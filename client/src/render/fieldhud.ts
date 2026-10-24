// The classic field HUD of a game: the action palette at the bottom right and
// the main menu (Home / F12) with its Item Pack and Technique windows, drawn
// with the classic renderers (classic/palette.ts, classic/fieldmenu.ts) on a
// 2D canvas laid over the game's 3D canvas, like render/warpmenu.ts.
//
// PsoBB.exe (Ephinea 1.25.13) behaviour kept here:
//   - the action palette and the hotbar show on an unsafe map only (Pioneer 2 and
//     the hubs show neither; classic/fieldmenu.ts paletteWindowsShown, the
//     quick menu's hidden flag of the palette / hotbar windows);
//   - the menu locks the player's input (DisablePlayerInputForMenu_006936ec,
//     unknown_keyboard_enable_in_menu(0)): movement and the action palette
//     get no keys while it is open, and the palette window hides
//     (unknown_update_player_menu_hide_palette);
//   - while the menu is open the 3D view moves right / up and scales by 0.75
//     over 3 frames (render_player_menu_background FUN_00733b2c,
//     classic/mainmenu.ts menuViewShift);
//   - "Action Palette Change" (Ctrl in the default key config) flips the
//     palette (HandlePlayerPaletteToggle_00694f0c) and lights the Ctrl tab.
//   - the radar (minimap_type 0) and the Area Map's full map (type 1):
//     classic/minimap.ts keeps the state, render/minimap.ts draws it on this
//     overlay; TObjRaderCol (0x17) objects hold their room hidden until the
//     player comes within their radius (radar_collision_update,
//     MapObjectRadarCollisionUpdateHandler_00663250).
// Windows use the in-game space of classic/ingame.ts: a uniform scale by
// height, windows on the right half following the right edge.

import type { ClientFiles } from '../data/clientfiles.ts';
import { parseUnitxt } from '../classic/charcreate_text.ts';
import { MENU_LAYER } from '../classic/hud.ts';
import { WindowAnim } from '../classic/windowanim.ts';
import { anchorX } from '../classic/ingame.ts';
import { drawTextWindow, INSET, LINE } from '../classic/fieldwindows.ts';
import { gameTextWidth } from '../classic/gametext.ts';
import { FieldMenu, isSafeMap, paletteWindowsShown, type FieldMenuTextures } from '../classic/fieldmenu.ts';
import { ROW as HELP_ROW } from '../classic/fieldwindows.ts';
import { type HomeLeafServices } from '../classic/homeleaves.ts';
import { isInTeam } from '../classic/teammenu.ts';
import { equipProblems, itemRowName, itemRows, undroppable, type ChallengeListEnv, type RowContext } from '../classic/itempack.ts';
import { menuRowSelectable } from '../quest/battleitems.ts';
import { compareStatRows, type EquipStatRow, type StatBlock } from '../classic/itemdetail.ts';
import { equippedCandidate, recalculateCandidate, wornEquipment } from '../combat/playerstats.ts';
import type { ToolCheckContext } from '../classic/quickmenu.ts';
import { magStats } from '../formats/itemnames.ts';
import { techMenuOrder } from '../net/charfile.ts';
import type { FieldQuickEnv } from '../classic/field.ts';
import type { TradeEnv } from '../classic/trade.ts';
import { TRADE_STATUS, type TradeSession } from '../net/trade.ts';
import { createCounter, type Counter, type CounterKind, type CounterMusic } from '../classic/shop.ts';
import { ReturnPrompt, RETURN_NO, RETURN_TEXT, RETURN_YES } from '../classic/returnprompt.ts';
import { applyMenuViewShift } from './viewshift.ts';
import { characterOptionsEnv, readOptionFlags, restoreBrightness, toggleKeyboardControls } from '../classic/options.ts';
import { currentPalette, CONFIG_OFFSET, PALETTE_ITEMS, PALETTE_POS, PALETTE_SIZE, PaletteHud, paletteFromCharacter, type PaletteData, type PaletteSlot, type PaletteTextures } from '../classic/palette.ts';
import { CONFIG_SIZE } from '../classic/customize.ts';
import { isAndroid } from '../combat/progression.ts';
import { drawHotbar, HOTBAR_POS, hotbarY } from '../classic/hotbar.ts';
import { bandsOf, overlayFrame, textureBitmap, textureBitmaps, type WindowSkin } from '../classic/stage.ts';
import type { ItemData, ItemNames } from '../formats/itemnames.ts';
import { AFSArchive } from '../formats/archives.ts';
import { ITEM_KT_FILE, itemPictureEntry } from '../formats/itemkt.ts';
import { parseXvm } from '../formats/xvm.ts';
import { BINDING, bindingKey, KEYS } from '../input/keyconfig.ts';
import { chatFormOption, chatShortcutIndex, functionKeyAction, functionKeyNames } from '../input/shortcuts.ts';
import { drawTeamLog, type TeamChat } from '../classic/teamchat.ts';
import type { CharacterFile } from '../net/charfile.ts';
import { MESETA_ITEM_ID, stackSize, type GameItems } from '../net/items.ts';
import { BOSS_AREAS } from '../net/telepipe.ts';
import type { MapViewer } from './mapviewer.ts';
import { parseMinimapRel, minimapFileFor, type MinimapData } from '../formats/minimap.ts';
import { enemyIconRule, MinimapFloors, MinimapState, raderHideInside, raderIconIcon, type MinimapPlayer, type RaderHide, type RaderIconObject } from '../classic/minimap.ts';
import type { AreaMapInput } from '../classic/areamap.ts';
import type { Icon } from '../classic/minimap.ts';
import type { QuestBoardVM } from '../classic/questboard.ts';
import { disposeMinimapAssets, loadMinimapAssets, MinimapView } from './minimap.ts';
import { AREA_TEXT } from './warpmenu.ts';

const FRAME = 1 / 30;
const PROMPT_POS = [267, 130] as const; // position table 0x00971f40 entry 0x35
const NO_KEYS: ReadonlySet<string> = new Set();
const RADER_COL_DELAY = 3; // radar_collision_constructor: +0x9c = 3

// What the minimap needs from the game view each frame.
export interface MinimapSource {
  self: () => MinimapPlayer | null; // the local player (null: none / invisible)
  others: () => MinimapPlayer[]; // the other players on this floor
  enemies: () => readonly { x: number; z: number; type: string }[]; // live enemies on this floor (type: the newserv name, the icon rule)
  forcedIcons?: () => readonly Icon[]; // icons added forced (the Dark Falz form 3 body and its trail)
  cameraYaw: () => number; // the camera's y_rotation (BAMS)
  hidden: () => boolean; // a talk camera or a UI that blocks the player's input
  switchOn: (flag: number) => boolean; // a switch flag of this floor (TObjRaderIcon colour)
  doorIcons: () => readonly Icon[]; // the doors' icons (TObjDoor, this floor)
  komoIcons?: () => readonly Icon[]; // the Komo variant 6 icons (Episode 2 floors)
  battle: () => number | null; // the local player's battle team while battle mode runs (null: not in battle)
}

