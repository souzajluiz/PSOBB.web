// The Epsilon's own drawing besides its body (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs). Its update 0x0055a3ac draws, after the body:
//   - state 6 (recolour) while flag 0x200 is set (event 4 of 0x00558c84 sets
//     0x242): DerolleRender_0055a884, model 4 of bm_ene_epsilon.bml, placed at
//     the Epsilon's position (+0x38) + (0, 24, 0), turned with it and scaled
//     (t, 1, t) where t is the recolour fade (+0x500: 0 -> 1 -> 0). Verified:
//     the translation args (0, 0x41c00000, 0), the scale pushes and the model
//     index 4 (0x0055a8c0..0x0055a8f4).
//   - state 2 (stalk) with flag 0x100 (laser shown): render_epsilon_raf_laser_
//     line 0x0055a8fc, one line from (x, y + 24, z) (0x00558504 writes +0x300 /
//     +0x304 / +0x308 from +0x38 / +0x3c + 24.0 / +0x40; 24.0 is the float at
//     0x00925450) to the orb at +0x504 .. +0x50c. Drawn with flag 0x40 from the
//     line data at 0x009bde28. The colour constant at 0x009bde20 is 0x80ff4040
//     (ASSUMED that it is the line's colour: the line data's layout is not read).
// The orb itself is drawn by render/combat.ts (a sphere, ASSUMED: the exe
// creates a Rafoie-family model entity at 0x006ee0d0).

import * as THREE from 'three';
import { buildEnemy, type EnemyArchive } from './enemymodel.ts';

export const EPSILON_RING_MODEL = 4; // 0x0055a8e3 (push 4 into the model getter)
export const EPSILON_LASER_HEIGHT = 24; // 0x00925450
export const EPSILON_LASER_COLOUR = 0xff4040; // 0x009bde20 = 0x80ff4040: A 0x80, R 0xff, G 0x40, B 0x40
export const EPSILON_LASER_ALPHA = 0x80 / 255;

export interface EpsilonPose {
  x: number;
  feet: number; // the Epsilon's feet (its +0x3c)
  z: number;
  yaw: number; // radians
  ring: number | null; // the recolour fade while the recolour state runs, else null
  orb: { x: number; y: number; z: number } | null; // the laser orb's world position while shown
}

export class EpsilonFx {
  private readonly scene: THREE.Object3D;
  private readonly ring: THREE.Object3D | null;
  private readonly line: THREE.Line;

  constructor(scene: THREE.Object3D, archive: EnemyArchive | null) {
    this.scene = scene;
    let ring: THREE.Object3D | null = null;
    // ASSUMED: the ring draws with the body's texture list (texlistOf 0).
    if (archive && archive.modelCount > EPSILON_RING_MODEL) {
      try {
        ring = buildEnemy(archive, [{ model: EPSILON_RING_MODEL, texlistOf: 0 }]).root;
        ring.visible = false;
        scene.add(ring);
      } catch {
        ring = null;
      }
    }
    this.ring = ring;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: EPSILON_LASER_COLOUR, transparent: true, opacity: EPSILON_LASER_ALPHA }));
    this.line.visible = false;
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  update(p: EpsilonPose): void {
    if (this.ring) {
      this.ring.visible = p.ring !== null;
      if (p.ring !== null) {
        this.ring.position.set(p.x, p.feet + EPSILON_LASER_HEIGHT, p.z);
        this.ring.rotation.set(0, p.yaw, 0);
        this.ring.scale.set(p.ring, 1, p.ring);
      }
    }
    this.line.visible = p.orb !== null;
    if (p.orb) {
      const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, p.x, p.feet + EPSILON_LASER_HEIGHT, p.z);
      pos.setXYZ(1, p.orb.x, p.orb.y, p.orb.z);
      pos.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const o of [this.ring, this.line]) {
      if (!o) continue;
      this.scene.remove(o);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
  }
}
