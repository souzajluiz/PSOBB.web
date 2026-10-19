// Vol Opt's fight (client/src/combat/volopt.ts and volopt2.ts): the control's
// timeline, the leader's director, the core behind its wall, the monitors, the
// pillars and their lightning, the rod, phase 2's body (missiles, laser,
// heal, capture, parts, death), the remote paths (6x0A, 6x15, 6x16, 6x18) and
// that no state can hang.
//
// Run: node tests/volopt.test.ts
import {
  FORM2_SPOTS,
  PILLAR_RISE,
  VO_AI,
  VO_ID,
  VO_MONITORS,
  VO_PART_COUNT,
  VO_PILLARS,
  VoloptAi,
  VoloptBolt,
  VoloptPartAi,
  type VoloptEvent,
  type VoloptOptions,
} from '../client/src/combat/volopt.ts';
import { F2, FORM2_BOXES, FORM2_SLOTS, VoloptForm2Ai, VoloptMissile, type Form2Options } from '../client/src/combat/volopt2.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyMovementData } from '../client/src/formats/battleparams.ts';
import { bossPhaseOf } from '../client/src/audio/bossbgm.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);

function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// BattleParamEntry_on.dat, rows 33..42 (Normal).
const mv = (iparam: number[], f: number[] = [0, 0, 0, 0, 0, 0]): EnemyMovementData => ({
  fparam1: f[0],
  fparam2: f[1],
  fparam3: f[2],
  fparam4: f[3],
  fparam5: f[4],
  fparam6: f[5],
  iparam,
});
const ROW_CORE = mv([120, 0, 0, 0, 0, 0]);
const ROW_PILLAR = mv([280, 0, 0, 0, 0, 0]);
const ROW_MONITOR = mv([420, 350, 0, 0, 0, 0]);
const ROW_FORM2 = mv([300, 550, 900, 200, 190, 4], [1.75, 0.15, 25, -35, 0, 0]);
const ROW_PARTS = mv([1500, 3600, 800, 1500, 0, 0]);
const ROW_PRISON = mv([130, 0, 0, 0, 0, 0], [1.24, 0.7, 0, 0, 0, 0]);

const player = (clientId: number, x: number, z: number, dead = false): AiTarget => ({ clientId, x, z, charClass: 0, dead });

interface Fight {
  c: VoloptAi;
  f2: VoloptForm2Ai;
  log: VoloptEvent[];
  shots: unknown[];
  leader: { on: boolean };
  targets: AiTarget[];
  t: number;
  step(n?: number): void;
  until(cond: () => boolean, max: number, label: string): number;
  handle(ev: VoloptEvent): void;
}

function fight(over: { ultimate?: boolean; leader?: boolean; seed?: number; targets?: AiTarget[]; frames?: number } = {}): Fight {
  const leader = { on: over.leader ?? true };
  const rng = seeded(over.seed ?? 7);
  const frames = over.frames ?? 40;
  const copts: VoloptOptions = {
    x: 0,
    z: 0,
    angle: 0,
    ultimate: over.ultimate ?? false,
    movement: { core: ROW_CORE, pillar: ROW_PILLAR, monitor: ROW_MONITOR },
    hp: { core: 3000, pillar: 500, rod: 450 },
    leader: () => leader.on,
    frames: () => frames,
    playerHp: (id) => 100 - id,
    rng,
  };
  const c = new VoloptAi(copts);
  const fopts: Form2Options = {
    x: 0,
    z: -5000,
    angle: 0,
    ultimate: over.ultimate ?? false,
    hp: 9500,
    movement: ROW_FORM2,
    parts: ROW_PARTS,
    prison: ROW_PRISON,
    prisonHp: 260,
    leader: () => leader.on,
    selfId: () => 0,
    frames: () => frames,
    rng,
  };
  const f2 = new VoloptForm2Ai(fopts);
  c.form2 = f2;
  const targets = over.targets ?? [player(0, 0, 40)];
  const fi: Fight = {
    c,
    f2,
    log: [],
    shots: [],
    leader,
    targets,
    t: 0,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        fi.t++;
        // The players stand in phase 2's arena once it starts.
        const r = c.tick(fi.targets);
        if (r.shots) for (const s of r.shots) fi.shots.push(s);
        // What render/combat.ts does with the control's events.
        for (let k = 0; k < c.events.length; k++) fi.handle(c.events[k]);
        c.events.length = 0;
        const r2 = f2.tick(fi.targets);
        if (r2.shots) for (const s of r2.shots) fi.shots.push(s);
        for (let k = 0; k < f2.events.length; k++) fi.log.push(f2.events[k]);
        f2.events.length = 0;
      }
    },
    until(cond, max, label) {
      for (let i = 0; i < max; i++) {
        if (cond()) return i;
        fi.step();
      }
      check(false, `${label}: not within ${max} ticks (t=${fi.t}, ai ${c.ai}, core ${c.core.st}, f2 ${f2.st}/${f2.state})`);
      return max;
    },
    handle(ev: VoloptEvent) {
      if (ev.kind === 'se') return;
      fi.log.push(ev);
      if (ev.kind === 'action') {
        if (ev.action <= 2) c.applyAction(ev.action, ev.param, ev.count);
        else f2.applyAction(ev.action, ev.target, ev.param);
      } else if (ev.kind === 'pillars') c.applyPillars(ev.table, ev.count);
    },
  };
  return fi;
}

