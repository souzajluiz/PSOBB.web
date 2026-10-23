// The Home menu's Trade Window (main menu entry 0x1a, player_menu_entry trade_invite_menu1
// in PsoBB.exe, Ephinea 1.25.13): the partner pick, the proposal, the trade window with
// the offers, the item list and the meseta amount, the confirm and cancel dialogs. The
// protocol (6xA6, D0..D4 and the state machine) is net/trade.ts; this file only draws
// the windows and turns keys into the session's actions.
//
// Decoded from the dump (Psobb.exe-05112026.c):
//   - handle_player_menu_select (700118), case trade_invite_menu1..3 (26..28): the
//     window is QuickMenuWindow_Constructor_0075e958 (732354), whose process is
//     QuickMenuWindow_Process_0075e9f0 (732386):
//       state 0/1: the partner list at get_gui_position(0x5d) = (13, 256), title
//         unitxt(11, 0x32), 4 rows: the other players in the game (slots 0..3, not self,
//         invincibility 6 / 3 excluded), unitxt(11, 0xf1) greyed when none (0x5d list,
//         NOT the 0x61 list: 0x61 belongs to the quick menu's trade state 0x14 in
//         ProcessState_0075f09c, reached from the quick menu, not from the Home menu);
//       state 3: the chosen partner -> state 4: the confirm list at get_gui_position(0x5e)
//         = (239, 256), its text is the partner's name + unitxt(11, 0xf6), one row;
//       state 5: QuickMenuWindow_SendTradeRequest_008261e4 (the proposal, what 0), the
//         same window kept, state 6: cancel (ProcessTradeState_00825b4c) -> state 1.
//   - QuickMenuWindow_CreateTradeWindow_00760468 (733662): the trade window at
//     get_gui_position(0x60) = (341, 318), title unitxt(11, 0x3b), built with
//     CreateNumericDisplayListWindow_00728ac4 (692115).
//   - QuickMenuWindow_CreateConfirmationDialog_00760684 (733773): the confirm dialog at
//     get_gui_position(0x62) = (341, 256), title unitxt(11, 0x33), text unitxt(11, 0x105),
//     the cursor on No (SetSelectedIndex 1). HandleTradeConfirm_007606d0 shows the
//     trade's confirm message (QuickMenuWindow_ConstructTradeConfirmMessage_00826df0),
//     HandleTradeCancel_007606e4 the cancel question unitxt(11, 0x116); both are Yes / No
//     (YesNoListMenu_CreateListItem_0075ef80).
//   - unitxt(11, 0xfc) / 0xfb / 0x102 / 0xfd / 0xfe are the quick menu's player list
//     (QuickMenuWindow_CreatePlayerList_007605dc, 0x61): not used by the Home menu leaf.
//
// ASSUMED (see the DEVLOG entry 2026-10-23 "trade window"):
//   - the keys: Enter opens the item list from the window (the exe's slot list), Space
//     the confirm dialog, Backspace / Escape the cancel question (the exe's key indices
//     are not traced here);
//   - the first Yes of the confirm dialog holds the first confirm (flag 0x10) until the
//     session has sent it (exe TransitionTradeState_00825bf0 cancels a release before
//     30 frames; the port keeps the button down itself), the second Yes the second;
//   - the accept prompt (a partner's proposal) is the partner's name + unitxt(11, 0xf6)
//     with Yes / No (the exe's trade_invite_menu2/3 window is not traced);
//   - the offer lines of the trade window are plain text lines (the exe's numeric
//     display list rows are not traced); the amount is a spinner (AmountSpinner) in a
//     box at (341, 256);
//   - the notice (the session's TRADE_TEXT) is drawn in that same box when no other
//     dialog is up.

import { se, SE } from '../audio/se.ts';
import { AmountSpinner, spinnerKeyDown, spinnerKeyUp, type ItemRow } from './itempack.ts';
import { drawListWindow, INSET, listKey, type ListItem } from './fieldwindows.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import type { MenuKey } from './gamelist.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';
import { Question } from './teammenu.ts';
import { MESETA_ITEM_ID } from '../net/items.ts';
import { TRADE_FLAG, TRADE_MESETA_ID, TRADE_NO_PARTNER, TRADE_STATUS, type TradeSession } from '../net/trade.ts';

// Position table entries (0x00971f40 + 8 * index, read with tools/exedata.py).
export const TRADE_POS = {
  partner: { x: 13, y: 256 }, // 0x5d
  ask: { x: 239, y: 256 }, // 0x5e
  window: { x: 341, y: 318 }, // 0x60
  dialog: { x: 341, y: 256 }, // 0x62
} as const;

