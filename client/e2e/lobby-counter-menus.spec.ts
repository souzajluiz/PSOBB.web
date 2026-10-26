// The lobby information counter's Transport and Team menus (classic/counter.ts,
// classic/lobby.ts transport() and the team wiring, classic/teammenu.ts) against a
// local newserv:
//   - Transport > Change BLOCK: newserv has no blocks, so the ship list comes back
//     (classicShip); Enter on the ship rebuilds the lobby (a new lobby object).
//   - Team with no team: Create Team is enabled, Ranking / Master Menu / Leave Team
//     are greyed. Create Team > name > Registration > Yes makes the team, and the
//     membership (12EA) turns master.
//   - Team as the master: Ranking, Master Menu enabled; Create and Leave greyed.
//     Master Menu: Member Expulsion, Dissolve Team; Dissolve > Yes ends the team and
//     the local membership clears (the 12EA newserv sends to the master after 10EA).
//
// Not covered: Leave Team as a non-master member (needs a second member in the team;
// the master cannot leave, and Member Expulsion needs a second member too).
//
// The page is one canvas: keys go in through the keyboard, state is read through the
// development hooks on window (e2e/classic.ts).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, key, logIn, peek, reachLobby, type Win } from './classic.ts';

// The local test account of tests/login.live.ts (a character in slot 0).
const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

// Root rows of the counter (classic/counter.ts): Organize PARTY 0, Transport 1, Team 2.
const ROOT_TRANSPORT = 1;
const ROOT_TEAM = 2;
// Transport rows: Change SHIP 0, Change BLOCK 1.
const TRANSPORT_BLOCK = 1;
// Team rows: Create Team 0, Ranking 1, Master Menu 2, Leave Team 3.
const TEAM_CREATE = 0;
const TEAM_MASTER = 2;
// Master Menu rows (teammenu.ts openMaster): Dissolve Team 4; Master Transfer 3 is greyed.
const MASTER_DISSOLVE = 4;

type Page = import('@playwright/test').Page;

// The counter's top menu cursor and its disabled rows (the team rows come from lobby.ts).
const topCursor = (page: Page) => peek(page, (w: Win) => w.classicLobby.counter.stack.at(-1).cursor as number);
const topDisabled = (page: Page) => peek(page, (w: Win) => (w.classicLobby.counter.stack.at(-1).menu.disabled?.() ?? []) as boolean[]);
const depth = (page: Page) => peek(page, (w: Win) => w.classicLobby.counter.stack.length as number);
const inTeam = (page: Page) => peek(page, (w: Win) => {
  const m = w.classicLobby.hud.team.membership();
  return (m.masterGuildCard | m.teamId | m.unknownA5 | m.unknownA6) !== 0;
});
const teamPhase = (page: Page) => peek(page, (w: Win) => (w.classicLobby.team?.phase?.kind ?? null) as string | null);
const teamOpen = (page: Page) => peek(page, (w: Win) => !!w.classicLobby.team?.open);

// Walks onto the first information counter (the walk is not under test) and opens it.
async function openCounter(page: Page): Promise<void> {
  await peek(page, (w: Win) => {
    const c = w.classicLobby.hud.infoCols[0];
    w.classicLobby.lobby.self.position.x = c.x;
    w.classicLobby.lobby.self.position.z = c.z;
  });
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w: Win) => w.classicLobby.counter.open)).toBe(true);
}

// Moves the top menu's cursor to `row` and decides on it.
async function chooseRow(page: Page, row: number): Promise<void> {
  await cursorTo(page, (w: Win) => w.classicLobby.counter.stack.at(-1).cursor, row);
  await key(page, 'Enter');
}

// Escape backs out of the counter's menus until it is closed.
async function closeCounter(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      if (await peek(page, (w: Win) => w.classicLobby.counter.open)) await key(page, 'Escape');
      return peek(page, (w: Win) => w.classicLobby.counter.open);
    }, { timeout: 30_000, intervals: [300] })
    .toBe(false);
}

// A Question (classic/teammenu.ts) starts on No; Yes is cursor 0.
async function answerYes(page: Page): Promise<void> {
  await key(page, 'ArrowUp');
  await key(page, 'Enter');
}

// Waits for a notice (an info window) and continues past it.
async function continueNotice(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      if ((await teamPhase(page)) === 'notice') await key(page, 'Enter');
      return teamOpen(page);
    }, { timeout: 30_000, intervals: [400] })
    .toBe(false);
}

// Master > Dissolve Team > Yes: the team ends, and the local membership clears.
async function dissolveAsMaster(page: Page): Promise<void> {
  await openCounter(page);
  await chooseRow(page, ROOT_TEAM);
  await chooseRow(page, TEAM_MASTER);
  await expect.poll(() => teamPhase(page)).toBe('master');
  await cursorTo(page, (w: Win) => w.classicLobby.team.phase.list.cursor, MASTER_DISSOLVE);
  await key(page, 'Enter');
  await expect.poll(() => teamPhase(page)).toBe('dissolveConfirm');
  await answerYes(page);
  await expect.poll(() => teamPhase(page), { timeout: 30_000 }).toBe('notice');
  await continueNotice(page);
  // The 12EA newserv sends after 10EA (zeroed membership) clears the local membership.
  await expect.poll(() => inTeam(page), { timeout: 15_000 }).toBe(false);
}

