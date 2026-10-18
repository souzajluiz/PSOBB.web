// Damage (flinch) and death motions of the enemies, from their motion tables
// in PsoBB.exe (Ephinea 1.25.13). Rows: {u16 mode, u16 next, u32 motion,
// f32 frames per tick, u32 flags}; flags 0x8 marks the damage row and 0x10
// the death rows in the tables that use flags (formats/enemymodels.ts has
// the idle slots and the constructors).
//
// Enemies without a decoded table fall back to the archive's motion names
// (damage* / dam* and dead* / die*) at 1 frame per tick (ASSUMED).

import type { EnemyArchive } from '../render/enemymodel.ts';

export interface EnemyActionMotion {
  index: number; // motion entry relative to the first motion of the archive
  speed: number;
}

export interface EnemyCombatMotions {
  damage: EnemyActionMotion | null;
  death: EnemyActionMotion | null;
}

// Client class (EnemyModelSpec.name) -> table rows.
const TABLES: Record<string, EnemyCombatMotions> = {
  // 0x009bc980: slot 6 damage (motion 3, 1.5, flags 8), slot 8 dead (5, 0.6, flags 0x10).
  TObjEneBeast: { damage: { index: 3, speed: 1.5 }, death: { index: 5, speed: 0.6 } },
  // 0x009bb420: slot 6 damage (2, 0.8), slot 7 dead (4, 0.7).
  TObjEneMoja: { damage: { index: 2, speed: 0.8 }, death: { index: 4, speed: 0.7 } },
  // 0x009bbc20 (speeds set by FUN_00527890): slot 6 damage (1, 1.0), slot 7 die (2, 0.6).
  TObjEneLappy: { damage: { index: 1, speed: 1 }, death: { index: 2, speed: 0.6 } },
  // 0x009bb860: slot 6 dams (0, 1.0), slot 7 deadl (1, 1.5, chains to slot 8 okil).
  TObjEneBm5Wolf: { damage: { index: 0, speed: 1 }, death: { index: 1, speed: 1.5 } },
  // 0x009bb6a0: slot 2 dam_bm3_s_nest (2, 1.0), slot 7 dead_bm3_s_nest (4, 0.3).
  TObjEneBm3FlyNest: { damage: { index: 2, speed: 1 }, death: { index: 4, speed: 0.3 } },
  // 0x009bb5c0 (Mothmant, MothmanConstructor_005168a4 -> 0x00518bfc): slot 3
  // (1, 1.0) the damage reaction, slot 4 (3, 1.0) the fall.
  TObjEneBm3Fly: { damage: { index: 1, speed: 1 }, death: { index: 3, speed: 1 } },
  // 0x009bc280 (Poison Lily): animation 4 (1, 0.5) is the damage state's
  // (unknown_lily_handle_damage_taken), animation 5 (2, 0.5) the death state's.
  TObjEneRe2Flower: { damage: { index: 1, speed: 0.5 }, death: { index: 2, speed: 0.5 } },
  // 0x009bb300 has the same layout as TObjEneBeast (bm_ene_bm1_shark motions).
  TObjEneShark: { damage: { index: 3, speed: 1.5 }, death: { index: 5, speed: 0.6 } },
  TObjEneDimedian: { damage: { index: 3, speed: 1.5 }, death: { index: 5, speed: 0.6 } },
};

export function enemyCombatMotions(className: string, archive: EnemyArchive): EnemyCombatMotions {
  const known = TABLES[className];
  if (known) return known;
  const find = (re: RegExp, avoid?: RegExp): EnemyActionMotion | null => {
    let fallback: EnemyActionMotion | null = null;
    for (let j = 0; j < archive.motionCount; j++) {
      const name = archive.motionName(j) ?? '';
      if (!re.test(name)) continue;
      if (!avoid || !avoid.test(name)) return { index: j, speed: 1 };
      fallback ??= { index: j, speed: 1 };
    }
    return fallback;
  };
  return { damage: find(/^(damage|damege|dam)/i, /dwn|def/i), death: find(/^(dead|die)/i, /deadb|duck/i) };
}
