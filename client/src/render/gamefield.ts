// Per-floor game logic around the game view: floor music (audio/fieldbgm.ts),
// warp menus (warpmenu.ts), doors, switches and boxes (fieldobjects.ts,
// models from render/objectview.ts), the wave events of the floor
// (render/waves.ts, formats/events.ts) and the state they share with the
// other players (6x05, 6x67, 6x76).
//
// The warp objects follow the base class update FUN_006698e0: inside the
// radius the menu opens; leaving the radius closes it; Cancel keeps it closed
// until the player has left the radius once (+0xbc). PsoBB.exe measures the
// radius in 3D (FUN_00669a58); here the check is horizontal with a 30-unit
// height window because the position other players see (6x42) has no height
// while running.
//
// Wave events: a TObjEvtCollision the player walks into (or a trigger_event
// action) sends 6x67 and starts the event's wave; the enemies of that room and
// wave appear after the event's delay; when they are all dead the event's
// action stream runs (unlock doors with 6x05, start the next wave with 6x67).
// Enemies only exist once their wave has spawned, so the enemy layer starts
// hidden (EnemyLayer.startHidden) and each wave shows its own.
// While a wave of the local player's room is alive the music is the battle
// variant (FUN_0069821c -> FUN_008114b0), and it returns to calm 90 frames
// after the last enemy of the room dies.

import type { BgmPlayer } from '../audio/bgm.ts';
import { bossPhaseOf } from '../audio/bossbgm.ts';
import { FieldMusic } from '../audio/fieldbgm.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { parseEventFile, type WaveEvent } from '../formats/events.ts';
import { enemySlots } from '../formats/enemyids.ts';
import type { MapSection } from '../formats/nrel.ts';
import type { EnemySet, PlacedEntity } from '../formats/setdata.ts';
import { floorToArea, parseSwitchFlag, type Game } from '../net/game.ts';
import type { CollisionWorld } from './collision.ts';
import type { EnemyLayer } from './enemyview.ts';
import { constructKey, FieldObjects, MAP_WARP_TEXT, type FieldSwitch, type FieldWarp } from './fieldobjects.ts';
import type { MapViewer } from './mapviewer.ts';
import type { ObjectLayer } from './objectview.ts';
import { BATTLE_LINGER_FRAMES, ENEMY_BUILT, ENEMY_DEAD, FloorWaves, type WaveEnemy } from './waves.ts';
import type { JoinSyncState, SyncFloor, SyncLayout } from '../net/joinsync.ts';
import { PillarTrap, TRAP_HOLD, TRAP_TECH, type TrapEvent, type TrapPlayer } from './traps.ts';
import { PLAYER_RADIUS } from '../combat/enemyfsm.ts';
import { se } from '../audio/se.ts';
import { BossWarp, CONFIRM_WIDTH, POS_CONFIRM, POS_MESSAGE, POS_PLAYER_LIST } from './bosswarp.ts';
import { areaWarpLayout, CCA_WARP, ccaWarpLayout, mainWarpItems, mainWarpLayout, textWindowLayout, WarpMenuOverlay } from './warpmenu.ts';
import { gameTextWidth } from '../classic/gametext.ts';

