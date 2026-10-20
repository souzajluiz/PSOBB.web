// Quest opcodes: shift_left / shift_right, get_gender, find_inventory_item(_ex),
// enable_keyword_detect + check_for_keyword and the enemy battle parameter
// overrides (set_override_enemy_bp_index, set_enemy_*_data). A tiny hand
// assembled quest runs on the VM with a stub host.
//
// Run: node tests/questmisc.test.ts
import { BattleParams, BATTLE_PARAM_TABLE_SIZE } from '../client/src/formats/battleparams.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { questOpcodeByName } from '../client/src/formats/questopcodes.ts';
import { KEYWORD_LIFETIME, KeywordDetector, findInventoryItem, genderOfClass } from '../client/src/quest/miscops.ts';
import { QuestVM, type QuestVMHost } from '../client/src/quest/vm.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};

// --- a minimal assembler ----------------------------------------------------------
type Op = [string, ...Array<number | string>];

function opBytes(name: string, args: Array<number | string>): number[] {
  const def = questOpcodeByName(name);
  if (!def) throw new Error(`no opcode ${name}`);
  const out = def.opcode > 0xff ? [def.opcode >> 8, def.opcode & 0xff] : [def.opcode];
  let i = 0;
  // F_ARGS opcodes take their arguments from the arg stack, not the bytecode.
  for (const a of def.flags & 4 ? [] : def.args) {
    const v = args[i++];
    switch (a.t) {
      case 'I32':
        out.push(...[0, 8, 16, 24].map((s) => ((v as number) >> s) & 0xff));
        break;
      case 'LABEL16':
        out.push((v as number) & 0xff, (v as number) >> 8);
        break;
      case 'CSTRING':
        for (const ch of v as string) out.push(ch.charCodeAt(0), 0);
        out.push(0, 0);
        break;
      default:
        out.push(v as number);
    }
  }
  return out;
}

// Quest with the code `ops` at label 0 and `blobs` as labels 1.. (after the code).
function buildQuest(ops: Op[], blobs: Uint8Array[] = []): Uint8Array {
  const code = ops.flatMap(([n, ...a]) => opBytes(n, a));
  code.push(...opBytes('ret', []));
  const labelOffsets = [0];
  let at = code.length;
  for (const b of blobs) {
    labelOffsets.push(at);
    at += b.length;
  }
  const textOffset = 0x398;
  const labelTable = textOffset + at;
  const size = labelTable + labelOffsets.length * 4;
  const data = new Uint8Array(size);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, textOffset, true);
  dv.setUint32(4, labelTable, true);
  dv.setUint32(8, size, true);
  data.set(code, textOffset);
  let o = textOffset + code.length;
  for (const b of blobs) {
    data.set(b, o);
    o += b.length;
  }
  labelOffsets.forEach((l, i) => dv.setUint32(labelTable + i * 4, l, true));
  return data;
}

function run(ops: Op[], host: QuestVMHost = {}, blobs: Uint8Array[] = []): QuestVM {
  const vm = new QuestVM({ bin: parseQuestBin(buildQuest(ops, blobs)), host });
  vm.start();
  vm.runFrames(2);
  return vm;
}

// --- shifts -------------------------------------------------------------------------
{
  const vm = run([
    ['leti', 0, 1], ['leti', 1, 33], ['shift_left', 0, 1], // 33 & 31 = 1: 1 << 1
    ['leti', 2, -64], ['leti', 3, 2], ['shift_right', 2, 3], // arithmetic
    ['leti', 4, 0x40000000], ['leti', 5, 1], ['shift_left', 4, 5], // wraps to the sign bit
  ]);
  check(vm.regsI[0] === 2, `shift_left masks the count (${vm.regsI[0]})`);
  check(vm.regsI[2] === -16, `shift_right is arithmetic (${vm.regsI[2]})`);
  check(vm.regsI[4] === -0x80000000, `shift_left wraps (${vm.regsI[4]})`);
  check(vm.unimplemented.size === 0, 'no skipped opcodes in the shift quest');
}

// --- get_gender ---------------------------------------------------------------------
{
  const vm = run([['leti', 0, 1], ['get_gender', 0, 1], ['leti', 2, 3], ['get_gender', 2, 3]], { playerGender: (id) => genderOfClass(id === 1 ? 1 : 0) });
  check(vm.regsI[1] === 1, 'client 1 is female (HUnewearl)');
  check(vm.regsI[3] === 0, 'client 3 is male');
  const bare = run([['leti', 0, 0], ['get_gender', 0, 1]]);
  check(bare.regsI[1] === 2, 'no player: 2');
  check([0, 2, 3, 4, 7, 10].every((c) => genderOfClass(c) === 0) && [1, 5, 6, 8, 9, 11].every((c) => genderOfClass(c) === 1), 'class genders');
}

