// The action palette at the bottom right of the field screen, as PsoBB.exe
// (Ephinea 1.25.13) draws it.
//
// Data: the character's PlayerDispDataV4.config (E7 +0x34C +0x94, 0xE8 bytes)
// holds the client's action_palette_data (0x74 bytes; the second 0x74 bytes
// are the photon-blast palette): u32 is_palette_flipped, then two palettes of
// {middle_slot_override, palette_slots[3], hotbar_slots[10]}, each slot
// {u8 group_1, u8 group_2, u16 flags (bit 0 = disabled)} (headers in the
// named dump, get_current_palette, get_palette_slot_first_byte). newserv's
// default for a new hunter / ranger is left = (2,0) normal attack, middle =
// (2,1) heavy attack, right = (4,0) Monomate; a force has (3,0) Foie on the
// right (SaveFileFormats.cc config_hunter_ranger / config_force).
//
// Window (CreateSinowberillChallengeObjectListItem_0070f6bc): position-table
// entry 0x20 = (484, 368), 150 x 107 (0x009f1630); background =
// f256_hyouji.prs texture 2, texels (0,0)-(150,107) (render_main_palette_bg,
// 0.5859375 x 0.41796875 of 256): the blue, yellow, red and green hexagons.
// Elements (0x009f1480):
//   0 slot 1 icon at (50, 58.5)   (green, bottom)   1 its count at (75, 86.5)
//   2 slot 2 icon at (6, 32.5)    (blue, left)      3 its count at (31, 60.5)
//   4 slot 3 icon at (94, 32.5)   (red, right)      5 its count at (119, 60.5)
//   6 top icon at (50, 6.5)       (yellow)          7 "Ctrl" tab, texture 0
//     texels (46,0) 44 x 28 drawn at (91, 79), vertex colour 0xff666666, white
//     for 3 frames after the palette was switched (PaletteMenu_Update_0070f7a4).
// Slot n of the palette is drawn by element 2n (palette_slots[0] is the
// bottom hexagon). Icons are 50 x 43 texels (0x0096f598 / 0x0096f594) of
// texture 5, 6 or 7 picked by group_1 (PaletteMenu_UpdateTextures_0070ff56):
//   0 empty        texture 7 at (100, 0)
//   2 attack       texture 6, table 0x009f15e8 [group_2]
//   3 technique    texture 5, table 0x009f12e0 [technique]
//   4 item         texture 6 (index < 0xD) or 7, table 0x009f1380 [index]
//   5 ?            texture 5, table 0x009f1600
//   7 special      texture 7 (index 7, 0xB) or 6, table 0x009f1420
// Disabled slots (Player_IsPaletteSlotEnabled_0068ce58) are tinted 0xff404040.
// The top hexagon shows special 8 (texture 6 at (150,129)) while no photon
// blast is charged (PaletteMenu_Update_0070f7a4 tail; 9 while charging, 10
// when a boss is alive), white unless CreateItemObject_006dc358 says it is
// unavailable.
// Item counts (PaletteMenu_UpdateSlotIcon_0070fde5): the stack count of the
// tool in 0x0096f51c[index] (13 pairs: Monomate (0,0) .. Trap Vision (8,0)),
// right-aligned at icon (x + 25 + width / 2, y + 28) (0x0096f5ac,
// 0x0096f5a4, 0x0096f5a8) in the texturejapanese.xvm digits (10 px each,
// get_width_of_numeric_text with flag 4), shown when > 0.
// The palette hides while the player's input is locked by a menu
// (unknown_update_player_menu_hide_palette); it moves up to y = 268
// (0x43860000) while the main interactive panel is active, else y = 368.
// The switch: "Action Palette Change" (Ctrl in the default key config)
// toggles is_palette_flipped (HandlePlayerPaletteToggle_00694f0c).

export const PALETTE_POS = { x: 484, y: 368 } as const; // table entry 0x20
export const PALETTE_SIZE = { w: 150, h: 107 } as const; // 0x009f1630
export const ICON_W = 50; // 0x0096f598
export const ICON_H = 43; // 0x0096f594

export interface PaletteSlot {
  group1: number;
  group2: number;
  disabled: boolean;
}

export interface ActionPalette {
  middleOverride: PaletteSlot;
  slots: [PaletteSlot, PaletteSlot, PaletteSlot];
  hotbar: PaletteSlot[];
}

export interface PaletteData {
  flipped: boolean;
  palettes: [ActionPalette, ActionPalette];
}

export const CONFIG_OFFSET = 0x34c + 0x94; // E7: PlayerDispDataV4.config
const PALETTE_SIZE_BYTES = 0x38;

