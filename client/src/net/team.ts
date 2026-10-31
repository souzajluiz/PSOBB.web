// BB team commands (the EA family) on a game-server BBConnection.
//
// Wire format: the command is the u16 `(subcommand << 8) | 0xEA`, header.flag
// carries a result code or an argument, the payload follows. Client side
// layouts come from PsoBB.exe (Ephinea 1.25.13), the send_packet0xea_subcommand*
// functions at 0x007f2xxx..0x007f6xxx of the dump (each builds the header in
// place: `size`, byte 0xEA, byte subcommand, flag, payload) and the handler
// table pso_protocol_packet_ea_handler (0x00a0f800, 33 entries); the server
// layouts come from newserv src/CommandFormats.hh (EA: Team control) and
// ReceiveCommands.cc on_EA_BB / SendCommands.cc send_team_* (MIT).
//
// Client -> server (exe function, size, newserv handler):
//   01EA create team       sub 1     0x28  name UTF-16[0x10]           flag 0
//   03EA add member        sub 3     0x0C  guild card
//   05EA remove member     sub 5     0x0C  guild card (own card = leave)
//   07EA team chat         ...       0x28+ sender name[0x10], text     (zero terminated)
//   08EA member list       sub 8     0x08
//   0DEA team name         sub 0xd   0x08
//   0FEA set team flag     sub 0xf   0x808 flag_data u16[0x400]
//   10EA disband           sub 0x10  0x08
//   11EA privilege         sub 0x11  0x0C  guild card, flag = 0 / 0x30 / 0x40
//   13EA / 14EA            sub 0x13 / 0x14 (flag 1): team info of lobby players
//   18EA intra-team rank   sub 0x18  0x08
//   19EA / 1AEA            sub 0x19 / 0x1a: reward lists (owned / for sale)
//   1BEA buy reward        sub 0x1b  0x08, flag = reward id
//   1CEA cross-team rank   sub 0x1c  0x08
//   1EEA rename            sub 0x1e  0x28  flag = unused index, name UTF-16[0x10]
//   20EA                   sub 0x20  0x08  (the exe sends it; newserv has no handler)
// Server -> client (handler of the exe's table):
//   02EA / 1FEA create / rename result   flag: 0 ok, 2 name in use, 1 3..7 failed
//   04EA add member result               flag: 0 ok, 5 full, other: error
//   06EA / 10EA / 11EA operation result  flag: 0 ok, 5 "already" (11EA only), 1..6 failed
//   07EA team chat, 09EA member list, 0EEA team name, 12EA membership,
//   13EA / 15EA lobby team info, 18EA / 1CEA rankings, 19EA / 1AEA rewards,
//   1DEA reward flags (flag = bitmask)

import { readUtf16, type BBConnection, type Command } from './bbconnection.ts';

export const TEAM_CMD = {
  create: 0x01ea,
  createResult: 0x02ea,
  addMember: 0x03ea,
  addResult: 0x04ea,
  removeMember: 0x05ea,
  removeResult: 0x06ea,
  chat: 0x07ea,
  memberList: 0x08ea,
  memberListReply: 0x09ea,
  teamName: 0x0dea,
  teamNameReply: 0x0eea,
  setFlag: 0x0fea,
  disband: 0x10ea,
  privilege: 0x11ea,
  membership: 0x12ea,
  nearbyReply: 0x13ea,
  nearbyRequest: 0x14ea,
  nearbyUpdate: 0x15ea,
  intraRanking: 0x18ea,
  rewardsOwned: 0x19ea,
  rewardsForSale: 0x1aea,
  buyReward: 0x1bea,
  crossRanking: 0x1cea,
  rewardFlags: 0x1dea,
  rename: 0x1eea,
  renameResult: 0x1fea,
} as const;

// Privilege levels of a member (newserv Member::privilege_level; the exe's
// lists: promotion offers < 0x30, demotion 0 < p < 0x40, dismissal < 0x40).
export const PRIVILEGE = { member: 0x00, leader: 0x30, master: 0x40 } as const;

// Result codes in header.flag.
export const TEAM_RESULT = { ok: 0, generic: 1, nameInUse: 2, alreadyThere: 5 } as const;

export const TEAM_NAME_UNITS = 0x10;
export const FLAG_DATA_UNITS = 0x20 * 0x20;
export const TEAM_CHAT_MAX_UNITS = 0x8f; // "truncated by the client if longer than 0x8F wchar_ts"

export interface TeamPacket {
  command: number;
  flag: number;
  payload: Uint8Array;
}

function utf16(text: string, units: number): Uint8Array {
  const out = new Uint8Array(units * 2);
  const dv = new DataView(out.buffer);
  const s = [...text].slice(0, units - 1);
  s.forEach((c, i) => dv.setUint16(i * 2, c.charCodeAt(0), true));
  return out;
}

// The name goes out with the \tE marker the other lobby texts carry? The exe
// copies the typed text as is (wstrcpy of the editor's buffer, 0x10 units), so
// no marker: newserv decodes it with the client's language.
export function createTeamPacket(name: string): TeamPacket {
  return { command: TEAM_CMD.create, flag: 0, payload: utf16(name, TEAM_NAME_UNITS) };
}

export function addMemberPacket(guildCard: number): TeamPacket {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, guildCard, true);
  return { command: TEAM_CMD.addMember, flag: 0, payload };
}

// 05EA: the exe sends it for a dismissal and, with its own card, for leaving.
export function removeMemberPacket(guildCard: number): TeamPacket {
  return { ...addMemberPacket(guildCard), command: TEAM_CMD.removeMember };
}

// 11EA: flag = new privilege (0 demote, 0x30 promote, 0x40 transfer master).
export function privilegePacket(guildCard: number, privilege: number): TeamPacket {
  return { ...addMemberPacket(guildCard), command: TEAM_CMD.privilege, flag: privilege };
}

