// Free-play map set data: map_<area>[_<layout>]_<entities>e.dat (enemies) and
// ...o.dat (objects). Same format as Tethealla's map/ folder.
//
// Layouts ported from newserv (MIT license) src/Map.hh (ObjectSetEntry,
// EnemySetEntry) and src/Map.cc (MapFile::set_*_sets_for_floor,
// add_enemy_and_children); world transform from src/ChatCommands.cc.
//
// A free-play file is a bare array of fixed-size entries, no header:
//
// ObjectSetEntry (0x44)                 EnemySetEntry (0x48)
//   00 u16 base_type                      00 u16 base_type
//   02 u16 set_flags (runtime)            02 u16 set_flags (runtime)
//   04 u16 index (runtime)                04 u16 index (runtime)
//   06 u16 floor                          06 u16 num_children (0 = default)
//   08 u16 entity_id (runtime)            08 u16 floor
//   0A u16 group                          0A u16 entity_id (runtime)
//   0C u16 room (= n.rel section id)      0C u16 room (= n.rel section id)
//   0E u16 unknown_a3                     0E u16 wave_number
//   10 f32 pos[3] (relative to room)      10 u16 wave_number2
//   1C i32 angle[3] (BAMS)                12 u16 unknown_a1
//   28 f32 param1..3                      14 f32 pos[3] (relative to room)
//   34 i32 param4..6                      20 i32 angle[3] (BAMS)
//   40 u32 (client pointer)               2C f32 param1..5
//                                         40 i16 param6, param7
//                                         44 u32 (client pointer)

import { ENEMY_DEFINITIONS, ENEMY_PARAM_NAMES, ENEMY_TYPE_NAMES, OBJECT_DEFINITIONS, OBJECT_PARAM_NAMES } from './entitynames.ts';

export const OBJECT_SET_SIZE = 0x44;
export const ENEMY_SET_SIZE = 0x48;
const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

export type Vec3 = [number, number, number];

interface SetEntryBase {
  index: number;
  type: number;
  floor: number;
  section: number; // "room" in newserv; matches MapSection.id in the n.rel
  position: Vec3; // relative to the section
  rotation: Vec3; // raw BAMS (0x10000 = 360 degrees)
  // Set by the quest editor only (questeditor/model.ts): the record's bytes as
  // they were read, and the chunk floor they were read under, so a write can
  // keep the fields the editor does not model. Absent for new entries.
  raw?: Uint8Array;
  homeFloor?: number;
}

export interface ObjectSet extends SetEntryBase {
  kind: 'object';
  group: number;
  unknownA3: number;
  params: [number, number, number, number, number, number]; // 3 floats, 3 i32
}

export interface EnemySet extends SetEntryBase {
  kind: 'enemy';
  numChildren: number;
  wave: number;
  wave2: number;
  unknownA1: number;
  params: [number, number, number, number, number, number, number]; // 5 floats, 2 i16
}

export type SetEntity = ObjectSet | EnemySet;

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

function checkSize(data: Uint8Array, size: number, what: string): number {
  if (data.length % size) throw new Error(`${what} file size ${data.length} is not a multiple of 0x${size.toString(16)}`);
  return data.length / size;
}

export function parseObjectSets(data: Uint8Array): ObjectSet[] {
  const n = checkSize(data, OBJECT_SET_SIZE, 'object set');
  const dv = view(data);
  const out: ObjectSet[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * OBJECT_SET_SIZE;
    const u16 = (k: number) => dv.getUint16(o + k, true);
    const f32 = (k: number) => dv.getFloat32(o + k, true);
    const i32 = (k: number) => dv.getInt32(o + k, true);
    out.push({
      kind: 'object',
      index: i,
      type: u16(0x00),
      floor: u16(0x06),
      group: u16(0x0a),
      section: u16(0x0c),
      unknownA3: u16(0x0e),
      position: [f32(0x10), f32(0x14), f32(0x18)],
      rotation: [i32(0x1c), i32(0x20), i32(0x24)],
      params: [f32(0x28), f32(0x2c), f32(0x30), i32(0x34), i32(0x38), i32(0x3c)],
    });
  }
  return out;
}

