// Basic combat in the game view: the local player's attack combo, hit
// detection against the enemies of the floor, the damage formulas, the enemy
// flinch / death motions, and the 6x subcommands that carry all of it to the
// other clients and to newserv.
//
// From PsoBB.exe (Ephinea 1.25.13; see combat/attack.ts and combat/formulas.ts
// for the decompiled functions and the tables):
//   - 6x43 / 6x44 / 6x45 start attack 1 / 2 / 3 of a combo (FUN_006a0f58
//     builds 6x43), and the client runs its own command through the handler;
//   - the attack motion's hit frame sends 6x46 with the entities in reach
//     (FUN_00699248) and 6x0A per damaged enemy (FUN_007732b8's tail);
//   - a killed enemy also gets 6x76 (set flags 8), the drop request 6x60 to
//     the leader and, on BB, 6xC8 so the server grants EXP.
// Reach and cone come from ItemPMT's weapon range table (FUN_007a19c0 /
// FUN_005e4ba8); enemy stats from BattleParamEntry (the server's stream file).

import type { ClientFiles } from '../data/clientfiles.ts';
import { AttackState, type AttackEvents } from '../combat/attack.ts';
import { enemyCombatMotions, type EnemyCombatMotions } from '../combat/enemymotions.ts';
import {
  applyDamage,
  enemyDefender,
  FLAG_DEAD,
  playerAttacker,
  rollDamage,
  rollHit,
  type AttackType,
  type DefenderStats,
} from '../combat/formulas.ts';
import { BattleParams, battleParamFile } from '../formats/battleparams.ts';
import { ENEMY_TYPE_PARAMS } from '../formats/entitynames.ts';
import { expandEnemySets, type EnemySlot } from '../formats/enemyslots.ts';
import { parseItemPMT, type ItemPMT, type WeaponRange } from '../formats/itempmt.ts';
import { MOTION_TYPE } from '../formats/plymotion.ts';
import { parseSetFile, type EnemySet } from '../formats/setdata.ts';
import { fetchStreamFiles } from '../net/bbsession.ts';
import { parseAttack, parseEnemyState, type Game } from '../net/game.ts';
import type { EnemyInstance, EnemyLayer } from './enemyview.ts';
import type { LobbyView } from './lobbyview.ts';
import type { MapViewer } from './mapviewer.ts';

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;
// 6x0A base flags of an enemy that is on the ground and engaged
// (0x20000000 enemy, 0x00800000 on ground, 0x00100000 activated; the capture
// GC-ForestGameRareMagFeed sends 0x20900E00 for a killing hit).
const ENEMY_BASE_FLAGS = 0x20000000 | 0x00800000 | 0x00100000;

// Action palette keys. newserv's default-keyboard-config.bin maps the key
// config inputs in the order of the unitxt labels, which puts Action Palette
// Left / Middle / Right / Top on F3 / F4 / F5 / F6. Which action sits in each
// palette slot is part of the character's palette, which is not decoded: we
// ASSUME the usual normal / heavy / special order and also accept Z / X / C.
const ATTACK_KEYS: ReadonlyArray<readonly [string[], AttackType]> = [
  [['f3', 'z'], 0],
  [['f4', 'x'], 1],
  [['f5', 'c'], 2],
];

interface EnemyRuntime {
  instance: EnemyInstance;
  index: number; // enemy index of the game (entity id = 0x1000 | index)
  slot: EnemySlot;
  stats: DefenderStats;
  motions: EnemyCombatMotions;
  rtIndex: number;
  dead: boolean;
  state: 'idle' | 'damage' | 'death';
  removeIn: number; // seconds until a dead enemy is removed
}

export interface CombatOptions {
  log: (msg: string) => void;
  // Map files of a floor (GameView.floorFilesFor).
  floorFilesFor: (floor: number) => Promise<{ area: number; files: { enemies: string } | null }>;
}

