// The bottom hotbar of the field: ten hexagons along the bottom edge, keys 1..0
// (PsoBB.exe, Ephinea 1.25.13). Its data is the same action palette as the
// three-slot palette (classic/palette.ts), the hotbar_slots[0..9] of the current
// palette: key 1 = hotbar_slots[0] ... key 0 = hotbar_slots[9].
//
// Window: GUI position entry 0x21 = (0, 442) (table 0x00971f40, read with
// tools/exedata.py). The window is built by
// SinowberillChallengeObjectListWindow_Constructor_007104bc (dump 672339) from
// the element table 0x009f15d4; its y is 443 (0x43dd0000) normally and 342
// (0x43ab0000) while the main interactive panel is open
// (unknown_update_player_menu_hide_hotbar, dump 682072). It is drawn by
// SinowberillChallengeObjectListWindow_Render_00731a40 (dump 699098).
//
// Slots: PaletteMenu_HandleInput_0071050c (dump 672361) loops the palette
// indices 4..13 (1-based), reads group_1 / group_2 of each, and tints a slot
// disabled by Player_IsPaletteSlotEnabled_0068ce58 0xff404040, enabled white.
// Icons: PaletteMenu_UpdateTextures_0070ff56 and PaletteMenu_UpdateSlotIcon_0070fde5,
// the same routines as the three-slot palette (classic/palette.ts paletteIcon).
//
// ASSUMED (not traced): the hexagon texture and the per-slot UVs (the element
// table 0x009f15d4 is the window's descriptor, not the hexagon layout), so the
// hexagon is drawn as a dark outline; the hexagon pitch and offsets are sized
// from the reference screenshot (barrier.png, 512 wide: a row of ten about 40
// px apart at 640 width). The number labels use the palette's digit font.

import { drawDigits, drawTintedRect, EMPTY_ICON, paletteIcon, slotCount, TRAP_SLOT_FIRST, TRAP_SLOT_LAST, type PaletteIcon, type PaletteHudState, type PaletteSlot, type PaletteTextures } from './palette.ts';

export const HOTBAR_POS = { x: 0, y: 442 } as const; // GUI entry 0x21
export const HOTBAR_Y_NORMAL = 443; // 0x43dd0000
export const HOTBAR_Y_PANEL = 342; // 0x43ab0000, the main interactive panel is open
export const HOTBAR_SLOTS = 10;
export const HEX_PITCH = 43; // ASSUMED: slot centre spacing (640 px space)
export const HEX_W = 40; // ASSUMED
export const HEX_H = 36; // ASSUMED
const HEX_CENTER_X0 = 86; // ASSUMED: centre of slot 1, window-relative
const HEX_CENTER_Y = 19; // ASSUMED: centre, window-relative
const ICON_SCALE = 0.7; // ASSUMED: the 50 x 43 icon inside the hexagon
const DIGIT_W = 10; // palette.ts drawDigits
const DIGIT_H = 13;

// The hotbar's y for the main interactive panel state (dump 682072).
export function hotbarY(mainPanelOpen: boolean): number {
  return mainPanelOpen ? HOTBAR_Y_PANEL : HOTBAR_Y_NORMAL;
}

// The centre of hexagon i (0..9), window-relative.
export function hexCenter(i: number): { x: number; y: number } {
  return { x: HEX_CENTER_X0 + i * HEX_PITCH, y: HEX_CENTER_Y };
}

// The key label of hexagon i: 1..9 then 0.
export function hotbarLabel(i: number): number {
  return (i + 1) % 10;
}

// What a hotbar press does, from the slot's group_1 / group_2 (the dispatch of
// unknown_handle_palette_inputs, dump 555862). Pure: render/combat.ts acts on it.
export type HotbarAction =
  | { kind: 'none' }
  | { kind: 'attack'; type: number } // group 1 = 2, group 2 = attack type (0..2)
  | { kind: 'technique'; tech: number } // group 1 = 3
  | { kind: 'item'; group2: number } // group 1 = 4, group 2 = palette item index (classic/palette.ts PALETTE_ITEMS)
  | { kind: 'trap'; trap: number } // group 1 = 4, group 2 = 0x0d..0x10 (Battle Mode)
  | { kind: 'photon'; slot: number } // group 1 = 5
  | { kind: 'quest' }; // group 1 = 6 (activate_palette_button_quest_function, not ported)

