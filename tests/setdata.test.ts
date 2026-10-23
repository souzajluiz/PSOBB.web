// Parses every map set data file (map_*e.dat / map_*o.dat) in data.gsl, the
// loose client files and the Tethealla map/ folder, and compares the decoded
// entries with newserv's `disassemble-free-map --bb` output when the newserv
// binary is available. Also checks the n.rel <-> set data mapping, section ids
// and world placement.
//
// Run: node tests/setdata.test.ts
// Env: PSOBB_DATA (client data/ folder), TETHEALLA_MAP (map/ folder),
//      NEWSERV (newserv checkout with build/newserv; default: vendor/newserv
//      next to the main checkout)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseMapNRel } from '../client/src/formats/nrel.ts';
import {
  areaForMap, enemyDisplayName, enemyTypeClassName, entityParamLabels, objectTypeName, parseEnemySets, parseObjectSets, parseSetFile, parseSetFileName,
  placeEntities, sectionToWorld, setVariantsForMap, type SetEntity,
} from '../client/src/formats/setdata.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
// Repo root of the main checkout (differs from HERE/.. inside a git worktree).
const MAIN_ROOT = (() => {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim();
    return dirname(common);
  } catch {
    return join(HERE, '..');
  }
})();
const TETHEALLA = process.env.TETHEALLA_MAP ?? [join(HERE, '../../map'), join(MAIN_ROOT, '../map')].find((d) => existsSync(d)) ?? '';
let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);

function findNewserv(): string | null {
  const candidates = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')];
  return candidates.find((d) => d && existsSync(join(d, 'build/newserv'))) ?? null;
}

// --- Collect files -----------------------------------------------------------
interface Source { label: string; name: string; data: Uint8Array; path?: string }
const sources: Source[] = [];
const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
for (const name of gsl.entries.keys()) if (parseSetFileName(name)) sources.push({ label: 'gsl', name, data: gsl.get(name) });
const looseNames = readdirSync(DATA);
for (const name of looseNames.filter((n) => parseSetFileName(n))) {
  sources.push({ label: 'loose', name, data: new Uint8Array(readFileSync(join(DATA, name))), path: join(DATA, name) });
}
if (TETHEALLA && existsSync(TETHEALLA)) {
  for (const name of readdirSync(TETHEALLA).filter((n) => parseSetFileName(n))) {
    sources.push({ label: 'tethealla', name, data: new Uint8Array(readFileSync(join(TETHEALLA, name))), path: join(TETHEALLA, name) });
  }
}

// --- 1. Parse everything --------------------------------------------------------
const parsed = new Map<Source, SetEntity[]>();
const counts: Record<string, { files: number; enemies: number; objects: number }> = {};
for (const s of sources) {
  try {
    const ents = parseSetFile(s.name, s.data);
    parsed.set(s, ents);
    const c = (counts[s.label] ??= { files: 0, enemies: 0, objects: 0 });
    c.files++;
    for (const e of ents) c[e.kind === 'enemy' ? 'enemies' : 'objects']++;
    for (const e of ents) {
      if (!e.position.every(Number.isFinite)) fail(`${s.label}/${s.name} #${e.index}: non-finite position`);
    }
  } catch (e) {
    fail(`${s.label}/${s.name}: ${(e as Error).message}`);
  }
}
for (const [label, c] of Object.entries(counts)) console.log(`${label}: ${c.files} files, ${c.enemies} enemy sets, ${c.objects} object sets`);

// Loose files override data.gsl; when both exist with the same bytes, they must decode the same.
const gslByName = new Map(sources.filter((s) => s.label === 'gsl').map((s) => [s.name, s]));
let sameAsGsl = 0, differsFromGsl = 0;
for (const s of sources.filter((s) => s.label !== 'gsl')) {
  const g = gslByName.get(s.name);
  if (!g) continue;
  if (Buffer.compare(Buffer.from(g.data), Buffer.from(s.data)) === 0) sameAsGsl++;
  else differsFromGsl++;
}
console.log(`files also in data.gsl: ${sameAsGsl} identical, ${differsFromGsl} different`);

