// Generates client/src/formats/entitynames.ts from newserv's entity tables
// (src/Map.cc dat_object_definitions / dat_enemy_definitions and
// src/EnemyType.cc type_defs). newserv is MIT licensed; the generated file
// keeps the attribution.
//
// Run: node tools/gen-entity-names.ts [path/to/newserv]
// (default: $NEWSERV or ../vendor/newserv relative to the repo root)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const newserv = process.argv[2] ?? process.env.NEWSERV ?? join(repo, 'vendor/newserv');
const mapCc = readFileSync(join(newserv, 'src/Map.cc'), 'utf8');
const enemyTypeCc = readFileSync(join(newserv, 'src/EnemyType.cc'), 'utf8');

// Evaluate the `static constexpr uint{16,64}_t NAME = expr;` constants with BigInt.
const consts = new Map<string, bigint>();
const evalExpr = (expr: string): bigint => {
  const js = expr
    .replace(/\/\/.*$/, '')
    .replace(/\b(0x[0-9A-Fa-f]+|\d+)(ULL|ull|U|u)?\b/g, (_, n: string) => `${n}n`)
    .replace(/\b([A-Z][A-Z0-9_]*)\b/g, (_, name: string) => {
      const v = consts.get(name);
      if (v === undefined) throw new Error(`unknown constant ${name} in "${expr}"`);
      return `${v}n`;
    });
  const v = new Function(`return (${js});`)() as bigint;
  return BigInt.asUintN(64, v);
};
for (const m of mapCc.matchAll(/static constexpr uint(?:16|64)_t (\w+) = ([^;]+);/g)) consts.set(m[1], evalExpr(m[2]));

const BB = consts.get('F_V4')!; // bit 13 = Version::BB_V4
const tableBody = (name: string): string => {
  const start = mapCc.indexOf(`static const std::vector<DATEntityDefinition> ${name}{`);
  if (start < 0) throw new Error(`table ${name} not found`);
  return mapCc.slice(start, mapCc.indexOf('\n};', start));
};
const parseTable = (name: string): Array<[number, number, string]> => {
  const out: Array<[number, number, string]> = [];
  for (const m of tableBody(name).matchAll(/^\s*\{(0x[0-9A-F]{4}), ([^,]+), (.+), "([^"]+)"\},/gm)) {
    const versions = evalExpr(m[2]);
    if (!(versions & BB)) continue;
    out.push([Number(m[1]), Number(evalExpr(m[3])), m[4]]);
  }
  return out;
};

const objects = parseTable('dat_object_definitions');
const enemies = parseTable('dat_enemy_definitions');

// Parameter names: newserv documents each entity's params in the comment block
// above its first table entry ("//   param4 = switch flag number"). The label is
// the description cut at the first parenthesis, colon, semicolon or period.
// Params without a description stay null (the client shows "Param n").
const paramNames = (name: string): Array<[string, Array<string | null>]> => {
  const out = new Map<string, Array<string | null>>();
  let block = new Map<number, string>();
  let last = '';
  for (const line of tableBody(name).split('\n')) {
    const c = /^\s*\/\/ {3}param(\d)\s*=\s*(.*)$/.exec(line);
    if (c) {
      if (last !== 'param' && last !== 'comment') block = new Map();
      block.set(Number(c[1]), c[2]);
      last = 'param';
      continue;
    }
    const e = /^\s*\{(0x[0-9A-F]{4}), ([^,]+), (.+), "([^"]+)"\},/.exec(line);
    if (e) {
      if (block.size && !out.has(e[4])) {
        const labels: Array<string | null> = Array.from({ length: 7 }, () => null);
        for (const [i, text] of block) {
          const cut = text.split(/[(:;.]/)[0].replace(/\s+$/, '').trim();
          // Long descriptions do not fit a field caption: they stay "Param n".
          if (cut && cut.length <= 50 && !/TODO/.test(cut) && i >= 1 && i <= 7) labels[i - 1] = cut.charAt(0).toUpperCase() + cut.slice(1);
        }
        out.set(e[4], labels);
      }
      block = new Map();
      last = 'entry';
      continue;
    }
    last = /^\s*\/\//.test(line) ? 'comment' : '';
  }
  return [...out];
};
const objectParamNames = paramNames('dat_object_definitions');
const enemyParamNames = paramNames('dat_enemy_definitions');
const enemyNames: Array<[string, string, string | null]> = [];
for (const m of enemyTypeCc.matchAll(/\{EnemyType::(\w+),.*"(\w+)",\s*"([^"]*)",\s*(nullptr|"[^"]*")\}/g)) {
  enemyNames.push([m[2], m[3], m[4] === 'nullptr' ? null : m[4].slice(1, -1)]);
}

