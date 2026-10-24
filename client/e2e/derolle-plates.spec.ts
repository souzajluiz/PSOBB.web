// De Rol Le in Chrome (HANDOFF item 4, the 2026-10-24 check): one classic client creates an
// EPISODE 1 party, warps to De Rol Le's floor (12, area 0x0c, questeditor/areas.ts) and checks:
//   - the shell segment plates: a hit on a segment's enemy (the combat hit path, applyEnemyHit, the
//     one a melee hit runs) starts the hit flash, the plate's material turns cyan (0, 255, 255) at
//     once and fades back to white over the next frames (DrlSegment.tickColor, 0.05 a tick);
//   - the beam: when the body fires it (state 0x1b, sub 2), the beam's looping emitter (0x177) is
//     on the particle system, and its position is the beam's muzzle (DeRolLeAi.beam.from) on every
//     frame the beam is on. The muzzle does not move in this check (the body stays put while it
//     fires), so the follow itself is not exercised; see DEVLOG 2026-10-24.
// Nothing is forced on the body. No page error and no failed request. Screenshots go to the test's
// output folder (client/test-results, not committed).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';
const DE_ROL_LE_FLOOR = 12; // area 0x0c
const BEAM_WAIT_MS = 240_000;

interface BeamFrame {
  t: number;
  from: number[] | null;
  emitters: number[][];
}

