// Where the touch pad (ui/webcontrols.ts) puts its controls over the game
// canvas so they stay clear of the game's own HUD.
//
// The field HUD lays out in the 640x480 virtual screen scaled by the canvas
// height (render/fieldhud.ts: s = height / 480, `extra` = the virtual width
// beyond 640, windows on the right half shifted by it, classic/ingame.ts
// anchorX). The pad works out the same rectangles in CSS pixels:
//   - the action palette (classic/palette.ts, bottom right): its three slot
//     icons and the Ctrl tab ARE the attack / palette-change buttons;
//   - the status and party windows (top left), the radar (top right,
//     classic/minimap.ts) and the message window (right) are left free;
//   - the stick takes the lower left, the arrow diamond with OK / BACK sits
//     left of the palette, and the small buttons (MENU, CHAT, fullscreen,
//     mute) line the top edge between the status window and the radar.

import { MESSAGE_WINDOW, PARTY_WINDOW, STATUS_WINDOW } from '../classic/hud.ts';
import { MINIMAP_RECT } from '../classic/minimap.ts';
import { CTRL_TAB, ICON_H, ICON_W, PALETTE_POS, PALETTE_SIZE, SLOT_POS } from '../classic/palette.ts';
import { KEYS, PALETTE_KEYS } from './keyconfig.ts';
import type { GameKey } from './virtualpad.ts';

const VW = 640;
const VH = 480;

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PadLayout {
  scale: number; // CSS px per virtual pixel
  extra: number; // virtual width beyond 640
  button: number; // pad button size, CSS px
  gap: number;
  // Tap targets over the palette window: slot icons and the Ctrl tab.
  palette: Array<{ key: GameKey; rect: PxRect }>;
  stickZone: PxRect;
  stickSize: number;
  stickHome: { x: number; y: number }; // centre, relative to the canvas
  // Arrow diamond (3x3 buttons) and the OK / BACK column right of it.
  dpad: PxRect;
  actions: PxRect;
  // true when the stick and buttons sit under the stage (portrait).
  underStage: boolean;
  // Strip along the top edge for the small buttons, right-aligned.
  topStrip: PxRect;
  // HUD rectangles the pad keeps clear of (for tests / debugging).
  hud: { status: PxRect; party: PxRect; radar: PxRect; message: PxRect; palette: PxRect };
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// A pad needs this much room (in button sizes) under the stage to move there.
const BELOW_MIN = 4;

// `below`: free CSS px under the canvas (portrait phone: the stage is a 4:3
// box fitted to the width and the screen continues under it). With room for
// it the stick, the arrow diamond and OK / BACK move into that space, stick at
// the left and the buttons at the right, so the HUD is not covered; the
// palette taps and the top strip stay over the stage. Landscape: unchanged.
export function padLayout(width: number, height: number, insets: Insets = NO_INSETS, below = 0): PadLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const s = h / VH;
  const extra = Math.max(0, w / s - VW);
  // Virtual rect -> px; right-half windows move by `extra` (anchorX).
  const px = (r: { x: number; y: number; w: number; h: number }): PxRect => {
    const x = r.x + r.w / 2 >= VW / 2 ? r.x + extra : r.x;
    return { x: x * s, y: r.y * s, w: r.w * s, h: r.h * s };
  };
  const status = px(STATUS_WINDOW);
  const party = px(PARTY_WINDOW);
  const radar = px(MINIMAP_RECT[0]);
  const message = px(MESSAGE_WINDOW);
  const palette = px({ x: PALETTE_POS.x, y: PALETTE_POS.y, w: PALETTE_SIZE.w, h: PALETTE_SIZE.h });

  const button = clamp(h * 0.1, 34, 60);
  const gap = clamp(h * 0.015, 4, 10);

  const slots = PALETTE_KEYS.map(([key, index]) => {
    const [ex, ey] = SLOT_POS[index];
    return { key: key as GameKey, rect: { x: palette.x + ex * s, y: palette.y + ey * s, w: ICON_W * s, h: ICON_H * s } };
  });
  slots.push({ key: KEYS.paletteChange, rect: { x: palette.x + CTRL_TAB.x * s, y: palette.y + CTRL_TAB.y * s, w: CTRL_TAB.w * s, h: CTRL_TAB.h * s } });

  // Bottom row, right to left: palette | OK/BACK | diamond.
  const under = below >= BELOW_MIN * button;
  const bottom = (under ? h + below : h) - Math.max(gap, insets.bottom);
  const actionW = button * 1.25;
  const dpadSize = 3 * button;
  const actions: PxRect = under
    ? { x: w - Math.max(gap, insets.right) - actionW, y: bottom - 2 * actionW - gap, w: actionW, h: 2 * actionW + gap }
    : { x: palette.x - gap - actionW, y: bottom - 2 * actionW - gap, w: actionW, h: 2 * actionW + gap };
  const dpad: PxRect = { x: actions.x - gap - dpadSize, y: bottom - dpadSize, w: dpadSize, h: dpadSize };

  // Stick: lower left, below the party window, left of the diamond (portrait:
  // the whole left part of the space under the stage).
  const zoneLeft = Math.max(0, insets.left);
  const zoneTop = under ? h + gap : party.y + party.h + gap;
  const zoneBottom = under ? h + below : h;
  const stickZone: PxRect = { x: zoneLeft, y: zoneTop, w: Math.max(0, Math.min(w * 0.45, dpad.x - gap) - zoneLeft), h: Math.max(0, zoneBottom - zoneTop) };
  const stickSize = button * 2.2;
  const stickHome = {
    x: zoneLeft + Math.max(gap, insets.left) + stickSize / 2,
    y: bottom - stickSize / 2,
  };

  // Top strip: between the status window and the radar, above both.
  const stripLeft = status.x + status.w + gap;
  const stripRight = radar.x - gap;
  const top = Math.max(gap / 2, insets.top);
  const topStrip: PxRect = { x: stripLeft, y: top, w: Math.max(0, stripRight - stripLeft), h: Math.min(button * 0.75, 36) };

  return {
    scale: s,
    extra,
    button,
    gap,
    palette: slots,
    stickZone,
    stickSize,
    stickHome,
    dpad,
    actions,
    topStrip,
    underStage: under,
    hud: { status, party, radar, message, palette },
  };
}

