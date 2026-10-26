// NPC takeover (quest/npctakeover.ts): the flags a 6x69 creator gives (SetChallengeType 0x00686984),
// the globals of command 0, and the decision of SinowberillChallenge_CheckAndReassignPlayer_007b46f8
// (objdump 0x007b46f8..0x007b4874), and the default command 2 the taker sends.
//
// Run: node tests/npctakeover.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  challengeTypeFlag,
  createdNpcFlag,
  NO_TAKEOVER,
  NpcTakeover,
  takeoverStep,
  TAKEOVER_NO_SLOT,
  type TakeoverInput,
} from '../client/src/quest/npctakeover.ts';
import { NpcAi, NPC_FLAG_FOLLOWER } from '../client/src/quest/npcai.ts';
import { buildNpcControl } from '../client/src/formats/npcplayerchar.ts';

const HERE = join(fileURLToPath(import.meta.url), '..');
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};

const cmd = (param1: number, param2: number, command: number, param3 = 0) => ({ param1, param2, command, param3 });

// --- SetChallengeType: the flag per type (objdump 0x686984..0x686a18) ---------------------
check(challengeTypeFlag(0) === 1 && challengeTypeFlag(3) === 1, 'types 0..3 give flag 1');
check(challengeTypeFlag(4) === 2, 'type 4 gives flag 2 (the non-owner copy)');
check(challengeTypeFlag(5) === 3, 'type 5 gives flag 3 (the owner copy)');
check(challengeTypeFlag(6) === 6 && challengeTypeFlag(7) === 7, 'types 6 and 7 give 6 and 7');
check(challengeTypeFlag(8) === null, 'other types write nothing');
check(createdNpcFlag(2, 2) === 3, 'the receiver named by param1 builds the owner copy (type 5)');
check(createdNpcFlag(2, 0) === 2, 'the other clients build the non-owner copy (type 4)');

// --- command 0 / 3 bookkeeping -------------------------------------------------------------
{
  const t = new NpcTakeover();
  t.noteCreate(cmd(2, 1, 0, 9), 0);
  check(t.state.owner === 2 && t.state.npcSlot === 1 && t.state.template === 9, 'command 0 sets owner, NPC slot and template');
  check(t.flagOf(1) === 2, 'command 0 by another owner: the NPC is flag 2');
  t.noteCreate(cmd(0, 3, 3, 4), 0);
  check(t.flagOf(3) === 3, 'command 3 owned by this client: flag 3');
  check(t.state.npcSlot === 1, 'command 3 leaves the globals alone');
}
{
  const t = new NpcTakeover();
  t.noteCreate(cmd(0, 2, 0, 5), 2); // the owner's own creation: param2 is the NPC's slot, flag 3
  check(t.flagOf(2) === undefined, 'command 0 with the NPC slot equal to this client makes no NPC');
  check(t.state.owner === TAKEOVER_NO_SLOT, 'and sets no globals');
  t.noteCreate(cmd(TAKEOVER_NO_SLOT, 1, 0, 5), 0);
  check(t.flagOf(1) === undefined && t.state.npcSlot === TAKEOVER_NO_SLOT, 'param1 0xffff is ignored');
  t.noteCreate(cmd(1, TAKEOVER_NO_SLOT, 0, 5), 0);
  check(t.state.npcSlot === TAKEOVER_NO_SLOT, 'param2 0xffff is ignored by command 0');
  t.noteCreate(cmd(1, TAKEOVER_NO_SLOT, 3, 5), 0);
  check(t.flagOf(TAKEOVER_NO_SLOT) === undefined, 'param2 0xffff is ignored by command 3');
}

// --- the decision (007b46f8) ---------------------------------------------------------------
function input(over: Partial<TakeoverInput> & { present: number[]; flags?: Record<number, number> }): TakeoverInput {
  const present = new Set(over.present);
  const flags = over.flags ?? {};
  return {
    globals: over.globals ?? { owner: 2, npcSlot: 1, template: 9 },
    opm: over.opm ?? false,
    self: over.self ?? 0,
    present: (s) => present.has(s),
    npcFlag: (s) => flags[s],
  };
}

