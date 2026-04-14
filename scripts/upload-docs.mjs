/**
 * upload-docs.mjs
 * ----------------
 * 1. documents/ ফোল্ডারের সব JPG/PNG/PDF compress করে
 * 2. Supabase Storage waqf-files bucket-এ upload করে
 * 3. public.documents table-এ metadata insert করে (madrasa_rel_insert_document RPC)
 *
 * Usage:
 *   $env:TEACHER_PIN="yourpin"; node scripts/upload-docs.mjs [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SUPABASE_URL = 'https://bbdtoucanihtrymzpynq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiZHRvdWNhbmlodHJ5bXpweW5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDA0NjEsImV4cCI6MjA5MTMxNjQ2MX0.TPQtymiXFogCPCrT2ZbYFVZ7ziBrm5NNcB_XgPaPGPw';
const BUCKET = 'waqf-files';
const DOCS_DIR = path.join(ROOT, 'documents');
const DRY_RUN = process.argv.includes('--dry-run');

// ওই তিনটি ~৫৫ MB মজলিস PDF + যেকোনো ≥৫০ MB ফাইল স্কিপ
const SKIP_LARGE_PDF_BYTES = 50 * 1024 * 1024;

// pdf.js worker (Node)
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
).href;

const TEACHER_PIN = process.env.TEACHER_PIN || '';
if (!TEACHER_PIN && !DRY_RUN) {
  console.error('❌ TEACHER_PIN not set. Run: $env:TEACHER_PIN="yourpin"; node scripts/upload-docs.mjs');
  process.exit(1);
}
if (DRY_RUN) console.log('🔵 DRY RUN mode — no uploads, no DB changes\n');

// Image compression settings
const IMG_QUALITY = 72;
const IMG_MAX_WIDTH = 1600;
const IMG_MAX_HEIGHT = 2200;

// স্ক্যান করা (ইমেজ-হেভি) PDF — পেজ রেন্ডার করে JPEG
const PDF_RASTER_MAX_W = 1600;
const PDF_RASTER_MAX_H = 2200;
const PDF_RASTER_MAX_PAGES = 80;

// ── Load Firestore export metadata ───────────────────────────────────────────
const exportData = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore-export.json'), 'utf8'));
const submittedDocs = exportData.submittedDocuments || {};
const studentsFs = exportData.students || {};

// Firestore numeric studentId → waqf_id (waqf_001 format)
const fsIdToWaqf = {};
Object.values(studentsFs).forEach(s => {
  const data = s.data || {};
  const fsId = data.id;      // e.g. "1772388617441"
  const waqfId = (data.studentId || data.waqfId || '').replace(/-/g, '_'); // waqf_018
  if (fsId && waqfId) fsIdToWaqf[fsId] = waqfId;
});

// filename (basename) → submittedDoc metadata
const filenameMeta = {};
Object.entries(submittedDocs).forEach(([docId, d]) => {
  const data = d.data || {};
  const url = data.fileUrl || data.downloadURL || '';
  const match = url.match(/documents%2F[^%]+%2F([^?&]+)/);
  if (match) {
    const decoded = decodeURIComponent(match[1]);
    filenameMeta[decoded] = { docId, ...data };
  }
});

// ── Compression helpers ───────────────────────────────────────────────────────

async function compressImage(buf, ext) {
  const pipeline = sharp(buf).rotate();
  const meta = await pipeline.metadata();
  let p = sharp(buf).rotate();
  if (meta.width > IMG_MAX_WIDTH || meta.height > IMG_MAX_HEIGHT) {
    p = p.resize(IMG_MAX_WIDTH, IMG_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
  }
  const out = await p.jpeg({ quality: IMG_QUALITY, mozjpeg: true }).toBuffer();
  return { buf: out, mime: 'image/jpeg', ext: '.jpg' };
}

async function compressPdf(buf) {
  try {
    const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const out = await pdfDoc.save({ useObjectStreams: true });
    // Only use compressed version if it's actually smaller
    return out.length < buf.length ? Buffer.from(out) : buf;
  } catch (e) {
    console.warn(`    ⚠️  PDF compression failed (${e.message}), using original`);
    return buf;
  }
}

/**
 * ইমেজ-ভিত্তিক (স্ক্যান) PDF: প্রতিটি পেজ ক্যানভাসে রেন্ডার → sharp JPEG → নতুন PDF
 * টেক্সট-মাত্র PDF-এ আকার বাড়তে পারে — কলার সাইজ কম্পেয়ার করে নেয়।
 */
