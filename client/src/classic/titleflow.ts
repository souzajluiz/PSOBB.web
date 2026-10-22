// What the title screen does frame by frame, from PsoBB.exe (Ephinea 1.25.13).
// Pure state (no canvas): classic/title.ts and classic/login.ts draw it,
// tests/titlescreen.test.ts drives it.
//
// Title scene (construct_mainmenu_stuff @ 0x006f8130 region, the constructor
// the dump leaves unnamed; DEVLOG 2026-10-16 calls it FUN_006f8130):
//   - starts title.adx, creates the background (0x006f475c), the menu child
//     ("Sinowberill" entity, vtable 0x00b3eaf8) with flag 4 (not updated) and
//     the logo (0x006f4cc4);
//   - creates a fade-in object (SinowbeatConstructor_007889b0, callback
//     LAB_006fb7c0): alpha 255, -8 per frame (0x0097a724) until <= 0
//     (0x0097a720); its callback is DisableMainGameMenu_006fb7e4, which
//     clears the menu child's flag 4, so the title takes keys only once the
//     fade is over.
// Menu child update (SinowberillEntity_Update_006fed04): state 0 runs
// 0x006fede0, then its frame counter +0x38 goes up by one.
//   State 0 (0x006fede0):
//     - Alt+Backspace: exit the game (play_scene(exit_game));
//     - Enter (key slots 0xc | 0x15) with no window: create the "Login" menu
//       (ChallengePlayerInfoWindow_Constructor_007617e8);
//     - cancel (slot 0xd) with the window open: destroy it;
//     - window flags (+0x1d): 1 = Start Game / Patch Download confirmed
//       (credentials copied, SE 0x420, state 2), 4 = Exit Game confirmed
//       (fade-out with the exit callback LAB_006ff1b4, state 3), 8 = closed;
//     - "PRESS ENTER KEY" alpha (+0x28) = (sin(3 deg * (counter % 120)) + 1)
//       / 2 (0x0096e424..0x0096e430: 2, 1, 360, 65536 BAMS).
//   The alpha starts at 0 (constructor: +0x28 = 0), so the text stays hidden
//   until the first update after the fade-in.
// Title update (update_main_menus @ 0x006f8434 region): while the menu child
// is in state 2 (IsMenuState_006ff1a4), MainGameMenu_ProcessLoadingState
// _006f8464 creates one fade-out object (LoadingScreenObject_Constructor
// _00788938): alpha 0, +8 per frame (0x0097a730) until >= 255 (0x0097a72c),
// then the next scene.
// The fade objects draw a black 640x480 quad (DrawUIElementTriangleFan
// _00788820) with alpha = round(value), skipped at alpha 0, z -10 (in front).

import { WindowAnim } from './windowanim.ts';

export const TITLE_FPS = 30;
export const FADE_START = 255; // 0x437f0000
export const FADE_STEP = 8; // 0x0097a724 (-8.0) / 0x0097a730 (+8.0)
export const FADE_MAX = 255; // 0x0097a72c
export const PRESS_PERIOD = 120; // counter % 0x78
export const PRESS_DEG_PER_FRAME = 3;

// SE ids (play_directional_sound_effect).
export const SE_CURSOR = 0x56f; // 0x006fed2c, list windows
export const SE_OK = 0x570; // list window confirm
export const SE_CANCEL = 0x585; // list window cancel
export const SE_BUZZER = 0x575; // not allowed (greyed item)
export const SE_TITLE_OK = 0x420; // 0x006fede0 on flag 1

