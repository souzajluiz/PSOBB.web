// Helpers of the phone e2e specs (phone-charselect.spec.ts, phone-field.spec.ts):
// the title's login, the character creation through the phone UI, the character
// list, Ship Select and the lobby, through the page's development hooks.
import { devices, expect, type Page } from '@playwright/test';
import { key, peek } from './classic';

// A separate account (newserv registers a new one on its first login).
export const USER = process.env.PSO_TALL_USER ?? 'webtall';
export const PASSWORD = process.env.PSO_TALL_PASSWORD ?? 'webtall';
export const SHOTS = process.env.PSO_SHOTS_DIR ?? '';
export const NAME = 'Tallie';

export const IPHONE_13 = {
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['iPhone 13'].userAgent,
};
export const PIXEL_7 = {
  viewport: { width: 412, height: 839 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['Pixel 7'].userAgent,
};
export const IPHONE_13_LANDSCAPE = { ...IPHONE_13, viewport: { width: 664, height: 390 } };
export const DESKTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };

// The slot rows of the character list (charselect.ts RE.slots, 38 px high).
export const SLOT_Y = [182, 225, 268, 311];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

// The stage's CSS box (classic.html's #stage canvas).
export async function stageBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const r = document.getElementById('stage')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

// A tap at a virtual point of the 640x480 screen, through the tall layout
// (the box is 3:4 and the screen is centred in it).
export async function tapVirtual(page: Page, vx: number, vy: number): Promise<void> {
  const b = await stageBox(page);
  // Portrait: the tall stage (whole screen, centred vertically). Otherwise the
  // 4:3 screen is scaled by height and anchored to the box's left edge.
  if (b.h > b.w) {
    const s = b.w / 640;
    const oy = (b.h - 480 * s) / 2;
    await page.mouse.click(b.x + vx * s, b.y + oy + vy * s);
  } else {
    const s = b.h / 480;
    await page.mouse.click(b.x + vx * s, b.y + vy * s);
  }
}

export async function openTitle(page: Page): Promise<void> {
  await page.goto('/classic.html');
  await expect.poll(() => peek(page, (w) => !!w.classicTitle?.flow?.enabled), { timeout: 60_000 }).toBe(true);
}

// Title -> Login menu -> Input UserID (the HTML form) -> Start Game -> the
// character list. The form is the phone's own (classic/loginform.ts).
export async function loginPhone(page: Page, user = USER, password = PASSWORD): Promise<void> {
  await openTitle(page);
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => !!w.classicTitle.flow.menu && !w.classicTitle.flow.menu.anim.animating)).toBe(true);
  for (let i = 0; i < 6; i++) {
    if ((await peek(page, (w) => w.classicTitle.flow.menu.selected)) === 3) break;
    await key(page, 'ArrowDown');
  }
  await key(page, 'Enter');
  await expect(page.locator('.lf-root')).toBeVisible();
  await page.locator('.lf-root input[name=userid]').fill(user);
  await page.locator('.lf-root input[name=password]').fill(password);
  await page.locator('.lf-root input[name=password]').press('Enter');
  await expect(page.locator('.lf-root')).toBeHidden();
  // Start Game is enabled once both fields hold something (the Login menu
  // takes the form's result on its next tick).
  await expect.poll(() => peek(page, (w) => w.classicTitle.flow.menu?.input === null && w.classicTitle.flow.menu.startEnabled)).toBe(true);
  for (let i = 0; i < 6; i++) {
    if ((await peek(page, (w) => w.classicTitle.flow.menu.selected)) === 0) break;
    await key(page, 'ArrowUp');
  }
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
}

// Whether the character list on screen has a character in the slot. The
// window hook is replaced when the list is shown again.
export const slotFilled = async (page: Page, slot: number): Promise<boolean> => {
  const filled = await peek(page, (w) => (w.classicSelect ? w.classicSelect.slots.map((p: unknown) => p !== null) : []));
  return (filled as boolean[])[slot] === true;
};

// The first empty slot of the character list.
export async function firstEmptySlot(page: Page): Promise<number> {
  const empty = await peek(page, (w) => w.classicSelect.slots.map((p: unknown) => p === null));
  const i = (empty as boolean[]).indexOf(true);
  expect(i, 'the account has no empty slot (delete a character or use another PSO_TALL_USER)').toBeGreaterThanOrEqual(0);
  return i;
}

// The name form (classic/nameform.ts): the root that holds the name field. The
// login form is in the page too, so it is told apart by its field.
export const nameRoot = (page: Page) => page.locator('.lf-root').filter({ has: page.locator('input[name=name]') });

export type CreateState = { dress: boolean; sub: number; step: number; text: boolean };

