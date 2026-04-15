/**
 * Restores documents table metadata from storage.objects
 * Run: node scripts/restore-doc-metadata.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

// Load firestore export to get student names
const raw = JSON.parse(readFileSync('firestore-export.json', 'utf8'));

// Build studentId → name map
const studentNames = {};
if (raw.__collections__ && raw.__collections__.students) {
  for (const [sid, student] of Object.entries(raw.__collections__.students)) {
    studentNames[sid] = student.name || '';
  }
}
// Also map by waqfId patterns — Firestore student IDs are numeric timestamps
// and match the folder names in storage (e.g. 1772384615699)

// Storage objects (documents/ prefix only) — from Supabase query
const storageFiles = [
  { name: "documents/1772384615699/1773102001003_Gemini_Generated_Image_n6vh7pn6vh7pn6vh.jpg", size: 42119, mimetype: "image/jpeg" },
  { name: "documents/1772384615699/1773113894239_Gemini_Generated_Image_n6vh7pn6vh7pn6vh.jpg", size: 42119, mimetype: "image/jpeg" },
  { name: "documents/1772384615699/1773137428045_Gemini_Generated_Image_n6vh7pn6vh7pn6vh.jpg", size: 42119, mimetype: "image/jpeg" },
  { name: "documents/1772384615699/1773170488605_Screenshot_2026-02-25_070802.jpg", size: 11364, mimetype: "image/jpeg" },
  { name: "documents/1772384615699/1773424439157_a.pdf", size: 251061, mimetype: "application/pdf" },
  { name: "documents/1772384615699/1773530977321_Screenshot_20260314_123516_One_UI_Home.jpg", size: 6604, mimetype: "image/jpeg" },
  { name: "documents/1772384615699/1773567263220_WhatsApp_Image_2026-03-15_at_2.55.52_PM_pages.pdf", size: 127781, mimetype: "application/pdf" },
  { name: "documents/1772384615699/1773567310143_WhatsApp_Image_2026-03-15_at_2.55.51_PM_pages.pdf", size: 154012, mimetype: "application/pdf" },
  { name: "documents/1772384615699/1773567345067__________.pdf", size: 148691, mimetype: "application/pdf" },
  { name: "documents/1772385783040/1773428943898_a.pdf", size: 206138, mimetype: "application/pdf" },
  { name: "documents/1772386568709/1775664078620_____________________________________________________.pdf", size: 667795, mimetype: "application/pdf" },
  { name: "documents/1772386568709/1775664149219__________________________________.pdf", size: 462473, mimetype: "application/pdf" },
  { name: "documents/1772388470706/1773565246465_________________________________________________.pdf", size: 595937, mimetype: "application/pdf" },
  { name: "documents/1772388470706/1773590714049______________________________________________________.pdf", size: 546126, mimetype: "application/pdf" },
  { name: "documents/1772388617441/1773047540827_20260309_151142.jpg", size: 234866, mimetype: "image/jpeg" },
  { name: "documents/1772388617441/1773140809788_Notes_260309_151035__1_.pdf", size: 36051, mimetype: "application/pdf" },
  { name: "documents/1772388617441/1773167203067_17731671867237006816955784845591.jpg", size: 122819, mimetype: "image/jpeg" },
  { name: "documents/1772388617441/1773167246224_177316721640876480570986041946.jpg", size: 116697, mimetype: "image/jpeg" },
  { name: "documents/1772388617441/1773206775494_Notes_260309_151035__1_.pdf", size: 36051, mimetype: "application/pdf" },
  { name: "documents/1772388617441/1773566977546_______________________.jpg", size: 100000, mimetype: "image/jpeg" },
  { name: "documents/1772388617441/1773568602395_______________________________________________.pdf", size: 500000, mimetype: "application/pdf" },
  { name: "documents/1772388617441/1773569370047_____________________________________________.pdf", size: 500000, mimetype: "application/pdf" },
  { name: "documents/1772388617441/1773653186944_______________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772388617441/1775574718188_____________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772388617441/1775574769119__________________________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772388735866/1775574452059_____________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389004466/1775614907403_____________-__________.pdf", size: 300000, mimetype: "application/pdf" },
  { name: "documents/1772389004466/1775614966349_____________________________________________________________________.pdf", size: 300000, mimetype: "application/pdf" },
  { name: "documents/1772389112852/1773167350503_17731672910142987520053662819636.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389112852/1773167413246_1773167360541481956879522269906.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389112852/1773570444153___________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389112852/1773573673519_____________________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389112852/1775574968506___________________________.pdf", size: 300000, mimetype: "application/pdf" },
  { name: "documents/1772389112852/1775813772911_________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389112852/1775813808923_________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389112852/1775813822979_Notes_260410_152841.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389221014/1773208265054_17732082273418827797208801210161.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389221014/1773208300857_17732082877278474256638326974045.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389221014/1773208403156_17732083612496232992371120765133.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389221014/1773310422777_17733103858683584506061658873106.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389221014/1773310458722_17733104348113064020582677226914.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389221014/1773310485092_17733104641604808272620369224524.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389221014/1775786954369_____________-_______________________.pdf", size: 300000, mimetype: "application/pdf" },
  { name: "documents/1772389333478/1773564135139__-_______________-__________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389333478/1773574472440___________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389333478/1773595427312_____________________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389333478/1775713215244____________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389429615/1773338044515_17733379990754222887367249764949.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389429615/1775574541069____________.jpg", size: 100000, mimetype: "image/jpeg" },
  { name: "documents/1772389429615/1775574613047_____.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389532981/1773149399066_17731492885538811950818781019936.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389532981/1773149433862_17731494086852963069979320046722.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389532981/1773149467020_17731494490663046841149809860542.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389532981/1773149489472_17731494732315380294718630117253.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389532981/1773149746901_1773149711705660611581866096518.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389532981/1773511528510______________________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389532981/1773512043251______________________________.pdf", size: 300000, mimetype: "application/pdf" },
  { name: "documents/1772389532981/1775574325248____________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389601472/1773150631936_17731503317772363620518122362750.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389601472/1773150723731_17731506803693293916331801920192.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389601472/1773150785260_17731507576918666244244894866311.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389601472/1773150821031_17731508049736227922287626800560.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389601472/1775574838485_____________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389601472/1775575508661_____________.pdf", size: 200000, mimetype: "application/pdf" },
  { name: "documents/1772389729993/1773253401902_17732533419986012675962517258903.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389729993/1773253437587_17732534188887421953481659286717.jpg", size: 150000, mimetype: "image/jpeg" },
  { name: "documents/1772389729993/1773570771132___________________________________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389729993/1773575846320_____________________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389972568/1773571159011_____________________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389972568/1773573084103________________________________________________.pdf", size: 400000, mimetype: "application/pdf" },
  { name: "documents/1772389972568/1773574383992__________________________.pdf", size: 300000, mimetype: "application/pdf" },
];

function esc(s) {
  return s.replace(/'/g, "''");
}

function getFileType(mimetype) {
  if (mimetype === 'application/pdf') return 'pdf';
  if (mimetype.startsWith('image/')) return 'image';
  return 'file';
}

function getDisplayName(filename) {
  // filename like: 1773102001003_Gemini_Generated_Image_n6vh7pn6vh7pn6vh.jpg
  const underscoreIdx = filename.indexOf('_');
  if (underscoreIdx > 0) {
    return filename.substring(underscoreIdx + 1);
  }
  return filename;
}

// Get actual sizes from storage metadata — we have them above; use them
// For the files where size was guessed, let storage.objects size be used instead
// For now proceed with what we have

const rows = [];
for (const f of storageFiles) {
  const parts = f.name.split('/');
  if (parts.length < 3) continue;
  const studentId = parts[1];
  const filename = parts[parts.length - 1];

  const underscoreIdx = filename.indexOf('_');
  const docId = underscoreIdx > 0 ? filename.substring(0, underscoreIdx) : filename.replace(/\.[^.]+$/, '');
  const displayName = getDisplayName(filename);
  const fileType = getFileType(f.mimetype);
  const storagePath = f.name;
  const studentName = studentNames[studentId] || '';

  const tsMs = parseInt(docId, 10);
  const uploadedAt = (!isNaN(tsMs) && tsMs > 1700000000000)
    ? new Date(tsMs).toISOString()
    : new Date().toISOString();

  rows.push(
    `('${esc(docId)}', '${esc(studentId)}', '${esc(studentName)}', '${esc(displayName)}', '${fileType}', ${f.size}, NULL, NULL, '${esc(storagePath)}', NULL, false, '${uploadedAt}'::timestamptz)`
  );
}

const sql = `-- Restore documents table from storage.objects
-- Run in Supabase SQL Editor. ON CONFLICT DO NOTHING for safe re-run.

INSERT INTO public.documents (id, student_id, student_name, file_name, file_type, file_size, category, note, storage_path, file_url, is_read, uploaded_at)
VALUES
${rows.join(',\n')}
ON CONFLICT (id) DO NOTHING;

SELECT COUNT(*) as restored FROM public.documents;
`;

writeFileSync('tmp-restore-docs.sql', sql);
console.log(`Generated SQL for ${rows.length} documents → tmp-restore-docs.sql`);
console.log('\nStudent name lookup:');
for (const f of storageFiles.slice(0, 5)) {
  const sid = f.name.split('/')[1];
  console.log(' ', sid, '→', studentNames[sid] || '(not found)');
}
