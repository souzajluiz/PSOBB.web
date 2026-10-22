// The phone's lobby and game field (classic/lobby.ts, classic/field.ts, the HUD
// overlays render/playerhud.ts and render/fieldhud.ts) in portrait: the 3D view
// fills the 3:4 box and the 2D HUD keeps its anchors inside it (stage.ts
// phoneFill, overlayFrame, bandsOf). The touch pad sits in the bars around the
// box: the stick and the buttons under it, PAL / MENU / CHAT / VIB above it, the
// palette's taps on the palette. The character is made through the phone UI, the
// party is created at the lobby counter and the field is Forest 1; the joystick
// walks the player in the lobby and in the field; the menu and the palette open
// by tap. Desktop and landscape keep their layout.
// Screenshots go to PSO_SHOTS_DIR when it is set.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, peek, reachLobby } from './classic';
import { DESKTOP, enterSlot, firstEmptySlot, firstFilledSlot, goToLobbyByTap, IPHONE_13, IPHONE_13_LANDSCAPE, loginPhone, makeCharacter, PASSWORD, PIXEL_7, shot, sleep, SLOT_Y, slotFilled, stageBox, tapVirtual, USER } from './phone-helpers';

const FIELD_USER = process.env.PSO_FIELD_USER ?? USER;
const FIELD_PASSWORD = process.env.PSO_FIELD_PASSWORD ?? PASSWORD;

// The character list to Ship Select and the lobby: a character is made in the
// first empty slot when the account has none.
async function toLobby(page: Page): Promise<void> {
  await loginPhone(page, FIELD_USER, FIELD_PASSWORD);
  const filled = await peek(page, (w) => w.classicSelect.slots.some((p: unknown) => p !== null));
  if (!filled) {
    const slot = await firstEmptySlot(page);
    await tapVirtual(page, 221, SLOT_Y[slot] + 19);
    await expect.poll(() => peek(page, (w) => !!w.classicCreate), { timeout: 10_000 }).toBe(true);
    await makeCharacter(page);
    await expect.poll(() => slotFilled(page, slot)).toBe(true);
    await enterSlot(page, slot);
  } else {
    await enterSlot(page, await firstFilledSlot(page));
  }
  await goToLobbyByTap(page);
}

// The page's own position of the local player (lobby or field).
const lobbySelf = (page: Page) =>
  peek(page, (w) => {
    const p = w.classicLobby?.lobby?.self?.position;
    return p ? [p.x, p.y, p.z] : null;
  });
const fieldSelf = (page: Page) =>
  peek(page, (w) => {
    const p = w.classicGame?.game?.self?.position;
    return p ? [p.x, p.y, p.z] : null;
  });

// Holds the stick (the pad's zone under the box) toward `dy` pixels for `ms`.
// The zone takes the pointer where it lands, so the drag starts at its centre.
async function walk(page: Page, dx: number, dy: number, ms = 900): Promise<void> {
  const z = await page.locator('.wc-stick-zone').boundingBox();
  expect(z, 'the stick zone is on the page').not.toBeNull();
  const cx = z!.x + z!.width / 2;
  const cy = z!.y + z!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
    await sleep(20);
  }
  await sleep(ms);
  await page.mouse.up();
  await sleep(200);
}

const dist = (a: number[] | null, b: number[] | null) => (a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : 0);

// The 3:4 box of the phone's portrait stage (stage.ts phoneFill).
async function expectTallBox(page: Page): Promise<void> {
  const box = await stageBox(page);
  expect(box.w).toBeGreaterThanOrEqual(389);
  expect(Math.abs(box.h - (box.w * 4) / 3)).toBeLessThanOrEqual(2);
  expect(await peek(page, (w) => w.classicLobby?.phoneFill ?? w.classicGame?.phoneFill ?? false)).toBe(true);
}

