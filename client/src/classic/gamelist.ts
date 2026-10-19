// The lobby counter's game list ("Join a PARTY") and the party creation window
// ("Create a PARTY"), as PsoBB.exe (Ephinea 1.25.13) runs them.
//
// NAMES. The dump and psobb-client-source call a lot of functions
// "GameListMenu..." / "QuestLoadingScreen..", but those names were guessed by
// community tooling: GameListMenuObject (0x00407bf0, vtable 0x00af2xxx, JP
// FUN_004080c1 / FUN_004080de / FUN_004080fb / FUN_00408118 / FUN_00408135 /
// FUN_00408152 / FUN_0040816f / FUN_004081ff) is the "Connecting.." object of
// the title (classic/connecting.ts), `CloseGameListMenu` is the generic list
// window close, GameListMenuGetState (JP FUN_00409c78) just returns a global,
// and SetGameListMenuEntryText / ResetGameListMenuEntryFields / TerminateGame
// ListMenuAll (JP FUN_004153a0, FUN_00414b60, FUN_00405760) are a 0x100-byte
// string clear + copy, four zeroed dwords and a call thunk. The real game list
// is the lobby menu state machine in 0x00797xxx..0x007a0xxx
// (g_CurrentLobbyMenuId, 0x00aab1xx), driven by the lobby counter.
//
// Flow (lobby_menu_id, dispatch at ProcessLobbyMenu 0x00798xxx..):
//   3 lobby_counter_first_menu  handle_counter_menu_selection (counter.ts):
//     value 0 -> ShowJoinOrCreatePartyMenu: "Join a PARTY" [15:0x3b] /
//     "Create a PARTY" [15:0x3c] at gui entry 0xc7 (82, 292).
//   4 join_or_create_party  HandleLobbyEpisodeSubMenuInput_0079b264:
//     0 -> TransitionToPartyListingFromEpisodeMenu_0079b3d0: info text [15:4]
//          ("Please select a PARTY you would like to join. Press Tab to display
//          a member's information."), both counter menus closed, send_packet8
//          (the 08 game list request), state 6;
//     1 -> ShowEpisodeDifficultySelect: "EPISODE 1" [15:0x47], "EPISODE 2"
//          [15:0x48] and, when g_ClientCaps_DarvantForm7Supported, "EPISODE 4"
//          [15:0x49] at entry 0xc8 (96, 333); the info text follows the cursor
//          ([15:0x11] / [0x12] / [0x13] "Create a new EPISODE n PARTY."),
//          state 0x18 (HandleGameListMenuSelection_0079a644).
//     cancel (list bit 4) -> close_lobby_menus, which closes everything.
//   6 party_listing  the 08 answer (handle_ship_packet0x05 0x0079bbxx) builds
//     create_information_counter_object: an "Information Counter" list window
//     (0x00971640) at entry 0xc1 (18, 53), 605 x 184 (0x009f3190), up to 0x40
//     rows; the first 08 entry is the server header and is skipped. Rows are
//     InfoCounterEntity items (ChatshortcutmenulistitemConstructor_0072e42c,
//     UIElement_RenderTextAndQuad_0072e1c4), see gameRow().
//     handle_game_list_inputs: Decide -> if the entry's flags & 2, the password
//     prompt (9), else send_packet0x10 (menu selection of the game) and
//     do_party_burst (14); Cancel -> close_lobby_menus; Tab (key 0xe) ->
//     send_packet9 (the game's info), whose 11 answer is typed into a text
//     window at entry 0xdb (18, 265), 188 high (UpdateQuestLoadPanelText
//     _0079b94c). Entries flagged "joinable = no" (flags & 4) are only drawn
//     grey (+0x28): the client still sends the selection and the server
//     refuses it.
//   9 join_party_password_input  unknown_create_password_input_object: a list
//     window at entry 0xd7 (99, 128) with [15:0x46] "Please input the
//     password." and a blank line, and a TKeyboardControl (16 characters, no
//     flags) at entry 0xd8 (109, 164). Confirm -> send_packet0x10 with the
//     password and do_party_burst; Cancel -> close_lobby_menus.
//   10 party_creation  ChallengeMenuObject (0x00733f20, update 0x007340a4):
//     a five-row info-counter window (CreateChatShortcutMenuYesNoWindow
//     _0073824c: entry 0xbf (181, 50), 425 x 188, 0x009715d8, title
//     "Information Counter") with the rows [11:0x60] "Party Name", [0x61]
//     "Password", [0x62] "Play Mode", [0x63] "Difficulty" and [0x64]
//     "Registration". Name editor (14 characters) at entry 0xdf (357, 66),
//     password editor (16) at entry 0xe0 (357, 86); Play Mode opens a list of
//     [11:0x139..0x13c] Normal / Challenge / Battle / One Person and
//     Difficulty one of [0x13d..0x140] Normal / Hard / Very Hard / Ultimate,
//     both at (389, 251) (0x00971358). Registration is greyed until a name is
//     typed, and the cursor goes to it whenever the window is idle with a name
//     (ChallengeMenuObject_SetDefaultSelection_00734508); Challenge greys
//     Difficulty (UpdateYesNoUI_00734608). Registration sends 1C (name,
//     password, difficulty (0 for Challenge), battle = mode 2, challenge =
//     mode 1, episode 1 / 2 / 3, one person = mode 3, handle_party_creation
//     _menu 0x0079ae..) and do_party_burst; Cancel -> close_lobby_menus.
//   14 party_burst  all menus closed, waiting for the 64 of the new game.
//
// ASSUMED (in neither repository): the "Information Counter" title is the
// untranslated wide string of the exe; the window slides / fades like the
// counter's other windows do not (they have no open animation here); the
// password editor shows its text as typed (flag 0 is not 0x2000); a game list
// with no rows ignores Decide; the info window of a game is 342 wide.

