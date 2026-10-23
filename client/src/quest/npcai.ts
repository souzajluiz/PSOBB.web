// NPC players' follow state (6x69 commands 1-3), the rules the exe applies in
// the 0x69 row of the 0x60 subcommand table (g_Packet0x60SubcommandTable row
// 0x69 = 0x007b3f04, SinowberillChallenge_DispatchPacket_007b3f04, .c:798360;
// the dump's Sinowberill names are community guesses, the body is the 6x69
// receiver). Body: {69, 03, u16 unused, u16 param1 (+4), u16 param2 (+6, the
// NPC's player slot), u16 command (+8), u16 param3 (+10, template)}.
//
// Traced (exe):
//  - command 0 / 3 (create): the NPC is a player object built with
//    SinowberillChallengePlayer_Constructor_00686258, whose constructor sets
//    unknown_flags_invincibility (+0x32c) = 7 and the leader (+0x750) = 0xffff
//    (.c:552273, .c:552337). The client named by param1 == its own slot is the
//    owner: it also builds the AI object (SinowberillChallengeBoss_Constructor_
//    007aea10, .c:798404); the others build only the player (.c:798452). Command 3
//    also runs Player_ProcessActionPacket on the new player (the action state).
//  - command 1 (stop acting): the player at slot param1 with flag 3 gets its
//    leader cleared (+0x750 = 0xffff, .c:798425).
//  - command 2 (start acting): every player in slots 0..3 with flag 3 gets
//    +0x750 = param1 (the leader to follow, .c:798433).
//  - flag 3 is set on an NPC when its owner leaves and the next client takes over
//    (SinowberillChallenge_CheckAndReassignPlayer_007b46f8, .c:798808), and the
//    leader it follows is the taking-over client's slot.
//  - a follower with a leader (+0x750 != 0xffff) moves to the leader's floor
//    when the leader changes floor (MapObject_ChangeFloor_00669bf8, .c:533036).
//
// ASSUMED (not traced): that command 2 reaches the NPCs made by command 0 / 3
// too (their flag is 7 in the constructor; what sets flag 3 for them is in the
// vtable init, not traced), so the quest's npc_play follows them here; the
// follow distance; the walk path (a straight line with the render-side
// followTick); the attack and target choice (not ported: the AI object's
// update is not traced); who syncs the NPC's position to the other clients
// (every client simulates the followers from the leaders' synced positions).

export const NPC_FLAG_CREATED = 7; // SinowberillChallengePlayer_Constructor_00686258 (.c:552337)
export const NPC_FLAG_FOLLOWER = 3; // 007b46f8 (.c:798808); the 6x69 command 1 / 2 gate (.c:798425, .c:798433)
export const NO_LEADER = 0xffff; // player +0x750 (.c:552273)
// ASSUMED: the distance a follower keeps from its leader, in units.
export const FOLLOW_DISTANCE = 3.0;
// ASSUMED: command 2 also starts the NPCs made by command 0 / 3 (see above).
export const FOLLOW_CREATED_NPCS = true;

export interface NpcControlCommand {
  param1: number;
  param2: number;
  command: number;
  param3: number;
}

export interface NpcAiState {
  flag: number;
  leader: number; // a player slot, or NO_LEADER
  owner: boolean; // param1 named this client when the NPC was created
}

// The NPC players of this client, by slot.
export class NpcAi {
  private readonly states = new Map<number, NpcAiState>();

  get(slot: number): NpcAiState | undefined {
    return this.states.get(slot);
  }

  slots(): number[] {
    return [...this.states.keys()];
  }

  // Command 0 / 3: a new NPC player in `slot`; `owner` when the sender named this client.
  create(slot: number, owner: boolean): void {
    this.states.set(slot, { flag: NPC_FLAG_CREATED, leader: NO_LEADER, owner });
  }

  remove(slot: number): void {
    this.states.delete(slot);
  }

  clear(): void {
    this.states.clear();
  }

  // Command 1: the NPC in `slot` stops following (exe: flag 3 only).
  stop(slot: number): boolean {
    const s = this.states.get(slot);
    if (!s || s.flag !== NPC_FLAG_FOLLOWER) return false;
    s.leader = NO_LEADER;
    return true;
  }

  // Command 2: every follower takes `leader` as its leader (exe: flag 3 only; see FOLLOW_CREATED_NPCS).
  follow(leader: number): number {
    let n = 0;
    for (const s of this.states.values()) {
      if (s.flag !== NPC_FLAG_FOLLOWER && !(FOLLOW_CREATED_NPCS && s.flag === NPC_FLAG_CREATED)) continue;
      s.leader = leader;
      n++;
    }
    return n;
  }

  // Applies one received or self-sent 6x69. Returns a short description for the log, or null.
  apply(c: NpcControlCommand, selfSlot: number): string | null {
    switch (c.command) {
      case 0:
      case 3: {
        const slot = c.param2;
        if (slot === 0xffff || slot === selfSlot) return null;
        this.create(slot, c.param1 === selfSlot);
        return c.command === 3 ? `attacker NPC in slot ${slot}` : `follower NPC in slot ${slot}`;
      }
      case 1:
        return this.stop(c.param1) ? `NPC ${c.param1} stops following` : `NPC ${c.param1} stop: not a follower`;
      case 2: {
        const n = this.follow(c.param1);
        return `${n} NPC(s) follow client ${c.param1}`;
      }
      default:
        return null;
    }
  }
}

// The follow point: the spot FOLLOW_DISTANCE from the leader on the line to the follower (ASSUMED shape).
export function followPoint(
  follower: { x: number; z: number },
  leader: { x: number; z: number },
): { x: number; z: number } {
  const dx = follower.x - leader.x;
  const dz = follower.z - leader.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= FOLLOW_DISTANCE || dist < 1e-6) return { x: follower.x, z: follower.z };
  return { x: leader.x + (dx / dist) * FOLLOW_DISTANCE, z: leader.z + (dz / dist) * FOLLOW_DISTANCE };
}
