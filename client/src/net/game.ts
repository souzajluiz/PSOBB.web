// Games (team rooms) on top of a game-server BBConnection.
// Command layouts from newserv src/CommandFormats.hh (MIT), flow from
// src/ReceiveCommands.cc / src/ReceiveSubcommands.cc and from the real-client
// captures in newserv's tests/*.test.txt (GC-ForestGameRareMagFeed: solo create
// and warp; GC-XB-CrossplayForestGame: a second player joining).
//
// Create:  C->S C1 (C_CreateGame_BB_C1, 0x50)            -> S->C 64, 1D
// List:    C->S 08 (empty)                               -> S->C 08 (menu entries, flag = count - 1)
// Join:    C->S 10 {GAME menu id, game id [, password]}   -> S->C 64, 1D (or 01 message box)
// Loading (joining client, mirrors the captures):
//   S->C 64, 1D          C->S 1D (newserv holds the other players' state
//                        commands until this reply), 8A (ask for the game name)
//   ...load the floor... C->S 6x3F (position), 6x1F (floor), 6x3B, 6F (done)
//   S->C B1 (time)       C->S 99
// Others in the game get 65 (full player entry). The leader then sends to the
// joiner (6D/62 with flag = joiner's client id) 6x6D, 6x6B, 6x6C, 6x6E, 6x6F,
// 6x71, 6x70; every other player sends 6x70. On BB the server then sends 6x72
// (resume) to every player except the joiner (newserv send_resume_game).
// Warp:    C->S 6x21 {floor}, 6x22 (invisible), ...load..., 6x3F, 6x1F, 6x3B, 6x23 (visible)
// Leave:   C->S 98 (C_CharacterData_BB_61_98), 84 {LOBBY menu id, lobby id} -> S->C 67
//          The others get 66 (flag = client id; data: client_id, leader_id, ...).

import type { BBConnection, Command } from './bbconnection.ts';
import { readUtf16 } from './bbconnection.ts';
import { Lobby, parseLobbyPlayer, stripMarkers, type LobbyPlayer } from './lobby.ts';

export const MENU_ID_LOBBY = 0x33000033;
export const MENU_ID_GAME = 0x44000044;
// Quest flags per difficulty: 0x400 flags, one bit each (newserv
// src/PlayerSubordinates.hh QuestFlags = FlagsTable<0x400, 4, Difficulty>).
export const QUEST_FLAG_BYTES = 0x80;

export const DIFFICULTY_NAMES = ['Normal', 'Hard', 'Very Hard', 'Ultimate'];
export const EPISODE_NAMES: Record<number, string> = { 1: 'Episode 1', 2: 'Episode 2', 3: 'Episode 4' };

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;
const RAD_TO_BAMS = (r: number) => Math.round((r / (Math.PI * 2)) * 0x10000) & 0xffff;

export interface CreateGameOptions {
  name: string; // newserv keeps 14 characters of the 0x10-unit field
  password?: string;
  difficulty?: number; // 0..3
  battle?: boolean;
  challenge?: boolean;
  episode?: number; // wire value: 1 = Ep1, 2 = Ep2, 3 = Ep4
  solo?: boolean;
}

export interface GameListEntry {
  menuId: number;
  itemId: number; // game (lobby) id, sent back in 10
  name: string;
  difficulty: number; // 0..3 (wire: 0x22 + difficulty)
  players: number;
  maxPlayers: number; // BB: high nibble of the episode byte
  episode: number; // 1, 2 or 3 (= Episode 4)
  solo: boolean;
  passworded: boolean; // flags & 2
  joinable: boolean; // BB: flags & 4 grays out games the client cannot join
  battle: boolean; // flags & 0x10
  challenge: boolean; // flags & 0x20
}

export interface Variation {
  layout: number;
  entities: number;
}

export interface JoinGameInfo {
  variations: Variation[]; // 16 floors
  clientId: number;
  leaderId: number;
  difficulty: number;
  battle: boolean;
  event: number;
  sectionId: number;
  challenge: boolean;
  randomSeed: number;
  episode: number; // 1, 2, 3 (= Episode 4)
  solo: boolean;
  inQuest: boolean;
  // Players already in the game, by slot (64 only carries PlayerLobbyDataBB:
  // names and guild cards; appearance arrives later in 6x70).
  lobbyData: Array<{ clientId: number; guildCardNumber: number; name: string } | null>;
}

// 08 (S->C): S_MenuItem_PC_BB_08 entries (0x2C). The first entry is the
// server name (item id 0, flags 4); flag = number of games.
export function parseGameList(data: Uint8Array): GameListEntry[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: GameListEntry[] = [];
  for (let o = 0; o + 0x2c <= data.length; o += 0x2c) {
    const itemId = dv.getUint32(o + 4, true);
    if (itemId === 0) continue; // header entry
    const episodeByte = data[o + 0x2a];
    const flags = data[o + 0x2b];
    out.push({
      menuId: dv.getUint32(o, true),
      itemId,
      difficulty: data[o + 8] - 0x22,
      players: data[o + 9],
      name: stripMarkers(readUtf16(data, o + 0x0a, 0x10)),
      maxPlayers: episodeByte >> 4 === 1 ? 1 : episodeByte >> 4,
      episode: episodeByte & 0x0f,
      solo: episodeByte >> 4 === 1,
      passworded: (flags & 2) !== 0,
      joinable: (flags & 4) === 0,
      battle: (flags & 0x10) !== 0,
      challenge: (flags & 0x20) !== 0,
    });
  }
  return out;
}

