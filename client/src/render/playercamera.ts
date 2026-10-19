// The player camera of PsoBB.exe (Ephinea 1.25.13): the "unknown player
// camera" the client creates for the local player (CreateUnknownPlayerCamera
// _004d7e70, vtable 0x00afca90, update UpdateUnknownPlayerCamera_004d7698),
// plus what the camera controller does with its output each frame
// (UpdateDefaultNPCCameraState_004d3abc).
//
// Zoom: five levels, camera_zoom_level (0x009acedc, 1 at start) clamped to
// 0..4 by set_camera_zoom_level; the mouse wheel steps it
// (adjust_camera_for_boss_maps_and_handle_zoom, vtable +0x2c: wheel button
// 0x20000 -> increment_camera_zoom_level, 0x10000 -> decrement). Each level of
// camera_zoom_level_ARRAY_009ace60 is {x, source y, follow distance, x,
// target y, target z}; the same function sets the turn goal (+0x10c, through
// vtable +0x30 set_camera_angle_for_turn_changes) to heading + 0x8000 every
// frame.
//
// Desired source: update_desired_camera_source_based_on_zoom_levels turns (x,
// source y, follow distance) by the camera angle (+0x30) and adds the
// player's position. Desired target: update_desired_camera_target turns (x,
// target y, target z) by heading + 0x8000 and adds the player's position plus
// 18.0 (0x00909750) times the player's last move (position - previous
// position): the target leads the running player.
//
// Angle (ProcessCameraChaseState_004d7a1c, state +0xf8): state 0 waits for a
// move of at least 0.5 units in a frame (|move|^2 >= 0.25, 0x00909798) and
// goes to state 1. State 1 turns the angle toward the goal with
// SmoothCameraAngle_004d6370 (a step of speed * 127 BAMS, snapping once
// closer than that), speed 5, or 2 while the camera is at least 23 units
// (529 = 0x009096e4, squared, in XZ) from its target (flag 4, set by
// UpdateCameraTargetWithCollision_004d88e8); then it drops back to state 0
// when the player stood still this frame. The Camera key puts the angle
// straight behind (heading + 0x8000). State 2 (turn at speed 3 after 250
// idle frames, +0xf4) is never reached: nothing in the exe increments +0xf4.
//
// Wall check (CalculateCameraTargetWithCollision_004d235c, called by
// UpdateCameraTargetWithCollision): a ray with mask 0x100 from the current
// camera source to a probe at the target's height, L units from the player
// toward the camera, where L = 13 (0x00908fc0) * |move|; when the move is
// shorter than 1.0 (0x00908fc4) and the camera looks along the player's axis
// (|dot| of the two horizontal facings > 0.25, 0x00908fb8), L = 0. A hit sets
// flag 1: in state 1 the angle then snaps behind the player (source lerp
// 0.67), or, when the camera is within 20 units (400 = 0x009096e0, squared,
// XZ) of the player (flag 0x10), turns at speed 0x16c with a source lerp of
// 0.05 (0x3d4ccccd).
//
// Smoothing (the controller; the player camera sets its mode +0x38 to 5 =
// collision + lerp): set_global_camera_source_and_target copies the desired
// source / target and the lerp factors (+0x58: 0.67 = 0x3f2b851f, 0.56 with
// two split-screen players; +0x5c: 0.289 = 0x3e93f7cf, from the base
// constructor MapObjectSubEntity_BaseConstructor_004d1f68); then
//   1. unknown_handle_camera_collision_with_geometry: a ray (mask 0x901) from
//      the last safe source (+0x1c8) to the desired source; a hit moves the
//      safe source to 1 unit before the hit and raises +0x174, no hit sets it
//      to the current source and clears +0x174;
//   2. lerp_camera_position: unknown_vec3_lerp(current, desired, factor) for
//      the source and the target: the current point moves toward the desired
//      one by t = 0.16 (0x00909524) * distance * factor, and by 12.0
//      (0x00909520) once t reaches 5.0 (0x00909510);
//   3. handle_camera_source_colliding_with_map_geometry: while +0x174 is up,
//      a ray (mask 0x901) from the target to the source puts the source on
//      the first wall it crosses (and the safe source 1 normal off it).
//
// Field of view: +0x54 starts at 0x36c1 and is eased toward 0x36c1 by 0xb6
// per frame (UpdateUnknownPlayerCamera), so it stays 0x36c1; the controller
// passes it to the projection (0x0082ebc8, same math as njPerspectiveFovy).
//
// Left out: the lock-on check of state 1 (no turn while the player's target
// is within 70 units, player +0x45c), guard / freeze / death states, the
// Pioneer 2 target height offset (eased to 0 there), the camera shake, the
// NPC / boss cameras, and the 0x22d8 field of view of mode +0x100.

