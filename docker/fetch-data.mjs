// Downloads the PSOBB client data folder at container start, so a deploy
// needs no mounted data/ (docs/DEPLOY.md).
//
//   PSOBB_DATA_URL   a Google Drive share link or file id (or any direct http(s)
//                    URL) of ONE .zip / .tar.gz / .tgz holding the data/ folder.
//                    The files may be at the archive's root or inside a single
//                    top-level folder (data/, psobb-client/, ...).
//   PSOBB_DATA       where it is unpacked (default /data/psobb-client)
//
// Idempotent: a marker file records the URL that filled the folder, so a
// restart or redeploy with the same URL downloads nothing; a new URL replaces
// the folder's contents. A failure is logged and never stops the container
// (the page then asks each player for a data/ folder as before).
//
// Only use data you have the right to serve (docs/LEGAL.md).

import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MARKER = '.fetched-from';

// The Google Drive file id of a share link (/file/d/ID/..., ?id=ID, /open?id=ID,
// uc?id=ID) or a bare id; null for anything else.
export function driveFileId(input) {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)(drive|docs)\.google\.com$|(^|\.)drive\.usercontent\.google\.com$/.test(url.hostname)) return null;
  const m = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : (url.searchParams.get('id') ?? null);
}

// The URL to fetch for a Drive file id: the "usercontent" endpoint with the
// virus-scan confirmation already accepted (large files).
export function driveDownloadUrl(id) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

// Drive answers a file it will not stream directly with an HTML page holding a
// form whose hidden inputs make the real request. Returns that request's URL,
// or null when `html` is not such a page.
export function confirmFormUrl(html) {
  const form = html.match(/<form[^>]*id="download-form"[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/);
  if (!form) return null;
  const url = new URL(form[1].replaceAll('&amp;', '&'));
  for (const input of form[2].matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1];
    const value = (input[0].match(/value="([^"]*)"/)?.[1] ?? '').replaceAll('&amp;', '&');
    if (name) url.searchParams.set(name, value);
  }
  return url.toString();
}

export function archiveKind(head) {
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
  if (head[0] === 0x1f && head[1] === 0x8b) return 'tgz';
  return null;
}

function log(msg) {
  console.log(`[fetch-data] ${msg}`);
}

async function download(startUrl, file) {
  let url = startUrl;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
    if ((res.headers.get('content-type') ?? '').startsWith('text/html')) {
      const next = confirmFormUrl(await res.text());
      if (!next) throw new Error('the server returned a web page, not a file (is the link shared with "anyone with the link"?)');
      url = next;
      continue;
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
    return;
  }
  throw new Error('too many confirmation pages');
}

function unpack(file, dest) {
  const head = readFileSync(file).subarray(0, 4);
  const kind = archiveKind(head);
  if (!kind) throw new Error('the download is not a .zip or .tar.gz');
  const r = kind === 'zip' ? spawnSync('unzip', ['-q', '-o', file, '-d', dest]) : spawnSync('tar', ['-xzf', file, '-C', dest]);
  if (r.status !== 0) throw new Error(`${kind === 'zip' ? 'unzip' : 'tar'} failed: ${r.stderr?.toString().trim()}`);
}

// Moves a single top-level folder's contents up so the files sit at `dir`.
function flatten(dir) {
  for (;;) {
    const entries = readdirSync(dir).filter((n) => n !== '__MACOSX' && n !== MARKER);
    if (entries.length !== 1) return;
    const only = resolve(dir, entries[0]);
    if (!statSync(only).isDirectory()) return;
    for (const n of readdirSync(only)) renameSync(resolve(only, n), resolve(dir, n));
    rmSync(only, { recursive: true });
    rmSync(resolve(dir, '__MACOSX'), { recursive: true, force: true });
  }
}

export async function fetchData(source, target) {
  const marker = resolve(target, MARKER);
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === source && readdirSync(target).length > 1) {
    log(`already fetched into ${target}, nothing to do`);
    return;
  }
  const id = driveFileId(source);
  const url = id ? driveDownloadUrl(id) : source;
  mkdirSync(target, { recursive: true });
  // Download next to the target (same volume), unpack into a fresh folder, then swap.
  const tmp = `${target}.partial`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const archive = `${tmp}/archive`;
  log(id ? `downloading from Google Drive (file ${id.slice(0, 6)}...)` : `downloading from ${new URL(url).host}`);
  await download(url, archive);
  log(`downloaded ${(statSync(archive).size / 1048576).toFixed(0)} MB, unpacking`);
  const unpacked = `${tmp}/files`;
  mkdirSync(unpacked);
  unpack(archive, unpacked);
  rmSync(archive);
  flatten(unpacked);
  if (readdirSync(unpacked).length === 0) throw new Error('the archive is empty');
  for (const n of readdirSync(target)) rmSync(resolve(target, n), { recursive: true, force: true });
  for (const n of readdirSync(unpacked)) renameSync(resolve(unpacked, n), resolve(target, n));
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(marker, `${source}\n`);
  log(`ready: ${readdirSync(target).length - 1} entries in ${target}`);
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const source = process.env.PSOBB_DATA_URL?.trim();
  const target = resolve(process.env.PSOBB_DATA ?? '/data/psobb-client');
  if (!source) {
    log('PSOBB_DATA_URL is not set, skipping');
  } else {
    fetchData(source, target).catch((e) => log(`failed: ${e.message} (the page will ask players for their own data/ folder)`));
  }
}
