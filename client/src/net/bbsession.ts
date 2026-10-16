// High-level BB login flow on top of BBConnection.
//
// Data server phase (newserv ReceiveCommands.cc on_93_BB):
//   1. connect bb-data1, 03 init, send 93 with guild_card_number = 0
//   2. server answers E6 (guild card, security token, client config) + 19 redirect
//   3. reconnect to the redirect port, send 93 again carrying those values
//   4. ask for each character slot with E3; server answers E5 (preview) or E4 (empty)

import { BBConnection, readUtf16, type Command, type Transport } from './bbconnection.ts';

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

  close(): void {
    this.conn?.close();
    this.conn = null;
  }

  private requireConn(): BBConnection {
    if (!this.conn) throw new Error('not connected');
    return this.conn;
  }
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
