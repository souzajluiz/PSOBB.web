// Sound effects, after PsoBB.exe's SE engine (FUN_00814298 and friends).
//
// SE id -> wave slot: SE_ID_REMAP (0x00a1f840; FUN_0081443c also swaps ids
// 0x559..0x55c for 0x4b1..0x4b4 in areas 0x15/0x16). Slot -> wave: the slot
// table 0x00acb3a8 (0x700 x 0x20 bytes) filled by the bank loaders:
//   common.pac at start-up (FUN_00829b7c -> FUN_00829a04), always resident;
//   one area bank at a time (FUN_00828d40(area), bank = SE_AREA_BANK[area]),
//   written over common's slots. Start-up and the character screens load
//   area 0 (city.pac): FUN_00824944 and FUN_004df9ec call FUN_00815584(0).
// A slot with no wave loaded is silent (FUN_00829110).
//
// Playing (FUN_00828e4c): 64 voices (0x00acb388, 0x48 bytes each); without
// flag bit 28 a new voice first stops the voices of the same slot
// (FUN_00829c38). The DirectSound buffer is created with CTRLVOLUME and
// CTRLPOSITIONNOTIFY only (FUN_00829164): no pan or pitch on 2D voices. Volume
// in hundredths of a dB (FUN_00814298):
//   a = clamp(-attenuation [+ offset when flag 2], -127, 0)
//   f = (1 + a/127) * (1 + master/127) - 1
//   SetVolume(round(f^3 * 6400))
// Positional sounds (FUN_00814298 with a position, play_directional_sound_effect):
// the distance d to the listener (FUN_00836208; the listener is DAT_00acb39c,
// set by FUN_00814168 from the local player, see setSeListener):
//   d >= 300 is dropped (0x00980af4), unless the area is 0xe / 0x1f / 0x2c (FUN_00814498);
//   d <= 2 (0x00980afc), or d <= 16 (0x00980af8) for slots 0x87..0xa7 other than
//   0x88 0x8a 0x8f 0x93 0x94 0xa1, plays 2D (no position);
//   otherwise a 3D buffer when the slot's flags have bit 0x8000 and kind 0 / 10
//   (FUN_00829130): CTRL3D, min distance 80 and max 500 (0x42a00000 / 0x43fa0000,
//   FUN_00828e4c), position (x, y, -z). The distance does not change the volume
//   of FUN_00814298 itself; the buffer's rolloff does. ASSUMED: the rolloff is
//   DirectSound's inverse law, min / clamp(d, min, max), and the pan follows the
//   listener's right side (the port has no DS3D pan).
// One-shots play once. Looping waves (record flag bit 0, played through
// FUN_008144b0 / FUN_008292dc) get a position-notify event; when it fires
// FUN_00828978 stops the buffer, seeks to the loop start sample and plays
// again. The slot keeps loop start (+0x10) and loop length (+0x14, record
// end - start); here the loop runs loop start .. loop end.

import type { DataSource } from '../data/source.ts';
import { parseSePac, waveToFloat, type SeWave } from '../formats/sepac.ts';
import { masterOutput } from './mute.ts';
import { SE_AREA_BANK, SE_BANKS, SE_ID_REMAP, SE_SLOT_FLAGS } from './se_tables.ts';

/** Ids the classic UI plays (callers of FUN_00814298 in PsoBB.exe). */
export const SE = {
  cursor: 0x56f, // menu cursor move (title FUN_006fed2c, menus 0x734xxx, slot list 0x412653)
  ok: 0x570, // confirm (menus 0x7351c5, slot list 0x412742, char creation)
  auto: 0x571, // char creation AUTO roll finished (FUN_004f2988)
  back: 0x573, // char creation cancel (FUN_004ef208, FUN_004f0f44 ...)
  buzzer: 0x575, // not allowed (FUN_004f0b80 with an invalid name, menus 0x7351ac)
  nameNg: 0x57c, // name entry closed with an invalid name (FUN_004f34a8)
  cancel: 0x585, // window / character select cancel (0x412e4e, 0x7388d0)
  titleOk: 0x420, // title menu confirm (FUN_006fed2c, FUN_006fede0), from city.pac
} as const;

