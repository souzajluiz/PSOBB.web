// The Home menu leaves that the lobby and the field share (PsoBB.exe
// handle_player_menu_select, dump Psobb.exe-05112026.c line 700118):
//   0x0E Guild Card      (GuildCardMenu, guildcardmenu.ts)
//   0x11 Chat > Shortcut (ChatShortcutMenu, chatshortcutmenu.ts; 03ED on close when an action was picked)
//   0x12 Symbol Chat     (SymbolChatList, mode 'home', symbolchatlist.ts)
//   0x13 Simple Mail     (SimpleMailMenu, simplemail.ts; Team Member List > Send Mail: MailCompose)
//   0x25 Team Member List (TeamMemberListWindow, teammenu.ts; needs a team)
//   0x27 Team Log        (TeamLogWindow, teammenu.ts; needs a team; the rows show / hide the team chat window)
//   0x29 Team Invite     (TeamInviteWindow, teammenu.ts; needs a team; 14EA list, 6xC1 invite)
//   0x2B Team Info       (TeamInfoWindow, teammenu.ts; needs a team)
//   0x2D Point Regist    (TeamPointWindow, teammenu.ts; needs a team; 6xCC in a game)
// The lobby (classic/lobby.ts) and the field (classic/fieldmenu.ts) both open them through
// this class, so the window glue is written once. The fkey path (input/shortcuts.ts,
// unknown_handle_fkey_inputs) and the main menu open the same leaves; the exe's
// ValidateMenuItemCondition_00732620 only greys the team rows out of a team (fieldmenu.ts).

import type { Lobby } from '../net/lobby.ts';
import type { GuildCardBook, GuildCardClient, GuildCardSearchResult } from '../net/guildcard.ts';
import type { SimpleMailBox } from '../net/simplemail.ts';
import { parseCharacterFile } from '../net/charfile.ts';
import { se } from '../audio/se.ts';
import { GUILD_SEARCH_OPTION, GuildCardMenu, type GuildCardHost, type UnportedAction } from './guildcardmenu.ts';
import { ChatShortcutMenu } from './chatshortcutmenu.ts';
import { MailCompose, SimpleMailMenu, type SimpleMailHost } from './simplemail.ts';
import { SymbolChatList } from './symbolchatlist.ts';
import { symbolChatRows, SYMBOL_TEXT, type SymbolRow } from './symbolchat.ts';
import { masterBusyAnswer } from '../net/team.ts';
import { MasterTransferPromptWindow, MEET_FRAMES, TeamInfoWindow, TeamInviteAnswerWindow, TeamInviteWindow, TeamLogWindow, TeamMemberListWindow, TeamPointWindow, type InviteAnswerHost, type MasterPromptHost, type TeamHost } from './teammenu.ts';
import type { TeamChat } from './teamchat.ts';
import type { WindowSkin } from './stage.ts';

export const HOME_LEAF_IDS: ReadonlySet<number> = new Set([0x0e, 0x11, 0x12, 0x13, 0x25, 0x27, 0x29, 0x2b, 0x2d]);

// What the leaves read from the session: the local player and the other players come from
// the lobby object (a Game is one: its connection, players and self).
// The session's services the leaves need (the field's are the game's: a Game is a Lobby).
export interface HomeLeafServices {
  lobby: Lobby;
  guildCards: () => GuildCardBook | null;
  guildCardClient: () => GuildCardClient | null;
  mailbox: () => SimpleMailBox | null;
  fullCharacter: () => Uint8Array | null;
  team: () => TeamHost | null;
  // Guild Card > Search > Meet the User (state 0x25): reconnects with the search result
  // (BBSession.meetUser). Optional: a host without a session leaves the row a no-op.
  meetUser?: (reply: GuildCardSearchResult) => void;
  // Sends the chat shortcut records (03ED) when the Chat > Shortcut leaf closes after an edit.
  sendShortcuts?: () => void;
  // The team chat window the Team Log row shows or hides (classic/teamchat.ts). Optional: a host without it leaves the row a no-op.
  teamChat?: () => TeamChat | null;
}

