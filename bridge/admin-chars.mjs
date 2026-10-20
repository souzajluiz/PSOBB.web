// Offline editing of newserv's BB character files (system/players/player_<user>_<n>.psochar)
// and bank files (.psobank). newserv has no command that edits a character, so
// this is the only way; it is used only while the account is not online, with a
// backup copy before every write (docs/ADMIN.md).
//
// .psochar layout (little endian; newserv src/SaveFileFormats.hh, 0x399C bytes):
//   0000  command header (size 0x399C, command 0x00E7, flag 0)
//   0008  PSOBBCharacterFile: inventory (0x34C), disp data (0x190), ...
//         +04F0 save data..., +06F8 bank (num, meseta, 200 x 0x18)
// .psobank: u32 num_items, u32 meseta, num_items x { item 0x14, u16 amount, u16 present }.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const CHAR_FILE_SIZE = 0x399c;
const H = 8;
const INV = H + 0x0;
const DISP = H + 0x34c;
const PLAY_TIME = H + 0x4e8;
const BANK = H + 0x6f8;
const INV_SLOTS = 30;
const INV_ITEM = 0x1c;
const BANK_SLOTS = 200;
const BANK_ITEM = 0x18;

export const TECHNIQUES = [
  'Foie', 'Gifoie', 'Rafoie', 'Barta', 'Gibarta', 'Rabarta', 'Zonde', 'Gizonde', 'Razonde', 'Grants',
  'Deband', 'Jellen', 'Zalure', 'Shifta', 'Ryuker', 'Resta', 'Anti', 'Reverser', 'Megid',
];
export const SECTION_IDS = ['Viridia', 'Greenill', 'Skyly', 'Bluefull', 'Purplenum', 'Pinkal', 'Redria', 'Oran', 'Yellowboze', 'Whitill'];
export const CHAR_CLASSES = ['HUmar', 'HUnewearl', 'HUcast', 'RAmar', 'RAcast', 'RAcaseal', 'FOmarl', 'FOnewm', 'FOnewearl', 'HUcaseal', 'FOmar', 'RAmarl'];
const STAT_KEYS = ['atp', 'mst', 'evp', 'hp', 'dfp', 'ata', 'lck'];

export class CharError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,15}$/;

// ---- paths --------------------------------------------------------------------

function playersPath(playersDir, name) {
  const dir = resolve(playersDir);
  const file = resolve(dir, name);
  if (!file.startsWith(dir + sep)) throw new CharError('bad path');
  return file;
}

function checkUser(user) {
  if (typeof user !== 'string' || !USER_RE.test(user)) throw new CharError('unsupported BB username for file access');
  return user;
}

function checkIndex(i) {
  if (!Number.isInteger(i) || i < 0 || i > 15) throw new CharError('character slot must be 0-15');
  return i;
}

export function charPath(playersDir, user, index) {
  return playersPath(playersDir, `player_${checkUser(user)}_${checkIndex(index)}.psochar`);
}

export function bankPath(playersDir, user, target) {
  return target === 'shared'
    ? playersPath(playersDir, `shared_bank_${checkUser(user)}.psobank`)
    : playersPath(playersDir, `player_${checkUser(user)}_${checkIndex(target)}.psobank`);
}

export function listCharacterSlots(playersDir, user) {
  checkUser(user);
  if (!existsSync(playersDir)) return [];
  const re = /^player_(.+)_(\d+)\.psochar$/;
  const out = [];
  for (const f of readdirSync(playersDir)) {
    const m = re.exec(f);
    if (m && m[1] === user && Number(m[2]) <= 15) out.push(Number(m[2]));
  }
  return out.sort((a, b) => a - b);
}

// ---- backups / atomic writes ----------------------------------------------------

export function backupFile(playersDir, file, now = new Date()) {
  if (!existsSync(file)) return null;
  const dir = resolve(playersDir, '_admin-backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = file.slice(file.lastIndexOf(sep) + 1);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dest = join(dir, `${base}.${stamp}.bak`);
  copyFileSync(file, dest);
  // Keep the newest 30 backups of each file.
  const mine = readdirSync(dir).filter((f) => f.startsWith(base + '.') && f.endsWith('.bak')).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - 30))) unlinkSync(join(dir, old));
  return dest;
}

function atomicWrite(file, data) {
  const tmp = file + '.admin-tmp';
  writeFileSync(tmp, data, { mode: 0o644 });
  renameSync(tmp, file);
}

// ---- item helpers -------------------------------------------------------------

const hex = (buf, from, to) => Buffer.from(buf.subarray(from, to)).toString('hex');

