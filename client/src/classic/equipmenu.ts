// Item Pack > Equip: the slot list, the item list for one slot and the item
// description, as PsoBB.exe (Ephinea 1.25.13) runs them (main menu id 9,
// handle_player_menu_select -> EquipmentMenu_Constructor_0074aa48; update
// 0x0074aba4, vtable 0x00b41c00).
//
// Windows (position table 0x00971f40):
//   - Equip (slots): entry 0 = (13, 256), 308 x 184 (0x009738e0), title
//     unitxt group 11 [0x38] (EquipListWindow_Constructor_0074bb28).
//   - the description: entry 2 = (324, 256), 240 x 184 (0x009f2b58)
//     (CreateEquipListWindowObject_00725d18), the item in the selected slot
//     (ListWindowObject_UpdateItemDisplay_0074aee0) or the selected item of
//     the item list (UpdateEquipListWindowSelectedGameIndex_0074aec0).
//   - the item list: entry 1 = (13, 317), 308 x 124 (0x00973918), title [0x37]
//     (CreateEquipListWindow_0074ae04).
//
// Slot rows (EquipmentMenu_UpdateSlotDisplay_0074bc00), in this order:
// weapon (6), armor (2), one row per unit slot of the equipped armor (9..,
// data1[5] of the armor; none without armor), shield (3), mag (1). A filled
// slot is the item's Item Pack row (InitializeItemObject_0072bdd4); an empty
// one only its category icon in 0xffaaaaaa: weapon by class (hunter 0, ranger
// 1, force 2, GetItemDisplayCategory_0074be3c), armor 0xB, unit 4, shield 0xA,
// mag 3.
//
// Item list per slot: weapons (group 0) for the weapon, mags (2) for the mag,
// armors (1/1), shields (1/2), units (1/3) for the unit slots, in inventory
// order; an item the character cannot equip stays listed but is disabled
// (EquipListWindow_Finalize_0074b8c4 -> ValidateItemInstanceForEquip).
//
// States (0x0074aba4): 1 rebuild the slot list -> 2 browse slots (Backspace
// returns to the main menu, Enter -> 3) -> 3 the slot list shrinks to the
// chosen row and the item list opens -> 4 browse items (Backspace -> 1,
// Enter -> 5) -> 5 HandleItemEquipSwap_0074ad94 -> 1:
//   the item already in that slot is removed; otherwise the item leaves its
//   current slot, the slot's item is removed, and the item is equipped there.

import { menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { SLOT_ARMOR, SLOT_MAG, SLOT_SHIELD, SLOT_UNIT_1, SLOT_WEAPON } from '../net/items.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { DISABLED, drawTextWindow, drawWindowTitle, INSET, ROW, TITLE_GAP } from './fieldwindows.ts';
import { wipeElement, WindowAnim, withElementWipe, withWindowAnim } from './windowanim.ts';
import { equipProblems, ICON_UV, isWrapped, itemDescription, itemRow, type ItemPackEnv, type ItemPackTextures, type ItemRow } from './itempack.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';

export const SLOT_LIST = { x: 13, y: 256, w: 308, h: 184 } as const; // entry 0, 0x009738e0
export const EQUIP_ITEMS = { x: 13, y: 317, w: 308, h: 124 } as const; // entry 1, 0x00973918
export const EQUIP_DETAIL = { x: 324, y: 256, w: 240, h: 184 } as const; // entry 2, 0x009f2b58
const ITEM_ROWS = 5; // (124 - 26 + 6) / 20
const ICON = 18;
const EMPTY_ICON_COLOR = 0xaa / 0xff; // 0xffaaaaaa

// newserv class_flags_for_class: 0x20 hunter, 0x40 ranger.
const CLASS_FLAGS = [0x25, 0x2a, 0x31, 0x45, 0x51, 0x52, 0x86, 0x89, 0x8a, 0x32, 0x85, 0x46];

export interface EquipSlot {
  slot: number;
  item: InventoryItem | null;
  emptyIcon: number;
}

function slotItem(c: CharacterFile, slot: number): InventoryItem | null {
  return (
    c.inventory.find((it) => {
      if (!it.equipped) return false;
      const d = it.data.data1;
      if (slot === SLOT_WEAPON) return d[0] === 0;
      if (slot === SLOT_ARMOR) return d[0] === 1 && d[1] === 1;
      if (slot === SLOT_SHIELD) return d[0] === 1 && d[1] === 2;
      if (slot === SLOT_MAG) return d[0] === 2;
      return d[0] === 1 && d[1] === 3 && d[4] === slot - SLOT_UNIT_1;
    }) ?? null
  );
}

// EquipmentMenu_UpdateSlotDisplay_0074bc00.
export function equipSlots(c: CharacterFile): EquipSlot[] {
  const f = CLASS_FLAGS[c.charClass] ?? 0;
  const out: EquipSlot[] = [{ slot: SLOT_WEAPON, item: slotItem(c, SLOT_WEAPON), emptyIcon: f & 0x20 ? 0 : f & 0x40 ? 1 : 2 }];
  const armor = slotItem(c, SLOT_ARMOR);
  out.push({ slot: SLOT_ARMOR, item: armor, emptyIcon: 0x0b });
  const units = armor ? Math.min(4, armor.data.data1[5]) : 0;
  for (let k = 0; k < units; k++) out.push({ slot: SLOT_UNIT_1 + k, item: slotItem(c, SLOT_UNIT_1 + k), emptyIcon: 4 });
  out.push({ slot: SLOT_SHIELD, item: slotItem(c, SLOT_SHIELD), emptyIcon: 0x0a });
  out.push({ slot: SLOT_MAG, item: slotItem(c, SLOT_MAG), emptyIcon: 3 });
  return out;
}

// CreateEquipListWindow_0074ae04: the inventory items that fit a slot.
export function slotCandidates(c: CharacterFile, slot: number): InventoryItem[] {
  return c.inventory.filter((it) => {
    if (isWrapped(it.data)) return false;
    const d = it.data.data1;
    if (slot === SLOT_WEAPON) return d[0] === 0;
    if (slot === SLOT_MAG) return d[0] === 2;
    if (slot === SLOT_ARMOR) return d[0] === 1 && d[1] === 1;
    if (slot === SLOT_SHIELD) return d[0] === 1 && d[1] === 2;
    return d[0] === 1 && d[1] === 3;
  });
}

export interface EquipActions {
  equip(id: number, slot: number): void;
  unequip(id: number): void;
}

// HandleItemEquipSwap_0074ad94.
export function equipSwap(c: CharacterFile, slot: number, id: number, a: EquipActions): void {
  const current = slotItem(c, slot);
  const it = c.inventory.find((i) => i.data.id === id);
  if (!it) return;
  if (current?.data.id === id) return a.unequip(id);
  if (it.equipped) a.unequip(id);
  if (current) a.unequip(current.data.id);
  a.equip(id, slot);
}

export interface EquipMenuEnv extends ItemPackEnv {
  equipActions: EquipActions;
}

type State = 'slots' | 'items';

export class EquipMenu {
  private state: State = 'slots';
  private slotCursor = 0;
  private itemCursor = 0;
  private itemTop = 0;
  private frame = 0;
  slots: EquipSlot[] = [];
  items: InventoryItem[] = [];
  // The later windows are objects of their own (each with its own counter,
  // classic/windowanim.ts). The description (entry 2) is made with the menu and
  // opens with it (start); the item list (entry 1) is made fresh on each open
  // (SetupEquipListWindow_0074ad50 -> CreateEquipListWindow_0074ae04), so its
  // opening restarts at counter 0. `speed`: the field menu's window speed.
  speed = 1;
  detailAnim = new WindowAnim(true, false);
  itemsAnim = new WindowAnim(true, false);
  private env: EquipMenuEnv;

  constructor(env: EquipMenuEnv) {
    this.env = env;
    this.refresh();
  }

  // The description opens with the menu (its object is made in EquipmentMenu_Constructor_0074aa48).
  start(): void {
    this.detailAnim.open(this.speed);
  }

  // State 1: rebuild the slot list (and the item list when it is open).
  refresh(): void {
    const c = this.env.character();
    this.slots = c ? equipSlots(c) : [];
    if (this.slotCursor >= this.slots.length) this.slotCursor = Math.max(0, this.slots.length - 1);
    if (this.state === 'items') {
      const s = this.slots[this.slotCursor];
      this.items = c && s ? slotCandidates(c, s.slot) : [];
      if (this.itemCursor >= this.items.length) this.itemCursor = Math.max(0, this.items.length - 1);
      this.clampTop();
    }
  }

  private clampTop(): void {
    if (this.itemCursor < this.itemTop) this.itemTop = this.itemCursor;
    if (this.itemCursor >= this.itemTop + ITEM_ROWS) this.itemTop = this.itemCursor - ITEM_ROWS + 1;
    this.itemTop = Math.max(0, Math.min(this.itemTop, Math.max(0, this.items.length - ITEM_ROWS)));
  }

  private enabled(it: InventoryItem): boolean {
    return equipProblems(it.data, this.env.rowContext()) === 0;
  }

  tick(): void {
    this.frame++;
    this.detailAnim.tick(this.speed);
    this.itemsAnim.tick(this.speed);
  }

  // Returns false when the window closes (Backspace on the slot list).
  key(e: KeyboardEvent): boolean {
    const up = menuKeyOf(e) === 'up';
    const back = menuKeyOf(e) === 'cancel';
    if (this.state === 'slots') {
      const n = this.slots.length;
      if ((up || menuKeyOf(e) === 'down') && n) {
        this.slotCursor = (this.slotCursor + (up ? n - 1 : 1)) % n;
        se(SE.cursor);
      } else if (menuKeyOf(e) === 'decide' && n) {
        se(SE.ok);
        this.state = 'items';
        this.itemCursor = 0;
        this.itemTop = 0;
        this.itemsAnim = new WindowAnim(true, false);
        this.itemsAnim.open(this.speed);
        this.refresh();
      } else if (back) {
        se(SE.cancel);
        return false;
      }
      return true;
    }
    const n = this.items.length;
    if ((up || menuKeyOf(e) === 'down') && n) {
      this.itemCursor = (this.itemCursor + (up ? n - 1 : 1)) % n;
      this.clampTop();
      se(SE.cursor);
    } else if (menuKeyOf(e) === 'decide') {
      const it = this.items[this.itemCursor];
      const c = this.env.character();
      const s = this.slots[this.slotCursor];
      if (!it || !c || !s || !this.enabled(it)) {
        se(SE.buzzer);
        return true;
      }
      se(SE.ok);
      equipSwap(c, s.slot, it.data.id, this.env.equipActions);
      this.state = 'slots';
      this.refresh();
    } else if (back) {
      // ASSUMED: the item list goes at once (the exe's state 1 path has no close call for its object).
      se(SE.cancel);
      this.state = 'slots';
      this.refresh();
    }
    return true;
  }

  // `wipe`: the leaf's opening animation (FieldMenu's leafAnim) for the slot list;
  // the item list and the description draw under their own animations (detailAnim, itemsAnim).
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: ItemPackTextures, extra = 0, wipe?: WindowAnim): void {
    const rc = this.env.rowContext();
    const L = SLOT_LIST;
    const cx = L.x + INSET;
    const cy = L.y + INSET + TITLE_GAP;
    const cw = L.w - 2 * INSET;
    const browsing = this.state === 'slots';
    drawWindowFrame(ctx, skin.frame, L.x, L.y, L.w, browsing ? L.h : ROW + 14 + TITLE_GAP);
    withElementWipe(wipe, cx, cy, cw, () => {
      if (browsing) {
        const bar = cy + this.slotCursor * ROW;
        wipeElement(ctx, cx, bar, 16, () => drawSelectBar(ctx, skin.bars, cx, bar, cw, 16));
        this.slots.forEach((s, i) => this.drawSlot(ctx, tex, s, cx, cy + i * ROW, cw));
      } else {
        const s = this.slots[this.slotCursor];
        if (s) this.drawSlot(ctx, tex, s, cx, cy, cw);
      }
      drawWindowTitle(ctx, skin, L.x, L.y, this.env.text(11, 0x38));
    });

    let shown: InventoryItem | null = this.slots[this.slotCursor]?.item ?? null;
    if (!browsing) {
      const I = EQUIP_ITEMS;
      const ia = this.itemsAnim;
      withWindowAnim(ctx, ia, I.x, I.y, I.w, I.h, () => drawWindowFrame(ctx, skin.frame, I.x, I.y, I.w, I.h));
      const ix = I.x + INSET;
      const iy = I.y + INSET + TITLE_GAP;
      const iw = I.w - 2 * INSET;
      withWindowAnim(ctx, ia, I.x, I.y, I.w, I.h, () => withElementWipe(ia, ix, iy, iw, () => {
        if (!this.items.length) {
          const none = this.env.text(11, 0xee);
          wipeElement(ctx, ix, iy + 1, ROW, () => drawGameText(ctx, none, ix, iy + 1, DISABLED));
        } else {
          const bar = iy + (this.itemCursor - this.itemTop) * ROW;
          wipeElement(ctx, ix, bar, 16, () => drawSelectBar(ctx, skin.bars, ix, bar, iw, 16));
          this.items.slice(this.itemTop, this.itemTop + ITEM_ROWS).forEach((it, i) => this.drawRow(ctx, tex, itemRow(it, rc), ix, iy + i * ROW, iw));
        }
        drawWindowTitle(ctx, skin, I.x, I.y, this.env.text(11, 0x37));
      }));
      shown = this.items[this.itemCursor] ?? null;
    }

    ctx.save();
    ctx.translate(extra, 0);
    const D = EQUIP_DETAIL;
    withWindowAnim(ctx, this.detailAnim, D.x, D.y, D.w, D.h, () =>
      withElementWipe(this.detailAnim, D.x + INSET, D.y + INSET, D.w - 2 * INSET, () =>
        drawTextWindow(ctx, skin, D, shown ? itemDescription(shown.data, rc.names) : ''),
      ),
    );
    ctx.restore();
  }

  private drawSlot(ctx: CanvasRenderingContext2D, tex: ItemPackTextures, s: EquipSlot, x: number, y: number, w: number): void {
    if (s.item) return this.drawRow(ctx, tex, itemRow(s.item, this.env.rowContext()), x, y, w);
    wipeElement(ctx, x + ICON, y, ICON, () => drawIcon(ctx, tex.icons, s.emptyIcon, x + ICON, y, EMPTY_ICON_COLOR));
  }

  private drawRow(ctx: CanvasRenderingContext2D, tex: ItemPackTextures, r: ItemRow, x: number, y: number, w: number): void {
    const alpha = r.iconColor === '#ffffff' ? 1 : EMPTY_ICON_COLOR;
    const icon1 = r.icon1 === 0x30 && this.frame & 8 ? 0x31 : r.icon1;
    wipeElement(ctx, x, y, ICON, () => drawIcon(ctx, tex.icons, icon1, x, y, alpha));
    wipeElement(ctx, x + ICON, y, ICON, () => drawIcon(ctx, tex.icons, r.icon2, x + ICON, y, alpha));
    if (r.name) wipeElement(ctx, x + 2 * ICON, y, ROW, () => drawGameText(ctx, r.name, x + 2 * ICON, y, r.nameColor));
    if (r.count) {
      const nx = x + w - gameTextWidth(r.count);
      wipeElement(ctx, nx, y, ROW, () => drawGameText(ctx, r.count, nx, y, r.nameColor));
    }
  }
}

function drawIcon(ctx: CanvasRenderingContext2D, img: CanvasImageSource, icon: number, x: number, y: number, alpha: number): void {
  const uv = ICON_UV[icon];
  if (!uv) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, uv[0], uv[1], ICON, ICON, x, y, ICON, ICON);
  ctx.restore();
}