export const memberListPacket = (): TeamPacket => ({ command: TEAM_CMD.memberList, flag: 0, payload: new Uint8Array(0) });
export const teamNamePacket = (): TeamPacket => ({ command: TEAM_CMD.teamName, flag: 0, payload: new Uint8Array(0) });
export const disbandPacket = (): TeamPacket => ({ command: TEAM_CMD.disband, flag: 0, payload: new Uint8Array(0) });
export const intraRankingPacket = (): TeamPacket => ({ command: TEAM_CMD.intraRanking, flag: 0, payload: new Uint8Array(0) });
export const crossRankingPacket = (): TeamPacket => ({ command: TEAM_CMD.crossRanking, flag: 0, payload: new Uint8Array(0) });
// The exe asks with flag 1 (send_packet0xea_subcommand0x14).
export const nearbyTeamsPacket = (): TeamPacket => ({ command: TEAM_CMD.nearbyRequest, flag: 1, payload: new Uint8Array(0) });
export const rewardListPacket = (owned: boolean): TeamPacket => ({ command: owned ? TEAM_CMD.rewardsOwned : TEAM_CMD.rewardsForSale, flag: 0, payload: new Uint8Array(0) });
export const buyRewardPacket = (rewardId: number): TeamPacket => ({ command: TEAM_CMD.buyReward, flag: rewardId, payload: new Uint8Array(0) });

// 1EEA: the flag is "used, meaning unknown" (newserv); the exe passes the
// index of the selected purchase.
export function renameTeamPacket(name: string, index = 0): TeamPacket {
  return { command: TEAM_CMD.rename, flag: index, payload: utf16(name, TEAM_NAME_UNITS) };
}

// 0FEA: 32 x 32 u16 flag image (0x800 bytes).
export function setFlagPacket(flagData: Uint16Array): TeamPacket {
  if (flagData.length !== FLAG_DATA_UNITS) throw new Error(`team flag needs ${FLAG_DATA_UNITS} pixels`);
  const payload = new Uint8Array(FLAG_DATA_UNITS * 2);
  const dv = new DataView(payload.buffer);
  flagData.forEach((v, i) => dv.setUint16(i * 2, v, true));
  return { command: TEAM_CMD.setFlag, flag: 0, payload };
}

// 07EA (SendTeamOperationSuccessPacket 0x007f32ac): size
// ((len * 2 + 5) & ~3) + 0x28, sender name[0x10], then the zero terminated text
// (at most 0x80 units copied). newserv relays it only when the data ends with
// two zero bytes.
export function teamChatPacket(sender: string, text: string): TeamPacket {
  const body = [...text].slice(0, TEAM_CHAT_MAX_UNITS);
  const bytes = (body.length * 2 + 5) & ~3;
  const payload = new Uint8Array(0x20 + Math.max(4, bytes));
  payload.set(utf16(sender, TEAM_NAME_UNITS), 0);
  const dv = new DataView(payload.buffer);
  body.forEach((c, i) => dv.setUint16(0x20 + i * 2, c.charCodeAt(0), true));
  return { command: TEAM_CMD.chat, flag: 0, payload };
}

// --- parsers -----------------------------------------------------------------------

// PSOBBBaseTeamMembership (0x34): master gc, team id, two unknown dwords,
// privilege u8 (@+0x10), member count u8, two unknown bytes, name UTF-16[0x10].
export interface TeamMembership {
  masterGuildCard: number;
  teamId: number;
  unknownA5: number;
  unknownA6: number;
  privilege: number;
  memberCount: number;
  name: string;
}

export const NO_TEAM: TeamMembership = Object.freeze({ masterGuildCard: 0, teamId: 0, unknownA5: 0, unknownA6: 0, privilege: 0, memberCount: 0, name: '' });

export function parseMembership(data: Uint8Array, offset = 0): TeamMembership {
  if (data.length < offset + 0x34) return NO_TEAM;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    masterGuildCard: dv.getUint32(offset, true),
    teamId: dv.getUint32(offset + 4, true),
    unknownA5: dv.getUint32(offset + 8, true),
    unknownA6: dv.getUint32(offset + 12, true),
    privilege: data[offset + 0x10],
    memberCount: data[offset + 0x11],
    name: stripTeamMarker(readUtf16(data, offset + 0x14, TEAM_NAME_UNITS)),
  };
}

// The membership inside the E7 save data (PSOBBFullTeamMembership @0x315C).
export function membershipFromSave(save: Uint8Array | null): TeamMembership {
  return save ? parseMembership(save, 0x315c) : NO_TEAM;
}

// ShowTeamMainMenu: the player is in a team when any of the first four
// fields is nonzero.
export function inTeam(m: TeamMembership): boolean {
  return (m.masterGuildCard | m.teamId | m.unknownA5 | m.unknownA6) !== 0;
}

// UTF16_ALWAYS_MARKED strings start with "\tE" / "\tJ".
export function stripTeamMarker(s: string): string {
  return s.replace(/^\t[EJ]/, '');
}

// 12EA: u32 skip_update_system_file (nonzero: ignored, handle_packet0xEA_subcommand0x12
// only copies when it is 0) + membership. Null when the update is to be ignored.
export function parseMembershipUpdate(data: Uint8Array): TeamMembership | null {
  if (data.length < 0x38) return null;
  if (new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) !== 0) return null;
  return parseMembership(data, 4);
}

export interface TeamMember {
  rank: number;
  privilege: number;
  guildCard: number;
  name: string;
}

