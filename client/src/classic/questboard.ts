// The Quest Board window of the field main menu (Item Pack > Quest Board, menu
// id 0xF, classic/fieldmenu.ts; enabled only while a quest runs,
// g_QuestStarted), PsoBB.exe (Ephinea 1.25.13):
//
// handle_player_menu_select builds ChallengePlayerListWindow_Constructor
// _00754294 (vtable 0x00b42600), which sets bit 0x10 of the HUD's flags (the
// status window closes, classic/hud.ts STATUS_HIDING_FLAGS; the destructor
// ChallengePlayerListWindow_Destructor_007541f8 clears it) and builds the
// list window create_quest_board_hud_menu (0x007544f8, vtable 0x00b42668):
// GUI position 0x73 = (13, 256), template 0x009f4684 = {434, 184, ...,
// elements 0x009f4520, flags 3 (opens with SE 0x572, closes with 0x573)},
// titled unitxt group 11 0x3E (ChatShortcutMenuWindow_SetTitle_00761320).
// Its eight elements, relative to the content (the window + 10, W = 414,
// UiTextGeometryUpdate_0071b900):
//   0  text (204, 6), white: the quest's name (get_quest_name) centred on
//      x 204 (width * -0.5 + 204: 0x00973f84 / 0x00973f88);
//   1  text (379, 53), white, hidden at first: the selected item's name
//      (g_QuestNames_00a958e0 + index * 0x44, set_quest_board_handler) with
//      its right edge on x 379 (QuestListWindow_SetSelectedText_00754954,
//      0x00973f78);
//   2..7  56 x 56 images of texlist 0x00a983d8 (f256_hyouji.prs) texture 2 at
//      texel (151, 0), one per slot 0..5, at x 33, 97, 161, 225, 289, 386,
//      y 91; hidden unless the slot's register (r74 + slot,
//      get_quest_board_slot_enabled_007544d0: quest_read_register(0x4A + slot)
//      != 0) is set when the window opens. They grow from their centre as the
//      opening wipe passes them (unknown_render_sdjz_hud_icons: scale =
//      reveal / (w * 3.5), at most 0.5 = full size).
// With no slot set, the window flags bit 4 (+0x60): no selection, no decide.
// Otherwise the selection (+0x61, 0xFF at first) moves to the next set slot:
// +1 each try, 7 wrapping to 1, over slots 0..6 (one more than the
// elements); QuestListWindowUpdate_0075472c does it again every frame while
// the selected slot is not set (bit 4 clear).
// Keys (QuestListWindowUpdate_0075472c, while +0x60 bit 1 is clear): Left /
// Right (g_KeyboardSharedState 10 / 11, repeat 6 / 5) play SE 0x56F and move
// -1 / +1 over slots 0..5 wrapping, skipping the slots not set; decide (0xC /
// 0x15, QuestListWindow_ConfirmSelection_00754998) plays 0x570 and sets bit
// 1 unless bit 4; cancel (0xD, GuildCardListWindow_Cancel_0074943c) plays
// 0x585 and sets bit 2.
// The owner (ChallengePlayerListWindow_Process_00754380, state +0x1c):
//   0 / 1  clear bit 1, then 2;
//   2      bit 2: the main menu takes over again (its vtable + 0x1c), 5;
//          bit 1: 3;
//   3      CreateQuestThread_006bcdec(label of the selected item): a thread
//          on quest_run_thread_2 (QuestThread3), then 4;
//   4      while the thread lives the board ignores its keys (bit 1 stays,
//          cancel included); the thread's disp_msg_qb / add_msg show the
//          quest board text at GUI 0x74 (quest/questui.ts) and wait for the
//          decide key, and its `list` takes the arrows / decide: this window
//          hands the keys to the quest overlay (QuestBoardEnv.questKey). A
//          `message` / `window_msg` waits until the menu is closed (the
//          runners check is_menu_open first); once the thread ends, 1.
// Drawing (GuildCardSearchWindow_Render_007549c8): the frame, the title,
// then (register_quest_board_line_primitives, while the counter c >= 0 and
// the selected slot is set) the cursor around the selected slot
// (ChatShortcutMenuWindow_RenderButtonBackground_0075afb8: four 12 x 12
// corners of texture 2, UV (0.8711, 0)-(0.9180, 0.0469) and the next ones,
// pulled in by (frame & 15) * 0.3) and a line strip in 0xFF7E00 from the
// slot's top centre (+28, +7: 0x00973f64 / 0x00973f60) to the selected name
// (its x, its y + 20: 0x00973f5c) and along under it; both fade in over 6
// frames (alpha = c * 255 / 6, truncated: 0x00973f6c / 0x00974354); then the
// elements.

