// The lobby Home menu's Simple Mail leaf (main menu entry 0x13): the top menu, the received
// mail list with its detail boxes and action menu, the guild card book picker, the compose
// keyboard with its send confirm, the answer service (on / off and the response text), and
// the delete confirm. The store, the packets and the answer flags are net/simplemail.ts.
//
// Decoded from PsoBB.exe (Psobb.exe-05112026.c; the dump's names for the window are wrong:
// the vtable 0x00b427f0 is the Simple Mail's, its state handler is FUN_0075596c, decompiled
// with tools/ghidra/decomp.sh 0x0075596c; the constructor is ChatShortcutMenu_Constructor_007558a0):
//   - State 0 / 1: the top menu FUN_00756cf4 at get_gui_position(0xa0) = (8, 256), title
//     unitxt(11, 0x30) "Select". Rows: 0x6a "Send Mail" (value 3, enabled in the lobby),
//     0xec "Received Mail" (value 7, enabled when the store has a mail), 0x12b "Answer
//     Service" (value 0x13, enabled in the lobby). The 0xed row ("Send to GM") needs
//     CreateItemObject_006dc358 == 1, which returns 0, so it is not shown.
//   - State 3 / 4: the guild card book list (FUN_00747d6c, positions 0x88 (194, 256) and the
//     card info box 0x89 (419, 256)); decide takes the card's guild card number (FUN_00781dd4)
//     and goes to the keyboard (state 0xb); cancel goes to the top (state 1).
//   - State 0xb / 0xc: the keyboard at get_gui_position(0xcf) = (331, 266) (FUN_00756ab0).
//     Escape -> top (state 1); Enter -> state 0xd.
//   - State 0xd / 0xe: the send confirm (FUN_00756a60, position 0xa4 = (408, 256), unitxt
//     0x33 "Confirm" and 0x52 "Are you sure?"); the keyboard moves to 0xd0 = (23, 266). Yes
//     sends (FUN_008136f0) and marks the replied mail; No goes back to the keyboard (0xb).
//   - State 7 / 8: the received mail list (FUN_00756ca0, position 0xa1 = (188, 256), title
//     unitxt(11, 0x41) "Message List"), newest first. The detail boxes (0xaa (408, 256) and
//     0xa2 (408, 320)) show the highlighted mail (FUN_00756c2c: its message, date and the
//     unitxt 0x181 "Received Date"). Cancel closes the window (state 0x1c); decide goes to
//     the action menu (state 9).
//   - State 9 / 10: the action menu (FUN_00756b68, position 0xa3 = (408, 256), title
//     unitxt(11, 0x31) "Action"): 0x98 "Reply" (value 0xb: the keyboard to the mail's
//     sender), 0x6c "Search" (value 0xf: a guild card search for the sender, then the top),
//     0x6d "Delete" (value 0x11). Cancel goes back to the list (state 7).
//   - State 0x11 / 0x12: the delete confirm (FUN_007569e4, position 0xa5 = (408, 314), unitxt
//     0x51 "Are you sure?"): Yes deletes the mail (FUN_0081358c) and goes to the list; No
//     goes back to the action menu (state 9).
//   - State 0x13 (Answer Service row): when the answer text is empty, the response keyboard
//     (state 0x18); otherwise the answer menu (state 0x14): FUN_007568dc at 0xa6 = (397, 256)
//     with 0x12f "Answer on/off" (value 0x16) and 0x130 "Change Response" (value 0x18), and the
//     status list FUN_00756948 at 0xa7 = (188, 256): the on / off text (0x12d "On" / 0x12e
//     "Off") and the answer text.
//   - State 0x16 / 0x17: the on / off list (FUN_00756860, position 0xa8 = (397, 315)): 0x12d
//     (value 1) and 0x12e (value 0); the choice sets the service (FUN_0077a4c0), then state 0x14.
//   - State 0x18 / 0x19: the response keyboard (0xcf), started with the current text; Escape ->
//     top; Enter -> state 0x1a.
//   - State 0x1a / 0x1b: the confirm (FUN_00756808, position 0xa9 = (327, 256), unitxt 0x12c
//     "Are you sure?"): Yes keeps the text (FUN_0077a4fc); No goes back to the keyboard.
//   - Close (the destructor 0x755744): FUN_008136c0 clears the unread bit of every mail, and
//     on_exit_simple_mail_menu sends C7 / C8 when the answer service changed (net/simplemail.ts).
//
// ASSUMED (not traced): the lobby test in the top menu (taken as "in the lobby": the window
// exists only there); the empty-picker row (unitxt 0xf3, the guild card list's own); the
// detail boxes' lines (the date box holds the label and the date, the message box the text;
// the exe writes the same element twice, see DEVLOG); the box widths (188) and the yes/no
// width; the compose limit (0xAB units, the send's copy size); the keyboard starts empty for a
// new mail; the answer status list's rows are not selectable; the on / off cursor starts on the
// current state. The title of the picker is unitxt 0x30. The top rows are rebuilt on each key
// (the exe builds them when the menu opens), so a mail that arrives while the menu is open
// enables Received Mail at once.
import { se, SE } from '../audio/se.ts';
import { menuKeyOf } from '../input/keyconfig.ts';
import type { MailEntry, SimpleMailBox } from '../net/simplemail.ts';
import type { GuildCardBook, GuildCardClient } from '../net/guildcard.ts';
import { cardInfoLines, cardPageCount, cardRows, T11_GUILD } from './guildcardmenu.ts';
import { drawListWindow, INSET, listKey, type ListItem } from './fieldwindows.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import type { MenuKey, Text } from './gamelist.ts';
import { wrapGameText } from './chat.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';
import { CARET, caretColor, TextEditor } from './titleflow.ts';
import { Question } from './teammenu.ts';

