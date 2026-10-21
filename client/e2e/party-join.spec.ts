// Two classic clients against a local newserv: A creates a party at the
// counter and enters its field, B opens Join a PARTY, finds A's game in the
// list and joins it; both end up in the same game on Pioneer 2, then leave.
// B joins only after A's floor is loaded: newserv refuses a join while
// another player is loading ("another player is currently loading").
import { expect, test, type BrowserContext } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

// B is the local test account of tests/login.live.ts; A one of the accounts
// tests/gamelist.live.ts uses (newserv takes unregistered users locally).
const USER_A = process.env.PSO_USER_A ?? 'webgameb';
const PASSWORD_A = process.env.PSO_PASSWORD_A ?? 'webgameb';
const USER_B = process.env.PSO_USER ?? 'webtest';
const PASSWORD_B = process.env.PSO_PASSWORD ?? 'webtest';

let contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.map((c) => c.close()));
  contexts = [];
});

test('Join a PARTY: a second client joins a party created at the counter', async ({ browser }) => {
  contexts = [await browser.newContext(), await browser.newContext()];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const logsA = consoleLog(a);
  const logsB = consoleLog(b);
  const name = `pj${Date.now() % 100000}`;

  await test.step('A and B reach the lobby', async () => {
    await Promise.all([logIn(a, USER_A, PASSWORD_A).then(() => reachLobby(a)), logIn(b, USER_B, PASSWORD_B).then(() => reachLobby(b))]);
  });

  await test.step('A creates the party and enters it', async () => {
    await openPartyMenu(a);
    await key(a, 'ArrowDown'); // Create a PARTY
    await key(a, 'Enter');
    await key(a, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(a, (w) => w.classicLobby.party?.phase)).toBe('create');
    await key(a, 'Enter'); // Party Name
    await a.keyboard.type(name, { delay: 30 });
    await key(a, 'Enter');
    await cursorTo(a, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
    await key(a, 'Enter');
    await expectInGame(a, logsA, name);
  });

  await test.step('B joins it from the list', async () => {
    await openPartyMenu(b);
    await key(b, 'Enter'); // Join a PARTY
    await expect.poll(() => peek(b, (w) => w.classicLobby.party?.phase)).toBe('list');
    const names = await peek(b, (w) => w.classicLobby.party.list.entries.map((e: { name: string }) => e.name));
    const index = names.indexOf(name);
    expect(index).toBeGreaterThanOrEqual(0);
    await cursorTo(b, (w) => w.classicLobby.party.list.cursor, index, 0x40);
    await key(b, 'Enter');
    await expectInGame(b, logsB, name);
  });

  await test.step('both clients see two players', async () => {
    await expect.poll(() => peek(a, (w) => w.classicGame.game.players.size)).toBe(2);
    await expect.poll(() => peek(b, (w) => w.classicGame.game.players.size)).toBe(2);
  });

  await test.step('both go back to the lobby', async () => {
    await leaveToLobby(b);
    await leaveToLobby(a);
  });

  for (const [who, logs] of [['A', logsA], ['B', logsB]] as const) {
    const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
    if (errors.length) console.log(`${who}:\n${errors.join('\n')}`);
    expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
  }
});