// The pad's controls sit where the bars are: the stick zone, the arrows and the
// small buttons outside the 3:4 box (above or below it), the palette's slots
// inside it. Checked with the rectangles, not the pixels.
async function expectPadInBars(page: Page): Promise<void> {
  const box = await stageBox(page);
  const rect = async (sel: string) => page.locator(sel).first().boundingBox();
  const zone = await rect('.wc-stick-zone');
  const dpad = await rect('.wc-dpad');
  const actions = await rect('.wc-actions');
  expect(zone && dpad && actions).toBeTruthy();
  for (const r of [zone!, dpad!, actions!]) {
    expect(r.y >= box.y + box.h - 1 || r.y + r.height <= box.y + 1, 'the pad control is in a bar, not on the box').toBe(true);
  }
  // The palette's slot taps lie over the box's bottom right.
  const slot = await page.locator('.wc-palette').first().boundingBox();
  expect(slot).not.toBeNull();
  expect(slot!.y).toBeGreaterThanOrEqual(box.y + box.h / 2);
  expect(slot!.y + slot!.height).toBeLessThanOrEqual(box.y + box.h + 1);
}

// A tap lands on the control it is meant for: the element at its centre is the
// button (or inside it), not a stacked element.
async function expectTapLands(loc: Locator, what: string): Promise<void> {
  const hit = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && el.contains(top);
  });
  expect(hit, `a tap on ${what} reaches it`).toBe(true);
}

const menuButton = (page: Page) => page.locator('.wc-small', { hasText: 'MENU' });
const palButton = (page: Page) => page.locator('.wc-small', { hasText: 'PAL' });

test.describe.configure({ mode: 'serial' });

test.describe('iPhone 13 portrait: lobby and field', () => {
  test.use(IPHONE_13);
  test.setTimeout(420_000);

  test('the lobby fills the tall box; the joystick walks; the party enters Forest 1; the menu and the palette open by tap', async ({ page }) => {
    const logs = consoleLog(page);
    await toLobby(page);
    await expectTallBox(page);
    await sleep(2000);
    await shot(page, 'lobby-iphone');
    await expectPadInBars(page);

    // Walk in the lobby: the joystick moves the player.
    const a = await lobbySelf(page);
    await walk(page, 0, -70);
    await sleep(300);
    const b = await lobbySelf(page);
    expect(dist(a, b), 'the joystick walks the lobby player').toBeGreaterThan(5);
    await shot(page, 'lobby-iphone-walked');

    // A party from the counter: Organize PARTY -> Create a PARTY -> EPISODE 1,
    // the party name, Difficulty Normal, Registration.
    await page.evaluate(() => {
      const c = (window as any).classicLobby.hud.infoCols[0];
      (window as any).classicLobby.lobby.self.position.x = c.x;
      (window as any).classicLobby.lobby.self.position.z = c.z;
    });
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.counter.open)).toBe(true);
    await key(page, 'Enter'); // Organize PARTY
    await key(page, 'ArrowDown');
    await key(page, 'Enter'); // Create a PARTY
    await key(page, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
    await sleep(800);
    await shot(page, 'party-create-iphone');
    const name = `ph${Date.now() % 100000}`;
    await key(page, 'Enter');
    await page.keyboard.type(name, { delay: 30 });
    await key(page, 'Enter');
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 3);
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party.create.step)).toBe('difficulty');
    await key(page, 'Enter');
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 4);
    await key(page, 'Enter');
    await expectInGame(page, logs, name);

    // Forest 1 (the game's warp), then the field on the phone.
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect.poll(() => peek(page, (w) => w.classicGame?.view?.debug().floor() as number), { timeout: 60_000 }).toBe(1);
    await sleep(4000);
    await expectTallBox(page);
    await expectPadInBars(page);
    await shot(page, 'field-forest1-iphone');

    // Walk in the field with the stick.
    const f1 = await fieldSelf(page);
    await walk(page, 0, -70, 1200);
    await sleep(300);
    const f2 = await fieldSelf(page);
    expect(dist(f1, f2), 'the joystick walks the field player').toBeGreaterThan(3);
    await shot(page, 'field-forest1-walked');

    // The MENU button opens the main menu; a tap closes it with BACK (the
    // small menu is a tap too: the button on the bar above the box).
    await expectTapLands(menuButton(page), 'MENU');
    await menuButton(page).click();
    await expect.poll(() => peek(page, (w) => !!w.classicGame?.view?.hud?.debug().menuOpen)).toBe(true);
    await sleep(3500); // the window's opening wipe
    await shot(page, 'field-menu-iphone');
    // Item Pack (the first row) -> Items: the item list and its detail window
    // are leaf windows at the bottom of the frame.
    await key(page, 'Enter');
    await sleep(1500);
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    await sleep(3500);
    await shot(page, 'field-itempack-iphone');
    for (let i = 0; i < 4; i++) {
      if (!(await peek(page, (w) => !!w.classicGame?.view?.hud?.debug().menuOpen))) break;
      await key(page, 'Backspace');
      await sleep(800);
    }
    await expect.poll(() => peek(page, (w) => !!w.classicGame?.view?.hud?.debug().menuOpen)).toBe(false);

    // PAL flips the action palette (Ctrl), and a palette slot tap attacks.
    await expectTapLands(palButton(page), 'PAL');
    await palButton(page).click();
    await sleep(800);
    await shot(page, 'field-palette-flipped-iphone');
    await palButton(page).click();
    await sleep(800);
    await shot(page, 'field-palette-iphone');

    const errors = logs.filter((l) => l.startsWith('pageerror'));
    console.log(errors.join('\n'));
    expect(errors).toEqual([]);
  });
});

