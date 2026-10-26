// NPC takeover: when an NPC player's owner leaves, the next client takes the NPC
// over (SinowberillChallenge_CheckAndReassignPlayer_007b46f8, dump .c:798768;
// the body re-read in objdump 0x007b46f8..0x007b4874 on 2026-10-25). The
// 6x69 receiver that makes the NPC (SinowberillChallenge_DispatchPacket_007b3f04)
// is the source of the globals below. The takeover is the only writer of the
// NPC flag 3 for a remote copy (flag 2).
//
// Traced (PsoBB.exe):
//  - The flag +0x32c of an NPC player is set by
//    SinowberillChallengePlayer_SetChallengeType_00686984 (objdump 0x686984..0x686a18):
//    type < 4 -> 1, 4 -> 2, 5 -> 3, 6 -> 6, 7 -> 7. player_constructor (0x686858)
//    calls it, and the 6x69 creator 0x00686258 reaches it. The 7 of
//    SinowberillChallengePlayer_Constructor_006859cc (.c:552337) is not on this
//    path (its only caller is 0x006abdb8).
//  - 6x69 command 0 / 3 (the dispatcher's create branch): the client named by
//    param1 (the owner) builds the NPC with type 5 (flag 3) and its AI; the others
//    build it with type 4 (flag 2) and no AI. So a non-owner copy is flag 2, the
//    one the takeover looks for.
//  - Command 0 (not 3) sets the globals: owner = param1 (u16 0x00aad650),
//    NPC slot = param2 (u16 0x00a03cc0), template = param3 (dword 0x00aad654). It
//    needs param1 != 0xffff, param2 != 0xffff and param2 != this client.
//  - 007b46f8, objdump order: the OPM flag word (0x00aab1cc, the dump names it
//    g_IsOpmFlag_00aab1ec) is 0; the owner slot is not 0xffff; GetPlayer(owner) is
//    null (the owner left). Then GetPlayer(NPC slot) must exist with +0x32c == 2,
//    else the globals reset (owner 0xffff, NPC 0xffff, template 0). Then the first
//    slot 0..3 that is not the NPC's and holds a player is the taker; if the taker
//    is this client: the owner becomes this client, the default 6x69 (command 2,
//    param1 = this client: SinowberillChallenge_SendPacket0x60_Default_007b4879, the
//    sender also runs the handler), the NPC's flag = 3, leader (+0x750) = this
//    client, +0x754 = template, and the AI object SinowberillChallengeBoss_Constructor_
//    007aea10 (this client, the NPC's player_idx, template, queue). The loop breaks at
//    the first player found, so another taker does nothing.
//
// ASSUMED (not traced):
//  - The trigger. The function has no direct call in the binary (no E8 / E9 to
//    0x007b46f8); its address is in a table at 0x00b4663c, and no reader of that
//    table was found. The port runs it when the leave notice (S->C 0x66, game.ts
//    'playerLeft') arrives, after the leaver is removed from the player map.
//  - OPM flag = false: the port has no one-person-mode flag.
//  - The default command 2's unused bytes (offsets 2, 6) are zero here.
//  - Who else is the NPC's owner after the takeover: the port's owner flag is the
//    AI's (quest/npcai.ts NpcAi.owner); the exe's owner test in 6x69 is param1 == self,
//    the port's local creation also counts (npcai.ts, unchanged).

export const TAKEOVER_NO_SLOT = 0xffff;
export const TAKEOVER_REMOTE_FLAG = 2; // a non-owner copy (type 4)
export const TAKEOVER_OWNER_FLAG = 3; // the owner's copy (type 5) and a taken-over NPC
const PLAYER_SLOTS = 4; // the loops run over slots 0..3 (.c:798765)

// The flag +0x32c that SetChallengeType gives a challenge type (objdump 0x686984..0x686a18).
export function challengeTypeFlag(type: number): number | null {
  if (type < 4) return 1;
  if (type === 4) return 2;
  if (type === 5) return 3;
  if (type === 6) return 6;
  if (type === 7) return 7;
  return null;
}

