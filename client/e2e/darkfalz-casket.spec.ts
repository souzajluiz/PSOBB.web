// Dark Falz's casket trigger in Chrome (exe 0x0044d490; combat/darkfalz.ts leadScene waitCasket):
// one classic client creates a party, warps to the Dark Falz arena (floor 14), and stands on the
// casket point (-9860, -240). The brain must go WAIT_CASKET (scene 1) -> DEMO_WARP0 (scene 2), the
// boss camera (combat.bossCameraView, render/gamefield.ts opts.bossCamera) must drive the field
// camera for the whole of DEMO_WARP0, the scene must end (scene 2 -> another scene) with the
// frames still advancing (no hang), and the page must log no error and no request may fail.
// Screenshots go to the test's output folder (client/test-results, not committed).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';
const CASKET = { x: -9860, z: -240 };

type V3 = { x: number; y: number; z: number };

test('Dark Falz casket: WAIT_CASKET -> DEMO_WARP0 drives the boss camera, the cutscene ends without a hang', async ({ page }, info) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const name = `dk${Date.now() % 100000}`;

  await logIn(page, USER, PASSWORD);
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown'); // Create a PARTY
  await key(page, 'Enter');
  await key(page, 'Enter'); // EPISODE 1
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
  await key(page, 'Enter'); // Party Name
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  const floor = () => peek(page, (w) => w.classicGame?.view?.debug().floor() as number);
  await page.evaluate(() => (window as any).classicGame.view.warpTo(14));
  await expect.poll(floor, { timeout: 90_000 }).toBe(14);

  // A rAF counter in the page: it must keep rising through the cutscene (a hang stops it).
  await page.evaluate(() => {
    const w = window as any;
    w.__falzTicks = 0;
    const tick = () => {
      w.__falzTicks++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Dark Falz's scene (1 = WAIT_CASKET, 2 = DEMO_WARP0; combat/darkfalzcommon.ts), the boss camera's
  // view, the field camera's position and the frame counter, read in one page call.
  const sample = () =>
    peek(page, (w) => {
      const v: any = w.classicGame.view;
      const c = v.combat;
      const b = c.bossCameraView?.() as null | { source: V3; target: V3; up: V3 };
      const e = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'DarkFalzAi') as any;
      const p = v.camera.position;
      return {
        scene: e ? (e.ai.scene as number) : -1,
        boss: b ? { source: b.source, target: b.target } : null,
        cam: { x: p.x, y: p.y, z: p.z },
        ticks: (w as any).__falzTicks as number,
        now: Date.now(),
      };
    });

  // Dark Falz is in the arena and waits in WAIT_CASKET; the camera is the player's (no boss view).
  await expect.poll(async () => (await sample()).scene, { timeout: 60_000 }).toBe(1);
  const before = await sample();
  expect(before.boss, 'no boss camera view in WAIT_CASKET').toBeNull();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath('falz-0-wait-casket.png') });

  // Stand the player on the casket point at the current floor height.
  const y = await peek(page, (w) => (w.classicGame.view as any).selfPose()?.y ?? null);
  expect(y).not.toBeNull();
  await page.evaluate(
    ({ h, x, z }) => {
      const g = (window as any).classicGame.view;
      g.placePlayer(g.game.selfId, x, h, z, 0);
    },
    { h: y as number, x: CASKET.x, z: CASKET.z },
  );
  console.log(`placed player at (${CASKET.x}, ${y}, ${CASKET.z})`);

  // Sample every 250 ms for up to 20 s: the scene sequence, the camera against the boss view, and
  // the largest gap between two samples (a hang would show as a long gap or a frozen counter).
  const log: string[] = [];
  let last = '';
  let sawWarp0 = false;
  let leftWarp0 = false;
  let cameraMatches = 0;
  let cameraMismatch: string[] = [];
  let maxDelta = 0;
  let maxGap = 0;
  let prev: Awaited<ReturnType<typeof sample>> | null = null;
  let shot = false;
  let ticksAtWarp0Start = -1;
  let ticksAtWarp0End = -1;
  const t0 = Date.now();
  for (let i = 0; i < 80; i++) {
    const s = await sample();
    if (prev) maxGap = Math.max(maxGap, s.now - prev.now);
    prev = s;
    const line = `scene=${s.scene} view=${s.boss ? 'live' : 'null'}`;
    if (line !== last) {
      log.push(`t=${((Date.now() - t0) / 1000).toFixed(2)}s ${line}`);
      last = line;
    }
    if (s.scene === 2) {
      if (!sawWarp0) ticksAtWarp0Start = s.ticks;
      sawWarp0 = true;
      ticksAtWarp0End = s.ticks;
      if (s.boss) {
        const d = Math.max(
          Math.abs(s.cam.x - s.boss.source.x),
          Math.abs(s.cam.y - s.boss.source.y),
          Math.abs(s.cam.z - s.boss.source.z),
        );
        // The camera is set in the render (rAF) from the view of that frame; the AI (30 Hz) may have
        // moved the view one tick since, so the page sample can differ by one tick of motion (~1.5 units seen).
        maxDelta = Math.max(maxDelta, d);
        if (d < 1e-3) cameraMatches++;
        else if (d > 5) cameraMismatch.push(`d=${d.toFixed(3)} cam=${JSON.stringify(s.cam)} boss=${JSON.stringify(s.boss.source)}`);
      }
      if (!shot) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: info.outputPath('falz-1-demo-warp0.png') });
        shot = true;
      }
    } else if (sawWarp0) {
      leftWarp0 = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: info.outputPath('falz-2-after.png') });
  console.log(`falz transitions:\n${log.join('\n')}`);
  console.log(`warp0 camera samples matching the boss view: ${cameraMatches}; largest camera-to-view distance ${maxDelta.toFixed(3)}; mismatches (>5): ${cameraMismatch.length}`);
  console.log(`frames during DEMO_WARP0: ${ticksAtWarp0End - ticksAtWarp0Start}; max gap between samples ${maxGap} ms`);

  expect(sawWarp0, 'Dark Falz leaves WAIT_CASKET for DEMO_WARP0 (scene 2)').toBe(true);
  expect(cameraMismatch, 'the field camera sits on the boss view during DEMO_WARP0').toEqual([]);
  expect(cameraMatches, 'boss view seen with the field camera during DEMO_WARP0').toBeGreaterThan(0);
  expect(leftWarp0, 'the cutscene ends (scene 2 -> another scene)').toBe(true);
  expect(ticksAtWarp0End - ticksAtWarp0Start, 'frames keep advancing during the cutscene').toBeGreaterThan(10);
  expect(maxGap, 'no stall between samples').toBeLessThan(5000);

  // After the cutscene the boss view is gone and the field camera is the player's again.
  const after = await sample();
  expect(after.boss, 'no boss view after DEMO_WARP0').toBeNull();

  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
