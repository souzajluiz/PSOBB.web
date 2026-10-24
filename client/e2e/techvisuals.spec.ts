// Visual check of the technique effects on Forest 1: Foie, Gifoie, Barta, Gibarta, Rabarta,
// Zonde, Gizonde and Megid cast at the nearest enemy. One screenshot per cast is kept under
// test-results (techvisuals-<technique>.png) while the cast's effect is on screen, so the
// effects can be read by eye. The character is given the techniques' levels in the page (the
// combat's character file, the same object the cast reads), and the TP is topped up.
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

// Screenshots are taken by hand; no traces or failure screenshots (the disk is small).
test.use({ trace: 'off', screenshot: 'off' });

const OUT_DIR = fileURLToPath(new URL('../test-results/', import.meta.url));

// TECH indexes (combat/techniques.ts TECH) and the screenshot names.
const CASTS: Array<{ name: string; tech: number }> = [
  { name: 'foie', tech: 0 },
  { name: 'gifoie', tech: 1 },
  { name: 'barta', tech: 3 },
  { name: 'gibarta', tech: 4 },
  { name: 'rabarta', tech: 5 },
  { name: 'zonde', tech: 6 },
  { name: 'gizonde', tech: 7 },
  { name: 'megid', tech: 18 },
];

// Screenshots, each this many ms after the cast starts (the cast motion, then the effect).
const SHOT_MS = [300, 600, 1000, 1500, 2200];

test('Forest 1: the Foie, Barta, Zonde and Megid effects at the nearest enemy', async ({ page }) => {
  test.setTimeout(900_000);
  const logs = consoleLog(page);
  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'tvi' }));

  // Forest 1 (warp) and the wave of room 2 (constructEnemies), as lockon.spec.ts.
  // A killed wave is not built again on the same floor, so the floor is left (Pioneer 2) first.
  const loadWave = async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(0));
    await expect
      .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
      .toBe('0:false');
    await page.waitForTimeout(1000);
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect
      .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
      .toBe('1:false');
    await page.evaluate(() => (window as any).classicGame.view.constructEnemies(1, 2, 1));
    await expect
      .poll(() => peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].some((e: any) => !e.dead && e.instance?.root?.visible)), { timeout: 60_000 })
      .toBe(true);
    await page.waitForTimeout(2000);
  };

  await test.step('Forest 1 is loaded with a wave', loadWave);

  await test.step('the character knows the techniques at level 30', async () => {
    const techs = CASTS.map((c) => c.tech);
    const set = await page.evaluate((list: number[]) => {
      const combat = (window as any).classicGame.view.combat;
      const c = combat.opts.character?.();
      if (!c) return false;
      for (const t of list) c.techLevels[t] = 30;
      return true;
    }, techs);
    expect(set).toBe(true);
  });

  // Faces the nearest live enemy from 25 units (as lockon.spec.ts), so each cast has a target.
  const faceNearest = (dist: number) =>
    page.evaluate((dist: number) => {
      const g = (window as any).classicGame;
      const combat = g.view.combat;
      const self = g.game.selfId;
      const from = combat.view.playerPositions().get(self);
      let best: any = null;
      let bestD = Infinity;
      for (const e of combat.enemies.values()) {
        if (!e || e.dead || !e.instance?.root?.visible) continue;
        const p = e.instance.root.position;
        const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best) return false;
      const p = best.instance.root.position;
      const a = Math.atan2(p.x - from.x, p.z - from.z);
      const at = { x: p.x - dist * Math.sin(a), y: p.y, z: p.z - dist * Math.cos(a) };
      g.game.self.angle = a;
      g.view.placePlayer(self, at.x, p.y, at.z, a);
      g.game.self.angle = a;
      return true;
    }, dist);

  const liveEnemies = () =>
    peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].some((e: any) => !e.dead && e.instance?.root?.visible));

  mkdirSync(OUT_DIR, { recursive: true });
  for (const cast of CASTS) {
    await test.step(`${cast.name}: cast at the nearest enemy, mid-cast screenshot`, async () => {
      // An earlier cast may have killed the wave: the floor is loaded again with a new wave.
      if (!(await liveEnemies())) await loadWave();
      // The lock-on picks the enemy (the cast's targets read it), as lockon.spec.ts. When it
      // does not (the wave is left out of the cone after an earlier cast), the wave is loaded again.
      const locked = () => peek(page, (w) => w.classicGame.view.combat.lockOn !== null);
      for (let attempt = 0; ; attempt++) {
        expect(await faceNearest(attempt === 0 ? 25 : 12)).toBe(true);
        try {
          await expect.poll(locked, { timeout: 5_000 }).toBe(true);
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
          await loadWave();
        }
      }
      await page.waitForTimeout(500);
      // The previous cast's effects are gone before the next (the cast and the attack are idle).
      await expect
        .poll(() => peek(page, (w) => { const c = w.classicGame.view.combat; return !c.cast && !c.attack?.active && !c.damage?.busy && !c.status?.immobile; }), { timeout: 30_000 })
        .toBe(true);
      const started = await page.evaluate((t: number) => {
        const combat = (window as any).classicGame.view.combat;
        combat.tp = 999; // the HUD's TP is topped up before each cast (the server can lower it)
        return combat.castTechnique(t);
      }, cast.tech);
      console.log('TECHVIS', cast.name, 'cast', started, started ? '' : logs.slice(-3).join(' | '));
      expect(started).toBe(true);
      // Frames through the cast: the projectile and the hit are fast, the orbs and rings are slow.
      let at = 0;
      for (const t of SHOT_MS) {
        await page.waitForTimeout(t - at);
        at = t;
        await page.screenshot({ path: `${OUT_DIR}techvisuals-${cast.name}-${t}.png` });
      }
      // Let the effect play out before the next cast.
      await page.waitForTimeout(2500);
    });
  }
});
