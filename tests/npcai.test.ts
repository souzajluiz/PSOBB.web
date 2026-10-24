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
  headCalculateTarget,
  headTwoTech,
  headTwoTier,
  acquireClosestTargets,
  HEAD_STATE_CAST,
  HEAD_STATE_IDLE,
  HEAD_STATE_MOVE,
  HEAD_TWO_TECH_TABLE,
  HEAD_WALL_MASK,
  HEAD_RAY_HEIGHT,
  HEAD_FLAG_ARRIVE,
  HEAD_FLAG_AVOID,
  HEAD_FLAG_BUBBLE,
  HEAD_FLAG_NEXT,
  HEAD_FLAG_WALL_CLAMP,
  headProbeEnemies,
  adjustTargetForCollision,
  calculateAvoidanceTarget,
  distancePointToLine,
  pointToSegmentDistance,
  rotYBams,
  updateTargetPosition,
  type WallHit,
  type PathTarget,
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
// A wall hit for the stubs (the object's point and its surface normal).
const HIT_ANY: WallHit = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
const HIT = { point: { x: 25, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } };

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
const headWith = (leash: number, extra: Partial<NpcHead> = {}): NpcHead => {
  const h = new NpcHead();
  h.configure({ acquireRange: 100, leash, farRadius: 30, attackRadius: 30, pathRadius: 100, flags34: 0, need52: 0, need53: 0, standOff: 50 });
  Object.assign(h, extra);
  return h;
};
{
  const noWall = () => null;
  check(headSpawnRange(13) === 25 && headSpawnRange(18) === 30 && headSpawnRange(28) === 40 && headSpawnRange(50) === 40, 'spawn range: min(40, leash + 12) (DAT_0097dd8c / dd90)');
  const m = headMidpoint({ x: 0, y: 0, z: 0 }, { x: 10, y: 4, z: -6 });
  check(m.x === 5 && m.y === 2 && m.z === -3, 'midpoint of the NPC and the anchor, k = 0.5 (DAT_0097dd84)');

  // Pioneer 2: the anchor is the owner, the state is 1 (move), flags 0xffffefef | 0x20 (0x10 clears, 0x1000 stays).
  const h = headWith(13);
  h.flags = 0x1010;
  h.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  check(h.state === HEAD_STATE_MOVE && h.flags === 0x20 && h.anchor.x === 50, 'Pioneer 2 update state: anchor = owner, state 1, flags & ~0x1010 | 0x20 (0xffffefef)');

  // A far owner: the send target becomes the midpoint (25), and a run follows from the sender.
  let seenMask = -1;
  let wallAnswer: WallHit | null = null;
  const wall = (_a: unknown, _b: unknown, mask: number) => {
    seenMask = mask;
    return wallAnswer;
  };
  h.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, wall });
  check(h.sendTarget.x === 25 && h.sendTarget.z === 0, 'a far owner: the send target is the midpoint (move needed: the last one was 0,0, more than 10 away)');
  check(seenMask === HEAD_WALL_MASK && HEAD_WALL_MASK === 0x2100, 'the wall ray uses mask 0x2100 (SinowberillHead_CheckWall_007b18e0)');
  check(h.wallHit === false, 'no wall: the wall flag is clear');
  const sender = new NpcMoveSender();
  check(headSendDistance(h, { x: 0, z: 0 }) === 25, 'the state-1 sends measure the distance from the send target to the NPC');
  check(sender.tick(25, 13) === 'run', 'a send target beyond the leash is a run (6x42)');

  // The NPC got closer to the midpoint: the new midpoint is within 10 of the last send target, so
  // the send target becomes the NPC's own position (no walk).
  h.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  h.update({ npc: { x: 20, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, wall: noWall });
  check(h.sendTarget.x === 20 && headSendDistance(h, { x: 20, z: 0 }) === 0, 'a midpoint within 10 of the last send target: no move (the send target is the NPC)');
  check(h.state === HEAD_STATE_MOVE, 'the state stays 1 while the Pioneer 2 update runs, so the 2764 check sees 0 and sends nothing');

  // Inside the spawn range: state 0, flag 0x20 cleared, the anchor is the NPC's weapon; the send target is not written.
  const near = headWith(13);
  near.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  near.update({ npc: { x: 30, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, wall: noWall });
  check(near.state === HEAD_STATE_IDLE && (near.flags & 0x20) === 0 && near.sendTarget.x === 0 && near.anchor.x === 30, 'inside the spawn range (20 < 25): state 0, flag 0x20 cleared, anchor = the NPC, send target not written');
  check(headSendDistance(near, { x: 30, z: 0 }) === null, 'a head not in state 1 sends nothing (2764 state check)');

  // A short walk: the leash 25 keeps a walk (6x40) for a 20-unit send distance.
  const w = headWith(25);
  w.pioneerUpdateState({ x: 40, y: 0, z: 0 });
  w.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 40, y: 0, z: 0 }, wall: noWall });
  check(w.sendTarget.x === 20 && new NpcMoveSender().tick(20, 25) === 'walk', 'a send distance within the leash is a walk (6x40)');

  // A wall on the NPC's ray (CheckWall_007b18e0): the owner's ray is clear, so the avoidance point beside the wall
  // (perp of the normal (-1,0,0) is (0,0,1), at the weapon, 1.5 * 25 = 37.5 out) is clear: the target is beyond
  // it, (0,0,5) (the owner's ray at the owner's closest point, 5 out). Flag 1 (avoid) is set.
  const clearHead = headWith(13);
  clearHead.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  wallAnswer = HIT;
  clearHead.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, wall: (f: { x: number; y: number; z: number }) => (f.y === HEAD_RAY_HEIGHT && f.x === 0 ? HIT : null) });
  check(clearHead.wallHit === true && Math.abs(clearHead.moveTarget.z - 5) < 1e-9 && Math.abs(clearHead.moveTarget.x) < 1e-9, 'a wall with a clear owner ray: the target is the point beyond the wall, (0,0,5) (CalculateAvoidanceTarget clear branch)');
  check((clearHead.flags & HEAD_FLAG_AVOID) !== 0, 'a wall hit sets flag 1 (the avoidance target is in use)');
  // A blocked owner ray: the step-back point (38 out from the avoidance target along the anchor direction, DAT_0097dd7c)
  // is the move, with the arrival flag 2 set.
  const blockedHead = headWith(13);
  blockedHead.pioneerUpdateState({ x: 50, y: 0, z: 0 });
  blockedHead.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, wall: (f: { x: number; y: number; z: number }) => (f.x === 50 || (f.y === HEAD_RAY_HEIGHT && f.x === 0) ? HIT : null) });
  check((blockedHead.flags & HEAD_FLAG_ARRIVE) !== 0 && (blockedHead.flags & HEAD_FLAG_AVOID) === 0 && blockedHead.moveTarget.x > 60, 'a blocked owner ray: the avoidance step (40 along the anchor direction) with the arrival flag 2');

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
  // The avoidance and the segment helpers (SinowberillHead_CalculatePointToSegmentDistance_007b20ac, AdjustTargetForCollision_007b25c0,
  // UpdateTargetPosition_007b1ad0, the BAMS rotation of matrix_rotation_y).
  const seg = pointToSegmentDistance({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
  check(seg.dist === 7 && seg.dir.x === -1, 'segment distance: two equal line distances take 7 and the mean direction (.c:796771)');
  const seg2 = pointToSegmentDistance({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 10 }, { x: 5, y: 0, z: 2 });
  check(seg2.dist === 15 && seg2.dir.x === -1 && seg2.dir.z === 0, 'segment distance: the nearer line (A, 2 away) gives B when B is farther: dist = (len B * 0.5 + 10 - door dist) + 10 (.c:796771)');
  check(distancePointToLine({ x: 5, y: 0, z: 2 }, { x: 10, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }).dist === 2, 'the distance to the infinite line through a point with a direction (GetDistancePointToLineSegment)');
  const pulled = adjustTargetForCollision({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, (_f, _t) => ({ point: { x: 0, y: 3, z: 10 }, normal: { x: 0, y: 1, z: 0 } }));
  check(pulled !== null && Math.abs(pulled.z - 0) < 1e-9 && pulled.y === 3, 'AdjustTargetForCollision: a hit pulls the target 10 back along the xz direction (DAT_0097dd38)');
  check(adjustTargetForCollision({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, () => null) === null, 'AdjustTargetForCollision: a clear ray keeps the target');
  const rot = rotYBams({ x: 1, y: 0, z: 0 }, 0x4000);
  check(Math.abs(rot.x) < 1e-9 && Math.abs(rot.z + 1) < 1e-9, 'matrix_rotation_y: +90 degrees (0x4000) turns (1,0,0) to (0,0,-1)');
  const ut = updateTargetPosition({ npc: { x: 0, y: 0, z: 10 }, anchor: { x: 0, y: 0, z: -30 }, rec: { vx: 0, vz: 0, type: 0, centre: { x: 0, y: 0, z: 0 }, heading: 0 }, counter: 0, ray: () => null });
  check(Math.abs(ut.x - 20 / Math.SQRT2) < 1e-9 && Math.abs(ut.z - 20 / Math.SQRT2) < 1e-9, 'UpdateTargetPosition, simple branch: 20 out from the centre along the side turned by the anchor (.c:796511)');

  // The per-tick reset (ResetEntityHitboxes_007b34e8): the bits clear every tick; the first tick places the move target.
  const rs = headWith(13);
  rs.npcNeed8c = 0x2a;
  rs.ownerNeed8c = 2;
  rs.resetEntityBits({ x: 7, y: 0, z: 9 });
  check(rs.npcNeed8c === 0 && rs.ownerNeed8c === 0, 'ResetEntityHitboxes: B and Q +0x8c clear every tick');
  check(rs.moveTarget.x === 7 && rs.moveTarget.z === 27 && rs.sendTarget.x === 7 && rs.initDone, 'the first tick: move target = owner + (0, 0, 18), send target = owner (UpdatePosition_007b3458)');
  rs.moveTarget = { x: 1, y: 0, z: 1 };
  rs.resetEntityBits({ x: 50, y: 0, z: 50 });
  check(rs.moveTarget.x === 1, 'the init runs once: later ticks keep the move target');
  // The probe's bits (7af7ec's loop): an enemy sets 0x80 (the counter stops), an object sets 0x20 and its record.
  const pr = headWith(13);
  pr.prevNpc = { x: 0, y: 0, z: 0 };
  pr.state = HEAD_STATE_MOVE;
  pr.headStateUpdate({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, cands: [], probe: () => ({ kind: 'enemy' }) });
  check((pr.npcNeed8c & 0x80) !== 0 && pr.wall8c === 0, 'the probe hits an enemy: B +0x8c bit 0x80, and the wall counter stays 0');
  const pr2 = headWith(13);
  pr2.prevNpc = { x: 0, y: 0, z: 0 };
  pr2.headStateUpdate({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, cands: [], probe: () => ({ kind: 'object', rec: { vx: 1, vz: 2, type: 0, centre: { x: 3, y: 0, z: 4 }, heading: 0 } }) });
  check((pr2.npcNeed8c & 0x20) !== 0 && pr2.record?.vx === 1, 'the probe hits an object: B +0x8c bit 0x20 and the collision record');

  // The chooser's head writes: flag 0x200 when B +0x8c has bit 2 and the owner's bit is in (bVar7 == 3).
  const fc = new NpcHeadChooser().choose(1, { owner90: 0, owner8c: 4, npc90: 0, npc8c: 4, head34: 0, head84: 0, hasTarget: false, hasItem: () => false, canCast: () => true, lockedInRadius: () => false });
  check(fc.flag200 === true && fc.attack === false, 'the chooser sets flag 0x200 when both need bits are in (.c:795912)');

  const combatSrc = readFileSync(join(HERE, '../client/src/render/combat.ts'), 'utf8');
  check(/npcWallHit\(from: \{[^}]*\}, to: \{[^}]*\}, mask: number\)/.test(combatSrc), 'combat view exposes the NPC head wall ray with the mask and the hit normal');
  const townSrc2 = readFileSync(join(HERE, '../client/src/quest/town.ts'), 'utf8');
  check(townSrc2.includes('this.stepNpcHead(slot, p, leader, row, sender)'), 'the owner follows through the head (town.ts stepNpcHead, the stat row)');
  check(townSrc2.includes("if (send) this.game.sendNpcMove(slot, send === 'run', goal.x, goal.z);"), 'the 6x40 / 6x42 carry the head send target (goal = head.sendTarget)');
  check(townSrc2.includes('combat.npcWallHit(a, b, mask)'), 'the head wall ray comes from the combat view (with the hit normal)');
}

// --- the stat rows and the head's fields (exe: DAT_00a02ea0 + row * 0x28, the constructor .c:794403..794413)
{
  const r0 = npcAttackRow(0)!;
  const r1 = npcAttackRow(1)!;
  const r3 = npcAttackRow(3)!;
  const r4 = npcAttackRow(4)!;
  check(r0.flags34 === 0x40 && r1.flags34 === 0x8 && r3.flags34 === 0x4, 'the head word +0x34 is the raw k=1 word: 0x40 (row 0), 0x8 (row 1), 0x4 (row 3)');
  check(r0.need52 === 15 && r0.need53 === 0 && r1.need52 === 25 && r1.need53 === 90 && r3.need52 === 60 && r3.need53 === 40, 'the need bytes: +0x52 = byte 2 and +0x53 = byte 3 of the raw k=8 word (row 0: 15 / 0, row 1: 25 / 90, row 3: 60 / 40)');
  check(r0.pathRadius === 100 && r4.pathRadius === 120 && r0.standOff === 50, 'the path radius is k=7 (+0x4c, 100 / 120) and the stand-off k=9 (+0x54, 50)');
  check(r0.farRadius === 30 && r0.attackRadius === 30, 'the far radius k=5 (+0x44) and the attack radius k=6 (+0x48) stay as before');
  const hh = headWith(13);
  check(hh.nearRadius === 30 && hh.pathRadius === 100 && hh.head34 === 0 && hh.standOff === 50, 'configure copies the row into the head record');
}

// --- the acquire (exe: EnemyAI_AcquireClosestTargetInRange_007af2a0 .c:794836; AcquireTarget_007afc2c .c:795255)
{
  const cands = [
    { id: 0x1001, x: 4, z: 0, boxes: [{ x: 4, z: 0, targetable: true }, { x: 50, z: 0, targetable: true }] },
    { id: 0x1002, x: 2, z: 0, boxes: [{ x: 2, z: 0, targetable: false }] },
    { id: 0x1003, x: 1, z: 0, boxes: [{ x: 1, z: 0, targetable: true }] },
  ];
  const got = acquireClosestTargets({ x: 0, y: 0, z: 0 }, 10, cands);
  check(got.length === 2 && got[0].id === 0x1003 && got[1].id === 0x1001 && got[1].id2 === 0, 'acquire: the targetable boxes within the range, nearest first (the untargetable box and the far box are left out)');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 0x1100 + i, x: i + 0.5, z: 0, boxes: [{ x: i + 0.5, z: 0, targetable: true }] }));
  check(acquireClosestTargets({ x: 0, y: 0, z: 0 }, 100, many).length === 9, 'acquire: at most 9 candidates (EnemyAI_AcquireClosestTargetInRange: the list stops at 9)');
  check(acquireClosestTargets({ x: 0, y: 0, z: 0 }, 1, [{ id: 1, x: 1, z: 0, boxes: [{ x: 1, z: 0, targetable: true }] }]).length === 0, 'acquire: the box distance must be below the range (strict)');

  // The head's state update: the B acquire sets B +0x8c bit 2 and the list; the moved test resets the counter.
  const a = headWith(13);
  a.headStateUpdate({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 5, y: 0, z: 0 }, cands });
  check((a.npcNeed8c & 2) !== 0 && a.targets.length === 3 && a.targets[0].id === 0x1003, 'UpdateState_007af7ec: a candidate within the acquire range sets B +0x8c bit 2 and the list (count at B+0)');
  check((a.ownerNeed8c & 2) !== 0, 'UpdateState_007af1a8: a candidate within 30 of the owner sets the owner bit 2');
  const quiet = headWith(13);
  quiet.headStateUpdate({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 500, y: 0, z: 0 }, cands: [] });
  check((quiet.npcNeed8c & 2) === 0 && quiet.targets.length === 0, 'no candidate: the list is empty and the bit 2 is not set');
  // The wall counter: standing still in state 1 counts up; a moved NPC resets it.
  const cnt = headWith(13, { prevNpc: { x: 0, y: 0, z: 0 }, wall8c: 5, wall8d: 5 });
  cnt.state = HEAD_STATE_MOVE;
  cnt.headStateUpdate({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, cands: [] });
  check(cnt.wall8c === 6 && cnt.wall8d === 6, 'the wall counter counts up in state 1 when the NPC did not move (UpdateState_007af7ec .c:795227)');
  cnt.headStateUpdate({ npc: { x: 3, y: 0, z: 0 }, owner: { x: 50, y: 0, z: 0 }, cands: [] });
  check(cnt.wall8c === 0 && cnt.wall8d === 0 && (cnt.npcNeed8c & 1) !== 0, 'a moved NPC resets the wall counter and sets B +0x8c bit 1 (CheckHeadDistance)');
}

