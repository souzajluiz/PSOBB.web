// One check of the Gal Gryphon brain (combat/galgryphonai.ts) in the classic client: an Episode 2
// party warps to floor 12 (area 0x1e, Gal Gryphon), waits for the boss's brain to run, and takes one
// screenshot mid-fight. Same steps as ep2-floors-smoke.spec.ts.
import { expect, test, type TestInfo } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webep2';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webep2';

test('Episode 2 floor 12: the Gal Gryphon brain runs and the boss is drawn mid-fight', async ({ page }, info: TestInfo) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const name = `g${Date.now() % 100000}`;

  await logIn(page, USER, PASSWORD);
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.create?.episode)).toBe(2);
  await key(page, 'Enter');
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4);
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  await page.evaluate(() => (window as any).classicGame.view.warpTo(12));
  // As ep2-floors-smoke.spec.ts: wait for the load, then stand the player 40 units from the first
  // placed enemy so the floor's wave starts (the boss comes with its wave).
  await page.waitForTimeout(3000);
  const firstWorld = await peek(page, (w) => (w.classicGame.view.enemyLayer.instances[0]?.placed?.world ?? null) as number[] | null);
  if (firstWorld) {
    const [x, y, z] = firstWorld;
    await page.evaluate(
      ([px, py, pz]) => {
        const g = (window as any).classicGame.view;
        g.placePlayer(g.game.selfId, px, py + 5, pz, 0);
      },
      [x, y, z],
    );
  }
  // The boss is built by the combat view a moment after the load; its brain is GalgryphonAi.
  type Boss = { state: string | null; dead: boolean; hp: number | null };
  const readBoss = () =>
    peek(page, (w): Boss | null => {
      const enemies = [...w.classicGame.view.combat.enemies.values()] as any[];
      const e = enemies.find((x) => x.ai?.constructor?.name === 'GalgryphonAi');
      if (!e) return null;
      return { state: e.ai.state ?? null, dead: !!e.dead, hp: e.ai.hpNow ?? null };
    });
  const classes = () =>
    peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].map((x: any) => `${x.ai?.constructor?.name ?? 'none'}:${x.slot?.type ?? '?'}:${x.instance?.spec?.name ?? '?'}`));
  await expect.poll(readBoss, { timeout: 60_000 }).not.toBeNull().catch(async (err) => {
    console.log(`enemies on floor 12: ${JSON.stringify(await classes())}; placed: ${firstWorld}`);
    throw err;
  });
  // Let the entrance run; the states over the next seconds show the brain ticking.
  await page.waitForTimeout(6000);
  const boss = await readBoss();
  const states: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    const b = await readBoss();
    if (b?.state) states.push(b.state);
  }
  const shot = info.outputPath('galgryphon-floor12.png');
  await page.screenshot({ path: shot });
  console.log(`boss at check: ${JSON.stringify(boss)}; states over 6 s: ${[...new Set(states)].join(',')}`);
  console.log(`page errors: ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
  console.log(`screenshot: ${shot}`);
  expect(boss, 'the Gal Gryphon brain exists').not.toBeNull();
  expect(errors, 'no page errors').toEqual([]);
});
