// The game's mouse pointer over the game canvases. PsoBB.exe shows its own
// pointer (LoadCursorA(hInstance, 102), the RT_GROUP_CURSOR 102 of its .rsrc)
// over the client area in every screen (WM_SETCURSOR, exe 0x0082c649 and the
// WindowProc branch above it); see data/pecursor.ts for the evidence. The
// image is read from the user's PsoBB.exe at run time and set as the CSS
// cursor of the canvases. Without the exe the browser's default pointer stays.
import { loadPeCursor, type PeCursor } from '../data/pecursor.ts';
import type { DataSource } from '../data/source.ts';

// LoadCursorA(hInstance, 0x66) in PsoBB.exe (exe 0x0082cdab; g_hCursorDefault).
export const GAME_POINTER_GROUP = 102;

function cursorUrl(cur: PeCursor): string | null {
  const c = document.createElement('canvas');
  c.width = cur.width;
  c.height = cur.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(cur.rgba), cur.width, cur.height), 0, 0);
  return c.toDataURL('image/png');
}

// Sets the game pointer on the canvases; resolves true when it did. Any
// failure (no exe, an unknown layout, no 2D context) keeps the default pointer.
export async function applyGamePointer(source: DataSource, canvases: HTMLCanvasElement[]): Promise<boolean> {
  try {
    const exe = source.readExe ? await source.readExe() : null;
    if (!exe) return false;
    const cur = loadPeCursor(exe, GAME_POINTER_GROUP);
    if (!cur) return false;
    const url = cursorUrl(cur);
    if (!url) return false;
    for (const c of canvases) c.style.cursor = `url("${url}") ${cur.hotX} ${cur.hotY}, default`;
    return true;
  } catch (e) {
    console.log(`[classic] game pointer not set: ${(e as Error).message}`);
    return false;
  }
}
