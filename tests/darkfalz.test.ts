// Dark Falz's fight (client/src/combat/darkfalz*.ts): the control's scenes and
// their waits, the leader / follower split over 6x19, the Darvants, the three
// forms' state machines (sequences, attacks, hits, deaths), the remote damage
// paths, the ending's kill send, and that no state can hang.
//
// Every wait of the exe in this fight is a frame count the states load into
// their timer (tables 0x009A5940 / 0x009A6000 / 0x009A6280 / 0x009A6520), so the
// tests count real frames; the animation clips are 30 frame loops stepped by
// each form's own rule (DfAnim), tested against the tables' chains.
//
// Run: node tests/darkfalz.test.ts
import { DARVANT, DarkFalzAi, DarkFalzPartAi, Darvant, DF_ID, SCENE, SCENE_NAMES, darvantBoxStart, darvantBoxStep, darvantRingIcon, darvantRowSpeed } from '../client/src/combat/darkfalz.ts';
import { DfForm1, F1, F1_ANIM_ROWS, F1_BOX_COUNT, F1_BOX_FLAGS, pickWeighted, pushedOutOfBody, BODY_CIRCLES } from '../client/src/combat/darkfalz1.ts';
import { DfForm2, F2, F2_ANIM_ROWS } from '../client/src/combat/darkfalz2.ts';
import { advanceScale, BOLT, DfForm3, F3, F3_ANIM_ROWS, HomingBolt, f3Spot } from '../client/src/combat/darkfalz3.ts';
import { CASKET, CIRCLE, DfAnim, NO_PACKED, SCENE_FRAMES, STALL_TICKS, angDiff, ease, type DfEvent, type DfRow } from '../client/src/combat/darkfalzcommon.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyShot } from '../client/src/combat/enemyshots.ts';
import type { FireShot } from '../client/src/combat/techfire.ts';
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

// BattleParamEntry_on.dat, rows 53..57 (hp, atp, fparam1, iparam1..4) by
// difficulty, as tools/exedata.py and the table reader give them.
const row = (hp: number, atp: number, f1: number, i1 = 0, i2 = 0, i3 = 0, i4 = 0, i5 = 0): DfRow => ({ hp, atp, f1, i1, i2, i3, i4, i5 });
// The form 3 rows' iparam5 (the homing bolt's power) read from the same file:
// movement row 56 at 0xae00 + (difficulty * 0x60 + 56) * 0x30, +0x28 = 700, 1000,
// 1600, 2000 (fparam1 0.3, 0.4, 0.5, 0.5, the fixture's f1).
const ROWS = [
  // Normal
  { darvant: row(125, 80, 0.38, 3), df1: row(5900, 700, 13, 9, 6, 550), df2: row(6500, 750, 5, 2, 4), df3: row(9000, 800, 0.3, 3, 3, 3, 20000, 700), darvantFalz: row(250, 220, 0.5, 4) },
  // Hard
  { darvant: row(150, 190, 0.42, 5), df1: row(8500, 1100, 10, 12, 7, 900), df2: row(9000, 1300, 4, 2, 7), df3: row(8000, 1400, 0.4, 4, 10, 4, 10000, 1000), darvantFalz: row(300, 500, 0.9, 10) },
  // Very Hard
  { darvant: row(250, 350, 0.48, 10), df1: row(18000, 1900, 7, 14, 9, 1800), df2: row(10000, 2000, 3, 1, 14), df3: row(16500, 2100, 0.5, 5, 12, 6, 10000, 1600), darvantFalz: row(500, 700, 1.6, 14) },
  // Ultimate
  { darvant: row(300, 1390, 0.55, 10), df1: row(20000, 2400, 5, 24, 24, 2100), df2: row(16500, 2980, 1, 1, 24), df3: row(21000, 2560, 0.5, 5, 5, 3, 15000, 2000), darvantFalz: row(600, 1550, 1.6, 14) },
];

const player = (clientId: number, x: number, z: number, dead = false): AiTarget => ({ clientId, x, z, charClass: 0, dead });

interface Fight {
  c: DarkFalzAi; // the leader's brain
  shots: EnemyShot[]; // the shots the leader launched (the beam's balls)
  f: DarkFalzAi | null; // a follower's
  log: DfEvent[];
  sent: number;
  targets: AiTarget[];
  t: number;
  step(n?: number): void;
  until(cond: () => boolean, max: number, label: string): number;
}

function fight(over: { difficulty?: number; seed?: number; targets?: AiTarget[]; follower?: boolean; party?: number; lag?: number } = {}): Fight {
  const d = over.difficulty ?? 0;
  const mk = (leader: boolean, selfId: number, seed: number) =>
    new DarkFalzAi({ x: 0, z: 0, angle: 0, difficulty: d, rows: ROWS[d], leader: () => leader, selfId: () => selfId, partySize: () => over.party ?? 1, rng: seeded(seed) });
  const c = mk(true, 0, over.seed ?? 5);
  const f = over.follower ? mk(false, 1, (over.seed ?? 5) + 99) : null;
  const queue: Array<{ at: number; phase: number; packed: number }> = [];
  const fi: Fight = {
    c,
    shots: [],
    f,
    log: [],
    sent: 0,
    targets: over.targets ?? [player(0, CASKET.x, CASKET.z)],
    t: 0,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        fi.t++;
        // The follower gets the leader's packets `lag` ticks after they went out
        // (0: in the same tick, before its own).
        if (f) while (queue.length && queue[0].at <= fi.t) f.receive(queue[0].phase, queue.shift()!.packed);
        const frame = c.tick(fi.targets);
        for (const s of frame.shots ?? []) fi.shots.push(s);
        for (let k = 0; k < c.events.length; k++) {
          const ev = c.events[k];
          fi.log.push(ev);
          if (ev.kind === 'send') {
            fi.sent++;
            if (f) queue.push({ at: fi.t + (over.lag ?? 0), phase: ev.phase, packed: ev.packed });
          }
        }
        c.events.length = 0;
        if (f) {
          while (queue.length && queue[0].at <= fi.t) f.receive(queue[0].phase, queue.shift()!.packed);
          if (f.leader()) throw new Error('follower is a leader');
          f.tick(fi.targets);
          for (const ev of f.events) if (ev.kind === 'send') check(false, `the follower sent ${JSON.stringify(ev)}`);
          f.events.length = 0;
        }
      }
    },
    until(cond, max, label) {
      for (let i = 0; i < max; i++) {
        if (cond()) return i;
        fi.step();
      }
      check(false, `${label}: not within ${max} ticks (t=${fi.t}, scene ${SCENE_NAMES[c.scene]})`);
      return max;
    },
  };
  return fi;
}

// Kill Darvants until the ZAKO scene is done.
function clearZako(fi: Fight): void {
  fi.until(() => fi.c.scene === SCENE.zako, 400, 'ZAKO');
  // A ring Darvant can be hit only in its box window (450 of every 2701 ticks): the wait is long.
  for (let n = 0; n < 6000 && fi.c.scene === SCENE.zako; n++) {
    const d = fi.c.darvants.find((x) => x.st !== DARVANT.dead && !x.gone && x.targetable);
    if (d) d.damage(10000, true);
    fi.step();
  }
}

// The players stand in the arena once the casket scene is over.
function toArena(fi: Fight, x = 0, z = 0): void {
  fi.step(1);
  fi.targets[0].x = x;
  fi.targets[0].z = z;
}

// --- 1. the packed actions -------------------------------------------------------

{
  const p = DfForm1.pack(F1.move, 3, 1, 2, 0, 9, 5);
  eq(p, F1.move | (3 << 4) | (1 << 6) | (2 << 8) | (0 << 10) | (9 << 12) | (5 << 16), 'form 1 pack');
  const fi = fight();
  const f1 = new DfForm1(fi.c, { hp: 5900, atp: 700, moveFrames: 390, rafoie: 9, rabarta: 6, tenchu: 550, spitMax: 4 }, 0);
  f1.receive(p);
  eq(`${f1.st} ${f1.from} ${f1.to} ${f1.oldV} ${f1.newV} ${f1.gx} ${f1.gz}`, '2 3 1 2 0 9 5', 'form 1 receive: state, from, to, variants, cell');
  eq(f1.timer, 390, 'MOVESTNDPOS loads row 54 fparam1 * 30 frames');
  eq(f1.target[0], (9 + 0.5) * 29.375 - 235, 'the target point is the centre of the cell');
  f1.receive(DfForm1.pack(F1.tenchu, 1, 1, 1, 1, 0, 0));
  eq(f1.st, F1.tenchu, 'TENCHU entered');
  f1.receive(11 | (1 << 4));
  eq(f1.st, F1.tenchu, 'a state above 10 is ignored');
  eq(f1.from, 1, 'but its fields are stored (SetPlayerVoloptForm7HazardConfig)');
  f1.receive(F1.haki | (0 << 8) | (3 << 10));
  eq(f1.st, F1.tenchu, 'a variant of 3 is not a state change');
}
{
  const fi = fight();
  const f2 = new DfForm2(fi.c, { hp: 6500, atp: 750, moveFrames: 150, stopState: 10, restaLevel: 4, rafoie: 9, rabarta: 6, tenchu: 550 });
  f2.receive(DfForm2.pack(F2.move, 5, 9, 3, 12, 15));
  eq(f2.x, Math.sin((5 << 12) * ((Math.PI * 2) / 0x10000)) * 300, 'the body hangs on the circle of 300');
  eq(f2.y, -50, 'at height -50');
  eq(`${f2.st} ${f2.angle} ${f2.toAngle} ${f2.gx} ${f2.gz} ${f2.who}`, `4 ${5 << 12} ${9 << 12} 3 12 -1`, 'form 2 receive snaps to the slot; 0xF is no player');
  eq(f2.timer, 150, 'MOVE loads +0x424');
  eq(f2.moves, 1, 'MOVE counts');
  f2.receive(DfForm2.pack(F2.recover, 5, 5, 0, 0, 2));
  eq(f2.who, 2, 'a player id rides bits 20-23');
  eq(f2.moves, 0, 'any other state clears the move count');
  f2.receive(14);
  eq(f2.st, F2.recover, 'a state above 0xD is ignored');
}
{
  const fi = fight();
  const f3 = new DfForm3(fi.c, { hp: 9000, atp: 800, lMagic: 3, megid: 3, orbs: 3, f1: 0.3, power: 700 }, 10000, 0);
  f3.receive(DfForm3.pack(F3.libera, 0x11, 0x10, 3, 7, 2, 0xf));
  eq(`${f3.st} ${f3.from} ${f3.to} ${f3.oldFace} ${f3.face} ${f3.aim} ${f3.held}`, '16 17 16 3 7 2 -1', 'form 3 receive, state 0x10 is LIBERA');
  f3.receive(0x11);
  eq(f3.st, F3.libera, 'a state above 0x10 is ignored');
  eq(DfForm3.pack(F3.bura, 4, 5, 6, 7, 8, 9), F3.bura | (4 << 5) | (5 << 10) | (6 << 15) | (7 << 19) | (8 << 23) | (9 << 27), 'form 3 pack');
  const out: [number, number, number] = [0, 0, 0];
  f3Spot(F3.middle, out);
  eq(`${out[0]} ${out[1]} ${out[2]}`, '10000 -10 0', 'slot 0x10 is the middle on the ground');
  f3Spot(F3.above, out);
  eq(out[1], 300, 'slot 0x11 is 300 up');
  f3Spot(4, out);
  eq(Math.round(out[0]), 10000 - 100, 'slot 4 (a quarter turn) is 100 to the -x side');
  eq(Math.round(out[2]), 0, 'and on the middle line');
}

