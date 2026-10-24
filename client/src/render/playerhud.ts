// Draws classic/hud.ts over the game view: a 2D canvas laid over the WebGL
// canvas, in the client's 640x480 virtual space scaled by the window height
// (left windows stay left, right windows follow the right edge, as
// classic/ingame.ts does for the lobby HUD). Ticks the HUD at the game's 30
// frames per second and projects world anchors (enemies, player heads) to the
// screen for the floating texts.

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { anchorX } from '../classic/ingame.ts';
import {
  drawGlyphText,
  glyphTextWidth,
  GLYPH_HEIGHT,
  expText,
  hitText,
  FloatingTexts,
  levelUpText,
  MESSAGE_WINDOW,
  MessageLines,
  PartyWindows,
  STATUS_LAYER,
  type PartyValues,
  StatusWindow,
  type HudTextures,
  type StatusValues,
} from '../classic/hud.ts';
import { bandsOf, overlayFrame, textureBitmap, VW } from '../classic/stage.ts';
import { TARGET_CARD_ANCHOR } from '../combat/targetcard.ts';
import type { TargetCardText } from '../combat/targetcard.ts';
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';
import type { MapViewer } from './mapviewer.ts';

export type WorldAnchor = () => THREE.Vector3 | null;

export class PlayerHud {
  private viewer: MapViewer;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private textures: HudTextures | null = null;
  readonly status = new StatusWindow();
  readonly floats = new FloatingTexts();
  readonly messages = new MessageLines();
  readonly party = new PartyWindows();
  private ticks = 0;
  private disposed = false;
  private extra = 0; // virtual units beyond 640 on a wide window
  private vh = 480; // virtual height of the frame (tall fill: the box, stage.ts overlayFrame)
  private projected = new THREE.Vector3();
  log: (msg: string) => void = () => {};
  // The screen colour overlay (g_UIElementArray_00a98480[1], ARGB; the death
  // fade sets 0x??ff0000 with the alpha growing to 0x80). 0 = none. ASSUMED:
  // drawn over the scene and under the windows.
  tint = 0;
  // The HUD's flags (+0x1c; bit 1 = the full map is up, render/fieldhud.ts):
  // the status window closes while bits 1 / 0x10 are set.
  hudFlags: () => number = () => 0;
  // The target card of the lock-on target (combat/targetcard.ts); null = none.
  targetCard: TargetCardText | null = null;

  constructor(viewer: MapViewer, files: ClientFiles) {
    this.viewer = viewer;
    void this.load(files);
  }

  // f256_hyouji.prs (the HUD texlist, InitializeDisplayTexture_00712d14) and
  // the ASCII atlas of textureenglish.xvm (texturejapanese.xvm on a Japanese
  // client).
  private async load(files: ClientFiles): Promise<void> {
    try {
      const hyouji = await files.textures('f256_hyouji.prs');
      const text = await files.textures(['textureenglish.xvm', 'texturejapanese.xvm']);
      const [panel, icons, font, status] = await Promise.all([
        textureBitmap(hyouji[13]),
        textureBitmap(hyouji[0]),
        textureBitmap(text[0]),
        hyouji[1] ? textureBitmap(hyouji[1]) : Promise.resolve(undefined),
      ]);
      if (this.disposed) return;
      this.textures = { panel, icons, font, status };
    } catch (err) {
      this.log(`hud: textures unavailable (${(err as Error).message})`);
    }
  }

  get ready(): boolean {
    return this.textures !== null;
  }

  private ensureCanvas(): void {
    if (this.canvas) return;
    const gl = this.viewer.renderer.domElement;
    const parent = gl.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const c = document.createElement('canvas');
    c.className = 'game-hud';
    Object.assign(c.style, { position: 'absolute', pointerEvents: 'none', zIndex: String(STATUS_LAYER) });
    parent.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
  }

