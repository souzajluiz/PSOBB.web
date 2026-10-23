// The 6x3F / 6x3E room and guard fields (client/src/formats/playerroom.ts, net/game.ts
// setPositionBody, net/lobby.ts stopBody). The room table is PsoBB.exe's
// unknown_map_data (VA 0x0097f040) and the rule is get_player_room_id (dump line 803432).
// Run: node tests/setposition.test.ts
import { setPositionBody } from '../client/src/net/game.ts';
import { stopBody } from '../client/src/net/lobby.ts';
import { MAP_CLASS, isPioneer2Map, playerRoomAt, playerRoomId, roomOfPoint, usesRoomId2 } from '../client/src/formats/playerroom.ts';
import type { MapSection } from '../client/src/formats/nrel.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// The exe's map ids (the port's area numbers) for the maps the rule names.
const FOREST1 = 0x01, FOREST2 = 0x02, CAVE1 = 0x03, DERO = 0x0c, LOBBY = 0x0f, CCA = 0x17;
const PIONEER2_EP1 = 0x00, PIONEER2_EP2 = 0x12, PIONEER2_EP4 = 0x2d, BARBARAY = 0x20;
const SEASIDE_NIGHT = 0x22, TOWER = 0x23, SEASIDE = 0x1b, TEST = 0x2e;

// The table: the exe's dword[47] read at 0x0097f040 (tools/exedata.py read 0097f040 u 47).
eq(MAP_CLASS.length, 46, 'the class table covers map ids 0..45');
eq([MAP_CLASS[0], MAP_CLASS[15], MAP_CLASS[18], MAP_CLASS[45]], [13, 14, 13, 13], 'Pioneer 2 Ep1, lobby, Pioneer 2 Ep2 and Ep4 classes');
// The hub list at 0x0097f1c8 (0, 15, 18, 45) is the same set as the Pioneer 2 classes plus the lobby.
eq([PIONEER2_EP1, PIONEER2_EP2, PIONEER2_EP4].map(isPioneer2Map), [true, true, true], 'Pioneer 2 maps');
eq(isPioneer2Map(LOBBY), false, 'the lobby is not a Pioneer 2 map');
eq(isPioneer2Map(TEST), false, 'the test map is not Pioneer 2 (INVALID class)');

// usesRoomId2: forest, CCA class (table class 6), De Rol Le and Barba Ray.
eq([FOREST1, FOREST2, CCA, SEASIDE_NIGHT, TOWER, DERO, BARBARAY].map(usesRoomId2), [true, true, true, true, true, true, true], 'room id 2 maps');
eq([CAVE1, LOBBY, 0x1c, 0x1d, 0x0b, 0x1e, 0x08].map(usesRoomId2), [false, false, false, false, false, false, false], 'room id 1 maps (seabed is class 7, not 6)');
// Table class 6 also holds Jungle North / South, Mountain and Seaside (0x18..0x1b): the table decides.
eq(usesRoomId2(SEASIDE), true, 'Seaside is class 6 in the table, so room id 2');
eq(usesRoomId2(0x18), true, 'Jungle North is class 6 in the table, so room id 2');

// get_player_room_id: Pioneer 2 is 0 on every Pioneer 2 map, the room id 2 maps read _2, the rest _1.
eq(playerRoomId(PIONEER2_EP1, 5, 7), 0, 'Pioneer 2 Ep1 is 0');
eq(playerRoomId(PIONEER2_EP2, 5, 7), 0, 'Pioneer 2 Ep2 is 0');
eq(playerRoomId(PIONEER2_EP4, 5, 7), 0, 'Pioneer 2 Ep4 is 0');
eq(playerRoomId(FOREST1, 5, 7), 7, 'forest reads _2');
eq(playerRoomId(CCA, 5, 7), 7, 'CCA reads _2');
eq(playerRoomId(CAVE1, 5, 7), 5, 'a normal map reads _1');
eq(playerRoomId(TEST, 5, 7), 5, 'the test map (INVALID) reads _1');
eq(playerRoomId(-1, 5, 7), 5, 'no map reads _1');

// The room of a point: the nearest section circle that contains it.
const section = (id: number, x: number, z: number, radius: number): MapSection =>
  ({ id, position: [x, 0, z], rotation: [0, 0, 0], radius, objects: [], entries: [] });
const sections = [section(3, 0, 0, 100), section(5, 40, 0, 30), section(9, 500, 500, 10)];
eq(roomOfPoint(sections, { x: 45, y: 0, z: 0 }), 5, 'the nearer circle wins where two overlap');
eq(roomOfPoint(sections, { x: -20, y: 0, z: 10 }), 3, 'a point in one circle');
eq(roomOfPoint(sections, { x: 300, y: 0, z: 300 }), -1, 'a point outside every circle');
eq(playerRoomAt(CAVE1, sections, { x: 45, y: 0, z: 0 }), 5, 'playerRoomAt on a normal map');
eq(playerRoomAt(PIONEER2_EP1, sections, { x: 45, y: 0, z: 0 }), 0, 'playerRoomAt on Pioneer 2 is 0');
eq(playerRoomAt(FOREST2, sections, { x: -20, y: 0, z: 10 }), 3, 'playerRoomAt on a special map');

// 6x3F body: the guard flag at +4 and the room at +0xa (packet offsets), guard off = 0.
const warp = setPositionBody({ angle: 0, floor: 4, position: { x: 1, y: 2, z: 3 } }, { guard: true, room: playerRoomId(CCA, 9, 11) });
const wdv = new DataView(warp.buffer);
eq([wdv.getUint16(0, true), wdv.getInt16(6, true)], [1, 11], '6x3F on CCA: guard 1, room _2');
const home = setPositionBody({ angle: 0, floor: 0, position: { x: 0, y: 0, z: 0 } }, { guard: false, room: playerRoomId(PIONEER2_EP1, 9, 11) });
eq([new DataView(home.buffer).getUint16(0, true), new DataView(home.buffer).getInt16(6, true)], [0, 0], '6x3F on Pioneer 2: guard 0, room 0');

// 6x3E body (dispatch_action_move_stop): guard +4, heading +6, floor +8, room +0xa, xyz +0xc.
const stop = stopBody({ x: 4, y: 5, z: 6 }, Math.PI, 3, { guard: true, room: 7 });
const sdv = new DataView(stop.buffer);
eq(stop.length, 0x14, '6x3E body is 20 bytes');
eq([sdv.getUint16(0, true), sdv.getUint16(2, true), sdv.getInt16(4, true), sdv.getInt16(6, true), sdv.getFloat32(8, true), sdv.getFloat32(12, true), sdv.getFloat32(16, true)], [1, 0x8000, 3, 7, 4, 5, 6], '6x3E guard, heading (half turn), floor, room, xyz');
const idle = stopBody({ x: 0, y: 0, z: 0 }, 0, 0, { guard: false, room: 0 });
eq(new DataView(idle.buffer).getUint16(0, true), 0, '6x3E guard off when not guarding');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('setposition: all checks passed');
