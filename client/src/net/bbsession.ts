// High-level BB login flow on top of BBConnection.
//
// Data server phase (newserv ReceiveCommands.cc on_93_BB):
//   1. connect bb-data1, 03 init, send 93 with guild_card_number = 0
//   2. server answers E6 (guild card, security token, client config) + 19 redirect
//   3. reconnect to the redirect port, send 93 again carrying those values
//   4. ask for each character slot with E3; server answers E5 (preview) or E4 (empty)

import { BBConnection, readAscii, readUtf16, type Command, type Transport } from './bbconnection.ts';
import { parseCharacterFile, type CharacterFile } from './charfile.ts';
import { Lobby } from './lobby.ts';
import { GuildCardBook, GuildCardClient } from './guildcard.ts';
import { InfoBoardClient } from './infoboard.ts';
import { applyKeyConfig, keyConfigFromCharacter } from '../input/keyconfig.ts';

export type TransportFactory = (port: number) => Promise<Transport>;

export interface ClientInit {
  errorCode: number;
  guildCardNumber: number;
  securityToken: number;
  clientConfig: Uint8Array;
}

export interface CharacterPreview {
  slot: number;
  level: number; // displayed level (wire value is 0-based)
  exp: number;
  name: string;
  charClass: number;
  sectionId: number;
  playTimeSeconds: number;
  // Visual config (PlayerVisualConfigV4 shared part), for the 3D preview.
  classFlags?: number;
  costume?: number;
  skin?: number;
  face?: number;
  head?: number;
  hair?: number;
  hairColor?: [number, number, number];
  proportion?: [number, number];
}

export const CLASS_NAMES = [
  'HUmar', 'HUnewearl', 'HUcast', 'RAmar', 'RAcast', 'RAcaseal',
  'FOmarl', 'FOnewm', 'FOnewearl', 'HUcaseal', 'FOmar', 'RAmarl',
];

// class_flags of each class, from the client's default visual configs
// (PsoBB.exe 0x009b5f60, 0x70 bytes per class, field +0x34).
export const CLASS_FLAGS = [0x25, 0x2a, 0x31, 0x45, 0x51, 0x52, 0x86, 0x89, 0x8a, 0x32, 0x85, 0x46];

export const SECTION_IDS = [
  'Viridia', 'Greennill', 'Skyly', 'Bluefull', 'Purplenum',
  'Pinkal', 'Redria', 'Oran', 'Yellowboze', 'Whitill',
];

export const LOGIN_ERRORS: Record<number, string> = {
  1: 'Server connection failed',
  2: 'Incorrect Game ID or password',
  3: 'Incorrect Game ID or password',
  4: 'Server under maintenance',
  5: 'Game ID in use by another user',
  6: 'Game ID suspended',
  7: 'Game ID suspended',
  8: 'No record for this Game ID',
};

export interface NewCharacter {
  name: string; // up to 12 characters
  charClass: number; // index into CLASS_NAMES
  sectionId?: number; // defaults to the client's name + class formula (sectionIdForName)
  costume?: number;
  skin?: number;
  face?: number;
  head?: number;
  hair?: number;
  hairColor?: [number, number, number];
  proportion?: [number, number]; // 0..1 (x, y)
  classFlags?: number; // defaults to CLASS_FLAGS[charClass]
}

export interface MenuItem {
  menuId: number;
  itemId: number;
  name: string;
  flags: number;
}

// Section ID as derived by PsoBB.exe (FUN_004e7200, called when the new
// character is confirmed). The name is walked from its first character (the
// stored name starts with "\tE", which the client skips). Every character is
// added to a running sum; switching between narrow (< 0x100 or half-width
// katakana U+FF61..U+FF91) and wide characters adds 0x2D (to narrow) or 0x53
// (to wide), and the first character counts as such a switch. At most 17
// characters are read. The class number is added before taking mod 10, so the
// same name gives different section IDs for different classes.
export function sectionIdForName(name: string, charClass: number): number {
  const narrow = (c: number) => c < 0x100 || (c >= 0xff61 && c <= 0xff91);
  const chars = [...name.replace(/^\t[EJ]/, '')].map((ch) => ch.charCodeAt(0)).slice(0, 17);
  if (chars.length === 0) return charClass % 10;
  let wide = !narrow(chars[0]);
  let sum = chars[0] + (wide ? 0x53 : 0x2d);
  for (const c of chars.slice(1)) {
    sum += c;
    if (wide && narrow(c)) sum += 0x2d;
    else if (!wide && !narrow(c)) sum += 0x53;
    wide = !narrow(c);
  }
  const id = (charClass + sum) % 10;
  return id >= 0 && id < 10 ? id : 0;
}