// 09EA: u32 count, entries of 0x2C {rank, privilege, guild card, name[0x10]}.
// The exe lists them as "<%04d> name" (s_ChallengePlayerItemFormat, see
// memberRowLabel); newserv colours by privilege.
export function parseMemberList(data: Uint8Array): TeamMember[] {
  if (data.length < 4) return [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = dv.getUint32(0, true);
  const out: TeamMember[] = [];
  for (let i = 0; i < count && 4 + (i + 1) * 0x2c <= data.length; i++) {
    const o = 4 + i * 0x2c;
    out.push({ rank: dv.getUint32(o, true), privilege: dv.getUint32(o + 4, true), guildCard: dv.getUint32(o + 8, true), name: stripTeamMarker(readUtf16(data, o + 12, TEAM_NAME_UNITS)) });
  }
  return out;
}

// ASSUMED format of s_ChallengePlayerItemFormat (the string is data in the
// exe; newserv documents the list as "<{:04}> {}" % (rank, name)).
export function memberRowLabel(m: TeamMember): string {
  return `<${String(m.rank).padStart(4, '0')}> ${m.name}`;
}

// 0EEA: 0x10 unused, name[0x10].
export function parseTeamName(data: Uint8Array): string {
  return data.length >= 0x30 ? stripTeamMarker(readUtf16(data, 0x10, TEAM_NAME_UNITS)) : '';
}

export interface TeamRank {
  name: string;
  points: number;
}

// 1CEA: u32 count, entries of 0x28 {name[0x10], points, unknown}. The exe's
// UpdateTeamRankingList reads the name at entry +0 and the points at +0x20.
export function parseCrossRanking(data: Uint8Array): TeamRank[] {
  if (data.length < 4) return [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = dv.getUint32(0, true);
  const out: TeamRank[] = [];
  for (let i = 0; i < count && 4 + (i + 1) * 0x28 <= data.length; i++) {
    const o = 4 + i * 0x28;
    out.push({ name: stripTeamMarker(readUtf16(data, o, TEAM_NAME_UNITS)), points: dv.getUint32(o + 0x20, true) });
  }
  return out;
}

export interface IntraRanking {
  rankingPoints: number;
  pointsRemaining: number;
  entries: Array<{ rank: number; privilege: number; guildCard: number; name: string; points: number }>;
}

// 18EA: {ranking points, unknown, points remaining, count} + entries of 0x30.
export function parseIntraRanking(data: Uint8Array): IntraRanking {
  const out: IntraRanking = { rankingPoints: 0, pointsRemaining: 0, entries: [] };
  if (data.length < 0x10) return out;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  out.rankingPoints = dv.getUint32(0, true);
  out.pointsRemaining = dv.getUint32(8, true);
  const count = dv.getUint32(12, true);
  for (let i = 0; i < count && 0x10 + (i + 1) * 0x30 <= data.length; i++) {
    const o = 0x10 + i * 0x30;
    out.entries.push({ rank: dv.getUint32(o, true), privilege: dv.getUint32(o + 4, true), guildCard: dv.getUint32(o + 8, true), name: stripTeamMarker(readUtf16(data, o + 12, TEAM_NAME_UNITS)), points: dv.getUint32(o + 0x2c, true) });
  }
  return out;
}

export interface TeamReward {
  name: string;
  description: string;
  teamPoints: number;
  rewardId: number;
}

// 19EA / 1AEA: u32 count, entries of 0x188 {name UTF-16[0x40], description
// UTF-16[0x80], points, id}.
export function parseRewardList(data: Uint8Array): TeamReward[] {
  if (data.length < 4) return [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = dv.getUint32(0, true);
  const out: TeamReward[] = [];
  for (let i = 0; i < count && 4 + (i + 1) * 0x188 <= data.length; i++) {
    const o = 4 + i * 0x188;
    out.push({ name: readUtf16(data, o, 0x40), description: readUtf16(data, o + 0x80, 0x80), teamPoints: dv.getUint32(o + 0x180, true), rewardId: dv.getUint32(o + 0x184, true) });
  }
  return out;
}

export interface LobbyTeamInfo {
  membership: TeamMembership;
  guildCard: number;
  clientId: number;
  name: string;
}

// 13EA / 15EA: flag = count, entries of 0x85C {membership, gc, client id,
// name[0x10], flag data u16[0x400]}.
export function parseLobbyTeamInfo(cmd: Command): LobbyTeamInfo[] {
  const out: LobbyTeamInfo[] = [];
  const d = cmd.data;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  for (let i = 0; i < cmd.flag && (i + 1) * 0x85c <= d.length; i++) {
    const o = i * 0x85c;
    out.push({ membership: parseMembership(d, o), guildCard: dv.getUint32(o + 0x34, true), clientId: dv.getUint32(o + 0x38, true), name: stripTeamMarker(readUtf16(d, o + 0x3c, TEAM_NAME_UNITS)) });
  }
  return out;
}

// 07EA as received: sender name[0x10] + zero terminated text.
export function parseTeamChat(data: Uint8Array): { sender: string; text: string } {
  return { sender: stripTeamMarker(readUtf16(data, 0, TEAM_NAME_UNITS)), text: stripTeamMarker(readUtf16(data, 0x20, (data.length - 0x20) >> 1)) };
}

// --- the connection side -----------------------------------------------------------

export class TeamError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

// Keeps the team state of one game-server connection (the exe's
// g_pKeyTeamConfig) and sends the EA requests. Replies are claimed with
// BBConnection.waitFor, so a request has to finish before the next one of the
// same command starts.
export class TeamClient {
  membership: TeamMembership;
  // Team chat lines received (07EA).
  onChat: (sender: string, text: string) => void = () => {};
  // The membership changed (12EA).
  onMembership: (m: TeamMembership) => void = () => {};
  // The team rewards bitmask (1DEA, header.flag; the exe keeps it at g_pKeyTeamConfig + 0xaec, the
  // handler 0x007c4f40). Bit 0 is the team flag (the Master Menu's Team Flag Records row).
  rewardFlags = 0;
  onRewardFlags: (flags: number) => void = () => {};
  private readonly conn: BBConnection;
  private readonly self: number;

  // `selfGuildCard`: newserv does not send the leaver a 12EA after 05EA, so a
  // successful removal of the own card clears the membership here (ASSUMED:
  // the exe's leave path was not seen clearing g_pKeyTeamConfig; a new login
  // gets the real state from the E7 save data).
  constructor(conn: BBConnection, initial: TeamMembership = NO_TEAM, selfGuildCard = 0) {
    this.conn = conn;
    this.membership = initial;
    this.self = selfGuildCard;
    const prev = conn.onCommand;
    conn.onCommand = (c) => {
      prev(c);
      this.handle(c);
    };
  }

  private handle(c: Command): void {
    if (c.command === TEAM_CMD.membership) {
      const m = parseMembershipUpdate(c.data);
      if (m) {
        this.membership = m;
        this.onMembership(m);
      }
    } else if (c.command === TEAM_CMD.chat) {
      const { sender, text } = parseTeamChat(c.data);
      this.onChat(sender, text);
    } else if (c.command === TEAM_CMD.rewardFlags) {
      this.rewardFlags = c.flag >>> 0;
      this.onRewardFlags(this.rewardFlags);
    }
  }

  private send(p: TeamPacket): void {
    this.conn.send(p.command, p.flag, p.payload);
  }

  private async ask(p: TeamPacket, reply: number, timeoutMs = 5000): Promise<Command> {
    while (this.conn.poll(reply)); // stale answers must not satisfy this request
    this.send(p);
    return withTimeout(this.conn.waitFor(reply), timeoutMs, `no answer to ${p.command.toString(16)}`);
  }

  // 01EA -> 02EA. Resolves with the result code (0 = created).
  async createTeam(name: string): Promise<number> {
    return (await this.ask(createTeamPacket(name), TEAM_CMD.createResult)).flag;
  }

  // 1EEA -> 1FEA.
  async renameTeam(name: string, index = 0): Promise<number> {
    return (await this.ask(renameTeamPacket(name, index), TEAM_CMD.renameResult)).flag;
  }

  // 05EA -> 06EA (the exe sends its own guild card to leave).
  async removeMember(guildCard: number): Promise<number> {
    const result = (await this.ask(removeMemberPacket(guildCard), TEAM_CMD.removeResult)).flag;
    if (result === TEAM_RESULT.ok && guildCard === this.self) {
      this.membership = NO_TEAM;
      this.onMembership(NO_TEAM);
    }
    return result;
  }

  // 03EA -> 04EA.
  async addMember(guildCard: number): Promise<number> {
    return (await this.ask(addMemberPacket(guildCard), TEAM_CMD.addResult)).flag;
  }

  // The invitee's wait for the add-member result after an accept (04EA, add_member_result_handler
  // 0x00a0...; the exe's prompt state 7 waits for it with no time-out). Null when none comes in time
  // (ASSUMED: the time-out is the port's, the exe has none).
  joinResult(timeoutMs = 10000): Promise<number | null> {
    return withTimeout(this.conn.waitFor(TEAM_CMD.addResult), timeoutMs, 'no join result').then(
      (c) => c.flag,
      () => null,
    );
  }

  // 11EA -> 11EA (header.flag = result).
  async setPrivilege(guildCard: number, privilege: number): Promise<number> {
    return (await this.ask(privilegePacket(guildCard, privilege), TEAM_CMD.privilege)).flag;
  }

  // 10EA -> 10EA.
  async disband(): Promise<number> {
    return (await this.ask(disbandPacket(), TEAM_CMD.disband)).flag;
  }

  // 08EA -> 09EA.
  async members(): Promise<TeamMember[]> {
    return parseMemberList((await this.ask(memberListPacket(), TEAM_CMD.memberListReply)).data);
  }

  // 0DEA -> 0EEA.
  async name(): Promise<string> {
    return parseTeamName((await this.ask(teamNamePacket(), TEAM_CMD.teamNameReply)).data);
  }

  // 1CEA -> 1CEA.
  async crossRanking(): Promise<TeamRank[]> {
    return parseCrossRanking((await this.ask(crossRankingPacket(), TEAM_CMD.crossRanking)).data);
  }

  // 18EA -> 18EA.
  async intraRanking(): Promise<IntraRanking> {
    return parseIntraRanking((await this.ask(intraRankingPacket(), TEAM_CMD.intraRanking)).data);
  }

  // 14EA -> 15EA.
  async nearby(): Promise<LobbyTeamInfo[]> {
    return parseLobbyTeamInfo(await this.ask(nearbyTeamsPacket(), TEAM_CMD.nearbyUpdate));
  }

  // 19EA / 1AEA.
  async rewards(owned: boolean): Promise<TeamReward[]> {
    return parseRewardList((await this.ask(rewardListPacket(owned), owned ? TEAM_CMD.rewardsOwned : TEAM_CMD.rewardsForSale)).data);
  }

  setFlag(flagData: Uint16Array): void {
    this.send(setFlagPacket(flagData));
  }

  // 1BEA. The exe does not wait (send_packet0xea_subcommand0x1b); newserv answers nothing and drops
  // a client that cannot pay, so the window greys the rows the team cannot afford.
  buyReward(rewardId: number): void {
    this.send(buyRewardPacket(rewardId));
  }

  chat(sender: string, text: string): void {
    this.send(teamChatPacket(sender, text));
  }
}

// --- Team invite (Home menu > Team > Invite, 0x29) and Point Regist (0x2d) -------------------
//
// Invite is a peer message, not a team command. The 6xC1 INVITE is built inline by the Invite
// window's state 3 (exe 0x0074d0e3, the send after the lobby card match at 0x0074ce43); it does
// not copy any global. Layout (0x5C bytes, size word 0x17 dwords; relayed by 0x62 to the picked
// client id: 0x00800464 -> 0x007d3fcc, body size = buffer[1] * 4):
//   +0 u8 0xC1, +1 u8 0x17, +2 u16 NOT written by the exe (stack garbage; ours sends the sender id),
//   +4 u32 the window's +0x20 = the inviter's own player slot (0x0074d128; PROVEN as the slot the answer
//      relays to, see inviteSubcommand; the picked card is not sent),
//   +8 u32 action 0 = invite (the exe's withdraw is 1: 0x0074c7fd, header + action 1 only),
//   +0xC inviter name, 0x18 UTF-16 units (0x006936b4 result, ASSUMED the local player's name),
//   +0x3C team name, 0x10 units (copied max 0xF units from the global string 0x00a9ab78, ASSUMED).
// newserv's G_TeamInvitationAction_BB_6xC1_6xC2_6xCD_6xCE (CommandFormats.hh 5855) is the same
// shape with action "0 or 1 for 6xC1", so no conflict on the 6xC1 layout.
//
// The receiver of 6xC1 is 0x0078bc44 (the 0x60 table row C1 at file 0x0060ed04, ASSUMED from the
// 8-byte row stride to the C2 row at 0x0060ed0c). Action 1 sets 0x00a9c8c4 = 1
// (withdrawn). Action 0 passes a gate (0x007917b8); when it accepts, 0x0078bddf copies the body
// (+4..+0x5B) into the global 0x00a9c8c0 (58 bytes) and sets 0x00a98474 |= 0x10 (invite pending).
// When the gate refuses, the exe answers itself with a 6xC2 built as: +4 0, +8 4, name and team
// copied from the packet (ASSUMED reading, the copy is not fully traced).
//
// The 6xC2 ANSWER (the invitee's prompt, DEVLOG 2026-10-25 "Team invite answer: Yes is 2"). Its
// receiver 0x0078be84 (the 0x60 row C2) accepts only action == 2: it copies the body (+4..+0x5B) into
// the global 0x00a9c8c0 and sets 0x00a98474 |= 0x20. Any other action stores 0x00a9c8c4 = action and
// the name at 0x00a9c8c8 (declined). The invitee's senders, found by the C2 byte writes in the exe:
//   Yes (second confirm)   action 2   TeamFlagMenu_Update (dump 0x00722428) list value 0 at state 6:
//                                     body = the global copy, +4 = the player's own card (player +0xeb4),
//                                     +8 = 2 (0x00722c98), +0xC = own name, relayed to the global's +4 word.
//   No / cancel            action 3   the same function: list value 1 (0x007235a3, +8 = 3) and the cancel
//                                     bit (state 6 flag 4, and the first prompt's No, 0x00722a59).
//   timeout (900 frames)   action 4   the countdown reaches 0 (0x00722d26 builds +8 = 4 at 0x00722e30).
//   busy / gate refused    action 4   0x0078bc44 refuse path (+4 = 0, +8 = 4) and 0x00717754 when the
//                                     menu is busy (+8 = 4 at 0x007177cc). The inviter's window state 8
//                                     (0x0074ca78, global copy, +8 = 4) is a withdrawal: 4 means "not 2".
// So 4 is never an accept: the earlier "CONFLICT" (the invitee-side literal 4) was the refusal, not Yes.
// Other C2 senders (0x00722230 family) copy the global unchanged, so +8 is the stored action.
//
// On accept the inviter sends 03EA with that card (FUN_007f323c) and waits for 04EA (the flag).
//
// Point Regist (0x2d) sends 6xCC: [0xCC, 3, sender id (u16 at +2), item id u32, amount u32]
// (send_packet0x60_subcommand0xcc, dump 570353; sent only in a game, newserv
// on_exchange_item_for_team_points_bb).

export const TEAM_INVITE_SUB = 0xc1;
export const TEAM_INVITE_ANSWER_SUB = 0xc2;
export const TEAM_INVITE_SIZE = 0x5c;
export const TEAM_INVITE_ACCEPT = 2;
export const TEAM_POINTS_SUB = 0xcc;
export const TEAM_POINTS_SIZE = 0x0c;
const INVITE_NAME_UNITS = 0x18;

// The inviter's 6xC1 body; the caller targets it at the picked player's client id (0x62 flag).
// +4 is the inviter's own player slot (PROVEN 2026-10-25: 0x0074d128 stores the window's +0x20, the
// slot the window passes to GetPlayer at 0x0074ce17, and the invitee relays its 6xC2 to that word;
// the window's +0x20 is the menu owner's slot, ASSUMED). It is not the picked card.
export function inviteSubcommand(o: { selfId: number; name: string; teamName: string; action?: number }): Uint8Array {
  const b = new Uint8Array(TEAM_INVITE_SIZE);
  const dv = new DataView(b.buffer);
  b[0] = TEAM_INVITE_SUB;
  b[1] = TEAM_INVITE_SIZE / 4;
  dv.setUint16(2, o.selfId, true);
  dv.setUint32(4, o.selfId >>> 0, true);
  dv.setUint32(8, (o.action ?? 0) >>> 0, true);
  b.set(utf16(o.name, INVITE_NAME_UNITS), 0x0c);
  b.set(utf16(o.teamName, TEAM_NAME_UNITS), 0x3c);
  return b;
}

// The 6xC2 answer as received: the accepter's card and the action.
export function parseInviteAnswer(body: Uint8Array): { guildCard: number; action: number } {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { guildCard: dv.getUint32(4, true), action: dv.getUint32(8, true) };
}

export const TEAM_INVITE_DECLINE = 3;
export const TEAM_INVITE_TIMEOUT = 4;
// The exe's countdown of each prompt (the window's +0x28 is set to 900 on entry and drops by one per frame).
export const INVITE_ANSWER_FRAMES = 900;

// The invitee's 6xC2 answer. `invite` is the received 6xC1 body (0x5C bytes, the header included): the
// exe copies its +4..+0x5B into the global and the answer keeps that copy, then writes the player's own
// card at +4, the action at +8 and the own name (16 units, wcsncpy) at +0xC. The team name at +0x3C stays
// from the invite. The relay target is the invite's +4 word (the exe pushes the global's first dword).
export function inviteAnswerSubcommand(o: { invite: Uint8Array; ownCard: number; ownName: string; action: number }): Uint8Array {
  const b = new Uint8Array(TEAM_INVITE_SIZE);
  b[0] = TEAM_INVITE_ANSWER_SUB;
  b[1] = TEAM_INVITE_SIZE / 4;
  b.set(o.invite.subarray(4, TEAM_INVITE_SIZE), 4);
  const dv = new DataView(b.buffer);
  dv.setUint32(4, o.ownCard >>> 0, true);
  dv.setUint32(8, o.action >>> 0, true);
  b.set(utf16(o.ownName, 0x10), 0x0c);
  return b;
}

// The relay target of an invite (the 6xC1 body's +4 word, see inviteAnswerSubcommand).
export function inviteTarget(invite: Uint8Array): number {
  return new DataView(invite.buffer, invite.byteOffset, invite.byteLength).getUint32(4, true);
}

export const TEAM_INVITE_INVITE = 0; // 6xC1 action 0: the invite (0x0078bc44 keeps it when the gate opens)
export const TEAM_INVITE_WITHDRAW = 1; // 6xC1 action 1: the inviter withdrew it (0x0078bd54 sets 0x00a9c8c4)
// The refusal the receiver answers with at once (0x0078bd39): the body with +4 = 0 and +8 = 4.
export const TEAM_INVITE_REFUSED = 4;
const INVITE_NAME_BYTES = 0x30; // the inviter's name at +0xC is 0x18 units (0x006936b4 result)

// The invite as the receiver keeps it (the global copy of +4..+0x5B, 0x00a9c8c0).
export interface InviteRequest {
  body: Uint8Array;
  target: number; // +4: the inviter's slot, the relay target of the answer (PROVEN, see inviteSubcommand)
  inviterName: string; // +0xC, unitxt 11 0x14a's first argument (ASSUMED order)
  teamName: string; // +0x3C, its second argument
}

export function parseInviteRequest(body: Uint8Array): InviteRequest {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    body: body.slice(0, TEAM_INVITE_SIZE),
    target: dv.getUint32(4, true),
    inviterName: stripTeamMarker(readUtf16(body, 0x0c, INVITE_NAME_BYTES / 2)),
    teamName: stripTeamMarker(readUtf16(body, 0x3c, TEAM_NAME_UNITS)),
  };
}

// The 6xC2 built from a received invite: the body's +4..+0x5B copied, then the word at +8 set.
function answerFromInvite(invite: Uint8Array, card: number | null, action: number): Uint8Array {
  const b = new Uint8Array(TEAM_INVITE_SIZE);
  b[0] = TEAM_INVITE_ANSWER_SUB;
  b[1] = TEAM_INVITE_SIZE / 4;
  b.set(invite.subarray(4, TEAM_INVITE_SIZE), 4);
  const dv = new DataView(b.buffer);
  if (card !== null) dv.setUint32(4, card >>> 0, true);
  dv.setUint32(8, action >>> 0, true);
  return b;
}

// The receiver's refuse path (0x0078bc44, 0x0078bd31 / 0x0078bd39): +4 = 0, +8 = 4, the name kept.
export function inviteRefusal(invite: Uint8Array): Uint8Array {
  return answerFromInvite(invite, 0, TEAM_INVITE_REFUSED);
}

// The quick menu's busy answer (0x00717754, LAB_007177bd): the kept body, +4 unchanged, +8 = 4.
export function inviteBusyAnswer(invite: Uint8Array): Uint8Array {
  return answerFromInvite(invite, null, TEAM_INVITE_REFUSED);
}

// The receive side of 6xC1 (0x0078bc44) and the quick menu's pending check (0x00717754). `receive`
// is the 6xC1 arriving; `free` stands for the receiver's gate (0x007917b8 reads the byte 0x009ff3d4;
// ASSUMED: free when no other menu is open) and the busy checks (0x00689410, the menu's vtable +0x8c,
// the player's +0x2b8..+0x2c4 state; ASSUMED). A refused invite is answered at once; an accepted one
// stays pending until the menu can show it (busyTick). `close` ends it (the exe's
// QuickMenuObject_CloseTeamFlagMenu_007162e4 clears the 0x10 bit).
export class TeamInviteReceiver {
  pending: InviteRequest | null = null;
  // 0x00a9c8c4: the inviter withdrew the invite (the prompt shows the cancelled message).
  withdrawn = false;

  receive(body: Uint8Array, free: boolean): { answer: Uint8Array; target: number } | null {
    if (body.length < TEAM_INVITE_SIZE) return null;
    const action = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(8, true);
    if (action === TEAM_INVITE_WITHDRAW) {
      this.withdrawn = true;
      return null;
    }
    if (action !== TEAM_INVITE_INVITE) return null;
    if (!free || this.pending) return { answer: inviteRefusal(body), target: inviteTarget(body) };
    this.pending = parseInviteRequest(body);
    this.withdrawn = false; // ASSUMED: a new invite starts clean
    return null;
  }

  // Per frame (0x00717754): a pending invite the menus cannot show now is answered busy and dropped.
  busyTick(canOpen: boolean): { answer: Uint8Array; target: number } | null {
    if (!this.pending || canOpen) return null;
    const invite = this.pending;
    this.close();
    return { answer: inviteBusyAnswer(invite.body), target: invite.target };
  }

  close(): void {
    this.pending = null;
    this.withdrawn = false;
  }
}

// The invitee's prompt as a pure model of the exe's two Yes/No lists (TeamFlagMenu_Update, dump
// 0x00722428; the first list's No is the default cursor, SetSelection(1), as in the other prompts):
//   ask      Yes -> notice; No or cancel -> decline (3)
//   notice   the one-line message (unitxt 11, 0x14b, ASSUMED) closes on a key -> confirm
//   confirm  Yes -> accept (2); No or cancel -> decline (3)
// Either Yes/No prompt times out after INVITE_ANSWER_FRAMES frames -> 4. The window that drives it
// (classic/teammenu.ts TeamInviteAnswerWindow) adds the intro key and the texts; the answers are the exe's.
export class InviteAnswerPrompt {
  phase: 'ask' | 'notice' | 'confirm' | 'done' = 'ask';
  action: number | null = null;
  private frames = INVITE_ANSWER_FRAMES;

  private finish(action: number): void {
    this.phase = 'done';
    this.action = action;
  }

  // Yes = true (the first list's and the second list's "Yes" row), cancel = Escape / the cancel key.
  choose(yes: boolean): void {
    if (this.phase === 'ask') {
      if (yes) {
        this.phase = 'notice';
        this.frames = INVITE_ANSWER_FRAMES;
      } else this.finish(TEAM_INVITE_DECLINE);
    } else if (this.phase === 'confirm') {
      this.finish(yes ? TEAM_INVITE_ACCEPT : TEAM_INVITE_DECLINE);
    }
  }

  cancel(): void {
    if (this.phase === 'ask' || this.phase === 'confirm') this.finish(TEAM_INVITE_DECLINE);
  }

  // The notice's key (any key held, as the exe's CheckKeyHeld).
  dismissNotice(): void {
    if (this.phase !== 'notice') return;
    this.phase = 'confirm';
    this.frames = INVITE_ANSWER_FRAMES;
  }

  // One frame of the countdown; the time-out answers 4.
  tick(): void {
    if (this.phase !== 'ask' && this.phase !== 'confirm') return;
    if (--this.frames <= 0) this.finish(TEAM_INVITE_TIMEOUT);
  }
}

// The 6xCC body (the 4-byte header included; the caller's sendSubcommand writes the sender id).
export function exchangeTeamPointsPayload(itemId: number, amount: number): Uint8Array {
  const b = new Uint8Array(TEAM_POINTS_SIZE - 4);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, itemId >>> 0, true);
  dv.setUint32(4, amount >>> 0, true);
  return b;
}

// --- Master Transfer (Master Menu > Master Transfer, 6xCD / 6xCE) -------------------------------
//
// The master asks the chosen leader with a peer message and waits for the answer, then sends
// 11EA flag 0x40 (the server swaps the roles; newserv ReceiveCommands.cc 0x11EA case 0x40). Both
// messages have the layout of the invite (newserv G_TeamInvitationAction_BB_6xC1_6xC2_6xCD_6xCE,
// "Same format as 6xC1"). From the exe (Ghidra, objdump):
//   6xCD request   sent by 0x00798c80 (lobby menu state 0x43 on Yes): bytes [0xCD, 0x17], +4 u32 the
//                  master's own client id ([0x00a9c4f4]), +8 u32 0, +0xC the master's name (0x18 units,
//                  0x006936b4), +0x3C the team name (0xF units of g_pKeyTeamConfig + 0x2cc), 0x5C bytes,
//                  relayed to the chosen player's client id (0x00800464; 0x62 to a client).
//   receiver       0x0078c0d8: when the gate byte 0x009ff3d4 is 1 and flag bit 0x40 of 0x00a98474 is clear
//                  the body (+4..+0x5B) is copied to 0x00a9c940.. and the flag is set (the prompt window
//                  0x00724430 / 0x0072455c opens); otherwise the receiver answers 6xCE at once with the
//                  body and +8 = 1 (0x0078c1a2), relayed to the body's +4 word.
//   6xCE answer    built in 0x0072455c: [0xCE, 0x17], +4 u32 the answerer's guild card (player +0xeb4),
//                  +8 u32 the action, +0xC the answerer's name (0x10 units). Action 2 = accept, 3 =
//                  declined, 1 = busy / time-out. The master's receiver 0x0078bff4 copies +4..+0x5B to the
//                  same globals and sets bit 0x80; the wait state 0x44 (0x00798b48) reads the action
//                  (0x0078c0a8): 1 -> "Transfer failed.", 2 -> 11EA, 3 -> the refusal notice.
export const TEAM_MASTER_SUB = 0xcd;
export const TEAM_MASTER_ANSWER_SUB = 0xce;
export const MASTER_ANSWER = { busy: 1, accept: 2, decline: 3 } as const;
// The request's action word is 0; a 4 there withdraws it (the prompt's check of 0x00a9c944 == 4,
// 0x0072455c; ASSUMED sent by nobody in this port).
export const MASTER_WITHDRAWN = 4;
// Both Yes / No lists of the prompt count 450 frames (0x1c2, 0x0072455c) and then answer 1.
export const MASTER_ANSWER_FRAMES = 450;
const MASTER_NAME_UNITS = 0x18;

export function masterTransferSubcommand(o: { selfId: number; name: string; teamName: string; action?: number }): Uint8Array {
  const b = new Uint8Array(TEAM_INVITE_SIZE);
  const dv = new DataView(b.buffer);
  b[0] = TEAM_MASTER_SUB;
  b[1] = TEAM_INVITE_SIZE / 4;
  dv.setUint16(2, o.selfId, true); // not written by the exe (stack); the sender id like the other 6x
  dv.setUint32(4, o.selfId >>> 0, true);
  dv.setUint32(8, (o.action ?? 0) >>> 0, true);
  b.set(utf16(o.name, MASTER_NAME_UNITS), 0x0c);
  b.set(utf16(o.teamName, TEAM_NAME_UNITS), 0x3c);
  return b;
}

export function masterAnswerSubcommand(o: { ownCard: number; ownName: string; action: number }): Uint8Array {
  const b = new Uint8Array(TEAM_INVITE_SIZE);
  const dv = new DataView(b.buffer);
  b[0] = TEAM_MASTER_ANSWER_SUB;
  b[1] = TEAM_INVITE_SIZE / 4;
  dv.setUint32(4, o.ownCard >>> 0, true);
  dv.setUint32(8, o.action >>> 0, true);
  b.set(utf16(o.ownName, 0x10), 0x0c);
  return b;
}

export interface MasterRequest {
  body: Uint8Array;
  target: number; // +4: the master's client id, the relay target of the answer
  action: number;
  masterName: string; // +0xC, unitxt 11 0x17a's first argument
  teamName: string; // +0x3C, its second argument
}

export function parseMasterRequest(body: Uint8Array): MasterRequest {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    body: body.slice(0, TEAM_INVITE_SIZE),
    target: dv.getUint32(4, true),
    action: dv.getUint32(8, true),
    masterName: stripTeamMarker(readUtf16(body, 0x0c, MASTER_NAME_UNITS)),
    teamName: stripTeamMarker(readUtf16(body, 0x3c, TEAM_NAME_UNITS)),
  };
}

