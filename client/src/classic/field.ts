// A game on the classic page: the field of render/gameview.ts (the one the
// Online tab plays) on the 3D canvas under the stage, with its own HUD
// (render/fieldhud.ts draws on an overlay canvas). The stage stays clear and
// hands the keys to the 3D canvas, where the field's movement, combat, item
// and menu listeners are (the stage canvas holds the keyboard focus, and the
// touch pad / soft keyboard send their keys to it). The 3D canvas takes the
// mouse (worldPointer: the field's menus and the wheel); a press on it gives
// the focus back to the stage, so the keys keep coming here.
//
// The chat line is the lobby's (classic/chat.ts ChatLine): Space opens it, and
// while it is open the keys go to it, not to the field.
//
// The Pioneer 2 NPC talk, counters and quests are the town's
// (classic/townfield.ts, keys on the 3D canvas).
//
// The End key (the key config's Symbol Chat, role 14 = `quickmenu` in the exe,
// dump 86172) opens the quick menu (classic/quickmenuwindow.ts): the weapon and
// technique tabs of the field (the two-handed and traps tabs are not ported). The
// symbol chat picker is the main menu's Chat > Symbol Chat (classic/homeleaves.ts,
// leaf 0x12). A 6x07 from another player shows its picture over that player
// (ChatLine.receiveSymbol).

import type { Game } from '../net/game.ts';
import type { GameView } from '../render/gameview.ts';
import { KEYS } from '../input/keyconfig.ts';
import { ChatBubble, ChatLine, projectHead, type BubbleTextures } from './chat.ts';
import { PING_FRAMES } from './lobby.ts';
import { inGameSpace } from './ingame.ts';
import { parseChatShortcut, type WordSelectMessage } from '../net/chatshortcut.ts';
import { currentWordSelectTable, renderWordSelect } from '../net/wordselect.ts';
import type { SymbolChat } from '../net/symbolchat.ts';
import { QuickMenu, type QuickMenuEnv } from './quickmenuwindow.ts';
import { bandsOf, type Screen, type Stage, type TextInputState, type WindowSkin } from './stage.ts';

// What the quick menu needs from the field: its window env, the window skin, the
// character option mode (bits 16..17 of the option word), battle mode and the
// Android rule (should_have_traps_quick_menu, dump 712522). Built by FieldHud.fieldQuickEnv.
export interface FieldQuickEnv {
  skin: WindowSkin;
  menu: QuickMenuEnv;
  mode: () => number;
  battle: () => boolean;
  android: () => boolean;
}

const FRAME = 1 / 30;

export class FieldScreen implements Screen {
  transparent = true;
  worldPointer = true;
  readonly game: Game;
  readonly view: GameView;
  readonly chat: ChatLine;
  private target: HTMLElement;
  private stage: HTMLElement;
  private bubble: BubbleTextures;
  private acc = 0;
  private frame = 0;
  // The quick menu window (End key); null when closed.
  quick: QuickMenu | null = null;
  private quickEnv: FieldQuickEnv;
  private extra = 0;
  // Virtual height of the frame (480, or the phone's tall fill: stage.ts vh).
  private vh = 480;
  // A phone in portrait: the 3D view fills the tall box and the HUD keeps its
  // anchors (stage.ts phoneFill).
  readonly phoneLayout: boolean;
  readonly phoneFill: boolean;

