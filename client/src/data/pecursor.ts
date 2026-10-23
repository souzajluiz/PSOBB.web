// The game's mouse pointer, read from the user's own PsoBB.exe at run time.
//
// PsoBB.exe loads its default pointer with LoadCursorA(hInstance, 102) (the
// RT_GROUP_CURSOR id 102 in its .rsrc; exe 0x0082cdab, the LoadCursorA call that
// pushes 0x66 with the module handle). WM_SETCURSOR (WindowProc; the SetCursor
// chooser at exe 0x0082c649) shows it whenever the pointer is over the client
// area: WM_NCHITTEST HTCLIENT disables mouse input, and then the chooser sets
// g_hCursorDefault. That holds in every screen: title, menus and field. The
// pointer is hidden only in fullscreen (ShowCursor(0) is guarded by
// g_IsWindowMode == 0 in ProcessMouseInput, exe 0x0070973c), and the exe draws
// no sprite of its own at the pointer. So the browser shows this image as the
// CSS cursor of the game canvases.
//
// Nothing of the exe is committed or served from here: the bytes come from the
// user's copy (see data/source.ts readExe). Without it the page keeps the
// default pointer.
//
// The format (Windows PE / cursor resources):
//   RT_GROUP_CURSOR (type 12): WORD reserved, WORD type (2), WORD count, then
//     count x { BYTE/WORD width, height, WORD planes (hotspot x), WORD bitcount
//     (hotspot y), DWORD bytesInRes, WORD id }.
//   RT_CURSOR (type 1): WORD hotspot x, WORD hotspot y, then a BITMAPINFOHEADER
//     whose biHeight is twice the image height (XOR bitmap, then AND mask),
//     the palette (for 1/4/8 bpp), the XOR rows (bottom-up) and the AND rows
//     (1 bit per pixel, bottom-up, each row padded to 4 bytes).

export const RT_CURSOR = 1;
export const RT_GROUP_CURSOR = 12;

export interface PeCursor {
  width: number;
  height: number;
  hotX: number;
  hotY: number;
  // RGBA, top-down, width * height * 4 bytes. A pixel the AND mask makes
  // transparent (or whose XOR value is black under a set AND bit) has alpha 0.
  rgba: Uint8ClampedArray;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const s32 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

interface Section {
  va: number;
  vsize: number;
  raw: number;
  rawSize: number;
}

// The file offset of a resource-directory RVA, or -1.
function rvaToOffset(sections: Section[], rva: number): number {
  for (const s of sections) {
    const size = Math.max(s.vsize, s.rawSize);
    if (rva >= s.va && rva < s.va + size) return rva - s.va + s.raw;
  }
  return -1;
}

// The bytes of resource (type, id), any language; null when the exe has none.
// Named entries (strings) are skipped: the cursor resources are numeric.
export function findPeResource(exe: Uint8Array, type: number, id: number): Uint8Array | null {
  if (exe.length < 0x40 || exe[0] !== 0x4d || exe[1] !== 0x5a) return null;
  const pe = u32(exe, 0x3c);
  if (pe + 24 > exe.length || u32(exe, pe) !== 0x00004550) return null;
  const nSections = u16(exe, pe + 6);
  const optSize = u16(exe, pe + 20);
  const opt = pe + 24;
  const magic = u16(exe, opt);
  // Data directory 2 (the resource table): PE32 at +96, PE32+ at +112.
  const ddBase = opt + (magic === 0x20b ? 112 : 96);
  if (ddBase + 24 > exe.length) return null;
  const rsrcRva = u32(exe, ddBase + 16);
  if (rsrcRva === 0) return null;
  const sections: Section[] = [];
  for (let i = 0; i < nSections; i++) {
    const o = opt + optSize + i * 40;
    if (o + 40 > exe.length) break;
    sections.push({ vsize: u32(exe, o + 8), va: u32(exe, o + 12), rawSize: u32(exe, o + 16), raw: u32(exe, o + 20) });
  }
  const root = rvaToOffset(sections, rsrcRva);
  if (root < 0) return null;

  // Walks a directory; calls on each entry with its id (or -1 for a name) and
  // its target offset (relative to the resource root) and whether it is a
  // subdirectory.
  const entries = (dir: number) => {
    const named = u16(exe, dir + 12);
    const ids = u16(exe, dir + 14);
    const out: { id: number; target: number; sub: boolean }[] = [];
    for (let i = 0; i < named + ids; i++) {
      const e = dir + 16 + i * 8;
      if (e + 8 > exe.length) break;
      const name = u32(exe, e);
      const off = u32(exe, e + 4);
      out.push({ id: name & 0x80000000 ? -1 : name, target: off & 0x7fffffff, sub: (off & 0x80000000) !== 0 });
    }
    return out;
  };

  for (const t of entries(root)) {
    if (!t.sub || t.id !== type) continue;
    for (const n of entries(root + t.target)) {
      if (!n.sub || n.id !== id) continue;
      // Any language: the first leaf.
      const leaf = entries(root + n.target)[0];
      if (!leaf || leaf.sub) return null;
      const dataEntry = root + leaf.target;
      const dataRva = u32(exe, dataEntry);
      const size = u32(exe, dataEntry + 4);
      const off = rvaToOffset(sections, dataRva);
      if (off < 0 || off + size > exe.length) return null;
      return exe.subarray(off, off + size);
    }
  }
  return null;
}

export interface CursorGroupEntry {
  width: number;
  height: number;
  hotX: number;
  hotY: number;
  bytes: number;
  id: number;
}

// The entries of a RT_GROUP_CURSOR resource.
export function parseCursorGroup(group: Uint8Array): CursorGroupEntry[] {
  if (group.length < 6 || u16(group, 2) !== 2) return [];
  const count = u16(group, 4);
  const out: CursorGroupEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 14;
    if (o + 14 > group.length) break;
    const w = u16(group, o) || 256;
    const h = u16(group, o + 2) || 256;
    out.push({ width: w, height: h, hotX: u16(group, o + 4), hotY: u16(group, o + 6), bytes: u32(group, o + 8), id: u16(group, o + 12) });
  }
  return out;
}