// --- 2. Compare with newserv ---------------------------------------------------------
const newserv = findNewserv();
if (!newserv) {
  console.log('newserv binary not found: skipping CLI comparison (set NEWSERV=...)');
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'psobb-setdata-'));
  let files = 0, entities = 0, skipped = 0;
  try {
    for (const [s, ents] of parsed) {
      // newserv classifies "*e_d.dat" as objects (the "d.dat" check wins), so skip those.
      if (/e_d\.dat$/.test(s.name)) { skipped++; continue; }
      let path = s.path;
      if (!path) {
        path = join(tmp, s.name);
        writeFileSync(path, s.data);
      }
      const out = execFileSync(join(newserv, 'build/newserv'), ['disassemble-free-map', '--bb', path, '-'], {
        cwd: newserv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const lines = out.split('\n').filter((l) => /^\/\* [SK]-[0-9A-F]+ \*\//.test(l));
      files++;
      if (lines.length !== ents.length) {
        fail(`${s.label}/${s.name}: ${ents.length} entries, newserv ${lines.length}`);
        continue;
      }
      ents.forEach((e, i) => {
        const l = lines[i];
        const field = (k: string) => new RegExp(`\\b${k}=([^ \\]]+)`).exec(l)?.[1];
        const num = (k: string) => Number(field(k));
        const hex = (k: string) => parseInt(field(k) ?? 'NaN', 16);
        const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-5); // %g = 6 digits
        const name = /type=[0-9A-F]{4} "([^"]*)"/.exec(l)?.[1];
        const where = `${s.label}/${s.name} #${i}`;
        check(hex('type') === e.type, `${where}: type ${e.type} vs ${field('type')}`);
        check(hex('room') === e.section, `${where}: room ${e.section} vs ${field('room')}`);
        check(hex('floor') === e.floor, `${where}: floor ${e.floor} vs ${field('floor')}`);
        check(close(num('x'), e.position[0]) && close(num('y'), e.position[1]) && close(num('z'), e.position[2]), `${where}: position`);
        check((hex('y_angle') | 0) === e.rotation[1], `${where}: y_angle ${e.rotation[1]} vs ${field('y_angle')}`);
        const ours = e.kind === 'enemy' ? enemyTypeClassName(e.type) : objectTypeName(e.type);
        check(name === ours, `${where}: name "${ours}" vs newserv "${name}"`);
        if (e.kind === 'enemy') {
          check(hex('wave_number') === e.wave && hex('num_children') === e.numChildren, `${where}: wave/children`);
        } else {
          check(hex('group') === e.group, `${where}: group`);
        }
        entities++;
      });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`newserv: ${files} files and ${entities} entries compared (${skipped} *e_d.dat skipped)`);
}

// --- 3. n.rel <-> set data, section ids, room layout index -------------------------------------
const SCENE = join(DATA, 'scene');
const nrels = readdirSync(SCENE).filter((f) => /^map_.*n\.rel$/.test(f));
const setNames = [...new Set([...gsl.entries.keys(), ...looseNames])].filter((n) => parseSetFileName(n));
const readSet = (n: string) => (looseNames.includes(n) ? new Uint8Array(readFileSync(join(DATA, n))) : gsl.get(n));
let mapsWithSets = 0, variants = 0, placed = 0, missingSection = 0;
const used = new Set<string>();
for (const n of nrels) {
  const vs = setVariantsForMap(n, setNames, nrels);
  if (vs.length) mapsWithSets++;
  const geo = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, n))));
  for (const v of vs) {
    variants++;
    for (const f of [v.enemies, v.objects]) {
      if (!f) continue;
      if (!/^map_a(?!ncient)/.test(n)) {
        check(!used.has(f), `${f} mapped to more than one map (${n})`);
        used.add(f);
      }
      for (const p of placeEntities(parseSetFile(f, readSet(f)), geo.sections, areaForMap(n))) {
        placed++;
        if (!p.sectionFound) missingSection++;
      }
    }
  }
}
console.log(`maps: ${mapsWithSets}/${nrels.length} n.rel have set data, ${variants} variants, ${placed} entities placed, ${missingSection} with no matching section`);
check(missingSection <= 1, `too many entities without a section (${missingSection})`); // 1 known: map_lobby_green_be00o.dat
const unmapped = setNames.filter((f) => !used.has(f));
console.log(`set files not tied to a map: ${unmapped.join(' ')}`);

const expectVariants = (nrel: string, want: string[]) => {
  const got = setVariantsForMap(nrel, setNames, nrels).map((v) => `${v.label}:${v.enemies ?? '-'}:${v.objects ?? '-'}`);
  for (const w of want) check(got.includes(w), `${nrel}: expected variant ${w}, got ${got.join(', ')}`);
};
expectVariants('map_forest01n.rel', ['00:map_forest01_00e.dat:map_forest01_00o.dat', '04_off:map_forest01_04_offe.dat:-']);
expectVariants('map_cave01_02n.rel', ['01:map_cave01_02_01e.dat:map_cave01_02_01o.dat', '00_off:map_cave01_02_00_offe.dat:-']);
expectVariants('map_city00_00n.rel', ['00:map_city00_00e.dat:map_city00_00o.dat', '00_s:map_city00_00e_s.dat:map_city00_00o_s.dat']);
expectVariants('map_jungle01_00n.rel', ['02:map_jungle01_02e.dat:map_jungle01_02o.dat']);
expectVariants('map_darkfalz00n.rel', ['default:map_boss04e.dat:map_boss04o.dat']);
expectVariants('map_lobby_01n.rel', ['default:-:map_lobby_01o.dat']);

