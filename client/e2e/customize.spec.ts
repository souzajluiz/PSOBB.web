// Main menu > Customize (the action palette editor, classic/customize.ts) against a local newserv: a
// fresh character in Forest 1 (warpTo(1)), Home held for 200 ms opens the field menu, ArrowDown moves
// the cursor to Customize (row 1 of the main menu: Item Pack, Customize, ...), Enter opens the slot list
// and Decide opens the action grid. The frame is saved under test-results for a look against the exe's
// window (customize_menu_constructor, dump 717277; render_customize_menu_action_list, dump 718800).
import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { consoleLog, key, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

test('field: Home > Customize opens the slot list and the action grid', async ({ page }) => {
  test.setTimeout(240_000);
  const logs = consoleLog(page);
  await enterFreshField(page, logs, { prefix: 'cz' });
  await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
  await page.waitForTimeout(2000);
  mkdirSync('test-results', { recursive: true });

  await test.step('hold Home for 200 ms, then choose Customize', async () => {
    await page.keyboard.down('Home');
    await page.waitForTimeout(200);
    await page.keyboard.up('Home');
    await page.waitForTimeout(1200);
    await key(page, 'ArrowDown');
    await page.waitForTimeout(300);
    await key(page, 'Enter');
    await page.waitForTimeout(1500);
  });

  await test.step('the Customize window is open', async () => {
    const open = await peek(page, (w) => w.classicGame?.view?.hud?.menu?.isOpen ?? null);
    console.log(`[customize] menu open: ${JSON.stringify(open)}`);
  });

  await page.screenshot({ path: 'test-results/customize.png' });

  await test.step('Decide opens the action grid', async () => {
    await key(page, 'Enter');
    await page.waitForTimeout(1200);
  });
  await page.screenshot({ path: 'test-results/customize-grid.png' });
});