export interface CameraZoomLevel {
  sourceY: number;
  distance: number;
  targetY: number;
  targetZ: number;
}

export const CAMERA_ZOOM: readonly CameraZoomLevel[] = [
  { sourceY: 18, distance: 25, targetY: 19.8, targetZ: -5 },
  { sourceY: 25.43, distance: 45.42, targetY: 19.8, targetZ: -5 },
  { sourceY: 26.9, distance: 53.6, targetY: 16.4, targetZ: -5 },
  { sourceY: 28.4, distance: 61.8, targetY: 13.1, targetZ: -5 },
  { sourceY: 30, distance: 70, targetY: 9.8, targetZ: -5 },
];
export const DEFAULT_ZOOM = 1; // 0x009acedc

const BAMS = (Math.PI * 2) / 0x10000;
export const CHASE_STEP = 5 * 0x7f * BAMS; // radians per frame (speed 5)
export const CHASE_STEP_FAR = 2 * 0x7f * BAMS; // speed 2, camera >= 23 from its target
const CHASE_STEP_NEAR_WALL = 0x16c * 0x7f * BAMS; // speed 0x16c (flag 0x10)
export const CHASE_MOVE_SQ = 0.25; // 0x00909798
export const FAR_SQ = 529; // 0x009096e4 camera_auto_reposition_distance
export const NEAR_WALL_SQ = 400; // 0x009096e0
export const TARGET_LEAD = 18; // 0x00909750
const PROBE_SCALE = 13; // 0x00908fc0
const PROBE_MIN_MOVE = 1; // 0x00908fc4
const PROBE_AXIS_DOT = 0.25; // 0x00908fb8
export const LERP_SOURCE = Math.fround(0.67); // 0x3f2b851f
const LERP_SOURCE_NEAR_WALL = Math.fround(0.05); // 0x3d4ccccd
export const LERP_TARGET = Math.fround(0.289); // 0x3e93f7cf
const LERP_SPEED = Math.fround(0.16); // 0x00909524 g_LerpSpeedFactor
const LERP_JUMP_FROM = 5.0; // 0x00909510
const LERP_JUMP = 12.0; // 0x00909520 g_MaxLerpDistance
export const CAMERA_WALL_MASK = 0x901; // camera source rays
export const CAMERA_SIGHT_MASK = 0x100; // CalculateCameraTargetWithCollision
export const CAMERA_FOV_ANGLE = 0x36c1; // +0x54

export type Vec3 = { x: number; y: number; z: number };
type V3 = [number, number, number];

// The map collision the camera rays use (render/collision.ts CollisionWorld,
// segmentHit = cast_ray_at_map_collision_geometry).
export interface CameraWorld {
  segmentHit(from: V3, to: V3, mask: number): { point: V3; normal: V3 } | null;
}