// --- the attack (exe: SinowberillHead_TryAttack_007b0754 .c:795725, CheckPathAndTarget_007b086c .c:795775)
{
  // TryAttack: the owner's bit stops it; status 8 starts it; the far test is (P+0x44)^2 <= P+0x58.
  const ta = headWith(13, { ownerNeed8c: 2 });
  check(!ta.tryAttack({ npcStatus8: true }) && (ta.flags & 0x100) === 0, 'TryAttack: the owner busy returns 0 and clears the attack flag');
  const ts = headWith(13);
  check(ts.tryAttack({ npcStatus8: true }) && (ts.flags & 0x100) !== 0, 'TryAttack: status 8 on the NPC sets the attack flag');
  const tf = headWith(13, { dist58: 1000, targets: [{ id: 0x1001, id2: 0, pos: { x: 10, y: 0, z: 0 } }], npcPos: { x: 0, y: 0, z: 0 } });
  tf.tryAttack({ npcStatus8: false });
  tf.tryAttack({ npcStatus8: false });
  check(tf.counter66 === 2 && (tf.flags & 0x8000) === 0, 'TryAttack: the first two calls only count');
  tf.tryAttack({ npcStatus8: false });
  check(tf.counter66 === 0 && (tf.flags & 0x8080) === 0x8080, 'TryAttack: the third call re-picks; a target in attack radius sets 0x8080');

  // CheckPathAndTarget: the first candidate with a clear ray is locked; the anchor is the first candidate.
  const rayFirstBlocked = (_from: unknown, to: { x: number; z: number }, mask: number) => {
    check(mask === 0x2100, 'CheckPathAndTarget: the ray mask is 0x2100');
    return to.x === 30 && to.z === 0 ? HIT_ANY : null; // the first target is behind a wall
  };
  const targets = [
    { id: 1, id2: 2, pos: { x: 30, y: 0, z: 0 } },
    { id: 3, id2: 4, pos: { x: 0, y: 0, z: 40 } },
  ];
  const cp = headWith(13, { targets, pathRadius: 20 });
  const picked = cp.checkPathAndTarget({ npc: { x: 0, y: 0, z: 0 }, npcWeapon: { x: 0, y: 5, z: 0 }, ray: rayFirstBlocked });
  check(picked && cp.lockedPrimary === 3 && cp.lockedSecond === 4, 'CheckPathAndTarget: the second target is picked when the first is behind a wall');
  check((cp.flags & 0x1000) === 0 && cp.anchor.x === 30 && cp.anchor.z === 0, 'CheckPathAndTarget: the anchor is the first candidate; 30 (path 20 + 10) is not beyond 30 (no 0x1000)');
  const cp2 = headWith(13, { targets, pathRadius: 30 });
  cp2.checkPathAndTarget({ npc: { x: 0, y: 0, z: 0 }, npcWeapon: { x: 0, y: 5, z: 0 }, ray: () => null });
  check((cp2.flags & 0x1000) !== 0, 'CheckPathAndTarget: the far anchor (30 + 10 beyond the NPC) sets 0x1000');
  const cp3 = headWith(13);
  check(!cp3.checkPathAndTarget({ npc: { x: 0, y: 0, z: 0 }, npcWeapon: { x: 0, y: 0, z: 0 }, ray: () => null }) && (cp3.flags & 0x40) === 0, 'CheckPathAndTarget: no candidates: no target and no 0x40 (the exe skips the block under B count != 0)');
  const cp4 = headWith(13, { targets });
  check(!cp4.checkPathAndTarget({ npc: { x: 0, y: 0, z: 0 }, npcWeapon: { x: 0, y: 0, z: 0 }, ray: () => HIT_ANY }) && (cp4.flags & 0x40) !== 0, 'CheckPathAndTarget: every candidate blocked: flag 0x40');

  // UpdateAttackTarget (.c:796082): a second target with the stand-off bit pushes the anchor away from the NPC.
  const ua = headWith(13, { head34: 0x80, anchor: { x: 10, y: 0, z: 0 }, dist88: 25, standOff: 5 });
  ua.updateAttackTarget({ ownerWeapon: { x: 1, y: 2, z: 3 }, npc: { x: 0, y: 0, z: 0 }, secondTarget: true });
  check(Math.abs(ua.anchor.x - 5) < 1e-9 && ua.anchor.y === 2, 'UpdateAttackTarget: the second target pushes the anchor back by the stand-off (y from the owner)');
  ua.updateAttackTarget({ ownerWeapon: { x: 1, y: 2, z: 3 }, npc: { x: 0, y: 0, z: 0 }, secondTarget: false });
  check(ua.anchor.x === 1 && ua.anchor.z === 3, 'UpdateAttackTarget: no second target: the owner weapon position');
}

