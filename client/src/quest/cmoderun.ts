// Challenge Mode in a running game: gives the quest VM's ChallengeMode
// (quest/cmode.ts) its surroundings (the packets, the player's records, the
// character the template replaces, the dead players, the kills), and draws the
// mode's HUD windows. Only built for a game created with the Challenge flag.
//
// HUD, positions are the exe's GUI table (0x00971f40 + 8 * n, 640x480 space):
//   timer window         GUI 0x24 = (254, 37): "h'mm\"ss" of the quest's
//                        set_cmode_base_time (CreateQuestWindowTimeObject_00760f42,
//                        set_timer_text);
//   Area counter         GUI 0x27 = (463, 37): "Area NN/NN" from
//                        set_current_area_number / set_area_total
//                        (SinowberillChallengeObjectListWindow_SetupTitleAndCountInternal_00710ae0);
//   result panel         GUI 0x43 = (12, 189): the stage's clear time, total,
//                        record, title and rank (ChallengeObjectUIPanel_UpdateLabel_004dd29c);
//   "needs help" window  GUI 0x40 = (20, 120): on a field floor of a game with
//                        one player (unitxt 12 / 0x5F, 300 ticks).

import { InventoryFullError, writeCharacterInventory } from '../net/items.ts';
import type { Game } from '../net/game.ts';
import { BOSS_AREAS } from '../net/telepipe.ts';
import type { CharacterFile } from '../net/charfile.ts';
import type { GameView } from '../render/gameview.ts';
import {
  areaCounterText,
  buildChallengeRecords,
  buildDeadFlag,
  buildGraveRecoveryRequest,
  ChallengeRecords,
  GRAVE_TRIGGER_DISTANCE,
  graveDropPoints,
  parseChallengeRecords,
  parseDeadFlag,
  parseFailureOption,
  parseSetChallengeTime,
  recordGrave,
  resultLines,
  RECORDS_SIZE,
  saveGrave,
  timerText,
  type ChallengeEnv,
  type ChallengeMode,
} from './cmode.ts';
import { applyOverlay, buildChallengeOverlay, writeOverlayRaw } from './cmodeoverlay.ts';
import type { QuestTown } from './town.ts';
import type { QuestVM } from './vm.ts';

const RECORDS_OFFSET = 0x2cb8; // PSOBBCharacterFile.challenge_records
const HINT_TEXT = ['In Challenge Mode,', 'some stage areas', "require other user's", 'help to proceed.'];
const S_RANK_TYPES = [...Array.from({ length: 0x89 - 0x70 }, (_, i) => 0x70 + i), ...Array.from({ length: 0xaa - 0xa5 }, (_, i) => 0xa5 + i)];

export interface ChallengeRuntimeOptions {
  game: Game;
  view: GameView;
  town: QuestTown;
  log: (msg: string) => void;
}

export class ChallengeRuntime {
  readonly env: ChallengeEnv;
  private vm: QuestVM | null = null;
  private recs: ChallengeRecords | null = null;
  private readonly others = new Map<number, ChallengeRecords>();
  private readonly deadFlags = new Set<number>();
  private backup: { character: CharacterFile; raw: Uint8Array } | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private readonly disposers: Array<() => void> = [];
  private alive = true;
  private graveArmed = true;
  private wasDead = false;
  private readonly firedGraves = new Set<number>();
  private graves: { owner: number; x: number; y: number; z: number }[] = [];
  private lastArea = '';

  private readonly o: ChallengeRuntimeOptions;

  constructor(o: ChallengeRuntimeOptions) {
    this.o = o;
    this.env = this.buildEnv();
    const { game } = o;
    const onSub = (sub: number, clientId: number, body: Uint8Array) => this.onSubcommand(sub, clientId, body);
    game.on('subcommand', onSub);
    const onFloor = () => this.floorChanged();
    o.view.floorHooks.add(onFloor);
    this.disposers.push(() => o.view.floorHooks.delete(onFloor));
    // Everyone sees our records (SendChallengeDataRequest_004dbacc, when the
    // Challenge object is built on entering the game).
    const full = this.full();
    if (full) o.game.sendBroadcastSubcommand(buildChallengeRecords(game.selfId, this.records()?.raw ?? new Uint8Array(RECORDS_SIZE)));
    o.view.combat.challengeExpMultiplier = 1;
    this.poll = setInterval(() => this.tick(), 250);
  }

  attach(vm: QuestVM): void {
    this.vm = vm;
  }