export interface HomeLeafHost extends HomeLeafServices {
  text: (group: number, index: number) => string;
}

export class HomeLeaves {
  private guildCard: GuildCardMenu | null = null;
  private shortcuts: ChatShortcutMenu | null = null;
  private mail: SimpleMailMenu | null = null;
  private symbolList: SymbolChatList | null = null;
  private teamList: TeamMemberListWindow | null = null;
  private teamInfo: TeamInfoWindow | null = null;
  private teamLog: TeamLogWindow | null = null;
  private teamInvite: TeamInviteWindow | null = null;
  private teamPoint: TeamPointWindow | null = null;
  // The invitee's prompt (6xC1 received, classic/teammenu.ts TeamInviteAnswerWindow). It takes the keys first.
  private inviteAnswer: TeamInviteAnswerWindow | null = null;
  // The Master Transfer prompt (6xCD received, classic/teammenu.ts MasterTransferPromptWindow). It takes the keys too.
  private masterPrompt: MasterTransferPromptWindow | null = null;
  // The owner's menus other than the Home leaves (the exe's quick-menu gate, 0x00717754). Set by the view.
  inviteFreeOwner: () => boolean = () => true;
  // Team Member List > Send Mail (exe states 0xb..0xe): the keyboard over the list.
  private teamMail: MailCompose | null = null;
  // Guild Card > Search > Send Mail (state 0x21): the keyboard for the result's card.
  private searchMail: MailCompose | null = null;
  // Guild Card > Search > Meet the User (state 0x25): the frames of the phase label (null when idle).
  private meetFrames: number | null = null;
  // Called when the last window goes away by its own key (the owner's menu takes the keys again).
  onAllClosed: () => void = () => {};

  private readonly host: () => HomeLeafHost | null;

  constructor(host: () => HomeLeafHost | null) {
    this.host = host;
  }

  get open(): boolean {
    return this.windowsOpen || !!this.inviteAnswer || !!this.masterPrompt;
  }

  // Any Home window but the invitee's prompt.
  private get windowsOpen(): boolean {
    return !!(this.guildCard || this.shortcuts || this.mail || this.symbolList || this.teamList || this.teamInfo || this.teamLog || this.teamInvite || this.teamPoint || this.teamMail || this.searchMail);
  }

  // The receiver's gate for a 6xC1 (net/team.ts TeamInviteReceiver): no menu open.
  inviteFree(): boolean {
    return this.inviteFreeOwner() && !this.windowsOpen && !this.inviteAnswer && !this.masterPrompt;
  }

