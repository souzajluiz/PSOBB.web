// PSO Blue Burst stream cipher (STANDARD key subtype).
// Ported from newserv src/PSOEncryption.cc (PSOBBEncryption), MIT license.
// Key files are newserv .nsk files: 0x48 bytes initial keys, 0x1000 bytes
// private keys, 8 bytes subtype.

export const NSK_SIZE = 0x1050;

export class BBCrypt {
  private ik: Uint32Array; // initial_keys, 0x12 dwords
  private pk: Uint32Array; // private_keys, 0x400 dwords

  constructor(nsk: Uint8Array, seed: Uint8Array) {
    if (nsk.length !== NSK_SIZE) throw new Error(`bad .nsk size ${nsk.length}`);
    const dv = new DataView(nsk.buffer, nsk.byteOffset, nsk.byteLength);
    const subtype = dv.getUint32(0x1048, true);
    if (subtype !== 0) throw new Error(`unsupported BB key subtype ${subtype}`);
    this.ik = new Uint32Array(0x12);
    this.pk = new Uint32Array(0x400);
    for (let i = 0; i < 0x12; i++) this.ik[i] = dv.getUint32(i * 4, true);
    for (let i = 0; i < 0x400; i++) this.pk[i] = dv.getUint32(0x48 + i * 4, true);
    this.applySeed(seed);
  }

  private f(v: number): number {
    const pk = this.pk;
    return (((pk[v >>> 24] + pk[((v >>> 16) & 0xff) + 0x100]) ^ pk[((v >>> 8) & 0xff) + 0x200]) +
      pk[(v & 0xff) + 0x300]) >>> 0;
  }

  // Runs one block of the key schedule; returns [esi, ecx] for the output slot.
  private scheduleBlock(esi: number, ecx: number): [number, number] {
    const ik = this.ik;
    esi = (esi ^ ik[0]) >>> 0;
    ecx = (ecx ^ (this.f(esi) ^ ik[1])) >>> 0;
    let ebx = this.f(ecx);
    for (let x = 0; x <= 5; x++) {
      ebx = (ebx ^ ik[x * 2 + 2]) >>> 0;
      esi = (esi ^ ebx) >>> 0;
      ebx = (this.f(esi) ^ ik[x * 2 + 3]) >>> 0;
      ecx = (ecx ^ ebx) >>> 0;
      ebx = this.f(ecx);
    }
    ebx = (ebx ^ ik[14]) >>> 0;
    esi = (esi ^ ebx) >>> 0;
    const eax = (ecx ^ (this.f(esi) ^ ik[15])) >>> 0;
    ecx = (this.f(eax) ^ ik[16] ^ esi) >>> 0;
    esi = (ik[17] ^ eax) >>> 0;
    return [esi, ecx];
  }

  private applySeed(original: Uint8Array): void {
    if (original.length % 3) throw new Error('seed size must be divisible by 3');
    const seed = new Uint8Array(original.length);
    for (let x = 0; x < original.length; x += 3) {
      seed[x] = original[x] ^ 0x19;
      seed[x + 1] = original[x + 1] ^ 0x16;
      seed[x + 2] = original[x + 2] ^ 0x18;
    }
    const n = seed.length;
    let c = 0;
    for (let i = 0; i < 0x12; i++) {
      const v = ((seed[c] << 24) | (seed[(c + 1) % n] << 16) | (seed[(c + 2) % n] << 8) | seed[(c + 3) % n]) >>> 0;
      this.ik[i] = (this.ik[i] ^ v) >>> 0;
      c = (c + 4) % n;
    }
    let esi = 0, ecx = 0;
    for (let i = 0; i < 0x12; i += 2) {
      [esi, ecx] = this.scheduleBlock(esi, ecx);
      this.ik[i] = esi;
      this.ik[i + 1] = ecx;
    }
    for (let i = 0; i < 0x400; i += 2) {
      [esi, ecx] = this.scheduleBlock(esi, ecx);
      this.pk[i] = esi;
      this.pk[i + 1] = ecx;
    }
  }

  encrypt(data: Uint8Array): void {
    if (data.length & 7) throw new Error('size must be a multiple of 8');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ik = this.ik;
    for (let o = 0; o < data.length; o += 8) {
      let ebx = (dv.getUint32(o, true) ^ ik[0]) >>> 0;
      let ebp = (this.f(ebx) ^ ik[1] ^ dv.getUint32(o + 4, true)) >>> 0;
      ebx = (ebx ^ this.f(ebp) ^ ik[2]) >>> 0;
      ebp = (ebp ^ this.f(ebx) ^ ik[3]) >>> 0;
      ebx = (ebx ^ this.f(ebp) ^ ik[4]) >>> 0;
      ebp = (ebp ^ ik[5]) >>> 0;
      dv.setUint32(o, ebp, true);
      dv.setUint32(o + 4, ebx, true);
    }
  }

  decrypt(data: Uint8Array): void {
    if (data.length & 7) throw new Error('size must be a multiple of 8');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ik = this.ik;
    for (let o = 0; o < data.length; o += 8) {
      let ebx = (dv.getUint32(o, true) ^ ik[5]) >>> 0;
      let ebp = (this.f(ebx) ^ ik[4] ^ dv.getUint32(o + 4, true)) >>> 0;
      ebx = (ebx ^ this.f(ebp) ^ ik[3]) >>> 0;
      ebp = (ebp ^ this.f(ebx) ^ ik[2]) >>> 0;
      ebx = (ebx ^ this.f(ebp) ^ ik[1]) >>> 0;
      ebp = (ebp ^ ik[0]) >>> 0;
      dv.setUint32(o, ebp, true);
      dv.setUint32(o + 4, ebx, true);
    }
  }
}
