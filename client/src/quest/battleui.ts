// The battle HUD: the timer window, the player's lives and points, the team
// scores and the ranking lines, on a 2D canvas laid over the game canvas (the
// same 640x480 virtual space as quest/questui.ts).
//
// PsoBB.exe: the timer is the quest window time object (CreateQuestWindowTimeObject
// _00760f42, list window at GUI position 0x24 = (254, 37), text H'MM"SS from
// set_timer_text); the ranking lines go to the chat window list
// (UpdateChallengeResultDisplay_007182bc / DisplayFormattedTextToPlayer_00718300).
// Lives, points and team scores have no window in the exe that was found: they
// are drawn here as small windows (ASSUMED layout) so the rules are visible.

import { drawGameText, gameTextWidth, GAME_TEXT } from '../classic/gametext.ts';
import { anchorX } from '../classic/ingame.ts';
import { drawWindowFrame, textureBitmaps, VH, VW } from '../classic/stage.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { formatBattleTimer } from './battle.ts';

export const TIMER_POS = [254, 37] as const; // GUI 0x24
export const RULES_WINDOW = { x: 151, y: 166, w: 328, h: 166 }; // GUI 0x54, size 0x43a40000 x 0x43260000
// ASSUMED: the results box's origin (the exe writes the rows into the list windows; their GUI position is not traced).
export const RESULTS_POS = [200, 110] as const;
const BORDER = 20;

export interface BattleHudState {
  timer: number | null; // seconds left
  lives: number | null; // null: unlimited
  points: number | null;
  teamPoints: [number, number] | null;
  lines: string[]; // the ranking lines (announcements, timed)
  linesUntil: number; // performance.now() ms
  // The results window (battle.ts resultLines: the SCORE header, then one row per place). Shown from
  // the result until the battle exits. ASSUMED: its frame position (the exe's list windows are not placed here).
  results: string[] | null;
}

export class BattleHud {
  readonly state: BattleHudState = { timer: null, lives: null, points: null, teamPoints: null, lines: [], linesUntil: 0, results: null };
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frame: CanvasImageSource | null = null;
  private raf = 0;

  private host: HTMLCanvasElement;

  constructor(host: HTMLCanvasElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'battle-hud-overlay';
    Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none' });
    host.parentElement?.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  async load(files: ClientFiles): Promise<void> {
    if (this.frame) return;
    const hyouji = await textureBitmaps(await files.textures('f256_hyouji.prs'));
    this.frame = hyouji[1];
  }

  showLines(lines: string[], ms = 8000): void {
    this.state.lines = lines;
    this.state.linesUntil = performance.now() + ms;
  }

  // The results window (battle.ts resultLines). It stays until clear().
  showResults(lines: string[]): void {
    this.state.results = lines;
  }

  clear(): void {
    Object.assign(this.state, { timer: null, lives: null, points: null, teamPoints: null, lines: [], linesUntil: 0, results: null });
  }

  private box(ctx: CanvasRenderingContext2D, x0: number, y: number, lines: string[], extra: number): void {
    const w = Math.max(...lines.map(gameTextWidth)) + BORDER;
    const h = lines.length * GAME_TEXT.lineHeight - 6 + BORDER;
    const x = anchorX(x0, w, extra);
    drawWindowFrame(ctx, this.frame!, x, y, w, h);
    lines.forEach((l, i) => drawGameText(ctx, l, x + 10, y + 10 + i * GAME_TEXT.lineHeight, '#ffffff'));
  }

  private draw(): void {
    const host = this.host;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    Object.assign(this.canvas.style, { left: `${host.offsetLeft}px`, top: `${host.offsetTop}px`, width: `${w}px`, height: `${h}px` });
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.frame || !this.canvas.height) return;
    const s = this.canvas.height / VH;
    const extra = Math.max(0, this.canvas.width / s - VW);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const st = this.state;
    if (st.timer !== null) this.box(ctx, TIMER_POS[0], TIMER_POS[1], [formatBattleTimer(st.timer)], extra);
    const info: string[] = [];
    if (st.points !== null) info.push(`Score ${st.points}`);
    if (st.lives !== null) info.push(`Lives ${st.lives}`);
    if (st.teamPoints) info.push(`A ${st.teamPoints[0]}  B ${st.teamPoints[1]}`);
    if (info.length) this.box(ctx, 20, 37, info, extra);
    if (st.lines.length && performance.now() < st.linesUntil) this.box(ctx, 200, 110, st.lines, extra);
    if (st.results) this.box(ctx, RESULTS_POS[0], RESULTS_POS[1], st.results, extra);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
