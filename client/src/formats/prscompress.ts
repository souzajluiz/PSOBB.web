// PRS (LZ77 variant used across PSO) compressor, the inverse of formats/prs.ts.
//
// Stream layout (as prsDecompress and newserv src/Compression.cc read it): a
// stream of control bits, LSB first, 8 per control byte. The control byte is
// inserted into the output at the point where its first bit is needed, so
// control bytes and data bytes interleave. Per token:
//
//   1                         literal: one raw byte follows
//   0 0 c1 c0  + u8 off       short copy: length (c1c0)+2 = 2..5, offset =
//                             off | ~0xFF (-256..-1)
//   0 1        + u16 a        long copy: offset = (a >> 3) | ~0x1FFF; length is
//                             (a & 7) + 2 = 3..9, or when a & 7 == 0 one more
//                             byte b follows and the length is b + 1
//   0 1        + 0x0000       end of stream (offset field 0)
//
// This encoder is a greedy LZ77 with a 3-byte hash chain (window 8191 bytes,
// matches up to 256 long) plus a brute-force 2-byte search inside the short
// copy window. The ratio is close to, not identical to, the original tools'.

const MAX_LONG_DISTANCE = 0x1fff - 1; // offset field 0 is the end marker
const MAX_SHORT_DISTANCE = 0x100;
const MAX_LENGTH = 256;
const HASH_BITS = 15;
const MAX_CHAIN = 128;

export function prsCompress(data: Uint8Array): Uint8Array {
  // Worst case: every byte a literal = 9 bits per byte, plus the terminator.
  const out = new Uint8Array(Math.ceil((data.length * 9) / 8) + 16);
  let outPos = 0;
  let ctrlPos = -1; // position of the control byte being filled
  let ctrlBits = 0; // bits used in it

  const pushBit = (bit: number): void => {
    if (ctrlBits === 0) {
      ctrlPos = outPos++;
      out[ctrlPos] = 0;
    }
    out[ctrlPos] |= bit << ctrlBits;
    ctrlBits = (ctrlBits + 1) & 7;
  };
  const pushByte = (b: number): void => {
    out[outPos++] = b;
  };

  const n = data.length;
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hash = (i: number): number => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & ((1 << HASH_BITS) - 1);
  const insert = (i: number): void => {
    if (i + 2 >= n) return;
    const h = hash(i);
    if (head[h] === i) return; // already inserted (lazy matching looks ahead)
    prev[i] = head[h];
    head[h] = i;
  };

  // Longest match at `pos`; the hash chain is only valid for positions < pos.
  const find = (pos: number): { len: number; dist: number } => {
    let bestLen = 0;
    let bestDist = 0;
    const maxLen = Math.min(MAX_LENGTH, n - pos);
    if (pos + 2 < n) {
      let cand = head[hash(pos)];
      for (let chain = 0; cand >= 0 && chain < MAX_CHAIN; chain++, cand = prev[cand]) {
        const dist = pos - cand;
        if (dist > MAX_LONG_DISTANCE) break;
        let len = 0;
        while (len < maxLen && data[cand + len] === data[pos + len]) len++;
        // Prefer the longer match; on a tie the nearer one (found first) wins,
        // it may fit the cheaper short form.
        if (len > bestLen) {
          bestLen = len;
          bestDist = dist;
          if (len === maxLen) break;
        }
      }
    }
    if (bestLen < 3 && pos + 1 < n) {
      // A 2-byte match is only worth it as a short copy (12 bits vs 18).
      const lo = Math.max(0, pos - MAX_SHORT_DISTANCE);
      for (let cand = pos - 1; cand >= lo; cand--) {
        if (data[cand] === data[pos] && data[cand + 1] === data[pos + 1]) {
          let len = 2;
          while (len < Math.min(5, maxLen) && data[cand + len] === data[pos + len]) len++;
          if (len > bestLen) {
            bestLen = len;
            bestDist = pos - cand;
          }
          break;
        }
      }
    }
    return { len: bestLen, dist: bestDist };
  };

  let pos = 0;
  while (pos < n) {
    let { len: bestLen, dist: bestDist } = find(pos);
    // Lazy matching: a clearly longer match one byte later beats taking this
    // one, so emit a literal now.
    if (bestLen >= 2 && bestLen < MAX_LENGTH && pos + 1 < n) {
      insert(pos);
      if (find(pos + 1).len > bestLen + 1) bestLen = 0;
    }
    // A 3+ byte match that needs the long form costs 18 bits (26 past 9
    // bytes), which beats literals from 3 bytes on; a short form (<= 5 bytes,
    // distance <= 256) costs 12 bits and wins from 2 bytes on.
    const useShort = bestLen >= 2 && bestLen <= 5 && bestDist <= MAX_SHORT_DISTANCE;
    if (bestLen >= 3 || useShort) {
      if (useShort) {
        pushBit(0);
        pushBit(0);
        pushBit(((bestLen - 2) >> 1) & 1);
        pushBit((bestLen - 2) & 1);
        pushByte((-bestDist) & 0xff);
      } else {
        pushBit(0);
        pushBit(1);
        const off = ((-bestDist) & 0x1fff) << 3;
        if (bestLen <= 9) {
          pushByte((off | (bestLen - 2)) & 0xff);
          pushByte((off | (bestLen - 2)) >> 8);
        } else {
          pushByte(off & 0xff);
          pushByte(off >> 8);
          pushByte(bestLen - 1);
        }
      }
      for (let k = 0; k < bestLen; k++) insert(pos + k);
      pos += bestLen;
    } else {
      pushBit(1);
      pushByte(data[pos]);
      insert(pos);
      pos++;
    }
  }

  // End marker: control bits 0, 1 and a zero offset.
  pushBit(0);
  pushBit(1);
  pushByte(0);
  pushByte(0);
  return out.slice(0, outPos);
}
