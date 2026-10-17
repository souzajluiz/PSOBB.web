// The two combat read-outs of the field screen: the damage number that pops up
// over a hit entity and the lock-on reticle over the current target.
//
// From PsoBB.exe (Ephinea 1.25.13): the number is drawn by FUN_0078a5e8 with
// round(d) of each hit box of the strike (see combat/formulas.ts), and the
// reticle by `enable_reticle`, which every enemy AI state calls after
// `SetDerolleLockonTarget_0078730c` picked the lock-on target
// (combat/enemyai.ts). The look of both is drawn here with canvas sprites
// rather than from the client's own textures (ASSUMED: white for an ordinary
// hit, red for a critical one, and the float-up / fade-out timing).

import * as THREE from 'three';

const FLOAT_SPEED = 26; // world units per second the number rises
const LIFETIME = 0.9; // seconds

function numberSprite(text: string, critical: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const font = 'bold 40px system-ui, sans-serif';
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  canvas.width = w;
  canvas.height = 52;
  const c = canvas.getContext('2d')!;
  c.font = font;
  c.textBaseline = 'middle';
  c.lineWidth = 5;
  c.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  c.strokeText(text, 10, 27);
  c.fillStyle = critical ? '#ff5a4a' : '#ffffff';
  c.fillText(text, 10, 27);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(w / 5, 52 / 5, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function reticleSprite(): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.strokeStyle = '#ffe36b';
  c.lineWidth = 6;
  c.beginPath();
  c.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  c.stroke();
  // Four ticks, like the client's lock-on cursor.
  c.lineWidth = 8;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const r0 = size / 2 - 22;
    const r1 = size / 2 - 2;
    c.beginPath();
    c.moveTo(size / 2 + Math.cos(a) * r0, size / 2 + Math.sin(a) * r0);
    c.lineTo(size / 2 + Math.cos(a) * r1, size / 2 + Math.sin(a) * r1);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 0.85 }));
  sprite.scale.set(16, 16, 1);
  sprite.renderOrder = 19;
  sprite.visible = false;
  return sprite;
}

interface Floating {
  sprite: THREE.Sprite;
  age: number;
}

export class CombatOverlay {
  private scene: THREE.Scene;
  private numbers: Floating[] = [];
  private reticle: THREE.Sprite;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.reticle = reticleSprite();
    scene.add(this.reticle);
  }

  // One hit box's number over (x, y, z).
  damage(value: number, critical: boolean, x: number, y: number, z: number): void {
    const sprite = numberSprite(String(Math.max(0, Math.round(value))), critical);
    sprite.position.set(x, y, z);
    this.scene.add(sprite);
    this.numbers.push({ sprite, age: 0 });
  }

  // Lock-on cursor over the current target (null hides it).
  setTarget(pos: { x: number; y: number; z: number } | null): void {
    this.reticle.visible = pos !== null;
    if (pos) this.reticle.position.set(pos.x, pos.y, pos.z);
  }

  update(dt: number): void {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      n.sprite.position.y += FLOAT_SPEED * dt;
      const m = n.sprite.material as THREE.SpriteMaterial;
      m.opacity = Math.max(0, 1 - n.age / LIFETIME);
      if (n.age >= LIFETIME) {
        this.scene.remove(n.sprite);
        m.map?.dispose();
        m.dispose();
        this.numbers.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const n of this.numbers) {
      this.scene.remove(n.sprite);
      const m = n.sprite.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
    }
    this.numbers = [];
    this.scene.remove(this.reticle);
    const rm = this.reticle.material as THREE.SpriteMaterial;
    rm.map?.dispose();
    rm.dispose();
  }
}
