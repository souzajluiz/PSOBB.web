// Two classic clients (classic.html, the page production serves) in the same
// party field. A creates the party at the counter and enters it, B joins it
// (party-join.spec.ts); then both warp to Forest 1 (floor 1). A (desktop) walks,
// runs, stops and turns with real key presses. B (a Pixel 7 emulation, CPU
// throttled 4x while measuring, one-way WebSocket latency 100 ms +- 40 ms)
// samples A's remote marker on every animation frame, and A samples its own
// drawn pose on the same clock. Printed: lag (B's remote against A's drawn pose
// at the same wall time), overshoot, direction flips, zero-move frames,
// catch-up jumps, speed spread, animation mismatch and frame hitches.
//
// Needs newserv (vendor/newserv) and the bridge (bridge/bridge.mjs) running.
// PW_BASE_URL points at a Vite on its own port. See e2e/README.md.
import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER_A = process.env.PSO_USER_A ?? 'webmove1';
const USER_B = process.env.PSO_USER_B ?? 'webmove2';
const PASSWORD = process.env.PSO_MOVE_PASSWORD ?? 'webmove';
const LATENCY_MS = Number(process.env.PSO_LATENCY_MS ?? 100);
const JITTER_MS = Number(process.env.PSO_JITTER_MS ?? 40);
const CPU_RATE = Number(process.env.PSO_CPU_RATE ?? 4);
const OBSERVER = process.env.PSO_OBSERVER ?? 'phone';
const FLOOR = Number(process.env.PSO_FLOOR ?? 1); // Forest 1

// One-way delay with jitter and kept order, on the page's WebSocket (Chrome's
// network emulation does not shape WebSocket frames).
const latencyScript = (delay: number, jitter: number) => `
(() => {
  const D = ${delay}, J = ${jitter};
  const Native = window.WebSocket;
  const due = (last) => Math.max(last, performance.now() + D + J * (Math.random() * 2 - 1));
  function Wrapped(url, protocols) {
    const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
    let lastOut = 0, lastIn = 0, handler = null;
    const send = ws.send.bind(ws);
    ws.send = (data) => { lastOut = due(lastOut); setTimeout(() => send(data), Math.max(0, lastOut - performance.now())); };
    Object.defineProperty(ws, 'onmessage', { configurable: true, get: () => handler, set: (f) => { handler = f; } });
    ws.addEventListener('message', (e) => {
      lastIn = due(lastIn);
      setTimeout(() => handler && handler(e), Math.max(0, lastIn - performance.now()));
    });
    return ws;
  }
  Wrapped.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = Native[k];
  window.WebSocket = Wrapped;
})();
`;

