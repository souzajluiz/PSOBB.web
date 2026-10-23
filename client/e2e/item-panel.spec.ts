// The Item Pack's equipment stat panel (GUI entry 0xC, classic/itempack.ts drawPanel) on a fresh
// account in a party field. The field menu is opened with Home (held), Item Pack -> Items, then
// the cursor is moved onto the equipped weapon. The HUD's debug hook (hud.debug().itemPack, the
// ItemPackMenu.debugState rects of the last draw) gives the panel and the item list rectangles.
//
// The exe's coordinates overlap the two (the panel's 132-high frame at (16, 172) reaches y 304;
// the item list starts at (13, 256), and its open height is 188: ChallengePlayerListWindow_
// HandleInput_007526c8 state 0/1 and ListWindowObject_FinishRenderPositionUpdate(0x433c0000)),
// so the test asserts the overlap the exe's rects give, not an empty intersection.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const OUT = fileURLToPath(new URL('../test-results/', import.meta.url));

// Holds a key for `ms` (the port polls keys once per 30 fps frame).
async function hold(page: Page, k: string, ms = 150): Promise<void> {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
  await page.waitForTimeout(120);
}

type Rect = { x: number; y: number; w: number; h: number };
type PanelRect = Rect & { kind: 'equip' | 'mag' };
interface ItemPackDebug {
  leaf: string;
  state: string;
  cursor: number;
  rows: number[];
  item: { id: number; cls: number; equipped: boolean } | null;
  list: Rect;
  detail: Rect;
  panel: PanelRect | null;
}

const itemPack = (page: Page) => peek(page, (w): ItemPackDebug | null => w.classicGame?.view?.hud?.debug().itemPack ?? null);

// Vertical and horizontal overlap of two rects (0 when they do not meet).
const overlap = (a: Rect, b: Rect) => ({
  x: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
  y: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)),
});

test('the equipment stat panel is drawn for the equipped weapon, at the exe\'s rect', async ({ page }) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  mkdirSync(OUT, { recursive: true });

  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'ipn' }));

  await test.step('Home (held) opens the field menu; Item Pack -> Items', async () => {
    await hold(page, 'Home');
    await expect.poll(() => peek(page, (w) => !!w.classicGame?.view?.hud?.debug().menuOpen), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(3500); // the window's opening wipe
    await hold(page, 'Enter'); // Item Pack
    await page.waitForTimeout(1500);
    await hold(page, 'ArrowDown');
    await hold(page, 'Enter'); // Items
    await expect.poll(async () => (await itemPack(page))?.leaf ?? '', { timeout: 30_000 }).toBe('itempack');
    await expect.poll(async () => (await itemPack(page))?.state ?? '', { timeout: 30_000 }).toBe('list');
  });

  const weapon = await test.step('the equipped weapon is in the list', async () => {
    const id = await peek(page, (w): number | null => {
      const inv: any[] = w.classicGame.view.items.character?.inventory ?? [];
      const eq = inv.find((i) => i.equipped && i.data.data1[0] === 0);
      return eq ? (eq.data.id as number) : null;
    });
    expect(id, 'the character has an equipped weapon').not.toBeNull();
    const rows = (await itemPack(page))!.rows;
    expect(rows).toContain(id);
    return id!;
  });

  await test.step('the cursor moves onto the weapon: the panel draws for it', async () => {
    const rows = (await itemPack(page))!.rows;
    const want = rows.indexOf(weapon);
    for (let i = 0; i < rows.length && (await itemPack(page))!.cursor !== want; i++) await hold(page, 'ArrowDown');
    await expect.poll(async () => (await itemPack(page))?.cursor ?? -1, { timeout: 30_000 }).toBe(want);
    await expect.poll(async () => (await itemPack(page))?.panel ?? null, { timeout: 10_000 }).not.toBeNull();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}item-panel-weapon.png` });

    const pack = (await itemPack(page))!;
    expect(pack.item?.id).toBe(weapon);
    expect(pack.item?.cls).toBe(0);
    expect(pack.item?.equipped).toBe(true);
    // The exe's panel: GUI entry 0xC (16, 172); the base frame is 132 high (no requirement rows).
    expect(pack.panel).toEqual({ x: 16, y: 172, w: 240, h: 132, kind: 'equip' });
    // The item list (ITEM_LIST, 13, 256) and the panel meet in y by 48 px, the exe's rects overlap so.
    expect(pack.list).toEqual({ x: 13, y: 256, w: 308, h: 184 });
    expect(overlap(pack.panel!, pack.list)).toEqual({ x: 240, y: 48 });
    // The item detail (entry 2, (324, 256)) is clear of the panel.
    expect(overlap(pack.panel!, pack.detail).x).toBe(0);
  });

  await test.step('the panel is drawn on the list rows, not over the detail window', async () => {
    const pack = (await itemPack(page))!;
    expect(pack.state).toBe('list');
    expect(pack.rows.length).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}item-panel-weapon-full.png`, fullPage: false });
  });

  const errors = logs.filter((l) => l.startsWith('pageerror'));
  expect(errors).toEqual([]);
});