// The "Login" menu (create_main_menu_list_items, called from
// ChallengePlayerInfoWindow_Constructor_007617e8):
//   CreateListWindowObject_0073566c(&{210, y}, 5 rows, unitxt(41, 2) "Login")
//   y = 300, or 330 when g_SinowberillInitComplete (0x00a96968) is set, i.e.
//   when SinowberillInit_006fb914 loaded TitleEP4.prs: get_game_version()
//   (0x0070851e region) returns 1 for an "Episode4" AccountCtrl registry key.
//   Rows 41/3 "Start Game", 41/4 "Exit Game", 41/5 "Patch Download",
//   41/6 "Register UserID" (values 0..3), then the account line (flags 9:
//   not selectable, color 0xffffcc33): "[%s]" (0x00974ebc) with the user
//   name, or unitxt(41, 7) "Empty" (ChallengePlayerInfoWindow_UpdateTitle
//   _00761bc0).
//   Start Game is greyed (ListWindowObject_SetItemHighlight_0073662c: color
//   0xff909090, row flag 0x10) unless both user name and password are set
//   (ChallengePlayerInfoWindow_UpdateLoginButtonState_00762140).
//   Initial row: 3 when either is empty, else 0.
// The window size {220, 120} is g_MainMenuListItemProperties (0x00974e10),
// set by MenuListItem_InitializeProperties_00712c14; it is also what
// listWindowHeight(5, true) gives. unknown_set_list_window_size (0x00736458)
// only centres the rows: x = w * 0.5 - 10 - text width * 0.5 (0x009713d0,
// 0x009713d4, 0x009713c8) from the content's left edge.
export const LOGIN_MENU = { x: 210, y: 300, yEpisode4: 330, w: 220, h: 120 } as const;
export const DISABLED_COLOR = '#909090'; // 0xff909090
export const ACCOUNT_COLOR = '#ffcc33'; // 0xffffcc33

// "Input UserID" (ChallengePlayerInputWindow_Constructor_00762224):
// CreateChatShortcutMenuYesNoWindow_0073840c(140, 330, 360, 100, 4 rows).
export const INPUT_WINDOW = { x: 140, y: 330, w: 360, h: 100 } as const;
// Its text editors (TKeyboardControl_constructor) sit at (316, 346) for the
// user name and (316, 366) for the password (ChallengePlayerInputWindow
// _Process_0076253c states 3 and 5); SetPosition_0078ed84 adds -10
// (0x0097ab74) to the panel, whose content is inset by 10 again.
export const EDITOR_POS = [
  [316, 346],
  [316, 366],
] as const;
// GetMaxUsernameLength_00762d2c / GetMaxPasswordLength_00762d00: 16 for the
// PC builds (12 / 16 for Hangame).
export const MAX_USER = 16;
export const MAX_PASSWORD = 16;
// Password mask: '*' per character, at most 8 when the editor is cancelled
// or the window opens (region not 1 / 3), at most 31 after an entry (0x1f).
export const MASK_CANCEL = 8;
export const MASK_ENTERED = 31;
// Editor caret (TextInputCursor_Render_007307a8): a 5 x 14 block
// (0x00970fd4, 0x00970fd0), color 0x8000ff00 / 0x4000ff00 (table 0x00970f68)
// switching on bit 0x10 of the frame counter.
export const CARET = { w: 5, h: 14, colors: ['rgba(0,255,0,0.502)', 'rgba(0,255,0,0.251)'] } as const;
export function caretColor(frame: number): string {
  return CARET.colors[(frame & 0x10) !== 0 ? 1 : 0];
}

// The height of a list window (YesNoListMenu_UpdateRenderHeight_00736390,
// yes_no_list_constructor 0x00735708): 0 (0x009713e8), plus 6 (0x009713e4)
// and the text height for each row, -6 (0x009713e0), +6 with a title (flag
// 0x40 of +0x2c, CreateListWindowObject_0073566c), +20 (0x009713dc). A
// one-line row is 14 high (get_text_rendering_sizes_for_list_item
// 0x0072ddf4: first line 0x00970ea4 = 14, each further line 0x00970ea0 = 20).
export const LIST_ROW_GAP = 6;
export const LIST_LINE_HEIGHT = 14;
export function listWindowHeight(rows: number, title = false): number {
  return rows * (LIST_ROW_GAP + LIST_LINE_HEIGHT) - LIST_ROW_GAP + (title ? LIST_ROW_GAP : 0) + 20;
}

