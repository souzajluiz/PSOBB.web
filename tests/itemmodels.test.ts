// Floor item models and the item command helpers.
//   - every ItemPMT item (weapons, armors, shields, units, mags, tools, tech
//     disks; plain, rare and wrapped) and meseta resolves to an item.bml model
//     that exists in the client and builds with all its textures
//     (formats/itemmodels.ts, decompiled from FUN_005c3a94 / FUN_005c407c);
//   - BC0 round trip (6x6D join sync), the item subcommand sizes, and the
//     inventory rules (stacks, meseta, equip slots) of net/items.ts.
// Run: node tests/itemmodels.test.ts
// Env: PSOBB_DATA (client data/ folder), ITEMPMT (optional ItemPMT.prs)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { floorItemLook, ITEM_BML, ITEM_BML_MODELS, type ItemModelTables } from '../client/src/formats/itemmodels.ts';
import { parseItemPMT } from '../client/src/formats/itempmt.ts';
import { ItemNames, itemFromHex, maxStackSize, type ItemData } from '../client/src/formats/itemnames.ts';
import type { NjObject } from '../client/src/formats/xj.ts';
import { bc0Encode } from '../client/src/net/game.ts';
import type { CharacterFile } from '../client/src/net/charfile.ts';
import {
  bc0Decompress,
  boxIgnoresDef,
  buildBoxDropRequest,
  buildDropItem,
  buildEquip,
  buildPickUpRequest,
  buildSplitStack,
  buildUseItem,
  InventoryModel,
  MESETA_ITEM_ID,
  parseBoxOrEnemyDrop,
  parseItemSync,
  writeCharacterInventory,
} from '../client/src/net/items.ts';
import { EnemyArchive } from '../client/src/render/enemymodel.ts';
import { buildObjectTreeWithNodes, MaterialCache } from '../client/src/render/njmesh.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NEWSERV = join(ROOT, 'vendor/newserv');
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    if (failures < 40) console.log(`FAIL ${msg}`);
  }
};

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const read = (n: string) => (existsSync(join(DATA, n)) ? new Uint8Array(readFileSync(join(DATA, n))) : gsl.get(n));

function loadPmt(): { label: string; data: Uint8Array } {
  if (process.env.ITEMPMT) return { label: process.env.ITEMPMT, data: new Uint8Array(readFileSync(process.env.ITEMPMT)) };
  if (existsSync(join(DATA, 'ItemPMT.prs'))) return { label: 'client ItemPMT.prs', data: new Uint8Array(readFileSync(join(DATA, 'ItemPMT.prs'))) };
  if (gsl.has('ItemPMT.prs')) return { label: 'data.gsl:ItemPMT.prs', data: gsl.get('ItemPMT.prs') };
  const out = join(mkdtempSync(join(tmpdir(), 'pmt-')), 'ItemPMT.prs');
  execFileSync(join(NEWSERV, 'build/newserv'), ['encode-item-parameter-table', '--bb', join(NEWSERV, 'system/tables/item-parameter-table-bb-v4.json'), out], { cwd: NEWSERV, stdio: 'ignore' });
  return { label: 'newserv-encoded ItemPMT.prs', data: new Uint8Array(readFileSync(out)) };
}

// --- item.bml: every model resolves and builds -------------------------------
const archive = new EnemyArchive(ITEM_BML, read(ITEM_BML), ITEM_BML_MODELS);
check(archive.bml.entries.length === ITEM_BML_MODELS + 1, `item.bml has ${archive.bml.entries.length} entries (descriptor 0x009c2794: 14 models + 1 motion)`);
const texNames = archive.model(0).textures;
const built = new Map<number, { triangles: number; missing: number }>();
function buildModel(i: number): { triangles: number; missing: number } {
  let b = built.get(i);
  if (b) return b;
  const m = archive.model(i);
  let missing = 0;
  const tree = buildObjectTreeWithNodes(m.object as NjObject, new MaterialCache((id) => {
    const t = texNames[id] !== undefined ? archive.texture(texNames[id]) : null;
    if (!t) missing++;
    return t;
  }));
  let triangles = 0;
  tree.root.traverse((o) => {
    if (o instanceof THREE.Mesh) triangles += (o.geometry.index?.count ?? 0) / 3;
  });
  b = { triangles, missing };
  built.set(i, b);
  return b;
}
for (let i = 2; i <= 12; i++) {
  const b = buildModel(i);
  check(/^ixm_box/.test(archive.model(i).name) && b.triangles > 0 && b.missing === 0, `model ${i} ${archive.model(i).name}: ${b.triangles} triangles, ${b.missing} missing textures`);
}

