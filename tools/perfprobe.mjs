// Headless Chrome probe for render cost (dev tool, see docs/DEVLOG.md "Render cost").
//
//   node tools/perfprobe.mjs [--base http://127.0.0.1:5290] [--maps map_city00_00n,map_forest01n,...]
//        [--out dir] [--frames 120] [--churn 6]
//
// Opens the map viewer tab of a running `npx vite` (data from ~/Downloads/psobb-client/data),
// loads each map with a fixed camera and prints per map: draw calls, triangles, geometries,
// textures, scene objects, and the CPU ms of scene.updateMatrixWorld() / renderer.render()
// averaged over --frames after a warm-up. With --out it also writes a PNG per map (rendered
// with the animations at frame 0) for tools/imgdiff.mjs. --churn N reloads the first map and
// another map N times and prints renderer.info.memory after each load (leak trend).
// The GPU is SwiftShader here: the numbers are CPU / submission cost, not GPU time.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:5173');
const maps = arg('maps', 'map_city00_00n,map_forest01n,map_cave01_00n,map_ruins01_00n').split(',').map((m) => (m.endsWith('.rel') ? m : `${m}.rel`));
const out = arg('out', '');
const frames = Number(arg('frames', '120'));
const churn = Number(arg('churn', '0'));
const dpr = Number(arg('dpr', '1'));
// Camera poses: the first run (--cam file) records the framed camera of each map, later runs reuse it,
// so before / after screenshots look at the same view.
const withObjects = process.argv.includes('--objects');
const evalFile = arg('eval', '');
const camFile = arg('cam', '');
const cams = camFile && existsSync(camFile) ? JSON.parse(readFileSync(camFile, 'utf8')) : {};
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// The Chrome profile is ~100 MB: keep it under --profile-root (default: next to the output, else cwd) and delete it on every exit path.
const profileRoot = arg('profile-root', process.env.PERFPROBE_TMP ?? process.cwd());
mkdirSync(profileRoot, { recursive: true });
const profileDir = mkdtempSync(join(profileRoot, '.perfprobe-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--window-size=1280,800', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws; let id = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
}
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const loadMap = (name) => `(async () => {
  const sel = document.getElementById('map-select');
  sel.value = ${JSON.stringify(name)};
  const status = document.getElementById('map-status');
  const old = window.mapViewer?.geometry;
  sel.value = ${JSON.stringify(name)};
  status.textContent = '';
  sel.dispatchEvent(new Event('change'));
  for (let i = 0; i < 600; i++) { await new Promise(r => setTimeout(r, 100)); if (window.mapViewer.geometry !== old && /triangles/.test(status.textContent) && /set data|enemies|objects/.test(status.textContent)) break; if (status.className.includes('err')) throw new Error(status.textContent); }
  return status.textContent;
})()`;

// Freeze the animation loop, put every animation at frame 0 and measure.
const camSetFor = (cam) => cam ? `{ const c = v.camera, k = ${JSON.stringify(cam)}; c.position.fromArray(k.p); c.quaternion.fromArray(k.q); c.far = k.far; c.updateProjectionMatrix(); c.updateMatrixWorld(true); }` : `v.frameAll(); v.camera.updateMatrixWorld(true);`;
// The field objects of the map's set data (render/objectview.ts + fieldobjects.ts), built the way
// the game view does, without a server: models, FieldObjects, and batchStatic unless ?batch=off.
const objectsSetup = `(async () => {
  const v = window.mapViewer;
  const { ObjectLayer } = await import('/src/render/objectview.ts');
  const { FieldObjects } = await import('/src/render/fieldobjects.ts');
  const { ClientFiles } = await import('/src/data/clientfiles.ts');
  const { HttpSource } = await import('/src/data/source.ts');
  if (window.objLayer) window.objLayer.dispose();
  const layer = window.objLayer = new ObjectLayer(v, new ClientFiles(new HttpSource()));
  const items = v.entityMeshes.flatMap((e) => e.items).filter((p) => p.category === 'object');
  const t0 = performance.now();
  const done = await layer.show(items, { area: v.area, episode: 1, ultimate: false });
  const field = new FieldObjects(v, items, { episode: 1, floor: 0, area: v.area }, new Set(), layer, null, new Set());
  window.fieldObjects = field;
  let batch = null;
  if (!/batch=off/.test(location.search)) batch = layer.batchStatic(field.dynamicIndices(), field.hideableIndices());
  return { objects: items.length, modeled: done.size, buildMs: Math.round(performance.now() - t0), batch };
})()`;
const measure = (camSet) => `(async () => {
  const v = window.mapViewer;
  v.renderer.setAnimationLoop(null);
  v.setEntitiesVisible(false);
  ${camSet}
  const r = v.renderer, scene = v.scene, cam = v.camera;
  for (let i = 0; i < 30; i++) r.render(scene, cam);
  let tUpdate = 0, tRender = 0;
  const N = ${frames};
  for (let i = 0; i < N; i++) {
    let t0 = performance.now();
    for (let k = 0; k < 20; k++) scene.updateMatrixWorld(); // 20 calls: one is below the timer's resolution
    tUpdate += (performance.now() - t0) / 20;
    t0 = performance.now();
    r.render(scene, cam);
    tRender += performance.now() - t0;
  }
  let objects = 0, meshes = 0, groups = 0, skinned = 0, auto = 0;
  scene.traverse((o) => { objects++; if (o.isMesh) { meshes++; if (o.isSkinnedMesh) skinned++; if (Array.isArray(o.material)) groups += o.geometry.groups.length; else groups++; } if (o.matrixAutoUpdate) auto++; });
  const info = r.info;
  return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
    programs: info.programs.length, objects, meshes, matrixAuto: auto, updateMatrixMs: +(tUpdate / N).toFixed(3), renderMs: +(tRender / N).toFixed(3) };
})()`;

const shot = (camSet) => `(async () => {
  const v = window.mapViewer;
  v.renderer.setAnimationLoop(null);
  v.setEntitiesVisible(false);
  v.mapAnimator.update(0);
  for (const t of v.mapAnimator.tracks ?? []) t.frame = 0;
  v.mapAnimator.update(0);
  ${camSet}
  v.renderer.render(v.scene, v.camera);
  return v.renderer.domElement.toDataURL('image/png');
})()`;

const cleanup = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
await connect();
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: dpr, mobile: false });
await send('Page.navigate', { url: `${base}/?${arg('q', '')}#maps` });
for (let i = 0; i < 100; i++) { await sleep(300); if (await ev(`!!document.getElementById('map-select') && !document.getElementById('map-select').disabled && /enemies|NPCs/.test(document.getElementById('map-status').textContent)`)) break; }
if (out) mkdirSync(out, { recursive: true });
const rows = [];
for (const m of maps) {
  await ev(loadMap(m));
  await sleep(500);
  if (withObjects) console.log('objects', JSON.stringify(await ev(objectsSetup)));
  const camSet = camSetFor(cams[m]);
  const res = await ev(measure(camSet));
  if (!cams[m]) cams[m] = await ev(`(() => { const c = window.mapViewer.camera; return { p: c.position.toArray(), q: c.quaternion.toArray(), far: c.far }; })()`);
  rows.push({ map: m.replace(/n\.rel$/, ''), ...res });
  console.log(JSON.stringify({ map: m, ...res }));
  if (evalFile) console.log(JSON.stringify(await ev(readFileSync(evalFile, 'utf8'))));
  if (out) {
    const url = await ev(shot(camSet));
    writeFileSync(join(out, `${m.replace(/\.rel$/, '')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  await ev(`window.mapViewer.renderer.setAnimationLoop(() => {}), 0`);
}
if (churn) {
  console.log('memory trend (geometries/textures after each load):');
  const trend = [];
  for (let i = 0; i < churn; i++) {
    await ev(loadMap(maps[i % 2]));
    await sleep(300);
    const mem = await ev(`(() => { const r = window.mapViewer.renderer; r.render(window.mapViewer.scene, window.mapViewer.camera); return [r.info.memory.geometries, r.info.memory.textures, r.info.programs.length]; })()`);
    trend.push(mem);
    console.log(maps[i % 2], mem.join(' / '));
  }
}
if (camFile) writeFileSync(camFile, JSON.stringify(cams));
process.exit(0);
