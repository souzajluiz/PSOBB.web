// unitxt_*.prs: the client's text table, read with FUN_00792fe8(group, index).
// Layout after PRS decompression (FUN_0070b084): u32 group count G, then G
// u32 string counts, then one u32 offset per string for all groups in order;
// strings are NUL-terminated UTF-16LE.

import { prsDecompress } from '../formats/prs.ts';

export function parseUnitxt(prs: Uint8Array): string[][] {
  const d = prsDecompress(prs);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (o: number) => dv.getUint32(o, true);
  const readString = (o: number) => {
    let s = '';
    for (; o + 1 < d.length; o += 2) {
      const c = dv.getUint16(o, true);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const groups = u32(0);
  let slot = 1 + groups;
  const out: string[][] = [];
  for (let g = 0; g < groups; g++) {
    const n = u32(4 + g * 4);
    const strings: string[] = [];
    for (let i = 0; i < n; i++, slot++) strings.push(readString(u32(slot * 4)));
    out.push(strings);
  }
  return out;
}

// Group 11 (the menus' text, read by 0x0079317c) as PsoBB.exe indexes it: the
// party creation window asks for 0x139 (Play Mode "Normal", 0x00734578) and
// 0x13d (Difficulty "Normal", 0x00734628), the same word. The unitxt_e.prs
// inside Ephinea's data.gsl lacks group 11 entry 0xed ("Send to GM"), so from
// there on every entry sits one index lower (0x139 "Challenge", 0x13d "Hard")
// while the loose unitxt_j.prs and newserv's bb-v4 unitxt_e.prs line up.
export function menuTextAligned(table: string[][]): boolean {
  const g = table[11];
  return !!g && !!g[0x139] && g[0x139] === g[0x13d];
}

// The table with group 11 taken from the first alternative that is aligned,
// when the table's own group 11 is not (the other groups are kept: item names
// and descriptions differ between the files and are checked elsewhere).
export function withAlignedMenuText(table: string[][], alternatives: readonly string[][][]): string[][] {
  if (menuTextAligned(table)) return table;
  const fix = alternatives.find(menuTextAligned);
  if (!fix) return table;
  const out = table.slice();
  out[11] = fix[11];
  return out;
}
