// Battle Mode traps in Chrome (the classic client, local newserv).
// 1. A Battle party (Create a PARTY -> EPISODE 1 -> mode row = Battle, popup index 2;
//    Difficulty Normal; Registration), entered as the game's leader.
// 2. A battle quest started from the Hunter's Guild counter: the counter's category
//    list is searched for "Battle" (newserv's system/quests/battle/ entries).
// 3. The battle runs (log "battle: start", quest/battlerun.ts). The character file's
//    palette slot 2 is a trap slot (group 1 = 4, group 2 = 0x0d = trap type 0; set in
//    the test account's copy under vendor/newserv/system/players/, outside the repo).
//    The right arrow is the palette key of slot 2 (input/keyconfig.ts PALETTE_KEYS).
//    The press goes through render/combat.ts frame -> BattleRun.placeTrap.
// 4. Checks: the trap is placed (log, stock down by one), the 6x83 subcommand is sent
//    with type 0 and the count before the decrement, the arming delay passes and the
//    trap is triggered by the local player only when the battle rules let it hit its
//    owner (quest/battletraps.ts TrapField.tick; the owner is the only player here), and
//    the page logs no errors and no request fails.
// The subcommands are read by wrapping Game.sendSubcommand on the page (the test's own
// observer; nothing in the port changes).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby, talkKey } from './classic.ts';

// The battle account: a copy of webtest's save (vendor/newserv/system/players/, see e2e/README.md).
const USER = process.env.PSO_USER ?? 'webbattle';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webbattle';

