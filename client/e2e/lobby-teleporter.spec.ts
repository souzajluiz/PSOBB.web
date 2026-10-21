// The lobby teleporter on Pioneer 2 (floor 0) answers at once: the warp menu
// opens while the player stands in the teleporter's radius, and Enter on
// "Lobby" (the area warp of area 0x0f) reaches the lobby teleporter's leave
// (GameView.onLobbyWarp) and the lobby within a second.
//
// The menu is driven with the keyboard, as a player does: the walk onto the
// teleporter is not under test, so the player's position is set on the field.
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

type Events = Array<[string, number]>;

test('lobby teleporter: the menu answers Enter at once and the lobby loads', async ({ page }) => {
  const logs = consoleLog(page);
  const name = `tp${Date.now() % 100000}`;

  await test.step('log in and reach the lobby', async () => {
    await logIn(page, USER, PASSWORD);
    await reachLobby(page);
  });

  await test.step('create a Normal party and enter it', async () => {
    await openPartyMenu(page);
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
    await expect
      .poll(() => peek(page, (w) => (w.classicGame ? `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}` : '')), { timeout: 60_000 })
      .toBe('0:false');
  });

  await test.step('stand in the lobby teleporter (floor 0 lobby->15 warp)', async () => {
    await expect
      .poll(() => peek(page, (w) => (w.classicGame.view.field.objects?.warps ?? []).some((x: { kind: string }) => x.kind === 'lobby')), { timeout: 30_000 })
      .toBe(true);
    // Time stamps of the menu, the keys, the leave and the lobby (ms since the
    // teleport).
    await peek(page, (w) => {
      const t0 = performance.now();
      w.__tp = { t0, events: [] as Events, lobby: false };
      const mark = (what: string) => w.__tp.events.push([what, Math.round(performance.now() - t0)]);
      const field = w.classicGame.view.field;
      const show = field.menu.show.bind(field.menu);
      field.menu.show = (...a: unknown[]) => {
        mark('menu shown');
        return show(...a);
      };
      const close = field.menu.close.bind(field.menu);
      field.menu.close = (c: unknown = null) => {
        mark(`menu close ${c}`);
        return close(c);
      };
      const leave = w.classicGame.view.onLobbyWarp;
      w.classicGame.view.onLobbyWarp = () => {
        mark('onLobbyWarp');
        leave();
      };
      window.addEventListener('keydown', (e) => mark(`keydown ${e.key}`), true);
      window.addEventListener('pointerdown', (e) => mark(`pointerdown ${e.button}`), true);
      const lobbyWatch = setInterval(() => {
        if (w.classicLobby !== undefined && !w.__tp.lobby) {
          w.__tp.lobby = true;
          mark('lobby shown');
          clearInterval(lobbyWatch);
        }
      }, 5);
      mark('teleport');
      const x = field.objects.warps.find((y: { kind: string }) => y.kind === 'lobby');
      const me = w.classicGame.game.self;
      me.position.x = x.x;
      me.position.y = x.y;
      me.position.z = x.z;
    });
  });

  await test.step('the menu opens on the teleporter', async () => {
    await expect.poll(() => peek(page, (w) => w.classicGame.view.field.menu.open), { timeout: 10_000 }).toBe(true);
  });

  await test.step('Enter at the lobby teleporter', async () => {
    await peek(page, (w) => w.__tp.events.push(['--- Enter', Math.round(performance.now() - w.__tp.t0)]));
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby !== undefined && w.classicGame === undefined), { timeout: 45_000 }).toBe(true);
  });

  const events = await peek(page, (w) => w.__tp.events as Events);
  console.log(events.map(([what, t]) => `${String(t).padStart(6)} ms  ${what}`).join('\n'));
  const at = (what: string) => events.find(([e]) => e === what)?.[1];
  const enter = events.find(([e]) => e.startsWith('--- Enter'))?.[1] ?? Infinity;
  expect(at('menu shown')).toBeDefined();
  expect(at('onLobbyWarp')! - enter).toBeLessThan(1000);
  expect(at('lobby shown')! - enter).toBeLessThan(5000);
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
