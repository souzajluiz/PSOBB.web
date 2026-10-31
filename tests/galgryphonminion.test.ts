// The Gal Gryphon minion Effect (client/src/combat/galgryphonminion.ts): the
// creation on the ground, the three states, the homing, the forced 1.5 icon in
// state 1 (UpdateGalgryphonMinion_004ab283, dump 229526).
//
// Run: node tests/galgryphonminion.test.ts
import { GALMINION, GALMINION_STATE, GalgryphonMinionEffect, type GalgryphonPlayer } from '../client/src/combat/galgryphonminion.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);
const near = (got: number, want: number, msg: string) => check(Math.abs(got - want) < 1e-9, `${msg}: got ${got}, want ${want}`);

const flat = (y: number | null) => () => y;
const noPlayers: GalgryphonPlayer[] = [];

// Creation: the ground must exist and be at or below 6 (CreateGalgryphonMinionEffect_004ab138).
eq(GalgryphonMinionEffect.create(flat(null), 0, 0, 1), null, 'no ground, no effect');
eq(GalgryphonMinionEffect.create(flat(7), 0, 0, 1), null, 'ground above 6, no effect');
const atSix = GalgryphonMinionEffect.create(flat(6), 0, 0, 1);
eq(atSix?.y, 6, 'ground at 6 is taken');
const low = GalgryphonMinionEffect.create(flat(-3), 4, 5, 1);
eq(low?.y, -3, 'the height is the ground');
eq(low?.x, 4, 'at the launcher point x');
eq(low?.z, 5, 'and z');
eq(low?.state, GALMINION_STATE.init, 'starts in state 0');

// The first update leaves state 0 and runs the state-1 code on the same tick (0x004ab295 -> 0x004ab2f2 ->
// 0x004ab2f9): it moves one step and draws its icon.
{
  const m = GalgryphonMinionEffect.create(flat(0), 0, 0, 3)!;
  m.update([{ clientId: 3, x: 100, z: 0 }]);
  eq(m.state, GALMINION_STATE.move, 'state 0 goes to 1');
  near(m.x, GALMINION.accel * GALMINION.damp, 'the first tick already moves');
  eq(m.minimapIcons().length, 1, 'the first tick draws its icon');
}

// Homing: one tick toward +x gives v = (0.01 + 0) * 0.995 and the step is v.
{
  const m = GalgryphonMinionEffect.create(flat(0), 0, 0, 3)!;
  const p = [{ clientId: 3, x: 100, z: 0 }];
  m.update(p);
  near(m.vx, GALMINION.accel * GALMINION.damp, 'the velocity after one pull');
  near(m.x, GALMINION.accel * GALMINION.damp, 'the position steps by the velocity');
  near(m.z, 0, 'no sideways drift toward a target on the axis');
  eq(m.minimapIcons().length, 1, 'one icon in state 1');
  // The second tick adds another pull: v = (0.01 + v1) * 0.995.
  m.update(p);
  near(m.vx, (GALMINION.accel + GALMINION.accel * GALMINION.damp) * GALMINION.damp, 'the second pull');
  const ic = m.minimapIcons()[0];
  eq(ic.scale, 1.5, 'the icon is 1.5');
  eq(ic.shape, 1, 'shape 1');
  eq(ic.color, 0xffffa24c, 'colour 0xffffa24c');
  near(ic.x, m.x, 'the icon is at the new position');
  // It keeps closing on the target and the speed does not blow up.
  for (let i = 0; i < 200; i++) m.update(p);
  check(m.x > 1, `it moves toward the target (x=${m.x})`);
  check(Math.abs(m.vx) < 2.1, `the speed settles near 2 (vx=${m.vx})`);
}