// --- 2. the animation chain ----------------------------------------------------------

{
  const a = new DfAnim(F1_ANIM_ROWS, 0.4);
  a.set(2);
  let guard = 0;
  while (a.id === 2 && guard++ < 200) a.tick();
  eq(a.id, 3, 'a mode 2 clip hands on to the row\'s next');
  eq(a.mode, 0, 'which loops');
  const g = new DfAnim(F2_ANIM_ROWS, 1);
  g.set(2);
  for (let i = 0; i < 60; i++) g.tick();
  eq(g.frame, 29, 'a mode 1 clip holds frame 29');
  const h = new DfAnim(F3_ANIM_ROWS, 1);
  h.set(3);
  for (let i = 0; i < 29; i++) h.tick();
  eq(h.id, 0, 'form 3\'s slash returns to the idle clip');
}

// --- 3. the control's scenes -------------------------------------------------------

{
  const fi = fight({ targets: [player(0, CASKET.x + 31, CASKET.z)] });
  fi.step(1);
  eq(fi.c.scene, SCENE.waitCasket, 'EDITOR goes on to WAIT_CASKET (the leader)');
  fi.step(20);
  eq(fi.c.scene, SCENE.waitCasket, '31 units from the casket: it waits');
  fi.targets[0].x = CASKET.x + 30;
  fi.step(1);
  eq(fi.c.scene, SCENE.demoWarp0, '30 units from the casket: 6x19 scene 2');
  eq(fi.log.some((e) => e.kind === 'send' && e.phase === 2 && e.packed === NO_PACKED), true, 'the packet is {2, no action}');
  eq(fi.log.some((e) => e.kind === 'place' && e.circle === 'inner'), true, 'the players stand on the inner circle');
  const t0 = fi.t;
  fi.until(() => fi.c.scene === SCENE.demoWarp1, 300, 'DEMO_WARP1');
  eq(fi.t - t0, SCENE_FRAMES.demoWarp0, 'DEMO_WARP0 lasts 120 frames');
  const t1 = fi.t;
  fi.until(() => fi.c.scene === SCENE.zako, 300, 'ZAKO');
  eq(fi.t - t1, SCENE_FRAMES.demoWarp1, 'DEMO_WARP1 lasts 30 frames');
}

{
  // The ZAKO scene.
  const fi = fight({ party: 2 });
  toArena(fi, CASKET.x, CASKET.z);
  fi.until(() => fi.c.scene === SCENE.zako, 400, 'ZAKO');
  eq(fi.c.darvants.length, 80, '5 + 15 + 25 + 35 Darvants');
  eq(fi.c.made, 80, 'the control counts them (+0x390)');
  const radii = new Map<number, number>();
  for (const d of fi.c.darvants) {
    const r = Math.round(Math.hypot(d.x, d.z) * 10) / 10;
    radii.set(r, (radii.get(r) ?? 0) + 1);
  }
  eq([...radii.entries()].map(([r, n]) => `${r}:${n}`).join(' '), '28.6:5 85.7:15 142.9:25 200:35', 'rings of 5 / 15 / 25 / 35 at 28.6 + 57.1 each');
  eq(fi.c.darvants[0].entity, DF_ID.darvant, 'the first Darvant is control + 1');
  eq(fi.c.darvants[79].entity, 80, 'and the last control + 80');
  check(fi.c.darvants[0].y < -12, 'they start under the floor (y -13, one third up in the tick they are made)');
  check(!fi.c.darvants[0].targetable, 'and cannot be hit while they rise');
  fi.step(60);
  eq(fi.c.darvants[0].y, DARVANT.top, 'after 57 frames they float at 6');
  // The ring's box is off until its first window (PsoBB.exe 0x0045F25C): hover and chase
  // count the timer, and the box is on for 450 of each 2701 ticks.
  check(!fi.c.darvants[0].targetable, 'hovering with the box off: cannot be hit yet');
  let on = 0;
  for (let k = 0; k < 2701; k++) {
    if (fi.c.darvants[0].targetable) on++;
    fi.step();
  }
  eq(on, 450, 'the box is on for 450 ticks of the 2701-tick cycle');
  // Kills needed: row 53 iparam1 (3) x players (2). Each one waits for its box window.
  const need = 3 * 2;
  const hitInWindow = (d: Darvant) => {
    for (let k = 0; k < 2701 && !d.targetable; k++) fi.step();
    d.damage(1000, true);
  };
  for (let i = 0; i < need - 1; i++) hitInWindow(fi.c.darvants[i]);
  fi.step(3);
  eq(fi.c.kills, need - 1, 'the dead are counted');
  eq(fi.c.scene, SCENE.zako, 'one short: still ZAKO');
  hitInWindow(fi.c.darvants[need - 1]);
  fi.step(2);
  eq(fi.c.scene, SCENE.appType1, 'row 53 iparam1 * players kills end the scene');
  eq(fi.c.kills, fi.c.made, 'the Darvants left alive die with the scene (they all count)');
}

{
  // Ultimate rings are 1.25 wider.
  const fi = fight({ difficulty: 3 });
  toArena(fi, CASKET.x, CASKET.z);
  fi.until(() => fi.c.scene === SCENE.zako, 400, 'ZAKO');
  eq(Math.round(Math.hypot(fi.c.darvants[0].x, fi.c.darvants[0].z) * 100) / 100, 35.71, 'Ultimate: ring 1 at 28.571 * 1.25');
}

{
  // A Darvant's aura: within 8 of the player, every 16th frame, its ATP.
  const fi = fight();
  toArena(fi, CASKET.x, CASKET.z);
  fi.until(() => fi.c.scene === SCENE.zako, 400, 'ZAKO');
  fi.log.length = 0;
  fi.targets[0].x = fi.c.darvants[0].x + 3;
  fi.targets[0].z = fi.c.darvants[0].z;
  fi.step(120);
  const hits = fi.log.filter((e) => e.kind === 'hit' && e.what === 'Darvant');
  check(hits.length >= 3, `a Darvant next to the player hits it (${hits.length})`);
  eq(hits.every((e) => e.kind === 'hit' && e.power === 80 && !e.fixed), true, 'for its ATP, through the technique formula');
  fi.targets[0].x = 0;
  fi.targets[0].z = 0;
}

{
  // APP TYPE1 and the first form.
  const fi = fight();
  toArena(fi, CASKET.x, CASKET.z);
  clearZako(fi);
  eq(fi.c.scene, SCENE.appType1, 'APP TYPE1');
  const t = fi.t;
  fi.until(() => fi.log.some((e) => e.kind === 'bgm'), 400, 'dark1');
  eq(fi.t - t, SCENE_FRAMES.appType1Music, 'dark1.adx at frame 0xB9');
  fi.until(() => fi.c.scene === SCENE.type1, 400, 'TYPE1');
  eq(fi.t - t, SCENE_FRAMES.appType1, 'APP TYPE1 lasts 0x146 frames');
  eq(fi.log.some((e) => e.kind === 'questFlag' && e.flag === 0x32), true, 'quest flag 0x32');
  check(!!fi.c.form1, 'form 1 exists');
  eq(fi.c.form1!.entity, DF_ID.form1, 'in the slot control + 0x200');
  eq(fi.c.form1!.hp, 5900, 'with row 54\'s HP');
}

// --- 4. form 1 ------------------------------------------------------------------------

// Below half the HP, whatever the form is doing.
const lowHp = (f: { hp: number; threshold: number }) => {
  f.hp = f.threshold;
};

function toType1(fi: Fight): void {
  toArena(fi, CASKET.x, CASKET.z);
  clearZako(fi);
  fi.until(() => fi.c.scene === SCENE.type1, 500, 'TYPE1');
  fi.targets[0].x = 0;
  fi.targets[0].z = 0;
}

{
  const fi = fight({ seed: 9 });
  toType1(fi);
  const f1 = fi.c.form1!;
  // APPEAR slides from z -120 to -175 in 75 frames.
  eq(f1.st, F1.appear, 'APPEAR');
  eq(f1.z, -120, 'rises out of the floor at z -120');
  check(!fi.log.some((e) => e.kind === 'send' && e.packed !== NO_PACKED), 'no order before APPEAR ends');
  const seen = new Set<number>();
  let longest = 0;
  let run = 0;
  let last = -1;
  const spat: number[] = [];
  let ent = f1.entries;
  for (let i = 0; i < 12000; i++) {
    fi.step();
    seen.add(f1.st);
    if (f1.entries === ent) run++;
    else {
      longest = Math.max(longest, run);
      run = 0;
      ent = f1.entries;
      last = f1.st;
    }
    if (f1.st === F1.haki && f1.timer === 1) spat.push(f1.spat);
    // Keep it alive but below half so TENCHU can come.
    if (i === 1500) lowHp(f1);
    if (fi.c.scene !== SCENE.type1) break;
  }
  for (const st of [F1.appear, F1.move, F1.haki, F1.hakiEnd, F1.beamL, F1.beamR]) check(seen.has(st), `form 1 reached state ${st}`);
  check(seen.has(F1.tenchu), 'form 1 below half HP uses TENCHU');
  eq(Math.max(...spat) <= 4, true, 'HAKILOOP spits at most row 57 iparam1 (4) Darvants');
  check(spat.some((n) => n >= 1), 'and spits');
  check(longest <= 400, `no state of form 1 lasts more than its wait (${longest})`);
  // Positions: only the four spots when not moving.
  const spots = F1.spots.map((s) => `${s[0]},${s[2]}`);
  check(spots.includes(`${Math.round(f1.x)},${Math.round(f1.z)}`) || f1.st === F1.move, 'form 1 stands on one of the four spots');
}

{
  // The move takes row 54 fparam1 * 30 frames and the heads turn to the new variant.
  const fi = fight({ seed: 3 });
  toType1(fi);
  const f1 = fi.c.form1!;
  fi.until(() => f1.st === F1.move, 4000, 'MOVESTNDPOS');
  const from = f1.from;
  const to = f1.to;
  check(from !== to, 'the move goes to another spot');
  const t0 = fi.t;
  fi.until(() => f1.st !== F1.move, 800, 'move done');
  eq(fi.t - t0, 390, 'MOVESTNDPOS lasts 13 * 30 frames (the order is applied in the tick that starts it)');
  const want = F1.spots[to];
  eq(`${Math.round(f1.x)} ${Math.round(f1.z)}`, `${want[0]} ${want[2]}`, 'ends on the spot');
}

