// Episode 4 Zu / Pazuzu (combat/enemyfsmep4.ts): the traced arithmetic of the
// movement, the volley, the targeting and the radar bit, the state map, and the
// ZuAi brain driven through its phases.
// Run: node tests/enemyfsmep4.test.ts
import { FireShot } from '../client/src/combat/techfire.ts';
import {
  ZU_CLASS_SPEED,
  ZU_CLASS_STATE,
  ZU_ICON_HIDDEN_BIT,
  ZU_MOTIONS,
  ZU_HITBOX_SCALE,
  ZU_STAT_SCALE,
  ZU_STATES,
  ZU_TECH_TRAVEL,
  ZU_DEFAULT_TUNING,
  ZuAi,
  bamsOf,
  zuApproach,
  zuDistanceClass,
  zuGate,
  zuInRangeAndFacing,
  zuProjectileDifficulty,
  zuRadarIconHidden,
  zuTuning,
  zuVolleyHeadings,
} from '../client/src/combat/enemyfsmep4.ts';
import { TechBolt } from '../client/src/combat/enemyshots.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// Distance class: thresholds 8100 (90^2) and 62500 (250^2) from 0x0092ae08 / 0x0092ae04.
eq(zuDistanceClass(0), 0, 'class at 0');
eq(zuDistanceClass(8099), 0, 'class just under 90^2');
eq(zuDistanceClass(8100), 1, 'class at 90^2');
eq(zuDistanceClass(62499), 1, 'class just under 250^2');
eq(zuDistanceClass(62500), 2, 'class at 250^2');
// The pending state and the speed per class (0x0092ac88 = 9, 12, 0; 0x0092aea4 = 10, 60, 80).
eq(ZU_CLASS_STATE, [9, 12, 0], 'pending state by class');
eq(ZU_CLASS_SPEED, [10, 60, 80], 'speed by class');

// Approach: already at the speed, it has arrived and the value is kept.
eq(zuApproach(80, 80), { arrived: true, f418: 80 }, 'approach at speed');
// Inside the 0.5 band on the low side: arrived.
eq(zuApproach(10.4, 10), { arrived: true, f418: Math.fround(10.4) }, 'approach inside band');
// From 0 toward 10 in 2.2 steps: 2.2, 4.4, 6.6, 8.8, then the 11.0 step overshoots and snaps to 10.
{
  let f = 0;
  const seen: number[] = [];
  let done = false;
  for (let i = 0; i < 10 && !done; i++) {
    const r = zuApproach(f, 10);
    f = r.f418;
    seen.push(Math.round(f * 10) / 10);
    done = r.arrived;
  }
  eq(seen, [2.2, 4.4, 6.6, 8.8, 10], 'approach ramp to 10');
  check(done && f === 10, 'approach ends on the speed');
}
// Downward ramp from 80 to 10: steps of -2.2 while the approach is above the speed.
{
  const r = zuApproach(80, 10);
  check(!r.arrived && Math.abs(r.f418 - 77.8) < 0.01, 'approach steps down from 80');
}

// Difficulty: floor * 10 + level / 20, clamp 29, then / 3 (objdump 0x005b3d90).
eq(zuProjectileDifficulty(0, 0), 0, 'difficulty floor 0 level 0');
eq(zuProjectileDifficulty(1, 0), 3, 'difficulty floor 1 (10 / 3)');
eq(zuProjectileDifficulty(1, 19), 3, 'difficulty level 19 adds nothing');
eq(zuProjectileDifficulty(1, 20), 3, 'difficulty level 20 adds 1 (11 / 3)');
eq(zuProjectileDifficulty(2, 40), 7, 'difficulty floor 2 level 40 (22 / 3)');
eq(zuProjectileDifficulty(10, 600), 9, 'difficulty clamps at 29 (29 / 3)');
eq(zuProjectileDifficulty(3, 0), 9, 'difficulty floor 3 clamps 30 to 29 (29 / 3)');

// Volley headings: +0x1000, 0, -0x1000 (masked), plus +-0x2000 when wide.
eq(zuVolleyHeadings(0x1000, false), [0x2000, 0x1000, 0x0000], 'volley from 0x1000');
eq(zuVolleyHeadings(0xf000, false), [0x0000, 0xf000, 0xe000], 'volley wraps');
eq(zuVolleyHeadings(0x0000, true), [0x1000, 0x0000, 0xf000, 0x2000, 0xe000], 'wide volley order');