const act = (log: VoloptEvent[], action: number) => log.filter((e) => e.kind === 'action' && e.action === action).length;

// --- tables ---------------------------------------------------------------------

{
  eq(VO_ID.pillar, 1, 'pillars start at base + 1');
  eq(VO_ID.monitor, 7, 'monitors start at base + 7');
  eq(VO_ID.prison, 0x20, 'the prison is base + 0x20');
  eq(VO_ID.rod, 0x21, 'the rod is base + 0x21');
  eq(VO_ID.core, 0x22, 'the core is base + 0x22');
  const f = fight();
  eq(f.c.parts.length, VO_PART_COUNT, 'parts: 6 + 24 + prison + rod + core');
  eq(f.c.pillars.length, VO_PILLARS, 'six pillars');
  eq(f.c.monitors.length, VO_MONITORS, 'twenty-four monitors');
  const entities = f.c.parts.map((p) => p.entity);
  eq(new Set(entities).size, entities.length, 'every part has its own entity offset');
  eq(f.c.partOf(VO_ID.core)?.kind, 'core', 'partOf finds the core');
  // Monitor HP: the big one iparam1, the small ones iparam2 (0x0044... stats).
  eq(f.c.monitors[0].maxHp, 420, 'the big monitor has MovementData iparam1');
  eq(f.c.monitors[1].maxHp, 350, 'a small monitor has iparam2');
  eq(f.c.pillars[0].maxHp, 500, 'pillar HP is its stats row');
  // Pillar ring: radius 76, 60 degrees apart.
  eq(Math.round(Math.hypot(f.c.pillars[0].baseX, f.c.pillars[0].baseZ)), 76, 'pillars sit on the 76 ring');
  eq(Math.round(f.c.pillars[3].baseX), -76, 'pillar 3 is opposite pillar 0');
  // The rise takes 15 ticks up (2.9333 a tick to 4.0) and 6 down.
  eq(Math.ceil((4 - PILLAR_RISE.hidden) / PILLAR_RISE.step), 15, 'the pillar rise takes 15 ticks to the top');
  eq(FORM2_SPOTS.length, 4, 'four player slots in the second arena');
  eq(FORM2_BOXES.length, 5, 'form 2 has four part boxes and the body');
  eq(FORM2_SLOTS[4].mode, 3, 'the death slot holds its last frame');
}

// --- the control's timeline ---------------------------------------------------------------

{
  const f = fight();
  const seen: number[] = [];
  let last = -1;
  for (let i = 0; i < 400; i++) {
    f.step();
    if (f.c.ai !== last) {
      last = f.c.ai;
      seen.push(i);
    }
  }
  eq(f.c.ai, VO_AI.fight, 'the intro ends in phase 1');
  // 0xd2 + 0x3c + 0x5a frames after the build tick.
  const introEnd = seen[seen.length - 1];
  check(introEnd >= 0xd2 + 0x3c + 0x5a && introEnd <= 0xd2 + 0x3c + 0x5a + 4, `the intro lasts 0xd2 + 0x3c + 0x5a frames (ended at ${introEnd})`);
  check(f.c.core.st !== 5 && !f.c.core.dead, 'the core appeared and is alive');
  eq(f.c.invulnerable, true, 'the control cannot be hurt');
  eq(f.c.untargetable, true, 'the control is not a target');
}

// --- the director -----------------------------------------------------------------------------