import { se, SE } from '../audio/se.ts';
import type { CreateGameOptions, GameListEntry } from '../net/game.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { ICON_UV } from './itempack.ts';
import { DISABLED, drawListWindow, drawWindowTitle, INSET, listWindowHeight, ROW, SELECTED, TITLE_GAP, type ListItem } from './fieldwindows.ts';
import { InfoWindow } from './ingame.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';
import { CARET, caretColor, TextEditor } from './titleflow.ts';

// lobby_menu_id values used here (the dump's enum).
export const LOBBY_MENU = {
  none: 0,
  counter: 3,
  joinOrCreate: 4,
  partyListing: 6,
  passwordInput: 9,
  partyCreation: 10,
  partyBurst: 14,
  episodeSelect: 24,
} as const;

// Position table (0x00971f40 + 8 * entry) and window sizes.
export const GAME_LIST_WINDOW = { x: 18, y: 53, w: 605, h: 184, title: 'Information Counter', maxRows: 0x40, visibleRows: 8 } as const; // 0xc1, 0x009f3190
export const GAME_INFO_WINDOW = { x: 18, y: 265, w: 342, h: 188 } as const; // 0xdb (the width is the info window default)
export const PARTY_INFO_POS = [294, 305] as const; // 0xd5, shared with the ship select
export const PASSWORD_WINDOW = { x: 99, y: 128 } as const; // 0xd7
export const PASSWORD_EDITOR = { x: 109, y: 164 } as const; // 0xd8
export const CREATE_WINDOW = { x: 181, y: 50, w: 425, h: 188 } as const; // 0xbf, 0x009715d8
export const CREATE_EDITORS = [
  { x: 357, y: 66 }, // 0xdf, Party Name
  { x: 357, y: 86 }, // 0xe0, Password
] as const;
export const CHOICE_POS = { x: 389, y: 251 } as const; // 0x00971358
export const MAX_NAME = 14; // TKeyboardControl(.., 0xe, ..)
export const MAX_PASSWORD = 16; // TKeyboardControl(.., 0x10, ..)

// unitxt group 11 indices (the rows, the Challenge UI strings) and group 15.
export const T11 = { episodeBase: 0x135, modeBase: 0x139, difficultyBase: 0x13d, partyName: 0x60, password: 0x61, playMode: 0x62, difficulty: 0x63, registration: 0x64 } as const;
export const T15 = { listInfo: 4, joinParty: 0x3b, createParty: 0x3c, enterPassword: 0x46, episode1: 0x47, episode2: 0x48, episode4: 0x49, createInfo: [0x11, 0x12, 0x13] } as const;

