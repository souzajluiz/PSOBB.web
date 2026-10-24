// Pioneer 2 on the classic page: the tekker (classic/shop.ts TekkerCounter, bb_p2_menu 6, talk
// action 1009) appraises the unidentified weapon the character holds (fresh-field.ts
// UNIDENTIFIED_WEAPON, put in offline with the meseta). The Result's picture window (0x32) and item
// row are screenshot for a comparison by eye; the test checks the state, not the pixels.
// The screenshot goes to TEKKER_SHOT when set (a path), and to the test's attachments.
//
// Against a local newserv, like the other classic e2e tests (e2e/classic.ts).
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, key, peek, talkKey } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

// The counter's window state (classic/shop.ts state(), render/fieldhud.ts debug().counter).
type CounterState = { message: string; choice: string[] | null; list: string[] | null; picture: boolean } | null;
const counterState = (page: Page) => peek(page, (w): CounterState => w.classicGame.view.hud.debug().counter);

test('the tekker shows the Result with the picture window for an identified weapon', async ({ page }) => {
  const logs = consoleLog(page);

  await test.step('a fresh account: funded, the unidentified weapon held, and a party field', () =>
    enterFreshField(page, logs, { prefix: 'tk', meseta: 300, weapon: true }));

  await test.step('the tekker is on the field', async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1009) !== null)).toBe(true);
  });

  await test.step('talk to the tekker and pick the weapon', async () => {
    // The player is placed beside the clerk, facing him; the first placement that opens the
    // counter is kept (a wall can stand at one side of the clerk).
    const sides: Array<[number, number]> = [[0, 8], [0, -8], [8, 0], [-8, 0], [0, 14], [0, -14], [14, 0], [-14, 0]];
    let open = false;
    for (const [dx, dz] of sides) {
      await page.evaluate(([ox, oz]) => {
        const w: any = window;
        const v = w.classicGame.view;
        const p = v.npcs.byAction(1009).root.position;
        v.placePlayer(w.classicGame.game.selfId, p.x + ox, p.y, p.z + oz, Math.atan2(-ox, -oz));
      }, [dx, dz]);
      await talkKey(page);
      await page.waitForTimeout(2000);
      if ((await counterState(page)) !== null) {
        open = true;
        break;
      }
    }
    expect(open).toBe(true);
    // The welcome lines wait for Enter; the list of unidentified items then shows.
    await expect
      .poll(
        async () => {
          const s = await counterState(page);
          if (s?.list?.length) return true;
          await key(page, 'Enter');
          return false;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBe(true);
    expect((await counterState(page))!.list!.length).toBe(1);
    await key(page, 'Enter'); // the weapon (row 0)
    await expect.poll(async () => (await counterState(page))?.choice ?? null, { timeout: 30_000 }).not.toBeNull();
    await key(page, 'Enter'); // Yes: the appraisal (100 meseta)
  });

  await test.step('the Result shows the identified weapon and its picture window', async () => {
    await expect
      .poll(
        async () => {
          const s = await counterState(page);
          if (s?.picture && s.list?.length) return true;
          if (s?.choice?.length) await key(page, 'Enter');
          return false;
        },
        { timeout: 90_000, intervals: [500] },
      )
      .toBe(true);
    const s = (await counterState(page))!;
    console.log(`tekker Result: row "${s.list![0]}", message "${s.message}"`);
    const shot = await page.screenshot();
    await test.info().attach('tekker-result', { body: shot, contentType: 'image/png' });
    if (process.env.TEKKER_SHOT) await import('node:fs').then((fs) => fs.writeFileSync(process.env.TEKKER_SHOT!, shot));
  });
});
