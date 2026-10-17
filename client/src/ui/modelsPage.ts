// Dev page (models.html): shows a player character model for a selectable
// class and appearance, rotating. Reads the client data through the dev
// server's /psobb-data endpoint, or a picked folder outside dev.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ClientFiles } from '../data/clientfiles.ts';
import { HttpSource, pickDataFolder, type DataSource } from '../data/source.ts';
import {
  appearanceLimits,
  buildPlayerModel,
  CLASS_NAMES,
  DEFAULT_APPEARANCE,
  loadPlayerAssets,
  SECTION_IDS,
  type PlayerAppearance,
  type PlayerAssets,
  type PlayerModel,
} from '../render/playermodel.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const status = $<HTMLDivElement>('status');
const clsSelect = $<HTMLSelectElement>('cls');
const sectionSelect = $<HTMLSelectElement>('section');
const fields = ['costume', 'skin', 'face', 'head', 'hair'] as const;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1424);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 60, 50);
scene.add(sun);
const grid = new THREE.GridHelper(40, 8, 0x335577, 0x223344);
scene.add(grid);
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
camera.position.set(0, 10, 42);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 9, 0);
controls.enableDamping = true;

const turntable = new THREE.Group();
scene.add(turntable);
let model: PlayerModel | null = null;
let assets: PlayerAssets | null = null;
let files: ClientFiles | null = null;

function setStatus(msg: string, err = false): void {
  status.textContent = msg;
  status.className = err ? 'err' : '';
}

function resize(): void {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if ($<HTMLInputElement>('rotate').checked) turntable.rotation.y += dt * 0.6;
  controls.update();
  renderer.render(scene, camera);
});

function appearance(): PlayerAppearance {
  const a: PlayerAppearance = { ...DEFAULT_APPEARANCE, sectionId: Number(sectionSelect.value) };
  for (const f of fields) a[f] = Number($<HTMLInputElement>(f).value) || 0;
  const hex = $<HTMLInputElement>('hair-color').value;
  a.hairR = parseInt(hex.slice(1, 3), 16);
  a.hairG = parseInt(hex.slice(3, 5), 16);
  a.hairB = parseInt(hex.slice(5, 7), 16);
  return a;
}

function disposeModel(): void {
  if (!model) return;
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
  turntable.remove(model.root);
  model = null;
}

function rebuild(): void {
  if (!assets) return;
  disposeModel();
  const a = appearance();
  const t0 = performance.now();
  model = buildPlayerModel(assets, a);
  turntable.add(model.root);
  // Frame the model: Ninja units, about 18 tall, feet near y = 0.
  const box = new THREE.Box3();
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox!);
    }
  });
  if (!box.isEmpty()) controls.target.set(0, (box.min.y + box.max.y) / 2, 0);
  const s = model.stats;
  setStatus(
    `${CLASS_NAMES[assets.charClass]} (pl${assets.letter}): ${model.parts.join(', ')}\n` +
      `${s.bones} bones, ${s.vertices} vertices, ${s.triangles} triangles, ${s.materials} materials` +
      `${s.missingTextures ? `, ${s.missingTextures} missing textures` : ''} (${Math.round(performance.now() - t0)} ms)`,
  );
}

async function selectClass(cls: number): Promise<void> {
  if (!files) return;
  setStatus(`Loading ${CLASS_NAMES[cls]}...`);
  try {
    assets = await loadPlayerAssets(files, cls);
    const lim = appearanceLimits(cls);
    for (const f of fields) {
      const input = $<HTMLInputElement>(f);
      input.max = String(lim[f] - 1);
      input.disabled = lim[f] <= 1;
      if (Number(input.value) >= lim[f]) input.value = '0';
    }
    rebuild();
  } catch (e) {
    setStatus((e as Error).message, true);
    throw e;
  }
}

async function dataSource(): Promise<DataSource> {
  if (await HttpSource.available()) return new HttpSource();
  const button = document.createElement('button');
  button.textContent = 'Open PSOBB data folder';
  status.replaceChildren(button);
  await new Promise<void>((r) => button.addEventListener('click', () => r(), { once: true }));
  return pickDataFolder();
}

async function main(): Promise<void> {
  clsSelect.replaceChildren(...CLASS_NAMES.map((n, i) => new Option(n, String(i))));
  sectionSelect.replaceChildren(...SECTION_IDS.map((n, i) => new Option(n, String(i))));
  const cls = Number(new URLSearchParams(location.search).get('class') ?? 0);
  clsSelect.value = String(cls >= 0 && cls < 12 ? cls : 0);
  files = new ClientFiles(await dataSource());
  clsSelect.addEventListener('change', () => void selectClass(Number(clsSelect.value)));
  sectionSelect.addEventListener('change', rebuild);
  for (const id of [...fields, 'hair-color']) $(id).addEventListener('input', rebuild);
  await selectClass(Number(clsSelect.value));
}

// For automated checks from the browser console.
(window as unknown as { modelsPage: object }).modelsPage = {
  selectClass,
  rebuild,
  // Stops the turntable and frames the model from the front (or rotated by rotY).
  async show(cls?: number, rotY = 0, appearance: Partial<PlayerAppearance> = {}): Promise<string> {
    $<HTMLInputElement>('rotate').checked = false;
    for (const [k, v] of Object.entries(appearance)) {
      const input = document.getElementById(k) as HTMLInputElement | null;
      if (input) input.value = String(v);
    }
    if (cls !== undefined) {
      clsSelect.value = String(cls);
      await selectClass(cls);
    } else rebuild();
    turntable.rotation.y = rotY;
    camera.position.set(0, controls.target.y, controls.target.y * 4.2);
    return status.textContent ?? '';
  },
  get model() {
    return model;
  },
  camera,
  controls,
};

void main();
