// Generates client/src/formats/questopcodes.ts from newserv's quest opcode
// table (src/QuestScript.cc QuestOpcodeIndex::DEFAULT_OPCODE_DEFS, 602
// entries). newserv is MIT licensed; the generated file keeps the attribution.
//
// Only the Blue Burst (F_BB_V4) rows are kept: they are the ones the web
// client can meet. The argument shapes are what the .bin decoder needs to
// walk the bytecode, so an opcode the VM does not implement can still be
// skipped by the right number of bytes and logged by name.
//
// Run: node tools/gen-quest-opcodes.ts [path/to/newserv]
// (default: $NEWSERV or ../vendor/newserv relative to the repo root)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const newserv = process.argv[2] ?? process.env.NEWSERV ?? join(repo, 'vendor/newserv');
const src = readFileSync(join(newserv, 'src/QuestScript.cc'), 'utf8');

// Version bit flags (QuestScript.cc: v_flag(Version) order) and the shortcuts
// the definitions use. Only BB_V4 matters here, so each shortcut is reduced to
// whether it includes BB.
const BB = 'F_BB_V4';
const SHORTCUTS_WITH_BB = new Set(['F_V0_V4', 'F_V05_V4', 'F_V1_V4', 'F_V2_V4', 'F_V3_V4', 'F_V4', BB]);

// Behaviour flags (QuestScript.cc:394..397).
const F_PUSH_ARG = 1;
const F_CLEAR_ARGS = 2;
const F_ARGS = 4;

// Named Arg shortcuts declared above the table (QuestScript.cc:482..491).
const ARG_ALIASES: Record<string, string> = {
  SCRIPT16: '{ t: "LABEL16", data: "SCRIPT" }',
  SCRIPT16_SET: '{ t: "LABEL16_SET", data: "SCRIPT" }',
  SCRIPT32: '{ t: "LABEL32", data: "SCRIPT" }',
  DATA16: '{ t: "LABEL16", data: "DATA" }',
  CSTRING_LABEL16: '{ t: "LABEL16", data: "CSTRING" }',
  CLIENT_ID: '{ t: "I32", name: "client_id" }',
  ITEM_ID: '{ t: "I32", name: "item_id" }',
  FLOOR: '{ t: "I32", name: "floor" }',
};

const ARG_TYPES = new Set([
  'LABEL16', 'LABEL16_SET', 'LABEL32', 'R_REG', 'W_REG', 'R_REG_SET', 'R_REG_SET_FIXED', 'W_REG_SET_FIXED',
  'R_REG32', 'W_REG32', 'R_REG32_SET_FIXED', 'W_REG32_SET_FIXED', 'I8', 'I16', 'I32', 'FLOAT32', 'CSTRING',
]);

// Splits "a, {b, 2}, c" at top level.
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\') cur += s[++i];
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function argExpr(raw: string): string {
  const s = raw.trim();
  if (ARG_ALIASES[s]) return ARG_ALIASES[s];
  if (ARG_TYPES.has(s)) return `{ t: "${s}" }`;
  // {TYPE, count} or {TYPE, count, "name"} or {TYPE, DataType::X, "name"}
  const m = /^\{(.*)\}$/s.exec(s);
  if (!m) throw new Error(`unparsed argument "${raw}"`);
  const parts = splitTop(m[1]);
  const t = parts[0].trim();
  if (!ARG_TYPES.has(t)) throw new Error(`unknown argument type "${t}" in "${raw}"`);
  const fields = [`t: "${t}"`];
  for (const p of parts.slice(1)) {
    const v = p.trim();
    if (/^\d+$/.test(v)) fields.push(`n: ${v}`);
    else if (/^0x[0-9a-fA-F]+$/.test(v)) fields.push(`n: ${parseInt(v, 16)}`);
    else if (v.startsWith('"')) fields.push(`name: ${v}`);
    else if (v.startsWith('Arg::DataType::')) fields.push(`data: "${v.slice('Arg::DataType::'.length)}"`);
    else throw new Error(`unparsed argument field "${v}" in "${raw}"`);
  }
  return `{ ${fields.join(', ')} }`;
}

interface Row {
  opcode: number;
  names: string[];
  args: string[];
  flags: number;
}