// --- the movement (exe: AIUpdateMovement_007b1298, AIUpdateState_007b267c, CalculateTarget_007b193c)
{
  // CalculateTarget (.c:796453): move (1, 0), anchor at (10, 10): the -90 side is used (z = -20).
  const ct = headCalculateTarget({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, { x: 1, z: 0 }, 0);
  check(Math.abs(ct.x) < 1e-9 && Math.abs(ct.z + 20) < 1e-9, 'CalculateTarget: the side away from the anchor, 20 units (-90 of the reversed move)');
  const ct2 = headCalculateTarget({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, { x: 1, z: 0 }, 0x14);
  check(Math.abs(ct2.z - 20) < 1e-9, 'CalculateTarget: a counter above 0x13 moves the target the other way');
  const ct3 = headCalculateTarget({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, z: 0 }, 0);
  check(ct3.x === 0 && ct3.z === 0, 'CalculateTarget: no movement keeps the NPC in place (no normalise on zero)');

  // The wall counter: at 0x1f the move is refused and the counter goes to 0x1e (AIUpdateState_007b267c).
  const clamp = headWith(13, { wall8c: 0x1f, anchor: { x: 100, y: 0, z: 0 } });
  clamp.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 100, y: 0, z: 0 }, wall: () => null });
  check(clamp.wall8c === 0x1e && (clamp.flags & 0x4000) !== 0, 'the wall counter at 0x1f refuses the move, sets 0x1e and flag 0x4000');
  check(clamp.sendTarget.x === 0 && clamp.sendTarget.z === 0, 'the refused move sends the NPC its own position');

  // The stuck band (15..29) takes CalculateTarget (AIUpdateMovement .c:796237..796244).
  const band = headWith(13, { wall8c: 15, anchor: { x: 30, y: 0, z: 30 }, moveRef: { x: -1, y: 0, z: 0 } });
  band.update({ npc: { x: 0, y: 0, z: 0 }, owner: { x: 30, y: 0, z: 30 }, wall: () => null });
  check(Math.abs(band.moveTarget.z + 20) < 1e-9 && Math.abs(band.moveTarget.x) < 1e-9, 'the wall band (counter 15) uses CalculateTarget for the move target');
}

