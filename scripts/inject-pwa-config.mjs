/**
 * Vercel / CI: writes pwa-config.js (VAPID public key only — safe to expose in the client).
 * Set PWA_VAPID_PUBLIC_KEY in the Vercel project for Web Push subscriptions.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const out = join(root, 'pwa-config.js');

const vapidPublic = process.env.PWA_VAPID_PUBLIC_KEY || '';

if (!vapidPublic) {
  if (existsSync(out)) {
    console.warn('[inject-pwa-config] PWA_VAPID_PUBLIC_KEY missing — leaving existing pwa-config.js unchanged.');
    process.exit(0);
  }
}

const body = `/* Generated at build — VAPID public only; safe in client */
window.__PWA_VAPID_PUBLIC_KEY__ = ${JSON.stringify(vapidPublic)};
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body, 'utf8');
console.log('[inject-pwa-config] wrote', out);
