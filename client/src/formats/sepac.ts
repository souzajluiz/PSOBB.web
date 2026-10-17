// Sound effect banks: data/sound/<name>.pac.
//
// A bank is a run of waves with no file header. Each wave starts on a 32-byte
// boundary with a 0x20-byte header:
//   +0x00 PCMWAVEFORMAT (format tag 1, channels, rate, byte rate, block align, bits)
//   +0x10 12 bytes left over from the source RIFF ("data" + size, or another chunk)
//   +0x1c u32 PCM byte count
//   +0x20 PCM data
// PsoBB.exe does not walk the file: the bank loaders (FUN_00829a04 for
// common.pac, FUN_00828d40 for the area bank) take each wave's offset from
// 16-byte records in the exe (see audio/se_tables.ts). Walking the 32-byte
// aligned waves gives the same offsets for all 26 banks, in table order.

export interface SeWave {
  offset: number;
  channels: number;
  rate: number;
  bits: number;
  /** PCM bytes, little endian. */
  pcm: Uint8Array;
  /** Length in sample frames. */
  frames: number;
}

export function parseSePac(data: Uint8Array): SeWave[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const waves: SeWave[] = [];
  let o = 0;
  while (o + 0x20 <= data.length) {
    const tag = dv.getUint16(o, true);
    if (tag !== 1) throw new Error(`sound bank: format tag ${tag} at 0x${o.toString(16)}`);
    const channels = dv.getUint16(o + 2, true);
    const rate = dv.getUint32(o + 4, true);
    const blockAlign = dv.getUint16(o + 12, true);
    const bits = dv.getUint16(o + 14, true);
    const size = dv.getUint32(o + 0x1c, true);
    if (o + 0x20 + size > data.length) throw new Error(`sound bank: wave at 0x${o.toString(16)} overruns the file`);
    waves.push({ offset: o, channels, rate, bits, pcm: data.subarray(o + 0x20, o + 0x20 + size), frames: Math.floor(size / blockAlign) });
    o = (o + 0x20 + size + 31) & ~31;
  }
  return waves;
}

/** 16-bit (or 8-bit unsigned) PCM to per-channel float samples. */
export function waveToFloat(w: SeWave): Float32Array[] {
  const out = Array.from({ length: w.channels }, () => new Float32Array(w.frames));
  const dv = new DataView(w.pcm.buffer, w.pcm.byteOffset, w.pcm.byteLength);
  for (let i = 0; i < w.frames; i++) {
    for (let c = 0; c < w.channels; c++) {
      const k = i * w.channels + c;
      out[c][i] = w.bits === 16 ? dv.getInt16(k * 2, true) / 32768 : (w.pcm[k] - 128) / 128;
    }
  }
  return out;
}
