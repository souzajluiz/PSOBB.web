// Smooth rendering between game ticks (GitHub issue #5, "PSOBB in 60FPS").
//
// A browser convenience, not PsoBB.exe behaviour: the game logic still runs
// at 30 ticks a second (GAME_TICKS_PER_SECOND, render/playeranim.ts) exactly
// as before; only what is drawn changes. An object the logic moves on a tick
// (an enemy, a shot, an NPC, a trap part) keeps the pose it had before the
// last tick and the pose after it, and each display frame draws it at the
// fraction of a tick that has passed since (the tick clock's remainder),
// with a shortest-arc lerp for the angles. At 30 Hz this is the original
// look delayed by up to a tick; at 60 / 120 / 144 Hz the steps are gone.
//
// The logic never sees an interpolated value: TickSmoother does not touch
// position / rotation. Before the draw it writes the interpolated pose into
// the object's local matrix and turns matrixAutoUpdate off; right after the
// draw (MapViewer.frame) restore() turns it back on and rebuilds the world
// matrices from the logic pose, so code that reads matrixWorld between
// frames (the De Rol Le node captures, render/combat.ts tickDeRolLe) sees
// what it saw before.
//
// Snaps (prev = current, no slide): an object seen for the first time, one
// that was hidden, one that moved without a tick (warps, 6x24 /
// placePlayer, network snaps), one whose snap serial changed (a brain's
// `warps` counter: De Rol Le's corner teleports, the Pan Arms burrowing
// back to its spawn point, a split's halves appearing, a slime's return),
// an explicit snap(), and any one-tick move longer than SNAP_DISTANCE.
//
// ?fps=30 turns all of it off (the original's look at any refresh rate).

import * as THREE from 'three';

// A one-tick move this long is a teleport, not a step (a running enemy
// covers a few units a tick).
export const SNAP_DISTANCE = 100;

const TAU = Math.PI * 2;

// The angle from `a` to `b` the short way round, in [-PI, PI).
export function shortestArc(a: number, b: number): number {
  const d = (b - a) % TAU;
  if (d >= Math.PI) return d - TAU;
  if (d < -Math.PI) return d + TAU;
  return d;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// `a` turned toward `b` by the fraction `t` of the short way round.
export function lerpAngle(a: number, b: number, t: number): number {
  return a + shortestArc(a, b) * t;
}

// `?fps=30` (any page, like ?touch / ?sound): draw only what the ticks
// produce, as the exe does.
export function smoothingFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get('fps') !== '30';
  } catch {
    return true;
  }
}

export const SMOOTH_RENDER = smoothingFromSearch(globalThis.location?.search ?? '');

// Counts the ticks of one game-tick accumulator and keeps its remainder (the
// fraction of the next tick that has passed). The owner calls advance()
// right after its tick loop; nothing else in the logic reads it.
export class TickClock {
  count = 0;
  alpha = 0;

  advance(ticks: number, remainder: number): void {
    this.count += ticks;
    this.alpha = Math.min(1, Math.max(0, remainder));
  }
}

// A pose: position and Euler angles (radians).
export interface Pose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

export const newPose = (): Pose => ({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 });

export function copyPose(to: Pose, from: Pose): Pose {
  to.px = from.px;
  to.py = from.py;
  to.pz = from.pz;
  to.rx = from.rx;
  to.ry = from.ry;
  to.rz = from.rz;
  return to;
}

export function samePose(a: Pose, b: Pose): boolean {
  return a.px === b.px && a.py === b.py && a.pz === b.pz && a.rx === b.rx && a.ry === b.ry && a.rz === b.rz;
}

// The pose a fraction `t` of the way from `prev` to `cur` (into `out`).
export function interpolatePose(prev: Pose, cur: Pose, t: number, out: Pose): Pose {
  out.px = lerp(prev.px, cur.px, t);
  out.py = lerp(prev.py, cur.py, t);
  out.pz = lerp(prev.pz, cur.pz, t);
  out.rx = lerpAngle(prev.rx, cur.rx, t);
  out.ry = lerpAngle(prev.ry, cur.ry, t);
  out.rz = lerpAngle(prev.rz, cur.rz, t);
  return out;
}

// What the smoother remembers of one object.
export interface SmoothTrack {
  prev: Pose;
  cur: Pose;
  tick: number; // the clock count when last observed
  shown: boolean;
  serial: number;
  snap: boolean; // snap on the next observation
}