{
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.until(() => act(f.log, 0) > 0, 100, 'first traverse order');
  const first = f.log.find((e) => e.kind === 'action' && e.action === 0) as Extract<VoloptEvent, { kind: 'action' }>;
  check(first.count >= 2 && first.count <= 4, `the traverse is 2..4 walls (${first.count})`);
  eq(first.param, 0, 'the first traverse starts at wall 0');
  eq(f.c.core.st, 1, 'the core is traversing after its order');
  // Cooldown 30: nothing else is ordered for 30 ticks.
  const n0 = f.log.length;
  f.step(20);
  eq(f.log.length, n0, 'the director pauses 30 frames after an order');
  // It waits for the core, then raises the pillars (6x16 with the first two).
  f.until(() => f.log.some((e) => e.kind === 'pillars'), 600, 'pillars after the traverse');
  const p = f.log.find((e) => e.kind === 'pillars') as Extract<VoloptEvent, { kind: 'pillars' }>;
  eq(p.count, 2, 'two pillars rise the first time');
  eq([...p.table].sort().join(','), '0,1,2,3,4,5', 'the table holds every live pillar once');
  eq(p.technique, null, 'no technique in Normal');
  const red = f.c.pillars[p.table[0]];
  check(red.active, 'the first entry is the red pillar');
  check(!f.c.pillars[p.table[1]].active, 'the second is a decoy');
  // The next traverse starts count walls back.
  const idx = f.log.indexOf(first);
  check(idx >= 0, 'the order is logged');
}

{
  // A follower runs the same states from the leader's orders but sends none.
  const f = fight({ leader: false });
  f.step(700);
  eq(act(f.log, 0) + act(f.log, 1), 0, 'a follower sends no order');
  eq(f.log.filter((e) => e.kind === 'pillars').length, 0, 'a follower sends no pillar table');
  eq(f.c.core.st, 0, 'a follower\'s core waits for the leader');
  // The leader's order moves it.
  f.c.applyAction(0, 2, 3);
  eq(f.c.core.st, 1, 'a 6x15 action 0 sends the core on its traverse');
  eq(f.c.traverseDone, false, 'the core clears the director\'s flag');
}

// --- the core behind its wall ------------------------------------------------------------------------

{
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  // Take over the director and send the core by hand.
  f.leader.on = false;
  f.c.applyAction(0, 2, 2);
  eq(f.c.core.wall, 2, 'the traverse starts at the given wall');
  let exposedTicks = 0;
  const walls = new Set<number>();
  let stand = false;
  for (let i = 0; i < 400 && f.c.core.st !== 0; i++) {
    f.step();
    if (f.c.exposed >= 0) {
      exposedTicks++;
      walls.add(f.c.exposed >> 2);
      eq(f.c.exposed & 3, 0, 'raised, the core is behind the big monitor');
    }
    if (f.c.core.st === 9) stand = true;
  }
  check(stand, 'the last wall ends in the stand');
  eq(f.c.core.st, 0, 'the core goes idle afterwards');
  eq(f.c.traverseDone, true, 'and reports it');
  check(walls.has(2) && walls.has(1), `it passed walls 2 and 1 (${[...walls].join(',')})`);
  check(exposedTicks > 40, `it was exposed for a while (${exposedTicks})`);
  eq(f.c.exposed, -1, 'idle, it is behind nothing');
}

{
  // Monitors can be shot only on the core's wall; a hit reaches the core.
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  f.c.applyAction(0, 3, 4);
  f.until(() => f.c.exposed >= 0, 200, 'core exposed');
  const wall = f.c.exposed >> 2;
  f.step();
  const up = f.c.monitors.filter((m) => m.targetable);
  check(up.length === 4 && up.every((m) => m.wall === wall), `the four monitors of wall ${wall} are targetable (${up.length})`);
  check(f.c.monitors.filter((m) => m.wall !== wall).every((m) => !m.targetable), 'no other wall can be shot');
  f.log.length = 0;
  f.c.damagePart(f.c.monitors[wall * 4 + 1].entity, 50, true);
  f.step(2);
  const hit = f.log.filter((e) => e.kind === 'coreHit');
  eq(hit.length, 1, 'a hit on a monitor of the core\'s wall reaches the core once');
  eq((hit[0] as { local: boolean }).local, true, 'and says we dealt it');
  // A hit that arrives as a 6x0A does not strike the core from here.
  f.log.length = 0;
  f.step(10);
  f.c.damageTaken(f.c.monitors[wall * 4 + 2].entity, 60);
  f.step(2);
  eq((f.log.find((e) => e.kind === 'coreHit') as { local: boolean } | undefined)?.local, false, 'a remote hit reports it was not ours');
  // Core damage is a part hit: the core pool drops.
  const core = f.c.core;
  const hp0 = core.hp;
  f.c.damagePart(VO_ID.core, 100, true);
  eq(core.hp, hp0 - 100, 'the core takes a strike');
  // A small monitor falling: it is checked, three of them take the big one.
  const w = wall;
  for (let k = 1; k < 4; k++) {
    const m = f.c.monitors[w * 4 + k];
    f.c.damagePart(m.entity, 9999, true);
    f.step(6);
  }
  check(f.c.wallChecked(w), 'when the three small ones are down the wall is checked');
  check(f.c.monitors[w * 4].broken, 'and the big monitor falls with them');
}