export class CombatView {
  private viewer: MapViewer;
  private game: Game;
  private files: ClientFiles;
  private layer: EnemyLayer;
  private opts: CombatOptions;
  private view: LobbyView | null = null;
  private enemies = new Map<number, EnemyRuntime>(); // by enemy index
  private attack: AttackState | null = null;
  private pmt: Promise<ItemPMT | null> | null = null;
  private params: Promise<BattleParams | null> | null = null;
  private floor = 0;
  private area = 0;
  private base = 0;
  private held = new Set<string>();
  private disposed = false;
  private rng: () => number = Math.random;
  // Set when a remote player is attacking, so LobbyView keeps its motion.
  private attacking = new Set<number>();

  constructor(viewer: MapViewer, game: Game, files: ClientFiles, layer: EnemyLayer, opts: CombatOptions) {
    this.viewer = viewer;
    this.game = game;
    this.files = files;
    this.layer = layer;
    this.opts = opts;
    game.on('subcommand', (sub, clientId, body) => this.onSubcommand(sub, clientId, body));
  }

  // True while that player is in an attack motion (LobbyView must not play a
  // gait motion over it).
  isAttacking = (clientId: number): boolean => this.attacking.has(clientId);

  attach(view: LobbyView): void {
    this.view = view;
    const inner = this.viewer.onFrame;
    this.viewer.onFrame = (dt, keys) => {
      inner?.(dt, keys);
      this.frame(dt, keys);
    };
  }

  // Enemy slots of the floor (entity ids) and their stats.
  async enterFloor(floor: number, area: number, sets: EnemySet[], base: number): Promise<void> {
    this.floor = floor;
    this.area = area;
    this.base = base;
    this.enemies.clear();
    this.attack = null;
    this.attacking.clear();
    const slots = expandEnemySets(sets, area, this.game.info?.event ?? 0);
    const headOf = new Map<number, { index: number; slot: EnemySlot }>();
    slots.forEach((slot, i) => {
      if (slot.child === 0) headOf.set(slot.set.index, { index: base + i, slot });
    });
    const params = await this.battleParams();
    if (this.disposed) return;
    let withStats = 0;
    for (const instance of this.layer.instances) {
      const head = headOf.get((instance.placed.entity as EnemySet).index);
      if (!head) continue;
      const def = ENEMY_TYPE_PARAMS[head.slot.type];
      let stats: DefenderStats = { hp: 1, maxHp: 1, evp: 0, dfp: 0 };
      if (params && def && def.stats.length) {
        const difficulty = this.game.info?.difficulty ?? 0;
        stats = enemyDefender(params.stats(difficulty, def.stats[0]), params.resist(difficulty, def.resist[0] ?? def.stats[0]));
        withStats++;
      }
      this.enemies.set(head.index, {
        instance,
        index: head.index,
        slot: head.slot,
        stats,
        motions: enemyCombatMotions(instance.spec.name, instance.archive),
        rtIndex: def?.rt ?? 0xff,
        dead: false,
        state: 'idle',
        removeIn: 0,
      });
    }
    this.opts.log(`combat: ${this.enemies.size} enemies on floor ${floor} (entities 0x${(0x1000 | base).toString(16)}+), ${withStats} with battle params`);
  }

  // --- local player ----------------------------------------------------------

  private frame(dt: number, keys: ReadonlySet<string>): void {
    if (this.disposed) return;
    const me = this.game.self;
    const view = this.view;
    if (me && view) {
      for (const [names, type] of ATTACK_KEYS) {
        const down = names.some((k) => keys.has(k));
        const key = names[0];
        if (down && !this.held.has(key)) this.press(type);
        if (down) this.held.add(key);
        else this.held.delete(key);
      }
      const animator = view.playerAnimator(me.clientId);
      if (this.attack?.active && animator) {
        animator.paused = this.attack.paused;
        const r = this.attack.tick(animator.frame, animator.ended);
        if (r.next) this.startAttack(r.next.step, r.next.type as AttackType);
        else if (r.idle) this.attacking.delete(me.clientId);
      }
    }
    // Enemy flinch / death motions.
    for (const [index, e] of [...this.enemies]) {
      if (e.state === 'idle') continue;
      const ended = e.instance.animators.every((a) => a.ended);
      if (e.state === 'damage' && ended) this.playIdle(e);
      if (e.state === 'death') {
        e.removeIn -= dt;
        if (ended && e.removeIn <= 0) {
          this.layer.remove(e.instance);
          this.enemies.delete(index);
        }
      }
    }
  }