export function parseEnemySets(data: Uint8Array): EnemySet[] {
  const n = checkSize(data, ENEMY_SET_SIZE, 'enemy set');
  const dv = view(data);
  const out: EnemySet[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * ENEMY_SET_SIZE;
    const u16 = (k: number) => dv.getUint16(o + k, true);
    const i16 = (k: number) => dv.getInt16(o + k, true);
    const f32 = (k: number) => dv.getFloat32(o + k, true);
    const i32 = (k: number) => dv.getInt32(o + k, true);
    out.push({
      kind: 'enemy',
      index: i,
      type: u16(0x00),
      numChildren: u16(0x06),
      floor: u16(0x08),
      section: u16(0x0c),
      wave: u16(0x0e),
      wave2: u16(0x10),
      unknownA1: u16(0x12),
      position: [f32(0x14), f32(0x18), f32(0x1c)],
      rotation: [i32(0x20), i32(0x24), i32(0x28)],
      params: [f32(0x2c), f32(0x30), f32(0x34), f32(0x38), f32(0x3c), i16(0x40), i16(0x42)],
    });
  }
  return out;
}

// --- File names -------------------------------------------------------------

export interface SetFileName {
  name: string;
  key: string; // e.g. "map_cave01_00_01", "map_jungle01_00_off"
  kind: 'enemy' | 'object';
  flavor: string; // "" or "_s", "_c1", "_d" (mode-specific variants, e.g. solo/challenge)
}

export function parseSetFileName(name: string): SetFileName | null {
  const m = /^(map_.+)([eo])(_s|_c\d|_d)?\.dat$/.exec(name);
  if (!m) return null;
  return { name, key: m[1], kind: m[2] === 'e' ? 'enemy' : 'object', flavor: m[3] ?? '' };
}

export function parseSetFile(name: string, data: Uint8Array): SetEntity[] {
  const f = parseSetFileName(name);
  if (!f) throw new Error(`not a set data file name: ${name}`);
  return f.kind === 'enemy' ? parseEnemySets(data) : parseObjectSets(data);
}

export interface SetVariant {
  label: string; // e.g. "00", "01_off", "00_s"
  enemies: string | null; // file name
  objects: string | null;
}

const stemOf = (nrel: string) => nrel.replace(/n\.rel$/, '');