// A TObjRaderCol (0x0017): radius param1, room param4.
export interface RaderCol {
  x: number;
  z: number;
  radius: number;
  room: number;
}
// newserv class_flags_for_class: bit 0x10 = android.
const ANDROID_CLASSES = new Set([2, 4, 5, 9]);

// The Battle Mode hooks the field's windows read (quest/battlerun.ts fills them while a battle
// runs): the trap stock by type, the sonar stock and manager, and the one-row menus' actions.
export interface BattleItemsHook {
  traps: () => readonly number[];
  sonar: () => number;
  sonarActive: () => boolean;
  useSonar: () => boolean;
  // A status row's one-row menu (menu value 4 trap, 5 sonar): false when the action did not run.
  activate: (statusIndex: number, menuValue: number) => boolean;
}

export interface FieldHudOptions {
  character: () => CharacterFile | null;
  fullCharacter: () => Uint8Array | null;
  // Main menu > Customize, window closed with a change: the 0xE8 config goes to the server (07ED, classic/customize.ts).
  saveCustomize?: (config: Uint8Array) => void;
  // The quick menu's technique order, sent when its list closes after a swap (ED 06, bbsession.ts).
  sendTechOrder?: (order: readonly number[]) => void;
  items: GameItems;
  // The floor music for the counters' jingles (classic/shop.ts CounterMusic).
  music?: CounterMusic;
  area: () => number;
  // g_QuestStarted: a quest is loaded and running (the main menu's Quest
  // Board entry, classic/fieldmenu.ts).
  questStarted: () => boolean;
  // The running quest's VM and name, for the Quest Board window
  // (classic/questboard.ts).
  quest?: () => { vm: QuestBoardVM; name: string } | null;
  // The quest overlay's lists and board text while the Quest Board's item
  // thread runs (quest/questui.ts menuKey).
  questKey?: (e: KeyboardEvent) => boolean;
  // Starts a technique cast from the Technique menu (render/combat.ts
  // castTechnique); false when it cannot be cast.
  cast?: (tech: number) => boolean;
  // The challenge palette's 6x60 subcommand 0x83 for a quick menu status row (rows 0..3).
  challengeTrap?: (row: number, count: number) => void;
  // Whether a telepipe can be opened here (render/telepipe.ts): the Telepipe
  // item is greyed out otherwise.
  telepipeAllowed?: () => boolean;
  // The local player's status flags (combat/status.ts), for Antidote / Antiparalysis.
  statusFlags?: () => number;
  // The Moon Atomizer's target (render/combat.ts atomizerTarget), null when none.
  atomizerTarget?: () => number | null;
  // The Star Atomizer's 6x66 list (render/combat.ts starTargets), null when none.
  starTargets?: () => readonly number[] | null;
  // The local echo of a sent 6x33 / 6x66 (render/combat.ts atomizerEcho).
  atomizerEcho?: (packet: Uint8Array) => void;
  // The player trade (net/trade.ts): the session and the other players of the game the
  // Trade Window offers; null when the game has no session. The session's timers run
  // each frame, and a partner's proposal opens the accept prompt (classic/trade.ts).
  trade?: () => { session: TradeSession; partners: () => { id: number; name: string }[] } | null;
  // The Home menu's shared leaves' services (classic/homeleaves.ts); null with no session.
  home?: () => HomeLeafServices | null;
  // The team chat window and its log (classic/teamchat.ts); null with no session.
  teamChat?: TeamChat | null;
  // Another window (a warp menu) has the keyboard.
  blocked: () => boolean;
  // A chat shortcut slot (0..11) was pressed (handle_chat_shortcuts, input/shortcuts.ts).
  chatShortcut?: (index: number) => void;
  // Sends a command to the game server (the Options window's 0x01ED).
  send?: (command: number, payload: Uint8Array) => void;
  minimap?: MinimapSource;
  log?: (msg: string) => void;
}

interface Textures {
  skin: WindowSkin;
  menu: FieldMenuTextures;
  palette: PaletteTextures;
}

interface RaderColState extends RaderCol {
  state: 0 | 1;
  wait: number;
  done: boolean;
}

