import crypto from 'crypto';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const privateKeyB64url = process.argv[2] || '';
if (!privateKeyB64url) {
  console.error('Usage: node scripts/derive-vapid-public.mjs <private_key_base64url>');
  process.exit(1);
}

function b64urlToBuf(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64');
}

function bufToB64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const priv = b64urlToBuf(privateKeyB64url);
if (priv.length !== 32) {
  console.error('Expected 32-byte private key, got', priv.length);
  process.exit(1);
}

const ecdh = crypto.createECDH('prime256v1');
ecdh.setPrivateKey(priv);
const pub = ecdh.getPublicKey(null, 'uncompressed');
const publicKey = bufToB64url(pub);

const out = join(root, 'supabase', '.secrets.vapid.env');
fs.writeFileSync(
  out,
  `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKeyB64url}\n`,
  'utf8'
);
console.log('Wrote', out);
console.log('VAPID_PUBLIC_KEY length', publicKey.length);
