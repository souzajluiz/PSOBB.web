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
// Two encoders share the stream writer:
//   * prsCompress: greedy LZ77 with a 3-byte hash chain (window 8191 bytes,
//     matches up to 256 long) plus a brute-force 2-byte search inside the short
//     copy window. Fast; the ratio is close to, not identical to, the original
//     tools'. Used where speed matters (the admin panel's bomb-sized inputs).
//   * prsCompressOptimal: the optimal parse, as newserv's prs_compress_optimal
//     (src/Compression.cc): a shortest path over the command costs in bits
//     (literal 9, short copy 12, long copy 18, extended long copy 26), with
//     the same candidate windows (short: distance <= 256, length <= 5; long
//     and extended: distance <= 8191, length <= 256). The match finders are
//     exact (hash chains over the whole window), so the parse matches
//     newserv's byte for byte on the BB quests. Slower than prsCompress; about
//     0.5 s per 100 KB. The result is never larger than prsCompress's.

const MAX_LONG_DISTANCE = 0x1fff - 1; // offset field 0 is the end marker
const MAX_SHORT_DISTANCE = 0x100;
const MAX_LENGTH = 256;
const HASH_BITS = 15;
const MAX_CHAIN = 128;

// Distance 8191 is the largest valid long-copy distance (offset field 1).
const OPT_MAX_LONG_DISTANCE = 0x1fff;
const OPT_HASH_BITS = 16;

const COST_LITERAL = 9;
const COST_SHORT = 12;
const COST_LONG = 18;
const COST_EXTENDED = 26;

// Writes the control bits and the data bytes of a PRS stream.
class PrsWriter {
  private readonly out: Uint8Array;
  private pos = 0;
  private ctrlPos = 0; // position of the control byte being filled
  private ctrlBits = 0; // bits used in it

  constructor(capacity: number) {
    this.out = new Uint8Array(capacity);
  }

  bit(b: number): void {
    if (this.ctrlBits === 0) {
      this.ctrlPos = this.pos++;
      this.out[this.ctrlPos] = 0;
    }
    this.out[this.ctrlPos] |= b << this.ctrlBits;
    this.ctrlBits = (this.ctrlBits + 1) & 7;
  }

  byte(b: number): void {
    this.out[this.pos++] = b;
  }

  literal(b: number): void {
    this.bit(1);
    this.byte(b);
  }

  // dist 1..256, len 2..5
  shortCopy(dist: number, len: number): void {
    this.bit(0);
    this.bit(0);
    this.bit(((len - 2) >> 1) & 1);
    this.bit((len - 2) & 1);
    this.byte((-dist) & 0xff);
  }

  // dist 1..8191; len 3..9 is the 2-byte form, 10..256 the 3-byte extended form
  longCopy(dist: number, len: number): void {
    this.bit(0);
    this.bit(1);
    const off = ((-dist) & 0x1fff) << 3;
    if (len <= 9) {
      const a = off | (len - 2);
      this.byte(a & 0xff);
      this.byte(a >> 8);
    } else {
      this.byte(off & 0xff);
      this.byte(off >> 8);
      this.byte(len - 1);
    }
  }

  finish(): Uint8Array {
    // End marker: control bits 0, 1 and a zero offset.
    this.bit(0);
    this.bit(1);
    this.byte(0);
    this.byte(0);
    return this.out.slice(0, this.pos);
  }
}

export function prsCompress(data: Uint8Array): Uint8Array {
  // Worst case: every byte a literal = 9 bits per byte, plus the terminator.
  const w = new PrsWriter(Math.ceil((data.length * 9) / 8) + 16);

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
    if (useShort || bestLen >= 3) {
      if (useShort) w.shortCopy(bestDist, bestLen);
      else w.longCopy(bestDist, bestLen);
      for (let k = 0; k < bestLen; k++) insert(pos + k);
      pos += bestLen;
    } else {
      w.literal(data[pos]);
      insert(pos);
      pos++;
    }
  }

  return w.finish();
}

