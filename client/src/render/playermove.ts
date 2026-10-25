// The player's movement constants and pure helpers, read from PsoBB.exe (the
// Ephinea dump has no values for them; they come from the code and from
// tools/exedata.py reads). Per game tick (render/playeranim.ts
// GAME_TICKS_PER_SECOND), not per second:
//   - walk speed 1.0: 0x00a94300 (set by the static init at 0x0069864c), read
//     through 0x0069788c by the walk update (0x0069babc, 0x006a1... walk tick);
//   - run speed 1.5: 0x00a94324 (init 0x0069b6f4), read by the run start
//     (0x006a1898) and 0x006a14e0;
//   - the target of one leg lies 8.0 ahead: 0x00a94320;
//   - 0x006978a0: ×0.5 (0x0093ca20) when slowed (player+0x30 bit 0x08, set by
//     slow_entity 0x00778b10) outside the hubs (0x00690344: the map id at
//     player+0x3ec is not Pioneer 2 Ep1 / lobby / Pioneer 2 Ep2 / Ep4 = 0 /
//     15 / 18 / 45, table 0x0097f1c8), else ×0.75 (0x0093ca24) in guard
//     stance (player+0x30 bit 0x00100000, copied to player+0x6c4 bit 0x08 by
//     0x0069ba18; set near a target by 0x0052ac5c: enter within 50 / leave
//     beyond 100 units for hunters, 100 / 150 for the others, and after a
//     light hit or an evade, 0x006a29f4); then ×[player+0x690] (0.4) when
//     player+0x68c bit 0 is set, which no player code sets (not ported);
//   - position += velocity once per tick (0x00777724);
//   - the walk / run motion step: the record speed * the leg speed of the
//     state (0x006a2061 walk: base DAT_00a94300 = 1.0, 0x006a1a10 run: base
//     DAT_00a94324 = 1.5). The exe writes record.speed * 0x6c0 (player+0x6c0,
//     the 0x006978a0 result) to player+0xd0 every tick, and the motion tick
//     copies it to the frame step (0x007aa094 / 0x007a9b5b). So a slowed or
//     guarding player's legs and feet run at the same rate.
// The local player's slow and guard are driven in the field too: render/combat.ts
// feeds PlayerMover.slowed and the target distance (LobbyView.legState).
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

// The hub table 0x0097f1c8 (0, 15, 18, 45, -1 end): read by 0x00807d8c, which
// returns 1 when the map id is NOT in it. The port's `area` is that map id
// (render/gameview.ts AREA_NAMES: 0x00 Pioneer 2, 0x12 Lab, 0x2d Pioneer 2;
// net/game.ts floorToArea gives floor 0 of Ep2 = 0x12, of Ep4 = 0x2d).
export const HUB_AREAS: readonly number[] = [0, 15, 18, 45];

// is_player_in_unsafe_map (0x0068a3fc: the map id at player+0x3ec is outside the
// hub table). Three exe callers use it, so the port shares this one helper:
//   - the slow (player+0x30 bit 8) counts only here (0x00690344);
//   - attacks: is_player_allowed_to_attack (0x00699510, last test at 0x0069955f)
//     behind CheckPlayerAttackPermission (0x006994d4);
//   - techniques: CanPlayerCastTechnique (0x0069a0c4, call at 0x0069a128, only
//     when the technique's level test 0x006ad158 is 0).
// render/combat.ts press() and castTechnique() refuse outside it.
export function inUnsafeMap(area: number): boolean {
  return !HUB_AREAS.includes(area);
}

// The slow counts outside the hubs only (0x00690344 -> 0x0068a3fc).
export function slowApplies(area: number): boolean {
  return inUnsafeMap(area);
}

// The guard stance's classes (0x0052ac5c): a hunter (player+0x964 & 0xe0 == 0x20:
// HUmar, HUnewearl, HUcast, HUcaseal) uses the near / far pair of hunters, the
// others (Rangers, Forces) the wider pair. Squared distances (0x00922330..3c):
// a hunter enters within 50 and leaves beyond 100, the others enter within 100
// and leave beyond 150.
export const GUARD_HUNTER_CLASSES: ReadonlySet<number> = new Set([0, 1, 2, 9]);
export const GUARD_RANGE_SQ = {
  hunter: { enter: 2500, leave: 10000 },
  other: { enter: 10000, leave: 22500 },
} as const;

// The guard stance after one proximity check. `distSq` is the squared distance
// to the target, or null with no target (the stance drops). Hysteresis: once
// on, it stays on until the leave distance; off, it turns on inside the enter one.
export function guardStance(on: boolean, distSq: number | null, charClass: number): boolean {
  if (distSq === null) return false;
  const r = GUARD_HUNTER_CLASSES.has(charClass) ? GUARD_RANGE_SQ.hunter : GUARD_RANGE_SQ.other;
  return on ? distSq <= r.leave : distSq < r.enter;
}

