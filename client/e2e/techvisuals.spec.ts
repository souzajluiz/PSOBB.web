// Visual check of the technique effects on Forest 1: every technique the TODO's "Technique visuals"
// item lists (the Foie and Barta families, Zonde, Gizonde, Razonde, Grants, Megid, and the support
// techniques Deband, Jellen, Zalure, Shifta, Resta, Anti). Reverser (needs a dead party member in
// range) and Ryuker (needs a telepipe) are not cast here: see e2e/README.md.
// The character is a fresh Force (FOmarl) whose save is patched offline with the techniques at
// level 30 (bridge/admin-chars.mjs); the cast reads those levels from the character file.
// Per cast: the effect objects are counted before, while the effect plays, and after it is gone
// (the counters must return to the baseline: the objects are disposed). Three screenshots per cast
// under test-results (techvisuals-<technique>-<ms>.jpg, JPEG to keep the disk use small).
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

// Screenshots are taken by hand; no traces or failure screenshots (the disk is small).
test.use({ trace: 'off', screenshot: 'off' });

// The harness shield, before each cast: the Force's HP is topped up and it gets `SHIELD_TICKS` of
// the exe's invulnerability (PlayerDamage.invuln). That is an exe state, not a client shortcut:
// enemies do not target or hit a player whose maybe_invuln flag is set (PsoBB.exe dump lines 317577
// and 314778; the flag follows invuln_frames >= 1, line 555330). Without it a wave hit during the
// charge ends the cast (a hit ends input state 8: HandlePlayerInputState_0069ed10 runs state 8's
// end handler, ResetPlayerTechState_006a2a90, dump lines 584743 and 588374), and the wave kills
// the character over the casts (its HP is not restored between them).
// The shield does not clear a freeze: that one wears off by its frames, and the idle wait waits
// for it. A paralysis has no end of its own in this client (combat/status.ts), so the shield cures it.
const SHIELD_TICKS = 600;

// Runs in the page (Playwright serialises it, so it takes no closure).
function shieldSelf(ticks: number): void {
  const combat = (window as any).classicGame.view.combat;
  const d = combat.damage;
  if (combat.status.slot0?.type === 0x10) combat.status.cure(0x10);
  if (!d.dead) {
    d.hp = d.maxHp;
    d.invuln = Math.max(d.invuln, ticks);
  }
}

// Faces the nearest live enemy from `dist` units. With `tech` it also casts there, in the same
// evaluate, so the enemy cannot leave the technique's reach between the facing and the cast.
// Returns true when only facing was asked for, else the cast's result.
function faceNearestEnemy(arg: { dist: number; tech?: number }): any {
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
  const at = { x: p.x - arg.dist * Math.sin(a), y: p.y, z: p.z - arg.dist * Math.cos(a) };
  g.game.self.angle = a;
  g.view.placePlayer(self, at.x, p.y, at.z, a);
  g.game.self.angle = a;
  if (arg.tech === undefined) return true;
  combat.tp = 999; // the HUD's TP is topped up before each cast (the server can lower it)
  const ok = combat.castTechnique(arg.tech);
  // The 6x47 list (the targets the cast sends) and the enemies in the cast's list.
  return { ok, sent: combat.cast?.sent.length ?? -1, targets: combat.cast?.targets.length ?? -1, enemies: [...combat.enemies.values()].filter((e: any) => !e.dead && e.instance?.root?.visible).length };
}

const OUT_DIR = fileURLToPath(new URL('../test-results/', import.meta.url));

// The Force's class (bridge/admin-chars.mjs CHAR_CLASSES: FOmarl).
const FORCE_CLASS = 6;

// TECH indexes (combat/techniques.ts TECH), the screenshot names, and the distance the Force
// stands from the nearest enemy (`dist`): the cone and range of the enemy-picked techniques
// (combat/techniques.ts techTargets) reach only a short way, so they are cast from 8 units.
const CASTS: Array<{ name: string; tech: number; dist: number }> = [
  { name: 'foie', tech: 0, dist: 25 },
  { name: 'gifoie', tech: 1, dist: 25 },
  { name: 'rafoie', tech: 2, dist: 25 },
  { name: 'barta', tech: 3, dist: 25 },
  { name: 'gibarta', tech: 4, dist: 25 },
  { name: 'rabarta', tech: 5, dist: 25 },
  { name: 'zonde', tech: 6, dist: 8 },
  { name: 'gizonde', tech: 7, dist: 8 },
  { name: 'razonde', tech: 8, dist: 8 },
  { name: 'grants', tech: 9, dist: 8 },
  { name: 'deband', tech: 10, dist: 8 },
  { name: 'jellen', tech: 11, dist: 8 },
  { name: 'zalure', tech: 12, dist: 8 },
  { name: 'shifta', tech: 13, dist: 8 },
  { name: 'resta', tech: 15, dist: 8 },
  { name: 'anti', tech: 16, dist: 8 },
  { name: 'megid', tech: 18, dist: 25 },
];

