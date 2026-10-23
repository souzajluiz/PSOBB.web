// Main menu > Options (id 6) as PsoBB.exe (Ephinea 1.25.13) runs it:
// handle_player_menu_select case options_menu ->
// ChallengePlayerListWindow_Initialize_007536f4 (vtable 0x00b42598, state
// machine ChallengePlayerListWindow_Process_007538ec).
//
// The option list (create_list_items_for_menu_options): a titled list window
// (CreateListWindowObject_0073566c, 11 rows) at position table entry 0x16 =
// (13, 256), titled unitxt 11 [0x3D] "Options", 195 wide
// (ListWindowObject_UpdateScrollPosition_00736138(195.0)), items centred.
// Rows and their values (ListWindowObject_AddListItem_00735c90):
//   0 Map Direction [11:0x79]       1 Function Key Setting [0:6]
//   2 Keyboard Controls [0:9]       3 Mouse Controls [0:10]
//   4 Pad Button Config [0:0x11]    (ListWindowObject_AddListItem_00735ee0,
//                                    flags 6, greyed when there is no pad:
//                                    get_num_dinput_controllers() == 0)
//   5 Keyboard Config [0:0]         6 Cursor Position [11:0x7B]
//   7 Message Speed [11:0x7C]       9 Auto Disconnect [11:0x81]
//   10 Brightness [11:0x82]
// Value 8 (Vibration [11:0x7D]) has a settings case but no row. There is no
// sound / BGM volume here: the client takes those from the launcher's
// registry settings only.
//
// Deciding a row (state 3) opens its settings window
// (ChallengePlayerListWindow_CreateSettingsMenu_00753d84): the Ship Select
// list window class (CreatePlayerListObject_00714ac8 -> 0x00736988, vtable
// 0x00b3f4f0) at entry 0x17 = (210, 256), 302 x 148
// (g_ChallengeListWindowSettingsAlignment 0x00973f18), titled with the row's
// label, one item per choice (ChatShortcutMenu_AddListItem_00714d34):
//   - the cursor and the chosen value (+0x88 / +0x94) start on the current
//     setting (ChatShortcutMenuListWindow_Update_00714e5c);
//   - each item draws the icon +0x1D of f256_hyouji texture 1 (0x00970b40):
//     0x14 on the chosen value, 0x15 on the others (ListWindowObject_SetText
//     _0072c548, ChatShortcutMenuYesNoWindow_ResetListItems_007379e4), then
//     its text: the item's x is -18 (0xc1900000) and three 18 px icon slots
//     come before the text (BaseEntity_Render_0072ae74), so the icon sits
//     where Ship Select's text starts and the text 18 px to its right;
//   - keys (ChatShortcutMenuYesNoWindow_Update_00714ba8): up / down move and
//     wrap (SE 0x56F), Decide makes the cursor the chosen value (SE 0x570)
//     and closes it, Cancel closes it unchanged (SE 0x585).
// While it is open the chosen value is written every frame
// (ChallengePlayerListWindow_ApplySelectedSetting_00753c70) into the
// session's character option word (SessionData_SetCharacterOptionBitfield
// _007be17c = PSOBBCharacterFile option_flags, +0x4EC):
//   0 Map Direction     bit 0x00000001  Fixed / Non-fixed [11:0x83..0x84]
//   1 Function Key      bit 0x02000000  Menu / Chat Shortcuts [0:7..8]
//   2 Keyboard Controls bit 0x01000000  ON / OFF [11:0xC4..0xC5]
//   3 Mouse Controls    0x00700000 >> 20  OFF / DRAG / HOLD [0:0xB..0xD]
//                       (also SetMouseControlsSetting_00708a58)
//   6 Cursor Position   bit 0x00000004  Saved / Non-Saved [11:0x87..0x88]
//   7 Message Speed     0x00000300 >> 8  Slow / Normal / Fast / Very Fast
//                       [11:0x89..0x8C] (the list windows' speed,
//                       classic/windowanim.ts)
//   9 Auto Disconnect   0x00001C00 >> 10  15 / 30 / 45 / 60 minutes
//                       [11:0x8D..0x90]
//   10 Brightness       not in the option word: SetExternalSettingsFlag
//                       (0..4, "+2 level" .. "-2 level" [11:0x92..0x96]);
//                       when the window closes UpdateExternalSettings adds
//                       {32, 16, 0, -16, -32}[i] << 8 (0x009006e0) to the
//                       16-bit gamma ramp (UpdateGammaRamp_00837818) and
//                       ResetExternalSettings stores it in the registry.
// Pad Button Config (4) opens a "Custom" / "Return to default" list and
// Keyboard Config (5) opens the key config window (classic/keyconfig.ts); the
// Pad Button Config list is not ported.
// Cancel on the option list returns to the main menu. When the window is
// destroyed after any row was decided (+0x24), the client sends the option
// word to the server (ChallengePlayerListWindow_Destructor_00753624 ->
// send_packet0xed_subcommand1: command 0x01ED, flag 0, u32 option_flags;
// newserv on_ED_BB stores it in the character file).

import { menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import { drawGameText } from './gametext.ts';
import { drawListWindow, drawWindowTitle, INSET, listKey, ROW, SELECTED, TITLE_GAP, type ListItem } from './fieldwindows.ts';
import { anchorX } from './ingame.ts';
import { drawIcon } from './itempack.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';
import { KeyConfigMenu, type KeyConfigEnv } from './keyconfig.ts';
import { applyKeyConfig, keyConfigFromCharacter, writeKeyConfigToCharacter } from '../input/keyconfig.ts';
import { wipeElement, WindowAnim, withElementWipe, withWindowAnim } from './windowanim.ts';

export const OPTIONS_LIST = { x: 13, y: 256, w: 195 } as const; // entry 0x16, 195.0
export const SETTINGS_RECT = { x: 210, y: 256, w: 302, h: 148 } as const; // entry 0x17, 0x00973f18
export const ICON_CHOSEN = 0x14;
export const ICON_OTHER = 0x15;
const ICON = 18; // 0x00970d98

// The option word of a character created by the client / newserv.
export const DEFAULT_OPTION_FLAGS = 0x00040058;
export const OPTION_FLAGS_OFFSET = 0x4ec; // PSOBBCharacterFile option_flags
export const OPTION_FLAGS_COMMAND = 0x01ed; // send_packet0xed_subcommand1

type Text = readonly [group: number, index: number];

// Where a row's value lives.
export type OptionField =
  | { kind: 'bits'; mask: number; shift: number } // the character option word
  | { kind: 'brightness' } // SetExternalSettingsFlag
  | { kind: 'padConfig' } // not ported
  | { kind: 'keyConfig' }; // classic/keyconfig.ts (env.keyConfig)

export interface OptionRow {
  value: number; // the list item's value (the switch case)
  label: Text;
  choices: readonly Text[];
  field: OptionField;
}

const bits = (mask: number): OptionField => ({ kind: 'bits', mask, shift: Math.log2(mask & -mask) });

// create_list_items_for_menu_options + ChallengePlayerListWindow_CreateSettingsMenu_00753d84.
export const OPTION_ROWS: readonly OptionRow[] = [
  { value: 0, label: [11, 0x79], choices: [[11, 0x83], [11, 0x84]], field: bits(0x1) },
  { value: 1, label: [0, 6], choices: [[0, 7], [0, 8]], field: bits(0x2000000) },
  { value: 2, label: [0, 9], choices: [[11, 0xc4], [11, 0xc5]], field: bits(0x1000000) },
  { value: 3, label: [0, 10], choices: [[0, 0xb], [0, 0xc], [0, 0xd]], field: bits(0x700000) },
  { value: 4, label: [0, 0x11], choices: [], field: { kind: 'padConfig' } },
  { value: 5, label: [0, 0], choices: [], field: { kind: 'keyConfig' } },
  { value: 6, label: [11, 0x7b], choices: [[11, 0x87], [11, 0x88]], field: bits(0x4) },
  { value: 7, label: [11, 0x7c], choices: [[11, 0x89], [11, 0x8a], [11, 0x8b], [11, 0x8c]], field: bits(0x300) },
  { value: 9, label: [11, 0x81], choices: [[11, 0x8d], [11, 0x8e], [11, 0x8f], [11, 0x90]], field: bits(0x1c00) },
  { value: 10, label: [11, 0x82], choices: [[11, 0x92], [11, 0x93], [11, 0x94], [11, 0x95], [11, 0x96]], field: { kind: 'brightness' } },
];

// The current value of a bit field (get_character_option /
// GetCharacterOptionsBitfield_007be1d0 / _007be210 / _007be250). Without
// session data every getter returns 0, except the message speed (1).
export function optionValue(flags: number | null, field: Extract<OptionField, { kind: 'bits' }>): number {
  if (flags === null) return field.mask === 0x300 ? 1 : 0;
  return (flags & field.mask) >>> field.shift;
}

// SessionData_SetCharacterOptionBitfield_007be17c: word & ~mask | value << shift.
export function withOptionValue(flags: number, field: Extract<OptionField, { kind: 'bits' }>, value: number): number {
  return ((flags & ~field.mask) | ((value << field.shift) & field.mask)) >>> 0;
}

// Cursor Position (bit 4): the main menu remembers its cursor while clear
// ("Saved", ChallengeMenuObject_UpdateMenuIndexFromCharacterOption_007332f8).
export function cursorSaved(flags: number | null): boolean {
  return flags === null || (flags & 0x4) === 0;
}

// Command 0x04ED (send_packet0xed_subcommand4): the 364-byte key config.
export const KEY_CONFIG_COMMAND = 0x04ed;

// The body of command 0x01ED (C_UpdateOptionFlags_BB_01ED).
export function optionFlagsPayload(flags: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, flags >>> 0, true);
  return b;
}

