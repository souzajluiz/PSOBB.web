// Quest files for the admin panel (docs/ADMIN.md, "Quests"): list, read and
// publish .bin / .dat / .qst files under newserv's system/quests.
//
// Everything that reaches the disk goes through this module's checks:
//   - the category is the name of an EXISTING directory directly under
//     system/quests (never created, never a path), the file name matches
//     ^[A-Za-z0-9_.-]{1,64}$ with no leading dot and no "..", an allowed
//     extension and a Blue Burst version tag (-bb);
//   - the resolved path is re-checked to be inside the real quests folder, and
//     an existing symlink at the target is refused;
//   - uploads are size-limited, base64-checked, then PRS-decompressed (with an
//     output cap) and parsed with the client's own parsers (client/src/formats,
//     loaded through Node's type stripping) before anything is written;
//   - the previous file is copied to a backup folder OUTSIDE system/quests, the
//     new one is written to a temp name and renamed into place.

import { Buffer } from 'node:buffer';
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class QuestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new QuestError(status, message);
};

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // per uploaded file
export const MAX_READ_BYTES = 8 * 1024 * 1024; // per file served to the editor
export const MAX_UNCOMPRESSED = 4 * 1024 * 1024; // PRS output cap
export const MAX_BODY_BYTES = 6 * 1024 * 1024; // the JSON upload (two base64 files)
const BACKUPS_KEPT = 30;

const CAT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const FILE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const BB_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*-bb(-[a-z])?\.(bin|dat|qst)$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const EXTS = ['.bin', '.dat', '.qst'];

export function checkCategoryName(name) {
  if (typeof name !== 'string' || !CAT_RE.test(name)) fail(400, 'invalid category');
  return name;
}

// A file name that may be listed / read: safe characters, no dot-files, no "..".
export function checkFileName(name) {
  if (typeof name !== 'string' || !FILE_RE.test(name) || name.startsWith('.') || name.includes('..')) fail(400, 'invalid file name (letters, digits, _ . - only, at most 64)');
  if (!EXTS.some((e) => name.endsWith(e))) fail(400, 'only .bin, .dat and .qst files');
  return name;
}

// A name the panel may WRITE: the above plus the Blue Burst version tag newserv
// reads (q123-bb-e.bin, q123-bb.dat, q123-bb.qst).
export function checkPublishName(name) {
  checkFileName(name);
  if (!BB_NAME_RE.test(name)) fail(400, 'name must look like q9001-bb-e.bin (.bin, language letter) or q9001-bb.qst: the "-bb" tag marks a Blue Burst quest');
  return name;
}

// The .dat that goes with a .bin: q9001-bb-e.bin -> q9001-bb.dat
export const datNameFor = (binName) => binName.replace(/-bb(-[a-z])?\.bin$/, '-bb.dat');

