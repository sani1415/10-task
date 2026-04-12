#!/usr/bin/env node
/**
 * One-time: Firestore export → Supabase `students` via `madrasa_rel_upsert_student`.
 * ম্যাপিং `remote-sync-write.js` এর `stuToDB` / `api.js` ছাত্র শেইপের সাথে মিলিয়ে।
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, TEACHER_PIN
 * Args: [path/to/firestore-export.json] [--dry-run] [--fix-duplicate-pins] [--print-sql]
 *
 * পুরনো প্রজেক্টে `students.pin` UNIQUE থাকলে একই পিনে একাধিক ছাত্রে স্ক্রিপ্ট থামবে;
 * `--fix-duplicate-pins` (প্রথম ছাত্র আসল পিন, বাকিদের `পিন_ডকআইডির শেষ ৪ অংশ`)। নতুন DB-তে pin ইউনিক নাও হতে পারে।
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COLORS = ['#128C7E', '#1565C0', '#6A1B9A', '#BF360C', '#1B5E20', '#E65100', '#004D40', '#880E4F'];

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set();
  const paths = [];
  let outSqlPath = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out-sql' && args[i + 1]) {
      outSqlPath = resolve(args[++i]);
      continue;
    }
    if (a.startsWith('--')) flags.add(a);
    else paths.push(a);
  }
  return {
    jsonPath: resolve(paths[0] || 'firestore-export.json'),
    dryRun: flags.has('--dry-run'),
    fixDupPins: flags.has('--fix-duplicate-pins'),
    printSql: flags.has('--print-sql'),
    outSqlPath,
  };
}

function normalizeWaqfId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/waqf[_-]?0*(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 1) return null;
  return `waqf_${String(n).padStart(3, '0')}`;
}

function waqfSortKey(waqfId) {
  const m = String(waqfId || '').match(/waqf_0*(\d+)/i);
  return m ? parseInt(m[1], 10) : 999999;
}

function buildNote(d) {
  const parts = [];
  if (d.address) parts.push(`ঠিকানা: ${d.address}`);
  if (d.parentEmail) parts.push(`অভিভাবক ইমেইল: ${d.parentEmail}`);
  if (d.email) parts.push(`ইমেইল: ${d.email}`);
  if (d.phone) parts.push(`ফোন: ${d.phone}`);
  if (Array.isArray(d.notes) && d.notes.length)
    parts.push(`নোট: ${d.notes.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' | ')}`);
  if (d.dateOfBirth) parts.push(`জন্মতারিখ: ${d.dateOfBirth}`);
  if (d.pinSetBy) parts.push(`পিন সেট: ${d.pinSetBy}`);
  const text = parts.join('\n');
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

function firestoreDocToStudentPayload(d, color) {
  const waqfId = normalizeWaqfId(d.studentId);
  if (!waqfId) throw new Error(`waqf_missing:${d.id}:${d.studentId}`);
  const enrollment = d.enrollmentDate ? String(d.enrollmentDate).slice(0, 10) : '';
  return {
    id: String(d.id),
    waqf_id: waqfId,
    name: String(d.name || '').trim() || 'নামহীন',
    cls: '',
    roll: '',
    pin: String(d.pin != null ? d.pin : '').trim(),
    color,
    note: buildNote(d),
    father_name: String(d.parentName || '').trim(),
    father_occupation: String(d.fatherWork || '').trim(),
    contact: String(d.parentPhone || d.phone || '').trim(),
    district: String(d.district || '').trim(),
    upazila: String(d.upazila || '').trim(),
    blood_group: String(d.bloodGroup || '').trim(),
    enrollment_date: enrollment,
  };
}

function resolveDuplicatePins(rows, fix) {
  const out = rows.map((r) => ({ ...r }));
  const byPin = new Map();
  for (const r of out) {
    if (!byPin.has(r.pin)) byPin.set(r.pin, []);
    byPin.get(r.pin).push(r);
  }
  const dups = [...byPin.entries()].filter(([, list]) => list.length > 1);
  if (!dups.length) return out;

  if (!fix) {
    console.error('\n❌ একই পিনে একাধিক ছাত্র (Supabase এ pin UNIQUE):');
    for (const [pin, list] of dups) {
      console.error(`   পিন "${pin}": ${list.map((x) => `${x.name} (${x.id})`).join(' | ')}`);
    }
    console.error(
      '\nসমাধান: JSON এ পিন আলাদা করুন, অথবা সচেতনভাবে চালান:\n' +
        '   node scripts/import-firestore-students.mjs --fix-duplicate-pins\n',
    );
    process.exit(1);
  }

  const used = new Set(out.map((r) => r.pin));

  for (const [, list] of dups) {
    const sorted = [...list].sort((a, b) => {
      const w = waqfSortKey(a.waqf_id) - waqfSortKey(b.waqf_id);
      if (w !== 0) return w;
      return String(a.id).localeCompare(String(b.id));
    });
    const basePin = String(sorted[0].pin);
    for (let i = 1; i < sorted.length; i++) {
      const row = sorted[i];
      let candidate = `${basePin}_${String(row.id).slice(-4)}`;
      let guard = 0;
      while (used.has(candidate) && guard < 20) {
        candidate = `${basePin}_${String(row.id).slice(-Math.min(13, 6 + guard))}`;
        guard++;
      }
      if (used.has(candidate)) throw new Error(`pin_dedupe_failed:${row.id}`);
      console.warn(`⚠️  পিন পরিবর্তন: "${row.name}" (${row.id})  ${String(row.pin)} → ${candidate}`);
      row.pin = candidate;
      used.add(candidate);
    }
  }
  return out;
}

function sqlString(s) {
  return `'${String(s ?? '').replace(/'/g, "''")}'`;
}

/** MCP / psql: RPC-এর মতোই ON CONFLICT (id) আপডেট (waqf_id/color পরিবর্তন হয় না)। */
function buildUpsertSql(resolved) {
  const cols =
    'id, waqf_id, name, cls, roll, pin, color, note, father_name, father_occupation, contact, district, upazila, blood_group, enrollment_date';
  const valRows = resolved.map((r) => {
    const ed = r.enrollment_date ? sqlString(r.enrollment_date) + '::date' : 'NULL::date';
    return `(${sqlString(r.id)}, ${sqlString(r.waqf_id)}, ${sqlString(r.name)}, ${sqlString(r.cls)}, ${sqlString(r.roll)}, ${sqlString(r.pin)}, ${sqlString(r.color)}, ${sqlString(r.note)}, ${sqlString(r.father_name)}, ${sqlString(r.father_occupation)}, ${sqlString(r.contact)}, ${sqlString(r.district)}, ${sqlString(r.upazila)}, ${sqlString(r.blood_group)}, ${ed})`;
  });
  return `INSERT INTO public.students (${cols})
VALUES
${valRows.join(',\n')}
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  cls = EXCLUDED.cls,
  roll = EXCLUDED.roll,
  pin = EXCLUDED.pin,
  note = EXCLUDED.note,
  father_name = EXCLUDED.father_name,
  father_occupation = EXCLUDED.father_occupation,
  contact = EXCLUDED.contact,
  district = EXCLUDED.district,
  upazila = EXCLUDED.upazila,
  blood_group = EXCLUDED.blood_group,
  enrollment_date = EXCLUDED.enrollment_date;`;
}