{
  // TENCHU: 64 marks, one on the player, a hit within 25 of any at the last frame.
  const fi = fight({ seed: 4 });
  toType1(fi);
  const f1 = fi.c.form1!;
  lowHp(f1);
  fi.targets[0].x = 50;
  fi.targets[0].z = 40;
  let tenchu = false;
  for (let i = 0; i < 20000 && !tenchu; i++) {
    fi.step();
    if (f1.st === F1.tenchu) tenchu = true;
  }
  check(tenchu, 'TENCHU came');
  fi.log.length = 0;
  fi.until(() => f1.timer === 5, 300, 'marks shown');
  eq(f1.markPoints.length, 64, '64 marks');
  eq(`${f1.markPoints[0][0]} ${f1.markPoints[0][2]}`, '50 40', 'the first is under the player');
  check(f1.markPoints.slice(1, 9).every((m) => Math.abs(Math.hypot(m[0] - 50, m[2] - 40) - 40) < 0.01), 'eight more on a ring of 40');
  check(f1.markPoints.slice(9).every((m) => Math.hypot(m[0] - f1.x, m[2] - f1.z) > 125 && Math.hypot(m[0], m[2]) < 230), 'the rest keep 125 from the body and inside the arena');
  const ent0 = f1.entries;
  fi.until(() => f1.entries !== ent0, 20, 'TENCHU ends');
  const hit = fi.log.filter((e) => e.kind === 'hit' && e.what === 'Dark Falz TENCHU');
  eq(hit.length, 1, 'standing on a mark: hit once');
  eq(hit[0].kind === 'hit' && hit[0].power, 550, 'for row 54 iparam3');
  eq(hit[0].kind === 'hit' && hit[0].fixed, true, 'as fixed damage');
  // Standing 70 away from the spot is safe.
  const g = fight({ seed: 4 });
  toType1(g);
  const h1 = g.c.form1!;
  lowHp(h1);
  g.targets[0].x = 50;
  g.targets[0].z = 40;
  let t2 = false;
  for (let i = 0; i < 20000 && !t2; i++) {
    g.step();
    if (h1.st === F1.tenchu) t2 = true;
  }
  g.log.length = 0;
  g.until(() => h1.timer === 8, 300, 'marks made');
  g.targets[0].x = 50 + 70;
  g.targets[0].z = 40;
  // Far from the first nine; the random ones may still land on it, so only the
  // nine are guaranteed clear.
  const near = h1.markPoints.slice(0, 9).some((m) => Math.hypot(m[0] - 120, m[2] - 40) < 25);
  check(!near, 'the nine marks about the player do not reach 70 away');
}

{
  // A beam: Rabarta / Rafoie at the cell of the player.
  const fi = fight({ seed: 12 });
  toType1(fi);
  const f1 = fi.c.form1!;
  fi.targets[0].x = -100;
  fi.targets[0].z = 100;
  fi.log.length = 0;
  fi.until(() => f1.st === F1.beamL || f1.st === F1.beamR, 20000, 'a beam');
  const cellX = Math.trunc((-100 + 235) / 29.375);
  const cellZ = Math.trunc((100 + 235) / 29.375);
  eq(`${f1.gx} ${f1.gz}`, `${cellX} ${cellZ}`, 'aimed at the player\'s cell');
  // The exe makes one technique object at timer 38 (0x00456860): a shot of the fight,
  // not an immediate event. It lives its cast frames and hits the player in its box.
  const st = f1.st;
  const ent = f1.entries;
  fi.shots.length = 0;
  const shotsSeen = new Set<EnemyShot>();
  const hitIds = new Set<number>();
  for (let k = 0; f1.entries === ent && k < 400; k++) {
    fi.step();
    for (const s of fi.shots) shotsSeen.add(s);
    for (const s of shotsSeen) if (!s.done) for (const h of s.tick(fi.targets)) hitIds.add(h.clientId);
  }
  eq(f1.entries !== ent, true, 'the beam ends');
  eq(fi.log.filter((e) => e.kind === 'tech').length, 0, 'no immediate tech event (the shot path does the hit)');
  eq(shotsSeen.size, 1, 'one technique object of the fight');
  const s0 = [...shotsSeen][0] as FireShot;
  eq(s0.fire.kind, st === F1.beamL ? 'rabarta' : 'rafoie', 'BEAM_L is Rabarta, BEAM_R Rafoie');
  eq(s0.fire.level, st === F1.beamL ? 6 : 9, 'at row 54 iparam2 / iparam1');
  eq(s0.fire.x, (cellX + 0.5) * 29.375 - 235, 'at the centre of the cell (x)');
  eq(s0.fire.z, (cellZ + 0.5) * 29.375 - 235, 'at the centre of the cell (z)');
  eq(s0.fire.y, 0, 'on the ground');
  // Keep ticking the object until its cast ends.
  for (let k = 0; k < 600 && !s0.done; k++) for (const h of s0.tick(fi.targets)) hitIds.add(h.clientId);
  eq(s0.done, true, 'the object ends');
  eq([...hitIds].join(), '0', 'it hits the player in the cell, once');
}

{
  // The alternate beam, and the weighted pick.
  const rng = seeded(2);
  const n = [0, 0];
  for (let i = 0; i < 4000; i++) n[pickWeighted({ random: rng }, [8, 9], [0.5, 0.5]) - 8]++;
  check(Math.abs(n[0] - 2000) < 150, `a fair pick (${n[0]})`);
  const m = [0, 0, 0];
  for (let i = 0; i < 4000; i++) m[pickWeighted({ random: rng }, [0, 1, 2], [0.25, 0.25, 0.5])]++;
  check(Math.abs(m[2] - 2000) < 150 && Math.abs(m[0] - 1000) < 150, `0.25 / 0.25 / 0.5 (${m.join(',')})`);
}

{
  // Death: DEAD for 75 frames, WAITKILL, then the control asks for APP TYPE2.
  const fi = fight({ seed: 6 });
  toType1(fi);
  const f1 = fi.c.form1!;
  const dealt = fi.c.damagePart(DF_ID.form1, 100000, true);
  eq(dealt, 5900, 'the damage taken is capped by the HP left');
  fi.step(1);
  eq(f1.st, F1.dead, 'form 1 dies (the die hook)');
  eq(fi.log.filter((e) => e.kind === 'died' && e.entity === DF_ID.form1).length, 1, 'one death event');
  check(!f1.targetable, 'a dead form cannot be hit');
  // The control asks for APP TYPE2 as soon as the form is in DEAD (the cutscene takes over).
  fi.step(2);
  eq(fi.c.scene, SCENE.appType2, 'the control moves on at once (TYPE1 lead: state 3 or 4)');
  eq(fi.log.some((e) => e.kind === 'questFlag' && e.flag === 0x33), true, 'quest flag 0x33');
  eq(fi.c.form1, null, 'form 1 is gone');
}

{
  // DEAD itself lasts 75 frames, then WAITKILL (a form that is not removed).
  const fi = fight({ seed: 6 });
  const f1 = new DfForm1(fi.c, { hp: 100, atp: 1, moveFrames: 390, rafoie: 1, rabarta: 1, tenchu: 1, spitMax: 4 }, 0);
  f1.hp = 0;
  f1.tick();
  eq(f1.st, F1.dead, 'dies');
  let n = 0;
  while (f1.st === F1.dead && n++ < 200) f1.tick();
  eq(n, 76, 'DEAD lasts 75 frames');
  eq(f1.st, F1.waitKill, 'then WAITKILL');
}

{
  // Remote damage feeds the pool; a hit copy never hangs the form.
  const fi = fight();
  toType1(fi);
  fi.c.damageTaken(DF_ID.form1, 1234);
  eq(fi.c.form1!.hp, 5900 - 1234, '6x0A: hp = max - damage taken');
  fi.c.damageTaken(DF_ID.form1, 100);
  eq(fi.c.form1!.hp, 5900 - 1234, 'a smaller total (a late copy) does not heal');
  fi.c.damageTaken(DF_ID.form1, 99999);
  eq(fi.c.form1!.hp, 0, 'the total can kill');
  fi.step(1);
  eq(fi.c.form1!.st, F1.dead, 'a remote kill runs the die hook here too');
}

// --- 5. form 2 -----------------------------------------------------------------------

function toType2(fi: Fight): void {
  toType1(fi);
  fi.c.damagePart(DF_ID.form1, 1e9, true);
  fi.until(() => fi.c.scene === SCENE.type2, 1500, 'TYPE2');
}

{
  const fi = fight({ seed: 7 });
  toType2(fi);
  const f2 = fi.c.form2!;
  eq(f2.entity, DF_ID.form2, 'form 2 is control + 0x1FF');
  eq(fi.log.some((e) => e.kind === 'questFlag' && e.flag === 0x34), true, 'quest flag 0x34');
  const seen = new Set<number>();
  let longest = 0;
  let run = 0;
  let last = -1;
  const moves: number[] = [];
  let ent2 = f2.entries;
  for (let i = 0; i < 12000; i++) {
    fi.step();
    seen.add(f2.st);
    if (f2.entries === ent2) run++;
    else {
      longest = Math.max(longest, run);
      run = 0;
      ent2 = f2.entries;
      last = f2.st;
      if (f2.st === F2.move) moves.push(fi.t);
    }
    if (i === 1500) lowHp(f2);
    if (fi.c.scene !== SCENE.type2) break;
  }
  for (const st of [F2.appear, F2.move, F2.jisin, F2.tenchu]) check(seen.has(st), `form 2 reached state ${st}`);
  check([...seen].some((s) => s >= F2.stop1 && s <= F2.stop4), 'form 2 pauses in MD_STOP');
  check(seen.has(F2.beamL) || seen.has(F2.beamR), 'form 2 fires beams');
  check(longest <= 400, `no state of form 2 lasts more than its wait (${longest})`);
  eq(f2.moves <= 3, true, 'at most three moves in a row');
}

{
  // MOVE: row 55 fparam1 * 30 frames; the angle eases between two slots.
  const fi = fight({ seed: 8 });
  toType2(fi);
  const f2 = fi.c.form2!;
  fi.until(() => f2.st === F2.move, 3000, 'MOVE');
  const t0 = fi.t;
  const a0 = f2.angle;
  fi.step(40);
  check(f2.angle !== a0, 'the angle moves');
  fi.until(() => f2.st !== F2.move, 400, 'move done');
  eq(fi.t - t0, 150, 'MOVE lasts 5 * 30 frames');
  eq(f2.angle, f2.toAngle, 'and ends on the slot');
  const mid = ease(0.5);
  check(Math.abs(mid - 0.5) < 1e-9, 'the ease is symmetric');
}

