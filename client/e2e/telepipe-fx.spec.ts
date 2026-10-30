// Telepipe ring particles and loop SE 0xA0 start and stop on Forest 1 (render/telepipe.ts).
// Opens the caster's pipe (TelepipeLayer.open, as the Telepipe item / Ryuker), checks the pipe's
// particles are live and SE 0xA0 is played as a looping positional voice at the pipe, then closes
// the pipe (game.telepipes.close, as the 6x68 close) and checks the visual is gone, its group is out
// of the scene and SE 0xA0 was stopped. The exe makes no pipe light (render/telepipe.ts header), so
// none is asserted.
// The SE calls are recorded on SePlayer.prototype (play / stop), not read back from the audio
// output: headless Chromium may never start the AudioContext (play returns -1 then).
// Needs newserv and the bridge. See e2e/README.md.
import { expect, test } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

test.use({ trace: 'off', screenshot: 'off' });

test('Forest 1: telepipe ring particles and loop SE start and stop', async ({ page }) => {
  test.setTimeout(300_000);
  const logs = consoleLog(page);
  await enterFreshField(page, logs, { prefix: 'tpp' });
  await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
  await expect
    .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
    .toBe('1:false');
  await page.waitForTimeout(2000);

  // Record SePlayer.play / stop calls for SE 0xA0 (the slot is its own id: seSlot).
  await page.evaluate(async () => {
    const { SePlayer } = await import('/src/audio/se.ts');
    const calls: Array<{ op: string; loop?: boolean; at?: number[] }> = [];
    (window as any).__seCalls = calls;
    const play = SePlayer.prototype.play;
    const stop = SePlayer.prototype.stop;
    SePlayer.prototype.play = function (id: number, opts: any = {}) {
      if (id === 0xa0) calls.push({ op: 'play', loop: !!opts.loop, at: opts.at ? [...opts.at] : undefined });
      return play.call(this, id, opts);
    };
    SePlayer.prototype.stop = function (id: number) {
      if (id === 0xa0) calls.push({ op: 'stop' });
      return stop.call(this, id);
    };
  });

  const state = () =>
    page.evaluate(() => {
      const t = (window as any).classicGame.view.telepipes;
      const vs = [...t.visuals.values()] as any[];
      const calls = (window as any).__seCalls as Array<{ op: string; loop?: boolean; at?: number[] }>;
      return {
        visuals: vs.length,
        particles: vs.reduce((n, v) => n + v.particles.count, 0),
        inScene: vs.filter((v) => v.group.parent !== null).length,
        at: vs[0]?.at as number[] | undefined,
        plays: calls.filter((c) => c.op === 'play').length,
        stops: calls.filter((c) => c.op === 'stop').length,
        last: calls[calls.length - 1],
      };
    });

  expect(await state()).toMatchObject({ visuals: 0, plays: 0 });
  expect(await page.evaluate(() => (window as any).classicGame.view.telepipes.open())).toBe(true);
  await expect.poll(async () => (await state()).plays, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await state()).particles, { timeout: 15_000 }).toBeGreaterThan(0);
  const open = await state();
  expect(open).toMatchObject({ visuals: 1, inScene: 1 });
  expect(open.last).toMatchObject({ op: 'play', loop: true });
  expect(open.last?.at).toEqual(open.at); // positional, at the pipe

  // The pipe closes (the owner's state names no floor).
  await page.evaluate(() => {
    const g = (window as any).classicGame;
    (window as any).__pipeGroup = [...g.view.telepipes.visuals.values()][0].group;
    g.game.telepipes.close(g.game.selfId);
  });
  await expect.poll(async () => (await state()).visuals, { timeout: 15_000 }).toBe(0);
  const closed = await state();
  expect(closed.last).toMatchObject({ op: 'stop' });
  expect(closed.stops).toBeGreaterThan(open.stops);
  expect(await page.evaluate(() => (window as any).__pipeGroup.parent)).toBeNull();
});
