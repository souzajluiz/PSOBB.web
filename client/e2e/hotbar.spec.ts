// The bottom hotbar on the classic field (classic/hotbar.ts, render/combat.ts): in Forest 1 the
// key 1 uses the Monomate in hotbar slot 1. The test sets slot 1 to the Monomate (palette item
// index 0) if it is empty, holds '1' for 150 ms, and expects one 6x27 use. A screenshot of the
// field goes to test-results for comparison with the reference (scratchpad barrier.png, a
// 512-wide capture of the same bar).
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { expect, test } from '@playwright/test';
import { consoleLog, leaveToLobby, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const HOLD_MS = 150; // the port polls keys once a frame, so a tap is lost

test('key 1 uses the Monomate in hotbar slot 1 (Forest 1)', async ({ page }) => {
  const logs = consoleLog(page);
  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'hbk' }));

  await test.step('Forest 1', async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect
      .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
      .toBe('1:false');
    await page.waitForTimeout(2000);
  });

  await test.step('the bag holds a Monomate and hotbar slot 1 uses it', async () => {
    const monomate = await peek(page, (w): number | null => {
      const inv: any[] = w.classicGame.view.items.inventory?.c?.inventory ?? [];
      const it = inv.find((i) => i.data.data1[0] === 3 && i.data.data1[1] === 0 && i.data.data1[2] === 0);
      return it ? (it.data.id as number) : null;
    });
    expect(monomate, 'the bag holds a Monomate').not.toBeNull();
    await page.evaluate(() => {
      const hud = (window as any).classicGame.view.hud;
      const pal = hud.palette;
      if (!pal) return;
      const cur = pal.palettes[pal.flipped ? 1 : 0];
      if (cur.hotbar[0].group1 === 0) cur.hotbar[0] = { group1: 4, group2: 0, disabled: false };
    });
  });

  await test.step('record the 6x27 sends', async () => {
    await peek(page, (w) => {
      const g = w.classicGame.game;
      if (g.__hotbarWrapped) return true;
      const orig = g.sendSubcommand.bind(g);
      g.__hotbarSent = [] as number[][];
      g.sendSubcommand = (sub: number, body: Uint8Array) => {
        if (sub === 0x27) g.__hotbarSent.push([...body.subarray(0, 12)]);
        return orig(sub, body);
      };
      g.__hotbarWrapped = true;
      return true;
    });
  });

  await test.step('holding 1 uses the Monomate once', async () => {
    await page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.focus());
    await page.keyboard.down('1');
    await page.waitForTimeout(HOLD_MS);
    await page.keyboard.up('1');
    await expect.poll(() => peek(page, (w) => (w.classicGame.game.__hotbarSent ?? []).length), { timeout: 5_000 }).toBe(1);
  });

  await test.step('the field screenshot (test-results)', async () => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: test.info().outputPath('hotbar-forest1.png') });
  });

  await test.step('leave the game cleanly', () => leaveToLobby(page));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
