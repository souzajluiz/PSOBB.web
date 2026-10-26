// Smoke run of the Episode 2 enemy state machines in Chrome (HANDOFF to-do 2:
// the groups combat/enemyfsmep2*.ts were ported, none was checked in a browser).
// One classic client on the Episode 2 page (no `ep4` flag) creates an EPISODE 2
// party and warps through every Episode 2 floor in turn (floor index -> area by
// questeditor/areas.ts floorToArea(2)). On each floor the spec records:
//  - the page errors, the failed requests and the console errors / warnings;
//  - the enemies the layer placed, the ones with no model (the model table's
//    name, enemymodels.ts) and the ones the layer could not build (stats.errors);
//  - the enemies constructed by the combat view and how many have a model;
//  - for 10 s with the player placed on the first placed enemy (its room's
//    waves start): the enemies' FSM states (a state change is a tick that
//    ran), the dead count, the combat fx count, the player's room and how many
//    of the floor's wave events have fired.
// Nothing is forced; the floor's own waves decide when the enemies start.
// Screenshots go to the test's output folder. Against a local newserv (e2e/README.md).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, openPartyMenu, peek, reachLobby } from './classic.ts';
import { freshUser, logInWithCharacter } from './fresh-field.ts';

// A fresh account per run (wep prefix) unless PSO_USER names one; its password is the user name.
const USER = process.env.PSO_USER ?? freshUser('wep');
const PASSWORD = process.env.PSO_PASSWORD ?? USER;

// Episode 2 floors (questeditor/areas.ts floorToArea(2)): floor index 0 is the
// Lab, where the game starts (warpTo(0) is a no-op), so the walk is 1..17.
const EP2_FLOORS: Array<{ floor: number; area: number; name: string }> = [
  { floor: 1, area: 0x13, name: 'VR Temple Alpha' },
  { floor: 2, area: 0x14, name: 'VR Temple Beta' },
  { floor: 3, area: 0x15, name: 'VR Spaceship Alpha' },
  { floor: 4, area: 0x16, name: 'VR Spaceship Beta' },
  { floor: 5, area: 0x17, name: 'Central Control Area' },
  { floor: 6, area: 0x18, name: 'Jungle North' },
  { floor: 7, area: 0x19, name: 'Jungle South' },
  { floor: 8, area: 0x1a, name: 'Mountain' },
  { floor: 9, area: 0x1b, name: 'Seaside' },
  { floor: 10, area: 0x1c, name: 'Seabed Upper' },
  { floor: 11, area: 0x1d, name: 'Seabed Lower' },
  { floor: 12, area: 0x1e, name: 'Gal Gryphon' },
  { floor: 13, area: 0x1f, name: 'Olga Flow' },
  { floor: 14, area: 0x20, name: 'Barba Ray' },
  { floor: 15, area: 0x21, name: 'Gol Dragon' },
  { floor: 16, area: 0x22, name: 'Seaside Night' },
  { floor: 17, area: 0x23, name: 'Tower' },
];

interface FloorResult {
  floor: number;
  area: string;
  name: string;
  warpError: string;
  placed: number;
  unresolved: string[];
  layerErrors: string[];
  constructed: number;
  modeled: number;
  maxConstructed: number;
  stateChanges: number;
  distinctStates: number;
  dead: number;
  fx: number;
  room: number;
  waveEvents: number;
  waveFlags: number;
  pageErrors: string[];
  failed: string[];
  consoleIssues: string[];
  shot: string;
}

// The enemies of the combat view and the layer's stats, in one read.
const snapshot = (page: Page) =>
  peek(page, (w) => {
    const v = w.classicGame.view;
    const c = v.combat;
    const layer = v.enemyLayer;
    const enemies = [...c.enemies.values()] as any[];
    const states = enemies.map((e) => `${e.ai?.constructor?.name ?? 'none'}:${e.ai?.state ?? '-'}:${e.dead ? 'dead' : 'live'}`);
    return {
      floor: v.debug().floor() as number,
      area: v.field?.viewer?.area ?? -1,
      placed: layer.stats.placed as number,
      unresolved: [...layer.stats.unresolved] as string[],
      layerErrors: [...layer.stats.errors] as string[],
      constructed: enemies.length,
      modeled: enemies.filter((e) => e.instance?.root).length,
      dead: enemies.filter((e) => e.dead).length,
      fx: c.fx ? c.fx.bursts.length : 0,
      states,
      firstWorld: layer.instances[0]?.placed?.world ?? null,
      room: v.debug().room() as number,
      waveFlags: (v.debug().events() as Array<{ flags: number }>).filter((e) => e.flags).length,
      waveEvents: (v.debug().events() as unknown[]).length,
    };
  });

