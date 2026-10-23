// The dead prompt and the return to Pioneer 2 (client/src/render/fieldhud.ts,
// render/gameview.ts returnToPioneer2). A fresh character goes from Pioneer 2 to
// Forest 1 (floor 1) through the real warp, then takes a lethal hit through the
// player's damage path (combat/playerdamage.ts hit()). After the death motion
// and the fade the prompt "Do you wish to / return to / Pioneer 2?" must open
// (6x4E went out). The spec picks Yes with the keys (Up, then Enter, each held
// ~150 ms: the port reads keys once a frame), then checks the player is on
// Pioneer 2 (floor 0), alive at full HP, and that the prompt is gone. No page
// error may happen. Needs the local newserv and bridge (e2e/README.md).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

// Holds a key for `ms` (the port polls keys once per 30 fps frame).
async function hold(page: Page, k: string, ms = 150): Promise<void> {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
  await page.waitForTimeout(100);
}

// The state the spec reads from the page: the floor, the player's damage and
// the dead prompt.
interface DeadState {
  floor: number | null;
  state: string | null;
  dead: boolean;
  hp: number;
  maxHp: number;
  prompt: boolean;
  cursor: number | null;
}

const deadState = (page: Page) =>
  peek(page, (w): DeadState => {
    const view = w.classicGame?.view as any;
    const damage = view?.combat?.damage;
    return {
      floor: w.classicGame?.game?.self?.floor ?? null,
      state: damage?.state ?? null,
      dead: !!damage?.dead,
      hp: damage?.hp ?? -1,
      maxHp: damage?.maxHp ?? -1,
      prompt: !!view?.hud?.returnPrompt,
      cursor: view?.hud?.returnPrompt?.cursor ?? null,
    };
  });

test('dead prompt: a dead player picks Yes and is back on Pioneer 2 alive', async ({ page }, info: TestInfo) => {
  test.setTimeout(420_000);
  const logs = consoleLog(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await enterFreshField(page, logs, { prefix: 'dead' });
  await expect.poll(() => deadState(page).then((s) => s.floor), { timeout: 60_000 }).toBe(0);

  // Forest 1 through the real warp (6x21 floor 1, then the floor load).
  await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
  await expect.poll(() => deadState(page).then((s) => s.floor), { timeout: 90_000 }).toBe(1);
  await expect.poll(() => deadState(page).then((s) => s.state), { timeout: 30_000 }).toBe('alive');
  const before = await deadState(page);
  expect(before.maxHp).toBeGreaterThan(0);

  // A lethal hit through the damage path.
  await page.evaluate(() => (window as any).classicGame.view.combat.damage.hit(100000, 0, 0));
  await expect.poll(() => deadState(page).then((s) => s.dead), { timeout: 30_000 }).toBe(true);
  expect((await deadState(page)).hp).toBe(0);

  // The death motion and the fade (~3 s), then the prompt on the revivable state.
  await expect.poll(() => deadState(page).then((s) => s.prompt), { timeout: 60_000 }).toBe(true);
  expect((await deadState(page)).state).toBe('revivable');
  expect((await deadState(page)).cursor).toBe(1); // the cursor starts on No

  // Yes: Up, then Enter.
  await hold(page, 'ArrowUp');
  await expect.poll(() => deadState(page).then((s) => s.cursor), { timeout: 10_000 }).toBe(0);
  await hold(page, 'Enter');

  // Back on Pioneer 2: floor 0, alive, full HP, the prompt gone.
  await expect.poll(() => deadState(page).then((s) => s.floor), { timeout: 90_000 }).toBe(0);
  await expect.poll(() => deadState(page).then((s) => s.state), { timeout: 30_000 }).toBe('alive');
  const after = await deadState(page);
  expect(after.dead).toBe(false);
  expect(after.prompt).toBe(false);
  expect(after.hp).toBe(after.maxHp);
  expect(logs.some((l) => l.includes('returned to Pioneer 2'))).toBe(true);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  info.annotations.push({ type: 'hp', description: `${after.hp}/${after.maxHp}` });
});
