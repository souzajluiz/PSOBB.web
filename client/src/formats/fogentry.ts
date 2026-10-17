// Area fog table (`fogentry.dat`, loose or in data.gsl) and the client's fog
// state machine. From PsoBB.exe:
//   loader            FUN_005bca88  reads fogentry.dat (fogentry_a.dat when FUN_0078b220() != 0)
//                                   into DAT_00a8d770, 0x4000 bytes = 256 entries of 0x40
//   fog object        FUN_005bc4ec  4 parameter slots (+0x174 pointers), current slot +0x184
//   set base fog      FUN_005bd918 / FUN_005bd968  (slot 0)
//   set override fog  FUN_005bcee4 / FUN_005bcf00  (slot 1, used by fog regions)
//   back to base      FUN_005bce4c / FUN_005bce64
//   per-frame update  FUN_005bd2cc  (vtable 0x00b0bae0[1]): immediate swap or fade
//   evaluate slot     FUN_005bd750  color/start/end (+ sine wobble)
//   apply             FUN_005bc440  D3DRS_FOGTABLEMODE/FOGVERTEXMODE = LINEAR,
//                                   FOGCOLOR, FOGSTART, FOGEND, FOGENABLE
//
// Entry (0x40, little endian):
//   00 u32 flags       bit 1: wobble (re-evaluated every frame), bit 2: phase counter
//   04 u32 color       D3DCOLOR, RGB used
//   08 f32 end         FOGEND   (clamped to >= 0 by FUN_0082dae0)
//   0C f32 start       FOGSTART (clamped to >= 0; many entries are negative)
//   10 f32 fade_step   fade progress per frame toward this entry (<= 0: 0.001)
//   18 f32 wobble_speed  degrees per frame
//   20 f32 end_amplitude    end   += sin(frame * speed + end_phase)   * end_amplitude
//   28 f32 start_amplitude  start += sin(frame * speed + start_phase) * start_amplitude
//   30 f32 aux_base    third value (default 640), + aux_amplitude * sin(frame * speed);
//                      computed into fog object +0x194, not used by the fog render states
//   3A u8  end_phase   degrees
//   3C u8  start_phase degrees
//   3E u8  aux_amplitude
//   (14, 1C, 24, 2C, 34, 38 unused by the fog code; 0x44 of the runtime copy is the
//    phase counter of flag bit 2, 0x40 holds the entry id)

export const FOG_ENTRY_SIZE = 0x40;
export const FOG_FLAG_WOBBLE = 0x2;
export const FOG_FLAG_PHASE = 0x4;

export interface FogEntry {
  id: number;
  flags: number;
  color: number; // 0xRRGGBB
  end: number;
  start: number;
  fadeStep: number;
  wobbleSpeed: number;
  endAmplitude: number;
  startAmplitude: number;
  auxBase: number;
  endPhase: number;
  startPhase: number;
  auxAmplitude: number;
  phase: number; // runtime counter (+0x44), advanced for flag bit 2
}

