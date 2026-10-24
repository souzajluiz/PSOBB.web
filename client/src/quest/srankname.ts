// The S-rank prize name window (Challenge Mode, the award_item_name state).
// Pure: no DOM, no three.js. quest/questui.ts draws it and takes its keys;
// quest/cmoderun.ts asks for the name through QuestUi.nameEntry.
//
// PsoBB.exe (Ghidra dump names, VAs are the exe's):
//   QuestThread4Constructor_006bcf6c  builds the window: a TKeyboardControl(.., 8, 0, 1)
//                                     (the 8 is the length cap, the 1 is the advanced
//                                     text input, EnableIME_Advanced), positioned at GUI
//                                     0xd3; the label list at GUI 0x58 holds one row, the
//                                     unitxt group 12 0x47 line "You can put your name on
//                                     this reward.", 443 wide (ListWindowObject_Initialize).
//   ProcessQuestListSelection_006bc68c  reads the typed text. An empty text returns 0 and
//                                     the window waits (the Decide on an empty name does
//                                     nothing); otherwise the text goes through the shop
//                                     word filter (NormalizeEntityName_00813f0c, which is
//                                     a banned-word pass, not a character whitelist).
//   g_QuestThread5 / buildSRankWeapon keeps the name in 5-bit letters (A..Z), anything
//                                     else is written as 0, so the port keeps letters only.
//
// The GUI positions are read from the exe's table 0x00971f40 + 8 * entry:
//   0x58 = (99, 120) (0x00972200), 0xd3 = (261, 173) (0x009725d8); the same formula
//   reproduces the game list's 0xd7 (99, 128) and 0xd8 (109, 164) (classic/gamelist.ts).
// ASSUMED: the typed text's place inside the label window (0xd3 is the editor's
// origin), the frame's height (84 from the list's second argument) and the caret.
// ASSUMED: Escape does nothing here (the exe's cancel path is not traced; the award
// list has no cancel either).

import { S_RANK_NAME_MAX, srankNameFromInput } from './cmode.ts';

export const NAME_LABEL_POS = { x: 99, y: 120 } as const; // GUI 0x58
export const NAME_EDITOR_POS = { x: 261, y: 173 } as const; // GUI 0xd3
export const NAME_WINDOW_SIZE = { w: 443, h: 84 } as const; // ASSUMED h (ListWindowObject_Initialize's 84)

// The characters the window takes: the 5-bit name of the weapon (letters only).
export function nameEntryAccepts(c: string): boolean {
  return c.length === 1 && /^[A-Za-z]$/.test(c);
}

export class SRankNameEntry {
  text = '';
  readonly max = S_RANK_NAME_MAX;

  // One typed character; a non-letter or a full name is dropped.
  type(c: string): void {
    if (nameEntryAccepts(c) && this.text.length < this.max) this.text += c;
  }

  backspace(): void {
    this.text = this.text.slice(0, -1);
  }

  // Decide: null while the name is empty (the window keeps waiting, exe 0x006bc68c),
  // else the weapon's name (upper case, at most S_RANK_NAME_MAX letters).
  decide(): string | null {
    if (this.text === '') return null;
    return srankNameFromInput(this.text);
  }
}
