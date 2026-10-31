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
import type { CombatStats } from '../combat/pvp.ts';
import { applyRemoteEquip, equippedWeaponOf, INVENTORY_BYTES } from './playerweapon.ts';
import { chatLineSends, EmoteQueue, parseEmoteKeys, parseEmoteSubcommand, parseSitSubcommand } from '../formats/emotes.ts';
import type { SetPositionState } from './game.ts';
import { TradeSession, TRADE_SUB, TRADE_SUB_SIZE } from './trade.ts';
import type { SymbolChat } from './symbolchat.ts';
import { WORD_SELECT_SUBCOMMAND, wordSelectSubcommandPayload, type WordSelectMessage } from './chatshortcut.ts';
import { parseWordSelectSubcommand } from './wordselect.ts';
import { tradeIO, type TradeHost } from './tradeio.ts';
import { TradeZone } from './tradezone.ts';
import { MasterTransferReceiver, parseInviteAnswer, parseMasterAnswer, TEAM_INVITE_ANSWER_SUB, TEAM_INVITE_SIZE, TEAM_INVITE_SUB, TEAM_MASTER_ANSWER_SUB, TEAM_MASTER_SUB, TeamInviteReceiver } from './team.ts';

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
  // The guard stance (in_guard_stance) of the last 6x3E / 6x3F (+4): a walk's packets do not carry it.
  guard: boolean;
  gait: 'walk' | 'run'; // last 6x40 (walk) or 6x42 (run)
  floor: number;
  visible?: boolean; // games: 6x22 (invisible while changing floors) / 6x23
  // A quest's NPC player (6x69, quest/npcplayers.ts): the npcplayerchar.dat
  // template it was made from.
  npcTemplate?: number;
  // PlayerStats char_stats.hp and the inventory's HP materials byte (the
  // party members' windows compute max HP from them: combat/partyhp.ts),
  // and PlayerVisualConfig name_color (ARGB).
  hpStat?: number;
  hpMaterials?: number;
  nameColor?: number;
  // The equipped weapon's ItemData data1 (12 bytes; null = none) and the
  // PlayerInventory copy it comes from, kept in step with the 6x25 / 6x26 of
  // this player (render/heldweapon.ts draws the weapon).
  weapon?: Uint8Array | null;
  inventory?: Uint8Array;
  // PlayerStats of the last 6x70 (atp, evp, dfp, ata, lck): the Battle mode hit check
  // of a strike on the local player (combat/pvp.ts).
  combatStats?: CombatStats;
  // The MST of the player's battleparams_stats (6x70 at 0x142, then each 6x30): the caster's
  // MST in a remote Resta's heal (combat/techniques.ts remoteRestaHeal). Unknown = undefined.
  mst?: number;
}

export interface LobbyEvents {
  joined: (players: LobbyPlayer[]) => void;
  playerJoined: (p: LobbyPlayer) => void;
  playerLeft: (clientId: number) => void;
  moved: (p: LobbyPlayer) => void;
  teleported: (p: LobbyPlayer) => void; // 6x55: placed at once, no walk
  // 6x58: another player's emote (slot in the map of the session's kind; opposite = flag 1).
  emote: (p: LobbyPlayer, slot: number, opposite: boolean) => void;
  // 6xAB: another player's sit (chair = flag 2, slot 49 instead of 48; opposite = flag 1).
  sit: (p: LobbyPlayer, chair: boolean, opposite: boolean) => void;
  // 6x3E: another player stopped (move_stop); a sitting player stands up on it (ASSUMED: the receiver's move-stop transition, dump 0x698b74 path not fully traced).
  stopped: (p: LobbyPlayer) => void;
  chat: (from: LobbyPlayer | null, guildCardNumber: number, text: string) => void;
  // 6x07: a symbol chat said in the room (symbolchat.ts; the bubble is not drawn yet).
  symbolChat: (clientId: number, chat: SymbolChat) => void;
  // 6x74: a word select message from a player in the room (net/wordselect.ts; drawn by classic/chat.ts receiveWord).
  wordSelect: (clientId: number, message: WordSelectMessage) => void;
  subcommand: (sub: number, clientId: number, data: Uint8Array) => void;
  // 6x06: a guild card another player sent (the 0x108 card at +4; exe handle_packet0x60_subcommand0x6).
  guildCardSent: (body: Uint8Array) => void;
  // S->C 0x81: a Simple Mail (net/simplemail.ts; the body is the 0x454 bytes after the header).
  simpleMail: (body: Uint8Array) => void;
  floorChanged: (p: LobbyPlayer) => void; // games: 6x1F / 6x21 / 6x70 from another player
  visibilityChanged: (p: LobbyPlayer) => void; // games: 6x22 (hidden while it changes floors) / 6x23
  // S->C 0x23: the Momoka item exchange's answer (flag 0 ok, 1 no item, 2 full inventory; other = failed), newserv on_momoka_item_exchange_bb.
  momokaResult: (code: number) => void;
  // B0 (RcvEmergencyCall): server text for the player's message window
  // (handle_b0_packet -> DisplayChallengeResultToPlayer_00718350).
  serverText: (text: string) => void;
}