export function parseFogEntries(data: Uint8Array): FogEntry[] {
  if (data.length % FOG_ENTRY_SIZE !== 0) throw new Error(`fogentry size ${data.length} is not a multiple of 0x40`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: FogEntry[] = [];
  for (let o = 0, id = 0; o < data.length; o += FOG_ENTRY_SIZE, id++) {
    out.push({
      id,
      flags: dv.getUint32(o, true),
      color: dv.getUint32(o + 4, true) & 0xffffff,
      end: dv.getFloat32(o + 8, true),
      start: dv.getFloat32(o + 0x0c, true),
      fadeStep: dv.getFloat32(o + 0x10, true),
      wobbleSpeed: dv.getFloat32(o + 0x18, true),
      endAmplitude: dv.getFloat32(o + 0x20, true),
      startAmplitude: dv.getFloat32(o + 0x28, true),
      auxBase: dv.getFloat32(o + 0x30, true),
      endPhase: data[o + 0x3a],
      startPhase: data[o + 0x3c],
      auxAmplitude: data[o + 0x3e],
      phase: 0,
    });
  }
  return out;
}

// Base fog id per area (DAT_00aafc9c, newserv area numbers), the table at
// 0x009c1ec0 that FUN_005bc4ec passes to FUN_005bd918 when the fog object is created.
export const DEFAULT_FOG_BY_AREA: readonly number[] = [
  0x21, 0x01, 0x02, 0x03, 0x04, 0x05, 0x0e, 0x0f, 0x1e, 0x1f, 0x20, 0x17, 0x10, 0x22, 0x23, 0x22,
  0x13, 0x2f, 0x60, 0x61, 0x62, 0x40, 0x41, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x28, 0x29, 0x42, 0x63,
  0x64, 0x10, 0x49, 0x4b, 0x80, 0x80, 0x80, 0x80, 0x84, 0x85, 0x8e, 0x97, 0xa0, 0x21, 0xa0,
];

export function defaultFogForArea(area: number): number {
  return DEFAULT_FOG_BY_AREA[area] ?? 0;
}

// The client's sine (FUN_0082dcbc) takes BAMS (0x10000 = 360 degrees).
const sinDegrees = (deg: number) => {
  const bams = Math.trunc((deg * 65536) / 360);
  return Math.sin((bams / 65536) * Math.PI * 2);
};

export interface FogState {
  color: number; // 0xRRGGBB
  start: number; // D3DRS_FOGSTART (>= 0)
  end: number; // D3DRS_FOGEND (>= 0)
  aux: number; // fog object +0x194
}

// FUN_005bd750 + the clamp in FUN_0082dae0. `frame` is the global frame counter (DAT_00a9c4ec).
export function evaluateFog(e: FogEntry, frame: number): FogState {
  let end = e.end;
  let start = e.start;
  let aux = 640;
  if (e.endAmplitude !== 0) end += sinDegrees(frame * e.wobbleSpeed + e.endPhase) * e.endAmplitude;
  if (e.startAmplitude !== 0) start += sinDegrees(frame * e.wobbleSpeed + e.startPhase) * e.startAmplitude;
  if (e.auxBase !== 0) aux = e.auxAmplitude * sinDegrees(frame * e.wobbleSpeed) + e.auxBase;
  return { color: e.color, start: Math.max(0, start), end: Math.max(0, end), aux };
}

const MODE_IDLE = 0, MODE_SWAP = 1, MODE_FADE_START = 2, MODE_FADE = 3;
const SLOT_BASE = 0, SLOT_OVERRIDE = 1, SLOT_STAGING = 2, SLOT_BLEND = 3;

const blank = (): FogEntry => ({
  id: -1, flags: 0, color: 0, end: 10000, start: 1000, fadeStep: 0, wobbleSpeed: 0,
  endAmplitude: 0, startAmplitude: 0, auxBase: 0, endPhase: 0, startPhase: 0, auxAmplitude: 0, phase: 0,
});

// Port of the fog object (FUN_005bc4ec and friends). Call tick() once per game
// frame (30 per second); `state` then holds the render state values.
export class FogController {
  private slots: FogEntry[] = [blank(), blank(), blank(), blank()];
  private current = SLOT_OVERRIDE; // +0x184
  private mode = MODE_IDLE; // +0x20
  private from = 0; // +0x19c
  private target = 0; // +0x1a0
  private dest = 0; // +0x1a4
  private fadeFrom = 0; // +0x1ac
  private fadeTarget = 0; // +0x1b0
  private fadeDest = 0; // +0x1b4
  private t = 0; // +0x1b8
  private step = 0; // +0x1bc
  state: FogState = { color: 0, start: 1000, end: 10000, aux: 640 };
  readonly entries: FogEntry[];

  constructor(entries: FogEntry[]) {
    this.entries = entries;
  }

  get currentId(): number {
    return this.slots[this.current].id;
  }

  get fading(): boolean {
    return this.mode === MODE_FADE_START || this.mode === MODE_FADE;
  }

  // FUN_005bd968 (dest = base slot) and FUN_005bcf00 (dest = override slot).
  private change(id: number, dest: number, immediate: boolean): void {
    const e = this.entries[id];
    if (!e || id === this.slots[this.current].id) return;
    this.slots[SLOT_STAGING] = { ...e, phase: 0 };
    this.mode = immediate ? MODE_SWAP : MODE_FADE_START;
    this.target = SLOT_STAGING;
    this.from = this.current;
    this.dest = dest;
  }

  setBase(id: number, immediate = true): void {
    this.change(id, SLOT_BASE, immediate);
  }

  setOverride(id: number, immediate = false): void {
    this.change(id, SLOT_OVERRIDE, immediate);
  }

  // FUN_005bce64: back to the base fog.
  revert(immediate = false): void {
    const c = this.current;
    if (c === SLOT_BASE || (c === SLOT_BLEND && this.fadeDest === SLOT_BASE)) return;
    this.mode = immediate ? MODE_SWAP : MODE_FADE_START;
    this.from = c;
    this.target = SLOT_BASE;
    this.dest = SLOT_BASE;
  }

  private swap(a: number, b: number): void {
    const s = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = s;
  }

  // FUN_005bd6d8: does the idle slot need re-evaluating every frame?
  private animated(e: FogEntry): boolean {
    if (e.flags & FOG_FLAG_WOBBLE) return e.endAmplitude !== 0 || e.startAmplitude !== 0 || e.auxAmplitude !== 0;
    if (e.flags & FOG_FLAG_PHASE) {
      let p = e.wobbleSpeed + e.phase;
      if (p < 0) p += 128;
      else if (p >= 128) p -= 128;
      e.phase = p;
      return true;
    }
    return false;
  }

  // FUN_005bd2cc. Returns true when the render state changed.
  tick(frame: number): boolean {
    if (this.mode === MODE_IDLE) {
      if (!this.animated(this.slots[this.current])) return false;
    } else if (this.mode === MODE_SWAP) {
      this.swap(this.target, this.dest);
      this.mode = MODE_IDLE;
      this.current = this.dest;
    } else {
      if (this.mode === MODE_FADE_START) {
        this.fadeFrom = this.from;
        this.fadeTarget = this.target;
        this.t = 0;
        this.fadeDest = this.dest;
        const speed = this.target === SLOT_BASE ? this.slots[this.from].fadeStep : this.slots[this.target].fadeStep;
        this.step = speed > 0 ? speed : 0.001;
        this.current = SLOT_BLEND;
        // The blend slot keeps its other fields; only the id follows the target.
        this.slots[SLOT_BLEND] = { ...this.slots[SLOT_BLEND], id: this.slots[this.target].id };
        this.mode = MODE_FADE;
      }
      const blend = this.slots[SLOT_BLEND];
      const a = this.slots[this.fadeFrom];
      const b = this.slots[this.fadeTarget];
      blend.phase = 0;
      if (this.t >= 1) {
        this.swap(this.target, this.dest);
        this.mode = MODE_IDLE;
        this.current = this.fadeDest;
      } else {
        const t = this.t, u = 1 - t;
        const ch = (shift: number) => Math.round(((b.color >>> shift) & 0xff) * t + ((a.color >>> shift) & 0xff) * u) & 0xff;
        blend.color = (ch(16) << 16) | (ch(8) << 8) | ch(0);
        blend.end = b.end * t + a.end * u;
        blend.start = b.start * t + a.start * u;
        blend.wobbleSpeed = b.wobbleSpeed;
        blend.endAmplitude = b.endAmplitude * t + a.endAmplitude * u;
        blend.startAmplitude = b.startAmplitude * t + a.startAmplitude * u;
        blend.auxBase = b.auxBase * t + a.auxBase * u;
        blend.endPhase = Math.round(b.endPhase * t + a.endPhase * u) & 0xff;
        blend.startPhase = Math.round(b.startPhase * t + a.startPhase * u) & 0xff;
        blend.auxAmplitude = Math.round(b.auxAmplitude * t + a.auxAmplitude * u) & 0xff;
        this.t += this.step;
      }
    }
    this.state = evaluateFog(this.slots[this.current], frame);
    return true;
  }
}

// Fog regions: set objects TObjFogCollision (0x07), TObjFogCollisionSwitch (0x18)
// and TObjFogCollisionPoison (0x160). Object fields from FUN_007ba33c:
//   +0x68 = param1 (radius), +0x70 = param3 (switch mode), +0x84 = param4 (fog id),
//   +0x88 = param5 (0: fade, else immediate), +0x8c = param6 (switch id).
// Each frame a region whose sphere contains the player (FUN_005c2a08:
// squared distance < radius^2) registers (fog id, fade) with that player's
// manager (FUN_005c2240): the highest id wins. Switch regions only register
// while (param3 >= 1) equals the switch state (FUN_005c252c), so param3 = 0
// regions are active while the switch is off (dark rooms lit by a switch).
export const OBJ_FOG_COLLISION = 0x07;
export const OBJ_FOG_COLLISION_SWITCH = 0x18;
export const OBJ_FOG_COLLISION_POISON = 0x160;

export interface FogRegion {
  type: number;
  position: [number, number, number]; // world
  radius: number;
  fogId: number; // may carry 0x1000 as a priority bit
  fade: boolean;
  switchMode: number; // param3
  switchId: number;
}

export function fogRegionFromSet(type: number, world: [number, number, number], fparams: readonly number[], iparams: readonly number[]): FogRegion | null {
  if (type !== OBJ_FOG_COLLISION && type !== OBJ_FOG_COLLISION_SWITCH && type !== OBJ_FOG_COLLISION_POISON) return null;
  return {
    type,
    position: world,
    radius: fparams[0],
    fogId: iparams[0],
    fade: iparams[1] === 0,
    switchMode: fparams[2],
    switchId: iparams[2],
  };
}

export function regionActive(r: FogRegion, switchOn: (id: number) => boolean): boolean {
  if (r.type === OBJ_FOG_COLLISION) return true;
  return (r.switchMode >= 1) === switchOn(r.switchId);
}

// Per-player fog region manager (vtable 0x00b0bf80, update at 0x005c2ce8).
export class FogRegionManager {
  private count = 0; // +0x1c
  private value = 0; // +0x20
  private fade = true; // +0x24
  private idle = true; // +0x2c

  // FUN_005c2240
  register(value: number, fade: boolean): void {
    if (this.value <= value) {
      this.count++;
      this.value = value;
      this.fade = fade;
    }
  }

  update(fog: FogController): void {
    if (!this.idle) {
      if (this.count > 0) {
        let id = this.value;
        if (id >= 0x1000) id -= 0x1000;
        id = Math.max(0, Math.min(0xff, id));
        fog.setOverride(id, !this.fade);
        this.count = 0;
      } else {
        this.idle = true;
        fog.revert(!this.fade);
      }
    } else if (this.count > 0) {
      this.count = 0;
      this.idle = false;
    }
    this.value = 0;
  }
}
