// The Pioneer 2 Present Counter (bb_p2_menu 8, the Momoka item exchange):
// the exchange table of the quest header (quest/giveaway.ts presentOffer, the
// create-item mask entries at 0x42c, stride 0x38), the 6xD9 bytes
// (net/items.ts buildMomokaExchange), the F95B opcode (bb_replace_item) through
// the VM with a stub host, and the tokens. The counter's window flow needs the
// quest UI and is not run here.
// Run: node tests/giveaway.test.ts
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { questOpcodeByName } from '../client/src/formats/questopcodes.ts';
import { argItemBytes, PRESENT_TABLE_OFFSET, PRESENT_TEXT, presentItem, presentOffer, presentTokens, type MomokaExchangeRequest } from '../client/src/quest/giveaway.ts';
import { buildMomokaExchange } from '../client/src/net/items.ts';
import { QuestVM } from '../client/src/quest/vm.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// --- the exchange table ---------------------------------------------------------------
// A 0x122C header (the full Qedit extension) with entry 0 = the hand-in item
// 0x03/0x0a/0x0b (data1[0..2] as dwords, count 4 at +0x14), entries 1 and 2
// the offered items 0x00/0x01/0x02 and 0x00/0x01/0x09, entry 3 empty.
function headerWithTable(): Uint8Array {
  const data = new Uint8Array(0x122c);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 0x122c, true); // text offset
  dv.setUint32(4, 0x122c + 0x10, true); // label table offset
  const at = (i: number) => PRESENT_TABLE_OFFSET + i * 0x38;
  const put = (i: number, d0: number, d1: number, d2: number) => {
    dv.setUint32(at(i), d0, true);
    dv.setUint32(at(i) + 4, d1, true);
    dv.setUint32(at(i) + 8, d2, true);
  };
  put(0, 0x03, 0x0a, 0x0b);
  dv.setUint32(at(0) + 0x14, 4, true);
  put(1, 0x00, 0x01, 0x02);
  put(2, 0x00, 0x01, 0x09);
  return data;
}

{
  const data = headerWithTable();
  const offer = presentOffer(data, true);
  check(offer !== null, 'a table with a hand-in item and offers is an offer');
  check(hex(Uint8Array.from(offer!.find)) === '030a0b', `hand-in item bytes ${offer && hex(Uint8Array.from(offer.find))}`);
  check(offer!.findCount === 4 && offer!.rewardCount === 4, 'the count of the hand-in item (data1[5]) is the offers\' count');
  check(offer!.rewards.length === 2 && hex(Uint8Array.from(offer!.rewards[1])) === '000109', 'offers run until the first empty entry');
  // The exe takes the count as 1 when the table gives none.
  const zeroCount = headerWithTable();
  new DataView(zeroCount.buffer).setUint32(PRESENT_TABLE_OFFSET + 0x14, 0, true);
  check(presentOffer(zeroCount, true)!.rewardCount === 1, 'a zero count is 1 for the offers');
  check(presentOffer(data, false) === null, 'a 0x398 header (no table) offers nothing');
  const empty = headerWithTable();
  empty.fill(0, PRESENT_TABLE_OFFSET, PRESENT_TABLE_OFFSET + 0x38);
  check(presentOffer(empty, true) === null, 'no hand-in item, no offer');
  const noOffers = headerWithTable();
  noOffers.fill(0, PRESENT_TABLE_OFFSET + 0x38, PRESENT_TABLE_OFFSET + 0x38 * 2);
  check(presentOffer(noOffers, true) === null, 'no offered item, no offer');
  check(presentOffer(new Uint8Array(0x400), true) === null, 'a short quest file offers nothing');
  // A dword is live when any of its three is non-zero (the exe's test on piVar1[0..2]).
  const highOnly = headerWithTable();
  new DataView(highOnly.buffer).setUint32(PRESENT_TABLE_OFFSET + 0x38 * 2 + 8, 0x100, true);
  check(presentOffer(highOnly, true)!.rewards.length === 2, 'entry 2 still live through data1[2]');
}

// --- item bytes and the packed F95B arguments --------------------------------------------
check(hex(Uint8Array.from(argItemBytes(0x030a0b))) === '030a0b', 'argItemBytes: high byte first');
check(hex(Uint8Array.from(argItemBytes(0x00ffff00))) === 'ffff00', 'argItemBytes: bits 16..23, 8..15, 0..7');
const pItem = presentItem([3, 10, 11], 4);
check(pItem.data1.length === 12 && pItem.data1[0] === 3 && pItem.data1[2] === 11 && pItem.data1[3] === 0, 'presentItem: data1[0..2] only');
check(new DataView(pItem.data2.buffer).getUint32(0, true) === 4 && pItem.id === 0, 'presentItem: count in data2, id 0');