  private get cm(): ChallengeMode | null {
    return this.vm?.cmode ?? null;
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    if (this.poll) clearInterval(this.poll);
    for (const t of this.timers) clearTimeout(t);
    for (const d of this.disposers) d();
    const ui = this.o.town.ui;
    for (const id of ['cmode-timer', 'cmode-area', 'cmode-result', 'cmode-hint', 'cmode-dead', 'cmode-wait']) ui.setHud(id, null);
    this.o.view.combat.challengeExpMultiplier = null;
    this.restoreCharacter();
  }

  // --- the save data ------------------------------------------------------------

  private full(): Uint8Array | null {
    const f = this.o.game.selfSnapshot.full;
    return f && f.length >= RECORDS_OFFSET + RECORDS_SIZE ? f : null;
  }

  private records(): ChallengeRecords | null {
    const f = this.full();
    if (!f) return null;
    this.recs ??= new ChallengeRecords(f.subarray(RECORDS_OFFSET, RECORDS_OFFSET + RECORDS_SIZE));
    return this.recs;
  }

  // The records go back into the save data the join sync and 6x70 read.
  private persist(): void {
    const f = this.full();
    if (f && this.recs) f.set(this.recs.raw, RECORDS_OFFSET);
  }

  private character(): CharacterFile | null {
    return this.o.view.items.inventory?.c ?? null;
  }

  // --- the environment the mode asks for -------------------------------------------------