// Reads / writes option_flags of a full character (00E7 data).
export function readOptionFlags(full: Uint8Array | null): number | null {
  if (!full || full.length < OPTION_FLAGS_OFFSET + 4) return null;
  return new DataView(full.buffer, full.byteOffset, full.length).getUint32(OPTION_FLAGS_OFFSET, true);
}

export function writeOptionFlags(full: Uint8Array | null, flags: number): void {
  if (!full || full.length < OPTION_FLAGS_OFFSET + 4) return;
  new DataView(full.buffer, full.byteOffset, full.length).setUint32(OPTION_FLAGS_OFFSET, flags >>> 0, true);
}

// --- brightness ---------------------------------------------------------------

export const BRIGHTNESS_SHIFT = [32, 16, 0, -16, -32] as const; // 0x009006e0
export const BRIGHTNESS_DEFAULT = 2; // set_default_graphics_settings
const BRIGHTNESS_KEY = 'psobb.brightness';
const FILTER_ID = 'psobb-brightness';
const STYLE_ID = 'psobb-brightness-style';

// SetExternalSettingsFlag: values above 3 become 4.
export function clampBrightness(i: number): number {
  return i > 3 ? 4 : Math.max(0, Math.trunc(i));
}

// The ramp offset of UpdateGammaRamp_00837818 on a 0..1 scale.
export function brightnessOffset(i: number): number {
  return (BRIGHTNESS_SHIFT[clampBrightness(i)] << 8) / 0xffff;
}

let brightness = BRIGHTNESS_DEFAULT;

export function getBrightness(): number {
  return brightness;
}

// A stored brightness: only a whole number 0..4, else the default.
export function parseBrightness(v: string | null | undefined): number {
  if (v === null || v === undefined || !/^\s*\d+\s*$/.test(v)) return BRIGHTNESS_DEFAULT;
  const n = Number(v);
  return Number.isFinite(n) && n <= 4 ? n : BRIGHTNESS_DEFAULT;
}

// The registry value (here localStorage), read once at start-up.
export function restoreBrightness(): void {
  let v: string | null | undefined = null;
  try {
    v = globalThis.localStorage?.getItem(BRIGHTNESS_KEY);
  } catch {
    // no storage
  }
  brightness = parseBrightness(v);
  applyBrightness();
}

export function setBrightness(i: number): void {
  brightness = clampBrightness(i);
}

// UpdateExternalSettings + ResetExternalSettings: applies the offset to every
// canvas of the page (the exe's gamma ramp is the whole screen; a filter on
// a canvas has no descendants to re-anchor, unlike one on body) and stores
// it. ASSUMED: the ramp is the identity before the offset (the desktop's
// ramp).
export function applyBrightness(): void {
  try {
    globalThis.localStorage?.setItem(BRIGHTNESS_KEY, String(brightness));
  } catch {
    // no storage
  }
  if (typeof document === 'undefined') return;
  const off = brightnessOffset(brightness);
  let svg: Element | null = document.getElementById(FILTER_ID);
  if (!svg) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg = el;
    el.id = FILTER_ID;
    el.setAttribute('width', '0');
    el.setAttribute('height', '0');
    el.style.position = 'absolute';
    el.innerHTML =
      '<filter id="psobb-brightness-filter" color-interpolation-filters="sRGB"><feComponentTransfer>' +
      '<feFuncR type="linear" slope="1"/><feFuncG type="linear" slope="1"/><feFuncB type="linear" slope="1"/>' +
      '</feComponentTransfer></filter>';
    document.body.append(el);
  }
  svg.querySelectorAll('feFuncR, feFuncG, feFuncB').forEach((f) => f.setAttribute('intercept', String(off)));
  // A style rule rather than inline styles: it also covers canvases created later.
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = off ? 'canvas { filter: url(#psobb-brightness-filter); }' : '';
}

