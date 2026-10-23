// Status effects on the local player (combat/status.ts): poison's damage
// formula and period, paralysis / freeze / shock / slow / confusion slots and
// durations, the android immunity, Anti's levels, Antidote / Antiparalysis, the
// 6x0C / 6x0D watcher, the HUD icons and the Ultimate melee status rolls.
// Run: node tests/status.test.ts
import {
  modifyDirection,
  PlayerMover,
} from '../client/src/render/playermove.ts';
import {
  antiClears,
  CONFUSION_FRAMES,
  FREEZE_FRAMES,
  meleeHitStatus,
  PlayerStatus,
  poisonDamage,
  SHOCK_FRAMES,
  SLOW_FRAMES,
  STATUS,
  type StatusEvents,
  type StatusType,
} from '../client/src/combat/status.ts';
import { statusIcon } from '../client/src/combat/buffs.ts';
import { parseStatusEffect } from '../client/src/net/game.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

function harness(): { s: PlayerStatus; sent: string[]; damage: number[]; pulses: StatusType[] } {
  const sent: string[] = [];
  const damage: number[] = [];
  const pulses: StatusType[] = [];
  const ev: StatusEvents = {
    sendAdd: (t) => sent.push(`0C:${t}`),
    sendRemove: (slot) => sent.push(`0D:${slot}`),
    poisonDamage: (n) => damage.push(n),
    pulse: (t) => pulses.push(t),
    log: () => {},
  };
  return { s: new PlayerStatus(ev), sent, damage, pulses };
}

// --- poison damage: trunc(hp * 0.0066666668), at least 1, + [0, 2, 5, 10] ---
eq([poisonDamage(20, 0), poisonDamage(149, 0), poisonDamage(300, 0), poisonDamage(1500, 0)], [1, 1, 2, 10], 'poison damage (Normal)');
eq([poisonDamage(300, 1), poisonDamage(300, 2), poisonDamage(300, 3)], [4, 7, 12], 'poison difficulty bonus');
eq(poisonDamage(450, 0), 3, 'poison 450 HP: trunc(3.0000001)');

// --- poison: first damage 45 frames after the hit, then every 45, never kills ---
{
  const { s, sent, damage } = harness();
  check(s.inflict(STATUS.poison), 'poison taken');
  s.sync();
  eq(sent, ['0C:15'], '6x0C poison on the next watcher pass');
  let hp = 300;
  let firstAt = -1;
  for (let f = 1; f <= 135; f++) {
    const before = damage.length;
    s.tick(hp, false, 0);
    if (damage.length > before) {
      hp -= damage.at(-1)!;
      if (firstAt < 0) firstAt = f;
    }
  }
  eq(firstAt, 45, 'first poison damage after 45 frames');
  eq(damage, [2, 1, 1], 'three periods in 135 frames');
  eq(hp, 296, 'HP after three periods');
  const low = harness();
  low.s.inflict(STATUS.poison);
  for (let f = 0; f < 45; f++) low.s.tick(1, false, 3);
  eq(low.damage, [0], 'poison does not take the last HP');
  check(s.has(STATUS.poison), 'poison has no end of its own');
}

// --- paralysis: indefinite for a player, re-pulses every 45 frames ---
{
  const { s, pulses, sent } = harness();
  s.inflict(STATUS.paralysis);
  for (let f = 0; f < 1000; f++) s.tick(100, false, 0);
  check(s.has(STATUS.paralysis), 'paralysis does not wear off');
  check(s.immobile, 'paralysis locks the player (ASSUMED)');
  eq(pulses.length, 1 + Math.ceil(1000 / 45), 'paralysis pulses: infliction + every 45 frames');
  eq(sent, ['0C:16'], '6x0C paralysis');
  s.inflict(STATUS.poison);
  s.sync();
  eq(s.types(), [STATUS.poison], 'poison replaces paralysis in slot 0');
  eq(sent.at(-1), '0C:15', '6x0C on a slot change');
}

// --- slot 1: durations and wear-off ---
for (const [type, frames] of [
  [STATUS.slow, SLOW_FRAMES],
  [STATUS.confusion, CONFUSION_FRAMES],
  [STATUS.freeze, FREEZE_FRAMES],
  [STATUS.shock, SHOCK_FRAMES],
] as const) {
  const { s, sent } = harness();
  s.inflict(type);
  let n = 0;
  while (s.has(type) && n < 1000) {
    s.tick(100, false, 0);
    n++;
  }
  eq(n, frames, `slot 1 effect ${type} lasts ${frames} frames`);
  eq(sent, [`0C:${type}`, '0D:1'], `6x0C then 6x0D for ${type}`);
}
eq([SLOW_FRAMES, CONFUSION_FRAMES, FREEZE_FRAMES, SHOCK_FRAMES], [210, 300, 150, 300], 'slot 1 durations');

