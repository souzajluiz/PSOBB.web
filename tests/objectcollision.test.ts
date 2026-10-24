// Field objects that block the player (containers, jungle rocks, doors):
//  1. the flag gate of CheckTwoHitboxCollision_007b5e40 (boxPairActive): enabled
//     bits, shared category bits, exclusive pairs; the player's flag word;
//  2. the box shapes against the player's sphere: a sphere container, a rounded
//     rock box, bit 0x100 (pass-through), a disabled box;
//  3. the step test (IsPlayerAboutToCollide_00694198): a box blocks a step toward
//     it, not a step away from it;
//  4. the placed solids of a floor (collectFieldSolids): containers and rocks are
//     solids, doors are not; a solid's box is turned by its yaw;
//  5. the drop spot's body test (spotHitsBody) for a sphere body.
//
// Run: node tests/objectcollision.test.ts
import type { PlacedEntity, ObjectSet } from '../client/src/formats/setdata.ts';
import type { MapCollision } from '../client/src/formats/crel.ts';
import { boxPairActive, CollisionWorld, OBJECT_BOX_FLAGS, PLAYER_BOX_FLAGS, PLAYER_RADIUS, type Obstacle } from '../client/src/render/collision.ts';
import { collectFieldSolids, solidObstacle, type FieldSolid } from '../client/src/render/fieldobjects.ts';
import { spotHitsBody } from '../client/src/net/dropspot.ts';
import { CHILD_COLLISION_LINKS, COLLISION_SITES, COLLISION_TABLES, ENEMY_COLLISION_LINKS, TYPE_COLLISION_TABLES } from '../client/src/formats/collisionboxes.gen.ts';
import { boxTargetable, childBoxTable, enemyBoxTable, isTargetable, slotSetType, slotVariant } from '../client/src/formats/enemyboxes.ts';
import { rowsAimHeight, rowsRadius } from '../client/src/combat/techfire.ts';

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

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('object collision: all checks passed');
}
