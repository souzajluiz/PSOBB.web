// Lobby: the 3D lobby (render/lobbyview.ts on a WebGL canvas under the stage)
// with the classic 2D HUD on top.
//
// Decoded from PsoBB.exe (Ephinea 1.25.13):
//   - lobby name window: FUN_0079eb78 formats "%s:%02d-%02d" (0x0097cef0) with
//     the ship name kept by the 07 handler (0x00aab2ec), the block number and
//     lobby number + 1, and FUN_0073f510 shows it in a 160 x 27 window
//     (0x009f340c) whose right edge is at position table entry 0xc0 =
//     (622, 37); see ingame.ts. Matches "newserv:01-01" on the capture.
//   - keyboard: newserv's default-keyboard-config.bin (0x16C bytes, the
//     client's key_config) holds {u32, key id} pairs in the order of the key
//     config labels (unitxt group 0: "Move Forward", "Move Backward",
//     "Move Left", "Move Right", "Lock Move Forward", "Lock Walk Forward",
//     "Decide", "Cancel", "Menu Open/Close", "Start", "Select Up"...), which
//     is also the order of the client's input enum (0 move_forwards ..
//     8 main_menu_1, 9 begin_chat_input, ...). Key ids are named by the table
//     at 0x0097b5e0 ({id, L": NAME"}): 0x26 W, 0x22 S, 0x10 A, 0x13 D,
//     0x61 ENTER, 0x50 BACK SPACE, 0x06 HOME, 0x59 SPACE, arrows 0x5c..0x5f.
//     So: W/S/A/D move, Enter decides, Backspace cancels, Home opens the main
//     menu (mainmenu.ts), Space opens the chat input (chat.ts), the arrows
//     move selections.
//   - chat: word balloons and the input line (chat.ts); the chat log is only
//     shown in the main menu's Log Window (there is no log on screen).
//   - information counter (counter.ts) and, from its Organize PARTY menu, the
//     party game list and the party creation window (gamelist.ts); from
//     Transport, Change SHIP / Change BLOCK (A0 / A1, hud.transport); from Team,
//     the team windows (teammenu.ts).
// Name tags over the heads: no code for them was found in PsoBB.exe; they
// are kept as on the psobb.io capture (fitted, see DEVLOG).

import { BINDING, bindingKey, menuKeyOf } from '../input/keyconfig.ts';
import { chatFormOption, chatShortcutIndex, functionKeyAction, functionKeyNames, LOBBY_SHORTCUT_LEAVES } from '../input/shortcuts.ts';
import { parseChatShortcut } from '../net/chatshortcut.ts';
import * as THREE from 'three';
import type { GuildCardBook, GuildCardClient, GuildCardSearchResult } from '../net/guildcard.ts';
import type { InfoBoardClient } from '../net/infoboard.ts';
import type { SimpleMailBox } from '../net/simplemail.ts';
import type { CharacterFile } from '../net/charfile.ts';
import type { Lobby } from '../net/lobby.ts';
import { TRADE_STATUS } from '../net/trade.ts';
import { TradeMenu, type TradeEnv } from './trade.ts';
import type { LobbyView } from '../render/lobbyview.ts';
import type { MapViewer } from '../render/mapviewer.ts';
import { ChatBubble, ChatLine, drawLogWindow, projectHead, type BubbleTextures } from './chat.ts';
import { drawTeamLog, type TeamChat } from './teamchat.ts';
import { InfoCounter, type CounterText, type InfoCol } from './counter.ts';
import { PartyMenus, T15, type PartyHost } from './gamelist.ts';
import { Question, TeamMenus, teamRowsDisabled, type TeamHost } from './teammenu.ts';
import { HomeLeaves, HOME_LEAF_IDS } from './homeleaves.ts';
import { QuickMenu, type QuickMenuEnv } from './quickmenuwindow.ts';
import { emotePayload } from '../formats/emotes.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { InfoBoardMenu, type InfoBoardHost } from './infoboard.ts';
import { se, SE } from '../audio/se.ts';
import { parseCharacterFile } from '../net/charfile.ts';
import { drawLobbyNameWindow, InfoWindow, inGameSpace, WINDOW_POS } from './ingame.ts';
import { validateMenuEntry, type MenuRules } from './fieldmenu.ts';
import { ItemListWindow, MAIN_MENU, MainMenu, type MainMenuTextures } from './mainmenu.ts';
import { applyMenuViewShift } from '../render/viewshift.ts';
import { KEYS } from '../input/keyconfig.ts';
import type { ItemRow } from './itempack.ts';
import { characterOptionsEnv, cursorSaved, OptionsMenu, readOptionFlags, restoreBrightness } from './options.ts';
import { bandsOf, type Screen, type Stage, type TextInputState, type WindowSkin } from './stage.ts';

