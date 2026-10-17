// PlyLevelTbl.prs: the Blue Burst level table (base stats per class and the
// stat gains / EXP threshold of every level). On BB it is not in data.gsl: the
// server sends it in the stream file (01EB/02EB, newserv
// DataIndex::generate_bb_stream_file), PRS-compressed, like ItemPMT.prs.
//
// Layout (newserv src/LevelTable.cc, LevelTableV4 / RootV4, MIT), a REL file:
//   root: u32 base_stats -> u32[12] -> CharacterStats (7 x u16: atp mst evp hp dfp ata lck)
//         u32 level_deltas -> u32[12] -> LevelStatsDelta[200]
//   LevelStatsDelta (0x0C): u8 atp mst evp hp dfp ata lck tp, u32 exp
// `exp` of entry L is the total EXP needed to reach level L (0-based, so the
// displayed level is L + 1); entry 0 is all zero.
//
// The client reads it the same way: GetCharacterStats_006ac570(class, level)
// returns table[class] + level * 0xC (level clamped to
// GetCharacterMaxLevel_006931f8() = 199), GetCharacterStatValue_006ac5cc reads
// its +8 (the EXP threshold), and GetPlayerStatValue_006ac5e4 (the EXP cap of
// add_to_player_exp_and_clamp) is the threshold of level 199.

import { prsDecompress } from './prs.ts';
import { RelFile } from './rel.ts';

export const LEVEL_CLASSES = 12;
export const LEVELS = 200;
// GetCharacterMaxLevel_006931f8: the last 0-based level (displayed 200).
export const MAX_LEVEL = 199;

export interface BaseStats {
  atp: number;
  mst: number;
  evp: number;
  hp: number;
  dfp: number;
  ata: number;
  lck: number;
}

export interface LevelDelta extends BaseStats {
  tp: number;
  exp: number; // total EXP to reach this level
}

export class LevelTable {
  readonly base: readonly BaseStats[];
  readonly deltas: readonly (readonly LevelDelta[])[];

  constructor(base: BaseStats[], deltas: LevelDelta[][]) {
    if (base.length !== LEVEL_CLASSES || deltas.length !== LEVEL_CLASSES || deltas.some((d) => d.length !== LEVELS)) {
      throw new Error('level table needs 12 classes x 200 levels');
    }
    this.base = base;
    this.deltas = deltas;
  }

  private row(charClass: number): readonly LevelDelta[] {
    const r = this.deltas[charClass];
    if (!r) throw new Error(`no level table for class ${charClass}`);
    return r;
  }

  // Stat gains of reaching `level` (0-based).
  delta(charClass: number, level: number): LevelDelta {
    return this.row(charClass)[Math.max(0, Math.min(MAX_LEVEL, level))];
  }

  // Total EXP needed to reach `level` (0-based), GetCharacterStatValue_006ac5cc.
  expForLevel(charClass: number, level: number): number {
    return this.delta(charClass, level).exp;
  }

  // The EXP cap (GetPlayerStatValue_006ac5e4).
  maxExp(charClass: number): number {
    return this.expForLevel(charClass, MAX_LEVEL);
  }

  // Highest 0-based level whose threshold `exp` reaches.
  levelForExp(charClass: number, exp: number): number {
    const row = this.row(charClass);
    let level = 0;
    while (level < MAX_LEVEL && exp >= row[level + 1].exp) level++;
    return level;
  }
}

// Parses PlyLevelTbl: PRS-compressed as the stream file carries it, or the
// decompressed REL with `compressed = false`.
export function parsePlyLevelTbl(data: Uint8Array, compressed = true): LevelTable {
  const raw = compressed ? prsDecompress(data) : data;
  const rel = new RelFile(raw);
  const baseTable = rel.u32(rel.root);
  const deltaTable = rel.u32(rel.root + 4);
  const base: BaseStats[] = [];
  const deltas: LevelDelta[][] = [];
  for (let c = 0; c < LEVEL_CLASSES; c++) {
    const b = rel.u32(baseTable + c * 4);
    base.push({ atp: rel.u16(b), mst: rel.u16(b + 2), evp: rel.u16(b + 4), hp: rel.u16(b + 6), dfp: rel.u16(b + 8), ata: rel.u16(b + 10), lck: rel.u16(b + 12) });
    const d = rel.u32(deltaTable + c * 4);
    const row: LevelDelta[] = [];
    for (let l = 0; l < LEVELS; l++) {
      const o = d + l * 0x0c;
      row.push({
        atp: rel.u8(o),
        mst: rel.u8(o + 1),
        evp: rel.u8(o + 2),
        hp: rel.u8(o + 3),
        dfp: rel.u8(o + 4),
        ata: rel.u8(o + 5),
        lck: rel.u8(o + 6),
        tp: rel.u8(o + 7),
        exp: rel.u32(o + 8),
      });
    }
    deltas.push(row);
  }
  return new LevelTable(base, deltas);
}
