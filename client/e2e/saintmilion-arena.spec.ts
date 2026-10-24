// Saint-Milion's arena in Chrome (HANDOFF item 4, the 2026-10-24 check): one classic client on the
// Episode 4 page creates an EPISODE 4 party, warps to the boss floor (9), walks into the arena so the
// body wakes, and watches it for 30 s with nothing forced. Checked:
//   - the brain runs: its sid changes while the page runs, and the page does not hang (the rAF
//     counter keeps rising and no gap between two samples is long);
//   - the tentacles (spinners) are posed: a visible spinner's node 3 sits at its rise, applied from
//     the motion each frame and not accumulated (node x - rise stays constant over the samples), and
//     its scaled node stays bounded;
//   - the part hit boxes sit on their model nodes: each part's enemy is at the captured node (matrix
//     slot 5 + i, SM_NODES) and that node's live world position is within a tick's motion of it.
// No page error and no failed request. Screenshots go to the test's output folder (not committed).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webtest';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webtest';
const SAINT_MILION_FLOOR = 9; // questeditor/areas.ts floorToArea(3): area 0x2c
const WATCH_SECONDS = 30;

// SM_NODES (the matrix slot -> model node table), read from the source so the spec does not import
// the game's modules.
function readSmNodes(): number[] {
  const src = readFileSync(new URL('../src/combat/saintmilionboss.ts', import.meta.url), 'utf8');
  const m = /export const SM_NODES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error('SM_NODES not found in saintmilionboss.ts');
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

interface Spinner {
  k: number;
  visible: boolean;
  rise: number;
  shrink: number;
  nodeX: number | null;
  scaleX: number | null;
}
interface Part {
  i: number;
  hittable: boolean;
  box: [number, number, number];
  cap: [number, number, number];
  live: [number, number, number] | null;
}
interface Sample {
  now: number;
  ticks: number;
  state: string;
  sid: number;
  form: number;
  arena: number;
  spinners: Spinner[];
  parts: Part[];
  afterShot?: boolean;
}

test('Saint-Milion arena: the brain runs, tentacles are posed, part boxes sit on the model nodes, no hang', async ({ page }, info) => {
  test.setTimeout(420_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const name = `sa${Date.now() % 100000}`;

  await logIn(page, USER, PASSWORD, 'screen=input&ep4');
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown'); // Create a PARTY
  await key(page, 'Enter');
  await key(page, 'ArrowDown', 2); // EPISODE 4 (the third row, offered with ep4)
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.create?.episode)).toBe(3);
  await key(page, 'Enter'); // Party Name
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  const floor = () => peek(page, (w) => w.classicGame?.view?.debug().floor() as number);
  await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), SAINT_MILION_FLOOR);
  await expect.poll(floor, { timeout: 90_000 }).toBe(SAINT_MILION_FLOOR);
  await page.waitForTimeout(4000);

  const spawn = await peek(page, (w) => {
    const c = w.classicGame.view.combat;
    const e = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'SaintMilionAi');
    return e ? `state=${e.ai.state} sid=${e.ai.sid}` : `no boss (${c.enemies.size} enemies)`;
  });
  console.log(`saint-milion spawn: ${spawn}`);
  expect(spawn.startsWith('no boss')).toBe(false);
  await page.screenshot({ path: info.outputPath('sm-arena-0-spawn.png') });

  // A rAF counter in the page: a hang stops it.
  await page.evaluate((nodes) => {
    const w = window as any;
    w.__smNodes = nodes;
    w.__smTicks = 0;
    const tick = () => {
      w.__smTicks++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, readSmNodes());

  // Walk the player into the arena (the body wakes for a player within sqrt(6251) of (-50, 24)).
  await peek(page, (w) => w.classicGame.view.placePlayer(w.classicGame.game.selfId, -50, 0, 24, 0));

  const samples: Sample[] = [];
  const t0 = Date.now();
  for (let i = 0; i < WATCH_SECONDS * 2; i++) {
    const s = await page.evaluate((): Sample | null => {
      const w = window as any;
      const M: number[] = w.__smNodes;
      const c = w.classicGame.view.combat;
      const e = [...c.enemies.values()].find((x: any) => x.ai?.constructor?.name === 'SaintMilionAi') as any;
      if (!e) return null;
      const ai = e.ai;
      const spinners: Spinner[] = (ai.field.entities as any[]).map((t: any, k: number) => {
        const g = e.instance.world?.getObjectByName(`spinner ${k}`);
        const idx = e.instance.parts.findIndex((p: any) => p.name === `spinner ${k}`);
        const tree = e.instance.nodes?.[idx];
        return {
          k,
          visible: !!g && g.visible,
          rise: t.rise as number,
          shrink: t.shrink as number,
          nodeX: tree && tree[3] ? (tree[3].position.x as number) : null,
          scaleX: tree && tree[46] ? (tree[46].scale.x as number) : null,
        };
      });
      const body = e.instance.nodes?.[0];
      const view = c.smHeads?.get(e.index);
      const parts: Part[] = [];
      for (let i = 0; i < 8; i++) {
        const rt = view?.proxies?.[i];
        const cap = ai.node(5 + i);
        if (!rt || !cap) continue;
        const p = rt.instance.root.position;
        const node = body ? body[M[5 + i]] : null;
        const lv = node ? node.getWorldPosition(p.clone()) : null;
        parts.push({
          i,
          hittable: !!ai.partHittable(i),
          box: [p.x, p.y, p.z],
          cap: [cap[0], cap[1], cap[2]],
          live: lv ? [lv.x, lv.y, lv.z] : null,
        });
      }
      return {
        now: Date.now(),
        ticks: w.__smTicks as number,
        state: ai.state as string,
        sid: ai.sid as number,
        form: ai.form as number,
        arena: ai.arena as number,
        spinners,
        parts,
      };
    });
    if (s) samples.push(s);
    if (i === 20) {
      // The screenshot stalls the page for a while: the gap after it is not a hang and is not counted.
      await page.screenshot({ path: info.outputPath('sm-arena-1-watch.png') });
      samples[samples.length - 1].afterShot = true;
    }
    if (i % 10 === 0) console.log(`t=${i / 2}s ${s ? `state=${s.state} sid=${s.sid} form=${s.form} arena=${s.arena}` : 'no boss'}`);
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: info.outputPath('sm-arena-2-end.png') });
  const ticks = await page.evaluate(() => (window as any).__smTicks as number);
  console.log(`watched ${((Date.now() - t0) / 1000).toFixed(1)} s, rAF frames ${ticks}`);

  // 1. The brain runs: samples keep coming, its sid changes, and no gap between samples is long.
  expect(samples.length, 'boss samples').toBeGreaterThan(WATCH_SECONDS);
  const sids = new Set(samples.map((s) => s.sid));
  const states = new Set(samples.map((s) => s.state));
  console.log(`brain: sids ${JSON.stringify([...sids])} states ${JSON.stringify([...states])}`);
  expect(sids.size, 'the brain changes its sid while watched').toBeGreaterThan(1);
  let maxGap = 0;
  for (let i = 1; i < samples.length; i++) if (!samples[i - 1].afterShot) maxGap = Math.max(maxGap, samples[i].now - samples[i - 1].now);
  console.log(`max gap between samples ${maxGap} ms`);
  expect(maxGap).toBeLessThan(5000);
  expect(ticks, 'rAF frames over the watch').toBeGreaterThan(WATCH_SECONDS * 20);

  // 2. Tentacles posed: a visible spinner's node 3 is at its rise (the rise node's bind is 0) and its
  // scaled node 46 is at 1 - 0.9 * shrink (combat/saintmilion.ts spinnerScale), each sample, so the
  // pose follows the entity and does not accumulate. The spinners must move while watched.
  let riseErr = 0;
  let scaleErr = 0;
  let posedSamples = 0;
  const moved = new Map<number, { rise: [number, number]; shrink: [number, number] }>();
  for (const s of samples) {
    for (const sp of s.spinners) {
      if (!sp.visible || sp.nodeX === null || sp.scaleX === null) continue;
      posedSamples++;
      riseErr = Math.max(riseErr, Math.abs(sp.nodeX - sp.rise));
      scaleErr = Math.max(scaleErr, Math.abs(sp.scaleX - (1 - 0.9 * sp.shrink)));
      const m = moved.get(sp.k) ?? { rise: [sp.rise, sp.rise], shrink: [sp.shrink, sp.shrink] };
      m.rise = [Math.min(m.rise[0], sp.rise), Math.max(m.rise[1], sp.rise)];
      m.shrink = [Math.min(m.shrink[0], sp.shrink), Math.max(m.shrink[1], sp.shrink)];
      moved.set(sp.k, m);
    }
  }
  const rows = [...moved].map(([k, m]) => `spinner ${k}: rise ${m.rise[0].toFixed(2)}..${m.rise[1].toFixed(2)}, shrink ${m.shrink[0].toFixed(2)}..${m.shrink[1].toFixed(2)}`);
  console.log(`tentacles: ${posedSamples} visible-spinner samples, node3 vs rise error ${riseErr.toExponential(2)}, node46 scale vs 1 - 0.9 shrink error ${scaleErr.toExponential(2)}\n${rows.join('\n') || '(none visible)'}`);
  expect(posedSamples, 'a spinner is visible and posed').toBeGreaterThan(0);
  expect(riseErr, 'the rise node follows the spinner rise').toBeLessThan(1e-3);
  expect(scaleErr, 'the scaled node follows the spinner shrink').toBeLessThan(1e-3);
  const movedAny = [...moved.values()].some((m) => m.rise[1] - m.rise[0] > 0.5 || m.shrink[1] - m.shrink[0] > 0.05);
  expect(movedAny, 'a visible spinner rises or shrinks while watched').toBe(true);

  // 3. Part boxes on the model nodes: the box is the captured node (ai.node), and the captured node
  // is within a tick's motion of the live node's world position.
  let worstBox = 0;
  let worstLive = 0;
  let checked = 0;
  for (const s of samples) {
    for (const p of s.parts) {
      if (!p.hittable) continue;
      checked++;
      worstBox = Math.max(worstBox, Math.hypot(p.box[0] - p.cap[0], p.box[1] - p.cap[1], p.box[2] - p.cap[2]));
      if (p.live) worstLive = Math.max(worstLive, Math.hypot(p.cap[0] - p.live[0], p.cap[1] - p.live[1], p.cap[2] - p.live[2]));
    }
  }
  const last = samples[samples.length - 1];
  console.log(`part boxes: ${checked} hittable samples; worst box-to-captured-node ${worstBox.toFixed(3)}, captured-to-live ${worstLive.toFixed(3)}`);
  console.log(`last parts: ${JSON.stringify(last.parts.map((p) => ({ i: p.i, hittable: p.hittable, box: p.box.map((x) => +x.toFixed(1)), live: p.live?.map((x) => +x.toFixed(1)) })))}`);
  expect(checked, 'hittable parts were sampled').toBeGreaterThan(0);
  expect(worstBox, 'part boxes sit on the captured nodes').toBeLessThan(1e-3);
  expect(worstLive, 'captured nodes are within a tick of the live nodes').toBeLessThan(10);

  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
