// Ranged and melee aim (combat/weaponaim.ts) and the gun reach rows of the ItemPMT
// (formats/itempmt.ts weaponRange): a target 8 degrees off the heading is inside the
// Handgun's 10 degree cone, one 25 or 45 degrees off is not, the attack faces the target
// (dispatch_action_attack_step1, PsoBB.exe 0x006a0f58), and the Handgun / Shot rows match
// the table. Run: node tests/rangedaim.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { facingOf, coneOffset, inWeaponCone } from '../client/src/combat/weaponaim.ts';
import { parseItemPMT } from '../client/src/formats/itempmt.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NEWSERV = join(ROOT, 'vendor/newserv');
const TABLES = join(NEWSERV, 'system/tables');
const DEG = Math.PI / 180;
const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// Direction (dx, dz) at `deg` from the heading `heading` (the port's convention: heading 0 = +z).
const dirAt = (heading: number, deg: number) => [Math.sin(heading + deg * DEG), Math.cos(heading + deg * DEG)] as const;

// Handgun: horizontal half angle 1820 BAMS = 10 degrees.
const HANDGUN_HALF = 1820 * BAMS_TO_RAD;
check(near(HANDGUN_HALF / DEG, 10, 0.01), `Handgun half angle is 10 degrees (${HANDGUN_HALF / DEG})`);

const heading = 0.7;
for (const [deg, inside] of [
  [0, true],
  [8, true],
  [9.9, true],
  [10.5, false],
  [25, false],
  [45, false],
] as const) {
  const [dx, dz] = dirAt(heading, deg);
  check(inWeaponCone(dx, dz, heading, HANDGUN_HALF) === inside, `target ${deg} deg off heading is ${inside ? 'inside' : 'outside'} the 10 degree cone`);
}

// Wrap-around: heading just short of pi, target just past -pi.
{
  const h = Math.PI - 0.05;
  const [dx, dz] = dirAt(h, 0.1 / DEG);
  check(near(coneOffset(dx, dz, h), 0.1, 1e-6), `cone offset wraps (${coneOffset(dx, dz, h)})`);
  check(inWeaponCone(dx, dz, h, 0.2), 'wrapped target inside a 0.2 rad cone');
}

// Facing: the attack turns to the target, so the target is then dead ahead and inside any cone.
for (const deg of [-9, -3, 4, 9]) {
  const [dx, dz] = dirAt(heading, deg);
  const face = facingOf(dx, dz);
  check(near(coneOffset(dx, dz, face), 0), `facing toward a target ${deg} deg off is dead ahead`);
  check(near(face, heading + deg * DEG, 1e-6), `facing equals the target angle (${deg} deg)`);
}
check(near(facingOf(0, 1), 0), 'facingOf(+z) is 0');
check(near(facingOf(1, 0), Math.PI / 2), 'facingOf(+x) is pi/2');

// ItemPMT: the real table rows for the guns (encoded by the vendored newserv, as items.test.ts does).
{
  const out = join(mkdtempSync(join(tmpdir(), 'rangedaim-')), 'ItemPMT.prs');
  execFileSync(join(NEWSERV, 'build/newserv'), ['encode-item-parameter-table', '--bb', join(TABLES, 'item-parameter-table-bb-v4.json'), out], {
    cwd: NEWSERV,
    stdio: 'ignore',
  });
  const pmt = parseItemPMT(new Uint8Array(readFileSync(out)));
  const handgun = pmt.weaponRange(6, 0, 0);
  check(handgun?.horizontal === 170 && handgun?.vertical === 30, `Handgun reach 170 + 30 (${JSON.stringify(handgun)})`);
  check(handgun?.horizontalHalfAngle === 1820 && handgun?.maxTargets === 1, `Handgun cone 1820, one target (${JSON.stringify(handgun)})`);
  const shot = pmt.weaponRange(9, 0, 0);
  check(shot?.maxTargets === 5 && shot?.horizontal === 130, `Shot: five targets, reach 130 (${JSON.stringify(shot)})`);
}

if (failures) {
  console.log(`rangedaim: ${failures} failure(s)`);
  process.exit(1);
}
console.log('rangedaim: all checks passed');
