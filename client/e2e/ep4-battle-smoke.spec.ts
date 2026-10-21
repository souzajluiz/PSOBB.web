// Smoke run of the 2026-10-21 Episode 4 boss and Battle Mode passes in Chrome.
// 1. Saint-Milion (Episode 4, floor 9 = area 0x2c, questeditor/areas.ts
//    floorToArea(3)): one classic client on the Episode 4 page (`ep4`) creates
//    an EPISODE 4 party, warps to the boss floor and walks to the boss's
//    waiting spot. Its states, its shots (SmLaser) and the laser's loop
//    (SE 0x6f8) are watched for 60 s. The first form waits for the tentacles
//    to be killed, so the laser is then reached the way the leader's script
//    does it: a 6xDC state action (state 0x13, the laser's first state), and
//    watched for 30 s more.
// The page must log no errors and no request may fail. Screenshots go to the
// test's output folder. Against a local newserv (e2e/README.md).
import { expect, test, type TestInfo, type Page } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

// Episode 4's floor table: floor 9 is area 0x2c, Saint-Milion.
const SAINT_MILION_FLOOR = 9;
// The laser's first state (state 19, 0x13) and the 6xDC state action.
const LASER_STATE = 0x13;

// Watches the boss for `ticks` half-seconds: its states, the shots of the
// combat view and the laser's sound. Returns what was seen.
async function watchBoss(page: Page, info: TestInfo, label: string, ticks: number) {
  let laserSeen = false;
  let laserSound = false;
  const shotKinds = new Map<string, number>();
  const states = new Map<string, number>();
  for (let i = 0; i < ticks; i++) {
    const s = await peek(page, (w) => {
      const c = w.classicGame.view.combat;
      const e = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'SaintMilionAi') as any;
      const shots: string[] = (c.shots ?? []).map((x: any) => x.shot?.constructor?.name ?? '?');
      return {
        ai: e ? `${e.ai.state}/0x${e.ai.sid.toString(16)} kind=${e.ai.kind} form=${e.ai.form} laser=${e.ai.laser ? 'yes' : 'no'}` : 'none',
        shots,
        se: c.sePlayer ? c.sePlayer.playing(0x6f8) : null,
      };
    });
    const st = s.ai.split(' ')[0];
    states.set(st, (states.get(st) ?? 0) + 1);
    for (const k of s.shots) shotKinds.set(k, (shotKinds.get(k) ?? 0) + 1);
    if (s.shots.includes('SmLaser')) laserSeen = true;
    if (s.se === true) laserSound = true;
    if (i % 4 === 0) console.log(`${label} t=${i / 2}s ${s.ai} shots=[${s.shots.join(',')}] se0x6f8=${s.se}`);
    if (i % 20 === 10) await page.screenshot({ path: info.outputPath(`saintmilion-${label}-${i}.png`) });
    await page.waitForTimeout(500);
  }
  console.log(`${label}: shot kinds ${JSON.stringify([...shotKinds])}`);
  console.log(`${label}: states seen (state/sid) ${JSON.stringify([...states])}`);
  console.log(`${label}: laser seen ${laserSeen}, laser sound 0x6f8 playing ${laserSound}`);
  return { laserSeen, laserSound };
}

test('Saint-Milion: the boss wakes for a player, its states and laser run without errors', async ({ page }, info) => {
  test.setTimeout(400_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const name = `e4${Date.now() % 100000}`;

  await logIn(page, USER, PASSWORD, 'screen=input&ep4');
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown'); // Create a PARTY
  await key(page, 'Enter');
  await key(page, 'ArrowDown', 2); // EPISODE 4 (the third row, offered with ep4)
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.create?.episode)).toBe(3);
  await key(page, 'Enter'); // Party Name
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  const floor = () => peek(page, (w) => w.classicGame?.view?.debug().floor() as number);

  await test.step('Saint-Milion floor: the boss is spawned', async () => {
    await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), SAINT_MILION_FLOOR);
    await expect.poll(floor, { timeout: 90_000 }).toBe(SAINT_MILION_FLOOR);
    await page.waitForTimeout(4000);
    const boss = await peek(page, (w) => {
      const c = w.classicGame.view.combat;
      const e = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'SaintMilionAi');
      return e ? `state=${e.ai.state} sid=${e.ai.sid} kind=${e.ai.kind}` : `no boss (${c.enemies.size} enemies)`;
    });
    console.log(`saint-milion spawn: ${boss}`);
    expect(boss.startsWith('no boss')).toBe(false);
    await page.screenshot({ path: info.outputPath('saintmilion-spawn.png') });
  });

  await test.step('walk into the arena and watch the states for 60 s', async () => {
    // The body wakes for a player within sqrt(6251) of (-50, 24) (state 0).
    await peek(page, (w) => {
      w.classicGame.view.placePlayer(w.classicGame.game.selfId, -50, 0, 24, 0);
    });
    await watchBoss(page, info, 'natural', 120);
  });

  await test.step('the leader sends 6xDC state 0x13: the laser, watched for 30 s', async () => {
    await peek(page, (w) => w.classicGame.game.sendEpisode4BossAction(0, 0x13));
    const r = await watchBoss(page, info, 'laser', 60);
    expect(r.laserSeen).toBe(true);
  });

  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
