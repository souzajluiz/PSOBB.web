// Entry point of the classic (original-looking) client.

import { ClientFiles } from '../data/clientfiles.ts';
import { HttpSource, pickDataFolder, type DataSource } from '../data/source.ts';
import { BBSession, type CharacterPreview } from '../net/bbsession.ts';
import { connectBridge } from '../net/wstransport.ts';
import { CharCreateScreen, type CharCreateAssets } from './charcreate.ts';
import { TEXTURE_FILES } from './charcreate_data.ts';
import { PlaceholderModelView } from './charcreate_model.ts';
import { parseUnitxt } from './charcreate_text.ts';
import { CharSelectScreen, type CharSelectAssets } from './charselect.ts';
import { LoginScreen } from './login.ts';
import { Stage, textureBitmaps, VH, VW, type Screen } from './stage.ts';
import { TITLE_TUNING, TitleScreen } from './title.ts';

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

async function loadKey(name = 'default'): Promise<Uint8Array> {
  const res = await fetch(`/keys/${name}.nsk`);
  if (!res.ok) throw new Error(`key file ${name}.nsk not found`);
  return new Uint8Array(await res.arrayBuffer());
}

function savedUser(): string {
  try {
    return localStorage.getItem('psobb.username') ?? '';
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const files = new ClientFiles(await dataSource());
  const stage = new Stage(canvas);
  const titleTex = await textureBitmaps(await files.textures('title.prs'));
  const selectAssets: CharSelectAssets = {
    header: (await textureBitmaps(await files.textures(['f512_midashi_eng.prs', 'f512_midashi.prs'])))[0],
    tag: (await textureBitmaps(await files.textures(['f256_tag_eng.prs', 'f256_tag.prs'])))[0],
    tunnel: await textureBitmaps(await files.textures('f256_backtext.prs')),
  };

  let createAssets: CharCreateAssets | null = null;
  const loadCreateAssets = async (): Promise<CharCreateAssets> =>
    (createAssets ??= {
      tex: await textureBitmaps(await files.textures(TEXTURE_FILES)),
      text: parseUnitxt((await files.readFirst(['unitxt_e.prs', 'unitxt_j.prs'])).data),
    });

  let session: BBSession | null = null;
  let title: TitleScreen;

  // Empty slot -> character creation; the result goes out as E5.
  const showCreate = async (slot: number, slots: Array<CharacterPreview | null>) => {
    const create: CharCreateScreen = new CharCreateScreen(
      await loadCreateAssets(),
      {
        done: async (r) => {
          try {
            if (session) {
              await session.createCharacter(slot, {
                name: r.name,
                charClass: r.charClass,
                sectionId: r.sectionId,
                classFlags: r.classFlags,
                ...r.look,
              });
              showSelect(await session.characterPreviews());
            } else {
              console.log('[classic] created (offline)', r);
              showSelect(slots.map((p, i) => (i === slot ? { slot, level: 1, exp: 0, name: r.name, charClass: r.charClass, sectionId: r.sectionId, playTimeSeconds: 0 } : p)));
            }
          } catch (err) {
            console.error(err);
            showSelect(slots);
          }
        },
        cancel: () => showSelect(slots),
      },
      new PlaceholderModelView(),
    );
    Object.assign(window, { classicCreate: create });
    show(create);
  };

  const showSelect = (slots: Array<CharacterPreview | null>) => {
    const select = new CharSelectScreen(selectAssets, slots, {
      enter: (slot) => {
        if (!slots[slot]) void showCreate(slot, slots);
        else console.log(`[classic] slot ${slot + 1} chosen`);
      },
      cancel: () => {
        session?.close();
        session = null;
        show(title);
      },
    });
    show(select);
  };

  const startGame = () => {
    const login = new LoginScreen(
      title,
      {
        submit: async (username, password) => {
          login.busy = true;
          try {
            session?.close();
            session = new BBSession({ nsk: await loadKey(), connect: (port) => connectBridge(port) });
            await session.login(username, password);
            try {
              localStorage.setItem('psobb.username', username);
            } catch {
              // storage unavailable; nothing to remember
            }
            showSelect(await session.characterPreviews());
          } catch (err) {
            login.busy = false;
            login.status = err instanceof Error ? err.message : String(err);
          }
        },
        cancel: () => show(title),
      },
      savedUser(),
    );
    show(login);
  };

  title = new TitleScreen(
    titleTex,
    [
      { label: 'Start Game', action: startGame },
      { label: 'Exit Game', action: () => (location.href = '/') },
      { label: 'Patch Download', action: () => {} },
      { label: 'Register UserID', action: () => {} },
      { label: 'Empty', color: '#f2c94c', action: () => {} },
    ],
    VERSION,
  );

  let current: Screen = title;
  function show(s: Screen): void {
    current = s;
    stage.show(s);
  }

  // ?screen=select jumps to the character list with empty slots and
  // ?screen=create to character creation, offline (layout work).
  const jump = new URLSearchParams(location.search).get('screen');
  if (jump === 'select') showSelect([null, null, null, null]);
  else if (jump === 'create') await showCreate(0, [null, null, null, null]);
  else show(title);

  const toVirtual = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const vy = ((e.clientY - r.top) / r.height) * VH;
    const left43 = (current as { layout?: string }).layout === 'left43';
    const vx = left43 ? ((e.clientX - r.left) / r.height) * VH : ((e.clientX - r.left) / r.width) * VW;
    return [vx, vy] as const;
  };
  const pointer = (e: MouseEvent, click: boolean) =>
    (current as { pointer?: (x: number, y: number, c: boolean) => void }).pointer?.(...toVirtual(e), click);
  canvas.addEventListener('pointermove', (e) => pointer(e, false));
  canvas.addEventListener('click', (e) => pointer(e, true));

  referenceOverlay();
  Object.assign(window, {
    classicStage: stage,
    TITLE_TUNING,
    classicTime: (t: number) => (stage.time = t),
    classicCapture: (name: string, w = 2880, h = 1800) => captureStage(stage, name, w, h),
  });
}

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

main().catch((e) => {
  boot.hidden = false;
  boot.textContent = `Error: ${e instanceof Error ? e.message : e}`;
  console.error(e);
});