const ENTRY_SIZE = 0x520;
const LOBBY_DATA = 0;
const ENTRY_INVENTORY = 0x44; // PlayerInventory within a 0x520 entry
const DISP = 0x44 + 0x34c;
const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;
// Numbers each Lobby object for the [lobby] console logs (lobby#N).
let lobbySeq = 0;

export function stripMarkers(s: string): string {
  // PSO text uses \tE / \tJ language markers and \tC<x> color escapes.
  return s.replace(/\t[EJ]/g, '').replace(/\tC[0-9A-Za-z]/g, '');
}

// One 0x520-byte 65/67/68 entry (PlayerLobbyDataBB + PlayerInventory + PlayerDispDataV4).
export function parseLobbyPlayer(data: Uint8Array, o: number): LobbyPlayer {
  return parseEntry(data, o);
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
  const inventory = data.slice(o + ENTRY_INVENTORY, o + ENTRY_INVENTORY + INVENTORY_BYTES);
  return {
    inventory,
    weapon: equippedWeaponOf(inventory),
    clientId: dv.getUint32(o + LOBBY_DATA + 0x1c, true),
    guildCardNumber: dv.getUint32(o + LOBBY_DATA + 0x04, true),
    name: stripMarkers(readUtf16(data, o + LOBBY_DATA + 0x20, 0x10)),
    charClass: data[shared + 0x21],
    sectionId: data[shared + 0x20],
    level: dv.getUint32(o + DISP + 0x18, true) + 1, // PlayerStats.level (0-based)
    hpStat: dv.getUint16(o + DISP + 0x06, true),
    hpMaterials: data[o + 0x44 + 1],
    nameColor: dv.getUint32(shared + 0x08, true),
    appearance,
    position: { x: 0, y: 0, z: 0 },
    angle: 0,
    moving: false,
    guard: false,
    gait: 'run',
    floor: 0,
  };
}

// The 6x3E body (20 bytes after the 4-byte header). Exe: dispatch_action_move_stop
// (PsoBB.exe dump 587490) writes action move_stop 0x3e, size 6, then guard
// (`character_flags & in_guard_stance`, +4), heading (+6), floor (+8), room
// (get_player_room_id, +0xa), xyz (+0xc). The port sends the facing at +6, as it
// does for 6x3F (net/game.ts setPositionBody).
export function stopBody(pos: { x: number; y: number; z: number }, angle: number, floor: number, state: SetPositionState): Uint8Array {
  const p = new Uint8Array(0x14);
  const dv = new DataView(p.buffer);
  dv.setUint16(0, state.guard ? 1 : 0, true);
  dv.setUint16(2, Math.round((angle / (Math.PI * 2)) * 0x10000) & 0xffff, true);
  dv.setInt16(4, floor, true);
  dv.setInt16(6, state.room, true);
  dv.setFloat32(8, pos.x, true);
  dv.setFloat32(12, pos.y, true);
  dv.setFloat32(16, pos.z, true);
  return p;
}