export interface GameFieldOptions {
  bgm?: BgmPlayer | null;
  // Runs the quest VM's threads on the game clock, if a quest is loaded
  // (quest/session.ts tick()).
  tickQuest?: (dt: number) => void;
  warpTo: (floor: number) => Promise<void>;
  // Intra-floor warp of the local player (6x55, render/lobbyview.ts warpSelf).
  warpSelf?: (pos: { x: number; y: number; z: number }, angle: number) => void;
  // The NPC talk's camera mover view (render/npcview.ts), if any.
  talkCamera?: () => { source: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null;
  toLobby: () => void;
  // A pillar trap's hold or technique on a player (render/traps.ts); combat
  // applies those on the local player.
  trap?: (e: TrapEvent, trap: PillarTrap) => void;
  log: (msg: string) => void;
}

// What loadFloor() hands over with the floor's entities.
export interface FloorEntities {
  placed: PlacedEntity[]; // objects of the floor (markers already placed)
  objectBase: number; // objects on the floors before this one
  // The floor's place in the game-wide join sync tables, when a 6x6E came
  // (net/joinsync.ts): its set flags, wave event flags and switches apply.
  sync?: SyncFloor | null;
  enemySets: EnemySet[]; // e.dat entries of the floor
  enemyBase: number; // enemy slots on the floors before this one
  eventFile: Uint8Array | null; // the floor's .evt
  sections: MapSection[];
  enemies: EnemyLayer | null;
  objects: ObjectLayer | null;
  collision: CollisionWorld | null;
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
  private area = 0;
  private objectBase = 0;
  private flags = new Map<number, Set<number>>(); // switch flags by floor
  private constructed = new Map<number, Set<string>>(); // construct_objects by floor
  private suppressed = new Set<number>(); // warps cancelled until the player leaves them
  private menuWarp: FieldWarp | null = null;
  // Boss warp the player is standing in and its state machine.
  private bossWarpObject: FieldWarp | null = null;
  private bossWarp = new BossWarp();
  private bossWarpPrompt = false;
  private busy = false;
  private disposed = false;
  // Wave events: state per floor, kept across floor changes like the client's
  // g_MapEventTablesArray.
  private waves = new Map<number, FloorWaves>();
  private pendingTriggers = new Map<number, Set<number>>(); // 6x67 for floors not loaded yet
  private pendingKills = new Map<number, Set<number>>(); // 6x76 flag 8 for floors not loaded yet (entity ids)
  private syncFloor: SyncFloor | null = null;
  private slotBases = new Map<number, { base: number; first: number[] }>(); // enemy slots of the floors loaded so far
  private enemies: EnemyLayer | null = null;
  private sections: MapSection[] = [];
  private enemyFirstSlot: number[] = [];
  private enemyBase = 0;
  private traps: Array<{ index: number; trap: PillarTrap }> = []; // TOTrapAncient02 / 02R of the floor
  private battleFrames = 0; // 0x5a countdown after the room is cleared
  private battle = false;
  private frameAcc = 0;

  constructor(viewer: MapViewer, game: Game, files: ClientFiles, opts: GameFieldOptions) {
    this.viewer = viewer;
    this.game = game;
    this.files = files;
    this.opts = opts;
    this.music = opts.bgm ? new FieldMusic(opts.bgm) : null;
    this.menu = new WarpMenuOverlay(viewer.renderer.domElement);
    void this.menu.load(files).catch((err) => opts.log(`warp menu: ${(err as Error).message}`));
    const onSub = (sub: number, _client: number, body: Uint8Array) => {
      if (this.disposed) return;
      if (sub === 0x05) {
        const s = parseSwitchFlag(body);
        if (!s || s.flag >= 0x100) return;
        const set = this.flagsOf(s.floor);
        if (s.set) set.add(s.flag);
        else set.delete(s.flag);
        return;
      }
      if (sub === 0x67) {
        // G_TriggerSetEvent_6x67: {u32 floor, u32 event id, u32 client id}
        if (body.length < 0x10) return;
        const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
        this.triggerEvent(dv.getUint32(4, true), dv.getUint32(8, true));
        return;
      }
      if (sub === 0x6a) {
        // G_SetBossWarpState_6x6A: {6a, 02, entity, u16 state}. Another player
        // accepted the warp (state 1) or the leader started it (state 2).
        if (body.length < 8) return;
        const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
        const entity = dv.getUint16(2, true);
        const state = dv.getUint16(4, true);
        const w = this.objects?.warps.find((x) => x.kind === 'boss' && 0x4000 + this.objectBase + x.index === entity);
        if (!w) return;
        this.bossWarpObject = w;
        this.bossWarp.receive(Math.min(4, state) as 0 | 1 | 2 | 3 | 4);
        this.opts.log(`boss warp ${w.index}: state ${state}`);
        return;
      }
      // A boss action from the room leader can report the boss's form, which
      // changes the music (audio/bossbgm.ts).
      const phase = bossPhaseOf(this.area, sub, body);
      if (phase !== null && this.music?.setBossPhase(phase)) {
        this.opts.log(`boss phase ${phase}: ${this.music.bossMusic?.name}`);
      }
      if (sub === 0x76) {
        // G_SetEntitySetFlags_6x76: {u16 entity, u16 floor, u16 flags}
        if (body.length < 8) return;
        const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
        const entity = dv.getUint16(2, true);
        const floor = dv.getUint16(4, true);
        const flags = dv.getUint16(6, true);
        if (flags & 0x08) this.killEntity(entity, floor);
      }
    };
    game.on('subcommand', onSub); // Lobby has no off(); the handler goes idle on dispose
  }

