// The field's chat line and mouse on the classic client (classic/field.ts),
// against a local newserv: create a party (as party-create.spec.ts), enter the
// game, then Space opens the chat line, a line is sent through the game
// connection and comes back as a log line and a balloon; Escape sends nothing.
// The 3D canvas takes the pointer in the field: a press reaches it, and the
// stage keeps the keys.
//
// The page is one canvas, so the test drives it with the keyboard and mouse
// and reads the screens through the development hooks (e2e/classic.ts).
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

// The local test account of tests/login.live.ts.
const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

test('field: chat line (Space, Enter, Escape) and the mouse on the 3D canvas', async ({ page }) => {
  const logs = consoleLog(page);
  const name = `fc${Date.now() % 100000}`;

  await test.step('log in', () => logIn(page, USER, PASSWORD));
  await test.step('reach the lobby', () => reachLobby(page));

  await test.step('create a party and enter the game', async () => {
    await openPartyMenu(page);
    // Create a PARTY (1) -> EPISODE 1 (0), then the name, the difficulty (0)
    // and Registration (as party-create.spec.ts).
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

  await test.step('mouse: the 3D canvas takes the press, the stage keeps the keys', async () => {
    // The field's canvas is the one under the stage's centre; the stage
    // gives it no pointer events.
    const at = await page.evaluate(() => {
      const r = document.getElementById('stage')!.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      return {
        hit: document.elementFromPoint(x, y)?.id ?? '',
        stagePointer: getComputedStyle(document.getElementById('stage')!).pointerEvents,
        x,
        y,
      };
    });
    expect(at.hit).toBe('world');
    expect(at.stagePointer).toBe('none');

    // A press on the 3D canvas moves the focus to the stage (the keys go to
    // the field's chat, not to the body).
    await page.mouse.click(at.x, at.y);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('stage');
  });

  await test.step('Space opens the chat line', async () => {
    await key(page, ' ');
    await expect.poll(() => peek(page, (w) => w.classicGame.chat.open)).toBe(true);
  });

  await test.step('Escape closes it and sends nothing', async () => {
    await peek(page, (w) => {
      w.__sentChat = [];
      const g = w.classicGame.game;
      const send = g.sendChat.bind(g);
      g.sendChat = (t: string) => {
        w.__sentChat.push(t);
        send(t);
      };
    });
    await page.keyboard.type('nope', { delay: 30 });
    await key(page, 'Escape');
    expect(await peek(page, (w) => w.classicGame.chat.open)).toBe(false);
    expect(await peek(page, (w) => w.__sentChat)).toEqual([]);
  });

  await test.step('typed text goes to the line, Enter sends it, the line comes back', async () => {
    const text = `hi field ${name}`;
    await key(page, ' ');
    await expect.poll(() => peek(page, (w) => w.classicGame.chat.open)).toBe(true);
    // Letters and spaces are the line's, not the field's (the walk keys stay off).
    await page.keyboard.type(text, { delay: 30 });
    expect(await peek(page, (w) => w.classicGame.chat.input.text)).toBe(text);
    await key(page, 'Enter');
    expect(await peek(page, (w) => w.classicGame.chat.open)).toBe(false);
    expect(await peek(page, (w) => w.__sentChat)).toEqual([text]);

    // The server echoes the line (06): a log line with the speaker's name and
    // the balloon over the player.
    await expect
      .poll(() => peek(page, (w) => w.classicGame.chat.log.lines.some((l: string) => l.endsWith(`> ${w.__sentChat[0]}`))), { timeout: 15_000 })
      .toBe(true);
    expect(await peek(page, (w) => w.classicGame.chat.bubbles.list.some((b: { clientId: number }) => b.clientId === w.classicGame.game.selfId))).toBe(true);
  });

  await test.step('back to the lobby', () => leaveToLobby(page));

  const errors = logs.filter((l) => l.startsWith('pageerror'));
  console.log(errors.join('\n'));
  expect(errors).toEqual([]);
});
