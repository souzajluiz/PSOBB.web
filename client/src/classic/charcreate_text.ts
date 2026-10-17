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
