// The bullet in flight of a gun shot (combat/gunbullet.ts): the gun_bullet.xj model
// of item.bml that the bullet object (PsoBB.exe vtable 0x00b0ff80, ctor 0x005e4704 ->
// 0x005e43e8 -> 0x005e4158) draws while it flies from the hand to the aim point.
//
// Decoded from PsoBB.exe (Ephinea 1.25.13):
//   - model: +0x58 = FUN_005b8610(0), item.bml entry 0 (gun_bullet.xj); texture list
//     +0x5c = FUN_005b8624(0). Render 0x005e4924 (vtable slot 0x08): fog off, the
//     texture index +0x70 written into the model's texture ids, then translate by
//     +0x1c (the position) and rotate by +0x28/+0x2c/+0x30 (FUN_00830df8 with the
//     order flag: Y (+0x2c), then X (+0x28), then Z (+0x30)); no scale. The
//     variant 0x005e4a58 (slot 0x1c) draws the same without the texture write.
//   - angles, set once: yaw +0x2c = atan2(x, z) of the velocity; pitch +0x28 =
//     -atan2(y, sqrt(x*x + z*z)) (0 when y is 0); roll +0x30 = 0 (0x005e43e8 overwrites
//     the base's value). Angles are BAMS, rounded like the exe's ints.
//   - texture index +0x70: set in the ctor from the shooter (FUN_005e94c8, clamped to
//     0..4, see bulletTextureIndex). It does not animate.
//   - motion, per game tick (0x005e400c): position += velocity (+0x1c += +0x38); the
//     velocity is the unit direction times the distance over the frames (speed =
//     dist / frames); frames (+0x34) count down by one, and the bullet dies at <= 0.
//   - the spin +0x6c += 0x1999 BAMS (0x005e466c) is written every tick but nothing in
//     the bullet's update or render reads it: no visible spin is ported.
// Not ported: the effect object the ctor attaches (+0x50, FUN_005dd76c; the effect id
// is not decoded), and the trail object 0x005e4704 of the first decode is this model.
//
// Load and build once: the model is built per texture variant (up to five) and each
// shot clones the variant's tree (geometry and materials are shared). A bullet's mesh
// lives only for its flight and is removed when it lands; dispose() releases the
// models. Pure helpers (bulletAngles, bulletTextureIndex) run in Node tests.
import * as THREE from 'three';
import type { Vec3 } from '../combat/gunbullet.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { ITEM_BML, ITEM_BML_MODELS } from '../formats/itemmodels.ts';
import { BAMS_TO_RAD } from '../formats/xj.ts';
import type { NjObject } from '../formats/xj.ts';
import { EnemyArchive } from './enemymodel.ts';
import { buildObjectTree, MaterialCache } from './njmesh.ts';

const BAMS_PER_RAD = 0x10000 / (Math.PI * 2);
const TEXTURE_VARIANTS = 5; // FUN_005e94c8 clamped to 0..4

// ROUND of the exe (halves away from zero), for the BAMS ints.
const roundBams = (rad: number): number => Math.sign(rad) * Math.round(Math.abs(rad) * BAMS_PER_RAD);

// The bullet's yaw and pitch from its velocity (0x005e4158 and 0x005e43e8), in BAMS.
// The roll is 0 (0x005e43e8 writes +0x30 = 0).
export function bulletAngles(v: Vec3): { pitch: number; yaw: number } {
  const yaw = roundBams(Math.atan2(v.x, v.z));
  const pitch = v.y === 0 ? 0 : -roundBams(Math.atan2(v.y, Math.hypot(v.x, v.z)));
  return { pitch, yaw };
}

// FUN_005e94c8 and the ctor's clamp: the texture variant (+0x70) from two bytes of the
// shooter (+0xf3, +0xf4). Out of 0..4 becomes 4.
export function bulletTextureIndex(byteF3: number, byteF4: number): number {
  let v: number;
  if (byteF3 === 0x14) v = byteF4 === 1 ? 2 : byteF4;
  else if (byteF3 >= 0xe8 && byteF3 <= 0xeb) v = 1;
  else v = byteF4;
  return v >= 0 && v < TEXTURE_VARIANTS ? v : 4;
}

// The bullet models: gun_bullet.xj of item.bml with one texture variant per list index.
export interface GunBulletModels {
  // The model with texture variant `tex`, built once; null when it is not available.
  variant(tex: number): THREE.Object3D | null;
  dispose(): void;
}