// get_gui_position (0x00971f40 + 8 * id, read with tools/exedata.py).
export const MAIL_POS = {
  top: { x: 8, y: 256 }, // 0xa0
  recipient: { x: 194, y: 256 }, // 0x88
  recipientInfo: { x: 419, y: 256 }, // 0x89
  inbox: { x: 188, y: 256 }, // 0xa1
  detailDate: { x: 408, y: 256 }, // 0xaa
  detailMessage: { x: 408, y: 320 }, // 0xa2
  action: { x: 408, y: 256 }, // 0xa3
  sendConfirm: { x: 408, y: 256 }, // 0xa4
  deleteConfirm: { x: 408, y: 314 }, // 0xa5
  answerMenu: { x: 397, y: 256 }, // 0xa6
  answerStatus: { x: 188, y: 256 }, // 0xa7
  onOff: { x: 397, y: 315 }, // 0xa8
  answerConfirm: { x: 327, y: 256 }, // 0xa9
  keyboard: { x: 331, y: 266 }, // 0xcf
  keyboardAside: { x: 23, y: 266 }, // 0xd0
} as const;

// Unitxt group 11 ids (the exe's FUN_0079317c).
export const MAIL_TEXT = {
  title: 0x30,
  action: 0x31,
  inboxTitle: 0x41,
  received: 0x181,
  sendMail: 0x6a,
  receivedMail: 0xec,
  answerService: 0x12b,
  reply: 0x98,
  search: 0x6c,
  del: 0x6d,
  confirmTitle: 0x33,
  deleteAsk: 0x51,
  sendAsk: 0x52,
  answerAsk: 0x12c,
  answerOnOff: 0x12f,
  changeResponse: 0x130,
  on: 0x12d,
  off: 0x12e,
  yes: 0x6e,
  no: 0x6f,
} as const;

// The menu rows' values: the exe's next states.
export const MAIL_ROW = {
  send: 3,
  inbox: 7,
  reply: 0xb,
  search: 0xf,
  del: 0x11,
  answer: 0x13,
  answerOnOff: 0x16,
  answerText: 0x18,
} as const;

export const MAIL_TEXT_MAX = 0xab; // the compose and the response keyboards (exe 0078e000 / 0077a4fc)
const KEYBOARD_WIDTH = 188;
const BOX_WIDTH = 188;