// Row layout of UIElement_RenderTextAndQuad_0072e1c4: the icon at the row's x,
// the name 18 px on (0x00970ef0) and each next column the offset after the
// previous one: +210 (0x00970ee8) the episode, +108 (0x00970ee4) the mode,
// +96 (0x00970ee0) the difficulty, +126 (0x00970edc) the player count.
export const ROW_COLUMNS = { icon: 0, name: 18, episode: 18 + 210, mode: 18 + 210 + 108, difficulty: 18 + 210 + 108 + 96, players: 18 + 210 + 108 + 96 + 126 } as const;
export const ICON_SIZE = 18; // 0x00970d98
export const ICON_PASSWORD = 0x18; // ChatshortcutmenulistitemConstructor: type 0x18 when the entry has a password flag
export const ICON_NONE = 0x36;
export const ROW_DISABLED = '#888888'; // 0xff888888 (+0x28 set)

// Game modes as the row stores them (+0x1e): Normal 0, Challenge 1, Battle 2;
// One Person (3) only exists in the creation list.
export const MODE = { normal: 0, challenge: 1, battle: 2, solo: 3 } as const;
export type Mode = (typeof MODE)[keyof typeof MODE];

export type Text = (index: number) => string;

export interface GameRow {
  icon: number;
  name: string;
  episode: string;
  mode: string;
  difficulty: string; // empty for Challenge games
  players: string; // "n/max"
  disabled: boolean;
}

// handle_ship_packet0x05 -> ChatshortcutmenulistitemConstructor_0072e42c: the
// mode is 2 for a battle flag (0x10), then 1 for a challenge flag (0x20).
export function entryMode(e: Pick<GameListEntry, 'battle' | 'challenge'>): Mode {
  let m: Mode = MODE.normal;
  if (e.battle) m = MODE.battle;
  if (e.challenge) m = MODE.challenge;
  return m;
}

// The texts of one row: the episode is [11:0x135 + episode], the mode
// [11:0x139 + mode], the difficulty [11:0x13d + difficulty] unless the mode is
// Challenge, the players "<n>/<max>" (the "/" at 0x0096f638).
export function gameRow(e: GameListEntry, t11: Text): GameRow {
  const mode = entryMode(e);
  return {
    icon: e.passworded ? ICON_PASSWORD : ICON_NONE,
    name: e.name,
    episode: e.episode ? t11(T11.episodeBase + e.episode) : '',
    mode: t11(T11.modeBase + mode),
    difficulty: mode === MODE.challenge ? '' : t11(T11.difficultyBase + e.difficulty),
    players: `${e.players}/${e.maxPlayers}`,
    disabled: !e.joinable,
  };
}

// Keys the menus take (the client's slots: arrows move, Decide = Enter,
// Cancel = Backspace / Escape, Tab = the info key 0xe).
export interface MenuKey {
  key: string;
}

export type ListEvent =
  | { type: 'decide'; entry: GameListEntry }
  | { type: 'cancel' }
  | { type: 'info'; entry: GameListEntry }
  | { type: 'move' }
  | { type: 'none' };

// The window of the 08 answer: up to 0x40 rows, 8 visible, the cursor wraps
// and the view follows it like the Item Pack's list.
export class GameListView {
  readonly entries: GameListEntry[];
  readonly rows: GameRow[];
  cursor = 0;
  top = 0;

  constructor(entries: readonly GameListEntry[], t11: Text) {
    this.entries = entries.slice(0, GAME_LIST_WINDOW.maxRows);
    this.rows = this.entries.map((e) => gameRow(e, t11));
  }

  get selected(): GameListEntry | null {
    return this.entries[this.cursor] ?? null;
  }

