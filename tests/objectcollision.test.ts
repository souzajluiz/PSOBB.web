// Field objects that block the player (containers, jungle rocks, doors):
//  1. the flag gate of CheckTwoHitboxCollision_007b5e40 (boxPairActive): enabled
//     bits, shared category bits, exclusive pairs; the player's flag word;
//  2. the box shapes against the player's sphere: a sphere container, a rounded
//     rock box, bit 0x100 (pass-through), a disabled box;
//  3. the step test (IsPlayerAboutToCollide_00694198): a box blocks a step toward
//     it, not a step away from it;
//  4. the placed solids of a floor (collectFieldSolids): containers and rocks are
//     solids, doors are not; a solid's box is turned by its yaw;
//  5. the drop spot's body test (spotHitsBody) for a sphere body;
//  6. the falling stalactite (0x038b): the trigger, the fall, the landing and the hit; the rock's switch flag.
//
// Run: node tests/objectcollision.test.ts
import type { PlacedEntity, ObjectSet } from '../client/src/formats/setdata.ts';
import type { MapCollision } from '../client/src/formats/crel.ts';
import { boxPairActive, CollisionWorld, OBJECT_BOX_FLAGS, PLAYER_BOX_FLAGS, PLAYER_RADIUS, type Obstacle } from '../client/src/render/collision.ts';
import { collectFieldSolids, dist2xz, FallingStalactite, FieldObjects, rockSwitchFlag, solidObstacle, stalactiteDamage, stalactiteInRange, type FieldSolid } from '../client/src/render/fieldobjects.ts';
import { spotHitsBody } from '../client/src/net/dropspot.ts';
import { CHILD_COLLISION_LINKS, COLLISION_SITES, COLLISION_TABLES, ENEMY_COLLISION_LINKS, TYPE_COLLISION_TABLES } from '../client/src/formats/collisionboxes.gen.ts';
import { boxTargetable, childBoxTable, enemyBoxTable, isTargetable, slotSetType, slotVariant } from '../client/src/formats/enemyboxes.ts';
import { rowsAimHeight, rowsRadius } from '../client/src/combat/techfire.ts';
import { DerolleEmitter, msvcRand, parseDerolleBlock, ROCK_DEBRIS_BLOCK, STALACTITE_DEBRIS_TEMPLATE, yawPoint } from '../client/src/classic/particles.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};

// 1. The flag gate.
check(PLAYER_BOX_FLAGS === 0x200b, 'the class 1 player flag word is 0x200b');
check(OBJECT_BOX_FLAGS === 0x10003, 'a door / rock box flag word is 0x10003');
check(boxPairActive(PLAYER_BOX_FLAGS, 0x10003), 'a door / rock box pairs with the class 1 player');
check(boxPairActive(PLAYER_BOX_FLAGS, 0x38003), 'a container box pairs with the class 1 player');
check(!boxPairActive(PLAYER_BOX_FLAGS, 0x10002), 'a box with bit 0 clear (disabled) does not pair');
check(!boxPairActive(PLAYER_BOX_FLAGS, 0x10001), 'a box with no shared category bit (2 / 4) does not pair');
check(!boxPairActive(PLAYER_BOX_FLAGS, 0x2008), 'bit 8 of the box against bit 0x2000 of the player is exclusive');
check(!boxPairActive(0x16043, 0x38003), 'class 6 (0x40) passes a box with 0x10000 (exclusive pair 0x40 / 0x10000)');
check(!boxPairActive(0x604b, 0x10003), 'class 3 (0x40) passes a box with 0x10000');
check(boxPairActive(0x10003, 0x38003), 'two table boxes pair');

// 2. Shapes against the player's radius.
const world = new CollisionWorld({ meshes: [] } as unknown as MapCollision);
const solid = (over: Partial<Obstacle>): Obstacle => ({ key: 1, x: 100, y: 0, z: 0, yaw: 0, halfX: 9, halfZ: 9, height: 50, sphere: true, flags: 0x38003, ...over });

world.obstacles = [solid({})];
check(!!world.blockedBy(108, 6, 0, PLAYER_RADIUS), 'a container sphere (r9) blocks a player 8 units from its centre (r5 + r9 = 14)');
check(!world.blockedBy(120, 6, 0, PLAYER_RADIUS), 'a container sphere does not block 20 units away');
check(!world.blockedBy(100, 200, 0, PLAYER_RADIUS), 'a container sphere does not block far above it');
check(!!world.blockedBy(108, 6, 0, PLAYER_RADIUS, [-1, 0]), 'a step toward a container is blocked');
check(!world.blockedBy(108, 6, 0, PLAYER_RADIUS, [1, 0]), 'a step away from an overlapped container is not blocked');
world.obstacles = [solid({ flags: 0x38103 })];
check(!world.blockedBy(108, 6, 0, PLAYER_RADIUS), 'bit 0x100 (pass-through) lets the player through a container');
world.obstacles = [solid({ flags: 0x38002 })];
check(!world.blockedBy(108, 6, 0, PLAYER_RADIUS), 'a disabled container (bit 0 clear) blocks nothing');
world.obstacles = [solid({ flags: undefined, sphere: false, halfX: 12, halfZ: 8, x: 0 })];
check(!!world.blockedBy(14, 0, 0, PLAYER_RADIUS, [-1, 0]), 'a jungle rock box (12 x 8) blocks 2 units past its face');
check(!!world.blockedBy(15, 0, 11, PLAYER_RADIUS, [-1, -1]), 'the box corner is rounded: 3 x 3 past the corner (4.2 away) blocks');
check(!world.blockedBy(16, 0, 12, PLAYER_RADIUS, [-1, -1]), 'the box corner is rounded: 4 x 4 past the corner (5.7 away) does not block');
check(!!world.blockedBy(2, 0, 0, PLAYER_RADIUS, [-1, 0]), 'a player inside the box is blocked by a step toward its centre');
world.obstacles = [];

