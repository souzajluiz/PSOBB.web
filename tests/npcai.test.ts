// NPC players' follow state (quest/npcai.ts): 6x69 commands 0-3 as the exe's
// 0x69 receiver applies them, the leader rules, the follow point, and the
// quest's npc_play reaching the host through the VM.
//
// Run: node tests/npcai.test.ts
import {
  FOLLOW_DISTANCE,
  NO_LEADER,
  NpcAi,
  NpcAttackAi,
  NpcAttackGate,
  NpcHeadChooser,
  type HeadChooseInput,
  headStatusFlags,
  NPC_FLAG_CREATED,
  NPC_TECH_ANTI,
  NPC_TECH_RESTA,
  NPC_TECH_REVERSER,
  npcAttackCast,
  NPC_FLAG_FOLLOWER,
  followPoint,
  npcAttackRow,
  NpcMoveSender,
  pickAttackTarget,
} from '../client/src/quest/npcai.ts';
import {
  headCastInputState,
  headMidpoint,
  headSendDistance,
  headSpawnRange,
  headTwoTech,
  headTwoTier,
  HEAD_STATE_IDLE,
  HEAD_STATE_MOVE,
  HEAD_TWO_TECH_TABLE,
  HEAD_WALL_MASK,
  NpcHead,
} from '../client/src/quest/npchead.ts';
import { buildNpcMove } from '../client/src/net/game.ts';
import { questOpcodeByName } from '../client/src/formats/questopcodes.ts';
import { boxTargetable } from '../client/src/formats/enemyboxes.ts';
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

// --- the attack AI (exe: SinowberillChallengePlayer_Update_007aefd4, EnemyAI_AcquireClosestTargetInRange_007af2a0, SinowberillHead_TryAttack_007b0754)
{
  const r0 = npcAttackRow(0);
  check(!!r0 && r0.acquireRange === 100 && r0.farRadius === 30 && r0.attackRadius === 30, 'stat row 0: acquire 100, far 30, attack 30 (exe 0x00a02ea0)');
  check(npcAttackRow(3)?.acquireRange === 120, 'stat row 3 has acquire range 120');
  check(npcAttackRow(6) === null, 'rows the exe read are the only ones given (6 and up are null)');

  const npc = { x: 0, z: 0 };
  const box = (x: number, z: number, targetable = true) => ({ x, z, targetable });
  const pick = pickAttackTarget(npc, 100, [
    { slot: 7, hitboxes: [box(40, 0)] },
    { slot: 8, hitboxes: [box(10, 0, false)] },
    { slot: 9, hitboxes: [box(0, 20), box(150, 0)] },
  ]);
  check(pick === 9, 'the nearest targetable box inside the range wins; non-targetable and out-of-range boxes are skipped');
  check(pickAttackTarget(npc, 100, [{ slot: 1, hitboxes: [box(100, 0)] }]) === null, 'a box at exactly the range is out (strict <)');
  check(pickAttackTarget(npc, 100, []) === null, 'no enemies, no target');
  // A box's targetable bit is its flag 0x8000 (formats/enemyboxes.ts boxTargetable): the table
  // 0x0093902c has flags 0x30003 (no 0x8000), so its enemy is not picked; 0x8003 is.
  check(pickAttackTarget(npc, 100, [{ slot: 4, hitboxes: [{ x: 5, z: 0, targetable: boxTargetable({ flags: 0x30003 }) }] }]) === null, 'a box without flag 0x8000 is not an NPC target');
  check(pickAttackTarget(npc, 100, [{ slot: 4, hitboxes: [{ x: 5, z: 0, targetable: boxTargetable({ flags: 0x8003 }) }] }]) === 4, 'a box with flag 0x8000 is an NPC target');

  const row = npcAttackRow(0)!;
  const g1 = new NpcAttackGate();
  const seq1 = [g1.tick(row, true, 10), g1.tick(row, true, 10), g1.tick(row, true, 10), g1.tick(row, true, 10)];
  check(seq1.join() === 'false,false,true,false', `retarget every 3rd far tick, attack when the target is inside attackRadius (got ${seq1.join()})`);
  const g2 = new NpcAttackGate();
  check([1, 2, 3].every(() => g2.tick(row, true, 31 * 31)) === false, 'a target outside attackRadius never sets the attack flag');
  const g3 = new NpcAttackGate();
  check(g3.tick(row, false, 1) === false && g3.tick(row, false, 1) === false && g3.tick(row, false, 1) === false, 'near the leader (not far) the NPC does not attack');
  const g4 = new NpcAttackGate();
  const seq4 = [g4.tick(row, true, null), g4.tick(row, true, null), g4.tick(row, true, 1), g4.tick(row, true, 1), g4.tick(row, true, 1)];
  check(seq4.join() === 'false,false,false,false,true', `no target: the counter does not advance (got ${seq4.join()})`);
}

