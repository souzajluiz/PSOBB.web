// Shared steps of the classic client's e2e tests: log in, reach the lobby and
// open the counter, through the keyboard and the development hooks
// classic/main.ts puts on window (classicTitle, classicSelect, classicShip,
// classicLobby, classicGame).
import { expect, type Page } from '@playwright/test';

export type Win = Record<string, any>;

// Runs `fn` on the page's window (the hooks) and returns its result.
export const peek = <T>(page: Page, fn: (w: Win) => T) => page.evaluate((src) => new Function('w', `return (${src})(w)`)(window), fn.toString()) as Promise<T>;

export async function key(page: Page, k: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(k);
    await page.waitForTimeout(60); // the client reads keys once a 30 fps frame
  }
}

// Talk is the action palette's Middle key (ArrowDown by default), as in the exe (palette slot
// down, 0x0068c31d); Enter is Decide and no longer talks. Held so a 30 fps frame sees it.
export async function talkKey(page: Page): Promise<void> {
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(60);
}

// Moves a cursor with ArrowDown until `at` reports `want` (never presses Enter).
export async function cursorTo(page: Page, at: (w: Win) => number, want: number, max = 8): Promise<void> {
  for (let i = 0; i < max && (await peek(page, at)) !== want; i++) await key(page, 'ArrowDown');
  expect(await peek(page, at)).toBe(want);
}

// Collects the page's console lines and errors.
export function consoleLog(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  return logs;
}

// `query`: the page's query (the Episode 4 client is `ep4`, classic/main.ts).
export async function logIn(page: Page, user: string, password: string, query = 'screen=input'): Promise<void> {
  await page.goto(`/classic.html?${query}`);
  await expect.poll(() => peek(page, (w) => !!w.classicTitle?.flow?.menu?.input && !w.classicTitle.flow.menu.input.anim.animating)).toBe(true);

  // Input UserID: rows 0 UserID, 1 Password, 2 Confirm, 3 Cancel.
  await cursorTo(page, (w) => w.classicTitle.flow.menu.input.row, 0);
  await key(page, 'Enter');
  await key(page, 'Backspace', 20);
  await page.keyboard.type(user, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicTitle.flow.menu.input.row, 1);
  await key(page, 'Enter');
  await page.keyboard.type(password, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicTitle.flow.menu.input.row, 2);
  await key(page, 'Enter');

  // The Login menu: rows 0 Start Game, 1 Exit Game, 2 Patch Download,
  // 3 Register UserID. Start Game is enabled once both fields are set.
  await expect.poll(() => peek(page, (w) => w.classicTitle.flow.menu?.input === null && w.classicTitle.flow.menu.startEnabled)).toBe(true);
  await cursorTo(page, (w) => w.classicTitle.flow.menu.selected, 0);
  await key(page, 'Enter');
}

// From Start Game to the lobby: the character list (slot 0), then the ship
// list (entry 0), then the lobby. The slot must hold a character.
export async function reachLobby(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const at = await peek(page, (w) => (w.classicLobby ? 'lobby' : w.classicShip ? 'ship' : w.classicSelect ? 'select' : 'title'));
        if (at === 'select' && !(await peek(page, (w) => w.__e2eSelected))) {
          await peek(page, (w) => (w.__e2eSelected = true));
          await key(page, 'Enter');
        } else if (at === 'ship' && !(await peek(page, (w) => w.__e2eShip))) {
          await peek(page, (w) => (w.__e2eShip = true));
          await key(page, 'Enter');
        }
        return at;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('lobby');
}

// Stands on the first information counter (the walk is not under test), opens
// it and picks Organize PARTY (root 0).
export async function openPartyMenu(page: Page): Promise<void> {
  await peek(page, (w) => {
    const c = w.classicLobby.hud.infoCols[0];
    w.classicLobby.lobby.self.position.x = c.x;
    w.classicLobby.lobby.self.position.z = c.z;
  });
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.counter.open)).toBe(true);
  await key(page, 'Enter');
}

// The game-entry loading screen (classic/connecting.ts, { status: false }),
// then the field: Pioneer 2 (floor 0) loaded, 6F sent, the lobby gone.
export async function expectInGame(page: Page, logs: string[], name: string): Promise<void> {
  await expect.poll(() => peek(page, (w) => w.classicGameLoading !== undefined || w.classicGame !== undefined), { timeout: 30_000 }).toBe(true);
  await expect
    .poll(() => peek(page, (w) => (w.classicGame ? `${w.classicGame.game.name}:${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}` : '')), { timeout: 60_000 })
    .toBe(`${name}:0:false`);
  // The loading screen ran to its end, and the lobby screen is gone.
  expect(await peek(page, (w) => w.classicGameLoading?.finished === true && w.classicLobby === undefined)).toBe(true);
  expect(logs.some((l) => l.includes(`entered game "${name}"`))).toBe(true);
  expect(logs.some((l) => l.includes('back to the lobby'))).toBe(false);
}

// The lobby teleporter (GameView.onLobbyWarp): 98 / 84 and the lobby again.
export async function leaveToLobby(page: Page): Promise<void> {
  await peek(page, (w) => w.classicGame.view.onLobbyWarp());
  await expect.poll(() => peek(page, (w) => w.classicLobby !== undefined && w.classicGame === undefined), { timeout: 45_000 }).toBe(true);
}
