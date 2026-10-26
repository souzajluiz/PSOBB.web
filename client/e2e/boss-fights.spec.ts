// The Episode 1 bosses in Chrome with a strong fresh character (offline patch: level 100, high stat
// block, the equipped weapon swapped for a grind-44 Saber; bridge/admin-chars.mjs). Each boss is
// warped to: the Dragon (floor 11), De Rol Le (12), Vol Opt (13), and Dark Belra (the first of
// Ruins / Mines floors 6..10 that spawns its brain). For each one:
//   - the brain is built (DragonAi / DeRolLeAi / VoloptAi / BelraAi);
//   - its state (sid) changes over ~60 s (the phases run);
//   - key attacks (ArrowDown, held 120 ms, the palette's normal attack) land and log a hit with
//     damage (the render layer's `hit ... for N` lines, combat.ts applyEnemyHit).
// The kill and the exit are NOT checked here (the bosses have thousands of HP; see DEVLOG).
// No page error and no failed request. Screenshots go to the test's output folder (not committed).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, key, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const PREFIX = 'wbo';
// The equipped weapon becomes a DB'S SABER (code 000105, grind 44; names-v4, item-parameter-table-bb-v4).
const STRONG_WEAPON = '0001052c' + '00'.repeat(8); // 24 hex digits: code, grind, special, attribute

interface BossView {
  index: number;
  sid: number | null;
  state: unknown;
  hp: number | null;
  maxHp: number | null;
  dead: boolean;
  x: number;
  y: number;
  z: number;
}

// The first enemy whose brain's class is `cls`, or null.
const readBrain = (page: Page, cls: string) =>
  page.evaluate((c) => {
    const view = (window as any).classicGame?.view;
    if (!view) return null;
    const e = [...view.combat.enemies.values()].find((x: any) => x.ai?.constructor?.name === c) as any;
    if (!e) return null;
    const ai = e.ai;
    const p = e.instance.root.position;
    const hp = ai.hp ?? ai.bodyHp ?? null;
    const maxHp = ai.maxHp ?? ai.bodyMax ?? null;
    return { index: e.index, sid: ai.sid ?? null, state: ai.state ?? null, hp, maxHp, dead: !!e.dead, x: p.x, y: p.y, z: p.z } as BossView;
  }, cls);

const floorOf = (page: Page) => peek(page, (w) => w.classicGame.view.debug().floor() as number);

// Warps to `floor` and waits until the floor is the one asked for, then ~4 s for the boss to be built.
async function warpTo(page: Page, floor: number): Promise<void> {
  await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), floor);
  await expect.poll(() => floorOf(page), { timeout: 90_000 }).toBe(floor);
  await page.waitForTimeout(4000);
}

interface Fight {
  cls: string;
  floor: number;
  built: boolean;
  states: string[];
  stateChanges: number;
  hpStart: number | null;
  hpEnd: number | null;
  hitLines: string[];
}

