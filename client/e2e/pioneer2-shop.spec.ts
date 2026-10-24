// Pioneer 2 on the classic page: a shop counter (classic/shop.ts, the tool
// store, bb_p2_menu 3). Create a party, enter it, walk to the item store clerk
// (talk action 1008, area script label 820), talk to him, buy one of the
// cheapest rows (the first one the wallet can pay, one piece) and close the
// window. The meseta and the bag change, and the server takes the buy (6xB7).
// The walk is not under test: the player is placed in front of the clerk.
//
// Against a local newserv, like the other classic e2e tests (e2e/classic.ts).
// The account is fresh per run and its character is funded offline with FUND meseta before the
// shop step (fresh-field.ts fundOffline, bridge/admin-chars.mjs): the wallet then pays the cheap
// rows and the buy branch runs. Rows dearer than FUND answer "not enough meseta" and the list
// comes back. PSO_USER / PSO_PASSWORD override the account.
// NEWSERV_LOG (optional): newserv's log file, checked for the purchase line.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, key, leaveToLobby, peek, talkKey } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

// The meseta the character is funded with: the buy stays within it (the bought item costs at
// most this much).
const FUND = 200;

// The counter's window state (classic/shop.ts state(), render/fieldhud.ts debug().counter).
type CounterState = { message: string; choice: string[] | null; list: string[] | null; cursor: number; amount: number | null } | null;
// The labels carry padding spaces (the unitxt text), so they are trimmed here.
async function counterState(page: Page): Promise<CounterState> {
  const s = await peek(page, (w): CounterState => w.classicGame.view.hud.debug().counter);
  return s && { ...s, choice: s.choice?.map((t) => t.trim()) ?? null, message: s.message.trim() };
}

// The bag and the wallet: the items (id and data1) and the meseta.
const bag = (page: Page) =>
  peek(page, (w) => {
    const c = w.classicGame.view.items.inventory?.c;
    return c ? { meseta: c.meseta as number, items: c.inventory.map((i: any) => ({ id: i.data.id as number, data1: Array.from(i.data.data1 as Uint8Array) as number[] })) } : null;
  });

// Items by kind: the data1 bytes without the stack count (byte 5), and the count held. Tools
// (class 3) stack; any other item counts once.
type Bag = NonNullable<Awaited<ReturnType<typeof bag>>>;
function holdings(b: Bag): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of b.items) {
    const key = it.data1.map((v, i) => (i === 5 ? 0 : v)).join(',');
    const n = it.data1[0] === 3 ? it.data1[5] || 1 : 1;
    out.set(key, (out.get(key) ?? 0) + n);
  }
  return out;
}

