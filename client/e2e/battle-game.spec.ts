// A whole two-player Battle Mode game in Chrome (the classic client, local newserv), on fresh
// accounts in two browser contexts. A battle with one player ends by itself (battle.ts ALONE_FRAMES),
// so B joins A's Battle party.
// 1. Two fresh accounts (`wba...`): slot 0 is made; A's palette slot 2 (the Right key) is set to a
//    trap (group 1 = 4, group 2 = 0x0d: trap type 0) while A is offline (E7 config +0x3e0, palette
//    0 slot 2 at E7 0x3f0, file 0x3f8).
// 2. A creates a Battle party (EPISODE 1, mode Battle, Normal, Registration); B joins it.
// 3. Both stand at the Hunter's Guild counter; A takes the first quest of the Battle category.
//    The battle starts on both clients (ba_initial_floor, ba_start: `battle: start`).
// 4. HUD: the timer runs (BattleHud state), the rules window opens on both.
// 5. Traps: A places a trap (Right key); the 6x83 goes out with the count before the decrement,
//    and B's client places the same trap; the blast (6x80 what 2) hits B when B stands in range.
// 6. Death and respawn for the player the blast kills (the respawn teleport, `battle respawn`).
// 7. The end: the timer runs out (`battle: time up`) on both; the leader's rematch prompt is
//    answered Lobby. The results screen is not drawn yet (battlerun.ts showResults logs only).
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { charPath, loadCharBuffer, writeCharacter } from '../../bridge/admin-chars.mjs';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby, talkKey } from './classic.ts';
import { makeCharacter, slotFilled } from './phone-helpers.ts';
import { freshUser, playersDir } from './fresh-field.ts';

const PALETTE_SLOT2 = 0x3f8; // file offset of palette 0's slot 2 group 1 (group 2 follows)

// A fresh account: slot 0 made when empty, then (`trapPalette`) the palette's Right key set to a
// trap while the account is offline. Ends at the character select of the logged-in account.
async function freshAccount(page: Page, user: string, trapPalette: boolean): Promise<void> {
  await logIn(page, user, user);
  await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
  if (!(await slotFilled(page, 0))) {
    await key(page, 'Enter');
    await makeCharacter(page);
    await expect.poll(() => slotFilled(page, 0), { timeout: 30_000 }).toBe(true);
  }
  if (!trapPalette) return;
  await page.goto('about:blank');
  await page.waitForTimeout(2000);
  const dir = playersDir();
  const file = charPath(dir, user, 0);
  const buf = Buffer.from(loadCharBuffer(file));
  buf[PALETTE_SLOT2] = 4;
  buf[PALETTE_SLOT2 + 1] = 0x0d;
  writeCharacter(dir, file, buf);
  await page.waitForTimeout(2000);
  await logIn(page, user, user);
  await expect.poll(() => peek(page, (w) => !!w.classicSelect), { timeout: 90_000 }).toBe(true);
}

// Stands the player at the Hunter's Guild clerk (action 1011), as the talk needs.
async function standAtClerk(page: Page): Promise<void> {
  await expect.poll(() => peek(page, (w) => w.classicGame.view.npcs.byAction(1011) !== null), { timeout: 60_000 }).toBe(true);
  await peek(page, (w) => {
    const v = w.classicGame.view;
    const p = v.npcs.byAction(1011).root.position;
    v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 8, Math.PI);
  });
}

const page_wait = (p: Page) => p.waitForTimeout(700);

const hasLog = (logs: string[], re: RegExp) => logs.some((l) => re.test(l));

