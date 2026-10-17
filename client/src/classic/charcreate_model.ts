// 3D layer of the character creation screen.
//
// The real player models are being built separately (render/playermodel.ts);
// until they land this module renders a placeholder with three.js into its own
// canvas, which the 2D stage composites between the background and the UI.
// To plug the real model in, implement CharacterModelView and pass it to
// CharCreateScreen.
//
// What is decompiled here:
// - The measuring lines behind the model (FUN_004ea030): 16 horizontal lines
//   in world space at y = 0 and 10..24, half length 8 at multiples of 5 and
//   7.5 otherwise, color #ffffa0 with alpha 24 * fade / 255, and a quad
//   x -7.5..7.5, y 0..15 just behind them, #404040 with alpha 64 * fade at the
//   bottom fading to 0 at the top.
// - Camera modes (FUN_004ea854): mode 0 for HEAD, FACE, HAIR and SKIN COLOR
//   (two values eased toward 0.5 h and 0.91 h, h from FUN_004e68cc), mode 1
//   for PROPORTION and AUTO (25 and 11), mode 2 for the other steps (1.25 h
//   and 0.55 h). Each value moves by at most 0.1 per frame with 0.003 frame^-2
//   acceleration. What the two values feed (camera height, distance or
//   field of view) is not traced yet.
// Not decompiled: the camera matrices; the placeholder framing below is
// fitted to the reference captures (AUTO step, mode 1: ruler y = 0 at 380 px,
// y = 24 at 75 px, x = 0 at 384 px of the 640x480 screen). Mode 0 zooms on
// the head (x1.25) as a guess.

import * as THREE from 'three';
import type { Appearance } from './charcreate_data.ts';

export interface CharacterModelView {
  // Bitmap source the stage draws over the full 640x480 virtual screen.
  readonly canvas: HTMLCanvasElement;
  setAppearance(classId: number, visual: Appearance): void;
  setCamera(mode: 0 | 1 | 2): void;
  setVisible(alpha: number): void; // 0..1, the model's fade-in
  setRuler(alpha: number): void; // 0..1, measuring lines (PROPORTION and AUTO)
  render(dt: number): void;
  dispose(): void;
}

const PX_PER_UNIT = 12.6;
const ORIGIN_X = 384;
const ORIGIN_Y = 380;

export class PlaceholderModelView implements CharacterModelView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>;
  private head: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private hair: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private backQuad: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private zoom = 1;
  private targetZoom = 1;
  private alpha = 0;
  private ruler = 0;
  private time = 0;

  constructor(width = 1280, height = 960) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    // Virtual-screen orthographic frame: 1 world unit = PX_PER_UNIT px.
    const w = 640 / PX_PER_UNIT;
    const h = 480 / PX_PER_UNIT;
    const left = -ORIGIN_X / PX_PER_UNIT;
    const top = ORIGIN_Y / PX_PER_UNIT;
    this.camera = new THREE.OrthographicCamera(left, left + w, top, top - h, -100, 100);
    this.camera.position.set(0, 0, 50);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 10, 12);
    this.scene.add(key);

    const skin = new THREE.MeshStandardMaterial({ color: 0xd8b090, roughness: 0.7 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(4.2, 18, 8, 24), new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.6 }));
    this.head = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), skin);
    this.hair = new THREE.Mesh(new THREE.SphereGeometry(2.8, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x80c040, roughness: 0.5 }));
    this.scene.add(this.body, this.head, this.hair);

    // FUN_004ea030 measuring lines.
    const pts: number[] = [];
    for (const y of [0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) {
      const half = y % 5 === 0 ? 8 : 7.5;
      pts.push(-half, y, 0, half, y, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffa0, transparent: true, opacity: 0 }));
    this.scene.add(this.lines);
    const qg = new THREE.BufferGeometry();
    qg.setAttribute('position', new THREE.Float32BufferAttribute([-7.5, 0, -0.1, 7.5, 0, -0.1, 7.5, 15, -0.1, -7.5, 15, -0.1], 3));
    qg.setAttribute('color', new THREE.Float32BufferAttribute([0.25, 0.25, 0.25, 1, 0.25, 0.25, 0.25, 1, 1, 1, 1, 0, 1, 1, 1, 0], 4));
    qg.setIndex([0, 1, 2, 0, 2, 3]);
    this.backQuad = new THREE.Mesh(qg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }));
    this.scene.add(this.backQuad);
    this.setAppearance(0, { costume: 0, skin: 0, face: 0, head: 0, hair: 0, hairColor: [128, 200, 64], proportion: [0.5, 0.5] });
  }

  setAppearance(classId: number, v: Appearance): void {
    const android = [2, 4, 5, 9].includes(classId);
    const [px, py] = v.proportion;
    // Proportion x widens, y lengthens the body (placeholder mapping).
    const sx = 0.85 + 0.3 * px;
    const sy = 0.92 + 0.16 * py;
    this.body.scale.set(sx, sy, sx);
    const bodyCenter = 7 * sy;
    this.body.position.set(0, bodyCenter, 0);
    const headY = bodyCenter + 13.6 * sy;
    this.head.position.set(0, headY, 0.4);
    this.hair.position.set(0, headY + 0.3, 0.2);
    this.hair.visible = !android;
    const [r, g, b] = v.hairColor;
    this.hair.material.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    const hue = ((android ? v.skin : v.costume) * 0.137 + classId * 0.07) % 1;
    this.body.material.color.setHSL(hue, 0.45, android ? 0.45 : 0.35);
    const skinTone = [0xf0c8a8, 0xd8a880, 0xa87050, 0x704830][v.skin % 4];
    this.head.material.color.setHex(android ? 0x9098a8 : skinTone);
  }

  setCamera(mode: 0 | 1 | 2): void {
    this.targetZoom = mode === 0 ? 1.25 : 1;
  }

  setVisible(alpha: number): void {
    this.alpha = alpha;
  }

  setRuler(alpha: number): void {
    this.ruler = alpha;
  }

  render(dt: number): void {
    this.time += dt;
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 4);
    // Zoom about the head for the close-ups.
    const fy = this.zoom > 1 ? 21 : 0;
    this.camera.zoom = this.zoom;
    this.camera.position.y = fy - fy / this.zoom;
    this.camera.updateProjectionMatrix();
    this.lines.material.opacity = (24 / 255) * this.ruler;
    this.backQuad.material.opacity = (64 / 255) * this.ruler;
    for (const m of [this.body, this.head, this.hair]) {
      m.material.transparent = this.alpha < 1;
      m.material.opacity = this.alpha;
    }
    this.body.rotation.y = Math.sin(this.time * 0.6) * 0.15;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
