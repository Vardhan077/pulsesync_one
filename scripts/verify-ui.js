import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'extension/manifest.json',
  'extension/background.js',
  'extension/offscreen.js',
  'extension/popup.html',
  'extension/popup.js',
  'extension/popup.css',
  'pulsesync_react/pulsesync-dashboard/src/main.jsx',
  'pulsesync_react/pulsesync-dashboard/src/App.jsx',
  'pulsesync_react/pulsesync-dashboard/src/index.css',
];

let ok = true;
for (const rel of requiredFiles) {
  if (!existsSync(path.join(root, rel))) {
    console.error(`FAIL missing required UI/runtime file: ${rel}`);
    ok = false;
  }
}

const manifest = JSON.parse(readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
for (const permission of ['tabCapture', 'offscreen', 'storage']) {
  if (!manifest.permissions?.includes(permission)) {
    console.error(`FAIL extension manifest lacks required permission: ${permission}`);
    ok = false;
  }
}

const popupHtml = readFileSync(path.join(root, 'extension/popup.html'), 'utf8');
const popupJs = readFileSync(path.join(root, 'extension/popup.js'), 'utf8');
const ids = [...popupJs.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map((match) => match[1]);
const missingIds = [...new Set(ids)].filter((id) => !new RegExp(`\\bid=["']${id}["']`).test(popupHtml));
if (missingIds.length) {
  console.error('FAIL popup references missing HTML ids:', missingIds);
  ok = false;
}

if (ok) console.log(`UI/extension structure checks passed (${requiredFiles.length} required files, ${new Set(ids).size} popup element IDs, required permissions present).`);
else process.exitCode = 1;
