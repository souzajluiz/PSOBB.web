// The player's movement constants and pure helpers, read from PsoBB.exe (the
// Ephinea dump has no values for them; they come from the code and from
// tools/exedata.py reads). Per game tick (render/playeranim.ts
// GAME_TICKS_PER_SECOND), not per second:
//   - walk speed 1.0: 0x00a94300 (set by the static init at 0x0069864c), read
//     through 0x0069788c by the walk update (0x0069babc, 0x006a1... walk tick);
//   - run speed 1.5: 0x00a94324 (init 0x0069b6f4), read by the run start
//     (0x006a1898) and 0x006a14e0;
//   - the target of one leg lies 8.0 ahead: 0x00a94320;
//   - 0x006978a0: ×0.5 (0x0093ca20) when 0x00690344 is true (player+0x30 bit
//     0x08, only while player+0x3ec is not 0 / 15 / 18 / 45), else ×0.75
//     (0x0093ca24) when player+0x6c4 bit 0x08 is set (0x0069ba18 copies it
//     from player+0x30 bit 0x00100000); then ×[player+0x690] when
//     player+0x68c bit 0 is set (not ported). ASSUMED: the names `slowed` /
//     `guard` for the two conditions; neither state was traced;
//   - position += velocity once per tick (0x00777724).
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';

export const WALK_SPEED_PER_TICK = 1.0;
export const RUN_SPEED_PER_TICK = 1.5;
export const LEG_LENGTH = 8.0;
export const SLOWED_MULT = 0.5;
export const GUARD_MULT = 0.75;
export const WALK_SPEED = WALK_SPEED_PER_TICK * GAME_TICKS_PER_SECOND;
export const RUN_SPEED = RUN_SPEED_PER_TICK * GAME_TICKS_PER_SECOND;

// Speed of a leg after the 0.5 / 0.75 rules of 0x006978a0 (see the header).
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

// --- the local player's tick (0x00689174: poll -> arrival check -> update) ---

const BAMS = 0x10000;
const TURN_IN_PLACE = 0x800;
const MOVE_THRESHOLD = 0.1; // 0x0093da84
const RUN_THRESHOLD = 0.75; // 0x0093da70
const RUN_TICKS = 6; // 0x0093da74
const AXIS = 128;

export const toBams = (rad: number): number => Math.round((rad / (Math.PI * 2)) * BAMS) & 0xffff;
export const fromBams = (bams: number): number => (bams / BAMS) * Math.PI * 2;

export type MoverState = 'stand' | 'walk' | 'run';

export interface MoverInput {
  lr: number; // right +, -128..128
  fb: number; // forward +, -128..128
  cameraYaw: number; // radians, the camera's chase angle (forward = -sin, -cos)
  keyboard: boolean; // sideways-only keys turn in place instead of walking off
}

export type MoveFn = (dx: number, dz: number) => { x: number; z: number };

// One player's walk / run state machine, stepped once per game tick. A leg
// aims at a point LEG_LENGTH ahead; the poll only acts when the leg has
// arrived, so a direction change or a release takes effect at a leg's end.
export class PlayerMover {
  state: MoverState = 'stand';
  heading = 0; // BAMS
  slowed = false;
  guard = false;
  private targetX = 0;
  private targetZ = 0;
  private arrived = true;
  private runCount = 0;

  x: number;
  z: number;

  constructor(x = 0, z = 0) {
    this.x = x;
    this.z = z;
  }

  get angle(): number {
    return fromBams(this.heading);
  }

  place(x: number, z: number, angle: number): void {
    this.x = x;
    this.z = z;
    this.heading = toBams(angle);
    this.state = 'stand';
    this.arrived = true;
    this.runCount = 0;
  }

  private startLeg(bams: number): void {
    const a = fromBams(bams);
    this.targetX = this.x + Math.sin(a) * LEG_LENGTH;
    this.targetZ = this.z + Math.cos(a) * LEG_LENGTH;
    this.arrived = false;
  }

  private poll(input: MoverInput): void {
    const amount = Math.min(1, Math.hypot(input.lr, input.fb) / AXIS);
    const sumSquares = (input.lr * input.lr + input.fb * input.fb) / (AXIS * AXIS);
    if (amount < MOVE_THRESHOLD) {
      if (this.state !== 'stand' && this.arrived) this.state = 'stand';
      this.runCount = 0;
      return;
    }
    // forward = (-sin, -cos) of the camera yaw, right = (-forward.z, forward.x)
    const fx = -Math.sin(input.cameraYaw);
    const fz = -Math.cos(input.cameraYaw);
    const dx = fx * input.fb - fz * input.lr;
    const dz = fz * input.fb + fx * input.lr;
    const want = toBams(Math.atan2(dx, dz));
    if (this.state === 'stand') {
      if (input.keyboard && Math.abs(input.fb) / AXIS < MOVE_THRESHOLD) {
        this.heading = clampAngleStep(this.heading, want, TURN_IN_PLACE);
        if (this.heading !== want) return;
      }
      this.state = 'walk';
      this.runCount = 0;
      this.startLeg(want);
      return;
    }
    if (this.state === 'walk') {
      if (sumSquares > RUN_THRESHOLD) this.runCount++;
      if (this.runCount >= RUN_TICKS) this.state = 'run';
    } else if (this.arrived && sumSquares < RUN_THRESHOLD) {
      this.state = 'walk';
      this.runCount = 0;
    }
    if (this.arrived) this.startLeg(want);
  }

  tick(input: MoverInput, move: MoveFn): void {
    this.poll(input);
    if (this.state === 'stand') return;
    const base = this.state === 'run' ? RUN_SPEED_PER_TICK : WALK_SPEED_PER_TICK;
    const speed = legSpeed(base, this.slowed, this.guard);
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    if (dx * dx + dz * dz < 4 * speed * speed) this.arrived = true;
    const toTarget = toBams(Math.atan2(dx, dz));
    this.heading = headingStep(this.heading, toTarget);
    const dir = fromBams(velocityAngle(this.heading, toTarget));
    const r = move(Math.sin(dir) * speed, Math.cos(dir) * speed);
    // A wall that stops (most of) the step ends the leg, so the next poll can
    // turn or stop: the leg's point lies behind the wall and would never be
    // reached. ASSUMED (the exe's wall-touch handler was not traced).
    if (Math.hypot(r.x - this.x, r.z - this.z) < 0.25 * speed) this.arrived = true;
    this.x = r.x;
    this.z = r.z;
  }
}

// A remote player's tick: the same update the local one runs (heading
// smoothing, velocity half way), toward the point a 6x40 / 6x42 packet gave,
// at 1.0 / 1.5 a tick. A point within a step is reached exactly. Returns
// false once the player stands on the target (nothing moved).
export interface Follower {
  x: number;
  z: number;
  heading: number; // BAMS
}

export function followTick(f: Follower, targetX: number, targetZ: number, run: boolean): boolean {
  const dx = targetX - f.x;
  const dz = targetZ - f.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return false;
  const speed = run ? RUN_SPEED_PER_TICK : WALK_SPEED_PER_TICK;
  const toTarget = toBams(Math.atan2(dx, dz));
  f.heading = headingStep(f.heading, toTarget);
  if (dist <= speed) {
    f.x = targetX;
    f.z = targetZ;
    return true;
  }
  const dir = fromBams(velocityAngle(f.heading, toTarget));
  f.x += Math.sin(dir) * speed;
  f.z += Math.cos(dir) * speed;
  return true;
}
