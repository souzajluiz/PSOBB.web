// The word select picker window (classic): the list the picker is on (the root word type's rows,
// then the child list a row opened), the sentence being built as a preview under it, and the
// Select / Cancel keys. The state is WordSelectPickerModel (classic/wordselectmenu.ts), which traces
// the exe's list levels, the selection buffer and the root table. What is ASSUMED here is the layout
// (the exe's ListWindowEntity placement is not ported) and the title; see DEVLOG 2026-10-23.
//
// Keys: Up / Down move the cursor (the toggle effect runs on the child lists), Enter (decide) opens a
// row's list or accepts a word, Escape (cancel) pops the child list, and on the root it cancels the
// picker. The owner reads `open` and the model's status when the picker closes.

import { se, SE } from '../audio/se.ts';
import { menuKeyOf } from '../input/keyconfig.ts';
import { renderWordSelect, type WordSelectNames, type WordSelectTable } from '../net/wordselect.ts';
import { drawListWindow, drawTextWindow, listWindowHeight, type ListItem, type WindowRect } from './fieldwindows.ts';
import { WORD_SELECT_STATUS_OPEN, WordSelectPickerModel, wordSelectRowLabel } from './wordselectmenu.ts';
import type { WindowSkin } from './stage.ts';

// Where the window sits and how many rows show. The row count is the exe's
// word_select_number_of_selectable_rows (0x96E51C = 6.0, read with tools/exedata.py), which
// CreateWordSelectMenuEntity_00701d00 (dump 658278) passes to both WordSelectEntity lists. ASSUMED: the
// count is the visible rows. The position and width are ASSUMED (the exe's ListWindowEntity placement
// is not traced here); the title is the exe's "SELECT" string (u_SELECT, the pointer at 0x9D05C4).
export const WORD_SELECT_WINDOW = { x: 30, y: 60, w: 300, visible: 6, title: 'SELECT' } as const;

export class WordSelectWindow {
  readonly model: WordSelectPickerModel;
  private readonly names: WordSelectNames;
  private readonly table: WordSelectTable | null;
  // The first visible row of the current list.
  private top = 0;

  constructor(model: WordSelectPickerModel, names: WordSelectNames = () => '') {
    this.model = model;
    this.names = names;
    this.table = model.table;
  }

  // The picker is still open (not accepted and not cancelled).
  get open(): boolean {
    return this.model.status === WORD_SELECT_STATUS_OPEN;
  }

  private items(): ListItem[] {
    return this.model.rows.map((v) => ({
      label: wordSelectRowLabel(this.table, v, this.names),
      value: v,
      enabled: true,
    }));
  }

  private scroll(): void {
    const c = this.model.top.index;
    if (c < this.top) this.top = c;
    if (c >= this.top + WORD_SELECT_WINDOW.visible) this.top = c - WORD_SELECT_WINDOW.visible + 1;
  }

  // The keys for the picker. Returns true when a key was used.
  key(e: { key: string }): boolean {
    if (!this.open) return false;
    const k = menuKeyOf(e);
    if (k === 'up' || k === 'down') {
      if (this.model.rows.length === 0) return true;
      this.model.move(k === 'up' ? -1 : 1);
      this.scroll();
      se(SE.cursor);
      return true;
    }
    if (k === 'decide') {
      se(SE.ok);
      this.model.press();
      this.scroll();
      return true;
    }
    if (k === 'cancel') {
      se(SE.cancel);
      this.model.back();
      this.top = 0;
      this.scroll();
      return true;
    }
    return false;
  }

  // The sentence as the buffer holds it now (the model's result, not copied out).
  preview(): string {
    return renderWordSelect(this.model.result(), this.table, this.names);
  }

  // The list window, then the preview window under it.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): WindowRect | null {
    if (!this.open) return null;
    const all = this.items();
    const shown = all.slice(this.top, this.top + WORD_SELECT_WINDOW.visible);
    const list = drawListWindow(
      ctx,
      skin,
      WORD_SELECT_WINDOW.x,
      WORD_SELECT_WINDOW.y,
      WORD_SELECT_WINDOW.w,
      WORD_SELECT_WINDOW.title,
      shown,
      this.model.top.index - this.top,
    );
    const lines = this.preview().split('\n');
    const h = listWindowHeight(Math.max(1, lines.length), false);
    const rect = { x: list.x, y: list.y + list.h + 8, w: list.w, h };
    drawTextWindow(ctx, skin, rect, lines.join('\n'));
    return rect;
  }
}
