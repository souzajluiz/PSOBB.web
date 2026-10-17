// Per-floor game logic around the game view: floor music (audio/fieldbgm.ts),
// warp menus (warpmenu.ts), doors and switches (fieldobjects.ts) and the
// switch flags they share with the other players (6x05).
//
// The warp objects follow the base class update FUN_006698e0: inside the
// radius the menu opens; leaving the radius closes it; Cancel keeps it closed
// until the player has left the radius once (+0xbc). PsoBB.exe measures the
// radius in 3D (FUN_00669a58); here the check is horizontal with a 30-unit
// height window because the position other players see (6x42) has no height
// while running.

import type { BgmPlayer } from '../audio/bgm.ts';
import { FieldMusic } from '../audio/fieldbgm.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { PlacedEntity } from '../formats/setdata.ts';
import { floorToArea, parseSwitchFlag, type Game } from '../net/game.ts';
import { FieldObjects, type FieldSwitch, type FieldWarp } from './fieldobjects.ts';
import type { MapViewer } from './mapviewer.ts';
import { areaWarpLayout, mainWarpItems, mainWarpLayout, WarpMenuOverlay } from './warpmenu.ts';
import { gameTextWidth } from '../classic/gametext.ts';

export interface GameFieldOptions {
  bgm?: BgmPlayer | null;
  warpTo: (floor: number) => Promise<void>;
  toLobby: () => void;
  log: (msg: string) => void;
}

const NO_KEYS: ReadonlySet<string> = new Set();
const HEIGHT_WINDOW = 30;

export class GameField {
  private viewer: MapViewer;
  private game: Game;
  private files: ClientFiles;
  private opts: GameFieldOptions;
  private music: FieldMusic | null;
  readonly menu: WarpMenuOverlay;
  private objects: FieldObjects | null = null;
  private floor = 0;
  private objectBase = 0;
  private flags = new Map<number, Set<number>>(); // switch flags by floor
  private suppressed = new Set<number>(); // warps cancelled until the player leaves them
  private menuWarp: FieldWarp | null = null;
  private busy = false;
  private disposed = false;

  constructor(viewer: MapViewer, game: Game, files: ClientFiles, opts: GameFieldOptions) {
    this.viewer = viewer;
    this.game = game;
    this.files = files;
    this.opts = opts;
    this.music = opts.bgm ? new FieldMusic(opts.bgm) : null;
    this.menu = new WarpMenuOverlay(viewer.renderer.domElement);
    void this.menu.load(files).catch((err) => opts.log(`warp menu: ${(err as Error).message}`));
    const onSub = (sub: number, _client: number, body: Uint8Array) => {
      if (sub !== 0x05 || this.disposed) return;
      const s = parseSwitchFlag(body);
      if (!s || s.flag >= 0x100) return;
      const set = this.flagsOf(s.floor);
      if (s.set) set.add(s.flag);
      else set.delete(s.flag);
    };
    game.on('subcommand', onSub); // Lobby has no off(); the handler goes idle on dispose
  }

  private flagsOf(floor: number): Set<number> {
    let s = this.flags.get(floor);
    if (!s) this.flags.set(floor, (s = new Set()));
    return s;
  }

  // A floor was loaded. `objectBase` = number of objects on the floors before
  // this one (entity ids are 0x4000 + global object index).
  enterFloor(floor: number, area: number, placed: PlacedEntity[], objectBase: number): void {
    this.menu.close();
    this.objects?.dispose();
    this.floor = floor;
    this.objectBase = objectBase;
    this.suppressed.clear();
    const episode = this.game.info?.episode ?? 1;
    this.objects = new FieldObjects(this.viewer, placed, { episode, floor, area }, this.flagsOf(floor));
    this.objects.onSwitch = (s) => this.pressSwitch(s);
    this.music?.enter(area, episode);
    const o = this.objects;
    this.opts.log(`floor ${floor}: ${o.warps.length} warps (${o.warps.map((w) => `${w.kind}${w.floor >= 0 ? `->${w.floor}` : ''}`).join(', ')}), ${o.doors.length} doors, ${o.switches.length} switches`);
  }

  // Call after the LobbyView of the floor has been created: it takes over
  // viewer.onFrame; movement keys are held back while a menu is open
  // (FUN_00791748(0) disables the player's control in the exe).
  attach(): void {
    const inner = this.viewer.onFrame;
    this.viewer.onFrame = (dt, keys) => {
      inner?.(dt, this.menu.open ? NO_KEYS : keys);
      this.frame(dt);
    };
  }

  private pressSwitch(s: FieldSwitch): void {
    this.opts.log(`switch ${s.index} on floor ${this.floor}: flag ${s.flag}`);
    this.game.sendSwitchFlag(0x4000 + this.objectBase + s.index, this.floor, s.flag, true);
  }

  private frame(dt: number): void {
    if (this.disposed) return;
    const me = this.game.self;
    const pos = me && !this.game.loading ? me.position : null;
    this.music?.tick(dt, pos);
    const others = [...this.game.players.values()].filter((p) => p.clientId !== me?.clientId && p.floor === this.floor && p.visible !== false).map((p) => p.position);
    this.objects?.frame(pos, others);
    if (pos && !this.busy) this.watchWarps(pos);
  }

  private inside(w: FieldWarp, p: { x: number; y: number; z: number }): boolean {
    return Math.hypot(w.x - p.x, w.z - p.z) < w.radius && Math.abs(w.y - p.y) < HEIGHT_WINDOW;
  }

  private watchWarps(p: { x: number; y: number; z: number }): void {
    const warps = this.objects?.warps ?? [];
    for (const w of warps) if (!this.inside(w, p)) this.suppressed.delete(w.index);
    if (this.menu.open) {
      if (this.menuWarp && !this.inside(this.menuWarp, p)) this.menu.close(null); // walked out of the radius
      return;
    }
    const w = warps.find((x) => this.inside(x, p) && !this.suppressed.has(x.index));
    if (!w) return;
    if (w.flag >= 0 && !this.flagsOf(this.floor).has(w.flag)) return; // boss warp still locked
    void this.openMenu(w);
  }

  private async openMenu(w: FieldWarp): Promise<void> {
    const episode = this.game.info?.episode ?? 1;
    let choice: Promise<number | null>;
    if (w.kind === 'main') {
      const items = mainWarpItems(episode, w.warpType).map((it) => ({ label: this.menu.label(it.text), floor: it.floor }));
      choice = this.menu.show(items, mainWarpLayout(items.length));
    } else {
      const area = w.kind === 'lobby' ? 0x0f : (floorToArea(episode)[w.floor] ?? -1);
      const label = this.menu.areaName(area);
      choice = this.menu.show([{ label, floor: w.floor }], areaWarpLayout(gameTextWidth(label)));
    }
    this.menuWarp = w;
    const floor = await choice;
    this.menuWarp = null;
    if (floor === null) {
      if (this.objects?.warps.includes(w)) this.suppressed.add(w.index);
      return;
    }
    this.suppressed.add(w.index);
    if (w.kind === 'lobby') {
      this.opts.log('lobby teleporter');
      this.opts.toLobby();
      return;
    }
    this.busy = true;
    this.opts.log(`${w.kind} warp to floor ${floor}`);
    try {
      await this.opts.warpTo(floor);
    } catch (err) {
      this.opts.log(`warp failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.menu.dispose();
    this.objects?.dispose();
    this.objects = null;
    this.opts.bgm?.stop();
  }
}