function readSlot(b: Uint8Array, o: number): PaletteSlot {
  return { group1: b[o], group2: b[o + 1], disabled: (b[o + 2] & 1) !== 0 };
}

// action_palette_data out of the 0xE8-byte config.
export function parsePalette(config: Uint8Array): PaletteData {
  const dv = new DataView(config.buffer, config.byteOffset, config.byteLength);
  const pal = (base: number): ActionPalette => ({
    middleOverride: readSlot(config, base),
    slots: [readSlot(config, base + 4), readSlot(config, base + 8), readSlot(config, base + 12)],
    hotbar: Array.from({ length: 10 }, (_, i) => readSlot(config, base + 16 + i * 4)),
  });
  return { flipped: dv.getUint32(0, true) !== 0, palettes: [pal(4), pal(4 + PALETTE_SIZE_BYTES)] };
}

// The palette from a raw E7 character file (null when it is too short).
export function paletteFromCharacter(raw: Uint8Array | null): PaletteData | null {
  if (!raw || raw.length < CONFIG_OFFSET + 0xe8) return null;
  return parsePalette(raw.subarray(CONFIG_OFFSET, CONFIG_OFFSET + 0xe8));
}

export function currentPalette(p: PaletteData): ActionPalette {
  return p.palettes[p.flipped ? 1 : 0];
}

// Icon texture and texel origin of a palette entry.
export interface PaletteIcon {
  texture: 5 | 6 | 7;
  u: number;
  v: number;
}

const ATTACK_UV: ReadonlyArray<readonly [number, number]> = [[200, 43], [200, 0], [200, 86]]; // 0x009f15e8
// 0x009f12e0, by technique number (Foie .. Megid).
const TECH_UV: ReadonlyArray<readonly [number, number]> = [
  [50, 0], [50, 43], [50, 86], [100, 0], [100, 43], [100, 86], [0, 0], [0, 43], [0, 86], [200, 0],
  [0, 129], [50, 172], [0, 172], [50, 129], [200, 86], [150, 0], [150, 86], [150, 43], [200, 43],
];
// 0x009f1380, by palette item index (0x0096f51c order below).
const ITEM_UV: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, 43], [0, 86], [50, 0], [50, 43], [50, 86], [100, 0], [50, 129], [100, 43], [0, 172],
  [0, 129], [150, 43], [50, 172], [0, 129], [0, 0], [0, 86], [0, 43], [0, 0],
];
const TYPE5_UV: ReadonlyArray<readonly [number, number]> = [[200, 172], [150, 129], [150, 172]]; // 0x009f1600
// 0x009f1420, special actions.
const SPECIAL_UV: ReadonlyArray<readonly [number, number]> = [
  [100, 0], [100, 129], [100, 172], [200, 129], [200, 172], [100, 86], [100, 86], [50, 0], [150, 129], [150, 86], [150, 172], [0, 172],
];
// 0x0096f51c: data1[1], data1[2] of the tool behind palette item index i.
export const PALETTE_ITEMS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [6, 0], [6, 1], [3, 0], [4, 0], [5, 0], [7, 0], [8, 0],
];

export const EMPTY_ICON: PaletteIcon = { texture: 7, u: 100, v: 0 }; // 0x0096f5a0 / 0x0096f59c

export function paletteIcon(group1: number, group2: number): PaletteIcon {
  const pick = (table: ReadonlyArray<readonly [number, number]>, texture: 5 | 6 | 7): PaletteIcon => {
    const uv = table[group2];
    return uv ? { texture, u: uv[0], v: uv[1] } : EMPTY_ICON;
  };
  switch (group1) {
    case 2:
      return pick(ATTACK_UV, 6);
    case 3:
      return pick(TECH_UV, 5);
    case 4:
      return pick(ITEM_UV, group2 < 0xd ? 6 : 7);
    case 5:
      return pick(TYPE5_UV, 5);
    case 7:
      return pick(SPECIAL_UV, group2 === 7 || group2 === 0xb ? 7 : 6);
    default:
      return EMPTY_ICON;
  }
}

// Element positions inside the window (0x009f1480).
export const SLOT_POS: ReadonlyArray<readonly [number, number]> = [[50, 58.5], [6, 32.5], [94, 32.5]];
export const TOP_POS = [50, 6.5] as const;
export const CTRL_TAB = { x: 91, y: 79, w: 44, h: 28, u: 46, v: 0 } as const;
const COUNT_DX = 25; // 0x0096f5ac
const COUNT_DY = 28; // 0x0096f5a4
const DIGIT_W = 10; // 0x00970dcc
const DIGIT_H = 13; // 0x0097a7b0
const FLASH_FRAMES = 3; // PaletteMenu_Update_0070f7a4: +0x70 = 3