  // construct_objects (room/group keys) per floor, kept across visits.
  private constructedOf(floor: number): Set<string> {
    let s = this.constructed.get(floor);
    if (!s) this.constructed.set(floor, (s = new Set()));
    return s;
  }

  // An event's construct_objects action / construct_delayed_object: the
  // floor's delayed objects of that room and group appear
  // (render/fieldobjects.ts isDelayedObject).
  constructObjects(floor: number, room: number, group: number): void {
    this.constructedOf(floor).add(constructKey(room, group));
    const n = floor === this.floor ? (this.objects?.construct(room, group) ?? 0) : 0;
    this.opts.log(`construct_objects floor ${floor} room ${room} group ${group}: ${floor === this.floor ? `${n} objects` : 'kept for the next visit'}`);
  }

  // Switch flags of a floor; a floor seen for the first time starts from the
  // game's switch table (g_FloorSwitchesBitmap_00ac9fa0, which a joiner's
  // 6x6E filled).
  private flagsOf(floor: number): Set<number> {
    let s = this.flags.get(floor);
    if (!s) {
      this.flags.set(floor, (s = new Set()));
      for (let f = 0; f < 0x100; f++) if (this.game.joinSync.switchFlag(floor, f)) s.add(f);
    }
    return s;
  }

  // Join sync, leader side (send_packet0x6d_subcommand0x6e): the field's
  // per-floor state into the game-wide tables. Floors this client never
  // loaded keep what the tables hold (a 6x6E we received, 6x76 / 6x67 kept
  // for later); flag 2 (built) is masked out by the builder.
  exportSync(state: JoinSyncState, layout: SyncLayout): void {
    for (const f of layout.floors) {
      const flags = this.flags.get(f.floor);
      if (flags) for (let k = 0; k < 0x100; k++) state.setSwitchFlag(f.floor, k, flags.has(k));
      const w = this.waves.get(f.floor);
      if (w) {
        w.flags.forEach((v, i) => (state.eventFlags[f.eventBase + i] = v));
        w.enemies.forEach((e, i) => (state.enemySetFlags[f.enemySetBase + i] = (state.enemySetFlags[f.enemySetBase + i] & ~(ENEMY_DEAD | ENEMY_BUILT)) | e.flags));
      } else {
        // 6x67 for a floor that is not loaded: set_flag_for_map_event_on_floor
        // sets flag 4 on every event with the id.
        for (const id of this.pendingTriggers.get(f.floor) ?? []) f.eventIds.forEach((e, i) => e === id && (state.eventFlags[f.eventBase + i] |= 4));
        for (const entity of this.pendingKills.get(f.floor) ?? []) {
          const i = f.setFirstSlots.indexOf(entity - 0x1000 - f.enemySlotBase);
          if (i >= 0) state.enemySetFlags[f.enemySetBase + i] |= ENEMY_DEAD;
        }
      }
      // construct_map_objects_for_section_flag sets 0x12 on the objects it
      // builds. ASSUMED: only delayed objects (group != 0) are tracked; an
      // object of the group already built by distance keeps 0 here.
      const built = this.constructed.get(f.floor);
      if (built)
        f.objects.forEach((o, i) => {
          if (o.group !== 0 && built.has(constructKey(o.section, o.group))) state.objectSetFlags[f.objectBase + i] |= 0x10;
        });
    }
  }

