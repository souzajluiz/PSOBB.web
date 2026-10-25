// 6x10 / 6x11 (client/src/combat/enemystate.ts): the packet layout and what a
// received packet does to the Dragon and Gol Dragon brains. The exe's handlers
// (ApplyEnemyTargetAndState_00423a78 / ..._ConditionalState_00423ac8) set the
// target, the cursor, then the state: 6x10 always, 6x11 only when the state
// changes; neither touches x / z or runs phase 7 (that is the 6x12's).
//
// Run: node tests/enemystate.test.ts
import {
  decodeEnemyTargetState,
  enemyTargetStateSets,
  ENEMY_TARGET_STATE,
} from '../client/src/combat/enemystate.ts';
import { DragonAi, DRAGON_STATE, type DragonOptions } from '../client/src/combat/dragon.ts';
import { GoldDragonAi, GOL_STATE, type GolOptions } from '../client/src/combat/goldragon.ts';
import type { EnemyMovementData } from '../client/src/formats/battleparams.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};

// The body as newserv's G_DragonBossActions_6x10_6x11 lays it out (0x0C bytes, little endian):
// [0] sub, [1] size in dwords (3), [2..3] entity, [4..5] phase, [6..7] cursor, [8..11] target.
function body(sub: number, entity: number, phase: number, cursor: number, target: number): Uint8Array {
  const b = new Uint8Array(0x0c);
  const dv = new DataView(b.buffer);
  b[0] = sub;
  b[1] = 3;
  dv.setUint16(2, entity, true);
  dv.setUint16(4, phase, true);
  dv.setUint16(6, cursor, true);
  dv.setUint32(8, target, true);
  return b;
}

// --- layout ----------------------------------------------------------------

{
  const b = body(0x10, 0x1000 | 0x25, 0x1c, 0x32, 2);
  check(b.length === 0x0c, 'a 6x10 body is 0x0C bytes (newserv G_DragonBossActions_6x10_6x11)');
  check(b[0] === 0x10 && b[1] === 0x03, 'the header is 10 03 (subcommand, size in dwords)');
  const m = decodeEnemyTargetState(b);
  check(m !== null, '6x10 decodes');
  check(m?.sub === 0x10 && m?.entity === 0x1025, 'the entity is the u16 at +2 (0x1000 | index)');
  check(m?.phase === 0x1c, 'the phase (state) is the u16 at +4');
  check(m?.cursor === 0x32, 'the cursor is the u16 at +6');
  check(m?.target === 2, 'the target is the client id at +8');
}
{
  const m = decodeEnemyTargetState(body(0x11, 0x1001, 3, 0, 0xffff));
  check(m?.sub === 0x11, '6x11 decodes with its own subcommand');
  check(m?.target === null, 'target 0xFFFF means no target (the exe reads the low 16 bits)');
}
{
  // A negative cursor or state reads as the exe's signed short ((int)*(short*)).
  const m = decodeEnemyTargetState(body(0x10, 0x1001, 0xffff, 0xfffe, 0));
  check(m?.phase === -1 && m?.cursor === -2, 'phase and cursor are signed shorts, as the exe reads them');
}
check(decodeEnemyTargetState(body(0x12, 0x1001, 2, 0, 0)) === null, 'a 6x12 is not a 6x10 / 6x11');
check(decodeEnemyTargetState(new Uint8Array(0x0b).fill(0x10)) === null, 'a body shorter than 0x0C is refused');
check(ENEMY_TARGET_STATE.unconditional === 0x10 && ENEMY_TARGET_STATE.conditional === 0x11, 'the subcommand constants');

// --- the decision (6x11 sets the state only on a change) ----------------------

check(enemyTargetStateSets(0x10, 5, 5) === true, '6x10 sets the state even when it is the current one');
check(enemyTargetStateSets(0x10, 5, 6) === true, '6x10 sets a different state');
check(enemyTargetStateSets(0x11, 5, 5) === false, '6x11 leaves the state alone when it is the current one');
check(enemyTargetStateSets(0x11, 5, 6) === true, '6x11 sets a different state');

// --- the receive side on the Dragon ----------------------------------------

