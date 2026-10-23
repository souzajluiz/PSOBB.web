// The classic field HUD of a game: the action palette at the bottom right and
// the main menu (Home / F12) with its Item Pack and Technique windows, drawn
// with the classic renderers (classic/palette.ts, classic/fieldmenu.ts) on a
// 2D canvas laid over the game's 3D canvas, like render/warpmenu.ts.
//
// PsoBB.exe (Ephinea 1.25.13) behaviour kept here:
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

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { parseUnitxt } from '../classic/charcreate_text.ts';
import { MENU_LAYER } from '../classic/hud.ts';
import { WindowAnim } from '../classic/windowanim.ts';
import { anchorX } from '../classic/ingame.ts';
import { drawTextWindow, INSET, LINE } from '../classic/fieldwindows.ts';
import { gameTextWidth } from '../classic/gametext.ts';
import { FieldMenu, isSafeMap, type FieldMenuTextures } from '../classic/fieldmenu.ts';
import { equipProblems, undroppable, type RowContext } from '../classic/itempack.ts';
import { createCounter, type Counter, type CounterKind } from '../classic/shop.ts';
import { ReturnPrompt, RETURN_NO, RETURN_TEXT, RETURN_YES } from '../classic/returnprompt.ts';
import { menuViewShift } from '../classic/mainmenu.ts';
import { characterOptionsEnv, restoreBrightness } from '../classic/options.ts';
import { currentPalette, PALETTE_ITEMS, PALETTE_POS, PALETTE_SIZE, PaletteHud, paletteFromCharacter, type PaletteData, type PaletteSlot, type PaletteTextures } from '../classic/palette.ts';
import { bandsOf, overlayFrame, textureBitmaps, type WindowSkin } from '../classic/stage.ts';
import type { ItemNames } from '../formats/itemnames.ts';
import type { CharacterFile } from '../net/charfile.ts';
import { MESETA_ITEM_ID, stackSize, type GameItems } from '../net/items.ts';
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
  cameraYaw: () => number; // the camera's y_rotation (BAMS)
  hidden: () => boolean; // a talk camera or a UI that blocks the player's input
  switchOn: (flag: number) => boolean; // a switch flag of this floor (TObjRaderIcon colour)
  doorIcons: () => readonly Icon[]; // the doors' icons (TObjDoor, this floor)
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