// 3. Placed solids of a floor.
const object = (type: number, index: number): ObjectSet =>
  ({ kind: 'object', type, index, group: 0, unknownA3: 0, params: [0, 0, 0, 0, 0, 0], position: [0, 0, 0], angle: [0, 0, 0], floor: 0, section: 0, room: 0, name: '' }) as unknown as ObjectSet;
const place = (type: number, index: number, world3: [number, number, number], yaw = 0): PlacedEntity =>
  ({ entity: object(type, index), name: 'x', category: 'object', world: world3, yaw, sectionFound: true }) as PlacedEntity;
const placed = [place(0x0203, 1, [100, 0, 50]), place(0x0206, 2, [0, 0, 0]), place(0x0207, 3, [30, 0, 0], Math.PI / 2), place(0x0080, 4, [0, 0, 200])];
const solids: FieldSolid[] = collectFieldSolids(placed, { area: 0x18, episode: 1 });
const ids = solids.map((s) => s.index).sort();
check(JSON.stringify(ids) === JSON.stringify([1, 2, 3]), `containers and rocks are solids, the door is not (got ${JSON.stringify(ids)})`);
const jungle = solids.find((s) => s.index === 1);
check(!!jungle && jungle.collision.address === 0x009c77ac, 'a jungle container is the container sphere 0x009c77ac');
const rockM = solids.find((s) => s.index === 3);
check(!!rockM && rockM.collision.type === 1 && rockM.collision.halfX === 12 && rockM.collision.halfZ === 8, 'the medium rock is the 12 x 8 box');
if (rockM) {
  const o = solidObstacle(rockM);
  check(o.sphere === false && o.flags === 0x10003 && o.halfX === 12, 'a rock box keeps its shape and flags');
  check(Math.abs(o.x - 30) < 1e-9 && Math.abs(o.z - 0) < 1e-9, 'the rock box (no offset) stays at its place');
}
const sphereOb = solidObstacle(jungle!);
check(sphereOb.sphere === true && sphereOb.flags === 0x38003 && sphereOb.halfX === 9, 'a container is a sphere of radius 9 with flags 0x38003');
check(sphereOb.y === 6 && sphereOb.x === 100 && sphereOb.z === 50, 'the container sphere sits at its origin with the (0, 6, 0) offset');
const turned = solidObstacle({ index: 9, x: 0, y: 0, z: 0, yaw: Math.PI / 2, collision: { address: 0, offset: [3, 0, 0], type: 1, halfX: 1, halfZ: 1, flags: 0x10003 } });
check(Math.abs(turned.x) < 1e-9 && Math.abs(turned.z + 3) < 1e-9, 'a table offset turns with the entity yaw (+3 on x at yaw pi/2 is -3 on z)');

// 3b. The Ancient pillars (TOTrapAncient02 0x0154, 02R 0x0167): their box is the
// static sphere 0x009c684c (r2, 8.5 up, flags 0x38003) from InitializeDerolleEnemyBase_0063c638.
// The box does not follow the rise (no writer in the trap's states), so the solid
// is built from the placement alone and blocks whether the pillar is up or down.
const pillars = collectFieldSolids([place(0x0154, 5, [50, 0, 50]), place(0x0167, 6, [-40, 0, 0])], { area: 0x13, episode: 1 });
check(JSON.stringify(pillars.map((s) => s.index).sort()) === '[5,6]', 'both pillar types are solids');
const pillar = pillars.find((s) => s.index === 5);
check(!!pillar && pillar.collision.address === 0x009c684c && pillar.collision.type === 0 && pillar.collision.halfX === 2, 'a pillar is the sphere r2 of 0x009c684c');
if (pillar) {
  const o = solidObstacle(pillar);
  check(o.sphere === true && o.flags === 0x38003 && o.halfX === 2, 'a pillar box is a sphere of radius 2 with flags 0x38003');
  check(Math.abs(o.y - 8.5) < 1e-9 && o.x === 50 && o.z === 50, 'a pillar box sits at its origin, 8.5 up');
  world.obstacles = [o];
  check(!!world.blockedBy(56, 0, 50, PLAYER_RADIUS), 'a pillar blocks a player 6 units from its centre (r2 + r5 = 7), lowered or raised');
  check(!world.blockedBy(58, 0, 50, PLAYER_RADIUS), 'a pillar does not block a player 8 units from its centre');
  check(!!world.blockedBy(56, 0, 50, PLAYER_RADIUS, [-1, 0]), 'a step toward a pillar is blocked');
  check(!world.blockedBy(56, 0, 50, PLAYER_RADIUS, [1, 0]), 'a step away from an overlapped pillar is not blocked');
  world.obstacles = [];
}

