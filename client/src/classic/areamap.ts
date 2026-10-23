// The Area Map window of the field main menu (Item Pack > Area Map, menu id
// 0xC, classic/fieldmenu.ts), PsoBB.exe (Ephinea 1.25.13):
//
// ChallengeMenuListWindow_Constructor_00743e00 (vtable ChallengeMenuListWindow
// _vtable) builds a list window at GUI position 0x5c = (13, 256) of the
// table at 0x00971f40 with the template 0x009f3c64 = {610, 188, ..., no
// elements, flags 3 (opens with SE 0x572)}
// (ChallengeMenuListWindow_Initialize_00744010), titled with the area's
// name (unitxt_get_area_name: group 10 through area_name_map, map 0xB past
// floor 2 reads as 0xE; a Challenge room shows "Area" + the stage number),
// and switches the keyboard to menu mode 4.
// Each frame (ChallengeMenuListWindow_Update_00744178):
//   - the window animation (unknown_closing_window_);
//   - ChallengeMenuListWindow_UpdateSelectionColor_007441a8: once the window
//     is open (flags +0x2c: bit 1 set, bit 2 clear) the full map starts
//     (+0x6c = 1, Minimap_GetPlayerPosition2D_008054fc: minimap_type 1
//     centred on the local player), the minimap object forgets its player
//     (UIElement_ClearFocusState_008055c0) and the HUD's flags get bit 1,
//     which closes the status window
//     (SinowberillChallengeObjectListWindow_HandleCancel_0071a838); when the
//     window starts closing the bit is cleared and minimap_type goes back to
//     0 (the destructor does the same);
//   - ChallengeMenuListWindow_HandleInput_00744230 while the full map is up:
//     the left mouse button (mask 4) pressed inside the window grabs the map
//     (Minimap_GetPlayer2Position_00805598); while held the pan is the grab
//     point minus 3.0 (0x0097327c) times the mouse's move; otherwise the menu
//     keys add to three speeds: Up +6 / Down -6 (0x00973278 / 0x00973274) to
//     the z speed, Left +6 / Right -6 to the x speed, Shift -6 / Ctrl +6 to
//     the height speed (g_KeyboardSharedState 8..11, 0x10, 0x11; unitxt group
//     11 0x145 "Shift / Zoom in", 0x146 "Ctrl / Zoom out"); then x -= x
//     speed, z -= z speed (MinimapZoomIn_00802b44, MinimapZoomOutZ
//     _00802b78, clamped by Minimap_ClampPlayerPosition_008058b4), height +=
//     height speed (MinimapMoveY_00802bac, 1200..3500), and every speed is
//     multiplied by 0.8 (0x00973270).
// Drawing: the frame; the four arrows of the HUD texlist texture 0
// (ChallengeMenuListWindow_RenderPhaseInfo_007445e4): left (16, 346)-(28,
// 360) UV (0.8711, 0.1641)-(0.9180, 0.2188), right (484, 346)-(496, 360) UV
// (0.9297, 0.1641)-(0.9766, 0.2188), up (249, 272)-(263, 284) UV (0.9375,
// 0)-(0.9922, 0.0469), down (249, 420)-(263, 432) UV (0.9375, 0.1094)-
// (0.9922, 0.1563); the two help texts (ChallengeMenuListWindow
// _RenderPhaseText_007444f0) at (487, 41) and (487, 97) from the window;
// both fade in over 6 frames (alpha = n * 255 / 6, 0x00973264).

import { menuKeyOf } from '../input/keyconfig.ts';
import type { MinimapState } from './minimap.ts';
import { WindowAnim, withWindowAnim } from './windowanim.ts';
import { drawWindowTitle } from './fieldwindows.ts';
import { drawGameText } from './gametext.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';

export const AREA_MAP_WINDOW = { x: 13, y: 256, w: 610, h: 188 } as const;
export const AREA_MAP_MENU_ID = 0xc;
export const PAN_STEP = 6; // 0x00973278 / 0x00973274
export const SPEED_DECAY = 0.8; // 0x00973270
export const DRAG_SCALE = 3; // 0x0097327c
export const HUD_FLAG_FULL_MAP = 1; // the HUD's flags (+0x1c) bit 1
export const HELP_TEXT = [
  { index: 0x145, x: 487, y: 41 },
  { index: 0x146, x: 487, y: 97 },
] as const;
export const FADE_FRAMES = 6;

// Arrow quads (x0, y0, x1, y1 in the 640x480 screen; texels of the 256x256
// texture 0 of f256_hyouji.prs).
export const ARROWS = [
  { x: 16, y: 346, w: 12, h: 14, u: 223, v: 42 },
  { x: 484, y: 346, w: 12, h: 14, u: 238, v: 42 },
  { x: 249, y: 272, w: 14, h: 12, u: 240, v: 0 },
  { x: 249, y: 420, w: 14, h: 12, u: 240, v: 28 },
] as const;

// Held menu inputs the window reads each frame.
export interface AreaMapInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  zoomIn: boolean; // Shift
  zoomOut: boolean; // Ctrl
  // The left mouse button and the pointer in the 640x480 screen.
  mouse: { down: boolean; x: number; y: number } | null;
}

export interface AreaMapEnv {
  minimap: () => MinimapState | null;
  input: () => AreaMapInput;
  setHudFlag: (bit: number, on: boolean) => void;
  title: () => string;
  text: (group: number, index: number) => string;
}

