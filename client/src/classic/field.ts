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
// The symbol chat key (the key config's Symbol Chat, End by default) opens the
// 12-row picker (classic/symbolchatlist.ts, mode 'chat'); a decided row is sent
// (Game.sendSymbolChat) and shown over the player too. A 6x07 from another player
// shows its picture over that player (ChatLine.receiveSymbol).

import type { Game } from '../net/game.ts';
import type { GameView } from '../render/gameview.ts';
import type { SymbolChatEntry } from '../net/symbolchat.ts';
import { KEYS } from '../input/keyconfig.ts';
import { ChatBubble, ChatLine, projectHead, type BubbleTextures } from './chat.ts';
import { PING_FRAMES } from './lobby.ts';
import { inGameSpace } from './ingame.ts';
import { symbolChatRows, SYMBOL_TEXT, type SymbolRow } from './symbolchat.ts';
import { SymbolChatList } from './symbolchatlist.ts';
import { bandsOf, type Screen, type Stage, type TextInputState, type WindowSkin } from './stage.ts';

// What the picker needs from the screen: the window skin, the saved chats of the
// character and the unitxt texts (group 11).
export interface FieldSymbolEnv {
  skin: WindowSkin;
  symbolChats: () => readonly SymbolChatEntry[];
  text: (group: number, index: number) => string;
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
  private symbolEnv: FieldSymbolEnv;
  symbolList: SymbolChatList | null = null;
  private extra = 0;
  // Virtual height of the frame (480, or the phone's tall fill: stage.ts vh).
  private vh = 480;
  // A phone in portrait: the 3D view fills the tall box and the HUD keeps its
  // anchors (stage.ts phoneFill).
  readonly phoneLayout: boolean;
  readonly phoneFill: boolean;

  constructor(view: GameView, target: HTMLElement, stage: HTMLElement, bubble: BubbleTextures, phone: boolean, symbol: FieldSymbolEnv) {
    this.phoneLayout = phone;
    this.phoneFill = phone;
    this.view = view;
    this.game = view.game;
    this.target = target;
    this.stage = stage;
    this.bubble = bubble;
    this.symbolEnv = symbol;
    this.chat = new ChatLine((text) => this.game.sendChat(text));
    view.inputBlocked = () => this.chat.open || this.symbolList !== null;
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
      this.symbolList?.draw(ctx, this.symbolEnv.skin);
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

  // The End-key picker: a decided row goes to the room, and the sender's own balloon shows it too.
  private openSymbolList(): void {
    const rows = symbolChatRows(this.symbolEnv.symbolChats(), this.symbolEnv.text);
    this.symbolList = new SymbolChatList('chat', this.symbolEnv.text(11, SYMBOL_TEXT.title), rows, (row) => this.sendSymbol(row));
  }

  private sendSymbol(row: SymbolRow): void {
    if (!row.chat) return;
    this.game.sendSymbolChat(row.chat);
    this.chat.receiveSymbol(this.game.selfId, this.game.playerName(this.game.selfId), row.chat, (id) => this.distanceTo(id));
  }

  key(e: KeyboardEvent): void {
    if (this.chat.open) {
      this.chat.key(e);
      return;
    }
    if (this.symbolList) {
      e.preventDefault();
      this.symbolList.key(e);
      if (!this.symbolList.open) this.symbolList = null;
      return;
    }
    if (KEYS.symbolChat && e.key.toLowerCase() === KEYS.symbolChat) {
      e.preventDefault();
      this.openSymbolList();
      return;
    }
    if (e.key === ' ') {
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
