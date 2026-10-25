// The minimap of PsoBB.exe (Ephinea 1.25.13): the radar in the field HUD
// (minimap_type 0) and the full map the Area Map window switches to
// (minimap_type 1; 2 is the split-screen map of the console versions,
// update_unknown_minimap_coop, which Blue Burst never selects:
// CreateItemObject_006dc358 is 0 there). This module keeps the state and
// the rules; render/minimap.ts draws them.
//
// Object: Minimap_CreateObject_00804d94 creates it with each floor (vtable
// g_MapObjectDerivedVtable; update unknown_minimap_update, render
// unknown_render_minimap), sets minimap_type = 0 and, per camera slot i =
// 0..2 of the table at 0x00aafb00 (0x40 bytes each: eye x, y, z, look offset
// x, y, z, yaw): InitMinimapMatrix_0083a57c, eye y = 2000 (0x00a11460), look
// offset (0, -1, 0), yaw 0x8000. Slot 0 is the radar (minimap1_xyz), slot 1
// the full map (minimap2_xyz). Object fields: +0x90 = 60 (the update and the
// render wait 60 frames after the floor loads), +0x168 = 2 (the height
// animation runs), +0x16c = 0 (zoom mode), +0x170 = 80 (0x00a11444, the
// height step), +0x174 = 0 (compass heading), +0x1a0 = 0.8 (room alpha cap).
//
// Update (after the 60 frames):
//   unknown_minimap_related: bit 1 of +0x168 = character option 1 (option
//     flags +0x4ec bit 0, get_character_option): the radar turns with the
//     camera.
//   unknown_minimap_update_players: marker 0 = the local player (x, z,
//     heading, colour unknown_minimap_player_colors[slot] = table 0x0097eaa0
//     {a, r, g, b}: red, green, yellow, blue), then the other players on the
//     same floor (floor_id_2 == g_CurrentFloor) in slot order; markers are
//     22.0 units (15.4 in zoom mode 2).
//   update_minimap_center_rotation: radar eye x, z = marker 0; radar yaw =
//     0x8000 (0 on De Rol Le's map, 12) or, turning, 0x8000 - camera
//     y_rotation; full map yaw 0x8000 (0 on De Rol Le); compass heading
//     +0x174 = 0 or, turning, -y_rotation (0x8000 - y_rotation on De Rol Le).
//     Height: +0x170 *= 1.2 (0x0097ecc8) each frame and the radar eye y
//     moves by it toward 2000 (mode 0) / 3500 (mode 1, 0x00a11464) / 1200
//     (mode 2, 0x00a11468), clamped there.
//   Room discovery: every room with flag 1 and without flag 2 whose centre
//     (room position + mesh centre) is within its radius (XZ) of marker 0
//     loses flag 1 and restarts its alpha at 0.
//   update_minimap_compass: +0x198 += 0x888; alpha +0x19c = (sin + 1.0) *
//     64 + 127 (0x0097ecc0 / 0x0097ecbc / 0x0097ecc4).
// Render (unknown_render_minimap): nothing while the local player's menu is
// open, unless the map is the full map; nothing while the player's UI
// blocks input unless HUD flag bit 1 is set; nothing with the talk
// cameras (5, 9). Order: the background (render_minimap_background: a quad
// of colour alpha << 24 over the rect, alphas 64 / 64 / 128 at
// FLOAT_ARRAY_00a11418), then the camera (Minimap_SetViewportAndLight
// _008047b4: viewport, unknown_size_minimaps, light (0, -1, 0) white, fog
// off), the discovered rooms (alpha += 0.08 (0x0097ec9c) each frame, capped
// at 0.8; colour minimap_ground_colors {1, 0.3, 0.3, 0.3} at 0x00a11450 with
// that alpha), the icons, the player markers (obj_f_player of
// obj_f_enemy.bml), then the compass (MinimapRenderIcon_00804b24).
//
// Viewport (CalculateMinimapViewport_00804844, table 0x00a11324 of {centre
// x, centre y, width, height, 500}): radar (544, 128) 128 x 128, full map
// (256, 352) 448 x 128; the background rects (0x00a113e8 / 0x00a11400) are
// the same. Camera (unknown_size_minimaps): eye = slot xyz * 1.0
// (0x00a1144c), target = eye + look offset, up = rotY(0x8000 - yaw) (0, 0,
// -1); the perspective is the game's default one (angle round-down(75 *
// 65536 / 360) = 0x3555, near 1, far 10000) and set_d3d_projection_matrix
// scales it by the full screen over the viewport, so the viewport shows its
// own part of a full-screen view: k = 2 * eye height * tan(fovy / 2) / 480
// world units per 640x480 pixel.

export type MinimapType = 0 | 1;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// Viewport / background per minimap_type (0x00a11324, 0x00a113e8 / 0x00a11400).
export const MINIMAP_RECT: readonly Rect[] = [
  { x: 480, y: 64, w: 128, h: 128 },
  { x: 32, y: 288, w: 448, h: 128 },
];
export const BACKGROUND_ALPHA = [64, 64] as const; // FLOAT_ARRAY_00a11418