// 3c. The generated table (tools/gen-collision-boxes.py, client/src/formats/collisionboxes.gen.ts).
// The pillar box is read from the exe (0x009c684c, one sphere, radius 2, 8.5 up); the pillar
// type reaches it at depth 1 (its constructor calls InitializeDerolleEnemyBase_0063c638).
check(COLLISION_SITES.length >= 190, `the generator decodes the call sites (got ${COLLISION_SITES.length})`);
const pillarTable = COLLISION_TABLES[0x009c684c];
check(!!pillarTable && pillarTable.length === 1 && pillarTable[0].shape === 0 && pillarTable[0].radius === 2 && pillarTable[0].flags === 0x38003, 'the generated pillar table is one sphere r2, flags 0x38003');
check(!!TYPE_COLLISION_TABLES[0x0154]?.some((l) => l.table === 0x009c684c && l.depth === 1), 'type 0x0154 reaches the pillar table at depth 1');
// The three field objects the table adds to the solids: the ancient nest container, the
// info capsule and the Wilds poison plant. Each box passes the player's flag gate.
const added = collectFieldSolids([place(0x0152, 7, [0, 0, 0]), place(0x0229, 8, [0, 0, 0]), place(0x0380, 9, [0, 0, 0])], { area: 0x18, episode: 4 });
const addedAddr: Record<number, number> = { 7: 0x009c7868, 8: 0x009c4a14, 9: 0x009c9f18 };
check(added.length === 3, `the nest container, the capsule and the poison plant are solids (got ${added.length})`);
for (const s of added) {
  check(s.collision.address === addedAddr[s.index], `solid ${s.index} uses its generated box ${addedAddr[s.index].toString(16)}`);
  check(boxPairActive(PLAYER_BOX_FLAGS, s.collision.flags), `solid ${s.index} box passes the player's flag gate`);
}
// 3c-2. The desert crystal box (0x038d, table 0x009c9ce8, set by ctor 0x00677610): a sphere
// of radius 9 at 6 up, the container's flags, so it blocks like a container. The Seabed
// capture trap (0x0228, table 0x009c6b04, flags 0x8011f04) has bit 0x1 clear, so the gate
// refuses it: a trap the player walks over, not a block.
const crystal = collectFieldSolids([place(0x038d, 10, [0, 0, 0])], { area: 0x18, episode: 4 });
check(crystal.length === 1 && crystal[0].collision.address === 0x009c9ce8, 'the desert crystal box is a solid with table 0x009c9ce8');
check(TYPE_COLLISION_TABLES[0x038d]?.some((l) => l.table === 0x009c9ce8 && l.depth === 1) === true, 'type 0x038d reaches table 0x009c9ce8 at depth 1');
if (crystal.length === 1) {
  const o = solidObstacle(crystal[0]);
  check(o.sphere === true && o.halfX === 9 && o.y === 6 && o.flags === 0x38003, 'the crystal box is a sphere of radius 9, 6 up');
}
check(!boxPairActive(0x8011f04, PLAYER_BOX_FLAGS), 'the Seabed trap box (flags 0x8011f04, bit 0x1 clear) does not pass the gate');
// The NPC box (0x009c3ecc, flags 0x30203, read from the exe) passes the gate against the
// container and the rock words, so an NPC is stopped by them as the player is (ASSUMED: the NPC's
// own walk uses the same gate; its runtime flag word is not traced).
check(boxPairActive(0x30203, 0x38003) && boxPairActive(0x30203, OBJECT_BOX_FLAGS), 'the NPC box passes the container and rock gates');
const nest = added.find((s) => s.index === 7);
if (nest) {
  const o = solidObstacle(nest);
  check(o.sphere === true && o.halfX === 10 && o.flags === 0x38003 && o.y === 8, 'the nest container is a sphere of radius 10, 8 up');
  world.obstacles = [o];
  check(!!world.blockedBy(14, 0, 0, PLAYER_RADIUS), 'the nest container blocks a player 14 units out (10 + 5 = 15)');
  check(!world.blockedBy(16, 0, 0, PLAYER_RADIUS), 'the nest container does not block a player 16 units out');
  world.obstacles = [];
}