  private press(type: AttackType): void {
    const me = this.game.self;
    if (!me || !this.view) return;
    if (this.attack?.active) {
      this.attack.press(type);
      return;
    }
    this.startAttack(0, type);
  }

  private startAttack(step: number, type: AttackType): void {
    const me = this.game.self;
    const view = this.view;
    if (!me || !view) return;
    const animator = view.playerAnimator(me.clientId);
    if (!animator) return;
    const weaponClass = this.weaponClass();
    const events: AttackEvents = {
      start: (_s, _t, motion, factor) => {
        animator.paused = false;
        animator.play(motion, factor);
      },
      hit: (s, t) => this.resolveHit((t as AttackType) ?? 0, s),
      end: () => {
        this.attacking.delete(me.clientId);
        view.resetGait(me.clientId);
      },
    };
    if (!this.attack || this.attack.weaponClass !== weaponClass) {
      this.attack = new AttackState(MOTION_TYPE[me.charClass] ?? 0, weaponClass, events);
    } else {
      this.attack.setEvents(events);
    }
    this.attacking.add(me.clientId);
    this.game.sendAttack(step, me.angle, type);
    this.attack.begin(step, type);
  }

  // Equipped weapon of the local player (first equipped 00xxxx item).
  private equippedWeapon(): { data1: Uint8Array } | null {
    const inv = this.game.selfSnapshot.inventory;
    const count = Math.min(30, inv[0]);
    for (let i = 0; i < count; i++) {
      const o = 4 + i * 0x1c;
      const flags = new DataView(inv.buffer, inv.byteOffset).getUint32(o + 4, true);
      if (!(flags & 8)) continue;
      const data1 = inv.subarray(o + 8, o + 8 + 12);
      if (data1[0] === 0) return { data1 };
    }
    return null;
  }

  private pmtSync: ItemPMT | null = null;

  // Motion class of the equipped weapon: ItemPMT's weapon kind table
  // (ASSUMED to be the motion set's weapon class; 0 = bare hands).
  private weaponClass(): number {
    const w = this.equippedWeapon();
    if (!w || !this.pmtSync) return 0;
    return this.pmtSync.weaponKinds[w.data1[1]] ?? 0;
  }

  private weaponRange(attackType: AttackType): WeaponRange {
    const w = this.equippedWeapon();
    const fallback: WeaponRange = { horizontal: 14, vertical: 18, horizontalHalfAngle: 0x127d, verticalHalfAngle: 0x127d, maxTargets: 1 };
    if (!w || !this.pmtSync) return fallback;
    return this.pmtSync.weaponRange(w.data1[1], w.data1[2], attackType) ?? fallback;
  }