// Default key config slots 0..3 (W, S, A, D) mapped to the keys LobbyView
// reads for its movement.
const MOVE_KEYS: Record<string, string> = { w: 'w', s: 's', a: 'a', d: 'd' };
const FRAME = 1 / 30;
const HEAD_FACTOR = 0.92; // FUN_00716204: model bound * 0.92 (0x0096fe90)
// ping_server (0x007bd288, called by the logged-in game loop 0x007bcc4c, which
// runs the lobby and the games): while logged in, a 1D every 900 frames
// (g_FrameCounter % 900, the 0x91a2b3c5 division). newserv disconnects a
// client that sent nothing for a minute (ClientIdleTimeout), so a player who
// only stands or reads the counter's menus needs it.
export const PING_FRAMES = 900;

export interface LobbyHud {
  skin: WindowSkin;
  bubble: BubbleTextures;
  menu: MainMenuTextures;
  // unitxt lookup (group, index), language markers removed.
  text: (group: number, index: number) => string;
  // Inventory rows for the Item List window (null: no character file), built
  // as the Item Pack builds them (itempack.ts itemRows).
  inventory: () => ItemRow[] | null;
  // f256_hyouji.prs texture 1: the Item List row icons.
  itemIcons: CanvasImageSource;
  infoCols: InfoCol[];
  // The session's full character data (00E7): the option word (options.ts).
  fullCharacter?: () => Uint8Array | null;
  // The character file (the Trade Window reads the offers and the meseta from it).
  character?: () => CharacterFile | null;
  // Quit Game > Disconnect: the save upload (E7, then 05; BBSession.sendSaveFile).
  saveFile?: () => void;
  // The counter's party menus talk to the server through this (gamelist.ts);
  // without it Organize PARTY only closes.
  party?: PartyHost;
  // g_ClientCaps_DarvantForm7Supported: the counter offers EPISODE 4.
  episode4?: boolean;
  // The counter's Team menus talk to the server through this (teammenu.ts);
  // without it the team rows are greyed.
  team?: TeamHost;
  // The counter's Transport rows: A0 (Change SHIP) / A1 (Change BLOCK), then the
  // server's menu (07) is shown by the host (the ship select screen).
  transport?: TransportHost;
  // The session's guild card book (net/guildcard.ts), null until its sync is done.
  guildCards?: () => GuildCardBook | null;
  // The session's guild card sender (null before the login sync).
  guildCardClient?: () => GuildCardClient | null;
  // The Info Board sender (net/infoboard.ts), null before the lobby's connection.
  infoBoardClient?: () => InfoBoardClient | null;
  // The Simple Mail store and answer service (net/simplemail.ts), null before the lobby's connection.
  mailbox?: () => SimpleMailBox | null;
  // The team chat window and its log (classic/teamchat.ts), shared with the field.
  teamChat?: TeamChat;
  // Meet the User from a Guild Card search result (BBSession.meetUser, set by the owner).
  meetUser?: (reply: GuildCardSearchResult) => void;
}

export interface TransportHost {
  changeShip(): Promise<void>;
  changeBlock(): Promise<void>;
}

// The main menu's availability rules in the lobby (map 0x0F, a safe map):
// Customize (0), Equip (9) and MAG (0x17) are not used here (replaced by id + 1,
// "cannot be used"); Quit Game reads "Disconnect" online (8); Trade is on (safe,
// online); Technique, Area Map and the Quest Board are off; the Team rows need
// a team. The rules are validateMenuEntry's (fieldmenu.ts, PsoBB.exe
// ValidateMenuItemCondition_00732620). The lobby is always online.
export function lobbyMenuRules(inTeam: boolean): MenuRules {
  return { lobby: true, safe: true, online: true, questStarted: false, inTeam };
}

