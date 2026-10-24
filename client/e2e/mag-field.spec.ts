// A player with a MAG in Forest 1 (render/magmodel.ts): the fresh character gets a MAG in its
// inventory (bridge/admin-chars.mjs, offline), equips it in the field, and its view draws the
// MAG's rig (two parts for type 0). The screenshot is the check for the drawing.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const SHOT = process.env.MAG_SHOT ?? '/private/tmp/claude-501/-Users-junior-Downloads-psobb-master/f60c4ff0-0b26-4933-b927-114d5ecac4ed/scratchpad/mag-field.png';

type Held = { clientId: number; mags: number; magShown: boolean };

const magOf = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const selfId = w.classicGame?.game?.selfId;
    return (w.classicGame?.view.heldWeapons() as Held[]).find((h) => h.clientId === selfId) ?? null;
  }) as Promise<Held | null>;

test('a MAG follows its player in Forest 1', async ({ page }) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  await enterFreshField(page, logs, { prefix: 'mag', mag: true });

  // Equip the MAG from the inventory (the item pack's equip path).
  const magId = await peek(page, (w) => (w.classicGame.view.items.character.inventory as Array<{ data: { id: number; data1: number[] } }>).find((i) => i.data.data1[0] === 2)?.data.id ?? null);
  expect(magId).not.toBeNull();
  await page.evaluate((id) => (window as any).classicGame.view.items.equip(id, 1 /* SLOT_MAG */), magId);

  await peek(page, (w) => void w.classicGame.view.warpTo(1));
  await expect
    .poll(() => peek(page, (w) => (w.classicGame ? `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}` : '')), { timeout: 60_000 })
    .toBe('1:false');

  // The MAG's rig is built once the body and the tables are loaded, then drawn in the field.
  await expect.poll(async () => (await magOf(page))?.mags ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await magOf(page))?.magShown ?? false, { timeout: 30_000 }).toBe(true);

  // Let a few game ticks run so the anchor has settled behind the shoulder.
  await page.waitForTimeout(1500);
  mkdirSync(dirname(SHOT), { recursive: true });
  await page.screenshot({ path: SHOT });
});