{
  // A big monitor taking the small ones with it.
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  f.c.applyAction(0, 0, 4);
  f.until(() => f.c.exposed >= 0, 200, 'exposed');
  const w = f.c.exposed >> 2;
  f.c.damagePart(f.c.monitors[w * 4].entity, 99999, true);
  f.step(4);
  check(f.c.monitors[w * 4 + 1].broken && f.c.monitors[w * 4 + 2].broken && f.c.monitors[w * 4 + 3].broken, 'the big monitor takes its wall down');
  check(f.c.wallChecked(w), 'and the wall is checked');
  // The core skips a checked wall.
  f.until(() => f.c.core.st === 0, 600, 'core idle');
  f.c.applyAction(0, w, 3);
  check(f.c.core.wall !== w, 'a checked wall is not visited again');
}

// --- pillars ---------------------------------------------------------------------------------------------

{
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  f.c.applyPillars([2, 4, 0, 1, 3, 5], 2);
  const red = f.c.pillars[2];
  const decoy = f.c.pillars[4];
  check(red.active && !decoy.active, 'the table\'s first pillar is the red one');
  eq(red.st, 2, 'a listed pillar enters state 2');
  eq(f.c.pillars[0].st, 0, 'the others stay down');
  check(red.busy && decoy.busy, 'both are busy for the director');
  // Rise: hidden for the first 20 + 21 ticks, targetable after the extension anim.
  f.step(30);
  check(!red.targetable, 'it is hidden while it rises');
  const bolts: unknown[] = [];
  let up = -1;
  let fires = 0;
  for (let i = 0; i < 700; i++) {
    f.step();
    if (up < 0 && red.targetable) up = i;
    while (f.shots.length) {
      const s = f.shots.shift();
      if (s instanceof VoloptBolt) {
        bolts.push(s);
        fires++;
      }
    }
    if (red.st === 0) break;
  }
  check(up > 0, 'the red pillar becomes a target once it is up');
  eq(fires, 2, 'the red pillar fires twice');
  eq(red.st, 0, 'and goes back down');
  eq(decoy.st, 0, 'the decoy goes down by itself');
  eq(red.yOff, PILLAR_RISE.hidden, 'underground again');
  const b = bolts[0] as VoloptBolt;
  const all = [player(0, 0, 0), player(1, 50, 50), player(2, 9, 9, true)];
  const hit = b.tick(all);
  eq(hit.length, 2, 'the bolt hits every live player');
  eq((b.effect as { power: number }).power, 280, 'with the pillar row\'s iparam1');
  eq(b.tick(all).length, 0, 'once');
}

{
  // The rod on the floor ends the round after the first bolt.
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  f.step(120);
  eq(f.c.rod.st, 1, 'the rod hangs at y 50 after the intro');
  f.c.damagePart(VO_ID.rod, 99999, true);
  f.step(40);
  check(f.c.rod.down, 'a shot-down rod lies on the floor');
  eq(f.c.rodDown(), true, 'the pillars see it');
  f.c.applyPillars([1, 0, 2, 3, 4, 5], 2);
  f.log.length = 0;
  f.until(() => f.log.some((e) => e.kind === 'action' && e.action === 2), 400, 'action 2 after the first bolt');
  // Every client applies it (the sender's own packet comes back as a 6x15).
  f.c.applyAction(2, 0, 0);
  check(!f.c.rod.down, 'the order stands the rod up');
  check(f.c.rod.hp === f.c.rod.maxHp, 'with its HP back');
  f.step(5);
  check(f.c.pillars[1].st === 9 || f.c.pillars[1].st === 0, 'and retracts the pillars');
}

