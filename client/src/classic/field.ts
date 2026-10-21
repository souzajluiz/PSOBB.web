// A game on the classic page: the field of render/gameview.ts (the one the
// Online tab plays) on the 3D canvas under the stage, with its own HUD
// (render/fieldhud.ts draws on an overlay canvas). The stage stays clear and
// hands the keys to the 3D canvas, where the field's movement, combat, item
// and menu listeners are (the stage canvas holds the keyboard focus, and the
// touch pad / soft keyboard send their keys to it).
//
// The Pioneer 2 NPC talk, counters and quests are the town's (classic/townfield.ts,
// keys on the 3D canvas). Not here yet: the chat line, the mouse (the 3D canvas
// does not take pointer events under the stage).

import type { Game } from '../net/game.ts';
import type { GameView } from '../render/gameview.ts';
import { PING_FRAMES } from './lobby.ts';
import type { Screen } from './stage.ts';

const FRAME = 1 / 30;

export class FieldScreen implements Screen {
  transparent = true;
  readonly game: Game;
  readonly view: GameView;
  private target: HTMLElement;
  private acc = 0;
  private frame = 0;

  constructor(view: GameView, target: HTMLElement) {
    this.view = view;
    this.game = view.game;
    this.target = target;
  }

  // The field runs on the 3D canvas's own loop; here only ping_server (see
  // lobby.ts PING_FRAMES).
  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= FRAME) {
      this.acc -= FRAME;
      if (++this.frame % PING_FRAMES === 0) this.game.conn.send(0x1d, 0);
    }
  }

  draw(): void {}

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
