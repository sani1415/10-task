/**
 * Fix document filenames — use real Bengali names from firestore-export.json
 * Run: node scripts/fix-docnames.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('firestore-export.json', 'utf8'));
const submitted = data.submittedDocuments || {};

function esc(s) {
  return String(s || '').replace(/'/g, "''");
}

const updates = [];
for (const [, wrap] of Object.entries(submitted)) {
  const d = wrap.data || wrap;
  const url = d.fileUrl || d.downloadURL || '';
  const m = url.match(/documents%2F[^%]+%2F([^?&]+)/);
  if (!m) continue;

  const storageName = decodeURIComponent(m[1]);
  const ts = storageName.split('_')[0]; // docId = timestamp prefix
  const realName = (d.fileName || '').trim();
  if (!realName || !ts) continue;

  updates.push(`UPDATE public.documents SET file_name = '${esc(realName)}' WHERE id = '${ts}';`);
  updates.push(`UPDATE public.messages SET text = '${esc(realName)}', extra = extra || jsonb_build_object('fileName', '${esc(realName)}') WHERE id = 'msg_doc_${ts}';`);
}

const sql = `-- Fix document filenames to original Bengali names\n-- Run in Supabase SQL Editor\n\n` + updates.join('\n') + `\n\nSELECT COUNT(*) as docs FROM public.documents;\n`;

writeFileSync('tmp-fix-docnames.sql', sql);
console.log(`Generated ${updates.length / 2} document name updates → tmp-fix-docnames.sql`);