// The team membership says whether the player is in a team: teamRowsDisabled's
// second row is "no team" (greyed Create Team), so the opposite is in a team.
function teamMember(hud: LobbyHud): boolean {
  return !teamRowsDisabled(hud.team!.membership())[1];
}

export class LobbyScreen implements Screen {
  transparent = true;
  private lobby: Lobby;
  private view: LobbyView;
  private viewer: MapViewer;
  private hud: LobbyHud;
  private shipName: string;
  private keys = new Set<string>();
  private chat: ChatLine;
  private menu: MainMenu;
  private counter: InfoCounter;
  private party: PartyMenus | null = null;
  private team: TeamMenus | null = null;
  // The Home menu's shared leaves (classic/homeleaves.ts): Guild Card, Symbol Chat, Simple Mail, Team Member List, Team Info.
  private home: HomeLeaves;
  // The End key's quick menu in the lobby: the motion menu (quickmenuwindow.ts).
  private quick: QuickMenu | null = null;
  // The info window [15:6] shown from Change SHIP / Change BLOCK until the
  // server's menu replaces this screen.
  private transporting: InfoWindow | null = null;
  private itemList: ItemListWindow | null = null;
  // Home menu > Simple Mail / Info Board: the Info Board window (infoboard.ts). infoOwn is the
  // text the keyboard accepted this session (the character's own board until then).
  private infoBoard: InfoBoardMenu | null = null;
  private infoOwn: string | null = null;
  // Home menu > Trade Window (0x1a, classic/trade.ts); also opened by a partner's proposal.
  private trade: TradeMenu | null = null;
  private options: OptionsMenu | null = null;
  // Quit Game's Yes / No (QuitMenu_Constructor_0074bf30).
  private quit: Question | null = null;
  private logWindow = false;
  private heights = new Map<number, number>();
  private acc = 0;
  private frame = 0;
  private extra = 0;
  // Virtual height of the frame (480, or the phone's tall fill: stage.ts vh).
  private vh = 480;
  // A phone in portrait: the 3D lobby fills the tall box and the HUD keeps its
  // anchors (stage.ts phoneFill).
  readonly phoneLayout: boolean;
  readonly phoneFill: boolean;