export interface FieldHudOptions {
  character: () => CharacterFile | null;
  fullCharacter: () => Uint8Array | null;
  items: GameItems;
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
  // Another window (a warp menu) has the keyboard.
  blocked: () => boolean;
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
  private shopGroups: string[][] | null = null;
  // The open shop / bank counter (classic/shop.ts), opened by quest/town.ts.
  private counter: Counter | null = null;
  // The dead prompt (classic/returnprompt.ts): open while the player is dead and
  // the death fade is over. `returnToken` drops a prompt that closed while its
  // unitxt text was still loading.
  private returnPrompt: ReturnPrompt | null = null;
  private returnToken = 0;
  private names: () => ItemNames | null = () => null;
  private palette: PaletteData | null = null;
  private paletteHud = new PaletteHud();
  // Battle Mode trap stock by type 0..3 (set by quest/battlerun.ts while a battle runs).
  trapCount: ((type: number) => number) | null = null;
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
        return { lobby: area === 0x0f, safe: isSafeMap(area), online: true, questStarted: this.opts.questStarted(), inTeam: false };
      },
      android: () => ANDROID_CLASSES.has(this.opts.character()?.charClass ?? 0),
      itemPack: {
        character: () => this.opts.character(),
        rowContext: () => this.rowContext(),
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
      questBoard: {
        vm: () => this.opts.quest?.()?.vm ?? null,
        questName: () => this.opts.quest?.()?.name ?? '',
        questKey: (e) => this.opts.questKey?.(e) ?? false,
        text: (g, i) => this.text(g, i),
        setHudFlag: (bit, on) => {
          this.hudFlags = on ? this.hudFlags | bit : this.hudFlags & ~bit;
        },
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

  // ItemPMT of the item names (MAG feeding, render/gameview.ts).
  get pmt(): ItemNames['pmt'] | null {
    return this.names()?.pmt ?? null;
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
      up: h.has('arrowup'),
      down: h.has('arrowdown'),
      left: h.has('arrowleft'),
      right: h.has('arrowright'),
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

  async load(): Promise<void> {
    if (this.tex) return;
    const hyouji = await textureBitmaps(await this.files.textures('f256_hyouji.prs'));
    const jp = await textureBitmaps(await this.files.textures('texturejapanese.xvm'));
    // Ephinea's loose unitxt_j.prs is the English text (render/warpmenu.ts).
    const { data } = await this.files.readFirst(['unitxt_j.prs', 'unitxt_e.prs']);
    this.groups = parseUnitxt(data);
    if (this.disposed) return;
    const skin = { frame: hyouji[1], bars: hyouji[2] };
    this.tex = {
      skin,
      menu: { menu: { panel: hyouji[13], labels: jp[2] }, icons: hyouji[1], arrows: hyouji[0], bars: hyouji[2], digits: jp[0] },
      palette: { bg: hyouji[2], tabs: hyouji[0], icons: { 5: hyouji[5], 6: hyouji[6], 7: hyouji[7] }, digits: jp[0] },
    };
  }

  // Chains viewer.onFrame (call after the floor's LobbyView / GameField /
  // CombatView took it): no keys reach the player while the menu is open,
  // and the menu's view shift is applied to the projection.
  attach(): void {
    const inner = this.viewer.onFrame;
    this.viewer.onFrame = (dt, keys) => {
      inner?.(dt, this.menu.isOpen || this.counter || this.returnPrompt ? NO_KEYS : keys);
      const cam = this.viewer.camera;
      cam.updateProjectionMatrix();
      const f = this.menu.shift;
      if (f) {
        const { ox, oy, s } = menuViewShift(f);
        cam.projectionMatrix.premultiply(new THREE.Matrix4().set(s, 0, 0, ox, 0, s, 0, oy, 0, 0, 1, 0, 0, 0, 0, 1));
        cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      }
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
    if (e.key === 'Home' || e.key === 'F12') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.tex) this.menu.toggle();
      return;
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
    const t = PALETTE_ITEMS[i];
    const it = t && this.opts.character()?.inventory.find((x) => x.data.data1[0] === 3 && x.data.data1[1] === t[0] && x.data.data1[2] === t[1]);
    return it ? stackSize(it.data) : 0;
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
    if (this.palette && !this.menu.isOpen && !this.counter) {
      this.paletteHud.draw(ctx, this.tex.palette, { data: this.palette, itemCount: (i) => this.itemCount(i), trapCount: (t) => this.trapCount?.(t) ?? 0 }, anchorX(PALETTE_POS.x, PALETTE_SIZE.w, extra), PALETTE_POS.y + bands.bottom);
    }
    const prompt = !this.menu.isOpen && !this.counter ? this.prompt?.() : null;
    if (prompt) {
      // Window 0x35 = (267, 130), sized to its line (ASSUMED layout).
      const w = gameTextWidth(prompt) + 2 * INSET;
      drawTextWindow(ctx, this.tex.skin, { x: anchorX(PROMPT_POS[0], w, extra), y: PROMPT_POS[1], w, h: LINE + 2 * INSET }, prompt);
    }
    this.menu.draw(ctx, this.tex.skin, this.tex.menu, extra, bands.bottom);
    if (this.minimapShown()) {
      // The enemies' icons (unknown_add_minimap_icon from each enemy's update).
      for (const e of this.opts.minimap?.enemies() ?? []) {
        const rule = enemyIconRule(e.type);
        this.minimap.addIcon({ x: e.x, z: e.z, color: rule.color, shape: 1, scale: rule.scale, heading: 0 }, rule.forced);
      }
      // The TObjRaderIcon switches and the doors (their own update adds them).
      const src = this.opts.minimap;
      for (const r of this.raderIcons) this.minimap.addIcon(raderIconIcon(r, (f) => src?.switchOn(f) ?? false));
      for (const ic of src?.doorIcons() ?? []) this.minimap.addIcon(ic);
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
