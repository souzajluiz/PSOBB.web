// Shape motions (.njs) of the Seabed jellyfish (TOKurage), the Episode 4 plants
// (Poison Plant, bohu, kogomi) and the Pofuilly Slime's puddle / crawl body,
// drawn through the game's ObjectLayer and buildEnemy on the dev server's
// /psobb-data (no login, no newserv). The page is a harness served from this
// spec (route), so nothing is added to the app.
//
// Asserts that every shape's frame advances with the game ticks and that the
// shaped vertices move with it. PW_SHOT=<dir> also writes a screenshot.
// Run: PW_BASE_URL=http://127.0.0.1:5193 npx playwright test e2e/shape-motions.spec.ts --trace off
import { expect, test } from '@playwright/test';

const HARNESS = `<!doctype html>
<html><body style="margin:0;background:#0a1424"><canvas id="c" style="width:1280px;height:720px"></canvas>
<script type="module">
import { MapViewer } from '/src/render/mapviewer.ts';
import { ObjectLayer } from '/src/render/objectview.ts';
import { ClientFiles } from '/src/data/clientfiles.ts';
import { HttpSource } from '/src/data/source.ts';
import { EnemyArchiveCache, buildEnemy } from '/src/render/enemymodel.ts';
import { enemyModelFor } from '/src/formats/enemymodels.ts';

const viewer = new MapViewer(document.getElementById('c'));
const files = new ClientFiles(new HttpSource());
const layer = new ObjectLayer(viewer, files);
const obj = (index, type, params) => ({
  entity: { kind: 'object', index, type, floor: 0, group: 0, section: 0, unknownA3: 0, position: [0, 0, 0], rotation: [0, 0, 0], params },
  name: 'obj' + type.toString(16), category: 'object', world: [(index - 1.5) * 60, 0, 0], yaw: 0, sectionFound: true,
});
const items = [
  obj(0, 0xcc, [0, 0, 0, 0, 0, 0]), // TOKurage
  obj(1, 0x380, [0, 0, 0, 0, 0, 0]), // Poison Plant
  obj(2, 0x383, [1, 1, 0, 0, 0, 0]), // bohu: speed 1, scale 1
  obj(3, 0x38c, [1, 1, 0, 0, 0, 0]), // kogomi: scale (1, 1, 1)
];
const shown = await layer.show(items, { area: 0x0d, episode: 3 });
const cache = new EnemyArchiveCache(files);
const archive = await cache.getAuto('bm4_ps_ma_body.bml');
const slime = enemyModelFor({ kind: 'enemy', type: 0x64, params: [0, 0, 0, 0, 0, 0, 0] }, { area: 2, episode: 1, difficulty: 0, event: 0 });
const slimes = ['Slime puddle', 'Slime crawl'].map((name, i) => {
  const built = buildEnemy(archive, [{ ...slime.parts.find((p) => p.name === name), hidden: false }], 0, cache.loadedTextures);
  built.root.position.set(-30 + i * 60, 0, 80);
  viewer.scene.add(built.root);
  viewer.frameHooks.add((dt) => built.animators.forEach((a) => a.update(dt)));
  return { name, built };
});
viewer.orbitTarget.set(0, 20, 40);
viewer.camera.position.set(0, 90, 260);

const sumOf = (root) => {
  let s = 0;
  root.traverse((o) => {
    if (o.isSkinnedMesh) for (const v of o.geometry.getAttribute('position').array) s += v;
  });
  return s;
};
window.__shape = () => ({
  shown: shown.size,
  stats: layer.stats,
  things: [
    ...[...layer.models.values()].map((m) => ({ name: m.spec.name, frame: m.parts[0].animator?.frame ?? null, sum: sumOf(m.root) })),
    ...slimes.map((s) => ({ name: s.name, frame: s.built.animators[0]?.frame ?? null, sum: sumOf(s.built.root) })),
  ],
});
window.__ready = true;
</script></body></html>`;

test('shape motions advance and move the shaped vertices', async ({ page }) => {
  await page.route('**/shape-harness.html', (r) => r.fulfill({ contentType: 'text/html', body: HARNESS }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/shape-harness.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 90_000 });
  type Snap = { shown: number; stats: { errors: string[]; unresolved: string[] }; things: { name: string; frame: number | null; sum: number }[] };
  const read = () => page.evaluate(() => (window as unknown as { __shape: () => Snap }).__shape());
  const a = await read();
  expect(a.stats.errors).toEqual([]);
  expect(a.shown).toBe(4);
  await page.waitForTimeout(700);
  const b = await read();
  await page.waitForTimeout(700);
  const c = await read();
  if (process.env.PW_SHOT) await page.screenshot({ path: `${process.env.PW_SHOT}/shape-motions.png` });
  console.log(JSON.stringify({ a: a.things, b: b.things, c: c.things }));
  for (let i = 0; i < a.things.length; i++) {
    const [x, y, z] = [a.things[i], b.things[i], c.things[i]];
    expect(x.frame, x.name).not.toBeNull();
    // The frame moved between samples (it may have wrapped, so only "changed").
    expect(y.frame !== x.frame || z.frame !== y.frame, `${x.name} frame ${x.frame} -> ${y.frame} -> ${z.frame}`).toBe(true);
    expect(y.sum !== x.sum || z.sum !== y.sum, `${x.name} shaped vertices ${x.sum} -> ${y.sum} -> ${z.sum}`).toBe(true);
  }
  expect(errors).toEqual([]);
});