  // A floor was loaded. `objectBase` = number of objects on the floors before
  // this one (entity ids are 0x4000 + global object index); enemy entity ids
  // are 0x1000 + global enemy slot (formats/enemyids.ts).
  enterFloor(floor: number, area: number, e: FloorEntities): void {
    this.menu.close();
    this.objects?.dispose();
    this.waves.get(this.floor)?.leave();
    this.floor = floor;
    this.area = area;
    this.objectBase = e.objectBase;
    this.enemyBase = e.enemyBase;
    this.enemies = e.enemies;
    this.sections = e.sections;
    this.suppressed.clear();
    this.battle = false;
    this.battleFrames = 0;
    const episode = this.game.info?.episode ?? 1;
    this.enemyFirstSlot = enemySlots(e.enemySets, area).first;
    this.syncFloor = e.sync ?? null;
    this.slotBases.set(floor, { base: e.enemyBase, first: this.enemyFirstSlot });
    if (e.sync) {
      // The floor loader (0x008129b0) builds a delayed object whose set flags
      // hold 0x01 or 0x10 (6x6E); the field keeps them as constructed keys.
      const sync = this.game.joinSync;
      for (const p of e.placed) {
        const o = p.entity;
        if (o.kind !== 'object' || o.group === 0) continue;
        if (sync.objectSetFlags[e.sync.objectBase + o.index] & 0x11) this.constructedOf(floor).add(constructKey(o.section, o.group));
      }
      const flags = this.flagsOf(floor);
      for (let f = 0; f < 0x100; f++) if (sync.switchFlag(floor, f)) flags.add(f);
    }
    this.objects = new FieldObjects(this.viewer, e.placed, { episode, floor, area }, this.flagsOf(floor), e.objects, e.collision, this.constructedOf(floor));
    this.objects.onSwitch = (s) => this.pressSwitch(s);
    this.objects.questFlag = (f) => this.game.getQuestFlag(f);
    const difficulty = this.game.info?.difficulty ?? 0;
    this.traps = [];
    for (const p of e.placed) {
      const o = p.entity;
      if (o.kind !== 'object' || (o.type !== TRAP_HOLD && o.type !== TRAP_TECH)) continue;
      this.traps.push({ index: o.index, trap: new PillarTrap({ type: o.type, x: p.world[0], z: p.world[2], params: o.params, difficulty }) });
    }
    this.objects.onEventTrigger = (t) => {
      this.opts.log(`event trigger ${t.index}: event ${t.eventId}`);
      this.game.sendTriggerEvent(0x4000 + this.objectBase + t.index, floor, t.eventId);
      this.triggerEvent(floor, t.eventId);
    };
    // Saint-Milion's track depends on the boss variant (param6 & 1).
    const boss = e.enemySets.find((s) => s.type === 0x119);
    this.music?.enter(area, episode, boss ? Math.trunc(boss.params[5]) : 0);
    this.setupWaves(floor, e);
    const o = this.objects;
    const w = this.waves.get(floor);
    this.opts.log(
      `floor ${floor}: ${o.warps.length} warps (${o.warps.map((x) => `${x.kind}${x.floor >= 0 ? `->${x.floor}` : ''}`).join(', ')}), ` +
        `${o.doors.length} doors, ${o.switches.length} switches, ${o.boxes.length} boxes, ${o.triggers.length} event triggers, ${w?.events.length ?? 0} wave events`,
    );
  }

  private setupWaves(floor: number, e: FloorEntities): void {
    let w = this.waves.get(floor);
    if (!w) {
      let events: WaveEvent[] = [];
      if (e.eventFile) {
        try {
          events = parseEventFile(e.eventFile).events;
        } catch (err) {
          this.opts.log(`event file: ${(err as Error).message}`);
        }
      }
      w = new FloorWaves(events, e.enemySets, {
        spawn: (list) => this.spawn(list),
        sendTrigger: (id) => this.game.sendTriggerEvent(0xffff, floor, id),
        sendSwitchFlag: (flag, set, flags) => this.game.sendSwitchFlag(0xffff, floor, flag, set, flags),
        setSwitchFlag: (flag, set) => {
          const f = this.flagsOf(floor);
          if (set) f.add(flag);
          else f.delete(flag);
        },
        constructObjects: (room, group) => this.constructObjects(floor, room, group),
        roomCleared: (room) => this.opts.log(`room ${room} cleared`),
        log: (m) => this.opts.log(m),
      });
      this.waves.set(floor, w);
      // copy_map_event_flags / copy_monster_object_init_flags (6x6E): the
      // floor's wave event and enemy set flags, as the leader had them.
      const sync = this.syncFloor;
      if (sync) {
        const t = this.game.joinSync;
        w.flags.forEach((_, i) => (w!.flags[i] = t.eventFlags[sync.eventBase + i] ?? 0));
        w.enemies.forEach((en, i) => (en.flags = (t.enemySetFlags[sync.enemySetBase + i] ?? 0) & ~ENEMY_BUILT));
        // set_active_map_events builds the handlers of the active events (enter()).
      }
    }
    const kills = this.pendingKills.get(floor);
    if (kills) {
      for (const entity of kills) this.killEntity(entity, floor);
      kills.clear();
    }
    // Enemies of a wave only exist once it starts.
    if (this.enemies) {
      this.enemies.startHidden = w.events.length > 0;
      if (w.events.length > 0) this.enemies.hideAll();
    }
    w.enter();
    const pending = this.pendingTriggers.get(floor);
    if (pending) {
      for (const id of pending) w.trigger(id);
      pending.clear();
    }
    // A floor with no wave events (Pioneer 2, bosses) shows its enemies at
    // once, except those whose set entry is dead (flag 8).
    if (!w.events.length) for (const [i] of this.enemyFirstSlot.entries()) this.enemies?.setVisible(i, !(w.enemies[i]?.flags & ENEMY_DEAD));
  }

