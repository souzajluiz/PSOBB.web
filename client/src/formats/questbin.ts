// Quest script file (<quest>.bin): the Blue Burst header, the label table and
// the bytecode decoder.
//
// The server delivers the .bin PRS-compressed in a 44 + 13 pair (net/quests.ts);
// the client decompresses both files into one buffer in
// decompress_received_quest_files (PsoBB.exe 0x006d0174, headers/quests.h) and
// keeps the .bin image at g_pQuestScriptData.
//
// File layout (newserv src/QuestScript.hh PSOQuestHeaderBB, MIT license;
// newserv src/QuestScript.cc:2966..2977 for how the three offsets are used):
//
//   0000 u32 text_offset         start of the bytecode
//   0004 u32 label_table_offset  start of the u32 label table
//   0008 u32 size                total size of the three sections
//   000C u16 unknown_a1 (0xFFFF)
//   000E u16 unknown_a2 (0xFFFF)
//   0010 u16 quest_number        0xFFFF for challenge quests
//   0012 u16 unknown_a6
//   0014 u8  episode             0 = Ep1, 1 = Ep2, 2 = Ep4
//   0015 u8  max_players         0 means 4
//   0016 u8  joinable
//   0017 u8  unknown_a4
//   0018 utf16 name[0x20]
//   0058 utf16 short_description[0x80]
//   0158 utf16 long_description[0x120]
//   0398 -- end of the header Qedit always writes --
//   0398 u32 unknown_a5
//   039C u16 solo_unlock_flags[8]
//   03AC FloorAssignment floor_assignments[0x10]  (8 bytes each:
//        floor, area, type, layout_var, entities_var, 3 unused; all 0xFF = unused)
//   042C CreateItemMaskEntry create_item_mask_entries[0x40] (0x38 each)
//   122C -- end of the full header --
//
// The extension is only present when text_offset and label_table_offset both
// point past it (newserv src/QuestScript.cc:5103): quests written by Qedit stop
// at 0x398 and put the bytecode there.
//
// The label table holds one u32 per label, and a label's offset in the file is
// text_offset + table[label] (newserv src/QuestScript.cc:5190). Label 0 is the
// quest entry point: quest_start_thread(0) (PsoBB.exe 0x006bc76c).
//
// Bytecode: one opcode byte, except that 0xF8 and 0xF9 introduce a two-byte
// opcode ((first << 8) | second), i.e. the client's three 256-entry opcode
// spaces (headers/quests.h, opcode_function_table[772] at .c:559261). The
// argument bytes that follow are given by formats/questopcodes.ts, with one BB
// rule: an opcode flagged F_ARGS takes no inline arguments at all — its
// arguments were pushed on g_QuestOpcodeArgStack by the preceding arg_push*
// opcodes (0x48..0x4E). Confirmed in the client: opcode_set_floor_handler
// (PsoBB.exe .c:605650) reads g_QuestOpcodeArgStack[0] and [1].

import { F_ARGS, F_PUSH_ARG, questOpcode, type QuestArg, type QuestOpcodeDef } from './questopcodes.ts';

export const QUEST_BIN_HEADER_BASE_SIZE = 0x398;
export const QUEST_BIN_HEADER_FULL_SIZE = 0x122c;
export const QUEST_NUM_FLOORS = 0x12;

export interface QuestFloorAssignment {
  floor: number;
  area: number;
  type: number; // 0 = use the quest's own set data, 1 = offline template, 2 = online template, 3 = nothing
  layoutVar: number;
  entitiesVar: number;
}

export interface QuestBinHeader {
  textOffset: number;
  labelTableOffset: number;
  size: number;
  questNumber: number;
  episode: number; // 0 = Ep1, 1 = Ep2, 2 = Ep4
  maxPlayers: number; // 0 on the wire means 4
  joinable: boolean;
  name: string;
  shortDescription: string;
  longDescription: string;
  // Only when the full 0x122C header is present.
  soloUnlockFlags: number[];
  floorAssignments: QuestFloorAssignment[];
  hasFullHeader: boolean;
}

export interface QuestBin {
  header: QuestBinHeader;
  data: Uint8Array; // the whole file
  labels: number[]; // label index -> absolute file offset
}

const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);