// Section positions against newserv's room layout index (system/maps/room-layout-index.json),
// keyed "<area>-<layout>" -> room id -> [x, y, z, ax, ay, az].
if (newserv && existsSync(join(newserv, 'system/maps/room-layout-index.json'))) {
  const index = JSON.parse(readFileSync(join(newserv, 'system/maps/room-layout-index.json'), 'utf8')) as Record<string, Record<string, number[]>>;
  let rooms = 0, matched = 0;
  for (const n of nrels.filter((n) => !n.startsWith('map_a') || n.startsWith('map_ancient'))) {
    const area = areaForMap(n);
    if (area === null || area === 0x0f) continue; // lobbies: one room each at the origin
    const layout = area >= 0x24 && area <= 0x27 ? 0 : Number(/_(\d\d)n\.rel$/.exec(n)?.[1] ?? 0);
    const key = `${area.toString(16).toUpperCase().padStart(2, '0')}-${layout.toString(16).toUpperCase().padStart(2, '0')}`;
    const table = index[key];
    if (!table) continue;
    const geo = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, n))));
    const byId = new Map(geo.sections.map((s) => [s.id, s]));
    for (const [id, r] of Object.entries(table)) {
      rooms++;
      const s = byId.get(parseInt(id, 16));
      if (s && Math.abs(s.position[0] - r[0]) < 0.01 && Math.abs(s.position[1] - r[1]) < 0.01 && Math.abs(s.position[2] - r[2]) < 0.01) matched++;
      else fail(`${n} (${key}) room ${id}: n.rel ${s ? s.position.join(',') : 'missing'} vs index ${r.slice(0, 3).join(',')}`);
    }
  }
  console.log(`room layout index: ${matched}/${rooms} rooms match n.rel section positions`);
}

// --- 4. Transforms and names -----------------------------------------------------------------
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
check(near(sectionToWorld({ id: 0, position: [10, 0, 20], rotation: [0, 0, 0] }, [1, 2, 3]), [11, 2, 23]), 'translate');
// +90 degrees about Y maps +X to -Z (right-handed, like newserv's rotate_y)
check(near(sectionToWorld({ id: 0, position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] }, [1, 0, 0]), [0, 0, -1]), 'rotate Y');
const wolf = parseSetFile('map_forest01_00e.dat', gsl.get('map_forest01_00e.dat')).find((e) => e.type === 0x43);
check(!!wolf && /Wolf$/.test(enemyDisplayName(wolf as never, 1)), 'forest wolf name');
check(objectTypeName(0x88, 1) === 'TObjContainerItem', 'object name');

// Parameter labels: newserv's names (generated) and the port's enemy decodings,
// "Param n" for the rest.
{
  const one = (size: number, type: number) => {
    const buf = new Uint8Array(size);
    new DataView(buf.buffer).setUint16(0, type, true);
    return buf;
  };
  const [player] = parseObjectSets(one(0x44, 0x0000));
  const labels = entityParamLabels(player, 1);
  check(labels.length === 6 && labels[0] === 'Client ID (param 1)' && labels[3] === 'Source type (param 4)', `object params named from newserv: ${labels.join(' | ')}`);
  check(labels[1] === 'Param 2 (f)' && labels[4] === 'Param 5 (i)', 'undocumented object params keep the Param n form');
  const [unknown] = parseEnemySets(one(0x48, 0xfff0));
  const plain = entityParamLabels(unknown, 1);
  check(plain.length === 7 && plain[0] === 'Param 1 (f)' && plain[4] === 'Param 5 (f)' && plain[5] === 'Param 6 (i16)' && plain[6] === 'Param 7 (i16)', `unknown enemy params: ${plain.join(' | ')}`);
  const [barb] = parseEnemySets(one(0x48, 0x0043));
  barb.params[1] = 1;
  const wolfLabels = entityParamLabels(barb, 1);
  check(wolfLabels[1] === 'Barbarous if >= 1 (param 2)', `port label for a wolf param: ${wolfLabels[1]}`);
  const [booma] = parseEnemySets(one(0x48, 0x0044));
  check(/^Variant: 0 Booma/.test(entityParamLabels(booma, 1)[5]), 'port label for a Booma variant');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
