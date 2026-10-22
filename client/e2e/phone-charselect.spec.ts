// The phone's character select and character creation (classic/charselect.ts,
// classic/charcreate.ts, classic/nameform.ts): in portrait the stage is the
// tall 3:4 box of the title (stage.ts tallLayout), the whole 640x480 screen
// scaled to its width and centred, the bars filled with the screen's background
// dimmed. A tap on a slot is the same as Enter on it. The character's name is
// typed into an HTML form on a phone. Desktop and landscape keep the 4:3 layout.
// Ship select (classic/shipselect.ts) takes the same tall stage in portrait,
// over the lobby backdrop, with the touch menu pad under the screen; its
// "Go to lobby" row is picked by a tap. Landscape and desktop keep their layout.
// Phones are emulated (isMobile, hasTouch). The character is made through the
// phone UI end to end and reaches the lobby. Screenshots go to PSO_SHOTS_DIR
// when it is set.
import { devices, expect, test, type Page } from '@playwright/test';
import { consoleLog, key, logIn, peek } from './classic';

// A separate account (newserv registers a new one on its first login).
const USER = process.env.PSO_TALL_USER ?? 'webtall';
const PASSWORD = process.env.PSO_TALL_PASSWORD ?? 'webtall';
const SHOTS = process.env.PSO_SHOTS_DIR ?? '';
const NAME = 'Tallie';

const IPHONE_13 = {
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['iPhone 13'].userAgent,
};
const PIXEL_7 = {
  viewport: { width: 412, height: 839 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['Pixel 7'].userAgent,
};
const IPHONE_13_LANDSCAPE = { ...IPHONE_13, viewport: { width: 664, height: 390 } };
const DESKTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };

// The slot rows of the character list (charselect.ts RE.slots, 38 px high).
const SLOT_Y = [182, 225, 268, 311];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

// The stage's CSS box (classic.html's #stage canvas).
async function stageBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const r = document.getElementById('stage')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

// A tap at a virtual point of the 640x480 screen, through the tall layout
// (the box is 3:4 and the screen is centred in it).
async function tapVirtual(page: Page, vx: number, vy: number): Promise<void> {
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

async function openTitle(page: Page): Promise<void> {
  await page.goto('/classic.html');
  await expect.poll(() => peek(page, (w) => !!w.classicTitle?.flow?.enabled), { timeout: 60_000 }).toBe(true);
}

// Title -> Login menu -> Input UserID (the HTML form) -> Start Game -> the
// character list. The form is the phone's own (classic/loginform.ts).
async function loginPhone(page: Page): Promise<void> {
  await openTitle(page);
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => !!w.classicTitle.flow.menu && !w.classicTitle.flow.menu.anim.animating)).toBe(true);
  for (let i = 0; i < 6; i++) {
    if ((await peek(page, (w) => w.classicTitle.flow.menu.selected)) === 3) break;
    await key(page, 'ArrowDown');
  }
  await key(page, 'Enter');
  await expect(page.locator('.lf-root')).toBeVisible();
  await page.locator('.lf-root input[name=userid]').fill(USER);
  await page.locator('.lf-root input[name=password]').fill(PASSWORD);
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
const slotFilled = async (page: Page, slot: number): Promise<boolean> => {
  const filled = await peek(page, (w) => (w.classicSelect ? w.classicSelect.slots.map((p: unknown) => p !== null) : []));
  return (filled as boolean[])[slot] === true;
};

// The first empty slot of the character list.
async function firstEmptySlot(page: Page): Promise<number> {
  const empty = await peek(page, (w) => w.classicSelect.slots.map((p: unknown) => p === null));
  const i = (empty as boolean[]).indexOf(true);
  expect(i, 'the account has no empty slot (delete a character or use another PSO_TALL_USER)').toBeGreaterThanOrEqual(0);
  return i;
}

// The name form (classic/nameform.ts): the root that holds the name field. The
// login form is in the page too, so it is told apart by its field.
const nameRoot = (page: Page) => page.locator('.lf-root').filter({ has: page.locator('input[name=name]') });

type CreateState = { dress: boolean; sub: number; step: number; text: boolean };

const createState = (page: Page) =>
  peek(page, (w): CreateState | null => {
    const c = w.classicCreate;
    if (!c) return null;
    return { dress: !!c.dress, sub: c.sub, step: c.dress ? c.step : -1, text: !!c.editor?.handlesText?.() };
  });