export type MailPhase =
  | 'top'
  | 'recipient'
  | 'compose'
  | 'sendConfirm'
  | 'inbox'
  | 'action'
  | 'deleteConfirm'
  | 'answer'
  | 'onOff'
  | 'answerText'
  | 'answerConfirm'
  | 'closed';

export interface SimpleMailHost {
  box: SimpleMailBox;
  // The guild card book (null until the sync has finished).
  book(): GuildCardBook | null;
  // The guild card client (the search row); null without a lobby connection.
  client(): GuildCardClient | null;
  // Our own guild card number and character name (the packet's sender fields).
  self(): { guildCard: number; name: string };
  // The unitxt lookup for the card info lines (group, index).
  unitxt(group: number, index: number): string;
  // Called once when the window closes (the destructor: the answer packets and the unread bits).
  onClose(): void;
}

function windowWidth(items: readonly ListItem[], title: string | null): number {
  const widest = Math.max(0, ...items.map((i) => gameTextWidth(i.label)), title ? gameTextWidth(title) : 0);
  return widest + 2 * INSET;
}

function drawLines(ctx: CanvasRenderingContext2D, skin: WindowSkin, x: number, y: number, width: number, lines: readonly string[]): void {
  const shown = lines.flatMap((l) => wrapGameText(l, width - 2 * INSET));
  const h = 14 + 20 * Math.max(0, shown.length - 1) + 20;
  drawWindowFrame(ctx, skin.frame, x, y, width, h);
  shown.forEach((line, i) => drawGameText(ctx, line, x + INSET, y + INSET + i * 20));
}

export class SimpleMailMenu {
  phase: MailPhase = 'top';
  private readonly text: Text;
  private readonly host: SimpleMailHost;
  private top: ListItem[] = [];
  private readonly topState = { cursor: 0 };
  private recipientRows: ListItem[] = [];
  private readonly recipientState = { cursor: 0 };
  private recipientPage = 0;
  private inbox: ListItem[] = [];
  private readonly inboxState = { cursor: 0 };
  private inboxVersion = -1;
  private action: ListItem[] = [];
  private readonly actionState = { cursor: 0 };
  private answerRows: ListItem[] = [];
  private readonly answerState = { cursor: 0 };
  private onOffRows: ListItem[] = [];
  private readonly onOffState = { cursor: 0 };
  // The guild card the mail goes to (the picker's card, or the replied mail's sender).
  private recipient: number | null = null;
  // The mail the reply or delete works on (its serial), and the mail a reply answers.
  private selected: number | null = null;
  private replyTo: number | null = null;
  private editor: TextEditor | null = null;
  private question: Question | null = null;

  constructor(text: Text, host: SimpleMailHost) {
    this.text = text;
    this.host = host;
    this.top = this.topRows();
  }

  get open(): boolean {
    return this.phase !== 'closed';
  }

  // The top menu rows: Send Mail (lobby), Received Mail (mails exist), Answer Service (lobby).
  topRows(): ListItem[] {
    const inLobby = true; // the window is only opened in the lobby (ASSUMED, see the header)
    return [
      { label: this.text(MAIL_TEXT.sendMail), value: MAIL_ROW.send, enabled: inLobby },
      { label: this.text(MAIL_TEXT.receivedMail), value: MAIL_ROW.inbox, enabled: this.host.box.store.count > 0 },
      { label: this.text(MAIL_TEXT.answerService), value: MAIL_ROW.answer, enabled: inLobby },
    ];
  }

  // The list of mails, newest first; the value is the serial.
  inboxRows(): ListItem[] {
    return [...this.host.box.store.all()]
      .reverse()
      .map((m: MailEntry) => ({ label: m.fromName || ' ', value: m.serial, enabled: true }));
  }

  private enterTop(): void {
    this.phase = 'top';
    this.top = this.topRows();
    if (this.topState.cursor >= this.top.length) this.topState.cursor = 0;
  }

  // The guild card picker's rows (the book's page), or the greyed empty row.
  private buildRecipients(): void {
    const book = this.host.book();
    const n = cardPageCount(book);
    this.recipientPage = Math.min(this.recipientPage, n - 1);
    this.recipientRows = cardRows(book, this.text(T11_GUILD.empty), this.recipientPage);
    if (this.recipientState.cursor >= this.recipientRows.length) this.recipientState.cursor = 0;
  }

