/**
 * POST /api/admin-ai
 * Gemini-backed, read-mostly admin assistant. The browser supplies a compact,
 * PIN-free snapshot; side effects are only proposed here and executed after
 * explicit confirmation in the teacher app.
 */
const MODEL = process.env.GEMINI_AI_MODEL || 'gemini-3.1-flash-lite';
const MAX_BODY_BYTES = 220 * 1024;
const buckets = new Map();

function ensureGeminiEnv() {
  if (process.env.GEMINI_API_KEY) return;
  const fs = require('fs');
  const path = require('path');
  for (const name of ['.env.local', '.env']) {
    try {
      const envPath = path.join(process.cwd(), name);
      if (!fs.existsSync(envPath)) continue;
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!match || match[1] !== 'GEMINI_API_KEY') continue;
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (value) process.env.GEMINI_API_KEY = value;
        return;
      }
    } catch (_) {}
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function rateLimited(req) {
  const raw = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown');
  const ip = raw.split(',')[0].trim();
  const now = Date.now();
  const entry = buckets.get(ip);
  if (!entry || now - entry.start > 60_000) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 20;
}

function cleanText(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function requestsBackupDownload(message) {
  const value = String(message || '').toLocaleLowerCase('bn-BD');
  const mentionsBackup = /ব্যাকআপ|backup|ডেটা\s*রপ্তানি|database\s*export/.test(value);
  const requestsDownload = /ডাউনলোড|download|রপ্তানি|export|নামাও|দাও|করো|করুন/.test(value);
  return mentionsBackup && requestsDownload;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => typeof part.text === 'string' ? part.text : '').join('').trim();
}

function parseModelJson(text) {
  const source = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(source);
  const reply = cleanText(parsed.reply, 5000);
  if (!reply) throw new Error('empty_reply');
  let action = null;
  if (parsed.action && parsed.action.type === 'send_message') {
    const studentId = cleanText(parsed.action.studentId, 80);
    const studentName = cleanText(parsed.action.studentName, 160);
    const message = cleanText(parsed.action.message, 1500);
    if (studentId && studentName && message) action = { type: 'send_message', studentId, studentName, message };
  } else if (parsed.action && parsed.action.type === 'download_backup') {
    action = { type: 'download_backup' };
  }
  return { reply, action };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return json(res, 204, {});
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'শুধু POST অনুমোদিত।' });
  if (rateLimited(req)) return json(res, 429, { ok: false, error: 'একটু পরে আবার চেষ্টা করুন।' });

  ensureGeminiEnv();
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return json(res, 500, { ok: false, error: 'AI সেবা কনফিগার করা নেই।' });

  let body;
  try {
    body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(await readBody(req));
  } catch (error) {
    return json(res, error?.message === 'payload_too_large' ? 413 : 400, { ok: false, error: 'অনুরোধটি গ্রহণ করা যায়নি।' });
  }

  const message = cleanText(body.message, 2000);
  const context = body.context && typeof body.context === 'object' ? body.context : null;
  const history = Array.isArray(body.history) ? body.history.slice(-8).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    text: cleanText(item?.text, 1200),
  })).filter((item) => item.text) : [];
  if (!message || !context || !Array.isArray(context.students)) {
    return json(res, 400, { ok: false, error: 'প্রশ্ন বা প্রয়োজনীয় তথ্য পাওয়া যায়নি।' });
  }
  if (requestsBackupDownload(message)) {
    return json(res, 200, {
      ok: true,
      reply: 'সম্পূর্ণ ডেটার JSON ব্যাকআপ ডাউনলোডের জন্য প্রস্তুত। নিচে নিশ্চিত করুন।',
      action: { type: 'download_backup' },
      model: 'deterministic-action',
    });
  }

  const system = `আপনি ওয়াকফুল মাদীনার শিক্ষক/অ্যাডমিনের বিশ্বস্ত বাংলা AI সহকারী।
আপনাকে দেওয়া APP_DATA-ই একমাত্র সত্য; তথ্য অনুমান করবেন না। উত্তর সংক্ষিপ্ত, স্পষ্ট ও সম্মানজনক বাংলায় দিন।
ছাত্রের নাম আংশিক বা উচ্চারণভেদে মিলিয়ে দেখুন। একাধিক সম্ভাব্য মিল থাকলে action দেবেন না; স্পষ্টীকরণ চাইবেন।
আজকের কাজ সম্পর্কে APP_DATA.students[].today ব্যবহার করুন। কোনো task-এর total 0 হলে তাকে সম্পন্ন দাবি করবেন না।
বিবরণ/সারসংক্ষেপে notes, recentMessages, today, overall ও pending ব্যবহার করুন এবং সময়সীমা উল্লেখ করুন।
শুধু ব্যবহারকারী স্পষ্টভাবে কোনো ছাত্রকে বার্তা পাঠাতে বললে send_message action প্রস্তাব করুন। আপনি নিজে বার্তা পাঠাননি—বলবেন অনুমোদনের জন্য খসড়ি প্রস্তুত।
ব্যবহারকারী স্পষ্টভাবে database/data/JSON backup download বা export করতে বললে download_backup action প্রস্তাব করুন। এটি বিদ্যমান app backup download চালাবে; আপনি নিজে database query করবেন না।
কোনো delete, edit, restore/import, broadcast, PIN, গোপন তথ্য বা অন্য side effect প্রস্তাব করবেন না।
শুধু বৈধ JSON দিন, markdown fence নয়:
{"reply":"বাংলা উত্তর","action":null}
অথবা
{"reply":"অনুমোদনের জন্য খসড়ি প্রস্তুত করেছি।","action":{"type":"send_message","studentId":"APP_DATA-এর exact id","studentName":"exact name","message":"পাঠানোর বাংলা বার্তা"}}
অথবা
{"reply":"ব্যাকআপ ডাউনলোডের জন্য প্রস্তুত।","action":{"type":"download_backup"}}`;

  const prompt = `${system}\n\nAPP_DATA:\n${JSON.stringify(context)}\n\nRECENT_CONVERSATION:\n${JSON.stringify(history)}\n\nADMIN_REQUEST:\n${message}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[admin-ai] Gemini error', response.status, data?.error?.message || 'unknown');
      return json(res, 502, { ok: false, error: 'AI সেবায় সাময়িক সমস্যা হয়েছে।' });
    }
    const result = parseModelJson(extractText(data));
    return json(res, 200, { ok: true, ...result, model: MODEL });
  } catch (error) {
    console.error('[admin-ai] request failed', error?.message || error);
    return json(res, 502, { ok: false, error: 'AI সহকারীর সঙ্গে যোগাযোগ করা যায়নি।' });
  }
};
