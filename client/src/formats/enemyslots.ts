// Enemy entity ids: every enemy set entry of a floor expands into one or more
// enemy slots (a Monest and its 30 Mothmants, a Pan Arms and its two halves,
// the boss parts...). The client numbers the slots of all floors in order;
// slot i of the game is entity 0x1000 + i. newserv (MapState) numbers them
// the same way and checks every 6x0A / 6x46 / 6x60 / 6xC8 against its own
// list, so the expansion must match exactly.
//
// Port of newserv src/Map.cc SuperMap::add_enemy_and_children (MIT, BB
// branch), with MapState's per-floor base index (sum of the earlier floors'
// slot counts, MapState::FloorConfig::base_indexes_for_version).

import { enemyKind, type EnemySet } from './setdata.ts';

export interface EnemySlot {
  set: EnemySet; // the set entry this slot came from
  child: number; // 0 = the set entry's own enemy, 1.. = children
  type: string; // newserv EnemyType name (BB default rares applied)
  aliasOf: number | null; // slot (within the floor) whose state this one shares
}

const RARE_BB: Record<string, (area: number, event: number) => string> = {
  HILDEBEAR: () => 'HILDEBLUE',
  RAG_RAPPY: (area, event) =>
    area < 0x12 ? 'AL_RAPPY' : area < 0x24 ? ({ 1: 'SAINT_RAPPY', 4: 'EGG_RAPPY', 5: 'HALLO_RAPPY' } as Record<number, string>)[event] ?? 'LOVE_RAPPY' : area <= 0x28 ? 'DEL_RAPPY_CRATER' : 'DEL_RAPPY_DESERT',
  SAND_RAPPY_CRATER: () => 'DEL_RAPPY_CRATER',
  SAND_RAPPY_DESERT: () => 'DEL_RAPPY_DESERT',
  MERISSA_A: () => 'MERISSA_AA',
  ZU_CRATER: () => 'PAZUZU_CRATER',
  ZU_DESERT: () => 'PAZUZU_DESERT',
  DORPHON: () => 'DORPHON_ECLAIR',
};

// Slots of one floor, in entity order.
export function expandEnemySets(sets: EnemySet[], area: number, event = 0): EnemySlot[] {
  const out: EnemySlot[] = [];
  for (const set of sets) {
    const head = out.length;
    let child = 0;
    const add = (type: string, aliasOf: number | null = null) => out.push({ set, child: child++, type, aliasOf });
    const p6 = set.params[5];
    let kind = enemyKind(set, area);
    // newserv: default rares on BB (is_default_rare_bb) become the rare type.
    const rareBB = (set.type === 0x40 && p6 >= 1) || ((set.type === 0x41 || set.type === 0x112 || set.type === 0x114 || set.type === 0x116) && (p6 & 1) !== 0);
    if (rareBB && RARE_BB[kind]) kind = RARE_BB[kind](area, event);
    if (kind === 'NON_ENEMY_NPC' && !isNpcType(set.type)) kind = 'UNKNOWN';
    let childType: string | null = null;
    let defaultChildren = 0; // -1: children were added explicitly
    switch (set.type) {
      case 0x42:
        add(kind);
        childType = 'MOTHMANT';
        defaultChildren = 30;
        break;
      case 0x64: {
        // Slimes: num_children (default 4) + 1, all slimes.
        const n = set.numChildren || 4;
        for (let i = 0; i <= n; i++) add('POFUILLY_SLIME');
        defaultChildren = -1;
        break;
      }
      case 0x65:
        add('PAN_ARMS');
        add('HIDOOM');
        add('MIGIUM');
        defaultChildren = -1;
        break;
      case 0x82:
      case 0xd4:
        add(kind);
        defaultChildren = 4;
        break;
      case 0x84:
        add(kind);
        childType = 'CANADINE_GROUP';
        defaultChildren = 8;
        break;
      case 0xa1:
        add('CHAOS_SORCERER');
        add('BEE_R');
        add('BEE_L');
        defaultChildren = -1;
        break;
      case 0xa7:
        add(kind);
        childType = 'CLAW';
        defaultChildren = 4;
        break;
      case 0xc1:
        add('DE_ROL_LE');
        for (let i = 0; i < 0x0a; i++) add('DE_ROL_LE_BODY');
        for (let i = 0; i < 0x09; i++) add('DE_ROL_LE_MINE');
        defaultChildren = -1;
        break;
      case 0xc2:
        add('VOL_OPT_1');
        for (let i = 0; i < 0x06; i++) add('VOL_OPT_PILLAR');
        for (let i = 0; i < 0x18; i++) add('VOL_OPT_MONITOR');
        add('NONE');
        add('NONE');
        add('VOL_OPT_AMP');
        add('VOL_OPT_CORE');
        add('NONE');
        defaultChildren = -1;
        break;
      case 0xc8:
        add('DARK_FALZ_3');
        for (let i = 0; i < 0x1fd; i++) add('DARVANT');
        add('DARK_FALZ_3', head);
        add('DARK_FALZ_2', head);
        add('DARK_FALZ_1', head);
        defaultChildren = -1;
        break;
      case 0xca:
        add('OLGA_FLOW_2');
        for (let i = 0; i < 0x200; i++) add('OLGA_FLOW_2', head);
        defaultChildren = -1;
        break;
      case 0xcb:
        add('BARBA_RAY');
        for (let i = 0; i < 0x0a; i++) add('BARBA_RAY_JOINT');
        for (let i = 0; i < 0x24; i++) add('PIG_RAY');
        add('BARBA_RAY');
        defaultChildren = -1;
        break;
      case 0xcc:
        add(kind);
        defaultChildren = 5;
        break;
      case 0xdf:
        add(kind);
        childType = 'RECON';
        break;
      case 0xe0:
        add(kind);
        if (area === 0x23) {
          childType = 'EPSIGARD';
          defaultChildren = 4;
        }
        break;
      case 0x119: {
        const base = p6 & 1 ? 'SHAMBERTIN' : 'SAINT_MILION';
        add(base);
        for (let i = 0; i < 8; i++) add(base);
        for (let i = 0; i < 0x10; i++) add(`${base}_SPINNER`);
        defaultChildren = -1;
        break;
      }
      case 0xc3:
      case 0xc4:
      case 0xc6:
      case 0xc7:
      case 0x118:
        add('UNKNOWN');
        break;
      default:
        add(kind);
    }
    if (defaultChildren >= 0) {
      const n = set.numChildren || defaultChildren;
      const t = childType ?? out[head].type;
      for (let i = 0; i < n; i++) add(t);
    }
  }
  return out;
}

// newserv's NON_ENEMY_NPC base types (other types without a case are UNKNOWN).
function isNpcType(t: number): boolean {
  return (
    (t >= 0x01 && t <= 0x0e) || (t >= 0x19 && t <= 0x22) || (t >= 0x24 && t <= 0x29) || (t >= 0x2b && t <= 0x2d) ||
    (t >= 0x30 && t <= 0x33) || t === 0x45 || t === 0x46 || t === 0xa9 || (t >= 0xd0 && t <= 0xd3) || (t >= 0xf0 && t <= 0x100)
  );
}