{
  // JISIN is the quake that goes on to TENCHU; TENCHU ends in the pause row 55 iparam1 names.
  const fi = fight({ seed: 8 });
  toType2(fi);
  const f2 = fi.c.form2!;
  fi.until(() => f2.st === F2.jisin, 6000, 'JISIN');
  const t0 = fi.t;
  fi.until(() => f2.st === F2.tenchu, 200, 'TENCHU');
  eq(fi.t - t0, F2.jisinFrames, 'JISIN lasts 75 frames');
  fi.until(() => f2.st !== F2.tenchu, 300, 'TENCHU done');
  eq(f2.st, 10, 'TENCHU hands on to MD_STOP2 (8 + row 55 iparam1 = 2)');
  eq(f2.blend, 0, 'and the blend is back');
}

{
  // Row 55 iparam1 = 1 gives MD_STOP1; the pauses count 75 / 150 / 225 / 300.
  const fi = fight({ seed: 2, difficulty: 2 });
  toType2(fi);
  const f2 = fi.c.form2!;
  eq(f2.row.stopState, 9, 'Very Hard: the pause after an attack is MD_STOP1');
  eq(f2.row.moveFrames, 90, 'its move takes 90 frames');
  eq(f2.row.restaLevel, 14, 'Resta level 14');
  fi.until(() => f2.st >= F2.stop1 && f2.st <= F2.stop4, 4000, 'a pause');
  const st = f2.st;
  const t0 = fi.t;
  fi.until(() => f2.st !== st, 400, 'pause done');
  // The pause is its table's frames (the other form 2 waits above are exact too; the old +1 was the
  // phase of the TYPE1 -> TYPE2 start, which the ZAKO wait now moves).
  eq(fi.t - t0, F2.stopFrames[st - F2.stop1] + 1, `MD_STOP${st - 8} lasts ${F2.stopFrames[st - F2.stop1]} frames`);
}

{
  // The beam: balls every other tick from 38 to 4 on the ring of 100, +-20.
  const fi = fight({ seed: 21 });
  toType2(fi);
  const f2 = fi.c.form2!;
  fi.targets[0].x = 90;
  fi.targets[0].z = 0;
  // Twelve players about the ring of 280 (the beam's MaxScale) so the balls meet some.
  for (let k = 0; k < 12; k++) fi.targets.push(player(10 + k, Math.sin((k * Math.PI) / 6) * 280, Math.cos((k * Math.PI) / 6) * 280));
  fi.until(() => f2.st === F2.beamL || f2.st === F2.beamR, 40000, 'a beam');
  const rabarta = f2.st === F2.beamL;
  {
    // The heading D is the body's direction to the target cell's centre (0x0045A790:
    // +0x3bc..+0x3c4 minus the body +0x38 / +0x40, y zeroed, normalised).
    const d = f2 as unknown as { beamDx: number; beamDz: number };
    const dx = (f2.gx + 0.5) * 29.375 - 235 - f2.x;
    const dz = (f2.gz + 0.5) * 29.375 - 235 - f2.z;
    const l = Math.hypot(dx, dz);
    check(Math.abs(d.beamDx - dx / l) < 1e-9 && Math.abs(d.beamDz - dz / l) < 1e-9, `the beam's heading is body to the cell centre (${d.beamDx.toFixed(3)}, ${d.beamDz.toFixed(3)})`);
  }
  fi.log.length = 0;
  fi.shots.length = 0;
  let balls = 0;
  let iconTotal = 0;
  let iconsOk = true;
  const hitIds = new Set<number>();
  const shotsSeen = new Set<EnemyShot>();
  while (f2.st === F2.beamL || f2.st === F2.beamR) {
    fi.step();
    for (let i = balls; i < f2.ballCount; i++) {
      // P stays within the ring of 280 (+50 a step) and the ball 20 off it.
      check(Math.hypot(f2.balls[i].x, f2.balls[i].z) < 280 + 50 + 20 + 1, 'a ball stays about the ring of 280');
    }
    balls = f2.ballCount;
    // The forced 2.5 icon of each ball thrown on this tick (0x40200000, colour 0xffffa24c).
    // (The body's own forced 5.0 icon is listed too; it is checked below.)
    const icons = f2.minimapIcons().filter((ic) => ic.scale !== 5);
    iconTotal += icons.length;
    for (const ic of icons) iconsOk = iconsOk && ic.scale === 2.5 && ic.shape === 1 && ic.color === 0xffffa24c;
    // Each ball's technique object ticks once a game tick, as the fight's shots do.
    for (const s of fi.shots) shotsSeen.add(s);
    for (const s of shotsSeen) if (!s.done) for (const h of s.tick(fi.targets)) hitIds.add(h.clientId);
  }
  eq(balls, 18, 'eighteen balls (timer 38, 36 .. 4)');
  eq(fi.shots.length, 18, 'each ball is a technique object of the fight');
  eq(iconTotal, 18, 'one forced 2.5 radar icon a ball');
  check(iconsOk, 'the icons are forced 2.5 enemy icons');
  eq(f2.balls[0].rabarta, rabarta, 'BEAM_L throws Rabarta');
  eq(fi.shots.every((s) => (s as FireShot).fire.kind === (rabarta ? 'rabarta' : 'rafoie')), true, 'each ball is the beam\'s technique');
  eq(f2.st, f2.row.stopState, 'and the pause follows');
  // The balls are removed when their technique ends (the cast frames).
  for (let k = 0; k < 600 && [...shotsSeen].some((s) => !s.done); k++) {
    fi.step();
    for (const s of shotsSeen) if (!s.done) for (const h of s.tick(fi.targets)) hitIds.add(h.clientId);
  }
  eq([...shotsSeen].every((s) => s.done), true, 'every ball ends');
  check(hitIds.size >= 1, `the balls hit players within their reach (${hitIds.size})`);
  eq(f2.minimapIcons().filter((ic) => ic.scale === 2.5).length, 0, 'no ball icon once the beam is over');
  eq(f2.minimapIcons().filter((ic) => ic.scale === 5).length, 1, 'the body icon stays (forced every live frame)');
}

{
  // MD_RECOVER (below half): Resta on itself at the end.
  const fi = fight({ seed: 33, difficulty: 1 });
  toType2(fi);
  const f2 = fi.c.form2!;
  lowHp(f2);
  let rec = false;
  for (let i = 0; i < 60000 && !rec; i++) {
    fi.step();
    if (f2.st === F2.recover) rec = true;
  }
  check(rec, 'MD_RECOVER came');
  eq(f2.who >= 0, true, 'aimed at a player');
  fi.log.length = 0;
  const hp0 = f2.hp;
  fi.until(() => f2.st !== F2.recover, 400, 'recover done');
  eq(fi.log.some((e) => e.kind === 'resta' && e.level === 7), true, 'Resta at row 55 iparam2 (7)');
  check(f2.hp > hp0, `Resta heals it (${hp0} -> ${f2.hp})`);
}

{
  // Death of form 2 on Normal: the ring; the flag 0x35.
  const fi = fight({ seed: 4 });
  toType2(fi);
  fi.c.damagePart(DF_ID.form2, 1e9, true);
  fi.until(() => fi.c.scene === SCENE.dieType2, 400, 'DIE TYPE2');
  eq(fi.log.some((e) => e.kind === 'questFlag' && e.flag === 0x35), true, 'quest flag 0x35');
  eq(fi.c.form2, null, 'form 2 is gone');
  const t0 = fi.t;
  fi.until(() => fi.c.scene !== SCENE.dieType2, 400, 'out of DIE TYPE2');
  eq(fi.t - t0, SCENE_FRAMES.dieType2, 'DIE TYPE2 lasts 280 frames');
  eq(fi.c.scene, SCENE.getRing, 'Normal has no third form: GET RING');
  const t1 = fi.t;
  fi.until(() => fi.c.scene === SCENE.olEnding, 400, 'OL ENDING');
  eq(fi.t - t1, SCENE_FRAMES.getRing + 1, 'GET RING lasts 142 frames');
  const t2 = fi.t;
  fi.until(() => fi.c.finished, 600, 'the ending');
  eq(fi.t - t2, SCENE_FRAMES.olEnding + 1, 'OL ENDING lasts 0x1C6 frames');
  const k = fi.log.filter((e) => e.kind === 'killed');
  eq(k.length, 1, 'one kill send');
  eq(k[0].kind === 'killed' && `${k[0].x} ${k[0].z}`, '20 20', 'Normal: the drop at (20, 20)');
}

// --- 6. form 3 -----------------------------------------------------------------------

function toType3(fi: Fight): void {
  toType2(fi);
  fi.c.damagePart(DF_ID.form2, 1e9, true);
  fi.until(() => fi.c.scene === SCENE.type3, 1500, 'TYPE3');
}

{
  const fi = fight({ seed: 5, difficulty: 1 });
  toType3(fi);
  const f3 = fi.c.form3!;
  eq(f3.entity, DF_ID.form3, 'form 3 is control + 0x1FE');
  check(fi.log.some((e) => e.kind === 'place' && e.circle === 'outer'), 'the players stand on the outer circle');
  check(fi.log.some((e) => e.kind === 'bgm' && e.track === 2), 'dark2.adx at DEMO_WARP2');
  eq(fi.log.some((e) => e.kind === 'questFlag' && e.flag === 0x36), true, 'quest flag 0x36');
  eq(`${f3.x} ${f3.y} ${f3.z}`, '10000 -10 0', 'form 3 starts at the middle of its arena');
  check(fi.c.warps >= 1, 'the teleport bumps the brain\'s warps counter');
  const part = new DarkFalzPartAi(DF_ID.form3, fi.c);
  check(part.warps >= 0, 'the hit proxy reads the form\'s warps');
}

{
  const fi = fight({ seed: 5, difficulty: 1 });
  toType3(fi);
  const f3 = fi.c.form3!;
  const seen = new Set<number>();
  let longest = 0;
  let run = 0;
  let last = -1;
  const sent: number[] = [];
  let ent3 = f3.entries;
  for (let i = 0; i < 20000; i++) {
    fi.step();
    seen.add(f3.st);
    if (f3.entries === ent3) run++;
    else {
      longest = Math.max(longest, run);
      run = 0;
      ent3 = f3.entries;
      last = f3.st;
      sent.push(f3.st);
    }
    // Below half the HP it grabs players.
    if (i === 800) lowHp(f3);
    if (fi.c.scene !== SCENE.type3) break;
  }
  for (const st of [F3.appear, F3.cut, F3.bura, F3.goUp, F3.goDown, F3.homing, F3.lMagic, F3.capture, F3.dMagic, F3.libera]) check(seen.has(st), `form 3 reached state ${st}`);
  check(longest <= 400, `no state of form 3 lasts more than its wait (${longest})`);
  // The chain: every CUT hands on to the one below, CUT to BURA.
  for (let i = 1; i < sent.length; i++) {
    if (sent[i - 1] > F3.cut && sent[i - 1] <= F3.cut5) check(sent[i] === sent[i - 1] - 1 || sent[i] === F3.waitNext, `CUT${sent[i - 1]} -> ${sent[i]}`);
    if (sent[i - 1] === F3.cut) check(sent[i] === F3.bura || sent[i] === F3.waitNext, `CUT -> BURA (${sent[i]})`);
  }
}

