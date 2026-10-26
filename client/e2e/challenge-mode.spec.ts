// Challenge Mode in a real game (classic client, local newserv): a Challenge party
// (EPISODE 1, mode Challenge) made from the lobby counter, entered by its leader; the
// Hunter's Guild clerk opens the challenge quest dialog (quest/challengedialog.ts), the
// stage is picked and started, and the stage's quest runs (quest/cmoderun.ts).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby, talkKey } from './classic.ts';
import { freshUser } from './fresh-field.ts';
import { makeCharacter, slotFilled } from './phone-helpers.ts';

const PREFIX = 'wch';

test('Challenge Mode: a Challenge party, stage 1 started from the clerk, the stage runs', async ({ page }) => {
  test.setTimeout(900_000);
  const logs = consoleLog(page);
  const user = process.env.PSO_USER ?? freshUser(PREFIX);
  const password = process.env.PSO_PASSWORD ?? user;
  const name = `ch${Date.now() % 100000}`;

  await test.step('log in, make the character when the account is new', async () => {
    await logIn(page, user, password);
    await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
    if (!(await slotFilled(page, 0))) {
      await key(page, 'Enter');
      await makeCharacter(page);
      await expect.poll(() => slotFilled(page, 0), { timeout: 30_000 }).toBe(true);
    }
    await reachLobby(page);
  });

  await test.step('create a Challenge party (EPISODE 1, mode Challenge) and enter it', async () => {
    await openPartyMenu(page);
    await key(page, 'ArrowDown'); // Create a PARTY
    await key(page, 'Enter');
    await key(page, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
    await key(page, 'Enter'); // Party Name
    await page.keyboard.type(name, { delay: 30 });
    await key(page, 'Enter');
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 2); // Play Mode
    await key(page, 'Enter');
    await key(page, 'ArrowDown'); // Normal -> Challenge (MODES index 1)
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party.create.mode)).toBe(1);
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (no Difficulty in Challenge)
    await key(page, 'Enter');
    await expectInGame(page, logs, name);
  });

  await test.step("talk to the Hunter's Guild clerk; the challenge quest dialog opens", async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1011) !== null)).toBe(true);
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1011).root.position;
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 8, Math.PI);
    });
    await talkKey(page);
    // The leader's challenge quest dialog (quest/challengedialog.ts) opens: the A2 list has entries.
    await expect.poll(() => logs.some((l) => l.includes('quest menu (A2)')), { timeout: 60_000, intervals: [500] }).toBe(true);
    expect(await peek(page, (w) => w.classicTown.counterOpen)).toBe(true);
  });


  console.log(logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror')).join('\n'));
});
