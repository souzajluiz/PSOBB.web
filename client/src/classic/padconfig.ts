// Options > Pad Button Config (row 4 of classic/options.ts, after the Custom /
// Return to default list), as PsoBB.exe runs it: pad_button_config_related
// (the window, exe 0x00792280 / dump line 772001), UpdatePadConfigMenu_00790df8
// (the wait for a pad input, dump line 770890), SetPadConfigDwordValue_00791474
// (the cursor), and the destructor's send (send_packet0xed_subcommand5).
//
// The window: 16 rows at (100, 60), 440 wide (exe FUN_007922f8): rows 0..3 are
// the analog bindings (the stick axes), rows 4..15 the controls 0..11 (their
// pad button). The bottom message bar at (10, 434), 620 wide. Decide on a row
// waits for the pad ("Please select item to change." until then); the next
// pad input is set on the row. Delete clears it (refused for the controls that
// must stay bound, unitxt 0x4C). Backspace / Escape leave the wait. Cancel on
// the list closes the window and commits the config (the exe's destructor
// sends 0x05ED every time, changed or not).
//
// ASSUMED (not decoded or not checkable without a pad):
// - the wait takes the rising edge of a pad input (the exe checks the held
//   state; the edge keeps the Decide press from being read as the new button);
// - the layout inside the rows (the caption column, the row height) and the
//   bottom bar's text rows are the list windows' own;
// - the analog swap uses the exe's signed compare, so 0xFF (none) matches code
//   6 as a conflict (ported as is; see padconfig.ts analogOpposite).

import { se, SE } from '../audio/se.ts';
import {
  analogName,
  analogOpposite,
  buttonName,
  buttonOf,
  CONTROL_COUNT,
  MUST_BIND,
  normalizePadConfig,
  PAD_BUTTON_NAMES,
  PAD_ROWS,
  setAnalog,
  setButton,
  type PadRow,
  ANALOG_NONE,
} from '../input/padconfig.ts';
import { setPadFeedPaused, type PadSample } from '../input/padinput.ts';
import { drawGameText } from './gametext.ts';
import { drawTextWindow, drawWindowTitle, INSET, listKey, listWindowHeight, ROW, TITLE_GAP, type ListItem } from './fieldwindows.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';

export const LIST_RECT = { x: 100, y: 60, w: 440 } as const;
export const MESSAGE_RECT = { x: 10, y: 434, w: 620 } as const;
export const TITLE_TEXT = 0x11; // unitxt group 0 "Pad Button Config"
export const KEY_COLUMN = 220; // ASSUMED: the caption's offset inside the rows

// unitxt group 0 messages (the exe's strings, read with newserv's unitxt_e).
const MSG_SELECT = 0x4b; // "Please select item to change."
const MSG_NOT_CHANGEABLE = 0x4c; // "This item is not changable."
const MSG_INTERCHANGED = 0x4e; // "Setup interchanged."

export interface PadConfigEnv {
  text: (group: number, index: number) => string;
  // The saved config (00E7), or null: the window starts from the default.
  load: () => Uint8Array | null;
  // The window closed: the config goes live and is sent to the server.
  commit: (cfg: Uint8Array) => void;
  // The connected pad's state now (null without a pad).
  pad: () => PadSample | null;
  // Option 0x800000 (the 5 / 6 swap of the labels and values).
  swap56: () => boolean;
}

type Stage = 'items' | 'wait';

export class PadConfigMenu {
  private readonly env: PadConfigEnv;
  // The working copy (the exe edits the live block; committed on close).
  private readonly cfg: Uint8Array;
  private readonly list = { cursor: 0 };
  private stage: Stage = 'items';
  private msg: number | null = MSG_SELECT;
  private closed = false;
  // The pad state the wait compares against (rising edges count).
  private prev: PadSample | null = null;