// What LobbyView asks the local player's owner each frame: whether the slow
// applies and the point the guard stance is measured to (null: no target).
export interface LegState {
  slowed: boolean;
  target: { x: number; y: number; z: number } | null;
  // Confused on an unsafe map: the heading is steered at random (modifyDirection).
  confused: boolean;
}

// modify_direction (dump Psobb.exe-05112026.c line 556981, its VA not read): a movement input's
// target heading (the stick or key direction plus the camera) is replaced, every
// tick it is read, by a random heading while the player is confused in an
// unsafe map. The random is the C rand() (0..32767, the constant 0x0093c750), and
// the result is ROUND(rand / 32768 * 360 * 65536 / 360) BAMS (0x0093c748 = 65536,
// 0x0093c74c = 360). Not confused: the heading is returned as it is, no rand call.
export const RAND_MAX_C = 32767;
const DIRECTION_NORMALIZATION = 32768; // 0x0093c750
const DIRECTION_SCALE = 65536; // 0x0093c748
const DEGREES_360 = 360; // 0x0093c74c
export function modifyDirection(heading: number, confused: boolean, rand: () => number): number {
  if (!confused) return heading;
  const r = rand();
  return Math.round(((r / DIRECTION_NORMALIZATION) * DEGREES_360 * DIRECTION_SCALE) / DEGREES_360) & 0xffff;
}

// The heading an attack is sent with (dispatch_action_attack_step1 at dump line 586837,
// _step2 at 586529, _step3 at 586320): the target's angle (or the player's heading) goes
// through modify_direction before the 6x43 packet's local_c, so a confused player's
// strike carries a random heading. Radians in and out; the exe writes only the packet,
// the player's own heading (param_1->heading) is not changed by the step (ASSUMED from the
// step bodies, which store nothing but local_c).
export function attackHeading(rad: number, confused: boolean, rand: () => number): number {
  if (!confused) return rad;
  return fromBams(modifyDirection(toBams(rad), true, rand));
}