{
  // Hitting the red pillar strikes the core and sends it away; a decoy retracts.
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  f.c.applyAction(0, 1, 3);
  f.c.applyPillars([3, 1, 0, 2, 4, 5], 2);
  f.until(() => f.c.pillars[3].targetable, 400, 'red pillar up');
  f.log.length = 0;
  f.c.damagePart(f.c.pillars[3].entity, 30, true);
  f.step(3);
  eq(f.log.filter((e) => e.kind === 'coreHit').length, 1, 'a hit on the red pillar strikes the core');
  eq(f.c.spawned, true, 'and the director learns a pillar was hit');
  check(f.c.core.st === 10 || f.c.core.st === 0 || f.c.core.st === 4, 'the core is sent away');
  // The decoy: a hit makes it lower (it is not attacking).
  f.until(() => f.c.pillars[1].st === 2 && f.c.pillars[1].sub === 12, 600, 'decoy waiting');
  f.step(5);
  f.c.damagePart(f.c.pillars[1].entity, 30, true);
  f.until(() => f.c.pillars[1].st === 0, 200, 'decoy lowers after a hit');
}

{
  // A pillar's death is permanent; six wrecks end the phase.
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  for (let i = 0; i < 6; i++) {
    f.c.damagePart(f.c.pillars[i].entity, 99999, true);
    f.step(3);
    check(f.c.pillars[i].wreck, `pillar ${i} is a wreck`);
    eq(f.c.pillarsLeft, 5 - i, `${5 - i} pillars left`);
  }
  f.step(2);
  check(f.c.ai === VO_AI.change || f.c.state === 'phase 1', 'six wrecks end phase 1');
  f.c.applyPillars([0, 1, 2, 3, 4, 5], 6);
  check(f.c.pillars.every((p) => p.st !== 2), 'a wreck does not rise again');
  f.until(() => f.c.ai === VO_AI.change, 400, 'the change to form 2');
}

// --- phase 1 ends, form 2 --------------------------------------------------------------------------------------

function toPhase2(over: Parameters<typeof fight>[0] = {}): Fight {
  const f = fight(over);
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  f.c.damagePart(VO_ID.core, 99999, true);
  f.step(2);
  f.until(() => f.c.ai === VO_AI.change, 400, 'the change');
  f.until(() => f.c.ai === VO_AI.fight2, 600, 'phase 2');
  f.leader.on = over.leader ?? true;
  return f;
}

{
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  eq(f.c.core.dead, false, 'the core lives');
  f.c.damagePart(VO_ID.core, 99999, true);
  f.step(2);
  check(f.c.core.dead, 'a core without HP is dead');
  const t0 = f.t;
  f.leader.on = true;
  f.until(() => f.c.ai === VO_AI.change, 400, 'change');
  const dt = f.t - t0;
  check(dt >= 0x96 + 60 - 2 && dt <= 0x96 + 60 + 6, `0x96 frames of rumble and the fade (${dt})`);
  f.step(2);
  const moves = f.log.filter((e) => e.kind === 'move') as Extract<VoloptEvent, { kind: 'move' }>[];
  eq(moves.length, 1, 'the leader carries each player over with a 6x17');
  eq(moves[0].z, -5090, 'the first player goes to the first slot');
  eq(f.f2.st, 7, 'form 2 is standing up');
  eq(f.f2.ready, false, 'and not a target yet');
  f.until(() => f.c.ai === VO_AI.fight2, 600, 'phase 2');
  eq(f.f2.ready, true, 'it is ready when phase 2 starts');
  eq(f.f2.st, 0, 'idle');
}

{
  // A follower does not move the players.
  const f = fight({ leader: false });
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.c.damagePart(VO_ID.core, 99999, true);
  f.until(() => f.c.ai === VO_AI.fight2, 900, 'phase 2');
  eq(f.log.filter((e) => e.kind === 'move').length, 0, 'a follower sends no 6x17');
  eq(f.log.filter((e) => e.kind === 'action').length, 0, 'and no order');
}

{
  // The director cycles missiles, laser, heal, capture; broken parts are skipped.
  const f = toPhase2({ targets: [player(0, 0, -4900)] });
  f.log.length = 0;
  f.f2.heading = 0; // faces +z
  f.step(1);
  f.until(() => f.log.filter((e) => e.kind === 'action').length >= 4, 4000, 'four orders');
  const orders = (f.log.filter((e) => e.kind === 'action') as Extract<VoloptEvent, { kind: 'action' }>[]).map((e) => e.action);
  eq(orders.slice(0, 4).join(','), '3,4,5,6', 'missiles, laser, heal, capture in turn');
}