// 64 (S->C): S_JoinGame_BB_64 (0x1A0, offsets from the start of the payload):
//   000 Variations (16 x {u32 layout, u32 entities})
//   080 PlayerLobbyDataBB[4] (0x44 each, in slot order; empty slots are zero)
//   190 u8 client_id, leader_id, disable_udp, difficulty, battle_mode, event,
//       section_id, challenge_mode; 198 u32 random_seed;
//   19C u8 episode, unused, solo_mode, is_in_quest
export function parseJoinGame(data: Uint8Array): JoinGameInfo {
  if (data.length < 0x1a0) throw new Error(`64 command too short (${data.length} bytes)`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const variations: Variation[] = [];
  for (let i = 0; i < 16; i++) variations.push({ layout: dv.getUint32(i * 8, true), entities: dv.getUint32(i * 8 + 4, true) });
  const lobbyData: JoinGameInfo['lobbyData'] = [];
  for (let i = 0; i < 4; i++) {
    const o = 0x80 + i * 0x44;
    const gc = dv.getUint32(o + 4, true);
    lobbyData.push(gc ? { clientId: i, guildCardNumber: gc, name: stripMarkers(readUtf16(data, o + 0x20, 0x10)) } : null);
  }
  return {
    variations,
    lobbyData,
    clientId: data[0x190],
    leaderId: data[0x191],
    difficulty: data[0x193],
    battle: data[0x194] !== 0,
    event: data[0x195],
    sectionId: data[0x196],
    challenge: data[0x197] !== 0,
    randomSeed: dv.getUint32(0x198, true),
    episode: data[0x19c],
    solo: data[0x19e] !== 0,
    inQuest: data[0x19f] !== 0,
  };
}

// Floor -> area (newserv SetDataTableBase::default_floor_to_area). Episode is the
// wire value of 64/C1 (3 = Episode 4).
export function floorToArea(episode: number): number[] {
  switch (episode) {
    case 2:
      return [0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23];
    case 3:
      return [0x2d, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2e, -1, -1, -1, -1, -1, -1, -1];
    default:
      return [...Array(0x12).keys()];
  }
}

// Literal-only BC0 stream (newserv Compression.cc bc0_encode): one control
// byte with a 1 bit per literal (LSB first), then up to 8 literal bytes.
export function bc0Encode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 8) {
    const n = Math.min(8, data.length - i);
    out.push((1 << n) - 1);
    for (let k = 0; k < n; k++) out.push(data[i + k]);
  }
  return new Uint8Array(out);
}