// 3c-3. The Episode 4 solids. The crater cactus 0x0301, brown rock 0x0302, black rocks 0x0386 and the
// beehive 0x038f take their box row from base + 0x2c * param4 (the ctors' init table; COLLISION_SITES
// has the variants, checked here against the port's bases). The destructible rock 0x0303 has one box
// (0x009c9a68). The falling stalactite 0x038b is row 0x009c9fb8, sphere r15 at the origin.
const epSite = (site: number) => COLLISION_SITES.find((s) => s.site === site);
const variantsOf = (site: number) => epSite(site)?.variants;
check(JSON.stringify(variantsOf(0x00676224)) === JSON.stringify({ 0: 0x009c9aa0, 1: 0x009c9acc, 2: 0x009c9af8 }), 'the cactus site 0x00676224 has rows 0x9c9aa0 + 0x2c * param4');
check(JSON.stringify(variantsOf(0x00675840)) === JSON.stringify({ 0: 0x009c9940, 1: 0x009c996c, 2: 0x009c9998 }), 'the brown rock site 0x00675840 has rows 0x9c9940 + 0x2c * param4');
check(JSON.stringify(variantsOf(0x00677edc)) === JSON.stringify({ 0: 0x009c9d80, 1: 0x009c9dac, 2: 0x009c9dd8 }), 'the black rock site 0x00677edc has rows 0x9c9d80 + 0x2c * param4');
check(JSON.stringify(variantsOf(0x00676c0f)) === JSON.stringify({ 0: 0x009c9b60, 1: 0x009c9b8c }), 'the beehive site 0x00676c0f has rows 0x9c9b60 + 0x2c * param4');
check(epSite(0x00675cd5)?.table === 0x009c9a68, 'the destructible rock site 0x00675cd5 has the single table 0x9c9a68');
check(epSite(0x0067a038)?.table === 0x009c9fb8, 'the stalactite site 0x0067a038 has table 0x9c9fb8');
const ep = (type: number, p4: number) => {
  const o = object(type, 20);
  o.params[3] = p4;
  return collectFieldSolids([{ ...place(type, 20, [0, 0, 0]), entity: o } as PlacedEntity], { area: 0x2c, episode: 4 })[0];
};
const cactusRows = [0x009c9aa0, 0x009c9acc, 0x009c9af8];
[0, 1, 2].forEach((p, k) => {
  const s = ep(0x0301, p);
  check(!!s && s.collision.address === cactusRows[k], `cactus with param4 ${p} takes row ${cactusRows[k].toString(16)}`);
});
check(ep(0x0301, 2)?.collision.halfZ === 9 && ep(0x0301, 2)?.collision.type === 1, 'the cactus at param4 2 is the 9 x 9 box');
check(ep(0x0302, 0)?.collision.address === 0x009c9940 && ep(0x0302, 2)?.collision.address === 0x009c9998, 'the brown rock takes rows 0x9c9940 / 0x9c9998 for param4 0 / 2');
check(ep(0x0386, 0)?.collision.halfZ === 30 && ep(0x0386, 2)?.collision.halfZ === 10, 'the black rocks: sphere 30 at param4 0, sphere 10 at 2');
check(ep(0x0303, 0)?.collision.address === 0x009c9a68 && ep(0x0303, 1)?.collision.address === 0x009c9a68, 'the destructible rock has its single box whatever the param4');
const stal = ep(0x038b, 0);
check(!!stal && stal.collision.address === 0x009c9fb8 && stal.collision.type === 0 && stal.collision.halfZ === 15 && stal.collision.flags === 0x10003, 'the stalactite is a sphere of radius 15, flags 0x10003 (bit 0 on while it hangs)');
check(ep(0x038f, 0)?.collision.offset[1] === 5 && ep(0x038f, 1)?.collision.offset[1] === 9, 'the beehive is the row at y 5 for param4 0 and at y 9 for 1');
check(ep(0x038f, 0)?.collision.flags === 0x38003, 'the beehive box has the container flags');

// 4. Drop spot body test on a sphere (FUN_0083dbd4 with the spot radius 3).
const sphereBody = { x: 10, z: 0, yaw: 0, halfX: 9, halfZ: 9, sphere: true };
check(spotHitsBody({ x: 0, y: 0, z: 0 }, sphereBody), 'a spot 10 from a sphere of radius 9 is hit (3 + 9 = 12)');
check(!spotHitsBody({ x: 0, y: 0, z: 0 }, { ...sphereBody, x: 12.5 }), 'a spot 12.5 from the same sphere is clear');
check(spotHitsBody({ x: 0, y: 0, z: 0 }, { x: 10, z: 0, yaw: 0, halfX: 9, halfZ: 9 }), 'a box body still uses the rounded rectangle');