  constructor(env: PadConfigEnv) {
    this.env = env;
    this.cfg = normalizePadConfig(env.load());
    // The keyboard is off while the window is open (the exe's disable_keyboard_controls).
    setPadFeedPaused(true);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // The control a row edits (the swap of 5 and 6 with option 0x800000).
  private controlOf(row: PadRow): number {
    if (row.analog) return -1;
    if (this.env.swap56()) {
      if (row.index === 5) return 6;
      if (row.index === 6) return 5;
    }
    return row.index;
  }

  private labelOf(row: PadRow): string {
    // Controls 5 and 6 read the next label with option 0x800000 (65, 67).
    const shift = !row.analog && (row.index === 5 || row.index === 6) && this.env.swap56() ? 1 : 0;
    return this.env.text(0, row.label + shift);
  }

  // The bound value's name of a row ('' when the value is not in the table).
  private captionOf(row: PadRow): string {
    if (row.analog) return analogName(this.cfg[row.index]);
    return buttonName(buttonOf(this.cfg, this.controlOf(row)));
  }

  private items(): ListItem[] {
    return PAD_ROWS.map((r, i) => ({ label: this.labelOf(r), value: i, enabled: true }));
  }

  // False when the window closed (Cancel on the list).
  key(e: KeyboardEvent): boolean {
    if (this.closed) return false;
    if (this.stage === 'items') {
      const items = this.items();
      const r = listKey(e, items, this.list);
      if (r === 'cancel') {
        se(SE.cancel);
        this.close();
        return false;
      }
      if (r === 'move') {
        this.msg = MSG_SELECT;
        se(SE.cursor);
      } else if (r === 'decide') {
        this.stage = 'wait';
        this.prev = this.env.pad();
      }
      return true;
    }
    // wait: Backspace / Escape leave it; Delete clears the row.
    const k = e.key.toLowerCase();
    if (k === 'backspace' || k === 'escape') {
      se(SE.cancel);
      this.stage = 'items';
      return true;
    }
    if (k === 'delete') this.clearRow();
    return true;
  }

  // The exe's Delete branch: an analog row goes to none; a control that must
  // stay bound is refused (0x4C), any other control is cleared.
  private clearRow(): void {
    const row = PAD_ROWS[this.list.cursor];
    if (row.analog) {
      setAnalog(this.cfg, row.index, ANALOG_NONE);
      se(SE.ok);
    } else {
      const c = this.controlOf(row);
      if (MUST_BIND.has(c)) {
        this.msg = MSG_NOT_CHANGEABLE;
        se(SE.buzzer);
      } else {
        setButton(this.cfg, c, 0);
        se(SE.ok);
      }
    }
    this.stage = 'items';
  }

  // Once a frame while waiting: the first rising pad input is set on the row.
  tick(): void {
    if (this.closed || this.stage !== 'wait') return;
    const s = this.env.pad();
    if (!s) {
      this.prev = null;
      return;
    }
    const before: Pick<PadSample, 'buttons' | 'analog'> = this.prev ?? { buttons: 0, analog: [] };
    this.prev = s;
    const row = PAD_ROWS[this.list.cursor];
    if (row.analog) {
      const code = s.analog.find((a) => !before.analog.includes(a));
      if (code !== undefined) this.assignAnalog(row.index, code);
      return;
    }
    const risen = (s.buttons & ~before.buttons) >>> 0;
    if (!risen) return;
    const hit = PAD_BUTTON_NAMES.find(([v]) => v !== 0 && (risen & v) !== 0);
    if (hit) this.assignButton(row, hit[0]);
  }

  // UpdatePadConfigMenu: an analog code on another analog row (either side of
  // the same axis) takes this row's old code (the swap, 0x4E).
  private assignAnalog(rowIndex: number, code: number): void {
    const old = this.cfg[rowIndex];
    for (let k = 0; k < 4; k++) {
      const b = this.cfg[k];
      if (code === b || code === analogOpposite(b)) {
        this.cfg[k] = old;
        this.msg = MSG_INTERCHANGED;
        break;
      }
    }
    setAnalog(this.cfg, rowIndex, code);
    se(SE.ok);
    this.stage = 'items';
  }

  // UpdatePadConfigMenu: a button already held by a control takes this row's
  // old button (0x4E); with no old button, that control is cleared unless it
  // must stay bound (0x4C, refused).
  private assignButton(row: PadRow, v: number): void {
    const c = this.controlOf(row);
    const old = buttonOf(this.cfg, c);
    let owner = -1;
    for (let u = 0; u < CONTROL_COUNT; u++) {
      if (buttonOf(this.cfg, u) === v) {
        owner = u;
        break;
      }
    }
    if (owner >= 0) {
      if (old !== 0) {
        setButton(this.cfg, owner, old);
        this.msg = MSG_INTERCHANGED;
      } else if (MUST_BIND.has(owner)) {
        this.msg = MSG_NOT_CHANGEABLE;
        se(SE.buzzer);
        this.stage = 'items';
        return;
      } else {
        setButton(this.cfg, owner, 0);
        this.msg = MSG_INTERCHANGED;
      }
    }
    setButton(this.cfg, c, v);
    se(SE.ok);
    this.stage = 'items';
  }

  // SetPadConfigDwordValue / the destructor: commit and send, always.
  private close(): void {
    if (this.closed) return;
    this.closed = true;
    setPadFeedPaused(false);
    this.env.commit(this.cfg.slice());
  }

  dispose(): void {
    this.close();
  }

  // The config as it is now (a copy; tests and the commit read it).
  current(): Uint8Array {
    return this.cfg.slice();
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    const L = LIST_RECT;
    const rows = PAD_ROWS;
    const cursor = this.list.cursor;
    drawWindowFrame(ctx, skin.frame, L.x, L.y, L.w, listWindowHeight(rows.length, true));
    drawWindowTitle(ctx, skin, L.x, L.y, this.env.text(0, TITLE_TEXT));
    const cx = L.x + INSET;
    const cy = L.y + INSET + TITLE_GAP;
    if (this.stage === 'items') drawSelectBar(ctx, skin.bars, cx, cy + cursor * ROW, L.w - 2 * INSET, 16);
    rows.forEach((r, i) => {
      const y = cy + i * ROW + 1;
      const color = this.stage === 'items' && i === cursor ? '#ffc19a' : '#ffffff';
      drawGameText(ctx, this.labelOf(r), cx, y, color);
      drawGameText(ctx, this.captionOf(r), cx + KEY_COLUMN, y, color);
    });
    if (this.msg !== null) {
      const M = MESSAGE_RECT;
      drawTextWindow(ctx, skin, { x: M.x, y: M.y, w: M.w, h: listWindowHeight(1, false) }, this.env.text(0, this.msg));
    }
  }
}
