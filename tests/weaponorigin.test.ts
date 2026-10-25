// The gun's bullet start (client/src/combat/weaponorigin.ts, PsoBB.exe PerformItemAttack
// 0x005e8a45 -> get_weapon_position 0x005e83c8): the attach index maps to a weapon walk entry
// (>= 0) or a body node (-1 -> 0x30, -2 -> 0x23); without a provider the start is the feet +
// WEAPON_HEIGHT. The exe's walk order (exeWalkIndices: pre-order, EVAL_BREAK takes no children)
// and the skeleton's world point (skeletonNodePosition) are checked on real three.js bones.
// The ItemPMT attach bytes of the guns come from the vendored newserv tables.
// Run: node tests/weaponorigin.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { gunBulletStart, HAND_BODY_NODE, SECOND_START_BODY_NODE, weaponAttachRef, type Point, type WeaponNodeRef } from '../client/src/combat/weaponorigin.ts';
import { WEAPON_HEIGHT } from '../client/src/combat/techfire.ts';
import { exeWalkIndices, skeletonNodePosition } from '../client/src/render/playeranim.ts';
import { parseItemPMT } from '../client/src/formats/itempmt.ts';
import { EVAL_BREAK } from '../client/src/formats/xj.ts';
import type { NjcmObject } from '../client/src/formats/njcm.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NEWSERV = join(ROOT, 'vendor/newserv');
const TABLES = join(NEWSERV, 'system/tables');

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) <= eps;
const FEET: Point = { x: 10, y: 0, z: -4 };

// 1. The attach index names (get_weapon_position's index handling).
{
  const m1 = weaponAttachRef(-1);
  const m2 = weaponAttachRef(-2);
  check(m1.part === 'body' && m1.node === 0x30, `-1 is body point 0x30 (${JSON.stringify(m1)})`);
  check(m2.part === 'body' && m2.node === 0x23, `-2 is body point 0x23 (${JSON.stringify(m2)})`);
  check(weaponAttachRef(2).part === 'weapon' && weaponAttachRef(2).node === 2, 'attach 2 is weapon walk entry 2');
  check(weaponAttachRef(0).part === 'weapon' && weaponAttachRef(0).node === 0, 'attach 0 is weapon walk entry 0');
}

// 2. The provider is asked for the mapped ref and its point is the start.
{
  const asked: WeaponNodeRef[] = [];
  const provider = (ref: WeaponNodeRef, out: Point) => {
    asked.push(ref);
    out.x = 1;
    out.y = 2;
    out.z = 3;
    return true;
  };
  const out = { x: 0, y: 0, z: 0 };
  const start = gunBulletStart(2, FEET, provider, out);
  check(start === out && start.x === 1 && start.y === 2 && start.z === 3, `provider point is the start (${JSON.stringify(start)})`);
  check(asked.length === 1 && asked[0].part === 'weapon' && asked[0].node === 2, `provider asked for weapon entry 2 (${JSON.stringify(asked)})`);
  gunBulletStart(-1, FEET, provider, out);
  check(asked[1].part === 'body' && asked[1].node === 0x30, `-1 asks the body point 0x30 (${JSON.stringify(asked[1])})`);
  gunBulletStart(-2, FEET, provider, out);
  check(asked[2].part === 'body' && asked[2].node === 0x23, `-2 asks the body point 0x23 (${JSON.stringify(asked[2])})`);
}

// 3. No skeleton (provider absent or false): the feet plus WEAPON_HEIGHT.
{
  const out = { x: 0, y: 0, z: 0 };
  const none = gunBulletStart(2, FEET, undefined, out);
  check(none.x === FEET.x && none.y === FEET.y + WEAPON_HEIGHT && none.z === FEET.z, `no provider: feet + WEAPON_HEIGHT (${JSON.stringify(none)})`);
  const refused = gunBulletStart(2, FEET, () => false, out);
  check(refused.y === WEAPON_HEIGHT, `provider false: fallback (${JSON.stringify(refused)})`);
}

// 4. The exe's walk order: pre-order over every node, children of an EVAL_BREAK node not taken.
// Full depth-first indices: root 0, A 1, A1 2, B 3, B1 4, C 5. B breaks, so B1 is not visited.
{
  const leaf = (flags = 0): NjcmObject => ({ flags, model: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], children: [] });
  const a1 = leaf();
  const a = { ...leaf(), children: [a1] };
  const b1 = leaf();
  const b = { ...leaf(EVAL_BREAK), children: [b1] };
  const c = leaf();
  const root = { ...leaf(), children: [a, b, c] };
  const walk = exeWalkIndices(root);
  check(JSON.stringify(walk) === JSON.stringify([0, 1, 2, 3, 5]), `walk order skips the children of EVAL_BREAK (${JSON.stringify(walk)})`);
  check(JSON.stringify(exeWalkIndices(leaf())) === '[0]', 'a lone node walks as [0]');
}

