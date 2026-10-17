// Background music.
//
// PsoBB.exe asks for ADX names (e.g. "title.adx" in the title constructor
// FUN_006f8130, "CHARA.adx" in FUN_004df9ec, "LOBBY.ADX" / "city.adx" in
// FUN_00642c30). The PC data ships them as data/ogg/<NAME>.ogg (upper case,
// same base name). Each OGG carries a Vorbis comment `loop_start=<sample>`; the
// track plays once and then loops from that sample to the end of the file.

import type { DataSource } from '../data/source.ts';

export class BgmPlayer {
  private source: DataSource;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private current: { name: string; node: AudioBufferSourceNode } | null = null;
  private cache = new Map<string, Promise<{ buffer: AudioBuffer; loopStart: number } | null>>();
  private pending: string | null = null;
  volume = 0.6;

  constructor(source: DataSource) {
    this.source = source;
    // Browsers only start audio after a user gesture.
    const unlock = () => {
      void this.context().resume();
      if (this.pending) void this.play(this.pending);
    };
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // "title.adx" -> "ogg/TITLE.ogg"
  static fileFor(adx: string): string {
    return `ogg/${adx.replace(/\.adx$/i, '').toUpperCase()}.ogg`;
  }

  private load(adx: string): Promise<{ buffer: AudioBuffer; loopStart: number } | null> {
    let p = this.cache.get(adx);
    if (!p) {
      p = (async () => {
        try {
          const data = await this.source.read(BgmPlayer.fileFor(adx));
          const loopSample = readLoopStart(data);
          const buffer = await this.context().decodeAudioData(data.slice().buffer);
          return { buffer, loopStart: loopSample / buffer.sampleRate };
        } catch {
          return null;
        }
      })();
      this.cache.set(adx, p);
    }
    return p;
  }

  async play(adx: string): Promise<void> {
    if (this.current?.name === adx) return;
    this.pending = adx;
    const ctx = this.context();
    if (ctx.state !== 'running') return; // started by the unlock handler
    const track = await this.load(adx);
    if (!track || this.pending !== adx) return;
    this.stop();
    const node = ctx.createBufferSource();
    node.buffer = track.buffer;
    node.loop = true;
    node.loopStart = Math.min(track.loopStart, track.buffer.duration);
    node.loopEnd = track.buffer.duration;
    node.connect(this.gain!);
    node.start();
    this.current = { name: adx, node };
  }

  stop(): void {
    this.current?.node.stop();
    this.current?.node.disconnect();
    this.current = null;
  }
}

// Finds `loop_start=<n>` in the Vorbis comment header (first pages of the file).
export function readLoopStart(ogg: Uint8Array): number {
  const head = new TextDecoder('latin1').decode(ogg.subarray(0, Math.min(ogg.length, 8192)));
  const m = /loop_start=(\d+)/i.exec(head);
  return m ? Number(m[1]) : 0;
}