// Records one sample per animation frame: the marker of `target` (own id for
// A, A's id for B) and the logic state of the local mover when there is one.
const samplerScript = () => {
  const w = window as any;
  w.__mv = { on: false, rec: [] as any[], target: null as number | null };
  const loop = (now: number) => {
    const s = w.__mv;
    if (s.on) {
      const v = w.gameView?.view;
      const rec: any = { t: now + performance.timeOrigin };
      if (v) {
        const id = s.target ?? v.lobby?.selfId;
        const m = v.markers?.get(id);
        if (m) {
          const p = m.group.position;
          rec.p = [p.x, p.y, p.z];
          rec.g = m.gait;
        }
        if (v.mover) rec.st = v.mover.state;
      }
      s.rec.push(rec);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

type Rec = { t: number; p?: [number, number, number]; g?: string; st?: string };

const round = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// A's drawn position at wall time t (linear between its frames).
function interp(aa: Rec[], t: number): [number, number, number] {
  if (t <= aa[0]!.t) return aa[0]!.p!;
  const last = aa[aa.length - 1]!;
  if (t >= last.t) return last.p!;
  let lo = 0;
  let hi = aa.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (aa[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - aa[lo]!.t) / (aa[hi]!.t - aa[lo]!.t || 1);
  const p0 = aa[lo]!.p!;
  const p1 = aa[hi]!.p!;
  return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f];
}

function stateAt(rs: Rec[], t: number): string | undefined {
  let st: string | undefined;
  for (const r of rs) {
    if (r.t > t) break;
    if (r.st !== undefined) st = r.st;
  }
  return st;
}

// Analysis of B's remote track against A's own track.
function analyse(a: Rec[], b: Rec[]): Record<string, number | string> {
  const aa = a.filter((r) => r.p);
  const bb = b.filter((r) => r.p);
  if (aa.length < 10 || bb.length < 10) return { error: `too few samples a=${aa.length} b=${bb.length}` };
  const lags = bb.map((r) => {
    const q = interp(aa, r.t);
    return Math.hypot(r.p![0] - q[0], r.p![2] - q[2]);
  });
  const sorted = [...lags].sort((x, y) => x - y);
  // B's per-frame step, and whether A moved over the same frame.
  const steps = [];
  for (let i = 1; i < bb.length; i++) {
    const p = bb[i]!.p!;
    const q = bb[i - 1]!.p!;
    const dt = (bb[i]!.t - bb[i - 1]!.t) / 1000;
    const a0 = interp(aa, bb[i - 1]!.t);
    const a1 = interp(aa, bb[i]!.t);
    steps.push({ vx: p[0] - q[0], vz: p[2] - q[2], dt, moving: Math.hypot(a1[0] - a0[0], a1[2] - a0[2]) > 0.02 });
  }
  const moving = steps.filter((s) => s.moving);
  const movingSteps = moving.map((s) => Math.hypot(s.vx, s.vz)).filter((d) => d > 0.01);
  const medStep = median(movingSteps);
  const zero = moving.filter((s) => Math.hypot(s.vx, s.vz) < 0.01).length;
  const jumps = moving.filter((s) => Math.hypot(s.vx, s.vz) > 2.5 * medStep).length;
  let flips = 0;
  for (let i = 1; i < steps.length; i++) {
    const s0 = steps[i - 1]!;
    const s1 = steps[i]!;
    if (!s0.moving || !s1.moving) continue;
    if (Math.hypot(s0.vx, s0.vz) < 0.05 || Math.hypot(s1.vx, s1.vz) < 0.05) continue;
    if (s0.vx * s1.vx + s0.vz * s1.vz < 0) flips++;
  }
  const speeds = moving.filter((s) => Math.hypot(s.vx, s.vz) > 0.01).map((s) => Math.hypot(s.vx, s.vz) / s.dt);
  const sm = mean(speeds);
  const sd = Math.sqrt(mean(speeds.map((x) => (x - sm) ** 2)));
  // Animation: A's state against B's marker gait on the same frame.
  let mismatch = 0;
  let compared = 0;
  const pairs: Record<string, number> = {};
  for (const r of bb) {
    const st = stateAt(a, r.t);
    if (!st || !r.g) continue;
    compared++;
    pairs[`${st}->${r.g}`] = (pairs[`${st}->${r.g}`] ?? 0) + 1;
    if ((st === 'stand' ? 'idle' : st) !== r.g) mismatch++;
  }
  console.log(`A state -> B gait: ${JSON.stringify(pairs)}`);
  // Transitions with times (ms from the first sample), for the timeline.
  const t0 = aa[0]!.t;
  const trans = (rs: Rec[], key: 'st' | 'g') => {
    const out: string[] = [];
    let prev: string | undefined;
    for (const r of rs) {
      const v = r[key];
      if (v === undefined || v === prev) continue;
      if (prev !== undefined) out.push(`${Math.round(r.t - t0)}:${prev}>${v}`);
      prev = v;
    }
    return out.join(' ');
  };
  console.log(`A transitions: ${trans(aa, 'st')}`);
  console.log(`B transitions: ${trans(bb, 'g')}`);
  // Overshoot: how far B's remote goes past A's final point, along A's last leg.
  const end = aa[aa.length - 1]!.p!;
  let start = aa[0]!.p!;
  for (let i = aa.length - 1; i > 0; i--) {
    const d = Math.hypot(aa[i]!.p![0] - aa[i - 1]!.p![0], aa[i]!.p![2] - aa[i - 1]!.p![2]);
    if (d < 0.001) {
      start = aa[i]!.p!;
      break;
    }
  }
  const ux = end[0] - start[0];
  const uz = end[2] - start[2];
  const ul = Math.hypot(ux, uz) || 1;
  let overshoot = 0;
  for (const r of bb) overshoot = Math.max(overshoot, ((r.p![0] - end[0]) * ux + (r.p![2] - end[2]) * uz) / ul);
  const span = (bb[bb.length - 1]!.t - bb[0]!.t) / 1000;
  return {
    samplesA: aa.length,
    samplesB: bb.length,
    lagMean: round(mean(lags)),
    lagP95: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    lagMax: round(sorted[sorted.length - 1] ?? 0),
    overshoot: round(overshoot),
    flipsPerSec: round(flips / span),
    movingFrames: moving.length,
    zeroMoveFrames: zero,
    catchUpJumps: jumps,
    medStepUnits: round(medStep),
    speedMean: round(sm),
    speedCv: round(sm ? sd / sm : 0),
    animMismatchPct: compared ? round((100 * mismatch) / compared) : 0,
  };
}

function hitches(rs: Rec[]): Record<string, number> {
  const d = rs.slice(1).map((r, i) => r.t - rs[i]!.t);
  return { frames: d.length, medianMs: round(median(d)), over50: d.filter((x) => x > 50).length, over100: d.filter((x) => x > 100).length };
}

test.describe.configure({ mode: 'serial' });

test('two classic clients in Forest 1: the remote follower on a throttled phone', async ({ browser }) => {
  test.setTimeout(900_000);
  const ctxA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // B logs in on a desktop window (the phone's login form is another flow);
  // the phone size is set once B is in the field (the stage takes the tall layout).
  const ctxB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const contexts = [ctxA, ctxB];
  for (const c of contexts) await c.addInitScript(latencyScript(LATENCY_MS, JITTER_MS));
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const logsA = consoleLog(a!);
  const logsB = consoleLog(b!);
  const pageA = a!;
  const pageB = b!;
  const cdpB: CDPSession = await ctxB.newCDPSession(pageB);
  const name = `mv${Date.now() % 100000}`;

  try {
    await test.step('A and B reach the lobby', async () => {
      await Promise.all([logIn(pageA, USER_A, PASSWORD).then(() => reachLobby(pageA)), logIn(pageB, USER_B, PASSWORD).then(() => reachLobby(pageB))]);
    });

    await test.step('A creates the party and enters it', async () => {
      await openPartyMenu(pageA);
      await key(pageA, 'ArrowDown'); // Create a PARTY
      await key(pageA, 'Enter');
      await key(pageA, 'Enter'); // EPISODE 1
      await expect.poll(() => peek(pageA, (w) => w.classicLobby.party?.phase)).toBe('create');
      await key(pageA, 'Enter'); // Party Name
      await pageA.keyboard.type(name, { delay: 30 });
      await key(pageA, 'Enter');
      await cursorTo(pageA, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
      await key(pageA, 'Enter');
      await expectInGame(pageA, logsA, name);
    });

    await test.step('B joins it from the list', async () => {
      await openPartyMenu(pageB);
      await key(pageB, 'Enter'); // Join a PARTY
      await expect.poll(() => peek(pageB, (w) => w.classicLobby.party?.phase)).toBe('list');
      const names = await peek(pageB, (w) => w.classicLobby.party.list.entries.map((e: { name: string }) => e.name));
      const index = names.indexOf(name);
      expect(index).toBeGreaterThanOrEqual(0);
      await cursorTo(pageB, (w) => w.classicLobby.party.list.cursor, index, 0x40);
      await key(pageB, 'Enter');
      await expectInGame(pageB, logsB, name);
    });

    await test.step('both see two players, then both warp to Forest 1', async () => {
      await expect.poll(() => peek(pageA, (w) => w.classicGame.game.players.size)).toBe(2);
      await expect.poll(() => peek(pageB, (w) => w.classicGame.game.players.size)).toBe(2);
      await pageA.evaluate((f) => (window as any).gameView.warpTo(f), FLOOR);
      await expect.poll(() => peek(pageA, (w) => w.classicGame.view.current?.floor), { timeout: 120_000 }).toBe(FLOOR);
      await pageB.evaluate((f) => (window as any).gameView.warpTo(f), FLOOR);
      await expect.poll(() => peek(pageB, (w) => w.classicGame.view.current?.floor), { timeout: 120_000 }).toBe(FLOOR);
    });

    const aId = await peek(pageA, (w) => w.classicGame.game.selfId as number);
    if (OBSERVER === 'phone') await pageB.setViewportSize({ width: 412, height: 839 });
    await pageA.evaluate(samplerScript);
    await pageB.evaluate(samplerScript);

    await test.step('measure: A walks, runs, stops and turns; B samples A', async () => {
      // Warm-up: a few seconds of keys so both sides are loaded and moving.
      await pageA.keyboard.down('w');
      await pageA.waitForTimeout(1500);
      await pageA.keyboard.up('w');
      // The throttle starts with the measurement (loading the field under 4x takes minutes).
      await cdpB.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
      await pageB.evaluate((id) => Object.assign((window as any).__mv, { on: true, rec: [], target: id }), aId);
      await pageA.evaluate(() => Object.assign((window as any).__mv, { on: true, rec: [], target: null }));
      const script: Array<[string[], number]> = [
        [['w'], 150], // a short tap: walk
        [[], 1200],
        [['w'], 2500], // held: run
        [[], 1200],
        [['a'], 800], // turn in place
        [['w', 'd'], 1500], // run, curving
        [[], 1500],
      ];
      for (const [keys, ms] of script) {
        for (const k of keys) await pageA.keyboard.down(k);
        await pageA.waitForTimeout(ms);
        for (const k of keys) await pageA.keyboard.up(k);
      }
      await pageB.waitForTimeout(800);
      const recA: Rec[] = await pageA.evaluate(() => {
        const s = (window as any).__mv;
        s.on = false;
        return s.rec;
      });
      const recB: Rec[] = await pageB.evaluate(() => {
        const s = (window as any).__mv;
        s.on = false;
        return s.rec;
      });
      console.log(`latency ${LATENCY_MS}+-${JITTER_MS} ms one way, B ${OBSERVER} CPU x${CPU_RATE}`);
      console.log(`B remote follower: ${JSON.stringify(analyse(recA, recB))}`);
      console.log(`A frames: ${JSON.stringify(hitches(recA))}`);
      console.log(`B frames: ${JSON.stringify(hitches(recB))}`);
    });

    await test.step('both go back to the lobby', async () => {
      await leaveToLobby(pageB);
      await leaveToLobby(pageA);
    });
    for (const [who, logs] of [['A', logsA], ['B', logsB]] as const) {
      const errors = logs.filter((l) => l.startsWith('error') || l.startsWith('pageerror'));
      if (errors.length) console.log(`${who}:\n${errors.join('\n')}`);
      expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