// 5. Enemy boxes (formats/enemyboxes.ts): the table of each .dat set type, from its own factory.
// Monest 0x42 is set by its constructor 0x005191c0 (table 0x009bb780: one box at the origin, flags
// 0x8003, so targetable); Hildebear 0x40 (table 0x009bb58c: one box at y 20); Booma 0x44 has no
// table found (its box is set through a vtable), so it is not targetable by table and aims at the fallback.
check(ENEMY_COLLISION_LINKS[0x42]?.[0]?.table === 0x009bb780, 'Monest links to its own box table 0x009bb780');
check(enemyBoxTable(0x40, null)?.table === 0x009bb58c, 'Hildebear links to its box table 0x009bb58c');
check(enemyBoxTable(0x44, null) === null, 'Booma without a variant has no box table (the index is the record +0x40)');
check(enemyBoxTable(0x44, null, 0)?.table === 0x009bc8e0 && enemyBoxTable(0x44, null, 1)?.table === 0x009bc90c, 'Booma variants 0 and 1 link to rows 0x009bc8e0 and 0x009bc90c (base + 0x2c * variant)');
check(enemyBoxTable(0x44, null, 2)?.table === 0x009bc938 && enemyBoxTable(0x44, null, 2)?.rows[0].radius === 8, 'Gigobooma (variant 2) links to 0x009bc938, radius 8');
check(enemyBoxTable(0x44, null, 3) === null && enemyBoxTable(0x44, null, -1) === null, 'a variant past the rows, or negative, has no table');
check(ENEMY_COLLISION_LINKS[0x44]?.[0]?.index?.recordOffset === 0x40 && ENEMY_COLLISION_LINKS[0x44]?.[0]?.index?.arg === 2, 'the Booma index is the factory argument +0x3c = record +0x40');
check(slotVariant({ set: { params: [0, 0, 0, 0, 0, 2, 0] } as never, child: 0 }) === 2 && slotVariant({ set: { params: [0, 0, 0, 0, 0, 2, 0] } as never, child: 1 }) === null, 'a root slot reads its variant from params[5]; a child has none');
// Canadine 0x83 and Canane 0x84 both reach the shared constructor 0x005424d8, which passes the
// constant table 0x009bcecc (count 1) to 0x0051ff3c: each gets that box (ASSUMED: the pair's other
// constructors do not overwrite it). The Pofuilly slime 0x64 table is 0x009bfd68 (the init is 4 deep).
check(enemyBoxTable(0x83, null)?.table === 0x009bcecc && enemyBoxTable(0x84, null)?.table === 0x009bcecc, 'Canadine and Canane link to the shared constructor table 0x009bcecc');
check(enemyBoxTable(0x64, null)?.table === 0x009bfd68, 'Pofuilly slime links to its table 0x009bfd68 (depth 4)');
// Vol Opt 0xc2 (TBoss3Volopt, not the Dragon: that is 0xc0): its 24 monitors are built by the AI's
// build state (0x0043c680, the loop at 0x0043c8a2..0x0043c94d), each through the monitor constructor
// 0x0044161c with the loop counter as argument 4; the constructor masks it with 3 (0x004416b8), so
// monitor k has the box row of shape k & 3. The root itself has no box table of its own.
check(childBoxTable(0xc2, 0)?.table === 0x009a5100 && childBoxTable(0xc2, 5)?.table === 0x009a512c, 'Vol Opt monitors 0 and 5 take rows 0x009a5100 and 0x009a512c (shapes 0 and 1)');
check(childBoxTable(0xc2, 10)?.table === 0x009a5158 && childBoxTable(0xc2, 23)?.table === 0x009a5184, 'Vol Opt monitors 10 and 23 take rows 0x009a5158 and 0x009a5184 (shapes 2 and 3)');
check(childBoxTable(0xc2, 0)?.rows[0].radius === 20 && childBoxTable(0xc2, 2)?.rows[0].radius === 15, 'the big monitor (shape 0) is a radius 20 sphere, shape 2 is radius 15');
check(childBoxTable(0xc2, 0)?.rows.every(boxTargetable) === true, 'the monitors\' boxes are targetable (flag 0x8000)');
check(childBoxTable(0xc2, 24) === null && childBoxTable(0xc2, -1) === null && childBoxTable(0xc1, 0) === null && childBoxTable(null, 0) === null, 'a child past the count, a negative one, a type with no children and no type have no table');
check(enemyBoxTable(0xc2, null) === null && CHILD_COLLISION_LINKS[0xc2]?.callee === 0x0044161c && CHILD_COLLISION_LINKS[0xc2]?.count === 24, 'the Vol Opt root has no box table; its children are the 24 monitors of 0x0044161c');
// The render's use of the monitor rows (render/combat.ts voloptMonitorRows): the radius of the first
// enabled row is 20 / 10 / 15 / 10 for shape k & 3 (flags 0x8005 / 0x8003 have bit 0), the aim height
// is the row's centre (offset 0, the monitor's own origin).
const MONITOR_RADIUS = [20, 10, 15, 10];
let monitorRadiusOk = true;
for (let k = 0; k < 24; k++) {
  const rows = childBoxTable(0xc2, k)?.rows;
  if (!rows || rowsRadius(rows) !== MONITOR_RADIUS[k & 3] || rowsAimHeight(rows) !== 0) monitorRadiusOk = false;
}
check(monitorRadiusOk, 'Vol Opt monitor k has the radius 20/10/15/10 of shape k & 3 and aims at its origin');
check(rowsRadius([]) === null && rowsAimHeight([]) === 22, 'no rows: no radius, the fallback aim height');
check(isTargetable(0x44) === true, 'an enemy with no known table is targetable (ASSUMED)');
check(isTargetable(0x42) === true, 'Monest has a box with flag 0x8000');
check(boxTargetable({ flags: 0x8003 }) && !boxTargetable({ flags: 0x30003 }), 'flag 0x8000 makes a box targetable');
check(slotSetType({ set: { type: 0x42 } as never, child: 0 }) === 0x42 && slotSetType({ set: { type: 0x42 } as never, child: 1 }) === null, 'a child slot has no set type of its own');

// 6. the falling stalactite (0x038b, render/fieldobjects.ts FallingStalactite): the trigger (50 in XZ),
//    the gravity step and the landing, the fall value under 10 (the hit), the range 100 and the damage by difficulty.
const stalactiteOk =
  [0, 1, 2, 3].map((d) => stalactiteDamage(d)).join(',') === '100,200,300,600' && stalactiteDamage(-1) === 100 && stalactiteDamage(9) === 600;
