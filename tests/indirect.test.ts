// Indirect-object tables (map_*i.bin, formats/indirect.ts), from PsoBB.exe
// and the Ephinea scene files:
//  1. every map_*i.bin parses ("ind0", big-endian count and ids);
//  2. the draw rule of the exe's map loops (row lookup in
//     MapGeometry_InitializeMeshTrees_0080a650, 0x80 / 0x400 branches), pure;
//  3. with the shipped tables every indirect entry the n.rel parser draws keeps
//     its row (nothing hidden), and without them only the 0x80 ones are left.
// Run: node tests/indirect.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyIndirectTable, indirectEntryDrawn, indirectFileFor, indirectRow, parseIndirectBin, type IndirectTable } from '../client/src/formats/indirect.ts';
import { ENTRY_GC_EFFECT, ENTRY_INDIRECT, parseMapNRel } from '../client/src/formats/nrel.ts';

const SCENE = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'scene');
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};

// 1. Every i.bin.
const tables = new Map<string, IndirectTable>();
for (const f of readdirSync(SCENE).filter((f) => /i\.bin$/.test(f))) {
  try {
    const t = parseIndirectBin(new Uint8Array(readFileSync(join(SCENE, f))));
    tables.set(f, t);
    const bad = t.rows.filter((r) => r.stageValue < 0 || r.info >= 0x40);
    if (bad.length) check(false, `${f}: rows outside the exe's tables ${JSON.stringify(bad)}`);
  } catch (e) {
    check(false, `${f}: ${(e as Error).message}`);
  }
}
check(tables.size === 17, `17 i.bin files parsed (${tables.size})`);
{
  const t = tables.get('map_seabed01_00i.bin');
  const rows = t?.rows.map((r) => `${r.id}:${r.stage}/${r.b3}/${r.info}`).join(' ');
  check(rows === '1:1/1/40 2:1/1/40 4:1/1/43', `seabed01_00 rows ${rows}`);
  const j = tables.get('map_jungle05_00i.bin');
  check(j?.rows.map((r) => `${r.id}:${r.stage}/${r.b3}/${r.info}`).join(' ') === '29:1/0/29 30:1/0/30', 'jungle05_00 rows');
  check(indirectRow(t!, 4)?.info === 43 && indirectRow(t!, 3) === null, 'row lookup by id');
}
check(indirectFileFor('map_jungle07_02n.rel') === 'map_jungle07_02i.bin' && indirectFileFor('map_boss06n.rel') === 'map_boss06i.bin', 'i.bin name from the n.rel');
let threw = false;
try {
  parseIndirectBin(new Uint8Array([0x66, 0x6d, 0x74, 0x32, 0, 0, 0, 1]));
} catch {
  threw = true;
}
check(threw, 'a file without "ind0" is refused');

// 2. The draw rule.
{
  const table: IndirectTable = { rows: [{ id: 5, stage: 1, stageValue: 1, b3: 1, info: 36 }] };
  const e = (flags: number, animated: boolean, id: number | null) => indirectEntryDrawn({ flags, animated, indirectId: id }, table);
  check(e(0x10000, false, null) && e(0x10000, true, null), 'entries without 0x200 are not indirect');
  check(e(0x10224, false, 5) && !e(0x10224, false, 6), 'static 0x200: drawn with a row, not without');
  check(e(0x10284, false, 6), 'static 0x200 | 0x80: drawn without the row test');
  check(!e(0x10605, false, 5), 'static 0x200 | 0x400: only the GameCube hook');
  check(e(0x10204, true, 5) && !e(0x10204, true, 6) && !e(0x10284, true, 6), 'animated 0x200: the row decides, 0x80 or not');
  check(!indirectEntryDrawn({ flags: 0x10224, animated: false, indirectId: 5 }, null), 'no i.bin: nothing indirect but 0x80');
}

// 3. Every map with indirect entries.
let maps = 0, entries = 0, hiddenWith = 0, leftWithout = 0, gcEffect = 0;
for (const f of readdirSync(SCENE).filter((f) => /n\.rel$/.test(f))) {
  const g = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, f))));
  const ind = g.sections.flatMap((s) => s.entries).filter((x) => x.flags & ENTRY_INDIRECT && x.rendered);
  if (!ind.length) continue;
  maps++;
  entries += ind.length;
  const table = tables.get(indirectFileFor(f)) ?? null;
  if (!table) check(false, `${f}: indirect entries but no ${indirectFileFor(f)}`);
  hiddenWith += applyIndirectTable(g, table);
  const g2 = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, f))));
  applyIndirectTable(g2, null);
  const left = g2.sections.flatMap((s) => s.entries).filter((x) => x.flags & ENTRY_INDIRECT && x.rendered);
  leftWithout += left.length;
  gcEffect += left.filter((x) => !x.animated && x.flags & ENTRY_GC_EFFECT).length;
}
console.log(`  ${maps} maps, ${entries} drawn indirect entries; with the tables ${hiddenWith} hidden; without them ${leftWithout} left (${gcEffect} static 0x80)`);
check(maps === 16 && hiddenWith === 0, 'the shipped tables have a row for every drawn indirect entry');
check(leftWithout === gcEffect, 'without a table only static 0x80 entries are drawn');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all passed');
