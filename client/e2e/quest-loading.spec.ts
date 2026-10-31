// The quest loading screen (classic/questloading.ts) during a quest start: a
// fresh account in the Pioneer 2 party field talks to the Hunter's Guild clerk,
// takes the first quest of Retrieval with Yes, and the loading screen covers the
// field from the first byte of the transfer until the quest is started. A window
// hook (window.classicQuestLoading) samples its state while it runs: the progress
// bar, the mode 0 sweep and the static groups, the middle particle. One screenshot
// is taken while the middle particle is up. Then the field screen is back.
//
// Against a local newserv, like the other classic e2e tests (e2e/classic.ts).
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { consoleLog, key, peek, leaveToLobby } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

test('a quest start shows the quest loading screen until the quest runs', async ({ page }) => {
  const logs = consoleLog(page);
  await test.step('fresh account in the Pioneer 2 party field', () => enterFreshField(page, logs, { prefix: 'qlw' }));

  await test.step('talk to the guild clerk and open the quest menu', async () => {
    expect(await peek(page, (w) => w.classicGame.view.npcs.byAction(1011) !== null)).toBe(true);
    await peek(page, (w) => {
      const v = w.classicGame.view;
      const p = v.npcs.byAction(1011).root.position;
      v.placePlayer(w.classicGame.game.selfId, p.x, p.y, p.z + 8, Math.PI);
    });
    // Talk is the action palette's Middle key (ArrowDown by default), as in the
    // exe (palette slot down, 0x0068c31d); held so a 30 fps poll sees it.
    const talk = async () => {
      await page.keyboard.down('ArrowDown');
      await page.waitForTimeout(150);
      await page.keyboard.up('ArrowDown');
      await page.waitForTimeout(60);
    };
    await talk();
    await expect
      .poll(
        async () => {
          const n = await peek(page, (w) => w.classicTown.ui.lists.length);
          if (n === 0) {
            // The clerk's lines and the counter advance with Enter (Decide); a new talk starts with the Middle key.
            if (await peek(page, (w) => w.classicGame.view.npcs.talking || w.classicTown.counterOpen)) await key(page, 'Enter');
            else await talk();
          }
          return n;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBeGreaterThan(0);
    const categories = await peek(page, (w) => w.classicTown.ui.lists[0].items as string[]);
    console.log(`quest categories: ${categories.join(' | ')}`);
    expect(categories[0]).toBe('Retrieval');
  });

  await test.step('take the first quest of Retrieval with Yes, sampling the loading screen', async () => {
    // A sampler in the page: every 40 ms, the loading screen's state (none while the field shows).
    await page.evaluate(() => {
      const w = window as unknown as { __qlSamples: unknown[]; __qlTimer: number };
      w.__qlSamples = [];
      w.__qlTimer = window.setInterval(() => {
        const s = (window as unknown as { classicQuestLoading?: any }).classicQuestLoading;
        if (!s) return;
        // The first frame with the middle particle and the sweep up: the screen's own draw, to a canvas.
        if (!(w as any).__qlShot && s.particles && s.particles.middle.count > 100) {
          const c = document.createElement('canvas');
          c.width = 640;
          c.height = 480;
          s.draw(c.getContext('2d'));
          (w as any).__qlShot = c.toDataURL('image/png');
        }
        w.__qlSamples.push({
          t: performance.now(),
          bar: s.bars.bar ? { ratio: s.bars.bar.ratio, eta: s.bars.bar.etaText(), pct: s.bars.bar.percent() } : null,
          wipes: s.particles ? s.particles.shownWipes() : -1,
          sweep: s.particles ? s.particles.wipes.filter((x: any) => x.active && x.spawn.mode === 0).length : -1,
          middle: s.particles ? s.particles.middle.count : -1,
          middleAngles: s.particles ? s.particles.middle.emitters.map((e: any) => e.orient) : null,
        });
      }, 40);
    });
    // Enter picks the cursor's row: the category (Retrieval, row 0), the first
    // quest, the information window, then Yes (row 0 of the yes / no list).
    // The loading line follows; the quest is started by the time it is read.
    await expect
      .poll(
        async () => {
          if (logs.some((l) => /quest ".+" started/.test(l))) return true;
          await key(page, 'Enter');
          return false;
        },
        { timeout: 120_000, intervals: [150] },
      )
      .toBe(true);
    const started = logs.find((l) => /quest ".+" started/.test(l))!;
    console.log(started);
    expect(logs.some((l) => l.includes('quest loaded:'))).toBe(true);
    expect(logs.some((l) => l.includes('quest failed to start'))).toBe(false);

    const { samples, shot } = await page.evaluate(() => {
      const w = window as unknown as { __qlSamples: any[]; __qlTimer: number; __qlShot?: string };
      window.clearInterval(w.__qlTimer);
      return { samples: w.__qlSamples, shot: w.__qlShot ?? null };
    });
    // The screen's own draw, from its third frame (the grey lines are up from the second; the bar may be done).
    expect(shot).not.toBeNull();
    const png = Buffer.from(shot!.split(',')[1]!, 'base64');
    await test.info().attach('quest-loading-screen', { body: png, contentType: 'image/png' });
    await writeFile(test.info().outputPath('quest-loading-screen.png'), png);
    console.log(`loading samples: ${samples.length}`);
    const withBar = samples.filter((s) => s.bar);
    console.log(`bar samples: ${withBar.length}, first ${JSON.stringify(withBar[0]?.bar ?? null)}, last ${JSON.stringify(withBar.at(-1)?.bar ?? null)}`);
    console.log(`max sweep ${Math.max(-1, ...samples.map((s) => s.sweep))}, max middle ${Math.max(-1, ...samples.map((s) => s.middle))}`);
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map((s) => s.middle))).toBeGreaterThan(0);
    expect(Math.max(...samples.map((s) => s.wipes))).toBeGreaterThan(1);
  });

  await test.step('the counter closes and the field screen is back', async () => {
    // The loading line waits for Enter; the counter is free once it is read.
    await expect
      .poll(
        async () => {
          if (!(await peek(page, (w) => w.classicTown.counterOpen))) return false;
          await key(page, 'Enter');
          return true;
        },
        { timeout: 60_000, intervals: [700] },
      )
      .toBe(false);
    expect(await peek(page, (w) => w.classicQuestLoading === undefined)).toBe(true);
    const quest = await peek(page, (w) => (w.classicTown.quest ? { name: w.classicTown.quest.name } : null));
    console.log(`quest held: ${JSON.stringify(quest)}`);
    expect(quest).not.toBeNull();
    expect(await peek(page, (w) => w.classicGame.game.loading)).toBe(false);
  });

  await test.step('leave the game cleanly (the quest ends with it)', async () => {
    await leaveToLobby(page);
    expect(await peek(page, (w) => w.classicTown === undefined)).toBe(true);
  });

  const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
  console.log(errors.join('\n'));
  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