check(stalactiteOk, 'the stalactite hit is 100 x {1, 2, 3, 6} by difficulty (0x0093b708 and the table), clamped');
{
  const hang = new FallingStalactite(0, 0, 100, 0);
  hang.watch([{ x: 49, z: 0 }]);
  const near = hang.state === 1;
  const far = new FallingStalactite(0, 0, 100, 0);
  far.watch([{ x: 51, z: 0 }]);
  check(near && far.state === 0, 'a player within 50 in XZ starts the fall (49 yes, 51 no; the 2500 squared gate)');
  const diag = new FallingStalactite(0, 0, 100, 0);
  diag.watch([{ x: 30, z: 40 }]); // 30^2 + 40^2 = 2500, not under the gate
  check(diag.state === 0, 'the trigger distance is strict: exactly 50 does not start the fall');
}
{
  const s = new FallingStalactite(0, 0, 100, 0);
  s.state = 1;
  const first = s.step(0);
  check(!first.landed && !first.hit && Math.abs(s.y - (100 + Math.fround(-0.1088888868689537))) < 1e-4 && s.fall === s.y, 'one gravity step drops the stalactite by g and its fall value is the height above the ground');
  let landedAt = -1;
  let hitAt = -1;
  for (let t = 0; t < 2000 && landedAt < 0; t++) {
    const r = s.step(0);
    if (r.hit && hitAt < 0) hitAt = t;
    if (r.landed) landedAt = t;
  }
  check(landedAt > 0 && s.y === 0 && s.vy === 0 && s.fall === 0, 'the fall lands on the ground at height 0 with no velocity');
  check(hitAt >= 0 && hitAt < landedAt && hitAt > 0, 'the hit (fall under 10) comes on the ticks just before the landing');
  const flat = new FallingStalactite(0, 0, 5, 0);
  flat.state = 1;
  const r0 = flat.step(0);
  check(r0.landed === false && r0.hit === true, 'a stalactite 5 above the floor is under the hit height at once');
  const none = new FallingStalactite(0, 0, 100, null);
  none.state = 1;
  const rn = none.step(null);
  check(!rn.landed && !rn.hit && none.y === 100, 'no ground under it: it does not fall and does not hit (ASSUMED)');
}
check(stalactiteInRange({ x: 0, z: 99 }, { x: 0, z: 0 }) && !stalactiteInRange({ x: 0, z: 101 }, { x: 0, z: 0 }), 'the stalactite hits the players within 100 in XZ');
check(dist2xz({ x: 3, z: 4 }, { x: 0, z: 0 }) === 25, 'the XZ distance squared ignores the height (7a9180)');

check(rockSwitchFlag(0) === 0 && rockSwitchFlag(0xff) === 0xff && rockSwitchFlag(0x100) === 0x100 && rockSwitchFlag(-1) === -1 && rockSwitchFlag(0x101) === -1, 'the destructible rock keeps param4 in 0..0x100 as its switch flag, else none (0x00675c74)');

// 6b. The destructible rock's break (0x00633734 -> 0x006336f8): the flag tick plays SE 0x44c and the particles
// 0x45 and 0x46 at the rock, once; the next tick hides it. The six-part debris (0x006759d4) is not ported.
{
  const rock = { kind: 'object', type: 0x0303, index: 7, params: [0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0], group: 0, section: 0 };
  const placed = [{ entity: rock, name: 'rock', category: 'object', world: [10, 2, -4], yaw: 0, sectionFound: true }];
  const se: Array<[number, number]> = [];
  const parts: Array<[number, number]> = [];
  const fake = { scene: { add() {}, remove() {} } } as any;
  const flags = new Set<number>();
  const fo = new FieldObjects(fake, placed as any, { episode: 1, floor: 0, area: 1 }, flags);
  fo.onSe = (id, at) => se.push([id, at.x]);
  fo.onParticles = (id, at) => parts.push([id, at.x]);
  fo.tickRocks(1);
  check(se.length === 0 && parts.length === 0, 'a rock with no switch flag set does not break');
  flags.add(5);
  fo.tickRocks(1);
  check(se.length === 1 && se[0][0] === 0x44c && se[0][1] === 10, 'the flag tick plays SE 0x44c at the rock');
  check(parts.length === 2 && parts[0][0] === 0x45 && parts[1][0] === 0x46, 'the flag tick makes particles 0x45 then 0x46');
  fo.tickRocks(3);
  check(se.length === 1 && parts.length === 2, 'the break effects run once');
}