{
  const f = toPhase2({ targets: [player(0, 0, -4900)] });
  // The missile part at 0 HP: no missiles; the pause grows by 30 per broken part.
  f.f2.partHp[3] = 0;
  eq(f.f2.canAct(3), false, 'a part at 0 HP turns its action off');
  eq(f.f2.busyParts, 1, 'CountUnreadyStates counts it');
  f.log.length = 0;
  f.f2.applyAction(3, 0, 0);
  eq(f.f2.st, 0, 'a broken missile part ignores the order');
  f.f2.partHp[3] = 100;
  f.f2.applyAction(3, 0, 0);
  eq(f.f2.st, 10, 'with a part it starts the missiles');
  eq(f.f2.canAct(5), true, 'the heal part is whole');
  f.f2.applyAction(5, 0, 0);
  eq(f.f2.st, 0xb, 'the exe\'s guards refuse only the state it is already in');
  f.f2.applyAction(5, 0, 0);
  eq(f.f2.st, 0xb, 'so the same action again changes nothing');
}

{
  // Missiles: aim 60 frames, motion to frame 22, 2 waves of up to 4 homing missiles.
  const targets = [player(0, 0, -4900), player(1, 20, -4900), player(2, 0, -5100)];
  const f = toPhase2({ targets });
  f.leader.on = false; // drive the body by hand
  f.f2.heading = 0; // the body faces heading + 0x8000 = -z? facing() is atan2(dx, dz) in BAMS
  f.f2.applyAction(3, 0, 0);
  const missiles: VoloptMissile[] = [];
  let waves = 0;
  let last = 0;
  f.shots.length = 0;
  for (let i = 0; i < 600 && f.f2.st === 10; i++) {
    f.step();
    for (const s of f.shots.splice(0)) if (s instanceof VoloptMissile) missiles.push(s);
    if (missiles.length > last) {
      waves++;
      last = missiles.length;
    }
  }
  eq(f.f2.st, 0, 'the missile attack ends');
  check(waves <= 2 && waves >= 0, `at most two waves (${waves})`);
  check(missiles.length <= 8, `at most four missiles a wave (${missiles.length})`);
  if (missiles.length) {
    const m = missiles[0];
    eq((m.effect as { power: number }).power, 300, 'a missile hits with row 37 iparam1');
    // It flies toward its target and hits within 10.
    const t = targets[0];
    m.x = t.x + 3;
    m.z = t.z + 3;
    m.y = 10;
    const hit = m.tick(targets);
    check(hit.length >= 1 || m.done, 'a missile on its target explodes');
  }
}