// --- every ItemPMT item -------------------------------------------------------
const pmt = loadPmt();
const table = parseItemPMT(pmt.data);
const names = new ItemNames(table, null);
const tables: ItemModelTables = { isRare: (it) => names.isRare(it), toolType: (a, b) => table.getTool(a, b)?.type };
const byModel = new Map<string, number>();
let items = 0;
const hex = (b: number[]) => b.map((v) => v.toString(16).padStart(2, '0')).join('');
function resolveItem(code: number[], what: string): void {
  const item = itemFromHex(hex(code).padEnd(40, '0'));
  for (const wrapped of [false, true]) {
    const it: ItemData = { data1: item.data1.slice(), id: item.id, data2: item.data2.slice() };
    const stackable = maxStackSize(it) > 1;
    if (wrapped) {
      if (stackable || it.data1[0] === 4) continue;
      if (it.data1[0] === 0 || it.data1[0] === 1) it.data1[4] |= 0x40;
      else if (it.data1[0] === 2) it.data2[2] |= 0x40;
      else it.data1[3] |= 0x40;
    }
    const look = floorItemLook(it, tables, stackable);
    items++;
    const entry = archive.bml.entries[look.model];
    const ok = look.model >= 2 && look.model <= 12 && !!entry && buildModel(look.model).missing === 0;
    check(ok, `${what}${wrapped ? ' (wrapped)' : ''} ${hex([...it.data1])}: model ${look.model}`);
    if (wrapped) check(look.model === 8, `${what} wrapped draws the gift box`);
    const key = `${entry?.name ?? look.model}${look.kind === 4 ? ' (rare)' : ''}`;
    byModel.set(key, (byModel.get(key) ?? 0) + 1);
  }
}
table.weapons.forEach((list, c1) => list.forEach((w, c2) => w && resolveItem([0, c1, c2], `weapon ${c1}/${c2}`)));
table.armors.forEach((a, c2) => a && resolveItem([1, 1, c2], `armor ${c2}`));
table.shields.forEach((a, c2) => a && resolveItem([1, 2, c2], `shield ${c2}`));
table.units.forEach((a, c2) => a && resolveItem([1, 3, c2], `unit ${c2}`));
table.mags.forEach((a, c1) => a && resolveItem([2, c1], `mag ${c1}`));
table.tools.forEach((list, c1) =>
  list.forEach((t, c2) => {
    if (!t) return;
    if (c1 === 2) resolveItem([3, 2, 0, 0, c2], `disk ${c2}`);
    else resolveItem([3, c1, c2, 0, 0, 1], `tool ${c1}/${c2}`);
  }),
);
resolveItem([4], 'meseta');
check(items > 1500, `${items} item looks resolved`);
console.log(`ItemPMT: ${pmt.label}; ${items} looks: ${[...byModel].map(([k, n]) => `${k} ${n}`).join(', ')}`);
const toolTypes = new Map<number, string[]>();
table.tools.forEach((list, c1) => list.forEach((t, c2) => t?.type && toolTypes.set(t.type, [...(toolTypes.get(t.type) ?? []), `03${c1.toString(16).padStart(2, '0')}${c2.toString(16).padStart(2, '0')}`])));
console.log(`tools with a box type: ${[...toolTypes].map(([t, l]) => `type ${t} -> kind ${t + 4}: ${l.join(' ')}`).join('; ')}`);

// Decompiled rules on hand-made items.
const look = (h: string, stackable = false) => floorItemLook(itemFromHex(h), tables, stackable);
check(look('000100').model === 2, 'Saber -> box01');
check(look('010100').model === 3 && look('010200').model === 3 && look('010300').model === 3 && look('020000').model === 3, 'armor/shield/unit/mag -> box02');
check(look('030000000001', true).model === 4, 'Monomate -> box03');
check(look('04').model === 5, 'meseta -> box04');
check(look('020000').model === 3 && look('022800').model === 6, 'mag 0x28 is rare -> box05');
check(look('00010000400a').model === 8 && look('00010000400a').color === 10, 'wrapped Saber -> gift box, color data1[5] & 0xF');