// --- the window ---------------------------------------------------------------

export interface OptionsEnv {
  text: (group: number, index: number) => string;
  // The session's option word (null: no session data).
  flags: () => number | null;
  setFlags: (flags: number) => void;
  // Sends command 0x01ED with the option word.
  send: (flags: number) => void;
  // get_num_dinput_controllers() != 0.
  padConnected: () => boolean;
  // Keyboard Config (row 5): the window's load / commit (absent: row 5 does nothing).
  keyConfig?: KeyConfigEnv;
}

interface SettingsWindow {
  row: OptionRow;
  items: ListItem[];
  cursor: number; // +0x88
  chosen: number; // +0x94
}

export class OptionsMenu {
  private env: OptionsEnv;
  private items: ListItem[];
  private list = { cursor: 0 };
  private settings: SettingsWindow | null = null;
  // Keyboard Config (row 5) while it is open.
  private keyWindow: KeyConfigMenu | null = null;
  private closing: SettingsWindow | null = null;
  // The settings window's own list window animation.
  readonly settingsAnim = new WindowAnim(false, false);
  // +0x24: a row was decided; the option word is sent on dispose.
  dirty = false;
  private frame = 0;

  constructor(env: OptionsEnv) {
    this.env = env;
    this.settingsAnim.se = (id) => se(id);
    this.items = OPTION_ROWS.map((r) => ({
      label: env.text(...r.label),
      value: r.value,
      enabled: r.field.kind !== 'padConfig' || env.padConnected(),
    }));
  }

  get cursor(): number {
    return this.list.cursor;
  }

  get open(): SettingsWindow | null {
    return this.settings;
  }

  private speed(): number {
    return WindowAnim.speedOf(this.env.flags() ?? undefined);
  }

  private currentValue(row: OptionRow): number {
    const f = row.field;
    if (f.kind === 'bits') return optionValue(this.env.flags(), f);
    if (f.kind === 'brightness') return getBrightness();
    return 0;
  }

  // False when the window closed (Cancel on the option list).
  key(e: KeyboardEvent): boolean {
    if (this.keyWindow) {
      if (!this.keyWindow.key(e)) this.keyWindow = null;
      return true;
    }
    const s = this.settings;
    if (s) {
      const n = s.items.length;
      if (menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') {
        s.cursor = (s.cursor + (menuKeyOf(e) === 'up' ? n - 1 : 1)) % n;
        se(SE.cursor);
      } else if (menuKeyOf(e) === 'decide') {
        // ChatShortcutMenuYesNoWindow_ConfirmSelection_00714d04.
        s.chosen = s.cursor;
        se(SE.ok);
        this.apply(s);
        this.closeSettings();
      } else if (menuKeyOf(e) === 'cancel') {
        se(SE.cancel);
        this.closeSettings();
      }
      return true;
    }
    switch (listKey(e, this.items, this.list)) {
      case 'cancel':
        return false;
      case 'decide': {
        this.dirty = true;
        const row = OPTION_ROWS[this.list.cursor];
        if (row.choices.length) this.openSettings(row);
        else if (row.field.kind === 'keyConfig' && this.env.keyConfig) this.keyWindow = new KeyConfigMenu(this.env.keyConfig);
        return true;
      }
      default:
        return true;
    }
  }

  private openSettings(row: OptionRow): void {
    const v = this.currentValue(row);
    this.settings = {
      row,
      items: row.choices.map((t, i) => ({ label: this.env.text(...t), value: i, enabled: true })),
      cursor: v,
      chosen: v,
    };
    this.closing = null;
    this.settingsAnim.open(this.speed());
  }

  // ChallengePlayerListWindow_ApplySelectedSetting_00753c70.
  private apply(s: SettingsWindow): void {
    const f = s.row.field;
    if (f.kind === 'bits') {
      const flags = this.env.flags();
      if (flags !== null) this.env.setFlags(withOptionValue(flags, f, s.chosen));
    } else if (f.kind === 'brightness') setBrightness(s.chosen);
  }

