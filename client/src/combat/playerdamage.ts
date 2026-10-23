// The local player taking damage: the hit / knockback / death / revive states
// of the player state machine of PsoBB.exe (Ephinea 1.25.13, addresses are
// VAs), their field motions, and the 6x subcommands they send.
//
// Player state machine (player+0x32e, enum input_state_1 of the reference
// headers): 5/6/7 = attack 1/2/3 (see combat/attack.ts), 10 = block (the
// reference calls it evade), 13 = got_hit_light, 14 = got_hit_heavy,
// 15 = dead, 0x12 = the revive state (handle_input_state_0x4f).
//
// Entering a state runs the handler with argument 0 (input_state_2.unknown0),
// which ends the previous state, plays its sound effect and plays the motion
// the motion set's vtable returns (field motion set vtable 0x00b39ec0):
//   handle_input_state_got_hit_light  (0x0069ec4c family, entry 0x0069ed10):
//     motion slot = vtable +0x60 -> 11, SE 0x13 at the player, invulnerability
//     = get_invincibility_frames() = invincibility_frames[8 + difficulty] = 60
//     ticks in game (table 0x009690e8; [12 + difficulty] = 120/150/180/210 is
//     for player+0x32c == 3, not a field player). The state ends when the
//     motion ends (CheckPlayerDeathOnHit_0069ecac, the 0xb0 & 0x10 "motion
//     ended" bit): alive again, or the dead state when the dead flag is set.
//   handle_input_state_got_hit_heavy  (entry 0x0069ea00, tick 0x0069e92c,
//     interrupt 0x0069e8b0): motion slot = vtable +0x58 -> 9 (the fall), SE
//     0x14, invulnerability 300 (literal). Stage 0 plays the fall; when the
//     motion elapsed passes 10 frames (check_entity_animation_elapsed
//     _threshold(10.0)) SE 0x15 plays (0x21 for a RAcast, footstep type 2,
//     get_player_class_footstep_sound_effect_type). When the fall
//     ends the state goes to stage 1; stage 1 with the dead flag still set
//     enters the dead state, otherwise one tick later stage 2 starts the
//     stand-up motion, vtable +0x5c -> 10; when that ends the invulnerability
//     becomes get_invincibility_frames_2() = 60 (table [24 + difficulty]) and
//     the player is idle again.
//   handle_input_state_dead (entry 0x0069e458): motion slot = vtable +0x64 ->
//     12 (with death flag 0x1 set no motion plays and the helper object is
//     created at once), velocity reset. See PlayerDamage.die.
//   handle_input_state_evade_attack (6x4A, action_block @ 0x0069a9c8; entry
//     0x0069f498): motion slot = vtable +0x4c -> 6, then PlayerProcessHurtDamage
//     _0068c8e8 (dump 557599): with a shield in the shield slot it calls the
//     shield item's do_attack (vtable +0x70 = 0x0061cdb0, a bare `ret`: the
//     shield shows nothing and plays no SE; shield vtable 0x00b0fb60 from
//     CreateArmorInstance_005e3200, group_idx 0x4f). Without one it calls
//     CreateEnemyEffectEntity_005030bc: the effect entity 0x00503144 (particles
//     0..3 at the player, height 0x24, when its pool allows) and SE 0x23 at
//     once. See combat/playerfx.ts.
//   Slot 13 (vtable +0x68) is the motion of the revive state 0x12.
// The slot numbers come from the vtable getters (each a `mov eax, N; ret`):
// 0x006a7584 (+0x4c) -> 6, 0x006a759c (+0x58) -> 9, 0x006a75a4 (+0x5c) -> 10,
// 0x006a75ac (+0x60) -> 11, 0x006a75b4 (+0x64) -> 12, 0x006a75bc (+0x68) -> 13.
//
// Subcommands (newserv src/CommandFormats.hh; the send sites are
// dispatch_action_got_hit_light / _heavy @ 0x0069ec4c / 0x0069e7b8 and
// dispatch_actions_0x89_0x4d @ 0x0069e234):
//   6x4A G_ShieldAttack_6x4A       {header}                      - attack fully blocked
//   6x4B / 6x4C G_HitByEnemy      {header, u16 angle, u16 hp, f32 vx, f32 vz}
//     6x4B when the damage was <= 25% of max HP, 6x4C above that; 6x4C also
//     recomputes the facing from the knockback velocity when its squared
//     length passes _DAT_0093da04.
//   6x89 G_PlayerDeath            {header, u16 killer entity, u16 0}
//   6x4D G_PlayerDied_6x4D        {header, u32 death_flags}       (player+0x92c)
//   6x4E G_PlayerRevivable_6x4E   {header}                        - Reverser target
//   6x4F G_PlayerRevived_6x4F     {header}
//
// The motion tables below are the field motion tables 0x009cbeec (records) /
// 0x009cbf04 (rlc index lists) read out of PsoBB.exe, [motion type][weapon
// class] -> [rlc entry, frames per tick]; every one of these slots has mode 3
// (play once and hold the last frame) and one flag word, listed per table.