  private follow(): void {
    const v = GAME_LIST_WINDOW.visibleRows;
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + v) this.top = this.cursor - v + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.rows.length - v)));
  }

  key(e: MenuKey): ListEvent {
    const n = this.rows.length;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        if (!n) return { type: 'none' };
        this.cursor = (this.cursor + (e.key === 'ArrowUp' ? n - 1 : 1)) % n;
        this.follow();
        se(SE.cursor);
        return { type: 'move' };
      case 'Enter': {
        const entry = this.selected;
        if (!entry) {
          se(SE.buzzer);
          return { type: 'none' };
        }
        se(SE.ok);
        return { type: 'decide', entry };
      }
      case 'Tab': {
        const entry = this.selected;
        return entry ? { type: 'info', entry } : { type: 'none' };
      }
      case 'Backspace':
      case 'Escape':
        se(SE.cancel);
        return { type: 'cancel' };
    }
    return { type: 'none' };
  }
}

// --- the creation window -----------------------------------------------------

export type CreateStep = 'rows' | 'name' | 'password' | 'mode' | 'difficulty';
export type CreateResult = 'create' | 'cancel' | null;

export const CREATE_ROWS = 5;
export const MODES: readonly Mode[] = [MODE.normal, MODE.challenge, MODE.battle, MODE.solo]; // list order 0x139..0x13c
export const DIFFICULTIES = [0, 1, 2, 3] as const; // 0x13d..0x140 (Ultimate is always offered)

export class CreatePartyWindow {
  readonly episode: 1 | 2 | 3; // ChallengeMenuObject +0x20: 1 Episode 1, 2 Episode 2, 3 Episode 4
  name = '';
  password = '';
  mode: Mode = MODE.normal;
  difficulty = 0;
  row = 0;
  step: CreateStep = 'rows';
  editor: TextEditor | null = null;
  popup: { cursor: number } | null = null;
  result: CreateResult = null;

  constructor(episode: 1 | 2 | 3) {
    this.episode = episode;
  }

  // The Registration row needs a name; Difficulty does not exist in Challenge.
  selectable(row: number): boolean {
    if (row === 4) return this.name !== '';
    if (row === 3) return this.mode !== MODE.challenge;
    return true;
  }

  // State 1 -> 2: with a name typed the cursor goes to Registration.
  private idle(): void {
    this.step = 'rows';
    this.editor = null;
    this.popup = null;
    if (this.name !== '') this.row = 4;
  }

  key(e: MenuKey): void {
    if (this.result) return;
    if (this.editor) {
      this.editorKey(e);
      return;
    }
    if (this.popup) {
      this.popupKey(e);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const d = e.key === 'ArrowDown' ? 1 : CREATE_ROWS - 1;
      let r = this.row;
      do r = (r + d) % CREATE_ROWS;
      while (!this.selectable(r));
      this.row = r;
      se(SE.cursor);
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      se(SE.cancel);
      this.result = 'cancel';
    } else if (e.key === 'Enter') {
      if (!this.selectable(this.row)) {
        se(SE.buzzer);
        return;
      }
      se(SE.ok);
      // ChallengeMenuObject_ApplyJoinSelection_0073452c.
      if (this.row === 0) {
        this.step = 'name';
        this.editor = new TextEditor(this.name, MAX_NAME, false);
      } else if (this.row === 1) {
        this.step = 'password';
        this.editor = new TextEditor(this.password, MAX_PASSWORD, false);
      } else if (this.row === 2) {
        this.step = 'mode';
        this.popup = { cursor: this.mode };
      } else if (this.row === 3) {
        this.step = 'difficulty';
        this.popup = { cursor: this.difficulty };
      } else this.result = 'create';
    }
  }

  private editorKey(e: MenuKey): void {
    const ed = this.editor!;
    if (e.key === 'Enter') {
      if (this.step === 'name') this.name = ed.text;
      else this.password = ed.text;
      se(SE.ok);
      this.idle();
    } else if (e.key === 'Escape') {
      // The old text stays (the editor's cancel callback).
      se(SE.cancel);
      this.idle();
    } else if (e.key === 'Backspace') ed.backspace();
    else ed.type(e.key);
  }

