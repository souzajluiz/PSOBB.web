// Vol Opt's fight (client/src/combat/volopt.ts and volopt2.ts): the control's
// timeline, the leader's director, the core behind its wall, the monitors, the
// pillars and their lightning, the rod, phase 2's body (missiles, laser,
// heal, capture, parts, death), the remote paths (6x0A, 6x15, 6x16, 6x18) and
// that no state can hang.
//
// Run: node tests/volopt.test.ts
// Env: PSOBB_DATA (client data/ folder; the real-model check is skipped without it)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { enemyModelFor, VOLOPT_LID_MODEL, VOLOPT_MONITOR_BROKEN, type EnemyModelContext } from '../client/src/formats/enemymodels.ts';
import { EnemyArchive } from '../client/src/render/enemymodel.ts';
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
  VoloptCore,
  VoloptLid,
  VoloptMonitor,
  VoloptPartAi,
  VoloptPillar,
  type VoloptEvent,
  type VoloptOptions,
} from '../client/src/combat/volopt.ts';
import {
  BAR,
  CAGE,
  F2,
  FORM2_BOXES,
  FORM2_SLOTS,
  VoloptBar,
  VoloptCage,
  VoloptForm2Ai,
  VoloptMissile,
  barStartHeight,
  type Form2Options,
} from '../client/src/combat/volopt2.ts';
import { VoloptPart, VoloptRod } from '../client/src/combat/volopt.ts';
import { radarConcealed, splitLockOk, splitStruckOk, voloptLockOk, voloptRadar } from '../client/src/render/combat.ts';
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
  // A follower's copy of the pillar does not send the order; the leader's does.
  f.step(600);
  eq(act(f.log, 2), 0, 'a follower sends no action 2');
  f.leader.on = true;
  f.c.applyPillars([1, 0, 2, 3, 4, 5], 2);
  f.until(() => f.log.some((e) => e.kind === 'action' && e.action === 2), 700, 'action 2 after the first bolt');
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
  // Ctor 0x00449CB4 / state 7: 25 below the floor, 6 ticks (one for the sound,
  // five of +5.0) before it is a target and the hold timer runs.
  check(!prison.targetable, 'it cannot be shot while it rises');
  eq(prison.y, -25 + 18, 'it starts 25 below the floor (hit sphere 18 up)');
  eq(f.f2.prisonFrames, F2.prisonRise + F2.prisonLife + ROW_FORM2.iparam[4], 'the hold is the rise plus iparam5 + 450');
  f.step(F2.prisonRise);
  check(prison.targetable, 'and can be shot once it is up');
  eq(prison.y, 18, 'with its hit sphere 18 above the floor');
  eq(f.f2.prisonFrames, F2.prisonLife + ROW_FORM2.iparam[4], 'the timer has not run yet');
  eq(f.f2.prisonFrames > 400, true, 'it holds for iparam5 + 450 frames');
  check(
    f.shots.some((s) => s instanceof Object && (s as { effect?: { kind: string; power: number } }).effect?.power === 0),
    'the cage hit the player with a power 0 technique hit',
  );
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

// --- review fixes -------------------------------------------------------------------------------

{
  // Ultimate has no rod: not targetable, no proxy-worthy state, never "down".
  const f = fight({ ultimate: true });
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  f.step(200);
  eq(f.c.rod.targetable, false, 'no rod to shoot in Ultimate');
  eq(f.c.rodDown(), false, 'and none on the floor');
}

