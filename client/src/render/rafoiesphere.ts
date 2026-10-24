// Draws Rafoie's fire sphere (combat/techfire.ts RafoieSphere): the blast's child object, which the
// exe draws as the technique BML's njcm chunk 11 at its fixed point, scaled and faded by its own
// update (render_bazooka_explosion, dump 651052). The model comes from the particle model loader
// (render/hitmodels.ts particleModel), each sphere has its own copy, and the copy is removed when
// the sphere's life ends.
//
// The sphere turns with the camera yaw (matrix_rotation_y of g_pDefaultNPCCameraState->y_rotation,
// combat/techfire.ts sphereTurnRad). ASSUMED: its fade is the material opacity with normal blending
// (the exe sets no blend in this draw), and its colour is white.

import * as THREE from 'three';
import { SPHERE_CHUNK, sphereTurnRad, type RafoieSphere } from '../combat/techfire.ts';
import type { FieldParticles } from './hitfx.ts';
import { instanceParticleModel, type ParticleModelPiece } from './hitmodels.ts';

interface Shown {
  sphere: RafoieSphere;
  piece: ParticleModelPiece | null; // null until the model has loaded
}

export class RafoieSpheres {
  private shown: Shown[] = [];
  private readonly fx: FieldParticles;
  /** The camera's yaw as a BAMS angle (g_pDefaultNPCCameraState->y_rotation). */
  private readonly yaw: () => number;

  constructor(fx: FieldParticles, yaw: () => number = () => 0) {
    this.fx = fx;
    this.yaw = yaw;
  }

  /** The sphere is shown from the next tick (its first update comes then, as the exe's entity update). */
  start(sphere: RafoieSphere): void {
    const s: Shown = { sphere, piece: null };
    this.shown.push(s);
    void this.fx.models.particleModel(SPHERE_CHUNK, null).then((model) => {
      // Drop it if the sphere ended while the model was loading.
      if (!model || !this.shown.includes(s) || !s.sphere.alive) return;
      s.piece = instanceParticleModel(model);
      this.fx.attach(s.piece.root);
      this.place(s);
    });
  }

  /** One game tick: steps every sphere, places it, and removes the ones whose life is over. */
  tick(): void {
    for (const s of this.shown) {
      if (!s.sphere.alive) continue;
      s.sphere.step();
    }
    this.shown = this.shown.filter((s) => {
      if (s.sphere.alive) {
        if (s.piece) this.place(s);
        return true;
      }
      this.release(s);
      return false;
    });
  }

  /** Removes every sphere (the object's clear). */
  clear(): void {
    for (const s of this.shown) this.release(s);
    this.shown = [];
  }

  get count(): number {
    return this.shown.length;
  }

  private place(s: Shown): void {
    const piece = s.piece!;
    const r = piece.root;
    const sp = s.sphere;
    r.visible = sp.fade > 0;
    r.position.set(sp.x, sp.y, sp.z);
    r.rotation.set(0, sphereTurnRad(this.yaw()), 0);
    r.scale.setScalar(Math.max(sp.scale, 0.001));
    for (const mat of piece.materials) {
      const mm = mat as THREE.MeshBasicMaterial;
      mm.opacity = sp.fade;
      mm.transparent = true;
      mm.blending = THREE.NormalBlending;
      mm.color?.setRGB(1, 1, 1);
    }
  }

  private release(s: Shown): void {
    if (!s.piece) return;
    this.fx.detach(s.piece.root);
    for (const m of s.piece.materials) m.dispose();
    s.piece = null;
  }
}