export const START_DELAY = 60; // +0x90
export const DEFAULT_HEIGHT = 2000; // 0x00a11460
export const MAX_HEIGHT = 3500; // 0x00a11464 (g_MinimapYBounds)
export const MIN_HEIGHT = 1200; // 0x00a11468
export const HEIGHT_STEP = 80; // 0x00a11444
export const HEIGHT_RATE = 1.2; // 0x0097ecc8
export const ROOM_ALPHA_STEP = 0.08; // 0x0097ec9c
export const ROOM_ALPHA_MAX = 0.8; // +0x1a0 (0x3f4ccccd)
export const GROUND_COLOR = [0.3, 0.3, 0.3] as const; // 0x00a11454..0x00a1145c
export const MARKER_SIZE = 22; // modes 0 and 1
export const MARKER_SIZE_SMALL = 15.4; // mode 2
export const COMPASS_STEP = 0x888;
// unknown_minimap_player_colors (0x0097eaa0), ARGB by client slot.
export const PLAYER_COLORS = [0xffff0000, 0xff00ff00, 0xffffff00, 0xff0000ff] as const;
// Battle mode (MinimapCheckBattleOrSpawnItem_00803180 true): the markers take
// the team colours of the minimap's marker loop (dump lines 817265-817415):
// team 1 red (1, 0, 0), team 2 green (0, 1, 0), any other team yellow
// (1, 1, 0). The local player's marker is always drawn; the others are drawn
// only when they are on the local player's team, and a local team 0 draws no
// other marker.
export const TEAM_COLORS = { 1: 0xffff0000, 2: 0xff00ff00 } as const;
export function teamColour(team: number): number {
  return team === 1 ? TEAM_COLORS[1] : team === 2 ? TEAM_COLORS[2] : 0xffffff00;
}

// Icons (unknown_add_minimap_icon*: at most 128 a frame; unless forced, only
// within 300 units (90000 = 0x0097ecf8, squared, XZ) of the radar centre).
export const MAX_ICONS = 0x80;
export const ICON_RANGE_SQ = 90000;
// The enemies' icon: shape 1 (the disc of obj_f_enemy, scale 8 x 8 x 8 =
// minimap_circle_size 0x0097ec98), colour 0xffffa24c, scale 1.
export const ENEMY_ICON_COLOR = 0xffffa24c;
export const CIRCLE_SIZE = 8;
// Shape 0 (switches, TObjRaderIcon): the gate box scaled 13.6 x 8 x 5.6
// (0x0097ec90 / 0x0097ec94) times the icon scale.
export const SWITCH_SIZE = [13.6, 5.6] as const;

