// The game's 2D text, as drawn by FUN_007ab554 (PsoBB.exe, Ephinea 1.25.13).
//
// The client rasterizes glyphs into a texture cache at the 640x480 virtual
// resolution and draws each glyph as a quad, so on a large window the text is
// a magnified bitmap. Layout rules from FUN_007ab554 / FUN_007ac344:
//   - (x, y) is the top-left of a 14-pixel glyph cell (clip height 0x0097db84);
//   - a glyph advances by its own width (the byte at glyph+2), a space by a
//     fixed 7 pixels (0x0097db7c), a newline by 20 pixels (0x0097db78);
//   - the color is the vertex color (white, black shadow, alpha for fades).
//   - \tC<c> escapes pick the colour per glyph (classic/textcodes.ts) and take
//     no width.
// The glyph shapes come from the system font (font_tahoma.reg asks for Tahoma);
// face, size and weight are fitted to captures of the original client.


export const GAME_TEXT = {
  cell: 14,
  space: 7,
  lineHeight: 20,
  // Fitted to the reference capture: every string width matches Arial bold
  // 11 px with the 7 px space (NEW CHARACTER 102, Please select character. 131,
  // Enter 28, Cancel 36); psobb.io runs under Wine, where Tahoma falls back
  // to an Arial-metric face. Baseline 11 px below the cell top.
  font: 'bold 11px Arial, sans-serif',
  baseline: 11,
  // Alpha threshold for hard-edged glyphs (0 = keep antialiasing; the
  // antialiased glyphs match the capture better).
  threshold: 0,
};

import { stripTextCodes, textGlyphs } from './textcodes.ts';

const cache = new Map<string, OffscreenCanvas>();

// Development aid: call after changing GAME_TEXT.
export function clearGameTextCache(): void {
  cache.clear();
}
let measureCtx: OffscreenCanvasRenderingContext2D | null = null;

function advance(ch: string): number {
  if (ch === ' ') return GAME_TEXT.space;
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  measureCtx.font = GAME_TEXT.font;
  return Math.round(measureCtx.measureText(ch).width);
}

// Width in virtual pixels (FUN_007ac344): the sum of the advances.
export function gameTextWidth(text: string): number {
  let w = 0;
  for (const ch of text.includes('\t') ? stripTextCodes(text) : text) if (ch !== '\n') w += advance(ch);
  return w;
}

// The string rendered at virtual resolution (1 canvas pixel = 1 virtual pixel).
function bitmap(text: string, rgb: string): OffscreenCanvas {
  const key = `${rgb}|${text}`;
  let c = cache.get(key);
  if (c) return c;
  const glyphs = textGlyphs(text, rgb);
  const lines: Array<typeof glyphs> = [[]];
  for (const g of glyphs) {
    if (g.ch === '\n') lines.push([]);
    else lines[lines.length - 1]!.push(g);
  }
  const w = Math.max(1, ...lines.map((l) => gameTextWidth(l.map((g) => g.ch).join('')))) + 2;
  const h = (lines.length - 1) * GAME_TEXT.lineHeight + GAME_TEXT.cell;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.font = GAME_TEXT.font;
  g.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    let x = 0;
    for (const gl of line) {
      if (gl.ch !== ' ') {
        g.fillStyle = gl.color;
        g.fillText(gl.ch, x, i * GAME_TEXT.lineHeight + GAME_TEXT.baseline);
      }
      x += advance(gl.ch);
    }
  });
  // Hard-edged glyphs, like the GDI glyph cache.
  if (GAME_TEXT.threshold > 0) {
    const img = g.getImageData(0, 0, w, h);
    const t = GAME_TEXT.threshold * 255;
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= t ? 255 : 0;
    g.putImageData(img, 0, 0);
  }
  cache.set(key, c);
  return c;
}

// Draws text with its cell's top-left at (x, y). `rgb` is the vertex color,
// `alpha` its alpha (0..1).
export function drawGameText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, rgb = '#ffffff', alpha = 1): void {
  if (!text || alpha <= 0) return;
  const c = bitmap(text, rgb);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, x, y);
  ctx.restore();
}