test('Battle Mode: a trap is placed from the palette, sent as 6x83, and it is armed and triggers', async ({ page }, info) => {
  test.setTimeout(900_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const name = `bt${Date.now() % 100000}`;

  await test.step('log in and reach the lobby', async () => {
    await logIn(page, USER, PASSWORD);
    await reachLobby(page);
  });

  await test.step('create a Battle party (EPISODE 1, mode Battle, Difficulty Normal) and enter it', async () => {
    await openPartyMenu(page);
    await key(page, 'ArrowDown'); // Create a PARTY
    await key(page, 'Enter');
    await key(page, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
    await key(page, 'Enter'); // Party Name
    await page.keyboard.type(name, { delay: 30 });
    await key(page, 'Enter');
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 2); // Mode
    await key(page, 'Enter');
    await key(page, 'ArrowDown', 2); // Normal, Challenge, Battle (MODES index 2)
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party.create.mode)).toBe(2);
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 3); // Difficulty
    await key(page, 'Enter');
    await key(page, 'Enter'); // Normal
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration
    await key(page, 'Enter');
    await expectInGame(page, logs, name);
  });

  await test.step('record the subcommands this client sends (Game.sendSubcommand)', async () => {
    await page.evaluate(() => {
      const w = window as any;
      const g = w.classicGame.game;
      w.__sent = [];
      const orig = g.sendSubcommand.bind(g);
      g.sendSubcommand = (sub: number, payload: Uint8Array, command?: number) => {
        w.__sent.push({ sub, payload: Array.from(payload), command });
        return orig(sub, payload, command);
      };
    });
  });

  await test.step('talk to the guild clerk; take the first Battle quest', async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1011) !== null)).toBe(true);
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1011).root.position;
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 8, Math.PI);
    });
    await talkKey(page);
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
    const categories = await peek(page, (w) => w.classicTown.ui.lists[0].items as string[]);
    console.log(`quest categories: ${categories.join(' | ')}`);
    const battle = categories.findIndex((c) => /battle/i.test(c));
    expect(battle, 'a Battle category in the Hunter\'s Guild menu').toBeGreaterThanOrEqual(0);
    await cursorTo(page, (w) => w.classicTown.ui.lists[0].cursor, battle);
    await key(page, 'Enter'); // the category; its first quest is the list's row 0
    await expect
      .poll(
        async () => {
          if (logs.some((l) => /quest ".+" started/.test(l))) return true;
          await key(page, 'Enter'); // the quest (row 0), its information, Yes
          return false;
        },
        { timeout: 120_000, intervals: [700] },
      )
      .toBe(true);
    console.log(logs.find((l) => /quest ".+" started/.test(l)));
  });

  await test.step('the counter closes; the battle starts', async () => {
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
    await expect.poll(() => logs.some((l) => l.includes('battle: start')), { timeout: 120_000, intervals: [500] }).toBe(true);
    await expect.poll(() => peek(page, (w) => typeof w.classicGame.view.combat.placeTrap), { timeout: 10_000 }).toBe('function');
    await test.info().attach('battle-start', { body: await page.screenshot(), contentType: 'image/png' });
  });

  await test.step('press the trap palette slot (right arrow): the trap is placed and 6x83 goes out', async () => {
    const stock = await peek(page, (w) => w.classicGame.view.hud.trapCount(0) as number);
    console.log(`trap stock of type 0 before the press: ${stock}`);
    expect(stock).toBeGreaterThan(0);
    const slot = await peek(page, (w) => w.classicGame.view.hud.paletteSlot(2));
    console.log(`palette slot 2: ${JSON.stringify(slot)}`);
    expect(slot).toMatchObject({ group1: 4, group2: 0x0d });
    // The palette keys are read from the held-key state once a frame (render/combat.ts frame), so the
    // key is held for a few frames rather than pressed.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowRight');
    await expect.poll(() => logs.some((l) => l.includes('battle trap 0 placed')), { timeout: 10_000 }).toBe(true);
    const sent = await peek(page, (w) => (w.__sent as any[]).filter((s) => s.sub === 0x83));
    console.log(`6x83 sent: ${JSON.stringify(sent)}`);
    expect(sent.length).toBe(1);
    // Payload after the 4-byte header: u16 type, u16 count (the count before the decrement).
    expect(sent[0].payload.slice(0, 2)).toEqual([0, 0]);
    expect(sent[0].payload[2] | (sent[0].payload[3] << 8)).toBe(stock);
    expect(await peek(page, (w) => w.classicGame.view.hud.trapCount(0) as number)).toBe(stock - 1);
    await test.info().attach('trap-placed', { body: await page.screenshot(), contentType: 'image/png' });
  });

  await test.step('the trap arms and is triggered by its owner (b88001 calls ba_set_trapself)', async () => {
    const hpBefore = await peek(page, (w) => w.classicGame.view.combat.damage.hp as number);
    // ASSUMED arming delay 0x96 frames (~5 s at 30 Hz); the fuse and the blast follow. The owner is
    // the only player, so the trap hits it only because the battle rules allow it (ba_set_trapself).
    // The 6x80 call is {trap number, what 2} (the blast): the number is count + client * 0x50 +
    // type * 0x14 (quest/battle.ts trapNumber).
    await expect.poll(() => peek(page, (w) => (w.__sent as any[]).some((s) => s.sub === 0x80)), { timeout: 60_000, intervals: [500] }).toBe(true);
    const clientId = await peek(page, (w) => w.classicGame.game.selfId as number);
    const calls = await peek(page, (w) => (w.__sent as any[]).filter((s) => s.sub === 0x80));
    console.log(`6x80 sent: ${JSON.stringify(calls)}`);
    expect(calls.length).toBe(1);
    expect(calls[0].payload.slice(0, 4)).toEqual([5 + clientId * 0x50, 0, 2, 0]);
    await expect.poll(() => peek(page, (w) => w.classicGame.view.combat.damage.hp as number), { timeout: 20_000, intervals: [300] }).toBeLessThan(hpBefore);
    const hpAfter = await peek(page, (w) => w.classicGame.view.combat.damage.hp as number);
    console.log(`trap logs: ${JSON.stringify(logs.filter((l) => /battle trap|blast hit/.test(l)))}`);
    console.log(`HP ${hpBefore} -> ${hpAfter}`);
    await test.info().attach('trap-after', { body: await page.screenshot(), contentType: 'image/png' });
  });

  await test.step('leave the game cleanly (the battle ends with it)', async () => {
    await leaveToLobby(page);
  });

  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
