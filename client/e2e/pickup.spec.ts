// Picking up a floor item on the classic field. The test drops an unequipped item from the bag
// (GameItems.drop, as drop.spec.ts), puts the player on it (GameView.warpSelf) and presses the
// pick-up key; the item must be back in the bag (6x5A sent, 6x59 answered).
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, leaveToLobby, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const HOLD_MS = 150; // the port polls keys once a frame, so a tap is lost

const inBag = (page: Page) =>
  peek(page, (w) => (w.classicGame.view.items.inventory?.c?.inventory ?? []).some((i: any) => i.data.id === w.__dropId));

async function dropAndStand(page: Page): Promise<void> {
  const id = await peek(page, (w): number | null => {
    const inv: any[] = w.classicGame.view.items.inventory?.c?.inventory ?? [];
    const it = inv.find((i) => !i.equipped && i.data.data1[0] !== 4);
    return it ? (it.data.id as number) : null;
  });
  expect(id, 'the bag holds an unequipped item').not.toBeNull();
  await page.evaluate((i) => ((window as any).__dropId = i), id);
  await peek(page, (w) => w.classicGame.view.items.drop(w.__dropId, 0));
  await expect.poll(() => peek(page, (w) => !!w.classicGame.view.items.floorItems.get(w.__dropId)), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => inBag(page)).toBe(false);
  await page.waitForTimeout(1000);
  await peek(page, (w) => {
    const it = w.classicGame.view.items.floorItems.get(w.__dropId);
    w.classicGame.view.view.warpSelf({ x: it.x + 3, y: it.y - 6, z: it.z }, -Math.PI / 2); // facing the item (weaponaim.ts facingOf)
    return true;
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.focus());
}

async function hold(page: Page, k: string): Promise<void> {
  await page.keyboard.down(k);
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up(k);
}

test('a floor item is picked up with Enter and with the Middle key', async ({ page }) => {
  const logs = consoleLog(page);
  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'wpk' }));

  await test.step('Enter picks up the item under the player', async () => {
    await dropAndStand(page);
    await hold(page, 'Enter');
    await expect.poll(() => inBag(page), { timeout: 5_000 }).toBe(true);
  });

  await test.step('the Middle key picks up the item in reach', async () => {
    await dropAndStand(page);
    await hold(page, 'ArrowDown');
    await expect.poll(() => inBag(page), { timeout: 5_000 }).toBe(true);
  });

  await test.step('Forest 1: Enter and the Middle key pick up there too', async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect
      .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
      .toBe('1:false');
    await page.waitForTimeout(2000);
    await dropAndStand(page);
    await hold(page, 'Enter');
    await expect.poll(() => inBag(page), { timeout: 5_000 }).toBe(true);
    await dropAndStand(page);
    await hold(page, 'ArrowDown');
    await expect.poll(() => inBag(page), { timeout: 5_000 }).toBe(true);
  });

  await test.step('leave the game cleanly', () => leaveToLobby(page));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