export class Lobby {
  readonly conn: BBConnection;
  players = new Map<number, LobbyPlayer>();
  // The local player's chat emote keys ({key} in a sent line, formats/emotes.ts);
  // the view plays and sends them (render/lobbyview.ts).
  readonly emoteQueue = new EmoteQueue();
  selfId = -1;
  // Team Invite received (6xC1, net/team.ts TeamInviteReceiver). `teamInviteFree` is the receiver's
  // gate: the menus set it (classic/homeleaves.ts); a refused invite is answered here at once.
  readonly teamInvites = new TeamInviteReceiver();
  teamInviteFree: () => boolean = () => true;
  // Master Transfer requests received (6xCD, net/team.ts MasterTransferReceiver); the same gate rule.
  readonly masterRequests = new MasterTransferReceiver();
  masterFree: () => boolean = () => true;
  // Player trade (net/trade.ts, the Home menu's Trade Window). The host gives the
  // session the character and the notices; the session is made for the current self id
  // on first use (6xA6 / D1 / D4 may arrive before any window is open).
  tradeHost: TradeHost | null = null;
  private tradeSession: TradeSession | null = null;
  // The trade zone bits (net/tradezone.ts); the field drives them from its collision objects.
  readonly tradeZone = new TradeZone();
  get trade(): TradeSession {
    if (!this.tradeSession || this.tradeSession.self !== this.selfId) {
      this.tradeSession = new TradeSession(
        this.selfId,
        tradeIO({
          send: (p) => this.conn.send(p.command, p.flag, p.payload),
          host: () => this.tradeHost,
          isPresent: (id) => id === this.selfId || this.players.has(id),
          inTradeZone: (id) => this.tradeZone.inZone(id),
        }),
      );
    }
    return this.tradeSession;
  }
  leaderId = -1;
  lobbyNumber = 0;
  blockNumber = 0;
  // The lobby's seasonal event (newserv l->event, the event byte of the 64 join
  // at 0x195; 0 = none). The lobby decorations follow it (objectmodels.ts).
  event = 0;
  // Raw 0x520-byte 67 entry of the local player (inventory + disp data), kept
  // to build the 98 / 6x70 commands when this connection later joins a game.
  selfEntry: Uint8Array | null = null;
  // A detached Lobby ignores incoming commands (the connection is in a game,
  // handled by net/game.ts). attach() makes it handle the next 67 again.
  active = true;
  private listeners = new Map<keyof LobbyEvents, Array<(...args: never[]) => void>>();
  readonly seq = ++lobbySeq;

  constructor(conn: BBConnection) {
    this.conn = conn;
    const prev = conn.onCommand;
    conn.onCommand = (c) => {
      prev(c);
      if (!this.active) return;
      try {
        this.handle(c);
      } catch (err) {
        console.warn(`[lobby#${this.seq}] command 0x${c.command.toString(16).padStart(2, '0')} failed to parse: ${(err as Error).message}`);
        throw err;
      }
    };
  }