async function rpcUpsertStudent(baseUrl, anonKey, teacherPin, pStudent) {
  const url = `${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/madrasa_rel_upsert_student`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ p_teacher_pin: teacherPin, p_student: pStudent }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.stringify(JSON.parse(text));
    } catch {
      /* keep text */
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
}

async function main() {
  const { jsonPath, dryRun, fixDupPins, printSql, outSqlPath } = parseArgs(process.argv);
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const teacherPin = process.env.TEACHER_PIN || '';

  if (!dryRun && !printSql && !outSqlPath && (!supabaseUrl || !anonKey || !teacherPin)) {
    console.error(
      'পরিবেশ ভেরিয়েবল লাগবে: SUPABASE_URL, SUPABASE_ANON_KEY, TEACHER_PIN\n' +
        '(শুধু দেখতে: --dry-run)',
    );
    process.exit(1);
  }

  if (!existsSync(jsonPath)) {
    console.error('ফাইল পাওয়া যায়নি:', jsonPath);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const bucket = raw.students;
  if (!bucket || typeof bucket !== 'object') {
    console.error('JSON এ "students" কালেকশন নেই।');
    process.exit(1);
  }

  const docs = Object.values(bucket)
    .map((wrap) => wrap && wrap.data)
    .filter(Boolean);

  const sorted = [...docs].sort((a, b) => {
    const wa = normalizeWaqfId(a.studentId) || '';
    const wb = normalizeWaqfId(b.studentId) || '';
    return waqfSortKey(wa) - waqfSortKey(wb) || String(a.id).localeCompare(String(b.id));
  });

  const rows = sorted.map((d, i) => firestoreDocToStudentPayload(d, COLORS[i % COLORS.length]));

  for (const r of rows) {
    if (!r.pin) {
      console.error('খালি পিন:', r.id, r.name);
      process.exit(1);
    }
  }

  const resolved = resolveDuplicatePins(rows, fixDupPins);

  if (printSql || outSqlPath) {
    const sql = buildUpsertSql(resolved);
    if (outSqlPath) {
      writeFileSync(outSqlPath, sql, 'utf8');
      console.error('SQL লেখা হয়েছে:', outSqlPath);
    } else {
      console.log(sql);
    }
    return;
  }

  console.log(`ছাত্র ${resolved.length} জন | dry-run=${dryRun} | ফাইল=${jsonPath}\n`);

  if (dryRun) {
    for (const r of resolved) {
      console.log(`${r.waqf_id}\t${r.id}\t${r.name}\tপিন=${r.pin}`);
    }
    return;
  }

  let ok = 0;
  for (const r of resolved) {
    try {
      await rpcUpsertStudent(supabaseUrl, anonKey, teacherPin, r);
      ok++;
      console.log(`✓ ${r.waqf_id}  ${r.name}`);
    } catch (e) {
      console.error(`✗ ${r.waqf_id}  ${r.name}`, e.message || e);
    }
  }
  console.log(`\nসম্পন্ন: ${ok}/${resolved.length}`);
  if (ok < resolved.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