{
  // The heal: body +iparam4 / 5 and 10, parts +40 up to their maximum.
  const f = toPhase2({ targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  f.f2.hp = 5000;
  f.f2.partHp[0] = 1000;
  f.f2.applyAction(5, 0, 0);
  eq(f.f2.st, 0xb, 'the heal state');
  f.until(() => f.f2.st === 0, 600, 'heal done');
  eq(f.f2.hp, 5050, 'HP +200 / 5 + 10');
  eq(f.f2.partHp[0], 1040, 'a part +40');
  eq(f.f2.partHp[1], 3600, 'a whole part stays at its maximum');
}

{
  // The laser: three rounds; the bars drop when a player stands at a point.
  const f = toPhase2({ targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  f.f2.applyAction(4, 0, 0);
  eq(f.f2.st, 2, 'the laser state');
  let pointsSeen = false;
  f.until(() => {
    if (f.f2.pointCount === 4) pointsSeen = true;
    return f.f2.st === 0;
  }, 2000, 'laser done');
  check(pointsSeen, 'four points turned round the body');
  // The first round waits up to 300 frames for a player at a point.
}

{
  // The capture: a cage flies out, takes the first player it touches and the
  // prison holds her until the timer or its HP ends it.
  const f = toPhase2({ targets: [player(0, 0, -4960)] });
  f.leader.on = false;
  f.f2.heading = 0x8000; // faces -z? The cage flies along facing()
  // Put the player in front of the body.
  const face = f.f2.facing();
  const fx = Math.sin(face * (Math.PI * 2 / 0x10000));
  const fz = Math.cos(face * (Math.PI * 2 / 0x10000));
  f.targets[0].x = f.f2.x + fx * 40;
  f.targets[0].z = f.f2.z + fz * 40;
  f.f2.applyAction(6, 0, 0);
  eq(f.f2.st, 9, 'the capture state');
  f.until(() => f.f2.captured === 0 || f.f2.st === 0, 600, 'captured or missed');
  eq(f.f2.captured, 0, 'the player in front is captured');
  const prison = f.c.prison;
  check(!prison.dead && prison.hp === 260, `the prison has the row's HP (${prison.hp})`);
  check(prison.targetable, 'and can be shot');
  eq(f.f2.prisonFrames > 400, true, 'it holds for iparam5 + 450 frames');
  // Teammates break it.
  f.c.damagePart(VO_ID.prison, 300, false);
  f.step(2);
  eq(f.f2.captured, 0xffff, 'a broken prison lets go');
  check(prison.dead, 'and is gone');
  f.until(() => f.f2.st === 0, 1500, 'capture state ends');
}

{
  // The hit reaction: marks a part, splits the damage, sends 6x18, shakes 6 frames.
  const f = toPhase2({ targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  f.log.length = 0;
  // Strike from in front of the capture part's box (local 0, 23, 29).
  const hp0 = f.f2.hp;
  const part = f.f2.hit(100, f.f2.x, f.f2.z + 60, true);
  check(part >= 0, `a strike marks a box (${part})`);
  f.step(1);
  eq(f.f2.hp, hp0 - 100, 'the body pool took it');
  const sync = f.log.find((e) => e.kind === 'partsHp') as Extract<VoloptEvent, { kind: 'partsHp' }> | undefined;
  if (part < 4) {
    check(!!sync, 'the reaction sends 6x18');
    eq(sync?.hp[part], f.f2.partMax[part] - 100, 'the marked part took the damage');
  }
  // Remote: a 6x0A feeds the same pool; 6x18 sets the parts.
  f.f2.setDamageTaken(500);
  eq(f.f2.hp, f.f2.maxHp - 500, 'a 6x0A total sets the HP');
  f.f2.applyPartsHp([10, 20, 30, 40]);
  eq(f.f2.partHp.join(','), '10,20,30,40', 'a 6x18 sets the part HPs');
  eq(f.f2.canAct(3), true, 'parts at 40 can act');
  f.f2.applyPartsHp([0, 0, 0, 0]);
  eq(f.f2.busyParts, 4, 'all four parts broken');
}

{
  // Ultimate: no flinch.
  const f = toPhase2({ ultimate: true, targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  f.f2.hit(50, f.f2.x, f.f2.z + 60, true);
  f.step(1);
  eq(f.f2.st, 0, 'no reaction state in Ultimate');
}

{
  // The death: 60 frames, the death motion held, the kill at frame 47, 16 more.
  const f = toPhase2({ targets: [player(0, 0, -4900)], frames: 80 });
  f.leader.on = false;
  f.f2.hit(99999, f.f2.x, f.f2.z + 60, true);
  f.step(1);
  eq(f.f2.st, 5, 'zero HP is the death state');
  f.log.length = 0;
  const t0 = f.t;
  f.until(() => f.log.some((e) => e.kind === 'killed'), 600, 'the kill');
  const dt = f.t - t0;
  check(dt > 60 + 80 && dt < 60 + 200, `the kill comes after the shaking and the motion (${dt})`);
  eq(f.log.filter((e) => e.kind === 'killed').length, 1, 'it is reported once');
  eq(f.f2.dead, true, 'dead');
  f.until(() => f.f2.removed, 100, 'removed');
  f.step(2);
  eq(f.c.ai, VO_AI.over, 'the control is over when the body is dead');
  eq(f.f2.hit(100, 0, 0, true), -1, 'a dead body takes no more hits');
  eq(f.f2.untargetable, true, 'and is not a target');
}

// --- remote paths and music ---------------------------------------------------------------------------------------------

{
  // A 6x0A feeds the part pools of a client that did not deal the damage and
  // the brain reacts (a pillar goes down, a monitor falls); the dead flag of
  // the packet is not what kills it.
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  const p = f.c.pillars[0];
  f.c.damageTaken(p.entity, 200);
  eq(p.hp, 300, 'max - damage_taken');
  f.c.damageTaken(p.entity, 150);
  eq(p.hp, 300, 'a smaller total does not heal');
  f.c.damageTaken(p.entity, 500);
  f.step(2);
  check(p.wreck, 'a total of the whole HP wrecks it');
  const m = f.c.monitors[5];
  f.c.damageTaken(m.entity, 999);
  f.step(2);
  check(m.dead, 'a remote kill takes the monitor');
}

{
  // The 6x15 actions 0..2 and 3..7 map to the music phases of the field.
  const body = (action: number) => {
    const b = new Uint8Array(0x0c);
    new DataView(b.buffer).setUint16(4, action, true);
    return b;
  };
  eq(bossPhaseOf(0x0d, 0x15, body(0)), 1, 'action 0 is phase 1');
  eq(bossPhaseOf(0x0d, 0x15, body(2)), 1, 'action 2 is phase 1');
  eq(bossPhaseOf(0x0d, 0x15, body(3)), 2, 'action 3 is phase 2');
  eq(bossPhaseOf(0x0d, 0x15, body(7)), 2, 'action 7 is phase 2');
}

{
  // A follower fed the leader's orders ends in the same state as the leader.
  const lead = fight({ seed: 3 });
  const follow = fight({ leader: false, seed: 9 });
  const seen: VoloptEvent[] = [];
  for (let i = 0; i < 1500; i++) {
    lead.step();
    for (const e of lead.log) {
      if (seen.includes(e)) continue;
      seen.push(e);
      if (e.kind === 'action' && e.action <= 2) follow.c.applyAction(e.action, e.param, e.count);
      else if (e.kind === 'pillars') follow.c.applyPillars(e.table, e.count);
    }
    follow.step();
  }
  const sig = (c: VoloptAi) => `${c.core.st}/${c.pillars.map((p) => p.st).join('')}/${c.ai}`;
  eq(sig(follow.c), sig(lead.c), 'the follower is in the leader\'s state');
}

// --- ultimate -----------------------------------------------------------------------------------------------------------------

{
  const f = fight({ ultimate: true });
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.until(() => f.log.some((e) => e.kind === 'pillars'), 800, 'ultimate pillars');
  const p = f.log.find((e) => e.kind === 'pillars') as Extract<VoloptEvent, { kind: 'pillars' }>;
  check(p.technique !== null && p.technique >= 0 && p.technique <= 3, `Ultimate sends 6x84 with a technique (${p.technique})`);
  eq(f.c.rodDown(), false, 'there is no rod in Ultimate');
}

{
  // Phase 2's Ultimate director picks by weight; every order is one of 3..7.
  const f = toPhase2({ ultimate: true, targets: [player(0, 0, -4900), player(1, 10, -4900)] });
  f.log.length = 0;
  f.step(1);
  f.until(() => f.log.filter((e) => e.kind === 'action').length >= 6, 8000, 'six Ultimate orders');
  const orders = (f.log.filter((e) => e.kind === 'action') as Extract<VoloptEvent, { kind: 'action' }>[]).map((e) => e.action);
  check(orders.every((a) => a >= 3 && a <= 7), `orders are 3..7 (${orders.join(',')})`);
}

// --- nothing hangs; nothing allocates in a quiet frame ---------------------------------------------------------------------------

{
  for (const seed of [1, 2, 3, 4, 5]) {
    const f = fight({ seed, targets: [player(0, 0, 40), player(1, 30, -30)] });
    const rng = seeded(seed * 31);
    let over = false;
    for (let i = 0; i < 90000 && !over; i++) {
      f.step();
      // A player who hits whatever can be hit, and sometimes a 6x0A.
      if (i % 5 === 0) {
        const targetable = f.c.parts.filter((p) => p.targetable && !p.dead);
        if (targetable.length) {
          const p = targetable[Math.floor(rng() * targetable.length)];
          f.c.damagePart(p.entity, 40 + Math.floor(rng() * 60), rng() < 0.5);
          if (p.kind === 'prison') continue;
        }
      }
      if (f.f2.ready && i % 4 === 0) f.f2.hit(30 + Math.floor(rng() * 50), f.f2.x + (rng() - 0.5) * 80, f.f2.z + (rng() - 0.5) * 80, rng() < 0.5);
      if (i % 300 === 0) f.c.damageTaken(VO_ID.core, Math.floor(rng() * 4000));
      over = f.c.ai === VO_AI.over;
      // The body's pause is never a hang: when it has nothing to do the
      // director gives it an order within a few hundred ticks.
    }
    check(over, `seed ${seed}: the fight reaches its end (ai ${f.c.ai}, form 2 ${f.f2.state}, hp ${f.f2.hp})`);
    // The capture's hold is released by then.
    eq(f.f2.captured, 0xffff, `seed ${seed}: nobody is left in the prison`);
  }
}

{
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.leader.on = false;
  const a = f.c.tick(f.targets);
  const b = f.c.tick(f.targets);
  check(a === b, 'the frame object is reused');
  f.step(50);
  eq(f.c.events.length, 0, 'a quiet tick leaves no events behind');
  const bolt = new VoloptPartAi(f.c.core, f.c);
  eq(bolt.untargetable, true, 'a part\'s enemy follows the part\'s targetable flag');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('volopt tests passed');