function decodeBase64(value, what) {
  if (typeof value !== 'string' || value.length === 0) fail(400, `${what} is missing`);
  if (value.length > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8) fail(413, `${what} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) fail(400, `${what} is not valid base64`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_FILE_BYTES) fail(413, `${what} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  if (bytes.length < 16) fail(400, `${what} is too small to be a quest file`);
  return bytes;
}

export function createQuestStore(options) {
  const questsDir = resolve(options.questsDir);
  const backupDir = resolve(options.backupDir);
  const mirrorDir = options.mirrorDir ? resolve(options.mirrorDir) : null;
  const formatsDir = resolve(options.formatsDir);
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => Date.now());
  let formats = null;

  async function loadFormats() {
    if (formats) return formats;
    try {
      const load = (f) => import(pathToFileURL(join(formatsDir, f)).href);
      const [prs, qst, bin, dat, write] = await Promise.all([load('prs.ts'), load('qst.ts'), load('questbin.ts'), load('questdat.ts'), load('questwrite.ts')]);
      formats = { prsDecompress: prs.prsDecompress, parseQst: qst.parseQst, parseQuestBin: bin.parseQuestBin, parseQuestDat: dat.parseQuestDat, serializeQuestBin: write.serializeQuestBin, serializeQuestDat: write.serializeQuestDat };
      return formats;
    } catch (e) {
      log(`quest formats not available in ${formatsDir}: ${e.message}`);
      return fail(503, 'quest validation is not available on this server (client/src/formats is missing); upload is disabled');
    }
  }

  function realQuestsDir() {
    try {
      return realpathSync(questsDir);
    } catch {
      return fail(500, 'the quests folder does not exist');
    }
  }

  // The directory of an existing category, or an error. The result is inside the real quests folder.
  function categoryDir(category) {
    checkCategoryName(category);
    const root = realQuestsDir();
    const dir = resolve(root, category);
    if (dirname(dir) !== root) fail(400, 'invalid category');
    let st;
    try {
      st = lstatSync(dir);
    } catch {
      return fail(404, 'no such category folder');
    }
    if (!st.isDirectory() || st.isSymbolicLink()) fail(400, 'invalid category');
    return dir;
  }

  function categories() {
    const root = realQuestsDir();
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.isSymbolicLink() && CAT_RE.test(d.name))
      .map((d) => d.name)
      .sort();
  }

  function listFiles() {
    return categories().map((dir) => {
      const files = [];
      for (const ent of readdirSync(join(realQuestsDir(), dir), { withFileTypes: true })) {
        if (!ent.isFile() || ent.isSymbolicLink()) continue;
        try {
          checkFileName(ent.name);
        } catch {
          continue;
        }
        files.push({ name: ent.name, size: statSync(join(realQuestsDir(), dir, ent.name)).size });
      }
      return { dir, files: files.sort((a, b) => a.name.localeCompare(b.name)) };
    });
  }

  function readFile(category, name) {
    checkFileName(name);
    const dir = categoryDir(category);
    const file = resolve(dir, name);
    if (dirname(file) !== dir) fail(400, 'invalid file name');
    let st;
    try {
      st = lstatSync(file);
    } catch {
      return fail(404, 'no such file');
    }
    if (!st.isFile() || st.isSymbolicLink()) fail(404, 'no such file');
    if (st.size > MAX_READ_BYTES) fail(413, 'file too large');
    return readFileSync(file);
  }

  // Parses what an upload carries, throwing QuestError(422) when it is not a
  // sound Blue Burst quest. Returns a short description.
  async function validateQuest({ bin, dat, qst }) {
    const f = await loadFormats();
    try {
      let binRaw;
      let datRaw;
      if (qst) {
        const parsed = f.parseQst(new Uint8Array(qst));
        binRaw = parsed.files.find((x) => x.filename === parsed.binFilename).data;
        datRaw = parsed.files.find((x) => x.filename === parsed.datFilename).data;
      } else {
        binRaw = f.prsDecompress(new Uint8Array(bin), MAX_UNCOMPRESSED);
        datRaw = f.prsDecompress(new Uint8Array(dat), MAX_UNCOMPRESSED);
      }
      if (binRaw.length > MAX_UNCOMPRESSED || datRaw.length > MAX_UNCOMPRESSED) fail(422, 'quest data is too large once decompressed');
      const parsedBin = f.parseQuestBin(binRaw);
      const h = parsedBin.header;
      if (!h.hasFullHeader) fail(422, 'not a Blue Burst quest: the .bin has no full 0x122C header');
      if (h.size !== 0 && h.size > binRaw.length) fail(422, 'the .bin header size is larger than the file');
      if (h.episode > 2) fail(422, 'the .bin header has an unknown episode');
      const parsedDat = f.parseQuestDat(datRaw);
      // Round trip: what the editor writes must read back.
      f.parseQuestBin(f.serializeQuestBin(parsedBin));
      f.parseQuestDat(f.serializeQuestDat(parsedDat));
      return { questNumber: h.questNumber, name: h.name, episode: h.episode, binBytes: binRaw.length, datBytes: datRaw.length };
    } catch (e) {
      if (e instanceof QuestError) throw e;
      return fail(422, `not a valid quest: ${String(e.message).slice(0, 160)}`);
    }
  }

  // newserv refuses a quest whose files (the basename, q9001-bb) sit in two categories ("file ...
  // exists in multiple categories", src/Quest.cc), so a publish may not put one there. The files of
  // the same quest may all replace each other inside their own category.
  function checkNoOtherCategory(category, name) {
    const base = name.replace(/-bb(?:-[a-z])?\.(bin|dat|qst)$/, '-bb');
    const root = realQuestsDir();
    for (const other of categories()) {
      if (other === category) continue;
      for (const ent of readdirSync(join(root, other), { withFileTypes: true })) {
        if (!ent.isFile() || ent.isSymbolicLink()) continue;
        if (ent.name.startsWith(`${base}-`) || ent.name.startsWith(`${base}.`)) {
          fail(409, `${ent.name} already exists in category ${other}: all files of a quest must be in one category (newserv refuses the quest otherwise)`);
        }
      }
    }
  }

  // Validates a publish request body and returns the plan; writes nothing.
  async function plan(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'body must be a JSON object');
    const category = checkCategoryName(body.category);
    const name = checkPublishName(body.name);
    const dir = categoryDir(category);
    checkNoOtherCategory(category, name);
    const writes = [];
    let info;
    if (name.endsWith('.qst')) {
      if (body.bin !== undefined || body.dat !== undefined) fail(400, 'send either qst, or bin and dat');
      const qst = decodeBase64(body.qst, 'qst');
      info = await validateQuest({ qst });
      writes.push({ name, bytes: qst });
    } else if (name.endsWith('.bin')) {
      if (body.qst !== undefined) fail(400, 'send either qst, or bin and dat');
      const bin = decodeBase64(body.bin, 'bin');
      const dat = decodeBase64(body.dat, 'dat');
      info = await validateQuest({ bin, dat });
      writes.push({ name, bytes: bin }, { name: datNameFor(name), bytes: dat });
    } else {
      fail(400, 'name must end in .bin (with dat) or .qst');
    }
    for (const w of writes) {
      checkPublishName(w.name);
      w.path = resolve(dir, w.name);
      if (dirname(w.path) !== dir) fail(400, 'invalid file name');
      w.replaces = false;
      try {
        const st = lstatSync(w.path);
        if (!st.isFile() || st.isSymbolicLink()) fail(409, `${w.name} exists and is not a regular file`);
        w.replaces = true;
      } catch (e) {
        if (e instanceof QuestError) throw e;
      }
    }
    return { category, dir, name, writes, info, target: `${category}/${name}` };
  }

  function backup(category, w) {
    const dir = join(backupDir, category);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const dest = join(dir, `${w.name}.${stamp}`);
    copyFileSync(w.path, dest);
    const old = readdirSync(dir).filter((n) => n.startsWith(`${w.name}.`)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) rmSync(join(dir, n), { force: true });
    return dest;
  }

  // Writes a validated plan. Returns { files, backupFiles }. On a failure while
  // writing, whatever was already replaced is put back.
  function commit(p) {
    const backupFiles = p.writes.map(() => null);
    const renamed = [];
    const temps = [];
    try {
      for (const w of p.writes) {
        const tmp = `${w.path}.admin-tmp`;
        writeFileSync(tmp, w.bytes, { mode: 0o644 });
        temps.push(tmp);
      }
      p.writes.forEach((w, i) => {
        if (w.replaces) backupFiles[i] = backup(p.category, w);
        renameSync(`${w.path}.admin-tmp`, w.path);
        renamed.push(i);
      });
    } catch (e) {
      restore(p, backupFiles, renamed);
      for (const t of temps) rmSync(t, { force: true });
      throw e;
    }
    if (mirrorDir) {
      try {
        const md = join(mirrorDir, p.category);
        mkdirSync(md, { recursive: true });
        for (const w of p.writes) writeFileSync(join(md, w.name), w.bytes);
      } catch (e) {
        log(`quest mirror failed: ${e.message}`);
      }
    }
    return { files: p.writes.map((w) => ({ name: w.name, size: w.bytes.length, replaced: w.replaces })), backupFiles, renamed };
  }

  // Puts the previous files back (or removes the new ones) for the entries in `indexes`.
  function restore(p, backupFiles, indexes) {
    for (const i of indexes) {
      const w = p.writes[i];
      try {
        if (backupFiles[i]) {
          copyFileSync(backupFiles[i], w.path);
          if (mirrorDir) copyFileSync(backupFiles[i], join(mirrorDir, p.category, w.name));
        } else {
          unlinkSync(w.path);
          if (mirrorDir) rmSync(join(mirrorDir, p.category, w.name), { force: true });
        }
      } catch { /* best effort */ }
    }
  }

  const rollback = (p, result) => restore(p, result.backupFiles, result.renamed);

  return { categories, listFiles, readFile, plan, commit, rollback, validateQuest, questsDir, backupDir };
}
