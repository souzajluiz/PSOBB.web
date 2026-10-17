import { ClientFiles } from '../data/clientfiles.ts';
import { pickDataFolder, type DataSource } from '../data/source.ts';
import { detectDevDataSource, onDataSource, setDataSource } from '../data/store.ts';
import { areaForMap, parseSetFile, placeEntities, setVariantsForMap, type SetEntity, type SetVariant } from '../formats/setdata.ts';
import { MapViewer, textureArchiveFor, type MapStats } from '../render/mapviewer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const label = (cls: string, ...children: Array<Node | string>): HTMLLabelElement => {
  const l = document.createElement('label');
  if (cls) l.className = cls;
  l.append(...children);
  return l;
};
const checkbox = (id: string, checked: boolean): HTMLInputElement => {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.id = id;
  c.checked = checked;
  return c;
};

export function initMapsTab(log: (msg: string) => void): { activate: () => void } {
  const select = $<HTMLSelectElement>('map-select');
  const status = $<HTMLParagraphElement>('map-status');
  const frameBtn = $<HTMLButtonElement>('frame-map');
  let viewer: MapViewer | null = null;
  let source: DataSource | null = null;
  let files: ClientFiles | null = null;
  let setNames: Promise<string[]> | null = null;
  let maps: string[] = [];
  let mapLine = '';
  let loadToken = 0;

  // Set data controls are created here so index.html stays untouched.
  const variantSelect = document.createElement('select');
  variantSelect.id = 'set-variant';
  variantSelect.disabled = true;
  variantSelect.title = 'Set data variant (map_*e.dat / o.dat)';
  const showBox = checkbox('show-entities', true);
  const labelsBox = checkbox('show-labels', false);
  frameBtn.before(
    label('', 'Set data ', variantSelect),
    label('check', showBox, ' Show enemies/objects'),
    label('check', labelsBox, ' Labels'),
  );
  for (const l of [showBox.parentElement!, labelsBox.parentElement!]) {
    l.style.cssText = 'display:flex;gap:6px;align-items:center;padding:8px 0;cursor:pointer';
  }

  const setStatus = (msg: string, kind: '' | 'ok' | 'err' = '') => {
    status.textContent = msg;
    status.className = `status ${kind}`;
  };

  async function useSource(s: DataSource): Promise<void> {
    source = s;
    files = new ClientFiles(s);
    setNames = null;
    $('data-label').textContent = `· ${s.label}`;
    const sceneFiles = await s.list('scene');
    maps = sceneFiles.filter((f) => /^map_.*n\.rel$/.test(f));
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

  const describeMap = (name: string, s: MapStats, ms: number) =>
    `${name}: ${s.sections} sections, ${s.meshes} meshes, ${s.triangles.toLocaleString()} triangles, ` +
    `${s.textures} textures${s.skippedEntries ? `, ${s.skippedEntries} unknown entries skipped` : ''} (${ms} ms)`;

  async function loadSelected(): Promise<void> {
    if (!source || !select.value) return;
    viewer ??= new MapViewer($<HTMLCanvasElement>('map-canvas'));
    const token = ++loadToken;
    const name = select.value;
    variantSelect.replaceChildren();
    variantSelect.disabled = true;
    setStatus(`Loading ${name} + ${textureArchiveFor(name)}...`);
    const t0 = performance.now();
    try {
      const s = await viewer.load(source, name);
      if (token !== loadToken) return;
      mapLine = describeMap(name, s, Math.round(performance.now() - t0));
      setStatus(mapLine, 'ok');
      log(`map loaded: ${name} ${JSON.stringify(s)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg, 'err');
      log(`map error: ${msg}`);
      return;
    }
    await loadVariants(name, token);
  }

  // Lists the set data variants for the map (reads data.gsl once per source).
  async function loadVariants(name: string, token: number): Promise<void> {
    if (!files) return;
    try {
      setNames ??= files.names();
      const variants = setVariantsForMap(name, await setNames, maps);
      if (token !== loadToken) return;
      variantSelect.replaceChildren(
        ...variants.map((v) => new Option(variantText(v), v.label)),
        new Option('none', ''),
      );
      variantSelect.disabled = false;
      variantSelect.value = variants[0]?.label ?? '';
      variantSelect.dataset.variants = JSON.stringify(variants);
      await showVariant(token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`${mapLine} · set data error: ${msg}`, 'err');
      log(`set data error: ${msg}`);
    }
  }

  const variantText = (v: SetVariant) => {
    const parts = [v.enemies ? 'e' : '', v.objects ? 'o' : ''].filter(Boolean).join('+');
    return `${v.label} (${parts})`;
  };

  async function showVariant(token = loadToken): Promise<void> {
    if (!viewer || !files) return;
    const variants = JSON.parse(variantSelect.dataset.variants ?? '[]') as SetVariant[];
    const v = variants.find((x) => x.label === variantSelect.value);
    if (!v) {
      viewer.clearEntities();
      setStatus(variants.length ? `${mapLine} · set data hidden` : `${mapLine} · no set data for this map`, 'ok');
      return;
    }
    const ents: SetEntity[] = [];
    for (const f of [v.enemies, v.objects]) if (f) ents.push(...parseSetFile(f, await files.read(f)));
    if (token !== loadToken || !viewer.geometry) return;
    const placed = placeEntities(ents, viewer.geometry.sections, areaForMap(select.value));
    viewer.setEntities(placed);
    viewer.setEntitiesVisible(showBox.checked);
    viewer.setLabelsVisible(labelsBox.checked);
    const n = (c: string) => placed.filter((p) => p.category === c).length;
    const missing = placed.filter((p) => !p.sectionFound).length;
    setStatus(
      `${mapLine} · ${n('enemy')} enemies, ${n('npc')} NPCs, ${n('object')} objects` +
        ` (${[v.enemies, v.objects].filter(Boolean).join(' + ')})${missing ? `, ${missing} without section` : ''}`,
      'ok',
    );
    log(`set data: ${v.label} ${placed.length} entities`);
  }

  $('pick-folder').addEventListener('click', async () => {
    try {
      setDataSource(await pickDataFolder());
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setStatus((err as Error).message, 'err');
    }
  });
  select.addEventListener('change', () => void loadSelected());
  variantSelect.addEventListener('change', () => void showVariant());
  showBox.addEventListener('change', () => viewer?.setEntitiesVisible(showBox.checked));
  labelsBox.addEventListener('change', () => viewer?.setLabelsVisible(labelsBox.checked));
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
