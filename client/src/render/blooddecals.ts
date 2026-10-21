// The ground pools of the dead (rules in combat/blooddecals.ts): a textured quad
// per pool on the floor, the three splat textures of bm_ene_common_all.bml.
// One geometry and one material per pool (the fade-in ones animate their
// alpha), nothing allocated per frame; the oldest pool is recycled past
// POOL_LIMIT.

import * as THREE from 'three';
import { BloodPool, POOLS, POOL_LIMIT, POOL_UV, type PoolId } from '../combat/blooddecals.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { BmlArchive } from '../formats/bml.ts';
import { texturesFromXvm } from './enemymodel.ts';
import type { MapViewer } from './mapviewer.ts';

const FRAME = 1 / 30;

interface PoolView {
  pool: BloodPool;
  mesh: THREE.Mesh;
  position: THREE.BufferAttribute;
  material: THREE.MeshBasicMaterial;
  corner: [number, number, number];
}

const INDEX = [0, 1, 2, 2, 1, 3]; // the strip as two triangles

export class BloodDecals {
  private viewer: MapViewer;
  private files: ClientFiles;
  private log: (msg: string) => void;
  private textures: THREE.Texture[] = [];
  private loaded: Promise<void> | null = null;
  private views: PoolView[] = [];
  private acc = 0;
  private disposed = false;
  private seed = 0x2545f491;
  private uv = new THREE.BufferAttribute(new Float32Array(POOL_UV.flat()), 2);
  private index = new THREE.BufferAttribute(new Uint16Array(INDEX), 1);
  private hook = (dt: number) => this.frame(dt);

  constructor(viewer: MapViewer, files: ClientFiles, log: (msg: string) => void) {
    this.viewer = viewer;
    this.files = files;
    this.log = log;
    viewer.frameHooks.add(this.hook);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const bml = new BmlArchive(await this.files.read('bm_ene_common_all.bml'));
        const xvm = bml.getTextures(bml.entries[0].name);
        if (!xvm) throw new Error('no texture list');
        this.textures = texturesFromXvm(xvm);
      } catch (err) {
        this.log(`death pools: textures unavailable (${(err as Error).message})`);
      }
    })();
    return this.loaded;
  }

  preload(): void {
    void this.load();
  }

  // The client's rand() / 32768 (its own PRNG: every client's pools differ).
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) | 0;
    return ((this.seed >>> 16) & 0x7fff) / 32768;
  }

  /** One creator call: pool `id` at `at`, drawn `delay` frames later. */
  async add(id: PoolId, delay: number, at: { x: number; y: number; z: number }): Promise<void> {
    await this.load();
    if (this.disposed) return;
    const spec = POOLS[id];
    const tex = this.textures[spec.texture];
    if (!tex) return;
    const ground = (x: number, z: number, fromY: number) => this.viewer.groundHeight(x, z, fromY);
    // The floor's tilt from four probes a unit around the point (the exe reads the hit triangle's normal).
    const gy = ground(at.x, at.z, at.y + 5);
    let slope: number | null = null;
    if (gy !== null) {
      const hx0 = ground(at.x - 1, at.z, gy + 5), hx1 = ground(at.x + 1, at.z, gy + 5);
      const hz0 = ground(at.x, at.z - 1, gy + 5), hz1 = ground(at.x, at.z + 1, gy + 5);
      if (hx0 !== null && hx1 !== null && hz0 !== null && hz1 !== null) slope = Math.hypot(hx1 - hx0, hz1 - hz0) / 2;
    }
    const pool = new BloodPool(spec, delay, at, ground, slope, () => this.rand());
    if (pool.dead) return;
    if (this.views.length >= POOL_LIMIT) this.drop(this.views.shift()!);
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(12), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('uv', this.uv);
    geometry.setIndex(this.index);
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.viewer.scene.add(mesh);
    this.views.push({ pool, mesh, position, material, corner: [0, 0, 0] });
  }

  private drop(v: PoolView): void {
    this.viewer.scene.remove(v.mesh);
    v.mesh.geometry.dispose();
    v.material.dispose();
  }

  get count(): number {
    return this.views.length;
  }

  private frame(dt: number): void {
    if (this.disposed || this.views.length === 0) return;
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= FRAME && ticks < 5) {
      this.acc -= FRAME;
      ticks++;
      for (const v of this.views) v.pool.tick();
    }
    if (this.acc >= FRAME) this.acc = 0;
    const cam = this.viewer.camera.position;
    for (const v of this.views) {
      const show = v.pool.visible && v.pool.near(cam.x, cam.z);
      v.mesh.visible = show;
      if (!show) continue;
      for (let k = 0; k < 4; k++) {
        v.pool.corner(k, v.corner);
        v.position.setXYZ(k, v.corner[0], v.corner[1], v.corner[2]);
      }
      v.position.needsUpdate = true;
      v.material.opacity = v.pool.opacity;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.viewer.frameHooks.delete(this.hook);
    for (const v of this.views) this.drop(v);
    this.views = [];
    for (const t of this.textures) t.dispose();
    this.textures = [];
  }
}
