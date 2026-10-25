// Picking up an enemy's drop on Forest 1. The pick-up spec (pickup.spec.ts) uses an item the
// player dropped from the bag, whose 6x2A carries a height; an enemy's drop comes as the server's
// 6x5F, which carries none (the item starts at y 0 and is set on the ground, FloorItemLayer.show).
//
// The test enters a party field on the webtest account (PSO_USER / PSO_PASSWORD override it),
// warps to Forest 1 (EDP_FLOOR / EDP_ROOM / EDP_WAVE override the field), builds a wave and kills
// its enemies one at a time with the wire kill (CombatView.killEnemy: 6x0A, 6x76, the drop request
// 6x60) until a drop is on the floor. The player stands next to the drop (its node height less the
// item's ground offset) and presses Enter; the item must leave the floor and reach the bag (a meseta
// drop: the meseta grows). The Middle key does the same with the next drop in reach.
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, leaveToLobby, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const FLOOR = Number(process.env.EDP_FLOOR ?? 1); // Forest 1
const ROOM = Number(process.env.EDP_ROOM ?? 2);
const WAVE = Number(process.env.EDP_WAVE ?? 1);
const HOLD_MS = 150; // the port polls keys once a frame, so a tap is lost
const ITEM_GROUND_OFFSET = 6; // item_box_ground_y_offset (render/flooritems.ts)
const MESETA_CLASS = 4; // ItemData data1[0] of meseta

type Drop = { id: number; x: number; z: number; cls: number; nodeY: number | null };
// bag: the bag's items (id and amount), so a stack that takes the drop in (the drop's id is then
// not kept) shows as a change too.
type Snap = { meseta: number; bag: string; onFloor: boolean };

// The enemy drops on the floor, with the height their node is drawn at.
const enemyDrops = (page: Page) =>
  peek(page, (w): Drop[] =>
    [...w.classicGame.view.items.floorItems.values()]
      .filter((it: any) => it.source === 'enemy')
      .map((it: any) => ({
        id: it.id,
        x: it.x,
        z: it.z,
        cls: it.data.data1[0],
        nodeY: w.classicGame.view.floorItems.shown.get(it.id)?.node.position.y ?? null,
      })),
  );

// Kills the living enemies of the wave one at a time (CombatView.killEnemy, the wire kill) until an
// enemy drop that is not in `known` is on the floor; returns it, or null when none came.
async function killUntilDrop(page: Page, known: number[]): Promise<Drop | null> {
  const living = await peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].filter((e: any) => !e.dead && !e.fake).length);
  for (let i = 0; i < living; i++) {
    await peek(page, (w) => {
      const c = w.classicGame.view.combat;
      const e = [...c.enemies.values()].find((x: any) => !x.dead && !x.fake);
      if (e) c.killEnemy(e, 0);
      return !!e;
    });
    await page.waitForTimeout(700);
    const fresh = (await enemyDrops(page)).find((d) => !known.includes(d.id));
    if (fresh) return fresh;
  }
  return null;
}

// The item's state: on the floor, in the bag, and the meseta (a meseta drop never enters the bag).
const snap = (page: Page, id: number): Promise<Snap> =>
  peek(page, (w): Snap => {
    const v = w.classicGame.view;
    const c = v.items.character ?? v.items.inventory?.c ?? {};
    return {
      meseta: c.meseta ?? -1,
      bag: JSON.stringify((v.items.inventory?.c?.inventory ?? []).map((i: any) => [i.data.id, i.data.data1[5], i.data.data1[1], i.data.data1[2]])),
      onFloor: v.items.floorItems.has(w.__dropId),
    };
  });

// Stands the player 3 units from a drop, facing it (weaponaim.ts facingOf), on the ground the drop
// is set on (its node height less the ground offset).
async function standAt(page: Page, id: number): Promise<void> {
  await page.evaluate(
    ([i, off]) => {
      const w = window as any;
      w.__dropId = i;
      const v = w.classicGame.view;
      const it = v.items.floorItems.get(i);
      const s = v.floorItems.shown.get(i);
      v.view.warpSelf({ x: it.x + 3, y: s.node.position.y - off, z: it.z }, -Math.PI / 2);
    },
    [id, ITEM_GROUND_OFFSET] as const,
  );
  await page.waitForTimeout(500);
  await page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.focus());
}

// Holds a key for a few frames, then checks that the drop left the floor and reached the bag (for
// meseta: that the meseta grew).
async function pressAndExpectPickup(page: Page, key: string, id: number, cls: number): Promise<void> {
  const before = await snap(page, id);
  expect(before.onFloor, 'the drop is on the floor before the press').toBe(true);
  await page.keyboard.down(key);
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up(key);
  await expect
    .poll(
      async () => {
        const now = await snap(page, id);
        return !now.onFloor && (cls === MESETA_CLASS ? now.meseta !== before.meseta : now.bag !== before.bag);
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

test('an enemy drop is picked up with Enter and with the Middle key', async ({ page }) => {
  const logs = consoleLog(page);
  process.env.PSO_USER ??= 'webtest';
  process.env.PSO_PASSWORD ??= 'webtest';
  await test.step('the webtest character in a party field', () => enterFreshField(page, logs, { prefix: 'edp' }));

  await test.step(`floor ${FLOOR}: the wave of room ${ROOM} is built`, async () => {
    await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), FLOOR);
    await expect
      .poll(() => peek(page, (w) => (w.classicGame ? `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}` : '')), { timeout: 60_000 })
      .toBe(`${FLOOR}:false`);
    await page.evaluate(([f, r, w]) => (window as any).classicGame.view.constructEnemies(f, r, w), [FLOOR, ROOM, WAVE] as const);
    await expect.poll(() => peek(page, (w) => w.classicGame.view.combat.enemies.size), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(3000);
  });

  const seen: number[] = [];
  let first: Drop | null = null;
  await test.step('an enemy drops an item (killed one at a time)', async () => {
    first = await killUntilDrop(page, seen);
    expect(first, 'an enemy dropped an item').not.toBeNull();
  });
  const one = first as unknown as Drop;
  seen.push(one.id);
  console.log('enemy drop', JSON.stringify({ ...one, id: one.id.toString(16) }));

  await test.step('Enter picks the drop up', async () => {
    await standAt(page, one.id);
    await pressAndExpectPickup(page, 'Enter', one.id, one.cls);
  });

  await test.step('the Middle key picks up the next enemy drop in reach', async () => {
    await page.waitForTimeout(1000);
    const two = await killUntilDrop(page, seen);
    expect(two, 'a second enemy dropped an item').not.toBeNull();
    const second = two as unknown as Drop;
    seen.push(second.id);
    console.log('second enemy drop', JSON.stringify({ ...second, id: second.id.toString(16) }));
    await standAt(page, second.id);
    await pressAndExpectPickup(page, 'ArrowDown', second.id, second.cls);
  });

  await test.step('leave the game cleanly', () => leaveToLobby(page));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
