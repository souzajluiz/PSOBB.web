// The player's movement constants and pure helpers, read from PsoBB.exe (the
// Ephinea dump has no values for them; they come from the code and from
// tools/exedata.py reads). Per game tick (render/playeranim.ts
// GAME_TICKS_PER_SECOND), not per second:
//   - walk speed 1.0: 0x00a94300 (set by the static init at 0x0069864c), read
//     through 0x0069788c by the walk update (0x0069babc, 0x006a1... walk tick);
//   - run speed 1.5: 0x00a94324 (init 0x0069b6f4), read by the run start
//     (0x006a1898) and 0x006a14e0;
//   - the target of one leg lies 8.0 ahead: 0x00a94320;
//   - slowed ×0.5 (0x0093ca20), guard stance flag ×0.75 (0x0093ca24), see
//     0x006978a0; position += velocity once per tick (0x00777724).
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';

export const WALK_SPEED_PER_TICK = 1.0;
export const RUN_SPEED_PER_TICK = 1.5;
export const LEG_LENGTH = 8.0;
export const SLOWED_MULT = 0.5;
export const GUARD_MULT = 0.75;
export const WALK_SPEED = WALK_SPEED_PER_TICK * GAME_TICKS_PER_SECOND;
export const RUN_SPEED = RUN_SPEED_PER_TICK * GAME_TICKS_PER_SECOND;

// Speed of a leg after the status rules (0x006978a0).
export function legSpeed(base: number, slowed: boolean, guard: boolean): number {
  return slowed ? base * SLOWED_MULT : guard ? base * GUARD_MULT : base;
}

// The keyboard ramp (0x0070a60c): a held key moves its axis by 32 a poll up
// to 128 (the stand-state "amount" is |axis| / 128 against 0.1, and the sum of
// squares / 16384 against 0.1 / 0.75 while moving); a released key drops to 0.
export const KEY_RAMP_STEP = 32;
export const KEY_RAMP_MAX = 128;
export function rampAxis(value: number, neg: boolean, pos: boolean): number {
  if (neg) return Math.max(-KEY_RAMP_MAX, value - KEY_RAMP_STEP);
  if (pos) return Math.min(KEY_RAMP_MAX, value + KEY_RAMP_STEP);
  return 0;
}

// Heading smoothing of one tick (0x007a8cd0): a quarter of the way, half when
// the angle is further than 0x3000. Angles are 16-bit BAMS.
export function headingStep(heading: number, target: number): number {
  const diff = ((target - heading) << 16) >> 16;
  let step = diff >> 1;
  if (diff > -0x3000 && diff < 0x3000) step -= diff >> 2;
  return (heading + step) & 0xffff;
}

// The direction the velocity takes (0x007a8c9c, angle_sum): half way.
export function velocityAngle(heading: number, target: number): number {
  const diff = ((target - heading) << 16) >> 16;
  return (heading + (diff >> 1)) & 0xffff;
}

// Turn in place while standing and pressing sideways (0x007a8c74, step 0x800).
export function clampAngleStep(angle: number, target: number, max: number): number {
  const diff = ((target - angle) << 16) >> 16;
  if (diff <= max && diff >= -max) return target & 0xffff;
  return (angle + (diff < 0 ? -max : max)) & 0xffff;
}