check(takeoverStep(input({ present: [0, 1, 2], self: 0 })).kind === 'none', 'owner present: nothing');
check(takeoverStep(input({ present: [0, 1], opm: true, self: 0 })).kind === 'none', 'OPM flag set: nothing');
check(takeoverStep(input({ present: [0], self: 0, globals: NO_TAKEOVER })).kind === 'none', 'no owner slot: nothing');
check(takeoverStep(input({ present: [0], self: 0, flags: { 1: 3 } })).kind === 'reset', 'owner gone, NPC not flag 2: reset');
check(takeoverStep(input({ present: [0], self: 0 })).kind === 'reset', 'owner gone, NPC slot empty: reset');
check(takeoverStep(input({ present: [1, 3], self: 0, flags: { 1: 2 } })).kind === 'other', 'owner gone, another client is the next slot: other');
{
  const d = takeoverStep(input({ present: [0, 1, 3], self: 0, flags: { 1: 2 } }));
  check(d.kind === 'take' && d.npcSlot === 1, 'owner gone, this client is the first slot (0): take');
}
{
  // Owner in slot 0 gone; the NPC's slot 1 is the lowest present slot and is skipped: slot 2 is the taker.
  const g = { owner: 0, npcSlot: 1, template: 9 };
  const d = takeoverStep(input({ present: [1, 2, 3], self: 3, globals: g, flags: { 1: 2 } }));
  check(d.kind === 'other' && d.taker === 2, 'NPC slot skipped: slot 2 takes, not the NPC');
  const e = takeoverStep(input({ present: [1, 2, 3], self: 2, globals: g, flags: { 1: 2 } }));
  check(e.kind === 'take' && e.npcSlot === 1, 'this client in slot 2 with the NPC in slot 1: take');
}
check(takeoverStep(input({ present: [1], self: 0, flags: { 1: 2 } })).kind === 'none', 'only the NPC is present: nothing');

// --- the class: the owner-left sequence -----------------------------------------------------
{
  const t = new NpcTakeover();
  t.noteCreate(cmd(2, 1, 0, 9), 0); // owner 2 made the NPC in slot 1, this client is slot 0
  const present = new Set([0, 1, 2]);
  const has = (s: number) => present.has(s);
  check(t.onPlayerLeft(has, 0).kind === 'none', 'the owner is still there: no change');
  present.delete(2); // the owner (slot 2) leaves
  const d = t.onPlayerLeft(has, 0);
  check(d.kind === 'take' && d.npcSlot === 1, 'the owner leaves, this client is slot 0: take');
  check(t.state.owner === 0 && t.flagOf(1) === 3, 'after take: owner is this client, the NPC is flag 3');
  check(t.onPlayerLeft(has, 0).kind === 'none', 'after take the owner is this client: nothing more');
}
{
  // A killed NPC loses its flag, so the next leave resets the globals.
  const t = new NpcTakeover();
  t.noteCreate(cmd(2, 1, 0, 9), 0);
  t.forget(1);
  const d = t.onPlayerLeft((s) => s === 0, 0);
  check(d.kind === 'reset' && t.state.owner === TAKEOVER_NO_SLOT, 'the NPC gone: reset, globals cleared');
}

// --- the default command 2 the taker sends: param1 = this client (objdump 0x007b4879) -------
{
  const body = buildNpcControl(cmd(3, 0, 2, 0));
  const dv = new DataView(body.buffer);
  check(body[0] === 0x69 && body[1] === 3, '6x69 header');
  check(dv.getUint16(4, true) === 3 && dv.getUint16(8, true) === 2, 'the default command 2 names this client as the leader');
}
{
  // The taker's apply: command 2 makes the flag-3 NPCs of this client follow it (npcai.ts, unchanged).
  const ai = new NpcAi();
  ai.create(1, true);
  ai.get(1)!.flag = NPC_FLAG_FOLLOWER;
  ai.apply(cmd(0, 0, 2, 0), 0);
  check(ai.get(1)!.leader === 0, 'command 2 with this client as the leader reaches a flag-3 NPC');
}

// --- the wiring in town.ts (source check) ---------------------------------------------------
{
  const src = readFileSync(join(HERE, '../client/src/quest/town.ts'), 'utf8');
  check(src.includes("this.game.on('playerLeft', () => this.npcOwnerLeft());"), 'town.ts listens for the leave notice');
  check(src.includes('this.npcTakeover.noteCreate(c, this.game.selfId);'), 'town.ts records the 6x69 creates');
  check(src.includes('this.npcTakeover.forget(slot);'), 'town.ts forgets a killed NPC');
  check(src.includes('st.flag = NPC_FLAG_FOLLOWER;') && src.includes('st.leader = self;'), 'town.ts sets the taken NPC flag 3 and leader');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('npctakeover: ok');