{
  // The slash: six sectors of 0x71C about the facing slot, swept over six ticks.
  const fi = fight({ seed: 5, difficulty: 1 });
  toType3(fi);
  const f3 = fi.c.form3!;
  // Put a player in the slot-4 direction (angle 0x4000: atan2(-dx, dz) = pi / 2 -> dx < 0).
  fi.targets[0].x = 10000 - 150;
  fi.targets[0].z = 0;
  fi.targets.push(player(1, 10000 + 150, 0));
  fi.until(() => f3.st >= F3.cut && f3.st <= F3.cut5, 4000, 'a slash');
  const face = f3.face;
  fi.log.length = 0;
  fi.until(() => f3.st === F3.waitNext || f3.st === F3.bura || f3.st === F3.cut + 1 || f3.timer < 0, 200, 'slash done');
  const slashes = fi.log.filter((e) => e.kind === 'hit' && e.what === 'Dark Falz slash');
  // The first player stands at angle 0x4000 (slot 4); the second at 0xC000 (slot 12).
  const slot = face;
  const inSector = (angle: number) => {
    const rel = ((angle - (slot << 12) + 0x8000 + 0x10000) & 0xffff) - 0x8000;
    return rel >= -0x1554 - 1 && rel < 0x1554 + 0x71c;
  };
  const expectedHits = [0x4000, 0xc000].filter(inSector).length;
  check(slashes.length <= expectedHits + 1, `only players in the swept arc are hit (${slashes.length} of ${expectedHits})`);
  check(slashes.every((e) => e.kind === 'hit' && e.fixed && e.power === 1400), 'for the row\'s ATP as fixed damage');
}

{
  // Hidden above the ring: not hittable; capture shields it: the damage it takes also hurts the prisoner.
  const fi = fight({ seed: 5, difficulty: 1 });
  toType3(fi);
  const f3 = fi.c.form3!;
  fi.until(() => f3.to === F3.above, 5000, 'above');
  check(!f3.targetable, 'form 3 cannot be hit above the ring');
  eq(fi.c.damagePart(DF_ID.form3, 500, true), 0, 'a strike on it does nothing');
  fi.until(() => f3.to !== F3.above && f3.st !== F3.dead, 5000, 'back down');
  // Force a prisoner.
  f3.held = 0;
  f3.aim = -1;
  fi.log.length = 0;
  const hp = f3.hp;
  if (f3.targetable) {
    f3.damage(700, true);
    fi.step(1);
    const shield = fi.log.filter((e) => e.kind === 'hit' && e.what === 'Dark Falz holding you');
    eq(shield.length, 1, 'the prisoner is hurt once');
    eq(shield[0].kind === 'hit' && shield[0].power, 700, 'by what the form lost');
    check(hp - f3.hp === 700, 'and the form lost it too');
  } else check(false, 'form 3 should be hittable now');
}

{
  // Megid on every player in DMAGIC, the technique on every player in LMAGIC.
  const fi = fight({ seed: 5, difficulty: 1 });
  toType3(fi);
  const f3 = fi.c.form3!;
  fi.targets.push(player(1, 10020, 30));
  f3.receive(DfForm3.pack(F3.dMagic, 0x11, 0x11, 0, 0, 0xf, 0));
  fi.log.length = 0;
  fi.until(() => f3.st !== F3.dMagic, 300, 'DMAGIC done');
  const megid = fi.log.filter((e) => e.kind === 'megid');
  eq(megid.length, 2, 'Megid on both players');
  eq(megid[0].kind === 'megid' && megid[0].level, 10, 'at row 56 iparam2');
  f3.receive(DfForm3.pack(F3.lMagic, 0x11, 0x11, 0, 0, 0xf, 0xf));
  fi.log.length = 0;
  fi.until(() => f3.st !== F3.lMagic, 300, 'LMAGIC done');
  eq(fi.log.filter((e) => e.kind === 'tech').length, 2, 'LMAGIC on both players');
}

{
  // HORMING: n volleys of two bolts (row 56 iparam3).
  const fi = fight({ seed: 5, difficulty: 1 });
  toType3(fi);
  const f3 = fi.c.form3!;
  fi.targets[0].x = 10000;
  fi.targets[0].z = 100;
  f3.receive(DfForm3.pack(F3.homing, 0x11, 0x11, 0, 0, 0, 0xf));
  let shots = 0;
  const bolts: HomingBolt[] = [];
  for (let i = 0; i < 300 && f3.st === F3.homing; i++) {
    const r = fi.c.tick(fi.targets);
    fi.c.events.length = 0;
    if (r.shots) {
      shots += r.shots.length;
      for (const s of r.shots) bolts.push(s as HomingBolt);
    }
  }
  eq(shots, 8, 'four volleys of two bolts (Hard: iparam3 = 4)');
  let hit = false;
  const t = fi.targets;
  for (let i = 0; i < 400 && !hit; i++) {
    for (const b of bolts) if (b.tick(t).length) hit = true;
  }
  check(hit, 'a homing bolt reaches its player');
}

{
  // The homing bolt's own flight (exe: ctor 0x00453030, update 0x00452BCC).
  const tune = (o: { f1?: number; power?: number; ultimate?: boolean; live?: boolean } = {}) => ({
    f1: o.f1 ?? 0.3,
    power: o.power ?? 700,
    ultimate: o.ultimate ?? false,
    shooterLive: () => o.live ?? true,
  });
  const far = [{ clientId: 0, x: 1e6, y: 0, z: 0, charClass: 0, dead: false }];
  // Life: the counter starts at 150 (300 in Ultimate) and the bolt is removed
  // on the tick it goes below 0, so 151 (301) ticks with no hit.
  for (const ult of [false, true]) {
    const b = new HomingBolt(0, 40, 0, 0, tune({ ultimate: ult }));
    let n = 0;
    while (!b.done && n < 1000) {
      b.tick(far);
      n++;
    }
    eq(n, ult ? 301 : 151, `a bolt with no hit lives ${ult ? 301 : 151} ticks (${ult ? 'Ultimate' : 'Normal'})`);
  }
  // Speed: 6 units a tick.
  const s = new HomingBolt(0, 40, 0, 0, tune());
  s.tick(far);
  const p0 = [s.x, s.y, s.z];
  s.tick(far);
  const step = Math.hypot(s.x - p0[0], s.y - p0[1], s.z - p0[2]);
  check(Math.abs(step - BOLT.speed) < 1e-9, `a bolt moves ${BOLT.speed} a tick (got ${step.toFixed(6)})`);
  // The start: it dives (no sideways part) before it turns.
  const first = new HomingBolt(0, 40, 0, 0, tune());
  first.tick(far);
  check(Math.abs(first.x) < 1e-9 && first.y < 40 - 5 && first.z > 0, 'the start heads down and forward (heading 0)');
  // A target that is gone removes the bolt at once.
  const gone = new HomingBolt(0, 40, 0, 0, tune());
  eq(gone.tick([]).length, 0, 'no hit when the target is gone');
  check(gone.done, 'a bolt whose target is gone is removed');
  // A player on the spot is hit with the row's iparam5 as the power; a shooter
  // that cannot hit (WAITKILL / DEAD) removes the bolt with no hit.
  const on = [{ clientId: 0, x: 10000, y: 0, z: 100, charClass: 0, dead: false }];
  const hitting = new HomingBolt(10000, 40, 100, 0, tune({ power: 1000 }));
  eq(hitting.tick(on).length, 1, 'a bolt on a player hits it');
  eq(hitting.effect.power, 1000, 'the hit power is iparam5, passed raw');
  const blocked = new HomingBolt(10000, 40, 100, 0, tune({ live: false }));
  eq(blocked.tick(on).length, 0, 'a shooter that cannot hit: no hit');
  check(blocked.done, 'and the bolt is removed');
}

{
  // Form 1's body pushes players out of its six circles (0x004551F4).
  const body = { x: 0, z: 0, yaw: 0, variant: 0 };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // The circles run in order, each on the position the last one left. A player on
  // the centre goes out to 75.75 along +x (the origin fallback), then the (50, 0)
  // circle takes it to 110.75 and the head circle (130, 0), radius 30, back to 99.25.
  const c0 = pushedOutOfBody(body, { x: 0, z: 0 });
  check(c0 !== null && near(c0.dx, 99.25) && near(c0.dz, 0), 'a player on the centre ends at 99.25 (the circles chain)');
  // Outside every circle: no push.
  eq(pushedOutOfBody(body, { x: 0, z: 200 }), null, 'a player outside the body is not pushed');
  // At (100, 0): the (50, 0) circle (radius 60) gives 110.75, the head circle 99.25.
  const p1 = pushedOutOfBody(body, { x: 100, z: 0 });
  check(p1 !== null && near(p1.dx, -0.75) && near(p1.dz, 0), 'at (100, 0) the chain ends at 99.25');
  // The sixth circle follows the variant: (130, 0) for 0, (0, 130) for 1.
  const s0 = pushedOutOfBody(body, { x: 150, z: 0 });
  check(s0 !== null && near(s0.dx, 10.75), 'variant 0: the head circle at (130, 0) pushes to 160.75');
  eq(pushedOutOfBody({ ...body, variant: 1 }, { x: 150, z: 0 }), null, 'variant 1: the head circle is at (0, 130), not here');
  // The body's yaw turns the circles: yaw 0x4000 (90 degrees) moves (130, 0) to (0, -130).
  const turned = pushedOutOfBody({ ...body, yaw: 0x4000 }, { x: 0, z: -150 });
  check(turned !== null && near(turned.dx, 0) && near(turned.dz, -10.75), 'a quarter turn moves the head circle to (0, -130)');
  check(BODY_CIRCLES.radii.length === 6 && BODY_CIRCLES.points.length + 1 === BODY_CIRCLES.radii.length, 'six circles');
}

{
  // Death of form 3 on Hard: the ending.
  const fi = fight({ seed: 5, difficulty: 1 });
  toType3(fi);
  fi.c.damagePart(DF_ID.form3, 1e9, true);
  fi.until(() => fi.c.scene === SCENE.dieType3, 400, 'DIE TYPE3');
  eq(fi.log.some((e) => e.kind === 'questFlag' && e.flag === 0x37), true, 'quest flag 0x37');
  const t0 = fi.t;
  fi.until(() => fi.c.scene === SCENE.olEnding, 800, 'OL ENDING');
  eq(fi.t - t0, SCENE_FRAMES.dieType3, 'DIE TYPE3 lasts 302 frames');
  fi.until(() => fi.c.finished, 600, 'the end');
  const k = fi.log.filter((e) => e.kind === 'killed');
  eq(k.length, 1, 'one kill send');
  eq(k[0].kind === 'killed' && `${k[0].x} ${k[0].z}`, '10226 96', 'other difficulties: the drop at (10226, 96)');
  fi.step(50);
  eq(fi.log.filter((e) => e.kind === 'killed').length, 1, 'and no second one');
}