// --- the attack's cast and the per-tick AI (exe: SinowberillHead_ExecuteAttack_007b2ae8 .c:797151, HandlePlayerTechCastState_007b2bc0 .c:797207)
{
  const a0 = npcAttackCast(0, false);
  check(a0?.kind === 'tech' && a0.tech === 0xf && a0.target === 'owner', 'action 0 casts tech 0xf (Resta) on the owner');
  check(NPC_TECH_RESTA === 0xf && NPC_TECH_ANTI === 0x10 && NPC_TECH_REVERSER === 0x11, 'action techs 0xf / 0x10 / 0x11');
  const a2 = npcAttackCast(2, false);
  const a3 = npcAttackCast(3, false);
  check(a2?.kind === 'tech' && a2.tech === 0x10 && a2.target === 'owner', 'action 2 casts 0x10 on the owner');
  check(a3?.kind === 'tech' && a3.tech === 0x11 && a3.target === 'target', 'action 3 casts 0x11 on the locked target');
  check(npcAttackCast(0, true)?.kind === 'item' && npcAttackCast(2, true)?.kind === 'item', 'flag 0x20 turns the action into an item use');
  check(npcAttackCast(1, false) === null && npcAttackCast(1, true)?.kind === 'item', 'action 1 is the item only');
  check(npcAttackCast(4, false) === null, 'unknown action: nothing');

  const row = npcAttackRow(0)!;
  const gd = new NpcAttackGate();
  gd.tick(row, true, 10);
  check(!gd.retargetDue(), 'retarget is not due after one far tick');
  gd.tick(row, true, 10);
  check(gd.retargetDue(), 'retarget is due on the third far tick (counter 2)');

  // The leader at the origin; the NPC 40 away (far for row 0: radius 30); an enemy 10 from the NPC.
  const enemy = { slot: 0x1005, hitboxes: [{ x: 50, z: 0, targetable: true }] };
  const posOf = (id: number) => (id === 0x1005 ? { x: 50, z: 0 } : null);
  const ai = new NpcAttackAi();
  const tickAt = (npcX: number) => ai.tick({ row, npc: { x: npcX, z: 0 }, leader: { x: 0, z: 0 }, enemies: [enemy], targetPos: posOf });
  const seqA = [tickAt(40), tickAt(40), tickAt(40), tickAt(40)];
  check(seqA.join() === 'false,false,true,false', `planner: attacks on the gate's cadence (got ${seqA.join()})`);
  check(ai.target === 0x1005, 'planner locks the nearest enemy');
  ai.busy(3);
  check([tickAt(40), tickAt(40), tickAt(40)].every((x) => x === false), 'planner: no attack while the cast is busy');

  const aiNear = new NpcAttackAi();
  const nearRes = [1, 2, 3, 4].map(() => aiNear.tick({ row, npc: { x: 5, z: 0 }, leader: { x: 0, z: 0 }, enemies: [enemy], targetPos: posOf }));
  check(nearRes.every((x) => !x) && aiNear.target === null, 'planner: an NPC near its leader does not attack or lock a target');

  const aiGone = new NpcAttackAi();
  for (let i = 0; i < 3; i++) aiGone.tick({ row, npc: { x: 40, z: 0 }, leader: { x: 0, z: 0 }, enemies: [enemy], targetPos: posOf });
  check(aiGone.target === 0x1005, 'planner: the target is locked');
  const gone = aiGone.tick({ row, npc: { x: 40, z: 0 }, leader: { x: 0, z: 0 }, enemies: [], targetPos: () => null });
  check(gone === false && aiGone.target === null, 'planner: a dead or gone target is dropped (no enemies left, no target)');
}