// The flag of an NPC made by 6x69 command 0 / 3: the owner (param1 == this client) is type 5, the others type 4.
export function createdNpcFlag(param1: number, self: number): number {
  return challengeTypeFlag(param1 === self ? 5 : 4) ?? TAKEOVER_REMOTE_FLAG;
}

// The globals 007b46f8 reads (g_SinowberillChallengePlayerIndex, _3, _2).
export interface TakeoverGlobals {
  owner: number;
  npcSlot: number;
  template: number;
}

export const NO_TAKEOVER: TakeoverGlobals = { owner: TAKEOVER_NO_SLOT, npcSlot: TAKEOVER_NO_SLOT, template: 0 };

export interface NpcCreateCommand {
  param1: number;
  param2: number;
  command: number;
  param3: number;
}

export type TakeoverStep =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'other'; taker: number }
  | { kind: 'take'; npcSlot: number };

export interface TakeoverInput {
  globals: TakeoverGlobals;
  opm: boolean; // g_IsOpmFlag (ASSUMED false)
  self: number; // this client's slot
  present: (slot: number) => boolean; // GetPlayer(slot) != null
  npcFlag: (slot: number) => number | undefined; // +0x32c of the NPC's player
}

// The decision of SinowberillChallenge_CheckAndReassignPlayer_007b46f8, without its writes.
export function takeoverStep(i: TakeoverInput): TakeoverStep {
  const g = i.globals;
  if (i.opm || g.owner === TAKEOVER_NO_SLOT || i.present(g.owner)) return { kind: 'none' };
  if (!i.present(g.npcSlot) || i.npcFlag(g.npcSlot) !== TAKEOVER_REMOTE_FLAG) return { kind: 'reset' };
  for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
    if (slot === g.npcSlot || !i.present(slot)) continue;
    return slot === i.self ? { kind: 'take', npcSlot: g.npcSlot } : { kind: 'other', taker: slot };
  }
  return { kind: 'none' };
}

// The client's NPC bookkeeping for the takeover: the globals (set by 6x69 command 0) and
// each NPC slot's flag (commands 0 / 3, the takeover).
export class NpcTakeover {
  private globals: TakeoverGlobals = NO_TAKEOVER;
  private readonly flags = new Map<number, number>();

  get state(): TakeoverGlobals {
    return this.globals;
  }

  flagOf(slot: number): number | undefined {
    return this.flags.get(slot);
  }

  // The 6x69 create branch (dispatcher 0x007b3f04): command 0 sets the globals and the flag,
  // command 3 sets the flag only. A slot of this client, or 0xffff, makes no NPC.
  noteCreate(c: NpcCreateCommand, self: number): void {
    if (c.param1 === TAKEOVER_NO_SLOT) return;
    if (c.command === 0) {
      if (c.param2 === self || c.param2 === TAKEOVER_NO_SLOT) return;
      this.globals = { owner: c.param1, npcSlot: c.param2, template: c.param3 };
      this.flags.set(c.param2, createdNpcFlag(c.param1, self));
    } else if (c.command === 3) {
      if (c.param2 === TAKEOVER_NO_SLOT) return;
      this.flags.set(c.param2, createdNpcFlag(c.param1, self));
    }
  }

  forget(slot: number): void {
    this.flags.delete(slot);
  }

  // Run on a player's leave (the owner test is the first step). A 'take' sets the globals' owner to
  // this client and the NPC's flag to 3; the caller sends the default command 2 and sets the leader.
  onPlayerLeft(present: (slot: number) => boolean, self: number): TakeoverStep {
    const step = takeoverStep({
      globals: this.globals,
      opm: false,
      self,
      present,
      npcFlag: (slot) => this.flags.get(slot),
    });
    if (step.kind === 'reset') this.globals = NO_TAKEOVER;
    if (step.kind === 'take') {
      this.globals = { ...this.globals, owner: self };
      this.flags.set(step.npcSlot, TAKEOVER_OWNER_FLAG);
    }
    return step;
  }
}