  // Opens the leaf for a Home menu id; false when this leaf cannot open here (no session, no team).
  openLeaf(id: number): boolean {
    const h = this.host();
    if (!h) return false;
    const text = h.text;
    const self = () => ({ guildCard: h.lobby.self?.guildCardNumber ?? 0, name: h.lobby.self?.name ?? '' });
    switch (id) {
      case 0x0e: {
        const host: GuildCardHost = {
          book: h.guildCards,
          client: h.guildCardClient,
          selfGuildCard: () => h.lobby.self?.guildCardNumber ?? null,
          // The other players of the lobby or game (the add-from-player list).
          lobbyPlayers: () =>
            [...h.lobby.players.values()]
              .filter((p) => p.clientId !== h.lobby.selfId)
              .map((p) => ({ slot: p.clientId, name: p.name, guildCardNumber: p.guildCardNumber, sectionId: p.sectionId, charClass: p.charClass })),
          loggedIn: true,
          unitxt: text,
        };
        this.guildCard = new GuildCardMenu((i) => text(11, i), host);
        return true;
      }
      case 0x11: {
        // handle_player_menu_select chat_shortcut_menu (17): the save copy's 16 records.
        if (!h.fullCharacter()) {
          console.info('[classic] Chat > Shortcut: no save copy yet');
          return false;
        }
        this.shortcuts = new ChatShortcutMenu({
          text: (g, i) => text(g, i),
          full: h.fullCharacter,
          onClose: (picked) => {
            // The destructor (CloseAllListMenusAndCleanup_00754ba4): 03ED when an action was picked.
            if (picked) h.sendShortcuts?.();
          },
        });
        return true;
      }
      case 0x12: {
        // handle_player_menu_select symbol_chat_menu (0x12): the 12 saved chats. A decided row
        // previews it; the leaf's option list and icon editor are not ported.
        const raw = h.fullCharacter();
        const entries = raw ? parseCharacterFile(raw).symbolChats : [];
        const rows = symbolChatRows(entries, text);
        this.symbolList = new SymbolChatList('home', text(11, SYMBOL_TEXT.title), rows, (row) => {
          previewSymbol(row);
          return false; // the Home leaf's window stays open
        });
        return true;
      }
      case 0x13: {
        // simple_mail_menu1 (0x13): needs the connection's mailbox for its packets.
        const box = h.mailbox();
        if (!box) {
          console.info('[classic] Simple Mail: no lobby connection yet');
          return false;
        }
        const host: SimpleMailHost = {
          box,
          book: h.guildCards,
          client: h.guildCardClient,
          self,
          unitxt: text,
          // The window's destructor: the answer service packets (C7 / C8) and the unread bits.
          onClose: () => {
            box.closeWindow();
            box.store.clearUnread();
          },
        };
        this.mail = new SimpleMailMenu((i) => text(11, i), host);
        return true;
      }
      case 0x25: {
        const team = h.team();
        if (!team) {
          console.info('[classic] Team Member List: not in a team');
          return false;
        }
        this.teamList = new TeamMemberListWindow(team, {
          t11: (i) => text(0x0b, i),
          t12: (i) => text(0x0c, i),
          t15: (i) => text(0x0f, i),
        });
        this.teamList.show();
        return true;
      }
      case 0x27: {
        // handle_player_menu_select team_log_option_menu (0x27): needs a team and the team chat window.
        const team = h.team();
        const chat = h.teamChat?.() ?? null;
        if (!team || !chat) return false;
        this.teamLog = new TeamLogWindow(
          { shown: () => chat.open, window: (on) => chat.setWindow(on) },
          (i) => text(11, i),
        );
        this.teamLog.show();
        return true;
      }
      case 0x29: {
        // handle_player_menu_select team_invite_menu (0x29): the lobby's team info list (14EA) and the invite.
        const team = h.team();
        const nearby = team?.nearby;
        const invite = team?.invite;
        if (!team || !nearby || !invite) return false;
        this.teamInvite = new TeamInviteWindow(
          { nearby: () => nearby.call(team), invite: (gc) => invite.call(team, gc), teamName: () => team.teamName?.() ?? '' },
          (i) => text(11, i),
        );
        this.teamInvite.show();
        return true;
      }
      case 0x2d: {
        // handle_player_menu_select team_point_menu (0x2d): the inventory's items for the team points.
        const team = h.team();
        if (!team || !team.itemRows) return false;
        this.teamPoint = new TeamPointWindow(
          { itemRows: () => team.itemRows?.() ?? [], exchange: (id, amount) => team.exchangeItem?.(id, amount) },
          (i) => text(11, i),
        );
        this.teamPoint.show();
        return true;
      }
      case 0x2b: {
        const team = h.team();
        if (!team) return false;
        this.teamInfo = new TeamInfoWindow(team, (i) => text(0x0b, i));
        this.teamInfo.show();
        return true;
      }
      default:
        return false;
    }
  }

  // The windows' own clocks (the Team Member List's search and meet timers).
  tick(): void {
    this.tickInvite();
    this.tickMaster();
    this.teamInvite?.tick();
    // The Invite window closes itself when the invitee's answer comes (its promise), so the owner's menu gets the keys back here.
    if (this.teamInvite && !this.teamInvite.open) {
      this.teamInvite = null;
      this.settle();
    }
    if (this.teamList) {
      this.teamList.tick();
      if (!this.teamList.open) {
        this.teamList = null;
        this.settle();
      }
    }
    // Guild Card > Search > Meet the User (state 0x25, dump 715371): the entry tick sets the counter
    // to 1 and each state 0x26 tick adds one; the owner's close runs when the counter read is above
    // 0x1c2, i.e. on the 452nd tick after the key (one more than the Team Member List's count).
    if (this.meetFrames !== null) {
      this.meetFrames++;
      if (this.meetFrames > MEET_FRAMES + 1) {
        this.meetFrames = null;
        this.guildCard = null;
        this.settle();
      }
    }
  }

