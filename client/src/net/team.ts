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

  chat(sender: string, text: string): void {
    this.send(teamChatPacket(sender, text));
  }
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
