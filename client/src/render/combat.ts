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
  type EnemyAiProfile,
  type EnemyBrain,
} from '../combat/enemyai.ts';
import {
  LilyAi,
  LilySpit,
  MONEST,
  MonestSpawner,
  MOTHMANT_FLY_HEIGHT,
  MOTHMANT_PROFILE,
  RappyFakeDeath,
  WolfAi,
} from '../combat/enemyfsm.ts';
import { GrassAi, NanoDragonAi } from '../combat/enemyfsmcaves.ts';
import { CanadineAi, CananeAi, DubchicAi, GaranzAi, SinowAi } from '../combat/enemyfsmmines.ts';
import { BelraAi, BringerAi, BulclawAi, ClawAi, delLilyMegid, DelsaberAi, GunnerAi, GunnerControl, SorcererAi, type BulclawEvent } from '../combat/enemyfsmruins.ts';
import type { EnemyShot } from '../combat/enemyshots.ts';
import * as THREE from 'three';
import { enemyCombatMotions, type EnemyCombatMotions } from '../combat/enemymotions.ts';
import { hitMotion, PlayerDamage, type HitMotionKind } from '../combat/playerdamage.ts';
import {
  applyDamage,
  enemyDefender,
  FLAG_DEAD,
  playerAttacker,
  FLAG_BIG_HIT,
  FLAG_HIT,
  FLAG_MISSED,
  hitChanceWith,
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
  techHitPower,
  techPower,
  type TechniqueData,
  type TechResist,
} from '../combat/techniques.ts';
import { antiCures, EntityBuffs, GROUP, remoteTechLevel, reverserHp, statusIcon, supportPower, type BuffGroup } from '../combat/buffs.ts';
import { meleeHitStatus, PlayerStatus, STATUS, STATUS_NAME, type StatusType } from '../combat/status.ts';
import { EnemyStatus, enemyAttribute, techFreezeChance, techShockChance } from '../combat/enemystatus.ts';
import {
  canUseSpecialAttack,
  resolveSpecial,
  retriesOnMiss,
  SPECIAL,
  SPECIAL_TYPE_NAMES,
  UNTEKKED_SPECIAL_ACCURACY,
  weaponSpecialByte,
} from '../combat/specials.ts';
import { BOSS_AREAS } from '../net/telepipe.ts';
import { PB_INVULN_FRAMES, PB_MAX_TARGETS, PB_NAMES, PB_RANGE, pbDamage, pbGain, pbPower, PhotonBlastGauge } from '../combat/photonblast.ts';
import { photonBlasts } from '../net/magfeed.ts';
import { isAndroid } from '../combat/progression.ts';
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
  parseEnemyStatusUltimate,
  parseExpMultiplier,
  parseGiveExp,
  parseHitByEnemy,
  parsePlayerDeath,
  parseStatusEffect,
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
import { LevelUpEffects } from './levelupfx.ts';
import { WindowAnim } from '../classic/windowanim.ts';
import { PartyHp, syncHp } from '../combat/partyhp.ts';
import type { PartyValues } from '../classic/hud.ts';
import type { EnemyInstance, EnemyLayer } from './enemyview.ts';
import type { PillarTrap, TrapEvent } from './traps.ts';
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
  ai: EnemyBrain | null; // combat/enemyai.ts or combat/enemyfsm.ts (null: no AI)
  lift: number; // height above the ground (a leaping wolf, a flying Mothmant)
  monest: MonestSpawner | null; // a Monest's Mothmant spawning
  parent: EnemyRuntime | null; // a Mothmant's Monest
  fake: RappyFakeDeath | null; // a dead Rappy getting up and running off
  ringSpawned?: boolean; // a Canane spawned its ring
  attacker: AttackerStats | null; // this enemy hitting a player
  attack: EnemyAttackData | null;
  exp: number; // BattleParamEntry exp of the enemy's stats row
  resist: TechResist; // ResistData efr / eic / eth / elt / edk
  buffs: EntityBuffs; // Jellen / Zalure (combat/buffs.ts)
  status: EnemyStatus; // paralysis / freeze / shock / confusion (combat/enemystatus.ts)
  esp: number; // BattleParamEntry esp (the specials' status resistance)
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

// Client classes whose behaviour is a per-family FSM without a generic AI
// profile (combat/enemyfsmcaves.ts, combat/enemyfsmmines.ts).
const OWN_FSM = new Set([
  'TObjEneNanoDrago',
  'TObjEneDubchik',
  'TObjEneGyaranzo',
  'TObjEneMe3ShinowaReal',
  'TObjEneMe1Canadin',
  'TObjEneMe1CanadinLeader',
  // Ruins (combat/enemyfsmruins.ts).
  'TObjEneBalClawBody',
  'TObjEneBalClawClaw',
  'TObjEneRe7Berura',
  'TObjEneDarkGunner',
  'TObjEneDf2Bringer',
  'TObjEneRe4Sorcerer',
  'TObjEneSaver',
]);

