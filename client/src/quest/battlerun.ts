// Runs a battle in a game: the controller of quest/battle.ts wired to the game
// connection (6x7D, 6xCF, 6x8F, 6xD0, 6x9B), the combat view (the local
// player's HP and death), the quest windows and the battle HUD. Created by
// quest/run.ts when ba_start fires.

import type { ClientFiles } from '../data/clientfiles.ts';
import type { Game } from '../net/game.ts';
import type { GameView } from '../render/gameview.ts';
import {
  BattleController,
  BattleRecords,
  PlayerScore,
  build6x80,
  build6x83,
  build6x8F,
  build6x9B,
  build6xCF,
  build6xD0,
  build7D,
  localRestrictions,
  parse7D,
  rankPlayers,
  SonarStock,
  type Battle7D,
  type BattleSetup,
  type EffectiveRules,
  type PlaceEntry,
} from './battle.ts';
import { BattleHud, RULES_WINDOW } from './battleui.ts';
import { battleRowAction, isBattleArena, type BattleRowAction } from './battleitems.ts';
import type { BattleItemsHook } from '../render/fieldhud.ts';
import {
  pickRespawn,
  respawnCandidates,
  TRAP_EFFECTS,
  TrapCounters,
  TRAP_GATE_VALUE,
  TrapField,
  placeRequest,
  parse6x80,
  parse6x83,
  trapAnnouncement,
  trapDamage,
  trapPlacePermitted,
  type BattleTrap,
  type PlaceContext,
  type TrapEvent,
  type TrapTarget,
} from './battletraps.ts';
import { isPlayerEntity, parse6x8F } from '../combat/pvp.ts';
import { isAndroid } from '../combat/progression.ts';
import { buildTeleport } from '../formats/npcplayerchar.ts';
import type { QuestUi } from './questui.ts';
import { buildBattleOverlay } from './battleoverlay.ts';
import { applyOverlay, writeOverlayRaw } from './cmodeoverlay.ts';
import type { CharacterFile } from '../net/charfile.ts';

export interface BattleRunOptions {
  game: Game;
  view: GameView;
  ui: QuestUi;
  canvas?: HTMLCanvasElement | undefined;
  files?: ClientFiles | undefined;
  log?: (msg: string) => void;
  meseta?: () => number;
  records?: ArrayLike<number>;
}

const RESULT_TITLES = ['1st', '2nd', '3rd', '4th'];

export class BattleRun {
  readonly records: BattleRecords;
  readonly score = new PlayerScore();
  controller: BattleController | null = null;
  hud: BattleHud | null = null;
  private setup: BattleSetup | null = null;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private disposed = false;
  private lastHp = -1;
  private wasDead = false;
  private enemyTotals = new Map<number, number>();
  // Battle Mode traps (quest/battletraps.ts): the field of placed traps and the local stock.
  readonly traps = new TrapField();
  counters = new TrapCounters();
  // The local sonar stock (quest/battle.ts SonarStock): set by applyRestrictions.
  readonly sonar = new SonarStock();
  // The real character while the battle overlay is on (quest/battleoverlay.ts); restored on exit.
  private backup: { character: CharacterFile; raw: Uint8Array | null } | null = null;
  private names: (i: number) => string;
  rulesText = '';

  private opts: BattleRunOptions;

  constructor(opts: BattleRunOptions) {
    this.opts = opts;
    this.records = new BattleRecords(opts.records);
    const game = opts.game;
    this.names = (i) => game.players.get(i)?.name || `Player ${i + 1}`;
    game.on('subcommand', (sub, clientId, body) => this.onSub(sub, clientId, body));
    game.onSent = (body) => this.onSent(body);
    opts.view.combat.placeTrap = (type) => this.placeTrap(type);
    // A strike of a remote player that hit us is reported as 6x8F (combat/pvp.ts).
    opts.view.combat.onPvpHit = (attackerId, damage) => this.reportPlayerHit(attackerId, damage);
    // The palette's trap slots show the local stock (render/fieldhud.ts, classic/palette.ts slotCount).
    opts.view.hud.trapCount = (type) => this.counters.get(type);
    // The item list's status rows and the quick menu's sonar row (classic/itempack.ts, render/fieldhud.ts).
    opts.view.hud.battleItems = this.battleItemsHook();
    // The minimap's team colours and the teammates' markers (classic/minimap.ts teamColour).
    opts.view.hud.battleTeam = (clientId) => (this.controller?.slots[clientId]?.present ? this.controller.slots[clientId]!.team : null);
    if (opts.canvas) {
      this.hud = new BattleHud(opts.canvas);
      if (opts.files) void this.hud.load(opts.files).catch((e) => this.log(`battle hud: ${(e as Error).message}`));
    }
  }