  private buildEnv(): ChallengeEnv {
    const { game, view, town, log } = this.o;
    const later = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        this.timers.delete(id);
        if (this.alive) fn();
      }, ms);
      this.timers.add(id);
    };
    return {
      isChallenge: () => !!game.info?.challenge,
      episodeIndex: () => (game.info?.episode === 2 ? 1 : 0),
      clientId: () => game.selfId,
      isLeader: () => game.selfId === game.leaderId,
      sendDf: (sub, payload) => game.sendChallengeConfig(sub, payload),
      sendSub: (body) => game.sendBroadcastSubcommand(body),
      sendRecords: (raw) => {
        this.persist();
        game.sendChallengeRecords(raw);
      },
      presentClients: () => this.present(),
      isDead: (id) => view.combat.isPlayerDead(id) || this.deadFlags.has(id),
      kills: (id) => (id === game.selfId ? game.selfKills : 0),
      resetKills: (id) => {
        if (id === game.selfId) game.selfKills = 0;
      },
      records: () => this.records(),
      random: Math.random,
      freeSlots: () => 30 - (this.character()?.inventory.length ?? 0),
      newItemId: () => view.items.takeItemId(),
      addPrize: (item) => this.addPrize(item),
      recordsChanged: () => this.persist(),
      applyTemplate: (index) => void this.applyTemplate(index),
      difficultyChanged: (n) => {
        if (game.info) game.info.difficulty = n;
      },
      expMultiplierChanged: (m) => {
        view.combat.challengeExpMultiplier = m;
      },
      stageReset: () => {
        this.graveArmed = true;
        this.firedGraves.clear();
        this.deadFlags.clear();
        town.ui.setHud('cmode-timer', null);
      },
      floorEntered: () => this.floorChanged(),
      setTimer: (sec) => {
        town.ui.setHud('cmode-timer', { x: 254, y: 37, lines: [timerText(sec)] });
      },
      showResult: (r) => {
        town.ui.setHud('cmode-result', { x: 12, y: 189, lines: resultLines(r) });
        later(12000, () => town.ui.setHud('cmode-result', null));
      },
      showRetryMenu: () => void this.retryMenu(),
      showDeadList: (clients) => {
        const names = clients.map((id) => game.players.get(id)?.name || `Player ${id + 1}`);
        town.ui.setHud('cmode-dead', { x: 270, y: 215, lines: names.length ? ['Defeated', ...names] : ['Defeated', '-'] });
        later(10000, () => town.ui.setHud('cmode-dead', null));
      },
      selectAward: () => this.pickAward(),
      nameAward: () => this.askAwardName(),
      confirmAward: () => this.confirmAward(),
      log,
    };
  }

  private present(): number[] {
    return [...this.o.game.players.keys()].filter((id) => id < 4 && this.o.game.players.get(id)?.npcTemplate === undefined);
  }

  // item_create_cmode / award_item_give: the prize goes into the local
  // inventory (and its raw save).
  private addPrize(item: Uint8Array): boolean {
    const inv = this.o.view.items.inventory;
    if (!inv) return true;
    const dv = new DataView(item.buffer, item.byteOffset, item.byteLength);
    try {
      inv.add({ data1: item.slice(0, 12), id: dv.getUint32(12, true), data2: item.slice(16, 20) });
    } catch (err) {
      if (err instanceof InventoryFullError) return false;
      throw err;
    }
    const full = this.full();
    if (full) writeCharacterInventory(inv.c, full);
    this.o.view.items.onInventoryChanged();
    return true;
  }

  // --- the character template ------------------------------------------------------------------

  private async applyTemplate(index: number): Promise<void> {
    const { view, game, log } = this.o;
    try {
      const c = this.character();
      const table = await view.combat.challengeLevelTable();
      if (!c || !table) {
        log('Challenge Mode: no character or level table, the template is not applied');
        return;
      }
      const full = this.full();
      if (!this.backup && full) this.backup = { character: structuredClone(c), raw: full.slice(0, 0x4dc) };
      const overlay = buildChallengeOverlay(this.backup?.character ?? c, index, table, () => view.items.takeItemId());
      applyOverlay(c, overlay);
      if (full) {
        writeOverlayRaw(c, full);
        game.selfSnapshot.inventory.set(full.subarray(0, 0x34c));
        game.selfSnapshot.disp.set(full.subarray(0x34c, 0x4dc));
      }
      await view.combat.reloadProgression();
      view.items.onInventoryChanged();
      log(`Challenge Mode: template ${index} (level ${c.level}, ${c.inventory.length} items)`);
    } catch (err) {
      log(`Challenge Mode: template ${index} failed: ${(err as Error).message}`);
    }
  }

  // The real character comes back when the game ends.
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
    if (full) {
      full.set(b.raw, 0);
      this.o.game.selfSnapshot.inventory.set(b.raw.subarray(0, 0x34c));
      this.o.game.selfSnapshot.disp.set(b.raw.subarray(0x34c, 0x4dc));
    }
    this.backup = null;
  }

  // --- incoming 6x ---------------------------------------------------------------------------------

  private onSubcommand(sub: number, clientId: number, body: Uint8Array): void {
    if (!this.alive || clientId === this.o.game.selfId) return;
    const cm = this.cm;
    if (sub === 0x95 && cm) {
      const t = parseSetChallengeTime(body);
      if (t) cm.receiveTimeRecord(t.clientId, t.encodedTime);
    } else if (sub === 0x97 && cm) {
      const f = parseFailureOption(body);
      if (f) cm.receiveRetry(f.retry);
    } else if (sub === 0x9d) {
      const id = parseDeadFlag(body);
      if (id !== null) this.deadFlags.add(id);
    } else if (sub === 0x7c) {
      const r = parseChallengeRecords(body);
      if (r) {
        this.others.set(r.clientId, r.records);
        this.floorChanged();
      }
    }
  }

  // --- HUD and per-tick duties -------------------------------------------------------------------------

  private floorChanged(): void {
    const { view, game, town } = this.o;
    const cur = view.current;
    if (!cur || !this.alive) return;
    // Graves of the players who died on this stage and floor
    // (ResetChallengeEntityProgress_004d99a0).
    this.graves = [];
    this.firedGraves.clear();
    const stage = this.cm?.stage ?? -1;
    const ep = game.info?.episode === 2 ? 1 : 0;
    const sources: Array<[number, ChallengeRecords | null]> = [[game.selfId, this.records()], ...this.others];
    for (const [owner, rec] of sources) {
      const g = rec ? recordGrave(rec) : null;
      if (g && g.episodeIndex === ep && g.stage === stage && g.floor === cur.floor && this.present().includes(owner)) {
        this.graves.push({ owner, x: g.x, y: g.y, z: g.z });
      }
    }
    // One player on a field floor: the "needs help" window for 300 ticks.
    const field = cur.floor !== 0 && !BOSS_AREAS.includes(cur.area);
    if (field && this.present().length < 2) {
      town.ui.setHud('cmode-hint', { x: 20, y: 120, lines: HINT_TEXT });
      const id = setTimeout(() => {
        this.timers.delete(id);
        town.ui.setHud('cmode-hint', null);
      }, 10000);
      this.timers.add(id);
    } else {
      town.ui.setHud('cmode-hint', null);
    }
  }

  private tick(): void {
    const { game, view, town } = this.o;
    const vm = this.vm;
    const cm = this.cm;
    if (!vm || !cm || !cm.active) return;
    // Area NN/NN
    const area = vm.areaTotal > 0 && vm.currentAreaNumber > 0 ? areaCounterText(vm.currentAreaNumber, vm.areaTotal) : '';
    if (area !== this.lastArea) {
      this.lastArea = area;
      town.ui.setHud('cmode-area', area ? { x: 463, y: 37, lines: [area] } : null);
    }
    // The local player died: the grave (SaveChallengeEntityProgressOnDeath_004d9a60).
    const dead = view.combat.isPlayerDead(game.selfId);
    if (dead && !this.wasDead && this.graveArmed && cm.retryAllowed) this.recordDeath();
    this.wasDead = dead;
    this.graveDrops();
  }

  private recordDeath(): void {
    const { game, view } = this.o;
    const rec = this.records();
    const cm = this.cm;
    if (!rec || !cm || cm.stage < 0) return;
    this.graveArmed = false;
    const pos = game.players.get(game.selfId)?.position;
    saveGrave(rec, {
      episodeIndex: game.info?.episode === 2 ? 1 : 0,
      stage: cm.stage,
      floor: view.current?.floor ?? 0,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      z: pos?.z ?? 0,
      team: game.name,
      defeatedByRt: 0xffffffff,
      date: new Date(),
    });
    this.persist();
    game.sendBroadcastSubcommand(buildDeadFlag(game.selfId));
    game.sendBroadcastSubcommand(buildChallengeRecords(game.selfId, rec.raw));
    this.o.log('Challenge Mode: grave saved');
  }

  // The leader walks up to a grave: the recovery items drop (6xD1 for each).
  private graveDrops(): void {
    const { game, view } = this.o;
    const cm = this.cm;
    if (!cm || game.selfId !== game.leaderId || !this.graves.length) return;
    const present = this.present();
    this.graves.forEach((g, i) => {
      if (this.firedGraves.has(i)) return;
      let near = false;
      for (const id of present) {
        const p = game.players.get(id)?.position;
        if (p && Math.hypot(p.x - g.x, p.z - g.z) < GRAVE_TRIGGER_DISTANCE) near = true;
      }
      if (!near) return;
      this.firedGraves.add(i);
      const drop = cm.graveDrop(present.length);
      if (!drop) return;
      const room = view.roomAt({ x: g.x, y: g.y, z: g.z });
      const floor = view.current?.floor ?? 0;
      for (const pt of graveDropPoints(g.x, g.z, 0, drop.count)) {
        game.sendServerSubcommand(buildGraveRecoveryRequest(game.selfId, floor, room, pt.x, pt.z, drop.type));
      }
      this.o.log(`Challenge Mode: grave drop, ${drop.count} x item type ${drop.type}`);
    });
  }

  // --- the retry menu (ChallengeObject_Update_004dbd04) --------------------------------------------------

  // The retry object waits for Pioneer 2; there the leader picks, the others read
  // a waiting message (unitxt 12 / 0x5A..0x5E).
  private async retryMenu(): Promise<void> {
    const { game, view, town } = this.o;
    const cm = this.cm;
    if (!cm) return;
    while (this.alive && cm.retryMenuOpen && view.current?.floor !== 0) await new Promise((r) => setTimeout(r, 200));
    if (!this.alive || !cm.retryMenuOpen) return;
    if (game.selfId === game.leaderId) {
      const choice = await town.ui.list(['Try again', 'Quit'], { title: 'Do you want to try this challenge again?', cancellable: false });
      if (this.alive && cm.retryMenuOpen) cm.chooseRetry(choice === 0);
    } else {
      town.ui.setHud('cmode-wait', { x: 150, y: 200, lines: ['Your leader is selecting', '"Try again / Quit."', 'Please wait.'] });
      while (this.alive && cm.retryMenuOpen) await new Promise((r) => setTimeout(r, 200));
      town.ui.setHud('cmode-wait', null);
    }
  }

  // --- the S rank prize (award_item_*) ----------------------------------------------------------------------

  private async pickAward(): Promise<number> {
    const names = S_RANK_TYPES.map((t) => `S-Rank 0x${t.toString(16).toUpperCase()}`);
    const i = await this.o.town.ui.list(names, { title: 'Choose the type of reward.', cancellable: false });
    return S_RANK_TYPES[i ?? 0] ?? 0x70;
  }

  private async askAwardName(): Promise<string> {
    // The name window of the exe is a text input; a prompt stands in for it.
    const typed = typeof prompt === 'function' ? prompt('You can put your name on this reward (8 letters).', 'RAGOL') : null;
    return (typed ?? 'RAGOL').replace(/[^A-Za-z]/g, '').slice(0, 8).toUpperCase();
  }

  private async confirmAward(): Promise<number> {
    return (await this.o.town.ui.yesNo()) ? 0 : 1;
  }
}