  // The card of a picker row (its value is the book slot).
  private cardAt(slot: number): number | null {
    const entries = this.host.book()?.view().entries ?? [];
    const e = entries[slot];
    return e && e.card.present ? e.card.guildCardNumber : null;
  }

  private enterInbox(): void {
    this.phase = 'inbox';
    this.refreshInbox();
  }

  // The list follows the store (exe state 8: DAT_00a98474 bit 0), keeping the highlighted mail.
  private refreshInbox(): void {
    const store = this.host.box.store;
    const cursorSerial = this.inbox[this.inboxState.cursor]?.value ?? null;
    this.inbox = this.inboxRows();
    this.inboxVersion = store.version;
    const again = this.inbox.findIndex((r) => r.value === cursorSerial);
    this.inboxState.cursor = again >= 0 ? again : Math.min(this.inboxState.cursor, Math.max(0, this.inbox.length - 1));
  }

  private highlightedMail(): MailEntry | null {
    const serial = this.inbox[this.inboxState.cursor]?.value;
    return serial === undefined ? null : this.host.box.store.find(serial);
  }

  private answerActive(): boolean {
    return this.host.box.answerText.length > 0;
  }

  private startEditor(text: string): void {
    this.editor = new TextEditor(text, MAIL_TEXT_MAX, false);
  }

  private closeWindow(): void {
    this.phase = 'closed';
    this.editor = null;
    this.question = null;
    this.host.onClose();
  }

  // The keys of the window: the phase's list, keyboard or confirm.
  key(e: MenuKey): void {
    switch (this.phase) {
      case 'top':
        this.topKey(e);
        return;
      case 'recipient':
        this.recipientKey(e);
        return;
      case 'compose':
        this.composeKey(e);
        return;
      case 'sendConfirm':
        this.sendConfirmKey(e);
        return;
      case 'inbox':
        this.inboxKey(e);
        return;
      case 'action':
        this.actionKey(e);
        return;
      case 'deleteConfirm':
        this.deleteConfirmKey(e);
        return;
      case 'answer':
        this.answerKey(e);
        return;
      case 'onOff':
        this.onOffKey(e);
        return;
      case 'answerText':
        this.answerTextKey(e);
        return;
      case 'answerConfirm':
        this.answerConfirmKey(e);
        return;
      default:
        return;
    }
  }

  private topKey(e: MenuKey): void {
    // The rows follow the store (a mail that arrived since the window opened enables Received Mail).
    this.top = this.topRows();
    const r = listKey(e, this.top, this.topState);
    if (r === 'cancel') {
      this.closeWindow();
      return;
    }
    if (r !== 'decide') return;
    const row = this.top[this.topState.cursor];
    if (!row) return;
    if (row.value === MAIL_ROW.send) {
      this.recipientPage = 0;
      this.recipientState.cursor = 0;
      this.buildRecipients();
      this.phase = 'recipient';
    } else if (row.value === MAIL_ROW.inbox) {
      this.inboxState.cursor = 0;
      this.enterInbox();
    } else if (row.value === MAIL_ROW.answer) {
      // State 0x13: an empty response text goes straight to the keyboard (state 0x18).
      if (this.answerActive()) this.enterAnswer();
      else this.enterAnswerText();
    }
  }

  private recipientKey(e: MenuKey): void {
    const k = menuKeyOf(e);
    if (k === 'left' || k === 'right') {
      const n = cardPageCount(this.host.book());
      if (n > 1) {
        this.recipientPage = (this.recipientPage + (k === 'right' ? 1 : n - 1)) % n;
        this.recipientState.cursor = 0;
        this.buildRecipients();
      }
      return;
    }
    const r = listKey(e, this.recipientRows, this.recipientState);
    if (r === 'cancel') {
      this.enterTop();
      return;
    }
    if (r !== 'decide') return;
    const row = this.recipientRows[this.recipientState.cursor];
    const gc = row ? this.cardAt(row.value) : null;
    if (gc === null) return;
    this.recipient = gc;
    this.replyTo = null;
    this.startEditor('');
    this.phase = 'compose';
  }

