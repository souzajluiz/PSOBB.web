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
import { expect, test } from '@playwright/test';
import { consoleLog, logIn, peek } from './classic';
import { goToLobbyByTap, enterSlot, firstEmptySlot, firstFilledSlot, loginPhone, makeCharacter, nameRoot, PASSWORD, shot, sleep, slotFilled, SLOT_Y, stageBox, tapVirtual, USER, IPHONE_13, PIXEL_7, IPHONE_13_LANDSCAPE, DESKTOP } from './phone-helpers';

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
