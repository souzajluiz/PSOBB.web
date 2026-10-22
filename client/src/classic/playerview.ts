// 3D player character of the classic character screens (SELECT CHARACTER
// preview and character creation): the real model from render/playermodel.ts
// played with the screens' own motions (charamakingmot.bml), rendered with
// three.js into an offscreen WebGL canvas that the 2D stage composites.
//
// Decompiled pieces shared by both screens:
// - Motions: both screens load charamakingmot.bml (FUN_004e9a68 / FUN_004072b8
//   via FUN_005b7a84) and index it with the same 16-byte motion records
//   (0x009b1580 for creation, 0x009a2ec0 for select; identical contents):
//   {i16 mode 1 (loop), i16 next 0, u32 bml entry, f32 speed 1.0, u32 flags 0}.
//   Record 0..2 = idle (B02) of motion type 0 male / 1 female / 2 FOmarl,
//   3..5 = B01, 6..8 = C10 (entries 33/1/0, 31/32/30, 47/48/46).
//   The motion type is 0 when class_flags & 1 (male, FUN_004e9370) or, on the
//   select screen, when !(class_flags & 2) (FUN_0040733c); FOmarl (class 6)
//   is 2, other females 1.
//   The entries are plain NMDM chunks (NJS_MOTION at +8, offsets relative to
//   it, 16-byte position and long-form angle keys).
// - Projection (FUN_0082eea0 / FUN_0082ebc8, angle in ECX, param 1.1333334):
//   a = ((angle * 85) / 100) / 2 (integer BAMS), t = tan(a) / 1.1333334,
//   fovy = 2 * trunc(atan(t) in BAMS), then D3DXMatrixPerspectiveFov with
//   aspect 4/3 (the 4:3 backbuffer's own aspect). Angle 0x3555 gives
//   fovy 57.49 deg (focal 437.54 px at 480 lines), 0x438e gives 73.74 deg
//   (focal 320.00 px).

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { BmlArchive } from '../formats/bml.ts';
import { parseNjMotion, type NjMotion } from '../formats/njmotion.ts';
import type { MotionRecord } from '../formats/plymotion.ts';
import type { RelFile } from '../formats/rel.ts';
import { PlayerAnimator, type MotionSource } from '../render/playeranim.ts';
import { buildPlayerModel, classLetter, loadPlayerAssets, type PlayerAppearance, type PlayerAssets } from '../render/playermodel.ts';

export const GAME_FPS = 30;
const BAMS = 65536;
const TWO_PI = 6.283184051513672; // _DAT_0098a460 (float 2*pi used by the exe)
const PERSPECTIVE_PARAM = Math.fround(1.1333334); // 0x3f911112

// fovy in degrees for a Ninja perspective angle (FUN_0082eea0).
export function njPerspectiveFovy(angle: number): number {
  const a = Math.trunc(Math.trunc((angle * 85) / 100) / 2);
  const t = Math.tan((a * TWO_PI) / BAMS) / PERSPECTIVE_PARAM;
  const n = Math.trunc((Math.atan(t) * BAMS) / TWO_PI); // FISTP with RC = chop
  return (n * 2 * TWO_PI * 180) / BAMS / Math.PI;
}

// Motion type of the character screens (FUN_004e9370 / FUN_0040733c).
export function charaMotionType(charClass: number, classFlags: number): 0 | 1 | 2 {
  if (!(classFlags & 2)) return 0;
  return charClass === 6 ? 2 : 1;
}

// 0x009b1580 / 0x009a2ec0: bml entry per motion record.
const CHARA_MOTION_ENTRIES = [33, 1, 0, 31, 32, 30, 47, 48, 46] as const;

export function charaMotionRecord(record: number): MotionRecord {
  return { index: CHARA_MOTION_ENTRIES[record], mode: 1, next: 0, speed: 1, flags: 0 };
}

// charamakingmot.bml: one NMDM chunk per entry, read on demand.
export class CharaMotions implements MotionSource {
  private bml: BmlArchive;
  private cache = new Map<number, NjMotion>();

  constructor(data: Uint8Array) {
    this.bml = new BmlArchive(data);
  }

  get(index: number): NjMotion {
    let m = this.cache.get(index);
    if (!m) {
      const entry = this.bml.entries[index];
      if (!entry) throw new Error(`charamakingmot.bml has no entry ${index}`);
      const chunk = this.bml.get(entry.name);
      if (String.fromCharCode(...chunk.slice(0, 4)) !== 'NMDM') throw new Error(`${entry.name} is not an NMDM chunk`);
      m = parseNjMotion(chunkView(chunk.subarray(8)), 0, 64);
      this.cache.set(index, m);
    }
    return m;
  }
}

// The few RelFile accessors parseNjMotion uses, over a chunk body whose
// pointers are offsets from its start.
function chunkView(data: Uint8Array): RelFile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const view = {
    data,
    dv,
    root: 0,
    u8: (o: number) => data[o],
    u16: (o: number) => dv.getUint16(o, true),
    u32: (o: number) => dv.getUint32(o, true),
    i32: (o: number) => dv.getInt32(o, true),
    f32: (o: number) => dv.getFloat32(o, true),
    ptr: (o: number) => dv.getUint32(o, true),
  };
  return view as unknown as RelFile;
}