const ROW: EnemyMovementData = { fparam1: 150, fparam2: 130, fparam3: 200, fparam4: 80, fparam5: 0, fparam6: 0, iparam: [0, 5, 15, 0, 0, 0] };
let seed = 7;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const frames = () => 30;
const dragonBrain = (over: Partial<DragonOptions> = {}, leader = false) =>
  new DragonAi({ x: 0, z: 0, angle: 0, ultimate: false, movement: ROW, hp: 2500, leader: () => leader, frames, playerHp: () => 500, rng, ...over });

// Wraps setState to see whether the brain changes state (the exe's SetEnemyAiState call).
function spyState<T extends { setState(n: number): void }>(ai: T): number[] {
  const calls: number[] = [];
  const orig = ai.setState.bind(ai);
  ai.setState = (n: number) => {
    calls.push(n);
    orig(n);
  };
  return calls;
}

{
  const ai = dragonBrain();
  const calls = spyState(ai);
  const cur = (ai as unknown as { sid: number }).sid;
  ai.applyTargetState(DRAGON_STATE.walk, 0x21, 3, 0x10);
  check(calls.length === 1 && calls[0] === DRAGON_STATE.walk, '6x10 sets the Dragon state to the packet phase');
  check((ai as unknown as { cursor: number }).cursor === 0x21, '6x10 sets the cursor (+0x684)');
  check((ai as unknown as { targetId: number | null }).targetId === 3, '6x10 sets the target');
  check(cur !== DRAGON_STATE.walk, 'the test starts from another state');
}
{
  // 6x10 re-applies the same state (the exe's SetEnemyAiState is unconditional); 6x11 does not.
  const ai = dragonBrain();
  ai.applyTargetState(DRAGON_STATE.walk, 0x10, null, 0x11);
  const calls = spyState(ai);
  ai.applyTargetState(DRAGON_STATE.walk, 0x11, 4, 0x11);
  check(calls.length === 0, '6x11 with the current state does not call setState');
  check((ai as unknown as { cursor: number }).cursor === 0x11, '6x11 with the current state still sets the cursor');
  ai.applyTargetState(DRAGON_STATE.walk, 0x12, 4, 0x10);
  check(calls.length === 1, '6x10 with the current state calls setState (unconditional)');
}
{
  // The 6x10 / 6x11 leave x / z to the 6x12: the brain's own position is untouched, and phase 7 is not run.
  const ai = dragonBrain();
  const before = { x: (ai as unknown as { ix: number }).ix, z: (ai as unknown as { iz: number }).iz };
  ai.applyTargetState(DRAGON_STATE.fire, 0x20, 1, 0x10);
  const after = { x: (ai as unknown as { ix: number }).ix, z: (ai as unknown as { iz: number }).iz };
  check(before.x === after.x && before.z === after.z, '6x10 leaves the x / z of the 6x12 alone');
}
{
  // A follower (not the leader) applies it too: the exe's handler has no leader gate.
  const ai = dragonBrain({}, false);
  ai.applyTargetState(DRAGON_STATE.tail, 0x05, 9, 0x10);
  check((ai as unknown as { sid: number }).sid === DRAGON_STATE.tail, 'a follower applies a 6x10');
}

// --- the receive side on the Gol Dragon ------------------------------------

const GOL_REAL = 30;
const golBrain = (over: Partial<GolOptions> = {}) =>
  new GoldDragonAi({ x: 0, z: 0, angle: 0, ultimate: false, movement: null, hp: 10000, leader: () => false, frames: () => GOL_REAL, playerHp: () => 300, rng, singleton: false, ...over });
{
  const ai = golBrain();
  const calls = spyState(ai);
  ai.applyTargetState(GOL_STATE.entrance, 0x33, 2, 0x10);
  check(calls.length === 1 && calls[0] === GOL_STATE.entrance, 'a Gol 6x10 sets the state');
  check((ai as unknown as { cursor: number }).cursor === 0x33, 'a Gol 6x10 sets the cursor');
  check((ai as unknown as { targetId: number | null }).targetId === 2, 'a Gol 6x10 sets the target');
}
{
  const ai = golBrain();
  const calls = spyState(ai);
  ai.applyTargetState(GOL_STATE.wait, 0x00, null, 0x11);
  check((ai as unknown as { sid: number }).sid === GOL_STATE.wait && calls.length === 0, 'a Gol 6x11 with the current state does not re-enter it');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('enemystate: ok');
