// The model-based damage effects of PsoBB.exe (Ephinea 1.25.13, VAs): the
// critical hit's flash, the enemy death dissolve and the ice block of a frozen
// enemy. Pure rules (frames of 1 / 30 s); render/hitmodels.ts draws them.

const f = Math.fround;

// --- the critical flash -------------------------------------------------------
//
// unknown_display_critical_hit_effect (0x00501478) makes the effect entity
// (vtable 0x00afe830, update 0x005014e8, render 0x00501620). Its model is the
// root object of effect_nt.rel (load_effect_nt_data, g_EffectNT_Data_009b94f8):
// two crossed quads of 19.2 x 19.2 through one axis (a cross of 45 degree
// planes), strips with the diffuse 0xffb2b2b2, source alpha / one blending,
// double sided, one texture (id 0). Render: the model is moved to the hit
// point, turned about Y by the camera's yaw, scaled by (+0x3c, +0x40, +0x44),
// drawn with the entity colour (+0x2c: alpha), and before the draw the
// texture list's entry 0 is replaced with entry (frame + 1) of technic_pt.xvm
// (g_TechnicTextureData, "Technic_PT": entry 0 is the lightning bolt, entries
// 1..8 are the 64 x 64 energy ring in eight variations).
// Update: the first call makes the particles of CRITICAL_SPARK (combat/
// hitfx.ts); then LerpFloat_00501b34 moves the alpha from 1 to 0 by
// g_enemy_entity_collision_threshold = 0.15 a frame (the entity ends on the
// call after it reached 0), Vec3Lerp_00501bb0 moves the scale from 1 towards 2
// by 20% of the distance a frame, and the frame counter +0x70 cycles 0..6.

export const FLASH_ALPHA_STEP = f(0.15);
export const FLASH_SCALE_LERP = f(0.2);
export const FLASH_SCALE_TARGET = 2;
export const FLASH_TEXTURE_FRAMES = 7; // +0x70 wraps at 7
export const FLASH_DIFFUSE = 0xb2 / 255; // the strips' material colour (0xffb2b2b2)

export interface FlashFrame {
  alpha: number;
  scale: number;
  /** Entry of technic_pt.xvm drawn: frame counter + 1. */
  texture: number;
}

/**
 * LerpFloat_00501b34 (value moved by `step` towards `target`, results kept
 * inside [0, 1] = _g_PositionMin / _g_PositionMax): the new value and whether
 * the value was already the target.
 */
export function lerpFloatTo(value: number, target: number, step: number): { value: number; done: boolean } {
  if (target === value) return { value, done: true };
  if (target <= value) {
    const n = f(value - step);
    return { value: target <= n ? (n < 1 ? n : 1) : target, done: false };
  }
  const n = f(value + step);
  return { value: 0 <= n ? (n <= target ? n : target) : 0, done: false };
}

/**
 * The frames the flash is drawn in. The first is the state it is made in
 * (alpha 1, scale 1, texture entry 1; ASSUMED drawn once before its first
 * update), then one frame per update until the alpha reaches 0 (that frame is
 * invisible and not returned).
 */
export function criticalFlashFrames(): FlashFrame[] {
  const out: FlashFrame[] = [{ alpha: 1, scale: 1, texture: 1 }];
  let alpha = 1;
  let scale = 1;
  let idx = 0;
  for (let i = 0; i < 32; i++) {
    const r = lerpFloatTo(alpha, 0, FLASH_ALPHA_STEP);
    if (r.done) break;
    alpha = r.value;
    scale = f(scale + f(f(FLASH_SCALE_TARGET - scale) * FLASH_SCALE_LERP));
    idx = idx + 1 < FLASH_TEXTURE_FRAMES ? idx + 1 : 0;
    if (alpha > 0) out.push({ alpha, scale, texture: idx + 1 });
  }
  return out;
}

