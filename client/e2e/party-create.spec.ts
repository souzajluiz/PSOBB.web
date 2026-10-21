// The lobby counter's "Create a PARTY" window (classic/gamelist.ts) on the
// classic client, against a local newserv: log in, walk to the counter,
// Organize PARTY -> Create a PARTY -> EPISODE 1, check the Difficulty row and
// its list, register the party and see where the client ends up.
//
// The page is one canvas, so the test drives it with the keyboard and reads
// the screens through the development hooks classic/main.ts puts on window
// (classicTitle, classicSelect, classicShip, classicLobby).
import { expect, test, type Page } from '@playwright/test';

// The local test account of tests/login.live.ts.
const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

type Win = Record<string, any>;

// Runs `fn` on the page's window (the hooks) and returns its result.
const peek = <T>(page: Page, fn: (w: Win) => T) => page.evaluate((src) => new Function('w', `return (${src})(w)`)(window), fn.toString()) as Promise<T>;

async function key(page: Page, k: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(k);
    await page.waitForTimeout(60); // the client reads keys once a 30 fps frame
  }
}

// Moves a cursor with ArrowDown until `at` reports `want` (never presses Enter).
async function cursorTo(page: Page, at: (w: Win) => number, want: number, max = 8): Promise<void> {
  for (let i = 0; i < max && (await peek(page, at)) !== want; i++) await key(page, 'ArrowDown');
  expect(await peek(page, at)).toBe(want);
}

async function logIn(page: Page): Promise<void> {
  await page.goto('/classic.html?screen=input');
  await expect.poll(() => peek(page, (w) => !!w.classicTitle?.flow?.menu?.input && !w.classicTitle.flow.menu.input.anim.animating)).toBe(true);

  // Input UserID: rows 0 UserID, 1 Password, 2 Confirm, 3 Cancel.
  await cursorTo(page, (w) => w.classicTitle.flow.menu.input.row, 0);
  await key(page, 'Enter');
  await key(page, 'Backspace', 20);
  await page.keyboard.type(USER, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicTitle.flow.menu.input.row, 1);
  await key(page, 'Enter');
  await page.keyboard.type(PASSWORD, { delay: 30 });
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
// list (entry 0), then the lobby.
async function reachLobby(page: Page): Promise<void> {
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

test('Create a PARTY: difficulty list and registration', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

  await test.step('log in', () => logIn(page));
  await test.step('reach the lobby', () => reachLobby(page));

  await test.step('open the counter', async () => {
    // Stand on the first information counter (the walk is not under test).
    await peek(page, (w) => {
      const c = w.classicLobby.hud.infoCols[0];
      w.classicLobby.lobby.self.position.x = c.x;
      w.classicLobby.lobby.self.position.z = c.z;
    });
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.counter.open)).toBe(true);
    // Organize PARTY (root 0) -> Create a PARTY (1) -> EPISODE 1 (0).
    await key(page, 'Enter');
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
  });

  await test.step('Difficulty row and list', async () => {
    const labels = await peek(page, (w) => {
      const t11 = (i: number) => w.classicLobby.party.text.t11(i);
      return { row: t11(0x63), modes: [0, 1, 2, 3].map((m) => t11(0x139 + m)), names: [0, 1, 2, 3].map((d) => t11(0x13d + d)) };
    });
    // The exe's indices (0x00734578 / 0x00734628) on the text the page loaded:
    // all four difficulties are listed, whatever the character's level.
    expect(labels.row).toBe('Difficulty');
    expect(labels.modes).toEqual(['Normal', 'Challenge', 'Battle', 'One Person']);
    expect(labels.names).toEqual(['Normal', 'Hard', 'Very Hard', 'Ultimate']);

    // Party Name first: Registration needs it.
    await key(page, 'Enter');
    await page.keyboard.type('pwtest', { delay: 30 });
    await key(page, 'Enter');
    // Difficulty (row 3) -> its list -> entry 0 (a new character can only
    // play the first difficulty: newserv refuses Hard below level 20).
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 3);
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party.create.step)).toBe('difficulty');
    await key(page, 'Enter');
    expect(await peek(page, (w) => w.classicLobby.party.create.difficulty)).toBe(0);
  });

  await test.step('Registration', async () => {
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 4);
    await key(page, 'Enter');
    // The client creates the game, then (no field scene yet) leaves it and
    // shows the lobby again: classic/main.ts partyHost.back.
    await expect
      .poll(() => logs.find((l) => l.includes('entered game "pwtest"')) ?? '', { timeout: 30_000 })
      .toContain('the classic field is not implemented');
    await expect.poll(() => peek(page, (w) => w.classicLobby !== undefined)).toBe(true);
  });

  const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  console.log(errors.join('\n'));
});
