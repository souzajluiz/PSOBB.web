// The Gol Dragon (client/src/combat/goldragon.ts) in Chrome. One Episode 2 party
// warps to area 0x21 (floor 15); the brain is the enemy whose ai is a GoldDragonAi.
// For ~60 s the spec samples the brain's state (+0x32e) and its hp every half
// second: the states must change (the entrance, then the sequence) with no page
// error. Then the spec stands the player in front of the body and attacks with
// the real keys (ArrowDown = the palette's slot 0, a normal attack) until the
// render layer logs a hit on the Gol Dragon (applyEnemyHit -> the Gol branch). The
// damage is the game's roll: this character's roll was 0 in the last run (as on the
// Barba Ray), so the hp is reported, not asserted. Against a local newserv
// (e2e/README.md).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webep2';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webep2';
const GOL_FLOOR = 15; // area 0x21

interface GolState {
  index: number;
  sid: number;
  state: string;
  hp: number;
  maxHp: number;
  cursor: number;
  x: number;
  y: number;
  z: number;
}

// The Gol Dragon's brain, or null.
const golState = (page: Page) =>
  peek(page, (w): GolState | null => {
    const enemies = [...w.classicGame.view.combat.enemies.values()] as any[];
    const e = enemies.find((x) => x.ai?.constructor?.name === 'GoldDragonAi');
    if (!e) return null;
    const ai = e.ai;
    const p = e.instance.root.position;
    return { index: e.index, sid: ai.sid, state: ai.state, hp: ai.hp, maxHp: ai.maxHp, cursor: ai.cursor, x: p.x, y: p.y, z: p.z };
  });

test('Gol Dragon: the brain runs in Chrome, its states change, a key attack hits it', async ({ page }, info: TestInfo) => {
  test.setTimeout(420_000);
  const logs = consoleLog(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const name = `gd${Date.now() % 100000}`;

  await logIn(page, USER, PASSWORD);
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown'); // Create a PARTY
  await key(page, 'Enter');
  await key(page, 'ArrowDown'); // EPISODE 2
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.create?.episode)).toBe(2);
  await key(page, 'Enter'); // Party Name
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  await test.step('warp to the Gol Dragon (floor 15, area 0x21)', async () => {
    await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), GOL_FLOOR);
    await page.waitForTimeout(3000);
  });

  const first = await golState(page);
  expect(first, 'the Gol Dragon brain is built on area 0x21').not.toBeNull();
  const b0 = first!;
  console.log(`goldragon start ${JSON.stringify(b0)}`);

  // ~60 s of states, half a second apart. The player stands clear of the body.
  const states = new Set<number>([b0.sid]);
  let changes = 0;
  let prev = b0.sid;
  let last = b0;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const s = await golState(page);
    if (!s) break;
    last = s;
    states.add(s.sid);
    if (s.sid !== prev) changes++;
    prev = s.sid;
  }
  console.log(`goldragon states ${JSON.stringify({ states: [...states].map((s) => s.toString(16)), changes, last })}`);
  expect(changes, 'the states change over ~60 s').toBeGreaterThan(1);

  // Stand 35 units in front of the body and attack with the real keys until the hit is logged.
  const hpBefore = last.hp;
  const hitLines = () => logs.filter((l) => /hit the Gol Dragon/.test(l));
  await page.evaluate(
    ([x, y, z]) => {
      const g = (window as any).classicGame.view;
      g.placePlayer(g.game.selfId, x, y, z + 35, Math.PI);
    },
    [last.x, last.y, last.z],
  );
  await page.waitForTimeout(400);
  const mark = hitLines().length;
  for (let n = 0; n < 16 && hitLines().length === mark; n++) {
    await key(page, 'ArrowDown');
    await page.waitForTimeout(700);
  }
  const after = await golState(page);
  console.log(`goldragon hits ${JSON.stringify({ lines: hitLines().slice(mark), hpBefore, hpAfter: after?.hp, sid: after?.sid.toString(16) })}`);
  await page.screenshot({ path: info.outputPath('goldragon-floor15.png') });

  expect(hitLines().length, 'a key attack hits the Gol Dragon').toBeGreaterThan(mark);
  expect(pageErrors, 'no page errors').toEqual([]);
});