// --- the death dissolve ---------------------------------------------------------
//
// The dark enemies of the ruins and the Episode 2 / 4 areas (Bulclaw, Claw,
// Dark Belra, Chaos Bringer, Dark Gunner, Delsaber, Chaos Sorcerer, Deldepth,
// Morfos, Nar Lily) own a colour ramp object (vtable 0x00aff758; the callers of
// InitializeEnemyState_00512458 are their death states). Its fields: +4..+0x10
// the colour offset (a, r, g, b), +0x14 the step, +0x18 the value t.
//   vtable +4 (0x00512314) sets the step to 2 / n (n = 10: 0.2);
//   InitializeEnemyState_00512458 sets n = 10, t = step * 10 + 2 = 4 and the
//     colour to 1.0 (no offset);
//   vtable +0x10 (0x0051236c) every frame: t -= step, then 0x00512398 maps t
//     to the colour: t > 2 -> a = 0, r = g = b = 0; 1 < t <= 2 -> a = t - 2;
//     t <= 1 -> a = -1, r = g = b = max(t - 1, -1); it returns 1 when t <= 0.
// So the model keeps its look for 10 frames, loses its alpha over the next 5
// (the offset is added to the draw colour: opacity 1 + a) and is gone for the
// last 5; the owner then removes the enemy (and makes a debris entity).

export const DISSOLVE_STEPS = 10;

export interface DissolveFrame {
  /** Opacity of the model: 1 + the alpha offset. */
  opacity: number;
  done: boolean;
}

export class Dissolve {
  private step = f(f(2) / DISSOLVE_STEPS);
  private t = f(f(this.step * 10) + 2);
  frame = 0;

  /** One call of vtable +0x10 (once per frame while dying). */
  tick(): DissolveFrame {
    this.t = f(this.t - this.step);
    this.frame++;
    const t = this.t;
    let a: number;
    if (t > 1) a = t <= 2 ? f(t + -2) : 0;
    else a = -1;
    return { opacity: Math.min(1, Math.max(0, 1 + a)), done: t <= 0 };
  }
}

// --- the ice block of a frozen enemy -----------------------------------------------
//
// freeze_entity makes (CreateItemEffectHandler_00500fe8 ->
// InitializeEnemyEntity_00501068, 0x374 bytes, vtable 0x00afe680, update
// 0x00500d40, render 0x00500c6c) an ice object around the frozen entity: the
// model entry 1 of bm_eff_ice.bml (ice_root.xj, 92 vertices, about 17 units
// radius, two textures, source alpha / one blending) at the hit box centre,
// the particle 0x12e (b_eff_kirameki) there too, SE 0x10. Its scale (+0x68..
// +0x70, all three equal) starts at 0 and the target `radius` is the hit box
// radius * 0.15 (0.075 through the other hit box pointer; 1.5 without one).
//   state 0 (0x00500ef4): scale += 0.1 and the yaw (+0x60) += 0x1000 a frame;
//     above `radius` -> state 1; every third frame the particle 0x12d (10
//     frames of emission) at the centre + (0, 0, scale * 10) turned by twice
//     the yaw;
//   state 1 (0x00500e08): the yaw += 0x10 a frame; when the frozen entity is
//     no longer frozen (its flag 0x20 clear, or flag 0x800) -> state 2 and
//     the shatter: the particle 0x153 (b_eff_koori, model entry 5 of
//     bm_technic.bml, eff_f_ice_piece.xj, at the entity's own position) and
//     the particle 0x33 (ice_breaker: model entry 0 of bm_eff_ice.bml with its
//     motion 0, at the centre);
//   state 2 (0x00500dd0): a value (+0x348) goes 0, -0.4, -0.8 -> at -1 or less
//     state 3 (three frames: the block is drawn a last time with it as a
//     colour offset);
//   state 3: the entity is destroyed.

