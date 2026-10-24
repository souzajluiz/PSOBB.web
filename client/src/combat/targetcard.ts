// The target window of the field (PsoBB.exe, Ephinea 1.25.13 dump names; VAs
// are the exe's): the card at the bottom left that names the player's lock-on
// target and gives its attribute. Pure: the HUD draws it (render/playerhud.ts).
//
// - Window: ChallengeMenuObject_Construct_00731c94 places it at gui slot 0x1f
//   (get_gui_position(0x1f) = (8.0, 437.0), dwords 0x00972038 / 0x0097203c);
//   ui_target_window_attribute (0x00731ed0 region, dump 699426) sets its height to
//   93.0 each frame. The card is built only for an enemy with the
//   0x20000000 flag (IsEnemyEligibleForChallengeDisplay_00731afc).
// - Lines: the monster's name (unitxt, `unitxt_get_monster_name`, collection 8
//   on floors 0..2, 0x10 after) on the first line; "Attribute:" (unitxt group 11,
//   0xc3) and the attribute's name (group 11: 0xb5 native, 0xb6 A.beast, 0xb7
//   machine, 0xb8 dark) on the second, coloured by monster_attribute_color
//   (0x009f2ed0).
// - The HP bar and the drop and kill lines of addon clients are not in the exe's card.

import { ENEMY_ATTR } from './enemystatus.ts';

// get_gui_position(0x1f): the card's anchor in the 640x480 virtual space.
export const TARGET_CARD_ANCHOR = { x: 8, y: 437 } as const;

// window_height_but_overwritten_every_frame = 93.0 (ui_target_window_attribute).
export const TARGET_CARD_HEIGHT = 93;

// monster_attribute_color (0x009f2ed0), ARGB, by the attribute index below.
export const TARGET_ATTR_ARGB = [0xffa5ffaa, 0xfff5ff99, 0xffff958b, 0xffe1a9ff, 0xffffffff] as const;

// unitxt group 11 entries (ui_target_window_attribute's unitxt_get_group_11_String calls).
export const TARGET_TEXT = { native: 0xb5, abeast: 0xb6, machine: 0xb7, dark: 0xb8, label: 0xc3 } as const;

// English fallbacks when the unitxt table is not loaded.
const ATTR_FALLBACK = ['Native', 'A.Beast', 'Machine', 'Dark'] as const;

// The attribute index of the card (the flag tests of ui_target_window_attribute:
// special 0x40 -> 4, native 1 -> 0, A.beast 2 -> 1, machine 4 -> 2, dark 8 -> 3,
// anything else -> 4, the empty line in white).
export function targetAttributeIndex(attribute: number): number {
  if (attribute & 0x40) return 4;
  if (attribute & ENEMY_ATTR.native) return 0;
  if (attribute & ENEMY_ATTR.abeast) return 1;
  if (attribute & ENEMY_ATTR.machine) return 2;
  if (attribute & ENEMY_ATTR.dark) return 3;
  return 4;
}

// The unitxt collection of monster names: floors 0..2 (g_CurrentFloor <= 2) use
// collection 8, the rest 0x10 (unitxt_get_monster_name, dump 772723).
export function monsterNameCollection(floor: number): number {
  return floor > 2 ? 0x10 : 8;
}

export interface TargetCardText {
  name: string;
  label: string;
  value: string;
  argb: number; // the value's colour
}

// The card's text for an enemy: its unitxt monster name (or the port's own name
// when the id has none) and the attribute line.
export function targetCardText(opts: {
  name: string;
  attribute: number;
  floor: number;
  // unitxt collections (parseUnitxt), null until loaded.
  texts: readonly (readonly string[])[] | null;
  // The enemy's unitxt monster id (graveKillerId), GRAVE_NO_KILLER-like when none.
  monsterId: number;
}): TargetCardText {
  const index = targetAttributeIndex(opts.attribute);
  const names = opts.texts?.[monsterNameCollection(opts.floor)];
  const fromUnitxt = names && opts.monsterId > 0 ? names[opts.monsterId] : undefined;
  const group = opts.texts?.[11];
  const valueId = [TARGET_TEXT.native, TARGET_TEXT.abeast, TARGET_TEXT.machine, TARGET_TEXT.dark][index];
  const value = index < 4 ? group?.[valueId] || ATTR_FALLBACK[index] : '';
  return {
    name: fromUnitxt || opts.name,
    label: group?.[TARGET_TEXT.label] || 'Attribute:',
    value,
    argb: TARGET_ATTR_ARGB[index],
  };
}