// The keyboard ramp (0x0070a60c, PsoBB.exe, dump get_input_movement_speed): a held key moves
// its axis by 32 a poll up to the cap (the stand-state "amount" is |axis| / 128 against 0.1,
// and the sum of squares / 16384 against 0.1 / 0.75 while moving); a released key drops to 0
// when no auto move is on. PROVEN: the step is 0x0096ed7c = 32.0 (fsub / fadd at 0x70a809,
// 0x70a842, 0x70a8bd, 0x70a902); the cap is 0x0096ed88 = 128.0, or 0x0096ed84 = 64.0 when the
// setting is the auto walk (edx == 1 at 0x70a63a, the walk test). The exe's key order: the
// forward key is tested first and its branch jumps past the backward one (0x70a7fb je 0x70a82a,
// 0x70a828 jmp 0x70a8a5), so forward wins over backward; the left key is tested first and its
// branch jumps past the right one (0x70a8e8 jmp 0x70a94f), so left wins over right.
// `negFirst` says which side wins when both keys are held: true for neg (left; the lateral
// call), false for pos (forward; the forward axis call passes its backward key as neg, forward
// as pos, and false). `cap` is 128, or KEY_RAMP_WALK_MAX under the auto walk setting.
export const KEY_RAMP_STEP = 32;
export const KEY_RAMP_MAX = 128;
export const KEY_RAMP_WALK_MAX = 64;
export function rampAxis(value: number, neg: boolean, pos: boolean, negFirst = true, cap = KEY_RAMP_MAX): number {
  const down = neg && (negFirst || !pos);
  const up = pos && (!negFirst || !neg);
  if (down) return Math.max(-cap, value - KEY_RAMP_STEP);
  if (up) return Math.min(cap, value + KEY_RAMP_STEP);
  return 0;
}
// No key held while an auto move is on (the same function, the setting not off): the forward
// axis still ramps 32 a poll to the cap (exe: max(amount - 32, -cap), forward is negative there;
// 0x70aa6d), so it reaches the cap in cap / 32 polls rather than at once.
export function autoForwardRamp(value: number, cap: number): number {
  return Math.min(value + KEY_RAMP_STEP, cap);
}
// No key and no stick on the lateral axis while an auto move is on: the amount falls back to 0
// by 8 a poll from either side (0x0096ed74 = -8.0, 0x0096ed78 = 8.0; 0x70a9e1 / 0x70aa1c).
// The release with the setting off is 0 at once (0x70aa4c).
export const LATERAL_DECAY_STEP = 8;
export function lateralDecay(value: number): number {
  if (value > 0) return Math.max(0, value - LATERAL_DECAY_STEP);
  if (value < 0) return Math.min(0, value + LATERAL_DECAY_STEP);
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
  // modify_direction on the input's target heading (BAMS); absent = no steering.
  steer?: ((heading: number) => number) | undefined;
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
  // Set on the tick a walk starts from a stand (the exe's move-start tick).
  private launch: number | null = null;
  // Legs started so far: each one is one 6x40 / 6x42 (the exe sends the leg's
  // point when the leg is set, 0x0069bb6c), so a change means a new packet.
  legSerial = 0;

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
    this.legSerial++;
  }

  // The point the current leg aims at (the 6x40 / 6x42 point).
  legEnd(): { x: number; z: number } {
    return { x: this.targetX, z: this.targetZ };
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
    const aim = toBams(Math.atan2(dx, dz));
    const want = input.steer ? input.steer(aim) : aim;
    if (this.state === 'stand') {
      if (input.keyboard && Math.abs(input.fb) / AXIS < MOVE_THRESHOLD) {
        this.heading = clampAngleStep(this.heading, want, TURN_IN_PLACE);
        if (this.heading !== want) return;
      }
      this.state = 'walk';
      this.runCount = 0;
      this.startLeg(want);
      this.launch = want;
      return;
    }
    // The run gate's measure: the keyboard path compares the sum of squares
    // (unknown_handle_gamepad_input_move's speed, the ramp values); the stick's
    // path (the same function, its amount > 0.1 branch, dump line 587209)
    // compares movement_input_amount, hypot / 128 clamped to 1.
    const pace = input.keyboard ? sumSquares : amount;
    if (this.state === 'walk') {
      if (pace > RUN_THRESHOLD) this.runCount++;
      if (this.runCount >= RUN_TICKS) this.state = 'run';
    } else if (this.arrived && pace < RUN_THRESHOLD) {
      this.state = 'walk';
      this.runCount = 0;
    }
    if (this.arrived) this.startLeg(want);
  }

  // The guard stance from the proximity check of this tick (0x0052ac5c).
  setGuard(distSq: number | null, charClass: number): void {
    this.guard = guardStance(this.guard, distSq, charClass);
  }

  tick(input: MoverInput, move: MoveFn): void {
    this.poll(input);
    if (this.state === 'stand') return;
    const base = this.state === 'run' ? RUN_SPEED_PER_TICK : WALK_SPEED_PER_TICK;
    const speed = legSpeed(base, this.slowed, this.guard);
    if (this.launch !== null) {
      // The move-start tick (UpdatePlayerVelocity_0069babc, dump line 581618): the
      // velocity is the input direction in full (ApplyPlayerRotation scale times
      // sin / cos of next_frame_heading_delta), and the heading is not smoothed
      // on this tick (no UpdateForwardMovement yet). Heading smoothing and the
      // half-way velocity start with the next tick.
      const dir = fromBams(this.launch);
      this.launch = null;
      this.step(move(Math.sin(dir) * speed, Math.cos(dir) * speed), speed);
      return;
    }
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    if (dx * dx + dz * dz < 4 * speed * speed) this.arrived = true;
    const toTarget = toBams(Math.atan2(dx, dz));
    this.heading = headingStep(this.heading, toTarget);
    const dir = fromBams(velocityAngle(this.heading, toTarget));
    this.step(move(Math.sin(dir) * speed, Math.cos(dir) * speed), speed);
  }

  private step(r: { x: number; z: number }, speed: number): void {
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

// The render-side follower of a remote player (not the exe's): one packet per
// leg arrives about a latency late, so a follower that reached its leg's point
// while the player still walks or runs carries on along the leg direction
// until the next packet corrects it (dead reckoning). A stopped player's
// follower is not allowed to pass the stop point: it jumps back to it instead
// of stepping back. `dir` is the unit direction of the last leg.
export function remoteStep(
  f: Follower,
  target: { x: number; z: number },
  run: boolean,
  moving: boolean,
  dir: { x: number; z: number },
): boolean {
  const speed = run ? RUN_SPEED_PER_TICK : WALK_SPEED_PER_TICK;
  const dist = Math.hypot(target.x - f.x, target.z - f.z);
  if (moving) {
    // At (or within a step before) the point, or past it: carry on ahead.
    const along = (f.x - target.x) * dir.x + (f.z - target.z) * dir.z;
    if (along >= -speed) return followTick(f, f.x + dir.x * LEG_LENGTH, f.z + dir.z * LEG_LENGTH, run);
    return followTick(f, target.x, target.z, run);
  }
  if (dist < 0.5) return false;
  if ((f.x - target.x) * dir.x + (f.z - target.z) * dir.z > 0) {
    f.x = target.x;
    f.z = target.z;
    return true;
  }
  return followTick(f, target.x, target.z, run);
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