// Exit Game asks unitxt(41, 12) "Really OK?" (main_menu_exit_game_sub_list,
// 0x00762498): ChatShortcutMenuWindow_CreateSubMenuWithYesNo_0073cfec makes
// an untitled one-row list at g_ExitGameMenuPosition (0x00974e3c: 400, 350),
// width 150, height listWindowHeight(1) = 34, render order 0.5; then the
// Yes/No list (yes_no_list_constructor: rows unitxt group 11 0x6e / 0x6f,
// width 104 (0x00971468), height listWindowHeight(2) = 54, render order 0.45
// (ListWindowObject_SetWidth_00712624; ASSUMED: the lower value is drawn
// in front) at YesNoListMenu_GetRenderPosition_0073cf10: the question's
// right edge - 111 (0x00971d44), its bottom edge - 10 (0x00971d40). The
// cursor starts on No (ListWindowObject_SetSelectedIndex_0073d148(1)).
// (psobb-client-source src/FUN_0073d178.c, the JP twin of
// ListWindowObject_IsItemSelectable_0073d114, confirms the pair keeps the
// Yes/No list at +0x24.)
export const EXIT_CONFIRM = { x: 400, y: 350, w: 150, h: listWindowHeight(1) } as const;
export const YES_NO = { dx: -111, dy: -10, w: 104, h: listWindowHeight(2) } as const;
export function yesNoRect(q: { x: number; y: number; w: number; h: number } = EXIT_CONFIRM): { x: number; y: number; w: number; h: number } {
  return { x: q.x + q.w + YES_NO.dx, y: q.y + q.h + YES_NO.dy, w: YES_NO.w, h: YES_NO.h };
}

export type Key = 'up' | 'down' | 'left' | 'right' | 'enter' | 'cancel' | 'backspace' | 'exitGame' | { char: string };

// One fade object.
export class ScreenFade {
  value: number;
  done = false;
  readonly dir: 'in' | 'out';

  constructor(dir: 'in' | 'out') {
    this.dir = dir;
    this.value = dir === 'in' ? FADE_START : 0;
  }

  // One update; true on the frame it finishes (the callback runs then).
  tick(): boolean {
    if (this.done) return false;
    if (this.dir === 'in') {
      const v = this.value - FADE_STEP;
      if (v <= 0) {
        this.value = 0;
        this.done = true;
        return true;
      }
      this.value = v;
    } else {
      const v = this.value + FADE_STEP;
      if (v >= FADE_MAX) {
        this.value = 255;
        this.done = true;
        return true;
      }
      this.value = v;
    }
    return false;
  }

  // Alpha of the black quad (0..1).
  get alpha(): number {
    return Math.round(this.value) / 255;
  }
}

// int_sin of a BAMS angle: the table lookup is sin() at 1/65536 of a turn.
function bamsSin(a: number): number {
  return Math.sin(((a & 0xffff) / 65536) * Math.PI * 2);
}

// "PRESS ENTER KEY" alpha for the menu child's frame counter.
export function pressAlpha(counter: number): number {
  const deg = (counter % PRESS_PERIOD) * PRESS_DEG_PER_FRAME;
  return (bamsSin(Math.round((deg * 65536) / 360)) + 1) / 2;
}

export interface Credentials {
  user: string;
  password: string;
}

// The user name as the Login menu keeps it (state 4 of
// ChallengePlayerInputWindow_UpdateState_00761d94): lower case (the region
// check CreateItemObject_006dc358 returns 0 on this build), at most 16.
export function storedUser(name: string): string {
  return name.slice(0, MAX_USER).toLowerCase();
}