  constructor(view: GameView, target: HTMLElement, stage: HTMLElement, bubble: BubbleTextures, phone: boolean, quick: FieldQuickEnv) {
    this.phoneLayout = phone;
    this.phoneFill = phone;
    this.view = view;
    this.game = view.game;
    this.target = target;
    this.stage = stage;
    this.bubble = bubble;
    this.quickEnv = quick;
    this.chat = new ChatLine((text) => this.game.sendChat(text));
    this.chat.sendSymbol = (chat) => this.sendSymbolChat(chat);
    this.chat.sendWord = (message) => {
      this.game.sendWordSelect(message);
      this.showWord(this.game.selfId, message);
    };
    this.game.on('wordSelect', (clientId, message) => this.showWord(clientId, message));
    // The team chat window (F9 / F10) and its sender name (classic/teamchat.ts).
    this.chat.team = view.teamChat;
    this.chat.teamSender = () => this.game.playerName(this.game.selfId);
    view.inputBlocked = () => this.chat.open || this.quick !== null;
    // The chat shortcuts (Shift+F or the F keys in the chat form, render/fieldhud.ts key()).
    view.chatShortcut = (index, full) => {
      this.chat.useShortcut(parseChatShortcut(full, index));
    };
    this.game.on('chat', (from, gc, text) => this.chat.receive(from, gc, text, (id) => this.distanceTo(id)));
    this.game.on('symbolChat', (clientId, chat) => this.chat.receiveSymbol(clientId, this.game.playerName(clientId), chat, (id) => this.distanceTo(id)));
    // A press on the 3D canvas keeps the focus here: the canvas focuses itself
    // on pointerdown (LobbyView) and the browser would take the focus on the
    // mousedown default, so that default is cancelled and the stage takes it.
    target.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.stage.focus();
    });
  }

  // The field runs on the 3D canvas's own loop; here the ping_server (see
  // lobby.ts PING_FRAMES) and the balloons.
  update(dt: number, stage: Stage): void {
    this.vh = stage.vh;
    this.acc += dt;
    while (this.acc >= FRAME) {
      this.acc -= FRAME;
      this.tick();
    }
  }

  private tick(): void {
    if (++this.frame % PING_FRAMES === 0) this.game.conn.send(0x1d, 0);
    this.chat.tickCooldown();
    const cam = this.view.camera;
    const width = 640 + this.extra;
    ChatBubble.screenW = width;
    ChatBubble.screenH = this.vh;
    this.chat.bubbles.tick((id) => {
      const head = this.view.playerHead(id);
      return head ? projectHead(cam, head, 0, width, this.vh) : null;
    });
  }

  private distanceTo(id: number): number {
    const head = this.view.playerHead(id);
    const me = this.view.playerHead(this.game.selfId);
    return head && me ? head.distanceTo(me) : 0;
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const bands = bandsOf(stage.vh, stage.fill);
    inGameSpace(ctx, stage, (extra) => {
      this.extra = extra;
      this.chat.bubbles.draw(ctx, this.bubble);
      // The chat line sits at the bottom of the screen (stage.ts bandsOf).
      ctx.save();
      ctx.translate(0, bands.bottom);
      this.chat.input.draw(ctx, this.frame);
      ctx.restore();
      this.quick?.draw(ctx, this.quickEnv.skin);
    });
  }

  textInput(): TextInputState | null {
    return this.chat.open ? { password: false, chat: true } : null;
  }

  private forward(e: KeyboardEvent): void {
    const copy = new KeyboardEvent(e.type, {
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      bubbles: true,
      cancelable: true,
    });
    if (!this.target.dispatchEvent(copy)) e.preventDefault();
  }

  // The End key: the quick menu. The character option mode and the traps rule are read
  // when it opens (quick_menu_constructor, dump 711543).
  private openQuickMenu(): void {
    const q = this.quickEnv;
    const android = q.android();
    this.quick = new QuickMenu(q.menu, { lobby: false, mode: q.mode(), traps: q.battle() || android, android });
  }

  // The 6x07 to the room and the sender's own balloon (the shortcut and the picker share it).
  // A word select balloon: a received 6x74, or the sender's own (send_chat_message_word_select
  // calls checked_call_packet0x60_subcommand, which runs the handler locally too, dump 664328).
  private showWord(clientId: number, message: WordSelectMessage): void {
    const names = (slot: number) => this.game.playerName(slot);
    const text = renderWordSelect(message, currentWordSelectTable(), names);
    this.chat.receiveWord(clientId, this.game.playerName(clientId), text, (id) => this.distanceTo(id));
  }

  private sendSymbolChat(chat: SymbolChat): void {
    this.game.sendSymbolChat(chat);
    this.chat.receiveSymbol(this.game.selfId, this.game.playerName(this.game.selfId), chat, (id) => this.distanceTo(id));
  }

  key(e: KeyboardEvent): void {
    if (this.chat.open) {
      this.chat.key(e);
      return;
    }
    if (this.quick) {
      e.preventDefault();
      this.quick.key(e);
      if (!this.quick.open) {
        this.quick = null;
        this.quickEnv.menu.techOrder.commit?.(); // the list's close after a swap (ED 06, dump 711530)
      }
      return;
    }
    if (KEYS.symbolChat && e.key.toLowerCase() === KEYS.symbolChat) {
      e.preventDefault();
      this.openQuickMenu();
      return;
    }
    // Input Start (role 9, Space by default): none with Keyboard Controls OFF.
    if (KEYS.chat && e.key.toLowerCase() === KEYS.chat) {
      e.preventDefault();
      this.chat.begin();
      return;
    }
    this.forward(e);
  }

  keyUp(e: KeyboardEvent): void {
    this.forward(e);
  }

  blur(): void {
    this.target.dispatchEvent(new FocusEvent('blur'));
  }

  leave(): void {
    this.blur();
  }
}