export function itemKind(d1) {
  switch (d1[0]) {
    case 0: return 'Weapon';
    case 1: return d1[1] === 1 ? 'Armor' : d1[1] === 2 ? 'Shield' : d1[1] === 3 ? 'Unit' : 'Armor/Shield/Unit';
    case 2: return 'Mag';
    case 3: return d1[1] === 2 ? 'Technique disk' : 'Tool';
    case 4: return 'Meseta';
    default: return 'Unknown';
  }
}

function itemView(d1buf, id, d2buf) {
  return { data1: hex(d1buf, 0, 12), id, data2: hex(d2buf, 0, 4), kind: itemKind(d1buf) };
}

function parseItemInput(item, what) {
  if (!item || typeof item !== 'object') throw new CharError(`${what}: item object expected`);
  const { data1, data2 } = item;
  if (typeof data1 !== 'string' || !/^[0-9a-fA-F]{24}$/.test(data1)) throw new CharError(`${what}: data1 must be 24 hex digits (12 bytes)`);
  const d2 = data2 === undefined ? '00000000' : data2;
  if (typeof d2 !== 'string' || !/^[0-9a-fA-F]{8}$/.test(d2)) throw new CharError(`${what}: data2 must be 8 hex digits (4 bytes)`);
  const b1 = Buffer.from(data1, 'hex');
  if (b1[0] > 4) throw new CharError(`${what}: item class (first byte) must be 00-04`);
  return { d1: b1, d2: Buffer.from(d2, 'hex') };
}

// ---- reading ----------------------------------------------------------------------

export function loadCharBuffer(file) {
  if (!existsSync(file)) throw new CharError('character file not found', 404);
  if (statSync(file).size !== CHAR_FILE_SIZE) throw new CharError('character file has an unexpected size');
  const buf = readFileSync(file);
  if (buf.readUInt16LE(0) !== CHAR_FILE_SIZE || buf.readUInt16LE(2) !== 0x00e7) throw new CharError('not a BB character file');
  return buf;
}

function decodeName(buf) {
  let s = buf.subarray(DISP + 0x74, DISP + 0x74 + 0x20).toString('utf16le');
  const z = s.indexOf('\0');
  if (z >= 0) s = s.slice(0, z);
  return s.replace(/^\t[A-Za-z]/, '').replace(/[\u0000-\u001f]/g, '');
}

export function readBankSection(buf, off, slots) {
  const num = Math.min(buf.readUInt32LE(off), slots);
  const items = [];
  for (let i = 0; i < num; i++) {
    const o = off + 8 + i * BANK_ITEM;
    items.push({ ...itemView(buf.subarray(o, o + 12), buf.readUInt32LE(o + 12), buf.subarray(o + 16, o + 20)), amount: buf.readUInt16LE(o + 20), present: buf.readUInt16LE(o + 22) });
  }
  return { meseta: buf.readUInt32LE(off + 4), items };
}

export function parseCharacter(buf) {
  const techs = {};
  for (let i = 0; i < TECHNIQUES.length; i++) {
    const v1 = buf[DISP + 0x17c + i];
    techs[TECHNIQUES[i]] = v1 === 0xff ? null : v1 + buf[INV + 4 + i * INV_ITEM + 2] + 1;
  }
  const num = Math.min(buf[INV], INV_SLOTS);
  const items = [];
  for (let i = 0; i < num; i++) {
    const o = INV + 4 + i * INV_ITEM;
    const flags = buf.readUInt32LE(o + 4);
    items.push({ slot: i, state: buf[o], equipped: (flags & 8) !== 0, flags, ...itemView(buf.subarray(o + 8, o + 20), buf.readUInt32LE(o + 20), buf.subarray(o + 24, o + 28)) });
  }
  const sec = buf[DISP + 0x54];
  const cls = buf[DISP + 0x55];
  return {
    name: decodeName(buf),
    level: buf.readUInt32LE(DISP + 0x18) + 1,
    exp: buf.readUInt32LE(DISP + 0x1c),
    meseta: buf.readUInt32LE(DISP + 0x20),
    stats: Object.fromEntries(STAT_KEYS.map((k, i) => [k, buf.readUInt16LE(DISP + i * 2)])),
    sectionId: sec,
    sectionName: SECTION_IDS[sec] ?? 'Unknown',
    charClass: cls,
    className: CHAR_CLASSES[cls] ?? 'Unknown',
    playTimeSeconds: buf.readUInt32LE(PLAY_TIME),
    techniques: techs,
    inventory: items,
    bankInCharacterFile: readBankSection(buf, BANK, BANK_SLOTS),
  };
}

export function summarizeCharacter(buf) {
  const c = parseCharacter(buf);
  return { name: c.name, level: c.level, exp: c.exp, meseta: c.meseta, sectionName: c.sectionName, className: c.className, items: c.inventory.length };
}

