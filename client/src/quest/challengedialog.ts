// The Pioneer 2 challenge quest dialog (QuestSelectionDialog, PsoBB.exe), the
// window g_pChallengeQuestDialogWindow (0x00a96180) that cmode.ts reads for the
// leader's stage-list sender (6x8A).
//
// Built by GameListMenu_EnterCreatePartyState_006cd2d4 (0x006cd2d4) when the
// Hunter's Guild counter's menu (the online dialog, quest/town.ts guild) enters
// its state 8; the constructor is QuestSelectionDialog_Constructor_006cfde8
// (0x006cfde8, vtable 0x00b3c080). Its process state is +0x20 and dispatches in
// QuestSelectionDialog_ProcessState_006cfe74 (0x006cfe74). The level of the
// selection is +0x78 (0 = the episode list, 1 = the quest list, 2 = a quest
// with its description, confirmed by the yes/no at +0x44).
//
// The server packets (dispatch: handle_ship_packet0xa2 / 0xa3 in PsoBB.exe,
// 0x007c8e00 / 0x007c8e50 copy the packet and call the ship connection's table
// slot 0x1f / 0x20, registered at 0x00797d46 / 0x00797d50):
//   A2 (0x2510 bytes, the 8-byte header then 30 entries of 0x13c): the list.
//     The header's flag (+4) is the entry count (EnterState1 reads +4).
//     MedicalCenterDialog_UpdateData_006cca7c: the block is copied and +0x20 = 1.
//   A3 (0x248 bytes, the header then UTF-16 text at +8): the description.
//     The header's flag (+4) is read as the quest number (GetChallengeEntityState
//     / GetChallengeEntityProgress). HandleChallengeMenuUpdate_006ccaa8: the block
//     is copied and +0x20 = 2.
// The entries are the A2 records (the same layout as net/quests.ts
// parseQuestMenu): the name at +8, the short description at +0x48, the
// episode byte (menu_id & 0xff) at +0, the disabled byte at +0x138.
//
// The client packets (QuestSelectionDialog_ProcessState*):
//   state 0 (unknown_clear_quest_file_ptrs): A2 with the menu flag (+0x80).
//   level 0 chooses an episode: 10 with flags = GetCurrentChallengeStage
//     (GetCurrentChallengeStage_006d040c), the menu and item ids of the entry.
//   level 1 chooses a quest: 09 with the menu and item ids (A3 comes back).
//   level 2 confirms: a yes / no (+0x44). Yes with a startable party: 10 with
//     flags 0 (the start; the quest files then come through quest/run.ts).
//   a cancel on the quest list closes the dialog (state 9); a no on the yes / no
//     goes back to the list (level - 1, state 1).
// Only the leader's dialog is driven (the port opens it from quest/town.ts).
//
// The port keeps the exe's states as numbers. Things the port does not drive
// are marked ASSUMED where they are set (the menu flag; the stage byte is
// GetCurrentChallengeStage_006d040c, cmode.ts challengeCurrentStage, with the selection
// state and party ASSUMED in town.ts; the start check is the dump's
// unknown_maybe_num_players_to_start_quest, town.ts challengeStartable).

import { parseQuestMenu, type QuestMenuEntry } from '../net/quests.ts';
import type { ChallengeQuestDialog } from './cmode.ts';

// The A2 block: 8 header bytes, then the entries (MedicalCenterDialogDataBuffer_00a96084,
// 0x2510 bytes = 8 + 30 * 0x13c).
export const CHALLENGE_LIST_MAX = 30;

// Ports of the exe's menu calls (QuestSelectionDialog's (**(menu+0x1c))(code, 1)):
// the codes the menu shows, kept in order for the UI (ASSUMED: the text of each).
export const MENU_CODE_PARTY_SMALL = 0x10; // the party is not ready (the start is refused)
export const MENU_CODE_START = 0x14; // the quest starts
export const MENU_CODE_BACK = 0x19; // back to the list
export const MENU_CODE_CONFIRM = 5; // the yes / no is open

// The packet and the party checks the dialog drives. The leader's client sends
// through quest/net (net/quests.ts QuestClient).
export interface ChallengeDialogHost {
  // C->S A2 with the menu flag (state 0).
  requestMenu(flag: number): void;
  // C->S 10 with the flags = the challenge stage (level 0).
  chooseCategory(entry: QuestMenuEntry, stage: number): void;
  // C->S 09: the description of an entry (level 1).
  requestInfo(entry: QuestMenuEntry): void;
  // C->S 10 with flags 0: start the quest (the yes at level 2).
  startQuest(entry: QuestMenuEntry): void;
  // unknown_maybe_num_players_to_start_quest (0x006cf...): 1 = the party may start.
  startable(): number;
  // GetCurrentChallengeStage_006d040c: the stage byte of the level 0 choice.
  stage(): number;
}

export class ChallengeQuestSelectionDialog implements ChallengeQuestDialog {
  // +0x20: the process state (0 request, 1 list, 2 description, 3 select, 8 confirm,
  // 0xb empty, 0xc waiting for the server, 9 closed by a cancel).
  proc = 0;
  // +0x78: the level (0 episode, 1 quest, 2 confirm). ChallengeQuestDialog.state
  // (cmode.ts reads it as the window state's input).
  level = 0;
  get state(): number {
    return this.level;
  }
  // +0x38 != 0: the quest list window is built.
  built = false;
  // +0x40 != 0: the description window is built (the header is read).
  headerRead = false;
  // The A3 header's flag: the quest number of the description (-1 before the first A3).
  quest = -1;
  // g_ChallengeQuestSelectionState (0x00a96168): 1 when the chosen episode is Episode 2.
  selection = 0;
  // The entries of the last A2 (the first `count` records).
  entries: QuestMenuEntry[] = [];
  // The description text of the last A3 (the list window's text, +0x40).
  description = '';
  // The yes / no at +0x44 is open (the level 2 confirm).
  confirming = false;
  // The entry the last choice was on (+0x4c / +0x50).
  chosen: QuestMenuEntry | null = null;
  // The start went out: the quest files come through the quest link, not the dialog.
  started = false;
  // Closed by a cancel, by an empty list or by abort().
  closed = false;
  // The menu codes the dialog raised, in order (see MENU_CODE_*).
  readonly menuCodes: number[] = [];
  private readonly listeners = new Set<() => void>();