// Classes whose own target search honours confusion: the Booma handlers
// (unknown_booma_enemy_find_target 0x0052b888: Booma, Shark, Dimenian,
// Rappy, Hildebear-family vtables), EnemyUpdateTarget_0052ccd8's callers
// (Bulclaw / Claw) and the Delsaber (unknown_delsaber_targeting_related).
// The Poison Lily has no confused branch; the Dark Belra spins and throws
// instead (combat/enemyfsmruins.ts BelraAi).
const CONFUSION_AWARE = new Set(['TObjEneBeast', 'TObjEneShark', 'TObjEneDimedian', 'TObjEneLappy', 'TObjEneMoja', 'TObjEneBalClawBody', 'TObjEneBalClawClaw', 'TObjEneSaver']);
// A Bulclaw's child slots (newserv: 4 CLAW children).
const BULCLAW_CLAWS = 4;

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
  // DisplayLevelUpMessage_00692aa4's particle and light (render/levelupfx.ts).
  private levelUpFx: LevelUpEffects | null = null;
  // Ryuker's pipe (render/telepipe.ts): whether one can be opened here
  // (SinowberillChallengePlayer_IsTelepipeEnabled_0068bfa0) and opening it.
  telepipe: { allowed: () => boolean; open: () => boolean } | null = null;
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
  // The other players' HP for the party members' windows (combat/partyhp.ts).
  readonly party = new PartyHp();
  private partyOwners = new Map<number, number>();
  // Remote players lying dead (6x4D .. 6x4F): Reverser targets.
  private deadPlayers = new Set<number>();
  // Poison / paralysis / freeze / shock / slow / confusion on the local
  // player (combat/status.ts).
  readonly status: PlayerStatus;
  // The MAG's photon blast gauge (combat/photonblast.ts).
  readonly pb = new PhotonBlastGauge();

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
    this.status = new PlayerStatus({
      sendAdd: (type) => this.game.sendAddStatus(type),
      sendRemove: (slot) => this.game.sendRemoveStatus(slot),
      poisonDamage: (amount) => {
        if (amount < 1) return;
        this.damage.hp = Math.max(1, this.damage.hp - amount);
        this.opts.log(`poison: -${amount} HP (${this.damage.hp}/${this.damage.maxHp})`);
      },
      pulse: () => {},
      log: (msg) => this.opts.log(msg),
    });
    game.on('subcommand', (sub, clientId, body) => this.onSubcommand(sub, clientId, body));
    game.on('serverText', (text) => {
      if (!this.disposed) this.hud?.notice(text);
    });
  }

  // A status effect on the local player (an enemy attack's vtable +0xb8 ..
  // +0xcc entry, or a test hook).
  inflictStatus(type: StatusType, what = ''): boolean {
    if (this.damage.dead) return false;
    this.status.android = isAndroid(this.game.self?.charClass ?? 0);
    const took = this.status.inflict(type);
    if (took) {
      this.opts.log(`${what}${what ? ': ' : ''}${STATUS_NAME[type]}`);
      if (this.status.immobile) this.view?.resetGait(this.game.selfId);
    }
    return took;
  }

  // True while that player is in an attack, hit or death motion (LobbyView must
  // not play a gait motion over it, and the local player must not move).
  isAttacking = (clientId: number): boolean =>
    this.attacking.has(clientId) || this.hurt.has(clientId) || (clientId === this.game.selfId && (this.damage.busy || this.status.immobile || this.holdTicks > 0));

  attach(view: LobbyView): void {
    this.view = view;
    this.overlay ??= new CombatOverlay(this.viewer.scene);
    this.hpReadout ??= this.makeHpReadout();
    if (!this.hud) {
      this.hud = new PlayerHud(this.viewer, this.files);
      this.hud.log = this.opts.log;
    }
    // PSOBBCharacterFile option_flags (+0x4ec): the window speed.
    const full = this.opts.fullCharacter?.();
    this.hud.windowSpeed = WindowAnim.speedOf(full && full.length >= 0x4f0 ? new DataView(full.buffer, full.byteOffset).getUint32(0x4ec, true) : undefined);
    this.levelUpFx ??= new LevelUpEffects(this.viewer, this.files, {
      position: (id) => this.view?.playerPositions().get(id) ?? null,
      litMaterials: (id) => this.view?.playerLitMaterials(id) ?? [],
      primary: () => ({ diffuse: this.viewer.directionalLight.intensity / Math.PI, ambient: this.viewer.ambientLight.intensity / Math.PI }),
      log: this.opts.log,
    });
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
      let esp = 0;
      let resist: TechResist = { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };
      if (params && def && def.stats.length) {
        const s = params.stats(difficulty, def.stats[0]);
        exp = s.exp;
        esp = s.esp;
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
      let ai: EnemyBrain | null = null;
      let monest: MonestSpawner | null = null;
      if (className === 'TObjEneBm3FlyNest') {
        // monest_constructor: initdata_param2 / initdata_param3.
        monest = new MonestSpawner(head.slot.set.params[1], head.slot.set.params[2]);
      }
      if (profile || OWN_FSM.has(className)) {
        // initdata_param6 (set entry params[5]) is the subtype, as
        // formats/enemymodels.ts reads it.
        const subtype = Math.max(0, Math.trunc(head.slot.set.params[5]));
        const cfg = aiConfig(className, subtype);
        const mi = params ? movementIndex(head.slot.type) : null;
        const radius = collisionRadius(className, subtype, ultimate);
        const entityId = 0x1000 | head.index;
        const at = { x: instance.placed.world[0], z: instance.placed.world[2], angle: instance.placed.yaw };
        const movement = params && mi !== null ? params.movement(difficulty, mi) : null;
        const setParams = head.slot.set.params;
        if (className === 'TObjEneRe2Flower') ai = new LilyAi({ ...at, attack, radius, rng: () => this.rng() });
        else if (className === 'TObjGrass') {
          // AttackData [0] slash, [1] web, [2] dash (g_EnemyAttackStats).
          const attacks = params && def ? def.attack.map((i) => params.attack(difficulty, i)) : [];
          // ASSUMED: the set entry's param1 / param2 are the fparam1 / fparam2
          // that 0x00786848 copies (the enrage fraction, the ambush run).
          ai = new GrassAi({ ...at, attacks, radius, fparam1: setParams[0], fparam2: setParams[1], rng: () => this.rng() });
        } else if (className === 'TObjEneNanoDrago') ai = new NanoDragonAi({ ...at, param2: setParams[1], movement, rng: () => this.rng() });
        else if (className === 'TObjEneDubchik')
          ai = new DubchicAi({ ...at, param1: setParams[0], gillchic: head.slot.type === 'GILLCHIC', ultimate, movement, attack, rng: () => this.rng() });
        else if (className === 'TObjEneGyaranzo') ai = new GaranzAi({ ...at, movement, rng: () => this.rng() });
        else if (className === 'TObjEneMe3ShinowaReal') {
          // The Sinow's MovementData rows are 6 (Beat) and 0x10 (Gold)
          // (0x00928b78), not its ResistData index.
          const gold = head.slot.type === 'SINOW_GOLD';
          const mv = params ? params.movement(difficulty, gold ? 0x10 : 6) : null;
          ai = new SinowAi({ ...at, gold, ultimate, movement: mv, attack, radius, rng: () => this.rng() });
        } else if (className === 'TObjEneMe1Canadin')
          // param1 (+0x35c): 0 in-fighter, else out-fighter (0x0053e858).
          ai = new CanadineAi({ ...at, kind: 'standalone', inFighter: setParams[0] === 0, movement, attack, radius, rng: () => this.rng() });
        else if (className === 'TObjEneMe1CanadinLeader') ai = new CananeAi({ ...at, movement, attack, radius, rng: () => this.rng() });
        else if (className === 'TObjEneBalClawBody') ai = new BulclawAi({ ...at, movement, attack, radius, phase: head.index, rng: () => this.rng() });
        else if (className === 'TObjEneBalClawClaw') ai = new ClawAi({ ...at, attack, radius, phase: head.index, rng: () => this.rng() });
        else if (className === 'TObjEneRe7Berura') ai = new BelraAi({ ...at, ultimate, attack, radius, rng: () => this.rng() });
        else if (className === 'TObjEneDarkGunner') ai = new GunnerAi({ ...at, movement, rng: () => this.rng() });
        else if (className === 'TObjEneDf2Bringer') ai = new BringerAi({ ...at, ultimate, movement, attack, radius, phase: head.index, rng: () => this.rng() });
        else if (className === 'TObjEneRe4Sorcerer')
          ai = new SorcererAi({ ...at, ultimate, episode2: this.game.info?.episode === 2, movement, rng: () => this.rng() });
        else if (className === 'TObjEneSaver') {
          // AttackData [0] combo, [1] jump, [2] slash (g_DelsaberAttackStatsArray).
          const attacks = params && def ? def.attack.map((i) => params.attack(difficulty, i)) : [attack];
          ai = new DelsaberAi({ ...at, param1: setParams[0], movement, attacks, phase: head.index, guardDrain: (id) => this.guardDrain(id, head.index), rng: () => this.rng() });
        }
        else if (className === 'TObjEneBm5Wolf') ai = new WolfAi({ ...at, detect: cfg.detect, turnRate: cfg.turnRate, attack, radius, entityId, rng: () => this.rng() });
        else if (profile) ai = new EnemyAi({
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
        // The Monest's own states are its spawner (combat/enemyfsm.ts).
        if (monest) ai = null;
        else withAi++;
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
        lift: 0,
        monest,
        parent: null,
        fake: null,
        attacker,
        attack,
        exp,
        resist,
        buffs: new EntityBuffs(),
        status: new EnemyStatus(enemyAttribute(head.slot.type)),
        esp,
      });
    }
    this.difficultyParams = { params, difficulty, slots, base };
    this.buildGunnerGroups(slots, base);
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
      const blocked = this.damage.busy || this.status.immobile;
      for (const [key, index] of PALETTE_KEYS) {
        const down = keys.has(key);
        if (down && !this.held.has(key) && !blocked) {
          const slot = this.opts.paletteSlot?.(index) ?? DEFAULT_SLOTS[index];
          if (slot && !slot.disabled && slot.group1 === 2 && slot.group2 <= 2) this.press(slot.group2 as AttackType);
          else if (slot && !slot.disabled && slot.group1 === 3) this.castTechnique(slot.group2);
          else if (slot && !slot.disabled && slot.group1 === 5) this.firePhotonBlast(slot.group2);
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
        if (ended && e.removeIn <= 0 && !e.fake && e.instance.spec.name === 'TObjEneLappy') {
          // update_rappy: a dead Rappy fakes it (combat/enemyfsm.ts).
          const ctx = this.difficultyParams;
          const mi = ctx?.params ? movementIndex(e.slot.type) : null;
          const speeds = enemySpeeds(ctx?.params && mi !== null ? ctx.params.movement(ctx.difficulty, mi) : null, 0.5);
          const p = e.instance.root.position;
          // The record's +4 speed is written at run time
          // (InitRappyGlobalConfig_00527973); ASSUMED the MovementData
          // engaged speed (fparam3; fparam1 = 8 would be 28 units a frame).
          e.fake = new RappyFakeDeath({ x: p.x, z: p.z, angle: e.instance.root.rotation.y, moveSpeed: speeds.engagedMove, rng: () => this.rng() });
          continue;
        }
        if (ended && e.removeIn <= 0 && !e.fake) {
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
      this.tickStatus();
      this.tickTechHits();
      this.tickBuffs();
    }
    this.updateLockOn();
    this.overlay?.update(dt);
    this.updateHpReadout();
    this.hud?.frame(dt, this.hudValues(), this.game.selfId, (slot) => this.partyValues(slot));
  }

  // What a party member's window shows (QuestListEntryUpdate_0073eb28,
  // QuickMenuClearSelection_00742430): nothing for an empty slot.
  private partyValues(slot: number): PartyValues | null {
    if (slot === this.game.selfId) return null;
    const p = this.game.players.get(slot);
    if (!p || p.npcTemplate !== undefined) return null;
    // A slot taken by a new player starts over.
    if (this.partyOwners.get(slot) !== p.guildCardNumber) {
      this.party.remove(slot);
      this.partyOwners.set(slot, p.guildCardNumber);
    }
    const m = this.party.get(slot) ?? this.party.stats(slot, this.partyStats(p));
    return { name: p.name, level: p.level, hp: m.hp, maxHp: m.maxHp, dead: m.dead || this.deadPlayers.has(slot), nameColor: p.nameColor };
  }

  private partyStats(p: { charClass: number; level: number; hpStat?: number; hpMaterials?: number }) {
    return { charClass: p.charClass, level: p.level, hpStat: p.hpStat ?? 0, hpMaterials: p.hpMaterials ?? 0 };
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
      pb: this.pb.charge,
      dead: this.damage.dead,
      nameColor: me?.nameColor,
      statusIcons: [...this.status.types().map(statusIcon), ...this.selfBuffs.icons()],
    };
  }

  // The status ticks of the local player (only on a field, like the player's
  // is_player_in_unsafe_map wrappers). ASSUMED: dying ends every effect.
  private tickStatus(): void {
    if (this.damage.dead) {
      if (this.status.flags) this.status.reset();
      return;
    }
    if (this.area === 0) return;
    this.status.tick(this.damage.hp, this.damage.dead, this.game.info?.difficulty ?? 0);
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

  // The attacker stats with another AttackData row of the enemy loaded
  // (set_enemy_stats_from_battleparams with that row: the Delsaber's jump /
  // slash, the Dark Belra's arm).
  private enemyAttackerRow(e: EnemyRuntime, row: number): AttackerStats | null {
    const ctx = this.difficultyParams;
    const def = ENEMY_TYPE_PARAMS[e.slot.type];
    const i = def?.attack[row];
    if (!ctx?.params || !def || i === undefined || !def.stats.length) return this.enemyAttackerOf(e);
    const a = enemyAttacker(ctx.params.stats(ctx.difficulty, def.stats[0]), ctx.params.attack(ctx.difficulty, i));
    return { ...a, atp: e.buffs.atp(a.atp), atpSpread: e.buffs.atpSpread(a.atpSpread) };
  }

  // An enemy's defender stats with its Zalure and the status slots' EVP
  // multipliers applied.
  // A shielded Dark Gunner's hit box damage_reduction (iparam3) comes off a
  // weapon hit's damage before the multiplier: the same as DFP + 5 * it.
  private enemyDefenderOf(e: EnemyRuntime): DefenderStats {
    const shield = e.ai instanceof GunnerAi && e.ai.shield ? e.ai.shieldPower / 0.2 : 0;
    return { ...e.stats, dfp: e.buffs.dfp(e.stats.dfp) + shield, evp: e.status.evp(e.stats.evp) };
  }

  private get ultimate(): boolean {
    return (this.game.info?.difficulty ?? 0) === 3;
  }

  // The enemy's 6x0A (send_packet0x60_subcommand0xa): its status bits ride in
  // the flags; in Ultimate they go out as a 6x9C first (combat/enemystatus.ts).
  private sendEnemy(e: EnemyRuntime, flags: number): void {
    const sync = e.status.syncBits(this.ultimate);
    if (sync.ultimateBits) this.game.sendEnemyStatusUltimate(e.index, sync.ultimateBits);
    this.game.sendEnemyState(e.index, e.stats.maxHp - e.stats.hp, flags | sync.flags);
  }

  // An effect landed on an enemy (vtable +0xbc / +0xc4 / +0xc8 / +0xcc).
  private inflictEnemy(e: EnemyRuntime, type: StatusType, what: string): boolean {
    if (e.dead || !e.status.inflict(type)) {
      this.opts.log(`${what}: E-${e.index.toString(16)} (${e.slot.type}) resists ${STATUS_NAME[type]}`);
      return false;
    }
    this.statusEffect(e, type);
    if (e.status.locked) this.lockEnemy(e, true);
    this.opts.log(`${what}: E-${e.index.toString(16)} (${e.slot.type}) ${STATUS_NAME[type]} (${e.status.describe()})`);
    return true;
  }

  // ASSUMED look: the client's particles (0x26 paralysis, 0x21 shock, 0x24
  // confusion) and the freeze's ice object are drawn as a tinted pulse.
  private statusEffect(e: EnemyRuntime, type: StatusType): void {
    const p = e.instance.root.position;
    const kind = type === STATUS.freeze ? 'ice' : type === STATUS.shock ? 'lightning' : type === STATUS.paralysis ? 'light' : 'dark';
    this.overlay?.techEffect(kind, p.x, p.y, p.z, 10);
  }

  // update_enemy_control_object returns before the AI while paralysis, shock
  // or freeze holds; ASSUMED the motion holds too.
  private lockEnemy(e: EnemyRuntime, locked: boolean): void {
    for (const a of e.instance.animators) a.paused = locked;
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
      const attacking = id === this.game.selfId ? !!this.attack?.active : this.attacking.has(id);
      out.push({ clientId: id, x: pos.x, z: pos.z, charClass: p.charClass, dead: false, angle: id === this.game.selfId ? (this.game.self?.angle ?? p.angle) : p.angle, attacking });
    }
    return out;
  }

  private tickEnemies(): void {
    const targets = this.aiTargets();
    for (const e of [...this.enemies.values()]) {
      if (e.dead || !e.instance.root.visible) continue;
      // The status block of update_enemy_control_object (combat/enemystatus.ts).
      if (e.status.flags) {
        const st = e.status.tick();
        for (const t of st.ended) this.opts.log(`${STATUS_NAME[t]} on E-${e.index.toString(16)} wore off`);
        if (st.pulse) this.statusEffect(e, st.pulse);
        this.lockEnemy(e, st.locked);
        if (st.locked) continue;
      }
      // An enemy whose wave has not spawned is not in the room yet.
      if (e.state !== 'idle') continue;
      const ended = e.instance.animators.length > 0 && e.instance.animators.every((a) => a.ended);
      if (e.monest) {
        this.tickMonest(e, targets, ended);
        continue;
      }
      const ai = e.ai;
      if (!ai) continue;
      if (ai instanceof LilyAi || ai instanceof GrassAi || ai instanceof NanoDragonAi || ai instanceof GaranzAi || ai instanceof BulclawAi || ai instanceof SorcererAi)
        ai.hpFraction = e.stats.hp / Math.max(1, e.stats.maxHp);
      // Confusion (entity+0x30 & 0x10): the families' target searches widen
      // to the other enemies (combat/enemyai.ts EnemyAi.confused,
      // combat/enemyfsmruins.ts updateTarget).
      const confused = e.status.has(STATUS.confusion);
      if ('confused' in ai) ai.confused = confused;
      if (ai instanceof GunnerAi) ai.frozenOrParalysed = e.status.has(STATUS.freeze) || e.status.has(STATUS.paralysis);
      if (ai instanceof BulclawAi) ai.candidates = this.clawsNear(e);
      const r = ai.tick(confused && CONFUSION_AWARE.has(e.instance.spec.name) ? [...targets, ...this.enemyTargets(e)] : targets, ended);
      const root = e.instance.root;
      const lift = r.lift ?? e.lift;
      if (r.x !== root.position.x || r.z !== root.position.z || lift !== e.lift) {
        const y = this.opts.ground?.(r.x, r.z, root.position.y - e.lift + 30) ?? null;
        root.position.set(r.x, (y ?? root.position.y - e.lift) + lift, r.z);
        e.lift = lift;
      }
      root.rotation.y = r.angle;
      if (r.motion) this.playEnemyMotion(e, r.motion);
      if (r.hit && r.hit.clientId >= 0x1000) this.enemyHitsEnemy(e, r.hit.clientId & 0xfff, r.hit.knockback, r.hit.mult);
      else if (r.hit) this.enemyHitsPlayer(e, r.hit.clientId, r.hit.knockback, r.hit.mult, r.hit.kbScale, r.hit.attack);
      if (r.shots) for (const s of r.shots) this.launchShot(e, s);
      if (r.techHit && r.techHit.clientId === this.game.selfId) {
        const what = `E-${e.index.toString(16)} (${e.slot.type})`;
        const p = e.instance.root.position;
        this.enemyTechHitsPlayer(e, r.techHit.power, p.x, p.z, what);
        if (r.techHit.status && this.rng() <= r.techHit.status.chance) this.inflictStatus(r.techHit.status.type as StatusType, what);
      }
      if (r.tpDrain) this.drainTp(e, ai, r.tpDrain);
      if (r.heal) this.enemyResta(e, r.heal.level);
      if (ai instanceof BulclawAi) for (const ev of ai.events.splice(0)) this.bulclawEvent(e, ai, ev);
      if (ai instanceof BulclawAi && !ai.bulk && this.bulclawPending.delete(e)) void this.swapBulclawModel(e, ai);
      if (r.hidden !== undefined) for (const c of root.children) c.visible = !r.hidden;
      if (ai instanceof CananeAi && !e.ringSpawned) {
        e.ringSpawned = true;
        for (let i = 0; i < 8; i++) void this.spawnRingCanadine(e, ai, i);
      }
      if (ai instanceof CanadineAi && ai.state === 'gone') this.removeQuietly(e, ai);
      if (r.hold && r.hold.clientId === this.game.selfId) this.imposeHold(r.hold, `E-${e.index.toString(16)} (${e.slot.type})`);
      if (r.status && r.status.clientId === this.game.selfId) {
        this.inflictStatus(r.status.type as StatusType, `E-${e.index.toString(16)} (${e.slot.type})`);
      }
      if (r.projectile && ai instanceof LilyAi) this.launchSpit(e, ai, r.projectile.x, r.projectile.z, r.projectile.angle);
    }
    this.tickSpits(targets);
    this.tickShots(targets);
    this.tickFakeDeaths(targets);
    this.tickRevives();
    this.tickGunnerControls(targets);
    if (this.holdTicks > 0 && --this.holdTicks === 0) this.opts.log('hold released');
  }

  // --- Caves / Mines FSM projectiles (combat/enemyshots.ts) -------------------

  private shots: Array<{ shot: EnemyShot; owner: EnemyRuntime; baseY: number; mesh: THREE.Mesh | null }> = [];

  // ASSUMED look: a coloured ball per shot (the client's own effects and
  // models are not drawn).
  private launchShot(e: EnemyRuntime, shot: EnemyShot): void {
    let mesh: THREE.Mesh | null = null;
    try {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(shot.look.size, 8, 6), new THREE.MeshBasicMaterial({ color: shot.look.color }));
      this.viewer.scene.add(mesh);
    } catch {
      mesh = null;
    }
    const baseY = e.instance.root.position.y - e.lift;
    mesh?.position.set(shot.x, baseY + shot.y, shot.z);
    this.shots.push({ shot, owner: e, baseY, mesh });
  }

  private tickShots(targets: AiTarget[]): void {
    for (const s of this.shots) {
      const hits = s.shot.tick(targets);
      s.mesh?.position.set(s.shot.x, s.baseY + s.shot.y, s.shot.z);
      for (const hit of hits) {
        if (hit.clientId !== this.game.selfId) continue; // each client resolves its own player
        const fx = s.shot.effect;
        const what = `E-${s.owner.index.toString(16)} (${s.owner.slot.type})`;
        if (fx.kind === 'tech') this.enemyTechHitsPlayer(s.owner, fx.power, s.shot.x, s.shot.z, what, fx.knockback ?? 0);
        else if (fx.kind === 'melee') {
          this.enemyHitsPlayer(s.owner, hit.clientId, fx.knockback, fx.mult, undefined, fx.attack);
          if (fx.status && this.rng() < fx.status.chance) this.inflictStatus(fx.status.type as StatusType, what);
        } else if (fx.kind === 'megid') this.enemyMegidHitsPlayer(fx.power, what);
        else this.inflictStatus(fx.status as StatusType, what);
      }
    }
    for (const s of this.shots.filter((x) => x.shot.done)) {
      s.mesh?.removeFromParent();
      s.mesh?.geometry.dispose();
      (s.mesh?.material as THREE.Material | undefined)?.dispose();
    }
    this.shots = this.shots.filter((x) => !x.shot.done);
  }

  // entity_hit_by_tech (0x00773afc) with group 0 on the local player: an
  // enemy attacker's base is its MST * 0.5 (0x00978278) + power, and case 0
  // (jump table 0x00977ea0 -> 0x00774cc7) multiplies it by 0.2 (0x00978250),
  // truncated; no resistance, no evasion roll.
  // ASSUMED: knockback 0 (try_knockdown_player's threshold was not traced).
  private enemyTechHitsPlayer(e: EnemyRuntime, power: number, fromX: number, fromZ: number, what: string, knockback = 0): void {
    const view = this.view;
    if (!view || this.damage.dead) return;
    const me = view.playerPositions().get(this.game.selfId);
    const ctx = this.difficultyParams;
    const def = ENEMY_TYPE_PARAMS[e.slot.type];
    const mst = ctx?.params && def?.stats.length ? Math.max(0, ctx.params.stats(ctx.difficulty, def.stats[0]).mst) : 0;
    const damage = Math.trunc((mst * 0.5 + Math.max(0, power)) * Math.fround(0.2));
    const angle = me ? Math.atan2(me.x - fromX, me.z - fromZ) : 0;
    this.damage.hit(damage, angle, knockback, 0x1000 | e.index);
    if (damage >= 1) this.gainPb(damage, true);
    this.opts.log(`${what}: technique hit for ${damage}`);
  }

  // A pillar trap (render/traps.ts) acting on the local player.
  //   hold: TOTrapAncient02's 6x2C; release: its 6x2D when the hold time ends.
  //   tech: TOTrapAncient02R's technique (ProcessEnemyAttackState_0063b930).
  //     ASSUMED: it lands at once (the exe launches create_directed_foie_object
  //     / create_gifoie / unknown_create_sorc_tech / create_megid projectiles,
  //     Zonde hits directly) with the group-0 formula of enemyTechHitsPlayer
  //     with MST 0 and power techPower(tech, level) (Zonde: level * 20 + 240,
  //     0x00934144 / 0x00934148, through a vtable call not traced), and Megid
  //     with megidChance(level, 0).
  trapEvent(ev: TrapEvent, trap: PillarTrap): void {
    const what = `trap 0x${trap.type.toString(16)}`;
    if (ev.kind === 'hold') this.imposeHold({ ...ev, particle: 0 }, what);
    else if (ev.kind === 'release') {
      if (this.holdTicks > 0) this.game.sendReleaseHold();
      this.holdTicks = 0;
      this.opts.log(`${what}: hold released`);
    } else if (ev.kind === 'tech' && ev.clientId === this.game.selfId && !this.damage.dead) {
      if (ev.tech === 'megid') {
        this.enemyMegidHitsPlayer(Math.max(0, techPower(TECH.megid, ev.level)), what);
        return;
      }
      const power = ev.tech === 'zonde' ? ev.level * 20 + 240 : Math.max(0, techPower(TECH[ev.tech], ev.level));
      const damage = Math.trunc(power * Math.fround(0.2));
      const me = this.view?.playerPositions().get(this.game.selfId);
      const angle = me ? Math.atan2(me.x - trap.x, me.z - trap.z) : 0;
      this.damage.hit(damage, angle, 0, 0);
      if (damage >= 1) this.gainPb(damage, true);
      this.opts.log(`${what}: ${ev.tech} level ${ev.level + 1} hit for ${damage}`);
    }
  }

  // 6x2C on the local player (a Grass Assassin's web).
  private holdTicks = 0;
  private imposeHold(h: { frames: number; particle: number; x: number; z: number; radius2: number }, what: string): void {
    if (this.damage.dead) return;
    this.holdTicks = h.frames;
    this.game.sendImposeHold(h.frames, h.particle, h.x, h.z, h.radius2);
    this.view?.resetGait(this.game.selfId);
    this.opts.log(`${what}: web hold for ${h.frames} frames`);
  }

  // entity_hit_by_tech's Megid case on the local player (an enemy Megid:
  // the Chaos Sorcerer's in Ultimate, the Del Lily's): death when rand <
  // (power - EDK) * 0.01 (0x0097826c). ASSUMED: the player's EDK is 0 and the
  // tech-resist roll (get_player_tech_resist_chance) is left out.
  private enemyMegidHitsPlayer(power: number, what: string): void {
    if (this.damage.dead) return;
    const chance = power * 0.01;
    if (this.rng() < chance) {
      this.opts.log(`${what}: Megid (${Math.round(chance * 100)}%) killed you`);
      this.damage.hit(this.damage.hp, 0, 0, 0);
    } else this.opts.log(`${what}: Megid (${Math.round(chance * 100)}%) missed`);
  }

  // Classes whose own target search honours confusion: the Booma handlers
  // (0x0052b888: Booma, Shark, Dimenian, Rappy ...), EnemyUpdateTarget
  // _0052ccd8's callers (Bulclaw / Claw) and the Delsaber.
  // The others keep targeting players (the Poison Lily has no confused
  // branch; the Dark Belra spins and throws instead, BelraAi).

  // The other live enemies as targets of a confused one (ids 0x1000 | index).
  private enemyTargets(self: EnemyRuntime): AiTarget[] {
    const out: AiTarget[] = [];
    for (const o of this.enemies.values()) {
      if (o === self || o.dead || o.state === 'death' || !o.instance.root.visible || o.ai?.invulnerable) continue;
      const p = o.instance.root.position;
      out.push({ clientId: 0x1000 | o.index, x: p.x, z: p.z, charClass: -1, dead: false });
    }
    return out;
  }

  // A confused enemy's melee on another enemy: try_hit_entity (0x007732b8)
  // with the attacker's stats and the defender's (the hit roll ATA - EVP *
  // 0.2, the damage formula of formulas.ts); the defender's 6x0A goes out
  // like any hit. ASSUMED: every client resolves it (the 6x0A carries the
  // total, so the copies agree) and no EXP is credited.
  private enemyHitsEnemy(e: EnemyRuntime, index: number, _knockback: number, mult: number): void {
    const d = this.enemies.get(index);
    const attacker = this.enemyAttackerOf(e);
    if (!d || d.dead || !attacker) return;
    const defender = this.enemyDefenderOf(d);
    const chance = (attacker.ata - defender.evp * 0.2) * 0.01;
    const damage = chance > 0 && this.rng() <= chance ? rollDamage(attacker, defender, 0, this.rng, mult).damage : 0;
    this.opts.log(`confused E-${e.index.toString(16)} (${e.slot.type}) hits E-${index.toString(16)} (${d.slot.type})`);
    this.applyEnemyHit(d, ENEMY_BASE_FLAGS, damage, false, `E-${e.index.toString(16)}: `, false);
  }

  // The Delsaber's guard drain for a player's attack: (ATP + spread + the
  // weapon's ATP - its own DFP) * 0.2. ASSUMED: a remote player's stats are
  // not known, so only the local player's swing drains it.
  private guardDrain(clientId: number, index: number): number {
    if (clientId !== this.game.selfId || !this.game.self) return 0;
    const a = this.attackerStats();
    const e = this.enemies.get(index);
    return Math.max(0, (a.atp + a.atpSpread + a.equipAtp - (e?.stats.dfp ?? 0)) * 0.2);
  }

  // The Chaos Bringer's TP drain (frame 12 of row 9): floor(TP * 0.25) from
  // the local player when in sight (the ray is not reproduced).
  private drainTp(e: EnemyRuntime, ai: EnemyBrain, fraction: number): void {
    if (this.damage.dead) return;
    const lost = Math.floor(this.tp * fraction);
    this.tp = Math.max(0, this.tp - lost);
    ai.drained?.(lost);
    this.opts.log(`E-${e.index.toString(16)} (${e.slot.type}) drains ${lost} TP`);
  }

  // The Chaos Sorcerer's Resta (CreateSpecialAttackEntity_006eeeb4) on
  // itself. ASSUMED: the player Resta's heal, MST * 0.5 + power.
  private enemyResta(e: EnemyRuntime, level: number): void {
    const ctx = this.difficultyParams;
    const def = ENEMY_TYPE_PARAMS[e.slot.type];
    const mst = ctx?.params && def?.stats.length ? Math.max(0, ctx.params.stats(ctx.difficulty, def.stats[0]).mst) : 0;
    const heal = Math.round(mst * 0.5 + techPower(TECH.resta, level));
    e.stats.hp = Math.min(e.stats.maxHp, e.stats.hp + heal);
    this.sendEnemy(e, ENEMY_BASE_FLAGS);
    this.opts.log(`E-${e.index.toString(16)} (${e.slot.type}) casts Resta: +${heal} HP (${e.stats.hp}/${e.stats.maxHp})`);
  }

  // --- Bulclaw / Bulk / Claw (combat/enemyfsmruins.ts) ------------------------

  // Live, not absorbed Claws of the body's section (state 10 scans every rt
  // 0x26 entity of the room).
  private clawsNear(body: EnemyRuntime): ClawAi[] {
    const section = (body.slot.set as EnemySet).section;
    const out: ClawAi[] = [];
    for (const o of this.enemies.values()) {
      // A Claw whose wave has not spawned does not exist yet.
      if (o.dead || !(o.ai instanceof ClawAi) || o.ai.absorbed || !o.instance.root.visible) continue;
      if ((o.slot.set as EnemySet).section !== section) continue;
      out.push(o.ai);
    }
    return out;
  }

  private runtimeOf(ai: EnemyBrain): EnemyRuntime | null {
    for (const o of this.enemies.values()) if (o.ai === ai) return o;
    return null;
  }

  private bulclawEvent(e: EnemyRuntime, ai: BulclawAi, ev: BulclawEvent): void {
    const what = `E-${e.index.toString(16)} (${e.slot.type})`;
    if (ev.kind === 'split') {
      if (ev.first) {
        // The first split: hp / (4 + 1) and the 4 Claws in the child slots.
        e.stats.hp = Math.max(1, Math.trunc(e.stats.hp / (BULCLAW_CLAWS + 1)));
        this.sendEnemy(e, ENEMY_BASE_FLAGS);
        for (let i = 0; i < BULCLAW_CLAWS; i++) void this.spawnClaw(e, ai, i);
        void this.swapBulclawModel(e, ai);
        this.opts.log(`${what} splits: Bulk with ${e.stats.hp} HP and its Claws`);
        return;
      }
      void this.swapBulclawModel(e, ai);
      const back = ai.claws.filter((c) => c.absorbed);
      const share = Math.max(1, Math.trunc(e.stats.hp / (back.length + 1)));
      e.stats.hp = share;
      this.sendEnemy(e, ENEMY_BASE_FLAGS);
      back.forEach((c, i) => {
        const at = ai.ringSlot(i);
        c.redeploy(at.x, at.z, at.angle);
        const rt = this.runtimeOf(c);
        if (rt) {
          rt.stats.hp = Math.min(rt.stats.maxHp, share);
          this.sendEnemy(rt, ENEMY_BASE_FLAGS);
        }
      });
      ai.claws = [];
      this.opts.log(`${what} splits again: ${back.length} Claws, ${share} HP each`);
    } else if (ev.kind === 'absorb') {
      let gained = 0;
      for (const c of ev.claws) {
        const rt = this.runtimeOf(c);
        if (!rt) continue;
        gained += rt.stats.hp;
        if (this.lockOn === rt) this.lockOn = null;
      }
      // No clamp: the absorbed Claws' HP adds to the body's.
      e.stats.hp += gained;
      e.stats.maxHp = Math.max(e.stats.maxHp, e.stats.hp);
      this.sendEnemy(e, ENEMY_BASE_FLAGS);
      this.bulclawPending.add(e);
      this.opts.log(`${what} absorbs ${ev.claws.length} Claws (+${gained} HP): Bulclaw again`);
    } else {
      // The self-destruct: the Bulk sets its own dead flag. ASSUMED: no drop
      // and no EXP (nobody killed it).
      e.dead = true;
      ai.kill();
      this.sendEnemy(e, ENEMY_BASE_FLAGS | FLAG_DEAD);
      const m = ai.deathMotion;
      this.playMotion(e, m.index, m.speed, false);
      e.state = 'death';
      e.removeIn = 1;
      this.opts.log(`${what} self-destructs`);
    }
  }

  // ClawAction(form) also sets +0x370, the model index: form 0 (Bulk) draws
  // model 0 (re6_b_bal_body, motions 0..5), form 1 (Bulclaw) model 1
  // (re6_b_bcbody, motions 6..9). The instance is rebuilt with that model.
  private bulclawPending = new Set<EnemyRuntime>();
  private async swapBulclawModel(e: EnemyRuntime, ai: BulclawAi): Promise<void> {
    const old = e.instance;
    const p = old.root.position;
    const model = ai.bulk ? 0 : 1;
    const m = ai.motion ?? (ai.bulk ? { index: 5, speed: 0.8, loop: true } : { index: 9, speed: 0.8, loop: true });
    const placed = { ...old.placed, world: [p.x, p.y - e.lift, p.z] as [number, number, number], yaw: old.root.rotation.y };
    const spec = { ...old.spec, parts: [{ model, motion: m }] };
    const instance = await this.layer.spawn(placed as typeof old.placed, spec as typeof old.spec);
    if (!instance || this.disposed || e.instance !== old) {
      if (instance) this.layer.remove(instance);
      return;
    }
    instance.root.position.copy(old.root.position);
    instance.root.rotation.y = old.root.rotation.y;
    instance.root.visible = old.root.visible;
    e.instance = instance;
    this.layer.remove(old);
  }

  // BulclawCreateClawEntity_00535554: Claw i in the body's child slot
  // (index + 1 + i), on the ring of 13.
  private async spawnClaw(body: EnemyRuntime, bai: BulclawAi, i: number): Promise<void> {
    const index = body.index + 1 + i;
    const ctx = this.difficultyParams;
    const slot = ctx?.slots[index - ctx.base];
    if (!ctx || !slot || slot.type !== 'CLAW' || this.enemies.has(index)) {
      this.opts.log(`Bulclaw E-${body.index.toString(16)}: no CLAW slot for child ${i}`);
      return;
    }
    const at = bai.ringSlot(i);
    const bp = body.instance.root.position;
    const placed = {
      ...body.instance.placed,
      entity: { ...(body.instance.placed.entity as EnemySet), index: -1 - index },
      world: [at.x, bp.y, at.z] as [number, number, number],
      yaw: at.angle,
      name: 'Claw',
    };
    const spec = { ...body.instance.spec, name: 'TObjEneBalClawClaw', parts: [{ model: 2, motion: { index: 15, speed: 1, loop: true } }] };
    const instance = await this.layer.spawn(placed as typeof body.instance.placed, spec as typeof body.instance.spec);
    if (!instance || this.disposed) return;
    const fight = this.childFightStats('CLAW');
    const ai = new ClawAi({ x: at.x, z: at.z, angle: at.angle, attack: fight.attack, radius: collisionRadius('TObjEneBalClawClaw'), phase: index, appear: true, rng: () => this.rng() });
    bai.claws[i] = ai;
    this.enemies.set(index, {
      instance,
      index,
      slot,
      ...fight,
      motions: enemyCombatMotions('TObjEneBalClawClaw', instance.archive),
      rtIndex: ENEMY_TYPE_PARAMS.CLAW?.rt ?? 0xff,
      dead: false,
      state: 'idle',
      removeIn: 0,
      ai,
      lift: 0,
      monest: null,
      parent: body,
      fake: null,
      buffs: new EntityBuffs(),
      status: new EnemyStatus(enemyAttribute('CLAW')),
    });
  }

  // --- Dark Gunner control objects (combat/enemyfsmruins.ts GunnerControl) ----

  private gunnerGroups: Array<{ control: GunnerControl; key: number; section: number; members: EnemyRuntime[] }> = [];

  // Each DARK_GUNNER_CONTROL slot (no model, so no instance) leads the
  // gunners with its param1 and section, ordered by param2.
  private buildGunnerGroups(slots: EnemySlot[], base: number): void {
    this.gunnerGroups = [];
    slots.forEach((slot, i) => {
      if (slot.type !== 'DARK_GUNNER_CONTROL' || slot.child !== 0) return;
      const set = slot.set as EnemySet;
      const members = [...this.enemies.values()]
        .filter((g) => g.ai instanceof GunnerAi && (g.slot.set as EnemySet).params[0] === set.params[0] && (g.slot.set as EnemySet).section === set.section)
        .sort((a, b) => (a.slot.set as EnemySet).params[1] - (b.slot.set as EnemySet).params[1]);
      if (!members.length) return;
      // ASSUMED: the control's own position is the middle of its gunners
      // (its set entry's room transform is not applied here).
      const cx = members.reduce((t, g) => t + g.instance.root.position.x, 0) / members.length;
      const cz = members.reduce((t, g) => t + g.instance.root.position.z, 0) / members.length;
      this.gunnerGroups.push({ control: new GunnerControl(cx, cz, base + i), key: set.params[0], section: set.section, members });
    });
    if (this.gunnerGroups.length) this.opts.log(`${this.gunnerGroups.length} Dark Gunner control group(s)`);
  }

  private tickGunnerControls(targets: AiTarget[]): void {
    for (const g of this.gunnerGroups) {
      // Gunners whose wave has not spawned do not exist yet; the control waits.
      if (g.members.some((m) => !m.dead) && !g.members.some((m) => !m.dead && m.instance.root.visible)) continue;
      const live = g.members.filter((m) => !m.dead && m.instance.root.visible && m.ai instanceof GunnerAi).map((m) => m.ai as GunnerAi);
      const before = live.map((a) => a.death);
      g.control.tick(live, targets);
      live.forEach((a, i) => {
        if (a.death && !before[i]) {
          const rt = g.members.find((m) => m.ai === a);
          if (rt) this.opts.log(`E-${rt.index.toString(16)} is the Death Gunner`);
        }
      });
    }
    this.gunnerGroups = this.gunnerGroups.filter((g) => !g.control.gone);
  }

  // A Dubchic getting up again (DubchicAi.revive).
  private tickRevives(): void {
    for (const e of this.enemies.values()) {
      if (!(e.ai instanceof DubchicAi) || e.ai.state !== 'down' || e.dead) continue;
      if (e.state === 'death' && e.instance.animators.every((a) => a.ended)) e.state = 'idle';
    }
  }

  // --- per-family behaviour (combat/enemyfsm.ts) -----------------------------

  private spits: Array<{ spit: LilySpit; owner: LilyAi; baseY: number; mesh: THREE.Mesh | null }> = [];

  // LilySpawnMegidProjectile_00529e68. ASSUMED look: a small green ball (the
  // client draws g_pLilyMegidProjectileBmlData).
  private launchSpit(e: EnemyRuntime, owner: LilyAi, x: number, z: number, angle: number): void {
    // 0x00528c38: a Del Lily (+0x3cc & 0x800, built on the tower map) and
    // every Lily in Ultimate cast create_megid1 instead, at
    // constrain_tech_level(MovementData iparam1).
    if (e.slot.type === 'DEL_LILY' || this.ultimate) {
      const ctx = this.difficultyParams;
      const mi = ctx?.params ? movementIndex(e.slot.type) : null;
      const iparam1 = ctx?.params && mi !== null ? ctx.params.movement(ctx.difficulty, mi).iparam[0] : 0;
      this.launchShot(e, delLilyMegid(x, z, angle, iparam1, this.ultimate));
      this.opts.log(`E-${e.index.toString(16)} (${e.slot.type}) casts Megid`);
      return;
    }
    const spit = new LilySpit(x, z, angle);
    let mesh: THREE.Mesh | null = null;
    try {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9be04a }));
      this.viewer.scene.add(mesh);
    } catch {
      mesh = null;
    }
    const baseY = e.instance.root.position.y;
    this.spits.push({ spit, owner, baseY, mesh });
    mesh?.position.set(x, baseY + spit.height, z);
    this.opts.log(`E-${e.index.toString(16)} (${e.slot.type}) spits`);
  }

  private tickSpits(targets: AiTarget[]): void {
    for (const s of this.spits) {
      const hit = s.spit.tick(targets);
      s.mesh?.position.set(s.spit.x, s.baseY + s.spit.height, s.spit.z);
      if (hit) {
        s.owner.spitLanded();
        // {group 0x0f, 2.0}: poison on the player it hit (each client
        // resolves hits on its own player).
        if (hit.clientId === this.game.selfId) this.inflictStatus(STATUS.poison, 'Poison Lily spit');
      }
    }
    for (const s of this.spits.filter((x) => x.spit.done)) {
      s.mesh?.removeFromParent();
      s.mesh?.geometry.dispose();
      (s.mesh?.material as THREE.Material | undefined)?.dispose();
    }
    this.spits = this.spits.filter((x) => !x.spit.done);
  }

  // spawn_mothmant_from_monest: the Monest's next MOTHMANT slot.
  private tickMonest(e: EnemyRuntime, targets: AiTarget[], ended: boolean): void {
    const m = e.monest!;
    const alive = [...this.enemies.values()].filter((c) => c.parent === e && !c.dead).length;
    const p = e.instance.root.position;
    const near = targets.some((t) => !t.dead && (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < 225 * 225);
    const r = m.tick(alive, near, ended);
    if (r.motion) this.playEnemyMotion(e, r.motion);
    if (r.spawn) void this.spawnMothmant(e, m.spawned - 1);
  }

  private async spawnMothmant(monest: EnemyRuntime, n: number): Promise<void> {
    const index = monest.index + 1 + n;
    const ctx = this.difficultyParams;
    const slot = ctx?.slots[index - ctx.base];
    if (!ctx || !slot || slot.type !== 'MOTHMANT' || this.enemies.has(index)) {
      this.opts.log(`Monest E-${monest.index.toString(16)}: no MOTHMANT slot for child ${n}`);
      return;
    }
    const mp = monest.instance.root.position;
    const placed = {
      ...monest.instance.placed,
      entity: { ...(monest.instance.placed.entity as EnemySet), index: -1 - index },
      world: [mp.x, mp.y + MONEST.height, mp.z] as [number, number, number],
      name: 'Mothmant',
    };
    const spec = { ...monest.instance.spec, name: 'TObjEneBm3Fly', parts: [{ model: 0, motion: { index: 10, speed: 0.6, loop: true } }] };
    const instance = await this.layer.spawn(placed as typeof monest.instance.placed, spec as typeof monest.instance.spec);
    if (!instance || this.disposed) return;
    const def = ENEMY_TYPE_PARAMS.MOTHMANT;
    const { params, difficulty } = ctx;
    let stats: DefenderStats = { hp: 1, maxHp: 1, evp: 0, dfp: 0 };
    let attack: EnemyAttackData | null = null;
    let attacker: AttackerStats | null = null;
    let exp = 0;
    let esp = 0;
    let resist: TechResist = { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };
    if (params && def && def.stats.length) {
      const st = params.stats(difficulty, def.stats[0]);
      esp = st.esp;
      const rs = params.resist(difficulty, def.resist[0] ?? def.stats[0]);
      stats = enemyDefender(st, rs);
      resist = { efr: rs.efr, eic: rs.eic, eth: rs.eth, elt: rs.elt, edk: rs.edk };
      attack = params.attack(difficulty, def.attack[0] ?? def.stats[0]);
      attacker = enemyAttacker(st, attack);
      exp = st.exp;
    }
    const mi = params ? movementIndex('MOTHMANT') : null;
    const ai = new EnemyAi({
      x: mp.x,
      z: mp.z,
      angle: monest.instance.root.rotation.y,
      profile: MOTHMANT_PROFILE as unknown as EnemyAiProfile,
      detect: 225,
      turnRate: 1536,
      attack,
      speeds: enemySpeeds(params && mi !== null ? params.movement(difficulty, mi) : null, 0.5),
      radius: collisionRadius('TObjEneBm3Fly'),
    });
    const runtime: EnemyRuntime = {
      instance,
      index,
      slot,
      stats,
      motions: enemyCombatMotions('TObjEneBm3Fly', instance.archive),
      rtIndex: def?.rt ?? 0xff,
      dead: false,
      state: 'idle',
      removeIn: 0,
      ai,
      lift: MONEST.height,
      monest: null,
      parent: monest,
      fake: null,
      attacker,
      attack,
      exp,
      resist,
      buffs: new EntityBuffs(),
      status: new EnemyStatus(enemyAttribute('MOTHMANT')),
      esp,
    };
    this.enemies.set(index, runtime);
    // It sinks to its flying height (ASSUMED) as it starts to move.
    runtime.lift = MONEST.height;
    const ground = this.opts.ground?.(mp.x, mp.z, mp.y + 30) ?? mp.y;
    instance.root.position.y = ground + MOTHMANT_FLY_HEIGHT;
    runtime.lift = MOTHMANT_FLY_HEIGHT;
    this.opts.log(`Monest E-${monest.index.toString(16)} spawned Mothmant E-${index.toString(16)} (${n + 1}/${monest.monest?.total ?? 0})`);
  }

  // A Canadine leaving without a kill (state 11 / after its self-destruct):
  // no 6x76, no EXP. ASSUMED: it just disappears.
  private removeQuietly(e: EnemyRuntime, ai: CanadineAi): void {
    e.dead = true;
    ai.kill();
    this.layer.remove(e.instance);
    this.enemies.delete(e.index);
    if (this.lockOn === e) this.lockOn = null;
    if (e.parent?.ai instanceof CananeAi) e.parent.ai.childGone();
    this.opts.log(`E-${e.index.toString(16)} (${e.slot.type}) left`);
  }

  // 0x00541188: the Canane's ring Canadine i in its CANADINE_GROUP slot
  // (Canane + 1 + i), 40 around it.
  private async spawnRingCanadine(leader: EnemyRuntime, lai: CananeAi, i: number): Promise<void> {
    const index = leader.index + 1 + i;
    const ctx = this.difficultyParams;
    const slot = ctx?.slots[index - ctx.base];
    if (!ctx || !slot || slot.type !== 'CANADINE_GROUP' || this.enemies.has(index)) {
      this.opts.log(`Canane E-${leader.index.toString(16)}: no CANADINE_GROUP slot for child ${i}`);
      return;
    }
    const at = lai.ringSlot(i);
    const lp = leader.instance.root.position;
    const placed = {
      ...leader.instance.placed,
      entity: { ...(leader.instance.placed.entity as EnemySet), index: -1 - index },
      world: [at.x, lp.y, at.z] as [number, number, number],
      name: 'Canadine',
    };
    // Model 0 with model 1's texture list, like a standalone Canadine.
    const spec = { ...leader.instance.spec, name: 'TObjEneMe1Canadin', parts: [{ model: 0, texlistOf: 1, motion: { index: 4, speed: 0.2, loop: true } }] };
    const instance = await this.layer.spawn(placed as typeof leader.instance.placed, spec as typeof leader.instance.spec);
    if (!instance || this.disposed) return;
    const { params, difficulty } = ctx;
    const mi = params ? movementIndex('CANADINE_GROUP') : null;
    const fight = this.childFightStats('CANADINE_GROUP');
    const ai = new CanadineAi({
      x: at.x,
      z: at.z,
      angle: lai.angle,
      kind: 'ring',
      inFighter: at.inFighter,
      movement: params && mi !== null ? params.movement(difficulty, mi) : null,
      attack: fight.attack,
      radius: collisionRadius('TObjEneMe1Canadin'),
      rng: () => this.rng(),
    });
    lai.children[i] = ai;
    this.enemies.set(index, {
      instance,
      index,
      slot,
      ...fight,
      motions: enemyCombatMotions('TObjEneMe1Canadin', instance.archive),
      rtIndex: ENEMY_TYPE_PARAMS.CANADINE_GROUP?.rt ?? 0xff,
      dead: false,
      state: 'idle',
      removeIn: 0,
      ai,
      lift: 0,
      monest: null,
      parent: leader,
      fake: null,
      buffs: new EntityBuffs(),
      status: new EnemyStatus(enemyAttribute('CANADINE_GROUP')),
    });
  }

  // BattleParamEntry rows of a spawned child type.
  private childFightStats(type: string) {
    const ctx = this.difficultyParams;
    const def = ENEMY_TYPE_PARAMS[type];
    let stats: DefenderStats = { hp: 1, maxHp: 1, evp: 0, dfp: 0 };
    let attack: EnemyAttackData | null = null;
    let attacker: AttackerStats | null = null;
    let exp = 0;
    let esp = 0;
    let resist: TechResist = { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };
    if (ctx?.params && def && def.stats.length) {
      const { params, difficulty } = ctx;
      const st = params.stats(difficulty, def.stats[0]);
      esp = st.esp;
      const rs = params.resist(difficulty, def.resist[0] ?? def.stats[0]);
      stats = enemyDefender(st, rs);
      resist = { efr: rs.efr, eic: rs.eic, eth: rs.eth, elt: rs.elt, edk: rs.edk };
      attack = params.attack(difficulty, def.attack[0] ?? def.stats[0]);
      attacker = enemyAttacker(st, attack);
      exp = st.exp;
    }
    return { stats, attack, attacker, exp, esp, resist };
  }

  // The Rag Rappy family's fake death (RappyFakeDeath): after the death
  // motion the Rappy lies there, gets up and runs off.
  private tickFakeDeaths(targets: AiTarget[]): void {
    for (const [index, e] of [...this.enemies]) {
      const f = e.fake;
      if (!f) continue;
      const ended = e.instance.animators.length > 0 && e.instance.animators.every((a) => a.ended);
      const m = f.tick(targets, ended);
      // Table 0x009bbc20: animation 9 (motion 7) then 4 (motion 3, the run);
      // their speeds are written at run time (ASSUMED 1.0).
      if (m === 'getup') this.playEnemyMotion(e, { index: 7, speed: 1, loop: false });
      if (m === 'run') this.playEnemyMotion(e, { index: 3, speed: 1, loop: true });
      const root = e.instance.root;
      root.rotation.y = f.angle;
      if (f.phase === 'flee') {
        const y = this.opts.ground?.(f.x, f.z, root.position.y + 30) ?? null;
        // Deleted when the next step finds no ground; ASSUMED also after 600
        // frames of running.
        if (y === null || f.frames > 900 + 600) {
          f.phase = 'gone';
          this.layer.remove(e.instance);
          this.enemies.delete(index);
          this.opts.log(`E-${index.toString(16)} (${e.slot.type}) ran off`);
          continue;
        }
        root.position.set(f.x, y, f.z);
      }
    }
  }

  // enterFloor's battle params and slots (spawned Mothmants need them).
  private difficultyParams: { params: BattleParams | null; difficulty: number; slots: EnemySlot[]; base: number } | null = null;

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
  private enemyHitsPlayer(e: EnemyRuntime, clientId: number, knockback: number, mult: number, kbScale?: number, attackRow?: number): void {
    if (clientId !== this.game.selfId) return; // other clients resolve their own hits
    const view = this.view;
    const attacker = attackRow ? this.enemyAttackerRow(e, attackRow) : this.enemyAttackerOf(e);
    if (!view || !attacker) return;
    const from = view.playerPositions().get(clientId);
    const p = e.instance.root.position;
    const stats = this.selfStats();
    // Deband / Zalure move the player's DFP (+0x2d2); a freeze lowers EVP.
    const defender: DefenderStats = { hp: this.damage.hp, maxHp: this.damage.maxHp, evp: this.status.evp(stats.evp), dfp: this.selfBuffs.dfp(stats.dfp) };
    // The generic hit check has no attack-type or combo multiplier for an
    // enemy's melee: accuracy 1.0.
    const chance = (attacker.ata - defender.evp * 0.2) * 0.01;
    let total = 0;
    let landed = false;
    if (chance > 0 && this.rng() <= chance) {
      landed = true;
      total = rollDamage(attacker, defender, 0, this.rng, mult).damage;
    }
    const angle = from ? Math.atan2(from.x - p.x, from.z - p.z) : 0;
    // cause_knockback(kbScale * the damage try_hit_entity returned).
    this.damage.hit(total, angle, kbScale !== undefined ? kbScale * total : knockback, 0x1000 | e.index);
    if (landed && total >= 1) this.gainPb(total, true);
    if (landed) e.ai?.landed?.(total);
    // The Ultimate wolves' and Mothmants' status rolls (combat/status.ts).
    const status = landed ? meleeHitStatus(e.slot.type, (this.game.info?.difficulty ?? 0) === 3, this.rng()) : null;
    if (status !== null) this.inflictStatus(status, `E-${e.index.toString(16)} (${e.slot.type})`);
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
      if (e.dead || !e.instance.root.visible || (e.ai instanceof ClawAi && e.ai.hidden)) continue;
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
    // is_player_allowed_to_attack: no attack while paralyzed or shocked
    // (character flags & 0x20006).
    if (!this.status.canAttack) return;
    // CheckPlayerAttackPermission_006994d4: the special attack needs a weapon
    // with a special.
    if (type === 2 && !canUseSpecialAttack(this.equippedWeapon()?.data1 ?? null)) {
      this.opts.log('special attack: the weapon has no special');
      return;
    }
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
        // apply_slow_status_effect_to_attack_speed: the frame step * 0.5.
        animator.play(motion, factor * this.status.motionScale);
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

  // Equipped weapon of the local player (first equipped 00xxxx item): the
  // session's character file, which net/items.ts keeps in step with equips,
  // else the join snapshot.
  private equippedWeapon(): { data1: Uint8Array } | null {
    const char = this.opts.character?.();
    if (char) {
      const w = char.inventory.find((i) => (i.flags & 8) !== 0 && i.data.data1[0] === 0);
      return w ? { data1: Uint8Array.from(w.data.data1) } : null;
    }
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
      if (attackType === 2) {
        this.specialHit(e, attacker, step);
        continue;
      }
      let damage = 0;
      let critical = false;
      const defender = this.enemyDefenderOf(e);
      if (rollHit(attacker, defender, attackType, step, this.rng)) {
        const r = rollDamage(attacker, defender, attackType, this.rng);
        damage = r.damage;
        critical = r.critical;
      }
      this.applyEnemyHit(e, ENEMY_BASE_FLAGS, damage, critical, '');
      if (damage >= 1) this.gainPb(damage, false);
    }
  }

  // The special attack on one target (unknown_melee_attack_2 with attack type
  // 2 and HandleSpecialAttack, combat/specials.ts).
  private specialHit(e: EnemyRuntime, attacker: AttackerStats, step: number): void {
    const me = this.game.self;
    const w = this.equippedWeapon();
    if (!me || !w) return;
    const sp = weaponSpecialByte(w.data1);
    const pmtSpecial = this.pmtSync?.specials[sp.index];
    const type = pmtSpecial?.type ?? 0;
    const power = pmtSpecial?.amount ?? 0;
    const name = `${SPECIAL_TYPE_NAMES[type] ?? 'special'} (special ${sp.index}, power ${power})`;
    // The hit check: 0.5 * combo step, or 0.1 for an unidentified weapon.
    const comboAcc = [1.0, 1.3, 1.69][Math.min(2, step)] ?? 1;
    const acc = sp.untekked ? UNTEKKED_SPECIAL_ACCURACY : 0.5 * comboAcc;
    const p0 = hitChanceWith(attacker, this.enemyDefenderOf(e), acc);
    if (!(p0 > 0 && this.rng() <= p0)) {
      // A miss: some types roll a second, plain strike.
      const p1 = hitChanceWith(attacker, this.enemyDefenderOf(e), 0.5 * comboAcc);
      if (retriesOnMiss(type) && p1 > 0 && this.rng() <= p1) {
        const r = rollDamage(attacker, this.enemyDefenderOf(e), 2, this.rng);
        this.applyEnemyHit(e, ENEMY_BASE_FLAGS, r.damage, r.critical, `${name} missed, plain strike: `);
        if (r.damage >= 1) this.gainPb(r.damage, false);
      } else {
        this.applyEnemyHit(e, ENEMY_BASE_FLAGS, 0, false, `${name} MISS: `);
      }
      return;
    }
    const char = this.opts.character?.() ?? null;
    const p = this.progression;
    const out = resolveSpecial(
      {
        type,
        power,
        weaponKind: w.data1[1],
        level: p ? p.level : Math.max(0, (me.level ?? 1) - 1),
        hp: this.damage.hp,
        tp: this.tp,
        maxTp: p?.maxTp ?? 0,
        meseta: char?.meseta ?? 0,
        android: isAndroid(me.charClass),
      },
      {
        hp: e.stats.hp,
        maxHp: e.stats.maxHp,
        esp: e.esp,
        efr: e.resist.efr,
        eth: e.resist.eth,
        edk: e.resist.edk,
        exp: e.exp,
        canTake: (t) => e.status.canTake(t),
      },
      { difficulty: this.game.info?.difficulty ?? 0, episode: this.game.info?.episode ?? 1, bossMap: BOSS_AREAS.includes(this.area), rng: this.rng },
    );
    const what = `${name}: ${out.note}: `;
    if (out.miss) {
      this.applyEnemyHit(e, ENEMY_BASE_FLAGS | (type === SPECIAL.charge ? FLAG_MISSED : 0), 0, false, `${name} MISS (${out.note}) `);
      return;
    }
    // The attacker's side: 6x9A for a steal, the cost of Charge / Spirit /
    // Berserk.
    if (out.heal) {
      this.game.sendEntityStat(out.heal.what === 'hp' ? 3 : 4, out.heal.amount);
      if (out.heal.what === 'hp') this.damage.hp = Math.min(this.damage.maxHp, this.damage.hp + out.heal.amount);
      else this.tp = Math.min(p?.maxTp ?? this.tp, this.tp + out.heal.amount);
    }
    if (out.cost?.what === 'meseta') {
      this.game.sendChargeAttack(out.cost.amount);
      if (char) char.meseta = Math.max(0, char.meseta - out.cost.amount);
    } else if (out.cost?.what === 'tp') {
      this.tp = Math.max(0, this.tp - out.cost.amount);
    } else if (out.cost?.what === 'hp') {
      this.damage.hp = Math.max(1, this.damage.hp - out.cost.amount);
      this.game.sendSetHp(this.damage.hp);
    }
    if (out.status !== null) this.inflictEnemy(e, out.status, name);
    let flags = ENEMY_BASE_FLAGS;
    let damage = 0;
    let critical = false;
    if (out.kill) {
      damage = e.stats.hp;
    } else if (out.hpDamage > 0) {
      damage = out.hpDamage;
      if (out.bigHit) flags |= FLAG_BIG_HIT;
    }
    if (out.strikeMult !== null) {
      const r = rollDamage(attacker, this.enemyDefenderOf(e), 2, this.rng, out.strikeMult);
      if (out.expSteal) {
        if (r.damage >= 1) this.game.sendStealExp(e.index);
        else out.note += ' (strike < 1: MISS)';
      }
      damage += r.damage >= 1 ? r.damage : 0;
      critical = r.critical;
    }
    if (damage >= 1) flags |= FLAG_HIT;
    this.applyEnemyHit(e, flags, damage, critical, what);
  }

  // --- photon blasts (combat/photonblast.ts) ---------------------------------

  // The local player's equipped MAG.
  private equippedMag(): { data1: Uint8Array; data2: Uint8Array; id: number } | null {
    const char = this.opts.character?.();
    const m = char?.inventory.find((i) => (i.flags & 8) !== 0 && i.data.data1[0] === 2);
    return m ? m.data : null;
  }

  // try_set_pb_charge: damage dealt or taken charges the gauge.
  private gainPb(damage: number, taken: boolean): void {
    if (this.damage.dead || this.area === 0 || !this.equippedMag()) return;
    const level = this.progression?.level ?? Math.max(0, (this.game.self?.level ?? 1) - 1);
    if (this.pb.add(pbGain(damage, level, taken)) === 'ready') {
      this.game.sendPhotonBlastReady(true);
      this.opts.log('photon blast ready (6x39)');
    }
  }

  // A palette slot with group 1 = 5: the MAG's blast in slot `slot` (0 center,
  // 1 right, 2 left; ASSUMED the palette's group 2 is that slot).
  firePhotonBlast(slot: number): boolean {
    const me = this.game.self;
    const view = this.view;
    if (!me || !view || this.area === 0) return false;
    // CanPlayerCastTechInCurrentState_0069a8c0.
    if (!this.status.canAttack || this.status.immobile || this.damage.busy || this.damage.dead) return false;
    if (!this.pb.ready || this.pb.firing || this.cast || this.attack?.active) {
      if (!this.pb.ready) this.opts.log(`photon blast: gauge ${Math.floor(this.pb.charge)}/100`);
      return false;
    }
    const mag = this.equippedMag();
    const type = mag ? photonBlasts(mag)[slot] : undefined;
    if (!mag || type === undefined) {
      this.opts.log(`photon blast: no blast in MAG slot ${slot}`);
      return false;
    }
    const from = view.playerPositions().get(me.clientId);
    if (!from) return false;
    // ASSUMED target list: the enemies within the table's 150 units.
    const targets =
      type <= 3
        ? [...this.enemies.values()]
            .filter((e) => !e.dead && e.instance.root.visible && e.instance.root.position.distanceTo(from) <= PB_RANGE)
            .sort((a, b) => a.instance.root.position.distanceToSquared(from) - b.instance.root.position.distanceToSquared(from))
            .slice(0, PB_MAX_TARGETS)
        : [];
    const gauge = this.pb.charge;
    this.game.sendPhotonBlast(slot, gauge, targets.map((e) => ({ entityId: 0x1000 | e.index })));
    this.pb.firing = true;
    this.damage.invuln = PB_INVULN_FRAMES;
    const animator = view.playerAnimator(me.clientId);
    if (animator) {
      animator.paused = false;
      animator.play(castMotion(MOTION_TYPE[me.charClass] ?? 0, this.weaponClass()), 1);
    }
    this.attacking.add(me.clientId);
    const name = PB_NAMES[type];
    this.opts.log(`photon blast ${name} (slot ${slot}, 6x49 with ${targets.length} target(s))`);
    // ASSUMED: the blast goes off one second later (the PB object counts its
    // own frames, UpdatePhotonBlastState_0067eed0).
    this.techHits.push({
      ticks: 30,
      apply: () => this.photonBlastEffect(type, gauge, targets),
    });
    return true;
  }

  private photonBlastEffect(type: number, gauge: number, targets: EnemyRuntime[]): void {
    const me = this.game.self;
    const mag = this.equippedMag();
    this.game.sendPhotonBlastDone(gauge);
    if (this.pb.spend() === 'notReady') this.game.sendPhotonBlastReady(false);
    this.pb.firing = false;
    if (me) {
      this.attacking.delete(me.clientId);
      this.view?.resetGait(me.clientId);
    }
    if (!me || !mag) return;
    const a = this.attackerStats();
    const s = this.selfStats();
    const power = pbPower(type, { atp: a.atp, equipAtp: a.equipAtp, evp: s.evp, ata: a.ata, synchro: mag.data2[0], iq: mag.data2[1] }, gauge, 1);
    const name = `${PB_NAMES[type]} (power ${power.toFixed(1)})`;
    const pos = this.view?.playerPositions().get(me.clientId);
    if (pos) this.overlay?.techEffect(type === 4 ? 'resta' : type === 5 ? 'support' : 'light', pos.x, pos.y, pos.z, type <= 3 ? PB_RANGE / 3 : 20);
    if (type <= 3) {
      for (const e of targets) {
        if (e.dead || !this.enemies.has(e.index)) continue;
        this.applyEnemyHit(e, ENEMY_BASE_FLAGS, pbDamage(power, e.resist.elt), false, `${name}: `);
      }
    } else if (type === 4) {
      // Group 6 (Resta) on the caster: HP + MST * 0.5 + power.
      const heal = Math.round(Math.max(0, s.mst) * 0.5 + power);
      this.damage.hp = Math.min(this.damage.maxHp, this.damage.hp + heal);
      this.opts.log(`${name}: +${heal} HP (${this.damage.hp}/${this.damage.maxHp})`);
    } else if (type === 5) {
      // Anti, Deband, Shifta with the blast's power (ASSUMED: Anti's level is
      // trunc(power)).
      this.applyAnti(Math.trunc(power), name);
      this.selfBuffs.apply(GROUP.deband, power);
      this.selfBuffs.apply(GROUP.shifta, power);
      this.opts.log(`${name}: Deband and Shifta`);
    }
  }

  // One damaged (or missed) enemy: 6x0A with the new total, the number over
  // it, its reaction, and the kill flow when it died. Shared by weapon hits
  // and techniques (entity_hit_by_tech ends in the same ApplyHitEffects).
  private applyEnemyHit(e: EnemyRuntime, baseFlags: number, damage: number, critical: boolean, what: string, byPlayer = true): void {
    const me = this.game.self;
    if (e.ai?.invulnerable) {
      // The invulnerable flag: entity_hit_by_tech / the weapon hit show the
      // "0" text and do nothing.
      this.opts.log(`${what}E-${e.index.toString(16)} (${e.slot.type}) is invulnerable`);
      return;
    }
    let flags = baseFlags | applyDamage(e.stats, damage);
    if (flags & FLAG_DEAD && e.ai instanceof DubchicAi && e.ai.revive()) {
      // State 5's revive branch: the Dubchic falls, lies there and gets up
      // with full HP; mark_enemy_as_dead (6x76, the drop and EXP requests)
      // only runs on its final death. ASSUMED: its 6x0A goes out without the
      // dead flag.
      flags &= ~FLAG_DEAD;
      this.sendEnemy(e, flags);
      e.stats.hp = e.stats.maxHp;
      if (e.motions.death) this.playMotion(e, e.motions.death.index, e.motions.death.speed, false);
      e.state = 'death';
      e.removeIn = Infinity;
      this.opts.log(`${what}E-${e.index.toString(16)} (${e.slot.type}) falls (death ${e.ai.deaths}), it will get up`);
      return;
    }
    this.sendEnemy(e, flags);
    // FUN_0078a5e8 shows round(d) of the hit box over the enemy.
    const p = e.instance.root.position;
    this.overlay?.damage(damage, critical, p.x, p.y + 26, p.z);
    // The enemy turns on its attacker (unknown_enemy_behavior_4).
    if (damage >= 1 && me && byPlayer) e.ai?.onDamage(me.clientId);
    // 0x0054615c: a hit on the Death Gunner while it shoots stuns its group.
    const groupStun = damage >= 1 && e.ai instanceof GunnerAi && e.ai.superArmor;
    if (groupStun) {
      const g = this.gunnerGroups.find((x) => x.members.includes(e));
      if (g) {
        g.control.stunGroup(g.members.filter((m) => !m.dead).map((m) => m.ai as GunnerAi));
        this.opts.log(`Death Gunner E-${e.index.toString(16)} hit while shooting: the group is stunned`);
      }
    }
    // A locked enemy skips its damage reaction (vtable +0x88 / +0x100).
    if (flags & FLAG_DEAD) this.killEnemy(e, flags);
    else if (damage >= 1 && !groupStun && !e.status.locked && !e.ai?.superArmor && (e.ai?.flinches?.(damage, e.stats.maxHp) ?? true)) this.playDamage(e);
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
    if (this.cast || this.attack?.active || this.damage.busy || this.damage.dead || this.status.immobile) return false;
    const level = this.techLevel(tech);
    if (level === null) {
      this.opts.log(`${name}: not learned`);
      return false;
    }
    if (tech === TECH.ryuker && !this.telepipe?.allowed()) {
      // CanPlayerCastTechnique_0069a0c4: Ryuker needs
      // SinowberillChallengePlayer_IsTelepipeEnabled_0068bfa0.
      this.opts.log(`${name}: no telepipe here`);
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
    if (c.tech === TECH.ryuker) {
      // unknown_cast_tech case ryuker: the caster's own client opens the pipe
      // (CreateChallengeObjectEntity_006e8478).
      const opened = this.telepipe?.open() ?? false;
      this.opts.log(`${name}: ${opened ? 'telepipe opened' : 'no new telepipe'}`);
      return;
    }
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
    if (own) this.sendEnemy(e, ENEMY_BASE_FLAGS);
    this.opts.log(`${what}: E-${e.index.toString(16)} ${buffName(group)} ${pct(slot.mult)} for ${(slot.frames / GAME_TICKS_PER_SECOND).toFixed(0)} s (${stat})`);
  }

  // Player_ClearStatusEffect(level): the status slots (combat/status.ts) and,
  // from level 5, Jellen / Zalure.
  private applyAnti(level: number, what: string): void {
    const cures = antiCures(level);
    const cleared = this.status.anti(level).map((t) => STATUS_NAME[t]);
    if (level >= 5 && this.selfBuffs.clearDebuffs()) cleared.push('Jellen / Zalure');
    this.status.sync();
    this.opts.log(`${what}: cures ${cures.join(', ')}; ${cleared.length ? `cleared ${cleared.join(', ')}` : 'nothing to clear'}`);
  }

  // Antidote / Antiparalysis (the tool's use entry calls vtable +0xdc / +0xe0).
  useCureItem(subtype: number): boolean {
    const type = subtype === 0 ? STATUS.poison : subtype === 1 ? STATUS.paralysis : null;
    if (type === null || !this.status.cure(type)) return false;
    this.status.sync();
    this.opts.log(`${subtype === 0 ? 'Antidote' : 'Antiparalysis'}: ${STATUS_NAME[type]} cured`);
    return true;
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
    // entity_hit_by_tech's status rolls after the damage (the local caster
    // rolls): Gibarta / Rabarta freeze, the Zonde family shock
    // (combat/enemystatus.ts).
    let status: StatusType | null = null;
    if (tech === TECH.gibarta || tech === TECH.rabarta) {
      const c = techFreezeChance(techHitPower(tech, level, mst, charClass), this.ultimate);
      if (this.rng() < c) status = STATUS.freeze;
    } else if (tech === TECH.zonde || tech === TECH.gizonde || tech === TECH.razonde) {
      if (this.rng() < techShockChance(this.ultimate)) status = STATUS.shock;
    }
    if (status !== null && !e.dead) this.inflictEnemy(e, status, name);
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
    // The form / leader decides the drop table: Bulclaw 0x28 / Bulk 0x27,
    // Dark Gunner 0x22 / Death Gunner 0x23 (newserv remaps them).
    if (e.ai instanceof BulclawAi || e.ai instanceof GunnerAi) e.rtIndex = e.ai.rtIndex;
    // A Bulclaw's death kills the Claws it absorbed (state 5).
    if (e.ai instanceof BulclawAi && !e.ai.bulk) {
      for (const c of e.ai.claws.filter((x) => x.absorbed)) {
        const rt = this.runtimeOf(c);
        if (!rt) continue;
        rt.dead = true;
        c.kill();
        this.sendEnemy(rt, ENEMY_BASE_FLAGS | FLAG_DEAD);
        this.layer.remove(rt.instance);
        this.enemies.delete(rt.index);
      }
    }
    // The Canane's death makes its ring self-destruct; a ring member's death
    // tells the Canane (0x00541c10).
    if (e.ai instanceof CananeAi) for (const c of e.ai.children) c.selfDestruct();
    if (e.ai instanceof CanadineAi && e.parent?.ai instanceof CananeAi) {
      e.ai.state = 'dead';
      e.parent.ai.childGone();
    }
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
      if (other) {
        other.level = c.level + 1;
        other.hpStat = c.hp;
        // The new stats, then hp = max_hp1 on a field.
        this.party.stats(c.clientId, this.partyStats(other));
        if (this.area !== 0) this.party.refill(c.clientId);
      }
      view?.refreshNameTag(c.clientId);
      this.displayLevelUp(c, head(c.clientId));
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
    view?.refreshNameTag(c.clientId);
    this.displayLevelUp(c, head(c.clientId));
  }

  // DisplayLevelUpMessage_00692aa4 (only on a field, is_player_in_unsafe_map):
  // SE 0x58d for the local player, the "Level Up" / "Level Down" text, the
  // particle 0x23 and the light (render/levelupfx.ts).
  private displayLevelUp(c: ChangeLevel, head: () => THREE.Vector3 | null): void {
    if (this.area === 0) return;
    if (c.clientId === this.game.selfId) {
      this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
      this.sePlayer?.play(SE_LEVEL_UP);
    }
    this.hud?.levelUpPopup(head, c.levelDown);
    void this.levelUpFx?.play(c.clientId);
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
    if (sub === 0x70) {
      const h = syncHp(body);
      const p = h && h.clientId !== this.game.selfId ? this.game.players.get(h.clientId) : undefined;
      if (h && p) this.party.stats(h.clientId, { ...this.partyStats(p), hpStat: h.hpStat, hpMaterials: h.hpMaterials, level: h.level }, h.hp);
      return;
    }
    // Remote HP for the party members' windows; the handlers below still run.
    this.party.receive(sub, body);
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
      // restore_enemy_status: the status bits that are new on this enemy.
      if (!(s.flags & FLAG_DEAD)) {
        for (const t of e.status.receiveFlags(s.flags, this.ultimate)) {
          this.statusEffect(e, t);
          this.opts.log(`E-${e.index.toString(16)} ${STATUS_NAME[t]} (6x0A from another client)`);
        }
        if (e.status.locked) this.lockEnemy(e, true);
      }
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
    if (sub === 0x9c) {
      const u = parseEnemyStatusUltimate(body);
      const e = u ? this.enemies.get(u.enemyIndex) : undefined;
      if (!u || !e || clientId === this.game.selfId) return;
      const t = e.status.receiveUltimate(u.bits, this.ultimate, e.dead);
      if (t !== null) {
        this.statusEffect(e, t);
        if (e.status.locked) this.lockEnemy(e, true);
        this.opts.log(`player ${clientId}: E-${e.index.toString(16)} ${STATUS_NAME[t]} (6x9C)`);
      }
      return;
    }
    if (sub === 0x0c || sub === 0x0d) {
      const st = parseStatusEffect(body);
      if (!st || st.clientId === this.game.selfId) return;
      this.opts.log(
        st.add
          ? `player ${st.clientId}: ${STATUS_NAME[st.value as StatusType] ?? `effect ${st.value}`} (6x0C)`
          : `player ${st.clientId}: status slot ${st.value} cleared (6x0D)`,
      );
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
    const m = e.ai?.flinchMotion ?? e.motions.damage;
    if (e.dead || !m) return;
    this.playMotion(e, m.index, m.speed, false);
    e.state = 'damage';
  }

  private playDeath(e: EnemyRuntime): void {
    e.state = 'death';
    e.removeIn = 0.5;
    const m = e.ai?.deathMotion ?? e.motions.death;
    e.ai?.kill();
    if (m) this.playMotion(e, m.index, m.speed, false);
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

  // The server's stream file (ItemPMT, ItemMagEdit, PlyLevelTbl, battle
  // params), fetched once per game.
  streamFiles(): Promise<Map<string, Uint8Array>> {
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
    this.levelUpFx?.dispose();
    this.levelUpFx = null;
    this.hud = null;
  }
}
