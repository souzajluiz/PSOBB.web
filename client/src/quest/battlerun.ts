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
  build6x8F,
  build6x9B,
  build6xCF,
  build6xD0,
  build7D,
  parse7D,
  rankPlayers,
  type Battle7D,
  type BattleSetup,
  type EffectiveRules,
  type PlaceEntry,
} from './battle.ts';
import { BattleHud, RULES_WINDOW } from './battleui.ts';
import type { QuestUi } from './questui.ts';

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
  }

  // One 30 Hz frame: the local player's HP and death feed the score, then the controller.
  private tick(): void {
    const c = this.controller;
    const w = this.setup?.weights;
    if (!c || !w) return;
    const dmg = this.opts.view.combat.damage;
    if (c.state === 'battle') {
      if (this.lastHp >= 0 && dmg.hp < this.lastHp) this.score.takeDamage(this.lastHp - dmg.hp, false, w);
      if (dmg.dead && !this.wasDead) this.onDeath();
    }
    this.lastHp = dmg.hp;
    this.wasDead = dmg.dead;
    c.tick();
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
    }
    c.sendOwnScore();
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
    } else if (sub === 0x8f && body.length >= 8 && this.setup) {
      // 6x8F: the victim's client says we (client_id) hurt a player for `amount`.
      if (clientId === this.opts.game.selfId) {
        this.score.giveDamage(new DataView(body.buffer, body.byteOffset, body.byteLength).getUint16(6, true), true, this.setup.weights);
      }
    }
  }

  // Sent by the victim's client when a player hits it (ApplyHitEffectText); the web
  // client has no player-versus-player attacks yet, so nothing calls this.
  reportPlayerHit(attackerId: number, amount: number): void {
    const g = this.opts.game;
    const payload = build6x8F(g.selfId, amount);
    const body = new Uint8Array(8);
    body[0] = 0x8f;
    body[1] = 2;
    new DataView(body.buffer).setUint16(2, attackerId, true); // the header names the attacker
    body.set(payload, 4);
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
    this.hud?.dispose();
  }
}