  private readonly host: ChallengeDialogHost;
  // +0x80: the flag of the A2 request (ASSUMED: 0 for the Hunter's Guild; the government counter sends 1).
  private readonly menuFlag: number;

  constructor(host: ChallengeDialogHost, menuFlag: number) {
    this.host = host;
    this.menuFlag = menuFlag;
  }

  // The entry names of the list, for the UI.
  names(): string[] {
    return this.entries.map((e) => e.name);
  }

  // Calls fn after each state change; returns the unsubscribe.
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Resolves at the next state change.
  nextChange(): Promise<void> {
    return new Promise((resolve) => {
      const off = this.subscribe(() => {
        off();
        resolve();
      });
    });
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  // state 0 (unknown_clear_quest_file_ptrs): ask for the list, then wait (0xc).
  open(): void {
    if (this.closed) return;
    this.proc = 0;
    this.host.requestMenu(this.menuFlag);
    this.proc = 0xc;
    this.emit();
  }

  // A2 (MedicalCenterDialog_UpdateData_006cca7c): the list. `count` is the header's flag.
  receiveList(payload: Uint8Array, count: number): void {
    if (this.closed) return;
    this.entries = parseQuestMenu(payload).slice(0, Math.min(Math.max(0, count), CHALLENGE_LIST_MAX));
    this.proc = 1;
    this.enterList();
  }

  // EnterState1_006d0698: build the list; an empty one closes the dialog (state 0xb).
  private enterList(): void {
    this.built = true;
    if (this.entries.length === 0) {
      this.built = false;
      this.proc = 0xb;
      this.closed = true;
      this.menuCodes.push(MENU_CODE_BACK);
    } else {
      this.proc = 3;
    }
    this.emit();
  }

  // A3 (HandleChallengeMenuUpdate_006ccaa8): the description; the flag is the quest number.
  receiveInfo(flag: number, text: string): void {
    if (this.closed) return;
    this.quest = flag;
    this.description = text;
    // EnterState2_006d0604: the description window (+0x40) is built, then state 3.
    this.proc = 2;
    this.headerRead = true;
    this.proc = 3;
    this.emit();
  }

  // The list confirm (state 3, flags & 2) on entry `index`.
  pick(index: number): void {
    if (this.proc !== 3 || !this.built || this.closed || this.confirming) return;
    const entry = this.entries[index];
    if (!entry) return;
    this.chosen = entry;
    if (this.level === 0) {
      // The episode byte: 1 = Episode 1 (selection 0), 2 = Episode 2 (selection 1).
      this.selection = entry.episodeByte === 2 ? 1 : 0;
      // The list windows are closed (+0x3c, +0x38); the server's next A2 rebuilds them.
      this.built = false;
      this.host.chooseCategory(entry, this.host.stage());
      this.level = 1;
      this.proc = 0xc;
    } else if (this.level === 1) {
      this.host.requestInfo(entry);
      this.level = 2;
      this.proc = 0xc;
    } else if (this.level === 2) {
      // The yes / no (+0x44) opens; the menu is told (5, 1).
      this.confirming = true;
      this.proc = 8;
      this.menuCodes.push(MENU_CODE_CONFIRM);
    }
    this.emit();
  }

  // The yes / no of state 8 (ProcessListSelection_006cff10): yes starts the quest
  // when the party can start, no (or a cancel) goes back to the list.
  answer(yes: boolean): void {
    if (this.proc !== 8 || !this.confirming || !this.chosen || this.closed) return;
    if (!yes) {
      this.cancelConfirm();
      return;
    }
    if (this.host.startable() !== 1) {
      // The party is not ready: the menu shows its message, the yes / no stays open.
      this.menuCodes.push(MENU_CODE_PARTY_SMALL);
      this.emit();
      return;
    }
    this.menuCodes.push(MENU_CODE_START);
    this.host.startQuest(this.chosen);
    this.started = true;
    // The start closes the lists (+0x44, +0x40, +0x3c, +0x38) and waits for the files (0xc).
    this.confirming = false;
    this.built = false;
    this.headerRead = false;
    this.proc = 0xc;
    this.emit();
  }

  private cancelConfirm(): void {
    // CloseListWindows_006d0104 closes the windows; the level goes back to the quest list.
    this.confirming = false;
    this.built = false;
    this.headerRead = false;
    this.level -= 1;
    this.menuCodes.push(MENU_CODE_BACK);
    this.proc = 1;
    this.enterList();
  }

  // A cancel on the quest list (state 3, flags & 4): the dialog closes (state 9).
  cancelList(): void {
    if (this.closed) return;
    this.close(9);
  }

  // The dialog is torn down (the town is left): nothing more is sent.
  abort(): void {
    if (this.closed) return;
    this.close(9);
  }

  private close(state: number): void {
    this.proc = state;
    this.closed = true;
    this.built = false;
    this.headerRead = false;
    this.confirming = false;
    this.emit();
  }
}