  on<K extends keyof LobbyEvents>(event: K, fn: LobbyEvents[K]): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn as (...args: never[]) => void);
    this.listeners.set(event, list);
  }

  detach(): void {
    this.active = false;
  }

  attach(): void {
    this.active = true;
  }

  protected emit<K extends keyof LobbyEvents>(event: K, ...args: Parameters<LobbyEvents[K]>): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as unknown as (...a: Parameters<LobbyEvents[K]>) => void)(...args);
  }

  // A player the client made itself (a quest's NPC player, 6x69): listeners
  // see it join and move like any other player.
  addLocalPlayer(p: LobbyPlayer): void {
    this.players.set(p.clientId, p);
    this.emit('playerJoined', p);
    this.emit('moved', p);
  }

  removeLocalPlayer(clientId: number): void {
    if (!this.players.delete(clientId)) return;
    this.emit('playerLeft', clientId);
  }

  // Tells the listeners a player was moved without a network command (6x24).
  notifyMoved(p: LobbyPlayer): void {
    this.emit('moved', p);
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
      case 0x65:
        // Not handled: the 67 that follows carries the lobby list.
        console.info(`[lobby#${this.seq}] ignored 0x65 (${c.flag} players)`);
        break;
      case 0x69: {
        const id = c.flag;
        const name = this.players.get(id)?.name ?? '?';
        this.players.delete(id);
        console.info(`[lobby#${this.seq}] player left: client ${id} "${name}" (now ${this.players.size})`);
        this.emit('playerLeft', id);
        break;
      }
      case 0x64:
        // The lobby's join (newserv send_join_lobby_t): the event byte is all we keep.
        if (c.data.length > 0x195) this.event = c.data[0x195];
        break;
      case 0x06:
        this.onChat(c);
        break;
      case 0x81:
        this.emit('simpleMail', c.data);
        break;
      case 0xb0:
        // Same format as 01: 8 bytes, then the text.
        this.emit('serverText', stripMarkers(readUtf16(c.data, 8, (c.data.length - 8) >> 1)).replace(/\r/g, ''));
        break;
      case 0x60:
      case 0x62:
      case 0x6c:
      case 0x6d:
        this.onSubcommands(c.data);
        break;
      // Trade (net/trade.ts): D1 the server executes the list, D3 the items moved (no
      // handler in the exe, ASSUMED), D4 the result (flag 1 = done, 0 = failed; exe
      // ShowTradeErrorDialogAndReset_00827024: 0x10a / 0x10b).
      case 0xd1:
        this.trade.onAdvance();
        break;
      case 0xd3:
        this.trade.onExecute();
        break;
      case 0xd4:
        this.trade.onComplete(c.flag === 1);
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
      if (d[3] !== this.lobbyNumber) console.info(`[lobby#${this.seq}] lobby number ${this.lobbyNumber} -> ${d[3]}`);
      this.lobbyNumber = d[3];
      this.blockNumber = d[4];
    }
    const added: LobbyPlayer[] = [];
    for (let i = 0; i < count; i++) {
      const o = 0x0c + i * ENTRY_SIZE;
      if (o + ENTRY_SIZE > d.length) break;
      const p = parseEntry(d, o);
      this.players.set(p.clientId, p);
      if (c.command === 0x67 && p.clientId === this.selfId) this.selfEntry = d.slice(o, o + ENTRY_SIZE);
      added.push(p);
    }
    if (c.command === 0x67) {
      const list = [...this.players.values()].map((p) => `${p.clientId} "${p.name}"`).join(', ');
      console.info(
        `[lobby#${this.seq}] joined lobby ${this.lobbyNumber} block ${this.blockNumber}: self client ${this.selfId}, ` +
          `${this.players.size} players [${list}]`,
      );
      this.emit('joined', added);
      // Ask the others where they are (they answer with 6x20 / 6x3F).
      this.sendSubcommand(0x1f, new Uint8Array(4));
    } else {
      for (const p of added) {
        console.info(`[lobby#${this.seq}] player arrived: client ${p.clientId} "${p.name}" (now ${this.players.size})`);
        this.emit('playerJoined', p);
      }
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

  protected onSubcommands(data: Uint8Array): void {
    let o = 0;
    while (o + 4 <= data.length) {
      const sub = data[o];
      // Size in dwords; 0 means an extended header (G_ExtendedHeaderT) with a
      // u32 byte size after the first 4 bytes (6D commands, e.g. 6x70).
      let size = data[o + 1] * 4;
      if (!size && o + 8 <= data.length) size = new DataView(data.buffer, data.byteOffset + o + 4, 4).getUint32(0, true);
      if (!size || o + size > data.length) break;
      const body = data.subarray(o, o + size);
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const clientId = dv.getUint16(2, true);
      // 6x06 (sub 6): the guild card a player sent (net/guildcard.ts receiveSent).
      if (sub === 0x06 && body.length >= 0x10c) this.emit('guildCardSent', body);
      // 6xA6 is the trade proposal / answer / offer subcommand (net/trade.ts receive).
      if (sub === TRADE_SUB && body.length >= TRADE_SUB_SIZE) this.trade.receive(body);
      // 6xC2: the invitee's answer to our Team Invite (6xC1, net/team.ts); the next one resolves the waiter.
      // 6xC1: a Team Invite from another player (0x0078bc44; net/team.ts). A refused one is answered at once.
      if (sub === TEAM_INVITE_SUB && body.length >= TEAM_INVITE_SIZE) {
        const refusal = this.teamInvites.receive(body, this.teamInviteFree());
        if (refusal) this.conn.send(0x62, refusal.target, refusal.answer);
      }
      if (sub === TEAM_INVITE_ANSWER_SUB && body.length >= TEAM_INVITE_SIZE && this.inviteWaiter) {
        const w = this.inviteWaiter;
        this.inviteWaiter = null;
        w(parseInviteAnswer(body));
      }
      // 6xCD: a Master Transfer request (0x0078c0d8); a refused one is answered busy at once.
      if (sub === TEAM_MASTER_SUB && body.length >= TEAM_INVITE_SIZE) {
        const refusal = this.masterRequests.receive(body, this.masterFree());
        if (refusal) this.conn.send(0x62, refusal.target, refusal.answer);
      }
      // 6xCE: the chosen player's answer to our request (0x0078bff4); the waiter takes the next one.
      if (sub === TEAM_MASTER_ANSWER_SUB && body.length >= TEAM_INVITE_SIZE && this.masterWaiter) {
        const w = this.masterWaiter;
        this.masterWaiter = null;
        w(parseMasterAnswer(body));
      }
      // 6x74 word select, in the lobby and in a game (handle_packet0x60_subcommand0x74, dump 664363:
      // the same handler in both): the balloon is drawn by the screen (classic/chat.ts receiveWord).
      if (sub === WORD_SELECT_SUBCOMMAND) {
        const ws = parseWordSelectSubcommand(body);
        if (ws) this.emit('wordSelect', ws.clientId, ws.message);
      }
      const p = this.players.get(clientId);
      if (p) {
        switch (sub) {
          case 0x1f: // set floor (and ask for positions)
            if (body.length >= 8) p.floor = dv.getInt32(4, true);
            break;
          case 0x20: // set position: floor, pos xyz, angle_y
            p.floor = dv.getInt32(4, true);
            p.position = { x: dv.getFloat32(8, true), y: dv.getFloat32(12, true), z: dv.getFloat32(16, true) };
            p.angle = dv.getUint32(20, true) * BAMS_TO_RAD;
            p.moving = false;
            this.emit('moved', p);
            break;
          case 0x3e: // stop at position (the sender's move_stop: dispatch_action_move_stop, dump 587490): also ends a remote sit (stopped)
          case 0x3f: // set position
            p.angle = dv.getUint16(6, true) * BAMS_TO_RAD;
            p.floor = dv.getInt16(8, true);
            p.position = { x: dv.getFloat32(12, true), y: dv.getFloat32(16, true), z: dv.getFloat32(20, true) };
            p.guard = dv.getUint16(4, true) !== 0;
            p.moving = false;
            this.emit('moved', p);
            if (sub === 0x3e) this.emit('stopped', p);
            break;
          case 0x24: // G_TeleportPlayer_6x24 (buildTeleport): {u32 angle, f32 x, y, z}; the battle respawn and set_player_start_position
            if (body.length < 0x14) break;
            p.angle = dv.getUint32(4, true) * BAMS_TO_RAD;
            p.position = { x: dv.getFloat32(8, true), y: dv.getFloat32(12, true), z: dv.getFloat32(16, true) };
            p.moving = false;
            this.emit('teleported', p);
            break;
          case 0x55: // G_IntraMapWarp_6x55: {u32 angle, from xyz, to xyz}
            if (body.length < 0x20) break;
            p.angle = dv.getUint32(4, true) * BAMS_TO_RAD;
            p.position = { x: dv.getFloat32(0x14, true), y: dv.getFloat32(0x18, true), z: dv.getFloat32(0x1c, true) };
            p.moving = false;
            this.emit('teleported', p);
            break;
          case 0x58: { // emote {u16 emote slot, u16 flags} (formats/emotes.ts; the player plays it)
            const e = parseEmoteSubcommand(body);
            if (e) this.emit('emote', p, e.slot, e.opposite);
            break;
          }
          case 0xab: { // sit {u16 0, u16 flags} (formats/emotes.ts; FUN_0069b378)
            const sit = parseSitSubcommand(body);
            if (sit) this.emit('sit', p, sit.chair, sit.opposite);
            break;
          }
          case 0x25: // equip {item id, slot}: the weapon is tracked (playerweapon.ts)
          case 0x26: // unequip {item id}
            if (p.inventory && body.length >= 8 && applyRemoteEquip(p.inventory, dv.getUint32(4, true), sub === 0x25)) {
              p.weapon = equippedWeaponOf(p.inventory);
            }
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
  // The next 6xC2 answer to a Team Invite (waitInviteAnswer). One waiter at a time.
  private inviteWaiter: ((a: { guildCard: number; action: number }) => void) | null = null;
  waitInviteAnswer(): Promise<{ guildCard: number; action: number }> {
    return new Promise((resolve) => {
      this.inviteWaiter = resolve;
    });
  }

  // The next 6xCE answer to a Master Transfer request (net/team.ts). One waiter at a time.
  private masterWaiter: ((a: { guildCard: number; action: number; name: string }) => void) | null = null;
  waitMasterAnswer(): Promise<{ guildCard: number; action: number; name: string }> {
    return new Promise((resolve) => {
      this.masterWaiter = resolve;
    });
  }
  // A window that stops waiting drops the waiter, so a late answer is not taken for the next request's.
  cancelMasterWait(): void {
    this.masterWaiter = null;
  }

  // The header's client id is this client's unless `clientId` names another player (an NPC player's
  // subcommands carry the NPC's slot, e.g. 6x46 from quest/town.ts stepNpcHead).
  sendSubcommand(sub: number, payload: Uint8Array, command = 0x60, clientId = this.selfId): void {
    const body = new Uint8Array(4 + payload.length);
    body[0] = sub;
    body[1] = body.length / 4;
    new DataView(body.buffer).setUint16(2, clientId, true);
    body.set(payload, 4);
    this.conn.send(command, 0, body);
  }

  // A word select chat (6x74, the shortcut's type 2): send_chat_message_word_select
  // (dump 664328) sends the 0x1C-byte message after the header, size 8 dwords. Sent from
  // the lobby too: send_chat_message does not check the scene for type 2 (ASSUMED that
  // the lobby's send is the same path; the exe's CreateItemObject gate is not traced).
  sendWordSelect(message: WordSelectMessage): void {
    this.sendSubcommand(WORD_SELECT_SUBCOMMAND, wordSelectSubcommandPayload(message));
  }

  sendChat(text: string): void {
    // process_chat_message on the sent line: its emote keys queue for this player.
    this.emoteQueue.push(parseEmoteKeys(text));
    // send_chat_message_text sends only when process_chat_message's value is not 0 (formats/emotes.ts).
    // The value is taken on the line as the exe holds it, with its 2-unit language marker (\tE): the
    // "- 2" of process_chat_message is that marker, so a short plain line is still sent (ASSUMED: the
    // marker is in the buffer process_chat_message reads).
    const s = `\tE${text}`;
    if (!chatLineSends(s)) return;
    const body = new Uint8Array(8 + (s.length + 1) * 2 + 2);
    const dv = new DataView(body.buffer);
    for (let i = 0; i < s.length; i++) dv.setUint16(8 + i * 2, s.charCodeAt(i), true);
    // pad to 4 bytes
    const padded = new Uint8Array((body.length + 3) & ~3);
    padded.set(body);
    this.conn.send(0x06, 0, padded);
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

  // 6x42: running toward (x, z).
  sendRun(x: number, z: number): void {
    const p = new Uint8Array(8);
    const dv = new DataView(p.buffer);
    dv.setFloat32(0, x, true);
    dv.setFloat32(4, z, true);
    this.sendSubcommand(0x42, p);
    this.updateSelf(x, undefined, z, undefined, true);
    if (this.self) this.self.gait = 'run';
  }

  // 6x3E: stop at (x, y, z) facing `angle` radians. `state` is the mover's guard
  // stance and room (stopBody).
  sendStop(x: number, y: number, z: number, angle: number, state: SetPositionState = { guard: false, room: 0 }): void {
    this.sendSubcommand(0x3e, stopBody({ x, y, z }, angle, this.self?.floor ?? 0, state));
    this.updateSelf(x, y, z, angle, false);
  }

  // 6x55 (G_IntraMapWarp_6x55, 0x20 bytes), as warp_player_from_source_to_dest
  // (0x0069b184) builds it: {55, 08, client id, u32 angle, from xyz, to xyz}.
  sendIntraMapWarp(to: { x: number; y: number; z: number }, angle: number): void {
    const me = this.self;
    if (!me) return;
    const p = new Uint8Array(0x1c);
    const dv = new DataView(p.buffer);
    dv.setUint32(0, Math.round((angle / (Math.PI * 2)) * 0x10000) & 0xffff, true);
    dv.setFloat32(4, me.position.x, true);
    dv.setFloat32(8, me.position.y, true);
    dv.setFloat32(12, me.position.z, true);
    dv.setFloat32(16, to.x, true);
    dv.setFloat32(20, to.y, true);
    dv.setFloat32(24, to.z, true);
    this.sendSubcommand(0x55, p);
    this.updateSelf(to.x, to.y, to.z, angle, false);
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
