// PSO V2 cipher (formats/psov2.ts) and the download-quest payload.
//
// Known answers come from an independent transcription of newserv's
// PSOV2Encryption (src/PSOEncryption.cc) written in Python for this test; they
// are not copied from the port. Everything here is synthetic data: no Sega
// quest bytes are used.
//
// Run: node tests/psov2.test.ts
import { prsCompress } from '../client/src/formats/prscompress.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import {
  decodeDownloadQuestData,
  DLQ_HEADER_SIZE,
  encodeDownloadQuestData,
  PsoV2Cipher,
  psoV2Crypt,
  psoV2First,
} from '../client/src/formats/psov2.ts';

let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = (d: Uint8Array): string => Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
const hex32 = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');

const rng = (() => {
  let s = 246813579;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x100000000;
})();
const randomBytes = (n: number, alphabet = 256): Uint8Array => Uint8Array.from({ length: n }, () => (rng() * alphabet) | 0);

// 1. Known answers (seed 0x12345678, seed 0xDEADBEEF)
{
  const c = new PsoV2Cipher(0x12345678);
  const words = Array.from({ length: 8 }, () => hex32(c.next()));
  check(words.join(' ') === 'DAE88B96 CB3060B9 AE4C4E68 F0EE2029 B20BA18A 33F1123F 3EAA77D2 03F5454B',
    `keystream for 0x12345678: ${words.join(' ')}`);

  const c2 = new PsoV2Cipher(0x12345678);
  for (let i = 0; i < 55; i++) c2.next();
  const wrap = [hex32(c2.next()), hex32(c2.next())];
  check(wrap.join(' ') === 'EEF55018 848B6582', `keystream after the first refill: ${wrap.join(' ')}`);

  check(hex32(psoV2First(0x12345678)) === 'DAE88B96', `psoV2First(0x12345678) = ${hex32(psoV2First(0x12345678))}`);
  check(hex32(psoV2First(0xdeadbeef)) === '03EA2F70', `psoV2First(0xDEADBEEF) = ${hex32(psoV2First(0xdeadbeef))}`);
  check(hex32(new PsoV2Cipher(0xdeadbeef).next()) === '03EA2F70', 'first word for 0xDEADBEEF');
  // psoV2First(seed) is the closed form of the first word for every seed
  let closedOk = true;
  for (let i = 0; i < 64; i++) {
    const s = (rng() * 0x100000000) >>> 0 || 1;
    if (psoV2First(s) !== new PsoV2Cipher(s).next()) closedOk = false;
  }
  check(closedOk, 'psoV2First matches the constructed cipher for 64 random seeds');
}

// 2. Encrypt then decrypt: the same XOR undoes itself, for every length
// (including the partial trailing word) and a few seeds.
{
  for (const seed of [1, 0x66, 0x12345678, 0xffffffff]) {
    for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 11, 63, 64, 65, 1000, 4096]) {
      const plain = randomBytes(n);
      const enc = psoV2Crypt(plain, seed);
      check(enc.length === n, `length kept for seed ${seed} n ${n}`);
      check(n < 4 || !same(enc, plain), `encryption changed data for seed ${seed} n ${n}`);
      check(same(psoV2Crypt(enc, seed), plain), `round trip seed ${seed} n ${n}`);
    }
  }
}

// 3. The prefix of a longer message encrypts the same (position-only keystream), so a
// trailing partial word does not change earlier bytes.
{
  const long = randomBytes(37);
  const full = psoV2Crypt(long, 0xc0ffee);
  let prefixOk = true;
  for (let n = 0; n <= long.length; n++) {
    if (!same(psoV2Crypt(long.subarray(0, n), 0xc0ffee), full.subarray(0, n))) prefixOk = false;
  }
  check(prefixOk, 'every prefix encrypts to the prefix of the full encryption');
}

// 4. Download-quest payload known answer: 11 synthetic bytes, decompressed size
// 0x1234, seed 0x12345678. The header is 4 bytes size + 4 bytes seed, then the
// bytes XORed with the stream (the last 3 bytes use the low bytes of a word).
{
  const payload = Uint8Array.from({ length: 11 }, (_, i) => i);
  const out = encodeDownloadQuestData(payload, 0x12345678, 0x1234);
  check(out.length === DLQ_HEADER_SIZE + 11, `payload length ${out.length}`);
  check(hex(out) === '3412000078563412968aead9bd6536cc604746', `download payload ${hex(out)}`);
  // The bytes are not a PRS stream, so decode (which checks the PRS size) is not
  // used here; undoing the cipher on the payload gives the input back.
  check(same(psoV2Crypt(out.subarray(DLQ_HEADER_SIZE), 0x12345678), payload), 'cipher undoes the known answer');
}

// 5. Round trip through the real PRS stream: the header size is the decompressed
// length, the decoded stream decompresses back to the input, and a wrong size is refused.
{
  const plain = new Uint8Array(3000);
  for (let i = 0; i < plain.length; i++) plain[i] = (i * 7 + (i >> 5)) & 0xff;
  const compressed = prsCompress(plain);
  for (const seed of [1, 0x7fffffff, 0xfeedface]) {
    const out = encodeDownloadQuestData(compressed, seed);
    const dv = new DataView(out.buffer);
    check(dv.getUint32(0, true) === plain.length, `default size for seed ${seed}`);
    check(dv.getUint32(4, true) === seed, `seed in header for ${seed}`);
    const dec = decodeDownloadQuestData(out);
    check(same(prsDecompress(dec.compressed), plain), `PRS round trip for seed ${seed}`);
    check(same(out.subarray(DLQ_HEADER_SIZE), psoV2Crypt(compressed, seed)), `payload is the V2 stream of the PRS bytes for ${seed}`);
  }
  const bad = encodeDownloadQuestData(compressed, 5, plain.length + 1);
  let threw = false;
  try {
    decodeDownloadQuestData(bad);
  } catch {
    threw = true;
  }
  check(threw, 'a wrong decompressed size is refused on decode');
}

// 6. Seed 0 means "random" in newserv; the port refuses it.
{
  let threw = false;
  try {
    encodeDownloadQuestData(Uint8Array.of(0), 0, 1);
  } catch {
    threw = true;
  }
  check(threw, 'seed 0 is refused');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('OK');