function lerpInto(out: Vec3, a: Vec3, b: Vec3, t: number): void {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const len3 = (x: number, y: number, z: number) => Math.hypot(x, y, z);
const arr = (v: Vec3): V3 => [v.x, v.y, v.z];

// SmoothCameraAngle_004d6370: one step toward `goal`, or the goal itself once
// closer than the step.
export function smoothAngle(angle: number, goal: number, step: number): number {
  const diff = wrap(goal - angle);
  return Math.abs(diff) < step ? wrap(goal) : wrap(angle + Math.sign(diff) * step);
}

// unknown_vec3_lerp (0x004d63b0) with vec3_lerp: moves `cur` toward `des`.
export function lerpPoint(cur: Vec3, des: Vec3, factor: number): Vec3 {
  const d = len3(cur.x - des.x, cur.y - des.y, cur.z - des.z);
  let t = LERP_SPEED * d * factor;
  // t >= d: the exe copies the current point over the desired one; the
  // current point does not move.
  if (!(t < d)) return cur;
  if (t >= LERP_JUMP_FROM) t = LERP_JUMP;
  if (!(t < d) || d === 0) return { ...des };
  const k = t / d;
  return { x: cur.x + (des.x - cur.x) * k, y: cur.y + (des.y - cur.y) * k, z: cur.z + (des.z - cur.z) * k };
}

export class PlayerCamera {
  zoom = DEFAULT_ZOOM;
  // Camera angle (+0x30, radians, the three.js Y angle of the camera's
  // offset from the player): heading + PI is straight behind.
  angle = Math.PI;
  // ProcessCameraChaseState state (+0xf8): 0 standing, 1 chasing.
  chase = 0;
  // What the controller shows (camera_source / camera_target) and the safe
  // source (+0x1c8); null until the first frame, or after snap().
  source: Vec3 | null = null;
  target: Vec3 | null = null;
  private safe: Vec3 | null = null;
  private wallHit = false; // +0x174
  private last: Vec3 | null = null;
  // The shown points before the last tick (render/smoothrender.ts draws the
  // camera between them and the current ones; null: snap).
  private prevSource: Vec3 | null = null;
  private prevTarget: Vec3 | null = null;
  private readonly drawn = { source: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

  // Straight behind the player (camera start, Camera key, warps).
  reset(heading: number): void {
    this.angle = wrap(heading + Math.PI);
  }

  // Shows the desired points at once on the next frame (the controller's
  // copy_desired_points_to_current_points). ASSUMED for warps: the client
  // does it on area entry, when it builds the camera.
  snap(): void {
    this.source = this.target = this.safe = null;
    this.last = null;
    this.prevSource = this.prevTarget = null;
    this.chase = 0;
  }

  // Mouse wheel: +1 farther, -1 closer.
  step(delta: number): void {
    this.zoom = Math.min(CAMERA_ZOOM.length - 1, Math.max(0, this.zoom + delta));
  }

  // The points the player camera asks for (update_desired_camera_source_based
  // _on_zoom_levels / update_desired_camera_target); `move` is the player's
  // last move (position - previous position).
  desired(pos: Vec3, heading: number, move: Vec3 = { x: 0, y: 0, z: 0 }): { source: Vec3; target: Vec3 } {
    const z = CAMERA_ZOOM[this.zoom];
    const a = this.angle;
    const h = heading + Math.PI;
    return {
      source: { x: pos.x + Math.sin(a) * z.distance, y: pos.y + z.sourceY, z: pos.z + Math.cos(a) * z.distance },
      target: {
        x: pos.x + move.x * TARGET_LEAD + Math.sin(h) * z.targetZ,
        y: pos.y + z.targetY,
        z: pos.z + move.z * TARGET_LEAD + Math.cos(h) * z.targetZ,
      },
    };
  }

  // One game frame (30 per second).
  tick(pos: Vec3, heading: number, world: CameraWorld | null = null): void {
    // The points are never changed in place, only replaced: keep the old ones.
    this.prevSource = this.source;
    this.prevTarget = this.target;
    const last = this.last ?? pos;
    this.last = { x: pos.x, y: pos.y, z: pos.z };
    const move = { x: pos.x - last.x, y: pos.y - last.y, z: pos.z - last.z };
    if (!this.source || !this.target || !this.safe) {
      const d = this.desired(pos, heading, move);
      this.source = d.source;
      this.target = d.target;
      this.safe = { ...d.source };
      return;
    }
    const src = this.source;
    const tgt = this.target;

    // UpdateCameraTargetWithCollision_004d88e8.
    let lerpSource = LERP_SOURCE;
    const far = (tgt.x - src.x) ** 2 + (tgt.z - src.z) ** 2 >= FAR_SQ;
    let blocked = false;
    let nearWall = false;
    if (world && this.sightBlocked(world, pos, heading, move)) {
      blocked = true;
      nearWall = (src.x - pos.x) ** 2 + (src.z - pos.z) ** 2 <= NEAR_WALL_SQ;
    }

    // ProcessCameraChaseState_004d7a1c.
    const moving = move.x * move.x + move.y * move.y + move.z * move.z >= CHASE_MOVE_SQ;
    const goal = heading + Math.PI;
    if (this.chase === 0) {
      if (moving) this.chase = 1;
    } else {
      if (!blocked) this.angle = smoothAngle(this.angle, goal, far ? CHASE_STEP_FAR : CHASE_STEP);
      else if (!nearWall) this.angle = wrap(goal);
      else {
        lerpSource = LERP_SOURCE_NEAR_WALL;
        this.angle = smoothAngle(this.angle, goal, CHASE_STEP_NEAR_WALL);
      }
      if (!moving) this.chase = 0;
    }

    // The controller.
    const want = this.desired(pos, heading, move);
    if (world) {
      const hit = world.segmentHit(arr(this.safe), arr(want.source), CAMERA_WALL_MASK);
      if (hit) {
        const dx = want.source.x - this.safe.x, dy = want.source.y - this.safe.y, dz = want.source.z - this.safe.z;
        const l = len3(dx, dy, dz) || 1;
        this.safe = { x: hit.point[0] - dx / l, y: hit.point[1] - dy / l, z: hit.point[2] - dz / l };
        this.wallHit = true;
      } else {
        this.safe = { ...src };
        this.wallHit = false;
      }
    }
    this.source = lerpPoint(src, want.source, lerpSource);
    this.target = lerpPoint(tgt, want.target, LERP_TARGET);
    if (world && this.wallHit) {
      const hit = world.segmentHit(arr(this.target), arr(this.source), CAMERA_WALL_MASK);
      if (hit) {
        this.source = { x: hit.point[0], y: hit.point[1], z: hit.point[2] };
        this.safe = { x: hit.point[0] + hit.normal[0], y: hit.point[1] + hit.normal[1], z: hit.point[2] + hit.normal[2] };
      }
    }
  }

  // CalculateCameraTargetWithCollision_004d235c: is there a 0x100 wall
  // between the camera and the probe behind the player?
  private sightBlocked(world: CameraWorld, pos: Vec3, heading: number, move: Vec3): boolean {
    const src = this.source!;
    const tgt = this.target!;
    const moved = len3(move.x, move.y, move.z);
    let l = moved * PROBE_SCALE;
    if (moved < PROBE_MIN_MOVE) {
      // Horizontal facings of the camera (y_rotation, from its source toward
      // its target; ASSUMED) and of the player.
      const fx = tgt.x - src.x, fz = tgt.z - src.z;
      const fl = Math.hypot(fx, fz) || 1;
      const dot = (fx / fl) * Math.sin(heading) + (fz / fl) * Math.cos(heading);
      if (Math.abs(dot) > PROBE_AXIS_DOT) l = 0;
    }
    let dx = src.x - tgt.x, dy = src.y - tgt.y, dz = src.z - tgt.z;
    const dl = len3(dx, dy, dz);
    if (dl !== 0) {
      dx /= dl;
      dy /= dl;
      dz /= dl;
    }
    const probe: V3 = [pos.x + dx * l, tgt.y, pos.z + dz * l];
    return world.segmentHit(arr(src), probe, CAMERA_SIGHT_MASK) !== null;
  }

  // Where the camera is and what it looks at: the controller's current
  // points, or the desired ones before the first frame.
  // `alpha` (render/smoothrender.ts): the fraction of a tick since the last
  // one; below 1 the points are drawn that far from the previous tick's.
  view(pos: Vec3, heading: number, alpha = 1): { source: Vec3; target: Vec3 } {
    if (this.source && this.target) {
      const ps = this.prevSource, pt = this.prevTarget;
      if (alpha >= 1 || !ps || !pt) return { source: this.source, target: this.target };
      const d = this.drawn;
      lerpInto(d.source, ps, this.source, alpha);
      lerpInto(d.target, pt, this.target, alpha);
      return d;
    }
    return this.desired(pos, heading);
  }
}