// Makes the character through the creation screen: the class, then each step
// of the dressing room in order with the defaults; the name in the HTML form.
// Step 7 is the name and step 9 is OK (STEP_LISTS in charcreate_data.ts).
async function makeCharacter(page: Page, stopAtName = false): Promise<void> {
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
async function firstFilledSlot(page: Page): Promise<number> {
  const filled = await peek(page, (w) => w.classicSelect.slots.map((p: unknown) => p !== null));
  const i = (filled as boolean[]).indexOf(true);
  expect(i, 'the account has no character (run the portrait test first or use another PSO_TALL_USER)').toBeGreaterThanOrEqual(0);
  return i;
}

// From the character list to Ship Select through the chosen slot.
async function enterSlot(page: Page, slot: number): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if ((await peek(page, (w) => w.classicSelect.selected)) === slot) break;
    await key(page, 'ArrowDown');
  }
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => !!w.classicShip || !!w.classicLobby), { timeout: 90_000 }).toBe(true);
}

// The stage mapping of a point of the 640x480 screen to the page (the stage
// box): tall in portrait, stretched over the box otherwise (ship select).
async function screenPoint(page: Page, vx: number, vy: number): Promise<{ x: number; y: number }> {
  const b = await stageBox(page);
  if (b.h > b.w) {
    const s = b.w / 640;
    return { x: b.x + vx * s, y: b.y + (b.h - 480 * s) / 2 + vy * s };
  }
  return { x: b.x + (vx * b.w) / 640, y: b.y + (vy * b.h) / 480 };
}

// Ship Select's rows (shipselect.ts): the list starts at (22, 66), 20 px apart.
const shipRowY = (row: number) => 66 + row * 20 + 8;

// Picks "Go to lobby" in Ship Select with a tap on its row, then waits for the lobby.
async function goToLobbyByTap(page: Page): Promise<void> {
  await expect.poll(() => peek(page, (w) => !!w.classicShip), { timeout: 90_000 }).toBe(true);
  const row = await peek(page, (w) => w.classicShip.items.findIndex((it: { label: string }) => it.label === 'Go to lobby'));
  expect(row, 'Ship Select lists "Go to lobby"').toBeGreaterThanOrEqual(0);
  const p = await screenPoint(page, 100, shipRowY(row as number));
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => peek(page, (w) => !!w.classicLobby), { timeout: 90_000 }).toBe(true);
}

test.describe('iPhone 13 portrait', () => {
  test.use(IPHONE_13);

  test('the list is a tall stage; a tap opens creation; the name is typed in the form; the character reaches the lobby', async ({ page }) => {
    const logs = consoleLog(page);
    await loginPhone(page);

    // The 3:4 box over the 390 wide screen, the screen flagged tall.
    const box = await stageBox(page);
    expect(box.w).toBeGreaterThanOrEqual(389);
    expect(Math.abs(box.h - (box.w * 4) / 3)).toBeLessThanOrEqual(2);
    expect(await peek(page, (w) => w.classicSelect.phoneLayout)).toBe(true);
    await sleep(1500);
    await shot(page, 'select-iphone');

    // A tap on the first empty slot opens the creation (the tap mapping).
    const slot = await firstEmptySlot(page);
    await tapVirtual(page, 221, SLOT_Y[slot] + 19);
    await expect.poll(() => peek(page, (w) => !!w.classicCreate), { timeout: 10_000 }).toBe(true);
    expect(await peek(page, (w) => w.classicCreate.phoneLayout)).toBe(true);
    await sleep(1500);
    await shot(page, 'create-class-iphone');

    await makeCharacter(page);
    // The list is shown again with the new character in its slot.
    await expect.poll(() => slotFilled(page, slot)).toBe(true);
    await shot(page, 'select-after-iphone');
    await enterSlot(page, slot);
    // Ship Select: the tall stage, the 4:3 window in the 640x480 screen, and the
    // touch menu pad (arrows and OK / BACK under the screen, no stick).
    expect(await peek(page, (w) => w.classicShip.phoneLayout)).toBe(true);
    const shipBox = await stageBox(page);
    expect(Math.abs(shipBox.h - (shipBox.w * 4) / 3)).toBeLessThanOrEqual(2);
    await expect(page.locator('.wc-stick-zone')).toBeHidden();
    await expect(page.locator('.wc-dpad')).toBeVisible();
    await expect(page.locator('.wc-actions')).toBeVisible();
    await sleep(1500);
    await shot(page, 'shipselect-iphone');
    await goToLobbyByTap(page);
    await sleep(1500);
    await shot(page, 'lobby-iphone');
    expect(logs.some((l) => l.startsWith('pageerror'))).toBe(false);
  });
});