function utf16(d: Uint8Array, offset: number, maxChars: number): string {
  const dv = view(d);
  let s = '';
  for (let i = 0; i < maxChars && offset + i * 2 + 1 < d.length; i++) {
    const c = dv.getUint16(offset + i * 2, true);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function parseQuestBinHeader(data: Uint8Array): QuestBinHeader {
  if (data.length < QUEST_BIN_HEADER_BASE_SIZE) throw new Error(`quest .bin is ${data.length} bytes, shorter than the 0x398 header`);
  const dv = view(data);
  const textOffset = dv.getUint32(0x00, true);
  const labelTableOffset = dv.getUint32(0x04, true);
  const size = dv.getUint32(0x08, true);
  const hasFullHeader = textOffset >= QUEST_BIN_HEADER_FULL_SIZE && labelTableOffset >= QUEST_BIN_HEADER_FULL_SIZE;
  const soloUnlockFlags: number[] = [];
  const floorAssignments: QuestFloorAssignment[] = [];
  if (hasFullHeader && data.length >= QUEST_BIN_HEADER_FULL_SIZE) {
    for (let i = 0; i < 8; i++) {
      const f = dv.getUint16(0x039c + i * 2, true);
      if (f !== 0xffff) soloUnlockFlags.push(f);
    }
    for (let i = 0; i < 0x10; i++) {
      const o = 0x03ac + i * 8;
      const fa = { floor: data[o], area: data[o + 1], type: data[o + 2], layoutVar: data[o + 3], entitiesVar: data[o + 4] };
      if (fa.floor === 0xff && fa.area === 0xff && fa.type === 0xff) continue; // unused slot
      floorAssignments.push(fa);
    }
  }
  return {
    textOffset,
    labelTableOffset,
    size,
    questNumber: dv.getUint16(0x10, true),
    episode: data[0x14],
    maxPlayers: data[0x15] || 4,
    joinable: data[0x16] !== 0,
    name: utf16(data, 0x18, 0x20),
    shortDescription: utf16(data, 0x58, 0x80),
    longDescription: utf16(data, 0x158, 0x120),
    soloUnlockFlags,
    floorAssignments,
    hasFullHeader,
  };
}

// Episode number of the game (1, 2 or 4) from the header byte.
export const questEpisode = (header: QuestBinHeader): number => (header.episode === 1 ? 2 : header.episode === 2 ? 4 : 1);

export function parseQuestBin(data: Uint8Array): QuestBin {
  const header = parseQuestBinHeader(data);
  const { textOffset, labelTableOffset } = header;
  const total = Math.min(header.size || data.length, data.length);
  if (labelTableOffset >= total) throw new Error(`label table at 0x${labelTableOffset.toString(16)} is beyond the end of the file (0x${total.toString(16)})`);
  if (textOffset >= total) throw new Error(`bytecode at 0x${textOffset.toString(16)} is beyond the end of the file (0x${total.toString(16)})`);
  // The two sections can be in either order (newserv src/QuestScript.cc:2972).
  const labelTableEnd = textOffset > labelTableOffset ? textOffset : total;
  const dv = view(data);
  const labels: number[] = [];
  for (let o = labelTableOffset; o + 4 <= labelTableEnd; o += 4) labels.push(textOffset + dv.getUint32(o, true));
  return { header, data, labels };
}

export interface QuestInstructionArg {
  arg: QuestArg;
  value: number; // register index, immediate, label index, or string offset for CSTRING
  float?: number; // FLOAT32 arguments keep their float value here
  text?: string; // CSTRING / LABEL16_SET arguments
}

export interface QuestInstruction {
  offset: number; // of the opcode byte
  size: number; // opcode + inline argument bytes
  opcode: number;
  def: QuestOpcodeDef | null; // null for an opcode BB does not define
  args: QuestInstructionArg[];
}

// Decodes one instruction. `fromArgStack` is true for BB: an F_ARGS opcode then
// reads no inline bytes.
export function decodeInstruction(data: Uint8Array, offset: number, fromArgStack = true): QuestInstruction {
  const dv = view(data);
  let at = offset;
  let opcode = data[at++];
  if ((opcode & 0xfe) === 0xf8) opcode = (opcode << 8) | data[at++];
  const def = questOpcode(opcode) ?? null;
  const args: QuestInstructionArg[] = [];
  if (def && !(fromArgStack && def.flags & F_ARGS)) {
    for (const arg of def.args) {
      switch (arg.t) {
        case 'I8':
        case 'R_REG':
        case 'W_REG':
        case 'R_REG_SET_FIXED':
        case 'W_REG_SET_FIXED':
          args.push({ arg, value: data[at++] });
          break;
        case 'I16':
        case 'LABEL16':
          args.push({ arg, value: dv.getUint16(at, true) });
          at += 2;
          break;
        case 'I32':
        case 'LABEL32':
        case 'R_REG32':
        case 'W_REG32':
        case 'R_REG32_SET_FIXED':
        case 'W_REG32_SET_FIXED':
          args.push({ arg, value: dv.getUint32(at, true) });
          at += 4;
          break;
        case 'FLOAT32':
          args.push({ arg, value: dv.getUint32(at, true), float: dv.getFloat32(at, true) });
          at += 4;
          break;
        case 'R_REG_SET': {
          // One count byte, then that many register numbers.
          const n = data[at++];
          args.push({ arg, value: n, text: [...data.subarray(at, at + n)].join(',') });
          at += n;
          break;
        }
        case 'LABEL16_SET': {
          // u8 count, then that many u16 label indexes (newserv QuestScript.cc
          // reads LABEL16_SET as get_u8 + get_u16l each; e.g. q101's
          // `40 00 02 C800 C900` = switch_jmp r0, [label 0xC8, label 0xC9]).
          const ids: number[] = [];
          const count = dv.getUint8(at);
          at += 1;
          for (let i = 0; i < count; i++) {
            ids.push(dv.getUint16(at, true));
            at += 2;
          }
          args.push({ arg, value: ids.length, text: ids.join(',') });
          break;
        }
        case 'CSTRING': {
          // BB strings in the bytecode are UTF-16, zero-terminated.
          const start = at;
          let s = '';
          for (;;) {
            const c = dv.getUint16(at, true);
            at += 2;
            if (!c) break;
            s += String.fromCharCode(c);
          }
          args.push({ arg, value: start, text: s });
          break;
        }
        default:
          throw new Error(`unhandled quest argument type ${arg.t satisfies never}`);
      }
    }
  }
  return { offset, size: at - offset, opcode, def, args };
}

// Walks one label's code from its offset until a terminator, following nothing.
// `limit` bounds the walk (the end of the bytecode section).
export function decodeFunction(data: Uint8Array, start: number, limit: number): QuestInstruction[] {
  const out: QuestInstruction[] = [];
  let at = start;
  while (at < limit) {
    const insn = decodeInstruction(data, at);
    out.push(insn);
    at += insn.size;
    if (!insn.def) break; // an unknown opcode makes every following byte a guess
    // ret / jmp / exit end a straight-line run.
    if (insn.def.name === 'ret' || insn.def.name === 'exit' || insn.def.name === 'jmp') break;
  }
  return out;
}

// End of the bytecode section.
export function questCodeEnd(bin: QuestBin): number {
  const h = bin.header;
  return h.textOffset > h.labelTableOffset ? Math.min(h.size, bin.data.length) : h.labelTableOffset;
}

// The labels that hold code, found by following control flow from label 0.
// A .bin's label table mixes code labels with data labels (strings, NPC stat
// blocks, camera splines); decoding a data label as code produces nonsense, so
// anything that walks the bytecode must start from the reachable set.
//
// Reachability follows every argument whose data type is SCRIPT (jmp, call,
// switch_jmp/call, thread, set_floor_handler, set_qt_*, ...) — the same
// SCRIPT/DATA annotation newserv's disassembler uses to tell the two apart.
export function questCodeLabels(bin: QuestBin): Set<number> {
  const end = questCodeEnd(bin);
  const bound = labelBounds(bin, end);
  const pending: number[] = [0];
  const seen = new Set<number>();
  while (pending.length) {
    const label = pending.pop()!;
    if (seen.has(label)) continue;
    const start = bin.labels[label];
    if (start === undefined || start < bin.header.textOffset || start >= end) continue;
    seen.add(label);
    for (const insn of walkLabel(bin, start, bound(start))) {
      for (const a of insn.args) {
        if (a.arg.data !== 'SCRIPT') continue;
        if (a.arg.t === 'LABEL16_SET') for (const id of (a.text ?? '').split(',').filter((s) => s.length)) pending.push(Number(id));
        else pending.push(a.value);
      }
    }
  }
  return seen;
}

// Every opcode the reachable code uses, by name, with how often. An opcode BB
// does not define is keyed as ".unknown_<hex>".
export function questOpcodeHistogram(bin: QuestBin): Map<string, number> {
  const counts = new Map<string, number>();
  const end = questCodeEnd(bin);
  const bound = labelBounds(bin, end);
  for (const label of questCodeLabels(bin)) {
    const start = bin.labels[label];
    for (const insn of walkLabel(bin, start, bound(start))) {
      const key = insn.def ? insn.def.name : `.unknown_${insn.opcode.toString(16).toUpperCase()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// Labels partition the bytecode, so a label's body ends at the next label's
// offset at the latest — newserv's disassembler sizes labels the same way
// (src/QuestScript.cc Label::size). Without this bound, a label whose code has
// no terminator walks on through the file's data section.
function labelBounds(bin: QuestBin, end: number): (start: number) => number {
  const offsets = [...new Set(bin.labels)].filter((o) => o >= bin.header.textOffset && o < end).sort((a, b) => a - b);
  return (start) => {
    let lo = 0;
    let hi = offsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] <= start) lo = mid + 1;
      else hi = mid;
    }
    return lo < offsets.length ? offsets[lo] : end;
  };
}

function walkLabel(bin: QuestBin, start: number, limit: number): QuestInstruction[] {
  const out: QuestInstruction[] = [];
  let at = start;
  while (at < limit) {
    const insn = decodeInstruction(bin.data, at);
    out.push(insn);
    at += insn.size;
    if (!insn.def) break;
    const name = insn.def.name;
    if (name === 'ret' || name === 'exit' || name === 'jmp') break;
  }
  return out;
}

export { F_ARGS, F_PUSH_ARG };