// --- the head's status flags and action chooser (exe: SinowberillCheckHeadRotation_007af694 .c:795008,
// SinowberillHead_AIProcessState_007b0a7c .c:795871)
{
  const full = { hp: 100, hpMax: 100, tp: 100, tpMax: 100, stateFlags30: 0 };
  check(headStatusFlags(full).f90 === 0 && headStatusFlags(full).f8c === 0, 'full HP and TP: no status flags');
  const half = headStatusFlags({ ...full, hp: 50 });
  check(half.f90 === 0x8 && half.f8c === 0x4, 'HP 50%: need heal (0x8, need 4), not critical');
  const crit = headStatusFlags({ ...full, hp: 10 });
  check(crit.f90 === 0x808 && crit.f8c === 0x4, 'HP 10% (<= 0.1): also 0x800');
  check(headStatusFlags({ ...full, tp: 20 }).f90 === 0x10, 'TP 20% (<= 0.2): 0x10');
  check(headStatusFlags({ ...full, tpMax: 0, tp: 0 }).f90 === 0, 'a zero TP max sets no TP flag');
  check(headStatusFlags({ ...full, stateFlags30: 0x1 }).f90 === 0x2, 'state 0x30 & 0x13 sets 0x2');

  const base: HeadChooseInput = {
    owner90: 0,
    owner8c: 0,
    npc90: 0,
    npc8c: 0,
    head34: 0,
    head84: 0,
    hasTarget: false,
    hasItem: () => false,
    canCast: () => true,
    lockedInRadius: () => false,
  };
  const ch = () => new NpcHeadChooser();
  check(!ch().choose(1, base).attack && !ch().choose(0, base).attack, 'nobody needs anything: no attack');
  const ownerHalf = { ...base, owner90: 0x8, owner8c: 0x4 };
  check(!ch().choose(1, ownerHalf).attack, 'owner at 50%: Resta is not cast (only at 10% or less)');
  const ownerCrit = { ...base, owner90: 0x808, owner8c: 0x4 };
  const r1 = ch().choose(1, ownerCrit);
  check(r1.attack && r1.action === 0 && !r1.item, 'owner at 10%: action 0 (Resta on the owner), no item');
  check(!ch().choose(1, { ...ownerCrit, head34: 0x40 }).attack, 'head flag 0x40 holds the action back');
  check(!ch().choose(1, { ...ownerCrit, canCast: (t) => t !== 0xf }).attack, 'no Resta eligibility: no action 0');
  const r2 = ch().choose(1, { ...base, owner90: 0x2, owner8c: 0x4, canCast: (t) => t === 0x10 });
  check(r2.attack && r2.action === 2, 'owner with status 0x2: Anti (action 2)');
  check(!ch().choose(1, { ...base, owner90: 0x10, owner8c: 0x4 }).attack, 'owner low TP alone: no cast (no 0x2 / 0x800 for the owner)');
  check(!ch().choose(1, { ...ownerCrit, head84: 5 }).attack, 'a second target (head +0x84) keeps the owner branch off');

  const npcHeal = { ...base, npc90: 0x8, npc8c: 0x4 };
  const it = ch().choose(0, { ...npcHeal, hasItem: (s) => s === 0 });
  check(it.attack && it.action === 0 && it.item, 'NPC at 50% with item 0: action 0 as an item use (flag 0x20)');
  const tech = ch().choose(0, npcHeal);
  check(tech.attack && tech.action === 0 && !tech.item, 'NPC at 50%, no item, Resta eligible: action 0 as the tech');
  check(!ch().choose(0, { ...npcHeal, canCast: () => false }).attack, 'NPC at 50%, no item, no eligibility: nothing');
  const tp = ch().choose(0, { ...base, npc90: 0x10, npc8c: 0x4, hasItem: (s) => s === 1 });
  check(tp.attack && tp.action === 1 && tp.item, 'NPC low TP with item 1: action 1 (item only)');
  check(!ch().choose(0, { ...base, npc90: 0x10, npc8c: 0x4 }).attack, 'NPC low TP without item 1: nothing');
  const st = ch().choose(0, { ...base, npc90: 0x2, npc8c: 0x4 });
  check(st.attack && st.action === 2 && !st.item, 'NPC with status 0x2: Anti (action 2) when eligible');

  // Mode 1 retarget: the locked target in the radius returns on the 30th call (counter +0x66 at 0x1e), with no write to the action.
  const hc = ch();
  const withTarget = { ...base, owner90: 0x8, owner8c: 0x4, hasTarget: true, lockedInRadius: () => true };
  const seq: boolean[] = [];
  for (let i = 0; i < 30; i++) seq.push(hc.choose(1, withTarget).attack);
  check(seq.slice(0, 29).every((x) => !x) && seq[29] === true, `retarget: attack on the 30th call only (got ${seq.indexOf(true) + 1})`);
  check(hc.action === 0, 'retarget attack does not write the action');

  // The exe writes action 0, 1 or 2 only (3 is never written in SinowberillHead_AIProcessState_007b0a7c).
  let seen3 = false;
  const bits = [0, 0x2, 0x8, 0x10, 0x800, 0x808, 0x18];
  for (const o90 of bits) for (const n90 of bits) for (const o8c of [0, 4]) for (const n8c of [0, 2, 4, 6]) {
    const c = new NpcHeadChooser().choose(1, { ...base, owner90: o90, owner8c: o8c, npc90: n90, npc8c: n8c, hasItem: () => true, canCast: () => true, hasTarget: true, lockedInRadius: () => false });
    if (c.action === 3) seen3 = true;
  }
  check(!seen3, 'the chooser never writes action 3');
}

