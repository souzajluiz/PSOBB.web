// The lock-on reticle and the target card on Forest 1 (PsoBB.exe: enable_reticle,
// PositionAndRenderReticlePrimitives_007a360c, ui_target_window_attribute). The player is
// put a short way in front of the nearest enemy, facing it; the lock-on must pick it, the
// cursor must show over it and the bottom-left card must name it. A screenshot is kept under
// test-results for comparison with the reference screenshots.
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const OUT_DIR = fileURLToPath(new URL('../test-results/', import.meta.url));

test('Forest 1: facing an enemy locks on, the cursor and the target card show', async ({ page }) => {
  const logs = consoleLog(page);
  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'lok' }));

  await test.step('Forest 1 is loaded', async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect
      .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
      .toBe('1:false');
    await page.waitForTimeout(2000);
  });

  await test.step('the player faces the nearest enemy from 25 units away', async () => {
    // As guns.spec.ts: place the player (GameView.placePlayer) 25 units behind the nearest
    // enemy, facing it, and set the game's heading (the lock-on's cone reads game.self.angle).
    await expect
      .poll(() => peek(page, (w) => [...(w.classicGame.view.combat.enemies?.values() ?? [])].some((e: any) => e && !e.dead && e.instance?.root)), { timeout: 60_000 })
      .toBe(true);
    await peek(page, (w) => {
      const g = w.classicGame;
      const combat = g.view.combat;
      const self = g.game.selfId;
      const from = combat.view.playerPositions().get(self);
      let best: any = null;
      let bestD = Infinity;
      for (const e of combat.enemies.values()) {
        if (!e || e.dead || !e.instance?.root) continue;
        const p = e.instance.root.position;
        const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      const p = best.instance.root.position;
      const a = Math.atan2(p.x - from.x, p.z - from.z);
      const at = { x: p.x - 25 * Math.sin(a), y: p.y, z: p.z - 25 * Math.cos(a) };
      g.game.self.angle = a;
      g.view.placePlayer(self, at.x, p.y, at.z, a);
      g.game.self.angle = a;
      return true;
    });
  });

  await test.step('the lock-on picks the enemy and the cursor shows over it', async () => {
    await page.waitForTimeout(1000);
    await expect
      .poll(() => peek(page, (w) => w.classicGame.view.combat.lockOn !== null), { timeout: 15_000 })
      .toBe(true);
    await expect
      .poll(() => peek(page, (w) => w.classicGame.view.combat.overlay?.reticle?.group?.visible === true), { timeout: 15_000 })
      .toBe(true);
  });

  await test.step('the target card names the enemy with its attribute', async () => {
    await expect.poll(() => peek(page, (w) => w.classicGame.view.combat.hud?.targetCard?.name ?? null), { timeout: 15_000 }).not.toBeNull();
    const card = await peek(page, (w) => w.classicGame.view.combat.hud.targetCard);
    expect(card.name.length).toBeGreaterThan(0);
    expect(card.label).toBe('Attribute:');
  });

  await test.step('a screenshot for comparison', async () => {
    await page.waitForTimeout(500);
    mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: `${OUT_DIR}lockon.png` });
  });
});
