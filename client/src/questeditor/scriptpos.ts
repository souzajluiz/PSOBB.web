// Quest editor: positions and radii that the quest SCRIPT carries, for the 3D view.
//
// The .dat holds the entities; the script places other things by registers: the players'
// start points (p_setpos), the trigger circles of at_coords_call / at_coords_talk /
// npc_coords_call / party_coords_call (centre and radius), moved collision circles and
// particles. The register layouts are newserv's own comments in src/QuestScript.cc:
//   at_coords_call (0x8C), at_coords_talk (0x8D), npc_coords_call (0x8E), party_coords_call (0x8F)
//   and their _ex forms: regs[0-2] = x, y, z (integers), regs[3] = (event) radius, then the label
//   set_player_start_position (0x76, p_setpos): value = client id, regs[0-2] = x, y, z, regs[3] = angle
//   move_coords_object (0xF8E6): regA = object token, regsB[0-2] = x, y, z
//   particle (0xC0): regs[0-2] = x, y, z, regs[3] = effect type, regs[4] = duration
//
// The positions come from the script's disassembly (formats/questasm.ts): straight-line
// constants. A register loaded by leti / letb / letw (or copied by let) since the last label,
// and not overwritten since, is known; an operand register with no known value drops that
// position (the script computes it at run time). Registers are cleared at every label because
// the code can be entered from anywhere. Which floor a trigger belongs to is a run-time fact
// (the script runs on whatever floor the party is on), so the editor shows them on every floor
// (ASSUMED: the 3D view cannot tell which floor a thread runs on).
//
// Pure: text in, list out (tests/questeditor-scriptpos.test.ts).

import { QUEST_OPCODES, type QuestOpcodeDef } from '../formats/questopcodes.ts';

export type ScriptPositionKind = 'call' | 'talk' | 'npc' | 'party' | 'start' | 'object' | 'particle';

export interface ScriptPosition {
  kind: ScriptPositionKind;
  op: string; // canonical opcode name
  x: number;
  y: number;
  z: number;
  radius: number | null; // trigger circles only
  angle: number | null; // start points: the register's value (the angle)
  clientId: number | null; // start points
  label: string; // the disassembly label the instruction sits under ('start', 'label0109' ...)
  line: number; // 0-based line of the disassembly
}

interface PositionOp {
  kind: ScriptPositionKind;
  regsOperand: number; // index of the register-set operand (0, or 1 when a value or register comes first)
  radiusIndex?: number; // register of the set that holds the radius
  angleIndex?: number;
}

const RADIUS_OPS = [
  ['at_coords_call', 'call'], ['at_coords_call_ex', 'call'], ['at_coords_talk', 'talk'], ['at_coords_talk_ex', 'talk'],
  ['npc_coords_call', 'npc'], ['npc_coords_call_ex', 'npc'], ['party_coords_call', 'party'], ['party_coords_call_ex', 'party'],
] as const;

export const POSITION_OPS: ReadonlyMap<string, PositionOp> = new Map<string, PositionOp>([
  ...RADIUS_OPS.map(([name, kind]) => [name, { kind, regsOperand: 0, radiusIndex: 3 }] as [string, PositionOp]),
  ['set_player_start_position', { kind: 'start', regsOperand: 1, angleIndex: 3 }],
  ['move_coords_object', { kind: 'object', regsOperand: 1 }],
  ['particle', { kind: 'particle', regsOperand: 0 }],
]);

const BY_NAME = new Map<string, QuestOpcodeDef>();
for (const def of QUEST_OPCODES) for (const n of def.names) if (!BY_NAME.has(n)) BY_NAME.set(n, def);

const toInt32 = (n: number): number => n | 0;
const LINE_RE = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/;
const LABEL_RE = /^([A-Za-z_][A-Za-z0-9_]*):/;
const REG_RE = /^r(\d+)$/;
const RANGE_RE = /^r(\d+)-r(\d+)$/;

function regsOf(operand: string): number[] | null {
  const single = REG_RE.exec(operand);
  if (single) return [Number(single[1])];
  const range = RANGE_RE.exec(operand);
  if (!range) return null;
  const a = Number(range[1]);
  const b = Number(range[2]);
  if (b < a || b - a > 15) return null;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export function extractScriptPositions(disassembly: string): ScriptPosition[] {
  const out: ScriptPosition[] = [];
  let known = new Map<number, number>();
  let label = 'start';
  disassembly.split('\n').forEach((raw, line) => {
    const lm = LABEL_RE.exec(raw);
    if (lm) {
      label = lm[1];
      known = new Map();
      return;
    }
    const m = LINE_RE.exec(raw);
    if (!m || m[1].startsWith('.')) return;
    const name = m[1];
    const cut = m[2].indexOf('//');
    const body = cut >= 0 ? m[2].slice(0, cut) : m[2];
    const note = cut >= 0 ? m[2].slice(cut + 2) : '';
    // Operands: the written ones, or for stack-argument opcodes the note after "//".
    const operands = body.split(',').map((s) => s.trim()).filter((s) => s.length);
    const noteOperands = note.split(',').map((s) => s.trim()).filter((s) => s.length);

    const posOp = POSITION_OPS.get(name);
    if (posOp) {
      const def = BY_NAME.get(name);
      // set_player_start_position takes its arguments from the arg stack: "// 0x00000000, r60-r63".
      const ops = operands.length ? operands : noteOperands;
      const set = regsOf(ops[posOp.regsOperand] ?? '');
      if (set && set.length >= 3) {
        const v = set.map((r) => known.get(r));
        if (v[0] !== undefined && v[1] !== undefined && v[2] !== undefined) {
          const radius = posOp.radiusIndex !== undefined ? v[posOp.radiusIndex] ?? null : null;
          const angle = posOp.angleIndex !== undefined ? v[posOp.angleIndex] ?? null : null;
          const clientId = posOp.kind === 'start' ? parseHex(ops[0]) : null;
          out.push({ kind: posOp.kind, op: def?.name ?? name, x: v[0], y: v[1], z: v[2], radius, angle, clientId, label, line });
        }
      }
    }

    // Register tracking after the instruction (the operands were read before it ran).
    if (name === 'leti' || name === 'letb' || name === 'letw') {
      const r = REG_RE.exec(operands[0] ?? '');
      const value = parseHex(operands[1]);
      if (r) {
        if (value === null) known.delete(Number(r[1]));
        else known.set(Number(r[1]), name === 'leti' ? toInt32(value) : value);
      }
      return;
    }
    if (name === 'let') {
      const a = REG_RE.exec(operands[0] ?? '');
      const b = REG_RE.exec(operands[1] ?? '');
      if (a) {
        const v = b ? known.get(Number(b[1])) : undefined;
        if (v === undefined) known.delete(Number(a[1]));
        else known.set(Number(a[1]), v);
      }
      return;
    }
    if (name === 'call' || name === 'va_call') {
      known = new Map(); // the callee may write any register
      return;
    }
    const def = BY_NAME.get(name);
    if (def && operands.length) {
      def.args.forEach((arg, i) => {
        if (arg.t !== 'W_REG' && arg.t !== 'W_REG_SET_FIXED' && arg.t !== 'W_REG32' && arg.t !== 'W_REG32_SET_FIXED') return;
        for (const r of regsOf(operands[i] ?? '') ?? []) known.delete(r);
      });
    }
  });
  return out;
}

function parseHex(s: string | undefined): number | null {
  if (s === undefined) return null;
  const m = /^(-)?0x([0-9a-fA-F]{1,8})$/.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[2], 16);
  return m[1] ? -n : n;
}
