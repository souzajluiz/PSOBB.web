// The player camera (render/playercamera.ts) and the default key config
// (input/keyconfig.ts), checked against PsoBB.exe's tables and newserv's
// system/blueburst/default-keyboard-config.bin.
// Run: node tests/controls.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMERA_ZOOM, CHASE_STEP, DEFAULT_ZOOM, PlayerCamera } from '../client/src/render/playercamera.ts';
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

// --- source / target ---
{
  const c = new PlayerCamera();
  c.reset(0); // facing +Z: camera straight behind, at -Z
  const v = c.view({ x: 0, y: 0, z: 0 }, 0);
  near(v.source.x, 0, 'behind: x');
  near(v.source.z, -CAMERA_ZOOM[1].distance, 'behind: z = -distance');
  near(v.source.y, CAMERA_ZOOM[1].sourceY, 'source height');
  near(v.target.z, 5, 'target 5 in front of the player');
  near(v.target.y, CAMERA_ZOOM[1].targetY, 'target height');
}

// --- chase (ProcessCameraChaseState_004d7a1c, SmoothCameraAngle_004d6370) ---
{
  const c = new PlayerCamera();
  c.reset(0);
  const heading = Math.PI / 2; // the player turned to +X
  c.tick({ x: 0, y: 0, z: 0 }, heading);
  c.tick({ x: 0.2, y: 0, z: 0 }, heading); // 0.04 < 0.25: standing
  near(c.angle, Math.PI, 'a player moving less than 0.5 per frame does not turn the camera');
  c.tick({ x: 3, y: 0, z: 0 }, heading);
  near(c.angle, Math.PI + CHASE_STEP - Math.PI * 2, 'one step of 5 * 127 BAMS toward the back');
  for (let i = 0, x = 3; i < 40; i++) c.tick({ x: (x += 3), y: 0, z: 0 }, heading);
  near(c.angle, -Math.PI / 2, 'ends straight behind the running player');
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

console.log(failures ? `${failures} failures` : 'camera and controls: all checks passed');
process.exit(failures ? 1 : 0);
