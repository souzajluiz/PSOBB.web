// Smoke run of the 2026-10-21 boss and particle passes in Chrome: one classic
// client creates a party, warps to Forest 1 and then to the Dragon's arena
// (floor 11). The Dark Falz casket is in darkfalz-casket.spec.ts. The Dragon's entrance (its sub-states 0x86c / 0x874, its six
// particle sites and its flame) must spawn particles, the page must log no
// errors and no request may fail. Screenshots go to the test's output folder.
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';

test('boss smoke: Forest 1 and the Dragon entrance spawn particles without errors', async ({ page }, info) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const name = `bs${Date.now() % 100000}`;

  await logIn(page, USER, PASSWORD);
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown'); // Create a PARTY
  await key(page, 'Enter');
  await key(page, 'Enter'); // EPISODE 1
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.phase)).toBe('create');
  await key(page, 'Enter'); // Party Name
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  const fxCount = () => peek(page, (w) => (w.classicGame?.view?.combat?.fx?.bursts?.length as number | undefined) ?? -1);
  const floor = () => peek(page, (w) => w.classicGame?.view?.debug().floor() as number);

  await test.step('Forest 1', async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect.poll(floor, { timeout: 60_000 }).toBe(1);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: info.outputPath('forest1.png') });
  });

  await test.step('Dragon arena: the entrance spawns particles', async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(11));
    await expect.poll(floor, { timeout: 60_000 }).toBe(11);
    const dragon = () =>
      peek(page, (w) => {
        const c = w.classicGame.view.combat;
        const e = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'DragonAi');
        return e ? `${e.ai.state} sid=${e.ai.sid} age=${e.ai.age} hp=${e.ai.hp} bursts=${c.fx ? c.fx.bursts.length : 'null'}` : `no dragon (${c.enemies.size} enemies)`;
      });
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      if (i % 2 === 0) console.log(`t=${i / 2}s ${await dragon()}`);
      peak = Math.max(peak, await fxCount());
      if (i === 10 || i === 25) await page.screenshot({ path: info.outputPath(`dragon-${i}.png`) });
      await page.waitForTimeout(500);
    }
    console.log(`dragon arena: particle peak ${peak}`);
    expect(peak).toBeGreaterThan(0);
  });

  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
