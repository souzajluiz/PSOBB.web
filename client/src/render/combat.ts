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
// Techniques (palette group 1 = 3, or the Technique menu) are cast by
// castTechnique(): combat/techniques.ts holds the data, the formulas and the
// cast state machine; this file sends 6x8D / 6x47 / 6x48 and applies the
// hits like a weapon strike (6x0A, kill flow).

import { PALETTE_KEYS } from '../input/keyconfig.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { AttackState, type AttackEvents } from '../combat/attack.ts';
import {
  AI_PROFILES,
  aiConfig,
  collisionRadius,
  EnemyAi,
  enemySpeeds,
  movementIndex,
  type AiTarget,
  type EnemyAiMotion,
} from '../combat/enemyai.ts';
import { enemyCombatMotions, type EnemyCombatMotions } from '../combat/enemymotions.ts';
import { hitMotion, PlayerDamage, type HitMotionKind } from '../combat/playerdamage.ts';
import {
  applyDamage,
  enemyDefender,
  FLAG_DEAD,
  playerAttacker,
  rollDamage,
  rollHit,
  type AttackerStats,
  type AttackType,
  type DefenderStats,
} from '../combat/formulas.ts';
import {
  castMotion,
  megidChance,
  releaseFrame,
  restaHeal,
  targetListKind,
  TECH,
  TECH_NAMES,
  TechCast,
  techData,
  techDamage,
  techElement,
  techPower,
  type TechniqueData,
  type TechResist,
} from '../combat/techniques.ts';
import { antiCures, EntityBuffs, GROUP, remoteTechLevel, reverserHp, supportPower, type BuffGroup } from '../combat/buffs.ts';
import { BattleParams, battleParamFile, type EnemyAttackData } from '../formats/battleparams.ts';
import { ENEMY_TYPE_PARAMS } from '../formats/entitynames.ts';
import { expandEnemySets, type EnemySlot } from '../formats/enemyslots.ts';
import { parseItemPMT, type ItemPMT, type WeaponRange } from '../formats/itempmt.ts';
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';
import { MOTION_TYPE } from '../formats/plymotion.ts';
import { parseSetFile, type EnemySet } from '../formats/setdata.ts';
import { fetchStreamFiles } from '../net/bbsession.ts';
import type { CharacterFile } from '../net/charfile.ts';
import {
  parseAttack,
  parseCastTechnique,
  parseCastTechniqueComplete,
  parseChangeLevel,
  parseEnemyState,
  parseExpMultiplier,
  parseGiveExp,
  parseHitByEnemy,
  parsePlayerDeath,
  parseTechLevelOverride,
  type ChangeLevel,
  type Game,
} from '../net/game.ts';
import { SePlayer } from '../audio/se.ts';
import type { DataSource } from '../data/source.ts';
import { parsePlyLevelTbl, type LevelTable } from '../formats/plyleveltbl.ts';
import { killExp, levelUpLines, PlayerProgression } from '../combat/progression.ts';
import { CombatOverlay } from './combatoverlay.ts';
import { PlayerHud } from './playerhud.ts';
import type { EnemyInstance, EnemyLayer } from './enemyview.ts';
import type { LobbyView } from './lobbyview.ts';
import type { MapViewer } from './mapviewer.ts';

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;
const pct = (m: number): string => `${m >= 0 ? '+' : ''}${(m * 100).toFixed(1)}%`;
// technique_group of a support technique and back (entity_hit_by_tech).
const BUFF_GROUP: Partial<Record<number, BuffGroup>> = {
  [TECH.shifta]: GROUP.shifta,
  [TECH.deband]: GROUP.deband,
  [TECH.jellen]: GROUP.jellen,
  [TECH.zalure]: GROUP.zalure,
};
const buffName = (type: number): string => ({ 9: 'Shifta', 10: 'Deband', 11: 'Jellen', 12: 'Zalure' } as Record<number, string>)[type] ?? `effect ${type}`;
// 6x0A base flags of an enemy that is on the ground and engaged
// (0x20000000 enemy, 0x00800000 on ground, 0x00100000 activated; the capture
// GC-ForestGameRareMagFeed sends 0x20900E00 for a killing hit).
const ENEMY_BASE_FLAGS = 0x20000000 | 0x00800000 | 0x00100000;

// Action palette keys (input/keyconfig.ts: Left / Down / Right in the BB
// default key config) and what they do: the palette slot's group 1 = 2 is an
// attack whose group 2 is the attack type (0 normal, 1 heavy, 2 special).
// Without a palette (no character file yet) the slots hold newserv's default
// hunter palette: slot 0 normal, slot 1 heavy, slot 2 Monomate.
const DEFAULT_SLOTS: ReadonlyArray<{ group1: number; group2: number; disabled: boolean }> = [
  { group1: 2, group2: 0, disabled: false },
  { group1: 2, group2: 1, disabled: false },
  { group1: 4, group2: 0, disabled: false },
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
  ai: EnemyAi | null; // combat/enemyai.ts (null: no AI profile for this class)
  attacker: AttackerStats | null; // this enemy hitting a player
  attack: EnemyAttackData | null;
  exp: number; // BattleParamEntry exp of the enemy's stats row
  resist: TechResist; // ResistData efr / eic / eth / elt / edk
  buffs: EntityBuffs; // Jellen / Zalure (combat/buffs.ts)
}

// The local player's technique cast in progress.
interface CastInProgress {
  tech: number;
  level: number; // 0-based effective level
  data: TechniqueData;
  state: TechCast;
  targets: EnemyRuntime[];
  sent: number[]; // the 6x47 target entity ids
}

// A technique's hit waiting for its object to reach the target (game ticks).
interface PendingTechHit {
  ticks: number;
  apply: () => void;
}

// 6x47 / 6x48 subcommand numbers.
const SUB_CAST_TECHNIQUE = 0x47;
const SUB_CAST_TECHNIQUE_COMPLETE = 0x48;
// ASSUMED: Rafoie's explosion reaches enemies within this distance of its
// target (the real object is a projectile with its own collision).
const RAFOIE_BLAST_RADIUS = 20;
// ASSUMED: the targeting system's height window for techniques (the weapon
// hit uses the same).
const TECH_HEIGHT_WINDOW = 40;

export interface CombatOptions {
  log: (msg: string) => void;
  // palette_slots[index] of the current action palette (render/fieldhud.ts).
  paletteSlot?: (index: number) => { group1: number; group2: number; disabled: boolean } | null;
  // Map files of a floor (GameView.floorFilesFor).
  floorFilesFor: (floor: number) => Promise<{ area: number; files: { enemies: string } | null }>;
  // Ground height under (x, z), so a walking enemy follows the floor.
  ground?: (x: number, z: number, fromY: number) => number | null;
  // The session's character (E7) kept in step with level / EXP / stats, like
  // net/items.ts keeps the inventory.
  character?: () => CharacterFile | null;
  fullCharacter?: () => Uint8Array | null;
  // The client data folder, for the HUD's sound effects (common.pac).
  source?: DataSource;
}

// Sound of the local player's level-up (PlayDirectionalSoundBasedOnAction_00692bf4,
// played when player +0x32c == 1, the local player).
const SE_LEVEL_UP = 0x58d;