// --- freeze: EVP -30%, no refreeze while frozen, locks the player ---
{
  const { s } = harness();
  s.inflict(STATUS.freeze);
  eq(s.evp(100), 70, 'frozen EVP');
  check(s.immobile, 'frozen: input state 0x13');
  check(!s.inflict(STATUS.freeze), 'no refreeze while frozen');
  s.inflict(STATUS.shock);
  eq(s.evp(100), 100, 'shock replaces freeze; the player shock multiplier is 0');
  check(!s.immobile, 'shock does not lock');
}

// --- freeze mash: ROUND(frames * -0.1) = -15 a press, 8-tick window, control ---
{
  const { s } = harness();
  s.inflict(STATUS.freeze);
  check(!s.mash(true), 'first press only starts the window');
  eq(s.slot1.counter, FREEZE_FRAMES, 'no frames off on the first press');
  for (let i = 0; i < 3; i++) s.tick(100, false, 0);
  const before = s.slot1.counter;
  check(s.mash(true), 'a press 3 ticks later counts');
  eq(s.slot1.counter, before - 15, 'a counted press takes 15 frames (150 * -0.1)');
  check(!s.mash(false), 'no mash outside the control state (+0x32c != 1)');
  for (let i = 0; i < 8; i++) s.tick(100, false, 0);
  const at = s.slot1.counter;
  check(!s.mash(true), 'a press 8 ticks after the last one does not count');
  eq(s.slot1.counter, at, 'nothing taken');
  s.tick(100, false, 0);
  check(s.mash(true), 'the window restarts from every press');
  for (let i = 0; i < 300 && s.has(STATUS.freeze); i++) {
    s.tick(100, false, 0);
    s.mash(true);
  }
  check(!s.has(STATUS.freeze), 'mashing every tick ends the freeze');
  check(!s.mash(true), 'no mash without a freeze');
}
{
  // Mashing every 2 ticks ends a 150-frame freeze after 10 counted presses (150 / 15),
  // plus the ticks in between: the freeze ends before its natural 150 frames.
  const { s, pulses } = harness();
  s.inflict(STATUS.freeze);
  let ticks = 0;
  let counted = 0;
  for (; s.has(STATUS.freeze) && ticks < 400; ticks++) {
    s.tick(100, false, 0);
    if (ticks % 2 === 1 && s.mash(true)) counted++;
  }
  check(counted > 0 && ticks < FREEZE_FRAMES, `2-tick mashing ends the freeze early (${ticks} ticks, ${counted} presses)`);
  check(pulses.includes(STATUS.freeze), 'the freeze pulse was sent at its start');
}

// --- slow halves the motion step ---
{
  const { s } = harness();
  s.inflict(STATUS.slow);
  eq(s.motionScale, 0.5, 'slow motion scale');
}

// --- androids are immune to poison and paralysis ---
{
  const { s } = harness();
  s.android = true;
  check(!s.inflict(STATUS.poison) && !s.inflict(STATUS.paralysis), 'android immune');
  check(s.inflict(STATUS.freeze), 'android can freeze');
}

// --- Anti by level, Antidote / Antiparalysis ---
eq(antiClears(0), [STATUS.poison], 'Anti Lv1');
eq(antiClears(2), [STATUS.poison, STATUS.shock, STATUS.paralysis], 'Anti Lv3');
eq(antiClears(6), [STATUS.poison, STATUS.shock, STATUS.paralysis, STATUS.confusion, STATUS.slow, STATUS.freeze], 'Anti Lv7');
{
  const { s, sent } = harness();
  s.inflict(STATUS.paralysis);
  s.inflict(STATUS.confusion);
  s.sync();
  eq(s.anti(1), [], 'Anti Lv2 does not cure paralysis or confusion');
  eq(s.anti(2), [STATUS.paralysis], 'Anti Lv3 cures paralysis');
  eq(s.anti(3), [STATUS.confusion], 'Anti Lv4 cures confusion');
  s.sync();
  eq(sent, ['0C:16', '0C:18', '0D:0', '0D:1'], 'Anti: 6x0D for both slots');
  s.inflict(STATUS.poison);
  check(!s.cure(STATUS.paralysis), 'Antiparalysis does not cure poison');
  check(s.cure(STATUS.poison), 'Antidote cures poison');
}

