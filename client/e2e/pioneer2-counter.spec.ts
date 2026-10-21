// Pioneer 2 on the classic page (classic/townfield.ts): create a party, enter
// it, walk to the Hunter's Guild clerk (talk action 1011, quest/town.ts
// counter 4), talk to him and open the quest menu from the counter. Escape
// closes the menu again. The clerk is reached by placing the player in front
// of him (the walk is not under test); the talk is the action button.
//
// Against a local newserv, like the other classic e2e tests (e2e/classic.ts).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

// The local test account of tests/login.live.ts.
const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

test('the Hunter\'s Guild counter opens the quest menu in the classic field', async ({ page }) => {
  const logs = consoleLog(page);
  const name = `pg${Date.now() % 100000}`;

  await test.step('log in', () => logIn(page, USER, PASSWORD));
  await test.step('reach the lobby', () => reachLobby(page));

  await test.step('create a party and enter it', async () => {
    await openPartyMenu(page);
    // Create a PARTY (1) -> EPISODE 1 (0).
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
    // Party Name, then Difficulty (row 3) -> Normal (entry 0), then Registration (row 4).
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
  });

  await test.step('the town hooks are on the field', async () => {
    // Pioneer 2 has its NPCs (the Hunter's Guild clerk is among them).
    expect(await peek(page, (w) => !!w.classicTown && w.classicGame.view.npcs.byAction(1011) !== null)).toBe(true);
  });

  await test.step('talk to the guild clerk', async () => {
    // Two steps in front of him, facing him (talkTarget: within range and in front).
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1011).root.position;
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 8, Math.PI);
    });
    await key(page, 'Enter');
    // The clerk's welcome lines wait for Enter; the categories list follows.
    await expect
      .poll(
        async () => {
          const n = await peek(page, (w) => w.classicTown.ui.lists.length);
          if (n === 0) await key(page, 'Enter');
          return n;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBeGreaterThan(0);
    expect(await peek(page, (w) => w.classicTown.counterOpen)).toBe(true);
    const categories = await peek(page, (w) => w.classicTown.ui.lists[0].items as string[]);
    console.log(`quest categories: ${categories.join(' | ')}`);
    expect(categories.length).toBeGreaterThan(0);
    await test.info().attach('quest-menu', { body: await page.screenshot(), contentType: 'image/png' });
  });

  await test.step('Escape closes the quest menu', async () => {
    await key(page, 'Escape');
    // The clerk's last line waits for Enter, then the counter is free again.
    await expect
      .poll(
        async () => {
          if (await peek(page, (w) => w.classicTown.counterOpen)) await key(page, 'Enter');
          return peek(page, (w) => w.classicTown.counterOpen);
        },
        { timeout: 30_000, intervals: [700] },
      )
      .toBe(false);
  });

  const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  console.log(errors.join('\n'));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