import type { MotionRecord } from '../formats/plymotion.ts';

// slot 9 (vtable +0x58), flags 0xa0000040
// prettier-ignore
const HEAVY_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[202, 1.4], [105, 1.4], [120, 1.4], [133, 1.4], [146, 1.4], [105, 1.4], [7, 1.8], [17, 1.4], [7, 1.6], [43, 1.4], [105, 1.4], [146, 1.4], [105, 1.4], [202, 1.4], [105, 1.4], [184, 1.4], [105, 1.4], [56, 1.4], [93, 1.8]],
  [[359, 1.5], [336, 1.5], [351, 1.6], [359, 1.5], [351, 1.6], [374, 1.6], [245, 1.6], [256, 1.8], [268, 1.5], [280, 1.5], [336, 1.5], [351, 1.5], [313, 1.5], [359, 1.5], [313, 1.5], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
  [[488, 1.5], [488, 1.7], [351, 1.5], [359, 1.5], [351, 1.5], [488, 1.5], [488, 1.6], [256, 1.5], [453, 1.6], [280, 1.5], [488, 1.6], [488, 1.5], [488, 1.5], [488, 1.6], [488, 1.6], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
  [[202, 1.4], [105, 1.4], [120, 1.4], [133, 1.4], [146, 1.4], [105, 1.4], [7, 1.8], [17, 1.4], [7, 1.6], [43, 1.4], [105, 1.4], [146, 1.4], [105, 1.4], [202, 1.4], [105, 1.4], [184, 1.4], [105, 1.4], [56, 1.4], [93, 1.8]],
  [[549, 1.5], [336, 1.5], [351, 1.6], [549, 1.5], [351, 1.6], [374, 1.6], [245, 1.6], [256, 1.8], [268, 1.5], [280, 1.5], [336, 1.5], [351, 1.5], [313, 1.5], [549, 1.5], [555, 1.5], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
  [[359, 1.5], [336, 1.5], [351, 1.6], [359, 1.5], [351, 1.6], [374, 1.6], [570, 1.6], [256, 1.8], [268, 1.5], [280, 1.5], [336, 1.5], [351, 1.5], [313, 1.5], [549, 1.5], [313, 1.5], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
];
// slot 10 (vtable +0x5c), flags 0x20000100: the stand-up after the heavy fall
// prettier-ignore
const GETUP_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[203, 1.9], [106, 1.9], [121, 1.9], [134, 1.9], [147, 1.9], [106, 1.9], [8, 2], [18, 1.5], [8, 1.6], [44, 1.6], [106, 1.9], [147, 1.9], [106, 1.9], [203, 1.9], [106, 1.9], [185, 1.9], [106, 1.9], [57, 1.5], [94, 2]],
  [[360, 1.8], [337, 1.8], [352, 1.8], [360, 1.8], [352, 1.8], [375, 1.8], [246, 1.6], [257, 1.6], [269, 1.8], [281, 1.8], [337, 1.8], [352, 1.8], [314, 1.8], [360, 1.8], [314, 1.8], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
  [[489, 1.6], [489, 1.7], [352, 1.8], [360, 1.8], [352, 1.8], [489, 1.8], [489, 1.7], [257, 1.8], [454, 1.7], [281, 1.8], [489, 1.7], [489, 1.7], [489, 1.7], [489, 1.6], [489, 1.6], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
  [[203, 1.9], [106, 1.9], [121, 1.9], [134, 1.9], [147, 1.9], [106, 1.9], [8, 2], [18, 1.5], [8, 1.6], [44, 1.6], [106, 1.9], [147, 1.9], [106, 1.9], [203, 1.9], [106, 1.9], [185, 1.9], [106, 1.9], [57, 1.5], [94, 2]],
  [[550, 1.8], [337, 1.8], [352, 1.8], [550, 1.8], [352, 1.8], [375, 1.8], [246, 1.6], [257, 1.6], [269, 1.8], [281, 1.8], [337, 1.8], [352, 1.8], [314, 1.8], [550, 1.8], [556, 1.8], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
  [[360, 1.8], [337, 1.8], [352, 1.8], [360, 1.8], [352, 1.8], [375, 1.8], [571, 1.6], [257, 1.6], [269, 1.8], [281, 1.8], [337, 1.8], [352, 1.8], [314, 1.8], [550, 1.8], [314, 1.8], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
];
// slot 6 (vtable +0x4c), flags 0xa0000010: the block (6x4A)
// prettier-ignore
const BLOCK_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[199, 3], [103, 3], [118, 2.6], [131, 3], [103, 2.5], [157, 3], [14, 3], [14, 2.5], [14, 2.5], [14, 2.5], [103, 3], [144, 3], [103, 3], [199, 3], [103, 3], [181, 3], [103, 3], [53, 2.5], [4, 3]],
  [[411, 3], [333, 3], [349, 2.5], [358, 3], [365, 2.5], [157, 3], [254, 3], [254, 2.5], [254, 2.5], [277, 2.5], [333, 3], [365, 3], [311, 3], [411, 3], [311, 3], [392, 3], [333, 3], [290, 2.5], [243, 3]],
  [[505, 3], [486, 3], [349, 2.5], [358, 3], [365, 2.5], [486, 3], [486, 3], [254, 2.5], [451, 2.5], [277, 2.5], [486, 3], [465, 3], [486, 3], [505, 3], [486, 3], [392, 3], [333, 3], [290, 2.5], [243, 3]],
  [[199, 3], [103, 3], [118, 2.6], [131, 3], [103, 2.5], [157, 3], [14, 3], [14, 2.5], [14, 2.5], [14, 2.5], [103, 3], [144, 3], [103, 3], [199, 3], [103, 3], [181, 3], [103, 3], [53, 2.5], [4, 3]],
  [[411, 3], [333, 3], [349, 2.5], [358, 3], [365, 2.5], [157, 3], [254, 3], [254, 2.5], [254, 2.5], [277, 2.5], [333, 3], [365, 3], [311, 3], [411, 3], [311, 3], [392, 3], [333, 3], [290, 2.5], [243, 3]],
  [[411, 3], [333, 3], [349, 2.5], [358, 3], [365, 2.5], [157, 3], [254, 3], [254, 2.5], [254, 2.5], [277, 2.5], [333, 3], [365, 3], [311, 3], [411, 3], [311, 3], [392, 3], [333, 3], [290, 2.5], [243, 3]],
];
// slot 11 (vtable +0x60), flags 0xa0000040
// prettier-ignore
const LIGHT_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[204, 3.7], [107, 3.7], [122, 3.7], [135, 3.7], [148, 3], [107, 3.7], [32, 3.7], [19, 3.7], [204, 3.7], [45, 3.7], [107, 3.7], [148, 3.7], [107, 3.7], [204, 3.7], [107, 3.7], [186, 3.7], [107, 3.7], [58, 3.7], [95, 3.7]],
  [[413, 3.7], [338, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [338, 3.7], [247, 3.7], [258, 3.7], [270, 3.7], [282, 3.7], [338, 3.7], [353, 3.7], [315, 3.7], [413, 3.7], [315, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
  [[490, 3.7], [490, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [490, 3.7], [490, 3.7], [258, 3.7], [455, 3.7], [282, 3.7], [490, 3.7], [490, 3.7], [490, 3.7], [490, 3.7], [490, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
  [[204, 3.7], [107, 3.7], [122, 3.7], [135, 3.7], [148, 3], [107, 3.7], [32, 3.7], [19, 3.7], [204, 3.7], [45, 3.7], [107, 3.7], [148, 3.7], [107, 3.7], [204, 3.7], [107, 3.7], [186, 3.7], [107, 3.7], [58, 3.7], [95, 3.7]],
  [[413, 3.7], [338, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [338, 3.7], [247, 3.7], [258, 3.7], [270, 3.7], [282, 3.7], [338, 3.7], [353, 3.7], [315, 3.7], [413, 3.7], [315, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
  [[413, 3.7], [338, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [338, 3.7], [247, 3.7], [258, 3.7], [270, 3.7], [282, 3.7], [338, 3.7], [353, 3.7], [315, 3.7], [413, 3.7], [315, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
];
// slot 12 (vtable +0x64), flags 0x80
// prettier-ignore
const DEATH_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1]],
  [[414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
  [[491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
  [[205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1]],
  [[414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
  [[414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
];
// slot 13 (vtable +0x68), flags 0x20000400
// prettier-ignore
const REVIVE_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [59, 1.3], [109, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [260, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
  [[109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [59, 1.3], [109, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
];

export type HitMotionKind = 'light' | 'heavy' | 'getup' | 'block' | 'death' | 'revive';

const TABLES: Record<HitMotionKind, { rows: readonly (readonly (readonly [number, number])[])[]; flags: number }> = {
  heavy: { rows: HEAVY_MOTIONS, flags: 0xa0000040 },
  getup: { rows: GETUP_MOTIONS, flags: 0x20000100 },
  block: { rows: BLOCK_MOTIONS, flags: 0xa0000010 },
  light: { rows: LIGHT_MOTIONS, flags: 0xa0000040 },
  death: { rows: DEATH_MOTIONS, flags: 0x80 },
  revive: { rows: REVIVE_MOTIONS, flags: 0x20000400 },
};

// Field motion of one of the hit / death / revive states.
export function hitMotion(motionType: number, weaponClass: number, kind: HitMotionKind): MotionRecord {
  const t = TABLES[kind];
  const row = t.rows[motionType]?.[weaponClass] ?? t.rows[0][0];
  return { index: row[0], mode: 3, next: -1, speed: row[1], flags: t.flags };
}

// Invulnerability after a hit, in game ticks: invincibility_frames[8 + x] = 60
// for a light hit (table 0x009690e8, read by get_invincibility_frames while the
// current scene is `logged_in`) and the literal 300 of the heavy-hit handler.
export const INVULN_TICKS_LIGHT = 60;
export const INVULN_TICKS_HEAVY = 300;
// After the stand-up of a heavy hit: get_invincibility_frames_2() =
// invincibility_frames[24 + difficulty] = 60 (table 0x009690e8 + 0x60).
export const INVULN_TICKS_GETUP = 60;
// The revive state (ForceExitSpecialState_0069db5c) sets the literal 300.
export const INVULN_TICKS_REVIVE = 300;

// A hit counts as heavy (6x4C) above a quarter of max HP; newserv's comment on
// G_HitByEnemy_6x4B_6x4C, and the same quarter that makes the enemy-side flag
// 0x400 in combat/formulas.ts (FUN_0077529c / DAT_0097822c).
export const HEAVY_HIT_FRACTION = 0.25;

// Death flags (player+0x92c, dispatch_actions_0x89_0x4d @ 0x0069e234):
// bit 0 "items already dropped", bit 1 "no drop items in inventory" (set when
// CheckForDropItemInInventory @ 0x0069248c returned 0), bit 2 cleared on the
// first death frame.
export const DEATH_FLAG_DROPPED = 1;
export const DEATH_FLAG_NO_DROP = 2;

// The death fade: the dead helper object (player_death_class_countdown_helper,
// vtable 0x00b44e88, update 0x00788a64) is created once the death motion has
// played. Every frame its counter grows by 2 (0x0097a718) and the screen colour
// (g_UIElementArray_00a98480[1], bytes B 0, G 0, R 0xff, A = counter) takes
// it; when the counter reaches 128 (0x0097a714), 64 frames in, it calls the
// return-to-Pioneer-2 routine (0x006920ac: on a field it creates the dead
// prompt and sends 6x4E) and ends.
export const DEATH_FADE_STEP = 2;
export const DEATH_FADE_MAX = 128;
export const DEATH_FADE_TICKS = DEATH_FADE_MAX / DEATH_FADE_STEP;

// ClampAndDampPlayerVelocity_00694230, once per tick on both axes: |v| below
// 1e-5 (0x0093c6c4 / 0x0093c6c0) becomes 0, otherwise v * 0.5 (0x0093c6b8).
export const KNOCKBACK_DAMPING = 0.5;
export const KNOCKBACK_EPSILON = 1e-5;
// _DAT_0093da04: above this length 6x4C turns the player to face the
// knockback direction (the exe compares the length, not the square).
export const KNOCKBACK_TURN_SPEED = 1e-5;

// Frames of the heavy fall after which SE 0x15 / 0x21 plays
// (check_entity_animation_elapsed_threshold(player, 10.0)).
export const HEAVY_LAND_FRAME = 10;

// Sound effect ids of the states (play_sound_effect_at_player).
export const SE_HIT_LIGHT = 0x13;
export const SE_HIT_HEAVY = 0x14;
export const SE_HEAVY_LAND = 0x15;
export const SE_HEAVY_LAND_RACAST = 0x21;
export const SE_BLOCK = 0x23;

export type PlayerHitState = 'alive' | 'light' | 'heavy' | 'getup' | 'block' | 'dead' | 'revivable' | 'reviving';

// What the state machine shows (combat/playerfx.ts has the ids).
export type PlayerDamageFx =
  | { kind: 'hit'; heavy: boolean; critical: boolean } // a hit that did damage (EntityHitEntity_00773350's spark or critical spark and attribute particle)
  | { kind: 'block' } // 6x4A (PlayerProcessHurtDamage_0068c8e8)
  | { kind: 'revive' }; // 6x4F (ForceExitSpecialState_0069db5c)

export interface PlayerDamageEvents {
  // Play one of the field motions on the player's model.
  motion(kind: HitMotionKind): void;
  // Push the player by a knockback velocity (one tick worth).
  push(vx: number, vz: number): void;
  // Face the player this way (6x4C recomputes the facing from the velocity).
  face(angle: number): void;
  // 6x4B / 6x4C.
  sendHit(heavy: boolean, angle: number, hp: number, vx: number, vz: number): void;
  // 6x4A: the attack did no damage.
  sendShieldAttack(): void;
  // 6x89 + 6x4D.
  sendDeath(killerEntityId: number, deathFlags: number): void;
  // 6x4E / 6x4F.
  sendRevivable(): void;
  sendRevived(): void;
  log(msg: string): void;
  // A sound effect at the player (play_sound_effect_at_player).
  sound?(id: number): void;
  // An effect on the player.
  fx?(e: PlayerDamageFx): void;
  // The SE of the heavy fall's 10th frame (0x15, 0x21 for a RAcast).
  landSound?(): number;
  // Whether a shield is in the shield slot (get_equipment_slot(shield) != 0).
  // A shielded block runs the shield's do_attack, which is empty: no SE, no
  // particles. Without it (the default) the no-shield effect plays.
  shielded?(): boolean;
  // The model's current motion has played to its end / its current frame.
  // Without them the state lengths fall back to fixed tick counts.
  motionEnded?(): boolean;
  motionFrame?(): number;
}

// Fallback state lengths (ticks) when the owner cannot tell when a motion
// ended: the field motions are 10 to 40 frames at 1.0 to 3.7 frames per tick.
const FALLBACK_TICKS = {
  light: 20,
  heavy: 40,
  getup: 20,
  block: 20,
  death: 60,
  revive: 40,
} as const;

// One axis of ClampAndDampPlayerVelocity_00694230.
export function dampKnockback(v: number): number {
  return v >= KNOCKBACK_EPSILON || v <= -KNOCKBACK_EPSILON ? v * KNOCKBACK_DAMPING : 0;
}

// The knockback of a player whose hit state runs the exe's physics tick
// (HandlePostHitPhysics_0069ece0 in the light hit, ProcessPlayerDeathState_0069e92c
// in the heavy fall): each game tick the velocity is damped and the player moves
// by it. A remote player's copy (6x4B / 6x4C of another client, action_get_hit_flinch
// / action_get_hit_fall @ 0x0069aa2c / 0x0069aaf4) sets the same velocity from the
// packet, so it slides with this too. The owner moves the model by the returned
// displacement; the exe's reset_velocity on IsPlayerAboutToCollide is not ported
// (the collision move slides instead, as for the local player).
export class KnockbackSlide {
  vx = 0;
  vz = 0;

  start(vx: number, vz: number): void {
    this.vx = vx;
    this.vz = vz;
  }

  stop(): void {
    this.vx = 0;
    this.vz = 0;
  }

  // One game tick: the displacement of this tick, or null when the player stands still.
  tick(): { dx: number; dz: number } | null {
    if (!this.vx && !this.vz) return null;
    this.vx = dampKnockback(this.vx);
    this.vz = dampKnockback(this.vz);
    if (!this.vx && !this.vz) return null;
    return { dx: this.vx, dz: this.vz };
  }
}

// The local player's HP, hit motions and death / revive flow. Pure logic: the
// owner (render/combat.ts) supplies the motions, the movement and the sends.
export class PlayerDamage {
  hp = 0;
  maxHp = 0;
  state: PlayerHitState = 'alive';
  // Ticks of invulnerability left (a hit while this is positive is ignored).
  invuln = 0;
  deathFlags = 0;
  // Death fade alpha, 0..128 (DEATH_FADE_MAX); 0 while alive.
  fade = 0;
  private events: PlayerDamageEvents;
  private vx = 0;
  private vz = 0;
  private ticksIn = 0; // ticks since the current motion started
  private fadeTicks = -1; // -1: the death motion is still playing
  private landed = false; // SE 0x15 of the heavy fall played
  private lethal = false; // the hit in progress takes the player to the dead state
  private killer = 0xffff;

  constructor(events: PlayerDamageEvents) {
    this.events = events;
  }

  // Entering a floor (or a fresh character): full HP, alive.
  reset(maxHp: number, hp = maxHp): void {
    this.maxHp = Math.max(1, maxHp);
    this.hp = Math.max(0, Math.min(this.maxHp, hp));
    this.state = 'alive';
    this.invuln = 0;
    this.deathFlags = 0;
    this.fade = 0;
    this.vx = 0;
    this.vz = 0;
    this.ticksIn = 0;
    this.fadeTicks = -1;
    this.landed = false;
    this.lethal = false;
  }

  // True while the player must not move or attack on its own.
  get busy(): boolean {
    return this.state !== 'alive';
  }

  get dead(): boolean {
    return this.state === 'dead' || this.state === 'revivable';
  }

  // A lethal hit is playing its flinch / fall before the dead state.
  get dying(): boolean {
    return this.lethal;
  }

  private startMotion(kind: HitMotionKind): void {
    this.ticksIn = 0;
    this.events.motion(kind);
  }

  // One attack against the player. `damage` is the rounded total (0 = the hit
  // did nothing: the client sends 6x4A instead), `angle` the direction the hit
  // came from in radians, `strength` the knockback magnitude.
  hit(damage: number, angle: number, strength: number, killerEntityId = 0xffff, critical = false): void {
    if (this.dead || this.state === 'reviving' || this.lethal) return;
    if (this.invuln > 0) return;
    if (damage < 1) {
      // 6x4A: the attack was fully blocked (block state, motion slot 6).
      this.state = 'block';
      this.startMotion('block');
      // PlayerProcessHurtDamage_0068c8e8: the shield's own routine (empty) or,
      // without a shield, CreateEnemyEffectEntity_005030bc (particles + SE 0x23).
      if (!(this.events.shielded?.() ?? false)) {
        this.events.sound?.(SE_BLOCK);
        this.events.fx?.({ kind: 'block' });
      }
      this.events.sendShieldAttack();
      return;
    }
    this.killer = killerEntityId;
    this.hp = Math.max(0, this.hp - Math.round(damage));
    const heavy = damage > this.maxHp * HEAVY_HIT_FRACTION;
    this.vx = Math.sin(angle) * strength;
    this.vz = Math.cos(angle) * strength;
    // 6x4C turns the player to face the knockback direction when the velocity
    // is fast enough (the staggering sibling of the two hit commands).
    let facing = angle;
    if (heavy && Math.hypot(this.vx, this.vz) > KNOCKBACK_TURN_SPEED) {
      facing = Math.atan2(this.vx, this.vz);
      this.events.face(facing);
    }
    this.events.sendHit(heavy, facing, this.hp, this.vx, this.vz);
    // The hit state runs either way: a lethal hit plays the whole flinch / fall
    // first and enters the dead state when it ends (CheckPlayerDeathOnHit /
    // ProcessPlayerHitRecovery look at the dead flag when the motion ends).
    this.lethal = this.hp < 1;
    this.state = heavy ? 'heavy' : 'light';
    this.invuln = heavy ? INVULN_TICKS_HEAVY : INVULN_TICKS_LIGHT;
    this.landed = false;
    this.startMotion(heavy ? 'heavy' : 'light');
    this.events.sound?.(heavy ? SE_HIT_HEAVY : SE_HIT_LIGHT);
    this.events.fx?.({ kind: 'hit', heavy, critical });
    this.events.log(`hit for ${Math.round(damage)}: ${this.hp}/${this.maxHp} HP`);
  }

  // handle_input_state_dead's entry (0x0069e458): sends 6x89 + 6x4D, plays
  // the death motion and takes the velocity away.
  private die(): void {
    this.state = 'dead';
    this.invuln = 0;
    this.lethal = false;
    this.vx = 0;
    this.vz = 0;
    this.fadeTicks = -1;
    // The first death frame clears flag 4 and sets flag 2 when the inventory
    // has nothing to drop; this client never drops items on death, so the
    // "no drop" bit is always set and the "already dropped" bit stays clear.
    this.deathFlags = DEATH_FLAG_NO_DROP;
    this.startMotion('death');
    this.events.sendDeath(this.killer, this.deathFlags);
    this.events.log('you died');
  }

  // Another player's Reverser / Moon Atomizer, or the web client's own revive
  // key. The real client cannot revive itself; this is the 6x4F path
  // (ForceExitSpecialState_0069db5c: invulnerability 300, state 0x12).
  revive(hp = Math.max(1, Math.round(this.maxHp * 0.125))): void {
    if (!this.dead) return;
    this.state = 'reviving';
    this.hp = Math.min(this.maxHp, Math.max(1, hp));
    this.invuln = INVULN_TICKS_REVIVE;
    this.deathFlags = 0;
    this.fade = 0;
    this.fadeTicks = -1;
    this.startMotion('revive');
    this.events.fx?.({ kind: 'revive' });
    this.events.sendRevived();
    this.events.log(`revived with ${this.hp}/${this.maxHp} HP`);
  }

  // The current motion has played to its end (or its fallback length).
  private motionDone(kind: keyof typeof FALLBACK_TICKS): boolean {
    if (this.events.motionEnded) return this.ticksIn >= 1 && this.events.motionEnded();
    return this.ticksIn >= FALLBACK_TICKS[kind];
  }

  // One game tick (30 per second).
  tick(): void {
    if (this.invuln > 0) this.invuln--;
    this.ticksIn++;
    if (this.vx || this.vz) {
      this.vx = dampKnockback(this.vx);
      this.vz = dampKnockback(this.vz);
      if (this.vx || this.vz) this.events.push(this.vx, this.vz);
    }
    switch (this.state) {
      case 'light':
        if (this.motionDone('light')) {
          this.vx = 0;
          this.vz = 0;
          if (this.lethal) this.die();
          else this.state = 'alive';
        }
        break;
      case 'block':
        if (this.motionDone('block')) this.state = 'alive';
        break;
      case 'heavy':
        // Stage 0, the fall: SE 0x15 / 0x21 when the motion passes frame 10.
        if (!this.landed) {
          const frame = this.events.motionFrame ? this.events.motionFrame() : this.ticksIn * 1.5;
          if (frame > HEAVY_LAND_FRAME) {
            this.landed = true;
            this.events.sound?.(this.events.landSound?.() ?? SE_HEAVY_LAND);
          }
        }
        if (this.motionDone('heavy')) {
          if (this.lethal) this.die();
          else {
            // Stage 2: the stand-up motion (slot 10).
            this.state = 'getup';
            this.startMotion('getup');
          }
        }
        break;
      case 'getup':
        if (this.motionDone('getup')) {
          this.invuln = INVULN_TICKS_GETUP;
          this.vx = 0;
          this.vz = 0;
          this.state = 'alive';
        }
        break;
      case 'dead':
        // The helper object starts when the death motion has played.
        if (this.fadeTicks < 0) {
          if (this.motionDone('death')) this.fadeTicks = 0;
          break;
        }
        this.fadeTicks++;
        this.fade = Math.min(DEATH_FADE_MAX, this.fadeTicks * DEATH_FADE_STEP);
        if (this.fadeTicks >= DEATH_FADE_TICKS) {
          // The return-to-Pioneer-2 routine: 6x4E, the revivable marker.
          this.state = 'revivable';
          this.events.sendRevivable();
        }
        break;
      case 'reviving':
        if (this.motionDone('revive')) this.state = 'alive';
        break;
      default:
        break;
    }
  }
}