  private popupKey(e: MenuKey): void {
    const p = this.popup!;
    const n = this.step === 'mode' ? MODES.length : DIFFICULTIES.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      p.cursor = (p.cursor + (e.key === 'ArrowUp' ? n - 1 : 1)) % n;
      se(SE.cursor);
    } else if (e.key === 'Enter') {
      se(SE.ok);
      if (this.step === 'mode') this.mode = MODES[p.cursor];
      else this.difficulty = DIFFICULTIES[p.cursor];
      this.idle();
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      se(SE.cancel);
      this.idle();
    }
  }

  // handle_party_creation_menu -> send_packet0x1c.
  options(): CreateGameOptions {
    return {
      name: this.name,
      password: this.password,
      difficulty: this.mode === MODE.challenge ? 0 : this.difficulty,
      battle: this.mode === MODE.battle,
      challenge: this.mode === MODE.challenge,
      solo: this.mode === MODE.solo,
      episode: this.episode,
    };
  }
}

// --- the join password prompt --------------------------------------------------

export class PasswordPrompt {
  readonly editor = new TextEditor('', MAX_PASSWORD, false);
  result: 'ok' | 'cancel' | null = null;

  key(e: MenuKey): void {
    if (this.result) return;
    if (e.key === 'Enter') {
      se(SE.ok);
      this.result = 'ok';
    } else if (e.key === 'Escape') {
      se(SE.cancel);
      this.result = 'cancel';
    } else if (e.key === 'Backspace') this.editor.backspace();
    else this.editor.type(e.key);
  }

  get password(): string {
    return this.editor.text;
  }
}

// --- the menus -------------------------------------------------------------------

// What the menus ask of the connection (net/game.ts Game.list / join / create
// plus the 09 / 11 info exchange).
export interface PartyHost {
  listGames(): Promise<GameListEntry[]>;
  gameInfo(entry: GameListEntry): Promise<string>;
  // Resolve once the 64 arrived; reject with the server's message otherwise.
  join(entry: GameListEntry, password: string): Promise<void>;
  create(options: CreateGameOptions): Promise<void>;
}

export interface PartyText {
  t11: Text;
  t15: Text;
}

export type PartyPhase = 'closed' | 'loading' | 'list' | 'password' | 'create' | 'burst' | 'message';

export class PartyMenus {
  phase: PartyPhase = 'closed';
  list: GameListView | null = null;
  create: CreatePartyWindow | null = null;
  password: PasswordPrompt | null = null;
  message = '';
  private info: InfoWindow;
  private details: InfoWindow | null = null;
  private frame = 0;
  private pending: GameListEntry | null = null;
  private readonly host: PartyHost;
  private readonly text: PartyText;
  // Called with an error text when a join / create was refused, and once the
  // game was entered.
  onEntered: () => void = () => {};

  constructor(host: PartyHost, text: PartyText) {
    this.host = host;
    this.text = text;
    this.info = new InfoWindow(PARTY_INFO_POS[0], PARTY_INFO_POS[1], 342, 144);
  }

  get open(): boolean {
    return this.phase !== 'closed';
  }

  // close_lobby_menus.
  close(): void {
    this.phase = 'closed';
    this.list = null;
    this.create = null;
    this.password = null;
    this.details = null;
    this.pending = null;
    this.message = '';
  }

  // TransitionToPartyListingFromEpisodeMenu_0079b3d0.
  openList(): void {
    this.close();
    this.phase = 'loading';
    this.info.set(this.text.t15(T15.listInfo));
    const t11 = this.text.t11;
    this.host.listGames().then(
      (entries) => {
        if (this.phase !== 'loading') return;
        this.list = new GameListView(entries, t11);
        this.phase = 'list';
      },
      (err) => this.fail(err),
    );
  }

  // HandleGameListMenuSelection_0079a644: episode 1, 2 or 3 (= Episode 4).
  openCreate(episode: 1 | 2 | 3): void {
    this.close();
    this.create = new CreatePartyWindow(episode);
    this.phase = 'create';
  }

  private fail(err: unknown): void {
    this.close();
    this.message = err instanceof Error ? err.message : String(err);
    this.phase = 'message';
  }

  private burst(task: Promise<void>): void {
    // do_party_burst: every menu closed while the game loads.
    this.list = null;
    this.create = null;
    this.password = null;
    this.details = null;
    this.phase = 'burst';
    task.then(
      () => {
        this.phase = 'closed';
        this.onEntered();
      },
      (err) => this.fail(err),
    );
  }