  constructor(viewer: MapViewer, view: LobbyView, lobby: Lobby, hud: LobbyHud, shipName: string, phone = false) {
    this.phoneLayout = phone;
    this.phoneFill = phone;
    this.viewer = viewer;
    this.view = view;
    this.lobby = lobby;
    this.hud = hud;
    // The trade's host: the offers come from the character, the session's notices open
    // the Trade Window's text (net/trade.ts TRADE_TEXT).
    lobby.tradeHost = {
      character: () => hud.character?.() ?? null,
      notify: (textId) => {
        if (this.trade) this.trade.notify(textId);
        else console.info(`[classic] trade notice 0x${textId.toString(16)} (no Trade Window open)`);
      },
    };
    this.shipName = shipName;
    this.menu = new MainMenu(
      (id) => hud.text(0x0b, id),
      (id) => this.menuAction(id),
    );
    this.menu.cursorSaved = () => cursorSaved(readOptionFlags(hud.fullCharacter?.() ?? null));
    // ValidateMenuItemCondition_00732620 with the lobby's rules (see lobbyMenuRules).
    this.menu.validate = (id) => validateMenuEntry(id, lobbyMenuRules(!!hud.team && teamMember(hud)));
    // Customize (0) chosen in the lobby: unitxt group 11 index 1, "Customizing Action Palette is not
    // allowed in the lobby." (the text's own line breaks become spaces). The exe's call site is not traced (ASSUMED).
    this.menu.disabledNotice = (id) => (id === 0 ? hud.text(11, 1).replace(/\s*\n\s*/g, ' ').trim() : null);
    this.home = new HomeLeaves(() => ({
      text: (g, i) => hud.text(g, i),
      lobby,
      guildCards: () => hud.guildCards?.() ?? null,
      guildCardClient: () => hud.guildCardClient?.() ?? null,
      mailbox: () => hud.mailbox?.() ?? null,
      fullCharacter: () => hud.fullCharacter?.() ?? null,
      team: () => hud.team ?? null,
      meetUser: (reply) => hud.meetUser?.(reply),
    }));
    this.home.onAllClosed = () => {
      this.menu.leafOpen = false;
    };
    restoreBrightness();
    const t15 = (i: number) => hud.text(0x0f, i);
    const counterText: CounterText = {
      info: t15(3),
      first: [t15(0x37), t15(0x38), t15(0x56)],
      transport: [t15(0x40), t15(0x41)],
      team: [t15(0x57), t15(0x58), t15(0x5b), t15(0x5c)],
      teamDisabled: () => (hud.team ? teamRowsDisabled(hud.team.membership()) : [true, true, true, true]),
      party: [t15(T15.joinParty), t15(T15.createParty)],
      episodes: [t15(T15.episode1), t15(T15.episode2), ...(hud.episode4 ? [t15(T15.episode4)] : [])],
      episodeInfo: T15.createInfo.slice(0, hud.episode4 ? 3 : 2).map(t15),
    };
    this.counter = new InfoCounter(counterText);
    const party = hud.party ? new PartyMenus(hud.party, { t11: (i) => hud.text(0x0b, i), t15 }) : null;
    this.party = party;
    if (hud.team) {
      const team = new TeamMenus(hud.team, { t11: (i) => hud.text(0x0b, i), t15 });
      team.onBack = () => this.counter.resume();
      team.onClose = () => this.counter.close();
      this.team = team;
    }
    this.counter.onChoose = (menu, index) => {
      if (menu === 'party' && index === 0) party?.openList();
      else if (menu === 'episode') party?.openCreate((index + 1) as 1 | 2 | 3);
      else if (menu === 'transport') this.transport(index);
      else if (menu === 'team' && this.team) {
        this.team.begin(index);
        return this.team.open;
      }
      return false;
    };
    // LobbyView reads the pressed keys from the viewer's frame callback;
    // feed it the keys of the stage canvas instead (none while a menu or the
    // chat input has the keyboard), then apply the main menu's view shift.
    const inner = viewer.onFrame;
    viewer.onFrame = (dt) => {
      inner?.(dt, this.busy ? new Set() : this.keys);
      this.applyViewShift();
    };
    this.chat = new ChatLine((text) => lobby.sendChat(text));
    this.chat.sendWord = (message) => lobby.sendWordSelect(message);
    this.chat.team = hud.teamChat ?? null;
    this.chat.teamSender = () => lobby.players.get(lobby.selfId)?.name ?? '';
    lobby.on('chat', (from, gc, text) => this.chat.receive(from, gc, text, (id) => this.distanceTo(id)));
    lobby.on('playerLeft', (id) => this.heights.delete(id));
    // A guild card sent by a player (6x06): the book takes a known card; others wait (ASSUMED: no window).
    // A Simple Mail (0x81): stored whatever window is open; the arrival sound on a kept mail (FUN_0081386c).
    lobby.on('simpleMail', (body) => {
      const box = this.hud.mailbox?.() ?? null;
      if (box && box.receive(body) === 'stored') se(SE.newMail);
    });
    lobby.on('guildCardSent', (body) => {
      const r = this.hud.guildCardClient?.()?.receiveSent(body);
      if (r === 'received' || r === 'dropped') console.info(`[classic] Guild Card received: ${r} (its window is not ported)`);
    });
  }

  // The chat line, or the party menus' name / password editors.
  textInput(): TextInputState | null {
    if (this.chat.open) return { password: false, chat: true };
    return this.team?.textInput() ?? this.party?.textInput() ?? null;
  }

  // The lobby's quick menu env: only the motion menu is live here (no character tabs in the lobby).
  private quickEnv(): QuickMenuEnv {
    return {
      text: (g, i) => this.hud.text(g, i),
      character: () => null,
      itemName: () => '',
      tech: { text: (g, i) => this.hud.text(g, i), level: () => null, canCast: () => false },
      equip: { equip: () => {}, unequip: () => {} },
      allowed: () => false,
      // A motion's emote: 6x58 with the town emote slot (formats/emotes.ts EMOTE_SLOTS.town).
      emote: (slot) => this.lobby.sendSubcommand(0x58, emotePayload(slot, false)),
    };
  }

