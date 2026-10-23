// The game's pointer read from a PE file's cursor resources (client/src/data/pecursor.ts):
// a synthetic PE with a .rsrc tree (group 102 -> cursor 2) and decoded pixels;
// then the user's own PsoBB.exe when one is present (PSOBB_EXE or
// ~/Downloads/psobb-client/PsoBB.exe), where group 102 is 32x32 with the
// arrow tip at (0, 0). The exe is never committed; without it that check is skipped.
// Run: node tests/pecursor.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const {
  decodeCursorResource,
  findPeResource,
  loadPeCursor,
  parseCursorGroup,
  RT_CURSOR,
  RT_GROUP_CURSOR,
} = await import('../client/src/data/pecursor.ts');

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// A cursor image: hotspot (0, 0), BITMAPINFOHEADER (biHeight = 2 * 2), a
// 2-entry BGRA palette (black, red), XOR rows bottom-up (8 bpp, 4-byte rows),
// AND rows bottom-up (1 bpp, 4-byte rows). Pixel (x, y), y down:
//   (0,0) red opaque; (1,0) black with AND 1 -> transparent;
//   (0,1) red opaque; (1,1) black opaque.
function cursorImage(): Uint8Array {
  const b = new Uint8Array(4 + 40 + 8 + 8 + 8);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, 0, true); // hotspot x
  dv.setUint16(2, 0, true); // hotspot y
  dv.setUint32(4, 40, true); // biSize
  dv.setInt32(8, 2, true); // biWidth
  dv.setInt32(12, 4, true); // biHeight (doubled)
  dv.setUint16(16, 1, true); // planes
  dv.setUint16(18, 8, true); // bpp
  dv.setUint32(36, 2, true); // biClrUsed (header offset 32)
  const p = 44;
  b.set([0, 0, 0, 0], p); // black
  b.set([0, 0, 255, 0], p + 4); // red (BGRA)
  const xor = p + 8;
  b.set([1, 0, 0, 0], xor); // bottom row (y = 1): red, black
  b.set([1, 0, 0, 0], xor + 4); // top row (y = 0): red, black
  const and = xor + 8;
  b.set([0, 0, 0, 0], and); // bottom row: both opaque
  b.set([0x40, 0, 0, 0], and + 4); // top row: x = 1 transparent
  return b;
}

// The group entry: 2 x 2, hotspot (1, 1) (ignored by the decoder), id 2.
function cursorGroup(id: number, bytes: number): Uint8Array {
  const g = new Uint8Array(6 + 14);
  const dv = new DataView(g.buffer);
  dv.setUint16(2, 2, true); // cursor
  dv.setUint16(4, 1, true); // one image
  dv.setUint16(6, 2, true); // width
  dv.setUint16(8, 2, true); // height
  dv.setUint16(10, 1, true);
  dv.setUint16(12, 1, true);
  dv.setUint32(14, bytes, true);
  dv.setUint16(18, id, true);
  return g;
}