  private composeKey(e: MenuKey): void {
    const ed = this.editor;
    if (!ed) {
      this.enterTop();
      return;
    }
    if (e.key === 'Escape') {
      se(SE.cancel);
      this.editor = null;
      this.enterTop();
    } else if (e.key === 'Enter') {
      se(SE.ok);
      this.question = new Question(this.text(MAIL_TEXT.sendAsk), { x: MAIL_POS.sendConfirm.x, y: MAIL_POS.sendConfirm.y, w: BOX_WIDTH });
      this.phase = 'sendConfirm';
    } else this.editKey(ed, e);
  }

  // The send confirm: Yes sends (and marks the replied mail), No goes back to the keyboard.
  private sendConfirmKey(e: MenuKey): void {
    const q = this.question;
    if (!q) return;
    q.key(e);
    if (!q.result) return;
    this.question = null;
    if (q.result === 'yes') {
      const to = this.recipient;
      const text = this.editor?.text ?? '';
      if (to !== null) {
        const self = this.host.self();
        this.host.box.send(self, to, text);
      }
      if (this.replyTo !== null) this.host.box.store.markReplied(this.replyTo);
      this.editor = null;
      this.enterTop();
    } else {
      this.phase = 'compose';
    }
  }

  private inboxKey(e: MenuKey): void {
    if (this.inboxVersion !== this.host.box.store.version) this.refreshInbox();
    const r = listKey(e, this.inbox, this.inboxState);
    if (r === 'cancel') {
      this.closeWindow();
      return;
    }
    if (r !== 'decide') return;
    const mail = this.highlightedMail();
    if (!mail) return;
    this.selected = mail.serial;
    this.action = this.actionRows();
    this.actionState.cursor = 0;
    this.phase = 'action';
  }

  private actionRows(): ListItem[] {
    const inLobby = true;
    return [
      { label: this.text(MAIL_TEXT.reply), value: MAIL_ROW.reply, enabled: inLobby },
      { label: this.text(MAIL_TEXT.search), value: MAIL_ROW.search, enabled: inLobby },
      { label: this.text(MAIL_TEXT.del), value: MAIL_ROW.del, enabled: true },
    ];
  }

  private actionKey(e: MenuKey): void {
    const r = listKey(e, this.action, this.actionState);
    if (r === 'cancel') {
      this.enterInbox();
      return;
    }
    if (r !== 'decide') return;
    const row = this.action[this.actionState.cursor];
    const mail = this.selected === null ? null : this.host.box.store.find(this.selected);
    if (!row || !mail) return;
    if (row.value === MAIL_ROW.reply) {
      // State 10 -> 0xb: the recipient is the mail's sender, the reply marks this mail.
      this.recipient = mail.fromGuildCard;
      this.replyTo = mail.serial;
      this.startEditor('');
      this.phase = 'compose';
    } else if (row.value === MAIL_ROW.search) {
      // The exe's FUN_00827f28: a search (0040) for the sender, then the top menu (state 0xf -> 1).
      const client = this.host.client();
      const self = this.host.self();
      if (client) {
        client.search(self.guildCard, mail.fromGuildCard).catch((err: unknown) => console.info(`[classic] Simple Mail search: ${String(err)}`));
      }
      this.enterTop();
    } else if (row.value === MAIL_ROW.del) {
      this.question = new Question(this.text(MAIL_TEXT.deleteAsk), { x: MAIL_POS.deleteConfirm.x, y: MAIL_POS.deleteConfirm.y, w: BOX_WIDTH });
      this.phase = 'deleteConfirm';
    }
  }

  // The delete confirm (state 0x12): Yes removes the mail and goes to the list; No to the action menu.
  private deleteConfirmKey(e: MenuKey): void {
    const q = this.question;
    if (!q) return;
    q.key(e);
    if (!q.result) return;
    this.question = null;
    if (q.result === 'yes' && this.selected !== null) {
      this.host.box.store.remove(this.selected);
      this.selected = null;
      this.enterInbox();
    } else {
      this.phase = 'action';
    }
  }