// --- the field's update (exe: SinowberillHead_UpdateState_007b00bc, .c:795481: mode 0 tail .c:795669, mode 1 .c:795510)
{
  const base = {
    owner: { x: 0, y: 0, z: 0 },
    npc: { x: 40, y: 0, z: 0 },
    npcWeapon: { x: 40, y: 5, z: 0 },
    allowed: false,
    roll: 0,
    npcStatus8: false,
    ray: () => null,
    chooser: () => false,
  };
  // Mode 0, no B +0x8c bit 2: the chooser refuses, the NPC walks to the owner (UpdateAttackTarget), flag 0x20, mode stays 0.
  const follow = headWith(13);
  follow.fieldUpdate(base);
  check(follow.state === 1 && (follow.flags & 0x20) !== 0 && follow.anchor.x === 0 && follow.mode === 0, 'mode 0 tail, no acquire, no attack: the owner is the anchor, state 1, flag 0x20');
  // Mode 0 with B +0x8c bit 2: the mode entry (flags & 0xffffefcf, state 0, anchor = the NPC).
  const entry = headWith(13, { npcNeed8c: 2, flags: 0x1030 });
  entry.fieldUpdate(base);
  check(entry.mode === 1 && entry.state === 0 && (entry.flags & 0x1030) === 0 && entry.anchor.x === 40, 'mode 0 with B +0x8c bit 2: mode 1, flags 0xffffefcf (0x1000 / 0x20 / 0x10 cleared), state 0, anchor = the NPC');

  // Mode 1, TryAttack refused (the NPC is near its owner: no far test), nothing to lock: walk to the owner.
  const f1 = headWith(13, { mode: 1, npcNeed8c: 2, dist58: 0 });
  f1.fieldUpdate({ ...base, npc: { x: 0, y: 0, z: 0 } });
  check(f1.state === 1 && (f1.flags & 0x20) !== 0 && f1.mode === 1, 'mode 1 with no path: move, flag 0x20; mode 1 stays while B +0x8c bit 2 is set');
  check(f1.anchor.x === 0 && f1.anchor.z === 0, 'mode 1 with no path: the anchor is the NPC (the exe sets it to the NPC position)');

  // Mode 1, a far target with no wall and no cooldown: the candidate's position is the anchor; flag 0x1000 (within 110).
  const cast2 = headWith(13, { mode: 1, npcNeed8c: 2, dist58: 0, nearRadius: 30, pathRadius: 100 });
  cast2.targets = [{ id: 9, id2: 0, pos: { x: 50, y: 0, z: 0 } }];
  cast2.fieldUpdate({ ...base, npc: { x: 0, y: 0, z: 0 } });
  check(cast2.state === 2 && cast2.anchor.x === 50 && (cast2.flags & 0x1000) === 0 && (cast2.flags & 0x10) !== 0, 'mode 1: a candidate with a clear ray within 110 (flag 0x1000) and no cooldown: state 2 (cast), anchor on the candidate (.c:795560)');
  const far = headWith(13, { mode: 1, npcNeed8c: 2, dist58: 0, nearRadius: 30, pathRadius: 20 });
  far.targets = [{ id: 9, id2: 0, pos: { x: 50, y: 0, z: 0 } }];
  far.fieldUpdate({ ...base, npc: { x: 0, y: 0, z: 0 } });
  check(far.state === 1 && far.anchor.x === 50 && (far.flags & 0x1000) === 0, 'mode 1: a candidate beyond path + 10 (no 0x1000): the move to it (state 1)');
  // The strong path (flag 0x1000 kept) and the chooser refusing: state 2 (cast), flag 0x10, 0x1000 cleared.
  const strong = headWith(13, { mode: 1, npcNeed8c: 2, dist58: 0, nearRadius: 30, pathRadius: 100, flags: 0x1000 });
  strong.targets = [{ id: 9, id2: 0, pos: { x: 50, y: 0, z: 0 } }];
  strong.fieldUpdate({ ...base, npc: { x: 0, y: 0, z: 0 } });
  check(strong.state === 2 && (strong.flags & 0x10) !== 0 && (strong.flags & 0x1000) === 0, 'mode 1: the chooser refuses and the path is strong: state 2 (cast), flag 0x10, 0x1000 cleared');

  // Mode 1: the chooser (AIProcessState(1)) attacks within 30 of the owner: state 8, anchor at the NPC.
  const atk = headWith(13, { mode: 1, npcNeed8c: 2, dist58: 100 });
  atk.fieldUpdate({ ...base, npc: { x: 10, y: 0, z: 0 }, npcWeapon: { x: 10, y: 5, z: 0 }, chooser: (m) => m === 1 });
  check(atk.state === 8 && atk.anchor.x === 10 && (atk.flags & 0x1000) === 0, 'mode 1: an attack from the chooser: state 8, anchor at the NPC weapon (not the owner)');

  // The mode exit: B +0x8c bit 2 clear in mode 1 returns to mode 0 at the end of the update.
  const exit = headWith(13, { mode: 1, npcNeed8c: 0, dist58: 0 });
  exit.fieldUpdate(base);
  check(exit.mode === 0, 'mode 1 exits to mode 0 when B +0x8c bit 2 is clear (.c:795663)');

  // --- the input state (+0x24), its chat line and the timers. Exe: DisplayChatBubble_007b2a30 (.c:797110), the
  // 2764 state-0 block (.c:796983), the 0x800 branch (.c:794719), the move gate (.c:796915), the owner's timers
  // (UpdateState_007af1a8, .c:794785), HandlePlayerTechCastState (.c:797215), ExecuteAttack (.c:797151).
  {
    const h = headWith(13);
    h.setInputState(0x13);
    check(h.inputState === 0x13 && (h.flags & HEAD_FLAG_BUBBLE) !== 0, 'a change of +0x24 sets flag 4 (the chat line is due)');
    h.flags &= ~HEAD_FLAG_BUBBLE;
    h.setInputState(0x13);
    check((h.flags & HEAD_FLAG_BUBBLE) === 0, 'the same input state again does not set flag 4');
    const said: number[] = [];
    const line = (s: number) => {
      said.push(s);
      return s === 0x13 ? 'Hold on!' : null;
    };
    h.flags |= HEAD_FLAG_BUBBLE;
    check(h.bubbleStep(line) === 'Hold on!' && (h.flags & HEAD_FLAG_BUBBLE) === 0, 'the chat step: the line of +0x24 is returned and flag 4 is cleared');
    check(h.bubbleStep(line) === null && said.length === 1, 'no flag 4, no chat step (DisplayChatBubble is called only with flag 4)');
    const silent = headWith(13);
    silent.setInputState(0x12);
    check(silent.bubbleStep(() => null) === null && (silent.flags & HEAD_FLAG_BUBBLE) === 0, 'an empty situation line shows nothing and still clears flag 4');
    const high = headWith(13);
    high.setInputState(0x1a);
    check(high.bubbleStep(line) === null && high.inputState === 0x19, 'an input state above 0x18 goes to 0x19 with no line (.c:797117)');
    const old = headWith(13);
    old.setInputState(0x14);
    old.t5c = 400;
    check(old.bubbleStep(() => 'Still here') === 'Still here' && old.inputState === 0x19 && old.t5c === 0, 'more than 399 ticks in the state: the line, then input 0x19 (.c:797142)');
    // The idle counter of state 0: 0x1518 ticks to input 0xb (flag 4), then 0x1519 to 0x19; the counter restarts.
    const idle = headWith(13);
    idle.t64 = 0x1517;
    idle.idleStep();
    check(idle.t64 === 0x1518 && idle.inputState === 0xb && (idle.flags & HEAD_FLAG_BUBBLE) !== 0, 'idle counter: reaching 0x1518 sets input 0xb with flag 4 (.c:797001)');
    idle.idleStep();
    check(idle.t64 === 0 && idle.inputState === 0x19 && (idle.flags & HEAD_FLAG_BUBBLE) === 0, 'idle counter: 0x1519 sets input 0x19 without flag 4 and restarts at 0');
    const leave = headWith(13);
    leave.t64 = 500;
    leave.state = HEAD_STATE_MOVE;
    leave.afterDispatch();
    check(leave.t64 === 0, 'the idle counter clears when the head is not idle (.c:797053)');
    // The cast's input (HandlePlayerTechCastState): Resta / Anti 0x16, the Foie family 0x17, others 2; +0x5c clears.
    const cast = headWith(13);
    cast.t5c = 9;
    cast.castInput(15);
    check(cast.inputState === 0x16 && cast.t5c === 0, 'Resta casts into input 0x16 and clears +0x5c');
    cast.castInput(0);
    check(cast.inputState === 0x17, 'Foie (0) casts into input 0x17');
    cast.castInput(8);
    check(cast.inputState === 2, 'a tech outside those casts into input 2');
    const att = headWith(13);
    att.flags |= HEAD_FLAG_NEXT;
    att.attackInput();
    check(att.inputState === 0x13, 'the 0x200 attack sets input 0x13 (.c:797161)');
    // The 0x800 branch: the NPC dead, +0x62 counts to the 0x400 cap; input 4, then 5 past the cap.
    const dead = headWith(13);
    dead.deadStep({ x: 3, y: 0, z: 4 });
    check(dead.inputState === 4 && dead.t62 === 1 && dead.state === HEAD_STATE_IDLE && dead.anchor.x === 3 && dead.anchor.z === 4, 'dead NPC: input 4, +0x62 counts, idle, anchor at the NPC weapon');
    dead.t62 = 0x3ff;
    dead.deadStep({ x: 0, y: 0, z: 0 });
    check(dead.inputState === 4 && dead.t62 === 0x400, 'dead NPC: 0x3ff keeps input 4, the counter at 0x400');
    dead.deadStep({ x: 0, y: 0, z: 0 });
    check(dead.inputState === 5 && dead.t62 === 0x401, 'dead NPC: past the cap, input 5 (.c:794731)');
    // The move gate: the wall counter at 0x1f clamps (flag 0x4000, input 7, the 0x6a timer); at 0 with the flag, input 0x18.
    const clamp = headWith(13);
    clamp.wall8c = 0x1f;
    clamp.sendTarget = { x: 0, y: 0, z: 0 };
    clamp.moveTarget = { x: 50, y: 0, z: 0 };
    check(clamp['moveGate']() === false && clamp.inputState === 7 && (clamp.flags & HEAD_FLAG_WALL_CLAMP) !== 0 && clamp.wall8c === 0x1e && clamp.t6a === 1, 'move gate clamp: input 7, flag 0x4000, counter 0x1e, the 0x6a timer at 1');
    clamp.t6a = 299;
    clamp.wall8c = 0x1f;
    clamp['moveGate']();
    check(clamp.t6a === 0, 'the 0x6a timer wraps to 0 at 300 (.c:796950)');
    const back = headWith(13);
    back.flags |= HEAD_FLAG_WALL_CLAMP;
    back.wall8c = 0;
    back.sendTarget = { x: 0, y: 0, z: 0 };
    back.moveTarget = { x: 50, y: 0, z: 0 };
    check(back['moveGate']() === true && back.inputState === 0x18 && (back.flags & HEAD_FLAG_WALL_CLAMP) === 0, 'the clamp is released at counter 0: input 0x18, flag 0x4000 cleared (.c:796928)');
    // The owner's timers (UpdateState_007af1a8): status bit 2 counts +0x70 with input 9; status bit 8 with the acquire counts +0x6c with input 0xc.
    const own = headWith(13);
    own.ownerStep(0x2, false);
    check(own.inputState === 9 && own.t70 === 1, 'owner status 2: input 9 and the +0x70 timer');
    own.ownerStep(0x0, false);
    check(own.t70 === 0, 'owner without status 2: the +0x70 timer clears');
    own.ownerStep(0x8, true);
    check(own.inputState === 0xc && own.t6c === 1, 'owner status 8 with an acquire: input 0xc and +0x6c counts');
    own.ownerStep(0x8, false);
    check(own.t6c === 1, 'owner status 8 without an acquire: +0x6c does not count');
    own.t6e = 700;
    own.ownerStep(0x8, true);
    check(own.t6e === 0, 'owner acquire: +0x6e above 699 resets to 0 (.c:794835)');
    // CheckPathAndTarget: the counter at 100 writes input 0 (no status 8) or 1 (status 8) (.c:795801); a clear ray
    // locks the first candidate; a blocked one with no clear candidate writes input 8 (.c:795856).
    const three = (): PathTarget[] => [
      { id: 1, id2: 0, pos: { x: 5, y: 0, z: 0 } },
      { id: 2, id2: 0, pos: { x: 6, y: 0, z: 0 } },
      { id: 3, id2: 0, pos: { x: 7, y: 0, z: 0 } },
    ];
    const clear = () => null;
    const blocked = () => ({ point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });
    const p0 = headWith(13);
    p0.targets = three();
    p0.counter68 = 99;
    p0.inputState = 5;
    p0.checkPathAndTarget({ npc: { x: 0, y: 0, z: 0 }, npcWeapon: { x: 0, y: 0, z: 0 }, ray: clear });
    check(p0.inputState === 0 && p0.counter68 === 0, 'CheckPathAndTarget counter at 100 without status 8: input 0');
    const p1 = headWith(13);
    p1.targets = three();
    p1.counter68 = 99;
    p1.inputState = 5;
    p1.checkPathAndTarget({ npc: { x: 0, y: 0, z: 0 }, npcWeapon: { x: 0, y: 0, z: 0 }, ray: clear, npcStatus8: true });
    check(p1.inputState === 1, 'CheckPathAndTarget counter at 100 with status 8: input 1');
    const p2 = headWith(13);
    p2.targets = three();
    p2.inputState = 5;
    check(p2.checkPathAndTarget({ npc: { x: 0, y: 0, z: 0 }, npcWeapon: { x: 0, y: 0, z: 0 }, ray: blocked }) === false && p2.inputState === 8 && (p2.flags & 0x40) !== 0, 'CheckPathAndTarget with no clear candidate: input 8 and flag 0x40');
    // The collision probe (B+0xa8): an enemy within the cut-off (xz^2 <= 10000) whose box centre is within the probe radius (5) sets 0x80.
    check(headProbeEnemies({ x: 0, y: 0, z: 0 }, [{ x: 30, z: 40, boxes: [{ x: 30, z: 40 }] }]) === null, 'probe: an enemy 50 away with its box 50 away is no hit');
    const hit = headProbeEnemies({ x: 0, y: 0, z: 0 }, [{ x: 30, z: 40, boxes: [{ x: 3, z: 4 }] }]);
    check(hit !== null && hit.kind === 'enemy', 'probe: an enemy in the cut-off with a box centre 5 from the NPC is an enemy hit');
    check(headProbeEnemies({ x: 0, y: 0, z: 0 }, [{ x: 200, z: 0, boxes: [{ x: 1, z: 0 }] }]) === null, 'probe: an enemy beyond the cut-off is never tested');
    const townSrc = readFileSync(join(HERE, '../client/src/quest/town.ts'), 'utf8');
    check(townSrc.includes('probe: (at) => headProbeEnemies(at, cands)') && townSrc.includes('const standing = !p.moving;') && townSrc.includes('if (standing) {'), 'town: the probe runs in headStateUpdate, and the 2764 state actions wait for the standing bit');
    check(townSrc.includes('head.bubbleStep((situation) => this.npcSituationText(situation))') && townSrc.includes('this.ui.sayHead(slot, p.name, line'), 'town: the NPC line goes to the quest UI balloons (sayHead)');
    const qSrc = readFileSync(join(HERE, '../client/src/quest/questui.ts'), 'utf8');
    check(qSrc.includes('readonly headBubbles = new ChatBubbles();') && qSrc.includes('this.headBubbles.tick(headOf)') && qSrc.includes('this.headBubbles.draw(ctx,'), 'questui: the head lines are ticked and drawn over the NPC heads');
  }

  // The state-2 cast's gates and the field wiring in town.ts.
  const src = readFileSync(join(HERE, '../client/src/quest/town.ts'), 'utf8');
  check(src.includes('(head.head34 & 0x40) !== 0') && src.includes('headTwoTech(head.head34, false, (Math.floor(Math.random() * 32768) / 32768) * 10, head.need53)'), 'town: the state-2 cast is off for the 0x40 table word and rolls with the need byte +0x53');
  check(src.includes('if (this.isPioneer2()) {') && src.includes('head.fieldUpdate({') && src.includes('head.afterDispatch();'), 'town: the field branch runs fieldUpdate off Pioneer 2, and the 2764 resets run after the dispatch');
  const combatSrc2 = readFileSync(join(HERE, '../client/src/render/combat.ts'), 'utf8');
  check(/npcCastTechnique[\s\S]*?if \(isFireTech\(tech\)\)[\s\S]*?this\.spawnFire\(tech, level, from, me\.angle, listed, first/.test(combatSrc2), 'npcCastTechnique: the Foie family makes its object at the NPC and hits through spawnFire / techHitEnemy');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('npcai: ok');
