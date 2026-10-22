// Smoke run of the 2026-10-21 Episode 4 boss and Battle Mode passes in Chrome.
// 1. Saint-Milion (Episode 4, floor 9 = area 0x2c, questeditor/areas.ts
//    floorToArea(3)): one classic client on the Episode 4 page (`ep4`) creates
//    an EPISODE 4 party, warps to the boss floor and walks to the boss's
//    waiting spot. Its states and shots are watched. The first form's lead
//    tentacles are struck to death (the same applyEnemyHit a melee hit runs):
//    each death makes the boss answer with 6xDC action 2 (the leader applies
//    it on its own client too, as checked_call_packet0x60_subcommand does),
//    and after the fourth the boss is in form 2 and its own attack pick
//    reaches the laser (states 0x13 / 0x14). The laser's shot (SmLaser) and its
//    loop (SE 0x6f8) are then watched for 30 s. Nothing is forced.
// The page must log no errors and no request may fail. Screenshots go to the
// test's output folder. Against a local newserv (e2e/README.md).
import { expect, test, type TestInfo, type Page } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

// Episode 4's floor table: floor 9 is area 0x2c, Saint-Milion.
const SAINT_MILION_FLOOR = 9;

// Watches the boss for `ticks` half-seconds: its states, the shots of the
// combat view and the laser's sound. Returns what was seen.
async function watchBoss(page: Page, info: TestInfo, label: string, ticks: number, strike = false) {
  let laserSeen = false;
  let laserSound = false;
  let kills = 0;
  const shotKinds = new Map<string, number>();
  const states = new Map<string, number>();
  for (let i = 0; i < ticks; i++) {
    const s = await peek(page, (w) => {
      const c = w.classicGame.view.combat;
      const e = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'SaintMilionAi') as any;
      const shots: string[] = (c.shots ?? []).map((x: any) => x.shot?.constructor?.name ?? '?');
      return {
        ai: e ? `${e.ai.state}/0x${e.ai.sid.toString(16)} kind=${e.ai.kind} form=${e.ai.form} laser=${e.ai.laser ? 'yes' : 'no'} arena=${e.ai.arena} hp=${w.classicGame.view.combat.damage.hp}/${w.classicGame.view.combat.damage.state}` : 'none',
        shots,
        se: c.sePlayer ? c.sePlayer.playing(0x6f8) : null,
      };
    });
    if (strike) {
      const hit = await peek(page, (w) => {
        const c: any = w.classicGame.view.combat;
        // ASSUMED test aid: the leader's max HP is raised and kept full. A dead player is no target
        // (render/combat.ts), and state 15 picks an attack only while a living player is in the arena
        // (chooseAttack), so one of the boss's blasts would otherwise stop the fight (seen: hp 0 in state 15).
        c.damage.maxHp = 100000;
        if (c.damage.state === 'alive') c.damage.hp = c.damage.maxHp;
        // The leader stays in the boss's arena (arrivalFrame: state 0x0d waits for a player within 250
        // of arena 2 at (533, -522); chooseAttack needs one near the arena). ASSUMED: arenas 3 / 4
        // are centred on the origin (SM_ARENAS ox / oz); a knockback would otherwise leave the arena.
        const boss: any = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'SaintMilionAi');
        const centre: Record<number, [number, number]> = { 2: [533, -522], 3: [0, 0], 4: [0, 0] };
        const at = boss ? centre[boss.ai.arena] : undefined;
        if (at && boss.ai.sid >= 0x0d && boss.ai.sid <= 0x18) w.classicGame.view.placePlayer(w.classicGame.game.selfId, at[0], 0, at[1], 0);
        // Parts 4 .. 7 first: their deaths are the first form's fourth death
        // (the form change). Then a lead tentacle: its death makes the boss answer
        // with 6xDC action 2 and cycle through the states. ENEMY_BASE_FLAGS of
        // render/combat.ts. ASSUMED: one blow of 9999 kills the target.
        const live = [...c.enemies.values()].filter((x: any) => x.ai?.constructor?.name === 'SmChildAi' && !x.dead);
        const part = live.find((x: any) => x.ai.index >= 4 && x.ai.index < 8 && !x.ai.untargetable);
        const lead = live.find((x: any) => x.ai.entity && x.ai.entity.lead && x.ai.entity.targetable && !x.ai.entity.dead);
        const target: any = part ?? lead;
        if (!target) return false;
        c.applyEnemyHit(target, 0x20000000 | 0x00800000 | 0x00100000, 9999, false, 'e2e strike: ', true, {});
        return true;
      });
      if (hit) kills++;
    }
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
  console.log(`${label}: laser seen ${laserSeen}, laser sound 0x6f8 playing ${laserSound}, lead strikes ${kills}`);
  return { laserSeen, laserSound, kills };
}

test('Saint-Milion: the boss wakes for a player, its states and laser run without errors', async ({ page }, info) => {
  test.setTimeout(900_000);
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

  await test.step('walk into the arena; strike the parts and leads until the laser is reached (max 8 x 60 s)', async () => {
    // The body wakes for a player within sqrt(6251) of (-50, 24) (state 0).
    await peek(page, (w) => {
      w.classicGame.view.placePlayer(w.classicGame.game.selfId, -50, 0, 24, 0);
    });
    let laserSeen = false;
    let laserSound = false;
    for (let chunk = 0; chunk < 8 && !laserSeen; chunk++) {
      const r = await watchBoss(page, info, `chunk${chunk}`, 120, true);
      laserSeen ||= r.laserSeen;
      laserSound ||= r.laserSound;
    }
    expect(laserSeen).toBe(true);
    // The laser's loop is checked while the laser lives (the shot's window), not after it.
    expect(laserSound).toBe(true);
  });

  await test.step('the laser ends: the loop stops with it (watched for 30 s)', async () => {
    await watchBoss(page, info, 'after', 60);
  });

  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