  tick(): void {
    this.frame++;
    this.info.tick();
    this.details?.tick();
  }

  key(e: MenuKey): void {
    switch (this.phase) {
      case 'list':
        this.listKey(e);
        break;
      case 'password':
        this.passwordKey(e);
        break;
      case 'create':
        this.createKey(e);
        break;
      case 'loading':
        if (e.key === 'Backspace' || e.key === 'Escape') {
          se(SE.cancel);
          this.close();
        }
        break;
      case 'message':
        if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape') this.close();
        break;
    }
  }

  private listKey(e: MenuKey): void {
    const ev = this.list!.key(e);
    if (ev.type === 'cancel') this.close();
    else if (ev.type === 'decide') {
      // handle_game_list_inputs: flags & 2 -> the password prompt.
      if (ev.entry.passworded) {
        this.pending = ev.entry;
        this.list = null;
        this.details = null;
        this.password = new PasswordPrompt();
        this.phase = 'password';
      } else this.burst(this.host.join(ev.entry, ''));
    } else if (ev.type === 'info') {
      void this.host.gameInfo(ev.entry).then(
        (text) => {
          if (this.phase !== 'list') return;
          this.details ??= new InfoWindow(GAME_INFO_WINDOW.x, GAME_INFO_WINDOW.y, GAME_INFO_WINDOW.w, GAME_INFO_WINDOW.h);
          this.details.set(text);
        },
        () => {},
      );
    }
  }

  private passwordKey(e: MenuKey): void {
    const p = this.password!;
    p.key(e);
    if (p.result === 'cancel') this.close();
    else if (p.result === 'ok' && this.pending) this.burst(this.host.join(this.pending, p.password));
  }

  private createKey(e: MenuKey): void {
    const c = this.create!;
    c.key(e);
    if (c.result === 'cancel') this.close();
    else if (c.result === 'create') this.burst(this.host.create(c.options()));
  }

  // Menus follow the counter's centring on a widescreen window.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number): void {
    const dx = extra / 2;
    ctx.save();
    ctx.translate(dx, 0);
    if (this.phase === 'list' || this.phase === 'loading') drawGameList(ctx, skin, this.list, this.frame);
    else if (this.phase === 'password' && this.password) this.drawPassword(ctx, skin, this.password);
    else if (this.phase === 'create' && this.create) drawCreateParty(ctx, skin, this.create, this.text, this.frame);
    ctx.restore();
    if (this.phase === 'list' || this.phase === 'loading') {
      this.info.draw(ctx, skin, extra);
      this.details?.draw(ctx, skin, extra);
    }
    if (this.phase === 'message') {
      const w = new InfoWindow(PARTY_INFO_POS[0], PARTY_INFO_POS[1], 342, 144);
      w.set(this.message);
      w.finish();
      w.draw(ctx, skin, extra);
    }
  }

  private drawPassword(ctx: CanvasRenderingContext2D, skin: WindowSkin, p: PasswordPrompt): void {
    const prompt = this.text.t15(T15.enterPassword);
    const w = gameTextWidth(prompt) + 2 * INSET; // FUN_0073608c: widest text + 20
    const h = listWindowHeight(2, true);
    drawWindowFrame(ctx, skin.frame, PASSWORD_WINDOW.x, PASSWORD_WINDOW.y, w, h);
    drawGameText(ctx, prompt, PASSWORD_WINDOW.x + INSET, PASSWORD_WINDOW.y + INSET + TITLE_GAP + 1);
    drawEditor(ctx, p.editor.shown, PASSWORD_EDITOR.x, PASSWORD_EDITOR.y, this.frame);
  }
}

// --- drawing ----------------------------------------------------------------------

function drawEditor(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, frame: number): void {
  drawGameText(ctx, text, x, y + 1);
  ctx.fillStyle = caretColor(frame);
  ctx.fillRect(x + gameTextWidth(text), y, CARET.w, CARET.h);
}

