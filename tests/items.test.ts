// ItemPMT parser and item naming vs newserv's reference tables.
// Run: node web/tests/items.test.ts
//
// ItemPMT source, first found: $ITEMPMT, a loose ItemPMT.prs in the client data
// folder, data.gsl, else the file newserv streams to BB clients, rebuilt with
// `newserv encode-item-parameter-table` from system/tables/item-parameter-table-bb-v4.json.
// Stats are compared field by field with that JSON; names (ItemPMT id -> unitxt
// collection 1) with system/tables/names-v4.json using newserv's bb-v4 unitxt_e.prs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { ITEM_STARS_FIRST_ID, parseItemPMT, SPECIAL_STARS_BEGIN_INDEX, type ItemPMT } from '../client/src/formats/itempmt.ts';
import { ItemNames, itemFromHex, primaryIdentifier } from '../client/src/formats/itemnames.ts';
import { parseUnitxt } from '../client/src/classic/charcreate_text.ts';
import { CLASS_NAMES } from '../client/src/net/bbsession.ts';
import { parseNewservJson } from './lib/newservjson.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NEWSERV = join(ROOT, 'vendor/newserv');
const TABLES = join(NEWSERV, 'system/tables');
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');

let failures = 0;
let checks = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const eq = (what: string, got: unknown, want: unknown) => {
  checks++;
  const same = typeof want === 'number' && typeof got === 'number' ? Math.fround(got) === Math.fround(want) : got === want;
  if (!same) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

function loadPmt(): { label: string; data: Uint8Array } {
  if (process.env.ITEMPMT) return { label: process.env.ITEMPMT, data: new Uint8Array(readFileSync(process.env.ITEMPMT)) };
  if (existsSync(join(DATA, 'ItemPMT.prs'))) return { label: 'client ItemPMT.prs', data: new Uint8Array(readFileSync(join(DATA, 'ItemPMT.prs'))) };
  if (existsSync(join(DATA, 'data.gsl'))) {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
    if (gsl.has('ItemPMT.prs')) return { label: 'data.gsl:ItemPMT.prs', data: gsl.get('ItemPMT.prs') };
  }
  const out = join(mkdtempSync(join(tmpdir(), 'pmt-')), 'ItemPMT.prs');
  execFileSync(join(NEWSERV, 'build/newserv'), ['encode-item-parameter-table', '--bb', join(TABLES, 'item-parameter-table-bb-v4.json'), out], {
    cwd: NEWSERV,
    stdio: 'ignore',
  });
  return { label: 'newserv-encoded ItemPMT.prs (as streamed to BB clients)', data: new Uint8Array(readFileSync(out)) };
}

// "ATARequired" -> "ataRequired", "ID" -> "id", "OnLowHP" -> "onLowHP"
const fieldName = (k: string) => {
  const m = /^([A-Z]+)(?=[A-Z][a-z]|[0-9]|$)/.exec(k);
  return m && m[1].length > 1 ? m[1].toLowerCase() + k.slice(m[1].length) : k[0].toLowerCase() + k.slice(1);
};

function compareEntry(code: string, ours: Record<string, unknown> | undefined, ref: Record<string, number>, pmt: ItemPMT): void {
  if (!ours) return fail(`${code}: missing from parsed table`);
  for (const [k, want] of Object.entries(ref)) {
    let got: unknown;
    if (k === 'WeaponKind') got = pmt.weaponKinds[parseInt(code.slice(2, 4), 16)];
    else if (k === 'SaleDivisor') got = pmt.weaponSaleDivisors[parseInt(code.slice(2, 4), 16)] ?? null; // null: class past the table
    else if (k === 'UnknownA1') got = (ours.unknownA1 as number[]).reduce((v, b) => (v << 8) | b, 0);
    else if (k === 'StatAmount') got = ours.amount;
    else got = ours[fieldName(k)];
    eq(`${code}.${k}`, got, want);
  }
}

const { label, data } = loadPmt();
console.log(`ItemPMT: ${label}`);
const pmt = parseItemPMT(data);
const ref = parseNewservJson(readFileSync(join(TABLES, 'item-parameter-table-bb-v4.json'), 'utf8')) as Record<string, any>;

// Items
const seen = new Set<string>();
for (const [code, entry] of Object.entries(ref.Items as Record<string, Record<string, number>>)) {
  seen.add(code);
  const b = (i: number) => parseInt(code.slice(i * 2, i * 2 + 2), 16);
  let ours: unknown;
  if (b(0) === 0) ours = pmt.getWeapon(b(1), b(2));
  else if (b(0) === 1) ours = [undefined, pmt.armors, pmt.shields, pmt.units][b(1)]?.[b(2)];
  else if (b(0) === 2) ours = pmt.mags[b(1)];
  else if (b(0) === 3) ours = pmt.getTool(b(1), b(2));
  compareEntry(code, ours as Record<string, unknown>, entry, pmt);
}
const hex = (...v: number[]) => v.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');
let ourCount = 0;
pmt.weapons.forEach((c, i) => c.forEach((_, j) => (ourCount++, seen.has(hex(0, i, j)) || fail(`extra weapon ${hex(0, i, j)}`))));
[pmt.armors, pmt.shields, pmt.units].forEach((t, k) => t.forEach((_, j) => (ourCount++, seen.has(hex(1, k + 1, j)) || fail(`extra ${hex(1, k + 1, j)}`))));
pmt.mags.forEach((_, j) => (ourCount++, seen.has(hex(2, j)) || fail(`extra mag ${hex(2, j)}`)));
pmt.tools.forEach((c, i) => c.forEach((_, j) => (ourCount++, seen.has(hex(3, i, j)) || fail(`extra tool ${hex(3, i, j)}`))));
eq('item count', ourCount, seen.size);

// Other tables
eq('special count', pmt.specials.length, ref.Specials.length);
ref.Specials.forEach((s: any, i: number) => (eq(`special ${i} type`, pmt.specials[i]?.type, s.Type), eq(`special ${i} amount`, pmt.specials[i]?.amount, s.Amount)));
eq('stat boost count', pmt.statBoosts.length, ref.StatBoosts.length);
ref.StatBoosts.forEach((s: any, i: number) => {
  const o = pmt.statBoosts[i];
  eq(`statboost ${i}`, `${o?.stat1},${o?.amount1},${o?.stat2},${o?.amount2}`, `${s.Stat1},${s.Amount1},${s.Stat2},${s.Amount2}`);
});
eq('star value base', ITEM_STARS_FIRST_ID, ref.StarValueBaseIndex);
eq('special stars base', SPECIAL_STARS_BEGIN_INDEX, ref.SpecialStarsBaseIndex);
eq('star values', pmt.starValues.join(','), ref.StarValues.join(','));
for (const [tech, byClass] of Object.entries(ref.MaxTechLevels as Record<string, Record<string, number>>)) {
  const t = ['Foie', 'Gifoie', 'Rafoie', 'Barta', 'Gibarta', 'Rabarta', 'Zonde', 'Gizonde', 'Razonde', 'Grants', 'Deband', 'Jellen', 'Zalure', 'Shifta', 'Ryuker', 'Resta', 'Anti', 'Reverser', 'Megid'].indexOf(tech);
  for (const [cls, v] of Object.entries(byClass)) eq(`max tech ${tech} ${cls}`, pmt.maxTechLevels[t]?.[CLASS_NAMES.indexOf(cls)], v);
}
eq('tech boost count', pmt.techBoosts.length, ref.TechBoosts.length);
ref.TechBoosts.forEach((t: any, i: number) =>
  [1, 2, 3].forEach((k) => {
    const e = pmt.techBoosts[i]?.entries[k - 1];
    eq(`techboost ${i}.${k}`, `${e?.techNum},${e?.flags},${Math.fround(e?.amount ?? NaN)}`, `${t[`TechNum${k}`]},${t[`Flags${k}`]},${Math.fround(t[`Amount${k}`])}`);
  }),
);
eq('combination count', pmt.combinations.length, ref.ItemCombinations.length);
ref.ItemCombinations.forEach((c: any, i: number) => {
  const o = pmt.combinations[i];
  eq(`combination ${i}`, [o?.usedItem, o?.equippedItem, o?.resultItem, o?.magLevel, o?.grind, o?.level, o?.charClass].join(','), [c.UsedItem, c.EquippedItem, c.ResultItem, c.MagLevel, c.Grind, c.Level, c.CharClass].join(','));
});
const sortNum = (a: number[]) => [...a].sort((x, y) => x - y).join(',');
eq('unsealable', sortNum(pmt.unsealableItems), sortNum(ref.UnsealableItems));
ref.MagFeedResults.forEach((table: any[], t: number) =>
  table.forEach((r: any, i: number) => {
    const o = pmt.magFeedTables[t]?.[i];
    eq(`mag feed ${t}.${i}`, [o?.def, o?.pow, o?.dex, o?.mind, o?.iq, o?.synchro].join(','), [r.DEF, r.POW, r.DEX, r.MIND, r.IQ, r.Synchro].join(','));
  }),
);
eq('armor sale divisor', pmt.nonWeaponSaleDivisors.armor, ref.ArmorSaleDivisor);
eq('shield sale divisor', pmt.nonWeaponSaleDivisors.shield, ref.ShieldSaleDivisor);
eq('unit sale divisor', pmt.nonWeaponSaleDivisors.unit, ref.UnitSaleDivisor);
eq('mag sale divisor', pmt.nonWeaponSaleDivisors.mag, ref.MagSaleDivisor);
console.log(`${failures ? 'FAIL' : 'PASS'} ItemPMT vs item-parameter-table-bb-v4.json: ${checks} values, ${seen.size} items, ${failures} mismatches`);

// Names
const before = failures;
const text = parseUnitxt(new Uint8Array(readFileSync(join(NEWSERV, 'system/text-sets/bb-v4/unitxt_e.prs'))));
eq('newserv bb-v4 unitxt matches the PMT', ItemNames.textMatches(pmt, text), true);
const names = new ItemNames(pmt, text);
const refNames = parseNewservJson(readFileSync(join(TABLES, 'names-v4.json'), 'utf8')) as Record<string, string>;
const KNOWN_TEXT_DIFFERENCES: Record<string, string> = {
  '010361': 'HP/Ressurection',
  '010362': 'TP/Ressurection',
  '030E06': 'Parasitic cell Type D ',
  '030E23': 'Amplifier of Red ',
};
let named = 0;
for (const [code, want] of Object.entries(refNames)) {
  if (code === '030200') continue; // "<TECH-DISK>": tech disks are named from the technique
  const item = itemFromHex(code);
  named++;
  // names-v4.json was hand-corrected in a few places; the client shows the unitxt text as is.
  const got = names.baseName(item);
  const known = KNOWN_TEXT_DIFFERENCES[code];
  if (known !== undefined) eq(`name ${code} (unitxt text)`, got, known);
  else eq(`name ${code}`, got, want);
}
// Every item code the PMT defines has a name in names-v4.json (newserv's ItemNameIndex skips none)
for (const [code] of Object.entries(ref.Items)) {
  const item = itemFromHex(code.length === 4 ? code + '00' : code);
  const pid = primaryIdentifier(item);
  if ((pid & 0xffff0000) === 0x03020000 || pid === 0) continue;
  const key = (pid >>> 8).toString(16).toUpperCase().padStart(6, '0');
  if (!(key in refNames)) console.log(`info: names-v4.json has no name for ${code} (id ${names.itemId(item)}: ${JSON.stringify(names.baseName(item))})`);
}
console.log(`${failures === before ? 'PASS' : 'FAIL'} names vs names-v4.json: ${named} item codes`);

// Descriptions (newserv describe_item format)
const descBefore = failures;
const cases: Array<[string, string]> = [
  ['000100000000000000000000 00000000 00000000', 'Saber'],
  ['00010503000000000000000000000000', ''],
  ['0001000a0000010a0332000000000000', 'Saber +10 10/0/50/0'],
  ['00020005810000000000000000000000', '???? Draw Sword +5'],
  ['000500000300050500000000', 'Fill Slicer 0/0/0/0/5'],
  ['010100000002050002000000', 'Frame (2 slots) +5DEF +2EVP'],
  ['010300000000010000000000', 'Knight/Power+'],
  ['02000500f401000000000000 00000000 28000009', 'Mag LV5 5/0/0/0 40% 0IQ (orange)'],
  ['030000000004000000000000', 'Monomate x4'],
  ['030204000003000000000000', 'Disk:Foie Lv.5'],
  ['030200001100000000000000', 'Disk:Reverser'],
  ['040000000000000000000000 00000000 e8030000', '1000 Meseta'],
];
for (const [h, want] of cases) {
  if (!want) continue;
  eq(`describe ${h.replace(/ /g, '')}`, names.describe(itemFromHex(h)), want);
}
console.log(`${failures === descBefore ? 'PASS' : 'FAIL'} item descriptions (${cases.filter((c) => c[1]).length} cases)`);

// The user's client text tables are checked for consistency with this PMT (informational).
if (existsSync(join(DATA, 'data.gsl'))) {
  const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
  for (const n of ['unitxt_e.prs', 'unitxt_j.prs']) {
    const buf = existsSync(join(DATA, n)) ? new Uint8Array(readFileSync(join(DATA, n))) : gsl.has(n) ? gsl.get(n) : null;
    if (buf) console.log(`info: client ${n} ${ItemNames.textMatches(pmt, parseUnitxt(buf)) ? 'matches' : 'does not match'} this ItemPMT`);
  }
}

console.log(failures ? `${failures} failures` : 'all passed');
process.exit(failures ? 1 : 0);
