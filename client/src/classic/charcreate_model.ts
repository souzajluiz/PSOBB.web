// 3D layer of the character creation screen: the real player model
// (classic/playerview.ts) seen through the creation camera, plus the
// measuring ruler. Decompiled from PsoBB.exe (docs/DEVLOG.md, "real 3D
// characters in the classic screens"):
//
// Camera object (ctor FUN_004eb334, vtable 0x00afd318, base FUN_004d1f68):
//   +0x3c..+0x44 eye, +0x48..+0x50 target (0, height, 0), +0x54 perspective
//   angle 0x438e, +0x6c distance (starts at 30), +0x4c height (starts at
//   10.5, DAT_00a72230), +0x70/+0x74 pitch/yaw (eased back to 0 by
//   FUN_007a8c74(a, 0, 0xc0); always 0 here), +0x78 mode (starts at 2),
//   +0x7c mode-change counter, +0x88/+0x8c distance/height velocities.
//   FUN_004ea5a8: eye = (r sin yaw, dist sin pitch + height, r cos yaw) with
//   r = dist cos pitch, i.e. (0, height, dist) looking at (0, height, 0).
//   FUN_004d1ff4 copies eye/target/angle into the global camera.
// FUN_004ea854 (camera state 0): the mode of the current step (0 HEAD, FACE,
//   HAIR, SKIN; 1 PROPORTION, AUTO; 2 the rest) is adopted after it has been
//   requested for 31 frames. Targets: mode 0 dist 0.5 h, height 0.91 h;
//   mode 1 dist 25, height 11; mode 2 dist 1.25 h, height 0.55 h, where
//   h = FUN_004e68cc = top + proportion_y (bottom - top) from the per-class
//   table 0x009b11e0 (e.g. FOmar 20.5 .. 14.8). Each value moves with a
//   velocity that grows by 0.003 per frame up to 0.1, shrinks by 0.003 down
//   to 0.00667 within 0.1 of the target, and stops within 0.00667.
// Model pass (FUN_004e7824 -> FUN_004eb3b8, FUN_004e7844, FUN_004eb430):
//   viewport (0, 0, W, H) shifted by ox = -128 * (W / 640) * k
//   (FUN_0082f308 clips it to x = |ox|..W), perspective angle 0x3555
//   (fovy 57.49 deg, near 1, far 10000, aspect of the backbuffer). k
//   (DAT_00a72234) is 1, except that the PROPORTION and AUTO editors
//   (FUN_004f2f28, FUN_004f2988) lower it by 1/30 per frame to 0 once open,
//   and raise it to 1 - fade while closing: those steps center the model.
//   The model sits at the origin, turned by DAT_00a72120 (0; the analog
//   rotation of FUN_004ef18c is not reproduced).
// Ruler (FUN_004ea030, drawn by the editors in the 2D pass): full viewport
//   (FUN_004d2968) and the camera's own angle 0x438e (fovy 73.74 deg, near 1,
//   far 21000). 16 lines at y = 0 and 10..24, half length 8 at multiples of 5
//   and 7.5 otherwise, #ffffa0 with alpha 24 * fade; a quad x -7.5..7.5,
//   y 0..15, z -0.1, #404040 with alpha 64 * fade at the bottom and 0 at the
//   top. The captures confirm both projections: the ruler is 48 px per unit
//   at 1800 lines (320 / 25 * 3.75) while the feet, drawn with the narrower
//   angle, reach below the y = 0 line.
// Widescreen: the reference client (16:10) renders both passes over the whole
// window with the window's aspect; W is the window width here.

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { CLASS_FLAGS } from '../net/bbsession.ts';
import type { PlayerAppearance } from '../render/playermodel.ts';
import type { Appearance } from './charcreate_data.ts';
import { addPlayerLights, CharacterActor, CharaFiles, charaMotionType, GAME_FPS, GLLayer, njPerspectiveFovy } from './playerview.ts';

export interface CharacterModelView {
  setAppearance(classId: number, visual: Appearance, sectionId?: number): void;
  setCamera(mode: 0 | 1 | 2): void;
  setVisible(alpha: number): void; // 0..1, the model's fade-in
  setRuler(alpha: number): void; // 0..1, the PROPORTION / AUTO editor fade
  render(dt: number): void; // advances the camera and the motion
  draw(ctx: CanvasRenderingContext2D): void; // over the whole window, in virtual units
  dispose(): void;
}

// 0x009b11e0: {f32 at proportion_y = 1, f32 at proportion_y = 0} per class.
const CAMERA_HEIGHT: readonly (readonly [number, number])[] = [
  [15, 20], [14, 18], [18, 21.5], [16, 20], [17, 21], [14.5, 19],
  [14.5, 17.5], [16.5, 20], [14, 17.5], [13, 18], [14.8, 20.5], [14.2, 18.3],
];
const FOV_MODEL = njPerspectiveFovy(0x3555);
const FOV_RULER = njPerspectiveFovy(0x438e);
const VIEWPORT_SHIFT = 128; // -_DAT_0091d8f0

// One eased camera value (FUN_004ea854).
function ease(cur: number, target: number, v: number): [number, number] {
  const d = target - cur;
  let s: number;
  if (d > 0.1) s = Math.min(0.1, v + 0.003);
  else if (d > 0.00667) s = Math.max(0.00667, v - 0.003);
  else if (d >= -0.00667) s = 0;
  else if (d >= -0.1) s = Math.min(-0.00667, v + 0.003);
  else s = Math.max(-0.1, v - 0.003);
  return [cur + s, s];
}

