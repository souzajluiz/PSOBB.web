// The player camera (render/playercamera.ts) and the default key config
// (input/keyconfig.ts), checked against PsoBB.exe's tables and newserv's
// system/blueburst/default-keyboard-config.bin.
// Run: node tests/controls.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAMERA_SIGHT_MASK,
  CAMERA_WALL_MASK,
  CAMERA_ZOOM,
  CHASE_STEP,
  CHASE_STEP_FAR,
  DEFAULT_ZOOM,
  lerpPoint,
  ORBIT_DEADZONE,
  LERP_SOURCE,
  LERP_TARGET,
  PlayerCamera,
  TARGET_LEAD,
  type CameraWorld,
} from '../client/src/render/playercamera.ts';
import { KEYS, PALETTE_KEYS } from '../client/src/input/keyconfig.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, what: string) => check(Math.abs(a - b) < 1e-6, `${what}: ${a} != ${b}`);

// --- zoom (camera_zoom_level_ARRAY_009ace60, camera_zoom_level 0x009acedc) ---
check(CAMERA_ZOOM.length === 5 && DEFAULT_ZOOM === 1, 'five zoom levels, level 1 at start');
check(CAMERA_ZOOM[4].distance === 70 && CAMERA_ZOOM[4].sourceY === 30, 'farthest level: 70 behind, 30 up');
{
  const c = new PlayerCamera();
  for (let i = 0; i < 10; i++) c.step(1);
  check(c.zoom === 4, 'zoom out stops at level 4');
  for (let i = 0; i < 10; i++) c.step(-1);
  check(c.zoom === 0, 'zoom in stops at level 0');
}

// --- desired source / target ---
{
  const c = new PlayerCamera();
  c.reset(0); // facing +Z: camera straight behind, at -Z
  const v = c.view({ x: 0, y: 0, z: 0 }, 0);
  near(v.source.x, 0, 'behind: x');
  near(v.source.z, -CAMERA_ZOOM[1].distance, 'behind: z = -distance');
  near(v.source.y, CAMERA_ZOOM[1].sourceY, 'source height');
  near(v.target.z, 5, 'target 5 in front of the player');
  near(v.target.y, CAMERA_ZOOM[1].targetY, 'target height');
  // update_desired_camera_target: + 18 x the last move.
  const d = c.desired({ x: 0, y: 0, z: 0 }, 0, { x: 1, y: 0, z: 2 });
  near(d.target.x, TARGET_LEAD, 'target leads by 18 x the move (x)');
  near(d.target.z, 5 + 2 * TARGET_LEAD, 'target leads by 18 x the move (z)');
}