export function parseMasterAnswer(body: Uint8Array): { guildCard: number; action: number; name: string } {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { guildCard: dv.getUint32(4, true), action: dv.getUint32(8, true), name: stripTeamMarker(readUtf16(body, 0x0c, 0x10)) };
}

// The receiver's immediate refusal (0x0078c1a2): the request's +4..+0x5B with +8 = 1.
export function masterBusyAnswer(request: Uint8Array): Uint8Array {
  const b = new Uint8Array(TEAM_INVITE_SIZE);
  b[0] = TEAM_MASTER_ANSWER_SUB;
  b[1] = TEAM_INVITE_SIZE / 4;
  b.set(request.subarray(4, TEAM_INVITE_SIZE), 4);
  new DataView(b.buffer).setUint32(8, MASTER_ANSWER.busy, true);
  return b;
}

// The receive side of 6xCD (0x0078c0d8): a free gate and no request already pending keep the
// request for the prompt; anything else is answered busy at once.
export class MasterTransferReceiver {
  pending: MasterRequest | null = null;
  // The request's action went to 4 while the prompt was up (0x0072455c: status == 4 -> the cancelled text).
  withdrawn = false;

  receive(body: Uint8Array, free: boolean): { answer: Uint8Array; target: number } | null {
    if (body.length < TEAM_INVITE_SIZE) return null;
    const request = parseMasterRequest(body);
    if (request.action === MASTER_WITHDRAWN) {
      if (this.pending) this.withdrawn = true;
      return null;
    }
    if (!free || this.pending) return { answer: masterBusyAnswer(body), target: request.target };
    this.pending = request;
    this.withdrawn = false;
    return null;
  }

