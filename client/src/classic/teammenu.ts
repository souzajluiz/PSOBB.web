// The lobby counter's Team menus, as PsoBB.exe (Ephinea 1.25.13) runs them.
//
// The counter's second menu is team_main_menu (lobby_menu_id 28,
// ShowTeamMainMenu 0x00799e..): "Create Team" [15:0x57], "Ranking" [0x58],
// "Master Menu" [0x5b], "Leave Team" [0x5c] at entry 0xc7 (see counter.ts).
// Rows are greyed (ListWindowObject_SetItemHighlight_0073662c: colour
// 0xff909090 and row flag 0x10) from the membership the 12EA / E7 gave
// (g_pKeyTeamConfig): in a team "Create Team" is greyed, without one "Ranking"
// and "Leave Team"; the master cannot leave, everybody else has no Master Menu.
// A chosen row collapses the list to that line (AdjustSelectedLinePosition) and
// opens the next window. The state machine below follows the dispatch switch of
// ProcessLobbyMenu (dump 0x00797xxx..0x007a0xxx, names there are wrong, the
// numbers are g_CurrentLobbyMenuId):
//
//   0 Create Team  CreateTeamLobbyMenu_00799f88: question [15:0x66] at entry
//        0xe9 = (31, 118), width entry 0xea.x = 572, cursor on No; state 30.
//        Yes -> InitializeTeamCreationLobbyMenu (31): the 3-row info counter
//        window of GuildCardListWindow (425 x 188 at (181, 50) like the party
//        creation window; rows [15:0x69] "Please input a Team Name.", [15:0x68]
//        "Team Name" with the typed name, [11:0x64] "Registration"); the name
//        editor is a TKeyboardControl of 14 characters at entry 0xe0 (357, 86),
//        spaces (0x20, 0x3000) are removed from the name. Registration is
//        greyed until a name is typed and the cursor goes there afterwards;
//        Cancel -> close_lobby_menus. Registration -> question [15:0x67] "Set
//        Team Name as [%s]?" at (180, 240) width 300 (32). Yes -> 01EA with the
//        name (33); the answer 02EA (display_team_create_rename_purchase_result):
//        0 -> [15:0x6a] "Team [%s] was established. ..." (34), 2 -> [15:0x6b]
//        "[%s] is already registered. ..." (41, Enter reopens the name window),
//        other -> [15:0x6c] "Team creation failed." (35). The notices are typed
//        into an info window at (180, 80), 280 x 180 (g_TeamMenuListData); Enter
//        closes everything. No / Cancel on any question -> ResetLobbyStateAnd
//        ShowTeamMenu: question [15:0x87] "Do you have any other business?" at
//        the same (180, 80) / 280 (state 27) with the info text [15:3]; Yes ->
//        the team list again, No -> close_lobby_menus.
//   1 Ranking  ShowTeamRankingMenu: 1CEA (39); the answer builds the ship
//        select style list window (CreateGameListMenuWindow, (12, 50) 385 x 184)
//        titled [15:0x59] "Current Ranking" with a header row [15:0x68] / [11:0x175]
//        and one row per team (name, points), state 40; Cancel closes.
//   2 Master Menu  HandleLobbyTeamMasterMenu_00799108: list window at entry
//        0xc8 = (96, 333) with [15:0x5d..0x63] Member Promotion, Member Demotion,
//        Member Expulsion, Master Transfer, Dissolve Team, Buying Privileges,
//        Team Flag Records (the last greyed unless team_rewards & 1) (42). The
//        first three send 08EA (member list) and the 09EA answer
//        (CreateTeamMasterActionList_0079db38) builds a titled list at entry 0xeb
//        = (190, 180) with the rows "<rank> name" (s_ChallengePlayerItemFormat)
//        of the members the action applies to (promotion: privilege < 0x30,
//        demotion: 0 < p < 0x40, expulsion: p < 0x40), or [11:0xf1] "No Player"
//        (value 0, which goes back to the master menu). A member -> question at
//        (180, 240) / 300: [15:0x6e] / [0x73] / [0x78] with the row's text; Yes
//        -> 11EA flag 0x30 (promotion), 11EA flag 0 (demotion), 05EA (expulsion).
//        The answer (11EA: 0 ok, 5 "already", 1..4 and 6 failed; 06EA: 0 ok,
//        1..6 failed) is a notice in the info window at entry 0xeb (190, 180)
//        size entry 0xec (260, 120): [15:0x6f] / [0x74] / [0x79] on success,
//        [0x70] / [0x75] for 5, [0x71] / [0x76] / [0x7a] failed; Enter closes.
//        Dissolve Team -> question [15:0x81] (73); Yes -> 10EA (74), 0 ->
//        [15:0x82] "[%s] was dissolved." (75), else [15:0x83] (64).
//   3 Leave Team  ShowTeamMasterMenu_00799e5c: question [15:0x84] (the region
//        branch with [15:0x9b] is the other build's, CreateItemObject returns 0
//        here) at (180, 240) / 300 (43). Yes -> 05EA with the own guild card and,
//        without waiting for the answer, the notice [15:0x85] "You left Team
//        [%s]." at (190, 180) 260 x 120 (44); Enter closes.
//
// NOT done (left, see ROADMAP): Master Transfer (the exe asks the chosen player
// with a 6x message and waits for his answer: state 68, the 6x subcommand is not
// decoded; the row is greyed here), Buying Privileges / Team Flag Records (the
// 19EA / 1AEA / 1BEA / 0FEA packets exist in net/team.ts, the windows do not),
// inviting a player (03EA / 04EA, [11:0x14c] "Now inviting %s."), the team chat
// line, the banned-name check (ValidatePlayerName 0x00819f28 against the 90
// strings of banned_names_list; the server is the only check here).
// ASSUMED (undecodable from the dump): the width of the master menu and of the
// member lists (widest row + 20), eight visible rows with scrolling, the
// question text left aligned with 20 px lines, the greyed "Please input a Team
// Name." header row, the right aligned points in the ranking, the buzzer on a
// greyed row.

import { menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import { memberRowLabel, PRIVILEGE, inTeam, type IntraRanking, type TeamMember, type TeamMembership, type TeamRank, type TeamReward } from '../net/team.ts';
import { wrapGameText } from './chat.ts';
import { DISABLED, drawListWindow, drawWindowTitle, INSET, listKey, ROW, SELECTED, TITLE_GAP, type ListItem } from './fieldwindows.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { CREATE_EDITORS, CREATE_WINDOW, GAME_LIST_WINDOW, type MenuKey, type Text } from './gamelist.ts';
import { InfoWindow } from './ingame.ts';
import { drawMenuWindow, drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';
import { CARET, caretColor, TextEditor, yesNoRect } from './titleflow.ts';

// unitxt group 15 indices (strings of the team menus) and group 11.
export const T15_TEAM = {
  info: 3,
  rankingTitle: 0x59,
  master: [0x5d, 0x5e, 0x5f, 0x60, 0x61, 0x62, 0x63],
  createIntro: 0x66,
  nameConfirm: 0x67,
  teamName: 0x68,
  nameHeader: 0x69,
  established: 0x6a,
  inUse: 0x6b,
  createFailed: 0x6c,
  promote: { list: 0x6d, confirm: 0x6e, done: 0x6f, already: 0x70, failed: 0x71 },
  demote: { list: 0x72, confirm: 0x73, done: 0x74, already: 0x75, failed: 0x76 },
  dismiss: { list: 0x77, confirm: 0x78, done: 0x79, already: 0x7a, failed: 0x7a },
  dissolveConfirm: 0x81,
  dissolved: 0x82,
  dissolveFailed: 0x83,
  leaveConfirm: 0x84,
  left: 0x85,
  otherBusiness: 0x87,
} as const;
export const T11_TEAM = { registration: 0x64, yes: 0x6e, no: 0x6f, noPlayer: 0xf1, points: 0x175 } as const;

// Position table entries (0x00971f40 + 8 * index) and data words read from the
// executable.
export const TEAM_POS = {
  createQuestion: { x: 31, y: 118, w: 572 }, // 0xe9, 0xea.x
  confirmQuestion: { x: 180, y: 240, w: 300 }, // literals of ShowTeamCreationConfirmationMenu
  otherQuestion: { x: 180, y: 80, w: 280 }, // 0x009ff50c, 0x009ff514
  teamPanel: { x: 180, y: 80, w: 280, h: 180 }, // 0x009ff50c..0x009ff518
  masterPanel: { x: 190, y: 180, w: 260, h: 120 }, // 0xeb, 0xec
  masterMenu: { x: 96, y: 333 }, // 0xc8
  memberList: { x: 190, y: 180 }, // 0xeb
} as const;
export const MAX_TEAM_NAME = 14; // TKeyboardControl(.., 0xe, ..)
export const VISIBLE_ROWS = 8; // ASSUMED
export const MEMBER_ACTIONS = ['promote', 'demote', 'dismiss'] as const;
export type MemberAction = (typeof MEMBER_ACTIONS)[number];

// What the menus ask of the connection (net/team.ts TeamClient plus the lobby).
export interface TeamHost {
  membership(): TeamMembership;
  selfGuildCard(): number;
  createTeam(name: string): Promise<number>;
  removeMember(guildCard: number): Promise<number>;
  members(): Promise<TeamMember[]>;
  setPrivilege(guildCard: number, privilege: number): Promise<number>;
  disband(): Promise<number>;
  crossRanking(): Promise<TeamRank[]>;
  // The Guild Card search (0040 / 0041, net/guildcard.ts) of one member: true when the
  // member answers (the exe's Enter on a member row, dump 720824 states 3, 0xf, 0x10).
  searchMember?(guildCard: number): Promise<boolean>;
  // Meet the User on the searched member (state 0x12): the host reconnects to the member's
  // server with the last search reply (ProcessPhaseLabel_0074f028). Called once on Enter.
  meetMember?(guildCard: number): void;
  // Team Info (0x2b, see TeamInfoWindow below): 18EA and 19EA / 1AEA answers.
  intraRanking?(): Promise<IntraRanking>;
  rewards?(owned: boolean): Promise<TeamReward[]>;
}

export interface TeamText {
  t11: Text;
  t15: Text;
  t12?: Text;
}

export function format(template: string, ...args: string[]): string {
  let i = 0;
  return template.replace(/%s/g, () => args[i++] ?? '');
}

// ShowTeamMainMenu: which rows of the counter's team list are greyed.
export function teamRowsDisabled(m: TeamMembership, clientCaps = true): [boolean, boolean, boolean, boolean] {
  const has = inTeam(m);
  const master = m.privilege === PRIVILEGE.master;
  return [has || !clientCaps, !has, has ? !master : true, has ? master : true];
}

// The member rows of the Home menu (ValidateMenuItemCondition's team entries) need a team:
// teamRowsDisabled's second row is "no team", so the opposite is in a team.
export function isInTeam(host: TeamHost | null): boolean {
  return !!host && !teamRowsDisabled(host.membership())[1];
}

// Spaces (0x20) and ideographic spaces (0x3000) are removed from the name.
export function cleanTeamName(raw: string): string {
  return [...raw].filter((c) => c !== ' ' && c !== '　').join('');
}

// --- windows ------------------------------------------------------------------------

type Rect = { x: number; y: number; w: number; h: number };

// YesNoListMenu: a text window plus a Yes / No list at the right bottom. The
// cursor starts on No; Cancel counts as No.
export class Question {
  readonly text: string;
  readonly rect: Rect;
  cursor = 1;
  result: 'yes' | 'no' | null = null;

  constructor(text: string, at: { x: number; y: number; w: number }) {
    this.text = text;
    const lines = wrapGameText(text, at.w - 2 * INSET);
    // First line 14, each further line 20 (0x00970ea4 / 0x00970ea0), +20 frame.
    this.rect = { x: at.x, y: at.y, w: at.w, h: 14 + 20 * (lines.length - 1) + 20 };
  }

  get lines(): string[] {
    return wrapGameText(this.text, this.rect.w - 2 * INSET);
  }

  key(e: MenuKey): void {
    if (this.result) return;
    if (menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') {
      this.cursor = 1 - this.cursor;
      se(SE.cursor);
    } else if (menuKeyOf(e) === 'decide') {
      se(SE.ok);
      this.result = this.cursor === 0 ? 'yes' : 'no';
    } else if (menuKeyOf(e) === 'cancel') {
      se(SE.cancel);
      this.result = 'no';
    }
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, yes: string, no: string): void {
    const r = this.rect;
    drawWindowFrame(ctx, skin.frame, r.x, r.y, r.w, r.h);
    this.lines.forEach((line, i) => drawGameText(ctx, line, r.x + INSET, r.y + INSET + i * 20));
    drawMenuWindow(ctx, skin, yesNoRect(r), [{ label: yes }, { label: no }], this.cursor);
  }
}

// GuildCardListWindow with 3 rows: the team name entry.
export class TeamNameWindow {
  name = '';
  row: 1 | 2 = 1;
  editor: TextEditor | null = null;
  result: 'register' | 'cancel' | null = null;

  // UpdateActionDataUI: Registration needs a name.
  get canRegister(): boolean {
    return this.name !== '';
  }

  key(e: MenuKey): void {
    if (this.result) return;
    const ed = this.editor;
    if (ed) {
      if (menuKeyOf(e) === 'decide') {
        this.name = cleanTeamName(ed.text);
        this.editor = null;
        this.row = this.canRegister ? 2 : 1;
        se(SE.ok);
      } else if (e.key === 'Escape') {
        this.editor = null; // the old text stays
        se(SE.cancel);
      } else if (e.key === 'Backspace') ed.backspace();
      else ed.type(e.key);
      return;
    }
    if (menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') {
      if (this.canRegister) {
        this.row = this.row === 1 ? 2 : 1;
        se(SE.cursor);
      }
    } else if (menuKeyOf(e) === 'decide') {
      se(SE.ok);
      if (this.row === 1) this.editor = new TextEditor(this.name, MAX_TEAM_NAME, false);
      else this.result = 'register';
    } else if (menuKeyOf(e) === 'cancel') {
      se(SE.cancel);
      this.result = 'cancel';
    }
  }
}

// A scrolling list with a cursor (the master menu, the member lists).
export class PickList {
  readonly items: ListItem[];
  cursor = 0;
  top = 0;
  result: 'decide' | 'cancel' | null = null;

  constructor(items: ListItem[]) {
    this.items = items;
  }

  get selected(): ListItem | undefined {
    return this.items[this.cursor];
  }

  get visible(): ListItem[] {
    return this.items.slice(this.top, this.top + VISIBLE_ROWS);
  }

  key(e: MenuKey): void {
    if (this.result) return;
    const state = { cursor: this.cursor };
    const r = listKey(e, this.items, state);
    this.cursor = state.cursor;
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + VISIBLE_ROWS) this.top = this.cursor - VISIBLE_ROWS + 1;
    if (r === 'decide') this.result = 'decide';
    else if (r === 'cancel') this.result = 'cancel';
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, x: number, y: number, title: string | null, minWidth = 0): Rect {
    const w = Math.max(minWidth, ...this.items.map((i) => gameTextWidth(i.label)), title ? gameTextWidth(title) : 0) + 2 * INSET;
    return drawListWindow(ctx, skin, x, y, w, title, this.visible, this.cursor - this.top);
  }
}

// --- the state machine --------------------------------------------------------------

type Notice = { kind: 'notice'; info: InfoWindow; next: 'close' | 'name' };

export type TeamPhase =
  | { kind: 'closed' }
  | { kind: 'other'; q: Question } // 27
  | { kind: 'createIntro'; q: Question } // 30
  | { kind: 'name'; w: TeamNameWindow } // 31
  | { kind: 'nameConfirm'; w: TeamNameWindow; q: Question } // 32
  | { kind: 'creating'; w: TeamNameWindow } // 33
  | Notice // 34, 35, 41, 44, 49.. (an info window, Enter continues)
  | { kind: 'master'; list: PickList } // 42
  | { kind: 'leaveConfirm'; q: Question } // 43
  | { kind: 'loading'; action: MemberAction } // 45, 52, 59: waiting for 09EA
  | { kind: 'pick'; action: MemberAction; list: PickList; title: string; members: TeamMember[] } // 46, 53, 60
  | { kind: 'pickConfirm'; action: MemberAction; q: Question; member: TeamMember } // 47, 54, 61
  | { kind: 'working'; action: MemberAction | 'dissolve' } // 48, 55, 62, 74: waiting for the answer
  | { kind: 'dissolveConfirm'; q: Question } // 73
  | { kind: 'ranking'; rows: RankRows }; // 39, 40

export interface RankRows {
  header: [string, string];
  rows: Array<[string, string]>;
  cursor: number;
  top: number;
}

const ACTION_TEXT = {
  promote: T15_TEAM.promote,
  demote: T15_TEAM.demote,
  dismiss: T15_TEAM.dismiss,
} as const;

export function memberFilter(action: MemberAction, m: TeamMember): boolean {
  switch (action) {
    case 'promote':
      return m.privilege < PRIVILEGE.leader;
    case 'demote':
      return m.privilege > 0 && m.privilege < PRIVILEGE.master;
    case 'dismiss':
      return m.privilege < PRIVILEGE.master;
  }
}

export class TeamMenus {
  phase: TeamPhase = { kind: 'closed' };
  private frame = 0;
  private epoch = 0; // answers of closed menus are dropped
  private readonly host: TeamHost;
  private readonly text: TeamText;
  // ShowTeamMainMenu: "Do you have any other business?" -> Yes.
  onBack: () => void = () => {};
  // close_lobby_menus: every counter and team window goes.
  onClose: () => void = () => {};
  private info: InfoWindow;

  constructor(host: TeamHost, text: TeamText) {
    this.host = host;
    this.text = text;
    this.info = this.newInfo(text.t15(T15_TEAM.info));
  }

  get open(): boolean {
    return this.phase.kind !== 'closed';
  }

  textInput(): { password: boolean } | null {
    const p = this.phase;
    if (p.kind === 'name' && p.w.editor) return { password: false };
    return null;
  }

  // handle_counter_menu_selection -> the leaf rows of the team list.
  begin(index: number): void {
    this.epoch++;
    const t15 = this.text.t15;
    const disabled = teamRowsDisabled(this.host.membership());
    if (disabled[index] ?? true) return;
    switch (index) {
      case 0:
        this.phase = { kind: 'createIntro', q: new Question(t15(T15_TEAM.createIntro), TEAM_POS.createQuestion) };
        break;
      case 1:
        this.phase = { kind: 'ranking', rows: { header: [t15(T15_TEAM.teamName), this.text.t11(T11_TEAM.points)], rows: [], cursor: 0, top: 0 } };
        void this.guard(this.host.crossRanking(), (ranks) => {
          if (this.phase.kind !== 'ranking') return;
          this.phase.rows.rows = ranks.map((r): [string, string] => [r.name, String(r.points)]);
        });
        break;
      case 2:
        this.openMaster();
        break;
      case 3:
        this.phase = { kind: 'leaveConfirm', q: new Question(t15(T15_TEAM.leaveConfirm), TEAM_POS.confirmQuestion) };
        break;
    }
  }

  close(): void {
    this.epoch++;
    this.phase = { kind: 'closed' };
  }

  private closeAll(): void {
    this.close();
    this.onClose();
  }

  // ResetLobbyStateAndShowTeamMenu_00798e98.
  private other(): void {
    this.phase = { kind: 'other', q: new Question(this.text.t15(T15_TEAM.otherBusiness), TEAM_POS.otherQuestion) };
    this.info = this.newInfo(this.text.t15(T15_TEAM.info));
  }

  private newInfo(text: string): InfoWindow {
    const w = new InfoWindow(294, 305, 342, 144); // entry 0xd5, shared with the counter
    w.set(text);
    return w;
  }

  private notice(text: string, panel: 'team' | 'master', next: 'close' | 'name' = 'close'): void {
    const p = panel === 'team' ? TEAM_POS.teamPanel : TEAM_POS.masterPanel;
    const info = new InfoWindow(p.x, p.y, p.w, p.h);
    info.set(wrapGameText(text, p.w - 2 * INSET).join('\n'));
    this.phase = { kind: 'notice', info, next };
  }

  // Runs a host call; the answer is dropped when the menus closed meanwhile.
  private guard<T>(task: Promise<T>, then: (v: T) => void, failed?: () => void): Promise<void> {
    const epoch = this.epoch;
    return task.then(
      (v) => {
        if (epoch === this.epoch) then(v);
      },
      () => {
        if (epoch === this.epoch) (failed ?? (() => this.closeAll()))();
      },
    );
  }

  private openName(): void {
    this.phase = { kind: 'name', w: new TeamNameWindow() };
  }

  private openMaster(): void {
    const t15 = this.text.t15;
    const hasRewards = false; // team_rewards[0] & 1: no reward flags are read yet
    // Master Transfer needs the 6x peer answer (state 68): greyed (see header).
    const enabled = [true, true, true, false, true, false, hasRewards];
    const items: ListItem[] = T15_TEAM.master.map((id, value) => ({ label: t15(id), value, enabled: enabled[value] }));
    this.phase = { kind: 'master', list: new PickList(items) };
  }

  private startMemberAction(action: MemberAction): void {
    this.phase = { kind: 'loading', action };
    void this.guard(this.host.members(), (members) => {
      const t = ACTION_TEXT[action];
      const rows = members.filter((m) => memberFilter(action, m));
      const items: ListItem[] = rows.length
        ? rows.map((m) => ({ label: memberRowLabel(m), value: m.guildCard, enabled: true }))
        : [{ label: this.text.t11(T11_TEAM.noPlayer), value: 0, enabled: true }];
      this.phase = { kind: 'pick', action, list: new PickList(items), title: this.text.t15(t.list), members: rows };
    });
  }

  key(e: MenuKey): void {
    const t15 = this.text.t15;
    const p = this.phase;
    switch (p.kind) {
      case 'other':
        p.q.key(e);
        if (p.q.result === 'yes') {
          this.close();
          this.onBack();
        } else if (p.q.result === 'no') this.closeAll();
        break;
      case 'createIntro':
        p.q.key(e);
        if (p.q.result === 'yes') this.openName();
        else if (p.q.result === 'no') this.other();
        break;
      case 'name':
        p.w.key(e);
        if (p.w.result === 'cancel') this.closeAll();
        else if (p.w.result === 'register') {
          this.phase = { kind: 'nameConfirm', w: p.w, q: new Question(format(t15(T15_TEAM.nameConfirm), p.w.name), TEAM_POS.confirmQuestion) };
          p.w.result = null;
        }
        break;
      case 'nameConfirm':
        p.q.key(e);
        if (p.q.result === 'yes') this.sendCreate(p.w);
        else if (p.q.result === 'no') this.other();
        break;
      case 'notice':
        if (menuKeyOf(e) === 'decide' || menuKeyOf(e) === 'cancel') {
          se(SE.ok);
          if (p.next === 'name') this.openName();
          else this.closeAll();
        }
        break;
      case 'master':
        p.list.key(e);
        if (p.list.result === 'cancel') this.closeAll();
        else if (p.list.result === 'decide') {
          const which = p.list.selected?.value ?? -1;
          p.list.result = null;
          if (which <= 2) this.startMemberAction(MEMBER_ACTIONS[which]);
          else if (which === 4) this.phase = { kind: 'dissolveConfirm', q: new Question(t15(T15_TEAM.dissolveConfirm), TEAM_POS.confirmQuestion) };
        }
        break;
      case 'leaveConfirm':
        p.q.key(e);
        if (p.q.result === 'yes') this.leave();
        else if (p.q.result === 'no') this.other();
        break;
      case 'pick':
        p.list.key(e);
        if (p.list.result === 'cancel') this.openMaster();
        else if (p.list.result === 'decide') {
          const item = p.list.selected;
          p.list.result = null;
          const member = item && p.members.find((m) => m.guildCard === item.value);
          // The "No Player" row (value 0) goes back to the master menu.
          if (!item || !member) this.openMaster();
          else this.phase = { kind: 'pickConfirm', action: p.action, member, q: new Question(format(t15(ACTION_TEXT[p.action].confirm), item.label), TEAM_POS.confirmQuestion) };
        }
        break;
      case 'pickConfirm':
        p.q.key(e);
        if (p.q.result === 'yes') this.sendMemberAction(p.action, p.member);
        else if (p.q.result === 'no') this.other();
        break;
      case 'dissolveConfirm':
        p.q.key(e);
        if (p.q.result === 'yes') this.sendDissolve();
        else if (p.q.result === 'no') this.other();
        break;
      case 'ranking':
        this.rankingKey(p.rows, e);
        break;
      case 'creating':
      case 'loading':
      case 'working':
        // Waiting for the server; Cancel leaves (the exe's handlers for these
        // states only look at the answer, so this is a browser convenience).
        if (menuKeyOf(e) === 'cancel') {
          se(SE.cancel);
          this.closeAll();
        }
        break;
      case 'closed':
        break;
    }
  }

  private rankingKey(rows: RankRows, e: MenuKey): void {
    const n = rows.rows.length;
    if ((menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') && n) {
      rows.cursor = (rows.cursor + (menuKeyOf(e) === 'up' ? n - 1 : 1)) % n;
      if (rows.cursor < rows.top) rows.top = rows.cursor;
      if (rows.cursor >= rows.top + VISIBLE_ROWS - 1) rows.top = rows.cursor - VISIBLE_ROWS + 2;
      se(SE.cursor);
    } else if (menuKeyOf(e) === 'cancel') {
      se(SE.cancel);
      this.closeAll();
    }
  }

  // 01EA (HandleLobbyMenuInput_00799c28) and the 02EA answer.
  private sendCreate(w: TeamNameWindow): void {
    const t15 = this.text.t15;
    this.phase = { kind: 'creating', w };
    void this.guard(
      this.host.createTeam(w.name),
      (code) => {
        if (code === 0) this.notice(format(t15(T15_TEAM.established), w.name), 'team');
        else if (code === 2) this.notice(format(t15(T15_TEAM.inUse), w.name), 'team', 'name');
        else this.notice(t15(T15_TEAM.createFailed), 'team');
      },
      () => this.notice(t15(T15_TEAM.createFailed), 'team'),
    );
  }

  // HandleLobbyTeamLeaveMenu_007996f8: 05EA with the own card and, at once, the
  // notice (the answer is not waited for).
  private leave(): void {
    const name = this.host.membership().name;
    void this.host.removeMember(this.host.selfGuildCard()).catch(() => {});
    this.notice(format(this.text.t15(T15_TEAM.left), name), 'master');
  }

  private sendMemberAction(action: MemberAction, member: TeamMember): void {
    const t = ACTION_TEXT[action];
    const label = memberRowLabel(member);
    this.phase = { kind: 'working', action };
    const call =
      action === 'promote' ? this.host.setPrivilege(member.guildCard, PRIVILEGE.leader) : action === 'demote' ? this.host.setPrivilege(member.guildCard, PRIVILEGE.member) : this.host.removeMember(member.guildCard);
    void this.guard(
      call,
      (code) => {
        if (code === 0) this.notice(format(this.text.t15(t.done), label, this.host.membership().name), 'master');
        // 11EA answers 5 for "already promoted / demoted"; 06EA has no such code.
        else if (code === 5 && action !== 'dismiss') this.notice(this.text.t15(t.already), 'master');
        else this.notice(this.text.t15(t.failed), 'master');
      },
      () => this.notice(this.text.t15(t.failed), 'master'),
    );
  }

  private sendDissolve(): void {
    const name = this.host.membership().name;
    this.phase = { kind: 'working', action: 'dissolve' };
    void this.guard(
      this.host.disband(),
      (code) => {
        if (code === 0) this.notice(format(this.text.t15(T15_TEAM.dissolved), name), 'master');
        else this.notice(this.text.t15(T15_TEAM.dissolveFailed), 'master');
      },
      () => this.notice(this.text.t15(T15_TEAM.dissolveFailed), 'master'),
    );
  }

  tick(): void {
    this.frame++;
    const p = this.phase;
    if (p.kind === 'notice') p.info.tick();
    if (p.kind === 'other') this.info.tick();
  }

  // --- drawing ------------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number): void {
    const p = this.phase;
    if (p.kind === 'closed') return;
    const yes = this.text.t11(T11_TEAM.yes);
    const no = this.text.t11(T11_TEAM.no);
    ctx.save();
    ctx.translate(extra / 2, 0); // menus follow the counter's centring
    switch (p.kind) {
      case 'other':
      case 'createIntro':
      case 'leaveConfirm':
      case 'pickConfirm':
      case 'dissolveConfirm':
        p.q.draw(ctx, skin, yes, no);
        break;
      case 'name':
      case 'creating':
        drawNameWindow(ctx, skin, p.w, this.text, this.frame, p.kind === 'name');
        break;
      case 'nameConfirm':
        drawNameWindow(ctx, skin, p.w, this.text, this.frame, false);
        p.q.draw(ctx, skin, yes, no);
        break;
      case 'master':
        p.list.draw(ctx, skin, TEAM_POS.masterMenu.x, TEAM_POS.masterMenu.y, null, 100);
        break;
      case 'pick':
        p.list.draw(ctx, skin, TEAM_POS.memberList.x, TEAM_POS.memberList.y, p.title);
        break;
      case 'ranking':
        drawRanking(ctx, skin, p.rows, this.text.t15(T15_TEAM.rankingTitle));
        break;
      default:
        break;
    }
    ctx.restore();
    if (p.kind === 'notice') p.info.draw(ctx, skin, extra);
    if (p.kind === 'other') this.info.draw(ctx, skin, extra);
  }
}

function drawEditor(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, frame: number): void {
  drawGameText(ctx, text, x, y + 1);
  ctx.fillStyle = caretColor(frame);
  ctx.fillRect(x + gameTextWidth(text), y, CARET.w, CARET.h);
}

export function drawNameWindow(ctx: CanvasRenderingContext2D, skin: WindowSkin, w: TeamNameWindow, text: TeamText, frame: number, active: boolean): void {
  const W = CREATE_WINDOW;
  drawWindowFrame(ctx, skin.frame, W.x, W.y, W.w, W.h);
  const cx = W.x + INSET;
  const cy = W.y + INSET + TITLE_GAP;
  const header = text.t15(T15_TEAM.nameHeader);
  const label = text.t15(T15_TEAM.teamName);
  const reg = text.t11(T11_TEAM.registration);
  if (active && !w.editor) drawSelectBar(ctx, skin.bars, cx, cy + w.row * ROW, W.w - 2 * INSET, 16);
  drawGameText(ctx, header, cx, cy + 1, DISABLED);
  drawGameText(ctx, label, cx, cy + ROW + 1);
  drawGameText(ctx, ':', cx + 154, cy + ROW + 1);
  drawGameText(ctx, w.editor ? '' : w.name, cx + 166, cy + ROW + 1);
  drawGameText(ctx, reg, cx + 202.5 - gameTextWidth(reg) / 2, cy + 2 * ROW + 1, w.canRegister ? '#ffffff' : DISABLED);
  drawWindowTitle(ctx, skin, W.x, W.y, GAME_LIST_WINDOW.title);
  if (w.editor) drawEditor(ctx, w.editor.shown, CREATE_EDITORS[1].x, CREATE_EDITORS[1].y, frame);
}

// CreateGameListMenuWindow: entry 0x28 (12, 50), 385 x 184, rows 20 px apart from
// 16 px under the top (shipselect.ts). The header row and the rows are dual
// texts (name left, points right: ASSUMED right edge of the content).
export const RANKING_WINDOW = { x: 12, y: 50, w: 385, h: 184 } as const;

export function drawRanking(ctx: CanvasRenderingContext2D, skin: WindowSkin, rows: RankRows, title: string): void {
  const W = RANKING_WINDOW;
  drawWindowFrame(ctx, skin.frame, W.x, W.y, W.w, W.h);
  const cx = W.x + INSET;
  const cy = W.y + 16;
  const cw = W.w - 2 * INSET;
  const all: Array<[string, string]> = [rows.header, ...rows.rows];
  const shown = all.slice(rows.top, rows.top + VISIBLE_ROWS);
  const row = (i: number) => rows.top + i; // index in `all`
  if (rows.rows.length) drawSelectBar(ctx, skin.bars, cx, cy + (rows.cursor + 1 - rows.top) * ROW, cw, 16);
  shown.forEach(([left, right], i) => {
    const y = cy + i * ROW + 1;
    const color = row(i) === 0 ? DISABLED : row(i) === rows.cursor + 1 ? SELECTED : '#ffffff';
    drawGameText(ctx, left, cx, y, color);
    drawGameText(ctx, right, cx + cw - gameTextWidth(right), y, color);
  });
  drawWindowTitle(ctx, skin, W.x, W.y, title);
}

// --- Home menu > Team > Team Member List (menu id 0x25) ------------------------------
//
// handle_player_menu_select team_member_list_menu (dump 700371, enum value 37) ->
// TeamMemberListMenu_Constructor_0074d8f4 (dump 720781). Its list is
// CreateChallengePlayerInfoWindowListWindow_0074ec58 (dump 721925) at
// get_gui_position(0x15) with the title unitxt (11, 0x156). The rows are the 09EA
// member list (rank, privilege, guild card, name), each "<%04d> name"
// (s_ChallengePlayerItemFormat); ChallengePlayerInfoWindowListWindow_UpdateItems_0074eddc
// (dump 722010) colours them by privilege: 0x10 / 0x20 0xff8affa3, 0x30 0xff5eb1ff,
// 0x40 0xffff6d46, others the default colour.
//
// Enter on a row (ChallengePlayerInfoWindow_ProcessState_0074d9ac, dump 720824):
//   state 3: the row's guild card is kept (+0x24) and the window goes to 0xf;
//   state 0xf: the Guild Card search 0040 for that card (SendJoinPacket_0074f008 ->
//     send_packet0x40), the "Press X" line (unitxt (12, 0x4b)) in a message box at
//     (418, 344) (dump state 0xf, 206 x 92 as the dump's locals show);
//   state 0x10: 150 frames (0x96) for the answer. The answer (the 0041 card, which
//     sets the list's title flag, dump 0074d47c) goes to state 4, the action list
//     titled unitxt (11, 0x30) at get_gui_position(0x8a) = (419, 256) (CreateMenuList
//     _0074ea28, dump 721815); no answer adds "Not Found." (unitxt (11, 0x15b)) and
//     state 0x11 waits for a key.
//   Action rows: Send Mail (11, 0x15c, always) -> state 0xb; Sent Item (11, 0x15d,
//     enabled only with the trade-state flag and another member) -> state 0x15; Meet
//     the User (11, 0x15e, enabled in the lobby) -> state 0x12.
//   Send Mail (states 0xb..0xe, ChallengePlayerInfoWindow_SendActionError_0074e154):
//     the action list hides, the keyboard (TKeyboardControl, 0xb7 units) takes the
//     mail, Enter asks "Are you sure?" (the 0xa4 confirm, Yes = value 0); Yes sends the
//     0x81 to the searched card (+0x24) through FUN_008136f0 and returns to the action
//     list; No goes back to the keyboard; Escape (state 4) returns too. The lobby runs
//     the keyboard (classic/simplemail.ts MailCompose) while phase is 'mail'.
//   Meet the User (state 0x12): ProcessPhaseLabel_0074f028 (dump 722132) -> the 0x41
//     reply's embedded 0x19 goes to the connection and the session reconnects to the
//     reply's port (ShipConnectionManager_HandlePacket0x19_007d7640, dump 812031; the
//     port side is host.meetMember -> BBSession.meetUser). 450 frames (MEET_FRAMES),
//     then the owner callback (vtable +0x1c) closes the list.
//   The confirm list Sort (11, 0x3a) with By Number / By Rank (11, 0x15f / 0x160) is
//     state 7, which only SetState_0074e9f4(3) enters; this list has no row 3, so the
//     member list does not reach it. Not ported.
// The member list itself is read-only: 08EA is the request, 09EA the answer.
//
// ASSUMED: the window sits at get_gui_position(0x15) = (13, 256), read from the
// static table at 0x00971f40 (tools/exedata.py). The table is not checked against a
// runtime write: entry 0x1b reads (200, 256) statically while the port's main menu
// uses (28, 85) at run time, so some entries are written while the game runs.
// The 8 visible rows and the width (widest row + 2 * INSET) are the PickList's.
// The 150-frame wait is the GuildCardClient's 5 s timeout (ASSUMED 30 fps).
export const TEAM_LIST_POS = { x: 13, y: 256 } as const; // 0x15, ASSUMED (see above)
export const TEAM_ACTION_POS = { x: 419, y: 256 } as const; // get_gui_position(0x8a)
export const TEAM_SEARCH_MSG_POS = { x: 418, y: 344, w: 206 } as const; // the state 0xf box
export const T11_TEAM_LIST = { title: 0x156, action: 0x30, notFound: 0x15b, sendMail: 0x15c, sentItem: 0x15d, meetUser: 0x15e } as const;
export const T12_TEAM_LIST = { pressX: 0x4b } as const;

export type MemberPhase = 'list' | 'searching' | 'notFound' | 'actions' | 'mail' | 'meet';

// The action rows' values (memberActionRows).
export const MEMBER_LEAF = { sendMail: 0, sentItem: 1, meetUser: 2 } as const;
// Meet the User (exe state 0x12 -> 0x13, dump 720824 at 0x0074da79): the phase runs while the
// frame counter (+0x28) is 450 or less; the entry tick sets it to 1, so the window closes on
// the 451st tick and calls the owner (vtable +0x1c, the Home menu's close).
export const MEET_FRAMES = 450;

// The action list's rows (CreateMenuList_0074ea28): Send Mail always; Sent Item only
// with the trade-state flag and not on the own card ((iVar5 != 1) || bVar1 greys it);
// Meet the User only in the lobby (unknown_current_map_is_lobby).
export function memberActionRows(text: Text, o: { tradeState: boolean; self: boolean; lobby: boolean }): ListItem[] {
  return [
    { label: text(T11_TEAM_LIST.sendMail), value: 0, enabled: true },
    { label: text(T11_TEAM_LIST.sentItem), value: 1, enabled: o.tradeState && !o.self },
    { label: text(T11_TEAM_LIST.meetUser), value: 2, enabled: o.lobby },
  ];
}

// The row colour of a privilege level (the exe's ARGB words, alpha dropped).
export function memberColor(privilege: number): string | undefined {
  if (privilege === 0x10 || privilege === 0x20) return '#8affa3';
  if (privilege === 0x30) return '#5eb1ff';
  if (privilege === 0x40) return '#ff6d46';
  return undefined;
}

export class TeamMemberListWindow {
  private list: PickList = new PickList([]);
  private colors = new WeakMap<ListItem, string | undefined>();
  private epoch = 0;
  private searchEpoch = 0;
  private visible = false;
  private phase: MemberPhase = 'list';
  private actions: PickList | null = null;
  private leaf: number | null = null;
  // The searched member's card (+0x24): the Send Mail target and the Meet the User card.
  private target: number | null = null;
  private frames = 0;
  private readonly title: string;
  private readonly actionTitle: string;
  private readonly pressX: string;
  private readonly notFound: string;
  private readonly actionText: Text;
  private readonly host: TeamHost;
  // trade-state: IsTradeStateFlagSet_00825abc (not wired in the port: ASSUMED never set);
  // lobby: the Team menus live in the lobby, so Meet the User is enabled.
  private readonly rules: { tradeState: boolean; lobby: boolean };

  constructor(host: TeamHost, text: TeamText & { t12: Text }, rules: { tradeState?: boolean; lobby?: boolean } = {}) {
    this.host = host;
    this.title = text.t11(T11_TEAM_LIST.title);
    this.actionTitle = text.t11(T11_TEAM_LIST.action);
    this.notFound = text.t11(T11_TEAM_LIST.notFound);
    this.pressX = text.t12(T12_TEAM_LIST.pressX);
    this.actionText = text.t11;
    this.rules = { tradeState: rules.tradeState ?? false, lobby: rules.lobby ?? true };
  }

  get open(): boolean {
    return this.visible;
  }

  // Opens the window and asks for the list (08EA). The rows appear with the answer;
  // a failed request leaves the title and no rows.
  show(): void {
    const epoch = ++this.epoch;
    this.visible = true;
    this.list = new PickList([]);
    this.phase = 'list';
    this.actions = null;
    this.target = null;
    this.host
      .members()
      .then((members) => {
        if (epoch !== this.epoch || !this.visible) return;
        const items = members.map((m) => {
          const item: ListItem = { label: memberRowLabel(m), value: m.guildCard, enabled: true };
          this.colors.set(item, memberColor(m.privilege));
          return item;
        });
        this.list = new PickList(items);
      })
      .catch(() => {});
  }

  // List: Cancel closes, Enter searches the row's member. Searching: Cancel goes back to
  // the list (the answer is then dropped). Not found: a key goes back. Actions: Cancel
  // goes back, Enter records the row (the leaf windows are not ported).
  // Returns whether the window is still open.
  key(e: MenuKey): boolean {
    if (!this.visible) return false;
    const k = menuKeyOf(e);
    switch (this.phase) {
      case 'list': {
        if (k === 'cancel') {
          this.close();
          return false;
        }
        this.list.key(e);
        const r = this.list.result;
        this.list.result = null;
        if (r === 'decide') this.enter();
        return true;
      }
      case 'searching':
        if (k === 'cancel') {
          this.searchEpoch++;
          this.phase = 'list';
        }
        return true;
      case 'notFound':
        if (k === 'cancel' || k === 'decide') this.phase = 'list';
        return true;
      case 'actions': {
        if (!this.actions) return true;
        this.actions.key(e);
        const r = this.actions.result;
        this.actions.result = null;
        if (r === 'cancel') {
          this.actions = null;
          this.phase = 'list';
        } else if (r === 'decide') {
          const row = this.actions.selected;
          if (!row?.enabled) return true;
          this.leaf = row.value as number;
          if (row.value === MEMBER_LEAF.sendMail) this.phase = 'mail';
          else if (row.value === MEMBER_LEAF.meetUser) {
            this.phase = 'meet';
            this.frames = 0;
            if (this.target !== null) this.host.meetMember?.(this.target);
          }
        }
        return true;
      }
      case 'mail':
      case 'meet':
        return true; // the keyboard (the lobby) or the phase label takes the keys
    }
  }

  // Enter on the member row: the Guild Card search (state 3 -> 0xf -> 0x10).
  private enter(): void {
    const row = this.list.selected;
    const search = this.host.searchMember;
    if (!row || !row.enabled || !search) return;
    this.phase = 'searching';
    const ep = ++this.searchEpoch;
    const target = row.value as number;
    search.call(this.host, target).then(
      (found) => this.answer(ep, target, found),
      () => this.answer(ep, target, false),
    );
  }

  private answer(ep: number, target: number, found: boolean): void {
    if (ep !== this.searchEpoch || this.phase !== 'searching' || !this.visible) return;
    if (found) {
      const self = target === this.host.selfGuildCard();
      this.actions = new PickList(memberActionRows(this.actionText, { tradeState: this.rules.tradeState, self, lobby: this.rules.lobby }));
      this.target = target;
      this.phase = 'actions';
    } else {
      this.phase = 'notFound';
    }
  }

  close(): void {
    this.epoch++;
    this.searchEpoch++;
    this.visible = false;
    this.phase = 'list';
    this.actions = null;
    this.target = null;
  }

  // The lobby's frame tick: Meet the User's phase label, then the owner callback (close).
  tick(): void {
    if (this.phase !== 'meet' || !this.visible) return;
    this.frames++;
    if (this.frames > MEET_FRAMES) this.close();
  }

  // Send Mail: the card the mail goes to while the keyboard runs (null otherwise).
  get mailTarget(): number | null {
    return this.phase === 'mail' ? this.target : null;
  }

  // The keyboard is done (sent or cancelled): the action list comes back (state 4).
  mailDone(): void {
    if (this.phase === 'mail') this.phase = 'actions';
  }

  // The rows as the answer gave them (test and draw helpers).
  get rows(): readonly ListItem[] {
    return this.list.items;
  }

  colorOf(item: ListItem): string | undefined {
    return this.colors.get(item);
  }

  // The current phase and the action list's rows / the last chosen leaf (test helpers).
  get state(): MemberPhase {
    return this.phase;
  }

  get actionRows(): readonly ListItem[] | null {
    return this.actions?.items ?? null;
  }

  get lastLeaf(): number | null {
    return this.leaf;
  }

  // The Meet the User wait, in frames (test helper).
  get meetFrames(): number {
    return this.frames;
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number): void {
    if (!this.visible) return;
    const w = Math.max(0, gameTextWidth(this.title), ...this.list.items.map((i) => gameTextWidth(i.label))) + 2 * INSET;
    ctx.save();
    ctx.translate(extra / 2, 0); // menus follow the counter's centring
    drawListWindow(ctx, skin, TEAM_LIST_POS.x, TEAM_LIST_POS.y, w, this.title, this.list.visible, this.list.cursor - this.list.top, true, (it) => this.colors.get(it));
    if (this.phase === 'searching' || this.phase === 'notFound') {
      const lines = this.phase === 'notFound' ? [this.pressX, this.notFound] : [this.pressX];
      const rows = lines.map((label) => ({ label, value: 0, enabled: true }));
      drawListWindow(ctx, skin, TEAM_SEARCH_MSG_POS.x, TEAM_SEARCH_MSG_POS.y, TEAM_SEARCH_MSG_POS.w, null, rows, -1, false);
    }
    if ((this.phase === 'actions' || this.phase === 'meet') && this.actions) {
      const labels = this.actions.items.map((i) => gameTextWidth(i.label));
      const aw = Math.max(gameTextWidth(this.actionTitle), ...labels) + 2 * INSET;
      drawListWindow(ctx, skin, TEAM_ACTION_POS.x, TEAM_ACTION_POS.y, aw, this.actionTitle, this.actions.visible, this.actions.cursor - this.actions.top, true);
    }
    ctx.restore();
  }
}

// --- Home menu > Team > Team Info (0x2b) ----------------------------------------------------
//
// ChallengePlayerInfoWindow_Constructor_0074c23c (dump 720228; the dump's name fits the
// constructor, its window is the team info one). The constructor makes a two-row list at
// get_gui_position(3) (CreateListWindow_0074c2d4, rows unitxt (11, 0x170) "Point Information"
// with value 0 and (11, 0x171) "Earned Privileges List" with value 1) and sets
// g_GuildCardMenu_IsOpen to itself. Its process FUN_0074c364 (vtable 0x00b41e08 slot 1; state
// byte at +0x1c):
//   state 1 (list): a decided row sends 18EA (row 0: FUN_007f67e0, size 8, sub 0x18, flag 0)
//        or 19EA (row 1: FUN_007f6810, size 8, sub 0x19, flag 0) and goes to state 2 / 4.
//   The answers come through the EA table (0x00a0f800: sub 0x18 -> 0x007c4ef4, sub 0x19 ->
//        0x007c4f10), which calls the window (through g_GuildCardMenu_IsOpen):
//        18EA -> SetState(3) and the points window ChallengePlayer_CreateGuildCardSearchWindow_0074fa2c
//        (FUN_0074faa4 copies the answer; its count is the answer's num_entries at +0x14, pages of 7,
//        GUI 0x1a = (299, 256) static); state 3 leaves on Cancel back to state 0 (= the list).
//        19EA -> ShowSubmenu_0074c608 -> state 5: a list at get_gui_position(3) + (0, 40) of
//        width 400 and height 140 (ListWindowObject_Initialize_007361d0), one row per reward
//        name (record +0, 0x188 bytes, the count at the answer's +8 is num_entries); the cursor
//        row's description (record +0x80) is added to the list at GUI 0x8a; no record -> one
//        row with unitxt (11, 0xee). Cancel in state 5 goes back to the list.
//   Cancel in state 1 closes the window (state 6 -> the owner's callback).
// ASSUMED: the list's static position (13, 256) is the member list's (get_gui_position(3) and
// (0x15) share the static value); the points window's rows (rank, name, points, not the exe's
// columns: its header strings are not identified); the description box at (419, 256) 260 wide;
// the reward list is a PickList (8 rows, not 7); no timeout (a late answer after a close is dropped).
// NOT traced: the points window's own key handling (paging) and its draw layout (vtable 0x00b421b0),
// the in-game "%s%d pt" notice FUN_0079f534 (state 0x4d), and the 18EA header numbers.
export const TEAM_INFO_POS = { x: 13, y: 256 } as const; // get_gui_position(3), static 0x00971f58
export const TEAM_INFO_POINTS_POS = { x: 299, y: 256 } as const; // get_gui_position(0x1a), static 0x00972010
export const TEAM_INFO_REWARDS_POS = { x: 13, y: 296, w: 400, h: 140 } as const; // (3) + (0, 40), 400 x 140
export const TEAM_INFO_DESC_POS = { x: 419, y: 256, w: 260 } as const; // ASSUMED (get_gui_position(0x8a))
export const T11_TEAM_INFO = { pointInfo: 0x170, earnedPrivileges: 0x171, none: 0xee } as const;
// Team Log (0x27, not ported): FUN_0074d618 titles its list with unitxt (11, 0x157) at
// get_gui_position(0x16) = (13, 256) static, and its rows are (11, 0x158) and (11, 0x159).
export const T11_TEAM_LOG = { title: 0x157, rows: [0x158, 0x159] } as const;

export type TeamInfoPhase = 'list' | 'waiting' | 'points' | 'rewards';

export class TeamInfoWindow {
  private visible = false;
  private epoch = 0;
  private phase: TeamInfoPhase = 'list';
  private readonly list: PickList;
  private sub: PickList | null = null;
  private description = '';
  private rewards: TeamReward[] = [];
  private readonly host: TeamHost;
  private readonly text: Text;

  constructor(host: TeamHost, text: Text) {
    this.host = host;
    this.text = text;
    this.list = new PickList([
      { label: text(T11_TEAM_INFO.pointInfo), value: 0, enabled: true },
      { label: text(T11_TEAM_INFO.earnedPrivileges), value: 1, enabled: true },
    ]);
  }

  get open(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.phase = 'list';
    this.sub = null;
    this.description = '';
    this.list.cursor = 0;
    this.list.top = 0;
  }

  close(): void {
    this.epoch++;
    this.visible = false;
    this.phase = 'list';
    this.sub = null;
  }

  get state(): TeamInfoPhase {
    return this.phase;
  }

  // The sub-list's rows (the points or the reward names) and the cursor row's description.
  get subRows(): readonly ListItem[] | null {
    return this.sub?.items ?? null;
  }

  get currentDescription(): string {
    return this.description;
  }

  // Returns whether the window is still open.
  key(e: MenuKey): boolean {
    if (!this.visible) return false;
    const k = menuKeyOf(e);
    switch (this.phase) {
      case 'list': {
        if (k === 'cancel') {
          this.close();
          return false;
        }
        this.list.key(e);
        const r = this.list.result;
        this.list.result = null;
        if (r === 'decide') {
          const row = this.list.selected;
          if (row?.enabled) this.ask(row.value === 0 ? 'points' : 'rewards');
        }
        return true;
      }
      case 'waiting':
        return true; // the exe ignores keys while the answer is pending (ASSUMED: Cancel too)
      case 'points':
      case 'rewards': {
        if (k === 'cancel') {
          this.epoch++;
          this.phase = 'list';
          this.sub = null;
          this.description = '';
          return true;
        }
        if (!this.sub) return true;
        this.sub.key(e);
        this.sub.result = null;
        if (this.phase === 'rewards') this.description = this.rewardDescription();
        return true;
      }
    }
  }

  // 18EA (points) or 19EA (rewards): the answer opens the sub-list; a failed request goes back.
  private ask(what: 'points' | 'rewards'): void {
    const epoch = ++this.epoch;
    this.phase = 'waiting';
    const answer = what === 'points' ? this.host.intraRanking?.() : this.host.rewards?.(true);
    if (!answer) {
      this.phase = 'list';
      return;
    }
    answer.then(
      (data) => {
        if (epoch !== this.epoch || !this.visible) return;
        if (what === 'points') {
          const r = data as IntraRanking;
          this.sub = new PickList(
            r.entries.length
              ? r.entries.map((e, i) => ({ label: `${memberRowLabel(e)} ${e.points}`, value: i, enabled: true }))
              : [{ label: this.text(T11_TEAM_INFO.none), value: -1, enabled: false }],
          );
          this.phase = 'points';
        } else {
          const rewards = data as TeamReward[];
          this.rewards = rewards;
          this.sub = new PickList(
            rewards.length ? rewards.map((r, i) => ({ label: r.name, value: i, enabled: true })) : [{ label: this.text(T11_TEAM_INFO.none), value: -1, enabled: false }],
          );
          this.description = this.rewardDescription();
          this.phase = 'rewards';
        }
      },
      () => {
        if (epoch !== this.epoch || !this.visible) return;
        this.phase = 'list';
        this.sub = null;
      },
    );
  }

  private rewardDescription(): string {
    const row = this.sub?.selected;
    if (!row || typeof row.value !== 'number' || row.value < 0) return '';
    return this.rewards[row.value]?.description ?? '';
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number): void {
    if (!this.visible) return;
    ctx.save();
    ctx.translate(extra / 2, 0); // menus follow the counter's centring
    this.list.draw(ctx, skin, TEAM_INFO_POS.x, TEAM_INFO_POS.y, null);
    if (this.phase === 'points' && this.sub) {
      this.sub.draw(ctx, skin, TEAM_INFO_POINTS_POS.x, TEAM_INFO_POINTS_POS.y, null);
    }
    if (this.phase === 'rewards' && this.sub) {
      this.sub.draw(ctx, skin, TEAM_INFO_REWARDS_POS.x, TEAM_INFO_REWARDS_POS.y, null, TEAM_INFO_REWARDS_POS.w);
      if (this.description) {
        const lines = wrapGameText(this.description, TEAM_INFO_DESC_POS.w - 2 * INSET).map((label) => ({ label, value: 0, enabled: false }));
        drawListWindow(ctx, skin, TEAM_INFO_DESC_POS.x, TEAM_INFO_DESC_POS.y, TEAM_INFO_DESC_POS.w, null, lines, -1, false);
      }
    }
    ctx.restore();
  }
}