// The user name an editor hands back (states 4 of 0x0076253c): spaces
// dropped, at most 16 characters read.
export function editedUser(text: string): string {
  return [...text.slice(0, MAX_USER)].filter((c) => c !== ' ').join('');
}

export function mask(length: number, max: number): string {
  return '*'.repeat(Math.min(length, max));
}

// A text editor (TKeyboardControl): the typed text, caret at the end.
export class TextEditor {
  text: string;
  readonly max: number;
  readonly password: boolean;

  constructor(text: string, max: number, password: boolean) {
    this.text = text.slice(0, max);
    this.max = max;
    this.password = password;
  }

  // Flag 0x2000: every character drawn as '*'.
  get shown(): string {
    return this.password ? '*'.repeat(this.text.length) : this.text;
  }

  type(c: string): void {
    if (c.length === 1 && c >= ' ' && c <= '~' && this.text.length < this.max) this.text += c;
  }

  backspace(): void {
    this.text = this.text.slice(0, -1);
  }
}

export type InputResult = 'ok' | 'cancel' | null;

// "Input UserID" window (ChallengePlayerInputWindow, update 0x0076253c).
export class InputUserIdWindow {
  user: string;
  password = '';
  // The password row's text (state 6 builds it from the entry).
  passwordShown = '';
  row = 0; // 0 UserID, 1 Password, 2 Confirm, 3 Cancel
  editor: { field: 0 | 1; edit: TextEditor } | null = null;
  result: InputResult = null;
  readonly anim = new WindowAnim(false, false);
  se: (id: number) => void = () => {};

  constructor(user: string) {
    this.user = user.slice(0, MAX_USER);
  }

  open(): void {
    this.anim.se = this.se;
    this.anim.open(1);
    this.refreshConfirm();
  }

  // UpdateSubmitButtonState_00762b14: Confirm is selectable once both fields
  // hold something, and the cursor moves to it; otherwise it is greyed.
  get confirmEnabled(): boolean {
    return editedUser(this.user) !== '' && this.password !== '';
  }

  private refreshConfirm(): void {
    this.user = editedUser(this.user);
    if (this.confirmEnabled) this.row = 2;
  }

  private selectable(row: number): boolean {
    return row !== 2 || this.confirmEnabled;
  }

  tick(): void {
    this.anim.tick(1);
  }

  key(k: Key): void {
    if (this.result || this.anim.animating) return;
    const ed = this.editor;
    if (ed) {
      if (k === 'enter') {
        // States 4 / 6, "focused" branch: take the text.
        if (ed.field === 0) this.user = editedUser(ed.edit.text);
        else {
          this.password = ed.edit.text;
          this.passwordShown = mask(this.password.length, MASK_ENTERED);
        }
        this.editor = null;
        this.se(SE_OK);
        this.refreshConfirm();
      } else if (k === 'cancel') {
        // "Locked" branch: the old text comes back.
        if (ed.field === 1) this.passwordShown = mask(this.password.length, MASK_CANCEL);
        this.editor = null;
        this.se(SE_CANCEL);
        this.refreshConfirm();
      } else if (k === 'backspace') ed.edit.backspace();
      else if (typeof k === 'object') ed.edit.type(k.char);
      return;
    }
    if (k === 'up' || k === 'down') {
      const d = k === 'down' ? 1 : 3;
      let r = this.row;
      do r = (r + d) % 4;
      while (!this.selectable(r));
      this.row = r;
      this.se(SE_CURSOR);
    } else if (k === 'cancel') {
      this.result = 'cancel';
      this.se(SE_CANCEL);
    } else if (k === 'enter') {
      // ChallengePlayerInputWindow_SetAction_00762cc0.
      if (this.row === 0) this.editor = { field: 0, edit: new TextEditor(this.user, MAX_USER, false) };
      else if (this.row === 1) this.editor = { field: 1, edit: new TextEditor('', MAX_PASSWORD, true) };
      else if (this.row === 2) {
        this.result = 'ok';
        this.se(SE_OK);
        return;
      } else {
        this.result = 'cancel';
        this.se(SE_CANCEL);
        return;
      }
      this.se(SE_OK);
    }
  }