  // Routes a key to the open window (the caller checks `open` first).
  key(e: KeyboardEvent): void {
    const h = this.host();
    e.preventDefault();
    if (this.meetFrames !== null) return; // the phase label takes no keys (state 0x26)
    if (this.inviteAnswer) {
      this.inviteAnswer.key(e);
      if (!this.inviteAnswer.open) this.endInvite(h);
    } else if (this.masterPrompt) {
      this.masterPrompt.key(e);
      if (!this.masterPrompt.open) this.endMaster(h);
    } else if (this.searchMail) {
      const m = this.searchMail;
      m.key(e); // its callbacks may clear the field, so the check uses the local
      if (!m.open) this.searchMail = null;
    } else if (this.shortcuts) {
      this.shortcuts.key(e);
      if (!this.shortcuts.open) this.shortcuts = null;
    } else if (this.symbolList) {
      this.symbolList.key(e);
      if (!this.symbolList.open) this.symbolList = null;
    } else if (this.guildCard) {
      const action = this.guildCard.key(e);
      if (action) this.searchAction(h, action);
      if (!this.guildCard?.open) this.guildCard = null;
    } else if (this.mail) {
      this.mail.key(e);
      if (!this.mail.open) this.mail = null;
    } else if (this.teamMail) {
      const m = this.teamMail;
      m.key(e); // its callbacks may clear the field, so the check uses the local
      if (!m.open) this.teamMail = null;
    } else if (this.teamList) {
      if (!this.teamList.key(e)) this.teamList = null;
      else this.openTeamMail(h);
    } else if (this.teamInfo) {
      if (!this.teamInfo.key(e)) this.teamInfo = null;
    } else if (this.teamLog) {
      if (!this.teamLog.key(e)) this.teamLog = null;
    } else if (this.teamInvite) {
      if (!this.teamInvite.key(e)) this.teamInvite = null;
    } else if (this.teamPoint) {
      if (!this.teamPoint.key(e)) this.teamPoint = null;
    }
    this.settle();
  }

  // Team Member List > Send Mail: the keyboard opens for the searched member's card. The mail
  // goes through the session's Simple Mail sender (net/simplemail.ts send, the exe's 0x81); the
  // list's action rows come back when the keyboard ends (sent or cancelled).
  private openTeamMail(h: HomeLeafHost | null): void {
    const list = this.teamList;
    const to = list?.mailTarget ?? null;
    if (!list || to === null || this.teamMail || !h) return;
    const give = list.giveItem;
    const box = h.mailbox();
    const finish = () => {
      this.teamMail = null;
      list.mailDone();
    };
    if (!give && !box) {
      console.info('[classic] Team Send Mail: no lobby connection yet');
      finish();
      return;
    }
    this.teamMail = new MailCompose(
      (i) => h.text(11, i),
      (text) => {
        if (give) {
          this.teamMail = null;
          this.sendTeamItem(h, list, to, give, text, box);
          return;
        }
        box?.send({ guildCard: h.lobby.self?.guildCardNumber ?? 0, name: h.lobby.self?.name ?? '' }, to, text);
        finish();
      },
      finish,
    );
  }