export const createState = (page: Page) =>
  peek(page, (w): CreateState | null => {
    const c = w.classicCreate;
    if (!c) return null;
    return { dress: !!c.dress, sub: c.sub, step: c.dress ? c.step : -1, text: !!c.editor?.handlesText?.() };
  });

// Makes the character through the creation screen: the class, then each step
// of the dressing room in order with the defaults; the name in the HTML form.
// Step 7 is the name and step 9 is OK (STEP_LISTS in charcreate_data.ts).
export async function makeCharacter(page: Page, stopAtName = false): Promise<void> {
  const NAME_STEP = 7;
  const AUTO_STEP = 8;
  const OK_STEP = 9;
  let opened = false; // an editor was opened on this step (Enter); close it next
  for (let i = 0; i < 400; i++) {
    const s = await createState(page);
    if (s && s.sub === 7) return; // done: the character is sent (handlers.done)
    if (!s) {
      await sleep(200);
      continue;
    }
    if (!s.dress) {
      await key(page, 'Enter'); // class type, then the class
      await sleep(400);
      continue;
    }
    if (s.sub === 1) {
      if (s.text && stopAtName) return;
      if (s.text) {
        const input = page.locator('.lf-root input[name=name]');
        await expect(input).toBeVisible({ timeout: 10_000 });
        await shot(page, 'create-name-form');
        await input.fill(NAME);
        await nameRoot(page).locator('.lf-ok').click();
        await expect.poll(async () => (await createState(page))?.sub).toBe(0);
        await key(page, 'ArrowDown'); // the name is done: the next step
        await sleep(150);
      } else if (s.step === AUTO_STEP) {
        // The AUTO editor rolls a look on Tab; Enter confirms it once rolled.
        await key(page, 'Tab');
        await sleep(1500);
        await key(page, 'Enter');
      } else {
        await key(page, 'Enter'); // confirm the step's editor
      }
      continue;
    }
    if (s.sub === 2) {
      await key(page, 'Enter'); // Confirm on the finished character
      continue;
    }
    if (s.sub !== 0) {
      await sleep(200);
      continue;
    }
    if (s.step === NAME_STEP) {
      await key(page, 'Enter'); // the name form opens (above)
      await sleep(300);
      continue;
    }
    if (s.step === OK_STEP) {
      await key(page, 'Enter');
      continue;
    }
    if (opened) {
      await key(page, 'ArrowDown'); // the step is done: the next one
      opened = false;
      await sleep(150);
      continue;
    }
    await key(page, 'Enter');
    opened = true;
    await sleep(150);
  }
  throw new Error('character creation did not finish');
}

// The first filled slot of the character list (a login with a character).
export async function firstFilledSlot(page: Page): Promise<number> {
  const filled = await peek(page, (w) => w.classicSelect.slots.map((p: unknown) => p !== null));
  const i = (filled as boolean[]).indexOf(true);
  expect(i, 'the account has no character (run the portrait test first or use another PSO_TALL_USER)').toBeGreaterThanOrEqual(0);
  return i;
}

// From the character list to Ship Select through the chosen slot.
export async function enterSlot(page: Page, slot: number): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if ((await peek(page, (w) => w.classicSelect.selected)) === slot) break;
    await key(page, 'ArrowDown');
  }
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => !!w.classicShip || !!w.classicLobby), { timeout: 90_000 }).toBe(true);
}

// The stage mapping of a point of the 640x480 screen to the page (the stage
// box): tall in portrait, stretched over the box otherwise (ship select).
export async function screenPoint(page: Page, vx: number, vy: number): Promise<{ x: number; y: number }> {
  const b = await stageBox(page);
  if (b.h > b.w) {
    const s = b.w / 640;
    return { x: b.x + vx * s, y: b.y + (b.h - 480 * s) / 2 + vy * s };
  }
  return { x: b.x + (vx * b.w) / 640, y: b.y + (vy * b.h) / 480 };
}

// Ship Select's rows (shipselect.ts): the list starts at (22, 66), 20 px apart.
export const shipRowY = (row: number) => 66 + row * 20 + 8;

// Picks "Go to lobby" in Ship Select with a tap on its row, then waits for the lobby.
export async function goToLobbyByTap(page: Page): Promise<void> {
  await expect.poll(() => peek(page, (w) => !!w.classicShip), { timeout: 90_000 }).toBe(true);
  const row = await peek(page, (w) => w.classicShip.items.findIndex((it: { label: string }) => it.label === 'Go to lobby'));
  expect(row, 'Ship Select lists "Go to lobby"').toBeGreaterThanOrEqual(0);
  const p = await screenPoint(page, 100, shipRowY(row as number));
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => peek(page, (w) => !!w.classicLobby), { timeout: 90_000 }).toBe(true);
}