export interface PaletteTextures {
  bg: CanvasImageSource; // f256_hyouji.prs texture 2
  tabs: CanvasImageSource; // texture 0
  icons: Record<5 | 6 | 7, CanvasImageSource>;
  digits: CanvasImageSource; // texturejapanese.xvm texture 0
}

export interface PaletteHudState {
  data: PaletteData;
  // Stack count of a palette item index (0x0096f51c), 0 when none.
  itemCount: (index: number) => number;
  // Slot n (1..3) usable (Player_IsPaletteSlotEnabled_0068ce58).
  slotEnabled?: (slot: number) => boolean;
}

// Digits of the texturejapanese.xvm font (u = (c & 15) * 16, v = c & 0xF0,
// SetTextPositionOffset_007893a4), right-aligned at x.
export function drawDigits(ctx: CanvasRenderingContext2D, font: CanvasImageSource, n: number, right: number, y: number): void {
  let x = right;
  let v = Math.max(0, Math.trunc(n));
  do {
    const c = 0x30 + (v % 10);
    x -= DIGIT_W;
    ctx.drawImage(font, (c & 15) * 16, c & 0xf0, DIGIT_W, DIGIT_H, x, y, DIGIT_W, DIGIT_H);
    v = Math.trunc(v / 10);
  } while (v > 0);
}

export class PaletteHud {
  // Frames left of the Ctrl tab's white flash.
  private flash = 0;
  visible = true;

  // Action Palette Change: flips between the two palettes.
  flip(data: PaletteData): void {
    data.flipped = !data.flipped;
    this.flash = FLASH_FRAMES;
  }

  tick(): void {
    if (this.flash > 0) this.flash--;
  }

  // Draws the window with its top-left at (x, y) in the 640x480 space.
  draw(ctx: CanvasRenderingContext2D, tex: PaletteTextures, state: PaletteHudState, x: number, y: number): void {
    if (!this.visible) return;
    ctx.drawImage(tex.bg, 0, 0, PALETTE_SIZE.w, PALETTE_SIZE.h, x, y, PALETTE_SIZE.w, PALETTE_SIZE.h);
    const pal = currentPalette(state.data);
    pal.slots.forEach((slot, i) => {
      const [ex, ey] = SLOT_POS[i];
      const icon = slot.group1 === 0 ? EMPTY_ICON : paletteIcon(slot.group1, slot.group2);
      const enabled = !slot.disabled && (state.slotEnabled?.(i + 1) ?? true);
      drawIcon(ctx, tex.icons[icon.texture], icon, x + ex, y + ey, enabled ? 1 : 0x40 / 0xff);
      if (slot.group1 === 4 && slot.group2 < PALETTE_ITEMS.length) {
        const n = state.itemCount(slot.group2);
        if (n > 0) drawDigits(ctx, tex.digits, n, x + ex + COUNT_DX + (String(n).length * DIGIT_W) / 2, y + ey + COUNT_DY);
      }
    });
    const top = paletteIcon(7, 8);
    drawIcon(ctx, tex.icons[top.texture], top, x + TOP_POS[0], y + TOP_POS[1], 1);
    // Vertex colour 0xff666666 (dimmed) or white while flashing.
    drawTinted(ctx, tex.tabs, CTRL_TAB.u, CTRL_TAB.v, CTRL_TAB.w, CTRL_TAB.h, x + CTRL_TAB.x, y + CTRL_TAB.y, this.flash > 0 ? 1 : 0x66 / 0xff);
  }
}

function drawIcon(ctx: CanvasRenderingContext2D, img: CanvasImageSource, icon: PaletteIcon, x: number, y: number, bright: number): void {
  drawTinted(ctx, img, icon.u, icon.v, ICON_W, ICON_H, x, y, bright);
}

// A texel rect multiplied by a grey vertex colour (bright = r = g = b).
function drawTinted(ctx: CanvasRenderingContext2D, img: CanvasImageSource, u: number, v: number, w: number, h: number, x: number, y: number, bright: number): void {
  if (bright >= 1) {
    ctx.drawImage(img, u, v, w, h, x, y, w, h);
    return;
  }
  const c = tintCanvas(w, h);
  const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(img, u, v, w, h, 0, 0, w, h);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(0,0,0,${1 - bright})`;
  g.fillRect(0, 0, w, h);
  ctx.drawImage(c, 0, 0, w, h, x, y, w, h);
}

let tint: OffscreenCanvas | null = null;
function tintCanvas(w: number, h: number): OffscreenCanvas {
  if (!tint || tint.width < w || tint.height < h) tint = new OffscreenCanvas(Math.max(w, tint?.width ?? 0), Math.max(h, tint?.height ?? 0));
  return tint;
}