test('Battle Mode: a two-player game (traps, death, respawn, time up) on fresh accounts', async ({ browser }) => {
  test.setTimeout(1_500_000);
  const ctxA: BrowserContext = await browser.newContext();
  const ctxB: BrowserContext = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const logsA = consoleLog(a);
  const logsB = consoleLog(b);
  const errors: string[] = [];
  const failed: string[] = [];
  for (const p of [a, b]) {
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
  }
  const userA = process.env.PSO_USER ?? freshUser('wba');
  const userB = freshUser('wbb');
  const name = `bg${Date.now() % 100000}`;
  console.log(`accounts: A ${userA}, B ${userB}`);

  await test.step('A (trap palette) and B (new) are made and reach the character select', async () => {
    await freshAccount(a, userA, true);
    await freshAccount(b, userB, false);
  });

  await test.step('A creates a Battle party (EPISODE 1, mode Battle, Normal) and enters it', async () => {
    await reachLobby(a);
    await openPartyMenu(a);
    await key(a, 'ArrowDown'); // Create a PARTY
    await key(a, 'Enter');
    await key(a, 'Enter'); // EPISODE 1
    await expect.poll(() => peek(a, (w) => w.classicLobby.party?.phase)).toBe('create');
    await key(a, 'Enter'); // Party Name
    await a.keyboard.type(name, { delay: 30 });
    await key(a, 'Enter');
    await cursorTo(a, (w) => w.classicLobby.party.create.row, 2); // Mode
    await key(a, 'Enter');
    await key(a, 'ArrowDown', 2); // Normal, Challenge, Battle (MODES index 2)
    await key(a, 'Enter');
    await expect.poll(() => peek(a, (w) => w.classicLobby.party.create.mode)).toBe(2);
    await cursorTo(a, (w) => w.classicLobby.party.create.row, 3); // Difficulty
    await key(a, 'Enter');
    await key(a, 'Enter'); // Normal
    await cursorTo(a, (w) => w.classicLobby.party.create.row, 4); // Registration
    await key(a, 'Enter');
    await expectInGame(a, logsA, name);
  });

  await test.step('B joins A\'s party from the list', async () => {
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
  });

  await test.step('both see two players; both are recorded for the subcommands', async () => {
    await expect.poll(() => peek(a, (w) => w.classicGame.game.players.size)).toBe(2);
    await expect.poll(() => peek(b, (w) => w.classicGame.game.players.size)).toBe(2);
    for (const p of [a, b]) {
      await p.evaluate(() => {
        const w = window as any;
        const g = w.classicGame.game;
        w.__sent = [];
        const orig = g.sendSubcommand.bind(g);
        g.sendSubcommand = (sub: number, payload: Uint8Array, command?: number) => {
          w.__sent.push({ sub, payload: Array.from(payload), command });
          return orig(sub, payload, command);
        };
      });
    }
  });

  await test.step('both stand at the clerk; A takes the first quest of the Battle category', async () => {
    await standAtClerk(a);
    await standAtClerk(b);
    // The clerk's first list can be a Yes / No prompt (answered No, then talked to again) before
    // the quest categories open.
    await expect
      .poll(
        async () => {
          const items = await peek(a, (w) => (w.classicTown.ui.lists[0]?.items as string[] | undefined) ?? []);
          if (items.some((c) => /battle/i.test(c))) return true;
          if (items.length === 0) {
            await talkKey(a);
            await key(a, 'Enter');
          } else {
            await key(a, 'ArrowDown');
            await key(a, 'Enter'); // No
            await page_wait(a);
          }
          return false;
        },
        { timeout: 120_000, intervals: [900] },
      )
      .toBe(true);
    const categories = await peek(a, (w) => w.classicTown.ui.lists[0].items as string[]);
    console.log(`quest categories: ${categories.join(' | ')}`);
    const battle = categories.findIndex((c) => /battle/i.test(c));
    expect(battle, "a Battle category in the Hunter's Guild menu").toBeGreaterThanOrEqual(0);
    await cursorTo(a, (w) => w.classicTown.ui.lists[0].cursor, battle);
    await key(a, 'Enter');
    await expect
      .poll(
        async () => {
          if (hasLog(logsA, /quest ".+" started/)) return true;
          await key(a, 'Enter');
          return false;
        },
        { timeout: 120_000, intervals: [700] },
      )
      .toBe(true);
    console.log(logsA.find((l) => /quest ".+" started/.test(l)));
  });

  await test.step('the counter closes; the battle starts on both clients', async () => {
    await expect
      .poll(
        async () => {
          if (!(await peek(a, (w) => w.classicTown.counterOpen))) return false;
          await key(a, 'Enter');
          return true;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBe(false);
    await expect.poll(() => hasLog(logsA, /battle: start/), { timeout: 120_000, intervals: [500] }).toBe(true);
    await expect.poll(() => hasLog(logsB, /battle: start/), { timeout: 120_000, intervals: [500] }).toBe(true);
    await expect.poll(() => peek(a, (w) => typeof w.classicGame.view.combat.placeTrap), { timeout: 10_000 }).toBe('function');
    await test.info().attach('battle-start', { body: await a.screenshot(), contentType: 'image/png' });
    console.log(`A battle logs: ${JSON.stringify(logsA.filter((l) => /battle|quest:/.test(l)))}`);
    console.log(`B battle logs: ${JSON.stringify(logsB.filter((l) => /battle|quest:/.test(l)))}`);
  });

  await test.step('the HUD timer runs on both clients', async () => {
    for (const p of [a, b]) {
      await expect.poll(() => peek(p, (w) => w.classicBattle?.hud?.state?.timer ?? null), { timeout: 30_000 }).not.toBeNull();
    }
    const t1 = await peek(a, (w) => w.classicBattle.hud.state.timer as number);
    await a.waitForTimeout(3000);
    const t2 = await peek(a, (w) => w.classicBattle.hud.state.timer as number);
    console.log(`timer A: ${t1} -> ${t2}`);
    expect(t2).toBeLessThan(t1);
  });

  await test.step('traps: A places one from the palette; 6x83 goes out; B is hit by the blast', async () => {
    // B stands 20 units from A, inside the blast radius of the trap A places at its own feet.
    const at = await peek(a, (w) => {
      const p = w.classicGame.view.view.playerPositions().get(w.classicGame.game.selfId);
      return { x: p.x, y: p.y, z: p.z };
    });
    await b.evaluate((p) => {
      const w = window as any;
      w.classicGame.view.placePlayer(w.classicGame.game.selfId, p.x + 20, p.y, p.z, 0);
    }, at);
    const stock = await peek(a, (w) => w.classicGame.view.hud.trapCount(0) as number);
    console.log(`trap stock of type 0 before the press: ${stock}`);
    expect(stock).toBeGreaterThan(0);
    const slot = await peek(a, (w) => w.classicGame.view.hud.paletteSlot(2));
    expect(slot).toMatchObject({ group1: 4, group2: 0x0d });
    await a.keyboard.down('ArrowRight');
    await a.waitForTimeout(150);
    await a.keyboard.up('ArrowRight');
    await expect.poll(() => hasLog(logsA, /battle trap 0 placed/), { timeout: 10_000 }).toBe(true);
    const sent = await peek(a, (w) => (w.__sent as any[]).filter((s) => s.sub === 0x83));
    expect(sent.length).toBe(1);
    expect(sent[0].payload.slice(0, 2)).toEqual([0, 0]);
    expect(sent[0].payload[2] | (sent[0].payload[3] << 8)).toBe(stock);
    expect(await peek(a, (w) => w.classicGame.view.hud.trapCount(0) as number)).toBe(stock - 1);
    await expect.poll(() => hasLog(logsB, /battle trap 0 placed/), { timeout: 10_000 }).toBe(true);
    const hpB = await peek(b, (w) => w.classicGame.view.combat.damage.hp as number);
    await expect.poll(() => hasLog(logsA, /battle trap 5: call 2|6x80|blast/), { timeout: 60_000, intervals: [500] }).toBe(true);
    await expect.poll(() => peek(b, (w) => w.classicGame.view.combat.damage.hp as number), { timeout: 30_000, intervals: [300] }).toBeLessThan(hpB);
    console.log(`A trap logs: ${JSON.stringify(logsA.filter((l) => /battle trap|blast|respawn/.test(l)))}`);
    console.log(`B trap logs: ${JSON.stringify(logsB.filter((l) => /battle trap|blast|respawn/.test(l)))}`);
    await test.info().attach('trap-after', { body: await b.screenshot(), contentType: 'image/png' });
  });

  await test.step('death and respawn: the player the blast kills is respawned (battle respawn)', async () => {
    await expect.poll(() => hasLog(logsA, /battle respawn|dead|died/) || hasLog(logsB, /battle respawn|dead|died/), { timeout: 120_000, intervals: [500] }).toBe(true);
    console.log(`respawn logs: ${JSON.stringify([...logsA, ...logsB].filter((l) => /respawn|dead|died/.test(l)))}`);
    await test.info().attach('after-death', { body: await b.screenshot(), contentType: 'image/png' });
  });

  await test.step('the battle ends with the timer (time up) on both clients', async () => {
    const endBy = Date.now() + 1_200_000;
    while (!hasLog(logsA, /battle: time up/) && Date.now() < endBy) {
      await a.waitForTimeout(60_000);
      const ta = await peek(a, (w) => (w.classicBattle?.hud?.state?.timer ?? null) as number | null);
      const tb = await peek(b, (w) => (w.classicBattle?.hud?.state?.timer ?? null) as number | null);
      const st = await peek(a, (w) => (w.classicBattle?.controller?.state ?? null) as string | null);
      console.log(`DIAG timer A ${ta} B ${tb} state ${st} ${new Date().toISOString()}`);
    }
    expect(hasLog(logsA, /battle: time up/), 'the timer ends the battle on A').toBe(true);
    await expect.poll(() => hasLog(logsB, /battle: time up/), { timeout: 30_000, intervals: [500] }).toBe(true);
    console.log(`A result: ${JSON.stringify(logsA.filter((l) => /battle result|battle: /.test(l)))}`);
    console.log(`B result: ${JSON.stringify(logsB.filter((l) => /battle result|battle: /.test(l)))}`);
    await test.info().attach('battle-end', { body: await a.screenshot(), contentType: 'image/png' });
  });

  await test.step('leave both games', async () => {
    await leaveToLobby(b);
    await leaveToLobby(a);
  });

  await ctxA.close();
  await ctxB.close();
  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