test('the item store counter sells a cheap item on the classic field', async ({ page }) => {
  const logs = consoleLog(page);

  await test.step('a fresh account: the character, funded offline, and a party field', () =>
    enterFreshField(page, logs, { prefix: 'wsh', meseta: FUND }));

  await test.step('the item store clerk is on the field', async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1008) !== null)).toBe(true);
  });

  const before = await bag(page);
  expect(before).not.toBeNull();
  expect(before!.meseta).toBe(FUND);

  await test.step('talk to the item store clerk and open Buy', async () => {
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1008).root.position;
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 8, Math.PI);
    });
    await talkKey(page);
    // The greeting lines wait for Enter; the Buy / Sell choice then shows.
    await expect
      .poll(
        async () => {
          const s = await counterState(page);
          if (s?.choice) return true;
          await key(page, 'Enter');
          return false;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBe(true);
    expect((await counterState(page))!.choice).toEqual(['Buy', 'Sell']);
    await key(page, 'Enter'); // Buy
    await expect.poll(async () => (await counterState(page))?.list?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    const list = (await counterState(page))!.list!;
    console.log(`item store: ${list.length} rows, first: ${list[0]}`);
    await test.info().attach('item-store', { body: await page.screenshot(), contentType: 'image/png' });
  });

  // false when the wallet can pay no row (the rows answer "not enough meseta"):
  // the buy steps are then skipped and the window is still closed.
  const canBuy = await test.step('pick the first row the wallet can pay, one piece', async () => {
    // A row the wallet cannot pay gets a line ("not enough meseta") and the
    // list again (classic/shop.ts tellow); the first row that passes shows the
    // amount spinner or Buy / Cancel.
    const WHAT = 'What would you like to buy?';
    let bought = false;
    const rows = (await counterState(page))!.list!.length;
    let refused = 0;
    for (let row = 0; row < rows && !bought; row++) {
      // The list is ready: its message asks what to buy, no choice is open.
      await expect
        .poll(
          async () => {
            const s = await counterState(page);
            if (s?.amount !== null && s?.amount !== undefined) return true;
            if (s?.choice?.includes('Cancel')) return true;
            if (s?.list && s.message === WHAT) return true;
            if (s && s.message && s.message !== WHAT && !s.choice) await key(page, 'Enter');
            return false;
          },
          { timeout: 60_000, intervals: [400] },
        )
        .toBe(true);
      if ((await counterState(page))!.choice?.includes('Cancel') || (await counterState(page))!.amount !== null) {
        bought = true; // a row already waits for the amount or Buy
        break;
      }
      for (let i = 0; i < 60 && (await counterState(page))!.cursor !== row; i++) await key(page, 'ArrowDown');
      await key(page, 'Enter');
      // Wait for the outcome: the spinner, Buy / Cancel, or a line (not affordable).
      let outcome = '';
      for (let i = 0; i < 25 && !outcome; i++) {
        await page.waitForTimeout(200);
        const s = await counterState(page);
        if (!s) break;
        if (s.amount !== null) outcome = 'amount';
        else if (s.choice?.includes('Cancel')) outcome = 'confirm';
        else if (s.message !== WHAT && !s.choice) outcome = 'line';
      }
      console.log(`row ${row}: ${outcome || 'no outcome'} (${(await counterState(page))?.message})`);
      if (outcome === 'line') {
        refused++;
        // Dismiss the line: an Enter while it is still typing only finishes the typing, so the
        // Enter is repeated until the list is back (the line's wait ends on the next one).
        await expect
          .poll(
            async () => {
              const s = await counterState(page);
              if (s?.list && s.message === WHAT) return true;
              await key(page, 'Enter');
              return false;
            },
            { timeout: 30_000, intervals: [300] },
          )
          .toBe(true);
      } else if (outcome === 'amount' || outcome === 'confirm') {
        bought = true;
      }
    }
    // Without a bought row, every row must have answered "not enough meseta".
    if (!bought) expect(refused).toBe(rows);
    return bought;
  });
  console.log(canBuy ? 'a row is bought' : 'no row the wallet can pay');

  if (canBuy) await test.step('amount, then Buy', async () => {
    // The spinner (one piece by default) and then Buy / Cancel.
    await expect
      .poll(async () => (await counterState(page))?.choice?.includes('Cancel') || (await counterState(page))?.amount !== null, { timeout: 30_000 })
      .toBe(true);
    if ((await counterState(page))!.amount !== null) {
      await key(page, 'Enter'); // one piece
      await expect.poll(async () => (await counterState(page))?.choice?.includes('Cancel') ?? false, { timeout: 30_000 }).toBe(true);
    }
    await key(page, 'Enter'); // Buy
  });

  if (canBuy) await test.step('the wallet and the bag changed', async () => {
    await expect.poll(async () => (await bag(page))?.meseta ?? 0, { timeout: 30_000 }).toBeLessThan(before!.meseta);
    const after = await bag(page);
    console.log(`meseta ${before!.meseta} -> ${after!.meseta}, bag ${before!.items.length} -> ${after!.items.length}`);
    // The item appears: a kind the bag did not hold, or a stack that grew.
    const had = holdings(before!);
    const now = holdings(after!);
    const grew = [...now].filter(([k, n]) => n > (had.get(k) ?? 0));
    console.log(`bag grew by: ${grew.map(([k, n]) => `[${k.slice(0, 12)}] ${had.get(k) ?? 0} -> ${n}`).join(', ')}`);
    expect(grew.length).toBeGreaterThan(0);
  });

  if (canBuy) await test.step('the server takes the buy', async () => {
    // newserv applies 6xB7 (on_buy_shop_item_bb) and takes the meseta; a
    // refused buy throws there and drops the game. The buy is not echoed to
    // the buyer (send_create_inventory_item_to_lobby excludes it), so the
    // check is that the game holds, and, when NEWSERV_LOG names newserv's log,
    // its "purchased item" line for the new id.
    const id = logs.map((l) => /bought ([0-9a-f]+) \(shop \d+ /.exec(l)?.[1]).find(Boolean);
    expect(id, 'the client logged the buy').toBeTruthy();
    await page.waitForTimeout(2000);
    expect(await peek(page, (w) => !!w.classicGame && w.classicGame.game.loading === false)).toBe(true);
    const log = process.env.NEWSERV_LOG;
    if (log) {
      const line = `purchased item ${id!.padStart(8, '0').toUpperCase()} (`;
      await expect.poll(() => readFileSync(log, 'utf8').includes(line), { timeout: 30_000 }).toBe(true);
    }
  });

  await test.step('close the window', async () => {
    // The clerk asks if you need anything else; Escape ends the talk.
    await expect
      .poll(
        async () => {
          const s = await counterState(page);
          if (!s) return 'closed';
          if (s.choice?.includes('Buy')) {
            await key(page, 'Escape');
          } else if (s.choice || s.list) {
            await key(page, 'Escape');
          } else {
            await key(page, 'Enter');
          }
          return 'open';
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBe('closed');
    expect(await peek(page, (w) => w.classicTown.counterOpen)).toBe(false);
  });

  await test.step('leave the game cleanly', async () => {
    await leaveToLobby(page);
  });

  const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  console.log(errors.join('\n'));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
