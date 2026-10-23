// Options > Keyboard Config (row 5 of classic/options.ts), as PsoBB.exe runs
// KeyboardConfigObject_Constructor_00791be8 (exe 0x00791be8) and its state
// handlers HandleKeyboardConfigInput_007903ba (0x007903ba),
// HandleKeyboardConfigState_00790a50, HandleKeyBindingInput_007907cc,
// HandleInputKeyBinding_00790458 (0x00790458) and
// KeyboardConfigObject_Destructor_0078f7fc (0x0078f7fc).
//
// The window: a top list of the four Default settings and Custom (exe unitxt
// 0x50..0x54), then for Custom a category header (group 0 0x0E..0x10, Left /
// Right switch it) and the category's rows: label (unitxt, see
// input/keyconfig.ts) and the key the binding holds. Decide on a row waits for
// a key ("Press the button you wish to map."); the key is written with a swap
// when another row has it (the exe's "Setup interchanged."). Cancel (Backspace)
// goes back a level; leaving the window commits the working copy: it becomes
// the live config (the exe copies g_KeyboardControlsForConfig back into
// keyboard_controls) and it is sent to the server with 0x04ED on every close,
// changed or not (the destructor always calls send_packet0xed_subcommand4).
//
// The Default 1..4 entries copy their preset into the working config (the
// exe's FUN_00792f98 from the table at 0x0097aca0; the contents are in
// input/keyconfig.ts). ASSUMED: no "overwrite" prompt is shown first (the exe
// opens a message box with unitxt 0x4A in FUN_00790970; its answer flow is not
// decoded), and the list stays on the top level after a copy.
// Not ported: the control names of type 1 bindings (pad buttons; shown blank).
// The menu keys are read live (menuKeyOf): Select, Decide, Cancel.
//
// Layout: the exe's list positions (KeyboardConfigObject_Constructor): top list
// at (100, 40), header at (100, 170) 260 wide, the rows at (110, 200), the
// message bar at (10, 440). The width of the rows and the key column are
// ASSUMED (the exe's ListWindowObject_Initialize sizes are not decoded).

import { se, SE } from '../audio/se.ts';
import {
  BINDING,
  codeOfDomKey,
  KEY_NAMES,
  keyCaption,
  menuKeyOf,
  normalizeKeyConfig,
  PRESET_COUNT,
  presetKeyConfig,
  readBinding,
  writeBinding,
} from '../input/keyconfig.ts';
import { drawGameText } from './gametext.ts';
import { drawListWindow, drawTextWindow, INSET, listKey, listWindowHeight, ROW, SELECTED, type ListItem } from './fieldwindows.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';

export const TOP_LIST = { x: 100, y: 40, w: 140 } as const; // exe list at (100, 40)
export const HEADER = { x: 100, y: 170, w: 260 } as const;
export const ROWS_RECT = { x: 110, y: 200, w: 420 } as const;
export const MESSAGE_RECT = { x: 10, y: 440, w: 620 } as const;
export const KEY_COLUMN = 220; // ASSUMED: the key caption's offset inside the rows

// unitxt group 0 messages (newserv unitxt_e: 2, 0x4B, 0x4C, 0x4D, 0x4E).
const MSG_PRESS = 0x02; // "Press the button you wish to map."
const MSG_SELECT = 0x4b; // "Please select item to change."
const MSG_NOT_CHANGEABLE = 0x4c; // "This item is not changable."
const MSG_IMPOSSIBLE = 0x4d; // "This button is impossible to set."
const MSG_INTERCHANGED = 0x4e; // "Setup interchanged."

// The top list: Default1..4 (exe 0x50..0x53) and Custom (0x54). Default n is
// preset n-1 (presetKeyConfig, the exe's 0x0097aca0 table).
const PRESET_LABELS = [0x50, 0x51, 0x52, 0x53] as const;
const CUSTOM_LABEL = 0x54;

