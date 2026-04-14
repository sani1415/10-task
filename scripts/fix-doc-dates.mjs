import fs from 'fs';

const raw = fs.readFileSync('firestore-export.json', 'utf8');
const data = JSON.parse(raw);
const submitted = data.submittedDocuments || {};

// Build Firestore map: fileName+studentId -> originalTimestamp
const firestoreMap = {};
Object.entries(submitted).forEach(([, ddata]) => {
  const m = ddata.data || ddata;
  const ts = m.uploadedAt || m.timestamp || m.createdAt;
  if (!ts) return;
  const key1 = String(m.fileName || '').trim() + '|' + m.studentId;
  firestoreMap[key1] = ts;
  const key2 = 'name:' + String(m.fileName || '').trim();
  if (!firestoreMap[key2]) firestoreMap[key2] = ts;
});

// Supabase documents (all except the test doc)
const supabaseDocs = JSON.parse(fs.readFileSync('tmp-supabase-docs.json', 'utf8'));

let fromPrefix = 0, fromFirestore = 0, unmatched = 0;
const updates = [];

for (const doc of supabaseDocs) {
  const fn = doc.file_name || '';
  let ts = null;

  // Strategy 1: filename starts with 13-digit ms prefix e.g. 1773102001003_foo.jpg
  const m1 = fn.match(/^(\d{13})_/);
  if (m1) { ts = new Date(parseInt(m1[1])).toISOString(); fromPrefix++; }

  // Strategy 2: filename IS a long number e.g. 17732082273418827797208801210161.jpg
  if (!ts) {
    const m2 = fn.match(/^(\d{13,})\.(jpg|jpeg|png|pdf)$/i);
    if (m2) { ts = new Date(parseInt(m2[1].slice(0, 13))).toISOString(); fromPrefix++; }
  }

  // Strategy 3: Firestore map by fileName+studentId
  if (!ts) {
    const v = firestoreMap[fn.trim() + '|' + doc.student_id];
    if (v) { ts = v; fromFirestore++; }
  }

  // Strategy 4: Firestore map by fileName alone
  if (!ts) {
    const v = firestoreMap['name:' + fn.trim()];
    if (v) { ts = v; fromFirestore++; }
  }

  if (ts) {
    updates.push({ id: doc.id, ts });
  } else {
    unmatched++;
    console.error('NO MATCH:', fn, '| student:', doc.student_id);
  }
}

console.log(`Matched: ${updates.length} (prefix: ${fromPrefix}, firestore: ${fromFirestore}) | Unmatched: ${unmatched}`);

// Build SQL — update both documents.uploaded_at AND messages.sent_at
const docCases = updates.map(u => `  WHEN id = '${u.id}' THEN '${u.ts}'::timestamptz`).join('\n');
const msgCases = updates.map(u => `  WHEN extra->>'docId' = '${u.id}' THEN '${u.ts}'::timestamptz`).join('\n');
const ids = updates.map(u => `'${u.id}'`).join(', ');

const sql = `-- Fix document and message dates to original Firestore timestamps
UPDATE documents
SET uploaded_at = CASE
${docCases}
END
WHERE id IN (${ids});

UPDATE messages
SET sent_at = CASE
${msgCases}
END
WHERE type = 'doc'
  AND extra->>'docId' IN (${ids});
`;

fs.writeFileSync('tmp-fix-doc-dates.sql', sql);
console.log('Written: tmp-fix-doc-dates.sql');
console.log('Sample:', updates.slice(0, 3));
