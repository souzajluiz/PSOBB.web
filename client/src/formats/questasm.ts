// Quest script assembler / disassembler: .bin <-> text, so an editor can edit
// the script as source. The syntax follows newserv's `disassemble-quest-script
// --reassembly` output (src/QuestScript.cc, MIT license) where it is sensible
// and is documented in docs/QUESTFILES.md. Only Blue Burst (.version BB_V4).
//
//   .version BB_V4
//   .quest_num 101
//   .name "Mop-up Operation #1"
//   ...
//
//   start:                              label 0 (also label0000)
//     set_episode                     0x00000000
//     arg_pushl                       0x00000000
//     arg_pushw                       0x0096
//     set_floor_handler               // 0x00000000, label0096     (BB: from the arg stack)
//     leti                            r60, 0x000000ED
//   label0096:
//     thread_stg                      label02BC
//     switch_jmp                      r0, [label00C8, label00C9]
//     window_msg                      // "..."
//
// Every label is a numbered label (labelXXXX, hex) or a name (`my_loop:`),
// which the assembler numbers itself. Labels whose bytes are not code are
// emitted as `.data` hex, unless a code reference types them (the opcode's
// argument data type, questopcodes.ts): a string (`.cstr "..."`) or a structure
// (`.struct KIND` with one `.field name value` line per field, or `.vector x y z t`
// lines for VECTOR4F_LIST; questdata.ts). A typed form is used only when it
// re-encodes to the same bytes. An IMAGE_DATA label (a PRS-compressed image)
// is `.struct IMAGE_DATA` followed by `.data` hex lines of the decompressed
// image; the assembler compresses them with prsCompressOptimal, which is
// used only when it reproduces the label's bytes. Text after `//` is a comment.

import { decodeInstruction, questCodeEnd, type QuestBin, type QuestFloorAssignment, type QuestInstruction, type QuestInstructionArg } from './questbin.ts';
import { prsDecompress } from './prs.ts';
import { prsCompressOptimal } from './prscompress.ts';
import { decodeCString, decodeTypedData, encodeTypedData, typedLayout, TYPED_DATA_KINDS, type FieldValue, type TypedDataKind, type TypedRecord } from './questdata.ts';
import { F_ARGS, F_CLEAR_ARGS, F_PUSH_ARG, questOpcodeByName, type QuestArg, type QuestArgDataType, type QuestOpcodeDef } from './questopcodes.ts';
import { buildQuestBin } from './questwrite.ts';

// ---------------------------------------------------------------------------
// Shared helpers

const hex = (v: number, width: number): string => v.toString(16).toUpperCase().padStart(width, '0');
const labelName = (index: number): string => `label${hex(index, 4)}`;
const REG_PUSH_DEFS = { arg_pushr: 'reg', arg_pusha: 'addr' } as const;

function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c) out += '\\\\';
    else if (c === 0x22) out += '\\"';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c === 0x09) out += '\\t';
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      out += s[i] + s[i + 1];
      i++;
    } else if (c < 0x20 || (c >= 0x7f && c < 0xa0) || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff || c === 0x2028 || c === 0x2029) out += `\\u${hex(c, 4)}`;
    else out += s[i];
  }
  return out + '"';
}

function fmtFloat(bits: number): string {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  u[0] = bits;
  const v = f[0];
  if (Number.isFinite(v)) {
    for (let p = 1; p <= 9; p++) {
      const s = v.toPrecision(p);
      f[0] = Number(s);
      if (u[0] === bits) return s;
    }
  }
  return `0x${hex(bits, 8)}`;
}

function regRange(first: number, n: number): string {
  return n > 1 ? `r${first}-r${first + n - 1}` : `r${first}`;
}

function formatArg(a: QuestInstructionArg): string {
  const t = a.arg.t;
  switch (t) {
    case 'I8':
      return `0x${hex(a.value, 2)}`;
    case 'I16':
      return `0x${hex(a.value, 4)}`;
    case 'I32':
      return `0x${hex(a.value, 8)}`;
    case 'FLOAT32':
      return fmtFloat(a.value);
    case 'R_REG':
    case 'W_REG':
    case 'R_REG32':
    case 'W_REG32':
      return `r${a.value}`;
    case 'R_REG_SET_FIXED':
    case 'W_REG_SET_FIXED':
    case 'R_REG32_SET_FIXED':
    case 'W_REG32_SET_FIXED':
      return regRange(a.value, a.arg.n ?? 1);
    case 'R_REG_SET':
      return `[${(a.text ?? '').split(',').filter((s) => s.length).map((s) => `r${s}`).join(', ')}]`;
    case 'LABEL16':
    case 'LABEL32':
      return labelName(a.value);
    case 'LABEL16_SET':
      return `[${(a.text ?? '').split(',').filter((s) => s.length).map((s) => labelName(Number(s))).join(', ')}]`;
    case 'CSTRING':
      return quote(a.text ?? '');
    default:
      throw new Error(`unhandled quest argument type ${t satisfies never}`);
  }
}

// ---------------------------------------------------------------------------
// Arg stack (BB): arg_push* opcodes push, an F_ARGS opcode takes its arguments
// from the top of the stack.

interface PushEntry {
  kind: 'imm' | 'reg' | 'addr' | 'label' | 'str';
  value: number;
  text?: string;
}

// Calls `consume(def, entries)` for each F_ARGS instruction with the entries it
// takes from the stack (one per declared argument, oldest first).
function trackArgStack(insns: readonly QuestInstruction[], consume: (insn: QuestInstruction, entries: PushEntry[]) => void): void {
  let stack: PushEntry[] = [];
  for (const insn of insns) {
    const def = insn.def;
    if (!def) break;
    if (def.flags & F_PUSH_ARG) {
      const a = insn.args[0];
      const reg = REG_PUSH_DEFS[def.name as keyof typeof REG_PUSH_DEFS];
      if (reg) stack.push({ kind: reg, value: a.value });
      else if (def.name === 'arg_pusho') stack.push({ kind: 'label', value: a.value });
      else if (def.name === 'arg_pushs') stack.push({ kind: 'str', value: 0, text: a.text ?? '' });
      else stack.push({ kind: 'imm', value: a.value });
    } else if (def.flags & F_ARGS) {
      const n = def.args.length;
      consume(insn, stack.slice(Math.max(0, stack.length - n)));
      stack = [];
    } else if (def.flags & F_CLEAR_ARGS) {
      stack = [];
    }
  }
}