// Categories: the header's unitxt name and the binding of each row, in order
// (the exe's label table 0x0097b500, 6 / 5 / 9 rows).
export const CATEGORIES: ReadonlyArray<{ name: number; rows: readonly { binding: number; label: number }[] }> = [
  {
    name: 0x0e, // "Config of Movement"
    rows: [
      { binding: BINDING.moveForward, label: 0x12 },
      { binding: BINDING.moveBackward, label: 0x13 },
      { binding: BINDING.moveLeft, label: 0x14 },
      { binding: BINDING.moveRight, label: 0x15 },
      { binding: BINDING.lockMoveForward, label: 0x16 },
      { binding: BINDING.lockWalkForward, label: 0x17 },
    ],
  },
  {
    name: 0x0f, // "Config of Action Palette"
    rows: [
      { binding: BINDING.paletteLeft, label: 0x28 },
      { binding: BINDING.paletteMiddle, label: 0x29 },
      { binding: BINDING.paletteRight, label: 0x2a },
      { binding: BINDING.symbolChat, label: 0x35 },
      { binding: BINDING.camera, label: 0x2d },
    ],
  },
  {
    name: 0x10, // unitxt 0x10 as the exe names it ("Setting improper item"; see DEVLOG)
    rows: [
      { binding: BINDING.decide, label: 0x18 },
      { binding: BINDING.cancel, label: 0x19 },
      { binding: BINDING.menu, label: 0x1a },
      { binding: BINDING.inputStart, label: 0x34 },
      { binding: BINDING.paletteChange, label: 0x2c },
      { binding: BINDING.selectUp, label: 0x1c },
      { binding: BINDING.selectDown, label: 0x1d },
      { binding: BINDING.selectLeft, label: 0x1e },
      { binding: BINDING.selectRight, label: 0x1f },
    ],
  },
];

// The row order of the exe's search (HandleInputKeyBinding_00790458 walks the
// categories and their rows in this order).
const ALL_ROWS = CATEGORIES.flatMap((c) => c.rows.map((r) => r.binding));

// The select arrows are never swapped with (the exe skips bindings 10..13).
const NO_SWAP = new Set<number>([BINDING.selectUp, BINDING.selectDown, BINDING.selectLeft, BINDING.selectRight]);

// Key codes that cannot be set (type 0 and 0x4C, 0x54..0x57: ESC, both Shifts,
// Ctrl, Alt).
const IMPOSSIBLE = new Set<number>([0x4c, 0x54, 0x55, 0x56, 0x57]);

const KNOWN_CODE = new Set<number>(KEY_NAMES.map(([c]) => c));

type Stage = 'top' | 'items' | 'wait';

export interface KeyConfigEnv {
  text: (group: number, index: number) => string;
  // The saved config, or null when there is none (the default is used).
  load: () => Uint8Array | null;
  // The window closed: the working config goes live and is saved.
  commit: (cfg: Uint8Array) => void;
}

export class KeyConfigMenu {
  private readonly env: KeyConfigEnv;
  // The working copy (the exe's g_KeyboardControlsForConfig).
  private readonly cfg: Uint8Array;
  private stage: Stage = 'top';
  private readonly top: { cursor: number };
  private readonly topItems: ListItem[];
  private cat = 0;
  private row = 0;
  // The message bar (unitxt index), null when none is shown.
  private msg: number | null = null;
  private closed = false;

