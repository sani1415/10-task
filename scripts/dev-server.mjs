import { spawn } from 'child_process';
import { networkInterfaces } from 'os';
import { join } from 'path';

const PORT = 3000;
const vercelBin = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel');

function getLanUrls(port) {
  const urls = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const net of entries || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      urls.push(`http://${net.address}:${port}`);
    }
  }
  return [...new Set(urls)];
}

function printAccessUrls() {
  const local = `http://localhost:${PORT}`;
  const lan = getLanUrls(PORT);
  console.log(`> Local:   ${local}`);
  if (lan.length) {
    for (const url of lan) console.log(`> Network: ${url}`);
  } else {
    console.log('> Network: (LAN IPv4 পাওয়া যায়নি — Wi‑Fi/Ethernet চেক করুন)');
  }
  console.log(`> Student: ${local}/student/`);
  if (lan[0]) console.log(`> Student: ${lan[0]}/student/ (মোবাইল)`);
}

const child = spawn(vercelBin, ['dev', '--listen', `0.0.0.0:${PORT}`], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let printedNetwork = false;

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!printedNetwork && /Ready!\s+Available at/i.test(text)) {
    printedNetwork = true;
    console.log('');
    printAccessUrls();
  }
});

child.stderr.on('data', (chunk) => process.stderr.write(chunk));

child.on('close', (code) => process.exit(code ?? 0));