function describePush(arg: QuestArg, e: PushEntry): string {
  if (e.kind === 'str') return quote(e.text ?? '');
  if (e.kind === 'reg') return `r${e.value}`;
  if (e.kind === 'addr') return `&r${e.value}`;
  switch (arg.t) {
    case 'LABEL16':
    case 'LABEL32':
      return labelName(e.value);
    case 'I8':
      return `0x${hex(e.value & 0xff, 2)}`;
    case 'I16':
      return `0x${hex(e.value & 0xffff, 4)}`;
    case 'FLOAT32':
      return fmtFloat(e.value >>> 0);
    case 'R_REG':
    case 'W_REG':
    case 'R_REG32':
    case 'W_REG32':
      return `r${e.value}`;
    case 'R_REG_SET_FIXED':
    case 'W_REG_SET_FIXED':
    case 'R_REG32_SET_FIXED':
    case 'W_REG32_SET_FIXED':
      return regRange(e.value, arg.n ?? 1);
    default:
      return `0x${hex(e.value >>> 0, 8)}`;
  }
}

// ---------------------------------------------------------------------------
// Disassembler

interface Section {
  start: number;
  stop: number;
  labels: number[]; // label indexes that point at `start`
  insns: QuestInstruction[];
  tail: number; // where decoding stopped (instructions cover start..tail)
  clean: boolean; // decoding stopped because of a terminator or the section end
  terminated: boolean; // ended with ret / exit / jmp
  kind: 'code' | 'data';
}

const isTerminator = (def: QuestOpcodeDef): boolean => def.name === 'ret' || def.name === 'exit' || def.name === 'jmp';

function decodeSection(data: Uint8Array, start: number, stop: number): Pick<Section, 'insns' | 'tail' | 'clean' | 'terminated'> {
  const insns: QuestInstruction[] = [];
  let at = start;
  let clean = true;
  let terminated = false;
  while (at < stop) {
    let insn: QuestInstruction;
    try {
      insn = decodeInstruction(data, at);
    } catch {
      clean = false;
      break;
    }
    if (!insn.def || at + insn.size > stop) {
      clean = false;
      break;
    }
    insns.push(insn);
    at += insn.size;
    if (isTerminator(insn.def)) {
      terminated = true;
      break;
    }
  }
  return { insns, tail: at, clean, terminated };
}

// Label references of one section: the label, whether it is code, and the data type of the argument.
function sectionRefs(s: Section): { label: number; script: boolean; data: QuestArgDataType | undefined }[] {
  const out: { label: number; script: boolean; data: QuestArgDataType | undefined }[] = [];
  const add = (a: QuestArg, value: number): void => {
    out.push({ label: value, script: a.data === 'SCRIPT', data: a.data });
  };
  for (const insn of s.insns) {
    for (const a of insn.args) {
      if (a.arg.t === 'LABEL16' || a.arg.t === 'LABEL32') add(a.arg, a.value);
      else if (a.arg.t === 'LABEL16_SET') for (const id of (a.text ?? '').split(',').filter((x) => x.length)) add(a.arg, Number(id));
    }
  }
  trackArgStack(s.insns, (insn, entries) => {
    const defArgs = insn.def!.args;
    const offset = defArgs.length - entries.length;
    entries.forEach((e, i) => {
      const a = defArgs[offset + i];
      if ((a.t === 'LABEL16' || a.t === 'LABEL32') && e.kind === 'imm') add(a, e.value);
    });
  });
  return out;
}

function dataLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) {
    lines.push(`  .data ${[...bytes.subarray(i, i + 32)].map((b) => hex(b, 2)).join(' ')}`);
  }
  return lines;
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

// The typed form of a data label, or null when the type does not describe its bytes.
function typedLines(bytes: Uint8Array, type: QuestArgDataType): string[] | null {
  if (type === 'CSTRING') {
    const s = decodeCString(bytes);
    return s === null ? null : [`  .cstr ${quote(s)}`];
  }
  if (type === 'IMAGE_DATA') {
    // The decompressed image, only when the compressor gives back the stream
    // at the start of the label. Bytes after the stream (the label's section
    // runs to the next label) follow an `.extra` line, as newserv prints them.
    let image: Uint8Array;
    try {
      image = prsDecompress(bytes);
    } catch {
      return null;
    }
    const packed = prsCompressOptimal(image);
    if (packed.length > bytes.length || !bytesEqual(packed, bytes.subarray(0, packed.length))) return null;
    const lines = ['  .struct IMAGE_DATA', ...dataLines(image)];
    if (packed.length < bytes.length) lines.push('  .extra', ...dataLines(bytes.subarray(packed.length)));
    return lines;
  }
  if (!(TYPED_DATA_KINDS as readonly string[]).includes(type)) return null;
  const kind = type as TypedDataKind;
  const records = decodeTypedData(kind, bytes);
  if (!records) return null;
  try {
    if (!bytesEqual(encodeTypedData(kind, records), bytes)) return null;
  } catch {
    return null;
  }
  const lines = [`  .struct ${kind}`];
  for (const rec of records) {
    if (kind === 'VECTOR4F_LIST') {
      lines.push(`  .vector ${rec.map(([, v]) => fmtFieldValue(v)).join(' ')}`);
    } else {
      for (const [name, v] of rec) lines.push(`  .field ${name} ${fmtFieldValue(v)}`);
    }
  }
  return lines;
}

function fmtFieldValue(v: FieldValue): string {
  if ('int' in v) return String(v.int);
  if ('float' in v) return fmtFloat(v.float);
  if ('bytes' in v) return [...v.bytes].map((b) => hex(b, 2)).join('');
  return quote(v.text);
}