  // Team Member List > Sent Item, Yes: the item goes first (TeamHost.sendItem, 6xCB); the text
  // is mailed only when the server answers 1 (exe state 0x1a: the mail follows the 0x60 answer,
  // e0a4). A closed gate (-1) or a refusal sends no mail. The list closes to the member list.
  private sendTeamItem(
    h: HomeLeafHost,
    list: TeamMemberListWindow,
    to: number,
    give: { itemId: number; amount: number },
    text: string,
    box: SimpleMailBox | null,
  ): void {
    const team = h.team();
    const done = (flag: number) => {
      if (flag === 1 && box) box.send({ guildCard: h.lobby.self?.guildCardNumber ?? 0, name: h.lobby.self?.name ?? '' }, to, text);
      else if (flag === 1) console.info('[classic] Team Sent Item: no lobby connection for the mail');
      list.giveDone();
    };
    if (!team?.sendItem) {
      done(-1);
      return;
    }
    team.sendItem(to, give.itemId, give.amount).then(done, () => done(-1));
  }

  // Guild Card > recent row > option list (exe states 0x21 / 0x25, dump 715298 / 715371). The
  // row's value is the recent entry's index (GuildCardClient.recent), the result is its 0041 copy.
  // Send Mail (0x6a, value 0x21): the keyboard for the result's card; Enter asks the confirm
  // (MailCompose) and the mail goes through the Simple Mail sender (0x81). The menu is back at its
  // root (state 1) while the keyboard runs. Meet the User (0x6b, value 0x25): the host reconnects
  // with the result; the menu stays up for 450 frames (tick), then closes.
  private searchAction(h: HomeLeafHost | null, action: UnportedAction): void {
    if (action.state !== GUILD_SEARCH_OPTION.keyboard && action.state !== GUILD_SEARCH_OPTION.option25) {
      console.info(`[classic] Guild Card: state 0x${action.state.toString(16)} (row ${action.card}) not ported yet`);
      return;
    }
    const reply = h?.guildCardClient()?.recent[action.card] ?? null;
    if (!this.guildCard || !h || !reply) return;
    this.guildCard.phase = 'menu';
    if (action.state === GUILD_SEARCH_OPTION.keyboard) {
      const box = h.mailbox();
      if (!box) {
        console.info('[classic] Guild Card Send Mail: no lobby connection yet');
        return;
      }
      const to = reply.guildCardNumber;
      this.searchMail = new MailCompose(
        (i) => h.text(11, i),
        (text) => {
          box.send({ guildCard: h.lobby.self?.guildCardNumber ?? 0, name: h.lobby.self?.name ?? '' }, to, text);
          this.searchMail = null;
        },
        () => {
          this.searchMail = null;
        },
      );
    } else if (action.state === GUILD_SEARCH_OPTION.option25) {
      if (!h.meetUser) {
        console.info('[classic] Guild Card Meet the User: no session');
        return;
      }
      this.meetFrames = 0;
      h.meetUser(reply);
    }
  }

  // Draws the team windows (the lobby's and the field's middle band, with the view's extra width).
  drawTeam(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number): void {
    this.inviteAnswer?.draw(ctx, skin, extra);
    this.masterPrompt?.draw(ctx, skin, extra);
    this.teamList?.draw(ctx, skin, extra);
    this.teamInfo?.draw(ctx, skin, extra);
    this.teamLog?.draw(ctx, skin, extra);
    this.teamInvite?.draw(ctx, skin, extra);
    this.teamPoint?.draw(ctx, skin, extra);
    this.teamMail?.draw(ctx, skin);
  }

  drawOther(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    this.shortcuts?.draw(ctx, skin);
    this.symbolList?.draw(ctx, skin);
    this.guildCard?.draw(ctx, skin);
    this.searchMail?.draw(ctx, skin);
    this.mail?.draw(ctx, skin);
  }

  // The windows go away at once (the owner's leave or a floor change). The mail's destructor
  // sends its answer packets, so a closed connection is tolerated.
  close(): void {
    try {
      this.mail?.dispose();
    } catch {
      // ignored: nothing to send on a closed connection
    }
    try {
      this.shortcuts?.dispose(); // the destructor's 03ED (a closed connection sends nothing)
    } catch {
      // ignored: nothing to send on a closed connection
    }
    this.shortcuts = null;
    this.guildCard = null;
    this.mail = null;
    this.teamList = null;
    this.teamInfo = null;
    this.teamLog = null;
    this.teamInvite?.close();
    this.teamInvite = null;
    this.inviteAnswer = null;
    this.masterPrompt = null;
    this.teamPoint?.close();
    this.teamPoint = null;
    this.teamMail = null;
    this.searchMail = null;
    this.meetFrames = null;
    this.symbolList = null;
  }