// Targeting: the bearing is trunc(atan2(dz, dx) * 65536 / 2pi'); a player straight
// ahead along +z (bearing 0x4000) is faced from heading 0.
const base = { dx: 0, dz: 10, heading: 0, flags: 0, range: 20, arc: 0x1000 };
check(zuInRangeAndFacing(base), 'in range and facing (heading 0 faces +z)');
check(!zuInRangeAndFacing({ ...base, heading: 0x8000 }), 'heading 0x8000 does not face +z');
check(!zuInRangeAndFacing({ ...base, range: 5 }), 'out of range (5 < 10)');
check(!zuInRangeAndFacing({ ...base, flags: 0x800 }), 'flag 0x800 is never targeted');
check(!zuInRangeAndFacing({ ...base, flags: 0x2000000 }), 'flag 0x2000000 is part of the refused mask');
check(zuInRangeAndFacing({ ...base, dx: 10, dz: 0, heading: 0x4000 }), 'player along +x is faced from heading 0x4000');

// Radar bit: 0x40000 of +0x390 hides the icon.
eq(ZU_ICON_HIDDEN_BIT, 0x40000, 'radar bit');
check(zuRadarIconHidden(0x40000), 'bit set hides the icon');
check(zuRadarIconHidden(0x40001), 'bit set with others hides the icon');
check(!zuRadarIconHidden(0), 'no flags shows the icon');
check(!zuRadarIconHidden(0x3ffff), 'other bits do not hide the icon');

// State map: the dispatcher's cases; 1, 2, 6, 8 have no case; 5 is the death (deathfx.ts).
eq(ZU_STATES.map((s) => s.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 'state ids');
eq(ZU_STATES.filter((s) => s.ported).map((s) => s.id), [0, 3, 4, 7, 9, 10, 11, 12, 13, 14], 'ported states');
eq(ZU_STATES.find((s) => s.id === 0)?.address, 0x005b44f8, 'wander handler VA');
eq(ZU_STATES.find((s) => s.id === 9)?.address, 0x005b3dd4, 'projectile handler VA');

// The motion table (PROVEN objdump via exedata motions 009c16a0): slot 0 wait (11, 0.8, loops),
// slot 1 walk (5, 1.4, loops), slot 12 flinch (1, 0.8, chains to 1), slot 3 flinch (2, 0.8, chains to 0).
eq(ZU_MOTIONS[0], { motion: 11, speed: 0.8, mode: 2, next: 0 }, 'slot 0 row');
eq(ZU_MOTIONS[1].motion, 5, 'slot 1 walk motion');
eq(ZU_MOTIONS[12], { motion: 1, speed: 0.8, mode: 2, next: 1 }, 'slot 12 row');
eq(ZU_MOTIONS.length, 14, 'fourteen motion rows');

// The bearing helper (trunc to BAMS, masked): a quarter turn is 0x4000, a half turn 0x8000.
eq(bamsOf(Math.PI / 2), 0x4000, 'bams of a quarter turn');
eq(bamsOf(-Math.PI / 2), 0xc000, 'bams of minus a quarter turn');

// The random gate of states 10 / 12: trunc(2u / 2^32): nonzero from 2^31 up.
eq(zuGate(0), 0, 'gate at 0');
eq(zuGate(0x7fffffff), 0, 'gate just under 2^31');
eq(zuGate(0x80000000), 1, 'gate at 2^31');
eq(zuGate(0xffffffff), 1, 'gate at the top');

// Tunables (zu_constructor, PROVEN): the Zu's MovementData row gives the walk and dash (x the
// 5/27 stat scale), the TechProjectile speed (fparam2) and power (iparam4), and the counters;
// the slide is the 85/54 hitbox scale (no row value); the travel limit is 500.
eq(zuTuning(null), ZU_DEFAULT_TUNING, 'no movement keeps the defaults');
const row = { fparam1: 3, fparam2: 7, fparam3: 5, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [30, 31, 20, 9, 21, 22] };
check(Math.abs(zuTuning(row).walk - 3 * ZU_STAT_SCALE) < 1e-6, 'fparam1 is the walk, times the stat scale');
check(Math.abs(zuTuning(row).dash - 5 * ZU_STAT_SCALE) < 1e-6, 'fparam3 is the dash, times the stat scale');
eq(zuTuning(row).slide, ZU_HITBOX_SCALE, 'the slide is the hitbox scale');
eq(zuTuning(row).techSpeed, 7, 'fparam2 is the TechProjectile speed');
eq(zuTuning(row).techPower, 9, 'iparam4 is the TechProjectile power');
eq([zuTuning(row).fireCharge, zuTuning(row).fireVolley, zuTuning(row).techCharge], [30, 31, 20], 'iparam1..3 are the fireball charge, volley and tech charge');
eq([zuTuning(row).lunge, zuTuning(row).dashWait], [21, 22], 'iparam5 and 6 are the lunge and the dash wait');
eq(zuTuning(row).techRange, ZU_TECH_TRAVEL, 'the bolt travels 500');

// --- The brain (ZuAi): driven through its phases ---------------------------------------

const player = (x: number, z: number, clientId = 1): AiTarget => ({ clientId, x, z, charClass: 0, dead: false });
const zero = () => 0;
const isShot = (s: unknown): s is FireShot => s instanceof FireShot;
const TICKS = 400;

// The start: wander (state 0), motion slot 1 (walk, 5 at 1.4, looping), far class 2.
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero });
  const f = ai.tick([]);
  eq(ai.exeState, 0, 'the Zu starts in wander');
  eq(f.motion, { index: 5, speed: 1.4, loop: true }, 'wander plays the walk row');
  eq(ai.exeClass, 2, 'no target: far class');
  for (let i = 0; i < 20; i++) ai.tick([]);
  eq(ai.exeState, 0, 'no target keeps it wandering');
  check(ai.radarHidden === false, 'the radar icon shows by default');
  check((ai.flags390 & 0x20000) !== 0, 'the ctor sets 0x20000');
}

