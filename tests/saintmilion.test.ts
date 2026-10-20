// Saint-Milion's 16 tentacle entities (combat/saintmilion.ts): their layout, the
// action and animation tables read from PsoBB.exe, the procedural pose and the
// placement of leads and followers. (The model and motion data checks are in
// tests/enemies.test.ts.)
//
// Run: node tests/saintmilion.test.ts
import {
  SPINNER_ACTIONS,
  SPINNER_ANIMATIONS,
  SPINNER_COUNT,
  SPINNER_FLAG,
  SPINNER_FOLLOWER,
  SPINNER_GROUPS,
  spinnerFarEnough,
  spinnerFirstAction,
  spinnerFollowerSpot,
  spinnerGroup,
  spinnerIsLead,
  spinnerLeadSpot,
  spinnerScale,
  spinnerStepX,
  spinnerSubId,
} from '../client/src/combat/saintmilion.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);

// Layout: 4 groups of 4, the first of each is the lead.
eq([SPINNER_COUNT, SPINNER_GROUPS], [16, 4], '16 entities in 4 groups');
eq([0, 1, 3, 4, 15].map(spinnerGroup), [0, 0, 0, 1, 3], 'group of a slot');
eq([0, 1, 4, 7, 12].map(spinnerIsLead), [true, false, true, false, true], 'leads are slots 0, 4, 8, 12');
eq([0, 1, 2, 3].map(spinnerSubId), [0, 1, 1, 1], 'sub-id 0 for a lead, 1 for a follower');
eq([0, 1].map(spinnerFirstAction), [0, 10], 'a lead starts in action 0, a follower in action 10');

// Action table: 17 rows, every next action and animation exists, both chains start hidden.
eq(SPINNER_ACTIONS.length, 17, '17 actions (0..0x10, the bound of ChangeAction)');
check(SPINNER_ACTIONS.every((a) => a.next >= 0 && a.next < 17), 'every next action exists');
check(SPINNER_ACTIONS.every((a) => a.anim === -1 || (a.anim >= 0 && a.anim < SPINNER_ANIMATIONS.length)), 'every animation id exists');
check(SPINNER_ACTIONS[0].flags & SPINNER_FLAG.hidden && SPINNER_ACTIONS[10].flags & SPINNER_FLAG.hidden, 'the first actions are hidden');
eq(SPINNER_ACTIONS[9].next, 0, 'the lead chain loops 9 -> 0');
eq(SPINNER_ACTIONS[15].next, 10, 'the follower chain loops 15 -> 10');
eq(SPINNER_ACTIONS[2].mask, 0x20, 'action 2 waits on bit 0x20');
check(SPINNER_ANIMATIONS[1].speed < 0 && SPINNER_ANIMATIONS[9].speed < 0, 'animations 1 and 9 run backwards');
check(SPINNER_ANIMATIONS[3].loop && SPINNER_ANIMATIONS[7].loop && !SPINNER_ANIMATIONS[0].loop, 'loop modes of the table');

// Pose: the scale for x in 0..1 and the x step with the clamp.
eq(spinnerScale(0), [1, 1, 1], 'x = 0: unscaled');
const s1 = spinnerScale(1);
near(s1[0], 0.1, 'x = 1: x and z scale 0.1');
near(s1[1], 0.9, 'x = 1: y scale 0.9');
near(spinnerStepX(SPINNER_FLAG.xGrow, 0), 0.1, 'grow +0.1');
near(spinnerStepX(SPINNER_FLAG.xShrink, 0.5), 0.5 - 1 / 180, 'slow shrink -1/180');
near(spinnerStepX(0, 0.5), 0.4, 'shrink -0.1');
eq([spinnerStepX(0, 0.05), spinnerStepX(SPINNER_FLAG.xGrow, 0.95)], [0, 1], 'clamped to 0..1');

// Placement. A lead: angle (slot * 0x1000 + param) & 0xffff, distance 100 + rand16 / 327.68, x < 0 stretched 1.5.
{
  const a = spinnerLeadSpot(0, 0, 0);
  near(a.z, 100, 'lead at angle 0, rand 0: 100 ahead');
  near(a.x, 0, 'lead at angle 0: x 0');
  const b = spinnerLeadSpot(4, 0, 65535);
  eq(b.angle, 0x4000, 'slot 4: angle 0x4000');
  near(Math.hypot(b.x, b.z), 100 + 65535 * 0.0030517578125, 'distance up to 300', 1e-2);
  near(b.x, 300 - 0.0030517578125, 'a quarter turn puts it on +x', 1e-2);
  const c = spinnerLeadSpot(12, 0, 0);
  eq(c.angle, 0xc000, 'slot 12: angle 0xc000');
  near(c.x, -150, 'x < 0 is stretched by 1.5');
  eq(spinnerLeadSpot(15, 0x2000, 0).angle, (15 * 0x1000 + 0x2000) & 0xffff, 'the angle wraps at 16 bits');
}
// Followers: 50 round the center at 120 degree steps.
{
  const c = { x: 10, z: 20 };
  const spots = [1, 2, 3].map((s) => spinnerFollowerSpot(s, c, 0));
  for (const p of spots) near(Math.hypot(p.x - c.x, p.z - c.z), SPINNER_FOLLOWER.radius, 'a follower is 50 from the center');
  near(Math.atan2(spots[0].x - c.x, spots[0].z - c.z), (0x5555 / 0x10000) * Math.PI * 2, '1st follower at 0x5555');
  near(Math.atan2(spots[1].x - c.x, spots[1].z - c.z), ((0xaaaa / 0x10000) * Math.PI * 2) - Math.PI * 2, '2nd follower at 0xaaaa');
  check(spinnerFarEnough({ x: 0, z: 31 }, { x: 0, z: 0 }) && !spinnerFarEnough({ x: 0, z: 29 }, { x: 0, z: 0 }), 'at least 30 from the avoided spot');
  check(spinnerFarEnough({ x: 0, z: 1 }, null), 'no spot to avoid');
}

if (failures) {
  console.log(`saintmilion: ${failures} failures`);
  process.exit(1);
}
console.log('saintmilion: all checks passed');
