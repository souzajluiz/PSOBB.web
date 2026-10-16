// High-level BB login flow on top of BBConnection.
//
// Data server phase (newserv ReceiveCommands.cc on_93_BB):
//   1. connect bb-data1, 03 init, send 93 with guild_card_number = 0
//   2. server answers E6 (guild card, security token, client config) + 19 redirect
//   3. reconnect to the redirect port, send 93 again carrying those values
//   4. ask for each character slot with E3; server answers E5 (preview) or E4 (empty)

import { BBConnection, readUtf16, type Command, type Transport } from './bbconnection.ts';
import { Lobby } from './lobby.ts';

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
}

export const CLASS_NAMES = [
  'HUmar', 'HUnewearl', 'HUcast', 'RAmar', 'RAcast', 'RAcaseal',
  'FOmarl', 'FOnewm', 'FOnewearl', 'HUcaseal', 'FOmar', 'RAmarl',
];

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
  sectionId?: number; // defaults to the PSO name-based formula
  costume?: number;
  skin?: number;
  face?: number;
  head?: number;
  hair?: number;
  hairColor?: [number, number, number];
  proportion?: [number, number]; // 0..1 (x, y)
}

export interface MenuItem {
  menuId: number;
  itemId: number;
  name: string;
  flags: number;
}

// Section ID as derived by PSO from the character name: sum of the name's
// character codes, mod 10 (community-documented; to be confirmed against the client).
export function sectionIdForName(name: string): number {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return sum % 10;
}

export interface SessionOptions {
  nsk: Uint8Array;
  connect: TransportFactory;
  log?: (msg: string) => void;
}

export class BBSession {
  conn: BBConnection | null = null;
  init: ClientInit | null = null;
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
    conn.onCommand = (c) =>
      this.log(`<- ${hex(c.command, 4)} flag=${c.flag} (${c.data.length} bytes)`);
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
    dv.setUint32(sh + 0x08, 0xffffffff, true); // name color
    body[sh + 0x20] = c.sectionId ?? sectionIdForName(c.name);
    body[sh + 0x21] = c.charClass;
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
    const first = await conn.waitFor(0x07, 0x67, 0x1a, 0xd5);
    if (first.command === 0x1a || first.command === 0xd5) {
      throw new Error(readUtf16(first.data, 0, first.data.length >> 1));
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
    return lobby;
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
  };
}

export function hex(v: number, width = 2): string {
  return v.toString(16).toUpperCase().padStart(width, '0');
}
