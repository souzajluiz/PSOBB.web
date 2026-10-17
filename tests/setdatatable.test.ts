// Parses the client's SetDataTable*.rel files, compares them with newserv's
// `disassemble-set-data-table --bb` output when the binary is available, and
// checks that every free-play floor of every episode resolves to a render map,
// a collision map and set data files that exist in the client.
//
// Run: node tests/setdatatable.test.ts
// Env: PSOBB_DATA (client data/ folder), NEWSERV (newserv checkout)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { floorToArea } from '../client/src/net/game.ts';
import { floorFiles, freePlayVariations, geometryCandidates, parseSetDataTable } from '../client/src/formats/setdatatable.ts';

const HERE = import.meta.dirname;
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const NEWSERV = process.env.NEWSERV ?? [resolve(HERE, '../vendor/newserv')].find((d) => existsSync(d)) ?? '';
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    if (failures < 40) console.log(`FAIL ${msg}`);
  }
};

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const loose = new Set(readdirSync(DATA));
const scene = new Set(readdirSync(join(DATA, 'scene')));
const read = (name: string) => (loose.has(name) ? new Uint8Array(readFileSync(join(DATA, name))) : gsl.has(name) ? gsl.get(name) : null);
const exists = (name: string) => loose.has(name) || gsl.has(name);

const tables = ['SetDataTableOn.rel', 'SetDataTableOff.rel', 'SetDataTableOnUlti.rel', 'SetDataTableOffUlti.rel'];
let floorsChecked = 0;
for (const name of tables) {
  const data = read(name);
  if (!data) {
    console.log(`skip ${name} (not in the client)`);
    continue;
  }
  const table = parseSetDataTable(data);
  const entries = table.flatMap((l, a) => l.flatMap((e, v1) => e.map((x, v2) => ({ a, v1, v2, ...x }))));
  console.log(`${name}: ${table.length} areas, ${entries.length} entries`);

  const bin = join(NEWSERV, 'build/newserv');
  if (existsSync(bin)) {
    const tmp = mkdtempSync(join(tmpdir(), 'sdt-'));
    const inPath = join(tmp, 'in.rel');
    const outPath = join(tmp, 'out.txt');
    writeFileSync(inPath, data);
    execFileSync(bin, ['disassemble-set-data-table', '--bb', inPath, outPath], { stdio: 'ignore' });
    const lines = readFileSync(outPath, 'utf8').trim().split('\n').slice(1);
    rmSync(tmp, { recursive: true, force: true });
    check(lines.length === entries.length, `${name}: newserv lists ${lines.length} entries, parser ${entries.length}`);
    lines.forEach((line, i) => {
      const e = entries[i];
      const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
      const expect = `${hex(e.a)}/${hex(e.v1)}/${hex(e.v2)} => ${e.objects.padStart(28)} ${e.enemies.padStart(28)} ${e.setup.padStart(28)}`;
      check(line === expect, `${name} line ${i}: "${line}" vs "${expect}"`);
    });
  }

  // Every free-play floor of every episode, every variation: geometry, collision and set data exist.
  const solo = name.includes('Off');
  for (const episode of [1, 2, 3]) {
    const areas = floorToArea(episode);
    for (let floor = 0; floor < 0x10; floor++) {
      const area = areas[floor];
      if (area < 0 || !table[area] || area === 0x0f || area === 0x10 || area === 0x11 || area === 0x2e) continue; // lobby, battle and test maps
      const n = freePlayVariations(table, area, solo);
      for (let layout = 0; layout < n.layouts; layout++) {
        for (let entities = 0; entities < n.entities; entities++) {
          const f = floorFiles(table, area, layout, entities, floor, solo ? 'solo' : 'normal')!;
          floorsChecked++;
          const geometry = geometryCandidates(f.setup).find((g) => scene.has(g));
          check(!!geometry, `${name} area ${area} ${layout}/${entities}: no render map for ${f.setup}`);
          if (geometry) check(scene.has(geometry.replace(/n\.rel$/, 'c.rel')), `${name}: no collision for ${geometry}`);
          check(exists(f.objects), `${name} area ${area} ${layout}/${entities}: missing ${f.objects}`);
          // Pioneer 2 and the Lab have no enemies.
          check(exists(f.enemies) || [0, 0x12, 0x2d].includes(area), `${name} area ${area} ${layout}/${entities}: missing ${f.enemies}`);
        }
      }
    }
  }
}

console.log(`${floorsChecked} floor variations resolved`);
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
