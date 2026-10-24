// The field's main menu (Home, classic/fieldmenu.ts) against a local newserv: a
// fresh character in Pioneer 2 (floor 0), Home held for 200 ms opens the menu
// (the 3D view shifts to the top right, the panel and the cursor row's help
// window come up), then ArrowDown moves the cursor to the next row. Both
// frames are saved under test-results for a look against the exe's screens
// (PsoBB.exe's render_player_menu_background and FUN_0073249c; the GC reference
// in the brief is not the target).
import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { consoleLog, key, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

test('field: Home opens the main menu, ArrowDown moves the help text', async ({ page }) => {
  test.setTimeout(240_000);
  const logs = consoleLog(page);
  await enterFreshField(page, logs, { prefix: 'hm' });
  mkdirSync('test-results', { recursive: true });

  await test.step('hold Home for 200 ms', async () => {
    await page.keyboard.down('Home');
    await page.waitForTimeout(200);
    await page.keyboard.up('Home');
    // The window opens over a few frames (the view shift takes 3 frames, the rows fade in 4).
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'test-results/field-menu-home.png' });
    // The menu's state and the projection the 3D view is drawn with (fieldhud.ts attach).
    const probe = await peek(page, (w) => {
      const v = w.classicGame?.view;
      const e = v?.viewer?.camera?.projectionMatrix?.elements;
      return { open: v?.hud?.menu?.isOpen, shift: v?.hud?.menu?.menu?.shift, p0: e?.[0], p3: e?.[3], p5: e?.[5], p7: e?.[7] };
    });
    console.log(`[field-menu-home] ${JSON.stringify(probe)}`);
  });

  await test.step('ArrowDown moves the cursor to the next row', async () => {
    await key(page, 'ArrowDown');
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'test-results/field-menu-home-row1.png' });
  });
});
