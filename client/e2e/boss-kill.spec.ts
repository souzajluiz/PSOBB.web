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