  private log(m: string): void {
    this.opts.log?.(m);
  }

  // ba_start: build the controller with the rules gathered so far and run it on the game clock.
  start(setup: BattleSetup): void {
    if (this.controller && !this.controller.finished) return;
    this.setup = setup;
    const { game, view, ui } = this.opts;
    this.score.reset();
    this.lastHp = -1;
    this.wasDead = false;
    this.traps.clear();
    this.counters = new TrapCounters(); // the stock is set by applyRestrictions (trap mode ALL_PLAYERS)
    this.sonar.setFromRules(null); // the stock is set by applyRestrictions (sonar enable)
    this.controller = new BattleController({
      setup,
      host: {
        localId: game.selfId,
        leaderId: () => game.leaderId,
        present: () => [0, 1, 2, 3].map((i) => game.players.has(i)),
        log: (m) => this.log(m),
        send7D: (m: Battle7D) => game.sendSubcommand(0x7d, build7D(m)),
        send6xCF: (rules, drops) => game.sendSubcommand(0xcf, build6xCF(rules, drops)),
        localPoints: () => this.points(),
        localAlive: () => !view.combat.damage.dead,
        showRules: (text) => {
          this.rulesText = text;
          ui.showWindow(text, false, RULES_WINDOW);
        },
        showTeams: (parties) => {
          const n = (ids: string[]) => ids.map((i) => this.names(Number(i)));
          const a = n(parties[0]!);
          const b = n(parties[1]!);
          ui.showWindow(`Party battle ok.\nA-Party\n  ${a[0] ?? ''}\n  ${a[1] ?? ''}\nB-Party\n  ${b[0] ?? ''}\n  ${b[1] ?? ''}`, false, RULES_WINDOW);
        },
        closeWindows: () => ui.closeWindow(),
        setTimer: (s) => {
          if (this.hud) this.hud.state.timer = s;
        },
        closeTimer: () => {
          if (this.hud) this.hud.state.timer = null;
        },
        announce: (lines) => this.hud?.showLines(lines),
        results: (entries, place) => this.showResults(entries, place),
        askRematch: async () => {
          const i = await ui.list(['Yes', 'No', 'Lobby'], { title: 'Do you want to\nfight the same\nrules?', cancellable: false });
          return i === 0 ? 'same' : i === 1 ? 'no' : 'lobby';
        },
        applyRestrictions: (e) => this.applyRestrictions(e),
        startBattle: () => this.log('battle: start'),
        endBattle: () => this.log('battle: time up'),
        exit: (aborted) => {
          this.log(`battle: exit${aborted ? ' (aborted)' : ''}`);
          ui.closeWindow();
          this.hud?.clear();
          this.restoreCharacter();
        },
        records: this.records,
      },
    });
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const loop = (t: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.25, (t - this.last) / 1000);
      this.last = t;
      this.acc += dt * 30;
      const n = Math.min(30, Math.floor(this.acc));
      this.acc -= Math.floor(this.acc);
      for (let i = 0; i < n; i++) this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private points(): number {
    const w = this.setup?.weights;
    if (!w) return 0;
    return this.score.total(w, this.opts.meseta?.() ?? 0, this.opts.view.combat.damage.dead);
  }

  private applyRestrictions(e: EffectiveRules): void {
    // The server owns the character in BB: newserv rebuilds the battle overlay when the
    // leader's 6xCF arrives (Client::create_battle_overlay). What the web client keeps
    // locally is the lives counter and the HUD.
    if (this.hud) this.hud.state.lives = e.respawn === 2 ? e.lives : null;
    // UNCLEAR: the stock without trap mode ALL_PLAYERS is not traced; it stays at 0 here.
    const lr = localRestrictions(e);
    if (lr.traps) this.counters.setFromRules(lr.traps);
    this.sonar.setFromRules(lr.sonarCount);
    void this.applyOverlay(e);
  }

  // The local overlay (cmoderun.applyTemplate's pattern): the backup is the real character,
  // taken once; a rematch rebuilds from the same backup. Applied when the level table is in.
  private async applyOverlay(e: EffectiveRules): Promise<void> {
    const { view } = this.opts;
    try {
      const c = this.character();
      const full = this.full();
      if (!c) return;
      if (!this.backup) this.backup = { character: structuredClone(c), raw: full ? full.slice(0, 0x4dc) : null };
      const table = await view.combat.challengeLevelTable();
      if (!table) {
        this.log('battle: no level table, the battle overlay is not applied');
        return;
      }
      if (!this.backup || this.disposed) return; // the battle exited while the table loaded
      const overlay = buildBattleOverlay(this.backup.character, e, table);
      applyOverlay(c, overlay);
      if (full) {
        writeOverlayRaw(c, full);
        this.opts.game.selfSnapshot.inventory.set(full.subarray(0, 0x34c));
        this.opts.game.selfSnapshot.disp.set(full.subarray(0x34c, 0x4dc));
      }
      await view.combat.reloadProgression();
      view.items.onInventoryChanged();
    } catch (err) {
      this.log(`battle: overlay failed: ${(err as Error).message}`);
    }
  }

  // The real character comes back when the battle exits (cmoderun.restoreCharacter).
  private restoreCharacter(): void {
    const b = this.backup;
    const c = this.character();
    if (!b || !c) return;
    c.inventory.splice(0, c.inventory.length, ...b.character.inventory);
    Object.assign(c.stats, b.character.stats);
    c.level = b.character.level;
    c.exp = b.character.exp;
    c.meseta = b.character.meseta;
    c.hpFromMaterials = b.character.hpFromMaterials;
    c.tpFromMaterials = b.character.tpFromMaterials;
    c.techLevels.splice(0, c.techLevels.length, ...b.character.techLevels);
    const full = this.full();
    if (full && b.raw) {
      full.set(b.raw, 0);
      this.opts.game.selfSnapshot.inventory.set(b.raw.subarray(0, 0x34c));
      this.opts.game.selfSnapshot.disp.set(b.raw.subarray(0x34c, 0x4dc));
    }
    this.backup = null;
    void this.opts.view.combat.reloadProgression();
    this.opts.view.items.onInventoryChanged();
  }

  private character(): CharacterFile | null {
    return this.opts.view.items.inventory?.c ?? null;
  }

  private full(): Uint8Array | null {
    const f = this.opts.game.selfSnapshot.full;
    return f && f.length >= 0x4dc ? f : null;
  }

  // The sonar's use (the Challenge item list's menu value 5, quest/battle.ts SonarStock). The
  // exe makes the manager only on battle_spaceship (16) or battle_ruins (17)
  // (CreateSinowberillChallengeEntityManager_006b08b8); the port's area of the floor is that map id
  // (quest/battleitems.ts isBattleArena). Called by activateStatusRow and the quick menu's row 4.
  useSonar(): boolean {
    return this.sonar.use(isBattleArena(this.opts.view.current?.area ?? -1));
  }

  // What the field's windows read while the battle runs (render/fieldhud.ts BattleItemsHook).
  private battleItemsHook(): BattleItemsHook {
    return {
      traps: () => [0, 1, 2, 3].map((t) => this.counters.get(t)),
      sonar: () => this.sonar.count,
      sonarActive: () => this.sonar.active,
      useSonar: () => this.useSonar(),
      activate: (statusIndex, menuValue) => this.activateStatusRow(statusIndex, menuValue) !== null,
    };
  }

  // A press of a status row's one-row menu (quest/battleitems.ts): menu value 4 is the trap
  // palette of the row's type, value 5 the sonar. Returns what ran (null: nothing).
  activateStatusRow(statusIndex: number, menuValue: number): BattleRowAction {
    const a = battleRowAction(statusIndex, menuValue);
    if (!a) return null;
    if (a.kind === 'trap') return this.placeTrap(a.type) ? a : null;
    return this.useSonar() ? a : null;
  }

  // One frame of the sonar manager (quest/battle.ts SonarManager): the owner's position against
  // the other players in the game; its ping plays at the pitch the distance gives.
  private tickSonar(): void {
    const g = this.opts.game;
    const others = [...g.players.values()].filter((p) => p.clientId !== g.selfId).map((p) => p.position);
    const ping = this.sonar.tick(g.self ? g.self.position : null, others);
    if (ping) this.opts.view.combat.playSonarPing(ping.pitch);
  }

  // One 30 Hz frame: the local player's HP and death feed the score, then the controller.
  private tick(): void {
    const c = this.controller;
    const w = this.setup?.weights;
    // Player versus player is on while the battle phase runs (render/combat.ts).
    this.opts.view.combat.battlePvp = !!c && c.state === 'battle';
    if (!c || !w) return;
    const dmg = this.opts.view.combat.damage;
    if (c.state === 'battle') {
      if (this.lastHp >= 0 && dmg.hp < this.lastHp) this.score.takeDamage(this.lastHp - dmg.hp, false, w);
      if (dmg.dead && !this.wasDead) this.onDeath();
    }
    this.lastHp = dmg.hp;
    this.wasDead = dmg.dead;
    c.tick();
    if (this.sonar.active) this.tickSonar();
    // The win particle on each leader, every update while the flag holds (quest/battle.ts winHolders).
    for (const id of c.winHolders()) this.opts.view.combat.winEffect(id);
    if (c.state === 'battle') this.tickTraps();
    if (this.hud) {
      this.hud.state.points = c.state === 'battle' ? this.points() : this.hud.state.points;
      if (c.effective.respawn === 2) this.hud.state.lives = c.livesLeft;
      if (c.effective.teams === 1) {
        const t: [number, number] = [0, 0];
        c.slots.forEach((s) => {
          if (s.present) t[s.team !== 1 ? 1 : 0] += s.points;
        });
        this.hud.state.teamPoints = t;
      } else this.hud.state.teamPoints = null;
    }
  }

  private onDeath(): void {
    const c = this.controller!;
    const w = this.setup!.weights;
    this.score.die(false, w);
    const r = c.onLocalDeath();
    if (r.result === 'respawn') {
      if (r.levelUp > 0) this.opts.game.sendSubcommand(0xd0, build6xD0(r.levelUp));
      if (r.techLevelUp > 0) this.opts.game.sendSubcommand(0x9b, build6x9B(r.techLevelUp));
      // The revive itself is the player's (render/combat.ts: the revive key).
      this.respawnTeleport();
    }
    c.sendOwnScore();
  }

  // The death teleport (unknown_dead_player_return_to_p2_related -> SendTeleportRequestToPlayer_00695444):
  // a random floor spawn that no other player stands near (quest/battletraps.ts respawnCandidates,
  // pickRespawn). The local player moves there and 6x24 tells the others. When no candidate is
  // left the player stays where it died (the exe's fallback is its own position).
  // ASSUMED: the teleport runs only when the battle controller grants a respawn.
  private respawnTeleport(): void {
    const g = this.opts.game;
    const others = [...g.players.values()].filter((p) => p.clientId !== g.selfId).map((p) => p.position);
    const spawn = pickRespawn(respawnCandidates(this.opts.view.respawnPoints(), others), Math.floor(Math.random() * 32768));
    if (!spawn) return;
    this.opts.view.placePlayer(g.selfId, spawn.x, spawn.y, spawn.z, spawn.angle);
    const bams = Math.round((((spawn.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (0x10000 / (Math.PI * 2))) & 0xffff;
    g.conn.send(0x60, 0, buildTeleport(g.selfId, bams, spawn.x, spawn.y, spawn.z));
    this.log(`battle respawn at ${spawn.x.toFixed(0)}, ${spawn.z.toFixed(0)}`);
  }

  // Our own 6x0A: the growth of an enemy's total damage is damage we dealt; 0x800 is its death.
  private onSent(body: Uint8Array): void {
    const c = this.controller;
    const w = this.setup?.weights;
    if (!c || !w || c.state !== 'battle' || body[0] !== 0x0a || body.length < 0x0c) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const index = dv.getUint16(4, true);
    const total = dv.getUint16(6, true);
    const flags = dv.getUint32(8, true);
    const before = this.enemyTotals.get(index) ?? 0;
    if (total > before) this.score.giveDamage(total - before, false, w);
    this.enemyTotals.set(index, total);
    if ((flags & 0x800) !== 0) this.score.kill(false, w);
  }

  private onSub(sub: number, clientId: number, body: Uint8Array): void {
    if (this.disposed || !this.controller) return;
    if (sub === 0x7d) {
      const m = parse7D(body);
      if (m) this.controller.receive7D(clientId, m);
    } else if (sub === 0x83) {
      this.onTrapPlaced(clientId, body);
    } else if (sub === 0x80) {
      const call = parse6x80(body);
      if (call && this.controller.state === 'battle') this.traps.receiveCall(call);
    } else if (sub === 0x8f && this.setup) {
      // 6x8F (victim's client, header = the attacker): a player was hurt by the attacker
      // (ApplyHitEffectText_006917a4). The attacker is credited with the damage it dealt.
      const h = parse6x8F(body);
      if (h && h.attacker === this.opts.game.selfId && isPlayerEntity(h.target)) {
        this.score.giveDamage(h.amount, true, this.setup.weights);
        // ASSUMED: the attacker's PB gauge follows the credit (the hit roll ran on the victim).
        this.opts.view.combat.pvpDealt(h.amount);
      }
    }
  }

  // The field context of a trap placed by `owner` (safe_create_trap_object's checks).
  // ASSUMED: fieldMap is true (the lobby / Pioneer 2 test is not traced to a floor id).
  private placeContext(owner: { floor: number; position: { x: number; y: number; z: number }; angle: number }): PlaceContext {
    const me = this.opts.game.self;
    return {
      floor: me?.floor ?? 0,
      gate: TRAP_GATE_VALUE, // the global 0x009f9860 (TRAP_GATE_ADDRESS): 1 in the exe, never written
      bossMap: this.opts.view.combat.inBossArea(),
      fieldMap: true,
      ownerFloor: owner.floor,
      ownerPos: owner.position,
      ownerAngle: owner.angle,
      // The receiving client's map: the 0x83 permission gate of both dispatches (trapPlacePermitted).
      map: this.opts.view.current?.area ?? -1,
      // The owner's room words are not in the port's player state (ASSUMED: no room data, ownerRoom undefined).
      difficulty: this.opts.game.info?.difficulty ?? 0,
      pioneer2Byte: 0, // g_Pioneer2MapInitData[0]: ASSUMED 0 in a battle (challengeFlagValue)
    };
  }

  // The Ultimate branch of trap_constructor clears g_BATrapsCanTargetOwnerPlayer (dump 492997); the
  // port keeps that rule in the battle state, so the trap that ran the branch clears it here.
  private applyUltimateClear(trap: BattleTrap | null): void {
    if (trap?.ultimate && this.setup) this.setup.trapsHitOwner = false;
  }

  // A remote player's 6x83 (its client's palette press). The local client's own placement
  // is made in placeTrap, so its echo (if any) is skipped here. The receive path gates the
  // handler by this client's map (TeamQuest_ProcessSubcommands, quest/battletraps.ts trapPlacePermitted),
  // which placeContext's `map` applies inside TrapField.place.
  private onTrapPlaced(clientId: number, body: Uint8Array): void {
    const c = this.controller;
    const g = this.opts.game;
    if (!c || c.state !== 'battle' || clientId === g.selfId) return;
    const p = parse6x83(body);
    const owner = g.players.get(clientId);
    if (!p || !owner) return;
    // The owner's stock is not tracked for remote players; a throwaway counter takes the decrement.
    const trap = this.traps.place({ clientId, type: p.type, count: p.count }, this.placeContext(owner), new TrapCounters());
    this.applyUltimateClear(trap);
    if (trap) this.log(`battle trap ${p.type} placed by ${this.names(clientId)}`);
  }

  // The local palette press of trap type `type` (render/combat.ts placeTrap). The request
  // carries the count before the decrement; the trap is placed here (the exe's local
  // dispatch), then the 6x83 goes out. Nothing is sent when the placement is refused.
  placeTrap(type: number): boolean {
    const c = this.controller;
    const g = this.opts.game;
    const me = g.self;
    if (!c || c.state !== 'battle' || !me || this.opts.view.combat.damage.dead) return false;
    const req = placeRequest(this.counters, type, true);
    if (!req) return false;
    // checked_call_packet0x60_subcommand (dump 815078) sends the 6x83 first, unconditionally; then the
    // local handler (handle_packet0x60_subcommand0x83) runs only when the map permits the 0x83 row
    // (trapPlacePermitted) and safe_create accepts. A refusal places and decrements nothing here, but
    // the palette press still counts as done (the exe's palette handler returns 1 after the call).
    g.sendSubcommand(0x83, build6x83(g.selfId, type, req.count).subarray(4));
    if (!trapPlacePermitted(this.opts.view.current?.area ?? -1)) {
      this.log(`battle trap ${type} sent, not placed (map refuses the 0x83 permission)`);
      return true;
    }
    const owner = { floor: me.floor, position: me.position, angle: me.angle };
    const trap = this.traps.place({ ...req, clientId: g.selfId }, this.placeContext(owner), this.counters);
    this.applyUltimateClear(trap);
    if (!trap) {
      this.log(`battle trap ${type} sent, not placed (safe_create refused)`);
      return true;
    }
    this.log(`battle trap ${type} placed (stock ${req.count})`);
    return true;
  }

  // One 30 Hz frame of the traps: the players in the game are the targets; the events
  // become the 6x80 calls, the blasts on the local player, the announcement and the removal.
  private tickTraps(): void {
    const g = this.opts.game;
    const view = this.opts.view;
    const targets: TrapTarget[] = [];
    for (const p of g.players.values()) {
      const local = p.clientId === g.selfId;
      // UNCLEAR: the remote players' death state is not tracked here (dead: false).
      // The reveal's owner checks (quest/battletraps.ts trapRevealed): the vision bit is the android
      // class flag (the same source as the field's capture traps); the challenge word is taken as 1
      // for the battle players (ASSUMED, see TrapTarget).
      targets.push({
        id: p.clientId, x: p.position.x, z: p.position.z, floor: p.floor, dead: local ? view.combat.damage.dead : false, local,
        trapVision: p.charClass >= 0 && isAndroid(p.charClass), challengeOne: true,
      });
    }
    const events: TrapEvent[] = this.traps.tick(targets, {
      trapsHitOwner: this.setup?.trapsHitOwner ?? false,
      challengeFlag: 0, // g_Pioneer2MapInitData[0] in a battle (ASSUMED 0, see challengeFlagValue)
    });
    for (const ev of events) {
      if (ev.kind === 'send80') {
        g.sendSubcommand(0x80, build6x80(g.selfId, ev.trap.number, ev.what).subarray(4));
        this.log(`battle trap ${ev.trap.number}: call ${ev.what}`);
      } else if (ev.kind === 'hit') {
        const effect = TRAP_EFFECTS[ev.trap.type];
        if (effect) view.combat.battleTrapHit(effect, trapDamage(this.setup?.trapDamage ?? 0), ev.trap.x, ev.trap.z, `trap ${ev.trap.type}`);
      } else if (ev.kind === 'announce') {
        this.hud?.showLines([trapAnnouncement(this.names(ev.trap.owner))]);
      } else if (ev.kind === 'burst') {
        view.combat.battleTrapBurst(ev.trap.x, ev.trap.y, ev.trap.z);
      }
    }
    view.combat.syncBattleTraps(this.traps.traps);
  }

  // 6x8F, sent by the victim's client when a remote player's strike hurt it (render/combat.ts
  // onRemoteStrikeTargets -> onPvpHit): {header = the attacker, u16 victim, u16 amount}.
  reportPlayerHit(attackerId: number, amount: number): void {
    const g = this.opts.game;
    const body = new Uint8Array(8);
    body[0] = 0x8f;
    body[1] = 2;
    new DataView(body.buffer).setUint16(2, attackerId, true); // the header names the attacker
    body.set(build6x8F(g.selfId, amount), 4);
    g.conn.send(0x60, 0, body);
  }

  private showResults(entries: PlaceEntry[], localPlace: number): void {
    const lines = entries.filter((e) => e.id >= 0).map((e) => `${RESULT_TITLES[e.place] ?? e.place + 1}  ${this.names(e.id)}  ${e.points}`);
    this.hud?.showLines(lines, 30000);
    this.log(`battle result: ${lines.join(' | ')} (you: ${localPlace + 1})`);
  }

  // ba_get_place / ba_get_score: the exe indexes the sorted place table.
  placeAt(index: number): { place: number; points: number } {
    const c = this.controller;
    const list = c ? c.places : rankPlayers([], false);
    const e = list[index];
    return e ? { place: e.place, points: e.points } : { place: 0, points: 0 };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.opts.game.onSent = null;
    this.opts.view.combat.placeTrap = null;
    this.opts.view.hud.trapCount = null;
    this.opts.view.hud.battleItems = null;
    this.opts.view.hud.battleTeam = null;
    this.traps.clear();
    this.sonar.clear();
    this.restoreCharacter();
    this.opts.view.combat.syncBattleTraps([]);
    this.opts.view.combat.battlePvp = false;
    this.opts.view.combat.onPvpHit = null;
    this.hud?.dispose();
  }
}