// The `.struct` block's records from its `.field` / `.vector` lines (assembler side).
function parseStructItems(kind: TypedDataKind, items: readonly ParsedLine[]): TypedRecord[] {
  const lineErr = (no: number, msg: string): never => {
    throw new QuestAssemblyError(no, msg);
  };
  if (kind === 'VECTOR4F_LIST') {
    return items.map((it) => {
      if (it.head !== '.vector') lineErr(it.no, `${kind} takes .vector lines, got ${it.head}`);
      const toks = it.rest.trim().split(/\s+/).filter((t) => t.length);
      if (toks.length !== 4) lineErr(it.no, '.vector takes four floats: x y z t');
      return ['x', 'y', 'z', 't'].map((n, i) => [n, { float: parseFloatBits(toks[i], it.no) }] as [string, FieldValue]);
    });
  }
  const layout = typedLayout(kind);
  const rec: TypedRecord = items.map((it) => {
    if (it.head !== '.field') lineErr(it.no, `${kind} takes .field lines, got ${it.head}`);
    const m = /^(\S+)\s*(.*)$/.exec(it.rest.trim());
    if (!m) lineErr(it.no, '.field takes a name and a value');
    const [, name, value] = m!;
    const def = layout.fields.find((d) => d.name === name);
    if (!def) lineErr(it.no, `${name} is not a field of ${kind}`);
    const d = def!;
    switch (d.t) {
      case 'u8':
        return [name, { int: parseInteger(value, it.no, 0, 0xff, name) }];
      case 'i8':
        return [name, { int: parseInteger(value, it.no, -0x80, 0x7f, name) }];
      case 'u16':
        return [name, { int: parseInteger(value, it.no, 0, 0xffff, name) }];
      case 'i16':
        return [name, { int: parseInteger(value, it.no, -0x8000, 0x7fff, name) }];
      case 'u32':
        return [name, { int: parseInteger(value, it.no, 0, 0xffffffff, name) }];
      case 'i32':
        return [name, { int: parseInteger(value, it.no, -0x80000000, 0x7fffffff, name) }];
      case 'f32':
        return [name, { float: parseFloatBits(value, it.no) }];
      case 'bytes':
        if (!/^([0-9a-fA-F]{2})*$/.test(value)) lineErr(it.no, `${name} takes hex bytes`);
        return [name, { bytes: Uint8Array.from(value.match(/../g) ?? [], (b) => parseInt(b, 16)) }];
      default:
        return [name, { text: unquote(value, it.no) }];
    }
  });
  return [rec];
}

export interface DisassembleOptions {
  // Emit the .name / .quest_num / ... header directives (default true). Without
  // them only labels and code are produced, for editors with a separate header form.
  header?: boolean;
}

const EPISODE_NAMES = ['Episode1', 'Episode2', 'Episode4'];