  private settle(): void {
    if (!this.open) this.onAllClosed();
  }

  // The invitee's prompt (classic/teammenu.ts TeamInviteAnswerWindow): the receiver's pending invite
  // opens it when the menus are free; a pending invite the menus cannot show is answered busy
  // (0x00717754, net/team.ts TeamInviteReceiver.busyTick). Runs every frame.
  private tickInvite(): void {
    const h = this.host();
    if (!h) return;
    const recv = h.lobby.teamInvites;
    h.lobby.teamInviteFree = () => this.inviteFree();
    const canOpen = this.inviteFreeOwner() && !this.windowsOpen;
    const busy = recv.busyTick(canOpen);
    if (busy) {
      this.inviteAnswer = null;
      h.lobby.conn.send(0x62, busy.target, busy.answer);
      return;
    }
    if (!this.inviteAnswer && recv.pending && canOpen) this.inviteAnswer = new TeamInviteAnswerWindow(recv.pending, this.answerHost(h));
    if (this.inviteAnswer) {
      this.inviteAnswer.tick();
      if (!this.inviteAnswer.open) this.endInvite(h);
    }
  }

  private endInvite(h: HomeLeafHost | null): void {
    this.inviteAnswer = null;
    h?.lobby.teamInvites.close();
  }

  // The Master Transfer prompt (classic/teammenu.ts MasterTransferPromptWindow), the same shape as the
  // invitee's: a pending 6xCD opens it when the menus are free; one the menus cannot show is answered
  // busy (0x00717754, LAB_00717989: 6xCE with action 1) and dropped.
  private tickMaster(): void {
    const h = this.host();
    if (!h) return;
    const recv = h.lobby.masterRequests;
    h.lobby.masterFree = () => this.inviteFree() && !this.masterPrompt;
    const canOpen = this.inviteFreeOwner() && !this.windowsOpen && !this.inviteAnswer;
    if (recv.pending && !this.masterPrompt && !canOpen) {
      const request = recv.pending;
      recv.close();
      h.lobby.conn.send(0x62, request.target, masterBusyAnswer(request.body));
      return;
    }
    if (!this.masterPrompt && recv.pending && canOpen) this.masterPrompt = new MasterTransferPromptWindow(recv.pending, this.masterHost(h));
    if (this.masterPrompt) {
      this.masterPrompt.tick();
      if (!this.masterPrompt.open) this.endMaster(h);
    }
  }

  private endMaster(h: HomeLeafHost | null): void {
    this.masterPrompt = null;
    h?.lobby.masterRequests.close();
  }

  private masterHost(h: HomeLeafHost): MasterPromptHost {
    const lobby = h.lobby;
    return {
      text: (group, index) => h.text(group, index),
      ownCard: () => h.team()?.selfGuildCard() ?? 0,
      ownName: () => lobby.self?.name ?? '',
      send: (target, body) => lobby.conn.send(0x62, target, body),
      withdrawn: () => lobby.masterRequests.withdrawn,
    };
  }

  private answerHost(h: HomeLeafHost): InviteAnswerHost {
    const lobby = h.lobby;
    return {
      text: (group, index) => h.text(group, index),
      ownCard: () => h.team()?.selfGuildCard() ?? 0,
      ownName: () => lobby.self?.name ?? '',
      send: (target, body) => lobby.conn.send(0x62, target, body),
      joinResult: () => h.team()?.joinResult?.() ?? Promise.resolve(null),
      withdrawn: () => lobby.teamInvites.withdrawn,
    };
  }
}

// The preview of a saved chat: ProcessChatMessageType_0077d880 (state 2 of the Home leaf) plays
// the row's sound only. Nothing is sent and no balloon is shown (the leaf sends from its option
// list, not ported).
function previewSymbol(row: SymbolRow): void {
  if (row.sound !== null) se(row.sound);
}
