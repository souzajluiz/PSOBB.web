// The bullet in flight of a gun shot (combat/gunbullet.ts): the trail that
// create_gun_bullet_particle_effect (PsoBB.exe 0x005e4678) makes from the hand to
// the aim point over the shot's frames. ASSUMED shape: a thin bright bar along the
// shot (the exe's object 0x005e4704 is not decoded). One shared geometry and
// material; a mesh lives only for its flight and is removed when it lands.
import * as THREE from 'three';
import type { Vec3 } from '../combat/gunbullet.ts';

const TRAIL_LENGTH = 14; // ASSUMED length of the bar, in units (readable at 60 units)
const TRAIL_THICKNESS = 2.5; // ASSUMED

interface Trail {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
  ticks: number; // game ticks left
  total: number;
}

export class GunTracers {
  private geo = new THREE.BoxGeometry(TRAIL_THICKNESS, TRAIL_THICKNESS, TRAIL_LENGTH);
  private mat = new THREE.MeshBasicMaterial({ color: 0xfff1a6, transparent: true, opacity: 0.9, depthWrite: false });
  private live: Trail[] = [];
  private disposed = false;
  private readonly tmp = new THREE.Vector3();

  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.live.length;
  }

  // A trail from `start` to `end` over `frames` game ticks (at least one).
  spawn(start: Vec3, end: Vec3, frames: number): void {
    if (this.disposed) return;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    const s = new THREE.Vector3(start.x, start.y, start.z);
    const e = new THREE.Vector3(end.x, end.y, end.z);
    mesh.position.copy(s);
    if (s.distanceToSquared(e) > 1e-6) mesh.lookAt(e);
    this.scene.add(mesh);
    const total = Math.max(1, frames);
    this.live.push({ mesh, start: s, end: e, ticks: total, total });
  }

  // One game tick: the trails move on, and the landed ones are removed.
  tick(): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.ticks--;
      const k = Math.min(1, (t.total - t.ticks) / t.total);
      this.tmp.lerpVectors(t.start, t.end, k);
      t.mesh.position.copy(this.tmp);
      if (t.ticks <= 0) {
        this.scene.remove(t.mesh);
        this.live.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.live) this.scene.remove(t.mesh);
    this.live = [];
    this.geo.dispose();
    this.mat.dispose();
  }
}