// unitxt group 11 indices of the Trade Window.
export const T11_TRADE = {
  partnerTitle: 0x32,
  nobody: 0xf1,
  propose: 0xf6,
  windowTitle: 0x3b,
  dialogTitle: 0x33,
  confirm: 0x105,
  cancel: 0x116,
  yes: 0x6e,
  no: 0x6f,
} as const;

// The width of the confirm and amount boxes (ASSUMED: the guild card's 282 for the dialog).
const DIALOG_WIDTH = 282;

export type TradePhase = 'partner' | 'ask' | 'waiting' | 'accept' | 'window' | 'items' | 'amount' | 'confirm' | 'cancel' | 'closed';

export interface TradeEnv {
  session: TradeSession;
  // unitxt (group, index), language markers removed.
  text: (group: number, index: number) => string;
  // The other players of the game the list offers (exe: slots 0..3 except self).
  partners(): { id: number; name: string }[];
  // The local item rows (itempack.ts ItemRow, the meseta row last) for the item list.
  rows(): ItemRow[];
  // The quantity of a local item (the stack); the meseta amount for TRADE_MESETA_ID.
  count(id: number): number;
  // The name of an item id, for the offer lines of both sides.
  itemName(id: number): string;
  // The character's meseta.
  meseta(): number;
}

function windowWidth(items: readonly ListItem[], title: string | null): number {
  const widest = Math.max(0, ...items.map((i) => gameTextWidth(i.label)), title ? gameTextWidth(title) : 0);
  return widest + 2 * INSET;
}

export class TradeMenu {
  phase: TradePhase;
  // The last notice of the session (a TRADE_TEXT), drawn until another dialog opens.
  notice: string | null = null;
  private readonly env: TradeEnv;
  private partnerRows: ListItem[] = [];
  private readonly partnerState = { cursor: 0 };
  private target = TRADE_NO_PARTNER;
  private itemRows: ItemRow[] = [];
  private readonly itemState = { cursor: 0 };
  private spinner: AmountSpinner | null = null;
  private spinnerId = -1;
  private question: Question | null = null;
  // The confirm is held by the window (see ASSUMED above): the flag it set.
  private holding = 0;

  constructor(env: TradeEnv) {
    this.env = env;
    this.phase = env.session.status === TRADE_STATUS.requested ? 'accept' : 'partner';
    if (this.phase === 'accept') this.openAccept();
    else this.buildPartners();
  }

  get open(): boolean {
    return this.phase !== 'closed';
  }

  private text(i: number): string {
    return this.env.text(0x0b, i);
  }

  private buildPartners(): void {
    const list = this.env.partners();
    this.partnerRows = list.length
      ? list.map((p) => ({ label: p.name, value: p.id, enabled: true }))
      : [{ label: this.text(T11_TRADE.nobody), value: -1, enabled: false }];
    if (this.partnerState.cursor >= this.partnerRows.length) this.partnerState.cursor = 0;
  }

  private partnerName(id: number): string {
    return this.env.partners().find((p) => p.id === id)?.name ?? '';
  }

  private openAccept(): void {
    this.target = this.env.session.partner;
    this.question = new Question(this.partnerName(this.target) + this.text(T11_TRADE.propose), {
      x: TRADE_POS.ask.x,
      y: TRADE_POS.ask.y,
      w: DIALOG_WIDTH,
    });
    this.phase = 'accept';
  }

  private openWindow(): void {
    this.phase = 'window';
    this.notice = null;
  }

  private openItems(): void {
    this.itemRows = this.env.rows();
    this.itemState.cursor = 0;
    this.phase = 'items';
  }

  private openDialog(kind: 'confirm' | 'cancel'): void {
    this.question = new Question(this.text(kind === 'confirm' ? T11_TRADE.confirm : T11_TRADE.cancel), {
      x: TRADE_POS.dialog.x,
      y: TRADE_POS.dialog.y,
      w: DIALOG_WIDTH,
    });
    this.phase = kind;
  }