// Reads item.bml once (the archive owns its textures) and builds the bullet models on demand.
export async function loadGunBulletModels(files: ClientFiles, log?: (msg: string) => void): Promise<GunBulletModels | null> {
  try {
    const archive = new EnemyArchive(ITEM_BML, await files.read(ITEM_BML), ITEM_BML_MODELS);
    return new ArchiveBulletModels(archive);
  } catch (err) {
    log?.(`gun bullets: ${(err as Error).message}`);
    return null;
  }
}

class ArchiveBulletModels implements GunBulletModels {
  private archive: EnemyArchive;
  private built = new Map<number, { root: THREE.Object3D; cache: MaterialCache }>();

  constructor(archive: EnemyArchive) {
    this.archive = archive;
  }

  variant(tex: number): THREE.Object3D | null {
    let b = this.built.get(tex);
    if (!b) {
      const data = this.archive.model(0); // gun_bullet.xj
      const names = data.textures; // texture list 0 (FUN_005b8624(0))
      if (data.kind !== 'xj' || tex >= names.length) return null;
      const name = names[tex];
      const cache = new MaterialCache(() => this.archive.texture(name));
      const root = buildObjectTree(data.object as NjObject, cache);
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.fog = false; // render 0x005e4924: fog off
      });
      b = { root, cache };
      this.built.set(tex, b);
    }
    return b.root;
  }

  dispose(): void {
    for (const { root, cache } of this.built.values()) {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      cache.dispose();
    }
    this.built.clear();
    this.archive.dispose();
  }
}

interface Trail {
  mesh: THREE.Object3D | null;
  start: THREE.Vector3;
  vel: THREE.Vector3; // per game tick: the exe's +0x38..+0x40
  texture: number;
  total: number; // frames of the flight
  ticks: number; // game ticks left
}

export class GunTracers {
  private live: Trail[] = [];
  private models: GunBulletModels | null = null;
  private disposed = false;
  private readonly tmp = new THREE.Vector3();
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.live.length;
  }

  // The bullet models, when they are loaded; the bullets already in flight get them now.
  setModels(models: GunBulletModels | null): void {
    if (this.disposed) {
      models?.dispose();
      return;
    }
    this.models?.dispose();
    this.models = models;
    for (const t of this.live) if (!t.mesh) this.attach(t);
  }

  // A bullet from `start` to `end` over `frames` game ticks (at least one). Its texture
  // variant is `texture` (bulletTextureIndex).
  spawn(start: Vec3, end: Vec3, frames: number, texture = 0): void {
    if (this.disposed) return;
    const total = Math.max(1, frames);
    const s = new THREE.Vector3(start.x, start.y, start.z);
    const vel = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z).divideScalar(total);
    const t: Trail = { mesh: null, start: s, vel, texture, total, ticks: total };
    this.live.push(t);
    this.attach(t);
  }

  // Gives the trail its mesh (when the models are there) and sets its orientation.
  private attach(t: Trail): void {
    const model = this.models?.variant(t.texture);
    if (!model) return;
    const mesh = model.clone();
    const a = bulletAngles({ x: t.vel.x, y: t.vel.y, z: t.vel.z });
    // The exe's order for the flags-set rotate (FUN_00830df8 param 1): Y, then X, then Z.
    mesh.rotation.set(a.pitch * BAMS_TO_RAD, a.yaw * BAMS_TO_RAD, 0, 'YXZ');
    mesh.position.copy(t.start);
    t.mesh = mesh;
    this.scene.add(mesh);
  }

  // Puts the bullet `elapsed` game ticks along its flight (start + velocity * elapsed).
  private place(t: Trail, elapsed: number): void {
    if (!t.mesh) return;
    t.mesh.position.copy(this.tmp.copy(t.start).addScaledVector(t.vel, Math.min(elapsed, t.total)));
  }

  // One game tick: the bullets move on, and the landed ones are removed.
  tick(): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.ticks--;
      if (t.ticks <= 0) {
        this.remove(t);
        this.live.splice(i, 1);
        continue;
      }
      this.place(t, t.total - t.ticks);
    }
  }

  // Between two game ticks: `alpha` is the part of the next tick already run (0..1), so
  // the bullets move smoothly with the frame rate.
  frame(alpha: number): void {
    for (const t of this.live) this.place(t, t.total - t.ticks + Math.max(0, Math.min(1, alpha)));
  }

  private remove(t: Trail): void {
    if (t.mesh) this.scene.remove(t.mesh);
    t.mesh = null;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.live) this.remove(t);
    this.live = [];
    this.models?.dispose();
    this.models = null;
  }
}
