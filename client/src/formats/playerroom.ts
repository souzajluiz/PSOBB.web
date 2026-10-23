// The room id a player sends with 6x3F (set position) and 6x3E (move stop).
//
// PsoBB.exe get_player_room_id (dump line 803432): Pioneer 2 (map_is_pioneer2_, map
// class 0xd) gives 0; a player (idx < 0x1000) on Forest 1 / Forest 2, the CCA class
// (is_cca_tower_seanight_map_, class 6), De Rol Le or Barba Ray reads unknown_room_id_2,
// every other player reads unknown_room_id_1; an enemy reads _1. set_player_room_id
// (dump line 803404) writes _1 on every map and _2 as well on the same special maps,
// so on those maps the value read is the one written last through set_player_room_id.
//
// The map class table is unknown_map_data (dword[47], VA 0x0097f040, read with
// tools/exedata.py): indexed by the exe's map_id, which is the port's area number
// (render/gameview.ts AREA_NAMES: Forest 1 = 0x01, Central Control Area = 0x17, ...).
// The table gives class 6 to 0x17 (CCA), 0x18..0x1b (Jungle North / South, Mountain,
// Seaside) and 0x22 / 0x23 (Seaside Night, Tower). The predicate's name covers the CCA,
// the Tower and Seaside Night only; the table also has the other three outdoor maps in
// class 6, so they read _2 too (the table, not the name, is what the code runs).
//
// The port tracks one room value per point (the field's section circle, roomOfPoint),
// not the exe's two fields. So the port passes that value as both _1 and _2. The writes
// that set _1 alone in the exe (initdata param6 0x10000 and the Sinowberill challenge's
// section) are not modelled: on the special maps the exe would report _2 there, ASSUMED
// to be a stale value the port does not reproduce.

import type { MapSection } from './nrel.ts';

// unknown_map_data[map_id], map_id 0..45 (46 = test, INVALID).
export const MAP_CLASS: readonly number[] = [
  13, 0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 11, 11, 11, 11, 14, 12, 12, 13, 4, 4, 5, 5, 6, 6, 6, 6, 6, 7, 7, 11, 11, 11, 11, 6, 6, 8, 8, 8, 8, 9, 10, 10, 10, 11, 13,
];

const CLASS_PIONEER2 = 13; // 0xd: map_is_pioneer2
const CLASS_CCA_TOWER_SEANIGHT = 6; // is_cca_tower_seanight_map
const MAP_FOREST1 = 1;
const MAP_FOREST2 = 2;
const MAP_DEROLLE = 12;
const MAP_BARBARAY = 32;

// map_is_pioneer2 on the map: the room is 0 there (Pioneer 2 Ep1, Ep2 "Lab", Ep4).
export function isPioneer2Map(area: number): boolean {
  return MAP_CLASS[area] === CLASS_PIONEER2;
}

// The map whose player room reads unknown_room_id_2 (get_player_room_id).
export function usesRoomId2(area: number): boolean {
  if (area === MAP_FOREST1 || area === MAP_FOREST2) return true;
  if (area === MAP_DEROLLE || area === MAP_BARBARAY) return true;
  return MAP_CLASS[area] === CLASS_CCA_TOWER_SEANIGHT;
}

// get_player_room_id for a player (idx < 0x1000) on `area`.
export function playerRoomId(area: number, roomId1: number, roomId2: number): number {
  if (isPioneer2Map(area)) return 0;
  return usesRoomId2(area) ? roomId2 : roomId1;
}

// The field's section (map section circle) a point is in, nearest first; -1 if none.
// (render/gamefield.ts roomAt uses the same rule.)
export function roomOfPoint(sections: readonly MapSection[], pos: { x: number; y: number; z: number }): number {
  let best = -1;
  let bestD = Infinity;
  for (const s of sections) {
    const d = Math.hypot(s.position[0] - pos.x, s.position[2] - pos.z);
    if (d <= s.radius && d < bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}

// The room a player sends at `pos` on `area` (one value for both exe fields).
export function playerRoomAt(area: number, sections: readonly MapSection[], pos: { x: number; y: number; z: number }): number {
  const r = roomOfPoint(sections, pos);
  return playerRoomId(area, r, r);
}