// 6c. The DerollePartObject debris (ctor 0x006441f4, InitSystem 0x00644cd0, update 0x006443d0, tick 0x00644390).
{
  const half = () => 16384; // rand() / 32768 = 0.5 for every draw
  const rock = parseDerolleBlock(ROCK_DEBRIS_BLOCK);
  check(Math.abs(rock.restitution - 0.95) < 1e-6 && Math.abs(rock.gravity - 0.4) < 1e-6 && rock.count === 1 && rock.life === 30 && rock.flags === 14, 'the rock block 0x0093aa40 decodes: restitution 0.95, gravity 0.4, one particle, delay 30, flags 14');
  check(rock.velScale.join() === '5,7.5,5' && rock.spin.join() === '1024,256,1024' && Math.abs(rock.scale - 0.4) < 1e-6, 'the rock block: velocity scale 5 / 7.5 / 5, spin 1024 / 256 / 1024, tint 0.4');
  // InitSystem with rand = 0.5 everywhere: vx = vz = 0 (m * (0.5 - 0.5)), vy = 7.5 * 0.5, spins halved.
  const e = new DerolleEmitter({ ...rock, origin: [1, 2, 3], floor: 0 }, half);
  const p = e.particles[0];
  check(e.particles.length === 1 && p.vel[0] === 0 && p.vel[1] === 3.75 && p.vel[2] === 0, 'InitSystem: vx = m (rand/32768 - 0.5), vy = m rand/32768 (rand 0.5 gives 0, 3.75, 0)');
  check(p.step[0] === 512 && p.step[1] === 128 && p.step[2] === 512 && p.pos[0] === 1 && p.pos[1] === 2 && p.pos[2] === 3 && p.delay === 30 && p.life === 1, 'InitSystem: spins trunc(spin * rand/32768), origin = the block origin, delay 30, life 1.0');
  check(e.active && e.radius === 200 && e.height === 40, 'the ctor sets radius 200, height 40, active');
  // One tick: vy = 3.75 - 0.4 - 0.1 * 3.75 = 2.975; y = 2 + 2.975; the angle grows by the step.
  e.update();
  check(Math.abs(p.vel[1] - 2.975) < 1e-5 && Math.abs(p.pos[1] - 4.975) < 1e-5 && p.delay === 29, 'update: vy loses gravity and 0.1 vy, y moves by the new vy, delay counts down');
  check(p.ang[0] === 512 && p.ang[1] === 128 && p.ang[2] === 512, 'update: the angles add the steps');
  // Horizontal drag keeps 0.93 of the speed (x and z are zero here, so use a moving block).
  const moving = new DerolleEmitter({ ...rock, velScale: [10, 0, 10], origin: [0, 0, 0], floor: -100, spin: [0, 0, 0], count: 1 }, () => 32767);
  const mp = moving.particles[0];
  const vx0 = mp.vel[0];
  moving.update();
  check(Math.abs(mp.vel[0] - vx0 * 0.93) < 1e-3 && Math.abs(mp.pos[0] - vx0 * 0.93) < 1e-3, 'update: x speed keeps 0.93 per tick (drag 0.07) and x moves by it');
  // Delay 30, then the life (1.0) counts down in one tick; the object goes inactive on that tick (tick returns true).
  const life = new DerolleEmitter({ ...rock, origin: [0, 0, 0], floor: -1000 }, half);
  let died = -1;
  for (let t = 1; t <= 40; t++) if (life.tick() && died < 0) died = t;
  check(died === 31 && life.dead && life.drawList().length === 0, 'a 30-tick delay then one life tick: the emitter is inactive at tick 31 and draws nothing');
  // Bounce: a chunk with no velocity starts 0.1 above the floor, falls 0.4 and comes back up with 0.95 of it.
  const bounce = new DerolleEmitter({ ...rock, velScale: [0, 0, 0], origin: [0, 0.1, 0], floor: 0, spin: [0, 0, 0], life: 0, count: 1 }, half);
  bounce.update();
  const bp = bounce.particles[0];
  check(bp.pos[1] === 0 && Math.abs(bp.vel[1] - 0.38) < 1e-5, 'bounce: below the floor and falling, the chunk sits on the floor and its vy becomes -0.95 vy');
  check(bp.step[0] === 0 && Math.abs(bp.vel[0]) < 1e-9, 'bounce: spins halve (truncated) and the horizontal speed keeps 0.9');
  // Count above 8 fails InitSystem (no particles, inactive).
  const bad = new DerolleEmitter({ ...rock, count: 9 }, half);
  check(bad.particles.length === 0 && !bad.active, 'InitSystem with more than 8 particles fails: no particles, inactive');
  // The rock's six debris emitters at its place (from the break tick) and the drawn chunks.
  const rockObj = { kind: 'object', type: 0x0303, index: 9, params: [0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0], group: 0, section: 0 };
  const rockPlaced = [{ entity: rockObj, name: 'rock', category: 'object', world: [10, 2, -4], yaw: 0, sectionFound: true }];
  const rflags = new Set<number>([5]);
  const rfo = new FieldObjects({ scene: { add() {}, remove() {} } } as any, rockPlaced as any, { episode: 1, floor: 0, area: 1 }, rflags);
  rfo.debrisRand = half;
  rfo.tickRocks(1);
  const debris = (rfo as any).debris as Array<{ emitter: DerolleEmitter; bml: string }>;
  check(debris.length === 6 && debris.every((d) => d.emitter.block.model === 1 && d.emitter.block.texture === 1 && d.emitter.block.floor === 2), 'the rock break makes six emitters on chunk model 1 / texture 1 with the floor at the rock');
  check(debris[0].emitter.particles[0].pos.join() === '22,9,8' && debris[1].emitter.particles[0].pos.join() === '-4,18,9', 'the emitters start at the rock plus each point (12,7,12) and (-14,16,13)');
  rfo.tickDebris(30);
  check((rfo as any).debris.length === 6, 'the rock debris lives through the 30-tick delay');
  rfo.tickDebris(1);
  check((rfo as any).debris.length === 0, 'the rock debris is dropped on the tick it goes inactive');
  // The stalactite's five emitters: particle counts 1, 2, 5, 2, 5 (the template's blocks), chunks 0, 2, 1, 2, 1.
  const sfo = new FieldObjects({ scene: { add() {}, remove() {} } } as any, [], { episode: 1, floor: 0, area: 1 }, new Set<number>());
  sfo.debrisRand = half;
  (sfo as any).shatterStalactite(7, { state: 1, x: 3, y: 4, z: 5 });
  const parts = (sfo as any).debris as Array<{ emitter: DerolleEmitter }>;
  const counts = parts.map((d) => d.emitter.particles.length).join(',');
  const chunks = parts.map((d) => d.emitter.block.model).join(',');
  const ys = parts.map((d) => d.emitter.particles[0].pos[1]).join(',');
  check(parts.length === 5 && counts === '1,2,5,2,5' && chunks === '0,2,1,2,1', 'the stalactite shatter makes five emitters: particles 1, 2, 5, 2, 5 on chunks 0, 2, 1, 2, 1');
  check(ys === '29,29,29,14,14' && parts.every((d) => d.emitter.block.floor === 4) && STALACTITE_DEBRIS_TEMPLATE.length === 95, 'the stalactite parts sit at y + 25 (parts 0..2) or y + 10 (parts 3, 4); their floor is the stalactite y');
  // A chunk's draw list: the position and the radian angles (BAMS 16384 = a quarter turn).
  const cl = new DerolleEmitter({ ...rock, origin: [1, 2, 3], floor: 0, spin: [32768, 0, 0], count: 1, life: 0 }, half);
  cl.update();
  const drawn = cl.drawList();
  check(drawn.length === 1 && Math.abs(drawn[0].ang[0] - Math.PI / 2) < 1e-9 && drawn[0].pos.length === 3, 'drawList: the angle is in radians (16384 = a quarter turn)');
  // The chunk's scale is the block's +0x60 (0.4 for the rock); flag 4 (the rock's 14) gives the life as alpha and the blend.
  const fresh = new DerolleEmitter({ ...rock, origin: [0, 0, 0], floor: -1000, count: 1 }, half).drawList()[0];
  check(fresh.scale === rock.scale && fresh.blend === true && fresh.alpha === 1 && fresh.model === rock.model, 'drawList: scale = the block scale 0.4, flag 4 blends with alpha = life (1 at the start)');
  check(drawn[0].alpha === 0, 'drawList: after one update the life is 0 (flag 4 counts it down), so the chunk is drawn at alpha 0');
  const noFlag4 = new DerolleEmitter({ ...rock, flags: 10, origin: [0, 0, 0], floor: -1000, spin: [0, 0, 0], life: 0, count: 1 }, half);
  const nf = noFlag4.drawList()[0];
  check(nf.blend === false && nf.alpha === 1, 'drawList: without flag 4 the chunk is not blended and has alpha 1');
  const fading = new DerolleEmitter({ ...rock, origin: [0, 0, 0], floor: -1000, spin: [0, 0, 0], life: 0, count: 1 }, half);
  fading.update();
  check(fading.drawList()[0].alpha === 0 && fading.particles[0].life === 0 && fading.drawList().length === 1, 'the life counts down to 0 and the chunk is still drawn, at alpha 0, while the emitter lives');
  // The exe's rand: MSVC rand (state * 0x343fd + 0x269ec3, bits 16..30): seed 1 gives 41, 18467, 6334.
  const crt = msvcRand(1);
  check(crt() === 41 && crt() === 18467 && crt() === 6334, 'msvcRand is the CRT sequence (seed 1: 41, 18467, 6334)');
  // The rock's points turn by its yaw (Ry, no translation): a quarter turn maps (12, 7, 12) to (12, 7, -12).
  const q = yawPoint([12, 7, 12], Math.PI / 2);
  check(Math.abs(q[0] - 12) < 1e-9 && q[1] === 7 && Math.abs(q[2] + 12) < 1e-9 && yawPoint([12, 7, 12], 0).join() === '12,7,12', 'yawPoint: the point turns about +Y (x = c x + s z, z = -s x + c z); yaw 0 leaves it');
  const rfy = new FieldObjects({ scene: { add() {}, remove() {} } } as any, [{ ...rockPlaced[0], yaw: Math.PI / 2 }] as any, { episode: 1, floor: 0, area: 1 }, rflags);
  rfy.debrisRand = half;
  rfy.tickRocks(1);
  const turned = (rfy as any).debris as Array<{ emitter: DerolleEmitter }>;
  check(turned.length === 6 && turned[0].emitter.particles[0].pos.join() === '22,9,-16' && turned[1].emitter.particles[0].pos.join() === '23,18,10', 'the rock at yaw pi/2: the emitters start at the rock plus the turned points (22,9,-16) and (23,18,10)');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('object collision: all checks passed');
}