// G_SyncGameStateHeader_6x6B_6x6C_6x6D_6x6E + BC0 data, padded to 4 bytes.
function syncStateCommand(sub: number, decompressed: Uint8Array): Uint8Array {
  const compressed = bc0Encode(decompressed);
  const size = (0x10 + compressed.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = sub;
  out[1] = 0; // extended header
  dv.setUint32(4, size, true);
  dv.setUint32(8, decompressed.length, true);
  dv.setUint32(12, compressed.length, true);
  out.set(compressed, 0x10);
  return out;
}

const ENTRY_INVENTORY = 0x44; // within a 0x520 67/65 entry
const ENTRY_DISP = 0x44 + 0x34c;

export interface SelfData {
  inventory: Uint8Array; // PlayerInventory (0x34C)
  disp: Uint8Array; // PlayerDispDataV4 (0x190)
  full: Uint8Array | null; // PSOBBCharacterFile (E7) when known
}

// The local player's inventory and disp data: from the 00E7 save data when the
// session has it (PSOBBCharacterFile: inventory @0, disp @0x34C), else from
// our own 67 entry.
export function selfData(full: Uint8Array | null, entry: Uint8Array | null): SelfData {
  if (full && full.length >= 0x2ea4) return { inventory: full.slice(0, 0x34c), disp: full.slice(0x34c, 0x4dc), full };
  if (entry) return { inventory: entry.slice(ENTRY_INVENTORY, ENTRY_INVENTORY + 0x34c), disp: entry.slice(ENTRY_DISP, ENTRY_DISP + 0x190), full: null };
  return { inventory: new Uint8Array(0x34c), disp: new Uint8Array(0x190), full: null };
}

// 98 / 61 body for BB: C_CharacterData_BB_61_98 (0x824), auto-reply disabled.
//   000 PlayerInventory  34C PlayerDispDataV4  4DC PlayerRecordsEntry_BB
//   (client_id, challenge 0x140, battle 0x18)  638 ChoiceSearchConfig (0x18)
//   650 info_board (UTF-16, 0xAC chars)  7A8 blocked_senders[0x1E]  820 auto_reply_enabled
// newserv keeps its own inventory/disp for BB and only stores the records,
// choice search config, info board and blocked senders, so those come from the
// save data (PSOBBCharacterFile: info_board @0x2B44, battle @0x2C9C,
// challenge @0x2CB8, choice search @0x2E20).
export function buildCharacterData(self: SelfData, clientId: number): Uint8Array {
  const out = new Uint8Array(0x824);
  const dv = new DataView(out.buffer);
  out.set(self.inventory, 0);
  out.set(self.disp, 0x34c);
  dv.setUint32(0x4dc, clientId, true);
  const f = self.full;
  if (f) {
    out.set(f.subarray(0x2cb8, 0x2cb8 + 0x140), 0x4e0);
    out.set(f.subarray(0x2c9c, 0x2c9c + 0x18), 0x620);
    out.set(f.subarray(0x2e20, 0x2e20 + 0x18), 0x638);
    out.set(f.subarray(0x2b44, 0x2b44 + 0x158), 0x650);
  }
  return out;
}

export interface PlayerState {
  clientId: number;
  floor: number;
  position: { x: number; y: number; z: number };
  angle: number; // radians
}

// 6x70 (BB): G_SyncPlayerDispAndInventory_BB_6x70 (0x4C0), offsets from the subcommand start:
//   000 extended header {0x70, 0, client_id, u32 size}
//   008 G_6x70_Base_V1: client_id u16, room u16, game_flags, pos xyz @010,
//       angle xyz (i32) @01C, phase, current_hp @02A, bonus hp/tp, 5 status
//       effects, language32 @06C, player_tag @070, guild card @074, battle,
//       team, telepipe @080 (0x1C), death_flags @09C, hold state @0A0,
//       area @0B4, player_flags @0B8, technique_levels_v1 @0BC
//   0D0 PlayerVisualConfigV4   140 PlayerStats   164 num_items
//   168 PlayerInventoryItem[30]   4B0 floor   4B4/4B8 xb user id   4BC unknown
export function buildPlayerSync(self: SelfData, s: PlayerState, guildCardNumber: number): Uint8Array {
  const out = new Uint8Array(0x4c0);
  const dv = new DataView(out.buffer);
  out[0] = 0x70;
  dv.setUint16(2, s.clientId, true);
  dv.setUint32(4, out.length, true);
  dv.setUint16(0x08, s.clientId, true);
  dv.setFloat32(0x10, s.position.x, true);
  dv.setFloat32(0x14, s.position.y, true);
  dv.setFloat32(0x18, s.position.z, true);
  dv.setInt32(0x20, RAD_TO_BAMS(s.angle), true);
  const disp = new DataView(self.disp.buffer, self.disp.byteOffset, self.disp.byteLength);
  dv.setUint16(0x2a, disp.getUint16(6, true), true); // current HP = PlayerStats.char_stats.hp
  out[0x2c] = self.inventory[1]; // hp_from_materials
  out[0x2e] = self.inventory[2]; // tp_from_materials
  dv.setUint32(0x6c, self.inventory[3], true); // language
  dv.setUint32(0x70, 0x00010000, true); // player_tag
  dv.setUint32(0x74, guildCardNumber, true);
  dv.setUint16(0x80, 0xffff, true); // telepipe owner: none
  dv.setUint32(0x98, 0x0000ffff, true); // telepipe unknown_a4 default
  dv.setUint32(0xb4, s.floor, true); // area
  out.set(self.disp.subarray(0x17c, 0x190), 0xbc); // technique_levels_v1
  out.set(self.disp.subarray(0x24, 0x94), 0xd0); // visual
  out.set(self.disp.subarray(0, 0x24), 0x140); // stats
  dv.setUint32(0x164, self.inventory[0], true);
  out.set(self.inventory.subarray(4, 4 + 30 * 0x1c), 0x168);
  dv.setUint32(0x4b0, s.floor, true);
  return out;
}

// Reads the parts of a 6x70 the view needs: appearance, class, level, place.
export function parsePlayerSync(body: Uint8Array, into: LobbyPlayer): void {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const visual = 0xd0;
  const shared = visual + 0x10;
  const u16 = (o: number) => dv.getUint16(shared + o, true);
  into.appearance = {
    sectionId: body[shared + 0x20],
    costume: u16(0x28),
    skin: u16(0x2a),
    face: u16(0x2c),
    head: u16(0x2e),
    hair: u16(0x30),
    hairR: u16(0x32),
    hairG: u16(0x34),
    hairB: u16(0x36),
    proportionX: dv.getFloat32(shared + 0x38, true),
    proportionY: dv.getFloat32(shared + 0x3c, true),
  };
  into.charClass = body[shared + 0x21];
  into.sectionId = body[shared + 0x20];
  const name = stripMarkers(readUtf16(body, visual + 0x50, 0x10));
  if (name) into.name = name;
  into.level = dv.getUint32(0x140 + 0x18, true) + 1;
  into.position = { x: dv.getFloat32(0x10, true), y: dv.getFloat32(0x14, true), z: dv.getFloat32(0x18, true) };
  into.angle = (dv.getInt32(0x20, true) & 0xffff) * BAMS_TO_RAD;
  into.floor = dv.getUint32(0x4b0, true);
  into.moving = false;
}

function blankPlayer(clientId: number, guildCardNumber: number, name: string): LobbyPlayer {
  return {
    clientId,
    guildCardNumber,
    name,
    charClass: -1, // unknown until 6x70
    sectionId: 0,
    level: 1,
    appearance: { sectionId: 0, costume: 0, skin: 0, face: 0, head: 0, hair: 0, hairR: 0, hairG: 0, hairB: 0, proportionX: 0, proportionY: 0 },
    position: { x: 0, y: 0, z: 0 },
    angle: 0,
    moving: false,
    gait: 'run',
    floor: 0,
  };
}

function utf16Field(s: string, chars: number): Uint8Array {
  const out = new Uint8Array(chars * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < Math.min(s.length, chars - 1); i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return out;
}

const timeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out waiting for ${what}`)), ms))]);

// Errors come back as a lobby message box (01 / 0101) with UTF-16 text after an 8-byte header.
function messageText(c: Command): string {
  return stripMarkers(readUtf16(c.data, 8, (c.data.length - 8) >> 1)).replace(/\$C\d/g, '').replace(/\n/g, ' ').trim();
}

export interface GameContext {
  // Session-level data the game needs: guild card and latest save data (E7).
  guildCardNumber: number;
  fullCharacter: () => Uint8Array | null;
}

// A game: the same player bookkeeping and movement commands as Lobby, plus the
// join/sync/warp/leave protocol. The Lobby it came from is detached while the
// game is active and re-attached by leave() before the server's 67.
export class Game extends Lobby {
  info: JoinGameInfo | null = null;
  name = '';
  // Loading state: true from 64 until finishLoading() sends 6F.
  loading = true;
  // Set when the server resumed the game after a player joined (6x72; on BB the
  // server sends it to everyone but the joiner).
  resumed = false;
  readonly lobby: Lobby;
  private ctx: GameContext;
  // Rebuilt before a 6x6D sync so it carries what net/items.ts changed.
  selfSnapshot: SelfData;
  private joined: Promise<void>;
  private resolveJoined!: () => void;
  private rejectJoined!: (e: Error) => void;
  private started = false;
  // Inventory item counts of the players in the game (item ids they have used).
  private inventoryCounts = new Map<number, number>();
  // Quest flags of the current difficulty (0x400 flags, MSB-first bits), kept
  // in step with 6x75 and 6x6F. The quest VM reads and writes them.
  readonly questFlags = new Uint8Array(QUEST_FLAG_BYTES);
  // Registers another client synced with 6x77 (sync_register).
  readonly questRegisters = new Map<number, number>();
  // Resolves when the server acknowledged our 6F (B1): other players can join now.
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  log: (msg: string) => void = () => {};

  private constructor(lobby: Lobby, ctx: GameContext) {
    super(lobby.conn);
    this.lobby = lobby;
    this.ctx = ctx;
    this.active = false; // until our own create/join request is answered
    this.selfSnapshot = selfData(ctx.fullCharacter(), lobby.selfEntry);
    this.joined = new Promise((res, rej) => {
      this.resolveJoined = res;
      this.rejectJoined = rej;
    });
    this.ready = new Promise((res) => (this.resolveReady = res));
    this.on('subcommand', (sub, clientId, body) => this.onGameSubcommand(sub, clientId, body));
  }

  // C1: create a game and enter it as its leader.
  static async create(lobby: Lobby, ctx: GameContext, opts: CreateGameOptions): Promise<Game> {
    const g = new Game(lobby, ctx);
    const body = new Uint8Array(0x50);
    body.set(utf16Field(opts.name, 0x10), 0x08);
    body.set(utf16Field(opts.password ?? '', 0x10), 0x28);
    body[0x48] = opts.difficulty ?? 0;
    body[0x49] = opts.battle ? 1 : 0;
    body[0x4a] = opts.challenge ? 1 : 0;
    body[0x4b] = opts.episode ?? 1;
    body[0x4c] = opts.solo ? 1 : 0;
    g.name = opts.name;
    await g.request(() => lobby.conn.send(0xc1, 0, body));
    return g;
  }

  // 10 with the game menu id: join an existing game.
  static async join(lobby: Lobby, ctx: GameContext, gameId: number, password = ''): Promise<Game> {
    const g = new Game(lobby, ctx);
    let body: Uint8Array;
    if (password) {
      // C_MenuSelectionWithPassword_PC_BB_10 (flag 2)
      body = new Uint8Array(0x28);
      body.set(utf16Field(password, 0x10), 8);
    } else {
      body = new Uint8Array(8);
    }
    const dv = new DataView(body.buffer);
    dv.setUint32(0, MENU_ID_GAME, true);
    dv.setUint32(4, gameId, true);
    await g.request(() => lobby.conn.send(0x10, password ? 2 : 0, body));
    return g;
  }

  // 08: the game list (the lobby stays active; 08 is answered with 08).
  static async list(conn: BBConnection): Promise<GameListEntry[]> {
    conn.send(0x08, 0);
    const c = await timeout(conn.waitFor(0x08), 5000, 'game list (08)');
    return parseGameList(c.data);
  }

  // Sends the request and waits for 64 (handled synchronously in handle()) or an error message box.
  private async request(send: () => void): Promise<void> {
    this.started = true;
    this.active = true;
    send();
    await timeout(this.joined, 8000, 'join game (64)');
  }

  handle(c: Command): void {
    if (!this.started) return;
    if (!this.info) {
      // Before 64: a lobby message box (01 / 0101) or large message box means the server refused.
      if (c.command === 0x01 || c.command === 0x0101 || c.command === 0x1a || c.command === 0xd5) {
        this.active = false;
        this.rejectJoined(new Error(messageText(c) || `server refused (command ${c.command.toString(16)})`));
        return;
      }
      if (c.command !== 0x64) return;
    }
    switch (c.command) {
      case 0x64:
        if (this.info) return; // already in (the client ignores 64 while loading)
        this.onJoinGame(c);
        return;
      case 0x65:
        this.onPlayerJoinGame(c);
        return;
      case 0x66: {
        const id = c.flag;
        this.leaderId = c.data[1] ?? this.leaderId;
        this.players.delete(id);
        this.inventoryCounts.delete(id);
        this.emit('playerLeft', id);
        return;
      }
      case 0x1d: // ping: newserv releases the queued join commands on our reply
        if (this.info) this.conn.send(0x1d, 0);
        return;
      case 0x8a: // game name
        if (c.data.length) this.name = stripMarkers(readUtf16(c.data, 0, c.data.length >> 1));
        return;
      case 0xb1: // server time, sent after 6F; the client answers 99
        if (this.info && !this.loading) {
          this.conn.send(0x99, 0);
          this.resolveReady();
        }
        return;
      case 0x67:
      case 0x68:
      case 0x69:
        return; // lobby commands: the re-attached Lobby handles them
    }
    if (this.info) super.handle(c);
  }

  private onJoinGame(c: Command): void {
    const info = parseJoinGame(c.data);
    this.info = info;
    this.selfId = info.clientId;
    this.leaderId = info.leaderId;
    this.players.clear();
    for (const e of info.lobbyData) {
      if (!e) continue;
      this.players.set(e.clientId, blankPlayer(e.clientId, e.guildCardNumber, e.name));
    }
    // Our own player: appearance from our save data.
    const me = this.players.get(info.clientId) ?? blankPlayer(info.clientId, this.ctx.guildCardNumber, '');
    const selfEntry = this.lobby.selfEntry;
    const fromLobby = this.lobby.self;
    if (fromLobby) {
      me.name = fromLobby.name;
      me.charClass = fromLobby.charClass;
      me.sectionId = fromLobby.sectionId;
      me.level = fromLobby.level;
      me.appearance = fromLobby.appearance;
    } else if (selfEntry) {
      Object.assign(me, { ...parseLobbyPlayer(selfEntry, 0), clientId: info.clientId });
    }
    me.floor = 0;
    me.position = { x: 0, y: 0, z: 0 };
    this.players.set(info.clientId, me);
    this.inventoryCounts.set(info.clientId, this.selfSnapshot.inventory[0]);
    this.lobby.detach();
    this.loading = true;
    this.conn.send(0x8a, 0); // the client asks for the game name while loading
    this.log(`joined game as client ${info.clientId}, leader ${info.leaderId}, episode ${info.episode}, difficulty ${info.difficulty}`);
    this.emit('joined', [...this.players.values()]);
    this.resolveJoined();
  }

  // 65: a player joined (same entry as 68). We send it our state while it loads.
  private onPlayerJoinGame(c: Command): void {
    const o = 0x0c;
    if (c.data.length < o + 0x520) return;
    const p = parseLobbyPlayer(c.data, o);
    this.leaderId = c.data[1];
    this.inventoryCounts.set(p.clientId, c.data[o + 0x44]);
    this.players.set(p.clientId, p);
    this.emit('playerJoined', p);
    this.sendJoinSync(p.clientId);
  }

  // What the original client sends to a joining player (GC-XB-CrossplayForestGame capture):
  // the leader sends the state commands, everyone sends its own 6x70.
  private sendJoinSync(target: number): void {
    const me = this.self;
    if (!me) return;
    if (this.selfId === this.leaderId) {
      // 6x6D item state (G_SyncItemState_6x6D_Decompressed, 0x8C: next drop number
      // per floor, next item id per player, floor item count per floor). The web
      // client does not track drops, so drop numbers and floor items are zero.
      // Item ids start at 0x00010000 + 0x00200000 * client id (newserv
      // Lobby::reset_next_item_ids) and each loaded player has used one per
      // inventory item; the joiner has not assigned its own yet. newserv
      // regenerates the item state for a BB joiner and only compares the ids.
      const items = new Uint8Array(0x8c);
      const idv = new DataView(items.buffer);
      for (let i = 0; i < 12; i++) {
        const used = i === target ? 0 : (this.inventoryCounts.get(i) ?? 0);
        idv.setUint32(0x20 + i * 4, 0x00010000 + 0x00200000 * i + used, true);
      }
      this.conn.send(0x6d, target, syncStateCommand(0x6d, items));
      // 6x6B / 6x6C / 6x6E (enemy, object, set flag states) are not sent: newserv
      // requires exactly the entity counts of every floor's map (including enemy
      // children), which needs the full entity expansion. 6x6F (quest flags) is
      // not sent either: the web client does not track them and zeros would
      // overwrite the game's flags.
      const unblock = new Uint8Array([0x71, 0x01, 0x00, 0x00]);
      this.conn.send(0x62, target, unblock);
    }
    // Fresh save data: net/items.ts keeps the inventory (item ids, pickups) in it.
    this.selfSnapshot = selfData(this.ctx.fullCharacter(), this.lobby.selfEntry);
    const sync = buildPlayerSync(this.selfSnapshot, { clientId: this.selfId, floor: me.floor, position: me.position, angle: me.angle }, this.ctx.guildCardNumber);
    this.conn.send(0x6d, target, sync);
  }

  private onGameSubcommand(sub: number, clientId: number, body: Uint8Array): void {
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    switch (sub) {
      case 0x70: {
        if (body.length < 0x4c0) return;
        const id = dv.getUint16(0x08, true);
        if (id === this.selfId) return;
        const p = this.players.get(id) ?? blankPlayer(id, dv.getUint32(0x74, true), '');
        parsePlayerSync(body, p);
        this.players.set(id, p);
        this.inventoryCounts.set(id, dv.getUint32(0x164, true));
        // Re-announce so views rebuild the model with the real appearance.
        this.emit('playerJoined', p);
        this.emit('floorChanged', p);
        break;
      }
      case 0x72:
        this.resumed = true;
        break;
      case 0x75: {
        // G_UpdateQuestFlag_V3_BB_6x75: another client's quest opcode changed
        // a flag. action 0 = set, 1 = clear.
        if (body.length < 8) return;
        const flag = dv.getUint16(4, true);
        this.writeQuestFlag(flag, dv.getUint16(6, true) === 0);
        break;
      }
      case 0x6f: {
        // G_SetQuestFlags_BB_6x6F: the leader's whole flag table while we load
        // (0x200 bytes, 0x80 per difficulty, MSB-first bits; newserv
        // PlayerSubordinates.hh FlagsTable<0x400, 4, Difficulty>).
        if (body.length < 4 + 0x200) return;
        const at = 4 + (this.info?.difficulty ?? 0) * QUEST_FLAG_BYTES;
        this.questFlags.set(body.subarray(at, at + QUEST_FLAG_BYTES));
        break;
      }
      case 0x77: {
        // G_SyncQuestRegister_6x77: another client's sync_register.
        if (body.length < 0x0c) return;
        this.questRegisters.set(dv.getUint16(4, true) & 0xff, dv.getInt32(8, true));
        break;
      }
      case 0x1f:
      case 0x21: {
        const p = this.players.get(clientId);
        if (!p || clientId === this.selfId || body.length < 8) return;
        p.floor = dv.getInt32(4, true);
        this.emit('floorChanged', p);
        break;
      }
      case 0x22:
      case 0x23: {
        const p = this.players.get(clientId);
        if (p && clientId !== this.selfId) p.visible = sub === 0x23;
        break;
      }
    }
  }

  // The floor is loaded and the player placed: 6x3F, 6x1F, 6x3B, then 6F.
  finishLoading(x: number, y: number, z: number, angle: number): void {
    const me = this.self;
    if (!me) return;
    me.position = { x, y, z };
    me.angle = angle;
    this.sendSetPosition();
    this.sendSubcommand(0x1f, int32(me.floor));
    this.sendSubcommand(0x3b, new Uint8Array(0));
    this.conn.send(0x6f, 0);
    this.loading = false;
  }

  // 6x21 (inter-level warp) + 6x22 (invisible). Call finishWarp() once the floor is loaded.
  warp(floor: number): void {
    const me = this.self;
    if (!me) return;
    this.sendSubcommand(0x21, int32(floor));
    this.sendSubcommand(0x22, new Uint8Array(0));
    me.floor = floor;
  }

  finishWarp(x: number, y: number, z: number, angle: number): void {
    const me = this.self;
    if (!me) return;
    me.position = { x, y, z };
    me.angle = angle;
    this.sendSetPosition();
    this.sendSubcommand(0x1f, int32(me.floor));
    this.sendSubcommand(0x3b, new Uint8Array(0));
    this.sendSubcommand(0x23, new Uint8Array(0));
  }

  // 6x05 (G_WriteSwitchFlag_6x05, 0x0C bytes): {05, 03, entity id, client id,
  // unused, u16 flag, u8 floor, u8 flags}. A switch object sends its own
  // entity id (0x4000 + object index across all floors of the game) and
  // flags 1 (set), as in newserv's captures of real clients
  // (DCv1-DCv2-PCv2-CrossplayPrivateDrops: 05 03 68 40 .. 07 00 01 01).
  // `flags` overrides the flag byte: bit 0 = set the flag, bit 1 = play the
  // room unlock sound. A wave event's first set_switch_flag sends 3
  // (FUN_0080cd7c), the rest 1, and clear_switch_flag sends 0.
  sendSwitchFlag(entityId: number, floor: number, flag: number, set = true, flags = set ? 1 : 0): void {
    const body = new Uint8Array(0x0c);
    const dv = new DataView(body.buffer);
    body[0] = 0x05;
    body[1] = 0x03;
    dv.setUint16(2, entityId, true);
    dv.setUint16(4, this.selfId, true);
    dv.setUint16(8, flag, true);
    body[10] = floor;
    body[11] = flags;
    this.conn.send(0x60, 0, body);
  }

  // 6x67 (G_TriggerSetEvent_6x67, 0x10 bytes): {67, 04, entity id, u32 floor,
  // u32 event id, u32 client id}. A trigger object sends its own entity id
  // (0x4000 + object index), a wave event's trigger_event action 0xFFFF
  // (FUN_0080ce24).
  sendTriggerEvent(entityId: number, floor: number, eventId: number): void {
    const body = new Uint8Array(0x10);
    const dv = new DataView(body.buffer);
    body[0] = 0x67;
    body[1] = 0x04;
    dv.setUint16(2, entityId, true);
    dv.setUint32(4, floor, true);
    dv.setUint32(8, eventId, true);
    dv.setUint32(12, this.selfId, true);
    this.conn.send(0x60, 0, body);
  }

  // Reads a quest flag of the current difficulty.
  getQuestFlag(flag: number): boolean {
    if (flag >= QUEST_FLAG_BYTES * 8) return false;
    return !!(this.questFlags[flag >> 3] & (0x80 >> (flag & 7)));
  }

  private writeQuestFlag(flag: number, set: boolean): void {
    if (flag >= QUEST_FLAG_BYTES * 8) return;
    const mask = 0x80 >> (flag & 7);
    if (set) this.questFlags[flag >> 3] |= mask;
    else this.questFlags[flag >> 3] &= ~mask;
  }

  // Sets a quest flag locally and tells the other players (6x75).
  setQuestFlag(flag: number, set: boolean): void {
    this.writeQuestFlag(flag, set);
    this.sendQuestFlag(flag, set);
  }

  // 6x75 (G_UpdateQuestFlag_V3_BB_6x75, 0x0C): {75, 02, unused, u16 flag,
  // u16 action (0 = set, 1 = clear), u16 difficulty, u16 unused}. Sent by the
  // quest opcodes gset / gclear / grev / glet (newserv QuestScript.cc:560).
  sendQuestFlag(flag: number, set: boolean, difficulty = this.info?.difficulty ?? 0): void {
    const body = new Uint8Array(0x0c);
    const dv = new DataView(body.buffer);
    body[0] = 0x75;
    body[1] = 0x02;
    dv.setUint16(4, flag, true);
    dv.setUint16(6, set ? 0 : 1, true);
    dv.setUint16(8, difficulty, true);
    this.conn.send(0x60, 0, body);
  }

  // 6x77 (G_SyncQuestRegister_6x77, 0x0C): {77, 02, unused, u16 register,
  // u16 unused, u32 value}. Sent by the sync_register / sync_register2
  // opcodes (0xD9 / 0xEF).
  sendQuestRegister(register: number, value: number): void {
    const body = new Uint8Array(0x0c);
    const dv = new DataView(body.buffer);
    body[0] = 0x77;
    body[1] = 0x02;
    dv.setUint16(4, register & 0xff, true);
    dv.setInt32(8, value | 0, true);
    this.conn.send(0x60, 0, body);
  }

  // 6x76 (G_SetEntitySetFlags_6x76, 8 bytes): {76, 02, entity id, u16 floor,
  // u16 flags}. The client ORs the flags into the entity's set entry; flag 8
  // means the enemy is dead, which is what advances a wave event.
  sendEntitySetFlags(entityId: number, floor: number, flags: number): void {
    const body = new Uint8Array(8);
    const dv = new DataView(body.buffer);
    body[0] = 0x76;
    body[1] = 0x02;
    dv.setUint16(2, entityId, true);
    dv.setUint16(4, floor, true);
    dv.setUint16(6, flags, true);
    this.conn.send(0x60, 0, body);
  }

  // --- Combat (layouts: newserv CommandFormats.hh; order: the real-client
  // capture GC-ForestGameRareMagFeed: 6x43, 6x46, 6x0A, 6x76, then 62/6x60
  // to the leader when the enemy died) ------------------------------------

  // 6x43 / 6x44 / 6x45 (G_Attack_6x43_6x44_6x45, 8): attack `step` 0..2 of a
  // combo, {u16 angle_y (BAMS), u16 attack_type}.
  sendAttack(step: number, angle: number, attackType: number): void {
    const p = new Uint8Array(4);
    const dv = new DataView(p.buffer);
    dv.setUint16(0, RAD_TO_BAMS(angle), true);
    dv.setUint16(2, attackType, true);
    this.sendSubcommand(0x43 + Math.min(2, Math.max(0, step)), p);
  }

  // 6x46 (G_AttackFinished_Header_6x46): the targets of one strike, at most
  // 10 {u16 entity id, u16 hit box}. newserv marks each enemy as last hit by us.
  sendAttackTargets(targets: Array<{ entityId: number; hitbox?: number }>): void {
    const list = targets.slice(0, 10);
    const p = new Uint8Array(4 + list.length * 4);
    const dv = new DataView(p.buffer);
    dv.setUint32(0, list.length, true);
    list.forEach((t, i) => {
      dv.setUint16(4 + i * 4, t.entityId, true);
      dv.setUint16(6 + i * 4, t.hitbox ?? 0, true);
    });
    this.sendSubcommand(0x46, p);
  }

  // 6x0A (G_UpdateEnemyState_6x0A, 0x0C): {entity id 0x1000 | index} {u16
  // index, u16 total damage, u32 game flags}. Flags: 0x20000000 enemy,
  // 0x200 hit, 0x400 big hit, 0x800 dead, 0x100 missed (see combat/formulas.ts).
  sendEnemyState(enemyIndex: number, totalDamage: number, flags: number): void {
    this.conn.send(0x60, 0, buildEnemyState(enemyIndex, totalDamage, flags));
  }

  // A killed enemy is reported with 6x76 flags 8 (sendEntitySetFlags above).

  // 6x60 (G_StandardDropItemRequest_PC_V3_BB_6x60, 0x18) for a killed enemy,
  // sent privately to the leader (62) like the original client; on BB newserv
  // generates the item and answers 6x5F to the game.
  sendEnemyDropRequest(req: { floor: number; rtIndex: number; enemyIndex: number; x: number; z: number; room: number; area: number }): void {
    this.conn.send(0x62, Math.max(0, this.leaderId), buildDropRequest(req));
  }

  // 6xC8 (G_EnemyEXPRequest_BB_6xC8, 0x0C): {entity id} {u16 enemy index, u16
  // requesting client id, u8 is_killer}. newserv answers 6xBF (EXP) on BB.
  sendExpRequest(enemyIndex: number, isKiller: boolean): void {
    const b = new Uint8Array(0x0c);
    const dv = new DataView(b.buffer);
    b[0] = 0xc8;
    b[1] = 3;
    dv.setUint16(2, 0x1000 | enemyIndex, true);
    dv.setUint16(4, enemyIndex, true);
    dv.setUint16(6, this.selfId, true);
    b[8] = isKiller ? 1 : 0;
    this.conn.send(0x60, 0, b);
  }

  // --- the player taking damage (combat/playerdamage.ts has the exe side) ---

  // 6x4A (G_ShieldAttack_6x4A, 4): the attack was fully shielded; the receiving
  // client plays the evade motion (action_evade @ 0x0069a9c8).
  sendShieldAttack(): void {
    this.sendSubcommand(0x4a, new Uint8Array(0));
  }

  // 6x4B / 6x4C (G_HitByEnemy_6x4B_6x4C, 0x10): hit by an enemy for at most
  // (4B) or more than (4C) a quarter of max HP. {u16 angle (BAMS), u16
  // current_hp, f32 velocity_x, f32 velocity_z}; the send sites are
  // dispatch_action_got_hit_light / _heavy.
  sendHitByEnemy(heavy: boolean, angle: number, currentHp: number, vx: number, vz: number): void {
    const p = new Uint8Array(0x0c);
    const dv = new DataView(p.buffer);
    dv.setUint16(0, RAD_TO_BAMS(angle), true);
    dv.setUint16(2, Math.max(0, Math.min(0xffff, Math.round(currentHp))), true);
    dv.setFloat32(4, vx, true);
    dv.setFloat32(8, vz, true);
    this.sendSubcommand(heavy ? 0x4c : 0x4b, p);
  }

  // 6x89 + 6x4D, both sent by dispatch_actions_0x89_0x4d @ 0x0069e234 in one
  // call: {u16 killer entity id, u16 0} and {u32 death_flags} (player+0x92c).
  sendPlayerDeath(killerEntityId: number, deathFlags: number): void {
    const a = new Uint8Array(4);
    const adv = new DataView(a.buffer);
    adv.setUint16(0, killerEntityId & 0xffff, true);
    adv.setUint16(2, 0, true);
    this.sendSubcommand(0x89, a);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, deathFlags >>> 0, true);
    this.sendSubcommand(0x4d, b);
  }

  // 6x4E (G_PlayerRevivable_6x4E, 4): the particle a Reverser / Moon Atomizer
  // can target.
  sendPlayerRevivable(): void {
    this.sendSubcommand(0x4e, new Uint8Array(0));
  }

  // 6x4F (G_PlayerRevived_6x4F, 4).
  sendPlayerRevived(): void {
    this.sendSubcommand(0x4f, new Uint8Array(0));
  }

  // 6x40: walking toward (x, z); flags 8 = near an enemy (slower walk).
  sendWalk(x: number, z: number, nearEnemy = false): void {
    const p = new Uint8Array(12);
    const dv = new DataView(p.buffer);
    dv.setFloat32(0, x, true);
    dv.setFloat32(4, z, true);
    dv.setUint32(8, nearEnemy ? 8 : 0, true);
    this.sendSubcommand(0x40, p);
    const me = this.self;
    if (me) {
      me.position = { x, y: me.position.y, z };
      me.moving = true;
      me.gait = 'walk';
    }
  }

  // 6x3F: set position {is_near_enemy, angle, floor, room, pos}.
  sendSetPosition(): void {
    const me = this.self;
    if (!me) return;
    const p = new Uint8Array(0x14);
    const dv = new DataView(p.buffer);
    dv.setUint16(2, RAD_TO_BAMS(me.angle), true);
    dv.setInt16(4, me.floor, true);
    dv.setFloat32(8, me.position.x, true);
    dv.setFloat32(12, me.position.y, true);
    dv.setFloat32(16, me.position.z, true);
    this.sendSubcommand(0x3f, p);
  }

  // 98 (leave game, with our character data), then 84 (choose lobby). Resolves
  // with the original Lobby once the server's 67 has been handled by it.
  async leave(): Promise<Lobby> {
    const self = selfData(this.ctx.fullCharacter(), this.lobby.selfEntry);
    this.conn.send(0x98, 0, buildCharacterData(self, this.selfId));
    this.active = false;
    this.lobby.attach();
    const joinedLobby = new Promise<void>((r) => this.lobby.on('joined', () => r()));
    const sel = new Uint8Array(8);
    new DataView(sel.buffer).setUint32(0, MENU_ID_LOBBY, true);
    new DataView(sel.buffer).setUint32(4, Math.max(1, this.lobby.blockNumber), true);
    this.conn.send(0x84, 0, sel);
    await timeout(joinedLobby, 8000, 'lobby join (67)');
    return this.lobby;
  }
}

// 6x05 from another client or a wave event (entity 0xFFFF).
export function parseSwitchFlag(body: Uint8Array): { entityId: number; flag: number; floor: number; set: boolean } | null {
  if (body.length < 0x0c || body[0] !== 0x05) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { entityId: dv.getUint16(2, true), flag: dv.getUint16(8, true), floor: body[10], set: (body[11] & 1) !== 0 };
}

export function buildEnemyState(enemyIndex: number, totalDamage: number, flags: number): Uint8Array {
  const b = new Uint8Array(0x0c);
  const dv = new DataView(b.buffer);
  b[0] = 0x0a;
  b[1] = 3;
  dv.setUint16(2, 0x1000 | enemyIndex, true);
  dv.setUint16(4, enemyIndex, true);
  dv.setUint16(6, Math.min(0xffff, Math.max(0, Math.round(totalDamage))), true);
  dv.setUint32(8, flags >>> 0, true);
  return b;
}

export function buildDropRequest(req: { floor: number; rtIndex: number; enemyIndex: number; x: number; z: number; room: number; area: number }): Uint8Array {
  const b = new Uint8Array(0x18);
  const dv = new DataView(b.buffer);
  b[0] = 0x60;
  b[1] = 6;
  b[4] = req.floor;
  b[5] = req.rtIndex;
  dv.setUint16(6, req.enemyIndex, true);
  dv.setFloat32(8, req.x, true);
  dv.setFloat32(12, req.z, true);
  dv.setUint16(0x10, req.room, true);
  dv.setUint16(0x12, 0, true); // ignore_def: enemies are never specialized
  b[0x14] = req.area;
  return b;
}

export interface EnemyStateUpdate {
  enemyIndex: number;
  totalDamage: number;
  flags: number;
}

// 6x0A from another client (or newserv, for fast kills).
export function parseEnemyState(body: Uint8Array): EnemyStateUpdate | null {
  if (body.length < 0x0c || body[0] !== 0x0a) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { enemyIndex: dv.getUint16(4, true), totalDamage: dv.getUint16(6, true), flags: dv.getUint32(8, true) };
}

// 6x43 / 6x44 / 6x45 from another client.
export function parseAttack(body: Uint8Array): { clientId: number; step: number; angle: number; attackType: number } | null {
  if (body.length < 8 || body[0] < 0x43 || body[0] > 0x45) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { clientId: dv.getUint16(2, true), step: body[0] - 0x43, angle: dv.getUint16(4, true) * BAMS_TO_RAD, attackType: dv.getUint16(6, true) };
}

// 6x4B / 6x4C from another client.
export function parseHitByEnemy(body: Uint8Array): { clientId: number; heavy: boolean; angle: number; currentHp: number; vx: number; vz: number } | null {
  if (body.length < 0x10 || (body[0] !== 0x4b && body[0] !== 0x4c)) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    clientId: dv.getUint16(2, true),
    heavy: body[0] === 0x4c,
    angle: dv.getUint16(4, true) * BAMS_TO_RAD,
    currentHp: dv.getUint16(6, true),
    vx: dv.getFloat32(8, true),
    vz: dv.getFloat32(12, true),
  };
}

// 6x4D (death), 6x4E (revivable), 6x4F (revived) and 6x4A (fully shielded):
// header-only apart from 6x4D's death flags.
export function parsePlayerDeath(body: Uint8Array): { clientId: number; deathFlags: number } | null {
  if (body.length < 8 || body[0] !== 0x4d) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { clientId: dv.getUint16(2, true), deathFlags: dv.getUint32(4, true) };
}

// 6x46: the entity ids a strike hit.
export function parseAttackTargets(body: Uint8Array): { clientId: number; targets: number[] } | null {
  if (body.length < 8 || body[0] !== 0x46) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const n = Math.min(10, dv.getUint32(4, true), (body.length - 8) >> 2);
  const targets: number[] = [];
  for (let i = 0; i < n; i++) targets.push(dv.getUint16(8 + i * 4, true));
  return { clientId: dv.getUint16(2, true), targets };
}

function int32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
}