// The save's technique names (bridge/admin-chars.mjs TECHNIQUES, the same index as TECH).
const TECH_SAVE_NAMES = [
  'Foie', 'Gifoie', 'Rafoie', 'Barta', 'Gibarta', 'Rabarta', 'Zonde', 'Gizonde', 'Razonde', 'Grants',
  'Deband', 'Jellen', 'Zalure', 'Shifta', 'Ryuker', 'Resta', 'Anti', 'Reverser', 'Megid',
];

// Screenshots, each this many ms after the cast starts (the cast motion, then the effect).
const SHOT_MS = [400, 1000, 2000];

// The effect objects of the combat view: the technique objects (render/techlightning.ts TechObjects:
// grants, orbs, pending), the lightning / ring / ball models (TechEffects), the technique objects of
// render/techfire.ts, and the particle bursts (FieldParticles, the combat's fx).
interface EffectCounts {
  grants: number;
  orbs: number;
  pending: number;
  bolts: number;
  rings: number;
  balls: number;
  fire: number;
  bursts: number;
}

const counts = (page: Page): Promise<EffectCounts | null> =>
  page.evaluate(() => {
    const c = (window as any).classicGame?.view?.combat;
    if (!c) return null;
    const o = c.techObjects;
    const t = c.techfx;
    return {
      grants: o?.grants.length ?? 0,
      orbs: o?.orbs.length ?? 0,
      pending: o?.pending.length ?? 0,
      bolts: t?.bolts.length ?? 0,
      rings: t?.rings.length ?? 0,
      balls: t?.balls.length ?? 0,
      fire: c.techFire?.active ?? 0,
      bursts: c.fx?.active ?? 0,
    };
  });

const total = (k: EffectCounts): number => Object.values(k).reduce((a, b) => a + b, 0);