const VOICES = 64;
const FLAG_OVERLAP = 0x10000000;

export interface SePlayOptions {
  /** param_3 of FUN_00814298, added to the attenuation when flag 2 is set (-127..0). */
  volume?: number;
  /** Loop like FUN_008144b0 voices when the wave has loop points. */
  loop?: boolean;
  /**
   * ProcessAudioCommand_00814664's pitch value (0x00829704: (v / 3072 - 0.1222)
   * * 4096, 0.1222 being log2(44100 / 48000)): ASSUMED 1/256 semitone, so the
   * playback rate is 2 ** (v / 3072).
   */
  pitch?: number;
  /**
   * A position (FUN_00814298's param_2): the sound is culled, 2D or 3D by the
   * rules in the header, against the listener (setSeListener).
   */
  at?: readonly [number, number, number];
}

/** A positional sound's cull distance (0x00980af4, FUN_00814298). */
export const SE_CULL_DISTANCE = 300;
/** Within this distance a positional sound plays 2D (0x00980afc). */
export const SE_NEAR = 2;
/** The DirectSound 3D min / max distance of a 3D buffer (FUN_00828e4c: 80, 500). */
export const SE_3D_MIN = 80;
export const SE_3D_MAX = 500;
/** The areas where the cull does not apply (FUN_00814498: 0xe, 0x1f, 0x2c). */
const CULL_EXEMPT_AREAS = new Set([0x0e, 0x1f, 0x2c]);
/** Slots that stay 3D within 16 of the listener (FUN_00814298's exceptions to the 2D band 0x87..0xa7). */
const NEAR_BAND_EXEMPT = new Set([0x88, 0x8a, 0x8f, 0x93, 0x94, 0xa1]);

/** The 3D listener (DAT_00acb39c position, DAT_00ab59cc front), see setSeListener. */
export interface SeListener {
  pos: readonly [number, number, number];
  front: readonly [number, number, number];
}
let listener: SeListener = { pos: [0, 0, 0], front: [0, 0, 1] };

/**
 * FUN_00814168 sets the listener each frame: the local player's position when
 * there is one (else the camera's), and the camera's direction. ASSUMED: the
 * port sets it when a positional sound is asked for (render/flooritems.ts).
 */
export function setSeListener(pos: readonly [number, number, number], front: readonly [number, number, number]): void {
  listener = { pos, front };
}

/** Distance of FUN_00836208: a squared distance under 0.025 is 0. */
export function seDistance(at: readonly number[], pos: readonly number[]): number {
  const d2 = (at[0] - pos[0]) ** 2 + (at[1] - pos[1]) ** 2 + (at[2] - pos[2]) ** 2;
  return d2 < 0.025 ? 0 : Math.sqrt(d2);
}

/**
 * The gain of a 3D buffer at distance d (ASSUMED: DirectSound's inverse rolloff):
 * 1 within the min distance, then min / d, clamped at the max distance.
 */
export function seGain3d(d: number): number {
  return d <= SE_3D_MIN ? 1 : SE_3D_MIN / Math.min(d, SE_3D_MAX);
}

/**
 * The stereo pan (-1 left .. 1 right) of a point for a listener: its offset
 * along the listener's right side (front x up, the screen's right in the port's
 * camera). ASSUMED: the exe's DirectSound pan is not read.
 */
export function sePan(at: readonly number[], l: SeListener): number {
  // right = front x up (0, 1, 0) = (-front.z, 0, front.x)
  const [fx, , fz] = l.front;
  const rl = Math.hypot(fx, fz);
  const d = seDistance(at, l.pos);
  if (rl === 0 || d === 0) return 0;
  const dot = ((at[0] - l.pos[0]) * -fz + (at[2] - l.pos[2]) * fx) / rl;
  return Math.max(-1, Math.min(1, dot / d));
}