  // A tap on a row (browser convenience): the cursor goes there and Enter
  // follows, as the Login menu's pointer does. Not while an editor is open.
  tapRow(row: number): void {
    if (this.result || this.anim.animating || this.editor || row < 0 || row > 3 || !this.selectable(row)) return;
    this.row = row;
    this.key('enter');
  }

  // The phone's HTML form (classic/loginform.ts) hands over its fields: the same
  // fields the editors would give (spaces dropped, printable ASCII, 16 max),
  // then Confirm / Cancel as the canvas does.
  submitForm(user: string, password: string): void {
    if (this.result) return;
    this.user = editedUser(user);
    this.password = [...password].filter((c) => c >= ' ' && c <= '~').join('').slice(0, MAX_PASSWORD);
    this.passwordShown = mask(this.password.length, MASK_ENTERED);
    if (!this.confirmEnabled) return;
    this.result = 'ok';
    this.se(SE_OK);
  }

  cancelForm(): void {
    if (this.result) return;
    this.result = 'cancel';
    this.se(SE_CANCEL);
  }

  // Row values while not editing (the edited row is blank: the editor draws).
  values(): [string, string] {
    return [this.editor?.field === 0 ? '' : this.user, this.editor?.field === 1 ? '' : this.passwordShown];
  }
}

export interface ExitConfirm {
  cursor: number;
  question: WindowAnim;
  list: WindowAnim;
}

export type MenuResult = 'start' | 'patch' | 'exit' | 'closed' | null;

export interface MenuRow {
  label: string;
  value: number; // -1 for the account line
  color?: string | undefined;
  selectable: boolean;
}

export interface MenuText {
  title: string; // 41/2
  items: [string, string, string, string]; // 41/3..6
  empty: string; // 41/7
  input: { title: string; user: string; password: string; confirm: string; cancel: string }; // 41/8, 9, 10, 1, 0
  reallyOk: string; // 41/12
  yes: string;
  no: string;
}

export const DEFAULT_TEXT: MenuText = {
  title: 'Login',
  items: ['Start Game', 'Exit Game', 'Patch Download', 'Register UserID'],
  empty: 'Empty',
  input: { title: 'Input UserID', user: 'UserID', password: 'Password', confirm: 'Confirm', cancel: 'Cancel' },
  reallyOk: 'Really OK?',
  yes: 'Yes',
  no: 'No',
};

// The "Login" menu window (ChallengePlayerInfoWindow, update
// ChallengePlayerInputWindow_UpdateState_00761d94).
export class LoginMenu {
  creds: Credentials;
  selected: number;
  result: MenuResult = null;
  input: InputUserIdWindow | null = null;
  // Exit Game's question and Yes/No lists (cursor 0 Yes, 1 No). Both are
  // created open, so each runs its own opening animation and wipe.
  exitConfirm: ExitConfirm | null = null;
  readonly anim = new WindowAnim(false, false);
  readonly text: MenuText;
  se: (id: number) => void = () => {};

  constructor(creds: Credentials, text: MenuText = DEFAULT_TEXT) {
    this.creds = { ...creds };
    this.text = text;
    this.selected = this.startEnabled ? 0 : 3;
  }

  open(): void {
    this.anim.se = this.se;
    this.anim.open(1);
  }

  get startEnabled(): boolean {
    return this.creds.user !== '' && this.creds.password !== '';
  }

  rows(): MenuRow[] {
    const t = this.text.items;
    return [
      { label: t[0], value: 0, selectable: this.startEnabled, color: this.startEnabled ? undefined : DISABLED_COLOR },
      { label: t[1], value: 1, selectable: true },
      { label: t[2], value: 2, selectable: true },
      { label: t[3], value: 3, selectable: true },
      { label: this.creds.user ? `[${this.creds.user}]` : this.text.empty, value: -1, selectable: false, color: ACCOUNT_COLOR },
    ];
  }