export class FieldHud {
  private viewer: MapViewer;
  private files: ClientFiles;
  private opts: FieldHudOptions;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private host: HTMLCanvasElement;
  private tex: Textures | null = null;
  private groups: string[][] | null = null;
  private itemKt: Promise<AFSArchive> | null = null; // ItemKTep4.afs, read on the first picture
  private shopGroups: string[][] | null = null;
  // The open shop / bank counter (classic/shop.ts), opened by quest/town.ts.
  private counter: Counter | null = null;
  // The dead prompt (classic/returnprompt.ts): open while the player is dead and
  // the death fade is over. `returnToken` drops a prompt that closed while its
  // unitxt text was still loading.
  private returnPrompt: ReturnPrompt | null = null;
  private returnToken = 0;
  private names: () => ItemNames | null = () => null;
  // The quick menu's technique order (the 19 ids the technique tab lists). In memory only:
  // the save layout has no order field (net/charfile.ts), so a new view starts from 0..18.
  // The technique order: loaded from the save's tech_menu on first use (ASSUMED: the exe's load
  // is not traced; the default 0..18 when the save has no permutation), sent on the close.
  private techOrder: number[] | null = null;
  private techOrderDirty = false;
  private currentTechOrder(): number[] {
    if (!this.techOrder) {
      const save = this.opts.fullCharacter();
      this.techOrder = (save && techMenuOrder(save)) || Array.from({ length: 19 }, (_, i) => i);
    }
    return this.techOrder;
  }
  private commitTechOrder(): void {
    if (!this.techOrderDirty || !this.techOrder) return;
    this.techOrderDirty = false;
    this.opts.sendTechOrder?.(this.techOrder);
  }
  private palette: PaletteData | null = null;
  private paletteHud = new PaletteHud();
  // Battle Mode trap stock by type 0..3 (set by quest/battlerun.ts while a battle runs).
  trapCount: ((type: number) => number) | null = null;
  // Battle Mode sonar and item list hooks (set by quest/battlerun.ts while a battle runs; null: none).
  battleItems: BattleItemsHook | null = null;
  // Battle Mode team of a client slot (set by quest/battlerun.ts while a battle runs; null: none).
  battleTeam: ((clientId: number) => number | null) | null = null;
  readonly menu: FieldMenu;
  private acc = 0;
  private inventoryKey = '';
  private onKey = (e: KeyboardEvent) => this.key(e);
  private hook = (dt: number) => this.frame(dt);
  private disposed = false;
  // A one-line window at GUI position 0x35 (the Pioneer 2 pipe's area name,
  // SinowberillMapObjectUpdateHandler_0066e3bc).
  prompt: (() => string | null) | null = null;
  // The minimap (classic/minimap.ts) and its drawing; the room flags of the
  // floors visited in this game.
  readonly minimap = new MinimapState();
  private minimapFloors = new MinimapFloors();
  private minimapView = new MinimapView();
  private minimapAssets = false;
  private raderCols: RaderColState[] = [];
  private raderHides: RaderHide[] = [];
  private raderIcons: readonly RaderIconObject[] = [];
  private floorToken = 0;
  // The HUD's flags (+0x1c): bit 1 while the full map is up, 0x10 while the
  // Quest Board window is (the status window closes, classic/hud.ts
  // STATUS_HIDING_FLAGS).
  hudFlags = 0;
  // Held keys and the mouse, for the Area Map (menu inputs read each frame).
  private held = new Set<string>();
  // The F1 help list (exe unknown_render_help_menu, flag 0x200): the 12 rows of group 11 0x161..0x16c.
  private helpOpen = false;
  private mouse = { down: false, x: 0, y: 0 };
  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.key.toLowerCase());
    this.menu.keyUp(e);
  };
  private onBlur = () => {
    this.held.clear();
    this.mouse.down = false;
  };
  private onMouse = (e: MouseEvent) => this.mouseEvent(e);

  constructor(viewer: MapViewer, files: ClientFiles, opts: FieldHudOptions) {
    this.viewer = viewer;
    this.files = files;
    this.opts = opts;
    this.host = viewer.renderer.domElement;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'field-hud-overlay';
    // Above the status window (classic/hud.ts MENU_LAYER): the menu and the
    // counter windows are created after it, so they are drawn over it.
    Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: String(MENU_LAYER) });
    this.host.parentElement?.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    // Capture phase on the canvas itself: runs before the movement, combat
    // and item listeners (bubble phase on the same element) and stops them
    // while a menu is open.
    this.host.addEventListener('keydown', this.onKey, true);
    this.host.addEventListener('keyup', this.onKeyUp, true);
    this.host.addEventListener('blur', this.onBlur);
    for (const t of ['mousedown', 'mousemove', 'mouseup'] as const) this.host.addEventListener(t, this.onMouse, true);
    window.addEventListener('mouseup', this.onMouse);
    viewer.frameHooks.add(this.hook);
    restoreBrightness();
    this.menu = new FieldMenu({
      text: (g, i) => this.text(g, i),
      rules: () => {
        const area = this.opts.area();
        return { lobby: area === 0x0f, safe: isSafeMap(area), online: true, questStarted: this.opts.questStarted(), inTeam: isInTeam(this.opts.home?.()?.team() ?? null) };
      },
      android: () => ANDROID_CLASSES.has(this.opts.character()?.charClass ?? 0),
      itemPack: {
        character: () => this.opts.character(),
        rowContext: () => this.rowContext(),
        challenge: () => this.challengeListEnv(),
        purposeContext: () => ({
          lobby: this.opts.area() === 0x0f,
          canUse: (it) => this.opts.items.canUse(it, this.rules()),
          equipProblems: (it) => equipProblems(it.data, this.rowContext()),
          undroppable: (it) => undroppable(it.data, this.names()),
        }),
        text: (g, i) => this.text(g, i),
        actions: {
          use: (id) => this.opts.items.use(id, this.rules()),
          equip: (id) => this.opts.items.equip(id),
          unequip: (id) => this.opts.items.unequip(id),
          drop: (id, amount) => this.opts.items.drop(id, amount),
          dropMeseta: (amount) => this.opts.items.drop(MESETA_ITEM_ID, amount),
          sortAuto: () => this.opts.items.sortAuto(),
          sortSwap: (a, b) => this.opts.items.sortSwap(a, b),
          commitSort: () => this.opts.items.commitSort(),
        },
      },
      equip: {
        equip: (id, slot) => this.opts.items.equip(id, slot),
        unequip: (id) => this.opts.items.unequip(id),
      },
      mag: {
        character: () => this.opts.character(),
        rowContext: () => this.rowContext(),
        text: (g, i) => this.text(g, i),
        pmt: () => this.names()?.pmt ?? null,
        feedTimer: (id) => this.opts.items.feedTimer(id),
        feed: (mag, food) => this.opts.items.feedMag(mag, food),
      },
      options: characterOptionsEnv(
        (g, i) => this.text(g, i),
        () => this.opts.fullCharacter(),
        (c, p) => this.opts.send?.(c, p),
      ),
      areaMap: {
        minimap: () => (this.minimap.loaded ? this.minimap : null),
        input: () => this.areaMapInput(),
        setHudFlag: (bit, on) => {
          this.hudFlags = on ? this.hudFlags | bit : this.hudFlags & ~bit;
        },
        title: () => this.areaName(),
        text: (g, i) => this.text(g, i),
      },
      trade: () => this.tradeEnv(),
      home: () => {
        const s = this.opts.home?.() ?? null;
        return s ? { ...s, text: (g, i) => this.text(g, i) } : null;
      },
      questBoard: {
        vm: () => this.opts.quest?.()?.vm ?? null,
        questName: () => this.opts.quest?.()?.name ?? '',
        questKey: (e) => this.opts.questKey?.(e) ?? false,
        text: (g, i) => this.text(g, i),
        setHudFlag: (bit, on) => {
          this.hudFlags = on ? this.hudFlags | bit : this.hudFlags & ~bit;
        },
      },
      customize: {
        text: (g, i) => this.text(g, i),
        learned: (t) => (this.opts.character()?.techLevels[t] ?? null) !== null,
        hasItem: (i) => this.paletteItemId(i) !== null,
        // ValidatePlayerAction's weapon test (ASSUMED: a weapon is item type 0, equipped).
        weaponEquipped: () => (this.opts.character()?.inventory ?? []).some((x) => x.equipped && x.data.data1[0] === 0),
        trapStock: (t) => this.trapCount?.(t) ?? 0,
        itemCount: (i) => this.itemCount(i),
        trapCount: (t) => this.trapCount?.(t) ?? 0,
        android: () => isAndroid(this.opts.character()?.charClass ?? -1),
        config: () => this.paletteConfig(),
        setConfig: (cfg) => this.setPaletteConfig(cfg),
        save: (cfg) => this.opts.saveCustomize?.(cfg),
      },
      tech: {
        text: (g, i) => this.text(g, i),
        level: (t) => this.opts.character()?.techLevels[t] ?? null,
        canCast: () => !isSafeMap(this.opts.area()),
        // A cast destroys the technique window (flags |= 1 after
        // SendCastTechPacket_0069a2f0); closing the whole menu with it is
        // ASSUMED.
        cast: (t) => {
          const ok = this.opts.cast?.(t) ?? false;
          if (ok) this.menu.close();
          return ok;
        },
      },
    });
  }

  // Item names and ItemPMT (the Online tab's inventory panel loads them from
  // the server's stream file).
  // palette_slots[index] of the current action palette (render/combat.ts
  // reads it for the palette keys, input/keyconfig.ts PALETTE_KEYS).
  paletteSlot(index: number): PaletteSlot | null {
    this.palette ??= paletteFromCharacter(this.opts.fullCharacter());
    return this.palette ? (currentPalette(this.palette).slots[index] ?? null) : null;
  }

  // The 0xE8 config of the save (a copy; zeros with no save) and its write-back for the Customize window.
  private paletteConfig(): Uint8Array {
    const raw = this.opts.fullCharacter();
    return raw && raw.length >= CONFIG_OFFSET + CONFIG_SIZE ? raw.slice(CONFIG_OFFSET, CONFIG_OFFSET + CONFIG_SIZE) : new Uint8Array(CONFIG_SIZE);
  }

  private setPaletteConfig(cfg: Uint8Array): void {
    const raw = this.opts.fullCharacter();
    if (raw && raw.length >= CONFIG_OFFSET + CONFIG_SIZE) raw.set(cfg, CONFIG_OFFSET);
    this.palette = paletteFromCharacter(raw);
  }

  // hotbar_slots[index] (0..9) of the current action palette (the bottom hotbar, classic/hotbar.ts).
  hotbarSlot(index: number): PaletteSlot | null {
    this.palette ??= paletteFromCharacter(this.opts.fullCharacter());
    return this.palette ? (currentPalette(this.palette).hotbar[index] ?? null) : null;
  }

  // The hotbar's item use (group 1 = 4, not a trap): the bag item of palette item index
  // group2 goes through GameItems.use (6x27). Refused in the lobby (is_current_map_lobby)
  // and on a safe map; false when the bag has no such item (nothing is sent).
  useHotbarItem(group2: number): boolean {
    const area = this.opts.area();
    if (area === 0x0f || isSafeMap(area)) return false; // the lobby, or a city (CanPerformAction_0068aa8c)
    const id = this.paletteItemId(group2);
    if (id === null) return false;
    this.opts.items.use(id, this.rules());
    return true;
  }

  // ItemPMT of the item names (MAG feeding, render/gameview.ts).
  get pmt(): ItemNames['pmt'] | null {
    return this.names()?.pmt ?? null;
  }

  // The item names the HUD draws with (null until setNames gives them).
  get itemNames(): ItemNames | null {
    return this.names();
  }

  setNames(names: () => ItemNames | null): void {
    this.names = names;
  }

  private rules() {
    const names = this.names();
    const charClass = this.opts.character()?.charClass ?? 0;
    return {
      maxTechLevel: (tech: number) => names?.pmt.maxTechLevels[tech]?.[charClass] ?? 0xff,
      maxGrind: (w: { data1: Uint8Array }) => names?.pmt.getWeapon(w.data1[1], w.data1[2])?.maxGrind ?? 0,
      telepipe: () => this.opts.telepipeAllowed?.() ?? false,
      statusFlags: () => this.opts.statusFlags?.() ?? 0,
      atomizerTarget: () => this.opts.atomizerTarget?.() ?? null,
      starTargets: () => this.opts.starTargets?.() ?? null,
      atomizerEcho: (packet: Uint8Array) => this.opts.atomizerEcho?.(packet),
    };
  }

  // The Trade Window's environment (classic/trade.ts): the offers are the Item Pack's rows
  // (itemRows, the meseta row last) of the character, the names the same rows.
  private tradeEnv(): TradeEnv | null {
    const t = this.opts.trade?.();
    if (!t) return null;
    const rows = () => {
      const c = this.opts.character();
      return c ? itemRows(c, this.rowContext(), this.text(12, 0)) : [];
    };
    return {
      session: t.session,
      text: (g, i) => this.text(g, i),
      partners: t.partners,
      rows,
      count: (id) => this.opts.character()?.inventory.find((i) => i.data.id === id)?.data.data1[5] ?? 0,
      itemName: (id) => rows().find((r) => r.id === id)?.name ?? `item ${id.toString(16)}`,
      meseta: () => this.opts.character()?.meseta ?? 0,
    };
  }

  // A trade notice from the session (net/trade.ts TRADE_TEXT): the open Trade Window shows it.
  notifyTrade(textId: number): void {
    if (this.menu.trade) this.menu.trade.notify(textId);
  }

  // The tools tab's checker context (quickmenu.ts toolCheckerBits): the map flags, the level and
  // class and the equipped items. ASSUMED: the mag's evolution stage is 0 (the port's stage is
  // not read here), so a mag cell is equippable with any mag equipped.
  private toolChecks(): ToolCheckContext | null {
    const pmt = this.names()?.pmt;
    const c = this.opts.character();
    if (!pmt || !c) return null;
    const area = this.opts.area();
    const equipped = c.inventory
      .filter((it) => it.equipped)
      .map((it) => ({ data1: it.data.data1, magLevel: it.data.data1[0] === 2 ? magStats(it.data).level : 0 }));
    const hasMag = c.inventory.some((it) => it.equipped && it.data.data1[0] === 2);
    return {
      pmt,
      safeMap: isSafeMap(area),
      bossMap: BOSS_AREAS.includes(area),
      level: c.level,
      charClass: c.charClass,
      equipped,
      magStage: hasMag ? 0 : null,
    };
  }

  // The compare list's rows for a weapon row: the current stats against the candidate the exe
  // computes (combat/playerstats.ts; the Item Pack panel keeps equipStatRows).
  private compareRows(instanceId: number): EquipStatRow[] | null {
    const pmt = this.names()?.pmt;
    const c = this.opts.character();
    if (!pmt || !c) return null;
    const it = c.inventory.find((o) => o.data.id === instanceId);
    if (!it) return null;
    const rc = this.rowContext();
    const current: StatBlock = {
      atp: rc.stats.atp,
      dfp: rc.stats.dfp ?? 0,
      mst: rc.stats.mst,
      ata: rc.stats.ata,
      evp: rc.stats.evp ?? 0,
      lck: rc.stats.lck ?? 0,
    };
    const worn = wornEquipment(c.inventory.filter((o) => o.equipped).map((o) => o.data));
    const problems = equipProblems(it.data, rc);
    // PlayerRecalculateStats_0068e030 (not worn) / PlayerCalculateItemStats_0068e4e8 (worn).
    const cand = it.equipped
      ? equippedCandidate(current, it.data, worn, c.charClass, pmt)
      : recalculateCandidate(current, it.data, worn, c.charClass, pmt);
    return compareStatRows(current, cand, problems === 0);
  }

  private rowContext(): RowContext {
    const c = this.opts.character();
    return {
      names: this.names(),
      charClass: c?.charClass ?? 0,
      level: c?.level ?? 1,
      stats: {
        atp: c?.stats.atp ?? 0,
        mst: c?.stats.mst ?? 0,
        ata: c?.stats.ata ?? 0,
        dfp: c?.stats.dfp ?? 0,
        evp: c?.stats.evp ?? 0,
        lck: c?.stats.lck ?? 0,
      },
      lobby: this.opts.area() === 0x0f,
    };
  }

  // unitxt_get_area_name: group 10 through area_name_map (render/warpmenu.ts
  // AREA_TEXT); map 0xB past floor 2 reads as 0xE.
  private areaName(): string {
    let area = this.opts.area();
    if (area === 0x0b && this.minimap.floor > 2) area = 0x0e;
    return this.text(10, AREA_TEXT[area] ?? -1);
  }

  // The menu inputs of the Area Map (g_KeyboardSharedState 8..11 = the
  // arrows, 0x10 Shift, 0x11 Ctrl; the left mouse button = mask 4).
  private areaMapInput(): AreaMapInput {
    const h = this.held;
    return {
      up: h.has(KEYS.selectUp),
      down: h.has(KEYS.selectDown),
      left: h.has(KEYS.selectLeft),
      right: h.has(KEYS.selectRight),
      zoomIn: h.has('shift'),
      zoomOut: h.has('control'),
      mouse: { ...this.mouse },
    };
  }

  // The pointer in the 640x480 screen (the Area Map window is on the left
  // half, so it does not follow the right edge; on a tall fill frame it sits in
  // the bottom band, so its y is taken back from that band's shift).
  private mouseEvent(e: MouseEvent): void {
    const r = this.host.getBoundingClientRect();
    if (!r.height) return;
    const f = overlayFrame(r.width, r.height);
    this.mouse.x = (e.clientX - r.left) / f.s;
    this.mouse.y = (e.clientY - r.top) / f.s - bandsOf(f.vh, f.fill).bottom;
    if (e.type === 'mousedown' && e.button === 0) this.mouse.down = true;
    if (e.type === 'mouseup' && e.button === 0) this.mouse.down = false;
    // ChallengeMenuListWindow_HandleInput_00744230 only takes a press inside
    // the window (CheckBoundsOverlap) and the drag that follows; those do not
    // reach the view's own mouse handlers. Other clicks pass (the open menu
    // already keeps them from the player, DisablePlayerInputForMenu).
    const map = this.menu.areaMap;
    if (!map?.active || e.currentTarget !== this.host) return;
    if ((e.type === 'mousedown' && e.button === 0 && map.contains(this.mouse.x, this.mouse.y)) || (e.type === 'mousemove' && map.dragging)) e.stopImmediatePropagation();
  }

  // A floor loaded (render/gameview.ts): its minimap (map_*r.rel from the
  // floor's n.rel; none on Pioneer 2 or the Lab) and its TObjRaderCol objects.
  // `read` gives null for a file the data folder does not hold.
  async enterFloor(floor: number, map: number, geometry: string | null, read: (name: string) => Promise<Uint8Array | null>, raderCols: readonly RaderCol[] = [], raderHides: readonly RaderHide[] = [], raderIcons: readonly RaderIconObject[] = []): Promise<void> {
    const token = ++this.floorToken;
    // The floor change destroys the Area Map window (its destructor clears
    // HUD flag bit 1 and minimap_type) and the Quest Board window (0x10).
    this.menu.closeAreaMap();
    this.menu.closeQuestBoard();
    this.minimap.enterFloor(floor, map, null, this.minimapFloors);
    this.minimapView.setRooms(null);
    this.raderCols = raderCols.map((c) => ({ ...c, state: 0, wait: RADER_COL_DELAY, done: false }));
    this.raderHides = raderHides.map((h) => ({ ...h, inside: false }));
    this.raderIcons = raderIcons;
    const name = geometry ? minimapFileFor(geometry) : null;
    let data: MinimapData | null = null;
    if (name) {
      try {
        const bytes = await read(name);
        data = bytes ? parseMinimapRel(bytes) : null; // Pioneer 2 and the Lab have no minimap (no r.rel)
      } catch {
        data = null;
      }
    }
    if (!this.minimapAssets) {
      this.minimapAssets = true;
      try {
        const assets = await loadMinimapAssets(this.files);
        if (this.disposed) {
          disposeMinimapAssets(assets);
          return;
        }
        this.minimapView.setAssets(assets);
      } catch (err) {
        this.opts.log?.(`minimap: no icons (${(err as Error).message})`);
      }
    }
    if (this.disposed || token !== this.floorToken) return;
    this.minimap.enterFloor(floor, map, data?.rooms ?? null, this.minimapFloors, `${floor}:${name ?? ''}`);
    this.minimapView.setRooms(data);
    if (data) this.opts.log?.(`minimap: ${name}, ${data.rooms.length} rooms`);
  }

  // One frame of the TObjRaderHideCol objects (FUN_00663400): the local player
  // inside the radius hides the minimap, leaving shows it again.
  private tickRaderHides(self: MinimapPlayer | null): void {
    if (!self) return;
    for (const h of this.raderHides) h.inside = raderHideInside(h, self);
  }

  // One frame of the radar collision objects (radar_collision_update).
  private tickRaderCols(self: MinimapPlayer | null): void {
    for (const c of this.raderCols) {
      if (c.done) continue;
      if (c.state === 0) {
        this.minimap.holdRoom(c.room);
        c.state = 1;
        continue;
      }
      if (!self) continue;
      if (c.wait > 0) {
        c.wait--;
        continue;
      }
      const dx = self.x - c.x;
      const dz = self.z - c.z;
      if (dx * dx + dz * dz < c.radius * c.radius) {
        this.minimap.revealRoom(c.room);
        c.done = true;
      }
    }
  }

  // Whether the minimap is drawn this frame (unknown_render_minimap).
  private minimapShown(): boolean {
    const m = this.minimap;
    if (!m.ready || this.counter) return false;
    if (this.raderHides.some((h) => h.inside)) return false;
    if (this.menu.isOpen && m.type !== 1) return false;
    if (this.opts.blocked() && m.type !== 1) return false;
    return !(this.opts.minimap?.hidden() ?? false) || (this.hudFlags & 1) !== 0;
  }

  // unitxt string without the language markers (render/warpmenu.ts).
  // The End key's quick menu (classic/quickmenuwindow.ts) and its start rules (classic/field.ts).
  // The weapon and technique rows and their actions are the field's own (the Equip and
  // Technique leaves' env). IsPlayerActionAllowed is ASSUMED true here.
  fieldQuickEnv(skin: WindowSkin): FieldQuickEnv {
    const tech = {
      text: (g: number, i: number) => this.text(g, i),
      level: (t: number) => this.opts.character()?.techLevels[t] ?? null,
      canCast: () => !isSafeMap(this.opts.area()),
      cast: (t: number) => this.opts.cast?.(t) ?? false,
    };
    return {
      skin,
      menu: {
        text: (g, i) => this.text(g, i),
        character: () => this.opts.character(),
        itemName: (it) => itemRowName(it.data, this.names()),
        tech,
        equip: {
          equip: (id, slot) => this.opts.items.equip(id, slot),
          unequip: (id) => this.opts.items.unequip(id),
        },
        allowed: () => true,
        tools: { use: (id) => this.opts.items.use(id, this.rules()) },
        isRare: (it) => this.names()?.isRare(it.data) ?? false,
        toolChecks: () => this.toolChecks(),
        compareRows: (id) => this.compareRows(id),
        traps: {
          // ASSUMED zeros: the quick menu's trap rows 0..3 are not wired to the trap stock here
          // (their decide sends 6x60 0x83, challengeTrap); the item list's status rows use the stock.
          statuses: () => [0, 0, 0, 0],
          // Row 4 is the sonar stock (+0x8a0), not a trap stock (classic/quickmenu.ts trapRows).
          stock: () => this.battleItems?.sonar() ?? 0,
          // is_current_map_safe is the inverse of the hub list here (see paletteWindowsShown),
          // so a trap row is enabled off the hub and off a boss area.
          safeNotBoss: () => !isSafeMap(this.opts.area()) && !BOSS_AREAS.includes(this.opts.area()),
          map: () => this.opts.area(),
          // The sonar manager is one at a time (quest/battle.ts SonarStock.active).
          managerExists: () => this.battleItems?.sonarActive() ?? false,
          // Row 4 decide: the sonar use (quest/battlerun.ts useSonar; the battle arena gate is there).
          useSonar: () => this.battleItems?.useSonar() ?? false,
          sendStatus: (row, count) => this.opts.challengeTrap?.(row, count),
        },
        techOrder: {
          get: () => this.currentTechOrder(),
          set: (order) => {
            this.techOrder = [...order];
            this.techOrderDirty = true;
          },
          commit: () => this.commitTechOrder(),
        },
      },
      mode: () => ((readOptionFlags(this.opts.fullCharacter()) ?? 0) & 0x30000) >>> 16,
      // Battle mode: a battle team is set while the battle runs (quest/battlerun.ts).
      battle: () => this.battleTeam !== null,
      android: () => ANDROID_CLASSES.has(this.opts.character()?.charClass ?? 0),
    };
  }

  // The Item Pack's Battle Mode rows (classic/itempack.ts ChallengeListEnv); null outside a battle.
  // The one-row menu's selectable flag is AddMenuItemList's: not a hub map and not a boss map.
  private challengeListEnv(): ChallengeListEnv | null {
    const b = this.battleItems;
    if (!b) return null;
    return {
      traps: () => b.traps(),
      sonar: () => b.sonar(),
      selectable: () => {
        const a = this.opts.area();
        return menuRowSelectable(!isSafeMap(a), BOSS_AREAS.includes(a));
      },
      activate: (statusIndex, menuValue) => b.activate(statusIndex, menuValue),
    };
  }

  private text(group: number, index: number): string {
    return (this.groups?.[group]?.[index] ?? '').replace(/\t[CEJ][0-9A-Za-z]?/g, '');
  }

  get counterOpen(): boolean {
    return !!this.counter;
  }

  get returnPromptOpen(): boolean {
    return !!this.returnPrompt;
  }

  // The dead prompt (0x006920ac -> DialogListItem_Constructor_0073f0ec): onAnswer
  // gets true for Yes. The movement keys are off while it is up.
  openReturnPrompt(onAnswer: (yes: boolean) => void): void {
    const token = ++this.returnToken;
    this.load()
      .then(() => {
        if (this.disposed || token !== this.returnToken) return;
        this.returnPrompt = new ReturnPrompt(this.text(11, RETURN_TEXT), this.text(11, RETURN_YES), this.text(11, RETURN_NO), (yes) => {
          this.returnPrompt = null;
          onAnswer(yes);
        });
        this.opts.log?.('dead prompt: return to Pioneer 2?');
      })
      .catch((err) => this.opts.log?.(`dead prompt: no text (${(err as Error).message})`));
  }

  // The player is alive again (a Reverser / Moon Atomizer) or the prompt is no longer wanted.
  closeReturnPrompt(): void {
    this.returnToken++;
    this.returnPrompt = null;
  }

  // Opens a Pioneer 2 counter (bb_p2_menu 0 / 2 / 3 / 5); resolves when it
  // closes. The movement keys are off meanwhile (unknown_keyboard_enable_in_menu(0)).
  async openCounter(kind: CounterKind): Promise<void> {
    if (this.counter) return;
    await this.load();
    if (!this.shopGroups) {
      const { data } = await this.files.readFirst(['unitxt_shop_j.prs', 'unitxt_shop_e.prs']);
      this.shopGroups = parseUnitxt(data);
    }
    if (this.disposed || this.counter) return;
    this.menu.close();
    const counter = createCounter(
      {
        shopText: (i, g = 0) => this.shopGroups?.[g]?.[i] ?? '',
        text: (g, i) => this.text(g, i),
        character: () => this.opts.character(),
        rowContext: () => this.rowContext(),
        pmt: () => this.names()?.pmt ?? null,
        items: this.opts.items,
        picture: (item) => this.itemPicture(item),
        ...(this.opts.music ? { music: this.opts.music } : {}),
        log: this.opts.log,
      },
      kind,
    );
    this.counter = counter;
    this.opts.log?.(`counter: ${kind} open`);
    await new Promise<void>((resolve) => {
      counter.onClose = () => {
        if (this.counter === counter) this.counter = null;
        this.opts.log?.(`counter: ${kind} closed`);
        resolve();
      };
      counter.start();
    });
  }

  // The item's picture (ItemKTep4.afs, formats/itemkt.ts) as a bitmap, or
  // null when the exe draws none. The archive is read once.
  private async itemPicture(item: ItemData): Promise<ImageBitmap | null> {
    if (!this.itemKt) {
      this.itemKt = this.files.read(ITEM_KT_FILE).then((data) => new AFSArchive(data));
    }
    const pmt = this.names()?.pmt ?? null;
    const weaponId = item.data1[0] === 0 ? pmt?.getWeapon(item.data1[1], item.data1[2])?.id : undefined;
    const entry = itemPictureEntry(item.data1, weaponId);
    if (entry === null) return null;
    const archive = await this.itemKt;
    if (entry >= archive.entries.length) return null;
    const [tex] = parseXvm(archive.get(entry));
    return tex ? textureBitmap(tex) : null;
  }

  async load(): Promise<void> {
    if (this.tex) return;
    const hyouji = await textureBitmaps(await this.files.textures('f256_hyouji.prs'));
    const jp = await textureBitmaps(await this.files.textures('texturejapanese.xvm'));
    // Ephinea's loose unitxt_j.prs is the English text (render/warpmenu.ts).
    const { data } = await this.files.readFirst(['unitxt_j.prs', 'unitxt_e.prs']);
    this.groups = parseUnitxt(data);
    if (this.disposed) return;
    const skin = { frame: hyouji[1], bars: hyouji[2] };
    const palette = { bg: hyouji[2], tabs: hyouji[0], icons: { 5: hyouji[5], 6: hyouji[6], 7: hyouji[7] }, digits: jp[0] };
    this.tex = {
      skin,
      menu: { menu: { panel: hyouji[13], labels: jp[2] }, icons: hyouji[1], arrows: hyouji[0], bars: hyouji[2], digits: jp[0], palette },
      palette,
    };
  }

  // Chains viewer.onFrame (call after the floor's LobbyView / GameField /
  // CombatView took it): no keys reach the player while the menu is open,
  // and the menu's view shift is applied to the projection.
  attach(): void {
    const inner = this.viewer.onFrame;
    this.viewer.onFrame = (dt, keys) => {
      inner?.(dt, this.menu.isOpen || this.counter || this.returnPrompt ? NO_KEYS : keys);
      applyMenuViewShift(this.viewer.camera, this.menu.shift);
    };
  }

  private key(e: KeyboardEvent): void {
    if (this.disposed) return;
    this.held.add(e.key.toLowerCase());
    if (this.counter) {
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.counter.key(e);
      return;
    }
    if (this.returnPrompt) {
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.returnPrompt.key(e);
      return;
    }
    if (this.opts.blocked()) return;
    const k = e.key.toLowerCase();
    if (k === KEYS.menu || k === bindingKey(BINDING.mainMenu2)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.tex) this.menu.toggle();
      return;
    }
    // The function-key shortcuts (input/shortcuts.ts): F2..F4 open the field's leaves.
    if (!this.menu.isOpen && this.tex) {
      const a = functionKeyAction(e, functionKeyNames(), chatFormOption(this.opts.fullCharacter()));
      if (a?.kind === 'help') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.helpOpen = !this.helpOpen;
        return;
      }
      // F11: Keyboard Controls ON / OFF (classic/options.ts toggleKeyboardControls, dump 697159).
      if (a?.kind === 'keyboardToggle') {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleKeyboardControls(this.opts.fullCharacter(), this.opts.send ?? (() => {}));
        return;
      }
      // F9 / F10: the team chat window and its lock (classic/teamchat.ts).
      if (this.opts.teamChat && (a?.kind === 'teamChat' || a?.kind === 'teamChatLock')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (a.kind === 'teamChat') this.opts.teamChat.toggle();
        else this.opts.teamChat.toggleLock();
        return;
      }
      if (a?.kind === 'menu' && this.menu.openShortcut(a.id)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    // The chat shortcuts (handle_chat_shortcuts, dump 674857): the raw F keys send a slot
    // when no menu is open. Which keys depend on the Function Key option (chatFormOption).
    if (!this.menu.isOpen && this.opts.chatShortcut) {
      const slot = chatShortcutIndex(e, chatFormOption(this.opts.fullCharacter()));
      if (slot >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.opts.chatShortcut(slot);
        return;
      }
    }
    if (this.menu.isOpen) {
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.menu.key(e);
      return;
    }
    // Ctrl is also the Area Map's zoom out; HandlePlayerPaletteToggle_00694f0c
    // does nothing while the menu (which holds the Area Map) is open, as here.
    if (e.key === 'Control' && !e.repeat && this.palette) this.paletteHud.flip(this.palette);
  }

  // The F1 help list: 12 rows, group 11 0x161..0x16c (exe unknown_render_help_menu). ASSUMED:
  // the geometry (the exe's list is built at 320 x 240 with width 0.1, row step not read here).
  private drawHelp(ctx: CanvasRenderingContext2D, extra: number, bottom: number): void {
    if (!this.tex) return;
    const lines = Array.from({ length: 12 }, (_, i) => this.text(11, 0x161 + i)).join('\n');
    const w = 360;
    const h = 12 * HELP_ROW + 2 * INSET;
    const x = anchorX(320 - w / 2, w, extra);
    const y = 240 - h / 2 + bottom;
    drawTextWindow(ctx, this.tex.skin, { x, y, w, h }, lines);
  }

  private frame(dt: number): void {
    if (this.disposed) return;
    this.palette ??= paletteFromCharacter(this.opts.fullCharacter());
    // PSOBBCharacterFile option_flags (+0x4ec): the window speed.
    const full = this.opts.fullCharacter();
    this.menu.speed = WindowAnim.speedOf(full && full.length >= 0x4f0 ? new DataView(full.buffer, full.byteOffset).getUint32(0x4ec, true) : undefined);
    this.acc += dt;
    while (this.acc >= FRAME) {
      this.acc -= FRAME;
      this.menu.tick();
      // The trade session's timers run with no window open; a partner's proposal opens
      // the accept prompt (classic/trade.ts, ASSUMED: the exe's trade_invite_menu2/3).
      const trade = this.opts.trade?.() ?? null;
      if (trade) {
        trade.session.tick();
        if (trade.session.status === TRADE_STATUS.requested && !this.menu.trade) this.menu.openTrade(true);
      }
      this.paletteHud.tick();
      this.opts.items.tickMags();
      this.opts.items.tickPickups();
      this.opts.items.tickDrops();
      this.counter?.tick();
      const src = this.opts.minimap;
      if (src) this.tickRaderHides(src.self());
      if (src && this.minimap.loaded) {
        const self = src.self();
        this.tickRaderCols(self);
        this.minimap.update(self, src.others(), src.cameraYaw(), src.battle());
        if (this.minimapShown()) this.minimap.fadeRooms();
      }
    }
    this.watchInventory();
    this.draw();
  }

  // The Item Pack list follows the inventory (6x25..6x2A, 6xBE, pickups).
  private watchInventory(): void {
    const c = this.opts.character();
    const key = c ? `${c.meseta}|${c.inventory.map((i) => `${i.data.id}:${i.equipped ? 1 : 0}:${stackSize(i.data)}:${[...i.data.data1].join(',')}`).join(';')}` : '';
    if (key === this.inventoryKey) return;
    this.inventoryKey = key;
    this.menu.inventoryChanged();
  }

  // Stack count of palette item index i (0x0096f51c).
  private itemCount(i: number): number {
    const id = this.paletteItemId(i);
    const it = id === null ? undefined : this.opts.character()?.inventory.find((x) => x.data.id === id);
    return it ? stackSize(it.data) : 0;
  }

  // The inventory item id of palette item index i (PALETTE_ITEMS: the tool's data1[1], data1[2]), null when the bag has none.
  private paletteItemId(i: number): number | null {
    const t = PALETTE_ITEMS[i];
    const it = t && this.opts.character()?.inventory.find((x) => x.data.data1[0] === 3 && x.data.data1[1] === t[0] && x.data.data1[2] === t[1]);
    return it ? it.data.id : null;
  }

  private draw(): void {
    const host = this.host;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    Object.assign(this.canvas.style, { left: `${host.offsetLeft}px`, top: `${host.offsetTop}px`, width: `${w}px`, height: `${h}px` });
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.tex || !this.canvas.height) return;
    // Tall fill (phone portrait): the palette stays at the bottom, the radar at
    // the top, the menus and the counter centred or at the bottom (stage.ts bandsOf).
    const f = overlayFrame(this.canvas.width, this.canvas.height);
    const s = f.s;
    const extra = f.extra;
    const bands = bandsOf(f.vh, f.fill);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // The action palette (GUI 0x20) and the hotbar (GUI 0x21) are shown on an unsafe map only
    // (classic/fieldmenu.ts paletteWindowsShown): Pioneer 2 and the hubs show neither.
    const paletteShown = paletteWindowsShown(this.opts.area());
    if (this.palette && paletteShown && !this.menu.isOpen && !this.counter) {
      this.paletteHud.draw(ctx, this.tex.palette, { data: this.palette, itemCount: (i) => this.itemCount(i), trapCount: (t) => this.trapCount?.(t) ?? 0 }, anchorX(PALETTE_POS.x, PALETTE_SIZE.w, extra), PALETTE_POS.y + bands.bottom);
    }
    // The bottom hotbar (GUI 0x21 = (0, 442)): hidden with the menus (unknown_update_player_menu_hide_hotbar) and on a safe map.
    if (this.palette && paletteShown && !this.menu.isOpen && !this.counter) {
      const slots = currentPalette(this.palette).hotbar;
      drawHotbar(ctx, this.tex.palette, slots, { itemCount: (i) => this.itemCount(i), trapCount: (t) => this.trapCount?.(t) ?? 0 }, HOTBAR_POS.x, hotbarY(false) + bands.bottom);
    }
    const prompt = !this.menu.isOpen && !this.counter ? this.prompt?.() : null;
    if (prompt) {
      // Window 0x35 = (267, 130), sized to its line (ASSUMED layout).
      const w = gameTextWidth(prompt) + 2 * INSET;
      drawTextWindow(ctx, this.tex.skin, { x: anchorX(PROMPT_POS[0], w, extra), y: PROMPT_POS[1], w, h: LINE + 2 * INSET }, prompt);
    }
    this.menu.draw(ctx, this.tex.skin, this.tex.menu, extra, bands.bottom);
    if (this.helpOpen && !this.menu.isOpen) this.drawHelp(ctx, extra, bands.bottom);
    if (this.opts.teamChat?.open) drawTeamLog(ctx, this.tex.skin, this.opts.teamChat.log);
    if (this.minimapShown()) {
      // The enemies' icons (unknown_add_minimap_icon from each enemy's update).
      for (const e of this.opts.minimap?.enemies() ?? []) {
        const rule = enemyIconRule(e.type);
        this.minimap.addIcon({ x: e.x, z: e.z, color: rule.color, shape: 1, scale: rule.scale, heading: 0 }, rule.forced);
      }
      for (const ic of this.opts.minimap?.forcedIcons?.() ?? []) this.minimap.addIcon(ic, true);
      // The TObjRaderIcon switches and the doors (their own update adds them).
      const src = this.opts.minimap;
      for (const r of this.raderIcons) this.minimap.addIcon(raderIconIcon(r, (f) => src?.switchOn(f) ?? false));
      for (const ic of src?.doorIcons() ?? []) this.minimap.addIcon(ic);
      for (const ic of src?.komoIcons?.() ?? []) this.minimap.addIcon(ic);
      // The radar follows the right edge; the full map stays in its window.
      ctx.save();
      ctx.translate(0, this.minimap.type === 0 ? 0 : bands.bottom);
      this.minimapView.draw(ctx, this.minimap, s, this.minimap.type === 0 ? extra : 0);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(0, bands.mid);
    this.counter?.draw(ctx, this.tex.skin, this.tex.menu, extra);
    ctx.restore();
    this.returnPrompt?.draw(ctx, this.tex.skin);
  }

  // Console aid: window.gameView.hud.debug()
  debug() {
    const m = this.minimap;
    return {
      palette: this.palette,
      menuOpen: this.menu.isOpen,
      itemPack: this.menu.leafDebug(),
      counter: this.counter?.state() ?? null,
      minimap: {
        type: m.type,
        loaded: m.loaded,
        shown: this.minimapShown(),
        rooms: m.rooms.length,
        discovered: m.rooms.filter((r) => !(r.flags & 1)).length,
        radar: { ...m.radar },
        full: { ...m.full },
        markers: m.markers.length,
        hudFlags: this.hudFlags,
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    // Closing the menu destroys an open Options window, which saves (01ED).
    this.menu.close();
    this.counter?.close();
    this.returnPrompt = null;
    this.host.removeEventListener('keydown', this.onKey, true);
    this.host.removeEventListener('keyup', this.onKeyUp, true);
    this.host.removeEventListener('blur', this.onBlur);
    for (const t of ['mousedown', 'mousemove', 'mouseup'] as const) this.host.removeEventListener(t, this.onMouse, true);
    window.removeEventListener('mouseup', this.onMouse);
    this.menu.closeAreaMap();
    this.menu.closeQuestBoard();
    this.minimap.leaveFloor(this.minimapFloors);
    this.minimapView.dispose();
    this.viewer.frameHooks.delete(this.hook);
    this.canvas.remove();
  }
}