test('Episode 2: every floor loads, its enemies are modeled and their FSMs tick without errors', async ({ page }, info: TestInfo) => {
  test.setTimeout(1_800_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => failed.push(`failed ${r.failure()?.errorText ?? '?'} ${r.url()}`));
  const name = `e2${Date.now() % 100000}`;

  await logInWithCharacter(page, USER, PASSWORD);
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown'); // Create a PARTY
  await key(page, 'Enter');
  await key(page, 'ArrowDown'); // EPISODE 2 (the second row)
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.create?.episode)).toBe(2); // Episode 2 (Episode 4 is 3)
  await key(page, 'Enter'); // Party Name
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  const results: FloorResult[] = [];
  for (const { floor, area, name: areaName } of EP2_FLOORS) {
    await test.step(`${areaName} (floor ${floor}, area 0x${area.toString(16)})`, async () => {
      const mark = { errors: errors.length, failed: failed.length, logs: logs.length };
      let warpError = '';
      try {
        await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), floor);
      } catch (e) {
        warpError = String((e as Error).message ?? e).slice(0, 300);
      }
      // The load is awaited inside warpTo; the enemies are built by the combat view a moment later.
      await page.waitForTimeout(3000);
      const first = await snapshot(page);
      expect(first.floor, `${areaName}: floor reached`).toBe(floor);

      // Place the player 40 units from the first placed enemy so its wave starts.
      if (first.firstWorld) {
        const [x, y, z] = first.firstWorld as number[];
        await page.evaluate(
          ([px, py, pz]) => {
            const g = (window as any).classicGame.view;
            g.placePlayer(g.game.selfId, px, py + 5, pz, 0);
          },
          [x, y, z],
        );
      }
      let maxConstructed = first.constructed;
      let stateChanges = 0;
      let dead = first.dead;
      let fx = first.fx;
      const seen = new Set<string>();
      let prev = first.states.join('|');
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        const s = await snapshot(page);
        maxConstructed = Math.max(maxConstructed, s.constructed);
        dead = Math.max(dead, s.dead);
        fx = Math.max(fx, s.fx);
        for (const st of s.states) seen.add(st);
        const now = s.states.join('|');
        if (now !== prev) stateChanges++;
        prev = now;
      }
      const last = await snapshot(page);
      const shot = info.outputPath(`ep2-${floor.toString().padStart(2, '0')}-${area.toString(16)}.png`);
      await page.screenshot({ path: shot });

      const newErrors = errors.slice(mark.errors);
      const newFailed = failed.slice(mark.failed);
      const consoleIssues = logs.slice(mark.logs).filter((l) => /^(error|warning|pageerror)/.test(l));
      const r: FloorResult = {
        floor,
        area: `0x${area.toString(16)}`,
        name: areaName,
        warpError,
        placed: last.placed,
        unresolved: [...new Set(last.unresolved)],
        layerErrors: last.layerErrors,
        constructed: last.constructed,
        modeled: last.modeled,
        maxConstructed,
        stateChanges,
        distinctStates: seen.size,
        dead,
        fx,
        room: last.room,
        waveEvents: last.waveEvents,
        waveFlags: last.waveFlags,
        pageErrors: newErrors,
        failed: newFailed,
        consoleIssues: consoleIssues.slice(0, 20),
        shot,
      };
      results.push(r);
      console.log(`ep2 ${JSON.stringify({ ...r, shot: undefined })}`);
      console.log(`ep2 ${areaName}: area reported ${last.area} (want 0x${area.toString(16)}); states ${JSON.stringify([...seen].slice(0, 12))}`);
    });
  }

  const summary = JSON.stringify(results, null, 1);
  console.log(`ep2 summary\n${summary}`);
  const fs = await import('node:fs');
  fs.writeFileSync(info.outputPath('ep2-summary.json'), summary);

  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(warpAll(results)).toEqual([]);
  expect(errors).toEqual([]);
  expect(failed.filter((f) => !KNOWN_MISSING.some((k) => f.includes(k)))).toEqual([]);
});

// Warp errors, as one list for the assertion.
function warpAll(results: FloorResult[]): string[] {
  return results.filter((r) => r.warpError).map((r) => `${r.name}: ${r.warpError}`);
}

// Object sets the data folder does not have: Seaside Night (area 0x22) and
// Tower (0x23) are quest-only areas in Episode 2. Their set data names
// map_jungle06_00o.dat / map_jungle07_00o.dat, which are in neither the data
// folder (data.gsl holds only map_jungle06d.dat / map_jungle07d.dat) nor
// newserv's system/maps/bb-v4. The floor loads without them (no objects, no
// enemies). Anything else that 404s fails the test.
const KNOWN_MISSING = ['map_jungle06_00o.dat', 'map_jungle07_00o.dat'];