  // State 4 -> 1: the window closes; Brightness is applied and stored.
  private closeSettings(): void {
    const s = this.settings;
    if (!s) return;
    if (s.row.field.kind === 'brightness') applyBrightness();
    this.closing = s;
    this.settings = null;
    this.settingsAnim.close();
  }

  // ChallengePlayerListWindow_Destructor_00753624.
  dispose(): void {
    if (this.settings?.row.field.kind === 'brightness') applyBrightness();
    this.settings = null;
    if (this.keyWindow) this.keyWindow.dispose();
    this.keyWindow = null;
    if (!this.dirty) return;
    this.dirty = false;
    const flags = this.env.flags();
    if (flags === null) return;
    try {
      this.env.send(flags);
    } catch {
      // the connection is gone: newserv keeps the last word it got
    }
  }

  tick(): void {
    this.frame++;
    this.settingsAnim.tick(this.speed());
    if (!this.settingsAnim.visible) this.closing = null;
  }

  // `extra`: virtual width beyond 640 (the settings window is on the right half).
  // `wipe`: the leaf's opening animation (FieldMenu's leafAnim) for the list; the settings window has its own.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra = 0, wipe?: WindowAnim): void {
    // The key config window replaces the option list on screen (ASSUMED: the
    // two overlap, and the exe's list is not drawn under it).
    if (this.keyWindow) {
      this.keyWindow.draw(ctx, skin);
      return;
    }
    const L = OPTIONS_LIST;
    withElementWipe(wipe, L.x + INSET, L.y + INSET + TITLE_GAP, L.w - 2 * INSET, () =>
      drawListWindow(ctx, skin, L.x, L.y, L.w, this.env.text(11, 0x3d), this.items, this.list.cursor),
    );
    const s = this.settings ?? this.closing;
    if (!s) return;
    const R = SETTINGS_RECT;
    const x = anchorX(R.x, R.w, extra);
    withWindowAnim(ctx, this.settingsAnim, x, R.y, R.w, R.h, () => {
      drawWindowFrame(ctx, skin.frame, x, R.y, R.w, R.h);
      const cx = x + INSET;
      const cy = R.y + INSET + TITLE_GAP;
      withElementWipe(this.settingsAnim, cx, cy, R.w - 2 * INSET, () => {
        const bar = cy + s.cursor * ROW;
        wipeElement(ctx, cx, bar, 16, () => drawSelectBar(ctx, skin.bars, cx, bar, R.w - 2 * INSET, 16));
        s.items.forEach((it, i) => {
          const y = cy + i * ROW;
          wipeElement(ctx, cx, y, ICON, () => drawIcon(ctx, skin.frame, i === s.chosen ? ICON_CHOSEN : ICON_OTHER, cx, y, '#ffffff', this.frame));
          const tx = cx + ICON;
          wipeElement(ctx, tx, y + 1, ROW, () => drawGameText(ctx, it.label, tx, y + 1, i === s.cursor ? SELECTED : '#ffffff'));
        });
        drawWindowTitle(ctx, skin, x, R.y, this.env.text(...s.row.label));
      });
    });
  }
}

// An OptionsEnv over a session's full character data (00E7) and a sender.
export function characterOptionsEnv(
  text: OptionsEnv['text'],
  full: () => Uint8Array | null,
  send: (command: number, payload: Uint8Array) => void,
): OptionsEnv {
  return {
    text,
    flags: () => readOptionFlags(full()),
    setFlags: (f) => writeOptionFlags(full(), f),
    send: (f) => send(OPTION_FLAGS_COMMAND, optionFlagsPayload(f)),
    padConnected: () => {
      try {
        return (globalThis.navigator?.getGamepads?.() ?? []).some((p) => Boolean(p));
      } catch {
        return false;
      }
    },
    keyConfig: {
      text,
      // The saved config (00E7), or null: the window starts from the default.
      load: () => keyConfigFromCharacter(full()),
      // Closing the window: the config goes live, into the character record and to the server.
      commit: (cfg) => {
        writeKeyConfigToCharacter(full(), cfg);
        applyKeyConfig(cfg);
        try {
          send(KEY_CONFIG_COMMAND, cfg);
        } catch {
          // the connection is gone: the live config still applies
        }
      },
    },
  };
}