  // World point -> virtual screen (null when behind the camera).
  project(p: THREE.Vector3 | null): { x: number; y: number } | null {
    if (!p) return null;
    const v = this.projected.copy(p).project(this.viewer.camera);
    if (v.z > 1 || v.z < -1) return null;
    const width = VW + this.extra;
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * this.vh };
  }

  // "EXP+n" over a killed enemy (the killer's client only).
  expPopup(amount: number, at: WorldAnchor): void {
    this.floats.add(expText(amount, () => this.project(at())));
  }

  // The number or "MISS" over a hit enemy (classic/hud.ts hitText).
  hitPopup(text: string, rgb: number, at: WorldAnchor): void {
    this.floats.add(hitText(text, rgb, () => this.project(at())));
  }

  // "Level Up" over a player's head.
  levelUpPopup(at: WorldAnchor, down = false): void {
    this.floats.add(levelUpText(down, () => this.project(at())));
  }

  // Lines for the message window, one every 0x16 frames.
  message(lines: string[]): void {
    this.messages.enqueue(lines);
  }

  // One line added at once (handle_b0_packet -> DisplayChallengeResultToPlayer).
  notice(text: string): void {
    this.messages.add(text);
  }

  // The window speed option (classic/windowanim.ts WindowAnim.speedOf).
  set windowSpeed(speed: number) {
    this.status.speed = speed;
    this.party.speed = speed;
  }

  // One rendered frame: advance the 30 Hz HUD frames, then draw. `party`
  // gives the party members' windows their values by client slot.
  frame(dt: number, values: StatusValues, selfSlot = -1, party: (slot: number) => PartyValues | null = () => null): void {
    if (this.disposed) return;
    if (selfSlot >= 0) this.party.setSelf(selfSlot);
    this.ticks += dt * GAME_TICKS_PER_SECOND;
    let n = Math.floor(this.ticks);
    this.ticks -= n;
    n = Math.min(n, 5);
    for (let i = 0; i < n; i++) {
      this.status.hudFlags = this.hudFlags();
      this.status.tick(values);
      this.party.tick(party);
      this.floats.tick();
      this.messages.tick();
    }
    this.draw();
  }

  private draw(): void {
    this.ensureCanvas();
    const c = this.canvas;
    const ctx = this.ctx;
    const tex = this.textures;
    if (!c || !ctx) return;
    const gl = this.viewer.renderer.domElement;
    const cssW = gl.clientWidth;
    const cssH = gl.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    Object.assign(c.style, { left: `${gl.offsetLeft}px`, top: `${gl.offsetTop}px`, width: `${cssW}px`, height: `${cssH}px` });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const alpha = this.tint >>> 24;
    if (alpha > 0) {
      ctx.fillStyle = `rgba(${(this.tint >>> 16) & 0xff},${(this.tint >>> 8) & 0xff},${this.tint & 0xff},${alpha / 255})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (!tex) return;
    // Tall fill (phone portrait): 640 x vh, the top-left HUD stays at the top,
    // the message window is centred vertically (stage.ts bandsOf).
    const f = overlayFrame(w, h);
    this.extra = f.extra;
    this.vh = f.vh;
    ctx.setTransform(f.s, 0, 0, f.s, 0, 0);
    ctx.imageSmoothingEnabled = true;
    this.status.draw(ctx, tex);
    this.party.draw(ctx, tex);
    this.floats.draw(ctx, tex.font);
    this.drawTargetCard(ctx, tex.font);
    ctx.save();
    ctx.translate(0, bandsOf(f.vh, f.fill).mid);
    this.messages.draw(ctx, anchorX(MESSAGE_WINDOW.x, MESSAGE_WINDOW.w, this.extra));
    ctx.restore();
  }

  // The bottom-left target card (ui_target_window_attribute): the monster's name and
  // "Attribute:" with the attribute in its colour. ASSUMED box: the exe's window
  // size is not traced, so the box is placed from the reference screenshot (top
  // 369, 97 high, the anchor's x), its padding is ASSUMED too.
  private drawTargetCard(ctx: CanvasRenderingContext2D, font: CanvasImageSource): void {
    const t = this.targetCard;
    if (!t) return;
    const pad = 10;
    const x = TARGET_CARD_ANCHOR.x;
    const y = 369;
    const valueX = glyphTextWidth(t.label) + 4; // ASSUMED gap between the label and the value
    const width = Math.max(120, Math.max(glyphTextWidth(t.name), valueX + glyphTextWidth(t.value)) + pad * 2);
    ctx.fillStyle = 'rgba(6, 18, 30, 0.78)';
    ctx.fillRect(x, y, width, 97);
    ctx.strokeStyle = 'rgba(90, 220, 240, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 96);
    drawGlyphText(ctx, font, t.name, x + pad, y + pad, 0xffffffff);
    const row = y + pad + GLYPH_HEIGHT + 10;
    drawGlyphText(ctx, font, t.label, x + pad, row, 0xffffffff);
    drawGlyphText(ctx, font, t.value, x + pad + valueX, row, t.argb);
  }

  dispose(): void {
    this.disposed = true;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}
