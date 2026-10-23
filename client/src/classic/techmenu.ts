// Main menu > Technique (id 3), as PsoBB.exe (Ephinea 1.25.13) runs it:
// handle_player_menu_select -> ChatShortcutMenuWindow_Constructor_0075de34,
// update_technique_menu (0x0075df60 area).
//
//   - "Type" window (ChatShortcutMenuWindow_Initialize_0075ded0): position-table
//     entry 0x12 = (13, 256), 179 wide (0x43330000), title unitxt group 11
//     [0x42], items [0xBA..0xBE] Simple Attack / Normal Attack / Hard Attack /
//     Heal / Support.
//   - "Techniques" window (CreateListWindowObject_0075e5b0): entry 0x13 =
//     (200, 256), 179 wide, title [0x43]; the techniques of the chosen type
//     (g_TechniqueMenuIdTable 0x009f57a8 -> 0x00974a4c / 44 / 38 / 30 / 24,
//     lists ending at 0x13), named by unitxt group 5. A technique the
//     character has not learned is disabled (flags 6, 0xff909090); one it
//     knows but cannot cast here (CanPerformTechniqueAction_0075e611: the map
//     is safe) is 0xfffd3901 (set_list_window_item_with_specified_value_and_color).
//     While the Type window has the cursor this window shows the type's list
//     without a cursor (flags 0x40 | 0x80).
//   - Info window (state 3, CreatePlayerMenuListWindow_0073aa40): entry 0x14 =
//     (385, 256), 242 x 161 (0x00974a08); UpdateTechniqueListItem_0075e668
//     writes group 6 [0x13] "Level:" + (level + 1) (not for Ryuker / Reverser),
//     group 7 [0x2E] "\nRequired TP: " + the TP cost, then group 6 [technique];
//     empty for a technique not learned.
// TP cost (GetTechniqueData_006ded14): the technique table at 0x009cf3c0
// (19 x 0x2C bytes), tp_cost (+0x10) + v_tp_cost (+0x23) / 100.0
// (0x0096ce84) * level, truncated (fistp with the control word | 0xC00);
// Ryuker and Reverser have a fixed cost (combat/techniques.ts).
// Enter on a castable technique sends the cast (SendCastTechPacket_0069a2f0,
// combat/techniques.ts and render/combat.ts castTechnique) and closes the
// window; when the cast is refused (TP, already casting) it plays SE 0x585
// like the client.

import { se, SE } from '../audio/se.ts';
import { techTpCost } from '../combat/techniques.ts';
import { drawListWindow, drawTextWindow, INSET, listKey, type ListItem, TITLE_GAP } from './fieldwindows.ts';
import type { WindowSkin } from './stage.ts';
import { withElementWipe, type WindowAnim } from './windowanim.ts';

export const TYPE_POS = { x: 13, y: 256, w: 179 } as const; // entry 0x12
export const TECH_POS = { x: 200, y: 256, w: 179 } as const; // entry 0x13
export const INFO_RECT = { x: 385, y: 256, w: 242, h: 161 } as const; // entry 0x14, 0x00974a08

// g_TechniqueMenuIdTable, by type.
export const TECH_TYPES: ReadonlyArray<readonly number[]> = [
  [0, 6, 3], // 0x00974a4c Simple Attack: Foie, Zonde, Barta
  [1, 7, 4], // 0x00974a44 Normal Attack: Gifoie, Gizonde, Gibarta
  [2, 8, 5, 9, 18], // 0x00974a38 Hard Attack: Rafoie, Razonde, Rabarta, Grants, Megid
  [15, 16, 17], // 0x00974a30 Heal: Resta, Anti, Reverser
  [13, 10, 11, 12, 14], // 0x00974a24 Support: Shifta, Deband, Jellen, Zalure, Ryuker
];

// GetTechniqueData_006ded14 tp_cost for a 0-based level (combat/techniques.ts).
export { techTpCost };
const RYUKER = 0x0e;
const REVERSER = 0x11;

export interface TechMenuEnv {
  text: (group: number, index: number) => string;
  // 1-based learned level, null when not learned (CharacterFile.techLevels).
  level: (tech: number) => number | null;
  // The map allows casting (is_current_map_safe == 0, i.e. not a city).
  canCast: () => boolean;
  cast?: (tech: number) => boolean;
}