// A disabled slot (flag bit 0) or an empty one (group 1 = 0) does nothing.
export function hotbarAction(slot: PaletteSlot | null | undefined): HotbarAction {
  if (!slot || slot.disabled) return { kind: 'none' };
  switch (slot.group1) {
    case 2:
      return slot.group2 <= 2 ? { kind: 'attack', type: slot.group2 } : { kind: 'none' };
    case 3:
      return { kind: 'technique', tech: slot.group2 };
    case 4:
      if (slot.group2 >= TRAP_SLOT_FIRST && slot.group2 <= TRAP_SLOT_LAST) return { kind: 'trap', trap: slot.group2 - TRAP_SLOT_FIRST };
      return { kind: 'item', group2: slot.group2 };
    case 5:
      return { kind: 'photon', slot: slot.group2 };
    case 6:
      return { kind: 'quest' };
    default:
      return { kind: 'none' };
  }
}

// The icon of a hotbar slot (EMPTY_ICON for an empty one).
export function hotbarIcon(slot: PaletteSlot | null | undefined): PaletteIcon {
  return !slot || slot.group1 === 0 ? EMPTY_ICON : paletteIcon(slot.group1, slot.group2);
}

// A slot is drawn lit when it can act: not disabled, and an item (group 1 = 4, not a trap)
// with stock in the bag. ASSUMED: the empty-bag grey (the exe's own test is not traced).
export function hotbarUsable(slot: PaletteSlot | null | undefined, count: number): boolean {
  if (!slot || slot.disabled || slot.group1 === 0) return false;
  if (slot.group1 === 4 && count <= 0 && !(slot.group2 >= TRAP_SLOT_FIRST && slot.group2 <= TRAP_SLOT_LAST)) return false;
  return true;
}

// The hotbar window: hexagons, icons, count labels. (x, y) is its top-left in the 640x480 space.
export function drawHotbar(
  ctx: CanvasRenderingContext2D,
  tex: PaletteTextures,
  slots: readonly (PaletteSlot | null)[],
  state: Pick<PaletteHudState, 'itemCount' | 'trapCount'>,
  x: number,
  y: number,
): void {
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const c = hexCenter(i);
    const cx = x + c.x;
    const cy = y + c.y;
    const slot = slots[i] ?? null;
    drawHexagon(ctx, cx, cy);
    const icon = hotbarIcon(slot);
    const n = slot ? slotCount(slot, state) : 0;
    const enabled = hotbarUsable(slot, n);
    const iw = ICON_SCALE * 50;
    const ih = ICON_SCALE * 43;
    drawTintedRect(ctx, tex.icons[icon.texture], icon.u, icon.v, 50, 43, cx - iw / 2, cy - ih / 2, iw, ih, enabled ? 1 : 0x40 / 0xff);
    // Count: the palette's stack count (slotCount), shown when > 0 like the three-slot palette.
    if (n > 0) drawDigits(ctx, tex.digits, n, cx + HEX_W / 2 - 2, cy + HEX_H / 2 - DIGIT_H);
    // Key label: 1..9, 0 (the palette's digit font), bottom-left of the hexagon.
    drawDigits(ctx, tex.digits, hotbarLabel(i), cx - HEX_W / 2 + DIGIT_W + 2, cy + HEX_H / 2 - DIGIT_H);
  }
}

// A flat-top hexagon outline with a dark fill (ASSUMED look, see the header).
function drawHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const rx = HEX_W / 2;
  const ry = HEX_H / 2;
  const q = rx / 2;
  ctx.beginPath();
  ctx.moveTo(cx - q, cy - ry);
  ctx.lineTo(cx + q, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx + q, cy + ry);
  ctx.lineTo(cx - q, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(8, 14, 22, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90, 220, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
