// BattleParamEntry*.dat: enemy stats, attack, resist and movement data per
// difficulty. On BB the server sends these files in the stream file
// (01EB/02EB, newserv DataIndex::generate_bb_stream_file), like ItemPMT.prs.
//
// Layout from newserv src/BattleParamsIndex.hh (MIT), BattleParamsIndex::Table
// (0xF600 bytes, little-endian), indexed [difficulty][bp index]:
//   0000 PlayerStats[4][0x60]  (0x24: atp mst evp hp dfp ata lck esp u16,
//                               f32 height, f32 unknown, u32 level, u32 exp, u32 meseta)
//   3600 AttackData[4][0x60]   (0x30: i16 min_atp, max_atp, min_ata, max_ata, ...)
//   7E00 ResistData[4][0x60]   (0x20: i16 evp_bonus, u16 efr eic eth elt edk, ..., i32 dfp_bonus @1C)
//   AE00 MovementData[4][0x60] (0x30)
// The bp indexes of each enemy type come from newserv's type_defs
// (ENEMY_TYPE_PARAMS in entitynames.ts).

export const BATTLE_PARAM_TABLE_SIZE = 0xf600;

export interface EnemyStats {
  atp: number;
  mst: number;
  evp: number;
  hp: number;
  dfp: number;
  ata: number;
  lck: number;
  esp: number;
  level: number;
  exp: number;
}

export interface EnemyAttackData {
  minAtp: number;
  maxAtp: number;
  minAta: number;
  maxAta: number;
  distanceX: number; // f32 @08: melee reach, checked by EnemyAI_CheckFacingArc_00772c08
  angle: number; // u32 @0C: half-angle of the attack arc, out of 0x10000
  distanceY: number; // f32 @10
}

// MovementData (0x30, newserv names the fields fparam1..6 / iparam1..6). The
// meaning of the first four for a walking enemy is newserv
// notes/movement-data.txt, and matches RemoveEnemyFromList_0052ad44, which
// copies fparam1/fparam2 into enemy+0x39c / the animation frame step normally
// and fparam3/fparam4 while the "near the player" flag is set.
export interface EnemyMovementData {
  fparam1: number; // idle move speed (units per tick, returning to the spawn point)
  fparam2: number; // idle walking animation speed
  fparam3: number; // engaged move speed (approaching a player)
  fparam4: number; // engaged animation speed
  fparam5: number;
  fparam6: number;
  iparam: readonly number[]; // iparam1..6
}

export interface EnemyResistData {
  evpBonus: number;
  efr: number;
  eic: number;
  eth: number;
  elt: number;
  edk: number;
  dfpBonus: number;
}

// The four tables a quest can override (opcode_get_physical_data / _attack_ /
// _resist_ / _movement_data -> set_quest_bp_physical / _attack_data /
// _resists / _animation, PsoBB.exe .c:752009..752235): each copies one whole
// row, byte for byte, into the table the client holds.
export type BattleParamKind = 'physical' | 'attack' | 'resist' | 'movement';

export const BATTLE_PARAM_ROWS: Record<BattleParamKind, { base: number; size: number }> = {
  physical: { base: 0, size: 0x24 },
  attack: { base: 0x3600, size: 0x30 },
  resist: { base: 0x7e00, size: 0x20 },
  movement: { base: 0xae00, size: 0x30 },
};

// maybe_valid_bp_index (.c:751989): -1 < index < 0x60.
export const BATTLE_PARAM_ROW_COUNT = 0x60;

export class BattleParams {
  private dv: DataView;
  private data: Uint8Array;
  private owned = false;

  constructor(data: Uint8Array) {
    if (data.length < BATTLE_PARAM_TABLE_SIZE) throw new Error(`BattleParamEntry: ${data.length} bytes, expected 0x${BATTLE_PARAM_TABLE_SIZE.toString(16)}`);
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  // A quest replaced row `index` of `kind` for `difficulty`. The table is
  // copied on the first write so the stream file's own bytes stay intact.
  override(kind: BattleParamKind, difficulty: number, index: number, row: Uint8Array): boolean {
    const t = BATTLE_PARAM_ROWS[kind];
    if (index < 0 || index >= BATTLE_PARAM_ROW_COUNT || difficulty < 0 || difficulty > 3 || row.length < t.size) return false;
    if (!this.owned) {
      this.data = this.data.slice();
      this.dv = new DataView(this.data.buffer);
      this.owned = true;
    }
    this.data.set(row.subarray(0, t.size), t.base + (difficulty * BATTLE_PARAM_ROW_COUNT + index) * t.size);
    return true;
  }

  stats(difficulty: number, index: number): EnemyStats {
    const o = (difficulty * 0x60 + index) * 0x24;
    const s = (k: number) => this.dv.getInt16(o + k, true);
    return {
      atp: s(0),
      mst: s(2),
      evp: s(4),
      hp: s(6),
      dfp: s(8),
      ata: s(0xa),
      lck: s(0xc),
      esp: s(0xe),
      level: this.dv.getUint32(o + 0x18, true),
      exp: this.dv.getUint32(o + 0x1c, true),
    };
  }

  attack(difficulty: number, index: number): EnemyAttackData {
    const o = 0x3600 + (difficulty * 0x60 + index) * 0x30;
    const s = (k: number) => this.dv.getInt16(o + k, true);
    return {
      minAtp: s(0),
      maxAtp: s(2),
      minAta: s(4),
      maxAta: s(6),
      distanceX: this.dv.getFloat32(o + 8, true),
      angle: this.dv.getUint32(o + 0x0c, true),
      distanceY: this.dv.getFloat32(o + 0x10, true),
    };
  }

  movement(difficulty: number, index: number): EnemyMovementData {
    const o = 0xae00 + (difficulty * 0x60 + index) * 0x30;
    const f = (k: number) => this.dv.getFloat32(o + k, true);
    return {
      fparam1: f(0),
      fparam2: f(4),
      fparam3: f(8),
      fparam4: f(0x0c),
      fparam5: f(0x10),
      fparam6: f(0x14),
      // Signed: the Garanz missile life adjust is -30 (update 0x005709e0 adds it to 150).
      iparam: [0, 1, 2, 3, 4, 5].map((i) => this.dv.getInt32(o + 0x18 + i * 4, true)),
    };
  }

  resist(difficulty: number, index: number): EnemyResistData {
    const o = 0x7e00 + (difficulty * 0x60 + index) * 0x20;
    const u = (k: number) => this.dv.getUint16(o + k, true);
    return { evpBonus: this.dv.getInt16(o, true), efr: u(2), eic: u(4), eth: u(6), elt: u(8), edk: u(0xa), dfpBonus: this.dv.getInt32(o + 0x1c, true) };
  }
}

// Stream file name of an episode's table (episode is the wire value: 1, 2, 3 = Ep4).
export function battleParamFile(episode: number, solo: boolean): string {
  const base = episode === 2 ? 'BattleParamEntry_lab' : episode === 3 ? 'BattleParamEntry_ep4' : 'BattleParamEntry';
  return solo ? `${base}.dat` : `${base}_on.dat`;
}