// The fight on the current floor: sample the brain for `watchMs`, then attack (in front of the body,
// 35 units away) until 3 hit lines or `maxPresses` presses.
async function fight(page: Page, logs: string[], info: TestInfo, cls: string, floor: number, tag: string, watchMs: number, maxPresses = 40): Promise<Fight> {
  const out: Fight = { cls, floor, built: false, states: [], stateChanges: 0, hpStart: null, hpEnd: null, hitLines: [] };
  let b = await readBrain(page, cls);
  for (let i = 0; !b && i < 20; i++) {
    await page.waitForTimeout(500);
    b = await readBrain(page, cls);
  }
  if (!b) return out;
  out.built = true;
  out.hpStart = b.hp;
  console.log(`${tag} spawn: ${JSON.stringify(b)}`);
  await page.screenshot({ path: info.outputPath(`${tag}-0-spawn.png`) });

  // The phases: the brain's sid, sampled every 500 ms.
  let prev = b.sid;
  const seen = new Set<string>([String(b.sid)]);
  for (let t = 0; t < watchMs; t += 500) {
    await page.waitForTimeout(500);
    const s = await readBrain(page, cls);
    if (!s) break;
    b = s;
    seen.add(String(s.sid));
    if (s.sid !== prev) out.stateChanges++;
    prev = s.sid;
  }
  out.states = [...seen];
  console.log(`${tag} phases: sids ${out.states.join(',')}, changes ${out.stateChanges}, last ${JSON.stringify(b)}`);

  // Attack: stand 35 units from the body (facing it, as goldragon-smoke.spec.ts does), then press the
  // normal attack until the render layer logs three hits.
  const hitRe = /hit .*for \d+/;
  const mark = logs.length;
  const hits = () => logs.slice(mark).filter((l) => hitRe.test(l));
  for (let n = 0; n < maxPresses && hits().length < 3; n++) {
    const now = (await readBrain(page, cls)) ?? b;
    if (n % 4 === 0) {
      await page.evaluate(
        ([x, y, z]) => {
          const g = (window as any).classicGame.view;
          g.placePlayer(g.game.selfId, x, y, z + 35, Math.PI);
        },
        [now.x, now.y, now.z],
      );
      await page.waitForTimeout(300);
    }
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(120);
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(700);
  }
  out.hitLines = hits();
  const end = await readBrain(page, cls);
  out.hpEnd = end?.hp ?? null;
  await page.screenshot({ path: info.outputPath(`${tag}-1-fight.png`) });
  console.log(`${tag} hits: ${out.hitLines.length}, hp ${out.hpStart} -> ${out.hpEnd}\n${out.hitLines.slice(0, 6).join('\n')}`);
  return out;
}

test('Episode 1 bosses: Dragon, De Rol Le, Vol Opt and Dark Belra spawn, change phase and take damage', async ({ page }, info: TestInfo) => {
  test.setTimeout(1_500_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });

  await enterFreshField(page, logs, {
    prefix: PREFIX,
    patch: (c) => {
      const weapon = c.inventory.find((i) => i.equipped && i.kind === 'Weapon');
      return {
        level: 100,
        stats: { atp: 600, mst: 200, evp: 200, hp: 2000, dfp: 300, ata: 300, lck: 100 },
        inventory: { set: weapon ? [{ slot: weapon.slot, data1: STRONG_WEAPON }] : [] },
      };
    },
  });

  const results: Fight[] = [];

  await test.step('the Dragon (floor 11)', async () => {
    await warpTo(page, 11);
    results.push(await fight(page, logs, info, 'DragonAi', 11, 'dragon', 60_000));
  });
  await test.step('De Rol Le (floor 12)', async () => {
    await warpTo(page, 12);
    results.push(await fight(page, logs, info, 'DeRolLeAi', 12, 'derolle', 60_000));
  });
  await test.step('Vol Opt (floor 13)', async () => {
    await warpTo(page, 13);
    results.push(await fight(page, logs, info, 'VoloptAi', 13, 'volopt', 60_000));
  });
  await test.step('Dark Belra (the first Ruins / Mines floor that spawns it)', async () => {
    let found = false;
    for (const f of [8, 9, 10, 6, 7]) {
      await warpTo(page, f);
      if ((await readBrain(page, 'BelraAi')) !== null) {
        found = true;
        results.push(await fight(page, logs, info, 'BelraAi', f, 'belra', 60_000));
        break;
      }
    }
    expect(found, 'a Dark Belra is on floors 6..10').toBe(true);
  });

  console.log(`boss fights: ${JSON.stringify(results.map((r) => ({ cls: r.cls, floor: r.floor, built: r.built, changes: r.stateChanges, hits: r.hitLines.length, hp: [r.hpStart, r.hpEnd] })))}`);
  console.log(`failed requests: ${failed.length}\n${failed.join('\n')}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  for (const r of results) {
    expect(r.built, `${r.cls} is built on floor ${r.floor}`).toBe(true);
    expect(r.stateChanges, `${r.cls} changes phase`).toBeGreaterThan(0);
    expect(r.hitLines.length, `${r.cls} takes a hit`).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