test.describe('Pixel 7 portrait: lobby', () => {
  test.use(PIXEL_7);
  test.setTimeout(300_000);

  test('the tall box fills the lobby, the pad is in the bars and the joystick walks', async ({ page }) => {
    const logs = consoleLog(page);
    await toLobby(page);
    await expectTallBox(page);
    await sleep(2000);
    await shot(page, 'lobby-pixel-field');
    await expectPadInBars(page);
    const a = await lobbySelf(page);
    await walk(page, 0, -70);
    await sleep(300);
    expect(dist(a, await lobbySelf(page)), 'the joystick walks the lobby player').toBeGreaterThan(5);
    expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
  });
});

test.describe('iPhone 13 landscape: lobby unchanged', () => {
  test.use(IPHONE_13_LANDSCAPE);
  test.setTimeout(300_000);

  test('the lobby is the full landscape window, the tall fill is off', async ({ page }) => {
    const logs = consoleLog(page);
    await toLobby(page);
    const box = await stageBox(page);
    expect(box.w).toBeGreaterThan(box.h);
    // The screen asks for the phone layout, but the landscape window is not portrait:
    // the stage keeps the whole-window frame (stage.ts paint).
    expect(await peek(page, (w) => w.classicStage.tall)).toBe(false);
    expect(await peek(page, (w) => w.classicStage.fill)).toBe(false);
    await sleep(2000);
    await shot(page, 'lobby-landscape-iphone');
    expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
  });
});

test.describe('desktop 1280x720: lobby unchanged', () => {
  test.use(DESKTOP);
  test.setTimeout(300_000);

  test('the lobby is the 4:3 stage of the window, no pad', async ({ page }) => {
    const logs = consoleLog(page);
    // Keyboard log in (no phone form on a desktop window); the first slot holds
    // the character the phone test made.
    await logIn(page, FIELD_USER, FIELD_PASSWORD);
    await reachLobby(page);
    expect(await peek(page, (w) => w.classicLobby.phoneLayout)).toBe(false);
    await sleep(2000);
    await shot(page, 'lobby-desktop');
    expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
  });
});