// --- find_inventory_item ----------------------------------------------------------------
{
  const items = [
    { id: 0x10001, data1: [0, 1, 0, 0, 0] }, // saber, no special
    { id: 0x10002, data1: [0, 2, 0, 0, 5] }, // dagger with special 5
    { id: 0x10003, data1: [1, 1, 3, 0, 0] }, // armor
    { id: 0x10004, data1: [2, 0, 0, 0, 0] }, // mag
    { id: 0x10005, data1: [3, 2, 7, 0, 2] }, // tech disk, level 3
    { id: 0x10006, data1: [3, 0, 0, 0, 0] }, // monomate
  ];
  check(findInventoryItem(items, [0, 1, 0], false) === 0x10001, 'weapon found');
  check(findInventoryItem(items, [0, 2, 0], false) === 0xffffffff, 'weapon with a special is not found by the plain form');
  check(findInventoryItem(items, [0, 2, 0, 5], true) === 0x10002, '_ex matches data1[4]');
  check(findInventoryItem(items, [1, 1, 3], false) === 0x10003 && findInventoryItem(items, [1, 1, 4], false) === 0xffffffff, 'armor');
  check(findInventoryItem(items, [2, 0, 99], false) === 0x10004, 'mag ignores data1[2]');
  check(findInventoryItem(items, [3, 2, 7], false) === 0xffffffff && findInventoryItem(items, [3, 2, 7, 2], true) === 0x10005, 'tech disk needs data1[4]');
  check(findInventoryItem(items, [3, 0, 0], false) === 0x10006, 'tool');
  const vm = run(
    [['leti', 0, 3], ['leti', 1, 0], ['leti', 2, 0], ['find_inventory_item', 0, 5], ['leti', 10, 9], ['find_inventory_item', 10, 6]],
    { inventoryItems: () => items },
  );
  check((vm.regsI[5] >>> 0) === 0x10006, `opcode finds the monomate (${vm.regsU[5].toString(16)})`);
  check((vm.regsI[6] >>> 0) === 0xffffffff, 'opcode: not found is 0xFFFFFFFF');
}

// --- keyword detection --------------------------------------------------------------------
{
  const k = new KeywordDetector();
  k.say(0, 'Hello World');
  check(!k.check(0, 'hello'), 'nothing is heard before enable_keyword_detect');
  k.enable();
  k.say(0, 'Hello World');
  check(k.check(0, 'hello') && k.check(0, ' world ') && k.check(0, 'hello '), 'substring match, case-insensitive text');
  check(!k.check(0, ' hel ') && !k.check(1, 'hello') && !k.check(0, ''), 'whole-word, per-player, empty');
  check(!k.check(0, 'Hello'), 'the keyword itself is not lowercased');
  for (let i = 0; i < KEYWORD_LIFETIME - 1; i++) k.update();
  check(k.check(0, 'hello'), 'still there one tick before it expires');
  k.update();
  check(!k.check(0, 'hello'), 'gone after 0x78 ticks');

  const vm = run([['enable_keyword_detect']]);
  check(vm.unimplemented.size === 0 && vm.keywords.isEnabled, 'enable_keyword_detect');
  vm.sayKeyword(2, 'open sesame');
  // check_for_keyword r7 = client 2 says "sesame": arg_pusha 7, arg_pushl 2, arg_pushs "sesame"
  const vm2 = new QuestVM({
    bin: parseQuestBin(buildQuest([['enable_keyword_detect'], ['arg_pusha', 7], ['arg_pushl', 2], ['arg_pushs', 'sesame'], ['check_for_keyword']])),
    host: {},
  });
  vm2.start();
  vm2.sayKeyword(2, 'open sesame'); // before the first frame: not enabled yet
  vm2.runFrames(1);
  check(vm2.regsI[7] === 0, 'said before enabling: not heard');
  const vm3 = new QuestVM({
    bin: parseQuestBin(buildQuest([['enable_keyword_detect'], ['sync'], ['arg_pusha', 7], ['arg_pushl', 2], ['arg_pushs', 'sesame'], ['check_for_keyword']])),
    host: {},
  });
  vm3.start();
  vm3.runFrames(1);
  vm3.sayKeyword(2, 'Open Sesame');
  vm3.runFrames(1);
  check(vm3.regsI[7] === 1 && vm3.unimplemented.size === 0, 'check_for_keyword finds it');
}

// --- enemy battle parameter overrides -------------------------------------------------------
{
  const row = (n: number, fill: number) => new Uint8Array(n).fill(fill);
  const seen: string[] = [];
  const vm = run(
    [
      ['arg_pushl', 0x2a], ['set_override_enemy_bp_index'],
      ['set_enemy_physical_data', 1], ['set_enemy_attack_data', 2], ['set_enemy_resist_data', 3], ['set_enemy_movement_data', 4],
      ['arg_pushl', 0x60], ['set_override_enemy_bp_index'], ['set_enemy_physical_data', 1], // out of range: ignored
    ],
    { overrideBattleParam: (kind, index, r) => seen.push(`${kind}:${index}:${r.length}:${r[0]}`) },
    [row(0x24, 1), row(0x30, 2), row(0x20, 3), row(0x30, 4)],
  );
  check(seen.join(' ') === 'physical:42:36:1 attack:42:48:2 resist:42:32:3 movement:42:48:4', `overrides sent: ${seen.join(' ')}`);
  check(vm.bpOverrides.size === 4 && vm.unimplemented.size === 0, 'overrides recorded');

  // BattleParams.override replaces the row in a copy of the table.
  const table = new Uint8Array(BATTLE_PARAM_TABLE_SIZE);
  const bp = new BattleParams(table);
  const phys = new Uint8Array(0x24);
  new DataView(phys.buffer).setInt16(6, 1234, true); // hp
  check(bp.override('physical', 2, 0x2a, phys), 'override accepted');
  check(bp.stats(2, 0x2a).hp === 1234 && bp.stats(1, 0x2a).hp === 0 && table[0] === 0 && table.every((b) => b === 0), 'only that difficulty and row changed, input untouched');
  const mv = new Uint8Array(0x30);
  new DataView(mv.buffer).setFloat32(0, 2.5, true);
  bp.override('movement', 0, 5, mv);
  check(bp.movement(0, 5).fparam1 === 2.5, 'movement row');
  check(!bp.override('attack', 0, 0x60, new Uint8Array(0x30)) && !bp.override('resist', 0, 0, new Uint8Array(4)), 'bad index / short row refused');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('questmisc: ok');
