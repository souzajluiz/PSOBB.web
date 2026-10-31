// The Episode 4 quest NPC's weapon table (formats/npcmodels.ts QUEST_NPC_WEAPONS, read from
// PsoBB.exe 0x009c3e58: four difficulty blocks of 64 [kind, variant] pairs) and the talk reach
// of the Middle key (combat/weaponaim.ts inMeleeReach with the NPC's box radius, the port's
// NpcLayer.nearestInReach). The exact pairs below are the exe's entries (exedata.py / the
// block addresses 0x00a038a0 + 0x100 * difficulty, item data1 at +8).
// Run: node tests/npctalkreach.test.ts
import { QUEST_NPC_WEAPONS, QUEST_NPC_WEAPON_TABLE_VA, questNpcWeapon } from '../client/src/formats/npcmodels.ts';
import { inMeleeReach, inWeaponReach, type MeleeAim, type WeaponReach } from '../client/src/combat/weaponaim.ts';
import { NPC_RADIUS } from '../client/src/render/npcwander.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// A. the table shape: 4 difficulties x 64 templates, every entry a [kind, variant] pair
check(QUEST_NPC_WEAPONS.length === 4 && QUEST_NPC_WEAPONS.every((row) => row.length === 64), 'four difficulty blocks of 64 templates');
check(QUEST_NPC_WEAPONS.every((row) => row.every(([k, v]) => Number.isInteger(k) && k >= 0 && k <= 0xff && Number.isInteger(v) && v >= 0 && v <= 0xff)), 'every entry is a byte pair');
check(QUEST_NPC_WEAPON_TABLE_VA === 0x009c3e58, 'the table is g_ChallengeEntityWeaponData at 0x009c3e58');

// B. exact lookups (the exe's entries): the template index is the set entry's param6 bits 8..13
check(JSON.stringify(questNpcWeapon(0, 0)) === '{"kind":6,"variant":0}', 'difficulty 0 template 0 is kind 6 variant 0 (exe 0x00a038a0)');
check(JSON.stringify(questNpcWeapon(1, 0)) === '{"kind":6,"variant":1}', 'difficulty 1 template 0 differs only in the variant (exe 0x00a039a0)');
check(JSON.stringify(questNpcWeapon(0, 6)) === '{"kind":151,"variant":0}', 'difficulty 0 template 6 is the class-151 weapon');
check(JSON.stringify(questNpcWeapon(2, 8)) === '{"kind":12,"variant":5}', 'difficulty 2 template 8 is kind 12 variant 5 (exe 0x00a03aa0 + 0x20)');
check(JSON.stringify(questNpcWeapon(3, 63)) === '{"kind":22,"variant":0}', 'difficulty 3 template 63 is kind 22 variant 0 (exe 0x00a03ba0 + 0xfc)');
check(JSON.stringify(questNpcWeapon(0, 34)) === '{"kind":137,"variant":3}', 'difficulty 0 template 34 is kind 137 variant 3');

// C. out-of-range indices give no weapon (the NPC is drawn without one)
check(questNpcWeapon(4, 0) === null, 'difficulty 4 has no block (g_CurrentFloor is 0..3)');
check(questNpcWeapon(-1, 0) === null, 'a negative difficulty has no block');
check(questNpcWeapon(0, 64) === null, 'template 64 is past the 64-entry block');
check(questNpcWeapon(0, -1) === null, 'a negative template has no entry');

// D. the talk reach. The sword-like row of tests/meleereach.test.ts: horizontal 14, vertical 18,
// half angles 0x127d (BAMS), heading 0. The weapon is the origin.
const AIM: MeleeAim = { heading: 0, horizontal: 14, vertical: 18, hAngle: 0x127d, vAngle: 0x127d };
const W = { x: 0, y: 0, z: 0 };
const at = (x: number, y: number, z: number) => ({ x, y, z });
const range: WeaponReach = { x: 0, y: 0, z: 0, heading: 0, maxDist: 32, halfAngle: (0x127d * Math.PI * 2) / 0x10000 };
check(NPC_RADIUS === 5, 'the NPC box radius the talk uses is NPC_RADIUS (5, ASSUMED)');

// The melee reach counts the NPC's radius: 14 + 18 + 5 = 37 ahead is the last talkable spot.
check(inMeleeReach(W, AIM, at(0, 0, 37), NPC_RADIUS), 'an NPC 37 ahead is inside the talk reach');
check(!inMeleeReach(W, AIM, at(0, 0, 38), NPC_RADIUS), 'an NPC 38 ahead is outside the talk reach');
// The cone test it replaces stopped at 32 (horizontal + vertical), so 33..37 ahead was the change.
check(!inWeaponReach(range, 0, 0, 33), 'the old cone test stopped at 32 (the reach without the radius)');
check(inMeleeReach(W, AIM, at(0, 0, 33), NPC_RADIUS), 'an NPC 33 ahead is inside the new talk reach');
// Right and left of the heading: the cone is centred on it.
check(!inMeleeReach(W, AIM, at(20, 0, 10), NPC_RADIUS), 'an NPC 20 right and 10 ahead is outside the cone');
// Behind the weapon: the cone's apex is 18 behind the weapon (vertical distance), so an NPC 10
// behind the weapon is 8 ahead of the apex and inside; 25 behind is 7 behind the apex, outside.
check(inMeleeReach(W, AIM, at(0, 0, -10), NPC_RADIUS), 'an NPC 10 behind the weapon is inside (the apex is 18 behind it)');
check(!inMeleeReach(W, AIM, at(0, 0, -25), NPC_RADIUS), 'an NPC 25 behind the weapon is outside (7 behind the apex)');
// Elevation: the new rule has no 40-unit window, so 30 up at 20 ahead is outside the cone
// (the elevation cone of the aim), while the old window (40) took it.
check(!inMeleeReach(W, AIM, at(0, 30, 20), NPC_RADIUS), 'an NPC 30 units up at 20 ahead is outside the elevation cone');
check(inWeaponReach(range, 0, 30, 20), 'the old window (40 units) took an NPC 30 units up');

if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('ALL PASS');