  close(): void {
    this.pending = null;
    this.withdrawn = false;
  }
}

// The prompt's pure model (0x0072455c, states 0..7): the intro text, then a first Yes / No (cursor
// on No, 450 frames), a notice (unitxt 11 0x17b), a second Yes / No (cursor on No, 450 frames).
// Yes twice accepts (2); No, Cancel on either list declines (3); a count that runs out answers
// busy (1). The window (classic/teammenu.ts MasterTransferPromptWindow) adds the texts and keys.
export class MasterPrompt {
  phase: 'ask' | 'notice' | 'confirm' | 'done' = 'ask';
  action: number | null = null;
  timedOut = false;
  private frames = MASTER_ANSWER_FRAMES;

  private finish(action: number): void {
    this.phase = 'done';
    this.action = action;
  }

  choose(yes: boolean): void {
    if (this.phase === 'ask') {
      if (yes) {
        this.phase = 'notice';
        this.frames = MASTER_ANSWER_FRAMES;
      } else this.finish(MASTER_ANSWER.decline);
    } else if (this.phase === 'confirm') {
      this.finish(yes ? MASTER_ANSWER.accept : MASTER_ANSWER.decline);
    }
  }

  cancel(): void {
    if (this.phase === 'ask' || this.phase === 'confirm') this.finish(MASTER_ANSWER.decline);
  }