/**
 * What FUN_00814298 does with a positional sound of slot `slot` (flags = its
 * slot flags) at distance d in `area`: dropped ('cull'), a 2D voice, or a 3D
 * buffer ('3d'). See the header of this file.
 */
export function positionalMode(slot: number, flags: number, d: number, area: number): 'cull' | '2d' | '3d' {
  if (!CULL_EXEMPT_AREAS.has(area) && d >= SE_CULL_DISTANCE) return 'cull';
  const kind = (flags & 0x0f000000) >>> 24;
  const near = d <= SE_NEAR || (d <= 16 && slot > 0x86 && slot < 0xa8 && !NEAR_BAND_EXEMPT.has(slot));
  return !near && (kind === 0 || kind === 10) && (flags & 0x8000) !== 0 ? '3d' : '2d';
}

interface Wave {
  wave: SeWave;
  loopStart: number; // sample, -1 = no loop
  loopEnd: number;
  buffer?: AudioBuffer;
}

interface Voice {
  slot: number;
  node: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
}

export function seSlot(id: number): number {
  return SE_ID_REMAP[id] ?? id;
}

/** DirectSound volume (1/100 dB) of FUN_00814298 for a slot. */
export function seVolume(flags: number, master = 0, offset = 0, useOffset = false): number {
  let a = -((flags & 0x7f00) >> 8);
  if (useOffset) a += offset;
  if (a > 0) a = 0;
  if (a < -0x7e) a = -0x7f;
  const f = (1 + a / 127) * (master / 127 + 1) - 1;
  return Math.round(f * f * f * 6400);
}

export class SePlayer {
  private source: DataSource;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private banks = new Map<number, Promise<Wave[] | null>>();
  private slots = new Map<number, Wave>();
  private common: Wave[] = [];
  private area = -1;
  private voices: Voice[] = [];
  /** DAT_00ab59f8, the SE volume option (-127..0). */
  master = 0;
  ready: Promise<void>;

