// Olga Flow's form 1 brain (client/src/combat/olgaflowai.ts): the 6xA4 wire format, the state table
// (exe 0x009a70a4), the hub and the attack choice of the leader, the follower's applyRemote, the
// sword chains decoded from the dump (Olga1HandleSwordWaveAttack 0x00498634, SwordWaveMoveAttack
// 0x00498674, SwordStabAttack 0x004986c8), the no-hang rule (every state ends in a bounded timer), the
// HP and the brain-owned death (the death hold 0x1c6, killed once), and the remote damage path.
//
// Run: node tests/olgaflowai.test.ts
import {
  OLGA1,
  OLGA1_MOTION_ROWS,
  OLGA1_ROWS,
  OLGA_A4_SIZE,
  OLGA_TIMER,
  OlgaFlowAi,
  decodeOlgaA4,
  encodeOlgaA4,
  type OlgaEvent,
} from '../client/src/combat/olgaflowai.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);

// A deterministic generator (a 32-bit LCG) so the attack choice is the same on every run.
const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const make = (over: Partial<ConstructorParameters<typeof OlgaFlowAi>[0]> = {}) =>
  new OlgaFlowAi({
    entityId: 0x10ca,
    x: 0,
    z: 0,
    heading: 0,
    height: 0,
    hp: 10000,
    maxHp: 10000,
    leader: () => true,
    frames: () => 30,
    rand: seeded(7),
    ...over,
  });

const sends = (ai: OlgaFlowAi): OlgaEvent[] => ai.drainEvents().filter((ev) => ev.kind === 'send');

// --- wire ---------------------------------------------------------------------