export const ICE_GROW = f(0.1);
export const ICE_TURN_GROW = 0x1000; // BAMS a frame in state 0
export const ICE_TURN_HOLD = 0x10; // BAMS a frame in state 1
export const ICE_RING_PERIOD = 3;
export const ICE_RING_PARTICLE = 0x12d;
export const ICE_RING_FRAMES = 10;
export const ICE_RING_RADIUS = 10; // x the scale
export const ICE_SPARKLE_PARTICLE = 0x12e;
export const ICE_SHATTER_PIECES = 0x153;
export const ICE_SHATTER_BREAK = 0x33;
/** The pieces' emitter: HandleFlameEnemyLogic_00500e08 flags it 0x200 and gives it the model (below), no texture list of its own (the current xvm: technic.xvm), motion speed 1. */
export const ICE_SHARD_MODEL = { bml: 'bm_technic.bml', model: 5, textures: 'technic.xvm' } as const;
/** Pieces made by the emitter 0x153 in its one burst (rate +0x44 = 20, once: the emitter lives one update). */
export const ICE_SHARD_COUNT = 20;
/** The model's strips use texture id 2 of the list, additive (source alpha / one). */
export const ICE_SHARD_TEXTURE_ID = 2;

// The orientation of a model particle (ParticleEffectSingleParticle_Update_0050e698,
// flag 0x200): Vector3f_GetAnglesZ_007a8d98 turns the step (velocity) into a Z angle
// -atan2(vx, vy) and an X angle atan2(vz, hypot(vx, vy)); the matrix is
// T(position) S(size) Rz(z) Rx(x) Ry(g_VelocityAngles_y: ASSUMED 0) Ry(spin angle), so the
// model's own up axis follows the step and the particle's angle spins it about that axis.
export function velocityAngles(vx: number, vy: number, vz: number): { z: number; x: number } {
  return { z: -Math.atan2(vx, vy), x: Math.atan2(vz, Math.hypot(vx, vy)) };
}
export const ICE_FADE_STEP = f(-0.4);
export const ICE_FADE_END = -1;
export const ICE_DEFAULT_RADIUS = 1.5;
export const ICE_RADIUS_FACTOR = f(0.15);

export interface IceStep {
  state: 0 | 1 | 2 | 3;
  /** Scale of the block (x = y = z). */
  scale: number;
  /** Yaw in BAMS (0..0xffff). */
  yaw: number;
  /** The ring particle to make this frame: its radius from the centre and its angle (BAMS). */
  ring: { radius: number; angle: number } | null;
  /** The shatter starts this frame. */
  shatter: boolean;
  /** Colour offset of the last frames (0 -> -1), for the opacity 1 + offset. */
  fade: number;
  done: boolean;
}

export class IceBlock {
  state: 0 | 1 | 2 | 3 = 0;
  scale = 0;
  yaw = 0;
  private fade = 0;
  private frames = 0;

  readonly radius: number;

  /** `radius`: the hit box radius * 0.15, or ICE_DEFAULT_RADIUS. */
  constructor(radius: number) {
    this.radius = radius;
  }

  /** One update (every frame); `frozen` is the frozen entity's flag 0x20 (and not 0x800). */
  tick(frozen: boolean): IceStep {
    let ring: IceStep['ring'] = null;
    let shatter = false;
    let done = false;
    switch (this.state) {
      case 0: {
        this.scale = f(ICE_GROW + this.scale);
        this.yaw = (this.yaw + ICE_TURN_GROW) & 0xffff;
        if (this.radius < this.scale) this.state = 1;
        this.frames++;
        if (this.frames % ICE_RING_PERIOD === 0) ring = { radius: f(this.scale * ICE_RING_RADIUS), angle: (this.yaw * 2) & 0xffff };
        break;
      }
      case 1:
        this.yaw = (this.yaw + ICE_TURN_HOLD) & 0xffff;
        if (!frozen) {
          this.state = 2;
          shatter = true;
        }
        break;
      case 2: {
        const v = f(this.fade + ICE_FADE_STEP);
        if (v <= ICE_FADE_END) {
          this.state = 3;
          this.fade = -1;
        } else {
          this.fade = v;
        }
        break;
      }
      case 3:
        done = true;
        break;
    }
    return { state: this.state, scale: this.scale, yaw: this.yaw, ring, shatter, fade: this.fade, done };
  }
}

/** The ice block's target scale from a collision radius (the hit box radius * 0.15). */
export function iceRadius(collisionRadius: number | null): number {
  return collisionRadius === null || !(collisionRadius > 0) ? ICE_DEFAULT_RADIUS : f(collisionRadius * ICE_RADIUS_FACTOR);
}