export const newTrack = (): SmoothTrack => ({ prev: newPose(), cur: newPose(), tick: -1, shown: false, serial: 0, snap: true });

// One observation of a tracked object at draw time (pure; `logic` is its
// pose as the logic left it). After it, `track.prev` -> `track.cur` is the
// span to draw at the clock's alpha.
export function observe(track: SmoothTrack, logic: Pose, clockCount: number, shown: boolean, serial: number): void {
  const ticked = track.tick !== clockCount;
  let snap = track.snap || !shown || !track.shown || serial !== track.serial;
  if (!snap && !ticked && !samePose(track.cur, logic)) snap = true; // moved outside a tick
  if (snap) {
    copyPose(track.prev, logic);
    copyPose(track.cur, logic);
  } else if (ticked) {
    copyPose(track.prev, track.cur);
    copyPose(track.cur, logic);
    const p = track.prev;
    if (Math.hypot(logic.px - p.px, logic.py - p.py, logic.pz - p.pz) > SNAP_DISTANCE) copyPose(track.prev, logic);
  }
  track.tick = clockCount;
  track.shown = shown;
  track.serial = serial;
  track.snap = false;
}

function readPose(o: THREE.Object3D, out: Pose): Pose {
  out.px = o.position.x;
  out.py = o.position.y;
  out.pz = o.position.z;
  out.rx = o.rotation.x;
  out.ry = o.rotation.y;
  out.rz = o.rotation.z;
  return out;
}

// Drawn when the object and at least one of its children (a hidden enemy
// hides its children: render/combat.ts r.hidden) are visible.
function isShown(o: THREE.Object3D): boolean {
  if (!o.visible) return false;
  const kids = o.children;
  if (kids.length === 0) return true;
  for (let i = 0; i < kids.length; i++) if (kids[i].visible) return true;
  return false;
}

export class TickSmoother {
  enabled: boolean;
  private tracks = new WeakMap<THREE.Object3D, SmoothTrack>();
  // Objects drawn with an interpolated matrix this frame (restore()).
  private overridden: THREE.Object3D[] = [];
  private overriddenCount = 0;
  private logic = newPose();
  private drawn = newPose();
  private euler = new THREE.Euler();
  private quat = new THREE.Quaternion();
  private pos = new THREE.Vector3();

  constructor(enabled = SMOOTH_RENDER) {
    this.enabled = enabled;
  }

  // The next observation of `o` snaps (a teleport the caller knows about).
  snap(o: THREE.Object3D): void {
    const t = this.tracks.get(o);
    if (t) t.snap = true;
  }

  // Call before the draw for each object the clock's ticks move. `serial`:
  // a counter the logic bumps on a teleport (a change snaps).
  track(o: THREE.Object3D, clock: TickClock, serial = 0): void {
    if (!this.enabled || !o.matrixAutoUpdate) return;
    let t = this.tracks.get(o);
    if (!t) this.tracks.set(o, (t = newTrack()));
    const logic = readPose(o, this.logic);
    observe(t, logic, clock.count, isShown(o), serial);
    if (samePose(t.prev, t.cur)) return;
    const d = interpolatePose(t.prev, t.cur, clock.alpha, this.drawn);
    this.euler.set(d.rx, d.ry, d.rz, o.rotation.order);
    this.quat.setFromEuler(this.euler);
    this.pos.set(d.px, d.py, d.pz);
    o.matrix.compose(this.pos, this.quat, o.scale);
    o.matrixAutoUpdate = false;
    o.matrixWorldNeedsUpdate = true;
    this.overridden[this.overriddenCount++] = o;
  }

  // Where `o` is drawn this frame (its logic position when not smoothed).
  drawnPosition(o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    const t = this.enabled ? this.tracks.get(o) : undefined;
    if (!t || o.matrixAutoUpdate) return out.copy(o.position);
    return out.setFromMatrixPosition(o.matrix);
  }

  // Call right after the draw: the logic poses again.
  restore(): void {
    for (let i = 0; i < this.overriddenCount; i++) {
      const o = this.overridden[i];
      this.overridden[i] = undefined as unknown as THREE.Object3D;
      o.matrixAutoUpdate = true;
      o.updateMatrixWorld(true);
    }
    this.overriddenCount = 0;
  }
}
