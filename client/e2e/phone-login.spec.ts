// The phone login (classic/title.ts, classic/loginform.ts, stage.ts tallLayout):
// in portrait the title stage is a tall 3:4 box with the screen scaled to its
// width; the Input UserID window is an HTML form (user name, password, Confirm,
// Cancel) over the title. Desktop and landscape keep the canvas window.
// Phones are emulated (isMobile, hasTouch: the pointer is coarse). The login
// is the same as the canvas one: the Login menu takes the form's result, Start
// Game logs in, and the character list opens.
import { devices, expect, test, type Page } from '@playwright/test';
import { consoleLog, key, peek } from './classic';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

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

// The stage's CSS box (classic.html's #stage canvas).
async function stageBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const r = document.getElementById('stage')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

// The title is up and its fade-in is done (the Enter key starts the menu).
async function openTitle(page: Page, query = ''): Promise<void> {
  await page.goto(`/classic.html${query}`);
  await expect.poll(() => peek(page, (w) => !!w.classicTitle?.flow?.enabled), { timeout: 60_000 }).toBe(true);
}

// Title -> Login menu -> Input UserID (rows of the Login menu: 0 Start Game,
// 1 Exit Game, 2 Patch Download, 3 Register UserID... the Login menu's row 3 is
// Input UserID when no login is set: the cursor is moved by key presses).
// The Login menu opens with its animation; keys are ignored while it runs.
async function openInputUserId(page: Page): Promise<void> {
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => !!w.classicTitle.flow.menu && !w.classicTitle.flow.menu.anim.animating)).toBe(true);
  // Row 3 of the Login menu opens Input UserID; move the cursor down to it.
  for (let i = 0; i < 6; i++) {
    const at = await peek(page, (w) => w.classicTitle.flow.menu.selected);
    if (at === 3) break;
    await key(page, 'ArrowDown');
  }
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => !!w.classicTitle.flow.menu?.input && !w.classicTitle.flow.menu.input.anim.animating)).toBe(true);
}

test.describe('iPhone 13 portrait', () => {
  test.use(IPHONE_13);

  test('the stage is a tall box, the login is an HTML form and logs in to the character list', async ({ page }) => {
    const logs = consoleLog(page);
    await openTitle(page);

    // A 3:4 stage box over the 390 wide screen: the whole 640x480 screen is
    // scaled to the width (tallLayout), nothing cropped; the bars are filled.
    const box = await stageBox(page);
    expect(box.w).toBeGreaterThanOrEqual(389);
    expect(Math.abs(box.h - (box.w * 4) / 3)).toBeLessThanOrEqual(2);
    expect(box.w / 640).toBeGreaterThan(0.6);
    expect(await peek(page, (w) => w.classicTitle.phoneLayout)).toBe(true);

    await openInputUserId(page);
    const form = page.locator('.lf-root');
    await expect(form).toBeVisible();
    // No canvas window under the form; the form takes the keys.
    expect(await peek(page, (w) => !!w.classicTitle.flow.menu.input)).toBe(true);

    // Large, masked, touch-sized fields with the game's labels.
    const userField = page.locator('.lf-root input[name=userid]');
    const passwordField = page.locator('.lf-root input[name=password]');
    await expect(userField).toBeVisible();
    expect(await passwordField.getAttribute('type')).toBe('password');
    expect(parseFloat(await passwordField.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    expect(parseFloat(await userField.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    const confirm = page.locator('.lf-ok');
    const cb = await confirm.boundingBox();
    expect(cb!.height).toBeGreaterThanOrEqual(44);

    // Confirm stays greyed until both fields hold something; Enter in the
    // UserID field moves on to the password.
    await userField.fill(USER);
    await expect(confirm).toHaveClass(/lf-off/);
    await userField.press('Enter');
    await expect(passwordField).toBeFocused();
    await passwordField.fill(PASSWORD);
    await expect(confirm).not.toHaveClass(/lf-off/);

    // Enter in the password field submits (the same result as Confirm).
    await passwordField.press('Enter');
    await expect(form).toBeHidden();
    await expect
      .poll(() => peek(page, (w) => w.classicTitle.flow.menu?.input === null && w.classicTitle.flow.menu.creds.user))
      .toBe(USER);
    expect(await peek(page, (w) => w.classicTitle.flow.menu.startEnabled)).toBe(true);
    // The canvas has the keys again.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('stage');

    // Start Game (row 0): the login runs and the character list opens.
    for (let i = 0; i < 6; i++) {
      if ((await peek(page, (w) => w.classicTitle.flow.menu.selected)) === 0) break;
      await key(page, 'ArrowUp');
    }
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
    expect(logs.some((l) => l.startsWith('pageerror'))).toBe(false);
  });

  test('Cancel closes the form; the saved user name is filled in', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('psobb.username', 'savedtester');
      } catch {
        // storage blocked
      }
    });
    await openTitle(page);
    await openInputUserId(page);
    const form = page.locator('.lf-root');
    await expect(form).toBeVisible();
    await expect(page.locator('.lf-root input[name=userid]')).toHaveValue('savedtester');
    await expect(page.locator('.lf-root input[name=password]')).toHaveValue('');
    await page.locator('.lf-cancel').click();
    await expect(form).toBeHidden();
    await expect.poll(() => peek(page, (w) => w.classicTitle.flow.menu?.input === null)).toBe(true);
    expect(await peek(page, (w) => w.classicTitle.flow.menu.creds.user)).toBe('savedtester');
  });

  test('the form stays on the visible viewport when the on-screen keyboard shrinks it', async ({ page }) => {
    await openTitle(page);
    await openInputUserId(page);
    const form = page.locator('.lf-root');
    await expect(form).toBeVisible();
    // A keyboard takes the lower part of the screen: the visual viewport is
    // shorter and the form is placed in what is left.
    await page.setViewportSize({ width: 390, height: 330 });
    await expect.poll(async () => Math.round((await form.boundingBox())?.height ?? 0)).toBeLessThanOrEqual(331);
    await page.locator('.lf-root input[name=password]').focus();
    const pw = await page.locator('.lf-root input[name=password]').boundingBox();
    expect(pw!.y).toBeGreaterThanOrEqual(0);
    expect(pw!.y + pw!.height).toBeLessThanOrEqual(330);
    await page.locator('.lf-cancel').click();
    await expect(form).toBeHidden();
  });
});

