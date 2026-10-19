// Builds the web bundle of the native app (dist/, read by Capacitor): the
// classic client only, with its start page copied to index.html, which is the
// page the app opens. The server it talks to comes from VITE_SERVER_ORIGIN and
// must be https (the native app cannot reach the server on its own origin).
//
//   VITE_SERVER_ORIGIN=https://psobb.example.com npm run build:app

import { copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const origin = process.env.VITE_SERVER_ORIGIN ?? '';
if (!/^https:\/\/[^/]+$/.test(origin)) {
  console.error('VITE_SERVER_ORIGIN must be the https address of the PSOBB.web server, for example https://psobb.example.com');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
copyFileSync(resolve(root, 'dist/classic.html'), resolve(root, 'dist/index.html'));
console.log(`native bundle in dist/ (server ${origin})`);