  constructor(source: DataSource) {
    this.source = source;
    const unlock = () => void this.context().resume();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    this.ready = (async () => {
      this.common = (await this.bank(SE_BANKS.findIndex((b) => b.file === 'common.pac'))) ?? [];
      this.mapBank(SE_BANKS.findIndex((b) => b.file === 'common.pac'), this.common);
      await this.setArea(0);
    })();
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.connect(masterOutput(this.ctx)); // master mute (mute.ts)
    }
    return this.ctx;
  }

  private bank(index: number): Promise<Wave[] | null> {
    let p = this.banks.get(index);
    if (!p) {
      const t = SE_BANKS[index];
      p = this.source
        .read(`sound/${t.file}`)
        .then((data) => {
          const waves = parseSePac(data);
          const loops = new Map(t.loops.map(([k, s, e]) => [k, [s, e]]));
          return waves.map((wave, k) => ({ wave, loopStart: loops.get(k)?.[0] ?? -1, loopEnd: loops.get(k)?.[1] ?? wave.frames }));
        })
        .catch(() => null);
      this.banks.set(index, p);
    }
    return p;
  }

  private mapBank(index: number, waves: Wave[]): void {
    SE_BANKS[index].slots.forEach((slot, k) => {
      if (waves[k]) this.slots.set(slot, waves[k]);
    });
  }

  /** FUN_00828d40: swap the area bank (common.pac stays). */
  async setArea(area: number): Promise<void> {
    if (area === this.area) return;
    this.area = area;
    const index = SE_AREA_BANK[area];
    const waves = index === undefined ? null : await this.bank(index);
    if (this.area !== area) return;
    this.stopAll();
    // FUN_00828c38: clear the slot table, re-add common, then the area bank.
    this.slots.clear();
    this.mapBank(SE_BANKS.findIndex((b) => b.file === 'common.pac'), this.common);
    if (waves && index !== undefined) this.mapBank(index, waves);
  }

  private buffer(w: Wave): AudioBuffer {
    if (!w.buffer) {
      const ctx = this.context();
      const data = waveToFloat(w.wave);
      const b = ctx.createBuffer(w.wave.channels, Math.max(1, w.wave.frames), w.wave.rate);
      data.forEach((ch, c) => b.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
      w.buffer = b;
    }
    return w.buffer;
  }

  /**
   * FUN_00814298(id, position, volume, flags): returns the wave slot, or -1 when
   * nothing plays. Without `at` the sound is 2D (the UI's id, position 0).
   */
  play(id: number, opts: SePlayOptions = {}): number {
    if (!id) return -1;
    const slot = id < 0x700 ? seSlot(id) : 0;
    const w = this.slots.get(slot);
    const ctx = this.context();
    if (!w || ctx.state !== 'running') return -1;
    const flags = SE_SLOT_FLAGS[slot] ?? 0;
    // The positional rules of FUN_00814298 (see the header): the cull, then 2D or a 3D buffer.
    let spatial: { gain: number; pan: number } | null = null;
    if (opts.at) {
      const d = seDistance(opts.at, listener.pos);
      const mode = positionalMode(slot, flags, d, this.area);
      if (mode === 'cull') return -1;
      if (mode === '3d') spatial = { gain: seGain3d(d), pan: sePan(opts.at, listener) };
    }
    if (!(flags & FLAG_OVERLAP)) for (const v of this.voices.filter((v) => v.slot === slot)) this.stopVoice(v);
    if (this.voices.length >= VOICES) return -1;
    const node = ctx.createBufferSource();
    node.buffer = this.buffer(w);
    if (opts.pitch) node.playbackRate.value = 2 ** (opts.pitch / 3072);
    if (opts.loop && w.loopStart >= 0) {
      node.loop = true;
      node.loopStart = w.loopStart / w.wave.rate;
      node.loopEnd = Math.min(w.loopEnd / w.wave.rate, node.buffer.duration);
    }
    const gain = ctx.createGain();
    const ds = seVolume(flags, this.master, opts.volume ?? 0, opts.volume !== undefined);
    gain.gain.value = Math.pow(10, ds / 2000) * (spatial?.gain ?? 1);
    let pan: StereoPannerNode | null = null;
    if (spatial) {
      pan = ctx.createStereoPanner();
      pan.pan.value = spatial.pan;
      node.connect(gain).connect(pan).connect(this.out!);
    } else {
      node.connect(gain).connect(this.out!);
    }
    const voice: Voice = { slot, node, gain, pan };
    node.onended = () => {
      gain.disconnect();
      pan?.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
    };
    node.start();
    this.voices.push(voice);
    return slot;
  }

  /** A voice of this SE id is still playing (PlaySFX_008292dc's owner check). */
  playing(id: number): boolean {
    const slot = id < 0x700 ? seSlot(id) : 0;
    return this.voices.some((v) => v.slot === slot);
  }

  /** Stops the voices of an SE id (FUN_00829c38). */
  stop(id: number): void {
    const slot = seSlot(id);
    for (const v of this.voices.filter((v) => v.slot === slot)) this.stopVoice(v);
  }

  stopAll(): void {
    for (const v of [...this.voices]) this.stopVoice(v);
  }

  private stopVoice(v: Voice): void {
    try {
      v.node.stop();
    } catch {
      // already stopped
    }
    v.gain.disconnect();
    v.pan?.disconnect();
    this.voices = this.voices.filter((x) => x !== v);
  }
}

// Shared player for the UI screens, installed by the classic main.
let shared: SePlayer | null = null;

export function setSePlayer(p: SePlayer | null): void {
  shared = p;
}

/** Plays an SE through the shared player (no-op until one is installed). */
export function se(id: number, opts?: SePlayOptions): void {
  shared?.play(id, opts);
}

/** A voice of this SE id plays on the shared player. */
export function sePlaying(id: number): boolean {
  return shared?.playing(id) ?? false;
}

/** Stops the voices of an SE id on the shared player. */
export function seStop(id: number): void {
  shared?.stop(id);
}