// --- the NPC's move sends (exe: SinowberillHead_AIUpdateState_007b2764 state 1 .c:796990..797035,
// SendMoveStart_007b298c .c:797061, SendMove_007b29f0 .c:797089; leash = stat row k=4)
{
  check(npcAttackRow(0)?.leash === 13 && npcAttackRow(3)?.leash === 18, 'stat rows: the leash (k=4) is 13 for row 0 and 18 for row 3 (exe 0x00a02eb0)');
  const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const s = new NpcMoveSender();
  check(s.tick(1.0, 15) === null && s.tick(0.5, 15) === null, 'a target within 1.0 of the NPC sends nothing (DAT_0097dd2c)');
  check(s.tick(2, 15) === 'walk' && s.tick(2, 15) === 'walk', 'near the leash the walk start (6x40) is sent each tick, the run flag is not set');
  check(s.tick(20, 15) === 'run', 'beyond the leash a run (6x42) is sent and sets the run flag');
  check(s.tick(2, 15) === 'run', 'with the run flag set, the moves that stay near the leash are runs too');
  s.reset();
  check(s.tick(2, 15) === 'walk', 'a tick without a move clears the run flag (the next move walks again)');
  check(hexOf(buildNpcMove(0x1234, false, 1.5, -2)) === '40043412' + '0000c03f' + '000000c0' + '00000000', '6x40 for an NPC: header 40 04, caster id, f32 x, f32 z, u32 flags 0 (16 bytes)');
  check(hexOf(buildNpcMove(0x1234, true, 1.5, -2)) === '42033412' + '0000c03f' + '000000c0', '6x42 for an NPC: header 42 03, caster id, f32 x, f32 z (12 bytes)');
  const townSrc = readFileSync(join(HERE, '../client/src/quest/town.ts'), 'utf8');
  check(/sendNpcMove\(slot, send === 'run', goal\.x, goal\.z\)/.test(townSrc), 'the owner sends the NPC move at the head send target from stepNpcHead (town.ts)');
  check(/if \(st\.owner && row\)/.test(townSrc), 'only the owner sends the NPC move');
  const gameSrc = readFileSync(join(HERE, '../client/src/net/game.ts'), 'utf8');
  check(gameSrc.includes('this.conn.send(0x60, 0, buildNpcMove(npcId, run, x, z))'), 'game.ts sendNpcMove builds the 6x40 / 6x42 packet');
}