  private enterAnswer(): void {
    this.answerRows = [
      { label: this.text(MAIL_TEXT.answerOnOff), value: MAIL_ROW.answerOnOff, enabled: true },
      { label: this.text(MAIL_TEXT.changeResponse), value: MAIL_ROW.answerText, enabled: true },
    ];
    this.answerState.cursor = 0;
    this.phase = 'answer';
  }

  private answerKey(e: MenuKey): void {
    const r = listKey(e, this.answerRows, this.answerState);
    if (r === 'cancel') {
      this.enterTop();
      return;
    }
    if (r !== 'decide') return;
    const row = this.answerRows[this.answerState.cursor];
    if (!row) return;
    if (row.value === MAIL_ROW.answerOnOff) {
      this.onOffRows = [
        { label: this.text(MAIL_TEXT.on), value: 1, enabled: true },
        { label: this.text(MAIL_TEXT.off), value: 0, enabled: true },
      ];
      this.onOffState.cursor = this.host.box.answerOn ? 0 : 1;
      this.phase = 'onOff';
    } else if (row.value === MAIL_ROW.answerText) {
      this.enterAnswerText();
    }
  }

  private onOffKey(e: MenuKey): void {
    const r = listKey(e, this.onOffRows, this.onOffState);
    if (r === 'cancel') {
      this.phase = 'answer';
      return;
    }
    if (r !== 'decide') return;
    const row = this.onOffRows[this.onOffState.cursor];
    if (row) this.host.box.setAnswerEnabled(row.value === 1);
    this.phase = 'answer';
  }

  private enterAnswerText(): void {
    this.startEditor(this.host.box.answerText);
    this.phase = 'answerText';
  }

  private answerTextKey(e: MenuKey): void {
    const ed = this.editor;
    if (!ed) {
      this.enterTop();
      return;
    }
    if (e.key === 'Escape') {
      se(SE.cancel);
      this.editor = null;
      this.enterTop();
    } else if (e.key === 'Enter') {
      se(SE.ok);
      this.question = new Question(this.text(MAIL_TEXT.answerAsk), { x: MAIL_POS.answerConfirm.x, y: MAIL_POS.answerConfirm.y, w: BOX_WIDTH });
      this.phase = 'answerConfirm';
    } else this.editKey(ed, e);
  }

  // The answer confirm (state 0x1b): Yes keeps the text; No goes back to the keyboard.
  private answerConfirmKey(e: MenuKey): void {
    const q = this.question;
    if (!q) return;
    q.key(e);
    if (!q.result) return;
    this.question = null;
    if (q.result === 'yes') {
      this.host.box.setAnswerText(this.editor?.text ?? '');
      this.editor = null;
      this.enterTop();
    } else {
      this.phase = 'answerText';
    }
  }

  private editKey(ed: TextEditor, e: MenuKey): void {
    if (e.key === 'Backspace') ed.backspace();
    else if (e.key.length === 1) ed.type(e.key);
  }


  // The highlighted card of the picker (its info box), or null.
  private highlightedCard() {
    const row = this.recipientRows[this.recipientState.cursor];
    if (!row || row.value < 0) return null;
    const entry = this.host.book()?.view().entries[row.value];
    return entry && entry.card.present ? entry.card : null;
  }