// 5. Skeleton world point, with no matrix update before the call. The group sits at (100, 0, 50),
// bone 1 at (0, 10, 0) turned 90 degrees about Y, bone 2 at (0, 0, 5) under it: world (105, 10, 50).
{
  const group = new THREE.Group();
  group.position.set(100, 0, 50);
  const b0 = new THREE.Bone();
  const b1 = new THREE.Bone();
  const b2 = new THREE.Bone();
  b1.position.set(0, 10, 0);
  b1.rotation.set(0, Math.PI / 2, 0);
  b2.position.set(0, 0, 5);
  group.add(b0);
  b0.add(b1);
  b1.add(b2);
  const bones = [b0, b1, b2];
  const out = { x: 0, y: 0, z: 0 };
  // The bones are not attached to a scene yet: their parents' matrices are stale until updated.
  // skeletonNodePosition refreshes the chain itself.
  const ok = skeletonNodePosition(bones, 2, out);
  check(ok && near(out.x, 105) && near(out.y, 10) && near(out.z, 50), `skeleton point of node 2 (${JSON.stringify(out)})`);
  // A node past the skeleton is not there.
  check(skeletonNodePosition(bones, 3, out) === false, 'node 3 past the skeleton is refused');
  check(skeletonNodePosition(undefined, 0, out) === false, 'no skeleton is refused');
}

// 6. The guns' attach bytes in the real ItemPMT (ItemPMT +0x1f, the port's `projectile`).
{
  const out = join(mkdtempSync(join(tmpdir(), 'weaponorigin-')), 'ItemPMT.prs');
  execFileSync(join(NEWSERV, 'build/newserv'), ['encode-item-parameter-table', '--bb', join(TABLES, 'item-parameter-table-bb-v4.json'), out]);
  const pmt = parseItemPMT(new Uint8Array(readFileSync(out)));
  const attach = (c: number, i: number) => pmt.getWeapon(c, i)?.projectile;
  check(attach(6, 0) === 2 && attach(7, 0) === 1 && attach(8, 0) === 1 && attach(9, 0) === 0, `gun attach bytes: Handgun 2, Rifle 1, Mechgun 1, Shot 0 (${attach(6, 0)}, ${attach(7, 0)}, ${attach(8, 0)}, ${attach(9, 0)})`);
}

// 7. The Mechgun's second start (+0x24c): the weapon walk pushed from body node 0x23 (the +0x189
// index that item_position_y_set(this, 0x23) writes). The ref carries the base; the hand is the default.
{
  check(SECOND_START_BODY_NODE === 0x23 && HAND_BODY_NODE === 0x30, 'the second start is pushed from body node 0x23, the hand is 0x30');
  check(weaponAttachRef(1).base === undefined && weaponAttachRef(1, HAND_BODY_NODE).base === undefined, 'no base: the hand walk (the default ref)');
  const b = weaponAttachRef(1, SECOND_START_BODY_NODE);
  check(b.part === 'weapon' && b.node === 1 && b.base === 0x23, `base 0x23 keeps the walk entry (${JSON.stringify(b)})`);
  const asked: WeaponNodeRef[] = [];
  const provider = (ref: WeaponNodeRef, out: Point) => {
    asked.push(ref);
    out.x = 7;
    out.y = 8;
    out.z = 9;
    return true;
  };
  const out = { x: 0, y: 0, z: 0 };
  gunBulletStart(1, FEET, provider, out, SECOND_START_BODY_NODE);
  check(asked[0].part === 'weapon' && asked[0].node === 1 && asked[0].base === 0x23, `second start asks walk entry 1 from 0x23 (${JSON.stringify(asked[0])})`);
  gunBulletStart(1, FEET, provider, out);
  check(asked[1].part === 'weapon' && asked[1].node === 1 && asked[1].base === undefined, `first start asks walk entry 1 from the hand (${JSON.stringify(asked[1])})`);
}

console.log(failures === 0 ? 'weaponorigin: all checks passed' : `weaponorigin: ${failures} failure(s)`);
if (failures) process.exitCode = 1;