// type_defs columns: rt_index and the BattleParamEntry indexes (stats, attack,
// resist) of each enemy type. NONE (0xFF) means no drop table.
const enemyParams: Array<[string, number, number[], number[], number[]]> = [];
const idxList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x));
for (const m of enemyTypeCc.matchAll(
  /\{EnemyType::(\w+),\s*[^,]*,\s*(NONE|0x[0-9A-F]+),\s*(?:NONE|0x[0-9A-F]+),\s*\{([^}]*)\},\s*\{([^}]*)\},\s*\{([^}]*)\},/g,
)) {
  enemyParams.push([m[1], m[2] === 'NONE' ? 0xff : Number(m[2]), idxList(m[3]), idxList(m[4]), idxList(m[5])]);
}

const fmtNames = (rows: Array<[string, Array<string | null>]>) =>
  rows
    .map(([n, ps]) => {
      const last = ps.reduce((k, p, i) => (p ? i + 1 : k), 0);
      return `  ${JSON.stringify(n)}: [${ps.slice(0, last).map((p) => (p ? JSON.stringify(p) : 'null')).join(', ')}],`;
    })
    .join('\n');

const fmt = (rows: Array<[number, number, string]>) =>
  rows.map(([t, a, n]) => `  [0x${t.toString(16).padStart(4, '0')}, 0x${a.toString(16)}, ${JSON.stringify(n)}],`).join('\n');

const out = `// GENERATED by tools/gen-entity-names.ts. Do not edit by hand.
// Source: newserv (https://github.com/fuzziqersoftware/newserv, MIT license),
// src/Map.cc (dat_object_definitions, dat_enemy_definitions; BB entries only)
// and src/EnemyType.cc (type_defs). Copyright (c) Martin Michelsen.
//
// Rows are [base_type, area_mask, client class name]. Bit N of area_mask is
// newserv's area number N (0 = Pioneer 2 Ep1, 1 = Forest 1, ... 0x2E = Ep4 test).

export const OBJECT_DEFINITIONS: ReadonlyArray<readonly [number, number, string]> = [
${fmt(objects)}
];

export const ENEMY_DEFINITIONS: ReadonlyArray<readonly [number, number, string]> = [
${fmt(enemies)}
];

// Parameter labels by client class name (newserv's comments in Map.cc): entry i
// is param(i+1); null = not documented. Trailing nulls are left out. An entity
// without a row has no documented parameters.
export const OBJECT_PARAM_NAMES: Readonly<Record<string, ReadonlyArray<string | null>>> = {
${fmtNames(objectParamNames)}
};

export const ENEMY_PARAM_NAMES: Readonly<Record<string, ReadonlyArray<string | null>>> = {
${fmtNames(enemyParamNames)}
};

// newserv EnemyType enum name -> [in-game name, Ultimate name or null]
export const ENEMY_TYPE_NAMES: Readonly<Record<string, readonly [string, string | null]>> = {
${enemyNames.map(([e, n, u]) => `  ${e}: [${JSON.stringify(n)}, ${JSON.stringify(u)}],`).join('\n')}
};

// newserv EnemyType enum name -> drop table index (rt_index, 0xFF = none) and
// BattleParamEntry indexes (type_defs BP-STATS, BP-ATTACK, BP-RESIST columns).
export const ENEMY_TYPE_PARAMS: Readonly<Record<string, { rt: number; stats: readonly number[]; attack: readonly number[]; resist: readonly number[] }>> = {
${enemyParams.map(([e, rt, st, at, rs]) => `  ${e}: { rt: 0x${rt.toString(16)}, stats: [${st.join(', ')}], attack: [${at.join(', ')}], resist: [${rs.join(', ')}] },`).join('\n')}
};
`;
const target = join(repo, 'client/src/formats/entitynames.ts');
writeFileSync(target, out);
console.log(`wrote ${target}: ${objects.length} object rows, ${enemies.length} enemy rows, ${enemyNames.length} enemy types, ${objectParamNames.length} object and ${enemyParamNames.length} enemy param rows`);
