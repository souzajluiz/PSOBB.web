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
  expText,
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
import { textureBitmap, VH, VW } from '../classic/stage.ts';
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
  private projected = new THREE.Vector3();
  log: (msg: string) => void = () => {};

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
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * VH };
  }

  // "EXP+n" over a killed enemy (the killer's client only).
  expPopup(amount: number, at: WorldAnchor): void {
    this.floats.add(expText(amount, () => this.project(at())));
  }

  // "Level Up" over a player's head.
  levelUpPopup(at: WorldAnchor, down = false): void {
    this.floats.add(levelUpText(down, () => this.project(at())));
  }

  // Lines for the message window, one every 0x16 frames.
  message(lines: string[]): void {
    this.messages.enqueue(lines);
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
    if (!tex) return;
    const s = h / VH;
    this.extra = Math.max(0, w / s - VW);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = true;
    this.status.draw(ctx, tex);
    this.party.draw(ctx, tex);
    this.floats.draw(ctx, tex.font);
    this.messages.draw(ctx, anchorX(MESSAGE_WINDOW.x, MESSAGE_WINDOW.w, this.extra));
  }

  dispose(): void {
    this.disposed = true;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}
