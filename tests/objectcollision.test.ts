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

// 4. Drop spot body test on a sphere (FUN_0083dbd4 with the spot radius 3).
const sphereBody = { x: 10, z: 0, yaw: 0, halfX: 9, halfZ: 9, sphere: true };
check(spotHitsBody({ x: 0, y: 0, z: 0 }, sphereBody), 'a spot 10 from a sphere of radius 9 is hit (3 + 9 = 12)');
check(!spotHitsBody({ x: 0, y: 0, z: 0 }, { ...sphereBody, x: 12.5 }), 'a spot 12.5 from the same sphere is clear');
check(spotHitsBody({ x: 0, y: 0, z: 0 }, { x: 10, z: 0, yaw: 0, halfX: 9, halfZ: 9 }), 'a box body still uses the rounded rectangle');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('object collision: all checks passed');
}