const rows: Row[] = [];
let total = 0;
const defRe = /^\s*Def\{(0x[0-9A-Fa-f]+),\s*\{([^}]*)\},\s*\{(.*)\},\s*([^}]*)\},\s*$/;
for (const line of src.split('\n')) {
  if (!/^\s*Def\{/.test(line)) continue;
  total++;
  const m = defRe.exec(line);
  if (!m) throw new Error(`unparsed Def line: ${line}`);
  const [, opStr, namesStr, argsStr, flagsStr] = m;
  const flagTokens = flagsStr.split('|').map((f) => f.trim());
  if (!flagTokens.some((f) => SHORTCUTS_WITH_BB.has(f))) continue; // not a BB opcode
  let flags = 0;
  for (const f of flagTokens) {
    if (f === 'F_PUSH_ARG') flags |= F_PUSH_ARG;
    else if (f === 'F_CLEAR_ARGS') flags |= F_CLEAR_ARGS;
    else if (f === 'F_ARGS') flags |= F_ARGS;
  }
  const names = [...namesStr.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  rows.push({
    opcode: parseInt(opStr, 16),
    names,
    args: splitTop(argsStr).map(argExpr),
    flags,
  });
}

if (total !== 602) throw new Error(`expected 602 Def entries in QuestScript.cc, found ${total}`);
const byOpcode = new Map<number, Row>();
for (const r of rows) {
  if (byOpcode.has(r.opcode)) throw new Error(`two BB definitions for opcode ${r.opcode.toString(16)}`);
  byOpcode.set(r.opcode, r);
}

const hex = (v: number) => `0x${v.toString(16).toUpperCase().padStart(v > 0xff ? 4 : 2, '0')}`;
const lines: string[] = [];
lines.push('// Generated by tools/gen-quest-opcodes.ts — do not edit.');
lines.push('//');
lines.push('// The Blue Burst quest opcodes, from newserv (MIT license)');
lines.push('// src/QuestScript.cc QuestOpcodeIndex::DEFAULT_OPCODE_DEFS: the 602 entries');
lines.push(`// cover every version, ${rows.length} of them apply to BB (F_BB_V4).`);
lines.push('//');
lines.push('// The client dispatches through a 772-entry table of (setup_func, opcode_func)');
lines.push('// pairs at PsoBB.exe .c:559261 (headers/quests.h); the setup_func family reads');
lines.push('// exactly the argument bytes listed here before calling the opcode body.');
lines.push('');
lines.push('export type QuestArgType =');
lines.push(
  [...ARG_TYPES].map((t) => `  | '${t}'`).join('\n'),
);
lines.push(';');
lines.push('');
lines.push("export type QuestArgDataType = 'SCRIPT' | 'DATA' | 'CSTRING' | 'PLAYER_STATS' | 'PLAYER_VISUAL_CONFIG' | 'RESIST_DATA' | 'ATTACK_DATA' | 'MOVEMENT_DATA' | 'IMAGE_DATA' | 'VECTOR4F_LIST';");
lines.push('');
lines.push('export interface QuestArg {');
lines.push('  t: QuestArgType;');
lines.push('  n?: number; // register count for the *_SET_FIXED types');
lines.push('  name?: string;');
lines.push('  data?: QuestArgDataType; // what the referenced label holds');
lines.push('}');
lines.push('');
lines.push('export interface QuestOpcodeDef {');
lines.push('  opcode: number;');
lines.push('  name: string; // canonical (first) name');
lines.push('  names: readonly string[]; // canonical first, Qedit name last');
lines.push('  args: readonly QuestArg[];');
lines.push('  flags: number;');
lines.push('}');
lines.push('');
lines.push('// QuestScript.cc:394..397');
lines.push('export const F_PUSH_ARG = 1; // this opcode pushes its argument on the arg stack');
lines.push('export const F_CLEAR_ARGS = 2; // the arg stack is empty afterwards');
lines.push('export const F_ARGS = 4; // on BB the arguments come from the arg stack, not from the bytecode');
lines.push('');
lines.push('export const QUEST_OPCODES: readonly QuestOpcodeDef[] = [');
for (const r of rows.sort((a, b) => a.opcode - b.opcode)) {
  const names = r.names.map((n) => JSON.stringify(n)).join(', ');
  lines.push(
    `  { opcode: ${hex(r.opcode)}, name: ${JSON.stringify(r.names[0])}, names: [${names}], args: [${r.args.join(', ')}], flags: ${r.flags} },`,
  );
}
lines.push('];');
lines.push('');
lines.push('const BY_OPCODE = new Map<number, QuestOpcodeDef>(QUEST_OPCODES.map((d) => [d.opcode, d]));');
lines.push('const BY_NAME = new Map<string, QuestOpcodeDef>(QUEST_OPCODES.flatMap((d) => d.names.map((n) => [n, d] as const)));');
lines.push('');
lines.push('export const questOpcode = (opcode: number): QuestOpcodeDef | undefined => BY_OPCODE.get(opcode);');
lines.push('export const questOpcodeByName = (name: string): QuestOpcodeDef | undefined => BY_NAME.get(name);');
lines.push('');

const out = join(repo, 'client/src/formats/questopcodes.ts');
writeFileSync(out, lines.join('\n'));
console.log(`wrote ${out}: ${rows.length} BB opcodes of ${total} definitions`);
