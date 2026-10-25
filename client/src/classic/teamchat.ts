// The team chat window (F9) and the team lock (F10), PsoBB.exe 1.25.13.
//
// Exe (named dump Psobb.exe-05112026.c):
// - TeamChatMenu_Update_00717260 (line 678207, called from 677720) is the per-frame update of
//   the quick menu object. F9 (team_chat) toggles the window: when the slot's UI element is
//   hidden it sets 0x180 on it (UIElement_SetLockAndVisibilityState_00716188: visible and
//   locked), when visible it clears 0x180 (UIElement_Update_00716198). F10 (team_chat_toggle,
//   line 678385) acts only while the window is visible: it toggles the lock bit 0x80
//   (Quickmenuobject_SetElementLocked_00716168 / UIElement_ClearLockState_00716178).
//   Both keys take the menu keys' Shift test (the 0x2000000 option, read at 678299 onwards).
// - The window is the team log list (`TeamLogListWindow`, the quick menu object's +0x48).
//   Its constructor call (CreateListWindowObject_00721558, line 677488) passes the position
//   (8, 380) and the render vector (624, 94) as literals, not from the GUI table; 30 rows
//   (0x1e), and a stored line is at most 0x8f units (line 686900 onwards). ASSUMED: the
//   render vector is the window's width and height.
// - SendChatMessageDispatcher_0077d710 (line 754225) sends a typed or shortcut text line
//   as team chat when the lock is set (UIPanel_IsElementLocked_00718ee4). Then
//   HandleTeamOperationSuccessFromChat_0077d784 (line 754294) sends the 07EA team chat
//   packet only in the logged_in scene (0x0b). The lock is not cleared by a send.
// - A received 07EA (handler 0x007c1a4c, the EA table 0x00a0f800 entry 7) calls the team log
//   writer through the team log handler (TeamLogHandler_AddMessage_007190b0, line 680596):
//   the line is "sender > text" with the sender, and the text alone without one; newlines
//   become spaces (line 680540). ASSUMED: the separator is the chat log's " > ".
//
// The port: the lock and the window are the two flags below; the lines the window shows are
// the team log. The window opens in or out of a team, as the exe's F9 does.

import { drawGameText, GAME_TEXT } from './gametext.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';

// The team log's window (CreateListWindowObject_00721558 arguments; ASSUMED size meaning).
export const TEAM_LOG_WINDOW = { x: 8, y: 380, w: 624, h: 94 };
// The list keeps 0x1e lines (the team log's entries, TeamLogListWindow_Initialize_007215dc).
export const TEAM_LOG_LINES = 0x1e;
// A stored line is at most 0x8f units (TeamLogListWindow_Initialize_007215dc, line 686900).
export const TEAM_LOG_TEXT_MAX = 0x8f;
// Rows that fit the window (the chat log's formula, ASSUMED for this window's height).
export const TEAM_LOG_FIT = Math.floor((TEAM_LOG_WINDOW.h - 20 + 6) / GAME_TEXT.lineHeight);

// One team line as the window shows it (the exe's "sender > text" or the bare text).
export function teamLogLine(sender: string, text: string): string {
  const body = [...text.replace(/\n/g, ' ')].slice(0, TEAM_LOG_TEXT_MAX).join('');
  return sender ? `${sender} > ${body}` : body;
}

export class TeamLog {
  lines: string[] = [];

  add(sender: string, text: string): void {
    this.lines.push(teamLogLine(sender, text));
    if (this.lines.length > TEAM_LOG_LINES) this.lines.shift();
  }
}

// The team chat state of one session (both screens share it: the lobby and the field).
export class TeamChat {
  readonly log = new TeamLog();
  // The window is shown (0x100 on the slot's element).
  open = false;
  // The lock (0x80): while the window is open, typed lines go to the team.
  locked = false;
  // sendLine: the 07EA send (the team client's chat).
  private readonly sendLine: (sender: string, text: string) => void;

  constructor(sendLine: (sender: string, text: string) => void) {
    this.sendLine = sendLine;
  }

  // F9: opens and closes the window (TeamChatMenu_Update_00717260 has no team test; the exe
  // gates only the send, by scene). Opening sets the lock too (0x180): the window starts in
  // team mode.
  toggle(): void {
    if (this.open) {
      this.open = false;
      this.locked = false;
      return;
    }
    this.open = true;
    this.locked = true;
  }

  // The Home menu's Team Log rows (0x158 shows, 0x159 hides): the exe's UIElement_SetLockAndVisibilityState
  // (0x180: shown and locked) and UIElement_Update (clears 0x180). Both bits move together.
  setWindow(on: boolean): void {
    this.open = on;
    this.locked = on;
  }

  // F10: only while the window is open.
  toggleLock(): void {
    if (this.open) this.locked = !this.locked;
  }

  // Whether a typed line goes to the team (the window is open and locked).
  routes(): boolean {
    return this.open && this.locked;
  }

  // A line sent as team chat: 07EA (SendTeamOperationSuccessPacket_007f32ac). The exe sends it
  // out of a team too; the scene check (logged_in, 0x0b) is the screen's, and the lobby and the
  // field are both logged_in. Out of a team the server has no team to relay it to (newserv
  // relays only to members), so the line goes nowhere (ASSUMED on the server side).
  submit(sender: string, text: string): void {
    this.sendLine(sender, text);
  }

  // A received 07EA (the handler's team log writer): kept whether the window is shown or not.
  receive(sender: string, text: string): void {
    this.log.add(sender, text);
  }
}

// Draws the team log (the newest rows at the bottom, as the chat log does).
export function drawTeamLog(ctx: CanvasRenderingContext2D, skin: WindowSkin, log: TeamLog): void {
  const { x, y, w, h } = TEAM_LOG_WINDOW;
  drawWindowFrame(ctx, skin.frame, x, y, w, h);
  log.lines.slice(-TEAM_LOG_FIT).forEach((l, i) => drawGameText(ctx, l, x + 10, y + 10 + i * GAME_TEXT.lineHeight, '#ffffff'));
}
