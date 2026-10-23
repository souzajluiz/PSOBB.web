// The field camera while walking (Pioneer 2, party floor 0). The desktop client holds W, then A, then
// D for PSO_HOLD_MS each (a real key press, polled once per frame) and records every animation frame:
// the local player's head point projected through the view camera (normalized screen x / y), the
// body heading against the camera's "away" direction (camera yaw + PI), and the travel direction of
// the drawn pose against the heading. The exe keeps a forward run centred on screen and the body
// facing away from the camera (the camera chases the heading, the move is camera-relative:
// unknown_handle_gamepad_input_move, PsoBB.exe dump line 587209). The numbers are printed for the
// before / after comparison; the checks only bound the forward run.
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). PW_BASE_URL points at a Vite on its own port.
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const HOLD_MS = Number(process.env.PSO_HOLD_MS ?? 2000);
const SETTLE_MS = 1200; // the stand after a release: the camera settles behind the player
const WARM_MS = 400; // skip the first frames of a hold (the leg's start and the chase's first step)

type Frame = { t: number; phase: string; x: number; z: number; a: number; ca: number; sx: number; sy: number; st: string };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)]!;
};
const pct = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, q2) => p - q2);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const round = (x: number) => Math.round(x * 1000) / 1000;

// Records one sample per animation frame while `on`: the self marker's drawn pose, the body heading,
// the camera yaw (LobbyView.camera.angle), the mover state and the head point on screen.
async function startSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__cam = { on: false, phase: 'idle', rec: [] as any[] };
    // Projects a world point through the three.js camera (column-major matrices), to normalized screen coords.
    const project = (cam: any, x: number, y: number, z: number) => {
      const v = cam.matrixWorldInverse.elements;
      const p = cam.projectionMatrix.elements;
      const ex = v[0] * x + v[4] * y + v[8] * z + v[12];
      const ey = v[1] * x + v[5] * y + v[9] * z + v[13];
      const ez = v[2] * x + v[6] * y + v[10] * z + v[14];
      const ew = v[3] * x + v[7] * y + v[11] * z + v[15];
      const cx = p[0] * ex + p[4] * ey + p[8] * ez + p[12] * ew;
      const cy = p[1] * ex + p[5] * ey + p[9] * ez + p[13] * ew;
      const cw = p[3] * ex + p[7] * ey + p[11] * ez + p[15] * ew;
      return { x: (cx / cw + 1) / 2, y: (1 - cy / cw) / 2 };
    };
    const loop = (now: number) => {
      const s = w.__cam;
      const gv = w.classicGame?.view;
      const lv = gv?.view;
      if (s.on && lv && gv) {
        const m = lv.markers?.get(gv.game.selfId);
        const cam = lv.viewer?.camera;
        if (m && cam) {
          const p = m.group.position;
          const head = project(cam, p.x, p.y + 10, p.z);
          s.rec.push({ t: now, phase: s.phase, x: p.x, z: p.z, a: m.angle, ca: lv.camera.angle, sx: head.x, sy: head.y, st: lv.mover.state });
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function summarise(frames: Frame[], phase: string): Promise<Record<string, number>> {
  const rs = frames.filter((f) => f.phase === phase);
  if (!rs.length) return {};
  const t0 = rs[0]!.t;
  const held = rs.filter((f) => f.t - t0 >= WARM_MS);
  const dx = held.map((f) => f.sx - 0.5);
  const dy = held.map((f) => f.sy - 0.5);
  // The body against "away from the camera" (camera yaw + PI), per frame.
  const facing = held.map((f) => Math.abs(wrap(f.a - (f.ca + Math.PI))));
  // The camera's yaw against the same away direction: its lag behind the heading.
  const camLag = held.map((f) => Math.abs(wrap(f.ca - (f.a + Math.PI))));
  // The travel direction of the drawn pose (frame to frame) against the body heading, while moving.
  const travel: number[] = [];
  for (let i = 1; i < held.length; i++) {
    const p = held[i - 1]!;
    const q = held[i]!;
    const dist = Math.hypot(q.x - p.x, q.z - p.z);
    if (dist < 0.02) continue;
    const dir = Math.atan2(q.x - p.x, q.z - p.z);
    travel.push(Math.abs(wrap(dir - q.a)));
  }
  return {
    frames: held.length,
    screenXMedian: round(median(dx.map(Math.abs))),
    screenXP95: round(pct(dx.map(Math.abs), 0.95)),
    screenYMedian: round(median(dy.map(Math.abs))),
    facingAwayMedian: round(median(facing)),
    facingAwayP95: round(pct(facing, 0.95)),
    cameraLagMedian: round(median(camLag)),
    cameraLagP95: round(pct(camLag, 0.95)),
    travelVsFacingMedian: round(median(travel)),
    travelVsFacingP95: round(pct(travel, 0.95)),
    sxJitterP95: round(pct(held.slice(1).map((f, i) => Math.abs(f.sx - held[i]!.sx)), 0.95)),
    caJitterP95: round(pct(held.slice(1).map((f, i) => Math.abs(wrap(f.ca - held[i]!.ca))), 0.95)),
    distance: round(Math.hypot(rs[rs.length - 1]!.x - rs[0]!.x, rs[rs.length - 1]!.z - rs[0]!.z)),
  };
}

test('holding W, A and D: the player stays near the centre and the body faces where the camera looks', async ({ page }) => {
  test.setTimeout(240_000);
  const logs = consoleLog(page);
  await test.step('a fresh account in a party field (Pioneer 2)', () => enterFreshField(page, logs, { prefix: 'wcam' }));
  await expect.poll(() => peek(page, (w) => w.classicGame?.view?.current?.floor), { timeout: 30_000 }).toBe(0);
  await page.waitForTimeout(1500); // the arrival's camera and the first frames settle

  await startSampler(page);
  const phases = ['w', 'a', 'd'];
  await page.evaluate(() => ((window as any).__cam.on = true));
  for (const k of phases) {
    await page.evaluate((ph) => ((window as any).__cam.phase = ph), k);
    await page.keyboard.down(k);
    await page.waitForTimeout(HOLD_MS);
    await page.keyboard.up(k);
    await page.evaluate(() => ((window as any).__cam.phase = 'settle'));
    await page.waitForTimeout(SETTLE_MS);
  }
  await page.evaluate(() => ((window as any).__cam.on = false));
  const frames: Frame[] = await page.evaluate(() => (window as any).__cam.rec);

  const report: Record<string, Record<string, number>> = {};
  for (const k of phases) report[k] = await summarise(frames, k);
  console.log('CAMERA_WALK ' + JSON.stringify(report));
  if (process.env.PSO_DUMP) for (const f of frames.filter((r) => r.phase === process.env.PSO_DUMP).filter((_, i) => i % 6 === 0)) console.log('FRAME ' + JSON.stringify({ x: round(f.x), z: round(f.z), a: round(f.a), ca: round(f.ca), st: f.st, sx: round(f.sx) }));

  // The forward run: centred on screen (the body faces away from the camera, the camera follows).
  const w = report.w!;
  expect(w.frames, 'forward frames were recorded').toBeGreaterThan(20);
  expect(w.distance, 'W moved the player').toBeGreaterThan(5);
  expect(w.screenXMedian, 'W: the player stays near the centre (horizontal)').toBeLessThan(0.15);
  expect(w.facingAwayMedian, 'W: the body faces away from the camera').toBeLessThan(0.15);
});
