// Challenge Mode in a real game (classic client, local newserv): a Challenge party
// (EPISODE 1, mode Challenge) made from the lobby counter, entered by its leader and a second
// player; the Hunter's Guild clerk opens the challenge quest dialog (quest/challengedialog.ts),
// the stage is picked (Episode 1, Stage1) and started, and the stage's quest runs
// (quest/cmoderun.ts). The start needs two players in the game: the exe's start check
// (unknown_maybe_num_players_to_start_quest, 0x006cba04) gives 2 for a lone player in a
// challenge game, and the yes only starts on 1.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby, talkKey } from './classic.ts';
import { freshUser } from './fresh-field.ts';
import { makeCharacter, slotFilled } from './phone-helpers.ts';

const PREFIX = 'wch';

// A fresh account: logged in at the character select with slot 0 made.
async function freshAccount(page: Page, user: string): Promise<void> {
  await logIn(page, user, user);
  await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
  if (!(await slotFilled(page, 0))) {
    await key(page, 'Enter');
    await makeCharacter(page);
    await expect.poll(() => slotFilled(page, 0), { timeout: 30_000 }).toBe(true);
  }
}

test('Challenge Mode: a Challenge party, stage 1 started from the clerk, the stage runs', async ({ browser }) => {
  test.setTimeout(900_000);
  const ctxA: BrowserContext = await browser.newContext();
  const ctxB: BrowserContext = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const logs = consoleLog(a);
  const logsB = consoleLog(b);
  const user = process.env.PSO_USER ?? freshUser(PREFIX);
  const password = process.env.PSO_PASSWORD ?? user;
  const userB = freshUser('wcb');
  const name = `ch${Date.now() % 100000}`;

  await test.step('log in, make the characters when the accounts are new', async () => {
    await logIn(a, user, password);
    await expect.poll(() => peek(a, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
    if (!(await slotFilled(a, 0))) {
      await key(a, 'Enter');
      await makeCharacter(a);
      await expect.poll(() => slotFilled(a, 0), { timeout: 30_000 }).toBe(true);
    }
    await reachLobby(a);
    await freshAccount(b, userB);
  });

  await test.step('create a Challenge party (EPISODE 1, mode Challenge) and enter it', async () => {
    await openPartyMenu(a);
    await key(a, 'ArrowDown'); // Create a PARTY
    await key(a, 'Enter');
    await key(a, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(a, (w) => w.classicLobby.party?.phase)).toBe('create');
    await key(a, 'Enter'); // Party Name
    await a.keyboard.type(name, { delay: 30 });
    await key(a, 'Enter');
    await cursorTo(a, (w) => w.classicLobby.party.create.row, 2); // Play Mode
    await key(a, 'Enter');
    await key(a, 'ArrowDown'); // Normal -> Challenge (MODES index 1)
    await key(a, 'Enter');
    await expect.poll(() => peek(a, (w) => w.classicLobby.party.create.mode)).toBe(1);
    await cursorTo(a, (w) => w.classicLobby.party.create.row, 4); // Registration (no Difficulty in Challenge)
    await key(a, 'Enter');
    await expectInGame(a, logs, name);
  });

  await test.step('B joins the Challenge party from the list; both are in the game', async () => {
    await reachLobby(b);
    await openPartyMenu(b);
    await key(b, 'Enter'); // Join a PARTY
    await expect.poll(() => peek(b, (w) => w.classicLobby.party?.phase)).toBe('list');
    const names = await peek(b, (w) => w.classicLobby.party.list.entries.map((e: { name: string }) => e.name));
    const index = names.indexOf(name);
    expect(index).toBeGreaterThanOrEqual(0);
    await cursorTo(b, (w) => w.classicLobby.party.list.cursor, index, 0x40);
    await key(b, 'Enter');
    await expectInGame(b, logsB, name);
    await expect.poll(() => peek(a, (w) => w.classicGame.game.players.size)).toBe(2);
  });

  await test.step("the leader talks to the Hunter's Guild clerk; the challenge quest dialog opens", async () => {
    expect(await peek(a, (w) => w.classicGame.view.npcs.byAction(1011) !== null)).toBe(true);
    // The leader stands at the clerk and says where; the second player stands within 50 units of
    // the leader (the start check's xz distance, g_MaxStartDistanceSquared = 2500).
    const at = await peek(a, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1011).root.position;
      const x = p.x;
      const y = p.y;
      const z = p.z + 8;
      v.placePlayer(w.classicGame.game.selfId, x, y, z, Math.PI);
      const me = w.classicGame.game.self;
      me.position = { x, y, z };
      me.angle = Math.PI;
      w.classicGame.game.sendSetPosition();
      return { x, y, z };
    });
    await expect.poll(() => peek(b, (w) => w.classicGame.game.self !== undefined), { timeout: 30_000 }).toBe(true);
    await b.evaluate((p) => {
      const w = window as any;
      const g = w.classicGame.game;
      const x = p.x + 10;
      g.self.position = { x, y: p.y, z: p.z };
      g.self.angle = Math.PI;
      w.classicGame.view.placePlayer(g.selfId, x, p.y, p.z, Math.PI);
      g.sendSetPosition();
    }, at);
    await expect
      .poll(() => peek(a, (w) => { const p = w.classicGame.game.players.get(1); return p ? Math.hypot(p.position.x - w.classicGame.game.players.get(0).position.x, p.position.z - w.classicGame.game.players.get(0).position.z) : -1; }), { timeout: 30_000 })
      .toBeLessThan(50);
    await talkKey(a);
    // The leader's challenge quest dialog (quest/challengedialog.ts) opens: the A2 list has entries.
    await expect.poll(() => logs.some((l) => l.includes('quest menu (A2)')), { timeout: 60_000, intervals: [500] }).toBe(true);
    expect(await peek(a, (w) => w.classicTown.counterOpen)).toBe(true);
  });

  await test.step('the leader picks Episode 1, then Stage1, and says Yes', async () => {
    const state = () => peek(a, (w) => {
      const d = w.classicTown.challengeDlg;
      return d ? { level: d.level, proc: d.proc, names: d.names(), confirming: d.confirming, codes: d.menuCodes.slice(), started: d.started } : null;
    });
    // Level 0: the episode list (Challenge (Episode 1) first).
    await expect.poll(async () => (await state())?.names?.[0] ?? '', { timeout: 30_000 }).toMatch(/Episode 1/);
    await key(a, 'Enter');
    // Level 1: the stage list.
    await expect.poll(async () => (await state())?.level, { timeout: 30_000 }).toBe(1);
    await expect.poll(async () => (await state())?.names?.[0] ?? '', { timeout: 30_000 }).toMatch(/Stage1/);
    await key(a, 'Enter');
    // Level 2: the Stage1 entry's description; its Enter opens the yes / no (its cursor starts on Yes).
    await expect.poll(async () => (await state())?.level, { timeout: 30_000 }).toBe(2);
    // The Enter counts only in the list state (proc 3): wait for the description (A3) to arrive.
    await expect.poll(async () => (await state())?.proc, { timeout: 30_000 }).toBe(3);
    await key(a, 'Enter');
    await expect.poll(async () => (await state())?.confirming, { timeout: 30_000 }).toBe(true);
    // The dialog object is dropped by town.ts (challengeDlg is nulled when the dialog's loop ends
    // after a start), so keep a reference to read its `started` flag after the yes.
    await peek(a, (w) => { w.__dlg = w.classicTown.challengeDlg; return 0; });
    await key(a, 'Enter');
    await expect.poll(() => peek(a, (w) => w.__dlg?.started === true), { timeout: 30_000 }).toBe(true);
    console.log(`dialog codes: ${JSON.stringify(await peek(a, (w) => w.__dlg.menuCodes.slice()))}`);
  });

  await test.step('the quest is loaded and started; the leader stands on the stage floor', async () => {
    await expect.poll(() => logs.some((l) => /quest "Stage1" started/.test(l)), { timeout: 120_000, intervals: [500] }).toBe(true);
    await expect
      .poll(() => peek(a, (w) => w.classicTown.counterOpen === false && w.classicGame.view.current?.floor !== 0), { timeout: 120_000, intervals: [500] })
      .toBe(true);
    console.log(logs.filter((l) => /quest|challenge|cmode|cm:|stage/i.test(l)).slice(-30).join('\n'));
  });

  console.log(logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror')).join('\n'));
});