function toPlayerAppearance(v: Appearance): PlayerAppearance {
  return {
    sectionId: 0, costume: v.costume, skin: v.skin, face: v.face, head: v.head, hair: v.hair,
    hairR: v.hairColor[0], hairG: v.hairColor[1], hairB: v.hairColor[2],
    proportionX: v.proportion[0], proportionY: v.proportion[1],
  };
}

export class PlayerModelView implements CharacterModelView {
  private gl = new GLLayer();
  private scene = new THREE.Scene();
  private rulerScene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV_MODEL, 4 / 3, 1, 10000);
  private rulerCamera = new THREE.PerspectiveCamera(FOV_RULER, 4 / 3, 1, 21000);
  private actor: CharacterActor;
  private lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private backQuad: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private cls = 0;
  private py = 0;
  private wanted: 0 | 1 | 2 = 2;
  private mode = 2;
  private counter = 0;
  private dist = 30;
  private height = 10.5;
  private vDist = 0;
  private vHeight = 0;
  private shift = 1; // DAT_00a72234
  private alpha = 0;
  private ruler = 0;
  private acc = 0;

  constructor(files: ClientFiles | CharaFiles) {
    this.actor = new CharacterActor(files instanceof CharaFiles ? files : new CharaFiles(files));
    this.scene.add(this.actor.group);
    addPlayerLights(this.scene);
    const pts: number[] = [];
    for (const y of [0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) {
      const half = y % 5 === 0 ? 8 : 7.5;
      pts.push(-half, y, 0, half, y, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffa0, transparent: true, opacity: 0, depthTest: false }));
    const qg = new THREE.BufferGeometry();
    qg.setAttribute('position', new THREE.Float32BufferAttribute([-7.5, 0, -0.1, 7.5, 0, -0.1, 7.5, 15, -0.1, -7.5, 15, -0.1], 3));
    const g4 = new THREE.Color(0x404040).r; // sRGB #40 in the linear working space
    qg.setAttribute('color', new THREE.Float32BufferAttribute([g4, g4, g4, 1, g4, g4, g4, 1, g4, g4, g4, 0, g4, g4, g4, 0], 4));
    qg.setIndex([0, 1, 2, 0, 2, 3]);
    this.backQuad = new THREE.Mesh(qg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthTest: false }));
    this.rulerScene.add(this.backQuad, this.lines);
  }

  setAppearance(classId: number, v: Appearance, sectionId = 0xff): void {
    this.cls = classId;
    this.py = v.proportion[1];
    const flags = CLASS_FLAGS[classId] ?? 0;
    this.actor.setLook({ charClass: classId, classFlags: flags, appearance: toPlayerAppearance(v), emblemSectionId: sectionId });
    this.actor.setMotion(charaMotionType(classId, flags));
  }

  setCamera(mode: 0 | 1 | 2): void {
    this.wanted = mode;
  }

  setVisible(alpha: number): void {
    this.alpha = alpha;
  }

  setRuler(alpha: number): void {
    this.ruler = alpha;
  }

  render(dt: number): void {
    this.acc += Math.min(dt, 0.25) * GAME_FPS;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.tick();
    }
    this.actor.update(dt);
  }

  private tick(): void {
    if (this.wanted === this.mode) this.counter = 0;
    else if (++this.counter >= 0x1f) {
      this.counter = 0;
      this.mode = this.wanted;
    }
    const [top, bottom] = CAMERA_HEIGHT[this.cls] ?? CAMERA_HEIGHT[0];
    const py = this.py >= 0 && this.py <= 1 ? this.py : 0;
    const h = bottom + py * (top - bottom);
    const [td, th] = this.mode === 0 ? [0.5 * h, 0.91 * h] : this.mode === 1 ? [25, 11] : [1.25 * h, 0.55 * h];
    [this.dist, this.vDist] = ease(this.dist, td, this.vDist);
    [this.height, this.vHeight] = ease(this.height, th, this.vHeight);
    // FUN_004f2988 / FUN_004f2f28 (see the header).
    if (this.ruler >= 1) this.shift = Math.max(0, this.shift - 1 / 30);
    else this.shift = Math.max(this.shift, 1 - this.ruler);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.alpha <= 0 && this.ruler <= 0) return;
    this.actor.sync();
    const { vw, w, h } = this.gl.fit(ctx);
    const r = this.gl.renderer;
    r.setViewport(0, 0, w, h);
    r.setScissorTest(false);
    r.clear();
    for (const cam of [this.camera, this.rulerCamera]) {
      cam.aspect = w / h;
      cam.position.set(0, this.height, this.dist);
      cam.lookAt(0, this.height, 0);
      cam.updateProjectionMatrix();
    }
    if (this.ruler > 0) {
      this.lines.material.opacity = Math.round(24 * this.ruler) / 255;
      this.backQuad.material.opacity = Math.round(64 * this.ruler) / 255;
      r.render(this.rulerScene, this.rulerCamera);
    }
    if (this.alpha > 0 && this.actor.loaded) {
      const ox = Math.round(VIEWPORT_SHIFT * (w / 640) * this.shift);
      r.clearDepth();
      r.setViewport(ox, 0, w - ox, h);
      r.render(this.scene, this.camera);
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.alpha > 0 ? this.alpha : 1);
    ctx.drawImage(this.gl.canvas, 0, 0, vw, 480);
    ctx.restore();
  }

  dispose(): void {
    this.actor.dispose();
    this.gl.dispose();
  }
}
