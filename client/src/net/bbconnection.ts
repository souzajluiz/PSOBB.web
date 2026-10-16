// PSO Blue Burst connection: framing, encryption setup and the login command.
// Command layouts follow newserv src/CommandFormats.hh (MIT license).
//
// Wire format: every command starts with an 8-byte header
//   u16 size (includes header, excludes padding), u16 command, u32 flag
// and, once encrypted, is zero-padded to a multiple of 8 bytes. After the server's 03 command,
// both directions are encrypted with BBCrypt (STANDARD subtype is stateless
// per 8-byte block, so the header can be decrypted before the body).

import { BBCrypt } from './bbcrypt.ts';

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
  onData: (data: Uint8Array) => void;
  onClose: () => void;
}

export interface Command {
  command: number;
  flag: number;
  data: Uint8Array; // payload without header or padding
}

export const HEADER_SIZE = 8;

export interface LoginParams {
  username: string;
  password: string;
  connectionPhase?: number; // 0 = initial, 4 = login server, 5 = lobby
  characterSlot?: number;
  guildCardNumber?: number;
  securityToken?: number;
  clientConfig?: Uint8Array; // 0x28 bytes echoed back from the server's E6 command
  versionString?: string;
}

export class BBConnection {
  private transport: Transport;
  private nsk: Uint8Array;
  private inCrypt: BBCrypt | null = null;
  private outCrypt: BBCrypt | null = null;
  private buffer = new Uint8Array(0);
  private waiters: Array<{ match: (c: Command) => boolean; resolve: (c: Command) => void }> = [];
  // Commands no waiter has claimed yet. Several commands often arrive in one
  // chunk (e.g. E6 + 19), so a waiter registered after an await must still see them.
  private backlog: Command[] = [];

  onCommand: (cmd: Command) => void = () => {};
  onClose: () => void = () => {};

  constructor(transport: Transport, nsk: Uint8Array) {
    this.transport = transport;
    this.nsk = nsk;
    transport.onData = (d) => this.receive(d);
    transport.onClose = () => this.onClose();
  }

  // Resolves with the next unclaimed command whose number is in `commands`.
  waitFor(...commands: number[]): Promise<Command> {
    const match = (c: Command) => commands.includes(c.command);
    const i = this.backlog.findIndex(match);
    if (i >= 0) return Promise.resolve(this.backlog.splice(i, 1)[0]);
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  send(command: number, flag: number, payload: Uint8Array = new Uint8Array(0)): void {
    const size = HEADER_SIZE + payload.length;
    const padded = new Uint8Array((size + 7) & ~7);
    const dv = new DataView(padded.buffer);
    dv.setUint16(0, size, true);
    dv.setUint16(2, command, true);
    dv.setUint32(4, flag, true);
    padded.set(payload, HEADER_SIZE);
    if (!this.outCrypt) throw new Error('cannot send before the server init (03) command');
    this.outCrypt.encrypt(padded);
    this.transport.send(padded);
  }

  sendLogin(p: LoginParams): void {
    const body = new Uint8Array(0xa4);
    const dv = new DataView(body.buffer);
    dv.setUint32(0x00, 0x00010000, true); // player_tag
    dv.setUint32(0x04, p.guildCardNumber ?? 0, true);
    dv.setUint32(0x08, 0x41, true); // sub_version
    body[0x0c] = 1; // language: English
    body[0x0d] = p.characterSlot ?? 0;
    body[0x0e] = p.connectionPhase ?? 0;
    dv.setUint32(0x10, p.securityToken ?? 0, true);
    writeAscii(body, 0x14, 0x30, p.username);
    writeAscii(body, 0x44, 0x30, p.password);
    if (p.clientConfig) body.set(p.clientConfig.subarray(0, 0x28), 0x7c);
    else writeAscii(body, 0x7c, 0x28, p.versionString ?? 'Ver. 1.25.13');
    this.send(0x93, 0, body);
  }

  close(): void {
    this.transport.close();
  }

  private receive(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    for (;;) {
      if (this.buffer.length < HEADER_SIZE) return;
      const header = this.buffer.slice(0, HEADER_SIZE);
      this.inCrypt?.decrypt(header);
      const hv = new DataView(header.buffer);
      const size = hv.getUint16(0, true);
      if (size < HEADER_SIZE) throw new Error(`bad command size ${size}`);
      // Only encrypted commands are padded; the cleartext 03 init is sent as-is.
      const padded = this.inCrypt ? (size + 7) & ~7 : size;
      if (this.buffer.length < padded) return;

      const raw = this.buffer.slice(0, padded);
      this.buffer = this.buffer.slice(padded);
      this.inCrypt?.decrypt(raw);
      const rv = new DataView(raw.buffer);
      const cmd: Command = {
        command: rv.getUint16(2, true),
        flag: rv.getUint32(4, true),
        data: raw.slice(HEADER_SIZE, size),
      };
      if (!this.inCrypt && (cmd.command === 0x03 || cmd.command === 0x9b)) this.setupCrypt(cmd);
      this.dispatch(cmd);
    }
  }

  // 03/9B: copyright[0x60], server_key[0x30], client_key[0x30]
  private setupCrypt(cmd: Command): void {
    const serverKey = cmd.data.slice(0x60, 0x90);
    const clientKey = cmd.data.slice(0x90, 0xc0);
    this.inCrypt = new BBCrypt(this.nsk, serverKey);
    this.outCrypt = new BBCrypt(this.nsk, clientKey);
  }

  private dispatch(cmd: Command): void {
    this.onCommand(cmd);
    const i = this.waiters.findIndex((w) => w.match(cmd));
    if (i >= 0) {
      this.waiters.splice(i, 1)[0].resolve(cmd);
    } else {
      this.backlog.push(cmd);
      if (this.backlog.length > 256) this.backlog.shift();
    }
  }
}

export function writeAscii(dst: Uint8Array, offset: number, maxLen: number, s: string): void {
  for (let i = 0; i < Math.min(s.length, maxLen - 1); i++) dst[offset + i] = s.charCodeAt(i) & 0x7f;
}

export function readAscii(src: Uint8Array, offset: number, maxLen: number): string {
  let s = '';
  for (let i = 0; i < maxLen && offset + i < src.length && src[offset + i]; i++) s += String.fromCharCode(src[offset + i]);
  return s;
}

export function readUtf16(src: Uint8Array, offset: number, maxChars: number): string {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let s = '';
  for (let i = 0; i < maxChars && offset + i * 2 + 1 < src.length; i++) {
    const c = dv.getUint16(offset + i * 2, true);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}