// --- BC0 and the 6x6D join sync -------------------------------------------
{
  const raw = new Uint8Array(0x8c + 0x24);
  const dv = new DataView(raw.buffer);
  dv.setUint32(0x20 + 1 * 4, 0x00210004, true);
  dv.setUint32(0x50 + 1 * 4, 1, true);
  raw[0x8c] = 1;
  raw[0x8d] = 2;
  dv.setUint16(0x8e, 0x7b, true);
  dv.setFloat32(0x90, 583.74, true);
  dv.setFloat32(0x94, 570.776, true);
  raw.set([4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0x9c);
  dv.setUint32(0x9c + 12, 0x0601017b, true);
  dv.setUint32(0x9c + 16, 8, true);
  check(bc0Decompress(bc0Encode(raw)).every((v, i) => v === raw[i]), 'BC0 round trip');
  const comp = bc0Encode(raw);
  const body = new Uint8Array((0x10 + comp.length + 3) & ~3);
  const bdv = new DataView(body.buffer);
  body[0] = 0x6d;
  bdv.setUint32(4, body.length, true);
  bdv.setUint32(8, raw.length, true);
  bdv.setUint32(12, comp.length, true);
  body.set(comp, 0x10);
  const s = parseItemSync(body);
  check(s?.nextItemIds[1] === 0x00210004 && s.items.length === 1 && s.items[0].id === 0x0601017b && s.items[0].floor === 1, `6x6D parse: ${JSON.stringify(s?.items.map((i) => [i.id.toString(16), i.floor, i.x]))}`);
}

// 6x5F from the capture (GC-ForestGameRareMagFeed: 8 Meseta from box K-077).
{
  const capture = '5F0B0000 01027B00 5CEF1144 AEB10E44 10000000 04000000 00000000 00000000 7B010106 08000000 02000000';
  const body = new Uint8Array(capture.replace(/ /g, '').match(/../g)!.map((h) => parseInt(h, 16)));
  const it = parseBoxOrEnemyDrop(body);
  check(!!it && it.id === 0x0601017b && it.floor === 1 && it.source === 'box' && it.entityIndex === 0x7b && Math.abs(it.x - 583.74) < 0.01, `6x5F parse: ${JSON.stringify(it && { id: it.id.toString(16), x: it.x, z: it.z })}`);
}

// Subcommand sizes (newserv CommandFormats.hh).
check(buildPickUpRequest(1, 0x10001, 2).length === 0x0c && buildPickUpRequest(1, 0, 0)[1] === 3, '6x5A is 0x0C bytes');
check(buildDropItem(1, 2, 3, 0, 0, 0).length === 0x18, '6x2A is 0x18 bytes');
check(buildSplitStack(1, 2, 3, 4, 0, 0).length === 0x18, '6xC3 is 0x18 bytes');
check(buildEquip(1, 2, 0).length === 0x0c && buildUseItem(1, 2).length === 8, '6x25 / 6x27 sizes');
{
  // The capture's 6xA2 for K-078 (TObjContainerBase2 0x88, no params): floor 1, object 0x7C.
  const b = buildBoxDropRequest({ floor: 1, area: 1, objectIndex: 0x7c, type: 0x88, room: 0x10, x: 567.73, z: 574.78, params: [0, 0, 1, 0, 0, 0] });
  check(b.length === 0x28 && b[0] === 0xa2 && b[1] === 0x0a && b[4] === 1 && b[5] === 0x30 && b[6] === 0x7c && b[0x12] === 1 && b[0x14] === 1, '6xA2 layout matches the capture');
  check(!boxIgnoresDef(0x92, 0) && boxIgnoresDef(0x92, 1) && !boxIgnoresDef(0x38d, 2) && boxIgnoresDef(0x88, 0), 'ignore_def rules');
}

// Inventory rules.
{
  const c = {
    inventory: [] as CharacterFile['inventory'],
    meseta: 100,
    stats: { atp: 0, mst: 0, evp: 0, hp: 0, dfp: 0, ata: 0, lck: 0, esp: 0 },
    techLevels: [],
  } as unknown as CharacterFile;
  const inv = new InventoryModel(c);
  const mate = itemFromHex('030000000002');
  mate.id = 0x10000;
  inv.add(mate);
  const mate2 = itemFromHex('030000000003');
  mate2.id = 0x810000;
  inv.add(mate2);
  check(c.inventory.length === 1 && c.inventory[0].data.data1[5] === 5, 'Monomates stack');
  const split = inv.remove(0x10000, 1);
  check(split.data1[5] === 1 && c.inventory[0].data.data1[5] === 4 && c.inventory[0].data.id === 0x10000, 'remove 1 of a stack keeps the stack and its id');
  const m = itemFromHex('04000000000000000000000000000000' + '32000000');
  inv.add(m);
  check(c.meseta === 150, `meseta pickup adds to meseta (${c.meseta})`);
  inv.remove(MESETA_ITEM_ID, 20);
  check(c.meseta === 130, 'meseta drop');
  const armor = itemFromHex('010100');
  armor.id = 0x10001;
  const unit = itemFromHex('010300');
  unit.id = 0x10002;
  inv.add(armor);
  inv.add(unit);
  inv.equip(0x10001, 0);
  inv.equip(0x10002, inv.freeUnitSlot());
  check(c.inventory[1].equipped && c.inventory[2].equipped && c.inventory[2].data.data1[4] === 0, 'armor and a unit (slot 9) equipped');
  inv.unequip(0x10001);
  check(!c.inventory[1].equipped && !c.inventory[2].equipped, 'unequipping the armor unequips its units');
  const raw = new Uint8Array(0x2ea4);
  writeCharacterInventory(c, raw);
  const rdv = new DataView(raw.buffer);
  check(raw[0] === 3 && rdv.getUint32(4 + 8 + 12, true) === 0x10000 && rdv.getUint32(0x34c + 0x20, true) === 130, 'inventory and meseta written back to the E7 layout');
}

console.log(failures ? `${failures} FAILED (${checks} checks)` : `ALL PASS (${checks} checks)`);
process.exit(failures ? 1 : 0);
