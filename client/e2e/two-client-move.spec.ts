// Two classic clients (classic.html, the page production serves) on two fresh accounts.
// Steps, in order:
//   1. Frame hitches of A in the lobby, alone and then with B in the lobby (both under the
//      same CPU throttle, the measured client's page throttled 4x while walking).
//   2. The same two comparisons in the party field (Forest 1): A alone, then with B.
//   3. A is slowed (combat.inflictStatus, the slow of a technique hit): A's own mover and
//      animator, and B's copy of A (the remote follower and marker), must both run at half
//      the leg speed and play the run motion at half the rate.
//   4. A guards: placed 25 units from the nearest enemy facing it (in the hunter's and the
//      other classes' enter range); after a stop B has A's guard flag (6x3E). Then A is placed
//      beyond the leave range and stops again: speed and rate go back to the plain run on both.
// B samples A's marker on every animation frame, and A samples its own drawn pose on the same
// clock. Printed: lag, overshoot, direction flips, zero-move frames, catch-up jumps, speed,
// animation mismatch and frame hitches.
//
// Needs newserv (vendor/newserv) and the bridge (bridge/bridge.mjs) running.
// PW_BASE_URL points at a Vite on its own port. See e2e/README.md.
import { expect, test, type BrowserContext, type CDPSession } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, leaveToLobby, openPartyMenu, peek, reachLobby } from './classic.ts';
import { ensureCharacter, freshUser } from './fresh-field.ts';

const USER_A = process.env.PSO_USER_A ?? freshUser('wmv');
const USER_B = process.env.PSO_USER_B ?? freshUser('wmw');
const passwordOf = (user: string): string => process.env.PSO_MOVE_PASSWORD ?? user;
const LATENCY_MS = Number(process.env.PSO_LATENCY_MS ?? 100);
const JITTER_MS = Number(process.env.PSO_JITTER_MS ?? 40);
const CPU_RATE = Number(process.env.PSO_CPU_RATE ?? 4);
const OBSERVER = process.env.PSO_OBSERVER ?? 'phone';
const FLOOR = Number(process.env.PSO_FLOOR ?? 1); // Forest 1
const STATUS_SLOW = 0x11; // combat/status.ts STATUS.slow

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

