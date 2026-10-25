// The gun's bullet start, as PsoBB.exe computes it (PerformItemAttack_005e8908 0x005e8a45 ->
// unknown_get_position_of_weapon_maybe 0x005e7534 -> get_weapon_position 0x005e83c8; DEVLOG
// 2026-10-23).
//
// get_weapon_position takes the item's attach index (item +0x1f2, written by
// ConstructWeaponArbiter 0x005d1b50 from the weapon's ItemPMT byte +0x1f, the port's
// ItemPMT field `projectile`, formats/itempmt.ts):
//   -1 -> body point 0x30 (field67_0x10c: the owner's body node 48, the hand)
//   -2 -> body point 0x23 (the owner's body node 35)
//   n  -> unk_matrix_array + n (64-byte stride): the n-th matrix of the WEAPON model's walk,
//         then the camera inverse. UpdateItemPosition (dump line 442990) pushes the owner's hand
//         matrix (player +0xe0, the body node 48) and UpdateWeaponModelTransformations_005c3568
//         / unk_apply_weapon_model_transforms_from_nj walk the weapon's njcm tree from there,
//         copying each visited node's stack head into unk_matrix_array in walk order. So n
//         is a node of the weapon model (its muzzle or another node), not a body node, and
//         it follows the hand's animation. (The walk is pre-order; a node with EVAL_BREAK 0x10
//         takes no children into the array: exeWalkIndices in render/playeranim.ts.)
// The item's own model matrix (item +0x230, the first branch of unknown_get_position_of_weapon
// _maybe) is allocated only by the special weapon constructors (the dump's Weapon107 ctor near
// line 445421 and the bVar1 == 1 / 2 branches near line 460452). ASSUMED: the ordinary guns
// leave it 0, so the attach path is the one used.
//
// The provider is injected (CombatOptions.weaponOrigin; render/lobbyview.ts supplies the
// player's skeleton). Without one, or when the player has no skeleton yet (headless, tests),
// the start is the feet plus WEAPON_HEIGHT (ASSUMED).

import { WEAPON_HEIGHT } from './techfire.ts';

export interface Point {
  x: number;
  y: number;
  z: number;
}

// The body node the held weapon's walk is pushed from. UpdateItemPosition (dump line 442975)
// pushes the owner's matrix at index (char)item+0x189 (GetItemField189), and the hand is node 0x30
// (the default: UpdateWeaponModelPosition_005ec21c sets 0x30 first, and OnEquipItem's table maps
// index 6 to 48). ASSUMED that the held weapon's +0x189 is 0x30 at the shot.
export const HAND_BODY_NODE = 0x30;
// The second start of the Mechgun (+0x24c): UpdateWeaponPosition_005e74ec (dump line 442050)
// calls item_position_y_set(this, 0x23), which writes the item's +0x189 (struct offset 0x189:
// the field after field317_0x188), then UpdateItemPosition: the weapon walk is pushed from body
// node 0x23, not the hand. The same pattern: ApplyItemField189Effect_005e6334(item, 0x23) and
// UpdateWeaponModelPosition_005ec21c's second position.
export const SECOND_START_BODY_NODE = 0x23;

// A matrix the origin reads: a node of the weapon model's walk, or a body node (depth-first).
// For a weapon node, `base` is the body node the walk is pushed from (absent: the hand).
export interface WeaponNodeRef {
  part: 'weapon' | 'body';
  node: number;
  base?: number;
}

// Writes the world point of `ref` into `out`; false when the owner has no such skeleton
// part (the caller falls back).
export type WeaponOriginProvider = (ref: WeaponNodeRef, out: Point) => boolean;

// The node an attach index names (get_weapon_position's index handling). `base` (optional) is
// the body node the weapon walk is pushed from (+0x189); the hand when absent.
export function weaponAttachRef(attach: number, base?: number): WeaponNodeRef {
  if (attach === -1) return { part: 'body', node: HAND_BODY_NODE };
  if (attach === -2) return { part: 'body', node: 0x23 };
  return base === undefined || base === HAND_BODY_NODE ? { part: 'weapon', node: attach } : { part: 'weapon', node: attach, base };
}

// The bullet start for a gun with `attach` (its ItemPMT byte) at the feet `feet`. Writes and
// returns `out`. `base`: see weaponAttachRef.
export function gunBulletStart(attach: number, feet: Point, origin: WeaponOriginProvider | undefined, out: Point, base?: number): Point {
  if (origin && origin(weaponAttachRef(attach, base), out)) return out;
  out.x = feet.x;
  out.y = feet.y + WEAPON_HEIGHT;
  out.z = feet.z;
  return out;
}

// The player's weapon_position (player +0x300) height. UpdatePlayerWeaponPosition_0077a1f4
// (dump 751644; objdump 0x0077a1f4..0x0077a23c): y = player.y + 0.5 * the bloodstain offset
// (battleparams_stats +0x10 = player +0xe3c, the constant 0.5 at 0x009780a8); with no
// battleparams_stats pointer the y is player.y. So the weapon position is the feet plus half the
// bloodstain offset. The load preserves +0xe3c and never sets it (DEVLOG 2026-10-23 "player
// weapon position"), so the offset is ASSUMED zero and the weapon position is the feet.
export const BLOODSTAIN_OFFSET = 0; // ASSUMED: player +0xe3c, no writer found in the exe

export function weaponPositionY(feet: number, bloodstain: number = BLOODSTAIN_OFFSET): number {
  return feet + 0.5 * bloodstain;
}