// A PE32 file whose only section is .rsrc (RVA 0x1000, file offset 0x400) holding
// the resource tree: type 12 -> groupId -> 1033 -> group; type 1 -> cursorId -> 1033 -> cursor.
function buildPe(groupId: number, cursorId: number, group: Uint8Array, cursor: Uint8Array): Uint8Array {
  const align4 = (n: number) => (n + 3) & ~3;
  const dataCur = 160;
  const dataGrp = dataCur + align4(cursor.length);
  const rsrc = new Uint8Array(dataGrp + group.length);
  const dv = new DataView(rsrc.buffer);
  const ids = (o: number, n: number) => dv.setUint16(o + 14, n, true);
  ids(0, 2); // root: type 1, type 12
  dv.setUint32(16, 1, true);
  dv.setUint32(20, 0x80000000 | 32, true);
  dv.setUint32(24, 12, true);
  dv.setUint32(28, 0x80000000 | 96, true);
  ids(32, 1); // type 1 -> cursorId
  dv.setUint32(48, cursorId, true);
  dv.setUint32(52, 0x80000000 | 56, true);
  ids(56, 1); // language 1033 -> leaf
  dv.setUint32(72, 1033, true);
  dv.setUint32(76, 80, true);
  dv.setUint32(80, 0x1000 + dataCur, true); // leaf: data RVA, size
  dv.setUint32(84, cursor.length, true);
  ids(96, 1); // type 12 -> groupId
  dv.setUint32(112, groupId, true);
  dv.setUint32(116, 0x80000000 | 120, true);
  ids(120, 1);
  dv.setUint32(136, 1033, true);
  dv.setUint32(140, 144, true);
  dv.setUint32(144, 0x1000 + dataGrp, true);
  dv.setUint32(148, group.length, true);
  rsrc.set(cursor, dataCur);
  rsrc.set(group, dataGrp);

  const file = new Uint8Array(0x400 + rsrc.length);
  const fv = new DataView(file.buffer);
  file.set([0x4d, 0x5a], 0); // MZ
  fv.setUint32(0x3c, 0x40, true); // e_lfanew
  file.set([0x50, 0x45, 0, 0], 0x40); // PE\0\0
  fv.setUint16(0x46, 1, true); // one section
  fv.setUint16(0x54, 0xe0, true); // optional header size (PE32)
  fv.setUint16(0x58, 0x10b, true); // PE32
  fv.setUint32(0x58 + 96 + 2 * 8, 0x1000, true); // resource directory RVA
  fv.setUint32(0x58 + 96 + 2 * 8 + 4, rsrc.length, true);
  const sec = 0x58 + 0xe0;
  file.set(new TextEncoder().encode('.rsrc'), sec);
  fv.setUint32(sec + 8, rsrc.length, true); // virtual size
  fv.setUint32(sec + 12, 0x1000, true); // virtual address
  fv.setUint32(sec + 16, rsrc.length, true); // raw size
  fv.setUint32(sec + 20, 0x400, true); // raw pointer
  file.set(rsrc, 0x400);
  return file;
}

const cur = cursorImage();
const grp = cursorGroup(2, cur.length);
const pe = buildPe(102, 2, grp, cur);

// Resource lookup through the directory tree.
const foundCur = findPeResource(pe, RT_CURSOR, 2);
eq(foundCur ? foundCur.length : -1, cur.length, 'cursor resource found by type and id');
eq(findPeResource(pe, RT_CURSOR, 3), null, 'missing id: null');
eq(findPeResource(pe, RT_GROUP_CURSOR, 102)?.length, grp.length, 'group resource found');
eq(findPeResource(new Uint8Array(64), RT_GROUP_CURSOR, 102), null, 'not a PE: null');

// The group entry.
const entries = parseCursorGroup(grp);
eq(entries.map((e) => [e.width, e.height, e.id, e.bytes]), [[2, 2, 2, cur.length]], 'group entry: size, id, bytes');

// Decoding: palette indices, AND transparency, row order.
const dec = decodeCursorResource(cur);
eq(dec && [dec.width, dec.height, dec.hotX, dec.hotY], [2, 2, 0, 0], 'decoded size and hotspot');
const px = (x: number, y: number) => (dec ? Array.from(dec.rgba.slice((y * 2 + x) * 4, (y * 2 + x) * 4 + 4)) : []);
eq(px(0, 0), [255, 0, 0, 255], 'top-left: red, opaque (top row is the last XOR row)');
eq(px(1, 0), [0, 0, 0, 0], 'top-right: black with AND 1 is transparent');
eq(px(0, 1), [255, 0, 0, 255], 'bottom-left: red opaque');
eq(px(1, 1), [0, 0, 0, 255], 'bottom-right: black opaque with AND 0');

// The whole path: group -> cursor.
const cursor = loadPeCursor(pe, 102);
eq(cursor && [cursor.width, cursor.height, cursor.rgba.length], [2, 2, 16], 'loadPeCursor: decoded image');
eq(loadPeCursor(pe, 7), null, 'loadPeCursor: no such group');

// The user's own exe, when it is present (never committed).
const exePath = process.env.PSOBB_EXE ?? join(homedir(), 'Downloads', 'psobb-client', 'PsoBB.exe');
if (existsSync(exePath)) {
  const real = loadPeCursor(new Uint8Array(readFileSync(exePath)), 102);
  eq(real && [real.width, real.height, real.hotX, real.hotY], [32, 32, 0, 0], 'PsoBB.exe: group 102 is 32x32, hotspot (0, 0)');
  eq(real && real.rgba[3], 255, 'PsoBB.exe: the arrow tip (0, 0) is opaque');
  eq(real && real.rgba[(31 * 32 + 31) * 4 + 3], 0, 'PsoBB.exe: the bottom-right corner is transparent');
} else {
  console.log('pecursor: PsoBB.exe not found, the exe checks are skipped');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('pecursor: all checks passed');
