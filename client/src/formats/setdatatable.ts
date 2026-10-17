// SetDataTableOn.rel / SetDataTableOff.rel (and the *Ulti.rel tables for
// Episode 1 Ultimate): the client's table from (area, layout variation,
// entities variation) to the map files of a game floor.
// Layout ported from newserv src/Map.cc (SetDataTable::load_table_t, MIT).
//
// REL root -> u32 offset of the area table, which runs up to the root:
//   area:     {u32 layouts_offset, u32 layout_count}
//   layout:   {u32 entities_offset, u32 entities_count}
//   entities: {u32 object_list_basename, u32 enemy_and_event_list_basename,
//              u32 area_setup_filename} (C string offsets)
//
// The server picks the two variation numbers per floor and sends them in 64
// (S_JoinGame_BB_64.variations). The game then loads:
//   objects: <object basename>o.dat, enemies: <enemy basename>e.dat, events: <enemy basename>.evt
//   with "_s" / "_c1" / "_d" before ".dat" on floor 0 in solo / challenge /
//   battle mode (newserv SetDataTable::map_filename_for_variation).

import { RelFile } from './rel.ts';

export interface SetDataTableEntry {
  objects: string; // e.g. "map_cave01_00_01"
  enemies: string;
  setup: string; // e.g. "map_cave01_00"
}

// [area][layout][entities]
export type SetDataTable = SetDataTableEntry[][][];

export function parseSetDataTable(data: Uint8Array): SetDataTable {
  const rel = new RelFile(data);
  const areaTable = rel.u32(rel.root);
  const out: SetDataTable = [];
  for (let a = areaTable; a + 8 <= rel.root; a += 8) {
    const layoutsOffset = rel.u32(a);
    const layoutCount = rel.u32(a + 4);
    const layouts: SetDataTableEntry[][] = [];
    for (let l = 0; l < layoutCount; l++) {
      const entitiesOffset = rel.u32(layoutsOffset + l * 8);
      const entitiesCount = rel.u32(layoutsOffset + l * 8 + 4);
      const entities: SetDataTableEntry[] = [];
      for (let e = 0; e < entitiesCount; e++) {
        const o = entitiesOffset + e * 12;
        entities.push({ objects: rel.cstring(rel.u32(o)), enemies: rel.cstring(rel.u32(o + 4)), setup: rel.cstring(rel.u32(o + 8)) });
      }
      layouts.push(entities);
    }
    out.push(layouts);
  }
  return out;
}

export type GameMode = 'normal' | 'solo' | 'challenge' | 'battle';

export interface FloorFiles {
  area: number;
  setup: string; // area setup name from the table
  objects: string; // o.dat file name
  enemies: string; // e.dat file name
  events: string; // .evt file name
}

export function floorFiles(table: SetDataTable, area: number, layout: number, entities: number, floor: number, mode: GameMode = 'normal'): FloorFiles | null {
  const e = table[area]?.[layout]?.[entities];
  if (!e) return null;
  const suffix = floor !== 0 ? '' : { normal: '', solo: '_s', challenge: '_c1', battle: '_d' }[mode];
  return {
    area,
    setup: e.setup,
    objects: `${e.objects}o${suffix}.dat`,
    enemies: `${e.enemies}e${suffix}.dat`,
    events: `${e.enemies}${suffix}.evt`,
  };
}

// Render geometry (scene/*n.rel) for an area setup name. Most setups name the
// geometry directly (map_forest01 -> map_forest01n.rel, map_cave01_00 ->
// map_cave01_00n.rel); the others add "_00" (map_city00 -> map_city00_00n.rel,
// map_labo00, the Episode 2 jungle maps), and boss04 is drawn from
// map_darkfalz00n.rel. Same pairing as formats/setdata.ts (setVariantsForMap).
export function geometryCandidates(setup: string): string[] {
  if (setup === 'map_boss04') return ['map_darkfalz00n.rel'];
  return [`${setup}n.rel`, `${setup}_00n.rel`];
}

// How many layout / entities variations the server may pick for an area in
// free play (newserv SetDataTable::num_free_play_variations_for_floor; the
// table holds more, e.g. cave layouts 03..05 are quest-only). Pairs per area
// 0x00..0x2E: [layouts, entities].
// prettier-ignore
const FREE_PLAY_ON = [
  1, 1, 1, 5, 1, 5, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 10, 1, 1, 1, 1, 1,
  1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 1, 3, 1, 3, 1, 3, 2, 2, 1, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 3, 1, 1, 3, 3, 1, 1, 1, 1, 1, 1, 1,
];
// prettier-ignore
const FREE_PLAY_OFF = [
  1, 1, 1, 3, 1, 3, 3, 1, 3, 1, 3, 1, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 10, 1, 1, 1, 1, 1,
  1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 1, 3, 1, 3, 1, 3, 2, 2, 1, 3, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 3, 1, 1, 3, 3, 1, 1, 1, 1, 1, 1, 1,
];

export function freePlayVariations(table: SetDataTable, area: number, solo: boolean): { layouts: number; entities: number } {
  const counts = solo ? FREE_PLAY_OFF : FREE_PLAY_ON;
  const t = table[area];
  if (!t || area * 2 + 1 >= counts.length) return { layouts: 1, entities: 1 };
  return { layouts: Math.min(t.length, counts[area * 2]), entities: Math.min(t[0]?.length ?? 1, counts[area * 2 + 1]) };
}
