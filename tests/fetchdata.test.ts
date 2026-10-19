// docker/fetch-data.mjs: Drive link parsing, the large-file confirmation page,
// and a real download of a .zip / .tar.gz from a local server into a folder
// (single top-level folder flattened, marker file, idempotence, new URL).
// Run: node web/tests/fetchdata.test.ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { archiveKind, confirmFormUrl, driveDownloadUrl, driveFileId, fetchData, findDataRoot } from '../docker/fetch-data.mjs';

let failures = 0;
function check(ok: boolean, msg: string): void {
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
}
function eq(a: unknown, b: unknown, msg: string): void {
  check(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
eq(driveFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), ID, 'share link');
eq(driveFileId(`https://drive.google.com/open?id=${ID}`), ID, 'open?id');
eq(driveFileId(`https://drive.google.com/uc?export=download&id=${ID}`), ID, 'uc?id');
eq(driveFileId(`https://drive.usercontent.google.com/download?id=${ID}&export=download`), ID, 'usercontent');
eq(driveFileId(ID), ID, 'bare id');
eq(driveFileId('https://example.com/data.zip'), null, 'other host is not Drive');
eq(driveFileId('not a url'), null, 'garbage');
check(driveDownloadUrl(ID).includes(`id=${ID}`) && driveDownloadUrl(ID).includes('confirm=t'), 'download url');
eq(archiveKind(Buffer.from([0x50, 0x4b, 3, 4])), 'zip', 'zip magic');
eq(archiveKind(Buffer.from([0x1f, 0x8b, 8, 0])), 'tgz', 'gzip magic');
eq(archiveKind(Buffer.from('<htm')), null, 'html is not an archive');

const page =
  '<html><form id="download-form" action="https://drive.usercontent.google.com/download" method="get">' +
  '<input type="hidden" name="id" value="X1"><input type="hidden" name="confirm" value="t">' +
  '<input type="hidden" name="uuid" value="u-u&amp;id"></form></html>';
const next = new URL(confirmFormUrl(page) ?? 'http://none');
eq(next.searchParams.get('id'), 'X1', 'form id');
eq(next.searchParams.get('uuid'), 'u-u&id', 'form uuid');
eq(confirmFormUrl('<html>nothing</html>'), null, 'no form');

// A tiny data tree, zipped inside a data/ folder (with a macOS junk folder).
const work = mkdtempSync(resolve(tmpdir(), 'fetchdata-'));
const src = resolve(work, 'src/data');
mkdirSync(resolve(src, 'sub'), { recursive: true });
writeFileSync(resolve(src, 'a.bin'), 'AAA');
writeFileSync(resolve(src, 'sub/b.bin'), 'BBBB');
mkdirSync(resolve(work, 'src/__MACOSX'));
writeFileSync(resolve(work, 'src/__MACOSX/junk'), 'x');
const zip = resolve(work, 'data.zip');
const tgz = resolve(work, 'other.tgz');
check(spawnSync('zip', ['-qr', zip, 'data', '__MACOSX'], { cwd: resolve(work, 'src') }).status === 0, 'zip created');
check(spawnSync('tar', ['-czf', tgz, '-C', resolve(work, 'src/data'), '.']).status === 0, 'tgz created');

let hits = 0;
const server = createServer((req, res) => {
  hits++;
  const path = req.url ?? '';
  if (path.startsWith('/page')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<form id="download-form" action="http://127.0.0.1:${(server.address() as { port: number }).port}/data.zip" method="get"><input type="hidden" name="confirm" value="t"></form>`);
  }
  const file = path.startsWith('/other') ? tgz : path.startsWith('/whole') ? resolve(work, 'whole.zip') : zip;
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const target = resolve(work, 'out');
const log = console.log;
console.log = () => {};
try {
  await fetchData(`${base}/data.zip`, target);
  eq(readFileSync(resolve(target, 'a.bin'), 'utf8'), 'AAA', 'zip: file at the root after flatten');
  eq(readFileSync(resolve(target, 'sub/b.bin'), 'utf8'), 'BBBB', 'zip: nested file');
  check(!existsSync(resolve(target, '__MACOSX')) && !existsSync(resolve(target, 'data')), 'zip: junk and the data/ folder gone');
  eq(readFileSync(resolve(target, '.fetched-from'), 'utf8').trim(), `${base}/data.zip layout2`, 'marker holds the URL and the layout');

  const before = hits;
  await fetchData(`${base}/data.zip`, target);
  eq(hits, before, 'same URL: nothing downloaded again');

  await fetchData(`${base}/page`, resolve(work, 'viaPage'));
  eq(readFileSync(resolve(work, 'viaPage/a.bin'), 'utf8'), 'AAA', 'the confirmation page leads to the file');

  writeFileSync(resolve(target, 'stale.bin'), 'old');
  await fetchData(`${base}/other.tgz`, target);
  check(!existsSync(resolve(target, 'stale.bin')), 'a new URL replaces the old contents');
  eq(readFileSync(resolve(target, 'sub/b.bin'), 'utf8'), 'BBBB', 'tgz: files unpacked');
  check(!readdirSync(target).includes('.partial'), 'no .partial left behind');

  // A zip of the whole client folder: data/ (with data.gsl) next to the exes.
  mkdirSync(resolve(work, 'client/psobb-client/data/sub'), { recursive: true });
  writeFileSync(resolve(work, 'client/psobb-client/PsoBB.exe'), 'exe');
  writeFileSync(resolve(work, 'client/psobb-client/data/data.gsl'), 'GSL');
  writeFileSync(resolve(work, 'client/psobb-client/data/sub/c.bin'), 'C');
  check(spawnSync('zip', ['-qr', resolve(work, 'whole.zip'), 'psobb-client'], { cwd: resolve(work, 'client') }).status === 0, 'whole zip created');
  eq(findDataRoot(resolve(work, 'client/psobb-client')), resolve(work, 'client/psobb-client/data'), 'findDataRoot finds the folder with data.gsl');
  eq(findDataRoot(resolve(work, 'src')), null, 'findDataRoot: none without data.gsl');
  writeFileSync(resolve(work, 'whole.copy'), readFileSync(resolve(work, 'whole.zip')));
  const wholeTarget = resolve(work, 'whole-out');
  await fetchData(`${base}/whole.zip`, wholeTarget);
  eq(readFileSync(resolve(wholeTarget, 'data.gsl'), 'utf8'), 'GSL', 'whole client zip: data.gsl at the root');
  eq(readFileSync(resolve(wholeTarget, 'sub/c.bin'), 'utf8'), 'C', 'whole client zip: nested file');
  check(!existsSync(resolve(wholeTarget, 'PsoBB.exe')), 'whole client zip: the exe is not served');

  let failed = '';
  await fetchData(`${base}/data.zip?404`, resolve(work, 'x')).catch(() => {});
  try {
    server.close();
    await fetchData('http://127.0.0.1:1/none.zip', resolve(work, 'y'));
  } catch (e) {
    failed = (e as Error).message;
  }
  check(failed !== '', 'an unreachable URL rejects (the entry script only logs it)');
} finally {
  console.log = log;
  server.close();
  rmSync(work, { recursive: true, force: true });
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('fetchdata: all checks passed');