function drawIcon(ctx: CanvasRenderingContext2D, img: CanvasImageSource, icon: number, x: number, y: number): void {
  const uv = ICON_UV[icon];
  if (icon === ICON_NONE || !uv) return;
  ctx.drawImage(img, uv[0], uv[1], ICON_SIZE, ICON_SIZE, x, y, ICON_SIZE, ICON_SIZE);
}

export function drawGameList(ctx: CanvasRenderingContext2D, skin: WindowSkin, list: GameListView | null, _frame = 0): void {
  const W = GAME_LIST_WINDOW;
  drawWindowFrame(ctx, skin.frame, W.x, W.y, W.w, W.h);
  const cx = W.x + INSET;
  const cy = W.y + INSET + TITLE_GAP;
  if (list && list.rows.length) {
    drawSelectBar(ctx, skin.bars, cx, cy + (list.cursor - list.top) * ROW, W.w - 2 * INSET, 16);
    list.rows.slice(list.top, list.top + W.visibleRows).forEach((r, i) => {
      const y = cy + i * ROW;
      const color = r.disabled ? ROW_DISABLED : i + list.top === list.cursor ? SELECTED : '#ffffff';
      drawIcon(ctx, skin.frame, r.icon, cx, y);
      drawGameText(ctx, r.name, cx + ROW_COLUMNS.name, y, color);
      drawGameText(ctx, r.episode, cx + ROW_COLUMNS.episode, y, color);
      drawGameText(ctx, r.mode, cx + ROW_COLUMNS.mode, y, color);
      if (r.difficulty) drawGameText(ctx, r.difficulty, cx + ROW_COLUMNS.difficulty, y, color);
      drawGameText(ctx, r.players, cx + ROW_COLUMNS.players, y, color);
    });
  }
  drawWindowTitle(ctx, skin, W.x, W.y, W.title);
}

export function drawCreateParty(ctx: CanvasRenderingContext2D, skin: WindowSkin, c: CreatePartyWindow, text: PartyText, frame: number): void {
  const W = CREATE_WINDOW;
  drawWindowFrame(ctx, skin.frame, W.x, W.y, W.w, W.h);
  const cx = W.x + INSET;
  const cy = W.y + INSET + TITLE_GAP;
  const t11 = text.t11;
  const labels = [t11(T11.partyName), t11(T11.password), t11(T11.playMode), t11(T11.difficulty)];
  const values = [
    c.step === 'name' ? '' : c.name,
    c.step === 'password' ? '' : c.password,
    t11(T11.modeBase + c.mode),
    t11(T11.difficultyBase + c.difficulty),
  ];
  if (!c.editor && !c.popup) drawSelectBar(ctx, skin.bars, cx, cy + c.row * ROW, W.w - 2 * INSET, 16);
  labels.forEach((label, i) => {
    const color = c.selectable(i) ? '#ffffff' : DISABLED;
    const y = cy + i * ROW + 1;
    drawGameText(ctx, label, cx, y, color);
    drawGameText(ctx, ':', cx + 154, y, color); // 0x00970f50
    drawGameText(ctx, values[i], cx + 166, y, color); // 0x00970f4c
  });
  // "Registration" is centred on x + 202.5 (0x00970f48 / 0x00970f44).
  const reg = t11(T11.registration);
  drawGameText(ctx, reg, cx + 202.5 - gameTextWidth(reg) / 2, cy + 4 * ROW + 1, c.selectable(4) ? '#ffffff' : DISABLED);
  drawWindowTitle(ctx, skin, W.x, W.y, GAME_LIST_WINDOW.title);
  if (c.editor) {
    const at = CREATE_EDITORS[c.step === 'name' ? 0 : 1];
    drawEditor(ctx, c.editor.shown, at.x, at.y, frame);
  }
  if (c.popup) {
    const items: ListItem[] = (c.step === 'mode' ? MODES.map((m) => t11(T11.modeBase + m)) : DIFFICULTIES.map((d) => t11(T11.difficultyBase + d))).map((label, value) => ({ label, value, enabled: true }));
    const w = Math.max(...items.map((i) => gameTextWidth(i.label))) + 2 * INSET;
    drawListWindow(ctx, skin, CHOICE_POS.x, CHOICE_POS.y, w, null, items, c.popup.cursor);
  }
}