// Decodes one RT_CURSOR resource (a cursor image, not an icon). Returns null
// for a layout this decoder does not know (1, 4, 8, 24 or 32 bpp only).
export function decodeCursorResource(res: Uint8Array): PeCursor | null {
  if (res.length < 4 + 40) return null;
  const hotX = u16(res, 0);
  const hotY = u16(res, 2);
  const hdr = 4;
  if (u32(res, hdr) < 40) return null;
  const width = s32(res, hdr + 4);
  const doubleHeight = s32(res, hdr + 8);
  const bpp = u16(res, hdr + 14);
  const compression = u32(res, hdr + 16);
  if (compression !== 0 || width <= 0 || doubleHeight <= 0) return null;
  const height = doubleHeight / 2;
  if (!Number.isInteger(height)) return null;
  const clrUsed = u32(res, hdr + 32);
  const headerSize = u32(res, hdr);
  let pos = hdr + headerSize;
  const palette: [number, number, number][] = [];
  if (bpp <= 8) {
    const n = clrUsed || 1 << bpp;
    for (let i = 0; i < n; i++) {
      const p = pos + i * 4;
      if (p + 4 > res.length) return null;
      palette.push([res[p + 2], res[p + 1], res[p]]); // BGRA quad
    }
    pos += n * 4;
  }
  const xorStride = Math.ceil((width * bpp) / 32) * 4;
  const andStride = Math.ceil(width / 32) * 4;
  const xorBytes = xorStride * height;
  const andBytes = andStride * height;
  if (pos + xorBytes > res.length) return null;
  const xor = pos;
  const and = pos + xorBytes;
  const hasAnd = and + andBytes <= res.length;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = height - 1 - y; // bitmap rows are bottom-up
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      const row = xor + src * xorStride;
      if (bpp === 1 || bpp === 4 || bpp === 8) {
        const perByte = 8 / bpp;
        const byte = res[row + Math.floor(x / perByte)];
        const idx = (byte >> (8 - bpp * (1 + (x % perByte)))) & ((1 << bpp) - 1);
        [r, g, b] = palette[idx] ?? [0, 0, 0];
      } else if (bpp === 24) {
        const p = row + x * 3;
        b = res[p];
        g = res[p + 1];
        r = res[p + 2];
      } else if (bpp === 32) {
        const p = row + x * 4;
        b = res[p];
        g = res[p + 1];
        r = res[p + 2];
        a = res[p + 3];
      }
      // AND bit 1: the screen shows through (the usual transparent colour of a
      // colour cursor is black with AND 1). A non-black XOR pixel would invert
      // the screen; a browser cursor cannot do that, so it is dropped too.
      // A 32 bpp image keeps its own alpha.
      if (hasAnd && bpp !== 32 && (res[and + src * andStride + (x >> 3)] >> (7 - (x & 7))) & 1) a = 0;
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return { width, height, hotX, hotY, rgba };
}

// The first cursor of group `groupId` in the exe, decoded; null when the exe has
// no such group or its image is in a layout this decoder does not read.
export function loadPeCursor(exe: Uint8Array, groupId = 102): PeCursor | null {
  const group = findPeResource(exe, RT_GROUP_CURSOR, groupId);
  if (!group) return null;
  for (const entry of parseCursorGroup(group)) {
    const res = findPeResource(exe, RT_CURSOR, entry.id);
    if (!res) continue;
    const cur = decodeCursorResource(res);
    if (cur) return cur;
  }
  return null;
}