  // One strike: targets in reach, hit roll, damage, and the 6x commands.
  private resolveHit(attackType: AttackType, step: number): void {
    const me = this.game.self;
    const view = this.view;
    if (!me || !view) return;
    const from = view.playerPositions().get(me.clientId);
    if (!from) return;
    const range = this.weaponRange(attackType);
    const maxDist = range.horizontal + range.vertical;
    const halfAngle = range.horizontalHalfAngle * BAMS_TO_RAD;
    const targets: EnemyRuntime[] = [];
    for (const e of this.enemies.values()) {
      if (e.dead) continue;
      // An enemy whose wave has not spawned yet is not in the room (its model
      // is hidden by render/waves.ts), so it cannot be hit.
      if (!e.instance.root.visible) continue;
      const p = e.instance.root.position;
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist || Math.abs(p.y - from.y) > 40) continue;
      let diff = Math.atan2(dx, dz) - me.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > halfAngle) continue;
      targets.push(e);
    }
    targets.sort((a, b) => a.instance.root.position.distanceToSquared(from) - b.instance.root.position.distanceToSquared(from));
    const hit = targets.slice(0, Math.max(1, range.maxTargets));
    if (!hit.length) return;
    this.game.sendAttackTargets(hit.map((e) => ({ entityId: 0x1000 | e.index })));
    const attacker = this.attackerStats();
    for (const e of hit) {
      let flags = ENEMY_BASE_FLAGS;
      let damage = 0;
      if (rollHit(attacker, e.stats, attackType, step, this.rng)) {
        damage = rollDamage(attacker, e.stats, attackType, this.rng).damage;
      }
      flags |= applyDamage(e.stats, damage);
      const total = e.stats.maxHp - e.stats.hp;
      this.game.sendEnemyState(e.index, total, flags);
      if (flags & FLAG_DEAD) this.killEnemy(e, flags);
      else if (damage >= 1) this.playDamage(e);
      this.opts.log(
        `hit E-${e.index.toString(16)} (${e.slot.type}) for ${Math.round(damage)}: ${e.stats.hp}/${e.stats.maxHp} HP${flags & FLAG_DEAD ? ' (dead)' : ''}`,
      );
    }
  }

  private attackerStats() {
    const me = this.game.self!;
    const disp = this.game.selfSnapshot.disp;
    const dv = new DataView(disp.buffer, disp.byteOffset, disp.byteLength);
    const stats = { atp: dv.getUint16(0, true), ata: dv.getUint16(0x0a, true), lck: dv.getUint16(0x0c, true) };
    const w = this.equippedWeapon();
    const pmtWeapon = w && this.pmtSync ? this.pmtSync.getWeapon(w.data1[1], w.data1[2]) : undefined;
    return playerAttacker(
      me.charClass,
      stats,
      pmtWeapon ? { atpMin: pmtWeapon.atpMin, atpMax: pmtWeapon.atpMax, grind: w!.data1[3], ata: pmtWeapon.ata } : null,
    );
  }

  // 6x0A (dead) was sent: 6x76, the drop request and the EXP request, then the
  // death motion (the enemy is removed when it ends).
  private killEnemy(e: EnemyRuntime, _flags: number): void {
    e.dead = true;
    this.game.sendEntitySetFlags(0x1000 | e.index, this.floor, 8);
    const p = e.instance.root.position;
    if (e.rtIndex !== 0xff) {
      this.game.sendEnemyDropRequest({
        floor: this.floor,
        rtIndex: e.rtIndex,
        enemyIndex: e.index,
        x: p.x,
        z: p.z,
        room: (e.slot.set as EnemySet).section,
        area: this.area,
      });
      this.opts.log(`drop request for E-${e.index.toString(16)} (rt ${e.rtIndex.toString(16)}) sent to the leader`);
    }
    this.game.sendExpRequest(e.index, true);
    this.playDeath(e);
  }

  // --- remote players and enemies -------------------------------------------

  private onSubcommand(sub: number, clientId: number, body: Uint8Array): void {
    if (this.disposed) return;
    if (sub >= 0x43 && sub <= 0x45) {
      const a = parseAttack(body);
      if (!a || a.clientId === this.game.selfId) return;
      this.remoteAttack(a.clientId, a.step, a.angle);
      return;
    }
    if (sub === 0x0a) {
      const s = parseEnemyState(body);
      if (!s) return;
      const e = this.enemies.get(s.enemyIndex);
      if (!e) return;
      e.stats.hp = Math.max(0, e.stats.maxHp - s.totalDamage);
      if (s.flags & FLAG_DEAD) {
        if (!e.dead) {
          e.dead = true;
          this.playDeath(e);
        }
      } else if (s.flags & 0x200) {
        this.playDamage(e);
      }
      return;
    }
    if (sub === 0x5f) this.opts.log(`item dropped (6x5F, ${body.length} bytes)`);
  }

  private remoteAttack(clientId: number, step: number, angle: number): void {
    const view = this.view;
    const p = this.game.players.get(clientId);
    if (!view || !p) return;
    const animator = view.playerAnimator(clientId);
    if (!animator) return;
    this.attacking.add(clientId);
    view.setPlayerAngle(clientId, angle);
    const state = new AttackState(MOTION_TYPE[p.charClass] ?? 0, 0, {
      start: (_s, _t, motion, factor) => animator.play(motion, factor),
      hit: () => {},
      end: () => {
        this.attacking.delete(clientId);
        view.resetGait(clientId);
      },
    });
    state.begin(step, 0);
    // The remote attack is driven by its own motion: when it ends the gait
    // motion comes back (the hits arrive as 6x46 / 6x0A).
    const hook = (dt: number) => {
      if (this.disposed || !state.active) {
        this.viewer.frameHooks.delete(hook);
        return;
      }
      const r = state.tick(animator.frame, animator.ended);
      if (r.idle || r.next) {
        this.viewer.frameHooks.delete(hook);
        this.attacking.delete(clientId);
        view.resetGait(clientId);
      }
      void dt;
    };
    this.viewer.frameHooks.add(hook);
  }

  private playDamage(e: EnemyRuntime): void {
    if (e.dead || !e.motions.damage) return;
    this.playMotion(e, e.motions.damage.index, e.motions.damage.speed, false);
    e.state = 'damage';
  }

  private playDeath(e: EnemyRuntime): void {
    e.state = 'death';
    e.removeIn = 0.5;
    if (e.motions.death) this.playMotion(e, e.motions.death.index, e.motions.death.speed, false);
  }

  private playIdle(e: EnemyRuntime): void {
    e.state = 'idle';
    e.instance.animators.forEach((a, i) => {
      const m = e.instance.parts[i].motion;
      if (!m) return;
      a.play(e.instance.archive.motion(m.index, a.nodeCount), m.speed, m.loop);
    });
  }

  private playMotion(e: EnemyRuntime, index: number, speed: number, loop: boolean): void {
    for (const a of e.instance.animators) {
      try {
        a.play(e.instance.archive.motion(index, a.nodeCount), speed, loop);
      } catch (err) {
        this.opts.log(`enemy motion ${index}: ${(err as Error).message}`);
      }
    }
  }

  // --- tables ----------------------------------------------------------------

  // ItemPMT: a loose file in the client data folder, else the server's stream
  // file (as ui/inventoryPanel.ts does).
  private itemPmt(): Promise<ItemPMT | null> {
    this.pmt ??= (async () => {
      try {
        const data = (await this.files.has('ItemPMT.prs')) ? await this.files.read('ItemPMT.prs') : (await this.streamFiles()).get('ItemPMT.prs');
        if (!data) return null;
        const pmt = parseItemPMT(data);
        this.pmtSync = pmt;
        return pmt;
      } catch (err) {
        this.opts.log(`combat: no ItemPMT (${(err as Error).message}); bare-hand reach is used`);
        return null;
      }
    })();
    return this.pmt;
  }

  private battleParams(): Promise<BattleParams | null> {
    this.params ??= (async () => {
      await this.itemPmt();
      const name = battleParamFile(this.game.info?.episode ?? 1, !!this.game.info?.solo);
      try {
        const data = (await this.streamFiles()).get(name);
        if (!data) throw new Error(`${name} missing from the stream file`);
        return new BattleParams(data);
      } catch (err) {
        this.opts.log(`combat: no battle params (${(err as Error).message}); enemies cannot be killed`);
        return null;
      }
    })();
    return this.params;
  }

  private streamed: Promise<Map<string, Uint8Array>> | null = null;

  private streamFiles(): Promise<Map<string, Uint8Array>> {
    this.streamed ??= fetchStreamFiles(this.game.conn, this.opts.log);
    return this.streamed;
  }

  // Enemy slots of the floors before `floor` (entity ids count across floors,
  // as newserv's MapState does).
  async enemyBase(floor: number): Promise<number> {
    let base = 0;
    for (let f = 0; f < floor; f++) {
      try {
        const { area, files } = await this.opts.floorFilesFor(f);
        if (!files || !(await this.files.has(files.enemies))) continue;
        const sets = parseSetFile(files.enemies, await this.files.read(files.enemies)).filter((e): e is EnemySet => e.kind === 'enemy');
        base += expandEnemySets(sets, area, this.game.info?.event ?? 0).length;
      } catch {
        // a floor without enemies contributes nothing
      }
    }
    return base;
  }

  dispose(): void {
    this.disposed = true;
    this.enemies.clear();
    this.view = null;
  }
}