// A player within 90 (class 0): the class moves it to state 9, the approach.
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero });
  const t = [player(0, 40)];
  let n = 0;
  while (ai.exeState !== 9 && n < 20) {
    ai.tick(t);
    n++;
  }
  eq(ai.state, 'approach', 'a near player brings the approach (state 9)');
  check(n <= 5, `the approach comes within a few ticks (${n})`);
}

// The approach ends in the fireball (10) when the player is in 60 and in the 0x2000 arc,
// and the volley is three foie (level from the projectile difficulty), then a shot of five when wide.
for (const wide of [false, true]) {
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero, wide, floor: 0 });
  const t = [player(0, 40)];
  const volleys: number[] = [];
  let reachedFire = false;
  for (let i = 0; i < TICKS; i++) {
    const f = ai.tick(t);
    if (ai.exeState === 10) reachedFire = true;
    const n = (f.shots ?? []).filter(isShot).length;
    if (n) volleys.push(n);
    if (volleys.length >= 2) break;
  }
  check(reachedFire, `wide=${wide}: the Zu reaches the fireball (10)`);
  eq(volleys[0], wide ? 5 : 3, `wide=${wide}: the first volley is ${wide ? 5 : 3} foie`);
}

// The flinch: a hit requests state 4 (motion 12, the flinch row, once), the animation's
// end leaves it, and the leave requests the dash (11).
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero });
  ai.tick([]);
  ai.tick([]);
  ai.onDamage(1);
  const f = ai.tick([]);
  eq(ai.state, 'flinch', 'a hit makes the flinch');
  eq(f.motion, { index: 1, speed: 0.8, loop: false }, 'the flinch plays row 12 once');
  check((ai.flags390 & 0x10001) === 0x10001, 'the flinch sets the no-transition and flinch bits');
  eq(ai.resume(), 'wander', 'the resume state is the old resume (wander)');
  ai.tick([], false);
  eq(ai.state, 'flinch', 'the flinch holds while the animation runs');
  ai.tick([], true);
  let n = 0;
  while (ai.state === 'flinch' && n < 5) {
    ai.tick([], false);
    n++;
  }
  eq(ai.state, 'dash', 'after the animation the leave requests the dash (11)');
  check(ai.exeState === 11, 'the dash is the state now');
}

// The retreat: with no wall the aim is 150 from the Zu after a leave (the first clear ray).
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero });
  ai.tick([]);
  ai.tick([]);
  ai.onDamage(1);
  ai.tick([]);
  ai.tick([], true);
  // The flinch does not move the Zu, so its position here is the one the leave measures from.
  const at = { x: ai.x, z: ai.z };
  for (let i = 0; i < 4; i++) ai.tick([], false);
  const a = ai.aimPoint;
  const d = Math.hypot(a.x - at.x, a.z - at.z);
  check(Math.abs(d - 150) < 1e-6, `the retreat aim is 150 out from the Zu (${d})`);
}

// With a wall on every ray at 100, the back-off is 100 - 20 = 80 (the aim at least 40 out).
{
  const wall = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: a.x + ((b.x - a.x) / d) * 100, y: a.y, z: a.z + ((b.z - a.z) / d) * 100 };
  };
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero, wall });
  ai.tick([]);
  ai.tick([]);
  ai.onDamage(1);
  ai.tick([]);
  ai.tick([], true);
  const at = { x: ai.x, z: ai.z };
  for (let i = 0; i < 4; i++) ai.tick([], false);
  const a = ai.aimPoint;
  const d = Math.hypot(a.x - at.x, a.z - at.z);
  check(Math.abs(d - 80) < 1e-6, `walled retreat backs off 80 from the Zu (${d})`);
}

