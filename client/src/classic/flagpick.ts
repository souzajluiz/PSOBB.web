// Team Flag Records' picture source. The exe reads "\teamflag\flag.bmp" from the game folder
// (LoadTeamFlagFile 0x0082aacc: 2 = no such file, 3 = the mode argument is not one it reads, 4 = the
// D3DX load failed, 1 = loaded into the 32 x 32 texture). A browser has no game folder, so the file
// comes from the system's file chooser: no file chosen = 2, a file the browser cannot decode = 3, a
// failed read = 4. The picture is scaled to 32 x 32 (ASSUMED: D3DX's surface copy scales to the
// destination size; the exe's own scaling filter was not read) and converted to the ARGB1555 words
// the server stores (net/team.ts flagFromRgba).

import { FLAG_SIZE, flagFromRgba } from '../net/team.ts';
import type { FlagPick } from './teammenu.ts';

// Decodes one image file to the flag words.
export async function flagFromFile(file: Blob): Promise<FlagPick> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { status: 3 };
  }
  try {
    const canvas = new OffscreenCanvas(FLAG_SIZE, FLAG_SIZE);
    const g = canvas.getContext('2d');
    if (!g) return { status: 4 };
    g.drawImage(bitmap, 0, 0, FLAG_SIZE, FLAG_SIZE);
    return { status: 1, flag: flagFromRgba(g.getImageData(0, 0, FLAG_SIZE, FLAG_SIZE).data) };
  } catch {
    return { status: 4 };
  } finally {
    bitmap.close();
  }
}

// The file chooser: resolves with the chosen file, or null when the player closes it (the `cancel`
// event; a browser without it leaves the promise pending and the window's Cancel key ends the wait).
export function chooseImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.bmp';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

export async function pickFlagImage(): Promise<FlagPick> {
  const file = await chooseImageFile();
  return file ? flagFromFile(file) : { status: 2 };
}