{
  // A motion shorter than the frame an exit waits for does not stall the state.
  const f = toPhase2({ frames: 5, targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  for (const [action, st] of [[3, 10], [5, 0xb], [4, 2]] as const) {
    f.f2.applyAction(action, 0, 0);
    eq(f.f2.st, st, `action ${action} starts`);
    const n = f.until(() => f.f2.st === 0, 900, `action ${action} ends with 5-frame motions`);
    check(n < 700, `action ${action} ended on its own, not by the watchdog (${n})`);
  }
  f.targets[0].x = f.f2.x + Math.sin(f.f2.facing() * Math.PI * 2 / 0x10000) * 40;
  f.targets[0].z = f.f2.z + Math.cos(f.f2.facing() * Math.PI * 2 / 0x10000) * 40;
  f.f2.applyAction(6, 0, 0);
  f.until(() => f.f2.st === 0, 1500, 'capture ends with short motions');
}

{
  // A strike during the 6-frame shake still splits its damage afterwards.
  const f = toPhase2({ targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  f.f2.hit(100, f.f2.x, f.f2.z + 60, true);
  f.step(1);
  f.log.length = 0;
  const p = f.f2.hit(100, f.f2.x, f.f2.z + 60, true);
  f.step(2);
  eq(f.log.some((e) => e.kind === 'partsHp'), false, 'no split yet during the shake');
  f.step(8);
  if (p < 4) check(f.log.some((e) => e.kind === 'partsHp'), 'the second strike is split once the shake is over');
}

{
  // Ultimate, all four parts gone: no order, and the pick waits instead of running every frame.
  const f = toPhase2({ ultimate: true, targets: [player(0, 0, -4900)] });
  f.f2.applyPartsHp([0, 0, 0, 0]);
  f.log.length = 0;
  f.step(1);
  check(f.c.cooldown > 20, `the director waits (${f.c.cooldown})`);
  f.c.applyDelays(0, [3, 4, 5]);
  eq(f.c.delays.join(','), '3,4,5', '6x85 stores its delays in Ultimate');
}

// --- the laser's bars (VoloptBar, ctor 0x0044B0BC / update 0x0044B1B8) -------------------

{
  // Start height: 90 up to 60 from the origin, then 90 - (distance - 60) / 3.
  eq(barStartHeight(0), 90, 'a bar at the origin starts at 90');
  eq(barStartHeight(59.9), 90, 'and up to 60 away');
  eq(barStartHeight(60), 90, 'exactly 60 away');
  check(Math.abs(barStartHeight(120) - 70) < 1e-4, `120 away starts at 70 (${barStartHeight(120)})`);
  check(barStartHeight(400) < 0, 'far away it starts below the floor');
}

{
  // The timeline with a wait of 4: 4 ticks of waiting, 6 of falling (90 -> -6),
  // the landing on the 6th, 15 held, 6 rising (-6 -> 90) and gone.
  const sounds: number[] = [];
  const near = player(0, 8, 0); // inside 5 + 5
  const edge = player(1, 10, 0); // exactly on the edge
  const out = player(2, 10.5, 0);
  const dead = player(3, 0, 0, true);
  const bar = new VoloptBar(0, 0, 0, 0, 4, 550, (id) => sounds.push(id));
  const targets = [near, edge, out, dead];
  eq(bar.y, 90, 'the bar starts at the top');
  eq(bar.effect.kind, 'tech', 'its hit is a technique hit');
  eq((bar.effect as { power: number }).power, 550, 'with iparam2 of row 37');
  const hitsAt: number[] = [];
  let ticks = 0;
  let landed = -1;
  while (!bar.done && ticks < 200) {
    ticks++;
    const hits = bar.tick(targets);
    if (hits.length) {
      landed = ticks;
      for (const h of hits) hitsAt.push(h.clientId);
    }
  }
  eq(landed, 4 + 6, 'it lands after the wait and six falls of 16');
  eq(hitsAt.join(','), '0,1', 'the live players inside the sphere (5 + 5) are hit, once');
  eq(ticks, 4 + 6 + 15 + 6, 'wait, fall, 15 held, six rising and then it is deleted');
  eq(sounds.join(','), String(BAR.landSe), 'the landing plays 0x343 once');
  // A wait of 1 (or 0) goes straight on to the fall in the same tick.
  const quick = new VoloptBar(0, 0, 0, 0, 1, 1, () => {});
  quick.tick([]);
  eq(quick.state, 2, 'a wait of one tick is spent by the first tick');
  const zero = new VoloptBar(0, 0, 0, 0, 0, 1, () => {});
  zero.tick([]);
  eq(zero.state, 2, 'a wait of zero too');
  // From far away it starts low and lands sooner.
  const far = new VoloptBar(120, 0, 0, 0, 1, 1, () => {});
  let n = 0;
  for (; n < 50 && far.state < 3; n++) far.tick([]);
  eq(n, 1 + Math.ceil(70 / 16), 'a bar 120 away (start 70) falls five ticks');
}

{
  // The laser builds four bars a round at the four points, each with the row's
  // wait (iparam6) and power (iparam2), measured from phase 2's origin.
  const f = toPhase2({ targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  f.f2.applyAction(4, 0, 0);
  const bars = (): VoloptBar[] => f.shots.filter((s): s is VoloptBar => s instanceof VoloptBar);
  f.until(() => bars().length >= 4, 2000, 'the first round of bars');
  const first = bars().slice(0, 4);
  eq(bars().length, 4, 'four bars in the first round');
  for (const b of first) {
    eq((b.effect as { power: number }).power, ROW_FORM2.iparam[1], 'a bar hits with iparam2');
    check(Math.abs(Math.hypot(b.x - f.f2.x, b.z - f.f2.z) - 75) < 26, 'and stands on the points turning round the body');
    eq(b.y, barStartHeight(Math.hypot(b.x, b.z + 5000)), 'its start height is measured from (0, -5000)');
  }
  // The bars that land on a player hit her; run them next to the fight.
  const target = f.targets[0];
  target.x = first[0].x;
  target.z = first[0].z;
  let hit = 0;
  for (let i = 0; i < 400 && !first[0].done; i++) {
    for (const b of first) {
      const h = b.tick(f.targets);
      if (b === first[0] && h.length) hit++;
    }
  }
  eq(hit, 1, 'the bar over the player landed on her once');
  f.until(() => f.f2.st === 0, 2000, 'laser done');
  eq(bars().length, 12, 'three rounds of four bars');
}

{
  // The Ultimate arm builds a bar under each player in its arc.
  const f = toPhase2({ ultimate: true, targets: [player(0, 0, -4900)] });
  f.leader.on = false;
  f.f2.applyAction(7, 0, 0);
  eq(f.f2.st, 0xc, 'the arm state');
  f.until(() => f.f2.st === 0, 400, 'arm done');
  const bars = f.shots.filter((s) => s instanceof VoloptBar);
  eq(bars.length, 1, 'one bar under the one player in the arc');
}

// --- the capture's cage (VoloptCage, ctor 0x0044A54C / update 0x0044A694) --------------------

{
  // It starts 35 ahead and 30 up, flies at fparam1 along the facing, and
  // homes with fparam2 toward the weapon point of its target.
  const cage = new VoloptCage(0, -5000, 0, 1.24, 0.7, 130, 0);
  eq(cage.x, 0, 'straight ahead of a body facing +z');
  eq(cage.z, -5000 + CAGE.ahead, 'it starts 35 ahead');
  eq(cage.y, CAGE.up, 'and 30 up');
  const side = new VoloptCage(0, 0, 0x4000, 1, 0.5, 10, 0);
  check(Math.abs(side.x - 35) < 1e-9 && Math.abs(side.z) < 1e-9, 'facing 0x4000 turns the offset to +x');
  // Without a target it flies straight for iparam1 ticks and ends without a hit.
  const blind = new VoloptCage(0, 0, 0, 1.24, 0.7, 130, 0xffff);
  let ticks = 0;
  while (!blind.over && ticks < 500) {
    ticks++;
    eq(blind.tick([player(0, 0, 5)]) === null, true, 'no target, no hit');
  }
  eq(ticks, 130, 'it lives iparam1 ticks');
  check(Math.abs(blind.z - 35 - 1.24 * 130) < 1e-6 && blind.y === CAGE.up, 'on a straight line at fparam1');
  // With a target it comes down toward her and takes her once it is below 25.
  const me = player(0, 0, 60);
  const homing = new VoloptCage(0, 0, 0, 1.24, 0.7, 130, 0);
  let caught: AiTarget | null = null;
  let t = 0;
  let yAtHit = 99;
  while (!homing.over && !caught && t < 200) {
    t++;
    caught = homing.tick([me]);
    if (caught) yAtHit = homing.y;
  }
  check(caught === me, 'the cage caught the player it homed on');
  check(yAtHit < CAGE.ceiling, `below 25 when it caught her (${yAtHit})`);
  check(Math.hypot(homing.x - me.x, homing.z - me.z) <= CAGE.box + 5, 'inside 5 + 5');
  // Over a player but above 25: nothing yet.
  const high = new VoloptCage(0, 0, 0, 0.01, 0.0, 130, 0xffff);
  high.z = 0;
  const under = player(0, 0, 0.5);
  eq(high.tick([under]) === null, true, 'a cage above 25 touches nobody');
  // The first player in the list wins when two are inside.
  const twoA = player(4, 0, 38);
  const twoB = player(5, 0, 36);
  const pair = new VoloptCage(0, 0, 0, 0.5, 0.0, 130, 0xffff);
  pair.y = 20;
  eq(pair.tick([twoA, twoB])?.clientId, 4, 'the first player in the cache order');
}

// --- the pillar's hatch lid (VoloptLid, object 0x0044B84C) --------------------------------------

{
  const lid = new VoloptLid();
  eq(lid.state, 0, 'the lid starts idle');
  lid.set(1);
  lid.tick();
  lid.tick();
  eq(lid.state, 0, 'closing a closed hatch takes two ticks');
  eq(lid.a + lid.b, 0, 'and moves nothing');
  lid.set(2);
  let n = 0;
  while (lid.state !== 0 && n < 100) {
    n++;
    lid.tick();
  }
  eq(n, 11 + 10, 'opening: a falls 0.3 to -3 (11 ticks), then b falls 1.8 to -18 (10)');
  eq(lid.a, -3, 'the second part ends at -3');
  eq(lid.b, -18, 'the first part ends at -18');
  lid.set(1);
  n = 0;
  while (lid.state !== 0 && n < 100) {
    n++;
    lid.tick();
  }
  eq(n, 10 + 11, 'closing: b rises 1.8 to 0 (10 ticks), then a rises 0.3 to 0 (11)');
  eq(lid.a + lid.b, 0, 'both parts are back');
  // Opening again before it finished starts the first step over.
  lid.set(2);
  for (let i = 0; i < 5; i++) lid.tick();
  const a5 = lid.a;
  check(a5 < 0 && a5 > -3, 'half way open');
  lid.set(1);
  lid.tick();
  eq(lid.b, 0, 'the first step of closing is on b, which had not moved');
}

{
  // A pillar's lid follows its state: open while it is up, closed otherwise.
  const f = fight();
  f.until(() => f.c.ai === VO_AI.fight, 600, 'intro');
  const p = f.c.pillars[0];
  p.start(true);
  f.step(40);
  eq(p.lid.a, -3, 'a rising pillar opens its hatch (second part)');
  eq(p.lid.b, -18, 'and the first part');
  p.retract();
  f.until(() => p.lid.state === 0 && p.bars !== 2 && p.lid.b === 0, 600, 'the hatch closes again');
}

{
  // The parts the renderer draws for the control (enemymodels.ts volOptChildren):
  // a lid per pillar on the pillar's place, a broken model per monitor (hidden
  // until the monitor falls), and no rod in Ultimate.
  const ctx = (difficulty: number): EnemyModelContext => ({ area: 0x0d, episode: 1, difficulty, event: 0 });
  const set = { type: 0xc2, params: [0, 0, 0, 0, 0, 0, 0] } as unknown as Parameters<typeof enemyModelFor>[0];
  const normal = enemyModelFor(set, ctx(0));
  const ultimate = enemyModelFor(set, ctx(3));
  const partNamed = (spec: typeof normal, name: string) => spec?.parts.find((p) => p.name === name);
  eq(normal?.parts.filter((p) => p.name?.endsWith(' lid')).length, 6, 'six pillar lids');
  eq(VOLOPT_LID_MODEL, 13, 'the lid is model 13 (fe_obj_vo_futa_moto)');
  for (let i = 0; i < 6; i++) {
    const lid = partNamed(normal, `pillar ${i} lid`);
    const pillar = partNamed(normal, `pillar ${i}`);
    eq(lid?.model, VOLOPT_LID_MODEL, `pillar ${i} lid model`);
    eq(lid?.place, 'world', `pillar ${i} lid is placed from the arena origin`);
    eq(lid?.yaw, pillar?.yaw, `pillar ${i} lid turns with its pillar`);
    eq(lid?.offset?.[0], pillar?.offset?.[0], `pillar ${i} lid x`);
    eq(lid?.offset?.[2], pillar?.offset?.[2], `pillar ${i} lid z`);
  }
  for (let i = 0; i < 24; i++) {
    const broken = partNamed(normal, `monitor ${i} broken`);
    const screen = partNamed(normal, `monitor ${i}`);
    eq(broken?.model, VOLOPT_MONITOR_BROKEN[i & 3], `monitor ${i} broken model`);
    eq(broken?.hidden, true, `monitor ${i} broken model is hidden until it falls`);
    eq(broken?.offset?.[2], screen?.offset?.[2], `monitor ${i} broken model stands where the screen does`);
  }
  eq(VOLOPT_MONITOR_BROKEN.join(), '3,6,9,12', 'the broken models (table 0x009a5230)');
  eq(normal?.parts.some((p) => p.name === 'lightning rod'), true, 'Normal has the rod');
  eq(ultimate?.parts.some((p) => p.name === 'lightning rod'), false, 'Ultimate has no rod');
  eq(ultimate?.parts.filter((p) => p.name?.endsWith(' lid')).length, 6, 'Ultimate still has the lids');
}

{
  // The lid's drawn offsets over time (what render/combat.ts sets on the nodes):
  // the first node follows b and the child a, from the closed hatch and back.
  const lid = new VoloptLid();
  lid.set(2);
  let steps = 0;
  // The child drops first (10 ticks to -3), then the first node (10 ticks to
  // -18); the tick that ends a part starts the next one (a float32 sum of 0.3
  // stops a tick short of -3, so it takes 11 ticks there).
  while (lid.sub === 0 && lid.state !== 0 && steps < 100) {
    lid.tick();
    steps++;
  }
  check(Math.abs(lid.a + 3) < 1e-4 && lid.b === 0 && steps === 11, `opening: the child drops to -3 in 11 ticks (float32 steps), first the child (a ${lid.a})`);
  while (lid.state !== 0 && steps < 100) {
    lid.tick();
    steps++;
  }
  check(Math.abs(lid.b + 18) < 1e-4 && Math.abs(lid.a + 3) < 1e-4, `opening: the first node ends at -18 (b ${lid.b})`);
  eq(steps, 21, 'opening takes 21 ticks');
  eq(lid.state, 0, 'the open hatch is idle');
  let prev = lid.b;
  lid.set(1);
  steps = 0;
  while (lid.state !== 0 && steps < 100) {
    lid.tick();
    steps++;
    check(lid.b >= prev - 1e-6, 'closing: the first node only rises');
    prev = lid.b;
  }
  check(Math.abs(lid.a) < 1e-4 && Math.abs(lid.b) < 1e-4, 'closed: both nodes back at their bind heights');
  eq(steps, 21, 'closing takes 21 ticks (10 on b, then 11 on a: the tick that ends b starts a)');
}

{
  // Radar (render/combat.ts voloptRadar, PsoBB.exe icon call sites per entity update, see the
  // comment there). The lock and the hit are not changed by this rule.
  const f = fight();
  eq(voloptRadar(f.c), 'never', 'the control is never on the radar (no icon call in its code)');
  check(radarConcealed({ ai: f.c }), 'the control stays off the radar');
  const part = (kind: 'rod' | 'prison' | 'monitor' | 'pillar' | 'core', targetable: boolean, dead = false) => {
    const p = new VoloptPart(kind, 0, VO_ID[kind], 1);
    p.targetable = targetable;
    p.dead = dead;
    return new VoloptPartAi(p, f.c);
  };
  const rod = part('rod', false);
  eq(voloptRadar(rod), 'always', 'the rod has an icon every frame (0x00440e55, no state gate)');
  check(!radarConcealed({ ai: rod }), 'an untargetable rod is still on the radar');
  check(rod.untargetable, 'the rod is still not lockable while untargetable (lock and hit unchanged)');
  check(radarConcealed({ ai: part('rod', false, true) }), 'a dead rod is off the radar (ASSUMED)');
  const prison = part('prison', true);
  eq(voloptRadar(prison), 'never', 'the prison has no icon call (0x00449e3c)');
  check(radarConcealed({ ai: prison }), 'the prison stays off the radar even while targetable');
  // Monitors: the icon (0x00441aaa) is after every state and gated only by flag 0x800 of +0x30.
  const mon = new VoloptMonitor(0, 1, 1, f.c, 0, 0);
  eq(voloptRadar(new VoloptPartAi(mon, f.c)), 'always', 'a monitor is on the radar in every state (0x800 gate only)');
  check(!radarConcealed({ ai: new VoloptPartAi(mon, f.c) }), 'an untargetable monitor that is not broken is on the radar');
  mon.st = 5;
  check(!radarConcealed({ ai: new VoloptPartAi(mon, f.c) }), 'a fallen monitor (state 5, no 0x800) is still on the radar');
  mon.breakDown();
  eq(voloptRadar(new VoloptPartAi(mon, f.c)), 'never', 'a broken monitor (the wall loop set 0x800) is off the radar');
  check(radarConcealed({ ai: new VoloptPartAi(mon, f.c) }), 'a broken monitor stays off the radar');
  // Pillars: states 0 and 5 have no icon call; 2, 4 and 9 do (the sub-state paths not traced).
  const pillar = (st: number) => {
    const p = new VoloptPillar(0, 1, f.c, 0, 0);
    p.st = st;
    return new VoloptPartAi(p, f.c);
  };
  for (const st of [0, 5]) check(radarConcealed({ ai: pillar(st) }), `a pillar in state ${st} is off the radar`);
  for (const st of [2, 4, 9]) check(!radarConcealed({ ai: pillar(st) }), `a pillar in state ${st} is on the radar even untargetable`);
  // Core: 0, 4, 5 and 7 have no icon call; 2 has one; 1, 9 and 10 gate it on the current monitor (DAT_00a447ac >= 0).
  const core = (st: number) => {
    const c = new VoloptCore(1, 120, f.c, 0, 0);
    c.st = st;
    return new VoloptPartAi(c, f.c);
  };
  for (const st of [0, 4, 5, 7]) check(radarConcealed({ ai: core(st) }), `a core in state ${st} is off the radar`);
  check(!radarConcealed({ ai: core(2) }), 'a core in state 2 is on the radar');
  const exposedOff = f.c.exposed;
  f.c.exposed = -1;
  for (const st of [1, 9, 10]) check(radarConcealed({ ai: core(st) }), `a core in state ${st} is off the radar with no current monitor`);
  f.c.exposed = 3;
  for (const st of [1, 9, 10]) check(!radarConcealed({ ai: core(st) }), `a core in state ${st} is on the radar behind a monitor`);
  f.c.exposed = exposedOff;
  eq(voloptRadar(f.f2), 'always', 'the body has an icon every live frame (0x00444692, flag 0x4000 only)');
  check(f.f2.untargetable && !f.f2.ready, 'the body is not ready yet and not lockable');
  check(!radarConcealed({ ai: f.f2 }), 'a body that is not ready is on the radar (its root shows once awake)');
}

{
  // Lock-on (render/combat.ts voloptLockOk: the enable_reticle_ sites per entity and state, PsoBB.exe
  // 0x007aa094). The lock is not the hit: a part can be lockable while its hit (targetable) is off.
  const f = fight();
  const part = (kind: 'prison' | 'monitor' | 'pillar' | 'core', targetable: boolean) => {
    const p = new VoloptPart(kind, 0, VO_ID[kind], 1);
    p.targetable = targetable;
    return new VoloptPartAi(p, f.c);
  };
  const lockOf = (ai: VoloptPartAi | VoloptForm2Ai | VoloptAi) => splitLockOk({ ai });
  eq(voloptLockOk(f.c), false, 'the control is never lockable (no enable_reticle_ site, 0x0043c508..0x0043e338)');
  eq(lockOf(f.c), false, 'the control is not locked through splitLockOk either');
  const prison = part('prison', true);
  eq(voloptLockOk(prison), false, 'the prison is never lockable (no site, 0x00449c33..0x0044a0d8)');
  // Monitors: no site in the monitor code (0x004414d8..0x00442254), so never locked even when it is hit.
  const mon = new VoloptMonitor(0, 1, 1, f.c, 0, 0);
  const monAi = new VoloptPartAi(mon, f.c);
  mon.targetable = true;
  eq(voloptLockOk(monAi), false, 'a monitor is never lockable (no site in its code)');
  eq(lockOf(monAi), false, 'a monitor on the core wall is not locked');
  check(!monAi.untargetable && splitStruckOk({ ai: monAi }), 'the hit path is not the lock: an exposed monitor is still struck');
  // Core: sites in states 1, 2, 4, 5, 7, 9, 10 minus the refused 7 (the 0x40000 window); none in 0, 3, 6, 8.
  const core = (st: number) => {
    const c = new VoloptCore(1, 120, f.c, 0, 0);
    c.st = st;
    return new VoloptPartAi(c, f.c);
  };
  for (const st of [1, 2, 4, 5, 9, 10]) eq(voloptLockOk(core(st)), true, `a core in state ${st} is lockable`);
  for (const st of [0, 3, 6, 7, 8]) eq(voloptLockOk(core(st)), false, `a core in state ${st} is not lockable`);
  const lockedCore = core(2);
  check(lockedCore.untargetable && lockOf(lockedCore), 'a core in state 2 is locked while its hit stays off (targetable false)');
  // Pillars: sites in 2, 4, 5, 9 (0 is refused by its 0x40000 window); 1, 3, 6, 7, 8 have none.
  const pillar = (st: number) => {
    const p = new VoloptPillar(0, 1, f.c, 0, 0);
    p.st = st;
    return new VoloptPartAi(p, f.c);
  };
  for (const st of [2, 4, 5, 9]) eq(voloptLockOk(pillar(st)), true, `a pillar in state ${st} is lockable`);
  for (const st of [0, 1, 3, 6, 7, 8]) eq(voloptLockOk(pillar(st)), false, `a pillar in state ${st} is not lockable`);
  // Rods: sites in 4 and 5 only. States 0 and 1 (the hanging rod) have no site: shootable, not lockable.
  const rod = (st: number) => {
    const r = new VoloptRod(450, 0, 0);
    r.st = st;
    return new VoloptPartAi(r, f.c);
  };
  for (const st of [4, 5]) eq(voloptLockOk(rod(st)), true, `a rod in state ${st} is lockable`);
  for (const st of [0, 1, 2, 7]) eq(voloptLockOk(rod(st)), false, `a rod in state ${st} is not lockable`);
  const hanging = rod(1);
  hanging.part.targetable = true; // the rod's tick sets it for state 1 (and 4)
  check(!hanging.untargetable && !lockOf(hanging), 'a hanging rod (state 1) is struck but not locked');
  // Body: sites in 0, 2, 5, 9, 10, 11, 12; 1 and 4 have none; 7 is refused by its 0x40000 window.
  const st0 = f.f2.st;
  for (const st of [0, 2, 5, 9, 10, 11, 12]) {
    f.f2.st = st;
    eq(voloptLockOk(f.f2), true, `the body in state ${st} is lockable`);
  }
  for (const st of [1, 3, 4, 6, 7, 8]) {
    f.f2.st = st;
    eq(voloptLockOk(f.f2), false, `the body in state ${st} is not lockable`);
  }
  f.f2.st = st0;
  check(f.f2.untargetable && lockOf(f.f2) === false, 'a body that is not ready is not locked');
  // Other enemies keep their own lock rule.
  eq(splitLockOk({ ai: null }), true, 'a non-Vol Opt enemy is not gated by the Vol Opt rule');
}

{
  // Real data: the model entries the lid and the broken monitors come from are in
  // bm_boss3_volopt.bml with the shapes the code assumes.
  const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME ?? '', 'Downloads/psobb-client/data');
  const gslPath = join(DATA, 'data.gsl');
  if (!existsSync(gslPath)) {
    console.log(`skipped the real-model check: ${gslPath} not found`);
  } else {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(gslPath)));
    const archive = new EnemyArchive('bm_boss3_volopt.bml', gsl.get('bm_boss3_volopt.bml'), 25);
    const lid = archive.model(VOLOPT_LID_MODEL);
    eq(lid.name, 'fe_obj_vo_futa_moto.nj', 'model 13 is the lid');
    eq(lid.kind, 'nj', 'the lid is a NJ model');
    eq(lid.object.children.length, 1, 'the lid has a root and one child node');
    eq(lid.object.children[0].children.length, 0, 'and the child has no children');
    for (const m of VOLOPT_MONITOR_BROKEN) eq(archive.model(m).name.includes('_hakai'), true, `model ${m} is a broken monitor`);
    eq(archive.model(17).name, 'me5p01_y_all.nj', 'model 17 is the pillar');
    eq(archive.model(16).name, 'fs_obj_hiraishin_a.nj', 'model 16 is the rod');
    eq(archive.model(24).name, 'me5_y_all.nj', 'model 24 is the core');
    eq(archive.model(19).name, 'me5p02_y_all.nj', 'model 19 is the phase 2 body');
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('volopt tests passed');