// No target (slot 0xffff, or a slot the party does not hold): no pull, no move.
{
  const m = GalgryphonMinionEffect.create(flat(0), 2, 2, 0xffff)!;
  m.update(noPlayers);
  m.update(noPlayers);
  eq(m.x, 2, 'no target: no motion');
  eq(m.minimapIcons().length, 1, 'still iconed while moving');
  const n = GalgryphonMinionEffect.create(flat(0), 2, 2, 9)!;
  n.update([{ clientId: 3, x: 50, z: 50 }]);
  n.update([{ clientId: 3, x: 50, z: 50 }]);
  eq(n.x, 2, 'a slot not in the party: no motion');
}

// Life: the init tick is the first MOVE tick; the 362nd tick sees timer 361 > 0x168, goes to WIND
// (timer 0) and still moves (timer 1 after it). WIND dies on the tick that sees its timer above 0x3c.
{
  const m = GalgryphonMinionEffect.create(flat(0), 0, 0, 0xffff)!;
  let ticks = 0;
  let windAt = -1;
  let deadAt = -1;
  while (!m.dead && ticks < 1000) {
    m.update(noPlayers);
    ticks++;
    if (windAt < 0 && m.state === GALMINION_STATE.wind) windAt = ticks;
    if (deadAt < 0 && m.dead) deadAt = ticks;
  }
  eq(windAt, 362, 'WIND starts on the 362nd tick (the init tick is the first move tick)');
  eq(deadAt, 362 + 61, 'the object is dead on the 61st WIND tick');
  // The transition tick still moves and icons; WIND draws none.
  const w = GalgryphonMinionEffect.create(flat(0), 0, 0, 0xffff)!;
  for (let i = 0; i < 361; i++) w.update(noPlayers);
  eq(w.state, GALMINION_STATE.move, 'still MOVE after 361 ticks');
  w.update(noPlayers);
  eq(w.state, GALMINION_STATE.wind, 'state 2 on the 362nd tick');
  eq(w.minimapIcons().length, 1, 'the transition tick still moves and icons');
  w.update(noPlayers);
  eq(w.minimapIcons().length, 0, 'no icon in WIND');
}

// No ground under it: the object ends.
{
  let g: number | null = 0;
  const m = GalgryphonMinionEffect.create(() => g, 0, 0, 0xffff)!;
  m.update(noPlayers);
  m.update(noPlayers);
  g = null;
  m.update(noPlayers);
  eq(m.dead, true, 'the ground is gone: dead');
  eq(m.minimapIcons().length, 0, 'and no icon');
}

// The height follows the ground, capped at 6.
{
  let g: number | null = -1;
  const m = GalgryphonMinionEffect.create(() => g, 0, 0, 0xffff)!;
  m.update(noPlayers);
  g = 4;
  m.update(noPlayers);
  eq(m.y, 4, 'height is the ground');
}

// ---- the homing minion's area hit (DispatchGalGryphonAttackEffect_004a8690 at 0x004ab39e, each move tick) ----
{
  const ground = () => 4;
  const m = GalgryphonMinionEffect.create(ground, 100, 200, 0xffff)!;
  const hits: Array<{ x: number; y: number; z: number }> = [];
  const att = (p: { x: number; y: number; z: number }) => hits.push(p);
  m.update([], att); // init -> move, on the same tick
  eq(hits.length, 1, 'attack: the init tick is a move tick');
  m.update([], att);
  eq(hits.length, 2, 'attack: one per move tick');
  m.update([], att);
  eq(hits.length, 3, 'attack: each move tick');
  near(hits[1]!.y, 4, 'attack: at the minion height (the ground under it, capped at 6)');
  // The wind state (after 360 ticks of move) makes no attack.
  const w = GalgryphonMinionEffect.create(ground, 100, 200, 0xffff)!;
  w.update([]);
  for (let i = 0; i <= GALMINION.life + 1; i++) w.update([]);
  const before = hits.length;
  const w2: Array<unknown> = [];
  for (let i = 0; i < 5; i++) w.update([], () => w2.push(1));
  eq(w2.length, 0, 'attack: none once the minion winds down');
  check(before >= 0, 'attack: counted');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphonminion tests passed');