  // The session's state moved on (called each frame by the host, before draw).
  tick(): void {
    const s = this.env.session;
    if (this.spinner) this.spinner.frame();
    // The button the window holds is released once the session has sent its confirm.
    if (this.holding === TRADE_FLAG.confirm1Pressed && s.flags & TRADE_FLAG.confirm1Sent) {
      s.setConfirm1(false);
      this.holding = 0;
    } else if (this.holding === TRADE_FLAG.confirm2Pressed && s.flags & TRADE_FLAG.confirm2Sent) {
      s.setConfirm2(false);
      this.holding = 0;
    }
    switch (this.phase) {
      case 'partner':
        if (s.status === TRADE_STATUS.open) this.openWindow();
        else if (s.status === TRADE_STATUS.requested) this.openAccept();
        break;
      case 'ask':
      case 'waiting':
        if (s.status === TRADE_STATUS.open) this.openWindow();
        else if (this.phase === 'waiting' && s.status === TRADE_STATUS.none) this.phase = 'partner';
        break;
      case 'accept':
        if (s.status === TRADE_STATUS.none) this.closeWith(null);
        break;
      case 'closed':
        break;
      default:
        if (s.status === TRADE_STATUS.none) this.closeWith(null);
        break;
    }
  }

  // Shows a session notice (a TRADE_TEXT id) from the host; the window draws it.
  notify(textId: number): void {
    this.notice = this.text(textId);
  }

  private closeWith(notice: string | null): void {
    this.notice = notice;
    this.phase = 'closed';
  }

  // One key (the Home menu's leaf keys). Returns false when the window closed.
  key(e: MenuKey): boolean {
    switch (this.phase) {
      case 'partner':
        return this.partnerKey(e);
      case 'ask':
        return this.askKey(e);
      case 'waiting':
        if (e.key === 'Backspace' || e.key === 'Escape') {
          this.env.session.cancel();
          this.phase = 'partner';
          se(SE.cancel);
        }
        return true;
      case 'accept':
        return this.acceptKey(e);
      case 'window':
        return this.windowKey(e);
      case 'items':
        return this.itemsKey(e);
      case 'amount':
        return this.amountKey(e);
      case 'confirm':
        return this.dialogKey(
          e,
          () => {
            this.confirmYes();
            this.openWindow();
          },
          () => this.openWindow(),
        );
      case 'cancel':
        return this.dialogKey(e, () => {
          this.env.session.cancel();
          this.closeWith(null);
        }, () => this.openWindow());
      default:
        return false;
    }
  }

  keyUp(e: KeyboardEvent): void {
    if (this.spinner) spinnerKeyUp(this.spinner, e);
  }

  private partnerKey(e: MenuKey): boolean {
    const r = listKey(e, this.partnerRows, this.partnerState);
    if (r === 'cancel') {
      this.closeWith(null);
      return false;
    }
    if (r !== 'decide') return true;
    const row = this.partnerRows[this.partnerState.cursor]!;
    this.target = row.value;
    this.phase = 'ask';
    return true;
  }

  private askKey(e: MenuKey): boolean {
    if (e.key === 'Enter') {
      const s = this.env.session;
      if (s.propose(this.target, 0)) {
        this.phase = 'waiting';
        se(SE.ok);
      }
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      this.phase = 'partner';
      se(SE.cancel);
    }
    return true;
  }

  private acceptKey(e: MenuKey): boolean {
    const q = this.question;
    if (!q) return true;
    q.key(e);
    if (!q.result) return true;
    if (q.result === 'yes') {
      if (this.env.session.accept(0)) this.openWindow();
      else this.closeWith(null);
    } else {
      this.env.session.reject();
      this.closeWith(null);
    }
    return this.phase !== 'closed';
  }

  private windowKey(e: MenuKey): boolean {
    if (e.key === 'Enter') {
      this.openItems();
      se(SE.ok);
    } else if (e.key === ' ') {
      this.openDialog('confirm');
      se(SE.ok);
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      this.openDialog('cancel');
      se(SE.cancel);
    }
    return true;
  }

  private itemsKey(e: MenuKey): boolean {
    const items = this.itemListItems();
    const r = listKey(e, items, this.itemState);
    if (r === 'cancel') {
      this.openWindow();
      return true;
    }
    if (r !== 'decide') return true;
    const row = this.itemRows[this.itemState.cursor]!;
    const meseta = row.id === MESETA_ITEM_ID;
    const max = meseta ? this.env.meseta() : this.env.count(row.id);
    this.spinnerId = meseta ? TRADE_MESETA_ID : row.id;
    this.spinner = new AmountSpinner(Math.max(1, max));
    this.phase = 'amount';
    return true;
  }

  private itemListItems(): ListItem[] {
    return this.itemRows.map((r, i) => ({ label: `${r.name}  ${r.count}`, value: i, enabled: true }));
  }