  dismissNotice(): void {
    if (this.phase !== 'notice') return;
    this.phase = 'confirm';
    this.frames = MASTER_ANSWER_FRAMES;
  }

  tick(): void {
    if (this.phase !== 'ask' && this.phase !== 'confirm') return;
    if (--this.frames <= 0) {
      this.timedOut = true;
      this.finish(MASTER_ANSWER.busy);
    }
  }
}

// --- Team Flag Records (Master Menu row 6) ------------------------------------------------------
//
// The team flag is a 32 x 32 image sent whole in 0FEA (0x800 bytes). newserv reads each u16 as
// ARGB1555 (TeamIndex.cc decode_flag_data: rgba8888_for_argb1555), so the client converts the
// picked picture to that. The exe loads "\\teamflag\\flag.bmp" through D3DX into its 32 x 32
// texture (LoadTeamFlagFile 0x0082aacc, LoadTeamFlagTexture 0x00839c68); the port gets the pixels
// from the host (a file picker) and converts them here. The scaling of a bigger picture is ASSUMED
// (D3DX's default surface copy scales to the destination size).
export const FLAG_SIZE = 32;

// RGBA bytes (length 32 * 32 * 4) -> ARGB1555 words (alpha bit set from alpha >= 128).
export function flagFromRgba(rgba: Uint8ClampedArray | Uint8Array): Uint16Array {
  if (rgba.length !== FLAG_SIZE * FLAG_SIZE * 4) throw new Error('team flag needs 32 x 32 RGBA pixels');
  const out = new Uint16Array(FLAG_SIZE * FLAG_SIZE);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = (rgba[o + 3] >= 128 ? 0x8000 : 0) | ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3);
  }
  return out;
}

// ARGB1555 words -> RGBA bytes (the preview; 5 bits widened as (v << 3) | (v >> 2)).
export function flagToRgba(flag: Uint16Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(flag.length * 4);
  const wide = (v: number) => (v << 3) | (v >> 2);
  flag.forEach((w, i) => {
    out[i * 4] = wide((w >> 10) & 31);
    out[i * 4 + 1] = wide((w >> 5) & 31);
    out[i * 4 + 2] = wide(w & 31);
    out[i * 4 + 3] = w & 0x8000 ? 255 : 0;
  });
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TeamError(what, -1)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