async function compressPdfRaster(buf) {
  const uint8 = new Uint8Array(buf);
  const loadingTask = getDocument({
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const n = pdf.numPages;
  if (n > PDF_RASTER_MAX_PAGES) {
    throw new Error(`too many pages (${n} > ${PDF_RASTER_MAX_PAGES})`);
  }

  const outPdf = await PDFDocument.create();

  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1.0 });
    let scale = Math.min(PDF_RASTER_MAX_W / vp1.width, PDF_RASTER_MAX_H / vp1.height);
    if (scale > 2.5) scale = 2.5;
    if (scale < 0.15) scale = 0.15;
    const viewport = page.getViewport({ scale });
    const w = Math.max(1, Math.floor(viewport.width));
    const h = Math.max(1, Math.floor(viewport.height));

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;

    const pngBuf = canvas.toBuffer('image/png');
    const jpgBuf = await sharp(pngBuf).jpeg({ quality: IMG_QUALITY, mozjpeg: true }).toBuffer();

    const embedded = await outPdf.embedJpg(jpgBuf);
    const dims = embedded.scale(1);
    const newPage = outPdf.addPage([dims.width, dims.height]);
    newPage.drawImage(embedded, {
      x: 0,
      y: 0,
      width: dims.width,
      height: dims.height,
    });
  }

  return Buffer.from(await outPdf.save({ useObjectStreams: true }));
}

/** pdf-lib রিসেভ খুব কম লাভ হলে রাস্টার চেষ্টা (স্ক্যান PDF) */
async function compressPdfSmart(buf) {
  const simple = await compressPdf(buf);
  const ratio = simple.length / Math.max(buf.length, 1);
  // টেক্সট PDF-এ সাধারণত simple-ই যথেষ্ট; রাস্টার শুধু যখন simple প্রায় কিছুই কমায় না
  if (ratio > 0.97 && buf.length > 120 * 1024) {
    try {
      const raster = await compressPdfRaster(buf);
      if (raster.length < simple.length) {
        return { buf: raster, mode: 'raster' };
      }
    } catch (e) {
      console.warn(`    ⚠️  PDF raster fallback: ${e.message}`);
    }
  }
  return { buf: simple, mode: 'pdf-lib' };
}

// ── Upload to Supabase Storage ────────────────────────────────────────────────

async function uploadFile(supabase, storagePath, buf, mime) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: mime, upsert: true });
  if (error) throw new Error(error.message);
}

// ── Insert document metadata via RPC ─────────────────────────────────────────

