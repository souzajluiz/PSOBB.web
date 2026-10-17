// Lobby state on top of a game-server BBConnection.
// Layouts from newserv src/CommandFormats.hh and src/PlayerSubordinates.hh (MIT).
//
// 67 (join lobby, all players) / 68 (one player joined) / 69 (player left, flag = client id)
//   LobbyFlags (0x0C): client_id, leader_id, disable_udp, lobby_number, block_number, ...
//   Entry (0x520): PlayerLobbyDataBB (0x44), PlayerInventory (0x34C), PlayerDispDataV4 (0x190)
//   PlayerDispDataV4: PlayerStats (0x24; level @+0x18), PlayerVisualConfigV4 (0x70) @+0x24
//   PlayerVisualConfigV4: guild card string[0x10], shared config @+0x10: section_id @+0x20,
//     char_class @+0x21, costume/skin/face/head/hair u16 @+0x28..+0x30, hair_r/g/b u16
//     @+0x32..+0x36, proportion_x/y f32 @+0x38/+0x3C
// 06 chat: u32 unused, u32 guild_card_number, UTF-16 text
// 60/62 game subcommands: u8 subcommand, u8 size (dwords), u16 client_id, payload

import { readUtf16, type BBConnection, type Command } from './bbconnection.ts';
import type { PlayerAppearance } from '../render/playermodel.ts';

export interface LobbyPlayer {
  clientId: number;
  guildCardNumber: number;
  name: string;
  charClass: number;
  sectionId: number;
  level: number;
  appearance: PlayerAppearance;
  position: { x: number; y: number; z: number };
  angle: number; // radians
  moving: boolean;
  gait: 'walk' | 'run'; // last 6x40 (walk) or 6x42 (run)
  floor: number;
}

export interface LobbyEvents {
  joined: (players: LobbyPlayer[]) => void;
  playerJoined: (p: LobbyPlayer) => void;
  playerLeft: (clientId: number) => void;
  moved: (p: LobbyPlayer) => void;
  chat: (from: LobbyPlayer | null, guildCardNumber: number, text: string) => void;
  subcommand: (sub: number, clientId: number, data: Uint8Array) => void;
}

const ENTRY_SIZE = 0x520;
const LOBBY_DATA = 0;
const DISP = 0x44 + 0x34c;
const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

export function stripMarkers(s: string): string {
  // PSO text uses \tE / \tJ language markers and \tC<x> color escapes.
  return s.replace(/\t[EJ]/g, '').replace(/\tC[0-9A-Za-z]/g, '');
}