// Set data variants that belong to a render map (map_*n.rel).
//
// - Areas with layout variants: map_cave01_00n.rel <-> map_cave01_00_NN{e,o}.dat
// - Areas without: map_forest01n.rel <-> map_forest01_NN{e,o}.dat
// - Exact matches: map_city00_00n.rel <-> map_city00_00{e,o}.dat, map_boss01n.rel <-> map_boss01{e,o}.dat
// - Some Episode 2 areas have one geometry with a "_00" suffix but no layout
//   variants: map_jungle01_00n.rel <-> map_jungle01_{00,01,02}{e,o}.dat. Used
//   when the n.rel is the only one with that base and no S_NN keys exist.
// - "_off" keys are the offline (single player) sets; "_s"/"_c1"/"_d" flavors
//   are kept as separate variants.
// - map_darkfalz00n.rel uses map_boss04*.dat; the "map_a*" maps (alternate
//   Episode 1 geometry) fall back to the sets of the map without the "a".
export function setVariantsForMap(nrelName: string, setFiles: Iterable<string>, nrelNames: Iterable<string> = []): SetVariant[] {
  const files = [...setFiles].map(parseSetFileName).filter((f): f is SetFileName => !!f);
  const stems = [...nrelNames].map(stemOf);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Returns the matching files and the prefix that labels are relative to.
  const find = (stem: string): { base: string; picked: SetFileName[] } => {
    const keysUnder = (prefix: string) => {
      const re = new RegExp(`^${esc(prefix)}(_\\d\\d)?(_off)?$`);
      return files.filter((f) => re.test(f.key));
    };
    const base = /^(.*)_\d\d$/.exec(stem)?.[1];
    if (base && !files.some((f) => new RegExp(`^${esc(stem)}_\\d\\d`).test(f.key))) {
      const siblings = stems.filter((s) => s !== stem && new RegExp(`^${esc(base)}_\\d\\d$`).test(s));
      if (!siblings.length) return { base, picked: keysUnder(base) };
    }
    return { base: stem, picked: keysUnder(stem) };
  };
  let stem = stemOf(nrelName);
  if (stem === 'map_darkfalz00') stem = 'map_boss04';
  let { base, picked } = find(stem);
  if (!picked.length && /^map_a[a-z]/.test(stem)) ({ base, picked } = find(`map_${stem.slice(5)}`));

  const variants = new Map<string, SetVariant>();
  for (const f of picked) {
    const label = (f.key === base ? 'default' : f.key.slice(base.length + 1)) + f.flavor;
    const v = variants.get(label) ?? { label, enemies: null, objects: null };
    if (f.kind === 'enemy') v.enemies = f.name;
    else v.objects = f.name;
    variants.set(label, v);
  }
  // Plain variants first, then _off, then flavored ones.
  const rank = (l: string) => (l.includes('_off') ? 1 : 0) + (/_(s|c\d|d)$/.test(l) ? 2 : 0);
  return [...variants.values()].sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

// --- Areas and names ----------------------------------------------------------

// newserv area numbers (Map.cc A_* flags, StaticGameData) by map name.
const AREA_BY_MAP: Record<string, number> = {
  city00: 0x00, forest01: 0x01, forest02: 0x02, cave01: 0x03, cave02: 0x04, cave03: 0x05,
  machine01: 0x06, machine02: 0x07, ancient01: 0x08, ancient02: 0x09, ancient03: 0x0a,
  boss01: 0x0b, boss02: 0x0c, boss03: 0x0d, boss04: 0x0e, darkfalz00: 0x0e, lobby: 0x0f,
  labo00: 0x12, ruins01: 0x13, ruins02: 0x14, space01: 0x15, space02: 0x16,
  jungle01: 0x17, jungle02: 0x18, jungle03: 0x19, jungle04: 0x1a, jungle05: 0x1b,
  seabed01: 0x1c, seabed02: 0x1d, boss05: 0x1e, boss06: 0x1f, boss07: 0x20, boss08: 0x21,
  jungle06: 0x22, jungle07: 0x23, crater01: 0x28, desert01: 0x29, desert02: 0x2a, desert03: 0x2b,
  boss09: 0x2c, city02: 0x2d, test01: 0x2e,
};

// "map_cave01_00n.rel" / "map_cave01_00_01e.dat" -> 3. Returns null if unknown.
export function areaForMap(name: string): number | null {
  const m = /^map_([a-z]+\d*)(?:_(\d\d))?/.exec(name);
  if (!m) return null;
  let key = m[1];
  if (!(key in AREA_BY_MAP) && key.startsWith('a') && key.slice(1) in AREA_BY_MAP) key = key.slice(1); // map_aforest01
  if (key === 'wilds01') return 0x24 + Number(m[2] ?? 0); // Crater east/west/south/north = layouts 00..03
  return AREA_BY_MAP[key] ?? null;
}

const hasArea = (mask: number, area: number) => Math.floor(mask / 2 ** area) % 2 === 1;

function lookup(defs: ReadonlyArray<readonly [number, number, string]>, type: number, area: number | null): string {
  const rows = defs.filter((d) => d[0] === type);
  if (area !== null) {
    const hit = rows.find((d) => hasArea(d[1], area));
    if (hit) return hit[2];
  }
  const names = [...new Set(rows.map((d) => d[2]))].sort();
  return names.length ? names.join('/') : `__UNKNOWN_ENTITY_${type.toString(16).toUpperCase().padStart(4, '0')}__`;
}

// Client class names, as newserv's MapFile::name_for_{object,enemy}_type with version BB.
export const objectTypeName = (type: number, area: number | null = null): string => lookup(OBJECT_DEFINITIONS, type, area);
export const enemyTypeClassName = (type: number, area: number | null = null): string => lookup(ENEMY_DEFINITIONS, type, area);

// In-game enemy name for a set entry (root enemy only; children are not listed).
// Port of the base_type switch in newserv's Map::add_enemy_and_children.
export function enemyKind(e: EnemySet, area: number | null): string {
  const p2 = e.params[1];
  const p6 = e.params[5];
  const pick = (types: string[]) => types[Math.min(Math.max(p6, 0), types.length - 1)];
  const a = area ?? 0;
  switch (e.type) {
    case 0x40: return 'HILDEBEAR';
    case 0x41: return a < 0x24 ? 'RAG_RAPPY' : a <= 0x28 ? 'SAND_RAPPY_CRATER' : 'SAND_RAPPY_DESERT';
    case 0x42: return 'MONEST';
    case 0x43: return p2 >= 1 ? 'BARBAROUS_WOLF' : 'SAVAGE_WOLF';
    case 0x44: return pick(['BOOMA', 'GOBOOMA', 'GIGOBOOMA']);
    case 0x60: return 'GRASS_ASSASSIN';
    case 0x61: return a === 0x23 ? 'DEL_LILY' : 'POISON_LILY';
    case 0x62: return 'NANO_DRAGON';
    case 0x63: return pick(['EVIL_SHARK', 'PAL_SHARK', 'GUIL_SHARK']);
    case 0x64: return 'POFUILLY_SLIME';
    case 0x65: return 'PAN_ARMS';
    case 0x80: return p6 !== 0 ? 'GILLCHIC' : 'DUBCHIC';
    case 0x81: return 'GARANZ';
    case 0x82: return p2 >= 1 ? 'SINOW_GOLD' : 'SINOW_BEAT';
    case 0x83: return 'CANADINE';
    case 0x84: return 'CANANE';
    case 0x85: return 'DUBWITCH';
    case 0xa0: return 'DELSABER';
    case 0xa1: return 'CHAOS_SORCERER';
    case 0xa2: return 'DARK_GUNNER';
    case 0xa3: return 'DARK_GUNNER_CONTROL';
    case 0xa4: return 'CHAOS_BRINGER';
    case 0xa5: return 'DARK_BELRA';
    case 0xa6: return pick(['DIMENIAN', 'LA_DIMENIAN', 'SO_DIMENIAN']);
    case 0xa7: return 'BULCLAW';
    case 0xa8: return 'CLAW';
    case 0xc0: return a < 0x12 ? 'DRAGON' : 'GAL_GRYPHON';
    case 0xc1: return 'DE_ROL_LE';
    case 0xc2: return 'VOL_OPT_1';
    case 0xc5: return 'VOL_OPT_2';
    case 0xc8: return 'DARK_FALZ_3';
    case 0xca: return 'OLGA_FLOW_2';
    case 0xcb: return 'BARBA_RAY';
    case 0xcc: return 'GOL_DRAGON';
    case 0xd4: return p6 > 0 ? 'SINOW_SPIGELL' : 'SINOW_BERILL';
    case 0xd5: return p6 > 0 ? 'MERILTAS' : 'MERILLIA';
    case 0xd6: return ['MERICAROL', 'MERIKLE', 'MERICUS'][p6] ?? 'MERICARAND';
    case 0xd7: return p6 > 0 ? 'ZOL_GIBBON' : 'UL_GIBBON';
    case 0xd8: return 'GIBBLES';
    case 0xd9: return 'GEE';
    case 0xda: return 'GI_GUE';
    case 0xdb: return 'DELDEPTH';
    case 0xdc: return 'DELBITER';
    case 0xdd: return p6 > 0 ? 'DOLMDARL' : 'DOLMOLM';
    case 0xde: return 'MORFOS';
    case 0xdf: return 'RECOBOX';
    case 0xe0: return a === 0x23 ? 'EPSILON' : p6 > 0 ? 'SINOW_ZELE' : 'SINOW_ZOA';
    case 0xe1: return 'ILL_GILL';
    case 0x110: return 'ASTARK';
    case 0x111: return a <= 0x28 ? (p2 ? 'YOWIE_CRATER' : 'SATELLITE_LIZARD_CRATER') : p2 ? 'YOWIE_DESERT' : 'SATELLITE_LIZARD_DESERT';
    case 0x112: return 'MERISSA_A';
    case 0x113: return 'GIRTABLULU';
    case 0x114: return a <= 0x28 ? 'ZU_CRATER' : 'ZU_DESERT';
    case 0x115: return pick(['BOOTA', 'ZE_BOOTA', 'BA_BOOTA']);
    case 0x116: return 'DORPHON';
    case 0x117: return pick(['GORAN', 'PYRO_GORAN', 'GORAN_DETONATOR']);
    case 0x119: return p6 & 1 ? 'SHAMBERTIN' : 'SAINT_MILION';
  }
  if ((e.type >= 0x01 && e.type <= 0x33) || e.type === 0x45 || e.type === 0x46 || e.type === 0xa9 ||
      (e.type >= 0xd0 && e.type <= 0xd3) || (e.type >= 0xf0 && e.type <= 0x100)) return 'NON_ENEMY_NPC';
  return 'UNKNOWN';
}

// Display name: in-game name if known ("Savage Wolf"), else the client class name.
export function enemyDisplayName(e: EnemySet, area: number | null): string {
  const kind = enemyKind(e, area);
  const n = ENEMY_TYPE_NAMES[kind];
  if (n && kind !== 'UNKNOWN' && kind !== 'NON_ENEMY_NPC') return n[0];
  return enemyTypeClassName(e.type, area);
}

export function entityName(e: SetEntity, area: number | null): string {
  return e.kind === 'enemy' ? enemyDisplayName(e, area) : objectTypeName(e.type, area);
}

// --- Parameter names -----------------------------------------------------------------

// Labels for the params of an entity, in .dat order: objects have param1..6 (3
// floats, 3 ints), enemies param1..7 (5 floats, 2 int16). newserv's comments
// name most of them (ENTITY_PARAM_NAMES in entitynames.ts, generated). The
// enemies that enemyKind / enemymodels.ts decode fill the gaps here, by base
// type. A parameter nobody documents is "Param n (f)", "(i)" or "(i16)".
const PORT_ENEMY_PARAMS: Readonly<Record<number, Readonly<Record<number, string>>>> = {
  0x40: { 6: 'Hildeblue if >= 1' },
  0x41: { 6: 'Rare if odd' },
  0x43: { 2: 'Barbarous if >= 1' },
  0x44: { 6: 'Variant: 0 Booma, 1 Gobooma, 2 Gigobooma' },
  0x63: { 6: 'Variant: 0 Evil, 1 Pal, 2 Guil Shark' },
  0x80: { 6: 'Gillchic if nonzero' },
  0x82: { 2: 'Gold if >= 1' },
  0xa6: { 6: 'Variant: 0 Dimenian, 1 La, 2 So' },
  0xd4: { 1: 'Ground if < 1 or in [2, 3)', 6: 'Spigell if > 0' },
  0xd5: { 6: 'Meriltas if > 0' },
  0xd6: { 6: 'Variant: 0 Mericarol, 1 Merikle, 2 Mericus' },
  0xd7: { 6: 'Zol Gibbon if > 0' },
  0xdd: { 6: 'Dolmdarl if > 0' },
  0x115: { 6: 'Variant: 0 Boota, 1 Ze Boota, 2 Ba Boota' },
  0x117: { 6: 'Variant: 0 Goran, 1 Pyro Goran, 2 Goran Detonator' },
  0x119: { 6: 'Shambertin if odd' },
};

// The client class name of a type (newserv's name in the definition tables), the
// key of the generated labels. Null when the rows for the type disagree.
function classNameOf(defs: ReadonlyArray<readonly [number, number, string]>, type: number, area: number | null): string | null {
  const rows = defs.filter((d) => d[0] === type);
  const hit = area !== null ? rows.find((d) => hasArea(d[1], area)) : undefined;
  if (hit) return hit[2];
  const names = new Set(rows.map((d) => d[2]));
  return names.size === 1 ? [...names][0] : null;
}

export function entityParamLabels(e: SetEntity, area: number | null): string[] {
  const isEnemy = e.kind === 'enemy';
  const count = isEnemy ? 7 : 6;
  const cls = classNameOf(isEnemy ? ENEMY_DEFINITIONS : OBJECT_DEFINITIONS, e.type, area);
  const documented = (cls && (isEnemy ? ENEMY_PARAM_NAMES : OBJECT_PARAM_NAMES)[cls]) || [];
  const port = isEnemy ? (PORT_ENEMY_PARAMS[e.type] ?? {}) : {};
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const named = port[i + 1] ?? documented[i];
    const kind = isEnemy ? (i < 5 ? 'f' : 'i16') : i < 3 ? 'f' : 'i';
    out.push(named ? `${named} (param ${i + 1})` : `Param ${i + 1} (${kind})`);
  }
  return out;
}