async function insertDoc(supabase, { studentDbId, studentName, fileName, fileSize, mime, storagePath, category, uploadedAt }) {
  const docId = crypto.randomUUID();
  const doc = {
    id: docId,
    student_id: studentDbId,
    student_name: studentName || '',
    file_name: fileName,
    file_type: mime,
    file_size: fileSize,
    category: category || 'general',
    note: '',
    storage_path: storagePath,
    file_url: null,
    is_read: false,
    uploaded_at: uploadedAt || new Date().toISOString(),
  };
  const { error } = await supabase.rpc('madrasa_rel_insert_document', {
    p_pin: TEACHER_PIN,
    p_role: 'teacher',
    p_doc: doc,
  });
  if (error) throw new Error(error.message);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Load students from DB
  let waqfToDb = {};
  let existingPaths = new Set();

  if (!DRY_RUN) {
    console.log('📋 Loading students from Supabase...');
    const { data: bootstrap, error: bootErr } = await supabase.rpc('madrasa_rel_teacher_bootstrap', { p_teacher_pin: TEACHER_PIN });
    if (bootErr) { console.error('Bootstrap error:', bootErr.message); process.exit(1); }
    const parsed = typeof bootstrap === 'string' ? JSON.parse(bootstrap) : bootstrap;
    const dbStudents = parsed?.students || [];
    dbStudents.forEach(s => { if (s.waqf_id) waqfToDb[s.waqf_id] = s; });
    console.log(`  ${dbStudents.length} students loaded`);
    existingPaths = new Set((parsed?.documents || []).map(d => d.storage_path).filter(Boolean));
    console.log(`  ${existingPaths.size} documents already in DB`);
  }

  const studentFolders = fs.readdirSync(DOCS_DIR).filter(f =>
    fs.statSync(path.join(DOCS_DIR, f)).isDirectory()
  );

  let total = 0, done = 0, skipped = 0, errors = 0;
  let origBytes = 0, compBytes = 0;

  for (const fsStudentId of studentFolders) {
    const waqfId = fsIdToWaqf[fsStudentId];
    const dbStudent = waqfId ? waqfToDb[waqfId] : null;
    const files = fs.readdirSync(path.join(DOCS_DIR, fsStudentId))
      .filter(f => fs.statSync(path.join(DOCS_DIR, fsStudentId, f)).isFile());

    console.log(`\n👤 ${fsStudentId} → ${waqfId || '?'} (${dbStudent?.name || 'unknown'}) — ${files.length} files`);

    for (const filename of files) {
      const filePath = path.join(DOCS_DIR, fsStudentId, filename);
      const ext = path.extname(filename).toLowerCase();
      const origBuf = fs.readFileSync(filePath);

      // ≥৫০ MB PDF স্কিপ (মজলিসের বড় স্ক্যান)
      if (ext === '.pdf' && origBuf.length >= SKIP_LARGE_PDF_BYTES) {
        console.log(`  ⏭️  ${filename} — স্কিপ (PDF ≥ ${(SKIP_LARGE_PDF_BYTES / 1024 / 1024).toFixed(0)} MB)`);
        skipped++;
        continue;
      }

      total++;
      origBytes += origBuf.length;

      const meta = filenameMeta[filename] || {};
      const origName = meta.fileName || filename;
      const category = meta.category || 'general';
      const uploadedAt = meta.createdAt || meta.submittedAt || null;

      // Storage path
        const ts = filename.match(/^(\d{10,})/)?.[1] || Date.now();
        // Remove leading timestamp from filename to avoid ts_ts_name duplication
        const nameWithoutTs = filename.replace(/^\d{10,}_?/, '');
        const safeName = path.basename(nameWithoutTs, ext).replace(/[^\w\u0600-\u06FF\u0980-\u09FF\-_.]/g, '_').substring(0, 80) || 'file';

      let finalExt = ext;
      let finalMime = 'application/octet-stream';
      let compBuf = origBuf;
      let pdfMode = null;

      try {
        if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          const r = await compressImage(origBuf, ext);
          compBuf = r.buf; finalExt = r.ext; finalMime = r.mime;
        } else if (ext === '.pdf') {
          const smart = await compressPdfSmart(origBuf);
          compBuf = smart.buf;
          pdfMode = smart.mode;
          finalMime = 'application/pdf'; finalExt = '.pdf';
        }

        const pct = ((1 - compBuf.length / origBuf.length) * 100).toFixed(0);
        const storagePath = `documents/${fsStudentId}/${ts}_${safeName}${finalExt}`;
        compBytes += compBuf.length;

        console.log(`  📄 ${filename}`);
        if (pdfMode) {
          console.log(`     [${pdfMode}]`);
        }
        console.log(`     ${(origBuf.length/1024).toFixed(0)} KB → ${(compBuf.length/1024).toFixed(0)} KB (${pct}% saved)`);
        console.log(`     → ${storagePath}`);

        if (existingPaths.has(storagePath)) {
          console.log(`     ⏭️  Already in DB, skipping`);
          skipped++; continue;
        }

        if (DRY_RUN) {
          console.log(`     🔵 [DRY RUN]`);
          skipped++; continue;
        }

        await uploadFile(supabase, storagePath, compBuf, finalMime);

        if (dbStudent) {
          await insertDoc(supabase, {
            studentDbId: dbStudent.id,
            studentName: dbStudent.name,
            fileName: origName,
            fileSize: compBuf.length,
            mime: finalMime,
            storagePath,
            category,
            uploadedAt,
          });
          console.log(`     ✅ Uploaded + DB saved`);
        } else {
          console.log(`     ✅ Uploaded (no DB student match)`);
        }
        done++;

      } catch (e) {
        console.error(`     ❌ ${e.message}`);
        errors++;
      }
    }
  }

  const savedMB = ((origBytes - compBytes) / 1024 / 1024).toFixed(1);
  const savedPct = ((1 - compBytes / origBytes) * 100).toFixed(0);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Summary`);
  console.log(`   Files     : ${total} total | ${done} uploaded | ${skipped} skipped | ${errors} errors`);
  console.log(`   Size      : ${(origBytes/1024/1024).toFixed(1)} MB → ${(compBytes/1024/1024).toFixed(1)} MB (saved ${savedMB} MB, ${savedPct}%)`);
  if (DRY_RUN) console.log(`\n   ℹ️  DRY RUN — no actual uploads`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