// ---- editing --------------------------------------------------------------------------

function intIn(v, lo, hi, what) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new CharError(`${what} must be an integer from ${lo} to ${hi}`);
  return v;
}

// Applies a validated patch to a copy of the file buffer; returns { buf, changes }.
export function applyCharacterPatch(orig, patch) {
  if (!patch || typeof patch !== 'object') throw new CharError('patch object expected');
  const known = new Set(['level', 'exp', 'meseta', 'stats', 'sectionId', 'charClass', 'techniques', 'inventory']);
  for (const k of Object.keys(patch)) if (!known.has(k)) throw new CharError(`unknown field: ${k}`);
  const buf = Buffer.from(orig);
  const changes = [];
  const set32 = (off, v, label) => {
    const before = buf.readUInt32LE(off);
    if (before !== v) {
      buf.writeUInt32LE(v, off);
      changes.push(`${label} ${before} -> ${v}`);
    }
  };
  if (patch.level !== undefined) set32(DISP + 0x18, intIn(patch.level, 1, 200, 'level') - 1, 'level(0-based)');
  if (patch.exp !== undefined) set32(DISP + 0x1c, intIn(patch.exp, 0, 999_999_999, 'exp'), 'exp');
  if (patch.meseta !== undefined) set32(DISP + 0x20, intIn(patch.meseta, 0, 999_999, 'meseta'), 'meseta');
  if (patch.stats !== undefined) {
    if (typeof patch.stats !== 'object' || patch.stats === null) throw new CharError('stats must be an object');
    for (const [k, v] of Object.entries(patch.stats)) {
      const i = STAT_KEYS.indexOf(k);
      if (i < 0) throw new CharError(`unknown stat: ${k}`);
      intIn(v, 0, 9999, k);
      const before = buf.readUInt16LE(DISP + i * 2);
      if (before !== v) {
        buf.writeUInt16LE(v, DISP + i * 2);
        changes.push(`${k} ${before} -> ${v}`);
      }
    }
  }
  if (patch.sectionId !== undefined) {
    intIn(patch.sectionId, 0, 9, 'sectionId');
    if (buf[DISP + 0x54] !== patch.sectionId) changes.push(`section ${buf[DISP + 0x54]} -> ${patch.sectionId}`);
    buf[DISP + 0x54] = patch.sectionId;
  }
  if (patch.charClass !== undefined) {
    intIn(patch.charClass, 0, 11, 'charClass');
    if (buf[DISP + 0x55] !== patch.charClass) changes.push(`class ${buf[DISP + 0x55]} -> ${patch.charClass}`);
    buf[DISP + 0x55] = patch.charClass;
  }
  if (patch.techniques !== undefined) {
    if (typeof patch.techniques !== 'object' || patch.techniques === null) throw new CharError('techniques must be an object');
    for (const [name, level] of Object.entries(patch.techniques)) {
      const i = TECHNIQUES.indexOf(name);
      if (i < 0) throw new CharError(`unknown technique: ${name}`);
      const ext = INV + 4 + i * INV_ITEM + 2;
      if (level === null) {
        buf[DISP + 0x17c + i] = 0xff;
        buf[ext] = 0;
      } else {
        intIn(level, 1, 30, `technique ${name}`);
        const zero = level - 1;
        buf[DISP + 0x17c + i] = Math.min(zero, 0x0e);
        buf[ext] = Math.max(0, zero - 0x0e);
      }
      changes.push(`tech ${name} -> ${level === null ? 'none' : level}`);
    }
  }
  if (patch.inventory !== undefined) {
    const inv = patch.inventory;
    if (typeof inv !== 'object' || inv === null) throw new CharError('inventory must be an object');
    let n = Math.min(buf[INV], INV_SLOTS);
    // Slot bytes 1-3 (unknown, extension_data1/2) belong to the slot index, not
    // to the item (technique levels and flags live there): they never move.
    const moveSlot = (from, to) => {
      const a = INV + 4 + from * INV_ITEM;
      const b = INV + 4 + to * INV_ITEM;
      buf[b] = buf[a];
      buf.copy(buf, b + 4, a + 4, a + INV_ITEM);
    };
    const clearSlot = (i) => {
      const a = INV + 4 + i * INV_ITEM;
      buf[a] = 0;
      buf.fill(0, a + 4, a + INV_ITEM);
    };
    for (const s of inv.set ?? []) {
      const slot = intIn(s?.slot, 0, n - 1, 'inventory slot');
      const { d1, d2 } = parseItemInput(s, `inventory slot ${slot}`);
      const o = INV + 4 + slot * INV_ITEM + 8;
      d1.copy(buf, o);
      d2.copy(buf, o + 16);
      changes.push(`inventory[${slot}] = ${d1.toString('hex')}`);
    }
    const removes = [...new Set(inv.remove ?? [])].map((s) => intIn(s, 0, n - 1, 'inventory slot')).sort((a, b) => b - a);
    for (const slot of removes) {
      for (let i = slot; i < n - 1; i++) moveSlot(i + 1, i);
      clearSlot(n - 1);
      n--;
      changes.push(`inventory remove slot ${slot}`);
    }
    for (const item of inv.add ?? []) {
      if (n >= INV_SLOTS) throw new CharError('inventory is full (30 items)');
      const { d1, d2 } = parseItemInput(item, 'inventory add');
      const o = INV + 4 + n * INV_ITEM;
      buf[o] = 1; // in inventory, not equipped
      buf.writeUInt32LE(0, o + 4);
      d1.copy(buf, o + 8);
      buf.writeUInt32LE((0x00200000 + n) >>> 0, o + 20); // newserv re-assigns item ids when the game starts
      d2.copy(buf, o + 24);
      n++;
      changes.push(`inventory add ${d1.toString('hex')}`);
    }
    buf[INV] = n;
  }
  return { buf, changes };
}