// --- smoothing (unknown_vec3_lerp) ---
{
  // 0.16 x distance x factor per frame.
  const p = lerpPoint({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, LERP_SOURCE);
  near(p.x, Math.fround(0.16) * 10 * LERP_SOURCE, 'source moves 0.16 x 0.67 of the way');
  const q = lerpPoint({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, LERP_TARGET);
  near(q.x, Math.fround(0.16) * 10 * LERP_TARGET, 'target moves 0.16 x 0.289 of the way');
  // A step of 5 or more becomes 12.
  const far = lerpPoint({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, LERP_SOURCE);
  near(far.x, 12, 'a step of 5 or more is 12');
  const c = new PlayerCamera();
  c.reset(0);
  c.tick({ x: 0, y: 0, z: 0 }, 0); // first frame: shown at once
  near(c.source!.z, -CAMERA_ZOOM[1].distance, 'first frame snaps to the desired source');
  c.tick({ x: 0, y: 0, z: 3 }, 0); // the player runs 3 forward
  const want = c.desired({ x: 0, y: 0, z: 3 }, 0, { x: 0, y: 0, z: 3 });
  near(c.source!.z, -CAMERA_ZOOM[1].distance + 3 * Math.fround(0.16) * LERP_SOURCE, 'source eases after the player');
  check(c.target!.z < want.target.z && c.target!.z > 5, 'target eases toward the lead');
}

// --- chase (ProcessCameraChaseState_004d7a1c, SmoothCameraAngle_004d6370) ---
{
  const c = new PlayerCamera();
  c.reset(0);
  c.zoom = 0; // keep the camera within 23 of its target: speed 5
  const heading = Math.PI / 2; // the player turned to +X
  const near5 = (x: number) => c.tick({ x, y: 0, z: 0 }, heading);
  near5(0);
  near5(0.2); // 0.04 < 0.25: standing
  near(c.angle, Math.PI, 'a player moving less than 0.5 per frame does not turn the camera');
  near5(3);
  near(c.angle, Math.PI, 'the first moving frame only starts the chase (state 0 -> 1)');
  check(c.chase === 1, 'chase state 1');
  near5(6);
  // Source 25 behind, target 5 in front + the lead: 23 or more apart in XZ,
  // so the step is 2 x 127 BAMS.
  near(c.angle, Math.PI + CHASE_STEP_FAR - Math.PI * 2, 'one step of 2 * 127 BAMS while the camera is 23+ from its target');
  let x = 6;
  for (let i = 0; i < 120; i++) near5((x += 3));
  near(c.angle, -Math.PI / 2, 'ends straight behind the running player');
  near5(x);
  check(c.chase === 0, 'standing still drops back to state 0');
  check(CHASE_STEP === 5 * 0x7f * (Math.PI * 2) / 0x10000, 'speed 5 step');
}

// --- wall checks (CalculateCameraTargetWithCollision_004d235c, the controller) ---
{
  // A wall plane z = -10 between the player (z = 0) and a camera behind it.
  const rays: number[] = [];
  const world: CameraWorld = {
    segmentHit(from, to, mask) {
      rays.push(mask);
      if ((from[2] + 10) * (to[2] + 10) >= 0) return null;
      const t = (from[2] + 10) / (from[2] - to[2]);
      return { point: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, -10], normal: [0, 0, 1] }; // faces the player's side
    },
  };
  const c = new PlayerCamera();
  c.reset(0);
  // Source at 40 - 45.42 = -5.42, in front of the wall; the player steps back
  // to 30 so the desired source (-15.42) is behind it.
  c.tick({ x: 0, y: 0, z: 40 }, 0, world);
  c.tick({ x: 0, y: 0, z: 30 }, 0, world);
  check(rays.includes(CAMERA_SIGHT_MASK) && rays.includes(CAMERA_WALL_MASK), 'sight ray (0x100) and source rays (0x901)');
  check(c.source!.z > -10, 'the source eases toward the wall');
  for (let i = 0; i < 60; i++) c.tick({ x: 0, y: 0, z: 30 }, 0, world);
  near(c.source!.z, -10, 'the source stops on the wall it would cross');
  // Blocked sight while chasing snaps the angle behind the player.
  const s = new PlayerCamera();
  s.reset(0);
  s.angle = Math.PI / 2; // looking from +X
  const wall: CameraWorld = { segmentHit: (_f, _t, mask) => (mask === CAMERA_SIGHT_MASK ? { point: [0, 0, 0], normal: [1, 0, 0] } : null) };
  s.tick({ x: 0, y: 0, z: 0 }, 0, wall);
  s.tick({ x: 0, y: 0, z: 3 }, 0, wall);
  s.tick({ x: 0, y: 0, z: 6 }, 0, wall);
  near(s.angle, Math.PI, 'a wall in the way snaps the camera behind the chasing player');
}

// --- keys (newserv's default BB keyboard config) ---
// pso_keycode (named dump): a..z = 0x10.., arrows 0x5C..0x5F, enter 0x61, ...
const CODE_KEY: Record<number, string> = { 6: 'home', 7: 'end', 0x50: 'backspace', 0x59: ' ', 0x5c: 'arrowleft', 0x5d: 'arrowdown', 0x5e: 'arrowup', 0x5f: 'arrowright', 0x61: 'enter', 0x56: 'control' };
for (let i = 0; i < 26; i++) CODE_KEY[0x10 + i] = String.fromCharCode(97 + i);
const file = join(import.meta.dirname, '../vendor/newserv/system/blueburst/default-keyboard-config.bin');
if (existsSync(file)) {
  const raw = new Uint8Array(readFileSync(file));
  const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const key = (i: number) => CODE_KEY[d.getUint32(i * 8 + 4, true)];
  const order: Array<[number, string]> = [
    [0, KEYS.moveForward], [1, KEYS.moveBackward], [2, KEYS.moveLeft], [3, KEYS.moveRight],
    [6, KEYS.decide], [7, KEYS.cancel], [8, KEYS.menu], [9, KEYS.chat],
    [10, KEYS.selectUp], [11, KEYS.selectDown], [12, KEYS.selectLeft], [13, KEYS.selectRight], [14, KEYS.symbolChat],
    [15, KEYS.paletteMiddle], [16, KEYS.paletteLeft], [17, KEYS.paletteRight], [18, KEYS.paletteChange], [19, KEYS.camera],
  ];
  for (const [i, k] of order) check(key(i) === k, `binding ${i}: ${key(i)} != ${k}`);
} else {
  console.log('(no vendor/newserv; skipping the key config file check)');
}
check(PALETTE_KEYS.map(([k, s]) => `${k}:${s}`).join(' ') === 'arrowleft:1 arrowdown:0 arrowright:2', 'palette keys -> palette_slots');

// --- dead camera (UpdateDefaultNPCCameraRotation_004d7c04; dead flag 0x800) ---
{
  const BAMS = (Math.PI * 2) / 0x10000;
  near(ORBIT_DEADZONE, 0.2, 'orbit deadzone 0.2 (0x00909788)');
  const orbitOnce = (amount: number, lr: number) => {
    const c = new PlayerCamera();
    c.angle = 0;
    c.orbit(amount, lr);
    return c.angle;
  };
  near(orbitOnce(1, 127), 364 * BAMS, 'full stick right: 2.5 -> 2 degrees -> 364 BAMS');
  near(orbitOnce(0.5, 1), 182 * BAMS, 'amount 0.5: 1.25 -> 1 degree -> 182 BAMS');
  near(orbitOnce(0.4, 1), 182 * BAMS, 'amount 0.4: 1.0 -> 1 degree (fround)');
  check(orbitOnce(0.3, 1) === 0, 'amount 0.3: 0.75 truncates to 0 degrees, no turn');
  check(orbitOnce(0.2, 1) === 0 && orbitOnce(0.1, 1) === 0, 'amount at or under the 0.2 deadzone: no turn');
  near(orbitOnce(1, 0), -364 * BAMS, 'left-right 0 or less turns the other way (the exe test is < 1)');
  near(orbitOnce(1, -100), -364 * BAMS, 'stick left turns the camera left');

  // Dead: a running player's camera does not chase; the stick turns it.
  const c = new PlayerCamera();
  c.reset(0);
  c.zoom = 0;
  const heading = Math.PI / 2; // the player faces +X
  let x = 0;
  const deadTick = (stick?: { amount: number; lr: number }) => c.tick({ x, y: 0, z: 0 }, heading, null, { dead: true, stick });
  deadTick();
  for (let i = 0; i < 60; i++) {
    x += 3;
    deadTick();
  }
  check(c.chase === 0, 'dead: the chase state stays 0 while the player runs');
  near(c.angle, Math.PI, 'dead: the camera does not follow the heading (alive it turns to -PI/2)');
  deadTick({ amount: 1, lr: 127 });
  const turned = Math.PI + 364 * BAMS; // wrapped to (-PI, PI] by the camera
  near(c.angle, Math.atan2(Math.sin(turned), Math.cos(turned)), 'dead: the stick turns the camera one step per tick');
  const before = c.angle;
  deadTick();
  near(c.angle, before, 'dead: no stick, no turn');
  check(Number.isFinite(c.source!.x) && Number.isFinite(c.target!.z), 'dead: the controller still places the camera');

  // Revived / back in town: the flag is off and the chase starts on the next moving frame.
  c.tick({ x: (x += 3), y: 0, z: 0 }, heading, null, { dead: false });
  check(c.chase === 1, 'alive again: a moving player starts the chase');
}

console.log(failures ? `${failures} failures` : 'camera and controls: all checks passed');
process.exit(failures ? 1 : 0);