// --- 7. the leader and a follower ------------------------------------------------------

{
  // A follower never sends, and follows the leader packet for packet.
  const fi = fight({ follower: true, seed: 11, targets: [player(0, CASKET.x + 500, CASKET.z)] });
  const f = fi.f!;
  fi.step(30);
  eq(f.scene, SCENE.editor, 'the follower starts in EDITOR and its own lead procedure is idle');
  fi.targets[0].x = CASKET.x;
  fi.until(() => fi.c.scene === SCENE.demoWarp0, 50, 'the leader goes');
  fi.step(2);
  eq(f.scene, SCENE.demoWarp0, 'the follower follows the 6x19 phase');
  fi.targets[0].x = 0;
  fi.targets[0].z = 0;
  clearZakoBoth(fi);
  const ticksTo = (cond: () => boolean, max: number) => {
    for (let i = 0; i < max && !cond(); i++) fi.step();
  };
  ticksTo(() => fi.c.scene === SCENE.type1, 800);
  fi.step(2);
  eq(f.scene, SCENE.type1, 'the follower is in TYPE1 too');
  // Lockstep over 4000 ticks of form 1: the same state and timer every tick.
  let diff = 0;
  for (let i = 0; i < 4000 && fi.c.scene === SCENE.type1; i++) {
    fi.step();
    if (fi.c.form1 && f.form1 && (fi.c.form1.st !== f.form1.st || fi.c.form1.to !== f.form1.to)) diff++;
  }
  eq(diff, 0, 'form 1 stays in step on both clients (immediate delivery)');
  // The follower takes the same damage by 6x0A.
  fi.c.damagePart(DF_ID.form1, 400, true);
  f.damageTaken(DF_ID.form1, 400);
  eq(f.form1!.hp, fi.c.form1!.hp, 'the same HP');
}

function clearZakoBoth(fi: Fight): void {
  fi.until(() => fi.c.scene === SCENE.zako, 400, 'ZAKO');
  fi.step(5);
  // A ring Darvant can be hit only in its box window (450 of every 2701 ticks): the wait is long.
  for (let n = 0; n < 6000 && fi.c.scene === SCENE.zako; n++) {
    const d = fi.c.darvants.find((x) => x.st !== DARVANT.dead && !x.gone && x.targetable);
    if (d) {
      d.damage(10000, true);
      fi.f?.damageTaken(d.entity, 10000);
    }
    fi.step();
  }
}

{
  // With the packets a few ticks late the follower still reaches every scene.
  const fi = fight({ follower: true, seed: 12, lag: 3, difficulty: 1 });
  fi.step(1);
  fi.targets[0].x = CASKET.x;
  clearZakoBoth(fi);
  fi.step(30);
  fi.targets[0].x = 0;
  fi.until(() => fi.c.scene === SCENE.type1, 800, 'leader TYPE1');
  fi.step(10);
  eq(fi.f!.scene, SCENE.type1, 'a lagging follower reaches TYPE1');
  fi.c.damagePart(DF_ID.form1, 1e9, true);
  fi.f!.damageTaken(DF_ID.form1, 1e9);
  fi.until(() => fi.c.scene === SCENE.type2, 800, 'TYPE2');
  fi.step(10);
  eq(fi.f!.scene, SCENE.type2, 'and TYPE2');
  eq(!!fi.f!.form2, true, 'with form 2 made by its own scene');
}

{
  // Phases from 6x19 for the music.
  const body = (phase: number) => {
    const b = new Uint8Array(0x10);
    new DataView(b.buffer).setUint16(4, phase, true);
    return b;
  };
  eq(bossPhaseOf(0x0e, 0x19, body(6)), 1, '6x19 scene 6 plays dark1');
  eq(bossPhaseOf(0x0e, 0x19, body(11)), 2, '6x19 scene 11 plays dark2');
  eq(bossPhaseOf(0x0e, 0x19, body(0xffff)), null, 'no change');
}

// --- 8. no state hangs -------------------------------------------------------------------

{
  // A follower that never hears from the leader decides for itself after STALL_TICKS.
  const fi = fight({ seed: 14 });
  const lone = new DarkFalzAi({ x: 0, z: 0, angle: 0, difficulty: 1, rows: ROWS[1], leader: () => false, selfId: () => 1, partySize: () => 1, rng: seeded(3) });
  const tg = [player(1, 0, 0)];
  lone.receive(SCENE.type1, NO_PACKED);
  const f1 = lone.form1!;
  let moved = 0;
  for (let i = 0; i < STALL_TICKS * 6; i++) {
    lone.tick(tg);
    for (const ev of lone.events) if (ev.kind === 'send') moved++;
    lone.events.length = 0;
  }
  check(moved > 0, `a silent leader does not hang the follower (${moved} orders)`);
  check(f1.st !== F1.appear, 'form 1 left APPEAR');
  void fi;
}

{
  // Players leaving, dying, nobody alive: nothing throws and the forms keep going.
  const fi = fight({ seed: 15, difficulty: 2 });
  toType3(fi);
  const f3 = fi.c.form3!;
  fi.targets[0].dead = true;
  let guard = 0;
  let longest = 0;
  let run = 0;
  let last = -1;
  let ent4 = f3.entries;
  while (guard++ < 6000 && fi.c.scene === SCENE.type3) {
    fi.step();
    if (f3.entries === ent4) run++;
    else {
      longest = Math.max(longest, run);
      run = 0;
      ent4 = f3.entries;
      last = f3.st;
    }
  }
  check(longest <= 400, `with nobody alive form 3 keeps cycling (${longest})`);
  fi.targets.length = 0;
  const e0 = f3.entries;
  fi.step(600);
  check(f3.entries > e0, 'with no players at all the form keeps cycling');
}

{
  // Every difficulty goes through the whole fight with no state longer than its wait.
  for (const d of [0, 1, 2, 3]) {
    const fi = fight({ seed: 20 + d, difficulty: d });
    toArena(fi, CASKET.x, CASKET.z);
    clearZako(fi);
    fi.targets[0].x = 0;
    fi.targets[0].z = 0;
    let guard = 0;
    while (!fi.c.finished && guard++ < 40000) {
      fi.step();
      if (fi.c.scene === SCENE.type1 && fi.t % 200 === 0) fi.c.damagePart(DF_ID.form1, 600, true);
      if (fi.c.scene === SCENE.type2 && fi.t % 200 === 0) fi.c.damagePart(DF_ID.form2, 600, true);
      if (fi.c.scene === SCENE.type3 && fi.t % 200 === 0) fi.c.damagePart(DF_ID.form3, 600, true);
    }
    check(fi.c.finished, `difficulty ${d}: the fight reaches its end (${guard} ticks)`);
    eq(fi.log.filter((e) => e.kind === 'killed').length, 1, `difficulty ${d}: one kill send`);
    const flags = fi.log.filter((e) => e.kind === 'questFlag').map((e) => (e as { flag: number }).flag);
    const want = d === 0 ? [0x32, 0x33, 0x34, 0x35] : [0x32, 0x33, 0x34, 0x35, 0x36, 0x37];
    eq(flags.join(','), want.join(','), `difficulty ${d}: the quest flags in order`);
  }
}

{
  // Garbage from the network (6x19 with any phase and any packed word) and damage
  // from any client never throws, never leaves a form in a state outside its table
  // and never makes a position NaN.
  const rnd = seeded(77);
  const fi = fight({ seed: 31, difficulty: 2 });
  fi.step(1);
  fi.targets[0].x = 0;
  fi.targets[0].z = 0;
  let bad = 0;
  for (let i = 0; i < 30000; i++) {
    if (i % 3 === 0) {
      const phase = rnd() < 0.5 ? 0xffff : Math.trunc(rnd() * 20);
      const packed = rnd() < 0.2 ? 0xffffffff : Math.trunc(rnd() * 0x100000000) >>> 0;
      fi.c.receive(phase, packed);
    }
    if (i % 5 === 0) fi.c.damageTaken(1 + Math.trunc(rnd() * 3), Math.trunc(rnd() * 400));
    if (i % 7 === 0) fi.c.damagePart([DF_ID.form1, DF_ID.form2, DF_ID.form3, 1 + Math.trunc(rnd() * 90)][Math.trunc(rnd() * 4)], rnd() * 300, rnd() < 0.5);
    fi.targets[0].dead = rnd() < 0.02;
    fi.step();
    for (const f of [fi.c.form1, fi.c.form2, fi.c.form3]) {
      if (!f) continue;
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.z)) bad++;
      if (f instanceof DfForm1 && (f.st < 0 || f.st > 10)) bad++;
      if (f instanceof DfForm2 && (f.st < 0 || f.st > 13)) bad++;
      if (f instanceof DfForm3 && (f.st < 0 || f.st > 16)) bad++;
      if (f.hp < 0 || f.hp > f.maxHp) bad++;
    }
    fi.c.events.length = 0;
    if (fi.c.finished) break;
  }
  eq(bad, 0, 'forms stay inside their tables under garbage');
}

{
  // The hit proxies answer for their entity.
  const fi = fight();
  toType1(fi);
  const p = new DarkFalzPartAi(DF_ID.form1, fi.c);
  check(!p.untargetable, 'a live form can be hit');
  const d = new DarkFalzPartAi(DF_ID.darvant, fi.c);
  check(d.untargetable, 'a Darvant that does not exist cannot');
  const q: [number, number, number] = [0, 0, 0];
  check(fi.c.reachOf(DF_ID.form1, 0, 0, q), 'form 1 offers a head');
  const heads = fi.c.form1!.heads.map((h) => `${Math.round(h[0])},${Math.round(h[2])}`);
  eq(heads.length, 3, 'three heads');
  const dd = new Darvant(1, 10);
  eq(dd.damage(5, false), 0, 'a Darvant that is still rising takes nothing');
  eq(angDiff(0xfff0, 0x10), 0x20, 'angDiff wraps');
  eq(CIRCLE.outer.radius, 250, 'the outer circle is 250');
  void HomingBolt;
}