test('Forest 1: every technique of the Technique visuals item cast at the nearest enemy', async ({ page }) => {
  test.setTimeout(3_000_000);
  const logs = consoleLog(page);
  const patch = {
    charClass: FORCE_CLASS,
    techniques: Object.fromEntries(CASTS.map((c) => [TECH_SAVE_NAMES[c.tech], 30])),
  };
  await test.step('a fresh Force account in a party field (techniques at level 30 in the save)', () =>
    enterFreshField(page, logs, { prefix: 'tvi', patch: () => patch }),
  );

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

  await test.step('the save gave the Force the techniques (the character file the cast reads)', async () => {
    const levels = await page.evaluate((list: number[]) => {
      const c = (window as any).classicGame.view.combat.opts.character?.();
      return c ? list.map((t) => c.techLevels[t]) : null;
    }, CASTS.map((c) => c.tech));
    expect(levels).not.toBeNull();
    expect(levels!.every((lv) => lv === 30)).toBe(true);
  });

  // Faces the nearest live enemy from `dist` units (as lockon.spec.ts), so each cast has a target.
  const faceNearest = (dist: number) => page.evaluate(faceNearestEnemy, { dist });

  // The shield before a cast, and a floor reload when the character is dead (a floor load resets
  // the damage state, PlayerDamage.reset; a dead character has no busy end to wait for).
  const shieldOrReload = async () => {
    await page.evaluate(shieldSelf, SHIELD_TICKS);
    if (await peek(page, (w) => w.classicGame.view.combat.damage.dead)) {
      await loadWave();
      await page.evaluate(shieldSelf, SHIELD_TICKS);
    }
  };

  const liveEnemies = () =>
    peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].some((e: any) => !e.dead && e.instance?.root?.visible));

  mkdirSync(OUT_DIR, { recursive: true });
  const report: string[] = [];
  const failures: string[] = [];
  // TV_ONLY=zonde,gizonde runs only those casts (a debugging filter; the full run has none).
  const only = process.env.TV_ONLY?.split(',');
  for (const cast of CASTS.filter((c) => !only || only.includes(c.name))) {
    await test.step(`${cast.name}: cast at the nearest enemy, effect objects counted and shot`, async () => {
      // An earlier cast may have killed the wave: the floor is loaded again with a new wave.
      // (Fewer than 3 live enemies: the earlier casts thinned the wave, and a cast needs targets in range.)
      const live = await peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].filter((e: any) => !e.dead && e.instance?.root?.visible).length);
      const dead = await peek(page, (w) => w.classicGame.view.combat.damage.dead);
      if (live < 3 || !(await liveEnemies()) || dead) await loadWave();
      // The lock-on picks the enemy (the cast's targets read it), as lockon.spec.ts. When it
      // does not (the wave is left out of the cone after an earlier cast), the wave is loaded again.
      const locked = () => peek(page, (w) => w.classicGame.view.combat.lockOn !== null);
      let placeDist = cast.dist;
      for (let attempt = 0; ; attempt++) {
        placeDist = attempt === 0 ? cast.dist : 8;
        expect(await faceNearest(placeDist)).toBe(true);
        try {
          await expect.poll(locked, { timeout: 5_000 }).toBe(true);
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
          await loadWave();
        }
      }
      await page.waitForTimeout(500);
      // The shield comes last: a floor load resets the damage state (PlayerDamage.reset clears invuln).
      await shieldOrReload();
      // The previous cast's effects are gone before the next (the cast and the attack are idle).
      await expect
        .poll(() => peek(page, (w) => { const c = w.classicGame.view.combat; return !c.cast && !c.attack?.active && !c.damage?.busy && !c.status?.immobile; }), { timeout: 30_000 })
        .toBe(true);
      // The baseline: whatever is on screen before the cast (ambient bursts) must be there after it.
      const before = (await counts(page))!;
      // The peak of the counters is sampled in the page (every 20 ms), so the screenshots' time does not hide a short effect.
      await page.evaluate(() => {
        const w = window as any;
        clearInterval(w.__tvTimer);
        w.__tvPeak = null;
        w.__tvTimer = setInterval(() => {
          const c = w.classicGame?.view?.combat;
          if (!c) return;
          const k = {
            grants: c.techObjects?.grants.length ?? 0,
            orbs: c.techObjects?.orbs.length ?? 0,
            pending: c.techObjects?.pending.length ?? 0,
            bolts: c.techfx?.bolts.length ?? 0,
            rings: c.techfx?.rings.length ?? 0,
            balls: c.techfx?.balls.length ?? 0,
            fire: c.techFire?.active ?? 0,
            bursts: c.fx?.active ?? 0,
          };
          const p = w.__tvPeak;
          if (!p) w.__tvPeak = k;
          else for (const key of Object.keys(k)) p[key] = Math.max(p[key], k[key]);
        }, 20);
      });
      const logAt = logs.length;
      // Facing the nearest enemy and the cast in one evaluate (faceNearestEnemy).
      const cast6x47 = await page.evaluate(faceNearestEnemy, { dist: placeDist, tech: cast.tech });
      const started = cast6x47.ok;
      console.log('TECHVIS', cast.name, 'cast', started, JSON.stringify(cast6x47), started ? '' : logs.slice(-3).join(' | '));
      expect(started).toBe(true);
      // Frames through the cast: the projectile and the hit are fast, the orbs and rings are slow.
      const shots: Buffer[] = [];
      let at = 0;
      for (const t of SHOT_MS) {
        await page.waitForTimeout(t - at);
        at = t;
        const path = `${OUT_DIR}techvisuals-${cast.name}-${t}.jpg`;
        shots.push(await page.screenshot({ path, type: 'jpeg', quality: 70 }));
      }
      const peak: EffectCounts = await page.evaluate(() => {
        const w = window as any;
        clearInterval(w.__tvTimer);
        return { ...w.__tvPeak };
      });
      // Created: some effect object or particle burst was alive while the cast played.
      const created = total(peak) > total(before);
      // Animated: the frames differ while the effect plays.
      const animated = shots.some((s, i) => i > 0 && !s.equals(shots[0]));
      // Let the effect play out, then the counters must be back at the baseline (disposed).
      await page.waitForTimeout(2500);
      let disposed = false;
      for (let i = 0; i < 40 && !disposed; i++) {
        disposed = total((await counts(page))!) === total(before);
        if (!disposed) await page.waitForTimeout(500);
      }
      const after = (await counts(page))!;
      const line = `${cast.name}: created ${created} animated ${animated} disposed ${disposed} (peak ${total(peak)}, before ${total(before)}, after ${total(after)})`;
      report.push(line);
      if (!created || !animated || !disposed) failures.push(line);
      console.log('TECHVIS', cast.name, 'peak', JSON.stringify(peak), 'after', JSON.stringify(after));
      if (!created || !animated || !disposed) console.log('TECHVIS', cast.name, 'game log', logs.slice(logAt).join(' | ').slice(0, 1500));
    });
  }
  console.log('TECHVIS summary\n' + report.join('\n'));
  // Every cast is checked above; the failures are listed together at the end.
  expect(failures, 'effect checks that failed').toEqual([]);
});
