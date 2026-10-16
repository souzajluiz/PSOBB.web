// Entry point of the classic (original-looking) client.

import { ClientFiles } from '../data/clientfiles.ts';
import { HttpSource, pickDataFolder, type DataSource } from '../data/source.ts';
import { Stage, textureBitmaps, VH, VW } from './stage.ts';
import { tintCircle, TITLE_TUNING, TitleScreen } from './title.ts';

const VERSION = 'PSOBB.web';
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const boot = document.getElementById('boot') as HTMLDivElement;

async function dataSource(): Promise<DataSource> {
  if (await HttpSource.available()) return new HttpSource();
  // The folder picker needs a user gesture.
  boot.hidden = false;
  const button = document.createElement('button');
  button.textContent = 'Open PSOBB folder';
  boot.replaceChildren(button);
  await new Promise<void>((r) => button.addEventListener('click', () => r(), { once: true }));
  const s = await pickDataFolder();
  boot.hidden = true;
  return s;
}

async function main(): Promise<void> {
  const files = new ClientFiles(await dataSource());
  const stage = new Stage(canvas);
  const titleTex = await textureBitmaps(await files.textures('title.prs'));
  const title = new TitleScreen(
    titleTex,
    await tintCircle(titleTex[11]),
    [
      { label: 'Start Game', action: () => console.log('[classic] start game') },
      { label: 'Exit Game', action: () => (location.href = '/') },
      { label: 'Patch Download', action: () => {} },
      { label: 'Register UserID', action: () => {} },
      { label: 'Empty', color: '#f2c94c', action: () => {} },
    ],
    VERSION,
  );
  stage.show(title);

  const toVirtual = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * VW, ((e.clientY - r.top) / r.height) * VH] as const;
  };
  canvas.addEventListener('pointermove', (e) => title.pointer(...toVirtual(e), false));
  canvas.addEventListener('click', (e) => title.pointer(...toVirtual(e as PointerEvent), true));
  (window as unknown as { classicStage: Stage }).classicStage = stage;
  referenceOverlay();
  Object.assign(window, { TITLE_TUNING, classicTime: (t: number) => (stage.time = t) });
  (window as unknown as { classicCapture: (name: string, w?: number, h?: number) => Promise<string> }).classicCapture =
    (name, w = 2880, h = 1800) => captureStage(stage, name, w, h);
}

main().catch((e) => {
  boot.hidden = false;
  boot.textContent = `Error: ${e instanceof Error ? e.message : e}`;
  console.error(e);
});

// Development aid: renders the current screen at w x h and saves it through the
// dev server (/__capture) for pixel comparison with the original client.
async function captureStage(stage: Stage, name: string, w: number, h: number): Promise<string> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')! as unknown as CanvasRenderingContext2D;
  stage.renderTo(ctx, w, h);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const res = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
  return res.ok ? `saved .captures/${name}.png` : `capture failed: ${res.status}`;
}

// Development aid: ?ref=<name> overlays /ref/<name>.png (a local capture of the
// original client, not committed) on the stage. Keys: F1 cycles opacity,
// F2 toggles difference blending (identical pixels turn black).
function referenceOverlay(): void {
  const ref = new URLSearchParams(location.search).get('ref');
  if (!ref) return;
  const img = document.createElement('img');
  img.src = `/ref/${ref}.png`;
  img.alt = '';
  Object.assign(img.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', opacity: '0.5' });
  const sync = () => {
    const r = canvas.getBoundingClientRect();
    Object.assign(img.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  new ResizeObserver(sync).observe(canvas);
  sync();
  document.body.append(img);
  const opacities = ['0.5', '1', '0'];
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') img.style.opacity = opacities[(opacities.indexOf(img.style.opacity) + 1) % opacities.length];
    if (e.key === 'F2') img.style.mixBlendMode = img.style.mixBlendMode === 'difference' ? '' : 'difference';
  });
}