{
  // Form 2's beam in Ultimate (0x00458E44): when the beam's timer runs out, three
  // Darvants per living player about the body, at radius 12.5, rising from y -13 (the
  // constructor 0x00460DE4, PROVEN) at 10/9 a frame to 6, then flying (state 2), alive while the scene is TYPE2.
  const two = () => [player(0, CASKET.x, CASKET.z), player(1, CASKET.x + 4, CASKET.z)];
  const fi = fight({ seed: 7, difficulty: 3, targets: two() });
  toType2(fi);
  const f2 = fi.c.form2!;
  const beam = () => f2.st === F2.beamL || f2.st === F2.beamR;
  fi.until(beam, 40000, 'a beam (Ultimate)');
  const before = fi.c.darvants.length;
  let px = 0;
  let pz = 0;
  for (let n = 0; beam() && n < 400; n++) {
    px = f2.x;
    pz = f2.z;
    fi.step();
  }
  const made = fi.c.darvants.slice(before);
  eq(made.length, 6, 'Ultimate: three Darvants per living player (two players)');
  eq(made.every((d) => d.kind === 'beam'), true, 'they are the beam kind');
  eq(new Set(made.map((d) => d.entity)).size, made.length, 'each has its own id');
  eq(made.every((d) => d.entity >= 1 && d.entity <= 0x1fd), true, 'ids in control + 1 .. 0x1fd');
  let posOk = true;
  made.forEach((d, i) => {
    const [ox, oz] = DARVANT.beamOffsets[i % 3];
    if (Math.abs(d.x - (px + ox * 12.5)) > 1e-9 || Math.abs(d.z - (pz + oz * 12.5)) > 1e-9 || d.y !== DARVANT.beamFloor) posOk = false;
  });
  check(posOk, 'at the body + (0, -12.5), (-10.75, 6.25), (10.75, 6.25), at y -13 (the constructor sets it; body height unused)');
  const r = made[0];
  const y0 = r.y;
  const t0 = fi.t;
  fi.until(() => r.st !== DARVANT.rise, 200, 'the beam Darvant rises');
  const frames = fi.t - t0;
  check(Math.abs(frames - Math.ceil((DARVANT.top - y0) / DARVANT.beamRise)) <= 1, `it rises at 10/9 a frame (${frames} frames from ${y0.toFixed(1)})`);
  // The top is reached in state 2; the bob of state 2 (0x00460938 / 0x00460B34) runs on that tick too.
  check(Math.abs(r.y - DARVANT.top) <= DARVANT.bobAmp + 1e-9, 'and it is at the top, 6, within the bob (0.1)');
  eq(r.st, DARVANT.chase, 'then the flight: state 2 (0x00460C10, PROVEN)');
  // Their life: they die with TYPE2 (the update's scene check, 0x00460938).
  fi.c.damagePart(DF_ID.form2, 1e9, true);
  fi.until(() => fi.c.scene !== SCENE.type2, 4000, 'the end of TYPE2');
  fi.step(1);
  eq(made.every((d) => d.st === DARVANT.dead), true, 'the beam Darvants die when the scene leaves TYPE2');
}

{
  // The same beam on the other difficulties makes nothing.
  for (const d of [0, 1, 2]) {
    const fi = fight({ seed: 7, difficulty: d });
    toType2(fi);
    const f2 = fi.c.form2!;
    const beam = () => f2.st === F2.beamL || f2.st === F2.beamR;
    fi.until(beam, 40000, `a beam (difficulty ${d})`);
    const before = fi.c.darvants.length;
    fi.until(() => !beam(), 400, `the beam ends (difficulty ${d})`);
    eq(fi.c.darvants.length, before, `difficulty ${d}: a beam makes no Darvants`);
  }
}

{
  // Ultimate with nobody alive on the floor: the beam makes none (0x00453AB8 checks each player).
  const fi = fight({ seed: 7, difficulty: 3 });
  toType2(fi);
  const f2 = fi.c.form2!;
  const beam = () => f2.st === F2.beamL || f2.st === F2.beamR;
  fi.until(beam, 40000, 'a beam (Ultimate, nobody alive)');
  fi.targets[0].dead = true;
  const before = fi.c.darvants.length;
  fi.until(() => !beam(), 400, 'the beam ends (nobody alive)');
  eq(fi.c.darvants.length, before, 'Ultimate with no living player: no beam Darvants');
}

// --- Dark Falz form 3's scale animation (Voloptform7updatescaleanimation0045b9b8, dump 199138) ---
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  // Climbing states (2 WAITKILL, 3 DEAD): +0.1 a frame, stopped at 1.0, the counter untouched.
  let a = advanceScale(0.25, 77, true);
  check(near(a.scale, 0.35) && a.count === 77, 'form 3 scale: WAITKILL / DEAD climb 0.1 a frame and keep the counter');
  a = advanceScale(0.95, 77, true);
  eq(a.scale, 1, 'form 3 scale: the climb stops at 1.0');
  // Counter schedule: 1.0 until the counter reaches 120.
  a = advanceScale(1, 118, false);
  eq(a.count, 119, 'form 3 scale: the counter steps once a frame');
  a = advanceScale(0.5, 118, false);
  eq(a.scale, 1, 'form 3 scale: 1.0 while the counter is below 120');
  // 120..149: falls by 1/30 a frame, to 0 (then holds at 0).
  a = advanceScale(1, 120, false);
  check(near(a.scale, 1 - 1 / 30) && a.count === 121, 'form 3 scale: falls by 1/30 from 120');
  a = advanceScale(0.01, 140, false);
  eq(a.scale, 0, 'form 3 scale: a fall past 0 stops at 0');
  // 150..269: held at 0.
  a = advanceScale(0, 200, false);
  eq(a.scale, 0, 'form 3 scale: 0 from 150 to 269');
  // 270..299: climbs by 1/30 a frame to 1.
  a = advanceScale(0, 270, false);
  check(near(a.scale, 1 / 30) && a.count === 271, 'form 3 scale: climbs by 1/30 from 270');
  a = advanceScale(0.99, 280, false);
  eq(a.scale, 1, 'form 3 scale: a climb past 1 stops at 1');
  // From 300 the scale is 1 and the counter returns to 0.
  a = advanceScale(0.5, 299, false);
  check(a.scale === 1 && a.count === 0, 'form 3 scale: from 300 the scale is 1 and the counter resets');
}
{
  // Radar and hit of the ring Darvant (PsoBB.exe 0x0045F25C tail: +0x3B0 picks the icon and
  // bit 0 of the box; 0x0045F238 clears +0x3B0 on death). ASSUMED: the timer starts at 0.
  const d = new Darvant(DF_ID.darvant, 100);
  d.kind = 'ring';
  d.st = DARVANT.rise;
  eq(darvantRingIcon(d), 'forced', 'rising: the forced icon (box off)');
  check(!d.targetable, 'rising: box off, cannot be hit');
  d.st = DARVANT.hover;
  darvantBoxStep(d);
  eq(d.boxTimer, DARVANT.boxCycle, 'the first hover tick reloads the timer (-1 -> 0xA8C)');
  eq(darvantRingIcon(d), 'forced', 'and the box stays off');
  for (let k = 0; k < DARVANT.boxCycle - DARVANT.boxOnBelow; k++) darvantBoxStep(d);
  eq(d.boxTimer, DARVANT.boxOnBelow, 'counting down: the timer reaches 0x1C2');
  eq(darvantRingIcon(d), 'forced', 'still off at 0x1C2 (the test is below it)');
  darvantBoxStep(d);
  eq(d.boxTimer, DARVANT.boxOnBelow - 1, 'one tick further (timer 0x1C1)');
  eq(darvantRingIcon(d), 'plain', 'below 0x1C2 the box is on: the plain icon, lockable and hittable');
  check(d.targetable, 'and it can be hit');
  d.st = DARVANT.chase;
  eq(darvantRingIcon(d), 'plain', 'chase keeps the flag (the cycle is the same in state 2)');
  d.st = DARVANT.dead;
  d.boxOn = false;
  eq(darvantRingIcon(d), null, 'dead: no icon');
  check(!d.targetable, 'dead: cannot be hit');
  // The spat and beam boxes (PsoBB.exe): the spat factory 0x00460778 sets bit 0 when it sets the
  // spit state (0x004608D5); the beam's state 0 function 0x00460D34 sets it (0x0046100C) every
  // tick it runs. Nothing clears either, so they are hittable from the first update until dead.
  const spit = new Darvant(DF_ID.darvant, 100);
  spit.kind = 'spit';
  spit.st = DARVANT.spit;
  check(spit.targetable, 'spat: box on from the spit state');
  spit.st = DARVANT.dead;
  check(!spit.targetable, 'spat: dead cannot be hit');
  const beam = new Darvant(DF_ID.darvant, 100);
  beam.kind = 'beam';
  beam.st = DARVANT.rise;
  check(beam.targetable, 'beam: box on in the rise (state 0 sets it)');
  beam.st = DARVANT.hover;
  check(beam.targetable, 'beam: hovering, box on');
  beam.st = DARVANT.dead;
  check(!beam.targetable, 'beam: dead cannot be hit');
  // The creation init (0x0045FBD4): +0x3B4 = 450 * (w % 6 + 1), w = the entity index word
  // (0x1000 + slot): the Darvants start staggered by id.
  eq(darvantBoxStart(0), 450, 'init w 0: 450');
  eq(darvantBoxStart(5), 2700, 'init w 5: 2700');
  eq(darvantBoxStart(6), 450, 'init w 6: 450 (mod 6)');
  eq(darvantBoxStart(0x1000 + 1), 450 * ((0x1001 % 6) + 1), 'a wire id (0x1001): 450 * (0x1001 % 6 + 1)');
  const early = new Darvant(1, 10);
  early.st = DARVANT.hover;
  early.boxTimer = darvantBoxStart(0);
  darvantBoxStep(early);
  check(early.boxOn, 'init 450: the first hover tick is already in the window (449 < 450)');
  const late = new Darvant(2, 10);
  late.st = DARVANT.hover;
  late.boxTimer = darvantBoxStart(5);
  darvantBoxStep(late);
  check(!late.boxOn && late.boxTimer === 2699, 'init 2700: box off until the timer falls below 450');
  const fz = fight({ party: 2 });
  toArena(fz, CASKET.x, CASKET.z);
  fz.until(() => fz.c.scene === SCENE.zako, 400, 'ZAKO');
  eq(fz.c.darvants[0].boxTimer, darvantBoxStart(0x1000 + 1), 'the control creates each Darvant with that init');
  // Form 2: the body's hit box is on only at blend 0 (0x00457BD4: +0x3F0 == 0.0), and its forced icon
  // is drawn every live frame (no state gate).
  const fi = fight();
  const f2 = new DfForm2(fi.c, { hp: 6500, atp: 750, moveFrames: 150, stopState: 10, restaLevel: 4, rafoie: 9, rabarta: 6, tenchu: 550 });
  f2.blend = 0.5;
  check(!f2.targetable, 'form 2 blending out: box off, cannot be hit');
  const body = f2.minimapIcons().find((i) => i.shape === 1 && i.scale === 5 && i.color === 0xffffa24c);
  check(body !== undefined, 'form 2: the forced body icon (scale 5) is listed while it is blending out');
  f2.blend = 0;
  check(f2.targetable, 'form 2 at blend 0: box on, can be hit');
  f2.st = F2.dead;
  check(f2.minimapIcons().some((i) => i.scale === 5), 'form 2: the body icon is not gated by its state (exe update)');
}

