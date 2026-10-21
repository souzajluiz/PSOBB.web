// The lobby counter's "Create a PARTY" window (classic/gamelist.ts) on the
// classic client, against a local newserv: log in, walk to the counter,
// Organize PARTY -> Create a PARTY -> EPISODE 1, check the Difficulty row and
// its list, register the party, then the game-entry loading screen and the
// field (Pioneer 2), and back to the lobby through the lobby teleporter.
//
// The page is one canvas, so the test drives it with the keyboard and reads
// the screens through the development hooks classic/main.ts puts on window
// (e2e/classic.ts).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

// The local test account of tests/login.live.ts.
const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

test('Create a PARTY: difficulty list, registration, loading screen and the field', async ({ page }) => {
  const logs = consoleLog(page);
  const name = `pw${Date.now() % 100000}`;

  await test.step('log in', () => logIn(page, USER, PASSWORD));
  await test.step('reach the lobby', () => reachLobby(page));

  await test.step('open the counter', async () => {
    await openPartyMenu(page);
    // Create a PARTY (1) -> EPISODE 1 (0).
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
    await page.keyboard.type(name, { delay: 30 });
    await key(page, 'Enter');
    // Difficulty (row 3) -> its list -> entry 0 (a new character can only
    // play the first difficulty: newserv refuses Hard below level 20).
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 3);
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party.create.step)).toBe('difficulty');
    await key(page, 'Enter');
    expect(await peek(page, (w) => w.classicLobby.party.create.difficulty)).toBe(0);
  });

  await test.step('Registration: loading screen, then the field', async () => {
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 4);
    await key(page, 'Enter');
    await expectInGame(page, logs, name);
  });

  await test.step('back to the lobby behind the loading screen', async () => {
    // The return is quick: sample the loading screen's hook every 10 ms, a
    // poll could miss the 98 / 84 window.
    await page.evaluate(() => {
      const hook = window as unknown as { classicLoadingSeen?: boolean };
      hook.classicLoadingSeen = false;
      setInterval(() => {
        if ((window as unknown as { classicGameLoading?: unknown }).classicGameLoading) hook.classicLoadingSeen = true;
      }, 10);
    });
    await peek(page, (w) => w.classicGame.view.onLobbyWarp());
    await expect.poll(() => peek(page, (w) => w.classicLobby !== undefined && w.classicGame === undefined), { timeout: 45_000 }).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { classicLoadingSeen?: boolean }).classicLoadingSeen)).toBe(true);
    expect(logs.some((l) => l.includes('back to the lobby'))).toBe(false);
  });

  const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  console.log(errors.join('\n'));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
