// PSO V2 stream cipher and the download-quest payload that wraps it. Ported
// from newserv src/PSOEncryption.cc (PSOV2Encryption, PSOLFGEncryption::encrypt_t
// and next) and src/Quest.cc (PSODownloadQuestHeader, encode_download_quest_data,
// decode_dlq_data), MIT license. newserv's source is in vendor/newserv/src.
//
// The cipher is a lagged-Fibonacci XOR stream: a 0x39-word state, 0x38 words
// per refill, the first refill after five warm-up updates. Encryption and
// decryption are the same XOR (newserv's decrypt is an alias of encrypt).
//
// A download quest (.bin or .dat) is written to the client as
//   u32le decompressed_size      (not encrypted)
//   u32le encryption_seed        (not encrypted)
//   PRS-compressed bytes, XORed with the V2 stream seeded by encryption_seed
// The V2 cipher is used for every download quest, PSO V3 / GC included.
// newserv pads the payload to a multiple of 4 bytes before encrypting and then
// trims the pad again. Each byte's keystream byte depends only on its own
// position, so the pad changes nothing it keeps; this port encrypts the exact
// length and gets the same bytes.
//
// The .qst packing of these payloads (the DC / PC / GC A6 / A7 command structs,
// newserv encode_qst_file) is in formats/qst.ts (packQstFiles, parseQstFiles).

import { prsDecompress } from './prs.ts';

export const PSO_V2_STREAM_LENGTH = 0x38;
export const DLQ_HEADER_SIZE = 8;

// newserv PSOV2Encryption::single(seed): the first keystream word from the seed
// alone (the closed form of the constructor's first loop, no state needed).
export function psoV2First(seed: number): number {
  return (Math.imul(0xc6dcab76, seed >>> 0) - 0x9e1977ba) >>> 0;
}

export class PsoV2Cipher {
  private readonly stream = new Uint32Array(PSO_V2_STREAM_LENGTH + 1);
  private offset: number;

  constructor(seed: number) {
    // PSOV2Encryption::PSOV2Encryption(seed)
    let a = 1;
    let b = seed >>> 0;
    this.stream[0x37] = b;
    for (let vi = 0x15; vi <= 0x36 * 0x15; vi += 0x15) {
      this.stream[vi % 0x37] = a;
      const c = (b - a) >>> 0;
      b = a;
      a = c;
    }
    for (let x = 0; x < 5; x++) this.updateStream();
    this.offset = 1; // set by updateStream
  }

  private updateStream(): void {
    const s = this.stream;
    for (let z = 1; z < 0x19; z++) s[z] = (s[z] - s[z + 0x1f]) >>> 0;
    for (let z = 0x19; z < 0x38; z++) s[z] = (s[z] - s[z - 0x18]) >>> 0;
    this.offset = 1;
  }

  // PSOLFGEncryption::next()
  next(): number {
    if (this.offset === PSO_V2_STREAM_LENGTH) this.updateStream();
    return this.stream[this.offset++];
  }

  // PSOLFGEncryption::encrypt_t<false>: each 4-byte group (little endian) is
  // XORed with one keystream word; a trailing partial group XORs only its
  // low bytes, which is what newserv's memcpy of extra_bytes does.
  apply(data: Uint8Array): void {
    for (let i = 0; i < data.length; i += 4) {
      const k = this.next();
      for (let j = 0; j < 4 && i + j < data.length; j++) data[i + j] ^= (k >>> (8 * j)) & 0xff;
    }
  }
}

// Encrypts (or decrypts) a copy of the bytes with a fresh cipher.
export function psoV2Crypt(data: Uint8Array, seed: number): Uint8Array {
  const out = Uint8Array.from(data);
  new PsoV2Cipher(seed).apply(out);
  return out;
}

const checkSeed = (seed: number): void => {
  // newserv treats encryption_seed 0 as "pick a random one"; the port needs
  // the caller to choose the seed so the output is reproducible.
  if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffffffff) {
    throw new RangeError(`download quest seed must be an integer 1..0xFFFFFFFF, got ${seed}`);
  }
};

// newserv encode_download_quest_data(compressed_data, decompressed_size,
// encryption_seed). When decompressedSize is omitted it is the length of the
// PRS stream's decompression, as newserv's prs_decompress_size gives.
export function encodeDownloadQuestData(compressed: Uint8Array, seed: number, decompressedSize?: number): Uint8Array {
  checkSeed(seed);
  const size = decompressedSize ?? prsDecompress(compressed).length;
  if (!Number.isInteger(size) || size < 0 || size > 0xffffffff) throw new RangeError(`bad decompressed size ${size}`);
  const out = new Uint8Array(DLQ_HEADER_SIZE + compressed.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, size, true);
  dv.setUint32(4, seed, true);
  out.set(compressed, DLQ_HEADER_SIZE);
  new PsoV2Cipher(seed).apply(out.subarray(DLQ_HEADER_SIZE));
  return out;
}

export interface DecodedDownloadQuestData {
  compressed: Uint8Array; // the PRS stream, decrypted
  decompressedSize: number;
  seed: number;
}

// newserv decode_dlq_data: the header's size must match the stream's
// decompressed length.
export function decodeDownloadQuestData(data: Uint8Array): DecodedDownloadQuestData {
  if (data.length < DLQ_HEADER_SIZE) throw new Error('download quest: not enough data for the header');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decompressedSize = dv.getUint32(0, true);
  const seed = dv.getUint32(4, true);
  const compressed = psoV2Crypt(data.subarray(DLQ_HEADER_SIZE), seed);
  if (prsDecompress(compressed).length !== decompressedSize) {
    throw new Error('download quest: decompressed size does not match the header');
  }
  return { compressed, decompressedSize, seed };
}