// The enemies' icon rules. The default is the plain icon (unknown_add_minimap_icon,
// scale 1, range checked). The boss updates call unknown_add_minimap_icon3
// (vec3f, colour, scale float, shape, flags) with the flag 1 (forced: no
// range check) and a bigger scale; the scale is the icon's size (the bosses'
// icons are drawn at 4.0 or 5.0). Keyed by the enemy's newserv type name.
export interface EnemyIconRule {
  scale: number;
  color: number;
  forced: boolean;
}
export const ENEMY_ICON_RULE: EnemyIconRule = { scale: 1, color: ENEMY_ICON_COLOR, forced: false };
// The shared enemy-base radar slot (PsoBB.exe 0x00520618, dump label
// PoisonLilyUpdateMinimap_00520618; the label is a community name, the function
// serves every family that reaches it): `if ((flags+0x30) & 0x40800) == 0`, then
// unknown_add_minimap_icon at +0x38 (x2), colour 0xffffa24c, scale 1, range
// checked. Bit 0x800 is "dead" (headers/battle.h), 0x40000 is the radar / lock-on
// bit (DEVLOG 2026-10-25, Gibbon and Mericarol). The slot is the family's +0x198
// (Mericarol, vtable 0x00b06320, called unconditionally by its update 0x00573050
// at 0x005730eb) or +0x188 (Gibbon, vtable 0x00b05750). The Booma family does not
// use it (its states add their own icons, see BOOMA_ICON_STATES).
export const BASE_ICON_HIDDEN_FLAGS = 0x40800;
export function baseIconShown(flags: number): boolean {
  return (flags & BASE_ICON_HIDDEN_FLAGS) === 0;
}
// The Booma family (vtable 0x00b01fc0, base ctor 0x0052b6ec, dump label
// "LilyTarget" for its vtable): unknown_ai_state -> handler, and whether the
// handler adds a radar icon (the calls to unknown_add_minimap_icon in the
// handler's body, objdump of PsoBB.exe, VERIFIED for the call sites). State 0 is
// the spawn (0x00535a6c, unknown_booma_enemy_spawn_handler: no icon); 6 and 9+
// are the empty slots (0x0061cdb0 placeholder); 8 (0x0052b518) adds none.
// Shark, Dimenian and the other Booma-substrate families use these handlers
// (ASSUMED: the same table for each; their vtables were not diffed).
export const BOOMA_ICON_STATES: readonly number[] = [1, 2, 3, 4, 5, 7];
export function boomaIconShown(state: number): boolean {
  return BOOMA_ICON_STATES.includes(state);
}
// The port's Booma-substrate brain (combat/enemyai.ts AiState) mapped to the exe's
// state numbers. idle = state 1 (wander, 0x0052a6e4); notice and chase = state 3
// (the war cry, then the chase, 0x0052afe4); attack and recover = state 5 (the
// attack, then substate 2 with the 15-tick wait, 0x0052b290); dead = state 8.
// spawn = state 0 (unknown_booma_enemy_spawn_handler 0x00535a6c, dump 319268: the
// spawn animation 0xb, invulnerable, then state 1). The Booma brain's 'spawn'
// state (combat/enemyai.ts EnemyAi) is that handler. The Shark (0x00552704) and
// the Dimenian (0x005ad51c) spawns report it too (their timer, not an animation);
// render/combat.ts keeps their radar icon through that spawn (timedSpawn).
export const BOOMA_BRAIN_EXE_STATE: Readonly<Record<string, number>> = {
  spawn: 0,
  idle: 1,
  notice: 3,
  chase: 3,
  attack: 5,
  recover: 5,
  dead: 8,
};
export function boomaBrainIconShown(brain: string): boolean {
  const state = BOOMA_BRAIN_EXE_STATE[brain];
  return state === undefined ? true : boomaIconShown(state);
}
// The families whose vtable is the Booma table (ctor 0x00535f1c for Booma, Gobooma,
// Gigobooma; ctor 0x00512bd0 for Evil / Pal / Guil Shark, vtable 0x00aff860;
// ctor 0x00551d3c for Dimenian / La / So, vtable 0x00b041e0). Their states 1 to 8
// are the same handlers as the Booma's (vtable rows, DEVLOG 2026-10-25). The Shark
// spawn (0x00552704) and the Dimenian state 9 (0x005517a0) differ and are not
// gated here (ASSUMED: they add no icon, untraced).
export const BOOMA_BRAIN_TYPES: ReadonlySet<string> = new Set([
  'BOOMA', 'GOBOOMA', 'GIGOBOOMA', 'EVIL_SHARK', 'PAL_SHARK', 'GUIL_SHARK', 'DIMENIAN', 'LA_DIMENIAN', 'SO_DIMENIAN',
]);
// The radar source of each enemy type, from its vtable (the shared slot
// 0x00520618 holds 0x198 of the vtable, or 0x188 for Gibbon). 'booma': the Booma
// table, icon per state. 'slot': the shared enemy-base slot (baseIconShown).
// 'rappy': unconditional in the alive update (update_rappy, dump 308039).
// 'own': the family's own icon call (unknown_add_minimap_icon 0x00805608, or a
// sibling), with no 0x40800 test on its path; the port keeps the default (alive and
// visible, concealed() for the families that list it). ASSUMED the update identity
// where noted in the table comments below.
// 'none': no radar icon at all (Garanz: no slot and no icon call, E8 scan of
// 0x56f8b8..0x571000, DEVLOG 2026-10-25 Garanz).
// 'gated': an own icon behind an exe flag, which the port applies (Claw: +0x390 bit
// 0x10000000 hides the icon; ClawAi.hidden).
// 'unsurveyed': no vtable or update found; the port keeps the default.
// Dark Gunner's icon is per state (dispatcher 0x005443c4 on +0x32e: states 1, 2, 3,
// 4, 6 add it; 0, 5, 8 do not) and its update adds one only in a timed-status branch;
// the port has no brain for it, so it stays 'own' (default), ASSUMED.
export type RadarSource = 'booma' | 'slot' | 'rappy' | 'own' | 'none' | 'gated' | 'unsurveyed';
export const ENEMY_RADAR_SOURCE: Readonly<Record<string, RadarSource>> = {
  BOOMA: 'booma', GOBOOMA: 'booma', GIGOBOOMA: 'booma',
  EVIL_SHARK: 'booma', PAL_SHARK: 'booma', GUIL_SHARK: 'booma',
  DIMENIAN: 'booma', LA_DIMENIAN: 'booma', SO_DIMENIAN: 'booma',
  SAVAGE_WOLF: 'slot', CHAOS_SORCERER: 'slot', CHAOS_BRINGER: 'slot', DARK_BELRA: 'slot',
  // Canadine (vtable 0x00b02be0, slot +0x198, update calls it at 0x00541d99), Poison Lily
  // and Del Lily (vtable 0x00b00fe0, slot at +0x198, update 0x00529754 calls it at 0x005297c1,
  // gated by the pause only), Dubchic (vtable 0x00b04a40 / 0x00b04cc0, slot at +0x198;
  // the extra pause gate FUN_004f7c84 is ASSUMED to change nothing here).
  CANADINE: 'slot', POISON_LILY: 'slot', DEL_LILY: 'slot', DUBCHIC: 'slot',
  RAPPY: 'rappy',
  // Own icon, no 0x40800 test: Hildebear (0x00affb20, icon at 0x0051360a), Grass Assassin
  // (0x00b00b60, unconditional at the end of each state), Delsaber (0x00b03fa0 / 0x00b041e0,
  // call at 0x00551692), Bulclaw (0x00b01b40, 0x00531e77), Dark Gunner (see above),
  // Nano Dragon (0x00b074e0, gate word +0x390 bit 0x40000; the port's concealed() already
  // reads its untargetable), Nar Lily and Sinow Beat (sibling 0x008056b0, state and +0x398
  // gates; family attribution of the update 0x00606e34 ASSUMED).
  HILDEBEAR: 'own', GRASS_ASSASSIN: 'own', NANO_DRAGON: 'own', DELSABER: 'own',
  BULCLAW: 'own', DARK_GUNNER: 'own', NAR_LILY: 'own', SINOW_BEAT: 'own',
  // Garanz: no icon.
  GARANZ: 'none',
  // Claw: +0x390 bit 0x10000000 hides the icon (ASSUMED the port's ClawAi.hidden is that bit).
  CLAW: 'gated',
  // Gillchic (vtable not found) and Sinow Gold (no ctor in the type table): default kept.
  GILLCHIC: 'unsurveyed', SINOW_GOLD: 'unsurveyed',
};
export function radarSourceOf(type: string): RadarSource | null {
  return ENEMY_RADAR_SOURCE[type] ?? null;
}
// OLGA_FLOW_1 (the phase-1 beast, ctor 0x00497580): the update of
// Olga1ObjectUpdate_00492a84 calls icon3 at its position with scale 0x40a00000
// (5.0), colour 0xffffa24c, flags 1 (exe 0x00492d95). ASSUMED: the position is
// the enemy's root (the dump passes param_1[1].field_0x144).
// OLGA_FLOW_2 (unknown_olga_related, dump 218236): icon3 at the root (&x2) with
// scale 0x40800000 (4.0), colour 0xffffa24c, flags 1 (dump 218366), straight
// after enable_reticle. ASSUMED: x2 is the root, as for phase 1.
// DE_ROL_LE (UpdateDerolle, dump 175033): icon3 at &x2 with scale 0x40000000
// (2.0), flags 1 (dump 175250). ASSUMED: the port's DE_ROL_LE is this update
// (the body and mine types are other updates).
// GAL_GRYPHON (update_gal_gryphon, dump 226140): icon3 at &x2 with scale 2.0,
// flags 1 (dump 226217), unconditional after enable_reticle.
// SINOW_BERILL (UpdateSinowberillEntity_004addc0, dump 231611): icon3 at &x2
// with scale 0x40000000 (2.0), flags 1 (dump 231675), unconditional after
// enable_reticle (exe 0x004addc0 onwards). ASSUMED: this update is the Sinow
// Berill's: the dump's enemy id 212 (0xd4) is the setdata row that gives
// SINOW_BERILL (formats/setdata.ts, p6 == 0), and the state set (lock-on attack,
// death) matches it. Sinow Berill is an enemy, not a boss.
// DRAGON (the Episode 1 Caves boss, OlgaUpdateMainLoop_00423b7c = the Dragon's
// per-frame update, dump 165532, the name is a community mislabel, see
// combat/dragon.ts): icon3 at &x with scale 0x40000000 (2.0), colour 0xffffa24c,
// flags 1 (dump 165532), unconditional after enable_reticle_ (the leader and
// follower branches both end before it). Settled 2026-10-25 (DEVLOG).
// The Gal Gryphon minion's Effect (UpdateGalgryphonMinion_004ab283, dump 229625)
// has its own forced icon, 1.5, in its state 1 (MOVE), not state 2: combat/
// galgryphonminion.ts minimapIcons(). Nothing creates the Effect yet (the Gal
// Gryphon brain is not in the port), so no icon reaches the radar.
// The De Rol Le shell segments (DE_ROL_LE_BODY, the ten DrlSegmentAi entities):
// their update is FUN_00435294 = handle_derolle_shell_behavior (dump 176942;
// the exe decompile of 0x00435294, tools/ghidra/decomp.sh, is the same body:
// the position is the pointer at +0x398 = current_target, copied into x2 (dump
// 176954-176956), then enable_reticle_ and unknown_add_minimap_icon3
// at x2 with 0x3f99999a (1.2), colour 0xffffa24c, flags 1, dump 176968 =
// exe 0x0080575c, the same icon3 the body uses). Only the pause gate precedes
// it, so forced whatever the hit box (PROVEN 2026-10-25: the only De Rol Le
// icon callers are UpdateDerolle dump 175250 (2.0) and this one; neither calls
// the plain icon 0x00805608). The icon's owner is the segment, not the
// body (the body's own icon is 2.0 above); render/combat.ts minimapEnemies
// reports the segments under this type.
export const FORCED_ICON_RULES: Readonly<Record<string, EnemyIconRule>> = {
  OLGA_FLOW_1: { scale: 5, color: ENEMY_ICON_COLOR, forced: true },
  OLGA_FLOW_2: { scale: 4, color: ENEMY_ICON_COLOR, forced: true },
  DE_ROL_LE: { scale: 2, color: ENEMY_ICON_COLOR, forced: true },
  DE_ROL_LE_BODY: { scale: 1.2, color: ENEMY_ICON_COLOR, forced: true },
  GAL_GRYPHON: { scale: 2, color: ENEMY_ICON_COLOR, forced: true },
  SINOW_BERILL: { scale: 2, color: ENEMY_ICON_COLOR, forced: true },
  DRAGON: { scale: 2, color: ENEMY_ICON_COLOR, forced: true },
};
export function enemyIconRule(type: string): EnemyIconRule {
  return FORCED_ICON_RULES[type] ?? ENEMY_ICON_RULE;
}