  private spawn(list: WaveEnemy[]): void {
    for (const e of list) this.enemies?.setVisible(e.key, true);
    this.opts.log(`wave spawn: ${list.length} enemies (room ${list[0]?.room}, wave ${list[0]?.wave})`);
  }

  // 6x67, from the network, from an event action or from a trigger object.
  triggerEvent(floor: number, eventId: number): void {
    const w = this.waves.get(floor);
    if (w) {
      if (!w.trigger(eventId)) this.opts.log(`event ${eventId} on floor ${floor}: no event with that id is free`);
      return;
    }
    let set = this.pendingTriggers.get(floor);
    if (!set) this.pendingTriggers.set(floor, (set = new Set()));
    set.add(eventId);
  }

  // An enemy died: `entityId` is 0x1000 + its global slot, as the 6x subcommand
  // headers carry it. Called for 6x76 from other clients and by the combat
  // code for local kills.
  onEnemyKilled(entityId: number, floor = this.floor): void {
    this.killEntity(entityId, floor);
  }

  private killEntity(entityId: number, floor: number): void {
    if (entityId < 0x1000 || entityId >= 0x4000) return;
    const w = this.waves.get(floor);
    if (!w) {
      // Kept until the floor's set data is known (export or the first visit).
      let set = this.pendingKills.get(floor);
      if (!set) this.pendingKills.set(floor, (set = new Set()));
      set.add(entityId);
      return;
    }
    const at = this.slotBases.get(floor) ?? { base: this.enemyBase, first: this.enemyFirstSlot };
    const slot = entityId - 0x1000 - at.base;
    const index = this.setEntryForSlot(slot, at.first);
    if (index < 0) return;
    // A child slot's 6x76 (a Claw, a Hidoom / Migium, a split slime) is not
    // its set entry's death: only the entry's first slot clears it.
    if (slot !== at.first[index]) return;
    w.kill(index);
    if (floor === this.floor) this.enemies?.setVisible(index, false);
  }

