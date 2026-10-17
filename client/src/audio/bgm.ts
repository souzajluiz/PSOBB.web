// Background music.
//
// PsoBB.exe asks for ADX names (e.g. "title.adx" in the title constructor
// FUN_006f8130, "CHARA.adx" in FUN_004df9ec, "LOBBY.ADX" / "city.adx" in
// FUN_00642c30). The PC data ships them as data/ogg/<NAME>.ogg (upper case,
// same base name). Each OGG carries a Vorbis comment `loop_start=<sample>`; the
// track plays once and then loops from that sample to the end of the file.
// Names that already end in ".ogg" (the Saint-Milion tracks of FUN_0076b688)
// are used as they are.
//
// The field areas use the interactive music of slbgm.ts instead
// (playInteractive): chained-Ogg links queued back to back by the sequencer.

import type { DataSource } from '../data/source.ts';
import { oggLinks, SlSequencer } from './slbgm.ts';

interface Playing {
  name: string;
  stop(): void;
  setBattle?(on: boolean): void;
}

export class BgmPlayer {
  private source: DataSource;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private current: Playing | null = null;
  private cache = new Map<string, Promise<{ buffer: AudioBuffer; loopStart: number } | null>>();
  private pending: (() => void) | null = null;
  private pendingName: string | null = null;
  private battle = false;
  volume = 0.6;

  constructor(source: DataSource) {
    this.source = source;
    // Browsers only start audio after a user gesture.
    const unlock = () => {
      void this.context().resume().then(() => this.pending?.());
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

  // "title.adx" -> "ogg/TITLE.ogg"; "slbgm_boss09.ogg" -> "ogg/slbgm_boss09.ogg"
  static fileFor(adx: string): string {
    if (/\.ogg$/i.test(adx)) return `ogg/${adx}`;
    return `ogg/${adx.replace(/\.adx$/i, '').toUpperCase()}.ogg`;
  }

  // Name of what is playing (or about to play), e.g. "city.adx" or "sl:0".
  get playing(): string | null {
    return this.pendingName ?? this.current?.name ?? null;
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

  // Runs `start` now if audio is unlocked, else on the first user gesture.
  private begin(name: string, start: () => Promise<void>): void {
    if (this.current?.name === name && this.pendingName === null) return;
    this.pendingName = name;
    this.pending = () => {
      if (this.pendingName === name) void start();
    };
    if (this.context().state === 'running') this.pending();
  }

  async play(adx: string): Promise<void> {
    this.begin(adx, async () => {
      const ctx = this.context();
      const track = await this.load(adx);
      if (!track || this.pendingName !== adx) return;
      this.stopCurrent();
      const node = ctx.createBufferSource();
      node.buffer = track.buffer;
      node.loop = true;
      node.loopStart = Math.min(track.loopStart, track.buffer.duration);
      node.loopEnd = track.buffer.duration;
      node.connect(this.gain!);
      node.start();
      this.pendingName = null;
      this.current = {
        name: adx,
        stop: () => {
          node.stop();
          node.disconnect();
        },
      };
    });
  }

  // Interactive field music: SLBGM descriptor `index` (FUN_00814c7c).
  playInteractive(index: number): void {
    const name = `sl:${index}`;
    this.begin(name, async () => {
      const ctx = this.context();
      const seq = new SlSequencer(index);
      let data: Uint8Array;
      try {
        data = await this.source.read(`ogg/${seq.bgm.file}`);
      } catch {
        return;
      }
      if (this.pendingName !== name) return;
      this.stopCurrent();
      const player = new SlPlayer(ctx, this.gain!, data, seq);
      seq.setBattle(this.battle);
      this.pendingName = null;
      this.current = { name, stop: () => player.stop(), setBattle: (on) => seq.setBattle(on) };
      player.start();
    });
  }

  // FUN_00814c5c: battle (true) or calm field music.
  setBattle(on: boolean): void {
    this.battle = on;
    this.current?.setBattle?.(on);
  }

  private stopCurrent(): void {
    this.current?.stop();
    this.current = null;
  }

  stop(): void {
    this.pendingName = null;
    this.pending = null;
    this.stopCurrent();
  }
}

// Plays the links chosen by an SlSequencer back to back, sample-accurately:
// each link is scheduled at the end of the previous one, and the next choice
// is made when a link starts (as FUN_00814f30 does when the stream's queue
// drains to the playing link).
class SlPlayer {
  private ctx: AudioContext;
  private out: AudioNode;
  private data: Uint8Array;
  private links: Array<[number, number]>;
  private seq: SlSequencer;
  private decoded = new Map<number, Promise<AudioBuffer | null>>();
  private nodes = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(ctx: AudioContext, out: AudioNode, data: Uint8Array, seq: SlSequencer) {
    this.ctx = ctx;
    this.out = out;
    this.data = data;
    this.links = oggLinks(data);
    this.seq = seq;
  }

  private decode(link: number): Promise<AudioBuffer | null> {
    let p = this.decoded.get(link);
    if (!p) {
      const range = this.links[link];
      p = range ? this.ctx.decodeAudioData(this.data.slice(range[0], range[1]).buffer).catch(() => null) : Promise.resolve(null);
      this.decoded.set(link, p);
    }
    return p;
  }

  private schedule(buffer: AudioBuffer, when: number): void {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.out);
    node.start(when);
    node.onended = () => {
      node.disconnect();
      this.nodes.delete(node);
    };
    this.nodes.add(node);
  }

  async start(): Promise<void> {
    const [a, b] = this.seq.start();
    const [ba, bb] = await Promise.all([this.decode(a), this.decode(b)]);
    if (this.stopped || !ba || !bb) return;
    const t0 = this.ctx.currentTime + 0.05;
    this.schedule(ba, t0);
    this.schedule(bb, t0 + ba.duration);
    this.at(t0 + ba.duration, bb.duration);
  }

  // When the link starting at `start` (lasting `duration`) begins, choose and
  // schedule the one after it.
  private at(start: number, duration: number): void {
    const delay = Math.max(0, (start - this.ctx.currentTime) * 1000);
    this.timer = setTimeout(async () => {
      if (this.stopped) return;
      const link = this.seq.next();
      const buffer = await this.decode(link);
      if (this.stopped || !buffer) return;
      const when = Math.max(start + duration, this.ctx.currentTime + 0.01);
      this.schedule(buffer, when);
      this.at(when, buffer.duration);
      // Keep only the links that can come back soon decoded.
      if (this.decoded.size > 24) for (const k of [...this.decoded.keys()].slice(0, this.decoded.size - 24)) this.decoded.delete(k);
    }, delay);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        // not started yet
      }
      n.disconnect();
    }
    this.nodes.clear();
  }
}

// Finds `loop_start=<n>` in the Vorbis comment header (first pages of the file).
export function readLoopStart(ogg: Uint8Array): number {
  const head = new TextDecoder('latin1').decode(ogg.subarray(0, Math.min(ogg.length, 8192)));
  const m = /loop_start=(\d+)/i.exec(head);
  return m ? Number(m[1]) : 0;
}