{
  const bytes = encodeOlgaA4({ entity: 0x10ca, state: 0x18, dir: -5, kind: 0x1c, extra: 0xfb, flag440: 1, flag41c: 1, rnd: 200 });
  eq(bytes.length, OLGA_A4_SIZE, 'A4 is 20 bytes');
  eq(bytes[0], 0xa4, 'A4 opcode');
  eq(bytes[1], 5, 'A4 size word');
  eq(bytes[2] | (bytes[3] << 8), 0x10ca, 'A4 entity id (u16 at +2)');
  eq(bytes[4], 0x18, 'A4 state at +4');
  eq(bytes[5], 0xfb, 'A4 dir at +5 (signed -5 as a byte)');
  eq(bytes[8], 1, 'A4 flag 0x440 at +8');
  eq(bytes[9], 1, 'A4 flag 0x41c at +9');
  eq(bytes[10], 200, 'A4 random at +10');
  const back = decodeOlgaA4(bytes);
  eq(back?.state, 0x18, 'A4 decode state');
  eq(back?.entity, 0x10ca, 'A4 decode entity');
  eq(decodeOlgaA4(new Uint8Array([0xa8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null, 'A4 rejects another opcode');
  eq(decodeOlgaA4(new Uint8Array(4)), null, 'A4 rejects a short body');
}

// --- table ----------------------------------------------------------------------

{
  eq(OLGA1_ROWS.length, 40, 'rows 0..39 (exe 0x009a70a4)');
  eq(OLGA1_ROWS[1].leader, 0x00498484, 'hub leader is Olga1UpdateAttack 0x00498484');
  eq(OLGA1_ROWS[1].frame, 0x00498554, 'hub frame is Olga1HandleRandomFloatAttack 0x00498554');
  eq(OLGA1_ROWS[24].leader, 0x004988d4, 'row 24 leader 0x004988d4');
  eq(OLGA1_ROWS[39].motion, -1, 'row 39 (exit 0x27) keeps the motion');
  eq(OLGA1_MOTION_ROWS.length, 16, 'motion pairs 0..15 (exe 0x009a6dc0)');
  eq(OLGA1_MOTION_ROWS[0].body, 45, 'pair 0 body is skywait_bssgc (archive 45)');
  eq(OLGA1_MOTION_ROWS[2].body, 56, 'pair 2 body is waitside_bssgc (archive 56)');
}

// --- the entrance and the hub -----------------------------------------------------

{
  const ai = make();
  eq(ai.stateIndex, OLGA1.entrance, 'starts in the entrance wait (state 0)');
  for (let i = 0; i < OLGA_TIMER.entrance + 2; i++) ai.tick([]);
  eq(ai.stateIndex, OLGA1.hub, 'the entrance ends at the hub after its 0x5a timer');
  check(ai.motion !== null && ai.motion.loop, 'the hub holds a looping motion');
}

// --- the leader's attack choice and the loopback -------------------------------------

{
  const ai = make({ rand: seeded(11) });
  const seen = new Set<number>();
  let applied = 0;
  for (let i = 0; i < 4000; i++) {
    ai.tick([]);
    for (const ev of ai.drainEvents()) {
      if (ev.kind !== 'send') continue;
      const m = decodeOlgaA4(ev.packet);
      check(m !== null, 'a leader send is a 6xA4');
      if (!m) continue;
      seen.add(m.state);
      // The leader applies its own packet first (the loopback is ignored by the render).
      applied++;
    }
    check(ai.stateIndex >= 0 && ai.stateIndex <= 0x28, `state ${ai.stateIndex} in range`);
  }
  check(applied > 0, 'the leader sent attack states');
  check(seen.size > 0, 'the leader sent at least one kind of attack state');
}

// --- a follower only applies --------------------------------------------------------------

{
  const ai = make({ leader: () => false, rand: seeded(3) });
  for (let i = 0; i < 2000; i++) ai.tick([]);
  eq(sends(ai).length, 0, 'a follower sends nothing');
  ai.applyRemote({ entity: 0x10ca, state: 20, dir: 0, kind: 0x12, extra: 10, flag440: 1, flag41c: 0, rnd: 0 });
  eq(ai.stateIndex, 20, 'applyRemote sets the state');
  eq(ai.flag440, 1, 'applyRemote sets the 0x440 flag');
  ai.applyRemote({ entity: 0x10ca, state: 0x29, dir: 0, kind: 0, extra: 0, flag440: 0, flag41c: 0, rnd: 0 });
  eq(ai.stateIndex, 20, 'applyRemote ignores a state past 40');
}

// --- the sword chains (decoded frame fns) ------------------------------------------------

{
  // One-tick timers (frames = 1) make each state's end a fixed two ticks.
  const step = (ai: OlgaFlowAi) => {
    ai.tick([]);
    ai.tick([]);
  };
  const ai = make({ frames: () => 1, leader: () => false });
  ai.applyRemote({ entity: 0x10ca, state: 20, dir: 0, kind: 0, extra: 0, flag440: 0, flag41c: 0, rnd: 0 });
  const chain: number[] = [ai.stateIndex];
  for (let i = 0; i < 5; i++) {
    step(ai);
    chain.push(ai.stateIndex);
  }
  // Olga1HandleSwordStabAttack: 16 goes to 0x24 (36), the others count down.
  eq(chain.join(','), '20,19,18,17,16,36', 'sword stab chain 20 -> 16 -> 0x24');

  const low = make({ frames: () => 1, leader: () => false });
  low.applyRemote({ entity: 0x10ca, state: 11, dir: 0, kind: 0, extra: 0, flag440: 0, flag41c: 0, rnd: 0 });
  step(low);
  eq(low.stateIndex, 0x1c, 'sword stab 11 goes to 0x1c (28)');

  const wave = make({ frames: () => 1, leader: () => false });
  wave.applyRemote({ entity: 0x10ca, state: 7, dir: 0, kind: 0, extra: 0, flag440: 0, flag41c: 0, rnd: 0 });
  const wchain: number[] = [];
  for (let i = 0; i < 8 && wave.stateIndex !== OLGA1.hub; i++) {
    wchain.push(wave.stateIndex);
    step(wave);
  }
  eq(wchain.join(','), '7,6,5', 'sword wave runs 7 -> 6 -> 5');
  eq(wave.stateIndex, OLGA1.hub, 'sword wave 5 returns to the hub');
}

// --- no state hangs ----------------------------------------------------------------------

{
  // The longest run of one state (the exit and the hub alternate, so they are counted together).
  const ai = make({ rand: seeded(99), frames: () => 5000 });
  let run = 0;
  let worst = 0;
  let last = -1;
  for (let i = 0; i < 20000; i++) {
    ai.tick([]);
    const s = ai.stateIndex;
    if (s === last) run++;
    else run = 1;
    last = s;
    if (run > worst) worst = run;
  }
  check(worst <= OLGA_TIMER.cap + 2, `no state holds past the cap (worst ${worst})`);
}

// --- the HP and the brain-owned death -------------------------------------------------------

{
  const ai = make({ hp: 100, maxHp: 100, leader: () => false });
  eq(ai.hit(40), false, 'a hit above 0 HP does not start the death');
  eq(ai.hp, 60, 'the hit takes the HP');
  ai.hit(1000);
  eq(ai.hp, 0, 'the HP clamps at 0');
  eq(ai.dying, true, 'the HP at 0 starts the death hold');
  let killed = 0;
  for (let i = 0; i < OLGA_TIMER.death + 3; i++) {
    ai.tick([]);
    for (const ev of ai.drainEvents()) if (ev.kind === 'killed') killed++;
  }
  eq(killed, 1, 'killed fires once after the death hold');
  eq(ai.dead, true, 'the brain is dead after the hold');
  ai.hit(10);
  ai.tick([]);
  eq(ai.drainEvents().length, 0, 'no events after the kill');
}

// --- remote damage on a follower ------------------------------------------------------------

{
  const ai = make({ hp: 500, maxHp: 500, leader: () => false });
  ai.setHp(500 - 500, 500);
  eq(ai.hit(0), true, 'a remote total of the max starts the death');
  eq(ai.hp, 0, 'the remote damage takes the HP to 0');
}

console.log(failures === 0 ? 'olgaflowai: all checks passed' : `olgaflowai: ${failures} failure(s)`);
if (failures) process.exit(1);