  // Draws the open window's list, box, keyboard or confirm.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    if (this.phase === 'closed') return;
    const p = this.phase;
    if (p === 'top') {
      const t = MAIL_POS.top;
      const title = this.text(MAIL_TEXT.title);
      drawListWindow(ctx, skin, t.x, t.y, windowWidth(this.top, title), title, this.top, this.topState.cursor, true);
      return;
    }
    if (p === 'recipient') {
      const t = MAIL_POS.recipient;
      const title = this.text(MAIL_TEXT.title);
      drawListWindow(ctx, skin, t.x, t.y, windowWidth(this.recipientRows, title), title, this.recipientRows, this.recipientState.cursor, true);
      const card = this.highlightedCard();
      if (card) {
        const d = MAIL_POS.recipientInfo;
        drawLines(ctx, skin, d.x, d.y, BOX_WIDTH, cardInfoLines(card, (g, i) => this.host.unitxt(g, i)));
      }
      return;
    }
    if (p === 'compose' || p === 'answerText') {
      this.drawKeyboard(ctx, skin, MAIL_POS.keyboard);
      return;
    }
    if (p === 'sendConfirm' || p === 'answerConfirm') {
      this.drawKeyboard(ctx, skin, MAIL_POS.keyboardAside);
      this.question?.draw(ctx, skin, this.text(MAIL_TEXT.yes), this.text(MAIL_TEXT.no));
      return;
    }
    if (p === 'inbox' || p === 'action' || p === 'deleteConfirm') {
      if (p === 'inbox') {
        const t = MAIL_POS.inbox;
        const title = this.text(MAIL_TEXT.inboxTitle);
        drawListWindow(ctx, skin, t.x, t.y, windowWidth(this.inbox, title), title, this.inbox, this.inboxState.cursor, true);
        this.drawMailDetail(ctx, skin);
        return;
      }
      if (p === 'action') {
        const t = MAIL_POS.action;
        const title = this.text(MAIL_TEXT.action);
        drawListWindow(ctx, skin, t.x, t.y, windowWidth(this.action, title), title, this.action, this.actionState.cursor, true);
        return;
      }
      // The delete confirm sits over the list.
      const t = MAIL_POS.inbox;
      const title = this.text(MAIL_TEXT.inboxTitle);
      drawListWindow(ctx, skin, t.x, t.y, windowWidth(this.inbox, title), title, this.inbox, this.inboxState.cursor, false);
      this.question?.draw(ctx, skin, this.text(MAIL_TEXT.yes), this.text(MAIL_TEXT.no));
      return;
    }
    if (p === 'answer') {
      const menu = MAIL_POS.answerMenu;
      drawListWindow(ctx, skin, menu.x, menu.y, windowWidth(this.answerRows, null), null, this.answerRows, this.answerState.cursor, true);
      const st = MAIL_POS.answerStatus;
      const status: ListItem[] = [
        { label: this.text(this.host.box.answerOn ? MAIL_TEXT.on : MAIL_TEXT.off), value: 0, enabled: false },
        { label: this.host.box.answerText, value: 0, enabled: false },
      ];
      drawListWindow(ctx, skin, st.x, st.y, windowWidth(status, null), null, status, -1, false);
      return;
    }
    if (p === 'onOff') {
      const t = MAIL_POS.onOff;
      drawListWindow(ctx, skin, t.x, t.y, windowWidth(this.onOffRows, null), null, this.onOffRows, this.onOffState.cursor, true);
    }
  }

  // The keyboard's frame and text (the caret at the end).
  private drawKeyboard(ctx: CanvasRenderingContext2D, skin: WindowSkin, at: { x: number; y: number }): void {
    const ed = this.editor;
    if (!ed) return;
    drawWindowFrame(ctx, skin.frame, at.x, at.y, KEYBOARD_WIDTH, 34);
    const shown = ed.shown;
    drawGameText(ctx, shown, at.x + INSET, at.y + INSET + 1);
    ctx.fillStyle = caretColor(0);
    ctx.fillRect(at.x + INSET + gameTextWidth(shown), at.y + INSET, CARET.w, CARET.h);
  }

  // The detail boxes of the highlighted mail: the date (unitxt 0x181 and the date) at 0xaa,
  // the message at 0xa2.
  private drawMailDetail(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    const mail = this.highlightedMail();
    if (!mail) return;
    const date = MAIL_POS.detailDate;
    drawLines(ctx, skin, date.x, date.y, BOX_WIDTH, [this.text(MAIL_TEXT.received), mail.date]);
    const msg = MAIL_POS.detailMessage;
    drawLines(ctx, skin, msg.x, msg.y, BOX_WIDTH, [mail.text]);
  }

  // The window is closed from outside (the lobby leaves): the close actions run once.
  dispose(): void {
    if (this.open) this.closeWindow();
  }
}