export interface SessionOptions {
  nsk: Uint8Array;
  connect: TransportFactory;
  log?: (msg: string) => void;
}

export class BBSession {
  conn: BBConnection | null = null;
  init: ClientInit | null = null;
  // Latest full save data (00E7, SC_SyncSaveFiles_BB_E7, starts with the
  // PSOBBCharacterFile). Sent at login and again after leaving a game (98).
  fullCharacter: Uint8Array | null = null;
  // The same, parsed (net/charfile.ts); updated with every E7.
  character: CharacterFile | null = null;
  // The Lobby of the current game-server connection (set by enterLobby /
  // connectGameServer and replaced when a menu answer redirects to another
  // ship, see followRedirect).
  lobby: Lobby | null = null;
  // The guild card book (net/guildcard.ts), downloaded once per session on the
  // game server (startGuildCardSync); null until that sync is done.
  guildCards: GuildCardBook | null = null;
  // The E8 sender of the same connection: the Guild Card menu's add / comment / swap / delete.
  guildCardClient: GuildCardClient | null = null;
  // The Info Board sender (net/infoboard.ts), set with the lobby's connection.
  infoBoardClient: InfoBoardClient | null = null;
  private guildCardSync: Promise<GuildCardBook | null> | null = null;
  // What a redirect needs to log in again: the character slot and credentials
  // of the last game-server login.
  private gameLogin: { username: string; password: string; slot: number } | null = null;
  private opts: SessionOptions;

  constructor(opts: SessionOptions) {
    this.opts = opts;
  }

  private log(msg: string): void {
    this.opts.log?.(msg);
  }