  // e.dat entry that owns a floor-relative enemy slot.
  private setEntryForSlot(slot: number, first: readonly number[] = this.enemyFirstSlot): number {
    if (slot < 0) return -1;
    let lo = 0;
    let hi = first.length - 1;
    if (hi < 0 || slot < first[0]) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (first[mid] <= slot) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Room of a position: the map section whose circle contains it, nearest first
  // (the client keeps the room id on the player, +0x28).
  roomAt(pos: { x: number; y: number; z: number }): number {
    let best = -1;
    let bestD = Infinity;
    for (const s of this.sections) {
      const d = Math.hypot(s.position[0] - pos.x, s.position[2] - pos.z);
      if (d <= s.radius && d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
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
    this.opts.tickQuest?.(dt);
    const me = this.game.self;
    const pos = me && !this.game.loading ? me.position : null;
    this.music?.tick(dt, pos);
    const others = [...this.game.players.values()].filter((p) => p.clientId !== me?.clientId && p.floor === this.floor && p.visible !== false).map((p) => p.position);
    this.objects?.frame(pos, others);
    // The wave state machine runs on game ticks (30/s).
    this.frameAcc += dt * 30;
    const ticks = Math.min(Math.floor(this.frameAcc), 30);
    this.frameAcc -= Math.floor(this.frameAcc);
    const w = this.waves.get(this.floor);
    for (let i = 0; i < ticks; i++) w?.frame();
    if (ticks && this.traps.length) this.trapFrames(ticks, pos);
    if (w && pos && ticks) this.updateBattleMusic(w, pos, ticks);
    if (pos && !this.busy) this.watchWarps(pos);
    for (let i = 0; i < ticks && !this.busy; i++) this.bossWarpFrame(pos);
    this.objects?.setBossWarpState(this.bossWarpObject?.index ?? null, this.bossWarp.state);
    // A door's unlock camera (FUN_00656eb4 state 1) replaces the player
    // camera that LobbyView placed this frame.
    const view = this.objects?.unlockCameraView();
    if (view) {
      this.viewer.camera.position.set(...view.source);
      this.viewer.camera.lookAt(...view.target);
    }
    // So does an NPC talk's camera mover (SetDefaultNPCCameraView_004d33c0).
    const talk = view ? null : this.opts.talkCamera?.();
    if (talk) {
      this.viewer.camera.position.set(talk.source.x, talk.source.y, talk.source.z);
      this.viewer.camera.lookAt(talk.target.x, talk.target.y, talk.target.z);
    }
  }

  // The floor's pillar traps (render/traps.ts) on the game clock. Every client
  // runs them; a trap only acts on the local player (6x2C / 6x2D go out from
  // combat), the others see the trap rise.
  private trapFrames(ticks: number, pos: { x: number; y: number; z: number } | null): void {
    const players: TrapPlayer[] = [];
    const me = this.game.self;
    if (me && pos) players.push({ clientId: me.clientId, x: pos.x, z: pos.z, radius: PLAYER_RADIUS });
    for (const p of this.game.players.values()) {
      if (p.clientId === me?.clientId || p.floor !== this.floor || p.visible === false) continue;
      players.push({ clientId: p.clientId, x: p.position.x, z: p.position.z, radius: PLAYER_RADIUS });
    }
    const switchOn = (flag: number) => this.flagsOf(this.floor).has(flag);
    for (const { index, trap } of this.traps) {
      for (let i = 0; i < ticks; i++) {
        for (const ev of trap.frame(players, this.game.selfId, this.area, switchOn)) {
          if (ev.kind === 'sound') se(ev.id);
          else this.opts.trap?.(ev, trap);
        }
      }
      this.objects?.setTrapPose(index, trap.rise1, trap.rise2, trap.spin);
    }
  }

  private updateBattleMusic(w: FloorWaves, pos: { x: number; y: number; z: number }, ticks: number): void {
    const room = this.roomAt(pos);
    const fighting = room >= 0 && w.battleIn(room);
    if (fighting) {
      this.battleFrames = 0;
      if (!this.battle) {
        this.battle = true;
        this.opts.bgm?.setBattle(true);
      }
      return;
    }
    if (!this.battle) return;
    this.battleFrames += ticks;
    if (this.battleFrames >= BATTLE_LINGER_FRAMES) {
      this.battle = false;
      this.opts.bgm?.setBattle(false);
    }
  }

  private inside(w: FieldWarp, p: { x: number; y: number; z: number }): boolean {
    return Math.hypot(w.x - p.x, w.z - p.z) < w.radius && Math.abs(w.y - p.y) < HEIGHT_WINDOW;
  }

  private watchWarps(p: { x: number; y: number; z: number }): void {
    const warps = this.objects?.warps ?? [];
    for (const w of warps) if (!this.inside(w, p)) this.suppressed.delete(w.index);
    if (this.menu.open) {
      // The boss warp keeps its windows open while the party gathers; an area
      // or main warp closes as soon as the player steps out of the radius.
      if (this.menuWarp && !this.bossWarp && !this.inside(this.menuWarp, p)) this.menu.close(null);
      return;
    }
    const w = warps.find((x) => this.inside(x, p) && !this.suppressed.has(x.index));
    if (!w) return;
    if (w.flag >= 0 && !this.flagsOf(this.floor).has(w.flag)) return; // boss warp still locked
    if (w.kind === 'boss') {
      this.bossWarpObject = w;
      return; // driven by bossWarpFrame()
    }
    void this.openMenu(w);
  }

  // --- Boss warp (render/bosswarp.ts) ---------------------------------------

  // One game tick of the boss warp the player is standing in.
  private bossWarpFrame(p: { x: number; y: number; z: number } | null): void {
    const w = this.bossWarpObject;
    if (!w) return;
    if (!this.objects?.warps.includes(w)) {
      this.bossWarpObject = null;
      return;
    }
    const inRadius = !!p && this.inside(w, p);
    // Back to idle and forget the object once nobody is around any more.
    if (!inRadius && this.bossWarp.state === 0 && this.bossWarp.sub <= 1 && !this.menu.open) {
      this.bossWarpObject = null;
      this.menu.update({});
      return;
    }
    const me = this.game.self;
    const others = [...this.game.players.values()].filter((q) => q.clientId !== me?.clientId);
    const rows = [me, ...others].filter((q): q is NonNullable<typeof q> => !!q).map((q) => ({
      label: q.name || `player ${q.clientId}`,
      // The client draws a player whose movement is disabled (i.e. already
      // taken by the warp) in 0xFFFFFF00.
      color: q.floor === this.floor && this.inside(w, q.position) ? '#ffff00' : '#f0f0f0',
    }));
    this.bossWarp.frame({
      inRadius: () => inRadius,
      gathered: () => [me, ...others].every((q) => !q || (q.floor === this.floor && this.inside(w, q.position))),
      // The game leader runs the floor (net/game.ts keeps leaderId).
      isLeader: () => this.game.selfId === this.game.leaderId,
      partySize: () => this.game.players.size,
      windows: (text, confirm) => this.bossWarpWindows(w, text, confirm, rows),
      send: (state) => {
        this.game.sendBossWarpState(0x4000 + this.objectBase + w.index, state);
        this.bossWarp.receive(state);
      },
      warp: () => {
        this.menu.close(null);
        this.bossWarpObject = null;
        this.bossWarp = new BossWarp();
        this.suppressed.add(w.index);
        this.busy = true;
        this.opts.log(`boss warp to floor ${w.floor}`);
        void this.opts
          .warpTo(w.floor)
          .catch((err) => this.opts.log(`warp failed: ${(err as Error).message}`))
          .finally(() => (this.busy = false));
      },
      sound: (id) => this.opts.log(`boss warp sound effect ${id}`),
      log: (msg) => this.opts.log(msg),
    });
  }

  private bossWarpWindows(w: FieldWarp, text: number | null, confirm: boolean, rows: Array<{ label: string; color: string }>): void {
    if (text === null) {
      if (this.bossWarpPrompt) {
        this.bossWarpPrompt = false;
        this.menu.close(null);
      }
      return;
    }
    const message = this.menu.string(11, text);
    const lines = message.split('\n').length;
    const panel = {
      layout: { x: POS_PLAYER_LIST[0], y: POS_PLAYER_LIST[1], w: 150, h: rows.length * 20 + 20 },
      rows,
    };
    if (this.bossWarpPrompt) {
      this.menu.update({ message, panel });
      return;
    }
    this.bossWarpPrompt = true;
    const pos = confirm ? POS_CONFIRM : POS_MESSAGE;
    const items = confirm ? [{ label: this.menu.string(15, 0x23), floor: 1 }, { label: this.menu.string(15, 0x24), floor: 0 }] : [];
    const layout = textWindowLayout(pos[0], pos[1], CONFIRM_WIDTH, lines, items.length);
    this.menuWarp = w;
    void this.menu.show(items, layout, { message, panel }, 1).then((answer) => {
      this.bossWarpPrompt = false;
      this.menuWarp = null;
      if (answer !== null) this.bossWarp.answer(answer === 1);
      else if (confirm) this.bossWarp.answer(false);
    });
  }

  private async openMenu(w: FieldWarp): Promise<void> {
    const episode = this.game.info?.episode ?? 1;
    let choice: Promise<number | null>;
    if (w.kind === 'main') {
      const items = mainWarpItems(episode, w.warpType).map((it) => ({ label: this.menu.label(it.text), floor: it.floor }));
      choice = this.menu.show(items, mainWarpLayout(items.length));
    } else if (w.kind === 'map') {
      const label = this.menu.label(w.text ?? MAP_WARP_TEXT);
      choice = this.menu.show([{ label, floor: this.floor }], areaWarpLayout(gameTextWidth(label)));
    } else if (w.kind === 'cca') {
      const items = CCA_WARP.map((it) => ({ label: this.menu.label(it.text), floor: it.floor }));
      choice = this.menu.show(items, ccaWarpLayout(Math.max(...items.map((it) => gameTextWidth(it.label)))));
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
    if (w.kind === 'map' && w.dest) {
      this.opts.log(`map warp to (${w.dest.x.toFixed(0)}, ${w.dest.y.toFixed(0)}, ${w.dest.z.toFixed(0)})`);
      this.opts.warpSelf?.(w.dest, w.angle ?? 0);
      return;
    }
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

  // --- what the quest VM asks of the field (quest/run.ts) ---

  // if_zone_clear (opcode 0x88): every wave of the room has been destroyed.
  zoneCleared(floor: number, room: number): boolean {
    const w = this.waves.get(floor);
    if (!w) return false;
    return !w.battleIn(room) && !w.aliveEnemies().some((e) => e.room === room);
  }

  // construct_delayed_enemy / an event's construct_enemies action.
  constructEnemies(floor: number, room: number, wave: number): void {
    const w = this.waves.get(floor);
    if (!w) {
      this.opts.log(`construct_enemies on floor ${floor}: no wave state`);
      return;
    }
    w.constructEnemies(room, wave);
  }

  switchFlag(floor: number, flag: number): boolean {
    return this.flagsOf(floor).has(flag);
  }

  // set_switch_flag_sync / clear_switch_flag_sync (F82B / F82C): set the flag
  // locally and send 6x05 with no owning object (0xFFFF), the way a wave
  // event's action stream does.
  setSwitchFlagFromQuest(floor: number, flag: number, set: boolean): void {
    const f = this.flagsOf(floor);
    if (set) f.add(flag);
    else f.delete(flag);
    this.game.sendSwitchFlag(0xffff, floor, flag, set);
  }

  // Debug helpers, reachable from the console (see GameView.debug()).
  debug() {
    const self = this;
    return {
      floor: () => self.floor,
      room: () => (self.game.self ? self.roomAt(self.game.self.position) : -1),
      events: () =>
        (self.waves.get(self.floor)?.events ?? []).map((e, i) => ({
          index: i,
          id: e.id,
          room: e.room,
          wave: e.wave,
          delay: e.delay,
          flags: self.waves.get(self.floor)?.flags[i] ?? 0,
          actions: e.actions,
        })),
      // Boss music: the phases of this floor's boss and a way to step them
      // (the real trigger is the leader's 6x15 / 6x19 / 6xA4 / 6xA5).
      boss: () => {
        const m = self.music?.bossMusic;
        return m ? { name: m.name, phase: self.music?.bossPhase ?? 0, phases: m.phases } : 'no boss on this floor';
      },
      bossPhase: (phase: number) => (self.music?.setBossPhase(phase) ? `boss phase ${phase}` : `boss phase ${phase} not played`),
      // Starts the wave event with this id on the current floor.
      trigger: (eventId: number) => {
        self.game.sendTriggerEvent(0xffff, self.floor, eventId);
        self.triggerEvent(self.floor, eventId);
        return `triggered ${eventId}`;
      },
      // Kills every alive enemy of the active waves (or of one room).
      killWave: (room?: number) => {
        const w = self.waves.get(self.floor);
        if (!w) return 'no waves on this floor';
        const alive = w.aliveEnemies().filter((e) => room === undefined || e.room === room);
        for (const e of alive) {
          w.kill(e.key);
          self.enemies?.setVisible(e.key, false);
          self.game.sendEntitySetFlags(0x1000 + self.enemyBase + (self.enemyFirstSlot[e.key] ?? e.key), self.floor, 0x08);
        }
        return `killed ${alive.length} enemies`;
      },
      switches: () => [...self.flagsOf(self.floor)].sort((a, b) => a - b),
      doors: () => (self.objects?.doors ?? []).map((d) => ({ index: d.index, type: d.type, flags: d.flags, state: d.state })),
      boxes: () => (self.objects?.boxes ?? []).map((b) => ({ index: b.index, type: b.type, x: b.x, y: b.y, z: b.z, broken: b.broken })),
    };
  }

  // The items agent breaks boxes through this.
  get fieldObjects(): FieldObjects | null {
    return this.objects;
  }

  dispose(): void {
    this.disposed = true;
    this.menu.dispose();
    this.objects?.dispose();
    this.objects = null;
    this.opts.bgm?.stop();
  }
}