// The tech bolt's flight: a map ray on the step ends it with no hit (update 0x0057fcc0), and
// with no ray it strikes a player on its path.
{
  const target = [player(300, 0)];
  const open = new TechBolt({ x: 0, y: 0, z: 0, angle: Math.PI / 2, speed: 4, range: ZU_TECH_TRAVEL, radius: 4, effect: { kind: 'tech', power: 1 }, color: 0 });
  let struck = 0;
  for (let i = 0; i < 100 && !open.done; i++) struck += open.tick(target).length;
  check(struck === 1 && open.done, `a clear bolt strikes the player on its path (${struck})`);
  const walled = new TechBolt({ x: 0, y: 0, z: 0, angle: Math.PI / 2, speed: 4, range: ZU_TECH_TRAVEL, radius: 4, effect: { kind: 'tech', power: 1 }, color: 0, wallBlocks: () => true });
  const hits = walled.tick(target);
  check(hits.length === 0 && walled.done, 'a walled step ends the bolt with no hit');
}

// The blocked aim (GoranSetupProjectileAttack_005b30c8): a blocked ray puts the aim 400 across
// the Zu's direction to the weapon point: the target at (100, 0) gives the side point (0, 400).
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero, wall: () => ({ x: 0, y: 0, z: 0 }) });
  const priv = ai as unknown as { tgt: AiTarget; setupAim: (t: AiTarget[]) => boolean };
  priv.tgt = player(100, 0);
  const clear = priv.setupAim([]);
  check(!clear, 'a blocked ray is not a clear aim');
  const a = ai.aimPoint;
  check(Math.abs(a.x) < 1e-6 && Math.abs(a.z - 400) < 1e-6, `the side aim is (0, 400) (${a.x}, ${a.z})`);
}

// The carry (state 7): the approach value counts 250 down by 2.2 to 80 and the leave requests wander.
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero });
  ai.tick([]);
  (ai as unknown as { pending: number }).pending = 7;
  ai.tick([]);
  eq(ai.state, 'carry', 'a pending 7 starts the carry');
  let frames = 0;
  while (ai.state === 'carry' && frames < 300) {
    ai.tick([]);
    frames++;
  }
  check(frames > 70 && frames < 90, `the carry lasts about 78 frames (${frames})`);
  eq(ai.state, 'wander', 'the carry ends in wander');
}

// The radar bit: the brain shows the flag word and the gate reads bit 0x40000.
eq(ZU_ICON_HIDDEN_BIT, 0x40000, 'radar bit');
check(zuRadarIconHidden(0x40000), 'bit set hides the icon');
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero });
  (ai as unknown as { flags: number }).flags |= 0x40000;
  check(ai.radarHidden, 'the brain with 0x40000 is hidden from the radar');
}

// Death: kill() ends the brain (no motion, state dead).
{
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng: zero });
  ai.tick([]);
  ai.kill();
  const f = ai.tick([]);
  eq(ai.state, 'dead', 'kill ends the brain');
  eq(f.motion, null, 'a dead Zu sends no motion');
}

// Smoke: a long run with a target that moves about (near, middle, far) and random rolls
// never throws, leaves the dispatcher's states, and visits the chase / tech / lunge states.
{
  let seed = 7;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  const ai = new ZuAi({ x: 0, z: 0, angle: 0, rng, wall: null, floor: 3, levelOf: () => 60 });
  const seen = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    const r = 30 + 200 * ((Math.sin(i / 90) + 1) / 2);
    const t = [player(Math.sin(i / 50) * r, Math.cos(i / 50) * r)];
    ai.tick(t, i % 37 === 0);
    if (i % 500 === 250) ai.onDamage(1);
    seen.add(ai.state);
  }
  for (const s of ['wander', 'approach', 'fireball', 'chase']) check(seen.has(s), `the smoke run visits ${s}`);
  check(!seen.has('stop') || seen.has('wander'), 'the smoke run does not idle outside the table');
  check(seen.size >= 5, `the smoke run visits several states (${[...seen].join(', ')})`);
  // The tech bolt and the lunge are reached by the chase's gates (the random rolls and the range).
  check([...seen].some((s) => s === 'tech' || s === 'lunge' || s === 'dash'), 'the smoke run reaches the tech, lunge or dash');
}

if (failures) {
  console.log(`enemyfsmep4: ${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmep4: all checks passed');