export function disassembleQuest(bin: QuestBin, opts: DisassembleOptions = {}): string {
  const h = bin.header;
  const data = bin.data;
  const text = h.textOffset;
  const end = questCodeEnd(bin);

  // --- sections: the code between consecutive label offsets
  const byOffset = new Map<number, number[]>();
  bin.labels.forEach((o, i) => {
    if (o < text || o > end) return;
    const l = byOffset.get(o);
    if (l) l.push(i);
    else byOffset.set(o, [i]);
  });
  const cuts = [...byOffset.keys()].sort((a, b) => a - b);
  if (!cuts.length || cuts[0] > text) cuts.unshift(text);
  const sections: Section[] = cuts.map((start, k) => {
    const stop = k + 1 < cuts.length ? cuts[k + 1] : end;
    return { start, stop, labels: byOffset.get(start) ?? [], insns: [], tail: start, clean: true, terminated: false, kind: 'data' };
  });
  for (const s of sections) Object.assign(s, decodeSection(data, s.start, s.stop));
  const sectionAt = new Map<number, number>(sections.map((s, i) => [s.start, i]));

  // --- classify: reachable from label 0, or a clean self-contained function
  // that nothing references as data.
  const reachable = new Set<number>();
  const dataRefs = new Set<number>();
  const refsOf = sections.map(sectionRefs);
  for (const refs of refsOf) {
    for (const r of refs) {
      const si = sectionAt.get(bin.labels[r.label]);
      if (si !== undefined && !r.script) dataRefs.add(si);
    }
  }
  const pending: number[] = [];
  const first = sectionAt.get(bin.labels[0]);
  if (first !== undefined) pending.push(first);
  while (pending.length) {
    const si = pending.pop()!;
    if (reachable.has(si)) continue;
    reachable.add(si);
    const s = sections[si];
    for (const r of refsOf[si]) {
      if (!r.script) continue;
      const t = sectionAt.get(bin.labels[r.label]);
      if (t !== undefined) pending.push(t);
    }
    if (s.clean && !s.terminated && si + 1 < sections.length) pending.push(si + 1); // falls through
  }
  sections.forEach((s, i) => {
    const trailingZero = data.subarray(s.tail, s.stop).every((b) => b === 0);
    if (reachable.has(i) || (s.clean && s.terminated && s.insns.length > 0 && trailingZero && !dataRefs.has(i))) s.kind = 'code';
  });

  // --- typed data labels: a data section that a code section references with
  // a data type (the first type, in reference order, that re-encodes exactly)
  const candidates = new Map<number, QuestArgDataType[]>();
  sections.forEach((s, i) => {
    if (s.kind !== 'code') return;
    for (const r of refsOf[i]) {
      if (!r.data || r.data === 'SCRIPT' || r.data === 'DATA') continue;
      const si = sectionAt.get(bin.labels[r.label]);
      if (si === undefined || sections[si].kind !== 'data') continue;
      const list = candidates.get(si) ?? [];
      if (!list.includes(r.data)) list.push(r.data);
      candidates.set(si, list);
    }
  });
  const typedOf = new Map<number, string[]>();
  for (const [si, types] of candidates) {
    const s = sections[si];
    for (const t of types) {
      const lines = typedLines(data.subarray(s.start, s.stop), t);
      if (lines) {
        typedOf.set(si, lines);
        break;
      }
    }
  }

  // --- header
  const lines: string[] = [];
  const codeInsns: QuestInstruction[] = [];
  for (const s of sections) if (s.kind === 'code') codeInsns.push(...s.insns);
  const derived = derivedFloorAssignments(codeInsns);
  if (opts.header !== false) {
    lines.push('.version BB_V4');
    lines.push(`.quest_num ${h.questNumber === 0xffff ? '0xFFFF' : h.questNumber}`);
    lines.push(`.name ${quote(h.name)}`);
    lines.push(`.short_desc ${quote(h.shortDescription)}`);
    lines.push(`.long_desc ${quote(h.longDescription)}`);
    if (h.episode < EPISODE_NAMES.length) lines.push(`.episode ${EPISODE_NAMES[h.episode]}`);
    lines.push(`.header_episode 0x${hex(h.episode, 2)}`);
    const rawMax = data[0x15];
    lines.push(`.max_players ${(rawMax || 4) === h.maxPlayers ? rawMax : h.maxPlayers}`);
    if (h.joinable) lines.push('.joinable');
    for (const f of h.soloUnlockFlags) lines.push(`.solo_unlock_flag 0x${hex(f, 4)}`);
    if (h.hasFullHeader) {
      let lastMask = -1;
      for (let i = 0; i < 0x40; i++) if (data.subarray(0x42c + i * 0x38, 0x42c + (i + 1) * 0x38).some((b) => b)) lastMask = i;
      for (let i = 0; i <= lastMask; i++) {
        lines.push(`.allow_create_item ${[...data.subarray(0x42c + i * 0x38, 0x42c + (i + 1) * 0x38)].map((b) => hex(b, 2)).join(' ')}`);
      }
    }
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    lines.push(`.header_unknown_a1 0x${hex(dv.getUint16(0x0c, true), 4)}`);
    lines.push(`.header_unknown_a2 0x${hex(dv.getUint16(0x0e, true), 4)}`);
    lines.push(`.header_unknown_a4 0x${hex(data[0x17], 2)}`);
    if (h.hasFullHeader) lines.push(`.header_unknown_a5 0x${hex(dv.getUint32(0x398, true), 8)}`);
    lines.push(`.header_unknown_a6 0x${hex(dv.getUint16(0x12, true), 4)}`);
    if (!sameAssignments(derived, h.floorAssignments)) {
      for (const fa of h.floorAssignments) lines.push(`.floor_assignment ${fa.floor} ${fa.area} ${fa.type} ${fa.layoutVar} ${fa.entitiesVar}`);
      if (!h.floorAssignments.length) lines.push('.no_floor_assignments');
    }
  }

  // --- table entries the sections cannot express
  const placed = new Set<number>();
  for (const s of sections) for (const l of s.labels) placed.add(l);
  const referenced = new Set<number>();
  for (const s of sections) {
    if (s.kind !== 'code') continue;
    for (const insn of s.insns) for (const a of insn.args) {
      if (a.arg.t === 'LABEL16' || a.arg.t === 'LABEL32') referenced.add(a.value);
      else if (a.arg.t === 'LABEL16_SET') for (const id of (a.text ?? '').split(',').filter((x) => x.length)) referenced.add(Number(id));
    }
  }
  let highest = -1;
  for (const i of placed) highest = Math.max(highest, i);
  const extra: string[] = [];
  bin.labels.forEach((o, i) => {
    if (placed.has(i)) return;
    const raw = (o - text) >>> 0;
    if (raw !== 0xffffffff) {
      extra.push(`.raw_label 0x${hex(i, 4)} 0x${hex(raw, 8)}`);
      highest = Math.max(highest, i);
    } else if (referenced.has(i)) {
      extra.push(`.unset_label 0x${hex(i, 4)}`);
      highest = Math.max(highest, i);
    }
  });
  // Labels the code names beyond the end of the table (a bug in the quest, but
  // shipped): the assembler must allow them without growing the table.
  for (const r of [...referenced].sort((a, b) => a - b)) if (r >= bin.labels.length) extra.push(`.undefined_label 0x${hex(r, 4)}`);
  if (bin.labels.length > highest + 1) extra.push(`.label_count 0x${hex(bin.labels.length, 4)}`);
  lines.push(...extra);

  // --- code
  for (const [si, s] of sections.entries()) {
    lines.push('');
    for (const l of s.labels) lines.push(l === 0 ? 'start:' : `${labelName(l)}:`);
    if (s.kind === 'data') {
      lines.push(...(typedOf.get(si) ?? dataLines(data.subarray(s.start, s.stop))));
      continue;
    }
    const notes = new Map<QuestInstruction, string>();
    trackArgStack(s.insns, (insn, entries) => {
      const defArgs = insn.def!.args;
      const offset = defArgs.length - entries.length;
      if (entries.length) notes.set(insn, entries.map((e, i) => describePush(defArgs[offset + i], e)).join(', '));
    });
    for (const insn of s.insns) {
      const name = insn.def!.name;
      const args = insn.args.map(formatArg).join(', ');
      const note = notes.get(insn);
      lines.push(`  ${name.padEnd(32)}${args ? ' ' + args : ''}${note ? ` // ${note}` : ''}`.trimEnd());
    }
    if (s.tail < s.stop) lines.push(...dataLines(data.subarray(s.tail, s.stop)));
  }
  return lines.join('\n') + '\n';
}

function sameAssignments(a: readonly QuestFloorAssignment[], b: readonly QuestFloorAssignment[]): boolean {
  return a.length === b.length && a.every((x, i) => x.floor === b[i].floor && x.area === b[i].area && x.type === b[i].type && x.layoutVar === b[i].layoutVar && x.entitiesVar === b[i].entitiesVar);
}

// newserv builds the header's floor assignments from the bb_map_designate
// instructions of the script, in order.
function derivedFloorAssignments(insns: readonly QuestInstruction[]): QuestFloorAssignment[] {
  const out: QuestFloorAssignment[] = [];
  for (const insn of insns) {
    if (insn.opcode !== 0xf951 || insn.args.length !== 5 || out.length >= 0x10) continue;
    const v = insn.args.map((a) => a.value);
    out.push({ floor: v[0], area: v[1], type: v[2], layoutVar: v[3], entitiesVar: v[4] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembler

export class QuestAssemblyError extends Error {
  line: number; // 1-based, 0 when the error is not tied to a line
  constructor(line: number, message: string) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'QuestAssemblyError';
    this.line = line;
  }
}

// Header fields; each one overrides the matching directive in the text.
export interface AssembleHeaderOptions {
  questNumber?: number;
  episode?: number; // header byte: 0 = Ep1, 1 = Ep2, 2 = Ep4
  maxPlayers?: number;
  joinable?: boolean;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
  soloUnlockFlags?: number[];
  floorAssignments?: QuestFloorAssignment[];
  unknownA1?: number;
  unknownA2?: number;
  unknownA4?: number;
  unknownA5?: number;
  unknownA6?: number;
  createItemMask?: Uint8Array[]; // up to 0x40 entries of 0x38 bytes
}

class Bytes {
  buf = new Uint8Array(1024);
  length = 0;
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const grown = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    grown.set(this.buf);
    this.buf = grown;
  }
  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
  }
  u16(v: number): void {
    this.u8(v);
    this.u8(v >> 8);
  }
  u32(v: number): void {
    this.u16(v);
    this.u16(v >>> 16);
  }
  bytes(b: ArrayLike<number>): void {
    for (let i = 0; i < b.length; i++) this.u8(b[i]);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

// Removes // and /* */ comments outside strings.
function stripComments(line: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < line.length) out += line[++i];
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && line[i + 1] === '/') break;
    else if (c === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close < 0) break;
      i = close + 1;
      out += ' ';
    } else out += c;
  }
  return out.trim();
}

