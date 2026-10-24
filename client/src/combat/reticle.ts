// The lock-on cursor (PsoBB.exe, Ephinea 1.25.13 dump names; VAs are the exe's).
//
// `enable_reticle` (0x00 dump 575550, the enemy AI states call it through
// enable_reticle_) runs check_enemy_is_targetable for every player's weapon and
// tech record; `find_targets_for_weapons_and_techs` then calls
// `create_target_reticles_for_weapon_or_tech`, which makes one reticle object
// (`init_reticle`, the g_BossWeaponReticle vtable) per target. The reticle is
// drawn by `render_reticle` -> `PositionAndRenderReticlePrimitives_007a360c`:
//   - the target's hitbox position, moved toward the camera by the hitbox radius
//     (CalculatePositionTowardsCamera_006ea73c), then the view's yaw;
//   - three copies of the cursor model at 60, 180 and 300 degrees (bams 0x2aaa,
//     0x7fff, 0xd554) on a circle of `notch_distance` (8.75, init_reticle), each
//     with a black outline (njcm chunk 2, drawn when the opacity is above
//     g_ReticleOutlineOpacityThreshold) and the coloured cursor 0.25 further in z;
//   - the model is `bm_ply_lock_on_cursor.bml` (LoadReticleModel_007a41d0, the
//     BML's njcm chunks 0 and 2: obj_f_maincarsol.nj, obj_f_blackcarsol.nj).
// The colour is a row of g_ReticleColorTable (0x009ff540, 14 rows of
// opacity, r, g, b floats) picked by GetReticleColorIndex_006aba4c from the
// player's targeting record; a target that cannot be picked up gets the
// fallback row (init_reticle).

// The bams angles of the three copies (PositionAndRenderReticlePrimitives_007a360c).
export const RETICLE_BAMS = [0x2aaa, 0x7fff, 0xd554] as const;

// init_reticle: notch_distance = 8.75 (field 0x38 of the reticle object).
export const RETICLE_NOTCH = 8.75;

// g_ReticleTranslationZOffset (0x009ff520, pushed before the outline's translate).
export const RETICLE_Z_OFFSET = 0.009999999776482582;

// The cursor's own translate in z (push 0x3e800000 = 0.25) after the outline.
export const RETICLE_MODEL_Z = 0.25;

// g_ReticleOutlineOpacityThreshold (0x0097cfd4): the outline is drawn when the
// reticle's opacity is above it.
export const RETICLE_OUTLINE_THRESHOLD = 0.9999899864196777;

// g_ReticleColorTable (0x009ff540): rows of [opacity, r, g, b].
export const RETICLE_COLORS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0.7799999713897705, 0],
  [1, 0, 0.7799999713897705, 0],
  [1, 0, 0, 1],
  [1, 1, 0, 0],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
  [1, 0.41999998688697815, 0.8100000023841858, 0.9599999785423279],
];

// The fallback row for a target that cannot be picked up (g_ReticleFallbackColor_*, 0x009ff620).
export const RETICLE_FALLBACK: readonly [number, number, number, number] = [1, 0, 0.38999998569488525, 0];

// The kind of target a reticle marks. The port's lock-on is an enemy (the first
// row of the table, the green cursor of the primary target); the other rows
// are the reticle colours of the other targets.
// ASSUMED: the exe picks the row from the player's weapon / tech record
// (GetReticleColorIndex_006aba4c over the 14-entry table at +4 / +0x3c of the
// targeting record, whose contents depend on the equipped weapon). The port
// uses row 0 for the lock-on enemy and row 4 for a support target (Resta's
// green-blue ally marker, the light-blue cursor of screenshot 6).
export type ReticleKind = 'enemy' | 'other' | 'support';

export function reticleRow(kind: ReticleKind): number {
  return kind === 'enemy' ? 0 : 4;
}

export function reticleColor(row: number): readonly [number, number, number, number] {
  return RETICLE_COLORS[row] ?? RETICLE_FALLBACK;
}

// Whether the black outline is drawn for a reticle of this opacity.
export function reticleOutlineVisible(opacity: number): boolean {
  return opacity > RETICLE_OUTLINE_THRESHOLD;
}

// bams (0..0xffff = a full turn) to radians.
export function bamsToRadians(bams: number): number {
  return (bams / 0x10000) * Math.PI * 2;
}