export function intersects(a: PxRect, b: PxRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Tall fill (a phone in portrait, Screen.phoneFill; stage.ts overlayFrame): the
// 2D frame is the 3:4 box itself, 640 wide and vh high, so the palette sits in
// its bottom band (PALETTE_POS shifted by the bottom band). The pad keeps out of
// the HUD: the stick, the arrow diamond and OK / BACK go in the bar under the box
// (`bar` CSS px), right-aligned for the buttons; the small buttons (PAL, MENU,
// CHAT, VIB, fullscreen, mute) go in the bar above the box, right-aligned. The
// palette taps are the palette's slots, as on the field. Coordinates are CSS px
// relative to the box (negative y: the bar above it).
export function padLayoutFill(width: number, height: number, insets: Insets = NO_INSETS, bar = 0): PadLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const s = w / VW;
  const vh = h / s;
  const dyBottom = vh - VH;
  const px = (r: { x: number; y: number; w: number; h: number }): PxRect => ({ x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s });
  const palette = px({ x: PALETTE_POS.x, y: PALETTE_POS.y + dyBottom, w: PALETTE_SIZE.w, h: PALETTE_SIZE.h });
  const status = px(STATUS_WINDOW);
  const party = px(PARTY_WINDOW);
  const radar = px(MINIMAP_RECT[0]);
  const message = px({ ...MESSAGE_WINDOW, y: MESSAGE_WINDOW.y + dyBottom / 2 });

  const gap = 6;
  // The bar under the box holds the stick (2.2 buttons high), the diamond (3
  // buttons) and the OK / BACK column (2.5 buttons + gap): the button size that
  // fits all three in the bar's height.
  const button = clamp(Math.min((bar - 2 * gap) / 3, (bar - 3 * gap) / 2.5), 20, 60);
  const slots = PALETTE_KEYS.map(([key, index]) => {
    const [ex, ey] = SLOT_POS[index];
    return { key: key as GameKey, rect: { x: palette.x + ex * s, y: palette.y + ey * s, w: ICON_W * s, h: ICON_H * s } };
  });
  slots.push({ key: KEYS.paletteChange, rect: { x: palette.x + CTRL_TAB.x * s, y: palette.y + CTRL_TAB.y * s, w: CTRL_TAB.w * s, h: CTRL_TAB.h * s } });

  const bottom = h + bar - gap;
  const actionW = button * 1.25;
  const dpadSize = 3 * button;
  const actions: PxRect = { x: w - Math.max(gap, insets.right) - actionW, y: bottom - 2 * actionW - gap, w: actionW, h: 2 * actionW + gap };
  const dpad: PxRect = { x: actions.x - gap - dpadSize, y: bottom - dpadSize, w: dpadSize, h: dpadSize };
  const stickSize = button * 2.2;
  const zoneLeft = Math.max(0, insets.left);
  const stickZone: PxRect = { x: zoneLeft, y: h, w: Math.max(0, dpad.x - gap - zoneLeft), h: bar };
  const stickHome = { x: zoneLeft + Math.max(gap, insets.left) + stickSize / 2, y: bottom - stickSize / 2 };

  // Small buttons: the bar above the box, right-aligned (the strip's width is
  // two buttons of 0.75 and the gap, as webcontrols.ts sets it).
  const stripH = Math.min(button * 0.75, 36);
  const stripW = 2 * button * 0.75 + gap;
  const topStrip: PxRect = { x: Math.max(0, w - Math.max(gap, insets.right) - stripW), y: -(stripH + gap), w: stripW, h: stripH };

  return {
    scale: s,
    extra: 0,
    button,
    gap,
    palette: slots,
    stickZone,
    stickSize,
    stickHome,
    dpad,
    actions,
    topStrip,
    underStage: true,
    hud: { status, party, radar, message, palette },
  };
}
