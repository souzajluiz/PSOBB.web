// Mechgun bursts (client/src/combat/attack.ts, PsoBB.exe handle_player_attack_animation_damaging_part
// 0x00699058, class 8 branch): the motion loops, each crossing of the hit frame (2) is one
// burst, the count is the weapon's attacks_per_step (item +0x1f4; 1 for a regular Mechgun, 3 for
// the proven items), the window opens after the last burst, and a combo chains through all three swings.
// Run: node tests/mechgun.test.ts
import { AttackState, burstCount, hitFrame, MECHGUN_CLASS } from '../client/src/combat/attack.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// Drives one swing: the motion frame advances `speed` per tick and wraps at `loop` (mode 1).
// Returns the tick of each burst, the tick the swing ended (or -1) and the chained attack.
function swing(state: AttackState, step: number, bursts: number, speed: number, loop: number, opts: { pressAt?: number } = {}) {
  let tick = 0;
  const hits: number[] = [];
  let ended = -1;
  state.setEvents({
    start: () => {},
    hit: () => hits.push(tick),
    end: () => {
      ended = tick;
    },
  });
  state.begin(step, 0, bursts);
  let frame = 0;
  let next: { step: number; type: number } | null = null;
  for (tick = 1; tick <= 400 && state.active; tick++) {
    frame += speed;
    if (frame >= loop) frame -= loop;
    if (opts.pressAt !== undefined && tick === opts.pressAt) state.press(0);
    const r = state.tick(frame, false);
    if (r.next) next = r.next;
    if (r.next || r.idle) break;
  }
  return { bursts: hits, ended, next };
}

// The count is the item's attacks_per_step (see burstCount for the exe writers).
// Regular Mechgun (kind 0x08) and the other unlisted kinds: 1.
check(burstCount(0x08, 0) === 1 && burstCount(0x77, 0) === 1 && burstCount(0x84, 3) === 1, 'a regular Mechgun (kind 8, 0x77, 0x84) is one burst');
// Samba Maracas (kind 0x48), Psychogun (kind 0x83), Mille Marteaux (kind 0xb0): 3.
check(burstCount(0x48, 0) === 3 && burstCount(0x83, 0) === 3 && burstCount(0x83, 16) === 3, 'Samba Maracas and Psychogun are three bursts');
check(burstCount(0xb0, 0) === 3, 'Mille Marteaux is three bursts (run-time write, ASSUMED ordering)');
// Guld Milla (variant 0) and Dual Bird (variant 1) are three bursts when group_idx < 2.
check(burstCount(0x4b, 0) === 3 && burstCount(0x4b, 1) === 3 && burstCount(0x4b, 2) === 1, 'Guld Milla / Dual Bird: 3 when group_idx < 2, else 1');
check(MECHGUN_CLASS === 8 && hitFrame(MECHGUN_CLASS, 0, 0) === 2 && hitFrame(MECHGUN_CLASS, 2, 0) === 2, 'mechgun hit frame 2 (0x00968d00..08)');
check(hitFrame(MECHGUN_CLASS, 0, 1) === 0, 'the table holds one hit frame per step (later bursts come from the loop)');

// A 10-frame loop at speed 1: the frame passes 2 at ticks 2, 12, 22 (wrap at 10).
{
  const s = new AttackState(0, MECHGUN_CLASS, { start: () => {}, hit: () => {}, end: () => {} });
  const r = swing(s, 0, burstCount(0x48, 0), 1, 10);
  check(r.bursts.join(',') === '2,12,22', `three bursts, loop 10: bursts at ${r.bursts.join(',')}`);
  check(r.ended > 22 && r.ended <= 22 + 32 + 1, `the swing ends after the window timer (ended at ${r.ended})`);
  check(r.next === null, 'no chain without a press');
}

// A regular Mechgun: one burst per swing, at the first crossing of the hit frame.
{
  const s = new AttackState(0, MECHGUN_CLASS, { start: () => {}, hit: () => {}, end: () => {} });
  const r = swing(s, 0, burstCount(0x08, 0), 1, 10);
  check(r.bursts.length === 1 && r.bursts[0] === 2, `regular Mechgun: one burst at tick 2 (${r.bursts.join(',')})`);
}

// A real loop length: 24 frames at speed 0.9 spaces the bursts 24 / 0.9 ticks apart.
{
  const s = new AttackState(0, MECHGUN_CLASS, { start: () => {}, hit: () => {}, end: () => {} });
  const r = swing(s, 0, 3, 0.9, 24);
  check(r.bursts.length === 3, `three bursts (got ${r.bursts.length})`);
  const gaps = r.bursts.slice(1).map((t, i) => t - r.bursts[i]);
  check(gaps.every((g) => g === 26 || g === 27), `the bursts are 24 / 0.9 ticks apart (gaps ${gaps.join(',')})`);
  check(r.ended > r.bursts[2], 'the swing ends after the last burst');
}

// A regular Mechgun chains through all three swings (the live report: the 3rd swing hit nothing).
{
  const s = new AttackState(0, MECHGUN_CLASS, { start: () => {}, hit: () => {}, end: () => {} });
  const first = swing(s, 0, burstCount(0x08, 0), 0.9, 24, { pressAt: 6 });
  check(first.bursts.length === 1, `regular Mechgun swing 1 fires once (${first.bursts.length})`);
  check(first.next?.step === 1, `a press in the window queues step 1 (${JSON.stringify(first.next)})`);
  const second = swing(s, 1, burstCount(0x08, 0), 1.0, 24, { pressAt: 6 });
  check(second.bursts.length === 1, `the second swing fires once (${second.bursts.length})`);
  check(second.next?.step === 2, `the second swing queues step 2 (${JSON.stringify(second.next)})`);
  const third = swing(s, 2, burstCount(0x08, 0), 1.1, 24);
  check(third.bursts.length === 1, `the third swing fires (${third.bursts.length} bursts)`);
  check(third.next === null && third.ended > 0, 'the third swing ends the combo');
}

// A press before the last burst loses the combo (the window opens only after the last burst).
{
  const s = new AttackState(0, MECHGUN_CLASS, { start: () => {}, hit: () => {}, end: () => {} });
  const r = swing(s, 0, 3, 1, 10, { pressAt: 5 });
  check(r.next === null, 'a press during the bursts is lost');
}

// The motion stops after the last burst (+0xb0 |= 0x40).
{
  const s = new AttackState(0, MECHGUN_CLASS, { start: () => {}, hit: () => {}, end: () => {} });
  s.setEvents({ start: () => {}, hit: () => {}, end: () => {} });
  s.begin(0, 0, 1);
  let frame = 0;
  for (let t = 1; t <= 2; t++) {
    frame += 1;
    s.tick(frame, false);
  }
  check(s.paused, 'the motion pauses after the last burst');
}

console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