import { se as playSe, SE } from '../audio/se.ts';
import { plainText } from '../quest/questui.ts';
import type { QuestBoardItem } from '../quest/vm.ts';
import { drawWindowTitle, INSET } from './fieldwindows.ts';
import { drawGameText, gameTextWidth, GAME_TEXT } from './gametext.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';
import { clipReveal, WindowAnim, withWindowAnim } from './windowanim.ts';

export const QUEST_BOARD_MENU_ID = 0xf;
export const QUEST_BOARD_WINDOW = { x: 13, y: 256, w: 434, h: 184 } as const; // GUI 0x73, 0x009f4684
export const HUD_FLAG_QUEST_BOARD = 0x10;
export const QUEST_BOARD_TITLE = 0x3e; // unitxt group 11
export const SLOT_REGISTER = 0x4a; // r74
export const SLOT_COUNT = 6; // elements 2..7
export const SLOT_LIMIT = 7; // get_quest_board_slot_enabled: 0..6
export const SLOT_X = [33, 97, 161, 225, 289, 386] as const;
export const SLOT_Y = 91;
export const SLOT_SIZE = 56;
export const SLOT_UV = { u: 151, v: 0 } as const; // f256_hyouji.prs texture 2
export const QUEST_NAME_POS = { x: 204, y: 6 } as const;
export const ITEM_NAME_POS = { right: 379, y: 53 } as const;
export const LINE_COLOR = '#ff7e00';
export const LINE_FROM = { x: 28, y: 7 } as const;
export const LINE_DROP = 20;
export const FADE_FRAMES = 6;
export const CURSOR_CORNER = 12;
export const CURSOR_PULSE = 0.3;
// Corner texels (texture 2): top left, top right, bottom right, bottom left.
export const CURSOR_UV = [
  [223, 0],
  [235, 0],
  [235, 12],
  [223, 12],
] as const;
export const ICON_GROW = 3.5; // 0x00970f0c
export const ICON_FULL = 0.5; // g_HudIconMaxScale

// A quest thread as the board sees it.
export interface QuestBoardThread {
  readonly done: boolean;
}

// What the board needs of the quest VM (quest/vm.ts QuestVM).
export interface QuestBoardVM {
  readonly questBoard: readonly QuestBoardItem[];
  readonly regsI: Int32Array;
  // CreateQuestThread_006bcdec: runner 2 (quest_run_thread_2).
  startThread(label: number, runner: 2): QuestBoardThread | null;
}

export interface QuestBoardEnv {
  vm: () => QuestBoardVM | null;
  questName: () => string;
  text: (group: number, index: number) => string;
  setHudFlag: (bit: number, on: boolean) => void;
  // The quest overlay's keys (its lists, the board text's decide) while the
  // item's thread runs; true when used.
  questKey: (e: KeyboardEvent) => boolean;
}

export interface QuestBoardTextures {
  bars: CanvasImageSource; // f256_hyouji.prs texture 2
}

// ChallengePlayerListWindow_Process_00754380 states (+0x1c).
export type QuestBoardState = 0 | 1 | 2 | 3 | 4 | 5;

export class QuestBoardWindow {
  readonly anim = new WindowAnim(false, false);
  state: QuestBoardState = 0;
  // +0x60: bit 1 decided, 2 cancelled, 4 nothing to choose.
  flags = 0;
  // +0x61: the selected slot (-1 = none).
  cursor = -1;
  // Slots whose image shows (fixed when the window opens).
  readonly shown: readonly boolean[];
  thread: QuestBoardThread | null = null;
  windowSpeed = 1;
  private frame = 0; // g_FrameCounter, for the cursor's pulse
  private destroyed = false;
  private env: QuestBoardEnv;
  private sound: (id: number) => void;

  // `sound`: the window's SE 0x572 / 0x573 and the keys' 0x56F / 0x570 / 0x585.
  constructor(env: QuestBoardEnv, windowSpeed = 1, sound: (id: number) => void = playSe) {
    this.env = env;
    this.windowSpeed = windowSpeed;
    this.sound = sound;
    this.anim.se = sound;
    // create_quest_board_hud_menu.
    this.shown = Array.from({ length: SLOT_COUNT }, (_, i) => this.slotSet(i));
    if (!this.shown.some((s) => s)) this.flags |= 4;
    else if (!this.slotSet(this.cursor)) this.nextSet();
    this.anim.open(windowSpeed);
    env.setHudFlag(HUD_FLAG_QUEST_BOARD, true);
  }