  // A tap on the exit question's Yes (0) / No (1).
  tapYesNo(index: number): void {
    const x = this.exitConfirm;
    if (this.result || this.anim.animating || !x || x.list.animating) return;
    x.cursor = index;
    this.key('enter');
  }

  // Flag 0x20 while a sub-window has the keys: no cursor bar.
  get active(): boolean {
    return !this.input && !this.exitConfirm;
  }

  tick(): void {
    this.anim.tick(1);
    if (this.exitConfirm) {
      this.exitConfirm.question.tick(1);
      this.exitConfirm.list.tick(1);
    }
    if (!this.input) return;
    this.input.tick();
    // State 4: the Input UserID result.
    if (this.input.result === 'ok') {
      this.creds = { user: storedUser(this.input.user), password: this.input.password.slice(0, MAX_PASSWORD) };
      this.input = null;
    } else if (this.input.result === 'cancel') this.input = null;
  }

  key(k: Key): void {
    if (this.result || this.anim.animating) return;
    if (this.input) return this.input.key(k);
    const x = this.exitConfirm;
    if (x) {
      // ASSUMED: the Yes/No list takes keys once it is open, as the Login
      // list does here.
      if (x.list.animating) return;
      if (k === 'up' || k === 'down') {
        x.cursor ^= 1;
        this.se(SE_CURSOR);
      } else if (k === 'enter') {
        this.se(SE_OK);
        this.exitConfirm = null;
        // State 6: Yes -> flags 4.
        if (x.cursor === 0) this.result = 'exit';
      } else if (k === 'cancel') {
        this.se(SE_CANCEL);
        this.exitConfirm = null;
      }
      return;
    }
    const rows = this.rows();
    if (k === 'up' || k === 'down') {
      const d = k === 'down' ? 1 : rows.length - 1;
      let r = this.selected;
      do r = (r + d) % rows.length;
      while (!rows[r].selectable);
      if (r !== this.selected) this.se(SE_CURSOR);
      this.selected = r;
    } else if (k === 'cancel') {
      // List flag 4 -> window flags 8.
      this.se(SE_CANCEL);
      this.result = 'closed';
    } else if (k === 'enter') {
      // translate_main_menu_list_index_to_state.
      const v = rows[this.selected].value;
      if (v === 0) this.result = 'start';
      else if (v === 1) {
        this.se(SE_OK);
        const question = new WindowAnim(false, false);
        const list = new WindowAnim(false, false);
        question.se = list.se = this.se;
        question.open(1);
        list.open(1);
        this.exitConfirm = { cursor: 1, question, list };
      } else if (v === 2) this.result = 'patch';
      else if (v === 3) {
        this.se(SE_OK);
        this.input = new InputUserIdWindow(this.creds.user);
        this.input.se = this.se;
        this.input.open();
      }
    }
  }
}

export interface TitleHost {
  se(id: number): void;
  // After the fade-out: Start Game / Patch Download, or Exit Game.
  // In the exe both Start Game and Patch Download go on through table
  // 0x009d04c8 (indexed by the menu child's +0x20, entries 1..3) to
  // SaveAndSetMainMenuType_00824860, i.e. the patch_status scene. The
  // browser has no patch server:
  // Start Game logs in at once and Patch Download returns to the title, and
  // the login runs under the "Connecting.." object (ASSUMED: the
  // patch_status scene's own screens are not traced).
  start(creds: Credentials): void;
  patch(creds: Credentials): void;
  exit(): void;
}

