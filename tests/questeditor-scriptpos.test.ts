// Quest editor: positions and radii the script carries (scriptpos.ts): synthetic disassembly
// text, the opcode table the layouts rest on, and (with a newserv checkout) real quests.
//
// Run: node tests/questeditor-scriptpos.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { disassembleQuest } from '../client/src/formats/questasm.ts';
import { QUEST_OPCODES } from '../client/src/formats/questopcodes.ts';
import { extractScriptPositions, POSITION_OPS } from '../client/src/questeditor/scriptpos.ts';

let failures = 0;
let checks = 0;
const eq = (a: unknown, b: unknown, msg: string) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// The layouts assume these opcodes take a register set of at least the used size.
for (const [name, op] of POSITION_OPS) {
  const def = QUEST_OPCODES.find((d) => d.names.includes(name));
  const set = def?.args[op.regsOperand];
  eq(def !== undefined && set?.t === 'R_REG_SET_FIXED' && (set.n ?? 0) >= 3 && (op.radiusIndex ?? op.angleIndex ?? 0) < (set.n ?? 0), true, `table: ${name} takes a register set`);
}

const text = `
start:
  leti                             r60, 0x000000ED
  leti                             r61, 0x00000000
  leti                             r62, 0x0000014D
  leti                             r63, 0xFFFFFFF1
  arg_pushl                        0x00000002
  arg_pushb                        0x3C
  set_player_start_position        // 0x00000002, r60-r63
  ret

label0109:
  leti                             r60, 0x000000D5
  leti                             r61, 0x00000003
  leti                             r62, 0xFFFFFEE8
  letb                             r63, 0x0A
  leti                             r64, 0x000002BD
  at_coords_talk                   r60-r64
  let                              r10, r60
  move_coords_object               r10, r60-r62
  addi                             r60, 0x00000005
  at_coords_call                   r60-r64
  leti                             r61, 0x00000009
  leti                             r62, 0x00000001
  at_coords_call_ex                r60-r64, r5
  ret

label010A:
  at_coords_call                   r60-r64
  call                             label0109
  at_coords_call                   r60-r64
`;
const got = extractScriptPositions(text);
eq(got.length, 3, 'three positions: the ones with unknown registers are dropped');
eq(got[0], { kind: 'start', op: 'set_player_start_position', x: 237, y: 0, z: 333, radius: null, angle: -15, clientId: 2, label: 'start', line: 8 }, 'start point with client id and angle');
eq(got[1], { kind: 'talk', op: 'at_coords_talk', x: 213, y: 3, z: -280, radius: 10, angle: null, clientId: null, label: 'label0109', line: 17 }, 'talk circle with a signed z and a radius');
eq([got[2].kind, got[2].x, got[2].y, got[2].z], ['object', 213, 3, -280], 'move_coords_object; the calls after addi made r60 unknown are dropped');
eq(extractScriptPositions('start:\n  at_coords_call r1-r5\n'), [], 'registers with no value drop the position');
eq(extractScriptPositions('start:\n  leti r1, 0x00000001\n  leti r2, 0x00000002\n  leti r3, 0x00000003\n  leti r4, 0x00000004\nlabel0001:\n  at_coords_call r1-r5\n'), [], 'registers are forgotten at a label');

// Real quests, when the newserv checkout is there.
const dir = resolve(import.meta.dirname, '../vendor/newserv/system/quests/extermination');
const q101 = resolve(dir, 'q101-bb-e.bin');
if (existsSync(q101)) {
  const bin = parseQuestBin(prsDecompress(new Uint8Array(readFileSync(q101)), 4 << 20));
  const list = extractScriptPositions(disassembleQuest(bin, { header: false }));
  const starts = list.filter((p) => p.kind === 'start');
  eq(starts.map((p) => p.clientId), [0, 1, 2, 3], 'q101: four player start points');
  eq([starts[0].x, starts[0].y, starts[0].z, starts[0].angle], [237, 0, 333, -15], 'q101: the first start point');
  const talks = list.filter((p) => p.kind === 'talk');
  eq(talks.length >= 3, true, 'q101: at_coords_talk circles');
  eq(talks[0].radius, 2, 'q101: the first talk radius');
  eq([talks[0].x, talks[0].y, talks[0].z], [213, 3, -280], 'q101: the first talk centre');
} else {
  console.log('(q101 not present: real-quest checks skipped)');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
