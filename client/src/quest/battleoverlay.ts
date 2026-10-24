// The Battle Mode overlay on the local character: what the battle's rules take out
// of the inventory and off the stats, the mirror of newserv's
// Client::create_battle_overlay and of the exe's client reset
// SinowberillChallengePlayer_ResetAll_00690674 (dump 572006; the per-phase tests are
// in quest/battle.ts localRestrictions). Same shape as quest/cmodeoverlay.ts: the
// overlay is built from a backup of the real character, applied in place, and the
// backup comes back when the battle exits (quest/battlerun.ts).
//
// Not here: the trap stock and the lives (battlerun.ts), the sonar stock (SonarStock),
// the tech-disk cooldowns of the exe (ASSUMED equivalent to newserv's levels, see below).

import type { LevelTable } from '../formats/plyleveltbl.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { localRestrictions, type EffectiveRules } from './battle.ts';

// Item data1[0]: 0 weapon, 1 armor / shield / unit, 2 mag, 3 tool; scape dolls are
// tool class 9 (newserv remove_all_items_of_type(3, 9)).
const SCAPE_DOLL_CLASS = 9;

// The character `base` becomes under the battle rules `e` (base is not touched).
// The inventory keeps the items the rules allow, renumbered from 0. With the
// replace-char rule the stats come from the level table at the rule's level (the
// same walk as cmodeoverlay.buildChallengeOverlay; ESP 40, no material bonuses).
export function buildBattleOverlay(base: CharacterFile, e: EffectiveRules, table: LevelTable): CharacterFile {
  const lr = localRestrictions(e);
  const out: CharacterFile = structuredClone(base);

  const removed = (it: InventoryItem): boolean => {
    const t = it.data.data1[0];
    const sub = it.data.data1[1];
    if (lr.removeWeapons && (t === 0 || t === 1)) return true;
    if (lr.removeMags && t === 2) return true;
    if (lr.removeTools && t === 3) return true;
    if (lr.removeScapeDolls && t === 3 && sub === SCAPE_DOLL_CLASS) return true;
    return false;
  };
  out.inventory = base.inventory.filter((it) => !removed(it)).map((it, i) => ({ ...it, index: i }));

  if (lr.clearMeseta) out.meseta = 0;

  if (lr.replaceCharLevel !== null) {
    const cls = base.charClass;
    const b = table.base[cls];
    if (!b) throw new Error(`no level table for class ${cls}`);
    const target = Math.max(0, Math.min(199, lr.replaceCharLevel));
    const s = { atp: b.atp, mst: b.mst, evp: b.evp, hp: b.hp, dfp: b.dfp, ata: b.ata, lck: b.lck };
    for (let l = 1; l <= target; l++) {
      const d = table.delta(cls, l);
      s.atp += d.atp;
      s.mst += d.mst;
      s.evp += d.evp;
      s.hp += d.hp;
      s.dfp += d.dfp;
      s.ata += d.ata;
      s.lck += d.lck;
    }
    out.stats = { ...s, esp: 40 };
    out.level = target + 1;
    out.exp = table.expForLevel(cls, target);
    out.hpFromMaterials = 0;
    out.tpFromMaterials = 0;
  }

  // Techniques: FORBID_ALL forgets them all, LIMIT_LEVEL caps each at the rule's level
  // (newserv's levels, 0-based there and 1-based in techLevels). ASSUMED: the exe
  // blocks them with the cooldown values 0xff / 0x1d instead (ResetAll, dump 572300).
  if (lr.clearTechs) out.techLevels = new Array<number | null>(19).fill(null);
  else if (lr.limitTechLevel !== null) {
    const cap = lr.limitTechLevel + 1;
    out.techLevels = out.techLevels.map((l) => (l !== null && l > cap ? cap : l));
  }
  return out;
}