test('the counter Transport and Team menus: block and ship change, create, master menu, dissolve', async ({ page }) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  const name = `wt${Date.now().toString(36).slice(-7)}`; // team names: letters and digits

  await test.step('log in and reach the lobby', async () => {
    await logIn(page, USER, PASSWORD);
    await reachLobby(page);
  });

  await test.step('Transport > Change BLOCK: the ship list, then the lobby again', async () => {
    await openCounter(page);
    await chooseRow(page, ROOT_TRANSPORT);
    expect(await depth(page)).toBe(2);
    // Remember the lobby object: a change of transport makes a new one.
    await peek(page, (w: Win) => (w.__e2eLobbyBefore = w.classicLobby));
    await chooseRow(page, TRANSPORT_BLOCK);
    await expect.poll(() => peek(page, (w: Win) => !!w.classicShip), { timeout: 30_000 }).toBe(true);
    // The ship list takes input after its fade-in; Enter on its entry 0 (Go to lobby)
    // is repeated while the answer is pending (a busy screen ignores it).
    await page.waitForTimeout(1000);
    await expect
      .poll(async () => {
        if (await peek(page, (w: Win) => !!w.classicShip && w.classicLobby === w.__e2eLobbyBefore)) await key(page, 'Enter');
        return peek(page, (w: Win) => !!w.classicLobby && w.classicLobby !== w.__e2eLobbyBefore);
      }, { timeout: 90_000, intervals: [2000] })
      .toBe(true);
    expect(await peek(page, (w: Win) => w.classicLobby.counter.open)).toBe(false);
  });

  await test.step('Team: a player with no team', async () => {
    // A leftover team from an earlier run would be the master's; end it first.
    if (await inTeam(page)) await dissolveAsMaster(page);
    await openCounter(page);
    await chooseRow(page, ROOT_TEAM);
    expect(await topDisabled(page)).toEqual([false, true, true, true]);
  });

  await test.step('Create Team: the name, the registration, the team is made', async () => {
    await chooseRow(page, TEAM_CREATE);
    await expect.poll(() => teamPhase(page)).toBe('createIntro');
    await answerYes(page); // Yes: a team of your own
    await expect.poll(() => teamPhase(page)).toBe('name');
    await key(page, 'Enter'); // the Team Name row opens the editor
    await page.keyboard.type(name, { delay: 30 });
    await key(page, 'Enter'); // the editor's Decide keeps the text
    await key(page, 'Enter'); // Registration (row 2)
    await expect.poll(() => teamPhase(page)).toBe('nameConfirm');
    await answerYes(page);
    await expect.poll(() => teamPhase(page), { timeout: 30_000 }).toBe('notice');
    await continueNotice(page);
    await expect.poll(() => inTeam(page), { timeout: 15_000 }).toBe(true);
  });

  await test.step('Team as the master: Create greyed, Master Menu enabled', async () => {
    await openCounter(page);
    await chooseRow(page, ROOT_TEAM);
    // Create (0) and Leave (3) greyed, Ranking and Master Menu enabled.
    expect(await topDisabled(page)).toEqual([true, false, false, true]);
    await closeCounter(page);
  });

  await test.step('Master Menu lists the member actions and Dissolve Team', async () => {
    await openCounter(page);
    await chooseRow(page, ROOT_TEAM);
    await chooseRow(page, TEAM_MASTER);
    await expect.poll(() => teamPhase(page)).toBe('master');
    const enabled = await peek(page, (w: Win) => w.classicLobby.team.phase.list.items.map((i: { enabled: boolean }) => i.enabled) as boolean[]);
    // Member Expulsion, Dissolve Team and the rest enabled; Master Transfer greyed.
    expect(enabled).toEqual([true, true, true, false, true, false, false]);
  });

  await test.step('Dissolve Team: Yes ends the team and the membership clears', async () => {
    await cursorTo(page, (w: Win) => w.classicLobby.team.phase.list.cursor, MASTER_DISSOLVE);
    await key(page, 'Enter');
    await expect.poll(() => teamPhase(page)).toBe('dissolveConfirm');
    await answerYes(page);
    await expect.poll(() => teamPhase(page), { timeout: 30_000 }).toBe('notice');
    await continueNotice(page);
    await expect.poll(() => inTeam(page), { timeout: 15_000 }).toBe(false);
    // The team rows are back to a player with no team.
    await openCounter(page);
    await chooseRow(page, ROOT_TEAM);
    expect(await topDisabled(page)).toEqual([false, true, true, true]);
  });

  const errors = logs.filter((l) => l.startsWith('pageerror'));
  expect(errors).toEqual([]);
});
