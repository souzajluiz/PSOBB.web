// The Item Pack > Items list's scroll bar (classic/listscrollbar.ts, PsoBB.exe
// RenderScrollbarPrimitives_0073f6b2). A fresh account gets 9 weapons in its pack (one more
// line than the 8 the list shows), so the bar is drawn: the thumb sits at the top, and moves
// down as the cursor passes the 8th row and the list scrolls. The HUD's debug hook
// (hud.debug().itemPack) gives the rects the last draw() put (`scrollbar`) and the first
// visible row (`top`).
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
interface ItemPackScroll {
  state: string;
  cursor: number;
  top: number;
  rows: number[];
  scrollbar: { track: Rect; thumb: Rect } | null;
}

const itemPack = (page: Page) => peek(page, (w): ItemPackScroll | null => w.classicGame?.view?.hud?.debug().itemPack ?? null);

// An unidentified-free Saber (class 0, type 1, variant 0): weapons do not stack, so nine of them
// are nine rows.
const SABER = { data1: '000100000000000000000000', data2: '00000000' } as const;

test('the Item Pack list shows its scroll bar for nine or more lines, and the thumb moves as the list scrolls', async ({ page }) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  mkdirSync(OUT, { recursive: true });

  await test.step('a fresh account in a party field, with nine weapons in the pack', () =>
    enterFreshField(page, logs, { prefix: 'ipsb', patch: () => ({ inventory: { add: Array(9).fill(SABER) } }) }));

  await test.step('Home (held) opens the field menu; Item Pack -> Items', async () => {
    await hold(page, 'Home');
    await expect.poll(() => peek(page, (w) => !!w.classicGame?.view?.hud?.debug().menuOpen), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(3500); // the window's opening wipe
    await hold(page, 'Enter'); // Item Pack
    await page.waitForTimeout(1500);
    await hold(page, 'ArrowDown');
    await hold(page, 'Enter'); // Items
    await expect.poll(async () => (await itemPack(page))?.state ?? '', { timeout: 30_000 }).toBe('list');
  });

  const first = await test.step('nine or more lines: the bar is drawn, the thumb at the top', async () => {
    const pack = (await itemPack(page))!;
    expect(pack.rows.length).toBeGreaterThanOrEqual(9);
    expect(pack.top).toBe(0);
    expect(pack.scrollbar, 'the scroll bar is drawn').not.toBeNull();
    const sb = pack.scrollbar!;
    // The list is ITEM_LIST (13, 256, 308 x 184), titled: the track starts 17 px below the top
    // (g_ScrollbarBaseYOffset) and is 150 px long (184 - 34, g_ScrollbarThickness), 7 px in from
    // the right edge. The inner height is 184 - 20 - 6 = 158.
    expect(sb.track.x).toBe(13 + 308 - 7);
    expect(sb.track.y).toBe(256 + 17);
    expect(sb.track.h).toBe(150);
    expect(sb.thumb.y).toBe(sb.track.y);
    // The pack holds its own items too, so the content is rows.length * 20 - 6 (the test counts them).
    expect(sb.thumb.h).toBeCloseTo((158 * 150) / (pack.rows.length * 20 - 6), 6);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}item-scrollbar-top.png` });
    return pack;
  });

  await test.step('the cursor passes the 8th row: the list scrolls and the thumb moves down', async () => {
    // Down until the list has scrolled (the 9th row at the latest; the cursor wraps at the end).
    for (let i = 0; i < 12 && ((await itemPack(page))?.top ?? 0) < 1; i++) await hold(page, 'ArrowDown');
    await expect.poll(async () => (await itemPack(page))?.top ?? -1, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(300);
    const pack = (await itemPack(page))!;
    const sb = pack.scrollbar!;
    // The offset is top * 20 (ASSUMED, see listscrollbar.ts), so the thumb is that far down the
    // track, scaled by track / content.
    const content = pack.rows.length * 20 - 6;
    expect(sb.thumb.y).toBeCloseTo(first.scrollbar!.track.y + (pack.top * 20 * 150) / content, 6);
    expect(sb.thumb.y).toBeGreaterThan(first.scrollbar!.thumb.y);
    expect(sb.thumb.h).toBeCloseTo(first.scrollbar!.thumb.h, 6);
    await page.screenshot({ path: `${OUT}item-scrollbar-scrolled.png` });
  });

  const errors = logs.filter((l) => l.startsWith('pageerror'));
  expect(errors).toEqual([]);
});
