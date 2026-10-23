// Pioneer 2 on the classic page: a quest started from the Hunter's Guild
// counter (quest/town.ts guild(), quest/run.ts runQuest). Create a party, enter
// it, walk to the guild clerk (talk action 1011), talk to him, take the first
// quest of the first category (Retrieval) with Yes, and check that the quest
// loads and runs (QuestSession started, the floor reloaded, the quest held by
// the town). Then the game is left through the lobby teleporter, which ends
// the quest (QuestTown dispose).
//
// The menus are walked with Enter: each list and each line takes the first
// entry or the Enter that goes on. The walk is not under test: the player is
// placed in front of the clerk.
//
// Against a local newserv, like the other classic e2e tests (e2e/classic.ts).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

// The local test account of tests/login.live.ts.
const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

test('a quest starts from the Hunter\'s Guild counter and runs in the classic field', async ({ page }) => {
  const logs = consoleLog(page);
  const name = `pq${Date.now() % 100000}`;

  await test.step('log in', () => logIn(page, USER, PASSWORD));
  await test.step('reach the lobby', () => reachLobby(page));

  await test.step('create a party and enter it', async () => {
    await openPartyMenu(page);
    // Create a PARTY (1) -> EPISODE 1 (0), the name, Difficulty Normal, Registration.
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
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

  await test.step('talk to the guild clerk and open the quest menu', async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1011) !== null)).toBe(true);
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1011).root.position;
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 8, Math.PI);
    });
    // Talk is the action palette's Middle key (ArrowDown by default), as in the
    // exe (palette slot down, 0x0068c31d); held so a 30 fps poll sees it.
    const talk = async () => {
      await page.keyboard.down('ArrowDown');
      await page.waitForTimeout(150);
      await page.keyboard.up('ArrowDown');
      await page.waitForTimeout(60);
    };
    await talk();
    await expect
      .poll(
        async () => {
          const n = await peek(page, (w) => w.classicTown.ui.lists.length);
          if (n === 0) {
            // The clerk's lines and the counter advance with Enter (Decide); a new talk starts with the Middle key.
            if (await peek(page, (w) => w.classicGame.view.npcs.talking || w.classicTown.counterOpen)) await key(page, 'Enter');
            else await talk();
          }
          return n;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBeGreaterThan(0);
    const categories = await peek(page, (w) => w.classicTown.ui.lists[0].items as string[]);
    console.log(`quest categories: ${categories.join(' | ')}`);
    expect(categories[0]).toBe('Retrieval');
  });

  await test.step('take the first quest of Retrieval with Yes', async () => {
    // Enter picks the cursor's row: the category (Retrieval, row 0), the first
    // quest, the information window, then Yes (row 0 of the yes / no list).
    // The loading line follows; the quest is started by the time it is read.
    await expect
      .poll(
        async () => {
          if (logs.some((l) => /quest ".+" started/.test(l))) return true;
          await key(page, 'Enter');
          return false;
        },
        { timeout: 120_000, intervals: [700] },
      )
      .toBe(true);
    const started = logs.find((l) => /quest ".+" started/.test(l))!;
    console.log(started);
    expect(logs.some((l) => l.includes('quest loaded:'))).toBe(true);
    expect(logs.some((l) => l.includes('quest failed to start'))).toBe(false);
  });

  await test.step('the counter closes and the quest is held by the town', async () => {
    // The loading line waits for Enter; the counter is free once it is read.
    await expect
      .poll(
        async () => {
          if (!(await peek(page, (w) => w.classicTown.counterOpen))) return false;
          await key(page, 'Enter');
          return true;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBe(false);
    const quest = await peek(page, (w) => (w.classicTown.quest ? { name: w.classicTown.quest.name, floor: w.classicGame.view.current?.floor } : null));
    console.log(`quest held: ${JSON.stringify(quest)}`);
    expect(quest).not.toBeNull();
    expect(quest!.name.length).toBeGreaterThan(0);
    // The quest's floors replace the free-play floor (reloadCurrentFloor): the
    // field is loaded again and the game is still running.
    expect(await peek(page, (w) => w.classicGame.game.loading)).toBe(false);
    await test.info().attach('quest-started', { body: await page.screenshot(), contentType: 'image/png' });
  });

  await test.step('leave the game cleanly (the quest ends with it)', async () => {
    await leaveToLobby(page);
    expect(await peek(page, (w) => w.classicTown === undefined)).toBe(true);
  });

  const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  console.log(errors.join('\n'));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