// Komo variant 6 (MapObjectKomoVariant6Update_0065d89c, Episode 2 only): one
// icon2 a frame at the object, shape 3, flags 0 (range checked), heading =
// yrot. The colour is red while its state is 0 (active, 0xffff0000) and green
// at 1 (idle). The scale is the parity of the object's +0x8c value, negative
// when the value is: the dump's `(((v ^ s) - s) & 1 ^ s) - s` with s = v >> 31
// (logical shift, so s is 0 or 1) gives an odd value 1 (or -1 when negative)
// and an even one 0 (dump line 524053).
export function komoVariant6Icon(value: number, state: 0 | 1, yrot: number, pos: { x: number; z: number }): Icon {
  const v = Math.trunc(value);
  const odd = Math.abs(v) & 1;
  return { x: pos.x, z: pos.z, color: state === 0 ? ICON_RED : ICON_GREEN, shape: 3, scale: v < 0 ? -odd : odd, heading: yrot };
}

// Dark Falz form 3 (dark_falz_form3_minimap_icons, dump 198990; called from
// VoloptForm7EntityUpdate 0045ad6c, dump 198703). The body's icon is forced at
// 5.0 (icon3 flags 1, dump 199068); its colour is the prisoner's table entry
// DAT_009a6428 (g_DarkFalzForm3MinimapIconColors, read from the exe: red,
// green, yellow, blue), or 0xffffa24c when nobody is held (0xffff). The colour
// is kept at +0x3cc (the ctor sets 0xffffa24c, dump 200031) and moves toward
// its target by 16 a channel a frame. A held slot above 3 draws nothing and
// does not fade (dump 199013).
export const FALZ3_COLORS: readonly number[] = [0xffff0000, 0xff00ff00, 0xffffff00, 0xff0000ff];
export const FALZ3_DEFAULT_COLOR = 0xffffa24c;
export const FALZ3_FADE_STEP = 0x10;
// The trail: forced 2.5 icons (icon3 0x40200000, dump 199121) every 25 units
// (g_DarkFalzMinimapStepSize = 25.0, dump 199087) from the body toward the
// prisoner, at most round(360 / 25) = 14 of them (span 360 at 0x00a45820, dump
// 199083 and 199092), in the prisoner's colour (not faded).
export const FALZ3_TRAIL_STEP = 25;
export const FALZ3_TRAIL_SPAN = 360;
export const FALZ3_TRAIL_SCALE = 2.5;

