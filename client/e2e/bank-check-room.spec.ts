// The Pioneer 2 bank counter's take list (the Check Room, classic/shop.ts
// BankCounter): a fresh field, the bank clerk (talk action 1010, counter menu 5),
// a deposit first when the bank is empty, then the take list is opened and
// screenshotted for comparison with the exe's Check Room window (the item rows,
// the "n/200" count, the stat panel of the cursor's item).
//
// Against a local newserv, like the other classic e2e tests (e2e/classic.ts).
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby, talkKey } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';
const SHOT = process.env.BANK_SHOT ?? '';

// The counter's state (CounterBase.state): the clerk's line, the choice labels, the list rows.
type CounterState = { message: string; choice: string[] | null; list: string[] | null; cursor: number; amount: number | null; capacity: number | null };
const counter = (page: Page) => peek(page, (w): CounterState | null => w.classicGame?.view?.hud?.debug().counter ?? null);

// Poll until the counter is in the wanted state; no keys are sent.
async function waitFor(page: Page, done: (s: CounterState) => boolean): Promise<CounterState> {
  await expect.poll(async () => { const s = await counter(page); return !!s && done(s); }, { timeout: 60_000, intervals: [400] }).toBe(true);
  return (await counter(page)) as CounterState;
}

// As waitFor, but Enter goes to the clerk's lines (no choice and no list on screen).
async function settle(page: Page, done: (s: CounterState) => boolean): Promise<CounterState> {
  await expect
    .poll(
      async () => {
        const s = await counter(page);
        if (s && done(s)) return true;
        // No counter yet (the talk), or its lines: Enter.
        if (!s || (s.choice === null && s.list === null)) await key(page, 'Enter');
        return false;
      },
      { timeout: 60_000, intervals: [700] },
    )
    .toBe(true);
  return (await counter(page)) as CounterState;
}

test('the bank Check Room take list opens in a fresh Pioneer 2 field', async ({ page }) => {
  const logs = consoleLog(page);
  const name = `bk${Date.now() % 100000}`;

  await test.step('log in, reach the lobby, create a party and enter it', async () => {
    await logIn(page, USER, PASSWORD);
    await reachLobby(page);
    await openPartyMenu(page);
    // Create a PARTY (1) -> EPISODE 1 (0), then the name, Difficulty Normal, Registration.
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

  await test.step('stand in front of the bank clerk and talk to him', async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1010) !== null)).toBe(true);
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1010).root.position;
      // Close in front of him (the Middle key's reach is the weapon's cone and range).
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 3, Math.PI);
    });
    await talkKey(page);
  });

  await test.step('the bank opens with Deposit / Take', async () => {
    const s = await settle(page, (x) => x.choice !== null);
    expect(s.choice?.length).toBe(2);
  });

  // Take (cursor 1) -> Meseta / Item -> Item: the bank's rows, or the clerk's "no items" line.
  let take: CounterState;
  await test.step('Take -> Item', async () => {
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    await settle(page, (x) => x.choice !== null && x.choice.length === 2);
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    take = await settle(page, (x) => x.list !== null || x.choice !== null);
  });

  if (take!.list === null) {
    // The bank is empty: back to Deposit (cursor 0) -> Item -> the first carried item.
    await test.step('the bank is empty: deposit the first carried item', async () => {
      // The "no items" line ends the take; the Deposit / Take choice comes back with the cursor on Deposit.
      await settle(page, (x) => x.choice !== null);
      await key(page, 'Enter');
      await settle(page, (x) => x.choice !== null && x.choice.length === 2);
      await key(page, 'ArrowDown');
      await key(page, 'Enter');
      const list = await waitFor(page, (x) => x.list !== null);
      expect(list.list?.length ?? 0).toBeGreaterThan(0);
      await key(page, 'Enter');
      // A stack asks the amount first (Enter confirms the spinner), then Yes / No (Yes first).
      const next = await waitFor(page, (x) => x.amount !== null || x.choice !== null);
      if (next.amount !== null) {
        await key(page, 'Enter');
        await waitFor(page, (x) => x.choice !== null);
      }
      await key(page, 'Enter');
      // Leave the deposit list: its "other help" line, then the choice again.
      await waitFor(page, (x) => x.list !== null);
      await key(page, 'Backspace');
      await settle(page, (x) => x.choice !== null);
      await key(page, 'ArrowDown');
      await key(page, 'Enter');
      await settle(page, (x) => x.choice !== null && x.choice.length === 2);
      await key(page, 'ArrowDown');
      await key(page, 'Enter');
      take = await settle(page, (x) => x.list !== null || x.choice !== null);
    });
  }

  await test.step('the take list shows the bank items with the n/200 count', async () => {
    expect(take!.list?.length ?? 0).toBeGreaterThan(0);
    expect(take!.capacity).toBe(200);
    console.log(`bank take list (${take!.list?.length}/${take!.capacity}): ${take!.list?.join(' | ')}`);
    // Let the list and its detail settle, then take the picture.
    await page.waitForTimeout(800);
    const shot = await page.screenshot({ path: SHOT || undefined });
    await test.info().attach('check-room', { body: shot, contentType: 'image/png' });
  });

  const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  console.log(errors.join('\n'));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
