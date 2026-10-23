// The Item Pack > Items window on a fresh account in a party field, as the exe lays it out
// (menu 11 -> GuildCardSearchWindow_Constructor_0075086c; the list is GUI entry 3 (13, 256),
// 308 x 184, from the size table 0x00973ca0; the description is entry 2 (324, 256), 240 x 184).
// The Item Pack never creates GUI entry 0xC, so no equipment stat panel is drawn here (the exe's
// panel belongs to the mag menus' window, ChallengePlayerListWindow_Constructor_007525bc).
// The field menu is opened with Home (held), Item Pack -> Items, then the cursor is moved onto
// the equipped weapon. The HUD's debug hook (hud.debug().itemPack, ItemPackMenu.debugState of the
// last draw) gives the rectangles and the cursor row, which must be on screen and inside the list.
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
interface ItemPackDebug {
  leaf: string;
  state: string;
  cursor: number;
  rows: number[];
  item: { id: number; cls: number; equipped: boolean } | null;
  list: Rect;
  detail: Rect;
  panel: (Rect & { kind: 'equip' | 'mag' }) | null;
  cursorRow: Rect;
}

const itemPack = (page: Page) => peek(page, (w): ItemPackDebug | null => w.classicGame?.view?.hud?.debug().itemPack ?? null);

// Vertical and horizontal overlap of two rects (0 when they do not meet).
const overlap = (a: Rect, b: Rect) => ({
  x: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
  y: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)),
});

// The virtual screen is 640 x 480 (the windows' game space).
const inScreen = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 640 && r.y + r.h <= 480;

test('the Item Pack list is laid out at the exe\'s rect, and the cursor row on the weapon is visible', async ({ page }) => {
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

  await test.step('the cursor moves onto the weapon: its row is visible in the list', async () => {
    const rows = (await itemPack(page))!.rows;
    const want = rows.indexOf(weapon);
    for (let i = 0; i < rows.length && (await itemPack(page))!.cursor !== want; i++) await hold(page, 'ArrowDown');
    await expect.poll(async () => (await itemPack(page))?.cursor ?? -1, { timeout: 30_000 }).toBe(want);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}item-panel-weapon.png` });

    const pack = (await itemPack(page))!;
    expect(pack.item?.id).toBe(weapon);
    expect(pack.item?.cls).toBe(0);
    expect(pack.item?.equipped).toBe(true);
    // The exe's list: GUI entry 3 (13, 256), 308 x 184 (size table 0x00973ca0). It opens down
    // from its y, not up: nothing in this menu sets its height to 188.
    expect(pack.list).toEqual({ x: 13, y: 256, w: 308, h: 184 });
    expect(inScreen(pack.list)).toBe(true);
    // No equipment panel in the Item Pack (GUI entry 0xC is not created by the inventory menu).
    expect(pack.panel).toBeNull();
    // The cursor's row is inside the list, below its title, and on screen.
    const row = pack.cursorRow;
    expect(row.x).toBeGreaterThanOrEqual(pack.list.x);
    expect(row.y).toBeGreaterThan(pack.list.y);
    expect(row.y + row.h).toBeLessThanOrEqual(pack.list.y + pack.list.h);
    expect(inScreen(row)).toBe(true);
    // The description (entry 2, (324, 256)) is clear of the list (the list ends at x 321).
    expect(overlap(pack.list, pack.detail).x).toBe(0);
  });

  const errors = logs.filter((l) => l.startsWith('pageerror'));
  expect(errors).toEqual([]);
});
