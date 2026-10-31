// Boss kill and exit: a boss is killed through the real damage path (combat.ts applyEnemyHit: the
// brain's pools, the 6x0A with the new total to newserv), its death state runs (the Dragon's state
// 0x15, De Rol Le's 0x1f: EnemyOnKilledHandler_0051f894 at 0x0051f894, which sends the 6x76 kill flag,
// the EXP request and the drop request), the floor's exit warp appears (the wave event's
// construct_objects(1, 1) runs once the boss's set entry is dead), and taking it changes the floor.
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, key, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const PREFIX = 'bsk';
const STRONG_WEAPON = '0001052c' + '00'.repeat(8);

const floorOf = (page: Page) => peek(page, (w) => w.classicGame.view.debug().floor() as number);

const dump = (page: Page) =>
  page.evaluate(() => {
    const v = (window as any).classicGame.view;
    const o = v.fieldObjects;
    return {
      floor: v.debug().floor(),
      switches: v.debug().switches(),
      warps: (o?.warps ?? []).map((w: any) => ({ i: w.index, kind: w.kind, floor: w.floor, flag: w.flag, x: Math.round(w.x), y: Math.round(w.y), z: Math.round(w.z), r: w.radius })),
      allWarps: (o?.all?.warps ?? []).map((w: any) => ({ i: w.index, kind: w.kind, floor: w.floor, flag: w.flag })),
    };
  });

async function killAndExit(page: Page, logs: string[], errors: string[], floor: number, cls: string, name: string): Promise<void> {
  await enterFreshField(page, logs, {
    prefix: PREFIX,
    patch: (c) => {
      const weapon = c.inventory.find((i) => i.equipped && i.kind === 'Weapon');
      return {
        level: 100,
        stats: { atp: 600, mst: 200, evp: 200, hp: 2000, dfp: 300, ata: 300, lck: 100 },
        inventory: { set: weapon ? [{ slot: weapon.slot, data1: STRONG_WEAPON }] : [] },
      };
    },
  });

  await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), floor);
  await expect.poll(() => floorOf(page), { timeout: 90_000 }).toBe(floor);
  await expect
    .poll(() => page.evaluate((c) => [...(window as any).classicGame.view.combat.enemies.values()].some((e: any) => e.ai?.constructor?.name === c), cls), { timeout: 30_000 })
    .toBe(true);
  console.log('before: ' + JSON.stringify(await dump(page)));
  console.log('events: ' + JSON.stringify(await page.evaluate(() => (window as any).classicGame.view.debug().events())));

  await expect
    .poll(() => page.evaluate((c) => [...(window as any).classicGame.view.combat.enemies.values()].find((e: any) => e.ai?.constructor?.name === c)?.ai.untargetable === true, cls), { timeout: 60_000 })
    .toBe(false);

  const mark = logs.length;
  const defeated = () => logs.slice(mark).some((l) => new RegExp(`${name} E-[0-9a-f]+ defeated`).test(l));
  // The real damage path: applyEnemyHit lowers the brain's pools and sends 6x0A to newserv. A brain
  // that gates its death (the Dragon: cursor 0x32 or more, so the first hit past the 90 % threshold
  // only makes it roar) is hit again every few seconds until it dies.
  for (let i = 0; i < 40 && !defeated(); i++) {
    const r = await page.evaluate((c) => {
      const combat = (window as any).classicGame.view.combat;
      const e = [...combat.enemies.values()].find((x: any) => x.ai?.constructor?.name === c);
      if (!e.ai.untargetable && !e.dead) combat.applyEnemyHit(e, 0x20000000 | 0x00800000 | 0x00100000, 100000, false, 'test: ');
      return { hp: e.ai.hp ?? e.ai.bodyHp, sid: e.ai.sid, dead: e.ai.dead };
    }, cls);
    console.log('hit ' + JSON.stringify(r));
    await page.waitForTimeout(4000);
  }
  expect(defeated(), `${name} is defeated`).toBe(true);
  console.log('dead logs: ' + logs.slice(mark).filter((l) => new RegExp(`${name}|defeat|EXP`).test(l)).slice(0, 20).join('\n'));
  // The boss's set entry is dead (6x76 flag 8, applied locally too), so the floor's wave event runs
  // construct_objects(1, 1): the exit warp (an area warp back to floor 0, a delayed object) appears.
  await expect.poll(async () => (await dump(page)).warps.map((w: any) => w.kind), { timeout: 30_000 }).toContain('area');
  const after = await dump(page);
  console.log('after: ' + JSON.stringify(after));
  const exit = after.warps.find((w: any) => w.kind === 'area')!;
  await page.evaluate(([x, y, z]) => {
    const g = (window as any).classicGame.view;
    g.placePlayer(g.game.selfId, x, y, z, 0);
  }, [exit.x, exit.y, exit.z]);
  // The area warp asks first (the Pioneer 2 name in a one-row menu); Enter takes it.
  await expect.poll(() => peek(page, (w) => w.classicGame.view.field.menu.open), { timeout: 10_000 }).toBe(true);
  await key(page, 'Enter');
  await expect.poll(() => floorOf(page), { timeout: 90_000 }).toBe(exit.floor);
  console.log(`exit taken: floor ${floor} -> ${exit.floor}`);
  expect(errors).toEqual([]);
}