// Client files of the character screens, shared by both screens.
export class CharaFiles {
  private files: ClientFiles;
  private classes = new Map<number, Promise<PlayerAssets>>();
  private motions: Promise<CharaMotions> | null = null;

  constructor(files: ClientFiles) {
    this.files = files;
  }

  assets(charClass: number): Promise<PlayerAssets> {
    let a = this.classes.get(charClass);
    if (!a) this.classes.set(charClass, (a = loadPlayerAssets(this.files, charClass)));
    return a;
  }

  motionSet(): Promise<CharaMotions> {
    return (this.motions ??= this.files.read('charamakingmot.bml').then((d) => new CharaMotions(d)));
  }
}

export interface CharacterLook {
  charClass: number;
  classFlags: number;
  appearance: PlayerAppearance;
  emblemSectionId?: number; // see buildPlayerModel
}

function disposeModel(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.geometry.dispose();
      for (const m of Array.isArray(c.material) ? c.material : [c.material]) m.dispose(); // textures are shared per class
    }
  });
}

// One animated character. The model is rebuilt when the look changes (at
// most once per render, the newest look wins); the motion keeps its frame.
export class CharacterActor {
  readonly group = new THREE.Group();
  private files: CharaFiles;
  private look: CharacterLook | null = null;
  private lookKey = '';
  private builtKey = '';
  private model: THREE.Object3D | null = null;
  private animator: PlayerAnimator | null = null;
  private record = 0;
  private loading = false;
  loaded = false;

  constructor(files: CharaFiles) {
    this.files = files;
  }

  setLook(look: CharacterLook | null): void {
    this.look = look;
    this.lookKey = look ? JSON.stringify(look) : '';
    if (!look) this.clear();
  }

  // Motion record 0..8 (see charaMotionRecord); `type` is added by the caller.
  setMotion(record: number): void {
    if (record === this.record) return;
    this.record = record;
    this.animator?.play(charaMotionRecord(record));
  }

  update(dt: number): void {
    this.animator?.update(dt);
  }

  // Builds the pending look if its files are ready.
  sync(): void {
    const look = this.look;
    if (!look || this.lookKey === this.builtKey || this.loading) return;
    this.loading = true;
    const key = this.lookKey;
    Promise.all([this.files.assets(look.charClass), this.files.motionSet()])
      .then(([assets, motions]) => {
        if (this.lookKey !== key) return; // changed while loading; the next sync builds it
        const model = buildPlayerModel(assets, look.appearance, { emblemSectionId: look.emblemSectionId });
        const body = assets.parts.get(`pl${classLetter(look.charClass)}bdy00.nj`)!;
        const animator = new PlayerAnimator(model.partBones[0], body, motions);
        const frame = this.animator && this.builtKey.startsWith(`{"charClass":${look.charClass},`) ? this.animator.frame : 0;
        animator.play(charaMotionRecord(this.record));
        animator.frame = frame;
        animator.update(0);
        this.clear();
        this.model = model.root;
        this.animator = animator;
        this.group.add(model.root);
        this.builtKey = key;
        this.loaded = true;
      })
      .catch((err) => {
        console.warn(`classic character model: ${(err as Error).message}`);
        this.builtKey = key;
      })
      .finally(() => (this.loading = false));
  }

  private clear(): void {
    if (this.model) {
      this.group.remove(this.model);
      disposeModel(this.model);
    }
    this.model = null;
    this.animator = null;
    this.loaded = false;
    if (!this.look) this.builtKey = '';
  }

  dispose(): void {
    this.look = null;
    this.clear();
  }
}

// Shared WebGL output. Each screen owns one; drawn at the window size.
export class GLLayer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
  }

  // Matches the 2D context the layer is drawn into: returns the window width
  // in virtual units (480 lines high) and resizes the GL canvas to the
  // context's pixels (capped).
  // virtualFrame: the layer covers the 640x480 screen only (the tall phone
  // stage): vw is 640 and the GL canvas is 4:3 at the context's scale, so the
  // model keeps the 4:3 placement of the exe instead of the window's shape.
  fit(ctx: CanvasRenderingContext2D, virtualFrame = false): { vw: number; w: number; h: number } {
    const scale = ctx.getTransform().a || 1;
    if (virtualFrame) {
      const k = Math.min(1, 2048 / (480 * scale));
      const w = Math.max(1, Math.round(640 * scale * k));
      const h = Math.max(1, Math.round(480 * scale * k));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.renderer.setSize(w, h, false);
      }
      return { vw: 640, w, h };
    }
    const vw = ctx.canvas.width / scale;
    const k = Math.min(1, 2048 / ctx.canvas.height);
    const w = Math.max(1, Math.round(ctx.canvas.width * k));
    const h = Math.max(1, Math.round(ctx.canvas.height * k));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.renderer.setSize(w, h, false);
    }
    return { vw, w, h };
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // browsers cap the number of live contexts
  }
}

// Lights for the Lambert player materials (same rig as the lobby; the
// screens' own light setup is not decoded).
export function addPlayerLights(scene: THREE.Scene): void {
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 80, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5), sun);
}