// One channel-wise step of the colour fade (dark_falz_form3_minimap_icons,
// dump 199018-199060): each of the three colour bytes moves toward the target
// by 16 and stops at it; the alpha is 0xff.
export function fadeColor(cur: number, target: number): number {
  let out = 0xff000000;
  for (let sh = 0; sh < 24; sh += 8) {
    const a = (cur >>> sh) & 0xff;
    const t = (target >>> sh) & 0xff;
    const v = t > a ? Math.min(a + FALZ3_FADE_STEP, t) : t < a ? Math.max(a - FALZ3_FADE_STEP, t) : a;
    out |= v << sh;
  }
  return out >>> 0;
}

// The colour the body fades toward for a prisoner slot (-1 for none), or null
// when the exe draws nothing (a slot above 3, dump 199013).
export function falz3TargetColor(held: number): number | null {
  if (held < 0) return FALZ3_DEFAULT_COLOR;
  return held <= 3 ? FALZ3_COLORS[held] : null;
}

// The body's icon and the trail toward the prisoner (player: the prisoner's
// position, null when none). White (0xffffffff) overrides the colour while the
// scale +0x3b8 is 0 with flag 4 (the caller's `white`, from the frame's counter
// +0x3c8, see combat/darkfalz3.ts). The trail is drawn only on frames where
// +0x3c8 bit 0 is clear (`trail`; the counter steps once a frame, so every
// other frame).
export function falz3Icons(
  pos: { x: number; z: number },
  colour: number,
  held: number,
  player: { x: number; z: number } | null,
  white = false,
  trail = true,
): Icon[] {
  if (falz3TargetColor(held) === null) return [];
  const out: Icon[] = [{ x: pos.x, z: pos.z, color: white ? 0xffffffff : colour, shape: 1, scale: 5, heading: 0 }];
  if (!trail || held < 0 || !player) return out;
  const dx = player.x - pos.x;
  const dz = player.z - pos.z;
  const len = Math.hypot(dx, dz);
  if (len < FALZ3_TRAIL_STEP) return out;
  const count = Math.min(Math.round(len / FALZ3_TRAIL_STEP), Math.round(FALZ3_TRAIL_SPAN / FALZ3_TRAIL_STEP));
  const ux = (dx / len) * FALZ3_TRAIL_STEP;
  const uz = (dz / len) * FALZ3_TRAIL_STEP;
  const trailColour = FALZ3_COLORS[held];
  for (let k = 1; k <= count; k++) {
    out.push({ x: pos.x + ux * k, z: pos.z + uz * k, color: trailColour, shape: 1, scale: FALZ3_TRAIL_SCALE, heading: 0 });
  }
  return out;
}

// The form's radar icons (UpdateVoloptForm7Behavior, dump 195879; the update
// 0x00454838 in the exe, the vtable 0x00AF75A0 of the form 1 ctor): four forced
// 5.0 icons in 0xffffa24c, at the body and at the three heads (dump 195973-195992),
// then a ring of forced 5.0 icons round the body. The ring's radii are
// ROUND(step), ROUND(step + r), ... with step 150 / 4.0 = 37.5 (the exe's
// g_VoloptForm7HazardRadiusDivided, _DAT_008fff14 = 4.0), so 38, 76, 114: at each
// radius, four icons (the last radius three) at the body's cardinal points turned
// by the yaw (dump 196000-196050). ASSUMED: the head icons use the port's head
// points (`heads`, ASSUMED in darkfalz1.ts), and ROUND is round-to-nearest.
export const F1_MINIMAP_COLOUR = 0xffffa24c;
export const F1_RING_STEP = 150 / 4;
export function form1Icons(body: { x: number; z: number }, heads: readonly (readonly number[])[], sin: number, cos: number): Icon[] {
  const out: Icon[] = [];
  const add = (x: number, z: number) => out.push({ x, z, color: F1_MINIMAP_COLOUR, shape: 1, scale: 5, heading: 0 });
  add(body.x, body.z);
  for (const h of heads) add(h[0], h[2]);
  const s = sin;
  const c = cos;
  let r = Math.round(F1_RING_STEP);
  for (let i = 0; i < 3; i++) {
    add(body.x - r * c, body.z + r * s);
    add(body.x + r * s, body.z + r * c);
    add(body.x + r * c, body.z - r * s);
    if (i < 2) add(body.x - r * s, body.z - r * c);
    r = Math.round(F1_RING_STEP + r);
  }
  return out;
}

// Full-map pan bounds (Minimap_ClampPlayerPosition_008058b4, filled in by the
// static initializer 0x008059dc / data 0x00a11434): {min x, max x, min z,
// max z}; the second row is for the Wilds (map type 8, table 0x0097f040);
// Vol Opt, Dark Falz, Olga Flow and the Tower (13, 14, 31, 35) are not clamped.
export const PAN_BOUNDS = [
  [-6000, 6000, -6000, 6000],
  [-3000, 9000, -9000, 3000],
] as const;
const UNCLAMPED_MAPS: ReadonlySet<number> = new Set([13, 14, 31, 35]);
const WILDS_MAPS: ReadonlySet<number> = new Set([36, 37, 38, 39]);
export const DE_ROL_LE = 12;

