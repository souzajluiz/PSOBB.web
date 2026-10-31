// A partial stack in the Pioneer 2 bank (classic/shop.ts BankCounter, net/items.ts depositItem):
// a fresh account with three Monomates, the bank clerk's Deposit -> Item -> Monomate, the amount
// spinner set to 2, Yes. The counter's own state and the local inventory show 1 carried; the
// server's copy of the bank (a fresh 6xBB, answered by 6xBC) shows 2.
//
// Against a local newserv, like the other classic e2e tests (e2e/classic.ts).
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, key, peek, talkKey } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

// A Monomate x3 in the raw form (class 3, type 0, subtype 0, stack count 3 at data1[5]).
const MONOMATE_X3 = { data1: '030000000003000000000000', data2: '00000000' };

type CounterState = { message: string; choice: string[] | null; list: string[] | null; cursor: number; amount: number | null; capacity: number | null };
const counter = (page: Page) => peek(page, (w): CounterState | null => w.classicGame?.view?.hud?.debug().counter ?? null);

async function waitFor(page: Page, done: (s: CounterState) => boolean): Promise<CounterState> {
  await expect.poll(async () => { const s = await counter(page); return !!s && done(s); }, { timeout: 60_000, intervals: [300] }).toBe(true);
  return (await counter(page)) as CounterState;
}

// Enter goes to the clerk's lines until the wanted state (no choice and no list on screen).
async function settle(page: Page, done: (s: CounterState) => boolean): Promise<CounterState> {
  await expect
    .poll(
      async () => {
        const s = await counter(page);
        if (s && done(s)) return true;
        if (!s || (s.choice === null && s.list === null)) await key(page, 'Enter');
        return false;
      },
      { timeout: 60_000, intervals: [600] },
    )
    .toBe(true);
  return (await counter(page)) as CounterState;
}

// The carried item's count and the bank's count of the same tool (class 3, type 0, subtype 0).
// (A fresh character starts with a Monomate of its own, so the count is the sum of the stacks.)
const carriedMonomates = (page: Page) =>
  peek(page, (w): number => {
    const inv: any[] = w.classicGame.view.items.inventory?.c?.inventory ?? [];
    return inv
      .filter((i) => !i.equipped && i.data.data1[0] === 3 && i.data.data1[1] === 0 && i.data.data1[2] === 0)
      .reduce((n: number, i: any) => n + i.data.data1[5], 0);
  });

// The row of the deposit list that holds the Monomate: the list is the carried items that are not
// equipped, in slot order (classic/shop.ts depositItems).
const monomateRow = (page: Page) =>
  peek(page, (w): number => {
    const inv: any[] = (w.classicGame.view.items.inventory?.c?.inventory ?? []).filter((i: any) => !i.equipped);
    return inv.findIndex((i) => i.data.data1[0] === 3 && i.data.data1[1] === 0 && i.data.data1[2] === 0);
  });

const bankMonomates = (page: Page) =>
  peek(page, (w): number | null => {
    const b = w.classicGame.view.items.bank;
    if (!b) return null;
    const m = b.items.find((i: any) => i.data.data1[0] === 3 && i.data.data1[1] === 0 && i.data.data1[2] === 0);
    return m ? m.amount : 0;
  });

test('a partial stack goes into the bank: 2 of 3 Monomates, 1 carried', async ({ page }) => {
  const logs = consoleLog(page);
  let before = 0; // the carried Monomates before the deposit

  await test.step('a fresh account with three Monomates in a Pioneer 2 party field', () =>
    enterFreshField(page, logs, { prefix: 'itm', patch: () => ({ inventory: { add: [MONOMATE_X3] } }) }));

  await test.step('the carried Monomates include the three added', async () => {
    before = await carriedMonomates(page);
    expect(before).toBeGreaterThanOrEqual(3);
  });

  await test.step('stand in front of the bank clerk and talk to him', async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1010) !== null)).toBe(true);
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1010).root.position;
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 3, Math.PI);
    });
    await talkKey(page);
  });

  await test.step('Deposit -> Item -> the Monomate row', async () => {
    await settle(page, (x) => x.choice !== null && x.choice.length === 2); // Deposit / Take
    await key(page, 'Enter'); // Deposit
    await settle(page, (x) => x.choice !== null && x.choice.length === 2); // Meseta / Item
    await key(page, 'ArrowDown');
    await key(page, 'Enter'); // Item
    const list = await waitFor(page, (x) => x.list !== null);
    const row = await monomateRow(page);
    expect(row, 'the deposit list has the Monomate').toBeGreaterThanOrEqual(0);
    expect(list.list?.length ?? 0).toBeGreaterThan(row);
    for (let i = 0; i < row; i++) await key(page, 'ArrowDown');
    await key(page, 'Enter'); // pick the Monomate: the spinner asks how many
  });

  await test.step('the spinner: 1 -> 2, Enter, then Yes', async () => {
    const spin = await waitFor(page, (x) => x.amount !== null);
    expect(spin.amount).toBe(1);
    await key(page, 'ArrowUp'); // the ones digit: 2
    await key(page, 'Enter'); // confirm the spinner: Yes / No
    await waitFor(page, (x) => x.choice !== null && x.choice.length === 2);
    await key(page, 'Enter'); // Yes
  });

  await test.step('the bank holds 2 and the inventory 1 at once (local side)', async () => {
    await expect.poll(() => bankMonomates(page), { timeout: 15_000 }).toBe(2);
    expect(await carriedMonomates(page)).toBe(before - 2);
  });

  await test.step('a fresh 6xBB: the server answers with the bank, which holds 2', async () => {
    await peek(page, (w) => w.classicGame.view.items.requestBank());
    await expect.poll(() => bankMonomates(page), { timeout: 30_000, intervals: [400] }).toBe(2);
  });

  // The take side of the same stack: 1 back out of the bank (6xBD take, the amount in byte 13, the
  // bank index in bytes 14-15). The server creates it in the inventory with 6xBE, so the carried
  // count rises only when that answer comes.
  await test.step('Take -> Item -> the Monomate, the spinner 1, Yes: 6xBE brings 1 back', async () => {
    await settle(page, (x) => x.list !== null || x.choice !== null);
    await key(page, 'Backspace'); // out of the deposit list: its "other help" line, then Deposit / Take
    await settle(page, (x) => x.choice !== null && x.choice.length === 2);
    await key(page, 'ArrowDown'); // Take
    await key(page, 'Enter');
    await settle(page, (x) => x.choice !== null && x.choice.length === 2); // Meseta / Item
    await key(page, 'ArrowDown');
    await key(page, 'Enter'); // Item
    await waitFor(page, (x) => x.list !== null);
    await key(page, 'Enter'); // the bank's first row: the Monomate x2
    const spin = await waitFor(page, (x) => x.amount !== null || x.choice !== null);
    if (spin.amount !== null) {
      expect(spin.amount).toBe(1);
      await key(page, 'Enter'); // confirm the spinner at 1
      await waitFor(page, (x) => x.choice !== null && x.choice.length === 2);
    }
    await key(page, 'Enter'); // Yes
    await expect.poll(() => carriedMonomates(page), { timeout: 15_000, intervals: [300] }).toBe(before - 1);
    await expect.poll(() => bankMonomates(page), { timeout: 15_000, intervals: [300] }).toBe(1);
  });

  const errors = logs.filter((l) => l.startsWith('pageerror'));
  expect(errors).toEqual([]);
});