// The title scene's logic: fade-in, menu child, Login menu, fade-out.
export class TitleFlow {
  state: 0 | 2 | 3 = 0;
  enabled = false; // the menu child's flag 4 cleared
  counter = 0; // menu child +0x38
  // The scene's idle counter (+0x34, limit +0x38 = 1200, or 800 when
  // CreateItemObject_006dc358 != 0) is not modelled: update_main_menus
  // (0x006f8434) clears it on any key and runs the fade-out only while it is
  // below the limit, and nothing in the title code (0x006f4000..0x006ff400)
  // increments it, so the gate stays open (ASSUMED: nothing else does).
  press = 0; // "PRESS ENTER KEY" alpha (+0x28)
  fadeIn = new ScreenFade('in');
  fadeOut: ScreenFade | null = null;
  menu: LoginMenu | null = null;
  creds: Credentials;
  private next: 'start' | 'patch' | 'exit' = 'start';
  readonly host: TitleHost;
  readonly text: MenuText;

  constructor(host: TitleHost, creds: Credentials = { user: '', password: '' }, text: MenuText = DEFAULT_TEXT) {
    this.host = host;
    this.creds = { ...creds };
    this.text = text;
  }

  // A new title scene (back from a later screen).
  reset(): void {
    this.state = 0;
    this.enabled = false;
    this.counter = 0;
    this.press = 0;
    this.fadeIn = new ScreenFade('in');
    this.fadeOut = null;
    this.menu = null;
  }

  // Development aid (?screen=menu / input): the fade-in done and the windows
  // fully open, as after the key presses.
  skipTo(what: 'menu' | 'input'): void {
    while (!this.enabled) this.tick();
    this.key('enter');
    const settle = () => {
      for (let i = 0; i < 30; i++) this.tick();
    };
    settle();
    if (what === 'input' && this.menu) {
      this.menu.selected = 3;
      this.key('enter');
      settle();
    }
  }

  // One 30 fps frame. Keys of this frame are given to key() before it.
  tick(): void {
    if (this.fadeIn.tick()) this.enabled = true;
    this.menu?.tick();
    if (this.enabled && this.state === 0) {
      this.handleMenu();
      if (this.state === 0) this.press = pressAlpha(this.counter);
    }
    if (this.enabled) this.counter++;
    if (this.fadeOut?.tick()) {
      if (this.next === 'exit') this.host.exit();
      else if (this.next === 'patch') this.host.patch(this.creds);
      else this.host.start(this.creds);
    }
  }

  private handleMenu(): void {
    const m = this.menu;
    if (!m) return;
    this.creds = { ...m.creds };
    if (m.result === 'start' || m.result === 'patch') {
      this.menu = null;
      this.host.se(SE_TITLE_OK);
      this.state = 2;
      this.next = m.result;
      this.fadeOut = new ScreenFade('out');
    } else if (m.result === 'exit') {
      this.menu = null;
      this.state = 3;
      this.next = 'exit';
      this.fadeOut = new ScreenFade('out');
    } else if (m.result === 'closed') this.menu = null;
  }

  key(k: Key): void {
    if (!this.enabled || this.state !== 0) return;
    if (k === 'exitGame') return this.host.exit();
    if (this.menu) {
      const m = this.menu;
      const editing = m.input?.editor != null;
      m.key(k);
      // 0x006fede0 checks the cancel slot itself and destroys the whole
      // window, whatever sub-window is up (the creds stay as they were). A
      // text editor holds the keyboard while it is open (assumed: the IME
      // panel takes the keys), so its cancel only ends the edit.
      if (k === 'cancel' && !editing) this.menu = null;
      return;
    }
    if (k === 'enter') {
      this.menu = new LoginMenu(this.creds, this.text);
      this.menu.se = (id) => this.host.se(id);
      this.menu.open();
    }
  }

  // Overall black overlay alpha (fade-in or fade-out).
  get fadeAlpha(): number {
    return Math.max(this.fadeIn.done ? 0 : this.fadeIn.alpha, this.fadeOut?.alpha ?? 0);
  }
}