// Enemy attacker stats out of the BattleParamEntry rows, as
// set_enemy_stats_from_battleparams (0x007621xx) builds them: ATP = stats.atp,
// spread = attack.max_atp - attack.min_atp, ATA = attack.min_ata + stats.ata,
// LCK = stats.lck; the "equipment ATP" an enemy carries is attack.min_atp
// (*(i16 *)(entity+0x31c)).
function enemyAttacker(stats: { atp: number; ata: number; lck: number }, attack: EnemyAttackData): AttackerStats {
  return {
    atp: stats.atp,
    atpSpread: Math.max(0, attack.maxAtp - attack.minAtp),
    equipAtp: attack.minAtp,
    ata: attack.minAta + stats.ata,
    lck: stats.lck,
    isPlayer: false,
  };
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
  // The local player's HP, hit / death motions and 6x4A..6x4F (see
  // combat/playerdamage.ts).
  readonly damage: PlayerDamage;
  private overlay: CombatOverlay | null = null;
  private tickRemainder = 0;
  private lockOn: EnemyRuntime | null = null;
  // Remote players in a hit / death motion: LobbyView must not play their gait.
  private hurt = new Set<number>();
  private hpReadout: HTMLElement | null = null;
  // Level, EXP and stats of the local player (combat/progression.ts), from
  // PlyLevelTbl.prs of the stream file; the HUD (classic/hud.ts).
  progression: PlayerProgression | null = null;
  private levelTablePromise: Promise<LevelTable | null> | null = null;
  hud: PlayerHud | null = null;
  tp = 0;
  // 6xDD: the lobby's EXP multiplier (unknown_xp_multiplier).
  expMultiplier = 1;
  private sePlayer: SePlayer | null = null;
  // The web client has no Reverser or Moon Atomizer, so this key revives the
  // local player (the real client needs another player's item or a trip back
  // to Pioneer 2).
  private reviveKey = 'r';
  private cast: CastInProgress | null = null;
  private techHits: PendingTechHit[] = [];
  private castTickRemainder = 0;
  // Shifta / Deband / Jellen / Zalure on the local player (combat/buffs.ts).
  // ASSUMED: they survive a floor change (the client keeps the player object
  // across field warps; its tick only runs on a field).
  readonly selfBuffs = new EntityBuffs();
  // Per remote client: the last 6x8D level_upgrade and the last 6x47, which its
  // 6x48 technique object runs with (action_launch_tech).
  private techOverride = new Map<number, number>();
  private remoteCasts = new Map<number, { tech: number; targets: number[] }>();
  // Remote players lying dead (6x4D .. 6x4F): Reverser targets.
  private deadPlayers = new Set<number>();

  constructor(viewer: MapViewer, game: Game, files: ClientFiles, layer: EnemyLayer, opts: CombatOptions) {
    this.viewer = viewer;
    this.game = game;
    this.files = files;
    this.layer = layer;
    this.opts = opts;
    this.damage = new PlayerDamage({
      motion: (kind) => this.playSelfMotion(kind),
      push: (vx, vz) => this.view?.pushPlayer(this.game.selfId, vx, vz),
      face: (angle) => this.view?.setPlayerAngle(this.game.selfId, angle),
      sendHit: (heavy, angle, hp, vx, vz) => this.game.sendHitByEnemy(heavy, angle, hp, vx, vz),
      sendShieldAttack: () => this.game.sendShieldAttack(),
      sendDeath: (killer, flags) => this.game.sendPlayerDeath(killer, flags),
      sendRevivable: () => this.game.sendPlayerRevivable(),
      sendRevived: () => this.game.sendPlayerRevived(),
      log: (msg) => this.opts.log(msg),
    });
    game.on('subcommand', (sub, clientId, body) => this.onSubcommand(sub, clientId, body));
  }

  // True while that player is in an attack, hit or death motion (LobbyView must
  // not play a gait motion over it, and the local player must not move).
  isAttacking = (clientId: number): boolean =>
    this.attacking.has(clientId) || this.hurt.has(clientId) || (clientId === this.game.selfId && this.damage.busy);

  attach(view: LobbyView): void {
    this.view = view;
    this.overlay ??= new CombatOverlay(this.viewer.scene);
    this.hpReadout ??= this.makeHpReadout();
    if (!this.hud) {
      this.hud = new PlayerHud(this.viewer, this.files);
      this.hud.log = this.opts.log;
    }
    const inner = this.viewer.onFrame;
    this.viewer.onFrame = (dt, keys) => {
      inner?.(dt, keys);
      this.frame(dt, keys);
    };
  }

  // The revive hint over the canvas while the local player is dead (the HUD
  // itself is render/playerhud.ts).
  private makeHpReadout(): HTMLElement | null {
    const parent = this.viewer.renderer.domElement.parentElement;
    if (!parent) return null;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const el = document.createElement('div');
    el.className = 'combat-hp';
    parent.appendChild(el);
    return el;
  }

  private updateHpReadout(): void {
    const el = this.hpReadout;
    if (!el) return;
    // Keep it in the bottom-left corner of the canvas itself (the parent also
    // holds the hint line under it).
    const canvas = this.viewer.renderer.domElement;
    el.style.left = `${canvas.offsetLeft + 12}px`;
    el.style.top = `${canvas.offsetTop + canvas.clientHeight - 40}px`;
    const d = this.damage;
    el.hidden = !d.dead;
    el.textContent = d.dead ? `dead - press ${this.reviveKey.toUpperCase()} to revive` : '';
    el.classList.toggle('dead', d.dead);
  }

  // Max HP of the local player: PlayerDispDataV4's PlayerStats
  // (atp, mst, evp, hp, dfp, ata, lck as u16).
  private selfStats(): { atp: number; mst: number; evp: number; hp: number; dfp: number; ata: number; lck: number } {
    const disp = this.game.selfSnapshot.disp;
    const dv = new DataView(disp.buffer, disp.byteOffset, disp.byteLength);
    const u = (k: number) => (disp.byteLength >= k + 2 ? dv.getUint16(k, true) : 0);
    return { atp: u(0), mst: u(2), evp: u(4), hp: u(6), dfp: u(8), ata: u(0x0a), lck: u(0x0c) };
  }

  // Enemy slots of the floor (entity ids) and their stats.
  async enterFloor(floor: number, area: number, sets: EnemySet[], base: number): Promise<void> {
    this.floor = floor;
    this.area = area;
    this.base = base;
    this.enemies.clear();
    this.attack = null;
    this.cast = null;
    this.techHits = [];
    this.attacking.clear();
    const slots = expandEnemySets(sets, area, this.game.info?.event ?? 0);
    const headOf = new Map<number, { index: number; slot: EnemySlot }>();
    slots.forEach((slot, i) => {
      if (slot.child === 0) headOf.set(slot.set.index, { index: base + i, slot });
    });
    const params = await this.battleParams();
    if (this.disposed) return;
    const difficulty = this.game.info?.difficulty ?? 0;
    const ultimate = difficulty === 3;
    let withStats = 0;
    let withAi = 0;
    for (const instance of this.layer.instances) {
      const head = headOf.get((instance.placed.entity as EnemySet).index);
      if (!head) continue;
      const def = ENEMY_TYPE_PARAMS[head.slot.type];
      let stats: DefenderStats = { hp: 1, maxHp: 1, evp: 0, dfp: 0 };
      let attacker: AttackerStats | null = null;
      let attack: EnemyAttackData | null = null;
      let exp = 0;
      let resist: TechResist = { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };
      if (params && def && def.stats.length) {
        const s = params.stats(difficulty, def.stats[0]);
        exp = s.exp;
        const r = params.resist(difficulty, def.resist[0] ?? def.stats[0]);
        stats = enemyDefender(s, r);
        resist = { efr: r.efr, eic: r.eic, eth: r.eth, elt: r.elt, edk: r.edk };
        attack = params.attack(difficulty, def.attack[0] ?? def.stats[0]);
        attacker = enemyAttacker(s, attack);
        withStats++;
      }
      // Behaviour: the AI profile of the client class plus the enemy's own
      // AI record (search radius / turn rate) and MovementData speeds.
      const className = instance.spec.name;
      const profile = AI_PROFILES[className] ?? null;
      let ai: EnemyAi | null = null;
      if (profile) {
        // initdata_param6 (set entry params[5]) is the subtype, as
        // formats/enemymodels.ts reads it.
        const subtype = Math.max(0, Math.trunc(head.slot.set.params[5]));
        const cfg = aiConfig(className, subtype);
        const mi = params ? movementIndex(head.slot.type) : null;
        const radius = collisionRadius(className, subtype, ultimate);
        ai = new EnemyAi({
          x: instance.placed.world[0],
          z: instance.placed.world[2],
          angle: instance.placed.yaw,
          profile,
          detect: cfg.detect,
          turnRate: cfg.turnRate,
          attack,
          // No MovementData: 0.5 units per tick is ASSUMED (the Booma family's
          // engaged speed) so the enemy still closes in.
          speeds: enemySpeeds(params && mi !== null ? params.movement(difficulty, mi) : null, 0.5),
          radius,
          // initdata_param2: the e.dat entry's wander radius.
          wander: Math.max(0, head.slot.set.params[1]),
        });
        withAi++;
      }
      this.enemies.set(head.index, {
        instance,
        index: head.index,
        slot: head.slot,
        stats,
        motions: enemyCombatMotions(className, instance.archive),
        rtIndex: def?.rt ?? 0xff,
        dead: false,
        state: 'idle',
        removeIn: 0,
        ai,
        attacker,
        attack,
        exp,
        resist,
        buffs: new EntityBuffs(),
      });
    }
    // HP follows the player across floors (a warp does not heal); it is only
    // refilled when the character's max HP is not known yet or changed.
    const s = this.selfStats();
    const progression = await this.ensureProgression();
    if (this.disposed) return;
    const maxHp = progression?.maxHp ?? (s.hp || 1);
    this.damage.reset(maxHp, this.damage.maxHp === maxHp && !this.damage.dead ? this.damage.hp : maxHp);
    if (progression && this.tp === 0) this.tp = progression.maxTp;
    this.opts.log(
      `combat: ${this.enemies.size} enemies on floor ${floor} (entities 0x${(0x1000 | base).toString(16)}+), ` +
        `${withStats} with battle params, ${withAi} with AI; you have ${this.damage.hp} HP`,
    );
  }

  // --- local player ----------------------------------------------------------

  private frame(dt: number, keys: ReadonlySet<string>): void {
    if (this.disposed) return;
    const me = this.game.self;
    const view = this.view;
    if (me && view) {
      const blocked = this.damage.busy;
      for (const [key, index] of PALETTE_KEYS) {
        const down = keys.has(key);
        if (down && !this.held.has(key) && !blocked) {
          const slot = this.opts.paletteSlot?.(index) ?? DEFAULT_SLOTS[index];
          if (slot && !slot.disabled && slot.group1 === 2 && slot.group2 <= 2) this.press(slot.group2 as AttackType);
          else if (slot && !slot.disabled && slot.group1 === 3) this.castTechnique(slot.group2);
          else if (slot && slot.group1 !== 0) this.opts.log(`palette slot ${index} (${slot.group1}, ${slot.group2}): only attacks and techniques are wired yet`);
        }
        if (down) this.held.add(key);
        else this.held.delete(key);
      }
      if (keys.has(this.reviveKey)) {
        if (!this.held.has(this.reviveKey) && this.damage.state === 'revivable') this.damage.revive();
        this.held.add(this.reviveKey);
      } else {
        this.held.delete(this.reviveKey);
      }
      const animator = view.playerAnimator(me.clientId);
      if (this.attack?.active && animator) {
        animator.paused = this.attack.paused;
        const r = this.attack.tick(animator.frame, animator.ended);
        if (r.next) this.startAttack(r.next.step, r.next.type as AttackType);
        else if (r.idle) this.attacking.delete(me.clientId);
      }
    }
    this.castTickRemainder += dt * GAME_TICKS_PER_SECOND;
    const castTicks = Math.min(5, Math.floor(this.castTickRemainder));
    this.castTickRemainder -= Math.floor(this.castTickRemainder);
    for (let i = 0; i < castTicks; i++) this.tickCast();
    // Enemy flinch / death motions.
    for (const [index, e] of [...this.enemies]) {
      if (e.state === 'idle') continue;
      const ended = e.instance.animators.every((a) => a.ended);
      if (e.state === 'damage' && ended) {
        this.playIdle(e);
        e.ai?.resume();
        if (e.ai?.motion) this.playEnemyMotion(e, e.ai.motion);
      }
      if (e.state === 'death') {
        e.removeIn -= dt;
        if (ended && e.removeIn <= 0) {
          this.layer.remove(e.instance);
          this.enemies.delete(index);
          if (this.lockOn === e) this.lockOn = null;
        }
      }
    }
    // Game ticks (30 per second) drive the enemy AI and the player's hit state.
    this.tickRemainder += dt * GAME_TICKS_PER_SECOND;
    let ticks = Math.floor(this.tickRemainder);
    this.tickRemainder -= ticks;
    ticks = Math.min(ticks, 5); // a long frame must not run the AI away
    for (let i = 0; i < ticks; i++) {
      this.tickEnemies();
      this.damage.tick();
      this.tickTechHits();
      this.tickBuffs();
    }
    this.updateLockOn();
    this.overlay?.update(dt);
    this.updateHpReadout();
    this.hud?.frame(dt, this.hudValues());
  }

  // What the status window shows (ChallengeMenuListWindow_UpdateStatusBar_007439e8).
  private hudValues() {
    const me = this.game.self;
    const p = this.progression;
    const maxTp = p?.maxTp ?? 0;
    this.tp = Math.min(this.tp, maxTp);
    return {
      name: me?.name ?? '',
      slot: this.game.selfId,
      level: p ? p.level + 1 : (me?.level ?? 1),
      hp: this.damage.hp,
      maxHp: this.damage.maxHp,
      tp: this.tp,
      maxTp,
      pb: 0, // photon blasts are not implemented
      dead: this.damage.dead,
      statusIcons: this.selfBuffs.icons(),
    };
  }

  // shifta_jellen_effect_tick / deband_zalure_effect_tick, once per frame on
  // the local player and on every live enemy.
  private tickBuffs(): void {
    for (const s of this.selfBuffs.tick()) this.opts.log(`${buffName(s.type)} wore off`);
    for (const e of this.enemies.values()) {
      if (e.dead) continue;
      for (const s of e.buffs.tick()) this.opts.log(`${buffName(s.type)} on E-${e.index.toString(16)} wore off`);
    }
  }

  // An enemy's attacker stats with its Jellen applied.
  private enemyAttackerOf(e: EnemyRuntime): AttackerStats | null {
    const a = e.attacker;
    if (!a) return null;
    return { ...a, atp: e.buffs.atp(a.atp), atpSpread: e.buffs.atpSpread(a.atpSpread) };
  }

  // An enemy's defender stats with its Zalure applied.
  private enemyDefenderOf(e: EnemyRuntime): DefenderStats {
    return { ...e.stats, dfp: e.buffs.dfp(e.stats.dfp) };
  }

  // Players an enemy can target: on this floor and alive.
  private aiTargets(): AiTarget[] {
    const view = this.view;
    if (!view) return [];
    const positions = view.playerPositions();
    const out: AiTarget[] = [];
    for (const [id, pos] of positions) {
      const p = this.game.players.get(id);
      if (!p) continue;
      if (id === this.game.selfId && this.damage.dead) continue;
      out.push({ clientId: id, x: pos.x, z: pos.z, charClass: p.charClass, dead: false });
    }
    return out;
  }

  private tickEnemies(): void {
    const targets = this.aiTargets();
    for (const e of this.enemies.values()) {
      const ai = e.ai;
      if (!ai || e.dead || e.state !== 'idle') continue;
      // An enemy whose wave has not spawned is not in the room yet.
      if (!e.instance.root.visible) continue;
      const ended = e.instance.animators.length > 0 && e.instance.animators.every((a) => a.ended);
      const r = ai.tick(targets, ended);
      const root = e.instance.root;
      if (r.x !== root.position.x || r.z !== root.position.z) {
        const y = this.opts.ground?.(r.x, r.z, root.position.y + 30) ?? null;
        root.position.set(r.x, y ?? root.position.y, r.z);
      }
      root.rotation.y = r.angle;
      if (r.motion) this.playEnemyMotion(e, r.motion);
      if (r.hit) this.enemyHitsPlayer(e, r.hit.clientId, r.hit.knockback, r.hit.mult);
    }
  }

  private playEnemyMotion(e: EnemyRuntime, m: EnemyAiMotion): void {
    for (const a of e.instance.animators) {
      try {
        a.play(e.instance.archive.motion(m.index, a.nodeCount), m.speed, m.loop);
      } catch (err) {
        this.opts.log(`enemy motion ${m.index}: ${(err as Error).message}`);
      }
    }
  }

  // One enemy melee landing on a player: the hit roll and the damage of
  // FUN_00777664 / FUN_007732b8 with the attack's own multiplier.
  private enemyHitsPlayer(e: EnemyRuntime, clientId: number, knockback: number, mult: number): void {
    if (clientId !== this.game.selfId) return; // other clients resolve their own hits
    const view = this.view;
    const attacker = this.enemyAttackerOf(e);
    if (!view || !attacker) return;
    const from = view.playerPositions().get(clientId);
    const p = e.instance.root.position;
    const stats = this.selfStats();
    // Deband / Zalure move the player's DFP (+0x2d2).
    const defender: DefenderStats = { hp: this.damage.hp, maxHp: this.damage.maxHp, evp: stats.evp, dfp: this.selfBuffs.dfp(stats.dfp) };
    // The generic hit check has no attack-type or combo multiplier for an
    // enemy's melee: accuracy 1.0.
    const chance = (attacker.ata - defender.evp * 0.2) * 0.01;
    let total = 0;
    if (chance > 0 && this.rng() <= chance) {
      total = rollDamage(attacker, defender, 0, this.rng, mult).damage;
    }
    const angle = from ? Math.atan2(from.x - p.x, from.z - p.z) : 0;
    this.damage.hit(total, angle, knockback, 0x1000 | e.index);
  }

  // Lock-on cursor: the nearest live enemy in front of the player
  // (SetDerolleLockonTarget_0078730c picks the client's own target the same way).
  private updateLockOn(): void {
    const view = this.view;
    const me = this.game.self;
    if (!view || !me || !this.overlay) return;
    const from = view.playerPositions().get(me.clientId);
    if (!from || this.damage.dead) {
      this.overlay.setTarget(null);
      this.lockOn = null;
      return;
    }
    let best: EnemyRuntime | null = null;
    let bestSq = 220 * 220; // ASSUMED lock-on range
    for (const e of this.enemies.values()) {
      if (e.dead || !e.instance.root.visible) continue;
      const p = e.instance.root.position;
      let diff = Math.atan2(p.x - from.x, p.z - from.z) - me.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > Math.PI / 3) continue;
      const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
      if (d >= bestSq) continue;
      best = e;
      bestSq = d;
    }
    this.lockOn = best;
    this.overlay.setTarget(best ? { x: best.instance.root.position.x, y: best.instance.root.position.y + 22, z: best.instance.root.position.z } : null);
  }

  // Plays one of the player's hit / death / revive field motions.
  private playSelfMotion(kind: HitMotionKind): void {
    const me = this.game.self;
    const view = this.view;
    if (!me || !view) return;
    const animator = view.playerAnimator(me.clientId);
    if (!animator) return;
    animator.paused = false;
    animator.play(hitMotion(MOTION_TYPE[me.charClass] ?? 0, this.weaponClass(), kind), 1);
  }

  private press(type: AttackType): void {
    const me = this.game.self;
    if (!me || !this.view || this.cast) return;
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
      let damage = 0;
      let critical = false;
      const defender = this.enemyDefenderOf(e);
      if (rollHit(attacker, defender, attackType, step, this.rng)) {
        const r = rollDamage(attacker, defender, attackType, this.rng);
        damage = r.damage;
        critical = r.critical;
      }
      this.applyEnemyHit(e, ENEMY_BASE_FLAGS, damage, critical, '');
    }
  }

  // One damaged (or missed) enemy: 6x0A with the new total, the number over
  // it, its reaction, and the kill flow when it died. Shared by weapon hits
  // and techniques (entity_hit_by_tech ends in the same ApplyHitEffects).
  private applyEnemyHit(e: EnemyRuntime, baseFlags: number, damage: number, critical: boolean, what: string): void {
    const me = this.game.self;
    const flags = baseFlags | applyDamage(e.stats, damage);
    const total = e.stats.maxHp - e.stats.hp;
    this.game.sendEnemyState(e.index, total, flags);
    // FUN_0078a5e8 shows round(d) of the hit box over the enemy.
    const p = e.instance.root.position;
    this.overlay?.damage(damage, critical, p.x, p.y + 26, p.z);
    // The enemy turns on its attacker (unknown_enemy_behavior_4).
    if (damage >= 1 && me) e.ai?.onDamage(me.clientId);
    if (flags & FLAG_DEAD) this.killEnemy(e, flags);
    else if (damage >= 1) this.playDamage(e);
    this.opts.log(
      `${what}hit E-${e.index.toString(16)} (${e.slot.type}) for ${Math.round(damage)}: ${e.stats.hp}/${e.stats.maxHp} HP${flags & FLAG_DEAD ? ' (dead)' : ''}`,
    );
  }

  // --- techniques -------------------------------------------------------------

  // 0-based learned level of a technique (CalculateEffectiveTechniqueLevel;
  // the character file keeps it 1-based), null when not learned.
  private techLevel(tech: number): number | null {
    const lv = this.opts.character?.()?.techLevels[tech];
    return lv ? lv - 1 : null;
  }

  // CanPlayerCastTechnique_0069a0c4 + SendCastTechPacket_0069a2f0: starts a
  // cast from the palette or the Technique menu; false when it cannot be cast.
  castTechnique(tech: number): boolean {
    const me = this.game.self;
    const view = this.view;
    const name = TECH_NAMES[tech] ?? `technique ${tech}`;
    if (!me || !view || tech < 0 || tech > 18) return false;
    if (this.cast || this.attack?.active || this.damage.busy || this.damage.dead) return false;
    const level = this.techLevel(tech);
    if (level === null) {
      this.opts.log(`${name}: not learned`);
      return false;
    }
    if (tech === TECH.ryuker) {
      // SinowberillChallengePlayer_IsTelepipeEnabled_0068bfa0 and the warp
      // back to Pioneer 2 are not part of the web client.
      this.opts.log(`${name}: not wired (no telepipe)`);
      return false;
    }
    const data = techData(tech, level, me.charClass);
    if (this.tp - data.tpCost < 0) {
      this.opts.log(`${name} Lv${level + 1}: not enough TP (${this.tp} < ${data.tpCost})`);
      return false;
    }
    const animator = view.playerAnimator(me.clientId);
    if (!animator) return false;
    const targets = this.techTargets(tech, data);
    const kind = targetListKind(tech);
    let sent: Array<{ entityId: number }> = [];
    if (tech === TECH.reverser) {
      const dead = this.reverserTarget(data);
      sent = dead === null ? [] : [{ entityId: dead }];
    } else if (tech === TECH.resta || tech === TECH.anti || tech === TECH.shifta || tech === TECH.deband) {
      sent = this.playerTargets(data).map((id) => ({ entityId: id }));
    } else if (kind === 'one') sent = targets.slice(0, 1).map((e) => ({ entityId: 0x1000 | e.index }));
    else if (kind === 'list') sent = targets.map((e) => ({ entityId: 0x1000 | e.index }));
    this.game.sendCastTechnique(tech, level, sent);
    // The enter code of input state 8 turns the caster to the first target.
    const first = targets[0];
    const from = view.playerPositions().get(me.clientId);
    if (first && from && kind !== 'none') {
      const p = first.instance.root.position;
      view.setPlayerAngle(me.clientId, Math.atan2(p.x - from.x, p.z - from.z));
    }
    const motionType = MOTION_TYPE[me.charClass] ?? 0;
    const weaponClass = this.weaponClass();
    animator.paused = false;
    animator.play(castMotion(motionType, weaponClass), 1);
    this.attacking.add(me.clientId);
    this.cast = {
      tech,
      level,
      data,
      targets,
      sent: sent.map((t) => t.entityId),
      state: new TechCast(data, releaseFrame(motionType, weaponClass), {
        release: () => this.releaseTechnique(),
        done: () => {
          this.cast = null;
          this.attacking.delete(me.clientId);
          animator.paused = false;
          view.resetGait(me.clientId);
        },
      }),
    };
    this.opts.log(`cast ${name} Lv${level + 1} (${data.tpCost} TP, ${sent.length} target(s) in 6x47)`);
    return true;
  }

  // One game tick of the local cast (ProcessHeavySpecialAttackState).
  private tickCast(): void {
    const c = this.cast;
    const me = this.game.self;
    if (!c || !me) return;
    const animator = this.view?.playerAnimator(me.clientId);
    if (!animator || this.damage.busy) {
      // A hit or death ends input state 8 (its end handler,
      // ResetPlayerTechState_006a2a90); a cast not released yet costs no TP.
      this.cast = null;
      this.attacking.delete(me.clientId);
      if (animator) animator.paused = false;
      return;
    }
    c.state.tick(animator.frame, animator.ended);
    // Phase 1 holds the motion near its first frame.
    animator.paused = c.state.holding;
    if (c.state.holding) animator.frame = c.state.holdFrame;
  }

  // Enemies the technique reaches, nearest first: within range_h on the
  // ground plane and inside the half-angle angle_h of the facing, the
  // lock-on target first when it qualifies (ASSUMED: the targeting system's
  // tech entries, SinowberillWeaponObject_FindTargetingParam_007a401c type 3,
  // are filtered by the technique's own range and angle).
  private techTargets(tech: number, data: TechniqueData): EnemyRuntime[] {
    const me = this.game.self;
    const from = me && this.view?.playerPositions().get(me.clientId);
    if (!me || !from) return [];
    if (techElement(tech) === null && tech !== TECH.jellen && tech !== TECH.zalure) return [];
    const half = data.angleH * BAMS_TO_RAD;
    const list: Array<{ e: EnemyRuntime; d: number }> = [];
    for (const e of this.enemies.values()) {
      if (e.dead || !e.instance.root.visible) continue;
      const p = e.instance.root.position;
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > data.rangeH || Math.abs(p.y - from.y) > TECH_HEIGHT_WINDOW) continue;
      if (half < Math.PI) {
        let diff = Math.atan2(dx, dz) - me.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) > half) continue;
      }
      list.push({ e, d });
    }
    list.sort((a, b) => a.d - b.d);
    const out = list.map((x) => x.e);
    const lock = this.lockOn;
    if (lock && out.includes(lock)) {
      out.splice(out.indexOf(lock), 1);
      out.unshift(lock);
    }
    return out.slice(0, Math.max(1, data.targets));
  }

  // Party members (client ids) a support technique reaches: the caster, then
  // the others within range_h (targets = 0 below level 3: the caster only).
  private playerTargets(data: TechniqueData): number[] {
    const me = this.game.self;
    const positions = this.view?.playerPositions();
    const from = me && positions?.get(me.clientId);
    if (!me || !positions || !from) return [];
    const out = [me.clientId];
    for (const [id, p] of positions) {
      if (id === me.clientId || out.length >= data.targets) continue;
      if (Math.hypot(p.x - from.x, p.z - from.z) <= data.rangeH) out.push(id);
    }
    return out;
  }

  // Reverser's one 6x47 target: the nearest party member lying dead within
  // range_h (ASSUMED: the targeting system's entry for the 6x4E particle).
  private reverserTarget(data: TechniqueData): number | null {
    const me = this.game.self;
    const positions = this.view?.playerPositions();
    const from = me && positions?.get(me.clientId);
    if (!me || !positions || !from) return null;
    let best: number | null = null;
    let bestD = data.rangeH;
    for (const id of this.deadPlayers) {
      const p = positions.get(id);
      if (!p) continue;
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d <= bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  // The release frame (0x006a0340 area): TP, 6x48, then the technique's
  // effect (action_launch_tech -> unknown_cast_tech).
  private releaseTechnique(): void {
    const c = this.cast;
    const me = this.game.self;
    const view = this.view;
    if (!c || !me || !view) return;
    const tp = this.tp - c.data.tpCost;
    this.tp = tp < 1 ? 0 : tp;
    this.game.sendCastTechniqueComplete(c.tech, c.level);
    const name = TECH_NAMES[c.tech];
    const from = view.playerPositions().get(me.clientId);
    if (!from) return;
    const mst = this.selfStats().mst;
    if (c.tech === TECH.resta) {
      const heal = restaHeal(c.level, mst, me.charClass);
      const before = this.damage.hp;
      if (!this.damage.dead) this.damage.hp = Math.min(this.damage.maxHp, this.damage.hp + heal);
      this.overlay?.techEffect('resta', from.x, from.y, from.z, c.data.rangeH);
      this.opts.log(`${name} Lv${c.level + 1}: +${heal} HP (${before} -> ${this.damage.hp}); other players heal on their own clients`);
      return;
    }
    if (techElement(c.tech) === null) {
      this.overlay?.techEffect('support', from.x, from.y, from.z, c.tech === TECH.jellen || c.tech === TECH.zalure ? c.data.rangeH : 20);
      this.releaseSupport(c);
      return;
    }
    // Who is hit: single-target techniques take the first target, Rafoie
    // explodes around it, the others reach every target in range.
    let hits = c.targets.filter((e) => !e.dead);
    if (c.data.targets <= 1) hits = hits.slice(0, 1);
    if (c.tech === TECH.rafoie) {
      const t = hits[0];
      hits = t ? [...this.enemies.values()].filter((e) => !e.dead && e.instance.root.position.distanceTo(t.instance.root.position) <= RAFOIE_BLAST_RADIUS) : [];
    }
    const element = techElement(c.tech)!;
    if (!hits.length) {
      // No target: the object flies straight ahead and fades (unknown_cast_tech).
      const a = me.angle;
      const r = Math.min(c.data.rangeH, 60);
      this.overlay?.techEffect(element, from.x + Math.sin(a) * r, from.y, from.z + Math.cos(a) * r, 12);
      this.opts.log(`${name} Lv${c.level + 1}: no target`);
      return;
    }
    // ASSUMED: the object travels `speed` units per tick (Foie: speed +
    // max(0, level - 4), TechniqueObject_ApplyPowerAndSpeedStats_006e31e8);
    // techniques with speed 0 strike at once.
    const speed = c.tech === TECH.foie ? c.data.speed + Math.max(0, c.level - 4) : c.data.speed;
    const area = c.data.angleH * BAMS_TO_RAD >= Math.PI && c.data.targets > 1;
    if (area) this.overlay?.techEffect(element, from.x, from.y, from.z, c.data.rangeH);
    for (const e of hits) {
      const p = e.instance.root.position;
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      this.techHits.push({
        ticks: speed > 0 ? Math.ceil(d / speed) : 0,
        apply: () => {
          if (e.dead || !this.enemies.has(e.index)) return;
          if (!area) this.overlay?.techEffect(element, p.x, p.y, p.z, 14);
          this.techHitEnemy(c.tech, c.level, mst, me.charClass, e);
        },
      });
    }
  }

  // The support techniques' objects on this client (combat/buffs.ts). The
  // caster is always hit; the other players in the 6x47 list apply the effect
  // on their own clients when this cast's 6x48 reaches them.
  private releaseSupport(c: CastInProgress): void {
    const name = `${TECH_NAMES[c.tech]} Lv${c.level + 1}`;
    const power = supportPower(c.level);
    const group = BUFF_GROUP[c.tech];
    if (group === GROUP.shifta || group === GROUP.deband) {
      this.applySelfBuff(group, power, name);
      return;
    }
    if (group === GROUP.jellen || group === GROUP.zalure) {
      const hits = c.targets.filter((e) => !e.dead && this.enemies.has(e.index));
      for (const e of hits) this.buffEnemy(e, group, power, name, true);
      if (!hits.length) this.opts.log(`${name}: no target`);
      return;
    }
    if (c.tech === TECH.anti) {
      this.applyAnti(c.level, name);
      return;
    }
    if (c.tech === TECH.reverser) {
      // The target revives on its own client (its copy of this object).
      const t = c.sent[0];
      this.opts.log(t === undefined ? `${name}: no dead party member in range` : `${name}: reviving player ${t}`);
    }
  }

  // entity_hit_by_tech(shifta / deband) on the local player.
  private applySelfBuff(group: BuffGroup, power: number, what: string): void {
    const before = { atp: this.selfBuffs.attack.mult, dfp: this.selfBuffs.defense.mult };
    const took = this.selfBuffs.apply(group, power);
    const slot = group === GROUP.shifta || group === GROUP.jellen ? this.selfBuffs.attack : this.selfBuffs.defense;
    if (!took) {
      this.opts.log(`${what}: a stronger ${buffName(slot.type)} holds (${pct(group === GROUP.shifta ? before.atp : before.dfp)})`);
      return;
    }
    const st = this.selfStats();
    const stat = group === GROUP.shifta || group === GROUP.jellen ? `ATP ${st.atp} -> ${this.selfBuffs.atp(st.atp)}` : `DFP ${st.dfp} -> ${this.selfBuffs.dfp(st.dfp)}`;
    this.opts.log(`${what}: ${buffName(group)} ${pct(slot.mult)} for ${(slot.frames / GAME_TICKS_PER_SECOND).toFixed(0)} s (${stat})`);
  }

  // entity_hit_by_tech(jellen / zalure) on an enemy; the caster's client
  // reports it with 6x0A (vtable +0x130, 0x00787578: unchanged total damage).
  private buffEnemy(e: EnemyRuntime, group: BuffGroup, power: number, what: string, own: boolean): void {
    if (!e.buffs.apply(group, power)) return;
    const slot = group === GROUP.jellen ? e.buffs.attack : e.buffs.defense;
    const stat =
      group === GROUP.jellen && e.attacker
        ? `ATP ${e.attacker.atp} -> ${e.buffs.atp(e.attacker.atp)}`
        : `DFP ${e.stats.dfp} -> ${e.buffs.dfp(e.stats.dfp)}`;
    if (own) this.game.sendEnemyState(e.index, e.stats.maxHp - e.stats.hp, ENEMY_BASE_FLAGS);
    this.opts.log(`${what}: E-${e.index.toString(16)} ${buffName(group)} ${pct(slot.mult)} for ${(slot.frames / GAME_TICKS_PER_SECOND).toFixed(0)} s (${stat})`);
  }

  // Player_ClearStatusEffect(level): the web client has no poison, paralysis,
  // shock, slow, confusion or freeze yet, so only the Jellen / Zalure part
  // (level >= 5) has something to clear.
  private applyAnti(level: number, what: string): void {
    const cures = antiCures(level);
    const cleared = level >= 5 && this.selfBuffs.clearDebuffs();
    this.opts.log(`${what}: cures ${cures.join(', ')}${cleared ? ' (Jellen / Zalure cleared)' : ''}; no other status effects exist yet`);
  }

  // entity_hit_by_tech on an enemy (combat/techniques.ts).
  private techHitEnemy(tech: number, level: number, mst: number, charClass: number, e: EnemyRuntime): void {
    const name = TECH_NAMES[tech];
    if (tech === TECH.megid) {
      // Instant death with chance (power - EDK) * 0.01 (no boss-map check:
      // ASSUMED the floor is not a boss map).
      const chance = megidChance(level, e.resist.edk);
      const kill = this.rng() < chance;
      this.applyEnemyHit(e, ENEMY_BASE_FLAGS, kill ? e.stats.hp : 0, false, `${name} (${Math.round(chance * 100)}%) `);
      return;
    }
    const damage = techDamage(tech, level, mst, charClass, e.resist);
    this.applyEnemyHit(e, ENEMY_BASE_FLAGS, damage, false, `${name} (power ${Math.round(techPower(tech, level, charClass))}) `);
  }

  // Another player's 6x48: its technique object on this client hits the
  // 6x47 targets (action_launch_tech -> unknown_cast_tech). Only the local
  // player and the enemies are tracked here, so the effects that land on them
  // are applied: Shifta / Deband / Anti from level 3 / 2 (the caster-only
  // levels hit nobody else), Jellen / Zalure on the listed enemies, Reverser
  // on a dead local player.
  private remoteSupport(clientId: number, tech: number, sentLevel: number): void {
    const cast = this.remoteCasts.get(clientId);
    if (!cast || cast.tech !== tech) return;
    const level = remoteTechLevel(sentLevel, this.techOverride.get(clientId) ?? 0);
    const name = `player ${clientId}'s ${TECH_NAMES[tech]} Lv${level + 1}`;
    const self = this.game.selfId;
    const onMe = cast.targets.includes(self);
    const group = BUFF_GROUP[tech];
    if ((group === GROUP.shifta || group === GROUP.deband) && onMe && level >= 2) {
      this.applySelfBuff(group, supportPower(level), name);
    } else if (group === GROUP.jellen || group === GROUP.zalure) {
      for (const id of cast.targets) {
        const e = id >= 0x1000 ? this.enemies.get(id - 0x1000) : undefined;
        if (e && !e.dead) this.buffEnemy(e, group, supportPower(level), name, false);
      }
    } else if (tech === TECH.anti && onMe && level >= 1) {
      this.applyAnti(level, name);
    } else if (tech === TECH.reverser && onMe && this.damage.dead) {
      // PlayerResetDeadState_0068fdc8: max HP / 2 on a field.
      this.damage.revive(reverserHp(this.damage.maxHp));
      this.opts.log(`${name}: revived`);
    }
  }

  private tickTechHits(): void {
    if (!this.techHits.length) return;
    const due = this.techHits.filter((h) => --h.ticks < 0);
    this.techHits = this.techHits.filter((h) => h.ticks >= 0);
    for (const h of due) h.apply();
  }

  // Another player's 6x47: its cast motion (action_cast_tech enters input
  // state 8 the same way); its 6x48 shows the effect.
  private remoteCast(clientId: number, tech: number): void {
    const view = this.view;
    const p = this.game.players.get(clientId);
    if (!view || !p) return;
    const animator = view.playerAnimator(clientId);
    if (!animator) return;
    this.attacking.add(clientId);
    animator.paused = false;
    animator.play(castMotion(MOTION_TYPE[p.charClass] ?? 0, 0), 1);
    this.opts.log(`player ${clientId} casts ${TECH_NAMES[tech] ?? tech}`);
    const hook = () => {
      if (this.disposed || animator.ended) {
        this.viewer.frameHooks.delete(hook);
        this.attacking.delete(clientId);
        if (!this.disposed) view.resetGait(clientId);
      }
    };
    this.viewer.frameHooks.add(hook);
  }

  private attackerStats() {
    const me = this.game.self!;
    const disp = this.game.selfSnapshot.disp;
    const dv = new DataView(disp.buffer, disp.byteOffset, disp.byteLength);
    const stats = { atp: dv.getUint16(0, true), ata: dv.getUint16(0x0a, true), lck: dv.getUint16(0x0c, true) };
    const w = this.equippedWeapon();
    const pmtWeapon = w && this.pmtSync ? this.pmtSync.getWeapon(w.data1[1], w.data1[2]) : undefined;
    const a = playerAttacker(
      me.charClass,
      stats,
      pmtWeapon ? { atpMin: pmtWeapon.atpMin, atpMax: pmtWeapon.atpMax, grind: w!.data1[3], ata: pmtWeapon.ata } : null,
    );
    // Shifta / Jellen move ATP (+0x2cc) and its spread (+0x2ce); the
    // equipment ATP (+0x31c) is not touched.
    return { ...a, atp: this.selfBuffs.atp(a.atp), atpSpread: this.selfBuffs.atpSpread(a.atpSpread) };
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
    // handle_experience: the EXP number over the enemy, on the killer's screen.
    const amount = killExp(e.exp, { episode2: this.game.info?.episode === 2, killer: true, multiplier: this.expMultiplier });
    const anchor = e.instance.root.position.clone();
    anchor.y += 22;
    this.hud?.expPopup(amount, () => anchor);
    this.playDeath(e);
  }

  // --- level and EXP ---------------------------------------------------------

  private levelTable(): Promise<LevelTable | null> {
    this.levelTablePromise ??= (async () => {
      try {
        const data = (await this.files.has('PlyLevelTbl.prs')) ? await this.files.read('PlyLevelTbl.prs') : (await this.streamFiles()).get('PlyLevelTbl.prs');
        if (!data) throw new Error('PlyLevelTbl.prs missing from the stream file');
        return parsePlyLevelTbl(data);
      } catch (err) {
        this.opts.log(`combat: no level table (${(err as Error).message}); levels follow 6x30 only`);
        return null;
      }
    })();
    return this.levelTablePromise;
  }

  // The local player's level / EXP / stats out of the save data (disp +0x18
  // level, +0x1c exp, stats @0; inventory bytes 1 / 2 = HP / TP materials).
  private async ensureProgression(): Promise<PlayerProgression | null> {
    if (this.progression) return this.progression;
    const table = await this.levelTable();
    if (!table) return null;
    const disp = this.game.selfSnapshot.disp;
    const inv = this.game.selfSnapshot.inventory;
    const dv = new DataView(disp.buffer, disp.byteOffset, disp.byteLength);
    const st = this.selfStats();
    const me = this.game.self;
    this.progression ??= new PlayerProgression(table, {
      charClass: me?.charClass ?? this.opts.character?.()?.charClass ?? 0,
      level: dv.getUint32(0x18, true),
      exp: dv.getUint32(0x1c, true),
      stats: { atp: st.atp, mst: st.mst, evp: st.evp, hp: st.hp, dfp: st.dfp, ata: st.ata, lck: st.lck },
      hpMaterials: inv[1] ?? 0,
      tpMaterials: inv[2] ?? 0,
    });
    const p = this.progression;
    this.opts.log(`level ${p.level + 1}, ${p.exp} EXP (next level at ${p.nextExp ?? '-'}), ${p.maxHp} HP / ${p.maxTp} TP`);
    return p;
  }

  // Writes level / EXP / stats back to the game's snapshot (6x70 / 6x6D syncs
  // and the damage formulas read it) and to the session's character file.
  private storeProgression(): void {
    const p = this.progression;
    if (!p) return;
    const write = (buf: Uint8Array | null | undefined, base: number) => {
      if (!buf || buf.length < base + 0x24) return;
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const st = p.stats;
      [st.atp, st.mst, st.evp, st.hp, st.dfp, st.ata, st.lck].forEach((v, i) => dv.setUint16(base + i * 2, v & 0xffff, true));
      dv.setUint32(base + 0x18, p.level, true);
      dv.setUint32(base + 0x1c, p.exp, true);
    };
    write(this.game.selfSnapshot.disp, 0);
    write(this.opts.fullCharacter?.(), 0x34c);
    const c = this.opts.character?.();
    if (c) {
      c.level = p.level + 1;
      c.exp = p.exp;
      Object.assign(c.stats, p.stats);
    }
    const me = this.game.self;
    if (me) me.level = p.level + 1;
  }

  // 6xBF for the local player: add_to_player_exp_and_clamp.
  private onGiveExp(amount: number): void {
    const p = this.progression;
    if (!p) return;
    p.addExp(amount);
    this.storeProgression();
    this.opts.log(`+${amount} EXP: ${p.exp} (${p.nextExp === null ? 'max level' : `${p.toNext} to level ${p.level + 2}`})`);
  }

  // 6x30 (UpdatePlayerStatsAndLevelMessage_006928e4).
  private onChangeLevel(c: ChangeLevel): void {
    const view = this.view;
    const head = (clientId: number) => () => {
      const pos = view?.playerPositions().get(clientId);
      if (!pos) return null;
      pos.y += view?.playerHeight(clientId) ?? 18;
      return pos;
    };
    if (c.clientId !== this.game.selfId) {
      const other = this.game.players.get(c.clientId);
      if (other) other.level = c.level + 1;
      this.hud?.levelUpPopup(head(c.clientId), c.levelDown);
      return;
    }
    const p = this.progression;
    if (p) {
      // HandleInvincibilityAndEquipmentReset_00692c14: level up from the
      // table and show the gains.
      const r = p.levelUp(c.level, this.equippedWeaponMinAta());
      if (r) this.hud?.message(levelUpLines(r));
      this.storeProgression();
      this.damage.maxHp = p.maxHp;
      this.opts.log(`level up: level ${p.level + 1}, ${p.maxHp} HP / ${p.maxTp} TP, next level at ${p.nextExp ?? '-'} EXP`);
    }
    // On a field floor HP and TP are refilled (unknown_set_total_stats, then
    // hp = max_hp1, tp2 = max_tp2).
    if (!this.damage.dead) this.damage.hp = this.damage.maxHp;
    this.tp = p?.maxTp ?? this.tp;
    this.hud?.levelUpPopup(head(c.clientId), c.levelDown);
    this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
    this.sePlayer?.play(SE_LEVEL_UP);
  }

  // The equipped weapon's ItemPMT min ATA (the ATA the level-up message
  // compares, BlendSinowberillChallengeState_00698088).
  private equippedWeaponMinAta(): number {
    const w = this.equippedWeapon();
    if (!w || !this.pmtSync) return 0;
    return this.pmtSync.getWeapon(w.data1[1], w.data1[2])?.ata ?? 0;
  }

  // --- remote players and enemies -------------------------------------------

  private onSubcommand(sub: number, clientId: number, body: Uint8Array): void {
    if (this.disposed) return;
    if (sub === 0xbf) {
      const g = parseGiveExp(body);
      if (g && g.clientId === this.game.selfId) this.onGiveExp(g.amount);
      return;
    }
    if (sub === 0x30) {
      const c = parseChangeLevel(body);
      if (c) this.onChangeLevel(c);
      return;
    }
    if (sub === 0xdd) {
      const m = parseExpMultiplier(body);
      if (m !== null) this.expMultiplier = Math.max(1, m);
      return;
    }
    if (sub === 0x8d) {
      const o = parseTechLevelOverride(body);
      if (o) this.techOverride.set(o.clientId, o.extra);
      return;
    }
    if (sub === SUB_CAST_TECHNIQUE) {
      const t = parseCastTechnique(body);
      if (t) this.remoteCasts.set(t.clientId, { tech: t.tech, targets: t.targets });
      if (t && t.clientId !== this.game.selfId) this.remoteCast(t.clientId, t.tech);
      return;
    }
    if (sub === SUB_CAST_TECHNIQUE_COMPLETE) {
      const t = parseCastTechniqueComplete(body);
      if (!t || t.clientId === this.game.selfId) return;
      const pos = this.view?.playerPositions().get(t.clientId);
      const el = techElement(t.tech);
      if (pos) this.overlay?.techEffect(el ?? (t.tech === TECH.resta ? 'resta' : 'support'), pos.x, pos.y, pos.z, 20);
      if (el === null) this.remoteSupport(t.clientId, t.tech, t.level);
      return;
    }
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
    // Another player taking damage / dying / being revived: its hit and death
    // motions (combat/playerdamage.ts documents the commands).
    if (sub === 0x4a || sub === 0x4b || sub === 0x4c) {
      if (clientId === this.game.selfId) return;
      const kind: HitMotionKind = sub === 0x4a ? 'guard' : sub === 0x4c ? 'heavy' : 'light';
      const h = sub === 0x4a ? null : parseHitByEnemy(body);
      if (h && sub === 0x4c) this.view?.setPlayerAngle(clientId, h.angle);
      this.playRemoteMotion(clientId, kind, sub === 0x4c ? 40 : 20);
      return;
    }
    if (sub === 0x4d) {
      const d = parsePlayerDeath(body);
      if (!d || d.clientId === this.game.selfId) return;
      this.playRemoteMotion(d.clientId, 'death', 0);
      this.deadPlayers.add(d.clientId);
      this.opts.log(`player ${d.clientId} died (6x4D flags 0x${d.deathFlags.toString(16)})`);
      return;
    }
    if (sub === 0x4f) {
      if (clientId === this.game.selfId) return;
      this.deadPlayers.delete(clientId);
      this.playRemoteMotion(clientId, 'revive', 40);
      return;
    }
    if (sub === 0x5f) this.opts.log(`item dropped (6x5F, ${body.length} bytes)`);
  }

  // Plays a hit / death / revive motion on a remote player and keeps its gait
  // suppressed for `ticks` ticks (0 = until it is revived).
  private playRemoteMotion(clientId: number, kind: HitMotionKind, ticks: number): void {
    const view = this.view;
    const p = this.game.players.get(clientId);
    if (!view || !p) return;
    const animator = view.playerAnimator(clientId);
    if (!animator) return;
    this.hurt.add(clientId);
    animator.paused = false;
    animator.play(hitMotion(MOTION_TYPE[p.charClass] ?? 0, 0, kind), 1);
    if (!ticks) return;
    let left = ticks;
    const hook = (dt: number) => {
      left -= dt * GAME_TICKS_PER_SECOND;
      if (this.disposed || left <= 0) {
        this.viewer.frameHooks.delete(hook);
        this.hurt.delete(clientId);
        view.resetGait(clientId);
      }
    };
    this.viewer.frameHooks.add(hook);
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
    e.ai?.kill();
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
    this.overlay?.dispose();
    this.overlay = null;
    this.hpReadout?.remove();
    this.hpReadout = null;
    this.hud?.dispose();
    this.hud = null;
  }
}
