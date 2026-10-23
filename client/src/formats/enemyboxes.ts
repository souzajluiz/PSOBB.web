// The box table of an enemy, from its .dat set type (map_*e.dat), its floor's area and its variant.
//
// The set type is the port's enemy id: a root slot's EnemySlot.set.type (the newserv
// name in EnemySlot.type is derived from it, formats/setdata.ts enemyKind). A child slot
// (a Mothmant, a Pofuilly, a pan arm half) has no set type of its own in the port and is
// not mapped here (null), since the exe creates it from its parent's constructor.
//
// ENEMY_COLLISION_LINKS (generated, tools/gen-collision-boxes.py) gives, per set type and
// factory, the box table that the enemy's constructor passes to
// InitEnemyCollisionBoxes_007b9a88 (directly, or through a helper that passes its own
// table on, 0x0051ff3c). A link reached only through a helper that three or more set types
// reach is not used (ASSUMED: the helper's table belongs to the other enemies that reach it).
// A helper reached by exactly two set types with a constant table (Canadine 0x83 and Canane 0x84,
// 0x005424d8) is used for both (ASSUMED).
//
// An indexed link (variants, e.g. Booma 0x44) picks its row set by the variant: the constructor
// computes table = base + stride * [this+0x370], and that field is the vtable slot's copy of the
// factory argument's s16 at +0x3c, which is the set record at +0x40 (the factory argument is
// record + 4, the spawner 0x00810fcb; the walk is in the generator, see the DEVLOG). The record's
// +0x40 is EnemySet.params[5] (`slotVariant`).

import { COLLISION_TABLES, ENEMY_COLLISION_LINKS, type CollisionBoxRow, type EnemyCollisionLink } from './collisionboxes.gen.ts';
import type { EnemySlot } from './enemyslots.ts';

// Box flag 0x8000 (+0x18 of the 0x2c-byte box, unknown_flags of collision_box): the box
// is targetable (ASSUMED meaning: check_enemy_is_targetable, 785551, tests 0x8000 within
// the 0xa000 mask of its battle-mode line of sight and 0x2000 of its nearest pick).
export const BOX_TARGETABLE = 0x8000;

export interface EnemyBoxTable {
  table: number; // exe address of the box table
  link: EnemyCollisionLink;
  rows: readonly CollisionBoxRow[];
}

// The link of a set type for an area: the factory the area uses (one set type can have
// several factories), else the first one. Null when no link reaches a box table. An indexed
// link needs the variant (the set record's +0x40, see `slotVariant`); without one, or with a
// variant that has no box row set, it is null (the fallback, ASSUMED).
export function enemyBoxTable(setType: number | null, area: number | null = null, variant: number | null = null): EnemyBoxTable | null {
  if (setType === null) return null;
  const links = ENEMY_COLLISION_LINKS[setType];
  if (!links || links.length === 0) return null;
  const link = (area !== null ? links.find((l) => l.areas.includes(area)) : undefined) ?? links[0];
  if (link.shared) return null;
  let table: number | null = link.table;
  if (link.variants) {
    table = variant !== null && Object.prototype.hasOwnProperty.call(link.variants, variant) ? link.variants[variant] : null;
  }
  if (table === null) return null;
  const rows = COLLISION_TABLES[table];
  return rows ? { table, link, rows } : null;
}

// The set type of a slot's enemy, or null for a child (see the header).
export function slotSetType(slot: Pick<EnemySlot, 'set' | 'child'>): number | null {
  return slot.child === 0 ? slot.set.type : null;
}

// The variant of a root slot's enemy: the set record's s16 at +0x40 (EnemySet.params[5], the
// field the Booma-style indexed links read; the variant labels are in setdata.ts). Null for a child.
export function slotVariant(slot: Pick<EnemySlot, 'set' | 'child'>): number | null {
  return slot.child === 0 ? slot.set.params[5] : null;
}

export function boxTargetable(row: Pick<CollisionBoxRow, 'flags'>): boolean {
  return (row.flags & BOX_TARGETABLE) !== 0;
}

// An enemy is targetable when one of its boxes is. An enemy whose box table is not known
// is targetable (ASSUMED: the port's former rule).
export function isTargetable(setType: number | null, area: number | null = null, variant: number | null = null): boolean {
  const b = enemyBoxTable(setType, area, variant);
  return b === null ? true : b.rows.some(boxTargetable);
}