// --- HUD icons (get_monster_status) in slot order ---
{
  const { s } = harness();
  s.inflict(STATUS.poison);
  s.inflict(STATUS.slow);
  eq(s.types().map(statusIcon), [3, 5], 'poison + slow icons');
  eq([STATUS.paralysis, STATUS.freeze, STATUS.shock, STATUS.confusion].map(statusIcon), [4, 2, 1, 0], 'other icons');
}

// --- 6x0C / 6x0D wire ---
{
  const b = new Uint8Array([0x0c, 3, 2, 0, 0x10, 0, 0, 0, 0, 0, 0, 0]);
  eq(parseStatusEffect(b), { clientId: 2, add: true, value: 0x10, amount: 0 }, '6x0C parse');
  b[0] = 0x0d;
  b[4] = 1;
  eq(parseStatusEffect(b)?.add, false, '6x0D parse');
}

// --- Ultimate melee status rolls ---
eq(meleeHitStatus('SAVAGE_WOLF', false, 0), null, 'not outside Ultimate');
eq(meleeHitStatus('SAVAGE_WOLF', true, 0.1), STATUS.slow, 'Gulgus slows (roll <= 0.1)');
eq(meleeHitStatus('BARBAROUS_WOLF', true, 0.05), STATUS.paralysis, 'Gulgus-gue paralyzes');
eq(meleeHitStatus('BARBAROUS_WOLF', true, 0.11), null, 'wolf roll above 0.1');
eq(meleeHitStatus('MOTHMANT', true, 0.049), STATUS.poison, 'Mothvert poisons (roll < 0.05)');
eq(meleeHitStatus('MOTHMANT', true, Math.fround(0.05)), null, 'Mothvert roll at 0.05');

// --- confusion: 300 frames, the steering (modify_direction) on the field ---
{
  const { s } = harness();
  s.inflict(STATUS.confusion);
  eq(s.slot1.counter, CONFUSION_FRAMES, 'confusion lasts 300 frames');
  let ticks = 0;
  for (; s.has(STATUS.confusion) && ticks < 1000; ticks++) s.tick(100, false, 0);
  eq(ticks, CONFUSION_FRAMES, 'confusion wears off after 300 ticks (no mash)');
  // Freeze mash does not shorten confusion: only the freeze's frames take the presses.
  s.inflict(STATUS.confusion);
  check(!s.mash(true), 'mash does nothing while confused');
  eq(s.slot1.counter, CONFUSION_FRAMES, 'confusion unchanged by presses');
}
// modify_direction: unchanged when not confused (no rand call), a random BAMS heading when confused.
{
  let calls = 0;
  const rand = () => (calls++, 1000);
  eq(modifyDirection(0x4000, false, rand), 0x4000, 'not confused: heading kept');
  eq(calls, 0, 'not confused: no rand call');
  eq(modifyDirection(0x4000, true, rand), 2000, 'confused: ROUND(1000 / 32768 * 65536) BAMS');
  eq(modifyDirection(0x4000, true, () => 32767), 0xfffe, 'confused: rand max -> 0xfffe BAMS');
  eq(modifyDirection(0x4000, true, () => 0), 0, 'confused: rand 0 -> heading 0');
}
// PlayerMover: a confused walk heads where the steer says, not the stick.
{
  const move = (dx: number, dz: number) => ({ x: dx, z: dz });
  const seen: number[] = [];
  const steered = new PlayerMover(0, 0);
  steered.tick({ lr: 0, fb: 128, cameraYaw: 0, keyboard: true, steer: (h) => (seen.push(h), 0x2000) }, move);
  eq(seen, [0x8000], 'steer gets the stick heading (forward = -z, 0x8000)');
  const sTarget = steered.legEnd();
  check(sTarget.x > 0 && sTarget.z > 0, `steered leg heads 45 degrees, got ${JSON.stringify(sTarget)}`);
  const plain = new PlayerMover(0, 0);
  plain.tick({ lr: 0, fb: 128, cameraYaw: 0, keyboard: true }, move);
  const pTarget = plain.legEnd();
  check(Math.abs(pTarget.x) < 1e-6 && pTarget.z < 0, `no steer: the leg heads forward, got ${JSON.stringify(pTarget)}`);
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('status: all checks passed');
