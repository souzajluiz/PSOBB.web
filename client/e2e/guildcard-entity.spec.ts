// Guild Card > Block list > Add > Entity against a local newserv, with two fresh accounts in one
// lobby: A opens the Home menu's Guild Card leaf (0x0e), goes to the Block list (0x39), the add
// row (0x3f), the entity source (0x4a), picks B's row (the entity list, 0x4b), answers the confirm
// (0x4d) with Yes, and B's guild card lands in A's blocked list (07E8, the entity's card).
// The entity list is the lobby's players here (classic/homeleaves.ts, ASSUMED). A screenshot of the
// confirm over the entity list goes to the test's output folder.
//
// Needs newserv and the bridge running; PW_BASE_URL points at a Vite on its own port.
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, cursorTo, key, peek, reachLobby, type Win } from './classic.ts';
import { ensureCharacter, freshUser } from './fresh-field.ts';

const USER_A = process.env.PSO_USER_A ?? freshUser('chla');
const USER_B = process.env.PSO_USER_B ?? freshUser('chlb');

// The guild card menu's phase, cursors and rows (the window's own fields, read through the hook).
const phase = (page: Page) => peek(page, (w: Win) => w.classicLobby.home.guildCard?.phase ?? null) as Promise<string | null>;
const blockedNumbers = (page: Page) =>
  peek(page, (w: Win) => (w.classicLobby.hud.guildCards?.()?.view().blocked ?? []).filter((c: { present: boolean }) => c.present).map((c: { guildCardNumber: number }) => c.guildCardNumber) as number[]);

test('two accounts: Guild Card > Block list > Add > Entity adds B to the blocked list', async ({ browser }) => {
  test.setTimeout(420_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(String(e)));
  const logsA = consoleLog(a);

  await ensureCharacter(a, USER_A, USER_A);
  await reachLobby(a);
  await ensureCharacter(b, USER_B, USER_B);
  await reachLobby(b);
  const cardB = await peek(b, (w: Win) => w.classicLobby.lobby.self.guildCardNumber as number);
  await expect.poll(() => peek(a, (w: Win) => w.classicLobby.lobby.players.size as number), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  // B's client id on A's side: the entity row's value (the list is ordered by the lobby's players).
  // (peek ships its function as source, so the number is passed as the evaluate argument.)
  const idB = await a.evaluate((n: number) => {
    const w = window as unknown as Win;
    const p = [...w.classicLobby.lobby.players.values()].find((x: { guildCardNumber: number }) => x.guildCardNumber === n);
    return p ? (p.clientId as number) : -1;
  }, cardB);
  expect(idB).toBeGreaterThanOrEqual(0);

  await test.step('A opens the Guild Card leaf with the card book synced', async () => {
    await expect.poll(() => peek(a, (w: Win) => !!w.classicLobby.hud.guildCards?.()), { timeout: 60_000 }).toBe(true).catch(async (err) => {
      const dbg = await peek(a, (w: Win) => ({ client: !!w.classicLobby.hud.guildCardClient?.(), book: !!w.classicLobby.hud.guildCardClient?.()?.book, lobbyJoined: !!w.classicLobby.lobby, sess: Object.keys(w.classicLobby.hud).filter((k: string) => /guild|session|conn/i.test(k)) }));
      console.log('DEBUGLOG ' + JSON.stringify(dbg) + '\n' + logsA.filter((l) => /error|pageerror|guild/i.test(l)).slice(-20).join('\n'));
      throw err;
    });
    await peek(a, (w: Win) => w.classicLobby.home.openLeaf(0x0e));
    await expect.poll(() => phase(a)).toBe('menu');
  });

  await test.step('Block list > Add > Entity: the list has B, the confirm asks, Yes adds B', async () => {
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.menuState.cursor, 3); // Block list (0x117)
    await key(a, 'Enter');
    await expect.poll(() => phase(a)).toBe('block');
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.subState.cursor, 1); // Add (0x3f)
    await key(a, 'Enter');
    await expect.poll(() => phase(a)).toBe('addSource');
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.subState.cursor, 2); // Entity (0x4a)
    await key(a, 'Enter');
    await expect.poll(() => phase(a)).toBe('addEntity');

    const values = await peek(a, (w: Win) => w.classicLobby.home.guildCard.list.map((r: { value: number }) => r.value) as number[]);
    expect(values).toContain(idB);
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.listState.cursor, values.indexOf(idB));
    await key(a, 'Enter');
    await expect.poll(() => phase(a)).toBe('addAsk');
    await expect.poll(() => peek(a, (w: Win) => (w.classicLobby.home.guildCard.question?.cursor ?? -1) as number)).toBe(1); // No by default

    await a.screenshot({ path: test.info().outputPath('guildcard-entity-confirm.png') });
    // Up -> Yes, then Enter.
    await key(a, 'ArrowUp');
    await key(a, 'Enter');
    await expect.poll(() => phase(a)).toBe('menu');
    await expect.poll(() => blockedNumbers(a), { timeout: 20_000 }).toContain(cardB);
  });

  await test.step('a second pass: No keeps the blocked list unchanged, Escape leaves the list', async () => {
    const before = await blockedNumbers(a);
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.menuState.cursor, 3);
    await key(a, 'Enter');
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.subState.cursor, 1);
    await key(a, 'Enter');
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.subState.cursor, 2);
    await key(a, 'Enter');
    await expect.poll(() => phase(a)).toBe('addEntity');
    const values = await peek(a, (w: Win) => w.classicLobby.home.guildCard.list.map((r: { value: number }) => r.value) as number[]);
    await cursorTo(a, (w: Win) => w.classicLobby.home.guildCard.listState.cursor, values.indexOf(idB));
    await key(a, 'Enter');
    await expect.poll(() => phase(a)).toBe('addAsk');
    await key(a, 'Enter'); // No (the default cursor)
    await expect.poll(() => phase(a)).toBe('addEntity');
    expect(await blockedNumbers(a)).toEqual(before);
    await key(a, 'Escape'); // the entity list's cancel goes to the menu (exe state 0x4c -> 1)
    await expect.poll(() => phase(a)).toBe('menu');
  });

  expect(errors).toEqual([]);
});