// Splits on top-level commas (outside quotes and brackets).
function splitArgs(s: string, lineNo: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) cur += s[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      cur += c;
    } else if (c === '[') {
      depth++;
      cur += c;
    } else if (c === ']') {
      if (--depth < 0) throw new QuestAssemblyError(lineNo, 'unbalanced ]');
      cur += c;
    } else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (inStr) throw new QuestAssemblyError(lineNo, 'unterminated string');
  if (depth) throw new QuestAssemblyError(lineNo, 'unbalanced [');
  if (cur.trim().length || out.length) out.push(cur.trim());
  return out;
}

function unquote(tok: string, lineNo: number): string {
  if (tok.length < 2 || tok[0] !== '"' || tok[tok.length - 1] !== '"') throw new QuestAssemblyError(lineNo, `expected a quoted string, got ${tok}`);
  let out = '';
  for (let i = 1; i < tok.length - 1; i++) {
    const c = tok[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = tok[++i];
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === '\\' || n === '"' || n === "'") out += n;
    else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(tok.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(tok.slice(i + 1, i + 5), 16));
      i += 4;
    } else if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(tok.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(tok.slice(i + 1, i + 3), 16));
      i += 2;
    } else throw new QuestAssemblyError(lineNo, `unknown escape \\${n ?? ''} in string`);
  }
  return out;
}

function parseInteger(tok: string, lineNo: number, min: number, max: number, what: string): number {
  if (!/^[-+]?(0[xX][0-9a-fA-F]+|\d+)$/.test(tok)) throw new QuestAssemblyError(lineNo, `expected ${what}, got "${tok}"`);
  const neg = tok[0] === '-';
  const body = tok.replace(/^[-+]/, '');
  const v = (neg ? -1 : 1) * Number(body);
  if (v < min || v > max) throw new QuestAssemblyError(lineNo, `${what} ${tok} is out of range (${min}..${max})`);
  return v;
}

function parseFloatBits(tok: string, lineNo: number): number {
  if (/^0[xX][0-9a-fA-F]{1,8}$/.test(tok)) return Number(tok) >>> 0;
  let v: number;
  if (/^[-+]?(nan)$/i.test(tok)) v = NaN;
  else if (/^[-+]?inf(inity)?$/i.test(tok)) v = tok[0] === '-' ? -Infinity : Infinity;
  else if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok)) v = Number(tok);
  else throw new QuestAssemblyError(lineNo, `expected a float, got "${tok}"`);
  const f = new Float32Array([v]);
  return new Uint32Array(f.buffer)[0];
}

const parseReg = (tok: string, lineNo: number, max: number): number => {
  const m = /^r(\d+)$/i.exec(tok);
  if (!m || Number(m[1]) > max) throw new QuestAssemblyError(lineNo, `expected a register r0..r${max}, got "${tok}"`);
  return Number(m[1]);
};

function parseRegRange(tok: string, lineNo: number, n: number, max: number): number {
  const m = /^r(\d+)(?:-r(\d+))?$/i.exec(tok);
  if (!m || Number(m[1]) > max) throw new QuestAssemblyError(lineNo, `expected a register range like r60-r${59 + n}, got "${tok}"`);
  const a = Number(m[1]);
  if (m[2] !== undefined && Number(m[2]) - a + 1 !== n) throw new QuestAssemblyError(lineNo, `${tok} covers ${Number(m[2]) - a + 1} registers, ${n} expected`);
  if (m[2] === undefined && n !== 1) throw new QuestAssemblyError(lineNo, `expected a range of ${n} registers (rA-rB), got ${tok}`);
  return a;
}

function parseList(tok: string, lineNo: number): string[] {
  if (tok[0] !== '[' || tok[tok.length - 1] !== ']') throw new QuestAssemblyError(lineNo, `expected a [list], got "${tok}"`);
  return splitArgs(tok.slice(1, -1), lineNo);
}

interface ParsedLine {
  no: number;
  kind: 'label' | 'directive' | 'insn';
  head: string; // label name / directive / opcode name
  rest: string;
  items?: ParsedLine[]; // a `.struct` line's `.field` / `.vector` lines (`.data` for IMAGE_DATA)
}