// Compass sprites (MinimapRenderIcon_00804b24, texlist RaderMapFrame.xvm,
// sprite table 0x00a113c0 {w, h, pivot x, pivot y, u0, v0, u1, v1, ...}):
// texture 1 (32 x 32, pivot 16, 16) at 0x00a11398 + pivot, its alpha the
// compass pulse; texture 0 (32 x 32, pivot 16, 27) at 0x00a11390 + pivot,
// turned by the compass heading (RenderMinimapIcon_00819f7c flag 1).
export interface CompassSprite {
  texture: 0 | 1;
  x: number; // top-left before rotation
  y: number;
  pivotX: number;
  pivotY: number;
}
export const COMPASS: readonly (readonly [CompassSprite, CompassSprite])[] = [
  [
    { texture: 1, x: 575, y: 159, pivotX: 16, pivotY: 16 },
    { texture: 0, x: 575, y: 149, pivotX: 16, pivotY: 27 },
  ],
  [
    { texture: 1, x: 450, y: 383, pivotX: 16, pivotY: 16 },
    { texture: 0, x: 450, y: 373, pivotX: 16, pivotY: 27 },
  ],
];
export const COMPASS_SIZE = 32;

const BAMS = 0x10000;
const TWO_PI = 6.283184051513672; // the exe's float 2*pi
export const bamsToRad = (b: number): number => (b * TWO_PI) / BAMS;
export const radToBams = (r: number): number => Math.round((r * BAMS) / TWO_PI) & 0xffff;
// int_sin: the exe reads a 4096-entry table; Math.sin of the angle is close.
const intSin = (b: number): number => Math.sin(bamsToRad(b & 0xffff));

// fovy (radians) of the default perspective, angle 0x3555 (SetupD3DProjection
// Matrix_0082eea0; the same formula as classic/playerview.ts njPerspectiveFovy).
export const PERSPECTIVE_ANGLE = Math.trunc((75 * BAMS) / 360); // 0x3555
export function minimapFovy(): number {
  const a = Math.trunc(Math.trunc((PERSPECTIVE_ANGLE * 85) / 100) / 2);
  const t = Math.tan((a * TWO_PI) / BAMS) / Math.fround(1.1333334);
  const n = Math.trunc((Math.atan(t) * BAMS) / TWO_PI);
  return (n * 2 * TWO_PI) / BAMS;
}

// World units per 640x480 pixel at an eye height.
export function unitsPerPixel(height: number): number {
  return (2 * height * Math.tan(minimapFovy() / 2)) / 480;
}

export function clampPan(map: number, p: { x: number; z: number }): void {
  if (UNCLAMPED_MAPS.has(map)) return;
  const [x0, x1, z0, z1] = PAN_BOUNDS[WILDS_MAPS.has(map) ? 1 : 0];
  if (p.x < x0) p.x = x0;
  if (p.x > x1) p.x = x1;
  if (p.z < z0) p.z = z0;
  if (p.z > z1) p.z = z1;
}

// One room's runtime state (flags / alpha of minimap_room_data).
export interface RoomState {
  index: number;
  flags: number;
  alpha: number;
  cx: number; // discovery centre (room position + mesh centre)
  cz: number;
  radius: number;
}

export interface MinimapRoomInput {
  index: number;
  flags: number;
  position: readonly [number, number, number];
  radius: number;
  model: { center: readonly [number, number, number] };
}

export interface Marker {
  slot: number;
  x: number;
  z: number;
  heading: number; // BAMS
  color: number; // ARGB
  size: number;
}

export interface Icon {
  x: number;
  z: number;
  color: number; // ARGB
  shape: 0 | 1 | 2 | 3;
  scale: number;
  heading: number; // BAMS
}

export interface MinimapPlayer {
  slot: number;
  x: number;
  y?: number; // the height (TObjRaderHideCol's distance is 3D)
  z: number;
  heading: number; // BAMS
  team?: number | null; // the battle team (battle mode only; see teamColour)
}

// The camera of the slot drawn this frame.
export interface MinimapCamera {
  x: number;
  y: number;
  z: number;
  yaw: number; // BAMS: up = rotY(0x8000 - yaw) (0, 0, -1)
}

// Up vector on the XZ plane for a slot yaw.
export function cameraUp(yaw: number): { x: number; z: number } {
  const a = bamsToRad((0x8000 - yaw) & 0xffff);
  // rotY(a) applied to (0, 0, -1).
  return { x: -Math.sin(a), z: -Math.cos(a) };
}

// Saved room flags of every floor of the game (floor_minimap_room_flags,
// Minimap_InitArena_00805a24: 18 floors, cleared when a game starts). The
// client keys them by floor; here the key is the floor's minimap file as well
// (a quest can put another layout on the same floor), and a saved array whose
// length does not match the rooms is dropped.
export class MinimapFloors {
  private saved = new Map<string, Uint16Array>();
  load(key: string, rooms: number): Uint16Array | null {
    const flags = this.saved.get(key);
    if (flags && flags.length !== rooms) {
      this.saved.delete(key);
      return null;
    }
    return flags ?? null;
  }
  save(key: string, flags: Uint16Array): void {
    this.saved.set(key, flags);
  }
}

export class MinimapState {
  type: MinimapType = 0;
  rooms: RoomState[] = [];
  map = 0;
  floor = -1;
  private key = '';
  delay = START_DELAY; // +0x90
  turning = false; // +0x168 bit 1
  zoomMode: 0 | 1 | 2 = 0; // +0x16c
  heightStep = HEIGHT_STEP; // +0x170
  radar: MinimapCamera = { x: 0, y: DEFAULT_HEIGHT, z: 0, yaw: 0x8000 };
  full: MinimapCamera = { x: 0, y: DEFAULT_HEIGHT, z: 0, yaw: 0x8000 };
  heading = 0; // +0x174
  compassPhase = 0; // +0x198
  compassAlpha = 0; // +0x19c, 0..255
  markers: Marker[] = [];
  icons: Icon[] = [];
  loaded = false; // minimap_current_map_data present

