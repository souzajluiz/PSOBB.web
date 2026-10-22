// Barba Ray (client/src/combat/barbaray.ts) in Chrome. One Episode 2 party
// warps to area 0x20 (floor 14, questeditor/areas.ts floorToArea(2)); the
// player is placed by the first Barba Ray so its wave starts. For ~60 s the
// spec records the brain's phase (+0x32e) and its motion slot each half second:
// the phases must change with no damage (the table runs). Then the spec strikes
// the four parts through the brain (the parts are not hit entities yet, see
// docs/bosses/barbaray-map.md "Open"), and checks the pools drop. The page must
// raise no page error. Against a local newserv (e2e/README.md).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webep2';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webep2';
const BARBA_FLOOR = 14; // area 0x20

interface BarbaState {
  index: number;
  phase: number;
  slot: number;
  dead: boolean;
  shell: number;
  body: number;
  parts: number[];
  x: number;
  y: number;
  z: number;
}

// The Barba Ray's brain (the enemy whose ai is a BarbaRayAi), or null.
const barbaState = (page: Page) =>
  peek(page, (w): BarbaState | null => {
    const enemies = [...w.classicGame.view.combat.enemies.values()] as any[];
    const e = enemies.find((x) => x.ai?.constructor?.name === 'BarbaRayAi');
    if (!e) return null;
    const ai = e.ai;
    const p = e.instance.root.position;
    return {
      index: e.index,
      phase: ai.phase,
      slot: ai.slot,
      dead: !!(ai.dead || e.dead),
      shell: ai.shellHp,
      body: ai.bodyHp,
      parts: ai.parts.map((q: { pool: number }) => q.pool),
      x: p.x,
      y: p.y,
      z: p.z,
    };
  });

test('Barba Ray: the brain runs in Chrome, its phases change, its pools take hits', async ({ page }, info: TestInfo) => {
  test.setTimeout(420_000);
  const logs = consoleLog(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const name = `bb${Date.now() % 100000}`;

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

  await test.step('warp to Barba Ray (floor 14, area 0x20)', async () => {
    await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), BARBA_FLOOR);
    await page.waitForTimeout(3000);
  });

  const first = await barbaState(page);
  expect(first, 'the Barba Ray brain is built on area 0x20').not.toBeNull();
  const b0 = first!;
  // Place the player 5 above the body so the floor's wave starts the fight.
  await page.evaluate(
    ([x, y, z]) => {
      const g = (window as any).classicGame.view;
      g.placePlayer(g.game.selfId, x, y + 5, z, 0);
    },
    [b0.x, b0.y, b0.z],
  );

  const phases = new Set<number>([b0.phase]);
  const slots = new Set<number>([b0.slot]);
  let phaseChanges = 0;
  let prev = b0.phase;
  let struck = false;
  let last = b0;
  // ~60 s, half a second apart: no damage for the first 30 s, then the parts are struck.
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const s = await barbaState(page);
    if (!s) break;
    last = s;
    phases.add(s.phase);
    slots.add(s.slot);
    if (s.phase !== prev) phaseChanges++;
    prev = s.phase;
    if (i === 60 && !struck) {
      struck = true;
      await page.evaluate(() => {
        const e = [...(window as any).classicGame.view.combat.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'BarbaRayAi') as any;
        for (let p = 0; p < 4; p++) e.ai.hitPart(p, 500);
        e.ai.hitRoot(300);
      });
    }
  }
  console.log(`barbaray ${JSON.stringify({ phases: [...phases], slots: [...slots], phaseChanges, last: { ...last, parts: last.parts.slice(0, 4) } })}`);
  await page.screenshot({ path: info.outputPath('barbaray-floor14.png') });

  const damaged = last.parts.filter((p, i) => p < b0.parts[i]!).length;
  expect(phaseChanges, 'the phases change with no damage over ~60 s').toBeGreaterThan(1);
  expect(damaged, 'the four struck parts lost pool').toBeGreaterThanOrEqual(4);
  expect(last.shell, 'the root hit went to the shell pool first').toBeLessThan(b0.shell);
  expect(pageErrors, 'no page errors').toEqual([]);
});
