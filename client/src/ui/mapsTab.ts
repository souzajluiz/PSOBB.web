import { pickDataFolder, type DataSource } from '../data/source.ts';
import { detectDevDataSource, onDataSource, setDataSource } from '../data/store.ts';
import { MapViewer, textureArchiveFor } from '../render/mapviewer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initMapsTab(log: (msg: string) => void): { activate: () => void } {
  const select = $<HTMLSelectElement>('map-select');
  const status = $<HTMLParagraphElement>('map-status');
  const frameBtn = $<HTMLButtonElement>('frame-map');
  let viewer: MapViewer | null = null;
  let source: DataSource | null = null;

  const setStatus = (msg: string, kind: '' | 'ok' | 'err' = '') => {
    status.textContent = msg;
    status.className = `status ${kind}`;
  };

  async function useSource(s: DataSource): Promise<void> {
    source = s;
    $('data-label').textContent = `· ${s.label}`;
    const files = await s.list('scene');
    const maps = files.filter((f) => /^map_.*n\.rel$/.test(f));
    select.replaceChildren(...maps.map((m) => new Option(m.replace(/n\.rel$/, ''), m)));
    select.disabled = false;
    frameBtn.disabled = false;
    log(`data source: ${s.label}, ${maps.length} maps`);
    const preferred = maps.find((m) => m === 'map_city00_00n.rel') ?? maps[0];
    if (preferred) {
      select.value = preferred;
      await loadSelected();
    }
  }

  async function loadSelected(): Promise<void> {
    if (!source || !select.value) return;
    viewer ??= new MapViewer($<HTMLCanvasElement>('map-canvas'));
    const name = select.value;
    setStatus(`Loading ${name} + ${textureArchiveFor(name)}...`);
    const t0 = performance.now();
    try {
      const s = await viewer.load(source, name);
      const ms = Math.round(performance.now() - t0);
      setStatus(
        `${name}: ${s.sections} sections, ${s.meshes} meshes, ${s.triangles.toLocaleString()} triangles, ` +
          `${s.textures} textures${s.skippedEntries ? `, ${s.skippedEntries} unknown entries skipped` : ''} (${ms} ms)`,
        'ok',
      );
      log(`map loaded: ${name} ${JSON.stringify(s)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg, 'err');
      log(`map error: ${msg}`);
    }
  }

  $('pick-folder').addEventListener('click', async () => {
    try {
      setDataSource(await pickDataFolder());
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setStatus((err as Error).message, 'err');
    }
  });
  select.addEventListener('change', () => void loadSelected());
  frameBtn.addEventListener('click', () => viewer?.frameAll());

  let activated = false;
  return {
    activate: () => {
      if (activated) return;
      activated = true;
      setStatus('Open your PSOBB folder (the one containing data/scene) to browse maps.');
      onDataSource((s) => void useSource(s));
      void detectDevDataSource();
    },
  };
}