  // get_quest_board_slot_enabled_007544d0.
  slotSet(slot: number): boolean {
    if (slot < 0 || slot >= SLOT_LIMIT) return false;
    return (this.env.vm()?.regsI[SLOT_REGISTER + slot] ?? 0) !== 0;
  }

  // The item of a slot (set_quest_board_handler), if any.
  item(slot: number): QuestBoardItem | null {
    return this.env.vm()?.questBoard.find((it) => it.index === slot) ?? null;
  }

  // The selected item's name element (hidden with bit 4).
  get itemName(): string | null {
    return this.flags & 4 ? null : plainText(this.item(this.cursor)?.name ?? '');
  }

  // The board takes no keys (+0x60 bit 1: decided, or the item's thread runs).
  get locked(): boolean {
    return (this.flags & 1) !== 0;
  }

  // The window is done (cancelled): the main menu takes over again.
  get finished(): boolean {
    return this.state === 5;
  }

  // The next set slot: +1, 7 wrapping to 1 (the loops of
  // create_quest_board_hud_menu and QuestListWindowUpdate_0075472c). The exe
  // spins forever when no slot is set any more; here the selection stays.
  private nextSet(): void {
    let i = this.cursor;
    for (let n = 0; n < 2 * SLOT_LIMIT; n++) {
      i += 1;
      if (i > 6) i -= 6;
      if (this.slotSet(i)) {
        this.cursor = i;
        return;
      }
    }
  }

  // Left / Right: -1 / +1 over slots 0..5, wrapping, to a set slot.
  private move(delta: number): void {
    let i = this.cursor;
    for (let n = 0; n < 2 * SLOT_LIMIT; n++) {
      i += delta;
      if (i < 0) i += 6;
      if (i > 5) i -= 6;
      if (this.slotSet(i)) {
        this.cursor = i;
        return;
      }
    }
  }

  // QuestListWindowUpdate_0075472c's keys. Returns false for a key it does
  // not take (the menu ignores it too).
  key(e: KeyboardEvent): boolean {
    if (this.destroyed) return false;
    if (this.locked) {
      // The item's thread reads the keys itself (its board text, its list).
      if (this.state === 4) this.env.questKey(e);
      return true;
    }
    const left = e.key === 'ArrowLeft';
    const right = e.key === 'ArrowRight';
    if (left || right) {
      if (!(this.flags & 4)) {
        this.sound(SE.cursor);
        this.move(right ? 1 : -1);
      }
      return true;
    }
    if (e.key === 'Enter') {
      // QuestListWindow_ConfirmSelection_00754998.
      if (!(this.flags & 4)) {
        this.sound(SE.ok);
        this.flags |= 1;
      }
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Escape') {
      // GuildCardListWindow_Cancel_0074943c.
      this.sound(SE.cancel);
      this.flags |= 2;
      return true;
    }
    return true;
  }

  // One frame: ChallengePlayerListWindow_Process_00754380, then the list
  // window's update (the selection follows the registers, the animation).
  tick(): void {
    this.frame++;
    if (!this.destroyed) this.process();
    if (!this.destroyed && !(this.flags & 1) && !(this.flags & 4) && !this.slotSet(this.cursor)) this.nextSet();
    this.anim.tick(this.windowSpeed);
  }

  private process(): void {
    switch (this.state) {
      case 0:
      case 1:
        this.flags &= ~1;
        this.state = 2;
        break;
      case 2:
        if (this.flags & 2) this.state = 5;
        else if (this.flags & 1) this.state = 3;
        break;
      case 3: {
        const label = this.item(this.cursor)?.label;
        // An empty slot has no label here (the exe would start its stale
        // entry); the board takes its keys again.
        this.thread = label === undefined ? null : (this.env.vm()?.startThread(label, 2) ?? null);
        this.state = 4;
        this.waitThread();
        break;
      }
      case 4:
        this.waitThread();
        break;
    }
  }

  private waitThread(): void {
    if (this.thread && !this.thread.done) return;
    this.thread = null;
    this.state = 1;
  }