test('Dragon (floor 11): killed through the real damage path, the exit warp works', async ({ page }) => {
  test.setTimeout(600_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await killAndExit(page, logs, errors, 11, 'DragonAi', 'Dragon');
});

test('De Rol Le (floor 12): killed through the real damage path, the exit warp works', async ({ page }) => {
  test.setTimeout(600_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await killAndExit(page, logs, errors, 12, 'DeRolLeAi', 'De Rol Le');
});

// Takes the exit warp that has appeared on the current floor (an area warp, a delayed object) and
// waits for the floor to change.
async function takeExit(page: Page, errors: string[], from: number): Promise<void> {
  await expect.poll(async () => (await dump(page)).warps.map((w: any) => w.kind), { timeout: 30_000 }).toContain('area');
  const after = await dump(page);
  console.log('after: ' + JSON.stringify(after));
  const exit = after.warps.find((w: any) => w.kind === 'area')!;
  await page.evaluate(([x, y, z]) => {
    const g = (window as any).classicGame.view;
    g.placePlayer(g.game.selfId, x, y, z, 0);
  }, [exit.x, exit.y, exit.z]);
  await expect.poll(() => peek(page, (w) => w.classicGame.view.field.menu.open), { timeout: 10_000 }).toBe(true);
  await key(page, 'Enter');
  await expect.poll(() => floorOf(page), { timeout: 90_000 }).not.toBe(from);
  console.log(`exit taken: floor ${from} -> ${await floorOf(page)}`);
  expect(errors).toEqual([]);
}

async function strongFresh(page: Page, logs: string[]): Promise<void> {
  await enterFreshField(page, logs, {
    prefix: PREFIX,
    patch: (c) => {
      const weapon = c.inventory.find((i) => i.equipped && i.kind === 'Weapon');
      return {
        level: 100,
        stats: { atp: 600, mst: 200, evp: 200, hp: 2000, dfp: 300, ata: 300, lck: 100 },
        inventory: { set: weapon ? [{ slot: weapon.slot, data1: STRONG_WEAPON }] : [] },
      };
    },
  });
}

test('Vol Opt (floor 13): core then body killed through the real damage path, voloptOver and the exit', async ({ page }) => {
  test.setTimeout(900_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await strongFresh(page, logs);
  await page.evaluate(() => (window as any).classicGame.view.warpTo(13));
  await expect.poll(() => floorOf(page), { timeout: 90_000 }).toBe(13);
  await expect.poll(() => page.evaluate(() => [...(window as any).classicGame.view.combat.enemies.values()].some((e: any) => e.ai?.constructor?.name === 'VoloptAi')), { timeout: 30_000 }).toBe(true);
  const before = await dump(page);
  console.log('before: ' + JSON.stringify(before));
  // The exit is a delayed object: it is not there before voloptOver builds groups 1 and 3.
  expect(before.warps.map((w: any) => w.kind)).not.toContain('area');
  const state = () => page.evaluate(() => {
    const e = [...(window as any).classicGame.view.combat.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'VoloptAi') as any;
    const f2 = [...(window as any).classicGame.view.combat.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'VoloptForm2Ai') as any;
    return { state: e.ai.state, f2: f2 ? { hp: f2.ai.hp, ready: f2.ai.ready, dead: f2.ai.dead } : null };
  });
  // Phase 1 ends when the core is dead: strike it through applyEnemyHit once the fight is on.
  await expect.poll(async () => (await state()).state, { timeout: 120_000 }).toMatch(/fight|phase/i);
  console.log('fight state: ' + JSON.stringify(await state()));
  await page.evaluate(() => {
    const combat = (window as any).classicGame.view.combat;
    const core = [...combat.enemies.values()].find((x: any) => x.ai?.part?.kind === 'core') as any;
    combat.applyEnemyHit(core, 0x20000000 | 0x00800000 | 0x00100000, 100000, false, 'test: ');
  });
  await expect.poll(async () => (await state()).f2?.ready, { timeout: 120_000 }).toBe(true);
  console.log('form 2: ' + JSON.stringify(await state()));
  const mark = logs.length;
  for (let i = 0; i < 60 && !logs.slice(mark).some((l) => /Vol Opt defeated/.test(l)); i++) {
    await page.evaluate(() => {
      const combat = (window as any).classicGame.view.combat;
      const f2 = [...combat.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'VoloptForm2Ai') as any;
      if (f2 && !f2.dead && f2.ai.hp > 0) combat.applyEnemyHit(f2, 0x20000000 | 0x00800000 | 0x00100000, 100000, false, 'test: ');
    });
    await page.waitForTimeout(3000);
  }
  expect(logs.slice(mark).some((l) => /Vol Opt defeated: quest flag 0x2a set/.test(l)), 'voloptOver ran').toBe(true);
  await takeExit(page, errors, 13);
});

test('Dark Belra: woken by its wave trigger, killed through the real damage path (a field enemy: EXP, no exit warp)', async ({ page }) => {
  test.setTimeout(900_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await strongFresh(page, logs);
  let floor = -1;
  let woke = false;
  const shown = () => page.evaluate(() => [...(window as any).classicGame.view.combat.enemies.values()].some((e: any) => e.ai?.constructor?.name === 'BelraAi' && e.instance.root.visible));
  for (const f of [8, 9, 10, 6, 7]) {
    await page.evaluate((x) => (window as any).classicGame.view.warpTo(x), f);
    await expect.poll(() => floorOf(page), { timeout: 90_000 }).toBe(f);
    await page.waitForTimeout(4000);
    if (!(await page.evaluate(() => [...(window as any).classicGame.view.combat.enemies.values()].some((e: any) => e.ai?.constructor?.name === 'BelraAi')))) continue;
    floor = f;
    const trigs = await page.evaluate(() => ((window as any).classicGame.view.fieldObjects?.all?.triggers ?? []).map((t: any) => [t.x, t.y, t.z]));
    for (const p of trigs) {
      await page.evaluate(([x, y, z]) => {
        const g = (window as any).classicGame.view;
        g.placePlayer(g.game.selfId, x, y, z, 0);
      }, p);
      await page.waitForTimeout(1500);
      if ((woke = await shown())) break;
    }
    console.log(`floor ${f}: ${trigs.length} triggers, woke ${woke}`);
    if (woke) break;
  }
  expect(floor, 'a Dark Belra is on floors 6..10').toBeGreaterThan(0);
  expect(woke, 'a Dark Belra shows after its wave trigger').toBe(true);
  console.log('before: ' + JSON.stringify(await dump(page)));
  console.log('events: ' + JSON.stringify(await page.evaluate(() => (window as any).classicGame.view.debug().events())));
  const mark = logs.length;
  // Dark Belra is a field enemy of the Ruins / Mines, not a boss: no 'defeated' boss line, the kill is the EXP award.
  const defeated = () => logs.slice(mark).some((l) => /\+\d+ EXP/.test(l));
  for (let i = 0; i < 40 && !defeated(); i++) {
    const r = await page.evaluate(() => {
      const combat = (window as any).classicGame.view.combat;
      const e = [...combat.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'BelraAi' && x.instance.root.visible) as any;
      if (e && !e.ai.untargetable && !e.dead) combat.applyEnemyHit(e, 0x20000000 | 0x00800000 | 0x00100000, 100000, false, 'test: ');
      return e ? { state: e.ai.state, dead: e.dead } : null;
    });
    console.log('hit ' + JSON.stringify(r));
    await page.waitForTimeout(3000);
  }
  console.log('dead logs: ' + logs.slice(mark).filter((l) => /Belra|defeat|EXP/.test(l)).slice(0, 20).join('\n'));
  expect(defeated(), 'Dark Belra is killed (EXP awarded)').toBe(true);
  // A field enemy has no exit of its own: the floor's ordinary warps exist before and after.
  expect(errors).toEqual([]);
});