// --- the follow head (exe: SinowberillHead_AIUpdate_007b1134 .c:796128, CheckSpawnValidity_007b1220
// .c:796178, AIUpdateMovement_007b1298 .c:796204, AIUpdateState_007b267c .c:796915, UpdateState_007b00bc's
// Pioneer 2 branch .c:795492; the 2764 sends are read from the send target)
{
  const noWall = () => false;
  check(headSpawnRange(13) === 25 && headSpawnRange(18) === 30 && headSpawnRange(28) === 40 && headSpawnRange(50) === 40, 'spawn range: min(40, leash + 12) (DAT_0097dd8c / dd90)');
  const m = headMidpoint({ x: 0, y: 0, z: 0 }, { x: 10, y: 4, z: -6 });
  check(m.x === 5 && m.y === 2 && m.z === -3, 'midpoint of the NPC and the anchor, k = 0.5 (DAT_0097dd84)');

  // Pioneer 2: the anchor is the owner, the state is 1 (move), flag 0x20 with 0x1010 cleared.
  const h = new NpcHead();
  h.flags = 0x1010;
  h.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  check(h.state === HEAD_STATE_MOVE && h.flags === 0x20 && h.anchor.x === 50, 'Pioneer 2 update state: anchor = owner, state 1, flags 0x20 (0x1010 cleared)');

  // A far owner: the send target becomes the midpoint (25), and a run follows from the sender.
  let seenMask = -1;
  let wallAnswer = false;
  const wall = (_a: unknown, _b: unknown, mask: number) => {
    seenMask = mask;
    return wallAnswer;
  };
  h.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, leash: 13, wall });
  check(h.sendTarget.x === 25 && h.sendTarget.z === 0, 'a far owner: the send target is the midpoint (move needed: the last one was 0,0, more than 10 away)');
  check(seenMask === HEAD_WALL_MASK && HEAD_WALL_MASK === 0x2100, 'the wall ray uses mask 0x2100 (SinowberillHead_CheckWall_007b18e0)');
  check(h.wallHit === false, 'no wall: the wall flag is clear');
  const sender = new NpcMoveSender();
  check(headSendDistance(h, { x: 0, z: 0 }) === 25, 'the state-1 sends measure the distance from the send target to the NPC');
  check(sender.tick(25, 13) === 'run', 'a send target beyond the leash is a run (6x42)');

  // The NPC got closer to the midpoint: the new midpoint is within 10 of the last send target, so
  // the send target becomes the NPC's own position (no walk).
  h.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  h.update({ npc: { x: 20, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, leash: 13, wall: noWall });
  check(h.sendTarget.x === 20 && headSendDistance(h, { x: 20, z: 0 }) === 0, 'a midpoint within 10 of the last send target: no move (the send target is the NPC)');
  check(h.state === HEAD_STATE_MOVE, 'the state stays 1 while the Pioneer 2 update runs, so the 2764 check sees 0 and sends nothing');

  // Inside the spawn range: state 0 and flag 0x20 cleared; the send target is not written.
  const near = new NpcHead();
  near.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  near.update({ npc: { x: 30, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, leash: 13, wall: noWall });
  check(near.state === HEAD_STATE_IDLE && (near.flags & 0x20) === 0 && near.sendTarget.x === 0, 'inside the spawn range (20 < 25): state 0, flag 0x20 cleared, send target not written');
  check(headSendDistance(near, { x: 30, z: 0 }) === null, 'a head not in state 1 sends nothing (2764 state check)');

  // A short walk: the leash 25 keeps a walk (6x40) for a 20-unit send distance.
  const w = new NpcHead();
  w.pioneerUpdateState({ x: 40, y: 0, z: 0 });
  w.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 40, y: 0, z: 0 }, leash: 25, wall: noWall });
  check(w.sendTarget.x === 20 && new NpcMoveSender().tick(20, 25) === 'walk', 'a send distance within the leash is a walk (6x40)');

  // A wall between the NPC and the anchor: the answer is recorded (the branch is ASSUMED: the midpoint).
  const blocked = new NpcHead();
  blocked.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  wallAnswer = true;
  blocked.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, leash: 13, wall });
  check(blocked.wallHit === true && blocked.sendTarget.x === 25, 'a wall on the ray is recorded; the avoidance branch is not ported (ASSUMED midpoint)');

  // The cast states (HandlePlayerTechCastState_007b2bc0 .c:797215): Resta / Anti 0x16, Foie / Barta / Zonde 0x17, others 2.
  check(headCastInputState(0xf) === 0x16 && headCastInputState(0x10) === 0x16, 'Resta and Anti: input state 0x16');
  check(headCastInputState(0) === 0x17 && headCastInputState(3) === 0x17 && headCastInputState(6) === 0x17, 'Foie, Barta, Zonde: input state 0x17');
  check(headCastInputState(0x11) === 2 && headCastInputState(1) === 2 && headCastInputState(8) === 2, 'Reverser and the other techniques: input state 2');

  // The state-2 technique table (0x0097dcf8: 0, 1, 3, 4, 6, 8) and its tier (.c:797366..797380).
  check(HEAD_TWO_TECH_TABLE.join(',') === '0,1,3,4,6,8', 'the state-2 table is 0x0097dcf8 (Foie, Gifoie, Barta, Gibarta, Zonde, Razonde)');
  check(headTwoTier(0x4) === 0 && headTwoTier(0x8) === 1 && headTwoTier(0x10) === 2 && headTwoTier(0) === 0 && headTwoTier(0x1c) === 0, 'tier: 0x4 first (0), then 0x8 (1), 0x10 (2), else 0');
  check(headTwoTech(0, false, 0, 0) === 0 && headTwoTech(0, true, 0, 0) === 1, 'tier 0: Foie, or Gifoie when strong');
  check(headTwoTech(0x8, false, 0, 0) === 3 && headTwoTech(0x8, true, 0, 0) === 4, 'tier 1: Barta, or Gibarta when strong');
  check(headTwoTech(0x10, false, 0, 0) === 6 && headTwoTech(0x10, true, 0, 0) === 8, 'tier 2: Zonde, or Razonde when strong');
  check(headTwoTech(0, false, 5, 10) === null && headTwoTech(0, false, 0.5, 10) === 0, 'a weak roll above the head byte +0x53 * 0.1 skips the cast (.c:797388)');
  check(headTwoTech(0, true, 5, 10) === 1, 'a strong cast is not skipped by the roll');
  const combatSrc = readFileSync(join(HERE, '../client/src/render/combat.ts'), 'utf8');
  check(/npcWallBlocks\(from: \{[^}]*\}, to: \{[^}]*\}, mask: number\): boolean/.test(combatSrc), 'combat view exposes the NPC head wall ray with the mask');
  const townSrc2 = readFileSync(join(HERE, '../client/src/quest/town.ts'), 'utf8');
  check(townSrc2.includes('this.stepNpcHead(slot, p, leader, row.leash, sender)'), 'the owner follows through the head (town.ts stepNpcHead)');
  check(townSrc2.includes("if (send) this.game.sendNpcMove(slot, send === 'run', goal.x, goal.z);"), 'the 6x40 / 6x42 carry the head send target (goal = head.sendTarget)');
  check(townSrc2.includes('combat.npcWallBlocks(a, b, mask)'), 'the head wall ray comes from the combat view');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('npcai: ok');