// Optimal parse (newserv's prs_compress_optimal): a shortest path over the
// command costs in bits, computed forward over every position, then emitted
// through the same writer. The result is never larger than prsCompress's: the
// greedy output is returned when the parse does not beat it (control bytes are
// rounded up, so the bit count and the byte count can disagree slightly).
export function prsCompressOptimal(data: Uint8Array): Uint8Array {
  const n = data.length;

  // Longest match per position in the short window (distance <= 256, length
  // 2..5). A match of length L at distance d also gives every shorter length
  // >= 2 at d, so one (length, distance) pair per position is enough.
  const shortLen = new Uint8Array(n);
  const shortDist = new Uint16Array(n);
  for (let i = 0; i + 1 < n; i++) {
    const cap = Math.min(5, n - i);
    let best = 1;
    const lo = Math.max(0, i - MAX_SHORT_DISTANCE);
    for (let c = i - 1; c >= lo && best < cap; c--) {
      if (data[c] !== data[i] || data[c + 1] !== data[i + 1]) continue;
      let len = 2;
      while (len < cap && data[c + len] === data[i + len]) len++;
      if (len > best) {
        best = len;
        shortDist[i] = i - c;
      }
    }
    if (best >= 2) shortLen[i] = best;
  }

  // Longest match per position in the long window (distance <= 8191, length
  // up to 256). Lengths 3..9 use the long form, 10..256 the extended one; both
  // share the distance, and the extended form's 1..9 lengths never win.
  const longLen = new Uint16Array(n);
  const longDist = new Uint16Array(n);
  const head = new Int32Array(1 << OPT_HASH_BITS).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  for (let i = 0; i + 2 < n; i++) {
    const h = Math.imul((data[i] << 16) | (data[i + 1] << 8) | data[i + 2], 0x9e3779b1) >>> (32 - OPT_HASH_BITS);
    const cap = Math.min(MAX_LENGTH, n - i);
    let best = 2;
    let bestDist = 0;
    // The chain is walked to the window edge (nearest first): exact, unlike a capped chain.
    for (let c = head[h]; c >= 0 && i - c <= OPT_MAX_LONG_DISTANCE; c = prev[c]) {
      // A candidate can only win if it matches the byte just past the best so far.
      if (best < cap && data[c + best] !== data[i + best]) continue;
      let len = 0;
      while (len < cap && data[c + len] === data[i + len]) len++;
      if (len > best) {
        best = len;
        bestDist = i - c;
        if (len === cap) break;
      }
    }
    prev[i] = head[h];
    head[h] = i;
    if (best >= 3) {
      longLen[i] = best;
      longDist[i] = bestDist;
    }
  }

  // Shortest path. cost[t] is the bit count of the cheapest parse of data[0..t);
  // from[t] and kind[t] describe its last command (kind 0 literal, 1 short
  // copy, 2 long or extended copy).
  const INF = 0x3fffffff;
  const cost = new Int32Array(n + 1).fill(INF);
  const from = new Int32Array(n + 1);
  const kind = new Uint8Array(n + 1);
  cost[0] = 0;
  const relax = (to: number, bits: number, src: number, k: number): void => {
    if (bits < cost[to]) {
      cost[to] = bits;
      from[to] = src;
      kind[to] = k;
    }
  };
  for (let i = 0; i < n; i++) {
    const c = cost[i]; // always reachable: a literal reaches i + 1 from i
    relax(i + 1, c + COST_LITERAL, i, 0);
    for (let len = 2; len <= shortLen[i]; len++) relax(i + len, c + COST_SHORT, i, 1);
    const maxLong = longLen[i];
    for (let len = 3; len <= Math.min(9, maxLong); len++) relax(i + len, c + COST_LONG, i, 2);
    for (let len = 10; len <= maxLong; len++) relax(i + len, c + COST_EXTENDED, i, 2);
  }

  // Walk the path back from the end, then emit it forwards.
  const ends: number[] = [];
  for (let t = n; t > 0; t = from[t]) ends.push(t);
  const w = new PrsWriter(Math.ceil((n * 9) / 8) + 16);
  for (let k = ends.length - 1; k >= 0; k--) {
    const end = ends[k];
    const start = from[end];
    const len = end - start;
    if (kind[end] === 0) {
      w.literal(data[start]);
    } else if (kind[end] === 1) {
      w.shortCopy(shortDist[start], len);
    } else {
      w.longCopy(longDist[start], len);
    }
  }
  const packed = w.finish();

  const greedy = prsCompress(data);
  return packed.length <= greedy.length ? packed : greedy;
}