test('De Rol Le: a segment plate flashes cyan and fades; the beam emitter follows the muzzle', async ({ page }, info) => {
  test.setTimeout(600_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const name = `dr${Date.now() % 100000}`;

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
  await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), DE_ROL_LE_FLOOR);
  await expect.poll(floor, { timeout: 90_000 }).toBe(DE_ROL_LE_FLOOR);
  await page.waitForTimeout(5000);

  const spawn = await peek(page, (w) => {
    const c = w.classicGame.view.combat;
    const body = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'DeRolLeAi') as any;
    const segs = [...c.enemies.values()].filter((x: any) => x.ai?.constructor?.name === 'DrlSegmentAi');
    return body ? `state=${body.ai.state} sid=${body.ai.sid} segments=${segs.length}` : `no body (${c.enemies.size} enemies)`;
  });
  console.log(`De Rol Le spawn: ${spawn}`);
  expect(spawn.startsWith('no body')).toBe(false);
  await page.screenshot({ path: info.outputPath('derolle-0-spawn.png') });

  // The plate hit. The segment's enemy is the index head + 1 (segment 0); the hit is the combat's
  // applyEnemyHit with a 5-point blow. Then the plate's colour is read each frame for 1.5 s.
  const plate = () =>
    peek(page, (w) => {
      const c = w.classicGame.view.combat;
      const body = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'DeRolLeAi') as any;
      const v = c.drlViews?.get(body.index);
      const seg = body.ai.segmentParts[0];
      const mats: any[] = v?.segMats?.[0] ?? [];
      return {
        flash: seg.flash as number,
        brainColor: (seg.color >>> 0).toString(16),
        plates: mats.length,
        hex: mats.map((m: any) => m.color.getHex() as number),
      };
    });
  const before = await plate();
  console.log(`before the hit: plates ${before.plates}, flash ${before.flash}, colour ${before.brainColor}, plate hex ${before.hex.map((h: number) => h.toString(16)).join(',')}`);
  expect(before.plates, 'segment 0 has plate materials').toBeGreaterThan(0);
  expect(before.hex[0], 'the idle plate is white').toBe(0xffffff);

  // The hit: the segment's enemy (body index + 1) takes a 5-point blow through applyEnemyHit. An in-page
  // frame recorder starts with it (a page call per sample is too slow to catch the first ticks): per
  // frame, the brain's flash and the plate material's colour for 1.5 s.
  await page.evaluate(() => {
    const w = window as any;
    const c = w.classicGame.view.combat;
    const body = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'DeRolLeAi') as any;
    const seg = c.enemies.get(body.index + 1);
    if (!seg) throw new Error(`no segment enemy at E-${(body.index + 1).toString(16)}`);
    const mats: any[] = c.drlViews.get(body.index).segMats[0];
    const rec = { frames: [] as { t: number; flash: number; hex: number }[], t0: performance.now(), done: false };
    w.__drlPlate = rec;
    c.applyEnemyHit(seg, 0x20000000 | 0x00800000 | 0x00100000, 5, false, 'e2e plate: ', true, {});
    const tick = () => {
      rec.frames.push({ t: Math.round(performance.now() - rec.t0), flash: body.ai.segmentParts[0].flash, hex: mats[0].color.getHex() });
      if (performance.now() - rec.t0 < 1500) requestAnimationFrame(tick);
      else rec.done = true;
    };
    requestAnimationFrame(tick);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__drlPlate.done === true), { timeout: 10_000 }).toBe(true);
  const flashSamples: { t: number; flash: number; hex: number }[] = await page.evaluate(() => (window as any).__drlPlate.frames);
  const fmt = (h: number) => h.toString(16).padStart(6, '0');
  console.log(`plate after the hit (ms:flash:hex, ${flashSamples.length} frames): ${flashSamples.map((s) => `${s.t}:${s.flash.toFixed(2)}:${fmt(s.hex)}`).join(' ')}`);
  const cyan = flashSamples.filter((s) => s.flash > 0.5);
  expect(cyan.length, 'the brain flash starts at the hit').toBeGreaterThan(0);
  for (const s of cyan) {
    expect(s.hex & 0xffff, 'the plate is cyan while the flash is high (green and blue full)').toBe(0xffff);
  }
  const first = flashSamples[0];
  expect(first.flash, 'the hit starts the flash at 1').toBeGreaterThan(0.9);
  // From the frame after the hit (the render takes its colour a frame later) the red rises back to white.
  const fadeFrom = flashSamples.findIndex((s) => s.flash < 0.95);
  const reds = flashSamples.map((s) => s.hex >> 16);
  const fading = flashSamples.every((s, i) => i <= fadeFrom || reds[i] >= reds[i - 1] || s.flash === 0);
  expect(fading, 'the red rises monotonically back to white').toBe(true);
  const last = flashSamples[flashSamples.length - 1];
  expect(last.hex, 'the plate fades back to white').toBe(0xffffff);
  expect(last.flash).toBe(0);
  await page.screenshot({ path: info.outputPath('derolle-1-faded.png') });

  // The beam lasts about 14 brain ticks (80, then +30 a tick to 500): under half a second, so an
  // in-page frame recorder keeps the first beam's frames (the muzzle and each tracked emitter).
  await page.evaluate(() => {
    const w = window as any;
    const rec = { frames: [] as any[], started: false, done: false };
    w.__drlBeam = rec;
    const tick = () => {
      const c = w.classicGame?.view?.combat;
      const body = c ? [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'DeRolLeAi') : null;
      if (body && !rec.done) {
        if (body.ai.beamFiring === true) {
          rec.started = true;
          const bursts: any[] = c.fx?.bursts ?? [];
          rec.frames.push({
            t: performance.now(),
            from: body.ai.beam ? [...body.ai.beam.from] : null,
            emitters: bursts.filter((b: any) => b.track && b.particles?.emitters?.length).map((b: any) => [...b.particles.emitters[0].pos]),
          });
        } else if (rec.started) rec.done = true;
      }
      if (!rec.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // The player stands 60 in front of the body; the wait is for the body's own beam (nothing forced).
  await peek(page, (w) => {
    const c = w.classicGame.view.combat;
    const body = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'DeRolLeAi') as any;
    w.classicGame.view.placePlayer(w.classicGame.game.selfId, body.ai.x, 0, body.ai.z + 60, 0);
  });
  const waitStart = Date.now();
  let started = false;
  while (Date.now() - waitStart < BEAM_WAIT_MS) {
    started = await page.evaluate(() => (window as any).__drlBeam.started === true);
    if (started) break;
    await page.waitForTimeout(500);
  }
  console.log(`beam: started ${started} after ${((Date.now() - waitStart) / 1000).toFixed(1)} s`);
  expect(started, 'the body fires the beam within the wait').toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__drlBeam.done === true), { timeout: 10_000 }).toBe(true);
  const beamFrames: BeamFrame[] = await page.evaluate(() => (window as any).__drlBeam.frames);
  console.log(`beam frames recorded: ${beamFrames.length}, span ${beamFrames.length ? Math.round(beamFrames[beamFrames.length - 1].t - beamFrames[0].t) : 0} ms`);
  expect(beamFrames.length, 'the beam is on for some frames').toBeGreaterThan(3);

  // Each frame with a tracked emitter sits on the muzzle (within float error). The tracked burst that
  // the beam makes is the last one listed when the beam is on (the beam is the only tracker started here).
  let worst = 0;
  let matched = 0;
  let movedFrom = 0;
  for (let i = 0; i < beamFrames.length; i++) {
    const s = beamFrames[i];
    if (!s.from) continue;
    if (i > 0 && beamFrames[i - 1].from && s.from.some((v, k) => Math.abs(v - (beamFrames[i - 1].from as number[])[k]) > 1e-3)) movedFrom++;
    if (s.emitters.length === 0) continue;
    matched++;
    const e = s.emitters[s.emitters.length - 1];
    worst = Math.max(worst, Math.hypot(e[0] - s.from[0], e[1] - s.from[1], e[2] - s.from[2]));
  }
  const f0 = beamFrames[0];
  const fN = beamFrames[beamFrames.length - 1];
  console.log(`beam emitter: ${matched} frames with a tracked emitter, worst emitter-to-muzzle ${worst.toFixed(4)}, muzzle moved on ${movedFrom} frames`);
  console.log(`beam first frame: from ${JSON.stringify(f0.from)} emitters ${JSON.stringify(f0.emitters)}; last frame: from ${JSON.stringify(fN.from)} emitters ${JSON.stringify(fN.emitters)}`);
  expect(matched, 'a tracked beam emitter exists while the beam is on').toBeGreaterThan(0);
  expect(worst, 'the emitter sits on the muzzle').toBeLessThan(1e-3);

  await page.screenshot({ path: info.outputPath('derolle-2-beam-after.png') });
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
