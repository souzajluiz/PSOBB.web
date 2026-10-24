// The two combat read-outs of the field screen: the damage number that pops up
// over a hit entity and the lock-on reticle over the current target.
//
// From PsoBB.exe (Ephinea 1.25.13): the number is the floating text object
// display_floating_text_effect_numeric (0x0078a5e8) makes with round(d) of
// each hit box of the strike (see combat/formulas.ts and combat/hitfx.ts):
// white, never recoloured for a critical, 0x14 frames, drawn by the HUD with
// the client's font (classic/hud.ts FloatingTexts). The "MISS" of a failed
// accuracy roll is the same object in red. Without the HUD's font (not
// loaded) the number falls back to a canvas sprite. The reticle is
// `enable_reticle` (every enemy AI state calls it after
// `SetDerolleLockonTarget_0078730c` picked the lock-on target, combat/enemyai.ts)
// and its drawing (`PositionAndRenderReticlePrimitives_007a360c`): three copies
// of bm_ply_lock_on_cursor.bml's cursor on a circle round the target, each with
// a black outline (combat/reticle.ts has the exe's constants and colour rows).

import * as THREE from 'three';
import { damageFloat, missFloat, type FloatSpec } from '../combat/hitfx.ts';
import {
  RETICLE_BAMS,
  RETICLE_MODEL_Z,
  RETICLE_NOTCH,
  RETICLE_OUTLINE_THRESHOLD,
  RETICLE_Z_OFFSET,
  bamsToRadians,
  reticleColor,
} from '../combat/reticle.ts';

const FLOAT_SPEED = 26; // world units per second the number rises
const LIFETIME = 20 / 30; // seconds (the object lives 0x14 frames)

function numberSprite(text: string, red: boolean): THREE.Sprite {
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
  c.fillStyle = red ? '#ff5a4a' : '#ffffff';
  c.fillText(text, 10, 27);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(w / 5, 52 / 5, 1);
  sprite.renderOrder = 20;
  return sprite;
}

// The lock-on cursor: the three rotated copies of the cursor model, each with its
// black outline, under one group that is moved to the target and turned to face
// the camera (render_reticle / PositionAndRenderReticlePrimitives_007a360c).
// `main` is the cursor's triangle (njcm chunk 0), `outline` the black shape (chunk 2).
interface ReticleParts {
  group: THREE.Group;
  bodies: THREE.MeshBasicMaterial[]; // the coloured cursors (one per copy)
  outlines: THREE.MeshBasicMaterial[]; // the black outlines (one per copy)
}

function reticleGroup(main: THREE.BufferGeometry, outline: THREE.BufferGeometry): ReticleParts {
  const group = new THREE.Group();
  const bodies: THREE.MeshBasicMaterial[] = [];
  const outlines: THREE.MeshBasicMaterial[] = [];
  for (const bams of RETICLE_BAMS) {
    // The exe rotates the frame, then translates it out to the notch distance.
    const arm = new THREE.Group();
    arm.rotation.z = bamsToRadians(bams);
    group.add(arm);
    const notch = new THREE.Group();
    notch.position.set(0, RETICLE_NOTCH, RETICLE_Z_OFFSET);
    arm.add(notch);
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, depthTest: false, transparent: true });
    const blackMesh = new THREE.Mesh(outline, black);
    blackMesh.renderOrder = 18;
    notch.add(blackMesh);
    outlines.push(black);
    const colour = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true });
    const body = new THREE.Mesh(main, colour);
    body.position.z = RETICLE_MODEL_Z;
    body.renderOrder = 19;
    notch.add(body);
    bodies.push(colour);
  }
  group.visible = false;
  return { group, bodies, outlines };
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
  // The lock-on cursors: null until setReticleModels (the BML is loaded). `reticle` is the
  // enemy's; `allyReticle` the support target's (a second reticle object of the same model,
  // the exe's one object per target, find_targets_for_weapons_and_techs).
  private reticle: ReticleParts | null = null;
  private allyReticle: ReticleParts | null = null;
  // The HUD's floating texts (render/playerhud.ts hitPopup); false when its
  // font is not there yet.
  text: ((spec: FloatSpec, x: number, y: number, z: number) => boolean) | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // The cursor's two models (bm_ply_lock_on_cursor.bml, chunks 0 and 2).
  setReticleModels(main: THREE.BufferGeometry, outline: THREE.BufferGeometry): void {
    if (this.reticle) return;
    this.reticle = reticleGroup(main, outline);
    this.allyReticle = reticleGroup(main, outline);
    this.scene.add(this.reticle.group, this.allyReticle.group);
  }

  // One hit box's number over (x, y, z). `_critical` does not change the look.
  damage(value: number, _critical: boolean, x: number, y: number, z: number): void {
    const spec = damageFloat(value);
    if (spec) this.float(spec, x, y, z);
  }

  // The red "MISS" of a failed accuracy roll.
  miss(x: number, y: number, z: number): void {
    this.float(missFloat(), x, y, z);
  }

  /** A floating text of any spec (Resta's green "HP+n"). */
  float(spec: FloatSpec, x: number, y: number, z: number): void {
    if (this.text?.(spec, x, y, z)) return;
    const sprite = numberSprite(spec.text, spec.rgb === 0xff0000);
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

  // Lock-on cursor over the current target (null hides it). `pos` is the target's
  // point, moved toward the camera by `radius` (CalculatePositionTowardsCamera_006ea73c,
  // ASSUMED 0: the hitbox radius is not passed here); the cursor's colour is the
  // reticle table row `row` (combat/reticle.ts reticleRow) and it turns to face `camera`.
  // `ally` moves the support target's cursor instead of the enemy's.
  setTarget(
    pos: { x: number; y: number; z: number } | null,
    opts: { row: number; camera: THREE.Camera; radius?: number; ally?: boolean },
  ): void {
    const r = opts.ally ? this.allyReticle : this.reticle;
    if (!r) return;
    r.group.visible = pos !== null;
    if (!pos) return;
    const cam = opts.camera.position;
    const dir = new THREE.Vector3(cam.x - pos.x, cam.y - pos.y, cam.z - pos.z).normalize();
    r.group.position.set(pos.x + dir.x * (opts.radius ?? 0), pos.y + dir.y * (opts.radius ?? 0), pos.z + dir.z * (opts.radius ?? 0));
    r.group.quaternion.copy(opts.camera.quaternion);
    const [opacity, cr, cg, cb] = reticleColor(opts.row);
    for (const m of r.bodies) {
      m.color.setRGB(cr, cg, cb, THREE.SRGBColorSpace);
      m.opacity = opacity;
    }
    for (const m of r.outlines) m.opacity = opacity > RETICLE_OUTLINE_THRESHOLD ? 1 : 0;
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
    for (const r of [this.reticle, this.allyReticle]) {
      if (!r) continue;
      this.scene.remove(r.group);
      for (const m of [...r.bodies, ...r.outlines]) m.dispose();
    }
    this.reticle = null;
    this.allyReticle = null;
  }
}