test.describe('Pixel 7 portrait', () => {
  test.use(PIXEL_7);

  test('the list is a 3:4 box and a tap on an empty slot opens the creation with the form', async ({ page }) => {
    await loginPhone(page);
    const box = await stageBox(page);
    expect(box.w).toBeGreaterThanOrEqual(411);
    expect(Math.abs(box.h - (box.w * 4) / 3)).toBeLessThanOrEqual(2);
    await sleep(1500);
    await shot(page, 'select-pixel');
    const slot = await firstEmptySlot(page);
    await tapVirtual(page, 221, SLOT_Y[slot] + 19);
    await expect.poll(() => peek(page, (w) => !!w.classicCreate), { timeout: 10_000 }).toBe(true);
    await sleep(1500);
    await shot(page, 'create-class-pixel');
    // The class, then the dressing room up to the name step.
    await makeCharacter(page, true);
    await expect(nameRoot(page)).toBeVisible({ timeout: 10_000 });
    await shot(page, 'create-name-pixel');
    await nameRoot(page).locator('.lf-cancel').click();
    await expect(nameRoot(page)).toBeHidden();
    await expect.poll(() => peek(page, (w) => !!w.classicCreate && w.classicCreate.sub === 0)).toBe(true);
  });

  test('ship select is the tall stage with the menu pad; a tap on Go to lobby reaches the lobby', async ({ page }) => {
    await loginPhone(page);
    const box = await stageBox(page);
    expect(Math.abs(box.h - (box.w * 4) / 3)).toBeLessThanOrEqual(2);
    await enterSlot(page, await firstFilledSlot(page));
    expect(await peek(page, (w) => w.classicShip.phoneLayout)).toBe(true);
    await expect(page.locator('.wc-stick-zone')).toBeHidden();
    await expect(page.locator('.wc-dpad')).toBeVisible();
    await sleep(1500);
    await shot(page, 'shipselect-pixel');
    await goToLobbyByTap(page);
    await sleep(1500);
    await shot(page, 'lobby-pixel');
  });
});

test.describe('iPhone 13 landscape', () => {
  test.use(IPHONE_13_LANDSCAPE);

  test('landscape keeps the whole-screen list and creation', async ({ page }) => {
    await loginPhone(page);
    const box = await stageBox(page);
    expect(box.w).toBe(664);
    expect(box.h).toBe(390);
    await sleep(1000);
    await shot(page, 'select-landscape');
    const slot = await firstEmptySlot(page);
    await tapVirtual(page, 221, SLOT_Y[slot] + 19);
    await expect.poll(() => peek(page, (w) => !!w.classicCreate), { timeout: 10_000 }).toBe(true);
    await sleep(1000);
    await shot(page, 'create-class-landscape');
  });

  test('landscape ship select keeps the whole-screen window; a tap on Go to lobby reaches the lobby', async ({ page }) => {
    await loginPhone(page);
    await enterSlot(page, await firstFilledSlot(page));
    expect(await peek(page, (w) => w.classicShip.phoneLayout)).toBe(true);
    const box = await stageBox(page);
    expect(box).toMatchObject({ w: 664, h: 390 });
    await sleep(1500);
    await shot(page, 'shipselect-landscape');
    await goToLobbyByTap(page);
    await sleep(1000);
    await shot(page, 'lobby-landscape');
  });
});

test.describe('desktop', () => {
  test.use(DESKTOP);

  test('desktop keeps the 4:3 list without the tall stage', async ({ page }) => {
    const logs = consoleLog(page);
    await logIn(page, USER, PASSWORD);
    await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
    const box = await stageBox(page);
    expect(box).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(await peek(page, (w) => w.classicSelect.phoneLayout)).toBe(false);
    await sleep(1500);
    await shot(page, 'select-desktop');
    expect(logs.some((l) => l.startsWith('pageerror'))).toBe(false);
  });

  test('desktop ship select keeps the 4:3 window; a click on Go to lobby reaches the lobby', async ({ page }) => {
    const logs = consoleLog(page);
    await logIn(page, USER, PASSWORD);
    await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
    await enterSlot(page, await firstFilledSlot(page));
    expect(await peek(page, (w) => w.classicShip.phoneLayout)).toBe(false);
    await sleep(1500);
    await shot(page, 'shipselect-desktop');
    await goToLobbyByTap(page);
    await sleep(1000);
    await shot(page, 'lobby-desktop');
    expect(logs.some((l) => l.startsWith('pageerror'))).toBe(false);
  });
});