export interface AreaMapTextures {
  arrows: CanvasImageSource; // f256_hyouji.prs texture 0
}

export class AreaMapWindow {
  readonly anim = new WindowAnim(false, false);
  active = false; // +0x6c
  speed = { x: 0, z: 0, y: 0 }; // +0x60 / +0x64 / +0x68
  private drag: { mouseX: number; mouseY: number; x: number; z: number } | null = null; // +0x8c, +0x78.., +0x84..
  private fade = 0;
  private disposed = false;
  private env: AreaMapEnv;
  windowSpeed = 1;

  // `sound`: SE 0x572 / 0x573 of the window (template flags 3: not silent).
  constructor(env: AreaMapEnv, windowSpeed = 1, sound: (id: number) => void = () => {}) {
    this.env = env;
    this.windowSpeed = windowSpeed;
    this.anim.se = sound;
    this.anim.open(windowSpeed);
  }

  // ChallengeMenuListWindow_Update_00744178.
  tick(): void {
    this.anim.tick(this.windowSpeed);
    this.updateSelection();
    this.handleInput();
    if (this.active && this.fade < FADE_FRAMES) this.fade++;
  }

  // ChallengeMenuListWindow_UpdateSelectionColor_007441a8.
  private updateSelection(): void {
    if (this.disposed) return;
    const m = this.env.minimap();
    if (!this.active) {
      if (this.anim.isOpen && !this.anim.animating) {
        this.active = true;
        m?.openFullMap();
        this.env.setHudFlag(HUD_FLAG_FULL_MAP, true);
        this.speed = { x: 0, z: 0, y: 0 };
      }
    } else if (!this.anim.isOpen) {
      this.leave();
    }
  }

  private leave(): void {
    if (!this.active) return;
    this.active = false;
    this.drag = null;
    this.env.setHudFlag(HUD_FLAG_FULL_MAP, false);
    this.env.minimap()?.closeFullMap();
  }

  // ChallengeMenuListWindow_HandleInput_00744230.
  private handleInput(): void {
    if (!this.active || this.disposed) return;
    const m = this.env.minimap();
    const input = this.env.input();
    const mouse = input.mouse;
    if (this.drag) {
      if (!mouse?.down) {
        this.drag = null;
        return;
      }
      m?.setPan(this.drag.x - (mouse.x - this.drag.mouseX) * DRAG_SCALE, this.drag.z - (mouse.y - this.drag.mouseY) * DRAG_SCALE);
      return;
    }
    if (mouse?.down && this.contains(mouse.x, mouse.y)) {
      this.drag = { mouseX: mouse.x, mouseY: mouse.y, x: m?.full.x ?? 0, z: m?.full.z ?? 0 };
      this.speed = { x: 0, z: 0, y: 0 };
      return;
    }
    if (input.up) this.speed.z += PAN_STEP;
    if (input.down) this.speed.z -= PAN_STEP;
    if (input.left) this.speed.x += PAN_STEP;
    if (input.right) this.speed.x -= PAN_STEP;
    if (input.zoomIn) this.speed.y -= PAN_STEP;
    if (input.zoomOut) this.speed.y += PAN_STEP;
    m?.pan(this.speed.x, 0);
    m?.pan(0, this.speed.z);
    m?.moveHeight(this.speed.y);
    this.speed.x *= SPEED_DECAY;
    this.speed.z *= SPEED_DECAY;
    this.speed.y *= SPEED_DECAY;
  }

  // The map is being dragged with the mouse (+0x8c).
  get dragging(): boolean {
    return this.drag !== null;
  }

  // SinowberillChallengeObjectListWindow_CheckBoundsOverlap_007125c4.
  contains(x: number, y: number): boolean {
    const r = AREA_MAP_WINDOW;
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  // Backspace (or Escape) closes the window; every other key is the map's.
  key(e: KeyboardEvent): boolean {
    return !(menuKeyOf(e) === 'cancel');
  }

  // The window is destroyed (ChallengeMenuListWindow_Destructor_00743f60:
  // HUD flag bit 1 cleared, minimap_type 0); it never starts the full map
  // again.
  dispose(): void {
    this.leave();
    this.disposed = true;
  }

  // The frame, title, arrows and help; the map itself is drawn by the field
  // HUD (render/minimap.ts) over the frame.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: AreaMapTextures): void {
    const r = AREA_MAP_WINDOW;
    withWindowAnim(ctx, this.anim, r.x, r.y, r.w, r.h, () => {
      drawWindowFrame(ctx, skin.frame, r.x, r.y, r.w, r.h);
      if (this.active) {
        const alpha = this.fade < FADE_FRAMES ? Math.round((this.fade * 255) / FADE_FRAMES) / 255 : 1;
        ctx.save();
        ctx.globalAlpha *= alpha;
        for (const a of ARROWS) ctx.drawImage(tex.arrows, a.u, a.v, a.w, a.h, a.x, a.y, a.w, a.h);
        ctx.restore();
        for (const t of HELP_TEXT) drawGameText(ctx, this.env.text(11, t.index), r.x + t.x, r.y + t.y, '#ffffff', alpha);
      }
      drawWindowTitle(ctx, skin, r.x, r.y, this.env.title());
    });
  }
}