  // load_minimap_data: a floor's rooms, with the flags saved from an earlier
  // visit, or every room undiscovered on the first one.
  // Minimap_CreateObject_00804d94 resets the object; the full map pan
  // (minimap2_xyz) is a global and keeps its values.
  // `key`: the floor and its minimap file (MinimapFloors).
  enterFloor(floor: number, map: number, rooms: readonly MinimapRoomInput[] | null, saved: MinimapFloors, key = String(floor)): void {
    this.leaveFloor(saved);
    this.floor = floor;
    this.key = key;
    this.map = map;
    this.type = 0;
    this.delay = START_DELAY;
    this.zoomMode = 0;
    this.heightStep = HEIGHT_STEP;
    this.radar = { x: 0, y: DEFAULT_HEIGHT, z: 0, yaw: 0x8000 };
    this.full.yaw = 0x8000;
    this.heading = 0;
    this.compassPhase = 0;
    this.compassAlpha = 0;
    this.markers = [];
    this.icons = [];
    this.loaded = rooms !== null;
    const flags = rooms ? saved.load(key, rooms.length) : null;
    this.rooms = (rooms ?? []).map((r, i) => ({
      index: r.index,
      flags: flags ? flags[i] : r.flags | 1,
      alpha: 0,
      cx: r.position[0] + r.model.center[0],
      cz: r.position[2] + r.model.center[2],
      radius: r.radius,
    }));
  }

  // uninit_minimap_data: the room flags go back to the floor's array.
  leaveFloor(saved: MinimapFloors): void {
    if (this.loaded && this.floor >= 0) saved.save(this.key, Uint16Array.from(this.rooms.map((r) => r.flags)));
    this.loaded = false;
    this.rooms = [];
  }

  get ready(): boolean {
    return this.loaded && this.delay <= 0;
  }

  // Minimap_MarkRoomDiscovered_00805400 (a TObjRaderCol's first frame):
  // the room stays hidden until revealed.
  holdRoom(index: number): boolean {
    const r = this.rooms.find((x) => x.index === index);
    if (!r) return false;
    r.flags |= 2;
    return true;
  }

  // mark_minimap_room_as_discovered.
  revealRoom(index: number): boolean {
    const r = this.rooms.find((x) => x.index === index && x.flags & 1);
    if (!r) return false;
    r.flags &= ~1;
    r.alpha = 0;
    return true;
  }

  // Minimap_UpdateRoomDiscoveryState_00804d58 (a Challenge stage restart: 1).
  setAllRooms(flag: number): void {
    for (const r of this.rooms) r.flags |= flag;
  }

  // unknown_minimap_update. `self`: the local player (null = none or
  // invisible); `others`: the other players on this floor; `cameraYaw`: the
  // camera's y_rotation (BAMS); `battle`: the local player's battle team
  // while battle mode runs (null = not in battle mode: the slot colours).
  update(self: MinimapPlayer | null, others: readonly MinimapPlayer[], cameraYaw: number, battle: number | null = null): void {
    if (!this.loaded) return;
    if (this.delay > 0) {
      this.delay--;
      return;
    }
    this.markers = [];
    const size = this.zoomMode === 2 ? MARKER_SIZE_SMALL : MARKER_SIZE;
    if (self) this.markers.push({ slot: self.slot, x: self.x, z: self.z, heading: self.heading, color: battle === null ? PLAYER_COLORS[self.slot & 3] : teamColour(battle), size });
    for (const p of others) {
      if (battle === null) {
        this.markers.push({ slot: p.slot, x: p.x, z: p.z, heading: p.heading, color: PLAYER_COLORS[p.slot & 3], size });
      } else if (battle !== 0 && p.team === battle) {
        this.markers.push({ slot: p.slot, x: p.x, z: p.z, heading: p.heading, color: teamColour(battle), size });
      }
    }
    // update_minimap_center_rotation.
    if (self) {
      this.radar.x = self.x;
      this.radar.z = self.z;
    }
    const derolle = this.map === DE_ROL_LE;
    if (this.turning) {
      this.radar.yaw = (0x8000 - cameraYaw) & 0xffff;
      this.full.yaw = derolle ? 0 : 0x8000;
      this.heading = (derolle ? 0x8000 - cameraYaw : -cameraYaw) & 0xffff;
    } else {
      this.radar.yaw = derolle ? 0 : 0x8000;
      this.full.yaw = this.radar.yaw;
      this.heading = 0;
    }
    this.stepHeight();
    if (self) this.discover(self.x, self.z);
    this.compassPhase = (this.compassPhase + COMPASS_STEP) & 0xffff;
    this.compassAlpha = (intSin(this.compassPhase) + 1) * 64 + 127;
  }

  private stepHeight(): void {
    this.heightStep *= HEIGHT_RATE;
    const y = this.radar.y;
    if (this.zoomMode === 0) this.radar.y = Math.min(y + this.heightStep, DEFAULT_HEIGHT);
    else if (this.zoomMode === 1) this.radar.y = Math.min(y + this.heightStep, MAX_HEIGHT);
    else this.radar.y = Math.max(y - this.heightStep, MIN_HEIGHT);
  }

  // The discovery loop of unknown_minimap_update (vec3f_xz_dist_squared <
  // radius^2).
  discover(x: number, z: number): number {
    let n = 0;
    for (const r of this.rooms) {
      if (r.flags & 2 || !(r.flags & 1)) continue;
      const dx = r.cx - x;
      const dz = r.cz - z;
      if (dx * dx + dz * dz < r.radius * r.radius) {
        r.alpha = 0;
        r.flags &= ~1;
        n++;
      }
    }
    return n;
  }

  // The rooms' fade-in, once per drawn frame.
  fadeRooms(): void {
    for (const r of this.rooms) if (!(r.flags & 1)) r.alpha = Math.min(r.alpha + ROOM_ALPHA_STEP, ROOM_ALPHA_MAX);
  }