  private async open(port: number): Promise<BBConnection> {
    this.conn?.close();
    const conn = new BBConnection(await this.opts.connect(port), this.opts.nsk);
    conn.onCommand = (c) => {
      this.log(`<- ${hex(c.command, 4)} flag=${c.flag} (${c.data.length} bytes)`);
      if (c.command === 0xe7) {
        this.fullCharacter = c.data;
        // The account's key config (system file at 0x2FB8 in the 00E7 record) becomes the live keys.
        applyKeyConfig(keyConfigFromCharacter(c.data));
        try {
          this.character = parseCharacterFile(c.data);
        } catch (err) {
          this.log(`E7 parse failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };
    this.conn = conn;
    await conn.waitFor(0x03, 0x9b);
    this.log(`connected to port ${port}, encryption ready`);
    return conn;
  }

  async login(username: string, password: string, port = 12000): Promise<ClientInit> {
    let conn = await this.open(port);
    conn.sendLogin({ username, password });
    let init = parseClientInit(await conn.waitFor(0xe6));
    if (init.errorCode) throw new Error(LOGIN_ERRORS[init.errorCode] ?? `login error ${init.errorCode}`);
    const redirect = parseReconnect(await conn.waitFor(0x19));
    this.log(`redirected to ${redirect.address}:${redirect.port}`);

    conn = await this.open(redirect.port);
    conn.sendLogin({
      username,
      password,
      guildCardNumber: init.guildCardNumber,
      securityToken: init.securityToken,
      clientConfig: init.clientConfig,
    });
    init = parseClientInit(await conn.waitFor(0xe6));
    if (init.errorCode) throw new Error(LOGIN_ERRORS[init.errorCode] ?? `login error ${init.errorCode}`);
    this.init = init;
    this.log(`logged in, guild card ${init.guildCardNumber}`);
    return init;
  }

  async characterPreviews(slots = 4): Promise<Array<CharacterPreview | null>> {
    const conn = this.requireConn();
    const out: Array<CharacterPreview | null> = [];
    for (let slot = 0; slot < slots; slot++) {
      const req = new Uint8Array(8);
      new DataView(req.buffer).setInt32(0, slot, true);
      conn.send(0xe3, 0, req);
      const resp = await conn.waitFor(0xe4, 0xe5);
      out.push(resp.command === 0xe5 ? parsePreview(resp.data) : null);
    }
    return out;
  }

  // E5 on the data-server connection; server answers E4 {slot, result=1}.
  async createCharacter(slot: number, c: NewCharacter): Promise<void> {
    const conn = this.requireConn();
    const body = new Uint8Array(0x80);
    const dv = new DataView(body.buffer);
    dv.setInt32(0, slot, true);
    const visual = 4 + 8; // SC_PlayerPreview: slot, then preview {exp, level, visual}
    const sh = visual + 0x10; // PlayerVisualConfigSharedT
    // The client writes the guild card number as "%10d" into the first 12
    // bytes (FUN_004f34a8) and keeps version 3 and class_flags from its
    // default visual config for the class.
    const gc = String(this.init?.guildCardNumber ?? 0).padStart(10, ' ');
    for (let i = 0; i < gc.length && i < 12; i++) body[visual + i] = gc.charCodeAt(i);
    dv.setUint32(sh + 0x08, 0xffffffff, true); // name color
    body[sh + 0x20] = c.sectionId ?? sectionIdForName(c.name, c.charClass);
    body[sh + 0x21] = c.charClass;
    body[sh + 0x23] = 3; // version
    dv.setUint32(sh + 0x24, c.classFlags ?? CLASS_FLAGS[c.charClass] ?? 0, true);
    dv.setUint16(sh + 0x28, c.costume ?? 0, true);
    dv.setUint16(sh + 0x2a, c.skin ?? 0, true);
    dv.setUint16(sh + 0x2c, c.face ?? 0, true);
    dv.setUint16(sh + 0x2e, c.head ?? 0, true);
    dv.setUint16(sh + 0x30, c.hair ?? 0, true);
    const [r, g, b] = c.hairColor ?? [0, 0, 0];
    dv.setUint16(sh + 0x32, r, true);
    dv.setUint16(sh + 0x34, g, true);
    dv.setUint16(sh + 0x36, b, true);
    const [px, py] = c.proportion ?? [0.5, 0.5];
    dv.setFloat32(sh + 0x38, px, true);
    dv.setFloat32(sh + 0x3c, py, true);
    const name = `\tE${c.name.slice(0, 12)}`;
    for (let i = 0; i < name.length; i++) dv.setUint16(visual + 0x50 + i * 2, name.charCodeAt(i), true);
    conn.send(0xe5, 0, body);
    const r1 = await conn.waitFor(0xe4, 0x1a, 0xd5);
    if (r1.command !== 0xe4 || new DataView(r1.data.buffer, r1.data.byteOffset).getUint32(4, true) !== 1) {
      throw new Error(r1.command === 0xe4 ? 'character creation rejected' : readUtf16(r1.data, 0, r1.data.length >> 1));
    }
    this.log(`character created in slot ${slot + 1}`);
  }

  // Game-server phase: 93 with connection_phase 4, main menu (07), "Go to lobby" (10) -> 67.
  async enterLobby(username: string, password: string, slot: number, port = 12000): Promise<Lobby> {
    const init = this.init;
    if (!init) throw new Error('log in first');
    const conn = await this.open(port);
    conn.sendLogin({
      username,
      password,
      guildCardNumber: init.guildCardNumber,
      securityToken: init.securityToken,
      clientConfig: init.clientConfig,
      connectionPhase: 4,
      characterSlot: slot,
    });
    const lobby = new Lobby(conn);
    this.lobby = lobby;
    this.gameLogin = { username, password, slot };
    const first = await conn.waitFor(0x07, 0x67, 0x1a, 0xd5);
    if (first.command === 0x1a || first.command === 0xd5) {
      throw new Error(readUtf16(first.data, 0, first.data.length >> 1));
    }
    // E7 (full save files) arrives before the menu; drop it from the backlog
    // (onCommand already stored and parsed it).
    if (conn.poll(0xe7) && this.character) {
      this.log(`character file: ${this.character.name}, ${this.character.inventory.length} items, ${this.character.meseta} meseta`);
    }
    if (first.command === 0x07) {
      const items = parseMenu(first.data);
      this.log(`main menu: ${items.map((i) => i.name).join(' | ')}`);
      const choice = items.find((i) => /lobby/i.test(i.name));
      if (!choice) throw new Error('server menu has no lobby entry');
      const sel = new Uint8Array(8);
      new DataView(sel.buffer).setUint32(0, choice.menuId, true);
      new DataView(sel.buffer).setUint32(4, choice.itemId, true);
      conn.send(0x10, 0, sel);
      await conn.waitFor(0x67);
    }
    this.log(`joined lobby ${lobby.lobbyNumber + 1}, block ${lobby.blockNumber}, client id ${lobby.selfId}`);
    this.startGuildCardSync(conn);
    return lobby;
  }

  // Guild card book after login (the exe's 01E8 checksum, then the 01DC / 03DC /
  // 02DC download when the server's copy differs; net/guildcard.ts). Once per
  // session and not awaited: the lobby does not wait for it, and a failure is
  // logged (the Guild Card menu then shows its empty row).
  startGuildCardSync(conn: BBConnection): void {
    if (this.guildCardSync) return;
    const client = new GuildCardClient(conn);
    this.guildCardClient = client;
    this.infoBoardClient = new InfoBoardClient(conn);
    this.guildCardSync = client
      .sync(null)
      .then((book) => {
        this.guildCards = book;
        this.log(`guild cards: ${book.cards().length} in the book`);
        return book;
      })
      .catch((err: unknown) => {
        this.log(`guild card sync failed: ${err instanceof Error ? err.message : String(err)}`);
        this.guildCardSync = null;
        return null;
      });
  }

  // BB stream file (data-server connection, after login): 04EB asks for the
  // index (01EB, flag = entry count, entries {u32 size, u32 crc32, u32 offset,
  // char name[0x40]}), then 03EB with flag = chunk index for each 0x6800-byte
  // chunk (02EB {u32 chunk_index, data}). The files are concatenated in index
  // order. newserv sends ItemPMT.prs, ItemMagEdit.prs, PlyLevelTbl.prs and the
  // BattleParamEntry*.dat tables (DataIndex::generate_bb_stream_file).
  async streamFiles(): Promise<Map<string, Uint8Array>> {
    return fetchStreamFiles(this.requireConn(), (m) => this.log(m));
  }

  // Game-server phase split in two steps for a UI that shows the server's
  // menu (classic client): 93 with connection_phase 4, then the first 07
  // (main menu; entry 0 is the menu title, item_id 0xFFFFFFFF) or a direct 67.
  async connectGameServer(username: string, password: string, slot: number, port = 12000): Promise<{ lobby: Lobby; menu: MenuItem[] | null }> {
    const init = this.init;
    if (!init) throw new Error('log in first');
    const conn = await this.open(port);
    conn.sendLogin({
      username,
      password,
      guildCardNumber: init.guildCardNumber,
      securityToken: init.securityToken,
      clientConfig: init.clientConfig,
      connectionPhase: 4,
      characterSlot: slot,
    });
    const lobby = new Lobby(conn);
    this.lobby = lobby;
    this.gameLogin = { username, password, slot };
    const first = await conn.waitFor(0x07, 0x67, 0x1a, 0xd5);
    if (first.command === 0x1a || first.command === 0xd5) {
      throw new Error(readUtf16(first.data, 0, first.data.length >> 1));
    }
    return { lobby, menu: first.command === 0x07 ? parseMenu(first.data) : null };
  }

  // 10 {menu_id, item_id}; resolves with the next menu (07) or null once the
  // lobby was joined (67). A 19 (reconnect to another ship / block server) is
  // followed: see followRedirect.
  async selectMenuItem(item: MenuItem): Promise<MenuItem[] | null> {
    const conn = this.requireConn();
    const sel = new Uint8Array(8);
    new DataView(sel.buffer).setUint32(0, item.menuId, true);
    new DataView(sel.buffer).setUint32(4, item.itemId, true);
    conn.send(0x10, 0, sel);
    return this.menuReply(conn);
  }

  // The counter's "Change SHIP" (ResetLobbyStateAndReturnToShipSelect
  // 0x0079ac9c: handler 4 = handle_ship_block_select_packets, send_packet0xa0)
  // and "Change BLOCK" (ExecuteLobbyJoinPartyAction 0x0079b208, send_packet0xa1).
  // Both send {player tag, guild card, 4 zero dwords} (0x20 bytes with the
  // header; the tag and card are the ship connection's +0x12120 / +0x12124,
  // stored from the 04 packet). newserv answers both the
  // same way (on_A0; "newserv doesn't have blocks"): 69 for the own client id,
  // an empty message box, B1, the full character again (E7) and the main menu
  // 07, so the same connection and character carry on and the ship select
  // screen is shown again. A server with real ships / blocks answers with a 07
  // titled "BLOCK" or a 19 (followed).
  async changeShip(): Promise<MenuItem[] | null> {
    return this.leaveToMenu(0xa0);
  }

  async changeBlock(): Promise<MenuItem[] | null> {
    return this.leaveToMenu(0xa1);
  }

  private async leaveToMenu(command: 0xa0 | 0xa1): Promise<MenuItem[] | null> {
    const conn = this.requireConn();
    const body = new Uint8Array(0x18);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, 0x00010000, true); // player tag
    dv.setUint32(4, this.init?.guildCardNumber ?? 0, true);
    conn.poll(0x07); // a stale menu must not answer this request
    conn.send(command, 0, body);
    return this.menuReply(conn);
  }

  // Waits for what a menu selection / A0 / A1 leads to: 07 (menu, returned),
  // 67 (lobby joined, null), 19 (reconnect, followed) or a message box (an
  // empty one is skipped: newserv sends it before the menu after A0; text is
  // an error).
  private async menuReply(conn: BBConnection): Promise<MenuItem[] | null> {
    for (;;) {
      const r = await conn.waitFor(0x07, 0x67, 0x19, 0x1a, 0xd5);
      if (r.command === 0x07) return parseMenu(r.data);
      if (r.command === 0x67) return null;
      if (r.command === 0x19) return this.followRedirect(parseReconnect(r));
      const text = readUtf16(r.data, 0, r.data.length >> 1);
      if (text) throw new Error(text);
    }
  }

  // 19 {address, port} during the game-server phase: the chosen ship / block
  // is another server. Connect to its port (through the same transport
  // factory, so the browser keeps going through the bridge), log in again with
  // phase 4 and the same character slot, and continue with its menu or lobby.
  // The new connection gets a new Lobby (session.lobby). Not exercised against
  // a live multi-ship server (newserv never sends 19 here).
  private async followRedirect(redirect: { address: string; port: number }): Promise<MenuItem[] | null> {
    const init = this.init;
    const login = this.gameLogin;
    if (!init || !login) throw new Error('log in first');
    this.log(`redirected to ${redirect.address}:${redirect.port}`);
    const conn = await this.open(redirect.port);
    conn.sendLogin({
      username: login.username,
      password: login.password,
      guildCardNumber: init.guildCardNumber,
      securityToken: init.securityToken,
      clientConfig: init.clientConfig,
      connectionPhase: 4,
      characterSlot: login.slot,
    });
    this.lobby = new Lobby(conn);
    return this.menuReply(conn);
  }

  close(): void {
    this.conn?.close();
    this.conn = null;
  }

  private requireConn(): BBConnection {
    if (!this.conn) throw new Error('not connected');
    return this.conn;
  }
}

// 07 menu: entries of S_MenuItem_PC_BB_08 (0x2C): u32 menu_id, u32 item_id,
// u8 difficulty, u8 players, UTF-16 name[0x10], u8 episode, u8 flags
export function parseMenu(data: Uint8Array): MenuItem[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const items: MenuItem[] = [];
  for (let o = 0; o + 0x2c <= data.length; o += 0x2c) {
    items.push({
      menuId: dv.getUint32(o, true),
      itemId: dv.getUint32(o + 4, true),
      name: readUtf16(data, o + 0x0a, 0x10).replace(/\t[EJ]/g, ''),
      flags: data[o + 0x2b],
    });
  }
  return items;
}

// S_ClientInit_BB_00E6: error_code, player_tag, guild_card_number, security_token, client_config[0x28]
export function parseClientInit(cmd: Command): ClientInit {
  const dv = new DataView(cmd.data.buffer, cmd.data.byteOffset, cmd.data.byteLength);
  return {
    errorCode: dv.getUint32(0x00, true),
    guildCardNumber: dv.getUint32(0x08, true),
    securityToken: dv.getUint32(0x0c, true),
    clientConfig: cmd.data.slice(0x10, 0x38),
  };
}

// S_Reconnect_19: be_uint32 address, le_uint16 port
export function parseReconnect(cmd: Command): { address: string; port: number } {
  const d = cmd.data;
  return { address: `${d[0]}.${d[1]}.${d[2]}.${d[3]}`, port: d[4] | (d[5] << 8) };
}

// SC_PlayerPreview_CreateCharacter_BB_00E5: character_index, PlayerDispDataV4Preview (0x7C)
//   preview: exp, level, visual (0x70: gc string[0x10], shared[0x40], name utf16[0x20]), play_time
export function parsePreview(data: Uint8Array): CharacterPreview {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const p = 4;
  const visual = p + 8;
  const shared = visual + 0x10;
  return {
    slot: dv.getInt32(0, true),
    exp: dv.getUint32(p, true),
    level: dv.getUint32(p + 4, true) + 1,
    sectionId: data[shared + 0x20],
    charClass: data[shared + 0x21],
    name: readUtf16(data, visual + 0x50, 0x10).replace(/^\t[EJ]/, ''),
    playTimeSeconds: dv.getUint32(p + 0x78, true),
    // shared config: class_flags @+0x24, costume/skin/face/head/hair u16
    // @+0x28..+0x30, hair_r/g/b u16 @+0x32..+0x36, proportion_x/y f32 @+0x38/+0x3C
    classFlags: dv.getUint32(shared + 0x24, true),
    costume: dv.getUint16(shared + 0x28, true),
    skin: dv.getUint16(shared + 0x2a, true),
    face: dv.getUint16(shared + 0x2c, true),
    head: dv.getUint16(shared + 0x2e, true),
    hair: dv.getUint16(shared + 0x30, true),
    hairColor: [dv.getUint16(shared + 0x32, true), dv.getUint16(shared + 0x34, true), dv.getUint16(shared + 0x36, true)],
    proportion: [dv.getFloat32(shared + 0x38, true), dv.getFloat32(shared + 0x3c, true)],
  };
}

export function hex(v: number, width = 2): string {
  return v.toString(16).toUpperCase().padStart(width, '0');
}

// BB stream file over any connection (see BBSession.streamFiles; newserv answers
// 04EB / 03EB on the game server too).
export async function fetchStreamFiles(conn: BBConnection, log: (msg: string) => void = () => {}): Promise<Map<string, Uint8Array>> {
  conn.send(0x04eb, 0);
  const index = await conn.waitFor(0x01eb);
  const dv = new DataView(index.data.buffer, index.data.byteOffset, index.data.byteLength);
  const entries: Array<{ name: string; size: number; offset: number }> = [];
  for (let i = 0; i < index.flag && (i + 1) * 0x4c <= index.data.length; i++) {
    const o = i * 0x4c;
    entries.push({ size: dv.getUint32(o, true), offset: dv.getUint32(o + 8, true), name: readAscii(index.data, o + 12, 0x40) });
  }
  const total = entries.reduce((n, e) => Math.max(n, e.offset + e.size), 0);
  const stream = new Uint8Array(total);
  const CHUNK = 0x6800;
  for (let chunk = 0; chunk * CHUNK < total; chunk++) {
    conn.send(0x03eb, chunk);
    const c = await conn.waitFor(0x02eb);
    const at = new DataView(c.data.buffer, c.data.byteOffset).getUint32(0, true) * CHUNK;
    stream.set(c.data.subarray(4, 4 + Math.min(CHUNK, total - at)), at);
  }
  const files = new Map<string, Uint8Array>();
  for (const e of entries) files.set(e.name, stream.slice(e.offset, e.offset + e.size));
  log(`stream file: ${entries.map((e) => `${e.name} (${e.size})`).join(', ')}`);
  return files;
}