// Records one sample per animation frame while on: the marker of `target` (own id when null)
// with its gait and animation step, and the local mover's state. The lobby's view is
// classicLobby.view, the field's gameView.view (a LobbyView either way).
const samplerScript = () => {
  const w = window as any;
  if (w.__mv) return; // installed once per page (the loop runs for the page's life)
  w.__mv = { on: false, rec: [] as any[], target: null as number | null };
  const loop = (now: number) => {
    const s = w.__mv;
    if (s.on) {
      const v = w.gameView?.view ?? w.classicLobby?.view;
      const rec: any = { t: now + performance.timeOrigin };
      if (v) {
        const id = s.target ?? v.lobby?.selfId;
        const m = v.markers?.get(id);
        if (m) {
          const p = m.group.position;
          rec.p = [p.x, p.y, p.z];
          rec.g = m.gait;
          rec.s = m.animator?.step;
        }
        if (v.mover) rec.st = v.mover.state;
      }
      s.rec.push(rec);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

type Rec = { t: number; p?: [number, number, number]; g?: string; st?: string; s?: number };

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

// Units per second of a marker between the first and the last sample in [from, to] (wall ms).
function speedIn(rs: Rec[], from: number, to: number): number {
  const w = rs.filter((r) => r.p && r.t >= from && r.t <= to);
  if (w.length < 2) return 0;
  const a = w[0]!;
  const b = w[w.length - 1]!;
  const dist = Math.hypot(b.p![0] - a.p![0], b.p![2] - a.p![2]);
  return dist / ((b.t - a.t) / 1000 || 1);
}

// The median animation step of the frames in [from, to] where the marker runs (`gait` is the
// marker's gait field on B's side, the mover's state on A's).
function runStep(rs: Rec[], from: number, to: number, side: 'st' | 'g'): number {
  const steps = rs.filter((r) => r.t >= from && r.t <= to && r[side] === 'run' && r.s !== undefined).map((r) => round(r.s!));
  return median(steps);
}

test.describe.configure({ mode: 'serial' });

test('two fresh accounts: hitches alone and with the other player, the slow and the guard on both sides', async ({ browser }) => {
  test.setTimeout(1_800_000);
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
  const cdpA: CDPSession = await ctxA.newCDPSession(pageA);
  const cdpB: CDPSession = await ctxB.newCDPSession(pageB);
  const name = `mv${Date.now() % 100000}`;

  // The CPU throttle of the measured windows: both clients, as the field measurement always had.
  const throttle = async (rate: number) => {
    await cdpA.send('Emulation.setCPUThrottlingRate', { rate });
    await cdpB.send('Emulation.setCPUThrottlingRate', { rate });
  };
  const samplers = async () => {
    await pageA.evaluate(samplerScript);
    await pageB.evaluate(samplerScript);
  };
  // Samples on both clients (A's own marker; B's copy of A) while `run` plays.
  const sampleBoth = async (run: () => Promise<void>): Promise<{ recA: Rec[]; recB: Rec[]; aId: number }> => {
    const aId = await peek(pageA, (w) => w.classicGame?.game?.selfId ?? w.classicLobbyState?.selfId ?? w.gameView?.game?.selfId ?? null);
    await pageA.evaluate(() => Object.assign((window as any).__mv, { on: true, rec: [], target: null }));
    await pageB.evaluate((id) => Object.assign((window as any).__mv, { on: true, rec: [], target: id }), aId);
    await run();
    await pageB.waitForTimeout(300);
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
    return { recA, recB, aId: aId as number };
  };
  const holdKeys = async (keys: string[], ms: number) => {
    for (const k of keys) await pageA.keyboard.down(k);
    await pageA.waitForTimeout(ms);
    for (const k of keys) await pageA.keyboard.up(k);
  };
  // A walk, a run, a stop and a turn: the same script for the lobby and the field.
  const SCRIPT: Array<[string[], number]> = [
    [['w'], 150], // a short tap: walk
    [[], 1200],
    [['w'], 2500], // held: run
    [[], 1200],
    [['a'], 800], // turn in place
    [['w', 'd'], 1500], // run, curving
    [[], 1500],
  ];
  const playScript = async () => {
    for (const [keys, ms] of SCRIPT) await holdKeys(keys, ms);
  };
  // A's frame hitches over the script, A's page throttled (B's too, as in the field measurement).
  const hitchWindow = async (label: string): Promise<void> => {
    await throttle(CPU_RATE);
    await pageA.evaluate(() => Object.assign((window as any).__mv, { on: true, rec: [], target: null }));
    await playScript();
    const recA: Rec[] = await pageA.evaluate(() => {
      const s = (window as any).__mv;
      s.on = false;
      return s.rec;
    });
    await throttle(1);
    console.log(`hitches ${label} (A, CPU x${CPU_RATE}): ${JSON.stringify(hitches(recA))}`);
  };
  const warmUp = async () => {
    await pageA.keyboard.down('w');
    await pageA.waitForTimeout(1500);
    await pageA.keyboard.up('w');
  };

  try {
    await test.step('A and B fresh accounts with a character', async () => {
      await ensureCharacter(pageA, USER_A, passwordOf(USER_A));
      await reachLobby(pageA);
    });
    await samplers();

    await test.step('lobby: A alone', async () => {
      await warmUp();
      await hitchWindow('lobby alone');
    });

    await test.step('lobby: B logs in and stands in the lobby, then A again', async () => {
      await ensureCharacter(pageB, USER_B, passwordOf(USER_B));
      await reachLobby(pageB);
      await pageB.evaluate(samplerScript);
      await pageA.waitForTimeout(1000);
      await hitchWindow('lobby with B');
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
      const entered = await pageA
        .waitForFunction(() => !!((window as any).classicGameLoading || (window as any).classicGame), null, { timeout: 15_000 })
        .then(() => true, () => false);
      if (!entered) {
        const state = await peek(pageA, (w) => ({
          phase: w.classicLobby?.party?.phase,
          row: w.classicLobby?.party?.create?.row,
          counter: w.classicLobby?.counter?.open,
          lobby: w.classicLobby !== undefined,
          message: w.classicLobby?.party?.message,
        }));
        console.log(`party create did not enter: ${JSON.stringify(state)}; A log tail: ${logsA.slice(-12).join(' | ')}`);
      }
      await expectInGame(pageA, logsA, name);
      await pageA.evaluate((f) => (window as any).gameView.warpTo(f), FLOOR);
      await expect.poll(() => peek(pageA, (w) => w.classicGame.view.current?.floor), { timeout: 120_000 }).toBe(FLOOR);
      await pageA.waitForTimeout(1500);
    });

    await test.step('field: A alone in Forest 1', async () => {
      await warmUp();
      await hitchWindow('field alone');
    });

    await test.step('B joins the party and warps to Forest 1', async () => {
      await openPartyMenu(pageB);
      await key(pageB, 'Enter'); // Join a PARTY
      await expect.poll(() => peek(pageB, (w) => w.classicLobby.party?.phase)).toBe('list');
      const names = await peek(pageB, (w) => w.classicLobby.party.list.entries.map((e: { name: string }) => e.name));
      const index = names.indexOf(name);
      expect(index).toBeGreaterThanOrEqual(0);
      await cursorTo(pageB, (w) => w.classicLobby.party.list.cursor, index, 0x40);
      await key(pageB, 'Enter');
      // A is already on Forest 1, so B lands on the party's floor, not Pioneer 2: wait for the game only.
      await expect.poll(() => peek(pageB, (w) => (w.classicGame ? w.classicGame.game.name : '')), { timeout: 90_000 }).toBe(name);
      expect(logsB.filter((l) => l.startsWith('pageerror'))).toEqual([]);
      await expect.poll(() => peek(pageA, (w) => w.classicGame.game.players.size)).toBe(2);
      await expect.poll(() => peek(pageB, (w) => w.classicGame.game.players.size)).toBe(2);
      await pageB.evaluate((f) => (window as any).gameView.warpTo(f), FLOOR);
      await expect.poll(() => peek(pageB, (w) => w.classicGame.view.current?.floor), { timeout: 120_000 }).toBe(FLOOR);
      await pageB.waitForTimeout(1500);
    });

    if (OBSERVER === 'phone') await pageB.setViewportSize({ width: 412, height: 839 });

    await test.step('field: A with B in the party', async () => {
      await warmUp();
      await throttle(CPU_RATE);
      const { recA, recB } = await sampleBoth(() => playScript());
      await throttle(1);
      console.log(`latency ${LATENCY_MS}+-${JITTER_MS} ms one way, B ${OBSERVER} CPU x${CPU_RATE}`);
      console.log(`hitches field with B (A): ${JSON.stringify(hitches(recA))}`);
      console.log(`B remote follower: ${JSON.stringify(analyse(recA, recB))}`);
      console.log(`B frames: ${JSON.stringify(hitches(recB))}`);
    });

    await test.step('slow: A is slowed; A and B walk and run at half the leg speed', async () => {
      await expect.poll(() => peek(pageA, (w) => !!w.classicGame.view.combat)).toBe(true);
      await pageA.waitForTimeout(500);
      const hold = async (label: string) => {
        const t0 = Date.now();
        const { recA, recB, aId } = await sampleBoth(() => holdKeys(['w'], 2500));
        const t1 = Date.now();
        const from = t0 + 700;
        const slowed = await peek(pageA, (w) => w.classicGame.view.view.mover.slowed as boolean);
        const out = {
          localSpeed: round(speedIn(recA, from, t1)),
          remoteSpeed: round(speedIn(recB, from, t1)),
          localStep: runStep(recA, from, t1, 'st'),
          remoteStep: runStep(recB, from, t1, 'g'),
          moverSlowed: slowed,
          aId,
        };
        console.log(`${label}: ${JSON.stringify(out)}`);
        return out;
      };
      const base = await hold('slow: base run');
      expect(base.moverSlowed).toBe(false);
      await pageA.evaluate((t) => (window as any).classicGame.view.combat.inflictStatus(t, 'two-client test'), STATUS_SLOW);
      await expect.poll(() => peek(pageA, (w) => w.classicGame.view.combat.status.has(0x11))).toBe(true);
      const slow = await hold('slow: slowed run');
      expect(slow.moverSlowed).toBe(true);
      // The leg factor 0.5 (legSpeed, playermove.ts): the run's 1.5 becomes 0.75 on both sides.
      expect(slow.localStep).toBeCloseTo(0.75, 2);
      expect(slow.remoteStep).toBeCloseTo(0.75, 2);
      expect(slow.localSpeed / base.localSpeed).toBeGreaterThan(0.35);
      expect(slow.localSpeed / base.localSpeed).toBeLessThan(0.65);
      expect(slow.remoteSpeed / base.remoteSpeed).toBeGreaterThan(0.35);
      expect(slow.remoteSpeed / base.remoteSpeed).toBeLessThan(0.65);
      // The slow lasts SLOW_FRAMES (210 game ticks): wait until it is off.
      await expect.poll(() => peek(pageA, (w) => w.classicGame.view.combat.status.has(0x11)), { timeout: 20_000 }).toBe(false);
      await pageA.waitForTimeout(500);
    });

    await test.step('guard: A guards near an enemy; B sees it at A\'s stop (6x3E) and runs at 0.75', async () => {
      // As lockon.spec.ts: enemies of room 2 are built, A is placed in front of the nearest one.
      await pageA.evaluate(() => (window as any).classicGame.view.constructEnemies(1, 2, 1));
      await expect.poll(() => peek(pageA, (w) => [...w.classicGame.view.combat.enemies.values()].some((e: any) => !e.dead && e.instance?.root?.visible)), { timeout: 60_000 }).toBe(true);
      // The player is placed `distance` units behind the nearest enemy and faces it (GameView.placePlayer).
      const placeFacing = (distance: number) =>
        pageA.evaluate((d) => {
          const g = (window as any).classicGame;
          const combat = g.view.combat;
          const self = g.game.selfId;
          const from = combat.view.playerPositions().get(self);
          let best: any = null;
          let bestD = Infinity;
          for (const e of combat.enemies.values()) {
            if (!e || e.dead || !e.instance?.root?.visible) continue;
            const p = e.instance.root.position;
            const dd = (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
            if (dd < bestD) {
              bestD = dd;
              best = e;
            }
          }
          const p = best.instance.root.position;
          const ang = Math.atan2(p.x - from.x, p.z - from.z);
          const at = { x: p.x - d * Math.sin(ang), y: p.y, z: p.z - d * Math.cos(ang) };
          g.game.self.angle = ang;
          g.view.placePlayer(self, at.x, p.y, at.z, ang);
          g.game.self.angle = ang;
          return true;
        }, distance);
      const guardOf = () => peek(pageA, (w) => w.classicGame.view.view.mover.guard as boolean);
      const hold = async (label: string) => {
        const t0 = Date.now();
        const { recA, recB } = await sampleBoth(() => holdKeys(['a'], 1500));
        const t1 = Date.now();
        const from = t0 + 300;
        const out = {
          localSpeed: round(speedIn(recA, from, t1)),
          remoteSpeed: round(speedIn(recB, from, t1)),
          localStep: runStep(recA, from, t1, 'st'),
          remoteStep: runStep(recB, from, t1, 'g'),
          moverGuard: await guardOf(),
        };
        console.log(`${label}: ${JSON.stringify(out)}`);
        return out;
      };
      // Guard on: 25 units from the target (inside both enter ranges). The sideways hold keeps it
      // on (the leave range is 100 for hunters, 150 for the others); its stop sends 6x3E guard 1.
      await placeFacing(25);
      await pageA.waitForTimeout(1000);
      expect(await guardOf()).toBe(true);
      await holdKeys(['a'], 500);
      await pageB.waitForTimeout(800);
      const on = await hold('guard: on');
      expect(on.moverGuard).toBe(true);
      expect(on.localStep).toBeCloseTo(1.125, 2);
      expect(on.remoteStep).toBeCloseTo(1.125, 2);
      // Guard off: 170 units out, beyond every leave range; the next stop sends guard 0.
      await placeFacing(170);
      await pageA.waitForTimeout(1000);
      expect(await guardOf()).toBe(false);
      await holdKeys(['a'], 500);
      await pageB.waitForTimeout(800);
      const off = await hold('guard: off');
      expect(off.moverGuard).toBe(false);
      expect(off.localStep).toBeCloseTo(1.5, 2);
      expect(off.remoteStep).toBeCloseTo(1.5, 2);
      expect(on.localSpeed / off.localSpeed).toBeGreaterThan(0.6);
      expect(on.localSpeed / off.localSpeed).toBeLessThan(0.9);
      expect(on.remoteSpeed / off.remoteSpeed).toBeGreaterThan(0.6);
      expect(on.remoteSpeed / off.remoteSpeed).toBeLessThan(0.9);
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
