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
// Not here yet (the Online tab has them): the Pioneer 2 NPC talk, counters and
// quests (quest/town.ts, net/quests.ts).

import type { Game } from '../net/game.ts';
import type { GameView } from '../render/gameview.ts';
import { ChatBubble, ChatLine, projectHead, type BubbleTextures } from './chat.ts';
import { PING_FRAMES } from './lobby.ts';
import { inGameSpace } from './ingame.ts';
import type { Screen, Stage, TextInputState } from './stage.ts';

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
  private extra = 0;

  constructor(view: GameView, target: HTMLElement, stage: HTMLElement, bubble: BubbleTextures) {
    this.view = view;
    this.game = view.game;
    this.target = target;
    this.stage = stage;
    this.bubble = bubble;
    this.chat = new ChatLine((text) => this.game.sendChat(text));
    view.inputBlocked = () => this.chat.open;
    this.game.on('chat', (from, gc, text) => this.chat.receive(from, gc, text, (id) => this.distanceTo(id)));
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
  update(dt: number): void {
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
    this.chat.bubbles.tick((id) => {
      const head = this.view.playerHead(id);
      return head ? projectHead(cam, head, 0, width) : null;
    });
  }

  private distanceTo(id: number): number {
    const head = this.view.playerHead(id);
    const me = this.view.playerHead(this.game.selfId);
    return head && me ? head.distanceTo(me) : 0;
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    inGameSpace(ctx, stage, (extra) => {
      this.extra = extra;
      this.chat.bubbles.draw(ctx, this.bubble);
      this.chat.input.draw(ctx, this.frame);
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

  key(e: KeyboardEvent): void {
    if (this.chat.open) {
      this.chat.key(e);
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
