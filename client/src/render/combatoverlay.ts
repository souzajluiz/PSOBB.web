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

export type TechEffectKind = 'fire' | 'ice' | 'lightning' | 'light' | 'dark' | 'resta' | 'support';

const TECH_COLORS: Record<TechEffectKind, number> = {
  fire: 0xff6a20,
  ice: 0x7fd8ff,
  lightning: 0xfff070,
  light: 0xffffff,
  dark: 0xb060ff,
  resta: 0x60ff80,
  support: 0x6090ff,
};
const EFFECT_LIFETIME = 0.6; // seconds

let glow: THREE.Texture | null = null;
// A soft white disc, tinted per technique.
function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  glow = new THREE.CanvasTexture(canvas);
  return glow;
}

export class CombatOverlay {
  private scene: THREE.Scene;
  private numbers: Floating[] = [];
  private effects: Array<Floating & { radius: number }> = [];
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

  // A technique's placeholder effect: a coloured disc that grows to `radius`
  // and fades (the client's own effects, tec_*.bml / g_TechniqueEffectData
  // Pointers, are not drawn; the colour per element is ASSUMED).
  techEffect(kind: TechEffectKind, x: number, y: number, z: number, radius: number): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: TECH_COLORS[kind], depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
    sprite.position.set(x, y + 10, z);
    sprite.scale.set(4, 4, 1);
    sprite.renderOrder = 18;
    this.scene.add(sprite);
    this.effects.push({ sprite, age: 0, radius: Math.max(6, radius) });
  }

  // Lock-on cursor over the current target (null hides it).
  setTarget(pos: { x: number; y: number; z: number } | null): void {
    this.reticle.visible = pos !== null;
    if (pos) this.reticle.position.set(pos.x, pos.y, pos.z);
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const f = this.effects[i];
      f.age += dt;
      const t = Math.min(1, f.age / EFFECT_LIFETIME);
      const s = 4 + (f.radius * 2 - 4) * Math.sqrt(t);
      f.sprite.scale.set(s, s, 1);
      (f.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
      if (t >= 1) {
        this.scene.remove(f.sprite);
        (f.sprite.material as THREE.SpriteMaterial).dispose();
        this.effects.splice(i, 1);
      }
    }
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
    for (const f of this.effects) {
      this.scene.remove(f.sprite);
      (f.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.effects = [];
    this.scene.remove(this.reticle);
    const rm = this.reticle.material as THREE.SpriteMaterial;
    rm.map?.dispose();
    rm.dispose();
  }
}