  // unknown_add_minimap_icon / icon2 / icon3: false when full or (unless
  // forced) out of range of the radar centre.
  addIcon(icon: Icon, force = false): boolean {
    if (this.icons.length >= MAX_ICONS) return false;
    if (!force) {
      const dx = icon.x - this.radar.x;
      const dz = icon.z - this.radar.z;
      if (dx * dx + dz * dz > ICON_RANGE_SQ) return false;
    }
    this.icons.push(icon);
    return true;
  }

  // The icons are drawn once and cleared (minimap_object_count = 0 at the end
  // of unknown_render_minimap).
  takeIcons(): Icon[] {
    const out = this.icons;
    this.icons = [];
    return out;
  }

  get camera(): MinimapCamera {
    return this.type === 1 ? this.full : this.radar;
  }

  // Minimap_GetPlayerPosition2D_008054fc: the full map, centred on marker 0.
  openFullMap(): void {
    this.type = 1;
    const m = this.markers[0];
    this.full.x = m ? m.x : 0;
    this.full.z = m ? m.z : 0;
  }

  closeFullMap(): void {
    this.type = 0;
  }

  // MinimapZoomIn_00802b44 / MinimapZoomOutZ_00802b78 (both pan, despite
  // the names) and MinimapMoveY_00802bac (the height), full map only.
  pan(dx: number, dz: number): void {
    if (this.type !== 1) return;
    this.full.x -= dx;
    this.full.z -= dz;
    clampPan(this.map, this.full);
  }

  moveHeight(dy: number): void {
    if (this.type !== 1) return;
    this.full.y = Math.min(Math.max(this.full.y + dy, MIN_HEIGHT), MAX_HEIGHT);
  }

  // Minimap_SetPlayer2Position_00805568 / Minimap_GetPlayer2Position_00805598.
  setPan(x: number, z: number): void {
    if (this.type !== 1) return;
    this.full.x = x;
    this.full.z = z;
    clampPan(this.map, this.full);
  }
}

// ---- Object icons and the radar hide volume ----
// Icon colours of the exe's unknown_add_minimap_icon4 calls: 0xffff0000 red,
// 0xff00ff00 green (ARGB).
export const ICON_RED = 0xffff0000;
export const ICON_GREEN = 0xff00ff00;

// TObjRaderIcon (0x0027): create Variant2 (CreateMapObjectRadarCollisionVariant2_006635d8),
// render MapObjectRadarCollisionRender_00663468, which adds one icon a frame
// (unknown_add_minimap_icon2, range checked, shape 0 = the switch box, scale
// = param1, heading = yrot). Param4 (initdata +0x84): mode = 1 when > 0, else
// 0. Param5: high word = switch count (0..12), low word = first switch flag,
// at most 0xff - count. Param6: the colour of mode 1.
// The scale is param1 when it is above 0, else 0.0 (0x00939070).
export interface RaderIconObject {
  x: number;
  y: number;
  z: number;
  heading: number; // BAMS
  scale: number;
  mode: 0 | 1;
  count: number;
  base: number;
  colour: number; // ARGB, mode 1
}

export function raderIconObject(params: readonly number[], pos: { x: number; y: number; z: number }, heading: number): RaderIconObject {
  const p1 = params[0];
  const p4 = params[3] | 0;
  const p5 = params[4] >>> 0;
  const p6 = params[5] >>> 0;
  let count = (p5 >>> 16) & 0xffff;
  if (count > 0xb) count = 0xc;
  const lo = p5 & 0xffff;
  const base = lo <= 0xff - count ? lo : 0xff - count;
  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    heading,
    scale: p1 > 0 ? p1 : 0,
    mode: p4 > 0 ? 1 : 0,
    count,
    base,
    colour: p6,
  };
}

// The colour of a TObjRaderIcon: mode 1 its colour; mode 0 green while every
// switch flag of its range is set on this floor (no range: green), else red.
export function raderIconColour(o: RaderIconObject, isSwitchOn: (flag: number) => boolean): number {
  if (o.mode === 1) return o.colour;
  for (let i = 0; i < o.count; i++) if (!isSwitchOn(o.base + i)) return ICON_RED;
  return ICON_GREEN;
}

export function raderIconIcon(o: RaderIconObject, isSwitchOn: (flag: number) => boolean): Icon {
  return { x: o.x, z: o.z, color: raderIconColour(o, isSwitchOn), shape: 0, scale: o.scale, heading: o.heading };
}

// TObjDoor (0x0080, UpdatePlayerActionState_00656e28): one icon a frame at the
// door (icon4, shape 0, scale 1, range checked, heading = the door's yaw),
// red while `locked`, green after. The caller passes the lock the door's own
// icon uses: its state 0 for TObjDoor (0x0080), bit 0 of +0xd0 for the beam-family
// doors (0x0202, 0x0204; fieldobjects.ts doorMapLocked).
export function doorIcon(x: number, z: number, heading: number, locked: boolean): Icon {
  return { x, z, color: locked ? ICON_RED : ICON_GREEN, shape: 0, scale: 1, heading };
}

// TObjRaderHideCol (0x001f): MapObjectRadarCollisionBaseConstructor_00663370,
// update FUN_00663400: radius param1 (+0x90); while the local player is
// within the radius (3D, squared distance below radius^2) the minimap object
// is hidden (FUN_008055e4: flag 0x10 set, player pointer +0x184 cleared),
// and it is shown again when the player leaves (FUN_008055c0). The calls
// happen on the change only (flag +0x94 bit 0).
export interface RaderHide {
  x: number;
  y: number;
  z: number;
  radius: number;
  inside: boolean;
}

export function raderHideInside(h: RaderHide, p: { x: number; y?: number; z: number }): boolean {
  const dx = h.x - p.x;
  const dy = h.y - (p.y ?? 0);
  const dz = h.z - p.z;
  return dx * dx + dy * dy + dz * dz < h.radius * h.radius;
}
