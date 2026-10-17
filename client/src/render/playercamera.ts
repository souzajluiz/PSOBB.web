// The player camera of PsoBB.exe (Ephinea 1.25.13): the "unknown player
// camera" the client creates for the local player (CreateUnknownPlayerCamera
// _004d7e70, update UpdateUnknownPlayerCamera_004d7698).
//
// Zoom: five levels, camera_zoom_level (0x009acedc, 1 at start) clamped to
// 0..4 by set_camera_zoom_level; the mouse wheel steps it
// (adjust_camera_for_boss_maps_and_handle_zoom: wheel button 0x20000 ->
// increment_camera_zoom_level, 0x10000 -> decrement). Each level of
// camera_zoom_level_ARRAY_009ace60 is {x, source y, follow distance, x,
// target y, target z}.
//
// Source: update_desired_camera_source_based_on_zoom_levels turns (x,
// source y, follow distance) by the camera angle and adds the player's
// position. Target: update_desired_camera_target turns (x, target y, target
// z) by the player's heading + 0x8000 and adds the player's position (plus
// 18.0 (0x00909750) times the player's last move, which this module leaves
// out together with the client's source / target lerp, unknown_vec3_lerp).
//
// Angle: set behind the player (heading + 0x8000) when the camera starts and
// when the Camera key is pressed. While the player moves at least 0.5 units
// per frame (0x00909798 = 0.25, squared) ProcessCameraChaseState_004d7a1c
// turns it toward heading + 0x8000 by at most 5 * 127 BAMS per frame
// (SmoothCameraAngle_004d6370, speed 5), snapping once it is closer than
// that; a standing player leaves it where it is.

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
export const CHASE_STEP = 5 * 0x7f * BAMS; // radians per frame
export const CHASE_MOVE_SQ = 0.25; // 0x00909798

type Vec3 = { x: number; y: number; z: number };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class PlayerCamera {
  zoom = DEFAULT_ZOOM;
  // Camera angle (radians, the three.js Y angle of the camera's offset from
  // the player): heading + PI is straight behind.
  angle = Math.PI;
  private last: Vec3 | null = null;

  // Straight behind the player (camera start, Camera key, warps).
  reset(heading: number): void {
    this.angle = wrap(heading + Math.PI);
  }

  // Mouse wheel: +1 farther, -1 closer.
  step(delta: number): void {
    this.zoom = Math.min(CAMERA_ZOOM.length - 1, Math.max(0, this.zoom + delta));
  }

  // One game frame (30 per second).
  tick(pos: Vec3, heading: number): void {
    const last = this.last;
    this.last = { x: pos.x, y: pos.y, z: pos.z };
    if (!last) return;
    const moved = (pos.x - last.x) ** 2 + (pos.y - last.y) ** 2 + (pos.z - last.z) ** 2;
    if (moved < CHASE_MOVE_SQ) return;
    const target = heading + Math.PI;
    const diff = wrap(target - this.angle);
    this.angle = Math.abs(diff) < CHASE_STEP ? wrap(target) : wrap(this.angle + Math.sign(diff) * CHASE_STEP);
  }

  // Where the camera is and what it looks at.
  view(pos: Vec3, heading: number): { source: Vec3; target: Vec3 } {
    const z = CAMERA_ZOOM[this.zoom];
    const a = this.angle;
    const h = heading + Math.PI;
    return {
      source: { x: pos.x + Math.sin(a) * z.distance, y: pos.y + z.sourceY, z: pos.z + Math.cos(a) * z.distance },
      target: { x: pos.x + Math.sin(h) * z.targetZ, y: pos.y + z.targetY, z: pos.z + Math.cos(h) * z.targetZ },
    };
  }
}