export const TECH_DISABLED = '#909090';
export const TECH_HERE = '#fd3901'; // 0xfffd3901

export function techItems(type: number, env: TechMenuEnv): Array<ListItem & { color?: string | undefined }> {
  return (TECH_TYPES[type] ?? []).map((t) => {
    const learned = env.level(t) !== null;
    return {
      label: env.text(5, t),
      value: t,
      enabled: learned,
      color: learned && !env.canCast() ? TECH_HERE : undefined,
    };
  });
}

// UpdateTechniqueListItem_0075e668.
export function techInfo(tech: number, env: TechMenuEnv): string {
  const lv = env.level(tech);
  if (lv === null) return '';
  let s = '';
  if (tech !== RYUKER && tech !== REVERSER) s += `${env.text(6, 0x13)}${lv}`;
  s += `${env.text(7, 0x2e)}${techTpCost(tech, lv - 1)}`;
  s += env.text(6, tech);
  return s;
}

export class TechniqueMenu {
  private state: 'type' | 'tech' = 'type';
  private type = { cursor: 0 };
  private tech = { cursor: 0 };
  private env: TechMenuEnv;

  constructor(env: TechMenuEnv) {
    this.env = env;
  }

  private typeItems(): ListItem[] {
    return [0xba, 0xbb, 0xbc, 0xbd, 0xbe].map((i, n) => ({ label: this.env.text(11, i), value: n, enabled: true }));
  }

  tick(): void {}

  // Returns false when the menu closes.
  key(e: KeyboardEvent): boolean {
    if (this.state === 'type') {
      const r = listKey(e, this.typeItems(), this.type);
      if (r === 'move') this.tech.cursor = 0; // ListWindowObject_SetSelection_00736510(.., 0)
      if (r === 'decide') this.state = 'tech';
      return r !== 'cancel';
    }
    const items = techItems(this.type.cursor, this.env);
    if (e.key === 'Enter') {
      const it = items[this.tech.cursor];
      if (it?.enabled && this.env.canCast() && this.env.cast?.(it.value)) {
        se(SE.ok);
        this.state = 'type';
      } else se(SE.cancel);
      return true;
    }
    const r = listKey(e, items, this.tech);
    if (r === 'cancel') this.state = 'type';
    return true;
  }

  // `wipe`: the leaf's opening animation (FieldMenu's leafAnim): each window's elements are revealed by its wipe.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra = 0, wipe?: WindowAnim): void {
    const items = techItems(this.type.cursor, this.env);
    const T = TYPE_POS;
    withElementWipe(wipe, T.x + INSET, T.y + INSET + TITLE_GAP, T.w - 2 * INSET, () =>
      drawListWindow(ctx, skin, T.x, T.y, T.w, this.env.text(11, 0x42), this.typeItems(), this.type.cursor, this.state === 'type'),
    );
    withElementWipe(wipe, TECH_POS.x + INSET, TECH_POS.y + INSET + TITLE_GAP, TECH_POS.w - 2 * INSET, () =>
      drawTechList(ctx, skin, items, this.tech.cursor, this.state === 'tech', this.env.text(11, 0x43)),
    );
    if (this.state === 'tech') {
      const it = items[this.tech.cursor];
      // On the right half: follows the right edge (classic/ingame.ts anchorX).
      const R = { ...INFO_RECT, x: INFO_RECT.x + extra };
      withElementWipe(wipe, R.x + INSET, R.y + INSET, R.w - 2 * INSET, () => drawTextWindow(ctx, skin, R, it ? techInfo(it.value, this.env) : ''));
    }
  }
}

function drawTechList(ctx: CanvasRenderingContext2D, skin: WindowSkin, items: Array<ListItem & { color?: string | undefined }>, cursor: number, active: boolean, title: string): void {
  // drawListWindow handles the disabled colour; learned techniques that
  // cannot be cast here are drawn in 0xfffd3901 over the same layout.
  drawListWindow(ctx, skin, TECH_POS.x, TECH_POS.y, TECH_POS.w, title, items, cursor, active, (it) => (it as { color?: string }).color);
}