  constructor(env: KeyConfigEnv) {
    this.env = env;
    this.cfg = normalizeKeyConfig(env.load());
    this.top = { cursor: 4 }; // ASSUMED: starts on Custom
    this.topItems = [
      ...PRESET_LABELS.map((g) => ({ label: env.text(0, g), value: g, enabled: true })),
      { label: env.text(0, CUSTOM_LABEL), value: CUSTOM_LABEL, enabled: true },
    ];
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // The rows of the category in view, as list items (enabled: Cancel is not
  // changeable, the exe's "This item is not changable.").
  private rows(): ListItem[] {
    return CATEGORIES[this.cat].rows.map((r) => ({ label: this.env.text(0, r.label), value: r.binding, enabled: r.binding !== BINDING.cancel }));
  }

  // Key codes of the bindings and what the rows show for them.
  private caption(binding: number): string {
    const b = readBinding(this.cfg, binding);
    if (binding === BINDING.cancel) return 'ESC/BACK SPACE';
    if (b.type !== 0) return '';
    return keyCaption(b.code);
  }

  // False when the window closed (Cancel on the top list).
  key(e: KeyboardEvent): boolean {
    if (this.closed) return false;
    if (this.stage === 'top') {
      const r = listKey(e, this.topItems, this.top);
      if (r === 'cancel') {
        this.close();
        return false;
      }
      if (r === 'decide') {
        if (this.top.cursor < PRESET_COUNT) {
          // Default n: its preset becomes the working config (FUN_00792f98).
          this.cfg.set(presetKeyConfig(this.top.cursor));
          return true;
        }
        this.stage = 'items';
        this.cat = 0;
        this.row = 0;
        this.msg = MSG_SELECT;
      }
      return true;
    }
    if (this.stage === 'items') {
      const mk = menuKeyOf(e);
      if (mk === 'left' || mk === 'right') {
        // HandleKeyBindingInput_007907cc: the header wraps (flags 0x2000 / 0x4000).
        const n = CATEGORIES.length;
        this.cat = mk === 'left' ? (this.cat + n - 1) % n : (this.cat + 1) % n;
        this.row = 0;
        this.msg = MSG_SELECT;
        se(SE.cursor);
        return true;
      }
      if (mk === 'cancel') {
        se(SE.cancel);
        this.stage = 'top';
        this.msg = null;
        return true;
      }
      const rows = this.rows();
      const cursor = { cursor: this.row };
      const r = listKey(e, rows, cursor);
      this.row = cursor.cursor;
      if (r === 'move') this.msg = MSG_SELECT;
      else if (r === 'buzzer') this.msg = MSG_NOT_CHANGEABLE;
      else if (r === 'decide') {
        this.stage = 'wait';
        this.msg = MSG_PRESS;
      }
      return true;
    }
    // wait: the next key the table knows is the new key (HandleKeyBindingInput).
    const code = e.key === 'Shift' ? (e.code === 'ShiftRight' ? 0x55 : 0x54) : codeOfDomKey(e.key);
    if (code === null || !KNOWN_CODE.has(code)) return true;
    this.assign(CATEGORIES[this.cat].rows[this.row].binding, code);
    return true;
  }

  // HandleInputKeyBinding_00790458: a key the table has is set on the row;
  // a key another row holds gets the row's old key (the swap).
  private assign(binding: number, code: number): void {
    if (IMPOSSIBLE.has(code)) {
      se(SE.buzzer);
      this.msg = MSG_IMPOSSIBLE;
      return;
    }
    const old = readBinding(this.cfg, binding);
    for (const other of ALL_ROWS) {
      if (NO_SWAP.has(other)) continue;
      const b = readBinding(this.cfg, other);
      if (b.type === 0 && b.code === code) {
        writeBinding(this.cfg, other, old);
        writeBinding(this.cfg, binding, { type: 0, code });
        this.msg = MSG_INTERCHANGED;
        this.stage = 'items';
        se(SE.ok);
        return;
      }
    }
    writeBinding(this.cfg, binding, { type: 0, code });
    this.stage = 'items';
    se(SE.ok);
  }

  // KeyboardConfigObject_Destructor_0078f7fc: commit and send, always.
  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.env.commit(this.cfg.slice());
  }

  // Closes the window without a key (the options menu is closing).
  dispose(): void {
    this.close();
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    drawListWindow(ctx, skin, TOP_LIST.x, TOP_LIST.y, TOP_LIST.w, null, this.topItems, this.top.cursor, this.stage === 'top');
    if (this.stage === 'top') return;
    const cat = CATEGORIES[this.cat];
    drawListWindow(ctx, skin, HEADER.x, HEADER.y, HEADER.w, null, [{ label: this.env.text(0, cat.name), value: this.cat, enabled: true }], 0, false);
    const rows = cat.rows;
    const R = ROWS_RECT;
    drawWindowFrame(ctx, skin.frame, R.x, R.y, R.w, listWindowHeight(rows.length, false));
    const cx = R.x + INSET;
    const cy = R.y + INSET;
    drawSelectBar(ctx, skin.bars, cx, cy + this.row * ROW, R.w - 2 * INSET, 16);
    rows.forEach((r, i) => {
      const y = cy + i * ROW + 1;
      const color = i === this.row ? SELECTED : '#ffffff';
      drawGameText(ctx, this.env.text(0, r.label), cx, y, color);
      drawGameText(ctx, this.caption(r.binding), cx + KEY_COLUMN, y, color);
    });
    if (this.msg !== null) {
      const M = MESSAGE_RECT;
      drawTextWindow(ctx, skin, { x: M.x, y: M.y, w: M.w, h: listWindowHeight(1, false) }, this.env.text(0, this.msg));
    }
  }
}
