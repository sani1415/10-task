/**
 * Vercel / CI: writes supabase-config.js from env (never commit secrets).
 * Set SUPABASE_URL and SUPABASE_ANON_KEY in the Vercel project.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const out = join(root, 'supabase-config.js');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
  if (existsSync(out)) {
    console.warn('[inject-supabase-config] env missing — leaving existing supabase-config.js unchanged.');
    process.exit(0);
  }
  console.warn(
    '[inject-supabase-config] SUPABASE_URL or SUPABASE_ANON_KEY missing — writing placeholder (local demo only).'
  );
}

const body = `/* Generated at build — do not commit secrets */
window.SUPABASE_URL = ${JSON.stringify(url)};
window.SUPABASE_ANON_KEY = ${JSON.stringify(key)};
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body, 'utf8');
console.log('[inject-supabase-config] wrote', out);