// --- 9. the box flags and the spit's constants (PsoBB.exe, this session) ---------------
{
  // Form 1's three boxes start from the template 0x009A5D80 with flags 0x801B: bit 0 on. Nothing
  // clears it, so the entity's own gates (awake, dead, waitKill) decide.
  eq(F1_BOX_COUNT, 3, 'form 1: three boxes (0x007B9A88 count 3)');
  check((F1_BOX_FLAGS & 1) === 1, 'form 1: template flags 0x801B have the hit bit');
  const fi = fight();
  toType1(fi);
  const f1 = fi.c.form1!;
  check(f1.targetable, 'form 1: targetable from its appear (box on from creation)');
  f1.awake = false;
  check(!f1.targetable, 'form 1: the awake gate still applies');
  f1.awake = true;
  // The spit (state 4, 0x00460620): gravity -0.015 a tick from vy 0, top 6 (the limit's float).
  eq(DARVANT.spitGravity, -0.015, 'spit gravity (0xBC75C290 at 0x00A459C8)');
  eq(DARVANT.spitTop, 6, 'spit limit 6.0');
}
// --- 10. the spat's launch, fall, chase and cage; the beam's constructor, flight and bob ----------
// (PsoBB.exe: factories 0x00460778 / 0x00460DE4, the state functions 0x00460620, 0x004601B0,
// 0x0046032C, 0x004604BC, 0x00460B84, 0x00460C10, and the dispatchers 0x0045FF50 / 0x00460938.)
type SpawnApi = {
  newDarvant: (k: 'ring' | 'spit' | 'beam', x: number, y: number, z: number) => Darvant | null;
  cageSpit: (d: Darvant) => void;
  beamConstructor: (d: Darvant) => void;
  bob: (d: Darvant) => void;
};
{
  // The row clamp of 0x0045FBD4: valid in (1/3, 10 x the default], else the default.
  eq(darvantRowSpeed(0.38, DARVANT.fallbackSpeed), 0.38, 'row speed: 0.38 is valid');
  eq(darvantRowSpeed(0, DARVANT.fallbackSpeed), DARVANT.fallbackSpeed, 'row speed: 0 takes the default (0x00A45A14)');
  eq(darvantRowSpeed(1 / 3, DARVANT.fallbackSpeed), DARVANT.fallbackSpeed, 'row speed: 1/3 is not above the floor');
  eq(darvantRowSpeed(11, DARVANT.fallbackSpeedFalz), DARVANT.fallbackSpeedFalz, 'row speed: over 10 x the default takes it');
  check(DARVANT.fallbackSpeedFalz > DARVANT.fallbackSpeed, 'row 57 default is 1.75 x row 53 default (0x00900540)');
}
{
  // The launch (0x00460778): toward the centre from the spawn point, at rand * 0.41666665 + 1.6666666.
  const fi = fight({ seed: 3 });
  toType1(fi);
  const c = fi.c as unknown as SpawnApi & { spawnSpit: (x: number, z: number) => boolean };
  c.spawnSpit(3, 4);
  const d = fi.c.darvants[fi.c.darvants.length - 1];
  eq(d.st, DARVANT.spit, 'a spat starts in state 4 (the fall)');
  check(Math.abs(d.vx + 0.6 * d.scale) < 1e-9 && Math.abs(d.vz + 0.8 * d.scale) < 1e-9, 'the launch points at the centre: unit(-3, -4) times the speed');
  check(d.scale >= 1.6666666 && d.scale < 1.6666666 + 0.41666665, `the speed is rand * 0.41666665 + 1.6666666 (${d.scale.toFixed(4)})`);
  c.spawnSpit(0, 0);
  const e = fi.c.darvants[fi.c.darvants.length - 1];
  check(e.vx > 0 && e.vz === 0, 'a spat at the centre goes (1, 0) (the zero-vector case of 0x00460778)');

  // The fall (0x00460620): vy += -0.015 a tick, pos += vel; the first tick below 6 is state 2.
  const f = c.newDarvant('spit', 10, 25, 0)!;
  f.st = DARVANT.spit;
  f.vx = 0;
  f.vz = 0;
  let y = 25;
  let vy = 0;
  let n = 0;
  while (y >= DARVANT.spitTop) {
    vy += DARVANT.spitGravity;
    y += vy;
    n++;
  }
  let steps = 0;
  while (f.st === DARVANT.spit && steps < 400) {
    fi.step(1);
    steps++;
  }
  eq(steps, n, 'the fall lasts as many ticks as the gravity sum takes to get under 6');
  check(Math.abs(f.y - DARVANT.spitTop) <= DARVANT.bobAmp + 1e-9, 'the transition puts it on 6 (the bob of that tick adds at most 0.1)');
  eq(f.st, DARVANT.chase, 'then state 2 (the chase)');
}
{
  // The cage (0x004604BC): inside 100 about form 1 (xz), it is put on the circle, toward its side.
  const fi = fight({ seed: 3 });
  toType1(fi);
  const c = fi.c as unknown as SpawnApi;
  const f1 = fi.c.form1!;
  const d = c.newDarvant('spit', f1.x + 10, 5, f1.z)!;
  c.cageSpit(d);
  check(Math.abs(d.x - (f1.x + 100)) < 1e-9 && Math.abs(d.z - f1.z) < 1e-9, 'cage: a spat 10 out is put 100 out on its side');
  const e = c.newDarvant('spit', f1.x, 5, f1.z)!;
  c.cageSpit(e);
  check(Math.abs(e.x - (f1.x + 100)) < 1e-9 && e.z === f1.z, 'cage: at the centre of form 1 it goes to (+100, 0)');
  const o = c.newDarvant('spit', f1.x, 5, f1.z + 150)!;
  c.cageSpit(o);
  eq(o.z, f1.z + 150, 'cage: outside 100 it is not moved');
}
{
  // The beam's constructor (0x00460DE4): toward the nearest player (+-4 by w & 3), else toward the centre.
  const fi = fight({ seed: 3, targets: [player(0, 50, 0)] });
  fi.step(1);
  const c = fi.c as unknown as SpawnApi;
  const b = c.newDarvant('beam', 0, 0, 0)!;
  c.beamConstructor(b);
  eq(b.y, DARVANT.beamFloor, 'a beam is put at y -13 (0x00460DE4)');
  eq(b.timer, DARVANT.beamTimer, 'with the timer 150');
  eq(b.st, DARVANT.rise, 'in state 0 (rise)');
  const k = (0x1000 + b.entity) & 3;
  const side = k & 1 ? 4 : -4;
  const sideZ = k & 2 ? 4 : -4;
  const len = Math.hypot(50 + side, sideZ);
  check(Math.abs(b.vx - ((50 + side) / len) * b.cap) < 1e-9 && Math.abs(b.vz - (sideZ / len) * b.cap) < 1e-9, 'the velocity is unit(player + offset - beam) times the cap');
  check(Math.abs(Math.hypot(b.vx, b.vz) - b.cap) < 1e-9 && b.vy === 0, 'speed is the cap and vy is 0');
  eq(b.cap, darvantRowSpeed(fi.c.rows.darvantFalz.f1, DARVANT.fallbackSpeedFalz), 'the cap is the row 57 clamp');

  const fz = fight({ seed: 3, targets: [] });
  fz.step(1);
  const cz = fz.c as unknown as SpawnApi;
  const bz = cz.newDarvant('beam', 30, 0, 40)!;
  cz.beamConstructor(bz);
  const hz = Math.hypot(bz.vx, bz.vz);
  check(Math.abs(bz.vx / hz + 0.6) < 1e-9 && Math.abs(bz.vz / hz + 0.8) < 1e-9, 'with no player the beam goes toward the centre: unit(-30, -40)');
}
{
  // The beam's flight (0x00460C10): dies below timer 0 or beyond 260 (xz).
  const fi = fight({ seed: 3 });
  toType2(fi);
  const c = fi.c as unknown as SpawnApi;
  const far = c.newDarvant('beam', 259.5, 6, 0)!;
  far.st = DARVANT.chase;
  far.vx = 1;
  far.timer = 150;
  fi.step(1);
  eq(far.st, DARVANT.dead, 'a beam past 260 dies (|xz| 260.5)');
  const short = c.newDarvant('beam', 0, 6, 0)!;
  short.st = DARVANT.chase;
  short.timer = 0;
  fi.step(1);
  eq(short.st, DARVANT.dead, 'the timer below 0 kills the beam (timer -1)');
  const live = c.newDarvant('beam', 0, 6, 0)!;
  live.st = DARVANT.chase;
  live.timer = 5;
  fi.step(1);
  eq(live.st, DARVANT.chase, 'a beam in reach with time left keeps flying');
  eq(live.timer, 4, 'the timer counts down a tick');
}
{
  // The bob of state 2 (the dispatchers): y += 0.1 sin(phase), then phase += step.
  const fi = fight({ seed: 3 });
  toType2(fi);
  const c = fi.c as unknown as SpawnApi;
  const d = c.newDarvant('beam', 0, 0, 0)!;
  const step0 = d.bobStep;
  check(step0 >= DARVANT.bobStepBase && step0 < DARVANT.bobStepBase + DARVANT.bobStepRand, 'the step is in 1092 .. 3276 (rand * 2184 + 1092)');
  d.y = 0;
  d.bobAngle = 16384;
  d.bobStep = 1000;
  c.bob(d);
  check(Math.abs(d.y - 0.1) < 1e-9, 'bob: a quarter turn adds 0.1');
  eq(d.bobAngle, 17384, 'and the phase moves by the step');
}
{
  // The aura's cadence (both dispatchers): the mask is the power of two at or above trunc(8 / speed), minus 1.
  // Speed 1.0208 gives trunc(7.84) = 7, so the mask is 7: a hit on every 8th tick (clock 0, 8, ...).
  const fi = fight({ seed: 3, targets: [player(0, 0, 3)] });
  toType2(fi);
  fi.targets[0].x = 0;
  fi.targets[0].z = 3;
  const c = fi.c as unknown as SpawnApi;
  const d = c.newDarvant('beam', 0, 6, 0)!;
  d.st = DARVANT.chase;
  d.timer = DARVANT.beamTimer;
  d.vx = 0;
  d.vz = 0;
  d.scale = 1.0208;
  d.cap = 1.0208;
  d.bobStep = 0;
  const before = fi.log.length;
  for (let k = 0; k < 16; k++) fi.step(1);
  let hits = 0;
  for (const ev of fi.log.slice(before)) if (ev.kind === 'hit' && ev.what === 'Darvant') hits++;
  eq(hits, 2, 'two aura hits in 16 ticks at speed 1.0208 (every 8)');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('darkfalz tests passed');