// --- tokens ---------------------------------------------------------------------------------
{
  const t = presentTokens(4, 2);
  check(t.token1 === 6 && t.token2 === 3, `presentTokens(4, 2) = ${JSON.stringify(t)} (count ^ slot, slot ^ 1)`);
}

// --- the 6xD9 bytes --------------------------------------------------------------------------
{
  const find = presentItem([3, 10, 11], 4);
  const replace = presentItem([0, 1, 9], 1);
  const b = buildMomokaExchange(2, find, replace, 0x11223344, 0x55667788, 7, 9);
  check(b.length === 0x38, `6xD9 is 0x38 bytes (got ${b.length})`);
  check(b[0] === 0xd9 && b[1] === 0x0e && new DataView(b.buffer).getUint16(2, true) === 2, '6xD9 header: sub, size 0x0E dwords, client id');
  check(hex(b.subarray(4, 7)) === '030a0b' && b[7] === 0, 'find item data1[0..2] at +4');
  check(new DataView(b.buffer).getUint32(4 + 0x10, true) === 4, 'find item count in data2 (+0x14)');
  check(hex(b.subarray(0x18, 0x1b)) === '000109', 'replace item data1[0..2] at +0x18');
  check(new DataView(b.buffer).getUint32(0x2c, true) === 0x11223344 && new DataView(b.buffer).getUint32(0x30, true) === 0x55667788, 'tokens at +0x2c / +0x30');
  check(new DataView(b.buffer).getUint16(0x34, true) === 7 && new DataView(b.buffer).getUint16(0x36, true) === 9, 'labels at +0x34 / +0x36');
}

// --- F95B through the VM ----------------------------------------------------------------------
{
  const got: MomokaExchangeRequest[] = [];
  const ops: Array<[string, ...number[]]> = [
    ['arg_pushl', 0x030a0b],
    ['arg_pushl', 0x000109],
    ['arg_pushl', 5],
    ['arg_pushl', 6],
    ['arg_pushl', 7],
    ['arg_pushl', 9],
    ['bb_replace_item'],
  ];
  const vm = new QuestVM({ bin: parseQuestBin(assemble(ops)), host: { clientId: () => 2, momokaExchange: (r) => got.push(r) } });
  vm.start();
  vm.runFrames(2);
  check(got.length === 1, `F95B sends one exchange (got ${got.length})`);
  check(got[0]?.find === 0x030a0b && got[0]?.replace === 0x000109, 'F95B: the packed items');
  check(got[0]?.token1 === (5 ^ 2) && got[0]?.token2 === (6 ^ 2), 'F95B: tokens xored with the slot');
  check(got[0]?.label1 === 7 && got[0]?.label2 === 9, 'F95B: the two labels');
  check(questOpcodeByName('bb_replace_item')?.opcode === 0xf95b, 'F95B is bb_replace_item');
}

// The counter's texts (unitxt_shop group 0) are the exe's indices.
check(PRESENT_TEXT.title === 0x4e && PRESENT_TEXT.reminder === 0x58 && PRESENT_TEXT.timeout === 0x57, 'Present Counter text indices');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;

// Quest .bin with the given ops at label 0 (the questmisc assembler, minimal).
function assemble(ops: Array<[string, ...number[]]>): Uint8Array {
  const code: number[] = [];
  for (const [name, ...args] of ops) {
    const def = questOpcodeByName(name);
    if (!def) throw new Error(`no opcode ${name}`);
    if (def.opcode > 0xff) code.push(def.opcode >> 8, def.opcode & 0xff);
    else code.push(def.opcode);
    if (def.flags & 4) continue; // F_ARGS: nothing inline
    let i = 0;
    for (const a of def.args) {
      const v = args[i++];
      if (a.t === 'I32') code.push(...[0, 8, 16, 24].map((s) => (v >> s) & 0xff));
      else if (a.t === 'LABEL16') code.push(v & 0xff, v >> 8);
      else code.push(v);
    }
  }
  const ret = questOpcodeByName('ret')!.opcode;
  code.push(ret);
  const textOffset = 0x398;
  const labelTable = textOffset + code.length;
  const data = new Uint8Array(labelTable + 4);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, textOffset, true);
  dv.setUint32(4, labelTable, true);
  dv.setUint32(8, data.length, true);
  dv.setUint16(0x10, 0, true);
  data.set(code, textOffset);
  dv.setUint32(labelTable, 0, true);
  return data;
}