export function assembleQuest(text: string, headerOptions: AssembleHeaderOptions = {}): QuestBin {
  // --- pass 1: lines
  const parsed: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const no = idx + 1;
    const line = stripComments(raw);
    if (!line) return;
    const label = /^([A-Za-z_][A-Za-z0-9_]*)(?:@\S+)?\s*:$/.exec(line);
    if (label) {
      parsed.push({ no, kind: 'label', head: label[1], rest: '' });
      return;
    }
    const m = /^(\S+)\s*(.*)$/.exec(line)!;
    parsed.push({ no, kind: m[1][0] === '.' ? 'directive' : 'insn', head: m[1], rest: m[2] });
  });
  // A `.struct` line takes the `.field` / `.vector` lines after it.
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].kind !== 'directive' || parsed[i].head !== '.struct') continue;
    const items: ParsedLine[] = [];
    const isImage = parsed[i].rest.trim() === 'IMAGE_DATA';
    while (
      i + 1 < parsed.length &&
      parsed[i + 1].kind === 'directive' &&
      (parsed[i + 1].head === '.field' || parsed[i + 1].head === '.vector' || (isImage && (parsed[i + 1].head === '.data' || parsed[i + 1].head === '.extra')))
    ) {
      items.push(parsed[i + 1]);
      parsed.splice(i + 1, 1);
    }
    parsed[i].items = items;
  }

  // --- label numbering: labelXXXX is numbered by its name, `start` is 0, any
  // other name gets the lowest unused number.
  const reserved = new Set<number>([0]);
  for (const m of text.matchAll(/\blabel([0-9A-Fa-f]{1,8})\b/g)) reserved.add(parseInt(m[1], 16));
  const named = new Map<string, number>();
  let nextFree = 1;
  const labelIndex = (name: string, lineNo: number): number => {
    const m = /^label([0-9A-Fa-f]{1,8})$/.exec(name);
    if (m) {
      const v = parseInt(m[1], 16);
      if (v > 0xffff) throw new QuestAssemblyError(lineNo, `label number ${name} is above 0xFFFF`);
      return v;
    }
    if (name === 'start') return 0;
    const v = named.get(name);
    if (v === undefined) throw new QuestAssemblyError(lineNo, `unknown label "${name}"`);
    return v;
  };
  for (const l of parsed) {
    if (l.kind !== 'label' || /^label[0-9A-Fa-f]{1,8}$/.test(l.head) || l.head === 'start' || named.has(l.head)) continue;
    while (reserved.has(nextFree)) nextFree++;
    named.set(l.head, nextFree);
    reserved.add(nextFree);
  }

  // --- pass 2: assemble
  const meta = {
    questNumber: 0,
    episode: 0,
    maxPlayers: 4,
    joinable: false,
    name: '',
    shortDescription: '',
    longDescription: '',
    soloUnlockFlags: [] as number[],
    floorAssignments: null as QuestFloorAssignment[] | null,
    unknownA1: 0xffff,
    unknownA2: 0xffff,
    unknownA4: 0,
    unknownA5: 0,
    unknownA6: 0,
    createItemMask: [] as Uint8Array[],
    version: 'BB_V4',
  };
  let episodeFromName: number | null = null;
  let headerEpisode: number | null = null;
  const code = new Bytes();
  const labelOffsets = new Map<number, number | null>(); // index -> raw table value
  const referenced = new Map<number, number>(); // label index -> first line
  let labelCount = 0;
  const allowedUndefined = new Set<number>();
  const designates: QuestFloorAssignment[] = [];
  let explicitFloors: QuestFloorAssignment[] | null = null;

  const useLabel = (name: string, lineNo: number, bits: 16 | 32): number => {
    const v = labelIndex(name, lineNo);
    if (bits === 16 && v > 0xffff) throw new QuestAssemblyError(lineNo, `label ${name} does not fit in 16 bits`);
    if (!referenced.has(v)) referenced.set(v, lineNo);
    return v;
  };

  const encodeArg = (a: QuestArg, tok: string, no: number, w: Bytes): void => {
    switch (a.t) {
      case 'I8':
        w.u8(parseInteger(tok, no, -0x80, 0xff, 'an 8-bit value'));
        break;
      case 'I16':
        w.u16(parseInteger(tok, no, -0x8000, 0xffff, 'a 16-bit value'));
        break;
      case 'I32':
        w.u32(parseInteger(tok, no, -0x80000000, 0xffffffff, 'a 32-bit value'));
        break;
      case 'FLOAT32':
        w.u32(parseFloatBits(tok, no));
        break;
      case 'R_REG':
      case 'W_REG':
        w.u8(parseReg(tok, no, 0xff));
        break;
      case 'R_REG32':
      case 'W_REG32':
        w.u32(parseReg(tok, no, 0xffffffff));
        break;
      case 'R_REG_SET_FIXED':
      case 'W_REG_SET_FIXED':
        w.u8(parseRegRange(tok, no, a.n ?? 1, 0xff));
        break;
      case 'R_REG32_SET_FIXED':
      case 'W_REG32_SET_FIXED':
        w.u32(parseRegRange(tok, no, a.n ?? 1, 0xffffffff));
        break;
      case 'R_REG_SET': {
        const regs = parseList(tok, no).map((r) => parseReg(r, no, 0xff));
        if (regs.length > 0xff) throw new QuestAssemblyError(no, 'a register set holds at most 255 registers');
        w.u8(regs.length);
        w.bytes(regs);
        break;
      }
      case 'LABEL16':
        w.u16(useLabel(tok, no, 16));
        break;
      case 'LABEL32':
        w.u32(useLabel(tok, no, 32));
        break;
      case 'LABEL16_SET': {
        const ids = parseList(tok, no).map((l) => useLabel(l, no, 16));
        if (ids.length > 0xff) throw new QuestAssemblyError(no, 'a label set holds at most 255 labels');
        w.u8(ids.length);
        for (const id of ids) w.u16(id);
        break;
      }
      case 'CSTRING': {
        const s = unquote(tok, no);
        for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i));
        w.u16(0);
        break;
      }
      default:
        throw new QuestAssemblyError(no, `unhandled argument type ${a.t satisfies never}`);
    }
  };

  const emitOpcode = (def: QuestOpcodeDef, w: Bytes): void => {
    if (def.opcode > 0xff) w.u8(def.opcode >> 8);
    w.u8(def.opcode & 0xff);
  };

  // A BB opcode that takes its arguments from the arg stack, written with
  // explicit arguments: push each one, then the opcode.
  const pushOps = {
    I8: 'arg_pushb',
    I16: 'arg_pushw',
    I32: 'arg_pushl',
  } as const;
  const autoPush = (def: QuestOpcodeDef, toks: string[], no: number, w: Bytes): void => {
    const push = (name: string, tok: string): void => {
      const pd = questOpcodeByName(name)!;
      emitOpcode(pd, w);
      encodeArg(pd.args[0], tok, no, w);
    };
    def.args.forEach((a, i) => {
      const tok = toks[i];
      switch (a.t) {
        case 'I8':
        case 'I16':
        case 'I32':
          push(pushOps[a.t], tok);
          break;
        case 'FLOAT32':
          push('arg_pushl', String(parseFloatBits(tok, no)));
          break;
        case 'LABEL16':
          push('arg_pushw', String(useLabel(tok, no, 16)));
          break;
        case 'LABEL32':
          push('arg_pushl', String(useLabel(tok, no, 32)));
          break;
        case 'CSTRING':
          push('arg_pushs', tok);
          break;
        case 'R_REG':
        case 'R_REG32':
          push('arg_pushr', tok);
          break;
        case 'W_REG':
        case 'W_REG32':
          push('arg_pusha', tok);
          break;
        case 'R_REG_SET_FIXED':
        case 'W_REG_SET_FIXED':
        case 'R_REG32_SET_FIXED':
        case 'W_REG32_SET_FIXED': {
          const first = parseRegRange(tok, no, a.n ?? 1, 0xff);
          push('arg_pushb', String(first));
          break;
        }
        default:
          throw new QuestAssemblyError(no, `opcode ${def.name}: argument type ${a.t} cannot be pushed on the arg stack`);
      }
    });
  };

  for (const l of parsed) {
    const no = l.no;
    if (l.kind === 'label') {
      const idx = labelIndex(l.head, no);
      if (labelOffsets.has(idx)) throw new QuestAssemblyError(no, `label ${l.head} (${idx}) is defined twice`);
      labelOffsets.set(idx, code.length);
      continue;
    }
    if (l.kind === 'directive') {
      const d = l.head;
      const rest = l.rest;
      const int = (min: number, max: number, what: string): number => parseInteger(rest.trim(), no, min, max, what);
      switch (d) {
        case '.version':
          if (rest.trim() !== 'BB_V4') throw new QuestAssemblyError(no, `only .version BB_V4 is supported, got ${rest.trim()}`);
          break;
        case '.quest_num':
          meta.questNumber = int(0, 0xffff, 'a quest number');
          break;
        case '.name':
          meta.name = unquote(rest.trim(), no);
          break;
        case '.short_desc':
          meta.shortDescription = unquote(rest.trim(), no);
          break;
        case '.long_desc':
          meta.longDescription = unquote(rest.trim(), no);
          break;
        case '.episode': {
          const i = EPISODE_NAMES.indexOf(rest.trim());
          if (i < 0) throw new QuestAssemblyError(no, `.episode must be one of ${EPISODE_NAMES.join(', ')}`);
          episodeFromName = i;
          break;
        }
        case '.header_episode':
          headerEpisode = int(0, 0xff, 'an episode byte');
          break;
        case '.max_players':
          meta.maxPlayers = int(0, 4, 'a player count');
          break;
        case '.joinable':
          meta.joinable = true;
          break;
        case '.language':
          break;
        case '.solo_unlock_flag':
          if (meta.soloUnlockFlags.length >= 8) throw new QuestAssemblyError(no, 'at most 8 .solo_unlock_flag directives');
          meta.soloUnlockFlags.push(int(0, 0xfffe, 'a flag'));
          break;
        case '.allow_create_item': {
          const hexBytes = rest.replace(/\s+/g, '');
          if (!/^([0-9a-fA-F]{2}){56}$/.test(hexBytes)) throw new QuestAssemblyError(no, '.allow_create_item takes 0x38 bytes of hex');
          if (meta.createItemMask.length >= 0x40) throw new QuestAssemblyError(no, 'at most 64 .allow_create_item directives');
          meta.createItemMask.push(Uint8Array.from(hexBytes.match(/../g)!, (b) => parseInt(b, 16)));
          break;
        }
        case '.header_unknown_a1':
          meta.unknownA1 = int(0, 0xffff, 'a 16-bit value');
          break;
        case '.header_unknown_a2':
          meta.unknownA2 = int(0, 0xffff, 'a 16-bit value');
          break;
        case '.header_unknown_a4':
          meta.unknownA4 = int(0, 0xff, 'a byte');
          break;
        case '.header_unknown_a5':
          meta.unknownA5 = int(0, 0xffffffff, 'a 32-bit value');
          break;
        case '.header_unknown_a6':
          meta.unknownA6 = int(0, 0xffff, 'a 16-bit value');
          break;
        case '.floor_assignment': {
          const v = rest.trim().split(/\s+/).map((t) => parseInteger(t, no, 0, 0xff, 'a byte'));
          if (v.length !== 5) throw new QuestAssemblyError(no, '.floor_assignment takes floor area type layout_var entities_var');
          if ((explicitFloors ??= []).length >= 0x10) throw new QuestAssemblyError(no, 'at most 16 floor assignments');
          explicitFloors.push({ floor: v[0], area: v[1], type: v[2], layoutVar: v[3], entitiesVar: v[4] });
          break;
        }
        case '.no_floor_assignments':
          explicitFloors = [];
          break;
        case '.unset_label': {
          const idx = int(0, 0xffff, 'a label number');
          labelCount = Math.max(labelCount, idx + 1);
          if (!labelOffsets.has(idx)) labelOffsets.set(idx, null);
          break;
        }
        case '.raw_label': {
          const [a, b] = rest.trim().split(/\s+/);
          const idx = parseInteger(a ?? '', no, 0, 0xffff, 'a label number');
          if (labelOffsets.has(idx)) throw new QuestAssemblyError(no, `label ${idx} is defined twice`);
          labelOffsets.set(idx, parseInteger(b ?? '', no, 0, 0xffffffff, 'a raw table value'));
          break;
        }
        case '.undefined_label':
          allowedUndefined.add(int(0, 0xffff, 'a label number'));
          break;
        case '.label_count':
          labelCount = Math.max(labelCount, int(0, 0x10000, 'a count'));
          break;
        case '.data': {
          const hexBytes = rest.replace(/\s+/g, '');
          if (!/^([0-9a-fA-F]{2})*$/.test(hexBytes)) throw new QuestAssemblyError(no, '.data takes hex bytes');
          code.bytes(Uint8Array.from(hexBytes.match(/../g) ?? [], (b) => parseInt(b, 16)));
          break;
        }
        case '.zero': {
          const n = int(0, 0x100000, 'a byte count');
          for (let i = 0; i < n; i++) code.u8(0);
          break;
        }
        case '.cstr': {
          const s = unquote(rest.trim(), no);
          for (let i = 0; i < s.length; i++) code.u16(s.charCodeAt(i));
          code.u16(0);
          break;
        }
        case '.struct': {
          const kind = rest.trim();
          if (kind === 'IMAGE_DATA') {
            // `.data` lines are the decompressed image; the `.extra` line
            // starts the bytes that follow the compressed stream.
            const image: number[] = [];
            const extra: number[] = [];
            let inExtra = false;
            for (const it of l.items ?? []) {
              if (it.head === '.extra') {
                if (inExtra) throw new QuestAssemblyError(it.no, 'a second .extra in .struct IMAGE_DATA');
                inExtra = true;
                continue;
              }
              const hexBytes = it.rest.replace(/\s+/g, '');
              if (!/^([0-9a-fA-F]{2})*$/.test(hexBytes)) throw new QuestAssemblyError(it.no, '.data takes hex bytes');
              for (const b of hexBytes.match(/../g) ?? []) (inExtra ? extra : image).push(parseInt(b, 16));
            }
            code.bytes(prsCompressOptimal(Uint8Array.from(image)));
            code.bytes(Uint8Array.from(extra));
            break;
          }
          if (!(TYPED_DATA_KINDS as readonly string[]).includes(kind)) throw new QuestAssemblyError(no, `unknown .struct kind ${kind}`);
          try {
            code.bytes(encodeTypedData(kind as TypedDataKind, parseStructItems(kind as TypedDataKind, l.items ?? [])));
          } catch (err) {
            if (err instanceof QuestAssemblyError) throw err;
            throw new QuestAssemblyError(no, (err as Error).message);
          }
          break;
        }
        default:
          throw new QuestAssemblyError(no, `unknown directive ${d}`);
      }
      continue;
    }

    // instruction
    const def = questOpcodeByName(l.head);
    if (!def) throw new QuestAssemblyError(no, `unknown opcode "${l.head}"`);
    const toks = l.rest ? splitArgs(l.rest, no) : [];
    if (def.flags & F_ARGS) {
      if (toks.length) {
        if (toks.length !== def.args.length) throw new QuestAssemblyError(no, `${def.name} takes ${def.args.length} argument(s), got ${toks.length}`);
        autoPush(def, toks, no, code);
      }
      emitOpcode(def, code);
      continue;
    }
    if (toks.length !== def.args.length) throw new QuestAssemblyError(no, `${def.name} takes ${def.args.length} argument(s), got ${toks.length}`);
    emitOpcode(def, code);
    def.args.forEach((a, i) => encodeArg(a, toks[i], no, code));
    if (def.opcode === 0xf951) {
      const v = toks.map((t) => parseInteger(t, no, 0, 0xff, 'a byte'));
      if (designates.length < 0x10) designates.push({ floor: v[0], area: v[1], type: v[2], layoutVar: v[3], entitiesVar: v[4] });
    }
  }

  // --- label table
  if (!labelOffsets.has(0)) throw new QuestAssemblyError(0, 'label 0 (start:) is not defined');
  for (const [idx, line] of referenced) {
    if (!labelOffsets.has(idx) && !allowedUndefined.has(idx)) throw new QuestAssemblyError(line, `label ${labelName(idx)} is used but never defined`);
  }
  let count = labelCount;
  for (const idx of labelOffsets.keys()) count = Math.max(count, idx + 1);
  const table: (number | null)[] = new Array(count).fill(null);
  for (const [idx, off] of labelOffsets) table[idx] = off;

  // --- header
  const o = headerOptions;
  const header = {
    questNumber: o.questNumber ?? meta.questNumber,
    episode: o.episode ?? headerEpisode ?? episodeFromName ?? meta.episode,
    maxPlayers: o.maxPlayers ?? meta.maxPlayers,
    joinable: o.joinable ?? meta.joinable,
    name: o.name ?? meta.name,
    shortDescription: o.shortDescription ?? meta.shortDescription,
    longDescription: o.longDescription ?? meta.longDescription,
    soloUnlockFlags: o.soloUnlockFlags ?? meta.soloUnlockFlags,
    floorAssignments: o.floorAssignments ?? explicitFloors ?? designates,
  };
  try {
    return buildQuestBin({
      header,
      unknownA1: o.unknownA1 ?? meta.unknownA1,
      unknownA2: o.unknownA2 ?? meta.unknownA2,
      unknownA4: o.unknownA4 ?? meta.unknownA4,
      unknownA5: o.unknownA5 ?? meta.unknownA5,
      unknownA6: o.unknownA6 ?? meta.unknownA6,
      createItemMask: o.createItemMask ?? meta.createItemMask,
      code: code.result(),
      labelOffsets: table,
    });
  } catch (err) {
    throw new QuestAssemblyError(0, (err as Error).message);
  }
}