  private get busy(): boolean {
    return this.chat.open || this.menu.open || this.counter.open || !!this.party?.open || !!this.team?.open || !!this.transporting || !!this.quit || !!this.infoBoard || !!this.trade || this.home.open || !!this.quick;
  }

  // ResetLobbyStateAndReturnToShipSelect / ExecuteLobbyJoinPartyAction: every
  // menu is closed, [15:6] is typed into the info window and A0 / A1 goes out.
  private transport(index: number): void {
    const host = this.hud.transport;
    if (!host) return;
    const [x, y] = WINDOW_POS.shipInfo;
    const info = new InfoWindow(x, y, 342, 144);
    info.set(this.hud.text(0x0f, 6));
    this.transporting = info;
    this.keys.clear();
    (index === 0 ? host.changeShip() : host.changeBlock()).catch((err) => {
      console.error('[classic] ship / block change failed', err);
      this.transporting = null;
    });
  }

  get lobbyName(): string {
    const two = (n: number) => String(n).padStart(2, '0');
    return `${this.shipName}:${two(this.lobby.blockNumber)}-${two(this.lobby.lobbyNumber + 1)}`;
  }

  // The balloon order: distance from the local player (ChatBubbles.say).
  private distanceTo(id: number): number {
    const p = this.lobby.players.get(id)?.position;
    const me = this.lobby.self?.position;
    return p && me ? Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) : 0;
  }

  // Quit Game > Yes: the loading screen returns to Ship Select (the exe's
  // ResetLobbyStateAndReturnToShipSelect_0079ac9c, 0xa0). The exe first sends the
  // 0x60 leave (CE 17) and packet 5 (unknown_send_disconnect, 0x0074c018 caller);
  // not ported (ASSUMED: the server's 0xa0 answer is the leave here).
  private disconnect(): void {
    this.hud.saveFile?.();
    this.transport(0);
  }

  // The Trade Window's environment (classic/trade.ts): the session, the partners in the
  // lobby (not self), the character's offers and meseta.
  private tradeEnv(): TradeEnv {
    const rows = () => this.hud.inventory() ?? [];
    const full = () => this.hud.character?.() ?? null;
    return {
      session: this.lobby.trade,
      text: (g, i) => this.hud.text(g, i),
      partners: () => [...this.lobby.players.values()].filter((p) => p.clientId !== this.lobby.selfId).map((p) => ({ id: p.clientId, name: p.name })),
      rows,
      count: (id) => {
        const c = full();
        if (!c) return 0;
        return c.inventory.find((i) => i.data.id === id)?.data.data1[5] ?? 0;
      },
      // The item's name from the Item List rows (a partner's item the local list lacks is shown by id).
      itemName: (id) => rows().find((r) => r.id === id)?.name ?? `item ${id.toString(16)}`,
      meseta: () => full()?.meseta ?? 0,
    };
  }

  private menuAction(id: number): void {
    if (HOME_LEAF_IDS.has(id)) {
      if (this.home.openLeaf(id)) this.menu.leafOpen = true;
      return;
    }
    if (id === 0xb) {
      const rows = this.hud.inventory();
      this.itemList = new ItemListWindow(this.hud.text(0x0b, 0x37), rows ?? [], this.hud.text(11, 0xee));
      this.menu.leafOpen = true;
    } else if (id === 0x15) {
      this.logWindow = true;
      this.menu.leafOpen = true;
    } else if (id === 0x16) {
      // handle_player_menu_select info_board_menu (0x16): the Info Board window (classic/infoboard.ts,
      // the exe's state machine FUN_007501e0). Needs the lobby's connection for its packets.
      const client = this.hud.infoBoardClient?.() ?? null;
      if (!client) {
        console.info('[classic] Info Board: no lobby connection yet');
        return;
      }
      const full = () => this.hud.fullCharacter?.() ?? null;
      const host: InfoBoardHost = {
        client,
        inLobby: () => true,
        own: () => {
          if (this.infoOwn !== null) return this.infoOwn;
          const raw = full();
          return raw ? parseCharacterFile(raw).infoBoard : '';
        },
        setOwn: (text) => {
          this.infoOwn = text;
        },
      };
      this.infoBoard = new InfoBoardMenu((i) => this.hud.text(11, i), host);
      this.menu.leafOpen = true;
    } else if (id === 0x1a) {
      // handle_player_menu_select trade_invite_menu1 (classic/trade.ts). The lobby has no
      // window check of its own (ValidateMenuItemCondition_00732620 allows 0x1a in a safe
      // online map, the lobby is one); newserv refuses 6xA6 / D0..D4 outside a game, so
      // the proposal gets no answer there (see the DEVLOG entry of 2026-10-23).
      this.trade = new TradeMenu(this.tradeEnv());
      this.menu.leafOpen = true;
    } else if (id === 6) {
      const full = () => this.hud.fullCharacter?.() ?? null;
      this.options = new OptionsMenu(characterOptionsEnv(this.hud.text, full, (c, p) => this.lobby.conn.send(c, 0, p)));
      this.menu.leafOpen = true;
    } else if (id === 7 || id === 8) {
      // Quit Game (8 = Disconnect online): QuitMenu_Constructor_0074bf30 at
      // get_gui_position(0x18), width 469, text unitxt (11, 0x4e) when logged in.
      this.quit = new Question(this.hud.text(0x0b, 0x4e), QUIT_POS);
      this.menu.leafOpen = true;
    } else {
      // A leaf window the port does not have yet: no window opens, the menu stays.
      console.info(`[classic] Home menu entry 0x${id.toString(16)}: no window in the port yet (not ported)`);
    }
  }

  private applyViewShift(): void {
    applyMenuViewShift(this.viewer.camera, this.menu.shift);
  }

  update(dt: number, stage: Stage): void {
    this.vh = stage.vh;
    this.acc += dt;
    while (this.acc >= FRAME) {
      this.acc -= FRAME;
      this.tick();
    }
  }

  private tick(): void {
    this.frame++;
    if (this.frame % PING_FRAMES === 0) this.lobby.conn.send(0x1d, 0);
    this.chat.tickCooldown();
    this.menu.tick();
    this.options?.tick();
    // Meet the User's 450 frames end in the owner callback, which closes the list (teammenu.ts tick).
    this.home.tick();
    // The session's timers run whether or not a window is open (a partner's proposal
    // arrives with no window). A proposal with no window opens the accept prompt (ASSUMED:
    // the exe's trade_invite_menu2/3 window, not traced).
    this.lobby.trade.tick();
    if (!this.trade && this.lobby.trade.status === TRADE_STATUS.requested) this.trade = new TradeMenu(this.tradeEnv());
    this.trade?.tick();
    if (this.trade && !this.trade.open) {
      this.trade = null;
      this.menu.leafOpen = false;
    }
    this.counter.tick();
    this.party?.tick();
    this.team?.tick();
    this.transporting?.tick();
    const cam = this.viewer.camera;
    const width = 640 + this.extra;
    ChatBubble.screenW = width;
    ChatBubble.screenH = this.vh;
    const positions = this.view.playerPositions();
    this.chat.bubbles.tick((id) => {
      const pos = positions.get(id);
      if (!pos) return null;
      return projectHead(cam, pos, this.headHeight(id), width, this.vh);
    });
  }

  private headHeight(id: number): number {
    let h = this.heights.get(id);
    if (h === undefined) {
      const top = this.view.playerHeight(id);
      // Fitted fallback until the model is loaded.
      h = (top ?? 18) * HEAD_FACTOR;
      if (top !== null) this.heights.set(id, h);
    }
    return h;
  }

  private nearCounter(): boolean {
    const p = this.lobby.self?.position;
    if (!p) return false;
    return this.hud.infoCols.some((c) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 <= c.radius * c.radius);
  }

  key(e: KeyboardEvent): void {
    if (this.chat.open) {
      this.chat.key(e);
      return;
    }
    if (this.options) {
      if (!this.options.key(e)) this.closeOptions();
      return;
    }
    if (this.itemList) {
      if (!this.itemList.key(e)) {
        this.itemList = null;
        this.menu.leafOpen = false;
      }
      return;
    }
    if (this.quick) {
      e.preventDefault();
      this.quick.key(e);
      if (!this.quick.open) this.quick = null;
      return;
    }
    if (this.home.open) {
      this.home.key(e);
      return;
    }
    if (this.trade) {
      e.preventDefault();
      if (!this.trade.key(e)) {
        this.trade = null;
        this.menu.leafOpen = false;
      }
      return;
    }
    if (this.infoBoard) {
      e.preventDefault();
      this.infoBoard.key(e);
      if (!this.infoBoard.open) {
        this.infoBoard = null;
        this.menu.leafOpen = false;
      }
      return;
    }
    if (this.logWindow) {
      if (menuKeyOf(e) === 'cancel' || menuKeyOf(e) === 'decide') {
        this.logWindow = false;
        this.menu.leafOpen = false;
      } else if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        // The Log Window's page keys (ChallengePlayerListWindow_HandleInput_00752238, dump 724833).
        e.preventDefault();
        this.chat.log.page(e.key === 'PageUp');
      }
      return;
    }
    if (this.transporting) return; // waiting for the server's menu
    if (this.quit) {
      e.preventDefault();
      this.quit.key(e);
      const r = this.quit.result;
      if (r) {
        this.quit = null;
        this.menu.leafOpen = false; // No: back to the menu
        if (r === 'yes') this.disconnect();
      }
      return;
    }
    if (this.party?.open) {
      // Tab is the game list's info key, Backspace its cancel.
      e.preventDefault();
      this.party.key(e);
      return;
    }
    if (this.team?.open) {
      e.preventDefault();
      this.team.key(e);
      return;
    }
    // The function-key shortcuts (input/shortcuts.ts): F5..F8 open the lobby's leaves.
    const full = this.hud.fullCharacter?.() ?? null;
    if (!this.menu.open && !this.counter.open) {
      const a = functionKeyAction(e, functionKeyNames(), chatFormOption(full));
      // F9 / F10: the team chat window and its lock (classic/teamchat.ts).
      if (this.hud.teamChat && (a?.kind === 'teamChat' || a?.kind === 'teamChatLock')) {
        e.preventDefault();
        if (a.kind === 'teamChat') this.hud.teamChat.toggle();
        else this.hud.teamChat.toggleLock();
        return;
      }
      if (a?.kind === 'menu' && LOBBY_SHORTCUT_LEAVES.has(a.id) && validateMenuEntry(a.id, lobbyMenuRules(!!this.hud.team && teamMember(this.hud))).enabled) {
        e.preventDefault();
        this.keys.clear();
        this.menu.toggle(MAIN_MENU);
        this.menuAction(a.id);
        return;
      }
      // The chat shortcuts (handle_chat_shortcuts, dump 674857): the raw F keys send a slot.
      const slot = chatShortcutIndex(e, chatFormOption(full));
      if (slot >= 0) {
        e.preventDefault();
        this.chat.useShortcut(parseChatShortcut(full, slot));
        return;
      }
    }
    const fk = e.key.toLowerCase();
    if (KEYS.symbolChat && fk === KEYS.symbolChat && !this.busy) {
      // The End key (role 14 = quickmenu, dump 86172): the lobby's motion menu.
      e.preventDefault();
      this.quick = new QuickMenu(this.quickEnv(), { lobby: true, mode: 0, traps: false, android: false });
      return;
    }
    if (fk === KEYS.menu || fk === bindingKey(BINDING.mainMenu2)) {
      e.preventDefault();
      if (!this.counter.open) {
        this.keys.clear();
        this.menu.toggle(MAIN_MENU);
      }
      return;
    }
    if (this.menu.open) {
      this.menu.key(e);
      return;
    }
    if (this.counter.open) {
      this.counter.key(e);
      return;
    }
    const k = e.key.toLowerCase();
    if (MOVE_KEYS[k]) {
      this.keys.add(MOVE_KEYS[k]);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      this.keys.clear();
      this.chat.begin();
      return;
    }
    if (menuKeyOf(e) === 'decide' && this.nearCounter()) {
      this.keys.clear();
      this.counter.begin();
    }
  }

  keyUp(e: KeyboardEvent): void {
    const k = MOVE_KEYS[e.key.toLowerCase()];
    if (k) this.keys.delete(k);
    this.trade?.keyUp(e);
  }

  blur(): void {
    this.keys.clear();
  }

  leave(): void {
    this.keys.clear();
    this.quit = null;
    this.infoBoard = null;
    // The close actions send the answer packets; the connection may be gone by now.
    this.home.close();
    this.quick = null;
    this.trade = null;
    this.party?.close();
    this.team?.close();
    this.closeOptions();
    this.menu.close();
  }

  // The Options window's destructor sends the option word (options.ts).
  private closeOptions(): void {
    if (!this.options) return;
    this.options.dispose();
    this.options = null;
    this.menu.leafOpen = false;
  }

  // Tall fill (stage.ts bandsOf): the lobby name, the menu and the log keep the
  // top; the chat line, the transport info and the options the bottom; the
  // counter, the team and the item list are centred. Desktop: all shifts are 0.
  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const bands = bandsOf(stage.vh, stage.fill);
    inGameSpace(ctx, stage, (extra) => {
      this.extra = extra;
      this.drawNameTags(ctx, extra, stage.vh);
      this.chat.bubbles.draw(ctx, this.hud.bubble);
      drawLobbyNameWindow(ctx, this.hud.skin, this.lobbyName, extra);
      inBand(ctx, bands.bottom, () => this.chat.input.draw(ctx, this.frame));
      inBand(ctx, bands.mid, () => this.counter.draw(ctx, this.hud.skin, extra));
      this.party?.draw(ctx, this.hud.skin, extra, bands.bottom);
      inBand(ctx, bands.mid, () => this.team?.draw(ctx, this.hud.skin, extra));
      inBand(ctx, bands.mid, () => this.home.drawTeam(ctx, this.hud.skin, extra));
      inBand(ctx, bands.bottom, () => this.transporting?.draw(ctx, this.hud.skin, extra));
      this.menu.draw(ctx, this.hud.skin, this.hud.menu, bands.bottom);
      inBand(ctx, bands.mid, () => this.itemList?.draw(ctx, this.hud.skin, this.hud.itemIcons));
      inBand(ctx, bands.mid, () => this.home.drawOther(ctx, this.hud.skin));
      inBand(ctx, bands.mid, () => this.quick?.draw(ctx, this.hud.skin));
      inBand(ctx, bands.mid, () => this.infoBoard?.draw(ctx, this.hud.skin));
      inBand(ctx, bands.mid, () => this.trade?.draw(ctx, this.hud.skin, this.hud.itemIcons));
      inBand(ctx, bands.mid, () => this.quit?.draw(ctx, this.hud.skin, this.hud.text(0x0b, 0x6e), this.hud.text(0x0b, 0x6f)));
      inBand(ctx, bands.bottom, () => this.options?.draw(ctx, this.hud.skin, extra));
      if (this.logWindow) drawLogWindow(ctx, this.hud.skin, this.chat.log);
      if (this.hud.teamChat?.open) drawTeamLog(ctx, this.hud.skin, this.hud.teamChat.log);
    });
  }

  // Name above each player's head (fitted to the psobb.io capture: white
  // game text centred 14 px above the head point; no code found in the exe).
  private drawNameTags(ctx: CanvasRenderingContext2D, extra: number, vh: number): void {
    const cam = this.viewer.camera;
    const w = 640 + extra;
    const v = new THREE.Vector3();
    for (const [id, pos] of this.view.playerPositions()) {
      const p = this.lobby.players.get(id);
      if (!p) continue;
      v.copy(pos).add(new THREE.Vector3(0, 22, 0)).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * vh;
      const tw = gameTextWidth(p.name);
      drawGameText(ctx, p.name, x - tw / 2 + 1, y - 13, '#000000', 0.8);
      drawGameText(ctx, p.name, x - tw / 2, y - 14, '#ffffff');
    }
  }
}

// get_gui_position(0x18) (table 0x00971fc0 = (214, 256)) and the Quit window's width (469.0).
const QUIT_POS = { x: 214, y: 256, w: 469 };

// Runs fn shifted by dy (a band of a tall fill frame, stage.ts bandsOf; 0 on
// the desktop).
function inBand(ctx: CanvasRenderingContext2D, dy: number, fn: () => void): void {
  ctx.save();
  ctx.translate(0, dy);
  fn();
  ctx.restore();
}
