#!/usr/bin/env node
/**
 * One-time: Firestore export → Supabase `public.messages` (direct INSERT SQL).
 * Map Firestore top-level `messages` collection to app shape (thread_id = student Firestore id).
 *
 * Run in Supabase → SQL Editor (or psql as superuser): RLS blocks anon REST on `messages`.
 *
 * Usage:
 *   node scripts/import-firestore-messages.mjs [firestore-export.json] [--dry-run] [--print-sql] [--out-sql path.sql] [--batch 150]
 *
 * Env not required for --dry-run | --print-sql | --out-sql
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set();
  const paths = [];
  let outSqlPath = '';
  let batchSize = 150;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out-sql' && args[i + 1]) {
      outSqlPath = resolve(args[++i]);
      continue;
    }
    if (a === '--batch' && args[i + 1]) {
      batchSize = Math.max(1, parseInt(args[++i], 10) || 150);
      continue;
    }
    if (a.startsWith('--')) flags.add(a);
    else paths.push(a);
  }
  return {
    jsonPath: resolve(paths[0] || 'firestore-export.json'),
    dryRun: flags.has('--dry-run'),
    printSql: flags.has('--print-sql'),
    outSqlPath,
    batchSize,
  };
}

function sqlString(s) {
  return `'${String(s ?? '').replace(/'/g, "''")}'`;
}

function sqlJsonb(obj) {
  return `${sqlString(JSON.stringify(obj == null ? {} : obj))}::jsonb`;
}

function parseFirestoreTimestamp(ts) {
  if (ts == null || ts === '') return new Date();
  const s = String(ts).trim();
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  d = new Date(s.replace(' ', 'T'));
  if (!Number.isNaN(d.getTime())) return d;
  return new Date();
}

/** Valid thread targets: Firestore student document ids present under `students`. */
function loadValidStudentIds(raw) {
  const set = new Set();
  const bucket = raw.students;
  if (!bucket || typeof bucket !== 'object') return set;
  for (const wrap of Object.values(bucket)) {
    const d = wrap && wrap.data;
    if (!d) continue;
    if (d.id != null) set.add(String(d.id).trim());
  }
  return set;
}

/**
 * @param {string} docKey Firestore document key under `messages`
 * @param {object} d wrap.data
 * @param {Set<string>} validStudentIds
 */
function firestoreMessageToRow(docKey, d, validStudentIds) {
  if (!d || typeof d !== 'object') return { skip: true, reason: 'no_data' };

  const sidRaw = d.studentId;
  const sid = sidRaw != null ? String(sidRaw).trim() : '';
  if (!sid) return { skip: true, reason: 'missing_studentId' };
  if (!validStudentIds.has(sid)) return { skip: true, reason: 'unknown_student', studentId: sid };

  const sender = String(d.sender || '').toLowerCase();
  let role;
  if (sender === 'teacher') role = 'out';
  else if (sender === 'student') role = 'in';
  else return { skip: true, reason: 'bad_sender', sender: d.sender };

  const body = d.text != null ? d.text : d.message != null ? d.message : '';
  const text = String(body).slice(0, 100000);

  let type = String(d.messageType || 'text').trim() || 'text';
  if (type.length > 32) type = type.slice(0, 32);

  const id = String(d.id != null ? d.id : docKey).trim();
  if (!id) return { skip: true, reason: 'missing_id' };

  const extra = {};
  if (d.category) extra.category = d.category;
  if (Array.isArray(d.replyChain)) extra.replyChain = d.replyChain;
  if (Array.isArray(d.readBy)) extra.readBy = d.readBy;
  extra.firestoreDocId = docKey;

  const sent = parseFirestoreTimestamp(d.timestamp);
  const isRead = Boolean(d.read);

  return {
    skip: false,
    id,
    thread_id: sid,
    role,
    type,
    text,
    extra,
    is_read: isRead,
    sent_at: sent.toISOString(),
  };
}

function buildInsertBatch(rows) {
  if (!rows.length) return '';
  const lines = rows.map(
    (r) =>
      `(${sqlString(r.id)}, ${sqlString(r.thread_id)}, ${sqlString(r.role)}, ${sqlString(r.type)}, ${sqlString(r.text)}, ${sqlJsonb(r.extra)}, ${r.is_read ? 'true' : 'false'}, ${sqlString(r.sent_at)}::timestamptz)`,
  );
  return `INSERT INTO public.messages (id, thread_id, role, type, text, extra, is_read, sent_at)
VALUES
${lines.join(',\n')}
ON CONFLICT (id) DO NOTHING;`;
}

function main() {
  const { jsonPath, dryRun, printSql, outSqlPath, batchSize } = parseArgs(process.argv);

  if (!existsSync(jsonPath)) {
    console.error('File not found:', jsonPath);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const msgBucket = raw.messages;
  if (!msgBucket || typeof msgBucket !== 'object') {
    console.error('JSON has no top-level "messages" collection.');
    process.exit(1);
  }

  const validStudentIds = loadValidStudentIds(raw);
  if (!validStudentIds.size) {
    console.error('No student ids found under "students" — cannot validate thread_id.');
    process.exit(1);
  }

  const stats = { ok: 0, skip: 0, byReason: {} };
  const rows = [];
  const seenIds = new Map();

  for (const [docKey, wrap] of Object.entries(msgBucket)) {
    const row = firestoreMessageToRow(docKey, wrap && wrap.data, validStudentIds);
    if (row.skip) {
      stats.skip++;
      const r = row.reason || 'unknown';
      stats.byReason[r] = (stats.byReason[r] || 0) + 1;
      continue;
    }
    if (seenIds.has(row.id)) {
      stats.skip++;
      stats.byReason.duplicate_id = (stats.byReason.duplicate_id || 0) + 1;
      continue;
    }
    seenIds.set(row.id, true);
    rows.push(row);
    stats.ok++;
  }

  rows.sort((a, b) => {
    const ta = new Date(a.sent_at).getTime();
    const tb = new Date(b.sent_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  console.log(`Messages parsed: ${stats.ok} to import, ${stats.skip} skipped`);
  console.log('Skip breakdown:', JSON.stringify(stats.byReason));

  if (dryRun) {
    console.log('\nFirst 5 rows (preview):');
    for (const r of rows.slice(0, 5)) {
      console.log(
        `${r.id}\tthread=${r.thread_id}\t${r.role}\t${r.type}\t${r.text.slice(0, 60).replace(/\n/g, ' ')}…`,
      );
    }
    return;
  }

  const chunks = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    chunks.push(rows.slice(i, i + batchSize));
  }
  const header =
    '-- Firestore → public.messages (one-time)\n' +
    '-- Run in Supabase SQL Editor. ON CONFLICT DO NOTHING allows safe re-run.\n\n';
  const sqlBody = chunks.map((c) => buildInsertBatch(c)).filter(Boolean).join('\n\n');

  if (!sqlBody.trim()) {
    console.error('No SQL generated (zero rows).');
    process.exit(1);
  }

  const fullSql = header + sqlBody + '\n';

  if (outSqlPath) {
    writeFileSync(outSqlPath, fullSql, 'utf8');
    console.log('Wrote SQL file:', outSqlPath, `(${chunks.length} batch(es), batch size ${batchSize})`);
    return;
  }

  if (printSql) {
    process.stdout.write(fullSql);
    return;
  }

  console.error('Nothing to do. Use --dry-run, --print-sql, or --out-sql <file.sql>');
  process.exit(1);
}

main();
