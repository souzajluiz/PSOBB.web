// Map object set files (`map_<area>o.dat`, inside data.gsl): a bare array of
// 0x44-byte ObjectSetEntry records (newserv src/Map.hh, MIT license):
//   00 u16 base_type   06 u16 floor   0C u16 room
//   10 f32 x, y, z     position relative to the room (n.rel section with that id)
//   1C i32 ax, ay, az  angles, BAMS (0x10000 = 360 degrees)
//   28 f32 param1..3   34 i32 param4..6   40 u32 runtime pointer
//
// Type 0 is TObjPlayerSet: where a player starts on that floor.
//   param1 = client id, param4 = source (0 = arriving from a lower floor,
//   1 = returning from a higher floor, other = only used by quest warps).
// The lobby files (map_lobby_NNo.dat) hold 12 of them, one per client id 0..11.

export interface ObjectSetEntry {
  type: number;
  floor: number;
  group: number;
  room: number;
  position: [number, number, number];
  angle: [number, number, number]; // BAMS
  fparams: [number, number, number];
  iparams: [number, number, number];
}

export function parseObjectSets(data: Uint8Array): ObjectSetEntry[] {
  if (data.length % 0x44 !== 0) throw new Error(`object set file size ${data.length} is not a multiple of 0x44`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: ObjectSetEntry[] = [];
  for (let o = 0; o < data.length; o += 0x44) {
    out.push({
      type: dv.getUint16(o, true),
      floor: dv.getUint16(o + 6, true),
      group: dv.getUint16(o + 0x0a, true),
      room: dv.getUint16(o + 0x0c, true),
      position: [dv.getFloat32(o + 0x10, true), dv.getFloat32(o + 0x14, true), dv.getFloat32(o + 0x18, true)],
      angle: [dv.getInt32(o + 0x1c, true), dv.getInt32(o + 0x20, true), dv.getInt32(o + 0x24, true)],
      fparams: [dv.getFloat32(o + 0x28, true), dv.getFloat32(o + 0x2c, true), dv.getFloat32(o + 0x30, true)],
      iparams: [dv.getInt32(o + 0x34, true), dv.getInt32(o + 0x38, true), dv.getInt32(o + 0x3c, true)],
    });
  }
  return out;
}

export interface PlayerSpawn {
  clientId: number;
  source: number;
  room: number;
  position: [number, number, number]; // room-relative
  angleY: number; // BAMS
}

export const OBJ_PLAYER_SET = 0x0000;

export function playerSpawns(entries: ObjectSetEntry[]): PlayerSpawn[] {
  return entries
    .filter((e) => e.type === OBJ_PLAYER_SET)
    .map((e) => ({
      clientId: Math.trunc(e.fparams[0]),
      source: Math.max(0, e.iparams[0]),
      room: e.room,
      position: e.position,
      angleY: e.angle[1],
    }));
}

// Room (n.rel section) placement, needed to turn room-relative positions into world space.
export interface RoomTransform {
  id: number;
  position: [number, number, number];
  rotation: [number, number, number]; // radians
}

// World position of a room-relative point: rotate by the room's angles, then translate.
// Map rooms only use the Y rotation in practice (checked across all n.rel files);
// X/Z rotation is applied in the same X->Y->Z order the map renderer uses.
export function roomToWorld(p: [number, number, number], room: RoomTransform | undefined): [number, number, number] {
  if (!room) return [p[0], p[1], p[2]];
  let [x, y, z] = p;
  const [rx, ry, rz] = room.rotation;
  if (rx) [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  if (ry) [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  if (rz) [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + room.position[0], y + room.position[1], z + room.position[2]];
}