test.describe('Pixel 7 portrait', () => {
  test.use(PIXEL_7);

  test('the stage is a tall box and the Input UserID form opens', async ({ page }) => {
    await openTitle(page);
    const box = await stageBox(page);
    expect(box.w).toBeGreaterThanOrEqual(411);
    expect(Math.abs(box.h - (box.w * 4) / 3)).toBeLessThanOrEqual(2);
    await openInputUserId(page);
    await expect(page.locator('.lf-root')).toBeVisible();
    await page.locator('.lf-cancel').click();
    await expect(page.locator('.lf-root')).toBeHidden();
  });
});

test.describe('iPhone 13 landscape', () => {
  test.use(IPHONE_13_LANDSCAPE);

  test('landscape keeps the whole-screen stage and the form login', async ({ page }) => {
    await openTitle(page);
    const box = await stageBox(page);
    expect(box.w).toBe(664);
    expect(box.h).toBe(390);
    expect(await peek(page, (w) => w.classicTitle.phoneLayout)).toBe(true);
    await openInputUserId(page);
    await expect(page.locator('.lf-root')).toBeVisible();
    await page.locator('.lf-cancel').click();
    await expect(page.locator('.lf-root')).toBeHidden();
  });
});

test.describe('desktop', () => {
  test.use(DESKTOP);

  test('desktop keeps the canvas Input UserID window and no form', async ({ page }) => {
    await openTitle(page);
    const box = await stageBox(page);
    expect(box).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(await peek(page, (w) => w.classicTitle.phoneLayout)).toBe(false);
    await openInputUserId(page);
    expect(await page.locator('.lf-root').count()).toBe(0);
    expect(await peek(page, (w) => !!w.classicTitle.flow.menu?.input)).toBe(true);
    // The canvas window is drawn: its Cancel row (row 3) closes it.
    // Row 2 (Confirm) is skipped while it is greyed out, so count on the row.
    for (let i = 0; i < 4; i++) {
      if ((await peek(page, (w) => w.classicTitle.flow.menu.input.row)) === 3) break;
      await key(page, 'ArrowDown');
    }
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicTitle.flow.menu?.input === null), { timeout: 10_000 }).toBe(true);
  });
});
