// NPC players' follow state (quest/npcai.ts): 6x69 commands 0-3 as the exe's
// 0x69 receiver applies them, the leader rules, the follow point, and the
// quest's npc_play reaching the host through the VM.
//
// Run: node tests/npcai.test.ts
import { FOLLOW_DISTANCE, NO_LEADER, NpcAi, NPC_FLAG_CREATED, NPC_FLAG_FOLLOWER, followPoint } from '../client/src/quest/npcai.ts';
import { questOpcodeByName } from '../client/src/formats/questopcodes.ts';
import { QuestVM } from '../client/src/quest/vm.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};

const cmd = (param1: number, param2: number, command: number, param3 = 0) => ({ param1, param2, command, param3 });

// --- creation (commands 0 / 3) -----------------------------------------------------
{
  const ai = new NpcAi();
  // The exe's constructor: flag 7, leader none.
  check(ai.apply(cmd(2, 1, 0, 5), 2) === 'follower NPC in slot 1', 'command 0 creates a follower in the slot');
  const s = ai.get(1);
  check(!!s && s.flag === NPC_FLAG_CREATED && s.leader === NO_LEADER, 'a new NPC has flag 7 and no leader');
  // param1 names this client: this client owns the NPC's AI.
  check(s?.owner === true, 'param1 == own slot makes this client the owner');
  ai.apply(cmd(0, 3, 3, 5), 2);
  check(ai.get(3)?.owner === false, 'a non-owner NPC (command 3) has no AI on this client');
  // The sender's own slot is never an NPC slot (exe: param2 != g_CurrentPlayerSlotIndex).
  check(ai.apply(cmd(2, 2, 0, 5), 2) === null && ai.get(2) === undefined, 'an NPC cannot take the own slot');
  check(ai.apply(cmd(2, 0xffff, 0, 5), 2) === null, 'slot 0xffff creates nothing');
}

// --- commands 1 / 2 on the flag ----------------------------------------------------
{
  const ai = new NpcAi();
  ai.create(1, false);
  ai.create(3, false);
  // command 2 follows for the NPCs made by command 0 / 3 too (ASSUMED, FOLLOW_CREATED_NPCS).
  check(ai.follow(0) === 2, 'command 2 reaches the created NPCs (ASSUMED)');
  check(ai.get(1)?.leader === 0 && ai.get(3)?.leader === 0, 'the leader is the param1 client');
  // command 1 stops the NPC named by param1 when it is a follower (flag 3 in the exe).
  check(ai.stop(1) === false, 'command 1 on a flag 7 NPC does not stop it (exe gate: flag 3)');
  const f = ai.get(3);
  if (f) f.flag = NPC_FLAG_FOLLOWER;
  check(ai.stop(3) === true && ai.get(3)?.leader === NO_LEADER, 'command 1 stops a flag 3 follower (exe: 0x750 = 0xffff)');
  check(ai.apply(cmd(3, 0, 1), 0) === 'NPC 3 stops following', 'command 1 is logged through apply');
  check(ai.get(1)?.leader === 0, 'command 1 leaves the other NPCs following');
  ai.remove(1);
  check(ai.get(1) === undefined && ai.slots().length === 1, 'remove drops the NPC');
}

// --- the follow point --------------------------------------------------------------
{
  const leader = { x: 0, z: 0 };
  const near = followPoint({ x: 1, z: 0 }, leader);
  check(near.x === 1 && near.z === 0, 'inside FOLLOW_DISTANCE the follower stays');
  const far = followPoint({ x: 10, z: 0 }, leader);
  check(Math.abs(far.x - FOLLOW_DISTANCE) < 1e-9 && far.z === 0, 'outside it the follower walks to FOLLOW_DISTANCE from the leader');
  const diag = followPoint({ x: 30, z: 40 }, leader);
  check(Math.abs(Math.hypot(diag.x, diag.z) - FOLLOW_DISTANCE) < 1e-9, 'the follow point is on the leader-follower line');
}

// --- npc_play reaches the host (vm.ts case; a VM run needs a quest binary, so the source is checked)
{
  const q = questOpcodeByName('npc_play');
  check(!!q && q.args.length === 1, 'npc_play takes one I32 argument');
  const vmSrc = readFileSync(join(HERE, '../client/src/quest/vm.ts'), 'utf8');
  check(/case 'npc_play': \{\s*this\.host\.npcPlay\?\.\(this\.int\(a, 0\)\);/.test(vmSrc), 'the VM sends npc_play to host.npcPlay');
  check(!/'npc_stop', 'npc_play'/.test(vmSrc), 'npc_play is no longer a no-op');
  check(typeof QuestVM === 'function', 'QuestVM loads');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('npcai: ok');