// ---- bank files -----------------------------------------------------------------------------

// Effective bank of a character (or the shared one): the .psobank wins over the
// bank inside the .psochar, as newserv does (Client::bank_file).
export function loadBank(playersDir, user, target) {
  const file = bankPath(playersDir, user, target);
  if (existsSync(file)) {
    const buf = readFileSync(file);
    if (buf.length < 8) throw new CharError('bank file is truncated');
    const num = buf.readUInt32LE(0);
    if (num > BANK_SLOTS || buf.length < 8 + num * BANK_ITEM) throw new CharError('bank file is malformed');
    return { source: 'psobank', ...readBankSection(buf, 0, BANK_SLOTS) };
  }
  if (target !== 'shared') {
    const cf = charPath(playersDir, user, target);
    if (existsSync(cf)) return { source: 'psochar', ...readBankSection(loadCharBuffer(cf), BANK, BANK_SLOTS) };
  }
  return { source: 'none', meseta: 0, items: [] };
}

function encodeBank(bank) {
  const out = Buffer.alloc(8 + bank.items.length * BANK_ITEM);
  out.writeUInt32LE(bank.items.length, 0);
  out.writeUInt32LE(bank.meseta, 4);
  bank.items.forEach((it, i) => {
    const o = 8 + i * BANK_ITEM;
    Buffer.from(it.data1, 'hex').copy(out, o);
    out.writeUInt32LE(it.id >>> 0, o + 12);
    Buffer.from(it.data2, 'hex').copy(out, o + 16);
    out.writeUInt16LE(it.amount, o + 20);
    out.writeUInt16LE(it.present, o + 22);
  });
  return out;
}

export function applyBankPatch(bank, patch) {
  if (!patch || typeof patch !== 'object') throw new CharError('patch object expected');
  for (const k of Object.keys(patch)) if (!['meseta', 'remove', 'add'].includes(k)) throw new CharError(`unknown field: ${k}`);
  const out = { meseta: bank.meseta, items: bank.items.map((i) => ({ ...i })) };
  const changes = [];
  if (patch.meseta !== undefined) {
    out.meseta = intIn(patch.meseta, 0, 999_999, 'bank meseta');
    changes.push(`bank meseta ${bank.meseta} -> ${out.meseta}`);
  }
  const removes = [...new Set(patch.remove ?? [])].map((s) => intIn(s, 0, out.items.length - 1, 'bank slot')).sort((a, b) => b - a);
  for (const slot of removes) {
    out.items.splice(slot, 1);
    changes.push(`bank remove slot ${slot}`);
  }
  for (const item of patch.add ?? []) {
    if (out.items.length >= BANK_SLOTS) throw new CharError('bank is full (200 items)');
    const { d1, d2 } = parseItemInput(item, 'bank add');
    const amount = item.amount === undefined ? 1 : intIn(item.amount, 1, 999, 'amount');
    out.items.push({ data1: d1.toString('hex'), id: (0x00300000 + out.items.length) >>> 0, data2: d2.toString('hex'), amount, present: 1 });
    changes.push(`bank add ${d1.toString('hex')} x${amount}`);
  }
  return { bank: out, changes };
}

export function writeBank(playersDir, user, target, bank, now = new Date()) {
  const file = bankPath(playersDir, user, target);
  const backup = backupFile(playersDir, file, now);
  atomicWrite(file, encodeBank(bank));
  return backup;
}

export function writeCharacter(playersDir, file, buf, now = new Date()) {
  const backup = backupFile(playersDir, file, now);
  atomicWrite(file, buf);
  return backup;
}