  // The window is destroyed (the menu took over again, closed, or the floor
  // changed): ChallengePlayerListWindow_Destructor_007541f8 clears the HUD
  // flag and closes the list window (its close animation and SE 0x573).
  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.env.setHudFlag(HUD_FLAG_QUEST_BOARD, false);
    this.anim.close();
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: QuestBoardTextures): void {
    const r = QUEST_BOARD_WINDOW;
    const a = this.anim;
    const cx = r.x + INSET;
    const cy = r.y + INSET;
    const W = r.w - 2 * INSET;
    withWindowAnim(ctx, a, r.x, r.y, r.w, r.h, () => {
      drawWindowFrame(ctx, skin.frame, r.x, r.y, r.w, r.h);
      drawWindowTitle(ctx, skin, r.x, r.y, this.env.text(11, QUEST_BOARD_TITLE));
      const name = this.itemName;
      const lines = name ? name.split('\n') : [];
      const nameW = Math.max(0, ...lines.map(gameTextWidth));
      const nameX = ITEM_NAME_POS.right - nameW;
      const c = a.c;
      const slot = this.cursor;
      if (c >= 0 && this.slotSet(slot) && slot < SLOT_COUNT) {
        const alpha = c < FADE_FRAMES ? Math.floor((c * 255) / FADE_FRAMES) / 255 : 1;
        this.drawCursor(ctx, tex, cx + SLOT_X[slot], cy + SLOT_Y, alpha);
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + SLOT_X[slot] + LINE_FROM.x, cy + SLOT_Y + LINE_FROM.y);
        ctx.lineTo(cx + nameX, cy + ITEM_NAME_POS.y + LINE_DROP);
        ctx.lineTo(cx + nameX + nameW, cy + ITEM_NAME_POS.y + LINE_DROP);
        ctx.stroke();
        ctx.restore();
      }
      // Elements in template order.
      const quest = plainText(this.env.questName());
      const questX = QUEST_NAME_POS.x - gameTextWidth(quest) / 2;
      this.wiped(ctx, questX, QUEST_NAME_POS.y, W, cx, cy, () => drawGameText(ctx, quest, cx + questX, cy + QUEST_NAME_POS.y));
      if (name) this.wiped(ctx, nameX, ITEM_NAME_POS.y, W, cx, cy, () => drawGameText(ctx, name, cx + nameX, cy + ITEM_NAME_POS.y), lines.length);
      for (let i = 0; i < SLOT_COUNT; i++) {
        if (!this.shown[i]) continue;
        const k = Math.min(ICON_FULL, a.reveal(SLOT_X[i], SLOT_Y, W) / (SLOT_SIZE * ICON_GROW));
        if (k <= 0) continue;
        const x = cx + SLOT_X[i] + SLOT_SIZE * (ICON_FULL - k);
        const y = cy + SLOT_Y + SLOT_SIZE * (ICON_FULL - k);
        ctx.drawImage(tex.bars, SLOT_UV.u, SLOT_UV.v, SLOT_SIZE, SLOT_SIZE, x, y, SLOT_SIZE * 2 * k, SLOT_SIZE * 2 * k);
      }
    });
  }

  // A text element under the opening wipe.
  private wiped(ctx: CanvasRenderingContext2D, ex: number, ey: number, W: number, cx: number, cy: number, draw: () => void, lines = 1): void {
    ctx.save();
    if (clipReveal(ctx, cx + ex, cy + ey, this.anim.reveal(ex, ey, W), (lines - 1) * GAME_TEXT.lineHeight + GAME_TEXT.cell)) draw();
    ctx.restore();
  }

  // ChatShortcutMenuWindow_RenderButtonBackground_0075afb8 (56 px, pulse 0.3).
  private drawCursor(ctx: CanvasRenderingContext2D, tex: QuestBoardTextures, x: number, y: number, alpha: number): void {
    const k = (this.frame & 15) * CURSOR_PULSE;
    const far = SLOT_SIZE - CURSOR_CORNER - k;
    const at = [
      [k, k],
      [far, k],
      [far, far],
      [k, far],
    ] as const;
    ctx.save();
    ctx.globalAlpha *= alpha;
    at.forEach(([dx, dy], i) => {
      const [u, v] = CURSOR_UV[i];
      ctx.drawImage(tex.bars, u, v, CURSOR_CORNER, CURSOR_CORNER, x + dx, y + dy, CURSOR_CORNER, CURSOR_CORNER);
    });
    ctx.restore();
  }
}