function parseEntry(data: Uint8Array, o: number): LobbyPlayer {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const visual = o + DISP + 0x24;
  const shared = visual + 0x10;
  const u16 = (o: number) => dv.getUint16(shared + o, true);
  const appearance: PlayerAppearance = {
    sectionId: data[shared + 0x20],
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
  return {
    clientId: dv.getUint32(o + LOBBY_DATA + 0x1c, true),
    guildCardNumber: dv.getUint32(o + LOBBY_DATA + 0x04, true),
    name: stripMarkers(readUtf16(data, o + LOBBY_DATA + 0x20, 0x10)),
    charClass: data[shared + 0x21],
    sectionId: data[shared + 0x20],
    level: dv.getUint32(o + DISP + 0x18, true) + 1, // PlayerStats.level (0-based)
    appearance,
    position: { x: 0, y: 0, z: 0 },
    angle: 0,
    moving: false,
    gait: 'run',
    floor: 0,
  };
}

export class Lobby {
  readonly conn: BBConnection;
  players = new Map<number, LobbyPlayer>();
  selfId = -1;
  leaderId = -1;
  lobbyNumber = 0;
  blockNumber = 0;
  private listeners = new Map<keyof LobbyEvents, Array<(...args: never[]) => void>>();

  constructor(conn: BBConnection) {
    this.conn = conn;
    const prev = conn.onCommand;
    conn.onCommand = (c) => {
      prev(c);
      this.handle(c);
    };
  }

  on<K extends keyof LobbyEvents>(event: K, fn: LobbyEvents[K]): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn as (...args: never[]) => void);
    this.listeners.set(event, list);
  }

  private emit<K extends keyof LobbyEvents>(event: K, ...args: Parameters<LobbyEvents[K]>): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as unknown as (...a: Parameters<LobbyEvents[K]>) => void)(...args);
  }

  get self(): LobbyPlayer | undefined {
    return this.players.get(this.selfId);
  }

  handle(c: Command): void {
    switch (c.command) {
      case 0x67:
      case 0x68:
        this.onJoin(c);
        break;
      case 0x69: {
        const id = c.flag;
        this.players.delete(id);
        this.emit('playerLeft', id);
        break;
      }
      case 0x06:
        this.onChat(c);
        break;
      case 0x60:
      case 0x62:
      case 0x6c:
      case 0x6d:
        this.onSubcommands(c.data);
        break;
    }
  }

  private onJoin(c: Command): void {
    const d = c.data;
    const count = c.flag;
    if (c.command === 0x67) {
      this.players.clear();
      this.selfId = d[0];
      this.leaderId = d[1];
      this.lobbyNumber = d[3];
      this.blockNumber = d[4];
    }
    const added: LobbyPlayer[] = [];
    for (let i = 0; i < count; i++) {
      const o = 0x0c + i * ENTRY_SIZE;
      if (o + ENTRY_SIZE > d.length) break;
      const p = parseEntry(d, o);
      this.players.set(p.clientId, p);
      added.push(p);
    }
    if (c.command === 0x67) {
      this.emit('joined', added);
      // Ask the others where they are (they answer with 6x20 / 6x3F).
      this.sendSubcommand(0x1f, new Uint8Array(4));
    } else {
      for (const p of added) this.emit('playerJoined', p);
    }
  }

  private onChat(c: Command): void {
    const dv = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
    const gc = dv.getUint32(4, true);
    // Text arrives as "<sender name>\t<message>" (with language markers).
    const raw = stripMarkers(readUtf16(c.data, 8, (c.data.length - 8) >> 1));
    const tab = raw.indexOf('\t');
    const text = tab >= 0 ? raw.slice(tab + 1) : raw;
    const from = [...this.players.values()].find((p) => p.guildCardNumber === gc) ?? null;
    this.emit('chat', from, gc, text);
  }

  private onSubcommands(data: Uint8Array): void {
    let o = 0;
    while (o + 4 <= data.length) {
      const sub = data[o];
      const size = data[o + 1] * 4;
      if (!size || o + size > data.length) break;
      const body = data.subarray(o, o + size);
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const clientId = dv.getUint16(2, true);
      const p = this.players.get(clientId);
      if (p) {
        switch (sub) {
          case 0x20: // set position: floor, pos xyz, angle_y
            p.floor = dv.getInt32(4, true);
            p.position = { x: dv.getFloat32(8, true), y: dv.getFloat32(12, true), z: dv.getFloat32(16, true) };
            p.angle = dv.getUint32(20, true) * BAMS_TO_RAD;
            p.moving = false;
            this.emit('moved', p);
            break;
          case 0x3e: // stop at position
          case 0x3f: // set position
            p.angle = dv.getUint16(6, true) * BAMS_TO_RAD;
            p.floor = dv.getInt16(8, true);
            p.position = { x: dv.getFloat32(12, true), y: dv.getFloat32(16, true), z: dv.getFloat32(20, true) };
            p.moving = false;
            this.emit('moved', p);
            break;
          case 0x40: // walk to x,z
          case 0x42: // run to x,z
            p.position = { x: dv.getFloat32(4, true), y: p.position.y, z: dv.getFloat32(8, true) };
            p.moving = true;
            p.gait = sub === 0x40 ? 'walk' : 'run';
            this.emit('moved', p);
            break;
        }
      }
      // A player that just joined asks everyone for their position.
      if (sub === 0x1f && clientId !== this.selfId) this.sendPosition();
      this.emit('subcommand', sub, clientId, body);
      o += size;
    }
  }

  // Sends one 6x subcommand via 60. `payload` excludes the 4-byte header.
  sendSubcommand(sub: number, payload: Uint8Array, command = 0x60): void {
    const body = new Uint8Array(4 + payload.length);
    body[0] = sub;
    body[1] = body.length / 4;
    new DataView(body.buffer).setUint16(2, this.selfId, true);
    body.set(payload, 4);
    this.conn.send(command, 0, body);
  }

  sendChat(text: string): void {
    const s = `\tE${text}`;
    const body = new Uint8Array(8 + (s.length + 1) * 2 + 2);
    const dv = new DataView(body.buffer);
    for (let i = 0; i < s.length; i++) dv.setUint16(8 + i * 2, s.charCodeAt(i), true);
    // pad to 4 bytes
    const padded = new Uint8Array((body.length + 3) & ~3);
    padded.set(body);
    this.conn.send(0x06, 0, padded);
  }

  // 6x42: running toward (x, z).
  sendRun(x: number, z: number): void {
    const p = new Uint8Array(8);
    const dv = new DataView(p.buffer);
    dv.setFloat32(0, x, true);
    dv.setFloat32(4, z, true);
    this.sendSubcommand(0x42, p);
    this.updateSelf(x, undefined, z, undefined, true);
  }

  // 6x3E: stop at (x, y, z) facing `angle` radians.
  sendStop(x: number, y: number, z: number, angle: number): void {
    const p = new Uint8Array(0x14);
    const dv = new DataView(p.buffer);
    dv.setUint16(0, 0, true); // is_near_enemy
    dv.setUint16(2, Math.round((angle / (Math.PI * 2)) * 0x10000) & 0xffff, true);
    dv.setInt16(4, this.self?.floor ?? 0, true);
    dv.setInt16(6, 0, true); // room
    dv.setFloat32(8, x, true);
    dv.setFloat32(12, y, true);
    dv.setFloat32(16, z, true);
    this.sendSubcommand(0x3e, p);
    this.updateSelf(x, y, z, angle, false);
  }

  // 6x20: answer a 6x1F position request.
  sendPosition(): void {
    const me = this.self;
    if (!me) return;
    const p = new Uint8Array(0x14);
    const dv = new DataView(p.buffer);
    dv.setInt32(0, me.floor, true);
    dv.setFloat32(4, me.position.x, true);
    dv.setFloat32(8, me.position.y, true);
    dv.setFloat32(12, me.position.z, true);
    dv.setUint32(16, Math.round((me.angle / (Math.PI * 2)) * 0x10000) & 0xffff, true);
    this.sendSubcommand(0x20, p);
  }

  private updateSelf(x: number, y: number | undefined, z: number, angle: number | undefined, moving: boolean): void {
    const me = this.self;
    if (!me) return;
    me.position = { x, y: y ?? me.position.y, z };
    if (angle !== undefined) me.angle = angle;
    me.moving = moving;
  }
}