// --- World placement -----------------------------------------------------------

export interface SectionTransform {
  id: number;
  position: Vec3;
  rotation: Vec3; // radians (as in nrel.ts MapSection)
}

// Section-relative position -> world. The game rotates about X, then Z, then Y,
// then translates (newserv ChatCommands.cc, nearest-entity lookup).
export function sectionToWorld(section: SectionTransform, p: Vec3): Vec3 {
  let [x, y, z] = p;
  const [ax, ay, az] = section.rotation;
  if (ax) [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  if (az) [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  if (ay) [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  return [x + section.position[0], y + section.position[1], z + section.position[2]];
}

export interface PlacedEntity {
  entity: SetEntity;
  name: string;
  category: 'enemy' | 'npc' | 'object';
  world: Vec3;
  yaw: number; // radians, entity Y angle plus section Y angle
  sectionFound: boolean;
}

export function placeEntities(entities: SetEntity[], sections: SectionTransform[], area: number | null): PlacedEntity[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  return entities.map((entity) => {
    const s = byId.get(entity.section);
    return {
      entity,
      name: entityName(entity, area),
      category: entity.kind === 'object' ? 'object' : enemyKind(entity, area) === 'NON_ENEMY_NPC' ? 'npc' : 'enemy',
      world: s ? sectionToWorld(s, entity.position) : entity.position,
      yaw: entity.rotation[1] * BAMS_TO_RAD + (s ? s.rotation[1] : 0),
      sectionFound: !!s,
    };
  });
}