  private amountKey(e: MenuKey): boolean {
    const a = this.spinner;
    if (!a) {
      this.phase = 'items';
      return true;
    }
    if (e.key === 'Enter') {
      this.offer(this.spinnerId, a.value);
      this.spinner = null;
      this.phase = 'window';
      se(SE.ok);
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Escape') {
      this.spinner = null;
      this.phase = 'items';
      se(SE.cancel);
      return true;
    }
    // Arrow keys step the spinner (the Item Pack's key routing, spinnerKeyDown).
    spinnerKeyDown(a, e as KeyboardEvent);
    return true;
  }

  // what 1 when the item is already offered (quantity), what 2 for a new offer.
  private offer(itemId: number, amount: number): void {
    const s = this.env.session;
    if (s.local.some((o) => o.itemId === itemId)) s.offerQuantity(itemId, amount);
    else s.offerItem(itemId, amount);
  }

  private confirmYes(): void {
    const s = this.env.session;
    if (!(s.flags & TRADE_FLAG.confirm1Sent)) {
      s.setConfirm1(true);
      this.holding = TRADE_FLAG.confirm1Pressed;
    } else {
      s.setConfirm2(true);
      this.holding = TRADE_FLAG.confirm2Pressed;
    }
  }

  // The Yes / No dialogs: Yes -> onYes, No / cancel -> onNo.
  private dialogKey(e: MenuKey, onYes: () => void, onNo: () => void): boolean {
    const q = this.question;
    if (!q) {
      onNo();
      return true;
    }
    q.key(e);
    if (!q.result) return true;
    this.question = null;
    if (q.result === 'yes') onYes();
    else onNo();
    return this.phase !== 'closed';
  }

  // Offers and partner lines of the trade window (both sides, the exe's two lists).
  private windowLines(): ListItem[] {
    const s = this.env.session;
    const lines: ListItem[] = [];
    for (const o of [...s.local, ...s.remote]) {
      if (o.itemId !== -1) lines.push({ label: `${this.env.itemName(o.itemId)}  x${o.amount}`, value: -1, enabled: false });
    }
    return lines;
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    const pos = TRADE_POS;
    if (this.phase === 'partner') {
      const title = this.text(T11_TRADE.partnerTitle);
      drawListWindow(ctx, skin, pos.partner.x, pos.partner.y, windowWidth(this.partnerRows, title), title, this.partnerRows, this.partnerState.cursor, true);
    }
    if (this.phase === 'ask' || this.phase === 'waiting') {
      const label = this.partnerName(this.target) + this.text(T11_TRADE.propose);
      const items: ListItem[] = [{ label, value: 0, enabled: true }];
      drawListWindow(ctx, skin, pos.ask.x, pos.ask.y, windowWidth(items, null), null, items, 0, this.phase === 'ask');
    }
    if (this.phase === 'accept' && this.question) {
      this.question.draw(ctx, skin, this.text(T11_TRADE.yes), this.text(T11_TRADE.no));
    }
    if (this.phase === 'window' || this.phase === 'items' || this.phase === 'amount' || this.phase === 'confirm' || this.phase === 'cancel') {
      const title = this.text(T11_TRADE.windowTitle);
      const lines = this.windowLines();
      drawListWindow(ctx, skin, pos.window.x, pos.window.y, windowWidth(lines, title), title, lines, 0, false);
    }
    if (this.phase === 'items') {
      const title = this.text(T11_TRADE.windowTitle);
      const items = this.itemListItems();
      drawListWindow(ctx, skin, pos.window.x, pos.window.y, windowWidth(items, title), title, items, this.itemState.cursor, true);
    }
    if (this.phase === 'amount' && this.spinner) {
      const d = pos.dialog;
      drawWindowFrame(ctx, skin.frame, d.x, d.y, DIALOG_WIDTH, 34);
      drawGameText(ctx, String(this.spinner.value), d.x + INSET, d.y + INSET + 1);
    }
    if ((this.phase === 'confirm' || this.phase === 'cancel') && this.question) {
      this.question.draw(ctx, skin, this.text(T11_TRADE.yes), this.text(T11_TRADE.no));
    }
    if (this.notice && (this.phase === 'partner' || this.phase === 'window' || this.phase === 'closed')) {
      const d = pos.dialog;
      drawWindowFrame(ctx, skin.frame, d.x, d.y, DIALOG_WIDTH, 34);
      drawGameText(ctx, this.notice, d.x + INSET, d.y + INSET + 1);
    }
  }
}
