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

import { HOTBAR_KEYS, KEYS, PALETTE_KEYS, paletteChannelDown } from '../input/keyconfig.ts';
import { hotbarAction, type HotbarAction } from '../classic/hotbar.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { AttackState, type AttackEvents, burstCount } from '../combat/attack.ts';
import { facingOf, inMeleeReach, meleeReachAny, type MeleeAim, type WeaponReach } from '../combat/weaponaim.ts';
import {
  AI_PROFILES,
  aiConfig,
  collisionRadius,
  EnemyAi,
  enemySpeeds,
  movementIndex,
  type AiTarget,
  type EnemyAiMotion,
  type EnemyBrain,
  type IllGillSpecial,
} from '../combat/enemyai.ts';
import { GoranAi, goranWarpRow } from '../combat/goranai.ts';
import {
  LilyAi,
  LilySpit,
  MONEST,
  MonestSpawner,
  MOTHMANT_FLY_HEIGHT,
  MothmantAi,
  RappyAi,
  RappyFakeDeath,
  WolfAi,
  armPackHowl,
} from '../combat/enemyfsm.ts';
import { GrassAi, NanoDragonAi } from '../combat/enemyfsmcaves.ts';
import { PanArmsAi, PanHalfAi, SlimeAi, SlimeArm, SlimeControl, slimeSplitsOnHit, type PanEvent } from '../combat/enemysplits.ts';
import { CanadineAi, CananeAi, DubchicAi, GaranzAi, SinowAi, SINOW_MIRAGE, type SinowEvent } from '../combat/enemyfsmmines.ts';
import { DUBWITCH, DubwitchAi } from '../combat/dubwitch.ts';
import { BELRA, BelraAi, BringerAi, BulclawAi, ClawAi, delLilyMegid, DelsaberAi, GunnerAi, GunnerControl, SORCERER, SorcererAi, SorcererBitAi, type BulclawEvent, type HealAlly } from '../combat/enemyfsmruins.ts';
import { DolmolmAi, MerilliaAi } from '../combat/enemyfsmep2.ts';
import { GibbonAi, GibbonGroups, MericarolAi } from '../combat/enemyfsmep2b.ts';
import { GeeAi, GibblesAi, GiGueAi } from '../combat/enemyfsmep2a.ts';
import { ZuAi } from '../combat/enemyfsmep4.ts';
import { EPSILON_ANIM, epsilonTint, EpsilonAi, EpsigardAi, MORFOS, MorfosAi, MorfosBolt, ReconAi, RecoboxAi, type ReconSpawn } from '../combat/enemyfsmep2d.ts';
import { IllGillAi } from '../combat/enemyfsmillgill.ts';
import { ENEMY_HIT_GROUP, enemyTechOnPlayer } from '../combat/enemytechplayer.ts';
import { MerissaAi } from '../combat/enemyfsmmerissa.ts';
import { EpsilonFx } from './epsilonfx.ts';
import { DelbiterAi, DeldepthAi, ExeBrain, SinowBerillAi, SinowZoaAi } from '../combat/enemyfsmep2c.ts';
import { DeRolLeAi, DrlSegmentAi, DRL_BEAM, DRL_SEGMENT, DRL_SLOTS, type DrlEvent, type Vec3 } from '../combat/derolle.ts';
import { BARBA_CAPTURE_COUNT, BARBA_HP, BARBA_PART_COUNT, BARBA_PART_RADIUS, BARBA_PIG_DEST, BARBA_PIG_HEADING, BarbaPartAi, BarbaRayAi, type BarbaEvent, barbaPigMode, barbaRows, decodeBarbaMessage } from '../combat/barbaray.ts';
import { PigRayAi, type PigEvent } from '../combat/barbaminion.ts';
import { type DrlDebris, drlPieceRecords, newMat } from '../combat/derollefins.ts';
import { DragonAi, DragonFireball, DRAGON_BODY_BOXES, DRAGON_MOUTH, type DragonEvent } from '../combat/dragon.ts';
import { GoldDragonAi, GOL_BODY_BOXES, GOL_EXTRA, decodeGolA8, type GolEvent, type GolExtraPlacement } from '../combat/goldragon.ts';
import { decodeEnemyTargetState } from '../combat/enemystate.ts';
import { shareMeshResources } from './dispose.ts';
import { SaintMilionAi, SmChildAi, SM_NODES, SM_PART_COUNT, SM_PART_RADIUS, type SmBossEvent } from '../combat/saintmilionboss.ts';
import { SPINNER_X, spinnerScale } from '../combat/saintmilion.ts';
import { PLAYER_AIM_HEIGHT, PLAYER_RADIUS, TechBolt, type EnemyShot } from '../combat/enemyshots.ts';
import { VoloptAi, VoloptCore, VoloptMonitor, VoloptPartAi, VoloptPillar, VoloptRod, VO_AI, type VoloptEvent } from '../combat/volopt.ts';
import { bossPhaseOf } from '../audio/bossbgm.ts';
import { VoloptForm2Ai, FORM2_SLOTS } from '../combat/volopt2.ts';
import { GalgryphonMinionManager } from '../combat/galgryphon.ts';
import { GalgryphonAi } from '../combat/galgryphonai.ts';
import { OlgaFlowAi, decodeOlgaA4 } from '../combat/olgaflowai.ts';
import { OLGA_AREA, OLGA_LANCER, OLGA_SWORD_WAVE, OlgaSwordTrail, OlgaStabObject, lancerBlade, lancerGate, lancerQuad, lancerTouches, olgaStabRange, randomlyAdjust, olgaBattlePower, stabGroundPoint, swordWaveTouches, type XYZ } from '../combat/olgaflowhits.ts';
import { galgryphonAttackBurst, GALFX_RING, GALFX_RING_PARTICLES } from '../combat/galgryphonfx.ts';
import { DARVANT, Darvant, DarkFalzAi, DarkFalzPartAi, DF_ID, SCENE_NAMES, darvantRingIcon } from '../combat/darkfalz.ts';
import { DEMO_WARP_PARTS } from '../formats/enemymodels.ts';
import { cameraSourceOf, DARKFALZ_CAMERA_FILE } from '../combat/darkfalzcamera.ts';
import { parseCameraRel, type CameraRel } from '../formats/cameramotion.ts';
import { F1_ANIM_ROWS } from '../combat/darkfalz1.ts';
import { F2_ANIM_ROWS } from '../combat/darkfalz2.ts';
import { F3_ANIM_ROWS } from '../combat/darkfalz3.ts';
import { BOOMA_BRAIN_TYPES, boomaBrainIconShown, darkGunnerBrainIconShown, radarSourceOf, type Icon } from '../classic/minimap.ts';
import type { DfEvent, DfRow, DfRows } from '../combat/darkfalzcommon.ts';
import * as THREE from 'three';
import { enemyCombatMotions, type EnemyCombatMotions } from '../combat/enemymotions.ts';
import {
  hitMotion,
  HEAVY_LAND_FRAME,
  KnockbackSlide,
  PlayerDamage,
  SE_BLOCK,
  SE_HIT_HEAVY,
  SE_HIT_LIGHT,
  type HitMotionKind,
  type PlayerDamageFx,
} from '../combat/playerdamage.ts';
import { attributeFx, BLOCK_FX, CRITICAL_HIT_FX, heavyLandSe, HIT_POINT_DY, HIT_SPARK, REVIVE_FX, SOUL_FX, WIN_FX, statusFx, statusPulse, type FxSpec } from '../combat/playerfx.ts';
import { PlayerEffects } from './playerfx.ts';
import {
  applyDamage,
  enemyDefender,
  FLAG_DEAD,
  TOOK_DAMAGE_MIN,
  playerAttacker,
  FLAG_BIG_HIT,
  FLAG_HIT,
  FLAG_MISSED,
  hitChanceWith,
  rollDamage,
  rollHit,
  tookDamage,
  weaponForCombat,
  type AttackerStats,
  type AttackType,
  type DefenderStats,
} from '../combat/formulas.ts';
import { chopToInt } from '../combat/chop.ts';
import { defaultSetContext, wornEquipment, type SetContext } from '../combat/playerstats.ts';
import { classBaseElements, playerElements, statusChanceFromResist, type PlayerElements } from '../combat/playerresist.ts';
import { liveBeatTime } from '../combat/beattime.ts';
import { readItemData, type ItemData } from '../formats/itemnames.ts';
import {
  castMotion,
  megidChance,
  releaseFrame,
  remoteRestaHeal,
  restaHeal,
  targetListKind,
  TECH,
  TECH_NAMES,
  TechCast,
  techData,
  techDamage,
  techBoost,
  techElement,
  techGroup,
  techHitPower,
  techPower,
  techHitShowsNumber,
  techTookDamageMin,
  type TechniqueData,
  type TechResist,
} from '../combat/techniques.ts';
import { bulletMissed, bulletSpeed, EGG_PARTICLE, firesGunBullet, MECHGUN_KIND, MUZZLE_PARTICLE, movedTowards, pelletAllowed, pelletAngleBams, pelletCount, pelletTargetIndex, planGunShot, RIFLE_HOOK_MUZZLE_ATTACH, rifleHookMuzzle, shotVisualOf, ShotEffect, type GunShot } from '../combat/gunbullet.ts';
import { boxTargetable, childBoxTable, enemyBoxTable, slotSetType, slotVariant, VOLOPT_SET_TYPE } from '../formats/enemyboxes.ts';
import type { CollisionBoxRow } from '../formats/collisionboxes.gen.ts';
import { castOriginY, enemyAimHeight, FIRE_SE, FireShot, isFireTech, makeFireObject, pickTechTargets, rowsAimHeight, rowsRadius, techCastPoint, type Candidate, type TechTarget } from '../combat/techfire.ts';
import { gunBulletStart, SECOND_START_BODY_NODE, weaponPositionY, type WeaponOriginProvider } from '../combat/weaponorigin.ts';
import { antiCures, EntityBuffs, GROUP, NO_CLIENT, nearbyAtomizerList, remoteTechLevel, reviveRestore, statusIcon, SUPPORT_ORIENT, SUPPORT_PARTICLE, supportPower, type BuffGroup } from '../combat/buffs.ts';
import { STATUS_ICON_BLAST_FIRST } from '../classic/hud.ts';
import { medicalNeeds, meleeHitStatus, PlayerStatus, STATUS, STATUS_NAME, type StatusType } from '../combat/status.ts';
import { attackHeading, inUnsafeMap, RAND_MAX_C, slowApplies } from './playermove.ts';
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
import { TRAP_DEATH_PARTICLE, trapPaletteType, type BattleTrap, type TrapEffect } from '../quest/battletraps.ts';
import { SONAR_PING_SOUND } from '../quest/battle.ts';
import type { EnemyHitbox as EnemyBoxHit, PlayerRatioStatus } from '../quest/npcai.ts';
import { BattleTrapView } from './battletrapview.ts';
import { PB_INVULN_FRAMES, PB_MAX_TARGETS, PB_NAMES, PB_RANGE, pbBlockedBy, pbDamage, pbGain, pbParticipants, pbPower, pbTechHitTicks, PhotonBlastGauge, PhotonBlastSlots } from '../combat/photonblast.ts';
import { photonBlasts } from '../net/magfeed.ts';
import { isAndroid } from '../combat/progression.ts';
import { BattleParams, battleParamFile, type BattleParamKind, type EnemyAttackData } from '../formats/battleparams.ts';
import { ENEMY_TYPE_NAMES, ENEMY_TYPE_PARAMS } from '../formats/entitynames.ts';
import { BmlArchive } from '../formats/bml.ts';
import { modelTriangles } from '../formats/minimap.ts';
import { parseNinjaChunkFile } from '../formats/njcm.ts';
import { parseUnitxt } from '../classic/charcreate_text.ts';
import { graveKillerId } from '../quest/cmodegrave.ts';
import { nearestSupportTarget, PLAYER_RETICLE_HEIGHT, reticleRow, type SupportCandidate } from '../combat/reticle.ts';
import { playerTargetCardText, targetCardText, type PlayerTargetCardText, type TargetCardText } from '../combat/targetcard.ts';
import { expandEnemySets, type EnemySlot } from '../formats/enemyslots.ts';
import { parseItemPMT, type ItemPMT, type WeaponRange } from '../formats/itempmt.ts';
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';
import { HAND_NODE } from './heldweapon.ts';
import { MOTION_TYPE } from '../formats/plymotion.ts';
import { parseSetFile, type EnemySet } from '../formats/setdata.ts';
import { fetchStreamFiles } from '../net/bbsession.ts';
import { applyHpModification, applyLevelChangeStats, nearestTargets, pvpInReach, pvpKnockback, pvpStrike, remoteAttacker } from '../combat/pvp.ts';
import type { CharacterFile } from '../net/charfile.ts';
import {
  parseAttack,
  parseAttackTargets,
  parseCastTechnique,
  parseCastTechniqueComplete,
  parseChangeLevel,
  parseEnemyState,
  parseEnemyStatusUltimate,
  parseExpMultiplier,
  parseGiveExp,
  parseHitByEnemy,
  parsePlayerDeath,
  parseStarAtomizer,
  parseRevivePlayer,
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
import { FieldParticles } from './hitfx.ts';
import { TechFire } from './techfire.ts';
import { bulletTextureIndex, GunTracers, loadGunBulletModels } from './guntracer.ts';
import { TechEffects, TechObjects, ownsTechnique, type TechWorld } from './techlightning.ts';
import { CAST_HEIGHT, CAST_LIGHT_AMBIENT, castLightColor, castLightFrames, CHARGE_SE, CHARGE_SE_PADDING, GizondeStrike, GrantsStrike, MEGID_WALL_MASK, MegidOrb, PlainBolt, SE, specialStart, SPECIAL_ID, TechShot, type FxSound, type Vec3 as TechVec3, type WallHit } from '../combat/techlightning.ts';
import { setModelOpacity } from './hitmodels.ts';
import { DeathRun, deathPlanFor, mothmantDeathPlan, SavageDeathMotion, type DeathActions, type DeathPoint } from '../combat/deathfx.ts';
import { Dissolve, ICE_DEFAULT_RADIUS, iceRadius } from '../combat/hitmodels.ts';
import { CRITICAL_SE, restaFloat, FLAME_FRAMES, FLAME_PARTICLE, flamePoint, hitParticles, specialHandlerParticles, specialHitFx, statusApplyFx, statusTickFx, techHitFx, type EnemyStatusKind, type HitFxKind, type ParticleSpawn } from '../combat/hitfx.ts';
import { PlayerHud } from './playerhud.ts';
import { LevelUpEffects } from './levelupfx.ts';
import { haptic } from '../input/haptics.ts';
import { analogStick, StickFlick } from '../input/analog.ts';
import { WindowAnim } from '../classic/windowanim.ts';
import { PartyHp, syncHp } from '../combat/partyhp.ts';
import type { PartyValues } from '../classic/hud.ts';
import type { EnemyInstance, EnemyLayer } from './enemyview.ts';
import type { NodeAnimator } from './enemymodel.ts';
import { holdCountdown, parseHoldPacket, type PillarTrap, type TrapEvent } from './traps.ts';
import type { LobbyView } from './lobbyview.ts';
import { burstSpinsOnReceipt } from './weaponspin.ts';
import type { MapViewer } from './mapviewer.ts';
import { TickClock } from './smoothrender.ts';
import { armLocalFromCapture, drawnWorldOrigin } from './morfosnodes.ts';

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
// play_directional_sound_effect: a sound this far from the listener is dropped.
const SE_CUTOFF = 300;
// The beast's BattleParam row (Olga Flow form 1: enemy row 43 for the stats and the animation speeds,
// exe ep1_None__ep2_OlgaFlowForm1__ep4_SpinnerKondrieu2 = 43, map docs/bosses/olgaflow-map.md 6).
const OLGA_ANIM_ROW = 43;
// The Moon Atomizer's object range (FUN_0069a1e0: 0x41200000 = 10.0).
const ATOMIZER_RANGE = 10;
// The 6x33 object: CreateTechniqueEntity_006ef8a4(sender, pos, [target], 0x1d). The
// constructor takes the Reverser's data (technique_data_array[0x11]) whatever the
// caller, and 0x1d is the level AccumulateEffectParams adds to its power (29).
const ATOMIZER_OBJECT_LEVEL = 0x1d;
// The 6x66 particles (FUN_005de5a4 -> FUN_0050b510 create_particle_effect): 0x19 on
// the caster, 0xc2 on each player it heals; on an unsafe map only (FUN_00807d60).
const STAR_CASTER_PARTICLE = 0x19;
const STAR_TARGET_PARTICLE = 0xc2;

const ENEMY_BASE_FLAGS = 0x20000000 | 0x00800000 | 0x00100000;

// The techniques whose targeting record picks a party member (the reticle's light-blue row):
// Resta (dump's resta, the GetTechniqueData(resta, 0xe) record of
// unknown_update_equipment_properties_from_pmt, reticle type 4 / 10), Reverser (type 4 / 9)
// and Anti. ASSUMED: Anti's record (the port's playerTargets, not traced in the dump).
const SUPPORT_TARGET_TECHS: readonly number[] = [TECH.resta, TECH.anti, TECH.reverser];

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

// A long emission (the beam's emitter): it ends when its alive() says so.
const BEAM_EMISSION = 1 << 20;

// What render/combat.ts keeps per De Rol Le (combat/derolle.ts): the body
// nodes it reads, the child part groups it moves, and reused point arrays.
interface DrlView {
  spine: THREE.Object3D[] | null; // 11 captured nodes (null: no node tree)
  attach: THREE.Object3D[] | null; // the 4 tentacle attach nodes
  tentacles: (THREE.Object3D | null)[];
  stings: (THREE.Object3D | null)[];
  bodyAnimators: NodeAnimator[];
  segs: Vec3[];
  atts: Vec3[];
  drawn: boolean; // the node matrices come from a frame that was drawn
  fins: (THREE.Object3D | null)[][]; // [chain][segment] part groups (combat/derollefins.ts)
  finAt: Vec3[]; // the two fin anchors (captured nodes 26 and 96)
  helmNode: THREE.Object3D | null; // draw index 77: the helm break captures its matrix
  helmCut: THREE.Object3D[]; // the helm nodes below it, collapsed once the helm flew off
  helmDebris: DrlDebrisView | null;
  shellDebris: (DrlDebrisView | null)[];
  // The segment entities' enemies (slots body + 1 + i), null: not spawned.
  segProxies: (EnemyRuntime | null)[];
  // Segment i's plate in the body model: root child i (draw index 1 + 2i,
  // DAT_00a43c0c[i]) and its child (2 + 2i, g_DerolleRenderColorsArray[i]).
  segPlates: THREE.Object3D[][];
  // The materials of segment i's plate (the strips of draw node 1 + 2i).
  segMats: THREE.Material[][];
}

// The materials buildEnemy gave one draw node of a model (NjcmPartInput.ownMaterials).
function plateMaterials(root: THREE.Object3D, node: number): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.userData.node === node && !out.includes(m)) out.push(m);
    }
  });
  return out;
}

// The exe writes the node's diffuse (DerolleSetAnimationSpeed 0x004355bc): the
// colour replaces the material's colour, the texture is still multiplied in.
function setPlateDiffuse(m: THREE.Material, argb: number): void {
  if (!(m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshBasicMaterial)) return;
  m.color.setRGB(((argb >> 16) & 0xff) / 255, ((argb >> 8) & 0xff) / 255, (argb & 0xff) / 255, THREE.SRGBColorSpace);
}

// A debris part: its group and its node tree (node i + 1 is piece i).
interface DrlDebrisView {
  group: THREE.Object3D;
  bones: THREE.Object3D[];
}

// What render/combat.ts keeps per Vol Opt control object: the groups of its
// parts in the head's world root and each part's enemy (VoloptAi.parts order).
interface VoloptView {
  pillars: (THREE.Object3D | null)[];
  lids: (VoloptLidView | null)[];
  monitors: (THREE.Object3D | null)[];
  brokenMonitors: (THREE.Object3D | null)[]; // the fallen monitors' models
  rod: THREE.Object3D | null;
  core: THREE.Object3D | null;
  proxies: (EnemyRuntime | null)[];
  spin: number;
}

// A pillar's hatch lid (model 13): its group in the world root and the two nodes
// the draw moves (the first node by b, the child by a), with their bind heights.
interface VoloptLidView {
  group: THREE.Object3D;
  first: THREE.Object3D;
  child: THREE.Object3D;
  firstY: number;
  childY: number;
}

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
  slimeSlot?: number; // a Pofuilly Slime's k in its control's slots (parent = the control)
  splitHp?: number; // a Hidoom / Migium's HP at the split (its call threshold)
  death?: { run: DeathRun; acc: number; dissolve: Dissolve | null; fade: boolean; savage?: SavageDeathMotion }; // combat/deathfx.ts: the death state's steps (fade: the slime's own fade runs; savage: a wolf's kill side, turn and slide)
  blood?: number; // the stats row's f32 @0x10 (the blood pool's distance, formats/battleparams.ts bloodOffset)
}

// How a hit is shown (combat/hitfx.ts): its effect family and whether the
// accuracy roll failed.
interface HitVisual {
  kind?: HitFxKind;
  miss?: boolean;
  // The hit roll passed (0x200, took_damage), 0 damage included. Default: not
  // a miss. A caller with its own roll (a confusion or a Megid kill) sets it.
  landed?: boolean;
  // The total that sets 0x200 for this source (formulas.ts TOOK_DAMAGE_*). Default:
  // the melee / weapon threshold, TOOK_DAMAGE_MIN.
  took?: number;
  // false: no damage number over the hit (entity_hit_by_tech's Megid: the spark
  // only). Default: the number, 0 included.
  number?: boolean;
}

// Epsilon's body: its cloned materials, their base colours and the last tint
// inputs (epsilonTintBody).
interface EpsilonBody {
  mats: THREE.MeshBasicMaterial[];
  base: THREE.Color[];
  from: number;
  to: number;
  mix: number;
  t: number;
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

// A strike's target: an enemy, or a remote player (Battle mode) by its client id.
export interface StrikeTarget {
  enemy: EnemyRuntime | null;
  player: number;
}

// The 6x46 entity id of a strike target (an enemy is 0x1000 | index, a player its client id).
const strikeEntityId = (t: StrikeTarget): { entityId: number } => ({ entityId: t.enemy ? 0x1000 | t.enemy.index : t.player });

// A gun bullet in flight: its target, the target's centre when the shot was
// made (gun_bullet_collision_check's orig_target_position) and the ticks left.
// A remote player's bullet has no entity (player = its client id): its hit is the
// victim's roll on its own copy (onRemoteStrikeTargets), so it lands with no effect here.
interface GunBulletRun {
  entity: EnemyRuntime | null;
  player: number;
  start: { x: number; y: number; z: number };
  origCentre: { x: number; y: number; z: number };
  ticks: number;
  attackType: AttackType;
  step: number;
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
  // Dubwitch (combat/dubwitch.ts): hp 300 from its ctor.
  'TOCtrlDubchik',
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
  // Episode 2 (combat/enemyfsmep2.ts).
  'TObjEneMerillLia',
  'TObjEneDolmOlm',
  // Episode 2, part 2 (combat/enemyfsmep2a.ts).
  'TObjEneMe1Gee',
  'TObjEneMe1GiGue',
  'TObjEneGibbles',
  // Episode 4 Zu / Pazuzu (combat/enemyfsmep4.ts). Pazuzu shares the set type and so the class.
  'Zu',
  // Episode 2, part d (combat/enemyfsmep2d.ts).
  'TObjEneMorfos',
  'TObjEneRecobox',
  'TObjEneEpsilonBody',
  // Caves splitters (combat/enemysplits.ts).
  'TObjEnePanarms',
  'TObjEneSlime',
  // Episode 1 bosses (combat/dragon.ts, combat/derolle.ts, combat/volopt.ts, combat/volopt2.ts).
  'TBoss1Dragon',
  'TBoss8Dragon', // Gol Dragon (combat/goldragon.ts)
  'TBoss2DeRolLe',
  'TBoss7DeRolLeC', // Barba Ray (combat/barbaray.ts)
  'TBoss3Volopt',
  'TBoss3VoloptP02',
  // Episode 4 (combat/saintmilionboss.ts).
  'Episode4Boss',
  // Ill Gill (combat/enemyfsmillgill.ts): the radar follows its per-state tail (IllGillAi.radar).
  'TObjEneIllGill',
  // Merissa A / AA (combat/enemyfsmmerissa.ts): the radar follows its +0x37c bit 0x8 (MerissaAi.radar).
  'MerissaA',
  // Dark Falz (combat/darkfalz*.ts).
  'TBoss4DarkFalz',
]);

// Classes whose own target search honours confusion: the Booma handlers
// (unknown_booma_enemy_find_target 0x0052b888: Booma, Shark, Dimenian,
// Rappy, Hildebear-family vtables), EnemyUpdateTarget_0052ccd8's callers
// (Bulclaw / Claw) and the Delsaber (unknown_delsaber_targeting_related).
// The Poison Lily has no confused branch; the Dark Belra spins and throws
// instead (combat/enemyfsmruins.ts BelraAi).
const CONFUSION_AWARE = new Set(['TObjEneBeast', 'TObjEneShark', 'TObjEneDimedian', 'TObjEneLappy', 'TObjEneMoja', 'TObjEneBalClawBody', 'TObjEneBalClawClaw', 'TObjEneSaver', 'TObjEneMerillLia', 'TObjEneDolmOlm']);
// Episode 2, second batch (combat/enemyfsmep2b.ts): the Mericarol family and the Gibbons.
OWN_FSM.add('TObjEneBm9Mericarol');
OWN_FSM.add('TObjEneBm5GibonU');
CONFUSION_AWARE.add('TObjEneBm9Mericarol');
CONFUSION_AWARE.add('TObjEneBm5GibonU');
// Episode 2, third batch (combat/enemyfsmep2c.ts): the Sinow family, Deldepth
// and Delbiter share the enemy base's FindDerolleTarget_00521010 (confusion
// aware: vtable +0x194 widens the search to the other enemies).
for (const n of ['TObjEneMe3StelthReal', 'TObjEneMe3SinowZoaReal', 'TObjEneDelDepth', 'TObjEneDellBiter']) {
  OWN_FSM.add(n);
  CONFUSION_AWARE.add(n);
}
// A Bulclaw's child slots (newserv: 4 CLAW children).
const BULCLAW_CLAWS = 4;
// A slime control, or the other split / boss parts: not on the radar, not locked on, not struck,
// not a technique or confused-enemy target (combat/enemysplits.ts untargetable). Vol Opt's control
// object, its parts that are not up and its body before the fight are hidden the same way.
// The Pan Arms, its Hidoom / Migium halves and a Pofuilly Slime follow the exe's three rules
// instead (PanArmsAi / PanHalfAi / SlimeAi radar / lockable / invulnerable), so the three
// predicates below read them:
//   - the radar icon: the Pofuilly every frame but the dead one (SinowzoaUpdate_00596104,
//     `field_0x38c != 0xd`); the Pan Arms while buried or lockable (DerolleUpdateStateTransition
//     _00580b2c, state != 0 and (+0x3e4 set and state != 4, or state 1)); a Hidoom / Migium
//     while state != 0, +0x38c set and state != 7 (FUN_00583eb0, 0x583fb3);
//   - the lock-on and the technique records only while the lock flag is set (enable_reticle):
//     +0x3f4 for the slime, +0x3e4 for the Pan Arms, +0x38c for the halves;
//   - the hit only while the box is on: the slime's 0x28 bits (SetEnemyInvulnerableAndImmune);
//     the halves' bit 0 of the box (+0x384, +0x18); the Pan Arms' hit is ASSUMED (its own box
//     bits are not traced, see PanArmsAi.invulnerable);
// Gibbles (GibblesAi, the per-state gates of enemyfsmep2a.ts setGate / enterBox): the icon
// and the reticle of the handler's frame, and bit 0 of its box as the hit (`hittable`).
const isSplitPart = (ai: EnemyBrain | null): boolean => ai instanceof SlimeAi || ai instanceof PanArmsAi || ai instanceof PanHalfAi || ai instanceof GibblesAi;
// Gibbon and Mericarol (combat/enemyfsmep2b.ts), PsoBB.exe: vtable +0x184 (FUN_00520504) calls
// +0x174 (FUN_0052039c: entity flag 0x4000000 = invulnerable, and 0x2000000 on every hit box, so
// the box is not struck) and +0x180 (FUN_005204b0: bit 0 of every box off), then sets entity flags
// 0x4040000. The lock / radar gate reads 0x40000 (radar and lock-on sites of EnemyGetNearestTarget;
// the same entity-flag family as the minimap), so `untargetable` (the +0x184 states) hides both
// from the radar, the lock-on and the hit (the hit boxes are off). The other timers call +0x174
// alone (the Gibbon's back step until its stomp, the Mericarol's TP drain): the boxes are off too,
// but the struck candidates keep them as before (the invulnerable hit shows its 0; ASSUMED display
// rule, see applyEnemyHit), and they stay on the radar and lockable.
const isEp2Hidden = (ai: EnemyBrain | null): boolean => (ai instanceof MericarolAi || ai instanceof GibbonAi) && ai.untargetable;
export const splitRadarOk = (e: { ai: EnemyBrain | null }): boolean =>
  (!isSplitPart(e.ai) || (e.ai as SlimeAi | PanArmsAi | PanHalfAi | GibblesAi).radar) && !isEp2Hidden(e.ai) && (!(e.ai instanceof IllGillAi) || e.ai.radar) && (!(e.ai instanceof MerissaAi) || e.ai.radar);
const splitLockBase = (e: { ai: EnemyBrain | null }): boolean =>
  (!isSplitPart(e.ai) || (e.ai as SlimeAi | PanArmsAi | PanHalfAi | GibblesAi).lockable) && !isEp2Hidden(e.ai);
// Lock-on and the technique records (the reticle's per-frame lockable flag). A Vol Opt entity is
// judged by voloptLockOk (its lock is not its hit); the other enemies by splitLockBase.
export const splitLockOk = (e: { ai: EnemyBrain | null }): boolean => {
  const vo = voloptLockOk(e.ai);
  return vo !== null ? vo : splitLockBase(e);
};
export const splitStruckOk = (e: { ai: EnemyBrain | null }): boolean => {
  if (isEp2Hidden(e.ai)) return false;
  if (e.ai instanceof GibblesAi) return e.ai.hittable;
  return !isSplitPart(e.ai) || !(e.ai as SlimeAi | PanArmsAi | PanHalfAi).invulnerable;
};
const techRecordOk = splitLockOk;
// The concealed() test of the lock-on and the technique records: a Vol Opt entity is decided by
// voloptLockOk alone (concealed() is its hit gate, see voloptLockOk).
const lockConcealed = (e: { ai: EnemyBrain | null }): boolean => (voloptLockOk(e.ai) !== null ? false : concealed(e));
const concealed = (e: { ai: EnemyBrain | null }): boolean =>
  (e.ai instanceof SlimeControl && e.ai.untargetable) ||
  ((e.ai instanceof VoloptAi || e.ai instanceof VoloptPartAi || e.ai instanceof VoloptForm2Ai || e.ai instanceof DragonAi) && e.ai.untargetable) ||
  (e.ai instanceof GoldDragonAi && e.ai.untargetable) ||
  (e.ai instanceof DubwitchAi && e.ai.untargetable) ||
  ((e.ai instanceof DarkFalzAi || e.ai instanceof DarkFalzPartAi) && e.ai.untargetable) ||
  (e.ai instanceof DrlSegmentAi && e.ai.untargetable) ||
  (e.ai instanceof BarbaPartAi && e.ai.untargetable) ||
  e.ai instanceof SaintMilionAi ||
  (e.ai instanceof SmChildAi && e.ai.untargetable) ||
  (e.ai instanceof SinowAi && e.ai.dormant) ||
  (e.ai instanceof NanoDragonAi && e.ai.untargetable);
// The radar test of concealed(). Two families keep their forced icon whatever their box state:
// - The Dragon's update (PsoBB.exe OlgaUpdateMainLoop_00423b7c, 0x00423b7c) ends every live frame
//   with enable_reticle_ and unknown_add_minimap_icon3(pos, 0xffffa24c, 0x40000000, flag 1): no
//   state gate, no distance gate. So the entrance (sid 0x1d, untargetable) is on the radar.
// - The De Rol Le shell segments (handle_derolle_shell_behavior 0x00435294, dump 176968):
//   unknown_add_minimap_icon3 at the segment's own x2 with 0x3f99999a (1.2), flag 1, after the
//   pause gate only. Their box (bit 0, off below y -60, 0x00435070) does not gate the icon.
// Lock-on and hit still follow concealed(): the Dragon's entrance is the only Dragon state that
// clears its body boxes' bit 0 (ProcessEnemySinowbeatDragonPhase phase 4 of 0x1d calls
// SaintEmilionPart_DisableAll 0x007ba03c, dump 159373; phase 5 calls EnableAllEntityHitboxes
// 0x007b9fbc, dump 159657). See combat/dragon.ts untargetable.
// The struck loops' visibility test (EntityHitEntity has no reticle or display test). A Vol Opt
// monitor's proxy is shown only while its wall is exposed (syncVolopt), but the exe strikes a
// monitor whatever its wall (see VoloptMonitor.hittable), so for it the head's visibility decides.
const struckShown = (e: EnemyRuntime): boolean =>
  e.instance.root.visible || (e.ai instanceof VoloptPartAi && e.ai.part instanceof VoloptMonitor && !!e.parent?.instance.root.visible);
// Vol Opt is decided per entity first (voloptRadar).
export const radarConcealed = (e: { ai: EnemyBrain | null }): boolean => {
  const vr = voloptRadar(e.ai);
  if (vr === 'never') return true;
  if (vr === 'always') return false;
  return concealed(e) && !(e.ai instanceof DragonAi) && !(e.ai instanceof DrlSegmentAi);
};

// Vol Opt's radar (PsoBB.exe; each entity's update is vtable +0x04, the minimap icon is
// unknown_add_minimap_icon at 0x00805608, the call sites are read with objdump and Ghidra):
//   - the control (vtable 0x00af5540, update 0x0043c5d4, states 0x0043c680): no icon call in
//     its code, never on the radar;
//   - the prison (vtable 0x00af6560, update 0x00449e3c): no icon call in its code, never;
//   - the rod (vtable 0x00af5a60, update 0x00440d58): the icon at 0x00440e55 (the update's
//     tail, pos +0x38) has no state gate, only the paused / cut-scene test, so it is on the
//     radar every frame; its death is not in the exe's update (ASSUMED: a dead rod stays
//     hidden, as before);
//   - the body (vtable 0x00af6220, update 0x004442e0): the icon at 0x00444692 is ungated
//     after the dying test (flag 0x4000 of +0x30), so the body is on the radar from the
//     moment its root shows (the port shows it once the control stood it up);
//   - the monitors (update 0x004419d4): the icon call at 0x00441aaa is after the state
//     dispatch (0x00441bf0, every state) and gated only by flag 0x800 of +0x30 (the wall
//     loop's SetHitFlag sets it: 0x004415f4 from 0x00441cd1, the inline copy at 0x00441d23).
//     The port's monitor `broken` is that loop's breakDown, so a broken one is off the radar
//     and every other one is on it, targetable or not;
//   - the pillars (dispatch 0x00442730 on +0x32e; the port's pillar `st` is the same number):
//     states 0 (0x00443b0c) and 5 (0x00442770) have no icon call in their code; states 2
//     (0x00442ec0, icon at 0x00443563), 4 (0x00442c98, 0x00442d5b) and 9 (0x004428b0,
//     0x00442986) reach the icon at the end of the handler. ASSUMED: each state's sub-state
//     (+0x384) paths that return before that tail were not all traced, so a sub-state
//     that skips it is still shown;
//   - the core (dispatch 0x0043f17c, jump table 0x008fe0bc; the port's core `st` is the same
//     number): states 0, 4, 5 and 7 have no icon call (0x0043fcfc, 0x0043f560, 0x0043f52c,
//     0x0043f458); state 2 has one (0x0043f9d8, in its sub 4 path: not all sub paths traced);
//     states 1, 9 and 10 gate it on DAT_00a447ac >= 0 (0x0043fccb / 0x00440320 / 0x0043f2ac),
//     the current monitor id the core writes each tick (0x0043f01a = its monitor lookup), which
//     is the port's VoloptAi `exposed` (ASSUMED equal: the same tick, the same value).
//   - the rest (the body's and the rod's cases above) are unchanged.
export type VoloptRadar = 'always' | 'never' | 'concealed';
export const voloptRadar = (ai: EnemyBrain | null): VoloptRadar | null => {
  if (ai instanceof VoloptAi) return 'never';
  if (ai instanceof VoloptForm2Ai) return 'always';
  if (ai instanceof VoloptPartAi) {
    const p = ai.part;
    if (p instanceof VoloptPillar) return p.st === 2 || p.st === 4 || p.st === 9 ? 'always' : 'never';
    if (p instanceof VoloptMonitor) return p.broken ? 'never' : 'always';
    if (p instanceof VoloptCore) {
      if (p.st === 0 || p.st === 4 || p.st === 5 || p.st === 7) return 'never';
      if (p.st === 2) return 'always';
      return ai.owner.exposed >= 0 ? 'always' : 'never';
    }
    if (ai.part.kind === 'prison') return 'never';
    if (ai.part.kind === 'rod') return ai.part.dead ? 'concealed' : 'always';
    return 'concealed';
  }
  return null;
};

// Vol Opt's lock-on (PsoBB.exe enable_reticle_ 0x007aa094, one `calll` per entity handler; the
// reticle filter is check_enemy_is_targetable 0x007a2b5c, which reads the entity's flags at the
// time of the lock). The lock is decided here, apart from the hit: EntityHitEntity 0x00773350 has
// no lock or reticle test, so a part can be lockable and not struck (concealed() stays the hit).
// The sites (objdump; the dispatch tables read with tools/exedata.py read; each site's handler
// found with tools/ghidra/decomp.sh):
//   - control (0x0043c508..0x0043e338) and prison (0x00449c33..0x0044a0d8): no site, never;
//   - monitor (0x004414d8..0x00442254): no site in its code, never (ASSUMED no base-class helper
//     reached through its vtable calls it);
//   - core (dispatch 0x0043f17c, table 0x008fe0bc): sites in states 1 (0x0043fb90), 2 (0x0043f6c8),
//     4 (0x0043f560), 5 (0x0043f52c), 7 (0x0043f458), 9 (0x00440298), 10 (0x0043f1c8); none in 0
//     (0x0043fcfc), 3, 6, 8. State 7 is inside the 0x40000 window: sub 0 sets it (0x0043f473) before
//     the site (0x0043f4e7) and it is cleared only on the exit frame (0x0043f50d), so the record
//     filter (field7 0x40000) refuses it. The sites are not gated by the exposed monitor
//     (DAT_00a447ac is read after them). State 4's window writes (0x0043f5a3) are ASSUMED to leave
//     its site reachable;
//   - pillar (dispatch 0x00442730): sites in states 0 (0x00443b46, after the window set 0x00443b33
//     of its sub 0: refused, so not listed), 2 (0x00442ec0; window sets on some sub paths, ASSUMED
//     those paths are the refused ones only), 4 (0x00442c98), 5 (0x00442770; the window set comes
//     after its site), 9 (0x004428b0). 1, 3, 6, 7, 8 have none;
//   - rod (dispatch 0x00440e84): sites in states 4 (0x004410f7, handler 0x004410c0) and 5 (0x00440ff9,
//     0x0044102a, handler 0x00440fd0); state 7 (0x00440ef8) calls once on its entry frame (0x00440f2a)
//     and then sets the window (0x00440f39), so it is refused; states 0 and 1 (0x00440ebc) have none.
//     So a hanging rod (state 1) is shootable (targetable) but not lockable;
//   - body (dispatch 0x004446fc, table 0x008fe588): sites in states 0 (0x0044833c), 2 (0x00446f90), 5
//     (0x00446948), 7 (0x00446838), 9 (0x00445e84), 10 (0x00445874), 11 (0x0044534c) and 12
//     (0x00444758), 17 sites in all; 1 (0x00448328) and 4 (0x00446d08) have none. State 7 sets the
//     window (0x0044687f) on every path before its site (0x00446889), so it is refused.
// The state lists below are the sites minus the refused window states. Returns null for an entity
// that is not Vol Opt.
const VOLOPT_CORE_LOCK: ReadonlySet<number> = new Set([1, 2, 4, 5, 9, 10]);
const VOLOPT_PILLAR_LOCK: ReadonlySet<number> = new Set([2, 4, 5, 9]);
const VOLOPT_BODY_LOCK: ReadonlySet<number> = new Set([0, 2, 5, 9, 10, 11, 12]);
export const voloptLockOk = (ai: EnemyBrain | null): boolean | null => {
  if (ai instanceof VoloptAi) return false;
  if (ai instanceof VoloptForm2Ai) return VOLOPT_BODY_LOCK.has(ai.st);
  if (ai instanceof VoloptPartAi) {
    const p = ai.part;
    if (p instanceof VoloptCore) return VOLOPT_CORE_LOCK.has(p.st);
    if (p instanceof VoloptPillar) return VOLOPT_PILLAR_LOCK.has(p.st);
    if (p instanceof VoloptRod) return p.st === 4 || p.st === 5;
    return false; // the monitor and the prison
  }
  return null;
};

// 6x47 / 6x48 subcommand numbers.
const SUB_CAST_TECHNIQUE = 0x47;
const SUB_CAST_TECHNIQUE_COMPLETE = 0x48;
// ASSUMED: the targeting system's height window for techniques (the weapon
// hit uses the same).
const TECH_HEIGHT_WINDOW = 40;

export interface CombatOptions {
  log: (msg: string) => void;
  // The death drop check's first item (GameItems.dropCheckItem) and the 6x29 of a Scape Doll's revive.
  dropCheckItem?: () => { id: number; scapeDoll: boolean } | null;
  consumeItem?: (itemId: number) => void;
  // The camera's yaw as a BAMS angle (render/gameview.ts): the Rafoie fire sphere's turn.
  cameraYaw?: () => number;
  // The death fade is over and 6x4E went out (the dead prompt opens), and the
  // player is alive again (6x4F, the prompt closes). combat/playerdamage.ts.
  onRevivable?: () => void;
  onRevived?: () => void;
  // Whether a quest (or a Battle Mode run) is on: its revive restores full HP and TP
  // (reviveRestore). Set by the game view.
  questRunning?: () => boolean;
  // palette_slots[index] of the current action palette (render/fieldhud.ts).
  paletteSlot?: (index: number) => { group1: number; group2: number; disabled: boolean } | null;
  // hotbar_slots[index] (0..9) of the current action palette: the bottom hotbar's keys 1..0
  // (classic/hotbar.ts; render/fieldhud.ts).
  hotbarSlot?: (index: number) => { group1: number; group2: number; disabled: boolean } | null;
  // Uses the bag item of palette item index group2 (the hotbar's group 1 = 4); true when a use was sent.
  // The safe-map gate is applied here, before the call (render/fieldhud.ts useHotbarItem does the lobby test).
  useItem?: (group2: number) => boolean;
  // The Action Palette Middle key, before its attack: true when an NPC or floor item in the
  // weapon's reach took it (the exe's middle-slot override, update_main_palette_slot_down_override
  // and unknown_handle_main_palette_slot_down_activation). The reach is null without a player.
  interactMiddle?: (reach: WeaponReach | null) => boolean;
  // Map files of a floor (GameView.floorFilesFor).
  floorFilesFor: (floor: number) => Promise<{ area: number; files: { enemies: string } | null }>;
  // Ground height under (x, z), so a walking enemy follows the floor.
  ground?: (x: number, z: number, fromY: number) => number | null;
  // The map's wall ray (cast_ray_at_map_collision_geometry, mask 0x8100 by default): true when a
  // wall stands between the two points (combat/gunbullet.ts; the slime's crawl passes 0x8000).
  wallBlocks?: (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, mask?: number) => boolean;
  // The same ray's hit point (the Megid orb stops at it): null when nothing is hit.
  wallHit?: (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, mask: number) => { x: number; y: number; z: number; normal?: { x: number; y: number; z: number } } | null;
  // The owner's body node's world point for a gun's bullet start (combat/weaponorigin.ts);
  // default: the local player's skeleton in the lobby view. False / absent: WEAPON_HEIGHT above the feet.
  weaponOrigin?: WeaponOriginProvider;
  // The session's character (E7) kept in step with level / EXP / stats, like
  // net/items.ts keeps the inventory.
  character?: () => CharacterFile | null;
  fullCharacter?: () => Uint8Array | null;
  // The client data folder, for the HUD's sound effects (common.pac).
  source?: DataSource;
  // Intra-floor warp of the local player (a 6x17 from the leader, Vol Opt).
  warpSelf?: (pos: { x: number; y: number; z: number }, angle: number) => void;
  // construct_objects of a floor (unhide_object_set_no_packet).
  constructObjects?: (floor: number, room: number, group: number) => void;
  // The boss's form changed (a 6x15 this client sent itself, Vol Opt's change
  // to form 2): the field plays that phase's music (audio/bossbgm.ts).
  bossPhase?: (phase: number) => void;
  // The stream file the session already has (the classic page reads it on the
  // login connection after login); without it (or if it failed) the game
  // connection is asked.
  streamFiles?: () => Promise<Map<string, Uint8Array>>;
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

const NO_FALZ_MARKS: readonly [number, number, number][] = [];

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
  private held = new Set<string>();
  // The movement keys down last frame (the freeze mash counts their new presses).
  private heldMove = new Set<string>();
  // The keys down this frame (frame's argument), read by the Barba Ray jump (barbaInput).
  private frameKeys: ReadonlySet<string> = new Set();
  // The stick's flicks (CheckMovementInput_007c11d0's stick branch): a flick is a
  // mash like a new movement key press.
  private stickFlick = new StickFlick();
  // Battle Mode: a palette press of a trap slot (group 1 = 4, group 2 = 0x0d..0x10) calls
  // this with the trap type 0..3 (the quick menu's trap row 4 too). Returns whether it was placed.
  // Set by quest/battlerun.ts while a battle runs; null otherwise.
  placeTrap: ((type: number) => boolean) | null = null;
  // Battle Mode player versus player (combat/pvp.ts): set by quest/battlerun.ts while the
  // battle controller is in its battle phase. A remote player's strike that names the local
  // player in its 6x46 targets hits it (onRemoteStrikeTargets).
  battlePvp = false;
  // The local player was hit by a remote player (clientId = the attacker, amount = the damage
  // dealt): quest/battlerun.ts sends the 6x8F that credits the attacker.
  onPvpHit: ((attackerId: number, damage: number) => void) | null = null;
  // The last strike (6x43..6x45: combo step, attack type) of each remote player.
  private remoteStrike = new Map<number, { step: number; attackType: number }>();
  // The Battle Mode traps in the field (render/battletrapview.ts), made on the first sync.
  private battleTraps: BattleTrapView | null = null;
  private disposed = false;
  private rng: () => number = Math.random;
  // Set when a remote player is attacking, so LobbyView keeps its motion.
  private attacking = new Set<number>();
  // The local player's HP, hit / death motions and 6x4A..6x4F (see
  // combat/playerdamage.ts).
  readonly damage: PlayerDamage;
  private overlay: CombatOverlay | null = null;
  private tickRemainder = 0;
  // The tick count and remainder of the loop above, for the smoother
  // (render/smoothrender.ts); no logic reads it.
  private readonly tickClock = new TickClock();
  private readonly smoothHook = () => this.smoothDraw();
  private readonly reticleAt = new THREE.Vector3();
  private lockOn: EnemyRuntime | null = null;
  // The support target (client id) of a palette Resta / Anti / Reverser: its own cursor
  // (the light-blue row) and the player card (updateLockOn).
  private allyLock: number | null = null;
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
  // Hit sparks, status / death particles and the specials' effects (combat/hitfx.ts).
  private fx: FieldParticles | null = null;
  // The technique objects of combat/techlightning.ts (render/techlightning.ts).
  private techfx: TechEffects | null = null;
  private techObjects: TechObjects | null = null;
  // The strike being shown is a failed accuracy roll: its number is "MISS".
  private hitMissed = false;
  // The strike being shown landed (its send carries 0x200, 0 damage included):
  // set by applyEnemyHit for the send helpers it dispatches to.
  private hitLanded = false;
  // The strike being shown has no number (HitVisual.number false): num() is silent
  // unless the caller forces it (the invulnerable "0"). Set by applyEnemyHit.
  private hitQuiet = false;
  // The particles on players: hits, blocks, status effects, revives and the
  // dead marker (render/playerfx.ts, combat/playerfx.ts).
  private playerFx: PlayerEffects | null = null;
  // The soul marker of every dead player (TriggerDespawnEffect_00697988).
  private souls = new Map<number, { stop(): void }>();
  // The status effects of the remote players (their copies tick them too).
  private remoteStatus = new Map<number, PlayerStatus>();
  // Ryuker's pipe (render/telepipe.ts): whether one can be opened here
  // (SinowberillChallengePlayer_IsTelepipeEnabled_0068bfa0) and opening it.
  telepipe: { allowed: () => boolean; open: () => boolean } | null = null;
  tp = 0;
  // 6xDD: the lobby's EXP multiplier (unknown_xp_multiplier).
  expMultiplier = 1;
  // Challenge Mode's exp_multiplication, while a quest runs in a Challenge
  // game (handle_experience's g_ChallengeObject / g_QuestStarted test); null
  // outside it. quest/run.ts sets it.
  challengeExpMultiplier: number | null = null;
  private sePlayer: SePlayer | null = null;
  // The web client has no Reverser or Moon Atomizer, so this key revives the
  // local player (the real client needs another player's item or a trip back
  // to Pioneer 2).
  private reviveKey = 'r';
  private cast: CastInProgress | null = null;
  private techHits: PendingTechHit[] = [];
  // Gun bullets in flight (combat/gunbullet.ts): each lands after its frame count.
  private gunBullets: GunBulletRun[] = [];
  // The egg shots' effect objects (combat/gunbullet.ts ShotEffect, shot callback 0x005e4264).
  private shotEffects: ShotEffect[] = [];
  private tracers: GunTracers | null = null;
  // The objects of Foie, Gifoie, Rafoie, Barta, Gibarta and Rabarta in flight
  // (combat/techfire.ts; render/techfire.ts draws them): the enemies they can
  // hit are round boxes of the enemy's collision radius.
  private readonly techFire = new TechFire({
    fx: () => this.fx,
    sound: (id, x, y, z) => this.playSeAt(id, this.fireAt.set(x, y, z)),
    cameraYaw: () => this.opts.cameraYaw?.() ?? 0,
  });
  private readonly fireAt = new THREE.Vector3();
  private fireTargets: TechTarget[] = [];
  private fireRadius = new WeakMap<EnemyRuntime, number>();
  private castTickRemainder = 0;
  // Shifta / Deband / Jellen / Zalure on the local player (combat/buffs.ts).
  // ASSUMED: they survive a floor change (the client keeps the player object
  // across field warps; its tick only runs on a field).
  readonly selfBuffs = new EntityBuffs();
  // The same slots of the remote players the local client hits with a Shifta /
  // Deband (remoteSupport: the caster's 6x47 targets), for the party windows'
  // status icons (QuickMenuUpdateShiftaStatusIcons_007426d8 on each player).
  private remoteBuffs = new Map<number, EntityBuffs>();
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
  // The per-slot blast state that drives the status icons (something_about_photon_blasts).
  private readonly pbSlots = new PhotonBlastSlots();

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
      sendHit: (heavy, angle, hp, vx, vz) => {
        haptic('damage'); // browser vibration (input/haptics.ts)
        this.game.sendHitByEnemy(heavy, angle, hp, vx, vz);
      },
      sendShieldAttack: () => this.game.sendShieldAttack(),
      findDropCheckItem: () => this.opts.dropCheckItem?.() ?? null,
      sendConsumeItem: (itemId) => this.opts.consumeItem?.(itemId),
      sendDeath: (killer, flags) => this.game.sendPlayerDeath(killer, flags),
      sendRevivable: () => {
        this.game.sendPlayerRevivable();
        this.showSoul(this.game.selfId, true);
        this.opts.onRevivable?.();
      },
      sendRevivalItemUsed: () => this.game.sendRevivalItemUsed(),
      // PlayerRestoreHealthAndTP_0068fda4 (Player_DisableMovement): TP = max_tp2.
      restoreTp: () => {
        if (this.progression) this.tp = this.progression.maxTp;
      },
      sendRevived: () => {
        this.game.sendPlayerRevived();
        this.showSoul(this.game.selfId, false);
        this.opts.onRevived?.();
      },
      log: (msg) => this.opts.log(msg),
      sound: (id) => this.playSe(id),
      shielded: () => this.equippedShield(),
      fx: (e) => this.selfFx(e),
      landSound: () => heavyLandSe(this.game.self?.charClass ?? 0),
      motionEnded: () => this.selfAnimator()?.ended ?? true,
      motionFrame: () => this.selfAnimator()?.frame ?? 0,
    });
    this.status = new PlayerStatus({
      sendAdd: (type) => this.game.sendAddStatus(type),
      sendRemove: (slot) => this.game.sendRemoveStatus(slot),
      poisonDamage: (amount) => {
        if (amount < 1) return;
        this.damage.hp = Math.max(1, this.damage.hp - amount);
        this.opts.log(`poison: -${amount} HP (${this.damage.hp}/${this.damage.maxHp})`);
      },
      pulse: (type, onset) => this.statusPulse(this.game.selfId, type, onset),
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
    // The local player's leg speed inputs (render/playermove.ts): the slow outside the
    // hubs, and the guard stance measured to the lock-on target.
    view.legState = () => ({
      slowed: this.status.has(STATUS.slow) && slowApplies(this.area),
      target: this.lockOn ? this.lockOn.instance.root.position : null,
      // should_do_confused_movement: confused (flag 0x10) in an unsafe map.
      confused: this.status.has(STATUS.confusion) && inUnsafeMap(this.area),
    });
    if (!this.overlay) {
      this.overlay = new CombatOverlay(this.viewer.scene);
      void this.loadReticleModels();
    }
    this.loadUnitxtText();
    this.hpReadout ??= this.makeHpReadout();
    if (!this.hud) {
      this.hud = new PlayerHud(this.viewer, this.files);
      this.hud.log = this.opts.log;
    }
    // PSOBBCharacterFile option_flags (+0x4ec): the window speed.
    const full = this.opts.fullCharacter?.();
    this.hud.windowSpeed = WindowAnim.speedOf(full && full.length >= 0x4f0 ? new DataView(full.buffer, full.byteOffset).getUint32(0x4ec, true) : undefined);
    this.fx ??= new FieldParticles(this.viewer, this.files, this.opts.log);
    this.fx.preload();
    this.fx.setMap(this.area);
    this.techfx ??= new TechEffects(this.viewer, this.files, this.fx, { playSe: (f) => this.playTechSe(f) }, this.opts.log);
    this.techfx.preload();
    this.techObjects ??= new TechObjects(this.techfx, this.techWorld());
    this.overlay.text = (spec, x, y, z) => {
      const hud = this.hud;
      if (!hud?.ready) return false;
      const at = new THREE.Vector3(x, y, z);
      hud.hitPopup(spec.text, spec.rgb, () => at);
      return true;
    };
    this.levelUpFx ??= new LevelUpEffects(this.viewer, this.files, {
      position: (id) => this.view?.playerPositions().get(id) ?? null,
      litMaterials: (id) => this.view?.playerLitMaterials(id) ?? [],
      primary: () => ({ diffuse: this.viewer.directionalLight.intensity / Math.PI, ambient: this.viewer.ambientLight.intensity / Math.PI }),
      log: this.opts.log,
    });
    this.playerFx ??= new PlayerEffects(this.viewer, this.files, {
      position: (id) => this.view?.playerPositions().get(id) ?? null,
      log: this.opts.log,
    });
    const inner = this.viewer.onFrame;
    this.viewer.onFrame = (dt, keys) => {
      inner?.(dt, keys);
      this.frame(dt, keys);
    };
    this.viewer.renderHooks.add(this.smoothHook);
  }

  // Before the draw (render/smoothrender.ts): what the game ticks move is
  // drawn between its last two tick poses; the logic never sees it.
  private smoothDraw(): void {
    if (this.disposed) return;
    const s = this.viewer.smoother;
    const clock = this.tickClock;
    for (const e of this.enemies.values()) s.track(e.instance.root, clock, e.ai?.warps ?? 0);
    for (const v of this.drlViews.values()) {
      for (const g of v.tentacles) if (g) s.track(g, clock);
      for (const g of v.stings) if (g) s.track(g, clock);
      for (const row of v.fins) for (const g of row) if (g) s.track(g, clock);
      if (v.helmDebris?.group.visible) for (const b of v.helmDebris.bones) s.track(b, clock);
      for (const d of v.shellDebris) if (d?.group.visible) for (const b of d.bones) s.track(b, clock);
    }
    for (const x of this.shots) if (x.mesh) s.track(x.mesh, clock);
    for (const x of this.spits) if (x.mesh) s.track(x.mesh, clock);
    const lock = this.lockOn;
    if (lock && this.overlay) {
      const p = s.drawnPosition(lock.instance.root, this.reticleAt);
      p.y += 22;
      this.overlay.setTarget(p, { row: reticleRow('enemy'), camera: this.viewer.camera });
    }
    // The support target's cursor follows the player's drawn position (the cursor is set
    // from the same positions in updateAllyLock each tick).
    const ally = this.allyLock === null ? undefined : this.view?.playerPositions().get(this.allyLock);
    if (ally && this.overlay) {
      this.overlay.setTarget({ x: ally.x, y: ally.y + PLAYER_RETICLE_HEIGHT, z: ally.z }, { row: reticleRow('support'), camera: this.viewer.camera, ally: true });
    }
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
  // The latest enterFloor call: one that is overtaken while it awaits (a floor
  // change while the battle params load) must not build its enemies on the new
  // floor's models (set entry indices repeat between floors).
  private enterToken = 0;
  // The Gibbons' leader / member lists (combat/enemyfsmep2b.ts), per floor.
  private gibbonGroups = new GibbonGroups();

  async enterFloor(floor: number, area: number, sets: EnemySet[], base: number): Promise<void> {
    const token = ++this.enterToken;
    this.floor = floor;
    this.area = area;
    this.fx?.setMap(area);
    // The area's SE bank (FUN_00828d40 = load_map_sound_data, 0x00828d40; SE_AREA_BANK maps the
    // area to its bank, e.g. area 0x2c -> boss09.pac for Saint-Milion). Nothing else swaps it, so
    // the area's sounds (0x6f8, the laser's loop) were never loaded. ASSUMED: swapped at each
    // floor entry, as the exe's area entry handlers do.
    this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
    void this.sePlayer?.setArea(area);
    this.enemies.clear();
    this.gibbonGroups.clear();
    this.attack = null;
    this.cast = null;
    this.techHits = [];
    this.techFire.clear();
    this.techObjects?.clear();
    this.attacking.clear();
    this.clearDrlBeam();
    this.drlViews.clear();
    this.drlLastHitLocal.clear();
    this.dragonLastHit.clear();
    this.galgryphonLastHit.clear();
    this.dragonLogged.clear();
    this.galMinions.clear();
    this.dragonBodies.clear();
    this.sinowClones.clear();
    this.sinowBaseEvp.clear();
    this.voloptViews.clear();
    this.voloptBodyAnim.clear();
    this.voloptLastHit.clear();
    this.voloptHead = null;
    this.voloptBody = null;
    this.voloptHeld = false;
    this.voloptCage?.removeFromParent();
    this.voloptCage = null;
    for (const m of this.epsilonOrbs.values()) m.removeFromParent();
    this.epsilonOrbs.clear();
    for (const fx of this.epsilonFx.values()) fx.dispose();
    this.epsilonFx.clear();
    this.epsilonBodies.clear();
    this.epsilonLook.clear();
    this.resetDarkFalz();
    const slots = expandEnemySets(sets, area, this.game.info?.event ?? 0);
    const headOf = new Map<number, { index: number; slot: EnemySlot }>();
    slots.forEach((slot, i) => {
      if (slot.child === 0) headOf.set(slot.set.index, { index: base + i, slot });
    });
    const params = await this.battleParams();
    if (this.disposed || token !== this.enterToken) return;
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
      // The Dubwitch has no BattleParam row (stats []): its ctor sets 300 HP.
      if (head.slot.type === 'DUBWITCH') stats = { hp: DUBWITCH.hp, maxHp: DUBWITCH.hp, evp: 0, dfp: 0 };
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
      // The Gal Gryphon has its own brain (the branch below) and no AI_PROFILES row, so it is let in here.
      if (profile || OWN_FSM.has(className) || className === 'TBoss5Gryphon' || className === 'TBoss6PlotFalz') {
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
        if (className === 'TObjEneRe2Flower') ai = new LilyAi({ ...at, attack, radius, ultimate, rng: () => this.rng() });
        else if (className === 'TObjGrass') {
          // AttackData [0] slash, [1] web, [2] dash (g_EnemyAttackStats).
          const attacks = params && def ? def.attack.map((i) => params.attack(difficulty, i)) : [];
          // ASSUMED: the set entry's param1 / param2 are the fparam1 / fparam2
          // that 0x00786848 copies (the enrage fraction, the ambush run).
          ai = new GrassAi({ ...at, attacks, radius, fparam1: setParams[0], fparam2: setParams[1], rng: () => this.rng() });
        } else if (className === 'TObjEneNanoDrago') ai = new NanoDragonAi({ ...at, param2: setParams[1], flyIn: Math.round(setParams[0]) === 1, movement, rng: () => this.rng() });
        else if (className === 'TObjEneDubchik')
          ai = new DubchicAi({ ...at, param1: setParams[0], gillchic: head.slot.type === 'GILLCHIC', ultimate, movement, attack, rng: () => this.rng() });
        else if (className === 'TOCtrlDubchik') ai = new DubwitchAi({ ...at, rng: () => this.rng() });
        else if (className === 'TObjEneGyaranzo') ai = new GaranzAi({ ...at, movement, rng: () => this.rng() });
        else if (className === 'TObjEneMe3ShinowaReal') {
          // The Sinow's MovementData rows are 6 (Beat) and 0x10 (Gold)
          // (0x00928b78), not its ResistData index.
          const gold = head.slot.type === 'SINOW_GOLD';
          const mv = params ? params.movement(difficulty, gold ? 0x10 : 6) : null;
          ai = new SinowAi({ ...at, gold, ultimate, movement: mv, attack, radius, param1: setParams[0], rng: () => this.rng() });
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
        // Episode 2 Booma-substrate families: param6 is the subtype (Meriltas /
        // Dolmdarl), the set entry's param1..5 their chances and ranges.
        else if (className === 'TObjEneMerillLia') ai = new MerilliaAi({ ...at, subtype, params: setParams, attack, movement, rng: () => this.rng() });
        else if (className === 'TObjEneDolmOlm') ai = new DolmolmAi({ ...at, subtype, params: setParams, attack, movement, rng: () => this.rng() });
        else if (className === 'TObjEneBm9Mericarol')
          ai = new MericarolAi({ ...at, subtype, params: setParams, movement, attack, ultimate, selfId: () => this.game.selfId, hp: () => stats.hp / Math.max(1, stats.maxHp), rng: () => this.rng() });
        else if (className === 'TObjEneBm5GibonU') {
          // The motion frame counts the strides and the roars are timed by.
          const nodes = instance.animators[0]?.nodeCount ?? 0;
          const counts = new Map<number, number>();
          const motionFrames = (m: number): number => {
            let n = counts.get(m);
            if (n === undefined) {
              try {
                n = instance.archive.motion(m, nodes).frameCount;
              } catch {
                n = 30;
              }
              counts.set(m, n);
            }
            return n;
          };
          // unknown_get_tech_level_from_battleparams_stats: the stats row's level field.
          const level = params && def ? params.stats(difficulty, def.stats[0]).level : 0;
          ai = new GibbonAi({ ...at, subtype, params: setParams, ultimate, level, attack, entityIndex: head.index, groups: this.gibbonGroups, motionFrames, rng: () => this.rng() });
        }
        else if (className === 'TObjEneMe1Gee') ai = new GeeAi({ ...at, params: setParams, movement, rng: () => this.rng() });
        else if (className === 'TObjEneMe1GiGue') ai = new GiGueAi({ ...at, params: setParams, attack, movement, rng: () => this.rng() });
        else if (className === 'TObjEneGibbles') {
          // AttackData [0] slams, then the two shockwave / swing rows (ENEMY_TYPE_PARAMS order).
          const attacks = params && def ? def.attack.map((i) => params.attack(difficulty, i)) : attack ? [attack] : [];
          ai = new GibblesAi({ ...at, params: setParams, attacks, movement, rng: () => this.rng() });
        }
        else if (className === 'TObjEneIllGill') {
          // Attack1..3 rows (battle params 38..41: the scythe, the ice / thunder rows, the
          // snare and the tackle), ENEMY_TYPE_PARAMS ILL_GILL.attack.
          const attacks = params && def ? def.attack.map((i) => params.attack(difficulty, i)) : [];
          const ill = new IllGillAi({ ...at, movement, attacks, rng: () => this.rng() });
          // The stats row's level: the attacker level of the thunder special (get_level, 0x0038).
          ill.level = params && def ? params.stats(difficulty, def.stats[0]).level : 0;
          ill.health = () => stats.hp / Math.max(1, stats.maxHp);
          ai = ill;
        }
        // Merissa A / AA: the variant is the set param6 bit (+0x380, enemymodels 0x112).
        else if (className === 'MerissaA') {
          // The walk's loop length and the attack windows read the archive's frame count (Gibbon's counter).
          const nodes = instance.animators[0]?.nodeCount ?? 0;
          const motionFrames = (m: number): number => {
            try {
              return instance.archive.motion(m, nodes).frameCount;
            } catch {
              return 30;
            }
          };
          ai = new MerissaAi({ ...at, variant: subtype & 1, movement, motionFrames, rng: () => this.rng() });
        }
        else if (className === 'TObjEneMorfos') {
          const mor = new MorfosAi({ ...at, params: setParams, movement, attack, difficulty, radius, phase: head.index, rng: () => this.rng() });
          mor.health = () => stats.hp / Math.max(1, stats.maxHp);
          ai = mor;
        } else if (className === 'TObjEneRecobox')
          // The Recons' rows: MovementData / AttackData 66 (ENEMY_TYPE_PARAMS.RECON).
          ai = new RecoboxAi({ ...at, boxY: instance.placed.world[1], params: setParams, cloneCount: (head.slot.set as EnemySet).numChildren, movement: params ? params.movement(difficulty, 66) : null, attack: params ? params.attack(difficulty, 66) : null, difficulty, rng: () => this.rng() });
        else if (className === 'TObjEneEpsilonBody')
          ai = new EpsilonAi({ ...at, params: setParams, movement, epsigard: params ? params.movement(difficulty, 36) : null, phase: head.index, rng: () => this.rng() });
        // Sinow Berill / Spigell: MovementData rows 6 / 0x10 (0x00929c00), not the ResistData index.
        else if (className === 'TObjEneMe3StelthReal') {
          const spigell = head.slot.type === 'SINOW_SPIGELL';
          const mv = params ? params.movement(difficulty, spigell ? 0x10 : 6) : null;
          const y0 = instance.placed.world[1];
          const hang = Math.max(0, y0 - (this.opts.ground?.(at.x, at.z, y0 + 30) ?? y0));
          ai = new SinowBerillAi({ ...at, params: setParams, movement: mv, attack, ultimate, hang, phase: head.index, rng: () => this.rng() });
        }
        // Sinow Zoa / Zele: MovementData rows 67 / 68.
        else if (className === 'TObjEneMe3SinowZoaReal') {
          const mv = params ? params.movement(difficulty, head.slot.type === 'SINOW_ZELE' ? 68 : 67) : null;
          const y0 = instance.placed.world[1];
          const hang = Math.max(0, y0 - (this.opts.ground?.(at.x, at.z, y0 + 30) ?? y0));
          ai = new SinowZoaAi({ ...at, params: setParams, movement: mv, attack, ultimate, hang, phase: head.index, rng: () => this.rng() });
        } else if (className === 'TObjEneDelDepth') ai = new DeldepthAi({ ...at, movement, attack, param1: setParams[0], ultimate, phase: head.index, rng: () => this.rng() });
        else if (className === 'TObjEneDellBiter') ai = new DelbiterAi({ ...at, params: setParams, movement, attack, ultimate, phase: head.index, rng: () => this.rng() });
        else if (className === 'TObjEnePanarms') ai = new PanArmsAi({ ...at, movement, rng: () => this.rng() });
        else if (className === 'TObjEneSlime') ai = new SlimeControl({ ...at, numChildren: (head.slot.set as EnemySet).numChildren });
        else if (className === 'TBoss2DeRolLe') {
          // MovementData[15] holds the pools and the children's powers
          // (g_DerolleBattleparamsAnimationSpeeds); the body's motion frame
          // counts come from its archive.
          const frameCounts = new Map<number, number>();
          const nodeCount = instance.animators[0]?.nodeCount ?? 0;
          const drl = new DeRolLeAi({
            ...at,
            ultimate,
            movement,
            hp: stats.maxHp,
            leader: () => this.game.selfId === this.game.leaderId,
            frames: (m) => {
              let n = frameCounts.get(m);
              if (n === undefined) {
                try {
                  n = instance.archive.motion(m, nodeCount).frameCount;
                } catch {
                  n = 30;
                }
                frameCounts.set(m, n);
              }
              return n;
            },
            ground: this.opts.ground ? (x, z) => this.opts.ground!(x, z, 60) : undefined,
            rng: () => this.rng(),
          });
          // The entity's own HP is refilled after every hit; the HP that
          // counts is the body pool (ProcessPlayerHealing_00433edc).
          stats = { ...stats, hp: drl.bodyMax, maxHp: drl.bodyMax };
          ai = drl;
        } else if (className === 'TBoss7DeRolLeC') {
          // Barba Ray (combat/barbaray.ts). The body's HP is the ctor's 20000 (0x004afe39);
          // the entity is refilled after each hit and the pools carry the damage.
          ai = new BarbaRayAi({ ...at, movement, rng: () => this.rng(), leader: () => this.game.selfId === this.game.leaderId });
          stats = { ...stats, hp: BARBA_HP, maxHp: BARBA_HP };
        } else if (className === 'Episode4Boss') {
          // Rows: the boss 32 / 34 (Shambertin 36 / 38, Kondrieu 40 / 42), the
          // tentacles 33 / 35 (37 / 39, 41 / 43).
          const v = head.slot.type === 'KONDRIEU' ? 2 : head.slot.type === 'SHAMBERTIN' ? 1 : 0;
          const mv = (row: number) => (params ? params.movement(difficulty, row) : null);
          const hp = (row: number) => (params ? params.stats(difficulty, row).hp : 0);
          const ground = this.opts.ground;
          // The laser's wall cut (cast_ray_at_map_collision_geometry, mask -1): the distance to the first wall hit.
          const wallHit = this.opts.wallHit;
          const wall = wallHit
            ? (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => {
                const h = wallHit(from, to, -1);
                return h ? Math.hypot(h.x - from.x, h.y - from.y, h.z - from.z) : null;
              }
            : undefined;
          ai = new SaintMilionAi({
            ...at,
            variant: v as 0 | 1 | 2,
            param1: head.slot.set.params[0],
            seed: head.index + 1,
            movement: [mv(32 + v * 4), mv(34 + v * 4)],
            hp: [hp(32 + v * 4), hp(34 + v * 4)],
            tentacleHp: [hp(33 + v * 4), hp(35 + v * 4)],
            tentacleMovement: [mv(33 + v * 4), mv(35 + v * 4)],
            // The stats row's ATP, the boss's base (the sand sonic's damage).
            atp: attacker?.atp ?? 0,
            leader: () => this.game.selfId === this.game.leaderId,
            frames: this.motionFrames(instance, null),
            tentacleFrames: this.tentacleFrames(instance),
            ...(ground ? { ground: (x: number, z: number) => ground(x, z, 60) !== null } : {}),
            ...(wall ? { wall } : {}),
            rng: () => this.rng(),
          });
          // The kill gives form 2's EXP (the stats row of the last form).
          if (params) exp = params.stats(difficulty, 34 + v * 4).exp;
        } else if (className === 'TBoss1Dragon') {
          // MovementData row 17 holds the breath's, fireballs' and trail's
          // powers (g_DragonAnimationSpeedIndices 17, 18, 19); stats row 18
          // gives the hp the clamp works on.
          ai = new DragonAi({
            ...at,
            ultimate,
            movement: params ? params.movement(difficulty, 17) : null,
            hp: stats.maxHp,
            leader: () => this.game.selfId === this.game.leaderId,
            frames: this.motionFrames(instance, null),
            playerHp: (id) => (id === this.game.selfId ? this.damage.hp : (this.party.get(id)?.hp ?? 0)),
            rng: () => this.rng(),
          });
        } else if (className === 'TBoss8Dragon') {
          // The Gol Dragon (combat/goldragon.ts). ASSUMED: its MovementData row is
          // not read yet (null); stats row 18 gives the hp. A fresh spawn is the
          // singleton that starts in the entrance (ctor 0x004cb480).
          ai = new GoldDragonAi({
            ...at,
            ultimate,
            movement: null,
            hp: stats.maxHp,
            singleton: true,
            leader: () => this.game.selfId === this.game.leaderId,
            frames: this.motionFrames(instance, null),
            playerHp: (id) => (id === this.game.selfId ? this.damage.hp : (this.party.get(id)?.hp ?? 0)),
            rng: () => this.rng(),
            // The 0x2b phase 9 waits while the copies' slots hold living entities (FUN_004ce970).
            extrasFree: () => this.golExtrasFree(head.index),
          });
        } else if (className === 'TBoss6PlotFalz') {
          // Olga Flow, form 1 (combat/olgaflowai.ts; map docs/bosses/olgaflow-map.md). The room leader's
          // brain chooses the attack states and sends each as 6xA4; the others apply them (onOlgaAction).
          // ASSUMED: the body stays at its spawn (the beast's movement is not ported), its height is the
          // spawn height (the exe's +0x3c) and its heading is the spawn yaw in BAMS.
          ai = new OlgaFlowAi({
            entityId,
            x: at.x,
            z: at.z,
            height: instance.placed.world[1],
            heading: Math.round((at.angle * 65536) / (Math.PI * 2)) & 0xffff,
            hp: stats.hp,
            maxHp: stats.maxHp,
            leader: () => this.game.selfId === this.game.leaderId,
            frames: this.motionFrames(instance, null),
            iparam: params ? params.movement(difficulty, OLGA_ANIM_ROW).iparam : undefined,
            rand: () => this.rng(),
          });
        } else if (className === 'TBoss3Volopt') {
          // The control builds the arena: MovementData rows 33 (core), 34
          // (pillar), 35 (monitor) and the stats HP of rows 33 / 34 / 36.
          const mv = (row: number) => (params ? params.movement(difficulty, row) : null);
          const hp = (row: number) => (params ? params.stats(difficulty, row).hp : 0);
          ai = new VoloptAi({
            ...at,
            ultimate,
            movement: { core: mv(33), pillar: mv(34), monitor: mv(35) },
            hp: { core: hp(33), pillar: hp(34), rod: hp(36) },
            leader: () => this.game.selfId === this.game.leaderId,
            frames: this.motionFrames(instance, 'pillar 0'),
            playerHp: (id) => (id === this.game.selfId ? this.damage.hp : (this.party.get(id)?.hp ?? 0)),
            rng: () => this.rng(),
          });
        } else if (className === 'TBoss3VoloptP02') {
          // Row 37 (body), 42 (the four part HPs), 38 (the prison).
          const mv = (row: number) => (params ? params.movement(difficulty, row) : null);
          const f2 = new VoloptForm2Ai({
            ...at,
            ultimate,
            hp: stats.maxHp,
            movement: mv(37),
            parts: mv(42),
            prison: mv(38),
            prisonHp: params ? params.stats(difficulty, 38).hp : 0,
            leader: () => this.game.selfId === this.game.leaderId,
            selfId: () => this.game.selfId,
            frames: this.motionFrames(instance, null),
            rng: () => this.rng(),
          });
          stats = { ...stats, hp: f2.maxHp, maxHp: f2.maxHp };
          ai = f2;
        }
        else if (className === 'TBoss4DarkFalz') {
          // The control builds the fight: BattleParamEntry rows 53..57 (Darvant,
          // the three forms, the Darvant of form 1).
          ai = new DarkFalzAi({
            ...at,
            difficulty,
            rows: this.falzRows(params, difficulty),
            entityId,
            leader: () => this.game.selfId === this.game.leaderId,
            selfId: () => this.game.selfId,
            partySize: () => this.game.players.size,
            rng: () => this.rng(),
          });
        }
        else if (className === 'Zu') {
          // Zu / Pazuzu (combat/enemyfsmep4.ts). The rare flag (+0x504) is the set's p6 bit 0 (zu_constructor:
          // PROVEN); the exe also ORs is_monster_rare(the floor's rare list, not ported). The level of the
          // target is its player's level. The map ray (cast_ray_at_map_collision_geometry, mask -1) cuts the
          // retreat sweep, the aim and the tech bolt's flight.
          const wallHit = this.opts.wallHit;
          ai = new ZuAi({
            ...at,
            y: instance.placed.world[1],
            movement,
            detect: cfg.detect,
            floor: this.floor,
            ultimate,
            wide: (subtype & 1) === 1,
            levelOf: (id) => this.game.players.get(id)?.level ?? 1,
            wall: wallHit ? (from, to) => wallHit(from, to, -1) : null,
            rng: () => this.rng(),
          });
        } else if (className === 'TObjEneBm5Wolf') ai = new WolfAi({ ...at, detect: cfg.detect, turnRate: cfg.turnRate, attack, radius, entityId, barbarous: head.slot.type === 'BARBAROUS_WOLF', rng: () => this.rng() });
        else if (className === 'TObjEneBm3Fly') {
          // Mothmant's own FSM (combat/enemyfsm.ts MothmantAi). A Mothmant
          // set on its own (no Monest) counts the other parentless ones.
          const speed = enemySpeeds(movement, 0.5).engagedMove;
          ai = new MothmantAi({ ...at, turnRate: cfg.turnRate, speed, attack, radius, siblingsOn: (id, self) => this.countMothmantTargets(null, id, self), rng: () => this.rng() });
        }
        else if (className === 'TObjEneLappy' && profile) {
          // The alive Rag / Al Rappy's own FSM (combat/enemyfsm.ts RappyAi). Its
          // speed is the engaged move, ASSUMED as the fake death's (the record's
          // +4 speed is written at run time).
          ai = new RappyAi({
            x: at.x,
            z: at.z,
            angle: at.angle,
            profile,
            detect: cfg.detect,
            turnRate: cfg.turnRate,
            attack,
            speed: enemySpeeds(movement, 0.5).engagedMove,
            radius,
            wander: Math.max(0, setParams[1]),
            entityId,
            rng: () => this.rng(),
          });
        } else if (className === 'TBoss5Gryphon') {
          // The Gal Gryphon (combat/galgryphonai.ts): the brain owns the body, the pattern and the
          // motion. The leader sends each 0xA0 (sendGalgryphonPacket); the followers apply them
          // (onGalgryphonSync). ASSUMED: P is the live player count; the heading is the spawn yaw in BAMS.
          ai = new GalgryphonAi({
            entityId,
            x: at.x,
            h: instance.placed.world[1],
            z: at.z,
            heading: Math.round((at.angle * 65536) / (Math.PI * 2)) & 0xffff,
            hp: stats.hp,
            maxHp: stats.maxHp,
            leader: () => this.game.selfId === this.game.leaderId,
            players: () => Math.max(1, this.aiTargets().length),
            rand: () => this.rng(),
            send: (packet) => this.game.sendGalgryphonPacket(packet),
            // The brain's death (S5's leave, galgryphonstatesa.ts): on_enemy_killed, then the quest flag 0x52
            // (set_quest_flag, as Vol Opt's 0x2a). The on-killed runs with the body at the origin.
            death: {
              killed: () => this.galgryphonKilled(entityId - 0x1000),
              setQuestFlag: (id) => this.game.setQuestFlag(id, true),
            },
            // The probe's sound (GalgryphonFxB probe, 0x39b) at the boss.
            sfx: (id) => this.playSe(id),
            // The S27 beam and the S30 dive beam: lightning ribbons through the technique effects (the
            // bolt's particle and its ribbon, render/techlightning.ts addBolt).
            bolt: (b) => this.techfx?.addBolt(b),
            // The minion ring's particles (CreateGalgryphonMinion_004aabd8): the two one-shots at the centre, then 32
            // outer emitters (particle 539) that track their slot's point for the 31 spawn ticks. ASSUMED: particle 539 is
            // drawn as its particleentry.dat sprite, not the exe's model particle (the lightning BML's chunk 1, not loaded);
            // the primary emitters (521, destroyed at birth) draw nothing and are not made.
            ringParticles: (() => {
              const slots = Array.from({ length: GALFX_RING.slots }, () => new THREE.Vector3());
              return {
                start: (c) => {
                  const at = new THREE.Vector3(c.x, c.y, c.z);
                  this.particle({ id: GALFX_RING_PARTICLES.startFirst }, at);
                  this.particle({ id: GALFX_RING_PARTICLES.startSecond }, at);
                  for (const p of slots) {
                    p.set(c.x, 0, c.z);
                    void this.fx?.spawn({ id: GALFX_RING_PARTICLES.outer, duration: GALFX_RING.spawnFrames }, () => p, false, true);
                  }
                },
                slot: (k, at) => {
                  slots[k]?.set(at.x, at.y, at.z);
                },
              };
            })(),
            throwMinion: (origin, offset, target, slot) => {
              this.galMinions.throw(origin, offset, target, slot);
            },
            ground: (x, z, y) => {
              const gy = this.opts.ground?.(x, z, y) ?? null;
              return gy === null ? null : { y: gy };
            },
          });
        } else if (profile) {
          const aiOpts: ConstructorParameters<typeof EnemyAi>[0] = {
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
          // The spawn animation branch: booma_constructor (0x00535f1c) writes the
          // current_target == 1 test value, so every Booma (floor or wave) animates.
          // Booma: the spawn animation; Shark and Dimenian: their spawn timer (AI_PROFILES.spawnTimer).
          // The timed spawn's gate is +0x398 == 1 on the first tick (DorphonProcessAttackPhase
          // 0x005ad51c sub 0). Shark: its ctor writes 1 (0x00512ed4). Dimenian: its ctor writes 0,
          // and nothing before that first tick writes 1 (the only 1-writer in its vtable is
          // EnableDerolleEntity 0x005517a0, reached only through unknown_booma_enemy_ai state 9),
          // so a fresh Dimenian takes the no-effect branch (spawn: false).
          spawn: className !== 'TObjEneDimedian',
          };
          // The Goran family: the warp roll (state 3) and the leap (state 10), combat/goranai.ts.
          // Its rows: MovementData 17 + subtype, AttackData 17 + subtype and 20 + subtype.
          ai = className === 'GoranFamily'
            ? new GoranAi({
                ...aiOpts,
                warp: goranWarpRow(
                  params && mi !== null ? params.movement(difficulty, 17 + subtype) : null,
                  params?.attack(difficulty, 17 + subtype).distanceX,
                  params?.attack(difficulty, 20 + subtype).distanceX,
                ),
                initdata3: setParams[2],
                rng: () => this.rng(),
                attack,
              })
            : new EnemyAi(aiOpts);
        }
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
        ...(params && def && def.stats.length ? { blood: params.bloodOffset(difficulty, def.stats[0]) } : {}),
      });
    }
    this.difficultyParams = { params, difficulty, slots, base };
    for (const rt of [...this.enemies.values()]) if (rt.ai instanceof SorcererAi) void this.spawnSorcererBits(rt, rt.ai);
    this.buildGunnerGroups(slots, base);
    await this.spawnSplitters();
    if (this.disposed || token !== this.enterToken) return;
    await this.spawnVolopt();
    if (this.disposed || token !== this.enterToken) return;
    await this.spawnDeRolLeSegments();
    await this.spawnBarbaParts();
    if (this.disposed || token !== this.enterToken) return;
    await this.spawnSaintMilion();
    if (this.disposed || token !== this.enterToken) return;
    await this.spawnDarkFalz();
    if (this.disposed || token !== this.enterToken) return;
    // HP follows the player across floors (a warp does not heal); it is only
    // refilled when the character's max HP is not known yet or changed.
    const s = this.selfStats();
    const progression = await this.ensureProgression();
    if (this.disposed) return;
    const maxHp = progression?.maxHp ?? (s.hp || 1);
    this.damage.reset(maxHp, this.damage.maxHp === maxHp && !this.damage.dead ? this.damage.hp : maxHp);
    // A new floor: no dead markers or remote status effects carry over.
    for (const id of [...this.souls.keys()]) this.showSoul(id, false);
    this.remoteStatus.clear();
    this.remoteBuffs.clear();
    this.pbSlots.reset();
    if (progression && this.tp === 0) this.tp = progression.maxTp;
    this.opts.log(
      `combat: ${this.enemies.size} enemies on floor ${floor} (entities 0x${(0x1000 | base).toString(16)}+), ` +
        `${withStats} with battle params, ${withAi} with AI; you have ${this.damage.hp} HP`,
    );
  }

  // --- local player ----------------------------------------------------------

  // A hotbar key (slot i = key i + 1, key 0 = slot 10): the action of hotbar_slots[i].
  private pressHotbar(i: number): void {
    const slot = this.opts.hotbarSlot?.(i) ?? null;
    const act: HotbarAction = hotbarAction(slot);
    switch (act.kind) {
      case 'attack':
        this.press(act.type as AttackType);
        return;
      case 'technique':
        this.castTechnique(act.tech);
        return;
      case 'item':
        this.useSlotItem(act.group2);
        return;
      case 'trap':
        this.placeTrap?.(act.trap);
        return;
      case 'photon':
        this.firePhotonBlast(act.slot);
        return;
      case 'quest':
        this.opts.log(`hotbar ${i + 1}: the quest function is not ported`);
        return;
      case 'none':
        return;
    }
  }

  // Group 1 = 4 (not a trap): the item of palette item index group2 is used from the bag
  // (6x27, net/items.ts). CanPerformAction_0068aa8c: the player is not dead and the map is not
  // a safe one (is_current_map_safe = 0; the cities refuse it). The lobby test is in fieldhud.
  private useSlotItem(group2: number): void {
    if (!this.game.self || !this.view) return;
    if (this.damage.busy || this.damage.dead || this.cast || this.attack?.active) return;
    if (!inUnsafeMap(this.area)) return;
    this.opts.useItem?.(group2);
  }

  private frame(dt: number, keys: ReadonlySet<string>): void {
    if (this.disposed) return;
    this.frameKeys = keys;
    const me = this.game.self;
    const view = this.view;
    // The freeze mash (combat/status.ts mash): a movement key newly down this frame,
    // or a flick of the touch stick (the exe's stick branch of the same check).
    // The key config's movement keys, read now (not at load): none with Keyboard Controls OFF.
    const moveDown = [KEYS.moveForward, KEYS.moveBackward, KEYS.moveLeft, KEYS.moveRight].filter((k) => k !== '' && keys.has(k));
    const moved = moveDown.some((k) => !this.heldMove.has(k));
    this.heldMove = new Set(moveDown);
    const flicked = this.stickFlick.step(analogStick());
    if ((moved || flicked) && this.area !== 0 && !this.damage.dead) this.status.mash(true);
    if (me && view) {
      const blocked = this.damage.busy || this.status.immobile;
      for (const [key, index] of PALETTE_KEYS) {
        // The channel's edge is kept per channel, so Tab and the bound Left key are one press.
        const chan = `palette:${index}`;
        const down = paletteChannelDown(keys, key, index) !== '';
        if (down && !this.held.has(chan) && !blocked) {
          const slot = this.opts.paletteSlot?.(index) ?? DEFAULT_SLOTS[index];
          // The Middle key (palette_slots[0], 1-based slot 1, input/keyconfig.ts): an NPC or
          // floor item in the weapon's reach replaces the attack.
          if (index === 0 && this.opts.interactMiddle?.(this.middleReach(slot)) === true) {
            // taken by the interaction (talk or pick up)
          } else if (slot && !slot.disabled && slot.group1 === 2 && slot.group2 <= 2) this.press(slot.group2 as AttackType);
          else if (slot && !slot.disabled && slot.group1 === 3) this.castTechnique(slot.group2);
          else if (slot && !slot.disabled && slot.group1 === 5) this.firePhotonBlast(slot.group2);
          else if (slot && !slot.disabled && slot.group1 === 4 && trapPaletteType(slot.group2) !== null) this.placeTrap?.(trapPaletteType(slot.group2)!);
          else if (slot && !slot.disabled && slot.group1 === 4) this.useSlotItem(slot.group2);
          else if (slot && slot.group1 !== 0) this.opts.log(`palette slot ${index} (${slot.group1}, ${slot.group2}): not wired yet`);
        }
        if (down) this.held.add(chan);
        else this.held.delete(chan);
      }
      // The bottom hotbar: keys 1..0 (hotbar_slots[0..9]), skipped while Shift, Alt or Ctrl is held
      // (unknown_handle_palette_inputs, dump 555862).
      const modifier = keys.has('shift') || keys.has('alt') || keys.has('control');
      for (let i = 0; i < HOTBAR_KEYS.length; i++) {
        const key = HOTBAR_KEYS[i];
        if (!key) continue;
        const down = keys.has(key);
        if (down && !this.held.has(key) && !blocked && !modifier) this.pressHotbar(i);
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
        if (e.death && this.deathSteps(e, dt, ended)) {
          this.dropDead(index, e);
          continue;
        }
        // A death plan that has steps or a dissolve left owns the removal.
        const planBusy = !!e.death && (!e.death.run.finished || !!e.death.dissolve || e.death.fade);
        if (ended && e.removeIn <= 0 && !e.fake && !planBusy && e.instance.spec.name === 'TObjEneLappy') {
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
        // A dead Gibbles goes once it has sunk (tickGibblesSink).
        if (ended && e.removeIn <= 0 && !e.fake && !planBusy && !(e.ai instanceof GibblesAi)) this.dropDead(index, e);
      }
    }
    // Game ticks (30 per second) drive the enemy AI and the player's hit state.
    this.tickRemainder += dt * GAME_TICKS_PER_SECOND;
    let ticks = Math.floor(this.tickRemainder);
    this.tickRemainder -= ticks;
    ticks = Math.min(ticks, 5); // a long frame must not run the AI away
    for (let i = 0; i < ticks; i++) {
      this.tickEnemies();
      // The Gal Gryphon's minions (combat/galgryphon.ts): the launchers make the
      // homing Effects, which home on the party and draw their radar icons.
      if (this.galMinions.active && this.opts.ground) {
        this.galMinions.update(this.aiTargets(), this.opts.ground, (at) => this.galgryphonAttack(at));
      }
      this.damage.tick();
      this.tickStatus();
      this.tickRemoteStatus();
      this.tickTechHits();
      this.tickGunBullets();
      this.tickFire();
      this.techObjects?.tick();
      this.tickBuffs();
    }
    this.tickClock.advance(ticks, this.tickRemainder);
    this.tracers?.frame(this.tickRemainder);
    this.updateLockOn();
    this.overlay?.update(dt);
    this.updateHpReadout();
    // The death fade: red, alpha growing to 0x80 (combat/playerdamage.ts).
    if (this.hud) this.hud.tint = this.damage.fade > 0 ? ((this.damage.fade << 24) | 0xff0000) >>> 0 : 0;
    this.hud?.frame(dt, this.hudValues(), this.game.selfId, (slot) => this.partyValues(slot));
  }

  // The enemy type (newserv name) of an enemy entity id (0x1000 | index), null for
  // anything else or an enemy that is gone (FindEntityById_007b4d18 in the exe).
  enemyTypeOf(entityId: number): string | null {
    if ((entityId & 0xf000) !== 0x1000) return null;
    return this.enemies.get(entityId & 0x0fff)?.slot.type ?? null;
  }

  // Whether a player of this game is dead (Challenge Mode's
  // cmode_check_*_player_dead read is_player_dead for every slot).
  isPlayerDead(clientId: number): boolean {
    if (clientId === this.game.selfId) return this.damage.dead;
    return this.deadPlayers.has(clientId) || (this.party.get(clientId)?.dead ?? false);
  }

  // The local character changed under the combat (a Challenge Mode template
  // replaced it, quest/cmodeoverlay.ts): read level, EXP and stats again.
  async reloadProgression(): Promise<void> {
    this.progression = null;
    const p = await this.ensureProgression();
    if (!p) return;
    this.damage.maxHp = p.maxHp;
    this.damage.reset(p.maxHp, p.maxHp);
    this.tp = p.maxTp;
  }

  // Material use (03 0B xx, combat/materials.ts), the item use's check and
  // change. The progression owns the stats; storeProgression writes them back.
  materialUsable(kind: number): boolean {
    return this.progression?.materialUsable(kind) ?? false;
  }

  // The max HP / TP follow the bonus; the current HP and TP are not refilled
  // (ASSUMED, see combat/materials.ts).
  useMaterial(kind: number, challenge: boolean): void {
    const p = this.progression;
    if (!p || !p.useMaterial(kind, challenge)) return;
    this.damage.maxHp = p.maxHp;
    this.storeProgression();
  }

  // After the return to Pioneer 2 (GameView.returnToPioneer2): the warp's
  // floor load already refilled the HP of a dead player (enterFloor). The TP
  // is refilled too (ASSUMED: PlayerRestoreHealthAndTP_0068fda4, full HP and TP).
  returnedToCity(): void {
    if (!this.damage.dead) return;
    this.damage.reset(this.damage.maxHp);
    if (this.progression) this.tp = this.progression.maxTp;
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
    // The remote copy's status slots (6x0C / 6x0D) and its Shifta / Deband slots, in
    // the order of the local window (slot 0, slot 1, attack, defense).
    const rs = this.remoteStatus.get(slot);
    // The photon blast icon comes first while the slot is in a blast (GetPhotonBlastData_0067e334).
    const statusIcons = [
      ...(this.pbSlots.active(slot) ? [STATUS_ICON_BLAST_FIRST] : []),
      ...(rs ? rs.types().map(statusIcon) : []),
      ...(this.remoteBuffs.get(slot)?.icons() ?? []),
    ];
    return { name: p.name, level: p.level, hp: m.hp, maxHp: m.maxHp, dead: m.dead || this.deadPlayers.has(slot), nameColor: p.nameColor, statusIcons };
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
      // The photon blast icon comes first while the local slot is in a blast (10 + the
      // player's index in the blast list, ASSUMED 0: the caster is the only participant).
      statusIcons: [
        ...(this.pbSlots.active(this.game.selfId) ? [STATUS_ICON_BLAST_FIRST] : []),
        ...this.status.types().map(statusIcon),
        ...this.selfBuffs.icons(),
      ],
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
    for (const [id, b] of this.remoteBuffs) {
      for (const s of b.tick()) this.opts.log(`player ${id}: ${buffName(s.type)} wore off`);
      if (!b.attack.type && !b.defense.type) this.remoteBuffs.delete(id);
    }
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
  // `damageTaken`: the 6x0A total when it is not max - hp (De Rol Le).
  private sendEnemy(e: EnemyRuntime, flags: number, damageTaken = e.stats.maxHp - e.stats.hp): void {
    const sync = e.status.syncBits(this.ultimate);
    if (sync.ultimateBits) this.game.sendEnemyStatusUltimate(e.index, sync.ultimateBits);
    this.game.sendEnemyState(e.index, damageTaken, flags | sync.flags);
  }

  // An effect landed on an enemy (vtable +0xbc / +0xc4 / +0xc8 / +0xcc).
  private inflictEnemy(e: EnemyRuntime, type: StatusType, what: string): boolean {
    if (e.dead || !e.status.inflict(type)) {
      this.opts.log(`${what}: E-${e.index.toString(16)} (${e.slot.type}) resists ${STATUS_NAME[type]}`);
      return false;
    }
    this.statusFx(e, type, false);
    if (e.status.locked) this.lockEnemy(e, true);
    this.opts.log(`${what}: E-${e.index.toString(16)} (${e.slot.type}) ${STATUS_NAME[type]} (${e.status.describe()})`);
    return true;
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
      out.push({ clientId: id, x: pos.x, y: pos.y, z: pos.z, charClass: p.charClass, dead: false, angle: id === this.game.selfId ? (this.game.self?.angle ?? p.angle) : p.angle, attacking });
    }
    return out;
  }

  // Where the live enemies of the floor stand, for their radar icons. The exe's
  // baseline for the ordinary families is the enemy-base slot (classic/minimap.ts
  // baseIconShown: icon unless the entity flags have 0x800 (dead) or 0x40000 (radar
  // hidden, set by +0x184)), called from the family's own update (Mericarol +0x198,
  // Gibbon vtable 0x00b05740 +0x198; classic/minimap.ts ENEMY_RADAR_SOURCE 'slot'). The port's dead / death / radar / concealed tests read those bits.
  // The Booma family adds its icon per state (boomaIconShown), not through the slot:
  // boomaBrainIconShown maps the brain's state to the exe's (spawn 0, idle 1, notice and
  // chase 3, attack and recover 5, dead 8): a spawning Booma (the spawn animation, then
  // idle) has no icon (classic/minimap.ts BOOMA_BRAIN_EXE_STATE).
  minimapEnemies(): { x: number; z: number; type: string }[] {
    const out: { x: number; z: number; type: string }[] = [];
    for (const e of this.enemies.values()) {
      // A Vol Opt rod's icon is not tied to its model: it shows while the control (its parent) does.
      const onField = e.instance.root.visible || (e.ai instanceof VoloptPartAi && voloptRadar(e.ai) === 'always' && !!e.parent?.instance.root.visible);
      if (e.dead || e.state === 'death' || !onField || radarConcealed(e) || !splitRadarOk(e)) continue;
      // Garanz draws no radar icon (classic/minimap.ts ENEMY_RADAR_SOURCE 'none').
      if (radarSourceOf(e.slot.type) === 'none') continue;
      // Zu / Pazuzu: update_zu draws the icon only while +0x390 bit 0x40000 is clear (PROVEN 0x005b28bc).
      if (e.ai instanceof ZuAi && e.ai.radarHidden) continue;
      // Claw: its icon is off while its hidden flag (+0x390 bit 0x10000000) is set.
      if (e.ai instanceof ClawAi && e.ai.hidden) continue;
      // A timed spawn (Shark, Dimenian) keeps its radar icon: the spec's trace found no change in the spawn.
      if (BOOMA_BRAIN_TYPES.has(e.slot.type) && e.ai instanceof EnemyAi && !(e.ai.timedSpawn && e.ai.state === 'spawn') && !boomaBrainIconShown(e.ai.state)) continue;
      // The Dark Gunner's icon follows its state (classic/minimap.ts DARK_GUNNER_BRAIN_EXE_STATE);
      // a timed status (paralysis, freeze, shock or the hold) adds one in any state (the update's
      // timed-status branch, which skips the dispatcher).
      // The flinch (owner damage state, exe state 4 = 0x00544704) shows the icon in any brain state.
      if (e.slot.type === 'DARK_GUNNER' && e.ai instanceof GunnerAi && !e.status.locked && !darkGunnerBrainIconShown(e.state === 'damage' ? 'flinch' : e.ai.state)) continue;
      // Dark Falz's forms have their own forced icons (minimapIcons); a ring Darvant's plain icon
      // is in this list only while its box is on (its forced icon is in minimapIcons).
      if (e.ai instanceof DarkFalzPartAi) {
        if (e.ai.entity === DF_ID.form1 || e.ai.entity === DF_ID.form2 || e.ai.entity === DF_ID.form3) continue;
        if (e.ai.part instanceof Darvant && e.ai.part.kind === 'ring' && darvantRingIcon(e.ai.part) !== 'plain') continue;
      }
      const p = e.instance.root.position;
      // A De Rol Le segment keeps the body's slot type, but its icon is its own (classic/minimap.ts FORCED_ICON_RULES).
      out.push({ x: p.x, z: p.z, type: e.ai instanceof DrlSegmentAi ? 'DE_ROL_LE_BODY' : e.slot.type });
    }
    return out;
  }

  // The forced icons of the Dark Falz form 1 body, heads and ring
  // (combat/darkfalz1.ts minimapIcons) and of the form 3 body and its prisoner
  // trail (combat/darkfalz3.ts minimapIcons), and each ring Darvant's forced icon
  // while its box is off (darvantRingIcon). The exe's form icons are not gated by
  // state or death (the update calls icon3 every frame), so only the part's drawn
  // flag gates them here.
  minimapIcons(): Icon[] {
    const out: Icon[] = [];
    // One set of icons per form and fight (the parts share their owner).
    const seen = new Set<string>();
    for (const e of this.enemies.values()) {
      if (!(e.ai instanceof DarkFalzPartAi)) continue;
      if (!e.instance.root.visible) continue;
      if (e.ai.part instanceof Darvant) {
        if (e.ai.part.kind !== 'ring' || darvantRingIcon(e.ai.part) !== 'forced') continue;
        const p = e.instance.root.position;
        out.push({ x: p.x, z: p.z, color: DARVANT.forcedIconColour, shape: 1, scale: DARVANT.forcedIconScale, heading: 0 });
        continue;
      }
      if (e.ai.entity !== DF_ID.form3 && e.ai.entity !== DF_ID.form1) continue;
      const owner = e.ai.owner;
      if (e.ai.entity === DF_ID.form1) {
        if (seen.has('f1')) continue;
        seen.add('f1');
        out.push(...(owner.form1?.minimapIcons() ?? []));
      } else {
        if (seen.has('f3')) continue;
        seen.add('f3');
        out.push(...(owner.form3?.minimapIcons() ?? []));
      }
    }
    // Form 2's beam balls (combat/darkfalz2.ts minimapIcons): forced 2.5 icons
    // on the tick that threw them. Form 2 has no part enemy, so it is read from
    // the control.
    const head = this.falzHead;
    if (head?.ai instanceof DarkFalzAi) out.push(...(head.ai.form2?.minimapIcons() ?? []));
    // The Gal Gryphon minion Effects (combat/galgryphon.ts): forced 1.5 icons in their MOVE state.
    out.push(...this.galMinions.minimapIcons());
    return out;
  }

  private tickEnemies(): void {
    const targets = this.aiTargets();
    for (const e of [...this.enemies.values()]) {
      // Vol Opt's body is stood up by the control whatever its wave says (it
      // sits in the second arena; the control waits for it).
      if (e.ai instanceof VoloptForm2Ai && e.ai.isAwake && !e.dead) e.instance.root.visible = true;
      // A splitter's children appear with their set entry's wave.
      if ((e.ai instanceof PanHalfAi || e.ai instanceof SlimeAi) && e.parent && this.enemies.get(e.parent.index) === e.parent) {
        e.instance.root.visible = e.parent.instance.root.visible;
      }
      // A dead Gibbles sinks into the ground, then goes (tickGibblesSink).
      if (e.ai instanceof GibblesAi && e.state === 'death') {
        this.tickGibblesSink(e, e.ai);
        continue;
      }
      // The Gol Dragon after its kill (state 0x15 leave): its brain still runs state 0x17 (the children's
      // timers) until the body is removed, so the exit of 0x17 happens on this client too.
      if (e.ai instanceof GoldDragonAi && e.dead && !e.ai.dead && e.instance.root.visible) {
        this.tickGol(e, e.ai, targets);
        continue;
      }
      // A killed Monest keeps its states until its kill (set_monest_dead runs
      // on every tick while it is dead).
      if (e.monest?.isDying && e.instance.root.visible) {
        this.tickMonest(e, e.instance.animators.length > 0 && e.instance.animators.every((a) => a.ended));
        continue;
      }
      // The Gal Gryphon's brain keeps running after its kill: the death script (S5's leave, then the
      // remove state 34) is the brain's, so it ticks until the body is gone.
      if (e.ai instanceof GalgryphonAi && e.dead && !e.ai.gone && e.instance.root.visible) {
        this.tickGalgryphon(e, e.ai, targets);
        continue;
      }
      if (e.dead || !e.instance.root.visible) continue;
      // The status block of update_enemy_control_object (combat/enemystatus.ts).
      if (e.status.active) {
        const st = e.status.tick();
        for (const t of st.ended) this.opts.log(`${STATUS_NAME[t]} on E-${e.index.toString(16)} wore off`);
        for (const t of st.pulses) this.statusFx(e, t, true);
        this.lockEnemy(e, st.locked);
        if (st.locked) continue;
      }
      // An enemy whose wave has not spawned is not in the room yet.
      if (e.state !== 'idle') continue;
      const ended = e.instance.animators.length > 0 && e.instance.animators.every((a) => a.ended);
      if (e.monest) {
        this.tickMonest(e, ended);
        continue;
      }
      const ai = e.ai;
      if (!ai) continue;
      if (ai instanceof OlgaFlowAi) {
        this.tickOlga(e, ai, targets);
        continue;
      }
      if (ai instanceof GalgryphonAi) {
        ai.setHp(e.stats.hp, e.stats.maxHp);
        this.tickGalgryphon(e, ai, targets);
        continue;
      }
      if (ai instanceof DeRolLeAi) {
        this.tickDeRolLe(e, ai, targets);
        continue;
      }
      if (ai instanceof DragonAi) {
        this.tickDragon(e, ai, targets);
        continue;
      }
      if (ai instanceof GoldDragonAi) {
        this.tickGol(e, ai, targets);
        continue;
      }
      if (ai instanceof SaintMilionAi) {
        this.tickSaintMilion(e, ai, targets);
        continue;
      }
      // A part's or a tentacle's enemy is moved by the body (tickSaintMilion).
      if (ai instanceof SmChildAi) continue;
      if (ai instanceof VoloptAi) {
        this.tickVolopt(e, ai, targets);
        continue;
      }
      if (ai instanceof VoloptForm2Ai) {
        this.tickVoloptForm2(e, ai, targets);
        continue;
      }
      if (ai instanceof DarkFalzAi) {
        this.tickDarkFalz(e, ai, targets);
        continue;
      }
      // A form's or a Darvant's enemy is moved by the control (syncDarkFalz).
      if (ai instanceof DarkFalzPartAi) continue;
      // A part's enemy is moved by the control (syncVolopt).
      if (ai instanceof VoloptPartAi) continue;
      // A De Rol Le segment's enemy is moved by the body (tickDeRolLe).
      if (ai instanceof DrlSegmentAi) continue;
      // A Barba Ray part is moved by the body's rows (tickBarbaParts).
      if (ai instanceof BarbaPartAi) continue;
      if (ai instanceof BarbaRayAi) {
        this.tickBarbaParts(e, ai);
        ai.input = this.barbaInput();
      }
      if (ai instanceof DelbiterAi) ai.hpFraction = e.stats.hp / Math.max(1, e.stats.maxHp);
      if (ai instanceof DubwitchAi) ai.linkedDead = this.dubwitchWake(e);
      if (ai instanceof SinowZoaAi) ai.disrupted = e.status.has(STATUS.freeze) || e.status.has(STATUS.shock);
      if (ai instanceof LilyAi) ai.setHp(e.stats.hp, e.stats.maxHp);
      if (ai instanceof GrassAi || ai instanceof NanoDragonAi || ai instanceof GaranzAi || ai instanceof BulclawAi || ai instanceof SorcererAi || ai instanceof MerilliaAi)
        ai.hpFraction = e.stats.hp / Math.max(1, e.stats.maxHp);
      if (ai instanceof GeeAi || ai instanceof GiGueAi || ai instanceof GibblesAi) ai.hpFraction = e.stats.hp / Math.max(1, e.stats.maxHp);
      // Confusion (entity+0x30 & 0x10): the families' target searches widen
      // to the other enemies (combat/enemyai.ts EnemyAi.confused,
      // combat/enemyfsmruins.ts updateTarget).
      const confused = e.status.has(STATUS.confusion);
      if ('confused' in ai) ai.confused = confused;
      if (ai instanceof GunnerAi) ai.frozenOrParalysed = e.status.has(STATUS.freeze) || e.status.has(STATUS.paralysis);
      if (ai instanceof BulclawAi) ai.candidates = this.clawsNear(e);
      if (ai instanceof PanArmsAi && (ai.state === 'split' || ai.state === 'merge')) e.stats.hp = this.panHalfHp(ai);
      if (ai instanceof PanArmsAi) ai.hpFraction = e.stats.hp / Math.max(1, e.stats.maxHp);
      if (ai instanceof PanHalfAi) ai.hpFraction = e.stats.hp / Math.max(1, e.splitHp ?? e.stats.maxHp);
      if (ai instanceof SorcererAi) this.sorcererFeed(e, ai);
      // The Recon's height is absolute (combat/enemyfsmep2d.ts): the ground under it
      // is the floor it is over, found the same way the placement below finds it.
      if (ai instanceof ReconAi) {
        const g = this.opts.ground?.(e.instance.root.position.x, e.instance.root.position.z, e.instance.root.position.y - e.lift + 30) ?? null;
        if (g !== null) ai.setGround(g);
      }
      const r = ai.tick(confused && CONFUSION_AWARE.has(e.instance.spec.name) ? [...targets, ...this.enemyTargets(e)] : targets, ended);
      if (ai instanceof BarbaRayAi) this.barbaDrain(e, ai);
      if (ai instanceof PigRayAi) this.pigDrain(e, ai);
      const root = e.instance.root;
      const lift = r.lift ?? e.lift;
      if (r.x !== root.position.x || r.z !== root.position.z || lift !== e.lift) {
        const y = this.opts.ground?.(r.x, r.z, root.position.y - e.lift + 30) ?? null;
        root.position.set(r.x, (y ?? root.position.y - e.lift) + lift, r.z);
        e.lift = lift;
      }
      root.rotation.y = r.angle;
      // A Recobox and its Recons: yaw, then the kind's tilt about X (derolleTiltX).
      if (ai instanceof RecoboxAi || ai instanceof ReconAi) {
        root.rotation.order = 'YXZ';
        root.rotation.x = ai.tiltX;
      }
      if (ai instanceof DeldepthAi) this.deldepthView(e, ai);
      if (ai instanceof SlimeAi) {
        this.slimeView(e, ai);
        // The stun's effect 0xe0 every 4th count (0x0050b510 at the body, +0x300).
        for (const fx of ai.effects.splice(0)) this.particle({ id: fx.id }, new THREE.Vector3(root.position.x, root.position.y + fx.dy, root.position.z));
      }
      if (ai instanceof MorfosAi) this.morfosView(e, ai, !!r.hidden);
      // Epsilon's motion goes to the part of the look that is shown (epsilonView).
      if (r.motion && !(ai instanceof EpsilonAi)) this.playEnemyMotion(e, r.motion);
      if (r.hit && r.hit.clientId >= 0x1000) this.enemyHitsEnemy(e, r.hit.clientId & 0xfff, r.hit.knockback, r.hit.mult);
      else if (r.hit) this.enemyHitsPlayer(e, r.hit.clientId, r.hit.knockback, r.hit.mult, r.hit.kbScale, r.hit.attack, r.hit.special);
      if (r.shots)
        for (const s of r.shots) {
          if (s instanceof MorfosBolt) this.morfosMuzzle(e, s);
          this.launchShot(e, s);
        }
      if (r.techHit && r.techHit.clientId === this.game.selfId) {
        const what = `E-${e.index.toString(16)} (${e.slot.type})`;
        const p = e.instance.root.position;
        this.enemyTechHitsPlayer(e, r.techHit.power, p.x, p.z, what);
        if (r.techHit.status && this.rng() <= r.techHit.status.chance) this.inflictStatus(r.techHit.status.type as StatusType, what);
      }
      if (r.tpDrain) this.drainTp(e, ai, r.tpDrain);
      if (r.heal) this.sorcererHeal(e, r.heal);
      if (ai instanceof SorcererAi) for (const id of ai.sounds.splice(0)) this.playSeAt(id, e.instance.root.position);
      if (ai instanceof SorcererBitAi && ai.takeRevive()) e.stats.hp = e.stats.maxHp; // back at full HP after 900 frames down
      if (ai instanceof BulclawAi) for (const ev of ai.events.splice(0)) this.bulclawEvent(e, ai, ev);
      if (ai instanceof RecoboxAi) for (const sp of ai.spawns.splice(0)) void this.spawnRecon(e, ai, sp);
      if ((ai instanceof ReconAi && ai.removed) || (ai instanceof EpsigardAi && ai.state === 'gone')) this.dropQuietly(e);
      if (ai instanceof GibbonAi)
        for (const c of ai.casts.splice(0)) this.buffEnemy(e, c.tech === 'shifta' ? GROUP.shifta : GROUP.deband, supportPower(c.level), `E-${e.index.toString(16)} (${e.slot.type}) enrage`, false);
      if (ai instanceof SinowAi) this.sinowTick(e, ai);
      if (ai instanceof BelraAi) this.belraTick(e, ai);
      if (ai instanceof SinowZoaAi)
        for (const b of ai.buffs.splice(0)) if (b.clientId === this.game.selfId) this.applySelfBuff(b.tech === 'jellen' ? GROUP.jellen : GROUP.zalure, supportPower(b.level), `E-${e.index.toString(16)} (${e.slot.type})`);
      if (ai instanceof PanArmsAi) for (const ev of ai.events.splice(0)) this.panEvent(e, ai, ev);
      // Gi Gue's Jellen / Zalure casts (combat/enemyfsmep2a.ts).
      if (ai instanceof GiGueAi && ai.events.length)
        for (const ev of ai.events.splice(0))
          if (ev.clientId === this.game.selfId) this.applySelfBuff(ev.tech === 'jellen' ? GROUP.jellen : GROUP.zalure, supportPower(ev.level), `E-${e.index.toString(16)} (${e.slot.type})`);
      // The Barbarous Wolf's howl: its sound at the wolf, and Jellen / Zalure on this player.
      // The alive Rappy's wander pause and lunge hit sounds (combat/enemyfsm.ts RappyAi).
      if (ai instanceof RappyAi) for (const id of ai.sounds.splice(0)) this.playSeAt(id, root.position);
      if (ai instanceof WolfAi) {
        for (const id of ai.sounds.splice(0)) this.playSeAt(id, root.position);
        for (const c of ai.casts.splice(0))
          if (c.clientId === this.game.selfId) this.applySelfBuff(c.tech === 'jellen' ? GROUP.jellen : GROUP.zalure, c.power, `E-${e.index.toString(16)} (${e.slot.type})`);
      }
      if (ai instanceof PanHalfAi && ai.buff && ai.buff.clientId === this.game.selfId) {
        const b = ai.buff;
        this.applySelfBuff(b.tech === 'jellen' ? GROUP.jellen : GROUP.zalure, supportPower(b.level), `E-${e.index.toString(16)} (${e.slot.type})`);
      }
      if (ai instanceof BulclawAi && !ai.bulk && this.bulclawPending.delete(e)) void this.swapBulclawModel(e, ai);
      // A Pofuilly Slime's parts are placed by slimeView (the body is drawn at alpha > 0, not by `hidden`);
      // a Morfos's by morfosView (its arm has its own life).
      if (r.hidden !== undefined && !(ai instanceof SlimeAi) && !(ai instanceof MorfosAi)) for (const c of root.children) c.visible = !r.hidden;
      // The Shark / Dimenian timed spawn (combat/enemyai.ts tickSpawnTimer): its sound at the enemy, then its particles.
      if (r.spawnFx) {
        this.playSeAt(r.spawnFx.sound, root.position);
        for (const fx of r.spawnFx.effects) this.particle({ id: fx.id }, new THREE.Vector3(root.position.x, root.position.y + fx.dy, root.position.z));
      }
      if (ai instanceof EpsilonAi) for (const ev of ai.events.splice(0)) this.playSeAt(ev.id, root.position);
      // The Grass Assassin's emerge (the abeast spawn sound and particles) and
      // the Nano Dragon's power-up charge (sound 0x111, particle 0xfa).
      if (ai instanceof GrassAi || ai instanceof NanoDragonAi) {
        for (const id of ai.sounds.splice(0)) this.playSeAt(id, root.position);
        for (const fx of ai.effects.splice(0)) this.particle({ id: fx.id }, new THREE.Vector3(root.position.x, root.position.y + fx.dy, root.position.z));
      }
      if (ai instanceof EpsilonAi) this.epsilonView(e, ai, r);
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
      // The low-HP spin's bob / blast sounds (combat/enemyfsm.ts LilyAi); the
      // blast leaves the Lily dead (its state 10: the kill as usual).
      if (ai instanceof LilyAi) {
        for (const id of ai.takeSe()) this.playSeAt(id, root.position);
        if (ai.exploded && !e.dead) this.killEnemy(e, FLAG_DEAD);
      }
    }
    this.tickSpits(targets);
    this.tickShots(targets);
    this.tickFakeDeaths(targets);
    this.tickRevives();
    this.tickGunnerControls(targets);
    if (this.holdTicks > 0 && --this.holdTicks === 0) this.opts.log('hold released');
  }

  // --- De Rol Le (combat/derolle.ts) -------------------------------------------

  // render_derolle's node captures (UpdateDerolleTransformationMatrix
  // _0042a904): each shell segment slot is the midpoint of two captured
  // draw-order nodes (0x008fcba0), the tentacles hang from draw indices
  // 0x1d..0x20. ASSUMED: the draw order is the model's depth-first node order
  // and the 10 slots pair the first 11 captures.
  private static readonly DRL_SPINE = [24, 26, 28, 29, 30, 31, 34, 69, 74, 95, 96];
  private static readonly DRL_ATTACH = [0x1d, 0x1e, 0x1f, 0x20];
  private drlBeam: THREE.Line | null = null;
  // Per De Rol Le (by enemy index): the node and part references, looked up
  // once, and the point arrays the brain reads, reused every tick.
  private drlViews = new Map<number, DrlView>();
  // Whether the last hit on a De Rol Le was the local player's (its
  // last_attacker, +0x2d8): that client asks for the killer's EXP.
  private drlLastHitLocal = new Map<number, boolean>();

  private drlView(e: EnemyRuntime, ai: DeRolLeAi): DrlView {
    let v = this.drlViews.get(e.index);
    if (v) return v;
    const inst = e.instance;
    const body = inst.nodes?.[0] ?? [];
    const world = inst.world;
    const spine = CombatView.DRL_SPINE.map((i) => body[i] ?? null);
    const attach = CombatView.DRL_ATTACH.map((i) => body[i] ?? null);
    v = {
      spine: spine.every((n) => n) ? (spine as THREE.Object3D[]) : null,
      attach: attach.every((n) => n) ? (attach as THREE.Object3D[]) : null,
      tentacles: ai.tentacles.map((_, i) => world?.getObjectByName(`tentacle ${i}`) ?? null),
      stings: ai.stings.map((s) => world?.getObjectByName(s.kind === 0 ? `sting ${s.index}` : `sting ring ${s.index}`) ?? null),
      bodyAnimators: inst.animators.filter((_, k) => !inst.parts[k]?.name),
      segs: Array.from({ length: 10 }, (): Vec3 => [0, 0, 0]),
      atts: Array.from({ length: 4 }, (): Vec3 => [0, 0, 0]),
      drawn: false,
      fins: [0, 1].map((c) =>
        [0, 1, 2, 3, 4].map((j) => {
          const g = world?.getObjectByName(j === 4 ? `fin ${c} tip` : `fin ${c} ${j}`) ?? null;
          if (g) g.rotation.order = 'YXZ';
          return g;
        }),
      ),
      finAt: [[0, 0, 0], [0, 0, 0]],
      helmNode: body[77] ?? null,
      // draw index 77 is the helm locator (the table's captures 0x4d..0x58
      // are exactly the 12 nodes under it); its children are the helm.
      helmCut: (body[77]?.children ?? []).filter((n) => body.includes(n)),
      helmDebris: this.drlDebrisView(inst, 'helm debris'),
      shellDebris: Array.from({ length: 10 }, (_, i) => this.drlDebrisView(inst, `shell debris ${i}`)),
      segProxies: ai.segmentParts.map((): EnemyRuntime | null => null),
      segPlates: ai.segmentParts.map((_, i) => [body[1 + 2 * i], body[2 + 2 * i]].filter((n): n is THREE.Object3D => !!n)),
      segMats: ai.segmentParts.map((_, i) => plateMaterials(inst.root, 1 + 2 * i)),
    };
    // The debris pieces are the child nodes of helm_break / shell_break.
    const records = (d: DrlDebrisView | null, shell: boolean) =>
      drlPieceRecords(d ? d.bones.slice(1).map((b): Vec3 => [b.position.x, b.position.y, b.position.z]) : [], shell);
    const shellView = v.shellDebris.find((d) => d) ?? null;
    if (v.helmDebris && shellView) ai.pieceRecords = { helm: records(v.helmDebris, false), shell: records(shellView, true) };
    this.drlViews.set(e.index, v);
    return v;
  }

  // The group and nodes of a hidden debris part (null: not in the spec).
  private drlDebrisView(inst: EnemyInstance, name: string): DrlDebrisView | null {
    const k = inst.spec.parts.findIndex((p) => p.name === name);
    const group = inst.world?.getObjectByName(name) ?? null;
    const bones = k >= 0 ? inst.nodes?.[k] : undefined;
    return group && bones ? { group, bones } : null;
  }

  private tickDeRolLe(e: EnemyRuntime, ai: DeRolLeAi, targets: AiTarget[]): void {
    const inst = e.instance;
    const root = inst.root;
    const v = this.drlView(e, ai);
    // render_derolle captures the node matrices while it draws, and the
    // update reads them on the next frame: here the world matrices the last
    // render left (no extra matrix update). Not before the first draw.
    if (v.drawn && v.spine) {
      const m = v.spine;
      for (let i = 0; i < 10; i++) {
        const a = m[i].matrixWorld.elements;
        const b = m[i + 1].matrixWorld.elements;
        const s = v.segs[i];
        s[0] = (a[12] + b[12]) / 2;
        s[1] = (a[13] + b[13]) / 2;
        s[2] = (a[14] + b[14]) / 2;
      }
      ai.segments = v.segs;
    }
    if (v.drawn && v.attach) {
      v.attach.forEach((n, i) => {
        const a = n.matrixWorld.elements;
        const p = v.atts[i];
        p[0] = a[12];
        p[1] = a[13];
        p[2] = a[14];
      });
      ai.attaches = v.atts;
    }
    // The fin chains' anchors are the captures 1 and 10 of the same table
    // (nodes 26 and 96); the helm break takes the capture of node 77.
    if (v.drawn && v.spine) {
      for (let c = 0; c < 2; c++) {
        const a = v.spine[c === 0 ? 1 : 10].matrixWorld.elements;
        const p = v.finAt[c];
        p[0] = a[12];
        p[1] = a[13];
        p[2] = a[14];
      }
      ai.finAnchors = v.finAt;
    }
    if (v.drawn && v.helmNode) ai.helmMatrix = v.helmNode.matrixWorld.elements;
    v.drawn = root.visible;
    const r = ai.tick(targets);
    root.position.set(r.x, r.y ?? root.position.y, r.z);
    root.rotation.order = 'YXZ';
    root.rotation.set(0, r.angle, (((ai.roll + 0x8000) & 0xffff) - 0x8000) * BAMS_TO_RAD);
    // The body's motion is the brain's (+0xb8 / +0xc0): only the body part's
    // animator plays it, held at the brain's frame.
    for (const a of v.bodyAnimators) {
      if (r.motion) {
        try {
          a.play(inst.archive.motion(r.motion.index, a.nodeCount), r.motion.speed, r.motion.loop);
        } catch (err) {
          this.opts.log(`De Rol Le motion ${r.motion.index}: ${(err as Error).message}`);
        }
      }
      a.paused = true;
      a.setFrame(ai.mframe);
    }
    // Flag 0x40: render_derolle draws the body without the helm nodes (the
    // pieces fly as the helm debris); the nodes collapse to a point.
    if (ai.helmCut) for (const n of v.helmCut) n.scale.setScalar(0.0001);
    this.syncDeRolLeSegments(e, ai, v);
    for (const s of r.shots ?? []) this.launchShot(e, s);
    for (const ev of ai.events.splice(0)) {
      this.drlEvent(e, ai, ev);
      if (ev.kind === 'remove') return;
    }
    this.drawDeRolLeChildren(e, ai, v);
  }

  private drlMat = newMat();
  private drlM4 = new THREE.Matrix4();

  // The fin chains (0x00434d34) and the debris pieces (0x0042a034 /
  // 0x00429bc0) as the matrices combat/derollefins.ts builds for them.
  private drawDeRolLeFins(e: EnemyRuntime, ai: DeRolLeAi, v: DrlView): void {
    const fins = e.instance.root.visible && ai.fins.active;
    for (let c = 0; c < 2; c++) {
      for (let j = 0; j < 5; j++) {
        const g = v.fins[c][j];
        if (!g) continue;
        g.visible = fins;
        if (!fins) continue;
        this.drlM4.fromArray(ai.fins.segmentMatrix(this.drlMat, c, j));
        this.drlM4.decompose(g.position, g.quaternion, g.scale);
      }
    }
    this.drawDrlDebris(ai.helm, v.helmDebris);
    for (let i = 0; i < ai.shells.length; i++) this.drawDrlDebris(ai.shells[i], v.shellDebris[i] ?? null);
  }

  private drawDrlDebris(d: DrlDebris | null, view: DrlDebrisView | null): void {
    if (!view) return;
    const live = !!d && !d.done;
    view.group.visible = live;
    if (!d || !live) return;
    for (let i = 0; i < d.count; i++) {
      const bone = view.bones[i + 1];
      if (!bone) continue;
      if (!d.visible(i)) {
        bone.scale.setScalar(0.0001);
        continue;
      }
      this.drlM4.fromArray(d.pieceMatrix(this.drlMat, i));
      this.drlM4.decompose(bone.position, bone.quaternion, bone.scale);
    }
  }

  private drawDeRolLeChildren(e: EnemyRuntime, ai: DeRolLeAi, v: DrlView): void {
    this.drawDeRolLeFins(e, ai, v);
    const shown = e.instance.root.visible && !ai.dying;
    {
      ai.tentacles.forEach((t, i) => {
        const g = v.tentacles[i];
        if (!g) return;
        g.visible = shown;
        const p = ai.attachAt(i);
        g.position.set(p[0], p[1], p[2]);
        g.rotation.order = 'YXZ';
        // ASSUMED: +0x120 lifts the tentacle about its x axis.
        g.rotation.set(-t.lift * BAMS_TO_RAD + t.pitch * BAMS_TO_RAD, (ai.yaw + t.yaw) * BAMS_TO_RAD, 0);
      });
      ai.stings.forEach((s, k) => {
        const g = v.stings[k];
        if (!g) return;
        g.visible = e.instance.root.visible && s.visible;
        g.position.set(s.x, s.y, s.z);
        g.rotation.order = 'YXZ';
        g.rotation.set(s.pitch * BAMS_TO_RAD, s.yaw * BAMS_TO_RAD, s.roll * BAMS_TO_RAD);
        // The blink (bit 2 of +0x398) tints the sting; ASSUMED: drawn as a
        // slight swell.
        g.scale.setScalar(s.blink ? 1.15 : 1);
      });
    }
    // ASSUMED look: the beam as a line (its particles are the events in drlEvent).
    const beam = ai.beam;
    if (!beam) {
      this.clearDrlBeam();
      return;
    }
    if (!this.drlBeam) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      this.drlBeam = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x80c0ff }));
      this.viewer.scene.add(this.drlBeam);
    }
    const pos = this.drlBeam.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, beam.from[0], beam.from[1], beam.from[2]);
    pos.setXYZ(1, beam.to[0], beam.to[1], beam.to[2]);
    pos.needsUpdate = true;
  }

  private clearDrlBeam(): void {
    if (!this.drlBeam) return;
    this.drlBeam.removeFromParent();
    this.drlBeam.geometry.dispose();
    (this.drlBeam.material as THREE.Material).dispose();
    this.drlBeam = null;
  }

  private drlEvent(e: EnemyRuntime, ai: DeRolLeAi, ev: DrlEvent): void {
    const what = `De Rol Le E-${e.index.toString(16)}`;
    switch (ev.kind) {
      case 'state': {
        const slot = DRL_SLOTS[ai.slotIndex];
        this.opts.log(`${what}: state 0x${ev.state.toString(16)} (${ai.state}), sequence ${ev.cursor}, motion ${slot?.motion ?? '?'}`);
        if (this.game.selfId === this.game.leaderId) this.game.sendBossAction(0x1000 | e.index, ev.state, ev.cursor, ev.withTarget ? (ev.target ?? 0xffff) : null);
        return;
      }
      case 'se':
        this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
        // A sustained SE (the body as its owner) only starts when no voice
        // of it plays yet (PlaySFX_008292dc refreshes that voice instead).
        if (ev.sustain && this.sePlayer?.playing(ev.id)) return;
        this.sePlayer?.play(ev.id);
        return;
      case 'shellBroken':
        this.opts.log(`${what}: the shell breaks (body pool ${ai.bodyHp}/${ai.bodyMax})`);
        return;
      case 'helmBreak':
        this.opts.log(`${what}: the helm flies off${ai.helm ? '' : ' (no node capture, nothing drawn)'}`);
        return;
      case 'segmentBroken':
        this.opts.log(`${what}: segment ${ev.index} breaks`);
        return;
      case 'particle': {
        // create_particle_effect_3 at the point, `back` toward the camera
        // (the exe subtracts the camera's view direction times `back`).
        const at = new THREE.Vector3(ev.at[0], ev.at[1] + ev.up, ev.at[2]);
        at.addScaledVector(this.viewer.camera.getWorldDirection(this.drlCamDir), -ev.back);
        this.particle({ id: ev.id }, at);
        return;
      }
      case 'beamStart': {
        // The looping emitter (0x177) of the beam: it follows the muzzle (the
        // emitter, not the particles) and lasts while the beam fires. ASSUMED:
        // the exe's handle stops when the beam ends, which is when beamFiring
        // clears.
        const muzzle = new THREE.Vector3(ev.at[0], ev.at[1], ev.at[2]);
        const at = (): THREE.Vector3 => {
          const b = ai.beam;
          return b ? muzzle.set(b.from[0], b.from[1], b.from[2]) : muzzle;
        };
        void this.fx?.spawn({ id: DRL_BEAM.emitter, duration: BEAM_EMISSION }, at, false, true, () => ai.beamFiring);
        return;
      }
      case 'bgm':
        // ASSUMED: the death track is not started here (audio/bossbgm.ts
        // keeps the boss floor's own track).
        this.opts.log(`${what}: ${ev.name}`);
        return;
      case 'killed':
        this.deRolLeKilled(e, ev.x, ev.z);
        return;
      case 'remove':
        // 0x20 deletes the body with its tree: the shots still flying go too.
        this.clearDrlBeam();
        for (const s of this.shots) if (s.owner === e) s.shot.done = true;
        this.layer.remove(e.instance);
        this.enemies.delete(e.index);
        // The body's dtor deletes the segment entities with it.
        for (const p of this.drlViews.get(e.index)?.segProxies ?? []) {
          if (!p) continue;
          this.layer.remove(p.instance);
          this.enemies.delete(p.index);
          if (this.lockOn === p) this.lockOn = null;
        }
        this.drlViews.delete(e.index);
        this.drlLastHitLocal.delete(e.index);
        if (this.lockOn === e) this.lockOn = null;
        return;
    }
  }

  private drlCamDir = new THREE.Vector3();

  // The body's ctor (0x0042ad4c) makes the ten segment entities with the ids
  // body + 1 .. body + 10: each gets an enemy there that the player can hit
  // (stats row 16 / attack 15 / resist 16, HP 20000, the hit box of radius
  // 50 at the segment), as Vol Opt's parts do.
  private async spawnDeRolLeSegments(): Promise<void> {
    for (const head of [...this.enemies.values()]) {
      const ai = head.ai;
      if (!(ai instanceof DeRolLeAi)) continue;
      const v = this.drlView(head, ai);
      const fight = this.childFightStats('DE_ROL_LE_BODY');
      for (let i = 0; i < ai.segmentParts.length; i++) {
        const index = head.index + 1 + i;
        if (this.enemies.has(index)) {
          this.opts.log(`De Rol Le E-${head.index.toString(16)}: slot E-${index.toString(16)} (segment ${i}) is taken, that segment cannot be hit`);
          continue;
        }
        const seg = ai.segmentParts[i];
        const placed = {
          ...head.instance.placed,
          entity: { ...(head.instance.placed.entity as EnemySet), index: -1 - index },
          world: [seg.x, seg.y, seg.z] as [number, number, number],
          yaw: 0,
          name: 'De Rol Le segment',
        };
        const spec = { ...head.instance.spec, name: 'TBoss2DeRolLeSegment', parts: [] };
        const instance = await this.layer.spawn(placed as typeof head.instance.placed, spec as typeof head.instance.spec);
        if (!instance || this.disposed) return;
        instance.root.visible = false;
        const rt: EnemyRuntime = {
          instance,
          index,
          slot: head.slot,
          ...fight,
          stats: { ...fight.stats, hp: DRL_SEGMENT.hp, maxHp: DRL_SEGMENT.hp },
          exp: 0,
          motions: head.motions,
          rtIndex: 0xff,
          dead: false,
          state: 'idle',
          removeIn: 0,
          ai: new DrlSegmentAi(ai, i),
          lift: 0,
          monest: null,
          parent: head,
          fake: null,
          buffs: new EntityBuffs(),
          status: new EnemyStatus(enemyAttribute('DE_ROL_LE_BODY')),
        };
        this.enemies.set(index, rt);
        v.segProxies[i] = rt;
      }
    }
  }

  // The segment enemies stand where the body's brain put the segments and
  // exist for the player while their hit box is on (y -60 and up, 0x00435070).
  // A broken segment's plate has alpha 0 (DerolleSetAnimationSpeed with the
  // colour 0); ASSUMED: alpha 0 draws nothing, so its two nodes collapse as
  // the helm's do. The hit flash: the plate's own materials (ownMaterials in
  // buildEnemy) take DrlSegment.color as their diffuse each frame, as the exe
  // writes the node's diffuse. The body is still one skinned mesh; the plate's
  // strips are split out of it by node (njcmmesh.ts).
  private syncDeRolLeSegments(e: EnemyRuntime, ai: DeRolLeAi, v: DrlView): void {
    const shown = e.instance.root.visible;
    for (let i = 0; i < ai.segmentParts.length; i++) {
      const s = ai.segmentParts[i];
      if (s.broken) for (const n of v.segPlates[i]) n.scale.setScalar(0.0001);
      for (const m of v.segMats[i]) setPlateDiffuse(m, s.color);
      const rt = v.segProxies[i];
      if (!rt) continue;
      rt.instance.root.position.set(s.x, s.y, s.z);
      rt.instance.root.visible = shown && s.targetable;
      rt.stats.hp = DRL_SEGMENT.hp;
      rt.dead = false;
    }
  }

  // A strike on a segment's enemy: the body's brain feeds the segment pool
  // or, once broken, the body pool. The entity's HP is refilled after each
  // hit, so the 6x0A carries this hit's damage.
  // ASSUMED: the body's last attacker (+0x2d8, the kill's EXP / drop gate) is
  // not set by a segment hit (the segment's own +0x2d8 is the one written).
  private deRolLeSegmentHit(e: EnemyRuntime, ai: DrlSegmentAi, damage: number, critical: boolean, flags: number, what: string): void {
    const owner = ai.owner;
    const went = owner.hitSegment(ai.index, damage);
    if (e.parent) e.parent.stats.hp = owner.bodyHp;
    this.sendEnemy(e, flags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED), Math.max(0, chopToInt(damage)));
    const p = e.instance.root.position;
    this.num(damage, critical, p.x, p.y + 26, p.z);
    const s = ai.segment;
    this.opts.log(`${what}hit De Rol Le's segment ${ai.index} (${went}) for ${Math.round(damage)}: segment ${s.pool}${s.broken ? ' (broken)' : ''}, body ${owner.bodyHp}/${owner.bodyMax}`);
  }

  // 0x1f phase 5: EnemyOnKilledHandler_0051f894 at (-55.8, 2.0, 60.29), so
  // the drop lands there. Every client runs it when it leaves 0x1f, and its
  // sends are gated as the exe gates them:
  //   - set_monster_spawn_initdata_as_dead (6x76 flags 8) has no gate:
  //     every client sends it;
  //   - request_enemy_drop only sends on the leader (or when the leader is
  //     on another floor) and only if the boss has a last attacker;
  //   - handle_experience (via on_enemy_killed) sends 6xC8 for the player at +0x2da
  //     with the killer bonus when that player is the last attacker (+0x2d8).
  //     ASSUMED: +0x2da is the local player, so each client asks for its own
  //     EXP, as the killer when it dealt the last hit.
  //   No 6x0A with the dead flag is sent (phase 5 sends none).
  private deRolLeKilled(e: EnemyRuntime, x: number, z: number): void {
    e.dead = true;
    e.stats.hp = 0;
    this.bossKilled(e, x, z, this.drlLastHitLocal, 'De Rol Le');
  }

  // The kill sends of a boss whose brain owns its death (on_enemy_killed and
  // set_monster_spawn_initdata_as_dead), gated as the exe gates them (see
  // deRolLeKilled). `lastHit`: enemy index -> whether the last strike was ours.
  private bossKilled(e: EnemyRuntime, x: number, z: number, lastHit: Map<number, boolean>, name: string): void {
    this.game.sendEntitySetFlags(0x1000 | e.index, this.floor, 8);
    if (e.rtIndex !== 0xff && this.game.selfId === this.game.leaderId && lastHit.has(e.index)) {
      this.game.sendEnemyDropRequest({ floor: this.floor, rtIndex: e.rtIndex, enemyIndex: e.index, x, z, room: (e.slot.set as EnemySet).section, area: this.area });
    }
    const killer = lastHit.get(e.index) === true;
    this.game.sendExpRequest(e.index, killer);
    const amount = killExp(e.exp, { episode2: this.game.info?.episode === 2, killer, multiplier: this.expMultiplier, ...(this.challengeExpMultiplier === null ? {} : { challenge: this.challengeExpMultiplier }) });
    const anchor = new THREE.Vector3(x, 22, z);
    this.hud?.expPopup(amount, () => anchor);
    this.opts.log(`${name} E-${e.index.toString(16)} defeated${killer ? ' (last hit yours)' : ''}`);
  }

  // A 6x13 / 6x14 from the leader (SetDerolleActionState_00432a38 /
  // ProcessEntityById_00432a74).
  private onDeRolLeAction(sub: number, body: Uint8Array): void {
    if (body.length < 8 || this.game.selfId === this.game.leaderId) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const e = this.enemies.get(dv.getUint16(2, true) - 0x1000);
    if (!(e?.ai instanceof DeRolLeAi)) return;
    const target = sub === 0x14 && body.length >= 12 ? dv.getUint32(8, true) & 0xffff : null;
    e.ai.applyRemote(dv.getUint16(4, true), dv.getUint16(6, true), target === 0xffff ? null : target);
  }

  // --- Barba Ray (combat/barbaray.ts) -----------------------------------------
  //
  // The leader's brain steps the action table and sends 6xA9 / 6xAA for each
  // phase (sendBarbaAction); every client applies them (onBarbaAction; the
  // sender applies its own through its brain, send-then-apply). A hit on the
  // body feeds the shell and body pools (hitRoot) on every client. The kill is
  // the leave of the finale (bossKilled, EXP and 6x76 as the other bosses).
  private barbaLastHit = new Map<number, boolean>();
  // Per Barba Ray (by enemy index): the part enemies (slots body + 1 + i, null:
  // not spawned) and the captures the rows are built from (same node list as De
  // Rol Le's spine: CombatView.DRL_SPINE, ASSUMED, see combat/barbaray.ts).
  private barbaParts = new Map<number, (EnemyRuntime | null)[]>();
  private barbaCaptures = Array.from({ length: BARBA_CAPTURE_COUNT }, (): [number, number, number] => [0, 0, 0]);
  private barbaDrawn = new Map<number, boolean>();

  // The part enemies: the body's ctor makes them at body + 1 .. body + 10 (the
  // same ids as De Rol Le's segments). Each is a target: the box of radius 50
  // (BARBA_PART_RADIUS, 0x004ba2d8), stats row 16 / 15 / 16 as the exe's part init
  // (0x004ba2e4, the same rows as De Rol Le's segment: childFightStats DE_ROL_LE_BODY).
  private async spawnBarbaParts(): Promise<void> {
    for (const head of [...this.enemies.values()]) {
      const ai = head.ai;
      if (!(ai instanceof BarbaRayAi)) continue;
      const fight = this.childFightStats('DE_ROL_LE_BODY');
      const parts: (EnemyRuntime | null)[] = [];
      this.barbaParts.set(head.index, parts);
      for (let i = 0; i < BARBA_PART_COUNT; i++) {
        parts.push(null);
        const index = head.index + 1 + i;
        if (this.enemies.has(index)) {
          this.opts.log(`Barba Ray E-${head.index.toString(16)}: slot E-${index.toString(16)} (part ${i}) is taken, that part cannot be hit`);
          continue;
        }
        const row = ai.rows[i]!;
        const placed = {
          ...head.instance.placed,
          entity: { ...(head.instance.placed.entity as EnemySet), index: -1 - index },
          world: [row[0], row[1], row[2]] as [number, number, number],
          yaw: 0,
          name: 'Barba Ray part',
        };
        const spec = { ...head.instance.spec, name: 'TBoss7DeRolLeCPart', parts: [] };
        const instance = await this.layer.spawn(placed as typeof head.instance.placed, spec as typeof head.instance.spec);
        if (!instance || this.disposed) return;
        instance.root.visible = false;
        const rt: EnemyRuntime = {
          instance,
          index,
          slot: head.slot,
          ...fight,
          stats: { ...fight.stats, hp: BARBA_HP, maxHp: BARBA_HP },
          exp: 0,
          motions: head.motions,
          rtIndex: 0xff,
          dead: false,
          state: 'idle',
          removeIn: 0,
          ai: new BarbaPartAi(ai, i),
          lift: 0,
          monest: null,
          parent: head,
          fake: null,
          buffs: new EntityBuffs(),
          status: new EnemyStatus(enemyAttribute('DE_ROL_LE_BODY')),
        };
        this.enemies.set(index, rt);
        parts[i] = rt;
      }
    }
  }

  // The root update's rows (barbaRows) from the body's spine nodes as the last
  // draw left them (render_derolle's capture, the same as De Rol Le's segments),
  // then each part follows its row. Parts show while the body is drawn.
  // The leader's held Left / Right palette keys for the Barba Ray jump (0x11 / 0x12, event 2).
  // Left is palette_slots[1] (Tab too), Right palette_slots[2]: keyconfig.ts PALETTE_KEYS.
  private barbaInput(): { left: boolean; right: boolean } {
    return {
      left: paletteChannelDown(this.frameKeys, KEYS.paletteLeft, 1) !== '',
      right: paletteChannelDown(this.frameKeys, KEYS.paletteRight, 2) !== '',
    };
  }

  private tickBarbaParts(e: EnemyRuntime, ai: BarbaRayAi): void {
    const parts = this.barbaParts.get(e.index);
    const body = e.instance.nodes?.[0];
    const spine = CombatView.DRL_SPINE.map((i) => body?.[i] ?? null);
    const drawn = this.barbaDrawn.get(e.index) ?? false;
    if (drawn && spine.every((n) => n)) {
      for (let i = 0; i < BARBA_CAPTURE_COUNT; i++) {
        const a = spine[i]!.matrixWorld.elements;
        const c = this.barbaCaptures[i]!;
        c[0] = a[12];
        c[1] = a[13];
        c[2] = a[14];
      }
      barbaRows(this.barbaCaptures, ai.rows);
    }
    this.barbaDrawn.set(e.index, e.instance.root.visible);
    if (!parts) return;
    for (let i = 0; i < parts.length; i++) {
      const rt = parts[i];
      if (!rt) continue;
      const row = ai.rows[i]!;
      rt.instance.root.position.set(row[0], row[1], row[2]);
      rt.instance.root.visible = e.instance.root.visible && !ai.dead && drawn;
    }
  }

  // The parts go with the body (0x1d / the kill): they stop being targets.
  private barbaPartsGone(e: EnemyRuntime): void {
    for (const rt of this.barbaParts.get(e.index) ?? []) {
      if (!rt) continue;
      rt.dead = true;
      rt.instance.root.visible = false;
    }
  }

  // A hit on a part: the brain's part pool (hitPart: a broken part drains the
  // body 704 by half). The entity is refilled to max, so its 6x0A carries this
  // hit's damage, as De Rol Le's segments do.
  private barbaPartHit(e: EnemyRuntime, ai: BarbaPartAi, damage: number, critical: boolean, flags: number, byPlayer: boolean, what: string): void {
    const owner = ai.owner;
    const parent = e.parent;
    const went = ai.hit(damage);
    e.stats.hp = BARBA_HP;
    if (parent && damage >= 1) this.barbaLastHit.set(parent.index, byPlayer);
    this.sendEnemy(e, flags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED), Math.max(0, chopToInt(damage)));
    if (parent) this.barbaDrain(parent, owner);
    const p = e.instance.root.position;
    this.num(damage, critical, p.x, p.y + 26, p.z);
    this.opts.log(`${what}hit Barba Ray's part ${ai.index} (${went}) for ${Math.round(damage)}: body ${owner.bodyHp}`);
  }

  private barbaDrain(e: EnemyRuntime, ai: BarbaRayAi): void {
    for (const ev of ai.drain() as BarbaEvent[]) {
      switch (ev.kind) {
        case 'send':
          if (this.game.selfId === this.game.leaderId) this.game.sendBarbaAction(0x1000 | e.index, ev.phase, ev.cursor, ev.target);
          this.opts.log(`Barba Ray E-${e.index.toString(16)}: phase 0x${ev.phase.toString(16)} (cursor ${ev.cursor})`);
          break;
        case 'se':
          this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
          this.sePlayer?.play(ev.id);
          break;
        case 'effect': {
          // ASSUMED: the part's spark is placed at the body (the part boxes and bones are not captured).
          const p = e.instance.root.position;
          this.particle({ id: ev.id }, new THREE.Vector3(p.x, p.y + (ev.up ?? 0), p.z));
          break;
        }
        case 'spawn':
          // The spawner (0x004b4e6c): a live count entry makes a Pig Ray.
          if (ev.count !== 0) void this.spawnPigRay(e, ev);
          break;
        case 'hit':
          // The player attack's area (0x0051fc9c, barbaray.ts BARBA_ATTACK): each client resolves its own
          // player, as the shots do (entity_hit_by_tech group 0 with the row's power and the knockback 20).
          if (ev.clientId !== this.game.selfId) break;
          this.enemyTechHitsPlayer(e, ev.power, ev.x, ev.z, `E-${e.index.toString(16)} (${e.slot.type})`, ev.knockback);
          break;
        case 'killed':
          this.barbaKilled(e);
          break;
        case 'dead':
          this.barbaPartsGone(e);
          break;
      }
    }
  }

  private barbaKilled(e: EnemyRuntime): void {
    const p = e.instance.root.position;
    e.dead = true;
    e.stats.hp = 0;
    this.barbaPartsGone(e);
    this.bossKilled(e, p.x, p.z, this.barbaLastHit, 'Barba Ray');
  }

  // A 6xA9 / 6xAA from the leader (0x004b98fc / 0x004b9938: the target, then the phase).
  private onBarbaAction(body: Uint8Array): void {
    const m = decodeBarbaMessage(body);
    if (!m) return;
    const e = this.enemies.get(m.entity - 0x1000);
    if (!(e?.ai instanceof BarbaRayAi)) return;
    e.ai.applyRemote(m.phase, m.cursor, m.target === null || m.target === 0xffff ? null : m.target);
    this.barbaDrain(e, e.ai);
  }

  // --- the Dragon (combat/dragon.ts) -------------------------------------------
  //
  // One brain owns the body, the flames, the fireballs and the area hits; its
  // hp is the entity's own (stats row 18) and a hit only lowers it: the brain
  // clamps it and decides the roars and the death. The room leader's brain
  // sends 6x12 for every step and the followers apply them (applyRemote); every
  // client runs the kill sends when the body leaves state 0x15.

  // Whether the last hit on a Dragon was the local player's (its last_attacker,
  // +0x2d8): that client asks for the killer's EXP.
  private dragonLastHit = new Map<number, boolean>();
  // The state last logged per Dragon (the walk's tracking packets repeat).
  private dragonLogged = new Map<number, number>();
  // Per Dragon: the animators that play the body's motion.
  private dragonBodies = new Map<number, NodeAnimator[]>();

  private tickDragon(e: EnemyRuntime, ai: DragonAi, targets: AiTarget[]): void {
    const inst = e.instance;
    const root = inst.root;
    const r = ai.tick(targets);
    e.stats.hp = Math.max(0, ai.hp);
    // The body stands on the ground under it, plus its altitude register.
    const lift = r.lift ?? 0;
    const gy = this.opts.ground?.(r.x, r.z, root.position.y - e.lift + 30) ?? null;
    root.position.set(r.x, (gy ?? root.position.y - e.lift) + lift, r.z);
    e.lift = lift;
    root.rotation.y = r.angle;
    let bodies = this.dragonBodies.get(e.index);
    if (!bodies) {
      bodies = inst.animators.filter((_, k) => !inst.parts[k]?.name);
      this.dragonBodies.set(e.index, bodies);
    }
    // The body's motion is the brain's (+0xb8 / +0xc0): only the body's
    // animators play it, held at the brain's frame.
    for (const a of bodies) {
      if (r.motion) {
        try {
          a.play(inst.archive.motion(r.motion.index, a.nodeCount), r.motion.speed, r.motion.loop);
        } catch (err) {
          this.opts.log(`Dragon motion ${r.motion.index}: ${(err as Error).message}`);
        }
      }
      a.paused = true;
      a.setFrame(ai.mframe);
    }
    // The model draw records the feet and the mouth for this tick's stomps and
    // flames, and the tail's nodes for the next tick's tail object (only the
    // tail swipe reads those), combat/dragon.ts recordFeet / recordMouth /
    // recordNodes.
    const tree = inst.nodes?.[0];
    if (tree) {
      root.updateMatrixWorld(true);
      const v = this.dragonNode;
      const read = (n: number, out: [number, number, number]): boolean => {
        const o = tree[n];
        if (!o) return false;
        o.getWorldPosition(v);
        out[0] = v.x;
        out[1] = v.y;
        out[2] = v.z;
        return true;
      };
      ai.recordFeet(read);
      // The mouth is node 60 with the point (0, 0, 5) in its space; the brain
      // keeps y above the ground the body stands on (the altitude's base).
      const mouth = tree[DRAGON_MOUTH.node];
      if (mouth) {
        v.set(0, 0, DRAGON_MOUTH.forward);
        mouth.localToWorld(v);
        ai.recordMouth([v.x, v.y - (root.position.y - lift), v.z]);
      } else ai.recordMouth(null);
      if (ai.wantsNodes) ai.recordNodes(read, root.position.y);
    }
    for (const ev of ai.events.splice(0)) this.dragonEvent(e, ai, ev);
    if (r.shots) for (const s of r.shots) this.launchShot(e, s);
  }

  private readonly dragonNode = new THREE.Vector3();

  private dragonEvent(e: EnemyRuntime, ai: DragonAi, ev: DragonEvent): void {
    const what = `Dragon E-${e.index.toString(16)}`;
    switch (ev.kind) {
      case 'send':
        if (this.dragonLogged.get(e.index) !== ev.state) {
          this.dragonLogged.set(e.index, ev.state);
          this.opts.log(`${what}: state 0x${ev.state.toString(16)} (${ai.state}), sequence ${ev.cursor}`);
        }
        this.game.sendDragonAction(0x1000 | e.index, ev.state, ev.cursor, ev.target, ev.x, ev.z);
        return;
      case 'se':
        this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
        this.sePlayer?.play(ev.id);
        return;
      case 'bgm':
        // ASSUMED: the track swaps (dradeath.adx at the entrance and the death,
        // draroar.adx at a roar) are not played here (audio/bossbgm.ts keeps
        // the boss floor's own track).
        this.opts.log(`${what}: ${ev.name}`);
        return;
      case 'killed':
        this.dragonKilled(e, ev.x, ev.z);
        return;
      case 'particle':
        // The brain's y is above the ground the body stands on (launchShot's base).
        this.particle({ id: ev.id }, new THREE.Vector3(ev.x, e.instance.root.position.y - e.lift + ev.y, ev.z));
        return;
      case 'emitter': {
        // The flame's emitter (0x0050981c, flyShoot's sub-state 2): it follows the
        // mouth (the brain's mouth(), the same base as the points above) and lives
        // while its handle is alive. ASSUMED: the handle's flag is read each frame
        // (fx.spawn's alive), the exe's own stop.
        const at = (): THREE.Vector3 => {
          const m = ai.mouth();
          return new THREE.Vector3(m[0], e.instance.root.position.y - e.lift + m[1], m[2]);
        };
        void this.fx?.spawn({ id: ev.id, duration: BEAM_EMISSION }, at, false, true, () => ev.handle.alive);
        return;
      }
    }
  }

  // State 0x15's phase 5: EnemyOnKilledHandler_0051f894, gated as the exe gates
  // it (see bossKilled).
  private dragonKilled(e: EnemyRuntime, x: number, z: number): void {
    e.dead = true;
    e.stats.hp = 0;
    if (this.lockOn === e) this.lockOn = null;
    this.bossKilled(e, x, z, this.dragonLastHit, 'Dragon');
  }

  // A 6x10 / 6x11 (ApplyEnemyTargetAndState_00423a78 / ..._ConditionalState_00423ac8, combat/enemystate.ts):
  // the target, the cursor and the state, on every client. The exe sends none, so this applies only what
  // another client wrote. Only the Dragon and the Gol Dragon are applied: their state numbers are the
  // exe's (their 6x12 / 6xA8 packets set the same words); the other families' state numbers are not
  // mapped to their brains, so their packets are logged and not applied.
  private onEnemyTargetState(body: Uint8Array): void {
    const m = decodeEnemyTargetState(body);
    if (!m) return;
    const e = this.enemies.get(m.entity - 0x1000);
    if (!e || e.dead) return;
    if (e.ai instanceof DragonAi || e.ai instanceof GoldDragonAi) {
      e.ai.applyTargetState(m.phase, m.cursor, m.target, m.sub);
      return;
    }
    this.opts.log(`6x${m.sub.toString(16)}: E-${e.index.toString(16)} (${e.slot.type}) state ${m.phase} not applied (family not mapped)`);
  }

  // A 6x12 from the leader (action_dragon 0x00423b00).
  private onDragonAction(body: Uint8Array): void {
    if (body.length < 20 || this.game.selfId === this.game.leaderId) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const e = this.enemies.get(dv.getUint16(2, true) - 0x1000);
    if (!(e?.ai instanceof DragonAi) || e.dead) return;
    const target = dv.getUint32(8, true) & 0xffff;
    e.ai.applyRemote(dv.getUint16(4, true), dv.getUint16(6, true), target === 0xffff ? null : target, dv.getFloat32(12, true), dv.getFloat32(16, true));
  }

  // --- the Gal Gryphon (combat/galgryphonai.ts) ----------------------------------
  //
  // The brain owns the body (x, height, z, heading) and its motion row. The leader's brain sends
  // each 0xA0 (its pattern step, through GalgryphonAi.emit) and each 0x9F (its target); the
  // followers apply them (onGalgryphonSub) and run phase 0 only. ASSUMED: the body is placed at
  // its own height (no ground follow); the motion plays on each change of row.
  // --- Olga Flow, form 1 (combat/olgaflowai.ts) ------------------------------------
  // The brain owns the body and its attack states; the leader's sends go out as 6xA4 (events), and the
  // death is the brain's: 'killed' runs the kill once (bossKilled: the drop, EXP, the 6x76 flag).
  private olgaLastHit = new Map<number, boolean>();
  private olgaTrails = new Map<number, OlgaSwordTrail>();

  // The sword wave's hit (CheckForSwordWaveHittingPlayers, combat/olgaflowhits.ts): on the brain's
  // waveTick, the local player is tested against the sword line (the sword tip = the model's bone, ASSUMED)
  // and takes the group-0 tech damage. Each client resolves its own player (as tickShots does).
  private olgaSwordWave(e: EnemyRuntime, ai: OlgaFlowAi): void {
    let trail = this.olgaTrails.get(e.index);
    if (!trail) {
      trail = new OlgaSwordTrail();
      this.olgaTrails.set(e.index, trail);
    }
    if (!ai.waveTick) {
      trail.reset();
      return;
    }
    const inst = e.instance;
    const bone = inst.nodes?.[0]?.[OLGA_SWORD_WAVE.swordBone];
    if (!bone) return;
    inst.root.updateWorldMatrix(true, true);
    const w = bone.getWorldPosition(new THREE.Vector3());
    const { a, tip } = trail.step({ x: w.x, z: w.z });
    const me = this.view?.playerPositions().get(this.game.selfId);
    if (!me || this.area !== OLGA_AREA || this.damage.dead) return;
    if (!swordWaveTouches({ x: me.x, z: me.z }, a, tip)) return;
    const ctx = this.difficultyParams;
    const speed = ctx?.params ? ctx.params.movement(ctx.difficulty, OLGA_ANIM_ROW) : null;
    const power = randomlyAdjust(olgaBattlePower(speed?.fparam1 ?? 0), 0.1, this.rng());
    this.enemyTechHitsPlayer(e, power, tip.x, tip.z, `E-${e.index.toString(16)} (${e.slot.type}) sword wave`);
  }

  // The sword stab (CheckOlga1SwordStab spawns, olga1_sword_stab_update hits; combat/olgaflowhits.ts, pass 5).
  // The spawn runs on the brain's stabTick (rows 11..20) at the sword's ground point; every live object hits
  // the local player within its range each tick, for 8 ticks. ASSUMED: the bone pair (tip, previous tip)
  // (see olgaflowhits.ts; the constants and the per-difficulty range are read from the exe).
  private olgaStabs = new Map<number, { prev: XYZ | null; objs: OlgaStabObject[] }>();

  private olgaSwordStab(e: EnemyRuntime, ai: OlgaFlowAi): void {
    let st = this.olgaStabs.get(e.index);
    if (!st) {
      st = { prev: null, objs: [] };
      this.olgaStabs.set(e.index, st);
    }
    const inst = e.instance;
    const bone = inst.nodes?.[0]?.[OLGA_SWORD_WAVE.swordBone];
    if (ai.stabTick && bone) {
      inst.root.updateWorldMatrix(true, true);
      const w = bone.getWorldPosition(new THREE.Vector3());
      const tip: XYZ = { x: w.x, y: w.y, z: w.z };
      const g = stabGroundPoint(st.prev ?? tip, tip);
      if (g) st.objs.push(new OlgaStabObject(g, olgaStabRange(this.difficultyParams?.difficulty ?? 0)));
      st.prev = tip;
    } else {
      st.prev = null;
    }
    const me = this.view?.playerPositions().get(this.game.selfId);
    if (me && this.area === OLGA_AREA && !this.damage.dead) {
      const ctx = this.difficultyParams;
      const speed = ctx?.params ? ctx.params.movement(ctx.difficulty, OLGA_ANIM_ROW) : null;
      for (const o of st.objs) {
        if (!o.alive) continue;
        if (o.touches({ x: me.x, z: me.z })) {
          const power = randomlyAdjust(olgaBattlePower(speed?.fparam1 ?? 0), 0.1, this.rng());
          this.enemyTechHitsPlayer(e, power, o.pos.x, o.pos.z, `E-${e.index.toString(16)} (${e.slot.type}) sword stab`);
        }
        o.tick();
      }
    } else {
      for (const o of st.objs) o.tick();
    }
    st.objs = st.objs.filter((o) => o.alive);
  }

  // The fire lancer (row 22, exe CheckOlga1SwordWaveHit_0049592c; combat/olgaflowhits.ts, pass 6). On the brain's
  // lancerTick the blade (the anchors A, B: the model's bones, ASSUMED, OLGA_LANCER.anchorBones) is spread by the
  // progress t, and the local player inside the quad (the blade extruded 500 along the heading) takes the group-0
  // tech damage with power randomly_adjust(fparam4, 0.1). Each client resolves its own player, as the sword does.
  private olgaLancer(e: EnemyRuntime, ai: OlgaFlowAi): void {
    if (!ai.lancerTick || ai.lancerProgress === 0) return;
    const inst = e.instance;
    const [ia, ib] = OLGA_LANCER.anchorBones;
    const ba = inst.nodes?.[0]?.[ia];
    const bb = inst.nodes?.[0]?.[ib];
    if (!ba || !bb) return;
    inst.root.updateWorldMatrix(true, true);
    const wa = ba.getWorldPosition(new THREE.Vector3());
    const wb = bb.getWorldPosition(new THREE.Vector3());
    const A: XYZ = { x: wa.x, y: wa.y, z: wa.z };
    const B: XYZ = { x: wb.x, y: wb.y, z: wb.z };
    if (!lancerGate(A, B, ai.lancerProgress)) return;
    const me = this.view?.playerPositions().get(this.game.selfId);
    if (!me || this.area !== OLGA_AREA || this.damage.dead) return;
    const { p1, p2 } = lancerBlade(A, B, ai.lancerProgress);
    if (!lancerTouches({ x: me.x, z: me.z }, lancerQuad(p1, p2, ai.angle))) return;
    const ctx = this.difficultyParams;
    const speed = ctx?.params ? ctx.params.movement(ctx.difficulty, OLGA_ANIM_ROW) : null;
    const power = randomlyAdjust(olgaBattlePower(speed?.fparam4 ?? 0), OLGA_LANCER.powerFraction, this.rng());
    this.enemyTechHitsPlayer(e, power, (p1.x + p2.x) / 2, (p1.z + p2.z) / 2, `E-${e.index.toString(16)} (${e.slot.type}) fire lancer`);
  }

  private tickOlga(e: EnemyRuntime, ai: OlgaFlowAi, targets: AiTarget[]): void {
    const inst = e.instance;
    const root = inst.root;
    const r = ai.tick(targets);
    root.position.set(r.x, root.position.y, r.z);
    root.rotation.y = r.angle;
    // After the placement, so the sword bone is read at this tick's body (ASSUMED: the pose is last frame's).
    this.olgaSwordWave(e, ai);
    this.olgaSwordStab(e, ai);
    this.olgaLancer(e, ai);
    const body = r.motion;
    if (body) {
      // The leg model (animator 0 in the spec order) plays the row's leg motion; the others the body's.
      const leg = ai.legMotion;
      inst.animators.forEach((a, k) => {
        const m = k === 0 && leg ? leg : body;
        try {
          a.play(inst.archive.motion(m.index, a.nodeCount), m.speed, m.loop);
        } catch (err) {
          this.opts.log(`Olga Flow motion ${m.index}: ${(err as Error).message}`);
        }
      });
    }
    for (const ev of ai.drainEvents()) {
      if (ev.kind === 'send') this.game.sendOlgaPacket(ev.packet);
      else this.olgaKilled(e, ai.x, ai.z);
    }
  }

  private olgaKilled(e: EnemyRuntime, x: number, z: number): void {
    e.dead = true;
    e.stats.hp = 0;
    if (this.lockOn === e) this.lockOn = null;
    this.bossKilled(e, x, z, this.olgaLastHit, 'Olga Flow');
  }

  // A 6xA4 from the leader: the form 1 state and its attack fields (the exe's 0x00497e50). The leader
  // applied its own packet already (tickOlga's send), so it ignores the loopback.
  private onOlgaAction(body: Uint8Array): void {
    if (this.game.selfId === this.game.leaderId) return;
    const m = decodeOlgaA4(body);
    if (!m) return;
    const e = this.enemies.get(m.entity - 0x1000);
    if (!(e?.ai instanceof OlgaFlowAi) || e.dead) return;
    e.ai.applyRemote(m);
  }

  private tickGalgryphon(e: EnemyRuntime, ai: GalgryphonAi, targets: AiTarget[]): void {
    const r = ai.tick(targets);
    // S34 (remove) marked the body gone: it leaves the room (Gol Dragon's gone case).
    if (ai.gone) e.instance.root.visible = false;
    // The area hits of the brain's minion ring (combat/galgryphonai.ts tickRing), through the enemy
    // shot path, so each client resolves its own player (tickShots).
    if (r.shots) for (const s of r.shots) this.launchShot(e, s);
    const root = e.instance.root;
    root.position.set(r.x, r.y ?? root.position.y, r.z);
    e.lift = 0;
    root.rotation.y = r.angle;
    if (!r.motion) return;
    for (const a of e.instance.animators) {
      try {
        a.play(e.instance.archive.motion(r.motion.index, a.nodeCount), r.motion.speed, r.motion.loop);
      } catch (err) {
        this.opts.log(`Gal Gryphon motion ${r.motion.index}: ${(err as Error).message}`);
      }
    }
  }

  // The homing minion's area hit (DispatchGalGryphonAttackEffect_004a8690, galgryphonfx.ts
  // galgryphonAttackBurst): the attack's owner is the Gal Gryphon (its entity is the attacker in the
  // exe: 0x004a6edc returns the boss). Nothing is hit when the boss is not on the field.
  private galgryphonAttack(at: { x: number; y: number; z: number }): void {
    let owner: EnemyRuntime | null = null;
    for (const e of this.enemies.values()) {
      if (e.ai instanceof GalgryphonAi && !e.dead) {
        owner = e;
        break;
      }
    }
    if (owner) this.launchShot(owner, galgryphonAttackBurst(at, 0, 0));
  }

  // A 0xA0 (the pattern step) or a 0x9F (the target) from the leader. The leader ignores its own echo.
  private onGalgryphonSub(sub: number, body: Uint8Array): void {
    if (body.length < 8 || this.game.selfId === this.game.leaderId) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const e = this.enemies.get(dv.getUint16(2, true) - 0x1000);
    if (!(e?.ai instanceof GalgryphonAi) || e.dead) return;
    if (sub === 0xa0) e.ai.receive(dv);
    else e.ai.receiveTarget(dv);
  }

  // Whether the last hit on a Gal Gryphon was the local player's (bossKilled's drop and EXP).
  private galgryphonLastHit = new Map<number, boolean>();

  // State 5's leave: EnemyOnKilledHandler_0051f894 (every client that runs the leave). The brain's
  // death, not the generic kill: the body is at the origin during the on-killed (galgryphonstatesa.ts).
  private galgryphonKilled(index: number): void {
    const e = this.enemies.get(index);
    if (!e || e.dead) return;
    e.dead = true;
    e.stats.hp = 0;
    if (this.lockOn === e) this.lockOn = null;
    this.bossKilled(e, 0, 0, this.galgryphonLastHit, 'Gal Gryphon');
  }

  // --- the Gol Dragon (combat/goldragon.ts) -------------------------------------
  //
  // The same shape as the Dragon: the brain owns the body and its fireballs and
  // area hits; the leader's brain sends a 6xA8 for every state it picks and every
  // client applies it (onGolAction). Each client runs the kill when it leaves
  // state 0x15 (bossKilled: the EXP request, and the drop from the leader).

  // Whether the last hit on a Gol Dragon was the local player's (its last_attacker).
  private golLastHit = new Map<number, boolean>();
  // The state last logged per Gol Dragon.
  private golLogged = new Map<number, number>();
  // Per Gol Dragon: the animators that play the body's motion.
  private golBodies = new Map<number, NodeAnimator[]>();

  private tickGol(e: EnemyRuntime, ai: GoldDragonAi, targets: AiTarget[]): void {
    const inst = e.instance;
    const root = inst.root;
    const r = ai.tick(targets);
    e.stats.hp = Math.max(0, ai.hp);
    const lift = r.lift ?? 0;
    const gy = this.opts.ground?.(r.x, r.z, root.position.y - e.lift + 30) ?? null;
    root.position.set(r.x, (gy ?? root.position.y - e.lift) + lift, r.z);
    e.lift = lift;
    root.rotation.y = r.angle;
    let bodies = this.golBodies.get(e.index);
    if (!bodies) {
      bodies = inst.animators.filter((_, k) => !inst.parts[k]?.name);
      this.golBodies.set(e.index, bodies);
    }
    for (const a of bodies) {
      if (r.motion) {
        try {
          a.play(inst.archive.motion(r.motion.index, a.nodeCount), r.motion.speed, r.motion.loop);
        } catch (err) {
          this.opts.log(`Gol Dragon motion ${r.motion.index}: ${(err as Error).message}`);
        }
      }
      a.paused = true;
      a.setFrame(ai.mframe);
    }
    for (const ev of ai.drainEvents()) this.golEvent(e, ev);
    if (r.shots) for (const s of r.shots) this.launchShot(e, s);
  }

  private golEvent(e: EnemyRuntime, ev: GolEvent): void {
    const what = `Gol Dragon E-${e.index.toString(16)}`;
    switch (ev.kind) {
      case 'send':
        if (this.golLogged.get(e.index) !== ev.state) {
          this.golLogged.set(e.index, ev.state ?? -1);
          this.opts.log(`${what}: state 0x${(ev.state ?? 0).toString(16)}, sequence ${ev.cursor}`);
        }
        this.game.sendGolAction(0x1000 | e.index, ev.state ?? 0, ev.cursor ?? 0, ev.target ?? null, ev.x ?? 0, ev.z ?? 0, ev.variant ?? 0);
        return;
      case 'killed':
        this.golKilled(e, ev.x ?? 0, ev.z ?? 0);
        return;
      case 'gone':
        // The children's exit of state 0x17 (exe: the body's +8 bit 0): the body leaves the room.
        e.instance.root.visible = false;
        this.opts.log(`${what}: removed (state 0x17 children expired)`);
        return;
      case 'extras':
        // The 0x2b leave (exe 0x004cea04): the copies on the ring around the body.
        void this.spawnGolExtras(e, ev.extras ?? []);
        return;
      default:
        return;
    }
  }

  // State 0x15's leave: EnemyOnKilledHandler_0051f894 (every client runs it).
  private golKilled(e: EnemyRuntime, x: number, z: number): void {
    e.dead = true;
    e.stats.hp = 0;
    if (this.lockOn === e) this.lockOn = null;
    // A copy leaves the room when it dies (the derived update's flag 8 branch: 6x76 and removal).
    if (e.ai instanceof GoldDragonAi && e.ai.derived) e.instance.root.visible = false;
    this.bossKilled(e, x, z, this.golLastHit, 'Gol Dragon');
  }

  // The copies of a Gol Dragon (exe 0x004cea04): slots body + 1 .. body + 5. A slot holding a living
  // entity, or a copy still being built, is taken, so the 0x2b phase 9 waits (FUN_004ce970).
  private golExtrasPending = new Set<number>();
  private golExtrasFree(index: number): boolean {
    if (this.golExtrasPending.has(index)) return false;
    for (let k = 1; k <= GOL_EXTRA.count; k++) {
      const other = this.enemies.get(index + k);
      if (other && !other.dead) return false;
    }
    return true;
  }

  // Builds the copies of a 0x2b leave (exe 0x004cea04 -> 0x004cede4): the same model as the body (its
  // geometry and materials are shared, see shareMeshResources), a derived brain (flag 0x40, no clamp).
  // ASSUMED: a copy's hp is the body's maximum and it has no drop (rtIndex 0xff).
  private async spawnGolExtras(head: EnemyRuntime, placements: readonly GolExtraPlacement[]): Promise<void> {
    if (!(head.ai instanceof GoldDragonAi)) return;
    const body = head.ai;
    this.golExtrasPending.add(head.index);
    try {
      for (let k = 0; k < placements.length; k++) {
        const index = head.index + 1 + k;
        const p = placements[k]!;
        const taken = this.enemies.get(index);
        if (taken && !taken.dead) {
          this.opts.log(`Gol Dragon E-${head.index.toString(16)}: slot E-${index.toString(16)} is taken, no copy`);
          continue;
        }
        const placed = {
          ...head.instance.placed,
          entity: { ...(head.instance.placed.entity as EnemySet), index: -1 - index },
          world: [p.x, head.instance.placed.world[1], p.z] as [number, number, number],
          yaw: p.yaw * BAMS_TO_RAD,
          name: 'Gol Dragon copy',
        };
        const instance = await this.layer.spawn(placed as typeof head.instance.placed, head.instance.spec);
        if (!instance || this.disposed) return;
        shareMeshResources(head.instance.root, instance.root);
        const hp = body.maxHp;
        const copy = new GoldDragonAi({
          x: p.x,
          z: p.z,
          angle: placed.yaw,
          ultimate: this.ultimate,
          movement: null,
          hp,
          singleton: false,
          derived: true,
          leader: () => this.game.selfId === this.game.leaderId,
          frames: this.motionFrames(instance, null),
          playerHp: (id) => (id === this.game.selfId ? this.damage.hp : (this.party.get(id)?.hp ?? 0)),
          rng: () => this.rng(),
        });
        copy.yaw = p.yaw;
        const rt: EnemyRuntime = {
          instance,
          index,
          slot: head.slot,
          stats: { ...head.stats, hp, maxHp: hp },
          exp: head.exp,
          attacker: head.attacker,
          attack: head.attack,
          resist: head.resist,
          esp: head.esp,
          motions: head.motions,
          rtIndex: 0xff,
          dead: false,
          state: 'idle',
          removeIn: 0,
          ai: copy,
          lift: 0,
          monest: null,
          parent: null,
          fake: null,
          buffs: new EntityBuffs(),
          status: new EnemyStatus(enemyAttribute(head.slot.type)),
        };
        this.enemies.set(index, rt);
        this.opts.log(`Gol Dragon E-${head.index.toString(16)}: copy E-${index.toString(16)} spawned at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
      }
    } finally {
      this.golExtrasPending.delete(head.index);
    }
  }

  // A 6xA8 from the leader (handler 0x004cbe80, the sender applies its own).
  private onGolAction(body: Uint8Array): void {
    if (this.game.selfId === this.game.leaderId) return;
    const m = decodeGolA8(body);
    if (!m) return;
    const e = this.enemies.get(m.entity - 0x1000);
    if (!(e?.ai instanceof GoldDragonAi) || e.dead) return;
    e.ai.applyRemote(m.state, m.cursor, m.target, m.x, m.z);
  }

  // --- Saint-Milion / Shambertin / Kondrieu (combat/saintmilionboss.ts) ------------------
  //
  // One brain owns the body, its 8 parts (ids body + 1 .. 8) and its 16
  // tentacles (body + 9 .. 24); the parts and the tentacles are invisible
  // enemies here (like Vol Opt's parts) so strikes, techniques, the lock-on
  // and the other clients' 6x0A find them by id. The room leader's brain sends
  // 6xDC and every client applies it; every client runs the deaths from the
  // 6x0A of each part and tentacle.

  // Whether the last strike on a part was ours, by child index (0 .. 7) and,
  // under the head's index, the kill's gate.
  private smLastHit = new Map<number, boolean>();
  private smHeads = new Map<number, { proxies: Array<EnemyRuntime | null>; bodies: NodeAnimator[] | null }>();
  private smVec = new THREE.Vector3();
  private smScale = new THREE.Vector3();

  // The tentacle archive's motion frame counts (bm_ene_boss09_tentacle.bml).
  private tentacleFrames(instance: EnemyInstance): (motion: number) => number {
    const cache = new Map<number, number>();
    return (m) => {
      let n = cache.get(m);
      if (n === undefined) {
        const k = instance.parts.findIndex((p) => p.name === 'spinner 0');
        const nodeCount = instance.animators[Math.max(0, k)]?.nodeCount ?? 32;
        try {
          n = instance.archive.motion(m, nodeCount).frameCount;
        } catch {
          // ASSUMED stand-ins when the archive does not parse (the real counts: 31 61 3 30 110 60 30).
          n = [31, 61, 3, 30, 110, 60, 30][m] ?? 30;
        }
        cache.set(m, n);
      }
      return n;
    };
  }

  private async spawnSaintMilion(): Promise<void> {
    for (const head of [...this.enemies.values()]) {
      const ai = head.ai;
      if (!(ai instanceof SaintMilionAi)) continue;
      const v = ai.variant;
      const view = { proxies: [] as Array<EnemyRuntime | null>, bodies: null as NodeAnimator[] | null };
      this.smHeads.set(head.index, view);
      for (let i = 0; i < SM_PART_COUNT + 16; i++) {
        view.proxies[i] = null;
        const index = head.index + 1 + i;
        if (this.enemies.has(index)) {
          this.opts.log(`Saint-Milion E-${head.index.toString(16)}: slot E-${index.toString(16)} is taken, that ${i < SM_PART_COUNT ? 'part' : 'tentacle'} cannot be hit`);
          continue;
        }
        const part = i < SM_PART_COUNT;
        const lead = !part && (i - SM_PART_COUNT) % 4 === 0;
        const row = part ? 32 + v * 4 : (lead ? 33 : 35) + v * 4;
        const hp = part ? ai.parts[i].maxHp : ai.field.entities[i - SM_PART_COUNT].maxHp;
        const fight = this.rowFightStats(row, hp);
        const placed = {
          ...head.instance.placed,
          entity: { ...(head.instance.placed.entity as EnemySet), index: -1 - index },
          world: [ai.x, 0, ai.z] as [number, number, number],
          yaw: 0,
          name: part ? 'Saint-Milion part' : 'Saint-Milion tentacle',
        };
        const spec = { ...head.instance.spec, name: 'Episode4BossChild', parts: [] };
        const instance = await this.layer.spawn(placed as typeof head.instance.placed, spec as typeof head.instance.spec);
        if (!instance || this.disposed) return;
        instance.root.visible = false;
        const rt: EnemyRuntime = {
          instance,
          index,
          slot: head.slot,
          ...fight,
          exp: 0,
          motions: head.motions,
          rtIndex: 0xff,
          dead: false,
          state: 'idle',
          removeIn: 0,
          ai: new SmChildAi(ai, i),
          lift: 0,
          monest: null,
          parent: head,
          fake: null,
          buffs: new EntityBuffs(),
          status: new EnemyStatus(enemyAttribute(head.slot.type)),
        };
        this.enemies.set(index, rt);
        view.proxies[i] = rt;
      }
    }
  }

  private tickSaintMilion(e: EnemyRuntime, ai: SaintMilionAi, targets: AiTarget[]): void {
    const inst = e.instance;
    const root = inst.root;
    const view = this.smHeads.get(e.index);
    const r = ai.tick(targets);
    // The body stands on the ground under it.
    const gy = this.opts.ground?.(r.x, r.z, root.position.y + 30) ?? null;
    root.position.set(r.x, gy ?? root.position.y, r.z);
    root.rotation.y = r.angle;
    let bodies = view?.bodies ?? null;
    if (view && !bodies) {
      bodies = inst.animators.filter((_, k) => !inst.parts[k]?.name);
      view.bodies = bodies;
    }
    for (const a of bodies ?? []) {
      if (r.motion) {
        try {
          a.play(inst.archive.motion(r.motion.index, a.nodeCount), r.motion.speed, r.motion.loop);
        } catch (err) {
          this.opts.log(`Saint-Milion motion ${r.motion.index}: ${(err as Error).message}`);
        }
      }
      a.paused = true;
      a.setFrame(ai.mframe);
    }
    // The model draw records the nodes the hit boxes sit on (matrix slots).
    const tree = inst.nodes?.[0];
    if (tree) {
      root.updateMatrixWorld(true);
      const v = this.smVec;
      for (let slot = 0; slot < SM_NODES.length; slot++) {
        const o = tree[SM_NODES[slot]];
        if (!o) continue;
        o.getWorldPosition(v);
        ai.nodes[slot * 3] = v.x;
        ai.nodes[slot * 3 + 1] = v.y;
        ai.nodes[slot * 3 + 2] = v.z;
        // The node's world +Z (column 2 of the column-major matrix): the laser's heading (SM_LASER.headingSlot).
        const me = o.matrixWorld.elements;
        ai.axes[slot * 2] = me[8];
        ai.axes[slot * 2 + 1] = me[10];
      }
      ai.nodesKnown = true;
      ai.axesKnown = true;
    }
    for (const ev of ai.events.splice(0)) this.smEvent(e, ai, ev);
    if (r.shots) for (const s of r.shots) this.launchShot(e, s);
    this.syncSaintMilion(e, ai, view);
  }

  private smEvent(e: EnemyRuntime, ai: SaintMilionAi, ev: SmBossEvent): void {
    const what = `Saint-Milion E-${e.index.toString(16)}`;
    switch (ev.kind) {
      case 'send':
        this.game.sendEpisode4BossAction(ev.action, ev.param);
        this.opts.log(`${what}: 6xDC action ${ev.action} param 0x${ev.param.toString(16)} (state 0x${ai.sid.toString(16)})`);
        return;
      case 'se':
        this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
        this.sePlayer?.play(ev.id, ev.loop ? { loop: true } : {});
        return;
      case 'seStop':
        this.sePlayer?.stop(ev.id);
        return;
      case 'bgm':
        // ASSUMED: the track swap is not played here (audio/bossbgm.ts keeps the floor's track).
        this.opts.log(`${what}: ${ev.name}`);
        return;
      case 'effect':
        // Not reproduced: the visuals of the effect names (the shots they make are launched through out.shots).
        this.opts.log(`${what}: ${ev.name} (not reproduced)`);
        return;
      case 'phase':
        this.opts.log(`${what}: form ${ev.form}`);
        return;
      case 'setDead':
        this.game.sendEntitySetFlags(0x1000 | e.index, this.floor, 8);
        return;
      case 'gone':
        // The tentacle's own set_monster_spawn_initdata_as_dead.
        this.game.sendEntitySetFlags(0x1000 | (e.index + 1 + SM_PART_COUNT + ev.slot), this.floor, 8);
        return;
      case 'killed': {
        e.dead = true;
        e.stats.hp = 0;
        if (ev.ours === null) this.smLastHit.delete(e.index);
        else this.smLastHit.set(e.index, ev.ours);
        if (this.lockOn === e) this.lockOn = null;
        this.bossKilled(e, ev.x, ev.z, this.smLastHit, 'Saint-Milion');
        return;
      }
    }
  }

  // The children follow the brain: parts on their model nodes, tentacles at
  // their spots; the tentacle models are the head's hidden world parts.
  private syncSaintMilion(e: EnemyRuntime, ai: SaintMilionAi, view: { proxies: Array<EnemyRuntime | null> } | undefined): void {
    const shown = e.instance.root.visible;
    const base = e.instance.root.position.y;
    for (let i = 0; i < SM_PART_COUNT; i++) {
      const rt = view?.proxies[i];
      if (!rt) continue;
      const p = ai.parts[i];
      const n = ai.node(5 + i);
      rt.instance.root.position.set(n ? n[0] : ai.x, n ? n[1] : base, n ? n[2] : ai.z);
      rt.instance.root.visible = shown && ai.partHittable(i);
      rt.stats.hp = p.hp;
      rt.stats.maxHp = p.maxHp;
      rt.dead = false;
    }
    const world = e.instance.world;
    ai.field.entities.forEach((t, k) => {
      const rt = view?.proxies[SM_PART_COUNT + k];
      const gy = this.opts.ground?.(t.x, t.z, base + 30) ?? base;
      if (rt) {
        rt.instance.root.position.set(t.x, gy + t.hitHeight, t.z);
        rt.instance.root.visible = shown && t.targetable;
        rt.stats.hp = t.hp;
        rt.stats.maxHp = t.maxHp;
        rt.dead = false;
      }
      const g = world?.getObjectByName(`spinner ${k}`);
      if (!g) return;
      g.visible = shown && !t.hidden && !t.gone;
      if (!g.visible) return;
      g.position.set(t.x, gy, t.z);
      g.rotation.y = t.heading * BAMS_TO_RAD;
      const idx = e.instance.parts.findIndex((p) => p.name === `spinner ${k}`);
      const a = e.instance.animators.find((_, j) => e.instance.parts[j]?.name === `spinner ${k}`);
      if (a) {
        try {
          a.play(e.instance.archive.motion(t.motion, a.nodeCount), 1, false);
        } catch {
          // A bad motion keeps the last pose.
        }
        a.paused = true;
        a.setFrame(t.frame);
      }
      // The procedural pose (SaintEmilionUpdateGlobalState 0x0076d138): z slides
      // nodes 3 and 8 along their x axis, x scales nodes 46, 49, 52 and 55.
      const tree = e.instance.nodes?.[idx];
      if (tree) {
        for (const n of [3, 8]) if (tree[n]) tree[n].position.x += t.rise;
        const [sx, sy, sz] = spinnerScale(t.shrink);
        for (const n of SPINNER_X.scaleNodes) if (tree[n]) tree[n].scale.multiply(this.smScale.set(sx, sy, sz));
      }
    });
  }

  // A strike on a part or a tentacle. The entity's hp is its own; the 6x0A
  // carries max - hp, as the exe sends it before the revive.
  private smChildHit(e: EnemyRuntime, c: SmChildAi, damage: number, critical: boolean, flags: number, byPlayer: boolean, what: string): void {
    const owner = c.owner;
    let total = 0;
    let dead = false;
    if (c.part) {
      owner.hitPart(c.index, damage, byPlayer);
      total = c.part.maxHp - c.part.hp;
      dead = c.part.hp <= 0;
      if (damage >= 1) this.smLastHit.set(c.index, byPlayer);
    } else if (c.entity) {
      c.entity.hit(damage);
      total = c.entity.maxHp - c.entity.hp;
      dead = c.entity.hp <= 0;
    }
    this.sendEnemy(e, flags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED) | (dead ? FLAG_DEAD : 0), Math.max(0, total));
    const p = e.instance.root.position;
    this.num(damage, critical, p.x, p.y + 20, p.z);
    this.opts.log(`${what}hit Saint-Milion's ${c.part ? 'part ' + c.index : 'tentacle ' + (c.index - SM_PART_COUNT)} for ${Math.round(damage)}`);
  }

  // A 6xDC from the leader.
  private onSaintMilionAction(body: Uint8Array): void {
    if (body.length < 8 || this.game.selfId === this.game.leaderId) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    for (const e of this.enemies.values()) {
      if (e.ai instanceof SaintMilionAi && !e.dead) {
        e.ai.applyRemote(dv.getUint16(4, true), dv.getUint16(6, true));
        return;
      }
    }
  }

  // --- Vol Opt (combat/volopt.ts, combat/volopt2.ts) ---------------------------
  //
  // Phase 1 is one brain (the control object, TBoss3Volopt) that owns 6
  // pillars, 24 monitors, the rod, the core and the prison; each of them gets
  // an invisible enemy of its own in the slot the exe gives it (control + the
  // VO_ID offsets) so strikes, techniques, the lock-on and the other clients'
  // 6x0A find it by entity id. Phase 2 (TBoss3VoloptP02) is its own enemy and
  // brain; the control links to it. Hits land on the brain's pools; the
  // brain's states decide what a hit does (a monitor of the core's wall and
  // the red pillar pass it to the core), and the brain owns every death.
  //
  // Sync, as the exe has it: the room leader's director sends 6x15 / 6x16 /
  // 6x84 / 6x17 / 6x85 and applies them itself; every client runs every
  // state machine from those orders and from the 6x0A of each entity (the
  // attacker's client sends them); the form 2 reaction sends 6x18 with the four
  // part HPs; a pillar's lightning sends 6x15 action 2 when the rod lies on
  // the floor (every client does). Kill sends follow the exe's gating at the
  // body's death frame (voloptKilled).

  // The frame count of a motion of an enemy's archive; `part` names the part
  // whose node tree it is for (null: the first animated one).
  private motionFrames(instance: EnemyInstance, part: string | null): (motion: number) => number {
    const cache = new Map<number, number>();
    return (m) => {
      let n = cache.get(m);
      if (n === undefined) {
        const k = part ? instance.parts.findIndex((p) => p.name === part) : 0;
        const nodeCount = instance.animators[Math.max(0, k)]?.nodeCount ?? 0;
        try {
          n = instance.archive.motion(m, nodeCount).frameCount;
        } catch {
          n = 30;
        }
        cache.set(m, n);
      }
      return n;
    };
  }

  // The control, per floor; its parts' enemies and the groups it moves (by
  // head enemy index; filled once).
  private voloptViews = new Map<number, VoloptView>();
  private voloptHead: EnemyRuntime | null = null;
  private voloptBody: EnemyRuntime | null = null;
  // Whether the last strike on the body was ours (its last_attacker, +0x2d8),
  // by enemy index; an entry means the body has a last attacker.
  private voloptLastHit = new Map<number, boolean>();
  // The strike being resolved (combat/combat.ts resolveHit): a monitor that
  // passes it to the core rolls the same attack again.
  private strike: { attackType: number; step: number } | null = null;
  private voloptHeld = false;

  // On entering the floor: the control gets the parts' enemies and is linked
  // to the body (a room without a TBoss3VoloptP02 has nothing to link; the
  // control then ends its fight 2 at once instead of waiting for it).
  private async spawnVolopt(): Promise<void> {
    this.voloptHead = null;
    this.voloptBody = null;
    for (const e of this.enemies.values()) {
      if (e.ai instanceof VoloptAi) this.voloptHead = e;
      else if (e.ai instanceof VoloptForm2Ai) this.voloptBody = e;
    }
    const head = this.voloptHead;
    if (!head || !(head.ai instanceof VoloptAi)) return;
    head.ai.form2 = this.voloptBody?.ai instanceof VoloptForm2Ai ? this.voloptBody.ai : null;
    await this.spawnVoloptParts(head, head.ai);
    this.opts.log(`Vol Opt E-${head.index.toString(16)}: ${head.ai.parts.length} parts${this.voloptBody ? ', body E-' + this.voloptBody.index.toString(16) : ', no body'}`);
  }

  private voloptView(e: EnemyRuntime, ai: VoloptAi): VoloptView {
    let v = this.voloptViews.get(e.index);
    if (v) return v;
    const world = e.instance.world;
    // The parts' node trees, by the spec's part names (instance.nodes is in spec order).
    const nodesOf = (name: string): THREE.Object3D[] | null => {
      const k = e.instance.spec.parts.findIndex((p) => p.name === name);
      return e.instance.nodes?.[k] ?? null;
    };
    v = {
      pillars: ai.pillars.map((p) => world?.getObjectByName(`pillar ${p.index}`) ?? null),
      lids: ai.pillars.map((p): VoloptLidView | null => {
        const name = `pillar ${p.index} lid`;
        const group = world?.getObjectByName(name);
        const nodes = nodesOf(name);
        if (!group || !nodes || nodes.length < 2) return null;
        return { group, first: nodes[0], child: nodes[1], firstY: nodes[0].position.y, childY: nodes[1].position.y };
      }),
      monitors: ai.monitors.map((m) => world?.getObjectByName(`monitor ${m.index}`) ?? null),
      brokenMonitors: ai.monitors.map((m) => world?.getObjectByName(`monitor ${m.index} broken`) ?? null),
      rod: world?.getObjectByName('lightning rod') ?? null,
      core: world?.getObjectByName('core') ?? null,
      proxies: ai.parts.map((): EnemyRuntime | null => null),
      spin: 0,
    };
    this.voloptViews.set(e.index, v);
    return v;
  }

  // BattleParamEntry row of an exe entity (not newserv's guess, which maps the
  // core to row 38): stats, resist, attack.
  private rowFightStats(row: number, hp: number) {
    const base = this.childFightStats('VOL_OPT_PILLAR');
    const ctx = this.difficultyParams;
    if (!ctx?.params) return hp > 0 ? { ...base, stats: { ...base.stats, hp, maxHp: hp } } : base;
    const { params, difficulty } = ctx;
    const st = params.stats(difficulty, row);
    const rs = params.resist(difficulty, row);
    const attack = params.attack(difficulty, row);
    let stats = enemyDefender(st, rs);
    if (hp > 0) stats = { ...stats, hp, maxHp: hp };
    return {
      stats,
      attack,
      attacker: enemyAttacker(st, attack),
      exp: 0,
      esp: st.esp,
      resist: { efr: rs.efr, eic: rs.eic, eth: rs.eth, elt: rs.elt, edk: rs.edk } as TechResist,
    };
  }

  // Each part's enemy, in the slot control + VO_ID.*.
  private async spawnVoloptParts(head: EnemyRuntime, ai: VoloptAi): Promise<void> {
    const v = this.voloptView(head, ai);
    const rows: Record<string, number> = { pillar: 34, monitor: 35, rod: 36, core: 33, prison: 38 };
    for (let i = 0; i < ai.parts.length; i++) {
      const part = ai.parts[i];
      // Not built in Ultimate (g_VoloptDifficultyMode != 0).
      if (part.kind === 'rod' && ai.ultimate) continue;
      const index = head.index + part.entity;
      if (this.enemies.has(index)) {
        this.opts.log(`Vol Opt E-${head.index.toString(16)}: slot E-${index.toString(16)} (${part.kind}) is taken, that part cannot be shot`);
        continue;
      }
      const fight = this.rowFightStats(rows[part.kind], part.maxHp);
      const placed = {
        ...head.instance.placed,
        entity: { ...(head.instance.placed.entity as EnemySet), index: -1 - index },
        world: [part.x, part.y, part.z] as [number, number, number],
        yaw: 0,
        name: 'Vol Opt part',
      };
      const spec = { ...head.instance.spec, name: 'TBoss3VoloptPart', parts: [] };
      const instance = await this.layer.spawn(placed as typeof head.instance.placed, spec as typeof head.instance.spec);
      if (!instance || this.disposed) return;
      instance.root.visible = false;
      const rt: EnemyRuntime = {
        instance,
        index,
        slot: head.slot,
        ...fight,
        motions: head.motions,
        rtIndex: 0xff,
        dead: false,
        state: 'idle',
        removeIn: 0,
        ai: new VoloptPartAi(part, ai),
        lift: 0,
        monest: null,
        parent: head,
        fake: null,
        buffs: new EntityBuffs(),
        status: new EnemyStatus(enemyAttribute(head.slot.type)),
      };
      this.enemies.set(index, rt);
      v.proxies[i] = rt;
    }
  }

  private tickVolopt(e: EnemyRuntime, ai: VoloptAi, targets: AiTarget[]): void {
    const v = this.voloptView(e, ai);
    const r = ai.tick(targets);
    // The events can add events (an order applied here pushes its sound).
    for (let i = 0; i < ai.events.length; i++) this.voloptEvent(e, ai, ai.events[i]);
    ai.events.length = 0;
    const shots = r.shots;
    if (shots) for (let i = 0; i < shots.length; i++) this.launchShot(e, shots[i]);
    ai.sustained.forEach(this.playSustained);
    this.syncVolopt(e, ai, v);
  }

  private playSustained = (id: number): void => {
    this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
    if (!this.sePlayer?.playing(id)) this.sePlayer?.play(id);
  };

  private playSe(id: number, pitch?: number): void {
    this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
    this.sePlayer?.play(id, pitch ? { pitch } : {});
  }

  // play_directional_sound_effect (0x00814558): a sound at a point is not
  // played at all from 300 units or more away (the cut-off 0x00980ad4; the
  // fall-off of the 3D voice below it is not modelled, ASSUMED: the player
  // stands where the listener does).
  private playSeAt(id: number, at: THREE.Vector3, pitch?: number): void {
    const me = this.game.self ? this.view?.playerPositions().get(this.game.self.clientId) : null;
    if (me && Math.hypot(me.x - at.x, me.y - at.y, me.z - at.z) >= SE_CUTOFF) return;
    this.playSe(id, pitch);
  }

  // A technique object's sound: play_directional_sound_effect + the tier's
  // pitch command (combat/techlightning.ts).
  private playTechSe(f: FxSound): void {
    this.playSeAt(f.id, new THREE.Vector3(f.at.x, f.at.y, f.at.z), f.pitch || undefined);
  }

  // The parts' enemies follow their brain's point and exist for the player
  // only while the brain says the part can be hit; the models in the world
  // root follow the states.
  private syncVolopt(e: EnemyRuntime, ai: VoloptAi, v: VoloptView): void {
    const shown = e.instance.root.visible;
    for (let i = 0; i < ai.parts.length; i++) {
      const rt = v.proxies[i];
      if (!rt) continue;
      const part = ai.parts[i];
      rt.instance.root.position.set(part.x, part.y, part.z);
      rt.instance.root.visible = shown && part.targetable;
      rt.stats.hp = part.hp;
      rt.stats.maxHp = part.maxHp;
      rt.dead = false;
    }
    for (let i = 0; i < ai.pillars.length; i++) {
      const p = ai.pillars[i];
      const g = v.pillars[i];
      if (g) {
        g.position.y = p.yOff;
        g.visible = p.yOff > -39;
      }
      // The lid is drawn where the pillar is (0x0044b9a0): its first node at
      // (0, b, 0) and its child at (0, a, 0), VoloptLid's state.
      const lid = v.lids[i];
      if (lid) {
        lid.group.position.y = p.yOff;
        lid.group.visible = p.yOff > -39;
        lid.first.position.y = lid.firstY + p.lid.b;
        lid.child.position.y = lid.childY + p.lid.a;
      }
    }
    for (let i = 0; i < ai.monitors.length; i++) {
      // A fallen monitor shows its broken model (0x00441902 swaps the model
      // entry for table 0x009a5230's); the others show the screen.
      const dead = ai.monitors[i].dead;
      const g = v.monitors[i];
      if (g) g.visible = !dead;
      const broken = v.brokenMonitors[i];
      if (broken) broken.visible = dead;
    }
    if (v.rod) {
      // State 1 turns it by 0x800 BAMS a tick.
      v.spin = (v.spin + 0x800 * BAMS_TO_RAD) % (Math.PI * 2);
      v.rod.position.y = ai.rod.y0;
      v.rod.rotation.y = v.spin;
      v.rod.visible = ai.ai <= 3;
    }
    if (v.core) {
      v.core.visible = !ai.core.hidden && ai.ai <= 2;
      v.core.position.set(ai.core.x, ai.core.y, ai.core.z);
      v.core.rotation.y = -(ai.core.angle * BAMS_TO_RAD);
    }
  }

  private voloptEvent(e: EnemyRuntime, ai: VoloptAi, ev: VoloptEvent): void {
    const what = `Vol Opt E-${e.index.toString(16)}`;
    const id = 0x1000 | e.index;
    switch (ev.kind) {
      case 'action': {
        const body = this.game.sendVoloptAction(id, ev.action, ev.target, ev.param, ev.count);
        const phase = bossPhaseOf(this.area, 0x15, body);
        if (phase !== null) this.opts.bossPhase?.(phase);
        this.applyVoloptAction(ai, ev.action, ev.target, ev.param, ev.count);
        this.opts.log(`${what}: 6x15 action ${ev.action}${ev.target !== 0 ? ` target ${ev.target}` : ''}${ev.action === 0 ? ` from monitor ${ev.param}, ${ev.count} walls` : ''}`);
        return;
      }
      case 'pillars': {
        this.game.sendVoloptPillars(id, ev.table, ev.count, ev.technique);
        ai.applyPillars(ev.table, ev.count);
        this.opts.log(`${what}: ${ev.count} pillars rise, the red one is ${ev.table[0]}${ev.technique !== null ? ` (technique ${ev.technique})` : ''}`);
        return;
      }
      case 'delays':
        this.game.sendVoloptDelays(ev.action, ev.delays);
        ai.applyDelays(ev.action, ev.delays);
        return;
      case 'move': {
        this.game.sendEntityPosition(ev.client, ev.x, ev.y, ev.z, ev.angle);
        if (ev.client === this.game.selfId) this.opts.warpSelf?.({ x: ev.x, y: ev.y, z: ev.z }, ev.angle * BAMS_TO_RAD);
        return;
      }
      case 'coreHit':
        if (ev.local) this.voloptCoreStrike(ai);
        return;
      case 'se':
        this.playSe(ev.id);
        return;
      case 'phase':
        this.opts.log(`${what}: ${ai.state}`);
        // unknown_set_volopt_form2 plays vol_opt2.adx as the change begins.
        if (ev.phase === VO_AI.change) this.opts.bossPhase?.(2);
        if (ev.phase === VO_AI.over && ai.form2?.dead) this.voloptOver();
        return;
      default:
        return;
    }
  }

  // VoloptDeathHandler (the control's state 4 sees g_VoloptIsDead): online it
  // is set_quest_flag(0x2A) (6x75 to the server) and
  // unhide_objects_for_volopt_death(0): unhide_object_set_no_packet for group
  // 1 and group 3 of room 0, which is what an event's construct_objects does.
  // Every client runs it; the flag is idempotent on the server.
  private voloptOver(): void {
    this.game.setQuestFlag(0x2a, true);
    this.opts.constructObjects?.(this.floor, 0, 1);
    this.opts.constructObjects?.(this.floor, 0, 3);
    this.opts.log('Vol Opt defeated: quest flag 0x2a set, room 0 groups 1 and 3 appear');
  }

  // An order of the leader (or our own): the control's actions 0..2 and the
  // body's 3..7.
  private applyVoloptAction(ai: VoloptAi, action: number, target: number, param: number, count: number): void {
    if (action <= 2) ai.applyAction(action, param, count);
    else (ai.form2 as VoloptForm2Ai | null)?.applyAction(action, target, param);
  }

  // player_hit_volopt_core: the core takes the attacker's strike through the
  // monitor or pillar that reached it (try_hit_entity, mult 1.0). We roll it
  // when we were the attacker; the others' clients roll theirs and send
  // their 6x0A. ASSUMED: a strike of a technique counts as a normal one.
  private voloptCoreStrike(ai: VoloptAi): void {
    const v = this.voloptHead ? this.voloptViews.get(this.voloptHead.index) : null;
    const core = v?.proxies[ai.parts.indexOf(ai.core)];
    if (!core || ai.core.dead || !this.game.self) return;
    const attacker = this.attackerStats();
    const defender = this.enemyDefenderOf(core);
    const type: AttackType = this.strike && this.strike.attackType !== 2 ? (this.strike.attackType as AttackType) : 0;
    const step = this.strike?.step ?? 0;
    let damage = 0;
    let critical = false;
    if (rollHit(attacker, defender, type, step, this.rng)) {
      const r = rollDamage(attacker, defender, type, this.rng);
      damage = r.damage;
      critical = r.critical;
    }
    this.applyEnemyHit(core, ENEMY_BASE_FLAGS, damage, critical, 'the core takes it through the wall: ');
  }

  // A strike (or a 6x0A) on a part.
  private voloptPartHit(e: EnemyRuntime, ai: VoloptPartAi, damage: number, critical: boolean, flags: number, local: boolean, what: string): void {
    const part = ai.part;
    ai.owner.damagePart(part.entity, damage, local);
    e.stats.hp = part.hp;
    const dead = part.hp <= 0;
    this.sendEnemy(e, flags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED) | (dead ? FLAG_DEAD : 0), Math.max(0, part.maxHp - part.hp));
    const p = e.instance.root.position;
    this.num(damage, critical, p.x, p.y + 10, p.z);
    this.opts.log(`${what}hit Vol Opt ${part.kind}${part.kind === 'pillar' || part.kind === 'monitor' ? ` ${part.index}` : ''} for ${Math.round(damage)}: ${part.hp}/${part.maxHp}`);
  }

  // --- phase 2 ---------------------------------------------------------------

  private voloptBodyAnim = new Map<number, { animators: NodeAnimator[]; slot: number }>();

  // The flying cage of the capture (VoloptCage, vtable 0x00AF6710). ASSUMED
  // look: a ball. The exe has no model for it: its constructor 0x0044A54C only
  // starts the particle emitters 0x11C and 0x11D (pushed at 0x0044A5B8 and
  // 0x0044A5F7), so the ball stands in for them.
  private voloptCage: THREE.Mesh | null = null;
  private readonly voloptCagePos: [number, number, number] = [0, 0, 0];
  private voloptCageBall(ai: VoloptForm2Ai): void {
    const live = ai.cagePosition(this.voloptCagePos);
    if (!live) {
      if (this.voloptCage) this.voloptCage.visible = false;
      return;
    }
    if (!this.voloptCage) {
      try {
        this.voloptCage = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: 0x80c0ff }));
        this.viewer.scene.add(this.voloptCage);
      } catch {
        return;
      }
    }
    this.voloptCage.visible = true;
    this.voloptCage.position.set(this.voloptCagePos[0], this.voloptCagePos[1], this.voloptCagePos[2]);
  }

  private tickVoloptForm2(e: EnemyRuntime, ai: VoloptForm2Ai, targets: AiTarget[]): void {
    const inst = e.instance;
    const root = inst.root;
    const r = ai.tick(targets);
    root.position.set(r.x, root.position.y, r.z);
    root.rotation.y = r.angle;
    // The body's motion is the brain's slot and frame.
    let b = this.voloptBodyAnim.get(e.index);
    if (!b) {
      b = { animators: inst.animators.filter((_, k) => !inst.parts[k]?.name), slot: -1 };
      this.voloptBodyAnim.set(e.index, b);
    }
    const changed = b.slot !== ai.animSlot;
    b.slot = ai.animSlot;
    const sl = FORM2_SLOTS[ai.animSlot];
    for (let k = 0; k < b.animators.length; k++) {
      const a = b.animators[k];
      if (changed) {
        try {
          a.play(inst.archive.motion(sl.motion, a.nodeCount), sl.speed, sl.mode === 1);
        } catch (err) {
          this.opts.log(`Vol Opt form 2 motion ${sl.motion}: ${(err as Error).message}`);
        }
      }
      a.paused = true;
      a.setFrame(ai.animFrame);
    }
    for (let i = 0; i < ai.events.length; i++) this.voloptForm2Event(e, ai, ai.events[i]);
    ai.events.length = 0;
    if (ai.removed) {
      e.dead = true;
      root.visible = false;
      this.voloptBodyAnim.delete(e.index);
      if (this.lockOn === e) this.lockOn = null;
      return;
    }
    const shots = r.shots;
    if (shots) for (let i = 0; i < shots.length; i++) this.launchShot(e, shots[i]);
    ai.sustained.forEach(this.playSustained);
    this.voloptCageBall(ai);
    // The prison holds the captured player (the cage entity's 0x20000 flag and
    // the position it sets), and lets go when the timer or the HP end it.
    const me = this.game.selfId;
    if (ai.captured === me && !this.voloptHeld && !this.damage.dead) {
      this.voloptHeld = true;
      const p = this.view?.playerPositions().get(me);
      if (p) this.imposeHold({ frames: ai.prisonFrames, particle: 0, x: p.x, z: p.z, radius2: 25 }, `Vol Opt E-${e.index.toString(16)}'s prison`);
    } else if (this.voloptHeld && ai.captured !== me) {
      this.voloptHeld = false;
      if (this.holdTicks > 0) this.game.sendReleaseHold();
      this.holdTicks = 0;
      this.opts.log(`Vol Opt E-${e.index.toString(16)}: the prison lets go`);
    }
  }

  private voloptForm2Event(e: EnemyRuntime, _ai: VoloptForm2Ai, ev: VoloptEvent): void {
    switch (ev.kind) {
      case 'partsHp': {
        const body = this.game.sendVoloptPartsHp(0x1000 | e.index, ev.hp);
        void body;
        this.opts.log(`Vol Opt E-${e.index.toString(16)}: parts ${ev.hp.join('/')} (6x18)`);
        return;
      }
      case 'se':
        this.playSe(ev.id);
        return;
      case 'killed':
        this.voloptKilled(e, ev.x, ev.z);
        return;
      default:
        return;
    }
  }

  // ProcessPlayerVoloptTransition sub 3 (the death motion past frame 47):
  // on_enemy_killed, the dead flag, set_monster_spawn_initdata_as_dead. Every
  // client runs it, and its sends are gated as the exe gates them (the same
  // as De Rol Le's, see deRolLeKilled).
  private voloptKilled(e: EnemyRuntime, x: number, z: number): void {
    // The body goes 16 frames later (the brain's last step), not now.
    e.stats.hp = 0;
    this.bossKilled(e, x, z, this.voloptLastHit, 'Vol Opt');
  }

  // A 6x15 / 6x16 / 6x17 / 6x18 / 6x84 / 6x85 from another client.
  private onVoloptSub(sub: number, body: Uint8Array): void {
    const head = this.voloptHead;
    const ai = head?.ai;
    if (!(ai instanceof VoloptAi) || body.length < 8) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const f2 = ai.form2 as VoloptForm2Ai | null;
    switch (sub) {
      case 0x15:
        if (body.length >= 0x0c) this.applyVoloptAction(ai, dv.getUint16(4, true), dv.getUint16(6, true), dv.getInt16(8, true), dv.getUint16(10, true));
        return;
      case 0x85:
        // Ultimate: action 0 stores three delays.
        if (body.length >= 0x0c) ai.applyDelays(dv.getUint16(4, true), [dv.getInt16(6, true), dv.getInt16(8, true), dv.getInt16(10, true)]);
        return;
      case 0x16:
      case 0x84: {
        if (body.length < 0x0c) return;
        const table: number[] = [];
        for (let i = 0; i < 6; i++) table.push(body[4 + i]);
        ai.applyPillars(table, dv.getUint16(10, true));
        return;
      }
      case 0x17:
        // The leader carries a player to the second arena.
        if (body.length >= 0x14 && dv.getUint16(2, true) === this.game.selfId) {
          this.opts.warpSelf?.({ x: dv.getFloat32(4, true), y: dv.getFloat32(8, true), z: dv.getFloat32(12, true) }, dv.getUint32(16, true) * BAMS_TO_RAD);
        }
        return;
      case 0x18:
        if (body.length >= 0x0c && f2) f2.applyPartsHp([dv.getInt16(4, true), dv.getInt16(6, true), dv.getInt16(8, true), dv.getInt16(10, true)]);
        return;
      default:
        return;
    }
  }

  // --- Dark Falz (combat/darkfalz.ts, darkfalz1.ts .. darkfalz3.ts) -------------------
  //
  // TBoss4DarkFalz is one brain (the control, 16 scenes) that owns the three
  // forms and the Darvants. Each of them gets an enemy of its own in the slot the
  // exe gives it (control + 0x200 / 0x1FF / 0x1FE for the forms, + 1.. for the
  // Darvants) so strikes, techniques, the lock-on and the other clients' 6x0A
  // find it by entity id; the brain decides what a hit does and owns every death.
  // The forms are drawn with the control's parts (form 1: the six first, form 2
  // and form 3: the later pairs, formats/enemymodels.ts), moved to the pose the
  // brain gives; the control's own enemy is the only one with a model.
  //
  // Sync, as the exe has it: every client runs every state machine; the leader's
  // decisions go out as 6x19 (the sender applies them itself first) and the damage
  // as each entity's 6x0A. The ending's kill sends (on_enemy_killed) follow
  // mark_falz_as_dead_and_request_drop at the end of OL ENDING, on every client.

  private falzHead: EnemyRuntime | null = null;
  // The Gal Gryphon's thrown minions (combat/galgryphon.ts). The brain's S7 handler
  // (animation 20.5) throws them through GalgryphonAi's throwMinion (spawn wiring above).
  private readonly galMinions = new GalgryphonMinionManager();
  // Dark Falz's cutscene camera file (bo04opcam.rel), read on the first call of bossCameraView.
  private bossCameraRel: CameraRel | null = null;
  private bossCameraLoad: Promise<void> | null = null;
  private falzProxies = new Map<number, EnemyRuntime>(); // by offset from the control
  private falzSpawning = new Set<number>();
  // Whether the last strike on an entity (by enemy index) was ours.
  private falzLastHit = new Map<number, boolean>();
  private falzDrawn: { groups: THREE.Object3D[]; ids: number[] } | null = null;
  private falzMarkMeshes: THREE.Mesh[] = [];
  private falzReachPoint: [number, number, number] = [0, 0, 0];

  private resetDarkFalz(): void {
    this.falzHead = null;
    this.falzProxies.clear();
    this.falzSpawning.clear();
    this.falzLastHit.clear();
    this.falzDrawn = null;
    for (const m of this.falzMarkMeshes) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.falzMarkMeshes = [];
  }

  // BattleParamEntry rows 53..57 of the difficulty (the exe's
  // get_battleparams_stats / _animation_speeds): HP, ATP and the MovementData
  // fparam1 / iparam1..4 the fight reads. Normal's numbers when the table is not
  // loaded.
  private falzRows(params: BattleParams | null, difficulty: number): DfRows {
    const fall: Array<[number, number, number, number[]]> = [
      [125, 80, 0.38, [3, 0, 0, 0]],
      [5900, 700, 13, [9, 6, 550, 0]],
      [6500, 750, 5, [2, 4, 0, 0]],
      [9000, 800, 0.3, [3, 3, 3, 20000]],
      [250, 220, 0.5, [4, 0, 0, 0]],
    ];
    const row = (i: number): DfRow => {
      if (!params) {
        const f = fall[i - 53];
        return { hp: f[0], atp: f[1], f1: f[2], i1: f[3][0], i2: f[3][1], i3: f[3][2], i4: f[3][3] };
      }
      const st = params.stats(difficulty, i);
      const mv = params.movement(difficulty, i);
      return { hp: st.hp, atp: st.atp, f1: mv.fparam1, i1: mv.iparam[0], i2: mv.iparam[1], i3: mv.iparam[2], i4: mv.iparam[3] };
    };
    return { darvant: row(53), df1: row(54), df2: row(55), df3: row(56), darvantFalz: row(57) };
  }

  // The control and the forms' enemies (the Darvants' come with their events).
  private async spawnDarkFalz(): Promise<void> {
    this.falzHead = null;
    for (const e of this.enemies.values()) if (e.ai instanceof DarkFalzAi) this.falzHead = e;
    const head = this.falzHead;
    if (!head || !(head.ai instanceof DarkFalzAi)) return;
    for (const entity of [DF_ID.form1, DF_ID.form2, DF_ID.form3]) await this.spawnFalzProxy(head, head.ai, entity);
    this.opts.log(`Dark Falz E-${head.index.toString(16)}: ${this.falzProxies.size} form slots`);
  }

  // An invisible enemy for a form, or a small model for a Darvant, in the slot
  // control + entity.
  private async spawnFalzProxy(head: EnemyRuntime, ai: DarkFalzAi, entity: number): Promise<void> {
    const index = head.index + entity;
    if (this.enemies.has(index) || this.falzSpawning.has(entity)) return;
    this.falzSpawning.add(entity);
    const darvant = entity >= DF_ID.darvant && entity <= DF_ID.lastDarvant;
    const part = ai.part(entity);
    const type = darvant ? 'DARVANT' : entity === DF_ID.form1 ? 'DARK_FALZ_1' : entity === DF_ID.form2 ? 'DARK_FALZ_2' : 'DARK_FALZ_3';
    const fight = this.childFightStats(type);
    const hp = part?.maxHp ?? fight.stats.maxHp;
    const stats = { ...fight.stats, hp, maxHp: hp };
    const placed = {
      ...head.instance.placed,
      entity: { ...(head.instance.placed.entity as EnemySet), index: -1 - index },
      world: [part?.x ?? 0, part?.y ?? 0, part?.z ?? 0] as [number, number, number],
      yaw: 0,
      name: 'Dark Falz part',
    };
    // ASSUMED: a Darvant is drawn as the archive's fd_obj813 face (model 16,
    // motion 39); the forms need no model of their own.
    const spec = {
      ...head.instance.spec,
      name: 'TBoss4DarkFalzPart',
      parts: darvant ? [{ model: 16, motion: { index: 39, speed: 0.5, loop: true } }] : [],
    };
    let instance = null;
    try {
      instance = await this.layer.spawn(placed as typeof head.instance.placed, spec as typeof head.instance.spec);
    } catch {
      instance = await this.layer.spawn(placed as typeof head.instance.placed, { ...spec, parts: [] } as typeof head.instance.spec);
    }
    this.falzSpawning.delete(entity);
    if (!instance || this.disposed) return;
    instance.root.visible = false;
    const rt: EnemyRuntime = {
      instance,
      index,
      slot: head.slot,
      ...fight,
      stats,
      motions: head.motions,
      rtIndex: 0xff,
      dead: false,
      state: 'idle',
      removeIn: 0,
      ai: new DarkFalzPartAi(entity, ai),
      lift: 0,
      monest: null,
      parent: head,
      fake: null,
      buffs: new EntityBuffs(),
      status: new EnemyStatus(enemyAttribute(head.slot.type)),
    };
    this.enemies.set(index, rt);
    this.falzProxies.set(entity, rt);
  }

  // The Dark Falz boss camera for the field (render/gamefield.ts opts.bossCamera):
  // the control's view for its scene (combat/darkfalzcamera.ts), null outside the
  // cutscenes and while the camera asset is not read.
  bossCameraView(): { source: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } } | null {
    const head = this.falzHead;
    if (!head || !(head.ai instanceof DarkFalzAi)) return null;
    this.loadBossCamera();
    // The live pivots come from the control's scene enters (darkfalz.ts cameraLive), read each call.
    const rel = this.bossCameraRel;
    const v = head.ai.cameraView(rel ? cameraSourceOf(rel, head.ai.cameraLive()) : null);
    if (!v) return null;
    return {
      source: { x: v.source[0], y: v.source[1], z: v.source[2] },
      target: { x: v.target[0], y: v.target[1], z: v.target[2] },
      up: { x: v.up[0], y: v.up[1], z: v.up[2] },
    };
  }

  // Reads bo04opcam.rel once (data.gsl; the name is matched without case, see data/clientfiles.ts).
  private loadBossCamera(): void {
    if (this.bossCameraLoad) return;
    this.bossCameraLoad = (async () => {
      if (!(await this.files.has(DARKFALZ_CAMERA_FILE))) return;
      this.bossCameraRel = parseCameraRel(await this.files.read(DARKFALZ_CAMERA_FILE));
    })().catch(() => {
      this.bossCameraRel = null;
    });
  }

  private tickDarkFalz(e: EnemyRuntime, ai: DarkFalzAi, targets: AiTarget[]): void {
    const r = ai.tick(targets);
    for (let i = 0; i < ai.events.length; i++) this.falzEvent(e, ai, ai.events[i]);
    ai.events.length = 0;
    const shots = r.shots;
    if (shots) for (let i = 0; i < shots.length; i++) this.launchShot(e, shots[i]);
    this.syncDarkFalz(e, ai);
    if (ai.finished) {
      e.dead = true;
      e.instance.root.visible = false;
      this.falzDrawn = null;
    }
  }

  // The proxies follow their entity and exist for the player only while the
  // brain says it can be hit; the control's model shows the form that lives.
  private syncDarkFalz(e: EnemyRuntime, ai: DarkFalzAi): void {
    const me = this.view?.playerPositions().get(this.game.selfId);
    const px = me?.x ?? 0;
    const pz = me?.z ?? 0;
    const py = me?.y ?? 0;
    const reach = this.falzReachPoint;
    for (const [entity, rt] of this.falzProxies) {
      const part = ai.part(entity);
      const isDarvant = entity >= DF_ID.darvant && entity <= DF_ID.lastDarvant;
      if (!part || part.gone) {
        // A Darvant that sank out of sight leaves the floor.
        if (isDarvant) {
          this.layer.remove(rt.instance);
          this.enemies.delete(rt.index);
          this.falzProxies.delete(entity);
          if (this.lockOn === rt) this.lockOn = null;
        }
        continue;
      }
      const darvant = isDarvant;
      if (!darvant && ai.reachOf(entity, px, pz, reach)) {
        // The body offers the sphere nearest the player; its height is the player's
        // (the exe's hit spheres are ASSUMED to be reachable from the floor).
        rt.instance.root.position.set(reach[0], py, reach[2]);
      } else if (darvant) {
        const y = this.opts.ground?.(part.x, part.z, py + 30) ?? py;
        rt.instance.root.position.set(part.x, y + part.y, part.z);
      }
      rt.instance.root.visible = part.targetable;
      rt.stats.hp = part.hp;
      rt.stats.maxHp = part.maxHp;
      rt.dead = false;
    }
    this.drawDarkFalz(e, ai);
  }

  // The control's model: the groups of the form that lives, posed, and their
  // animation frame (the exe steps frames by its own rule, combat/darkfalzcommon.ts
  // DfAnim; the node animator is paused on the brain's frame).
  private drawDarkFalz(e: EnemyRuntime, ai: DarkFalzAi): void {
    const inst = e.instance;
    this.drawDemoWarp(inst, ai);
    if (!this.falzDrawn) {
      const groups = inst.root.children.slice(0, 12);
      this.falzDrawn = { groups, ids: [-1, -1, -1] };
    }
    const g = this.falzDrawn.groups;
    if (g.length < 10) return;
    const f1 = ai.form1;
    const f2 = ai.form2;
    const f3 = ai.form3;
    for (let k = 0; k < 6; k++) g[k].visible = !!f1;
    g[6].visible = g[7].visible = !!f2;
    g[8].visible = g[9].visible = !!f3;
    if (g.length > 11) g[10].visible = g[11].visible = false;
    const root = inst.root;
    if (f1) {
      root.position.set(f1.x, this.falzGroundY(f1.x, f1.z, root.position.y), f1.z);
      root.rotation.y = f1.yaw * BAMS_TO_RAD;
      this.falzPlay(inst, 0, F1_ANIM_ROWS, f1.anim.id, f1.anim.frame, 0);
    } else if (f2) {
      root.position.set(f2.x, f2.y, f2.z);
      root.rotation.y = f2.yaw * BAMS_TO_RAD;
      this.falzPlay(inst, 6, F2_ANIM_ROWS, f2.anim.id, f2.anim.frame, 1, true);
    } else if (f3) {
      root.position.set(f3.x, f3.y, f3.z);
      root.rotation.y = f3.yaw * BAMS_TO_RAD;
      this.falzPlay(inst, 8, F3_ANIM_ROWS, f3.anim.id, f3.anim.frame, 2);
    }
    // TENCHU's marks.
    const marks = f1 ? f1.markPoints : f2 ? f2.markPoints : NO_FALZ_MARKS;
    const nMarks = f1 ? f1.shownMarks : f2 ? f2.shownMarks : 0;
    for (let i = 0; i < nMarks; i++) {
      let m = this.falzMarkMeshes[i];
      if (!m) {
        try {
          m = new THREE.Mesh(new THREE.CircleGeometry(25, 16), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
          m.rotation.x = -Math.PI / 2;
          this.viewer.scene.add(m);
          this.falzMarkMeshes[i] = m;
        } catch {
          continue;
        }
      }
      m.position.set(marks[i][0], this.falzGroundY(marks[i][0], marks[i][2], 0) + 0.5, marks[i][2]);
      m.visible = true;
    }
    for (let i = nMarks; i < this.falzMarkMeshes.length; i++) this.falzMarkMeshes[i].visible = false;
  }

  // DEMO_WARP0's cutscene object (exe 0x004513D4 / 0x00451334, combat/darkfalz.ts
  // demoWarpFrame): the event tower and the two fd_obj813 parts are world parts
  // at the pivot (formats/enemymodels.ts), shown in that scene only. The face and the flower play
  // their motions at the object's timer (paused, the frame set each tick).
  private drawDemoWarp(inst: EnemyInstance, ai: DarkFalzAi): void {
    const frame = ai.warpFrame;
    const shown = frame !== null;
    for (const name of Object.values(DEMO_WARP_PARTS)) {
      const g = inst.world?.getObjectByName(name);
      if (g) g.visible = shown;
    }
    if (frame === null) return;
    for (const name of [DEMO_WARP_PARTS.face, DEMO_WARP_PARTS.flower]) {
      const a = inst.animators[inst.parts.findIndex((p) => p.name === name)];
      if (!a) continue;
      a.paused = true;
      a.setFrame(Math.max(0, frame));
    }
  }

  private falzGroundY(x: number, z: number, fallback: number): number {
    return this.opts.ground?.(x, z, fallback + 30) ?? fallback;
  }

  // Plays the clip `id` of `rows` on the animators of the form's parts (first =
  // the part index in the control's spec) when it changed and holds the frame.
  private falzPlay(inst: EnemyInstance, first: number, rows: readonly { mode: number; motions: readonly number[] }[], id: number, frame: number, form: number, reversed = false): void {
    const d = this.falzDrawn;
    if (!d) return;
    const row = rows[id];
    if (!row) return;
    const changed = d.ids[form] !== id;
    d.ids[form] = id;
    const n = row.motions.length >= 6 ? 6 : 2;
    for (let i = 0; i < n; i++) {
      const a = inst.animators[first + i];
      if (!a) continue;
      // Form 2's table lists the base's motion before the body's; the control's
      // spec lists the body (model 8) first.
      const motion = row.motions[reversed ? n - 1 - i : i];
      if (changed) {
        try {
          a.play(inst.archive.motion(motion, a.nodeCount), 1, row.mode === 0);
        } catch (err) {
          this.opts.log(`Dark Falz motion ${motion}: ${(err as Error).message}`);
        }
      }
      a.paused = true;
      a.setFrame(frame);
    }
  }

  private falzEvent(e: EnemyRuntime, ai: DarkFalzAi, ev: DfEvent): void {
    const what = `Dark Falz E-${e.index.toString(16)}`;
    switch (ev.kind) {
      case 'send':
        this.game.sendDarkFalz(0x1000 | e.index, ev.phase, ev.packed);
        if (ev.phase !== 0xffff) this.opts.log(`${what}: 6x19 scene ${SCENE_NAMES[ev.phase] ?? ev.phase}`);
        return;
      case 'scene':
        this.opts.log(`${what}: ${SCENE_NAMES[ev.scene]}`);
        return;
      case 'questFlag':
        this.game.setQuestFlag(ev.flag, true);
        this.opts.log(`${what}: quest flag 0x${ev.flag.toString(16)}`);
        return;
      case 'bgm':
        this.opts.bossPhase?.(ev.track);
        return;
      case 'se':
        this.playSe(ev.id);
        return;
      case 'place':
        this.falzPlace(ev.circle, ev.slots);
        return;
      case 'darvant':
        void this.spawnFalzProxy(e, ai, ev.entity);
        return;
      case 'hit': {
        if (ev.clientId !== this.game.selfId || this.damage.dead) return;
        if (ev.fixed) {
          const damage = Math.trunc(ev.power);
          const me = this.view?.playerPositions().get(this.game.selfId);
          this.damage.hit(damage, me ? Math.atan2(me.x - ev.x, me.z - ev.z) : 0, 0, 0x1000 | e.index);
          if (damage >= 1) this.gainPb(damage, true);
          this.opts.log(`${ev.what}: ${damage} damage`);
        } else this.enemyTechHitsPlayer(e, ev.power, ev.x, ev.z, ev.what);
        return;
      }
      case 'tech':
        if (ev.clientId === this.game.selfId && !this.damage.dead) this.enemyTechHitsPlayer(e, Math.max(0, techPower(TECH[ev.tech], ev.level)), ev.x, ev.z, ev.what, 0, techGroup(TECH[ev.tech]));
        this.overlay?.techEffect(ev.tech === 'rabarta' ? 'support' : 'light', ev.x, 0, ev.z, 20);
        return;
      case 'megid':
        if (ev.clientId === this.game.selfId && !this.damage.dead) this.enemyMegidHitsPlayer(Math.max(0, techPower(TECH.megid, ev.level)), ev.what);
        return;
      case 'resta':
        this.opts.log(`${what}: form 2 casts Resta (level ${ev.level})`);
        return;
      case 'died': {
        const rt = this.falzProxies.get(ev.entity);
        const part = ai.part(ev.entity);
        if (rt) rt.stats.hp = part?.hp ?? 0;
        // A Darvant killed by damage goes through the generic kill flow (EXP, 6x76);
        // one that the scene ended does not.
        if (rt && part && part.hp <= 0 && ev.entity >= DF_ID.darvant && ev.entity <= DF_ID.lastDarvant && this.falzLastHit.get(rt.index) === true) this.bossKilled(rt, part.x, part.z, this.falzLastHit, 'Darvant');
        return;
      }
      case 'killed':
        this.falzKilled(e, ev.x, ev.z);
        return;
      default:
        return;
    }
  }

  // DistributePlayersInCircle (0x0044BF88) / RepositionPlayersInCircle (0x0044C090):
  // the local player's slot is its rank among the party.
  private falzPlace(circle: 'inner' | 'outer', slots: number): void {
    const ids = [...this.game.players.keys()].sort((a, b) => a - b);
    const k = Math.max(0, ids.indexOf(this.game.selfId));
    const n = Math.max(1, slots);
    const step = Math.trunc(0x10000 / n);
    const c = circle === 'inner' ? { cx: 0, cz: 0, r: 12.5 } : { cx: 10000, cz: 0, r: 250 };
    const a = (circle === 'inner' ? Math.trunc(step / 2) : 0) + k * step;
    const heading = circle === 'inner' ? 0x8000 : (a + 0x8000) & 0xffff;
    this.opts.warpSelf?.({ x: Math.sin(a * BAMS_TO_RAD) * c.r + c.cx, y: 10, z: Math.cos(a * BAMS_TO_RAD) * c.r + c.cz }, heading * BAMS_TO_RAD);
    this.opts.log(`Dark Falz: you stand on the ${circle} circle (slot ${k} of ${n})`);
  }

  // mark_falz_as_dead_and_request_drop (0x0044C230): on_enemy_killed and
  // set_monster_spawn_initdata_as_dead on every client. The last hit of the last
  // form is the control's last attacker.
  private falzKilled(e: EnemyRuntime, x: number, z: number): void {
    e.stats.hp = 0;
    this.bossKilled(e, x, z, this.falzLastHit, 'Dark Falz');
  }

  // A part's enemy was struck (or a 6x0A copy of a strike).
  private falzPartHit(e: EnemyRuntime, ai: DarkFalzPartAi, damage: number, critical: boolean, flags: number, local: boolean, what: string): void {
    const part = ai.part;
    if (!part) return;
    const applied = ai.owner.damagePart(ai.entity, damage, local);
    if (applied >= 1) this.falzLastHit.set(this.falzHead?.index ?? e.index, local);
    if (applied >= 1 && ai.entity >= DF_ID.darvant && ai.entity <= DF_ID.lastDarvant) this.falzLastHit.set(e.index, local);
    e.stats.hp = part.hp;
    const dead = part.hp <= 0;
    this.sendEnemy(e, flags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED) | (dead ? FLAG_DEAD : 0), Math.max(0, part.maxHp - part.hp));
    const p = e.instance.root.position;
    this.num(applied, critical, p.x, p.y + 10, p.z);
    this.opts.log(`${what}hit Dark Falz ${this.falzName(ai.entity)} for ${Math.round(applied)}: ${part.hp}/${part.maxHp}`);
  }

  private falzName(entity: number): string {
    return entity === DF_ID.form1 ? 'form 1' : entity === DF_ID.form2 ? 'form 2' : entity === DF_ID.form3 ? 'form 3' : `Darvant ${entity}`;
  }

  // A 6x19 from the leader (HandleVoloptEntityStateTransition 0x0044CE6C).
  private onDarkFalzSub(body: Uint8Array): void {
    let head = this.falzHead;
    if (!head) for (const e of this.enemies.values()) if (e.ai instanceof DarkFalzAi) head = e;
    const ai = head?.ai;
    if (!head || !(ai instanceof DarkFalzAi) || body.length < 0x10) return;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (dv.getUint16(2, true) !== (0x1000 | head.index)) return;
    ai.receive(dv.getUint16(4, true), dv.getUint32(8, true));
  }

  // --- Caves / Mines FSM projectiles (combat/enemyshots.ts) -------------------

  private shots: Array<{ shot: EnemyShot; owner: EnemyRuntime; baseY: number; mesh: THREE.Mesh | null; model: THREE.Object3D | null }> = [];

  // ASSUMED look: a coloured ball per shot (the client's own effects and
  // models are not drawn).
  private launchShot(e: EnemyRuntime, original: EnemyShot): void {
    // A technique object of combat/techfire.ts: particles instead of a ball.
    if (original instanceof FireShot) {
      const baseY = original.absolute ? 0 : e.instance.root.position.y - e.lift;
      this.techFire.attach(original, baseY);
      this.shots.push({ shot: original, owner: e, baseY, mesh: null, model: null });
      return;
    }
    // An enemy's Gizonde, Grants or Megid is the player's technique object in
    // the exe (combat/techlightning.ts), not a ball.
    const shot = (original instanceof TechBolt ? this.techShotFor(e, original) : null) ?? original;
    let mesh: THREE.Mesh | null = null;
    // A shot that is one of the owner's hidden world parts (the Dark Belra's
    // arm): that model moves instead of a ball.
    const model = shot.look.model ? e.instance.world?.getObjectByName(shot.look.model) ?? null : null;
    try {
      if (!model && !shot.look.hidden) {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(shot.look.size, 8, 6), new THREE.MeshBasicMaterial({ color: shot.look.color }));
        this.viewer.scene.add(mesh);
      }
    } catch {
      mesh = null;
    }
    const baseY = shot.absolute ? 0 : e.instance.root.position.y - e.lift;
    mesh?.position.set(shot.x, baseY + shot.y, shot.z);
    if (model) this.poseShotModel(model, shot, baseY);
    this.shots.push({ shot, owner: e, baseY, mesh, model });
    if (shot instanceof TechShot) this.techfx?.drainShot(shot);
  }

  // The technique object an enemy's TechBolt stands for (null: keep the
  // flight). The player a Gizonde / Grants aims at is the one best in line
  // with the bolt's heading (ASSUMED: the enemy's own target is not passed on).
  private techShotFor(e: EnemyRuntime, b: TechBolt): TechShot | null {
    const t = b.tech;
    if (!t || !this.techfx) return null;
    const ground = e.instance.root.position.y - e.lift;
    const from = { x: b.x, y: ground + b.y, z: b.z };
    const power = b.effect.kind === 'tech' || b.effect.kind === 'megid' ? b.effect.power : 0;
    if (t.id !== TECH.megid && t.id !== TECH.gizonde && t.id !== TECH.grants) return null;
    let best: AiTarget | null = null;
    let bestCos = 0.95;
    for (const p of this.aiTargets()) {
      if (p.dead) continue;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d === 0 || d > b.range) continue;
      const c = (dx * Math.sin(b.angle) + dz * Math.cos(b.angle)) / d;
      if (c > bestCos) {
        best = p;
        bestCos = c;
      }
    }
    if (t.id === TECH.megid) {
      const aim = best ? { x: best.x, y: ground + 10, z: best.z } : undefined;
      return new MegidOrb(from, b.angle, t.level, techData(TECH.megid, t.level).rangeH, power, PLAYER_RADIUS, ground, aim, this.techWall());
    }
    // Gizonde with nobody in front is the Gibbon's plain bolt; Grants needs its target.
    if (!best) return t.id === TECH.gizonde ? new PlainBolt(from, b.angle, b.range, () => this.rng()) : null;
    return t.id === TECH.gizonde ? new GizondeStrike(from, best, t.level, power, () => this.rng(), ground) : new GrantsStrike(from, best, t.level, power, ground);
  }

  // The Dark Belra without the arm it threw: the exe hides the polygons of the
  // arm's nodes while the arm is out (BELRA.armRootNode). Scaling the root of
  // the arm's subtree down collapses every vertex weighted to it, which is all
  // of them; the body animator reapplies the bind scale on its next frame, so
  // the hook below keeps it down and a regrown arm comes back by itself.
  private belraHooked = new WeakSet<object>();

  private belraTick(e: EnemyRuntime, ai: BelraAi): void {
    const inst = e.instance;
    const bones = BELRA.armRootNode.map((i) => inst.nodes?.[0]?.[i]);
    const hide = () => {
      for (let i = 0; i < 2; i++) if (ai.armGone[i]) bones[i]?.scale.setScalar(1e-4);
    };
    if (!this.belraHooked.has(inst)) {
      const body = inst.animators.find((_, k) => !inst.parts[k]?.name);
      if (!body) return;
      this.belraHooked.add(inst);
      body.onFrame = hide;
    }
    hide();
  }

  private poseShotModel(model: THREE.Object3D, shot: EnemyShot, baseY: number): void {
    const p = shot.pose?.();
    model.position.set(shot.x, baseY + (p?.y ?? shot.y), shot.z);
    if (p) {
      model.rotation.y = p.yaw;
      model.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    }
    model.visible = true;
  }

  private tickShots(targets: AiTarget[]): void {
    for (const s of this.shots) {
      // The Pofuilly Slime's arm also hits the other enemies (its branch B): they come in as 0x1000 | index.
      const hits = s.shot.tick(targets, s.shot instanceof SlimeArm ? this.enemyTargets(s.owner) : undefined);
      // The Dragon's fireball particles (its table, the fireball update 0x00426790): the flight, the impact.
      if (s.shot instanceof DragonFireball) {
        for (const id of s.shot.drainParticles()) void this.fx?.spawn({ id }, new THREE.Vector3(s.shot.x, s.baseY + s.shot.y, s.shot.z));
        // The impact's SE 0x320 (0x004268db), at the fireball.
        for (const id of s.shot.drainSounds()) {
          this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
          this.sePlayer?.play(id);
        }
      }
      if (s.shot.spawned?.length) for (const n of s.shot.spawned.splice(0)) this.launchShot(s.owner, n);
      if (s.shot instanceof TechShot) this.techfx?.drainShot(s.shot);
      s.mesh?.position.set(s.shot.x, s.baseY + s.shot.y, s.shot.z);
      if (s.model && !s.shot.done) this.poseShotModel(s.model, s.shot, s.baseY);
      for (const hit of hits) {
        if (hit.clientId >= 0x1000) {
          // The arm's hit on an enemy: the confused-enemy path (ASSUMED: every client resolves it).
          this.enemyHitsEnemy(s.owner, hit.clientId & 0xfff, 0, s.shot.effect.kind === 'melee' ? s.shot.effect.mult : 1);
          continue;
        }
        if (hit.clientId !== this.game.selfId) continue; // each client resolves its own player
        const fx = s.shot.effect;
        const what = `E-${s.owner.index.toString(16)} (${s.owner.slot.type})`;
        if (fx.kind === 'tech') {
          const wasDying = this.damage.dying;
          this.enemyTechHitsPlayer(s.owner, fx.power, s.shot.x, s.shot.z, what, fx.knockback ?? 0, fx.group ?? 0);
          // A Nano Dragon hit that kills its target starts the power-up
          // (EnemyAI_Projectile hit 0x00580380 / breath 0x0057fed6: the victim's
          // flag 0x800 is set by the hit). ASSUMED: only the local player's
          // death is seen here.
          if (!wasDying && this.damage.dying && s.owner.ai instanceof NanoDragonAi) s.owner.ai.powerUp();
          if (fx.status && this.rng() < fx.status.chance) this.inflictStatus(fx.status.type as StatusType, what);
        } else if (fx.kind === 'melee') {
          this.enemyHitsPlayer(s.owner, hit.clientId, fx.knockback, fx.mult, undefined, fx.attack);
          if (fx.status && this.rng() < fx.status.chance) this.inflictStatus(fx.status.type as StatusType, what);
        } else if (fx.kind === 'blast') this.enemyBlastHitsPlayer(s.owner, fx.damage, s.shot.x, s.shot.z, what, fx.knockback);
        else if (fx.kind === 'megid') this.enemyMegidHitsPlayer(fx.power, what);
        else this.inflictStatus(fx.status as StatusType, what);
      }
    }
    for (const s of this.shots.filter((x) => x.shot.done)) {
      if (s.model) s.model.visible = false;
      s.mesh?.removeFromParent();
      s.mesh?.geometry.dispose();
      (s.mesh?.material as THREE.Material | undefined)?.dispose();
    }
    this.shots = this.shots.filter((x) => !x.shot.done);
  }

  // entity_hit_by_tech (0x00773afc) with the local player as the defender and this enemy as the attacker
  // (combat/enemytechplayer.ts has the groups, the resists they read and the status rolls). `group` is the
  // technique_group of the cast (0 = the fixed damage, the default). The enemy's MST is its battleparams
  // MST; the player's resists are selfElements() (EFR / EIC / ETH / ELT / EDK, playerresist.ts).
  // ASSUMED: the defender state is 0 (a normal player; the freeze / shock need 1) and the last-killer id
  // (player +0x2d8) is 0; knockback 0 (try_knockdown_player's threshold, 0x25% of max HP, sets a flag only).
  private enemyTechHitsPlayer(e: EnemyRuntime, power: number, fromX: number, fromZ: number, what: string, knockback = 0, group = 0): void {
    const view = this.view;
    if (!view || this.damage.dead) return;
    if (group === ENEMY_HIT_GROUP.megid) {
      this.enemyMegidHitsPlayer(power, what);
      return;
    }
    const me = view.playerPositions().get(this.game.selfId);
    const ctx = this.difficultyParams;
    const def = ENEMY_TYPE_PARAMS[e.slot.type];
    const mst = ctx?.params && def?.stats.length ? Math.max(0, ctx.params.stats(ctx.difficulty, def.stats[0]).mst) : 0;
    const out = enemyTechOnPlayer({ group, power, mst, ultimate: ctx?.difficulty === 3, bossMap: this.inBossArea(), elements: this.selfElements(), rng: () => this.rng() });
    if (!out.handled) {
      this.opts.log(`${what}: technique group ${group} not a damage group here`);
      return;
    }
    const damage = out.damage;
    const angle = me ? Math.atan2(me.x - fromX, me.z - fromZ) : 0;
    this.damage.hit(damage, angle, knockback, 0x1000 | e.index);
    if (damage >= 1) this.gainPb(damage, true);
    if (!this.damage.dead && out.freeze) this.inflictStatus(STATUS.freeze, what);
    if (!this.damage.dead && out.shock) this.inflictStatus(STATUS.shock, what);
    this.opts.log(`${what}: technique hit for ${damage}${out.freeze ? ' (freeze)' : ''}${out.shock ? ' (shock)' : ''}`);
  }

  // A Saint-Milion missile's blast on the local player (the defender's vtable +0x60 with the boss as
  // attacker, 0x00521cf8): the damage is the MovementData iparam3 itself, not the group-0 formula.
  // ASSUMED: no defence is taken off it, and cause_knockback(3.0) is the knockback (its meaning is unclear).
  private enemyBlastHitsPlayer(e: EnemyRuntime, damage: number, fromX: number, fromZ: number, what: string, knockback: number): void {
    const view = this.view;
    if (!view || this.damage.dead) return;
    const me = view.playerPositions().get(this.game.selfId);
    const total = Math.max(0, Math.trunc(damage));
    const angle = me ? Math.atan2(me.x - fromX, me.z - fromZ) : 0;
    this.damage.hit(total, angle, knockback, 0x1000 | e.index);
    if (total >= 1) this.gainPb(total, true);
    this.opts.log(`${what}: blast hit for ${total}`);
  }

  // A Battle Mode trap's blast on the local player (quest/battletraps.ts TrapEffect; the
  // caller passes the trap's damage). The status goes through inflictStatus, the damage
  // through damage.hit with the blast's direction. ASSUMED: no kill credit, no PB gain.
  // The trap models in the field: shows the traps in their draw state (see render/battletrapview.ts).
  syncBattleTraps(traps: readonly BattleTrap[]): void {
    if (!this.battleTraps) {
      if (traps.length === 0) return;
      this.battleTraps = new BattleTrapView(this.viewer, this.files);
    }
    this.battleTraps.sync(traps);
  }

  // A trap's blast ends: the death particle 0x47 at the trap (EnemyDraw's death effect; the
  // position is ASSUMED to be the trap's).
  // The sonar manager's ping (quest/battle.ts SonarManager, dump 006b0744): the sound 183 with
  // the pitch the distance gives (0 = no pitch). ASSUMED: it plays where the listener is (the
  // exe passes (0, 0, 0) to play_directional_sound_effect).
  playSonarPing(pitch: number): void {
    this.playSe(SONAR_PING_SOUND, pitch);
  }

  battleTrapBurst(x: number, y: number, z: number): void {
    this.particle({ id: TRAP_DEATH_PARTICLE, delay: 0 }, new THREE.Vector3(x, y, z));
  }

  battleTrapHit(effect: TrapEffect, damage: number, fromX: number, fromZ: number, what: string): void {
    if (this.damage.dead) return;
    if (effect.kind === 'status') {
      this.inflictStatus(effect.status, what);
      return;
    }
    const total = Math.max(0, Math.trunc(damage));
    const me = this.view?.playerPositions().get(this.game.selfId);
    const angle = me ? Math.atan2(me.x - fromX, me.z - fromZ) : 0;
    this.damage.hit(total, angle, 0, 0);
    this.opts.log(`${what}: blast hit for ${total}`);
  }

  // Whether the current area is a boss area (safe_create refuses a trap there, the Megid kill is off).
  // BOSS_AREAS is the exe's current_map_is_boss_map: the map class 0xb rows of unknown_map_data
  // (tests/enemytechplayer.test.ts checks the list against playerroom.ts MAP_CLASS).
  inBossArea(): boolean {
    return BOSS_AREAS.includes(this.area);
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

  // The Seabed capture trap (TOTrapSeabed01; render/traps.ts CaptureTrap): its hold is the 6x2C on
  // the local player with frames 0xffff (no timer, EnemyAcquireTargetAndAttack_0063e444), and the
  // release is the 6x2D (SawMapObjectDisablePlayerMovementOnVisibility_0063e3b0), sent when another
  // entity touches the trap (CaptureTrap.touch). The state-3 hit path is not ported (traps.ts).
  // The Seabed capture trap's state-1 reticle (DerollePartObjectEnableReticle_0063a3bc, dump 575550
  // enable_reticle; drawn with the lock-on cursor, combat/reticle.ts). `pos` is the trap's point or null to
  // hide it. ASSUMED: the cursor sits on the trap origin (no height offset).
  setCaptureReticle(pos: { x: number; y: number; z: number } | null): void {
    this.overlay?.setTarget(pos, { row: reticleRow('enemy'), camera: this.viewer.camera, trap: true });
  }

  // A falling stalactite's hit on the local player (render/fieldobjects.ts FallingStalactite): the exe's
  // DerolleEnemyHead_UpdatePlayerDamage (0x006799c8) calls entity_hit_by_tech with the fixed amount, so it
  // is the same path as a fixed hit (the damage, the PB gain). ASSUMED: a player that is not alive takes
  // none, and the killer is 0 (the pillar traps' convention) with no knockback.
  fieldObjectHit(damage: number, at: { x: number; z: number }): void {
    if (this.damage.busy || damage < 1) return;
    const me = this.view?.playerPositions().get(this.game.selfId);
    this.damage.hit(damage, me ? Math.atan2(me.x - at.x, me.z - at.z) : 0, 0, 0);
    this.gainPb(damage, true);
    this.opts.log(`stalactite: ${damage} damage`);
  }

  captureTrapEvent(ev: TrapEvent): void {
    if (ev.kind === 'hold') this.imposeHold({ frames: ev.frames, particle: 0, x: ev.x, z: ev.z, radius2: ev.radius2 }, 'capture trap');
    else if (ev.kind === 'release') {
      // The held player's own client sends the 6x2D (DisablePlayerMovement on its own player); the other
      // clients run the same trap and only drop their record of it.
      if (ev.clientId !== this.game.selfId) return;
      if (this.holdTicks > 0) this.game.sendReleaseHold();
      this.holdTicks = 0;
      this.opts.log('capture trap: hold released');
    }
  }

  // Incoming 6x2C / 6x2D (render/traps.ts parseHoldPacket). A 6x2D for the local player releases its
  // hold (a teammate's touch of a capture trap, or another trap's release); a 6x2C for it imposes one.
  // Other players' holds are kept in remoteHolds (their movement comes from their own packets).
  private remoteHolds = new Set<number>();
  private onHoldPacket(sub: number, body: Uint8Array): void {
    const h = parseHoldPacket(sub, body);
    if (!h) return;
    if (h.clientId === this.game.selfId) {
      if (h.sub === 0x2d) {
        if (this.holdTicks > 0) this.opts.log('hold released by another client');
        this.holdTicks = 0;
      } else if (!this.damage.dead) {
        this.holdTicks = holdCountdown(h.frames);
        this.view?.resetGait(this.game.selfId);
      }
      return;
    }
    if (h.sub === 0x2c) this.remoteHolds.add(h.clientId);
    else this.remoteHolds.delete(h.clientId);
  }

  // The local hold of an item drop (0x0068d878's 6x2C; the packet is sent by
  // GameItems, net/items.ts). 6x2D releases it (releaseLocalHold).
  holdLocal(frames: number): void {
    if (this.damage.dead) return;
    this.holdTicks = frames;
    this.view?.resetGait(this.game.selfId);
  }

  releaseLocalHold(): void {
    this.holdTicks = 0;
  }

  // 6x2C on the local player (a Grass Assassin's web).
  private holdTicks = 0;
  private imposeHold(h: { frames: number; particle: number; x: number; z: number; radius2: number }, what: string): void {
    if (this.damage.dead) return;
    this.holdTicks = holdCountdown(h.frames);
    this.game.sendImposeHold(h.frames, h.particle, h.x, h.z, h.radius2);
    this.view?.resetGait(this.game.selfId);
    this.opts.log(`${what}: web hold for ${h.frames} frames`);
  }

  // entity_hit_by_tech's Megid case on the local player (an enemy Megid: the Chaos Sorcerer's in
  // Ultimate, the Del Lily's): death when the roll < (power - EDK) * 0.01 (0x0097826c), EDK = the
  // player's +0x2fc (playerresist.ts). No tech-resist roll: an enemy cast passes tech_id -1 (the early
  // miss test is skipped). Off a boss map (inBossArea) there is no kill unless Ultimate and the last killer
  // id (+0x2d8) is 0x1000 or more (enemytechplayer.ts, objdump 0x007744e2..0x00774f8a).
  private enemyMegidHitsPlayer(power: number, what: string): void {
    if (this.damage.dead) return;
    const ctx = this.difficultyParams;
    const out = enemyTechOnPlayer({ group: ENEMY_HIT_GROUP.megid, power, mst: 0, ultimate: ctx?.difficulty === 3, bossMap: this.inBossArea(), elements: this.selfElements(), rng: () => this.rng() });
    const chance = out.megidChance;
    if (out.megidKill) {
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
      if (o === self || o.dead || o.state === 'death' || !o.instance.root.visible || o.ai?.invulnerable || concealed(o) || !splitLockBase(o)) continue;
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
    const hit = chance > 0 && this.rng() <= chance;
    const damage = hit ? rollDamage(attacker, defender, 0, this.rng, mult).damage : 0;
    this.opts.log(`confused E-${e.index.toString(16)} (${e.slot.type}) hits E-${index.toString(16)} (${d.slot.type})`);
    this.applyEnemyHit(d, ENEMY_BASE_FLAGS, damage, false, `E-${e.index.toString(16)}: `, false, { landed: hit });
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

  // The Chaos Sorcerer's bits: BEE_R (entity index + 1, the attack bit) and
  // BEE_L (+ 2, the heal bit), created by sorcerer_constructor_ 0x0059d8b8. They
  // are entities of their own with the BEE slot's stats row, the body's
  // model 0 texture list and the bit model (entry 1); the AI places them on
  // their anchors (SorcererAi.bit). ASSUMED: the bits are not sent to the
  // other clients on their own, the body's enemy packets cover them.
  private async spawnSorcererBits(body: EnemyRuntime, bodyAi: SorcererAi): Promise<void> {
    const ctx = this.difficultyParams;
    if (!ctx) return;
    for (const side of [1, 2] as const) {
      const index = body.index + side;
      const type = side === 1 ? 'BEE_R' : 'BEE_L';
      const slot = ctx.slots[index - ctx.base];
      if (!slot || slot.type !== type || this.enemies.has(index)) {
        this.opts.log(`Chaos Sorcerer E-${body.index.toString(16)}: no ${type} slot`);
        continue;
      }
      const at = bodyAi.bit(side);
      const bp = body.instance.root.position;
      const placed = {
        ...body.instance.placed,
        entity: { ...(body.instance.placed.entity as EnemySet), index: -1 - index },
        world: [at.x, bp.y, at.z] as [number, number, number],
        yaw: bodyAi.angle,
        name: side === 1 ? 'Bee R' : 'Bee L',
      };
      const spec = { ...body.instance.spec, name: 'TObjEneRe4SorcererBee', parts: [{ model: 1, texlistOf: 0 }] };
      const instance = await this.layer.spawn(placed as typeof body.instance.placed, spec as typeof body.instance.spec);
      if (!instance || this.disposed) return;
      const fight = this.childFightStats(type);
      const ai = new SorcererBitAi(bodyAi, side, () => this.rng());
      this.enemies.set(index, {
        instance,
        index,
        slot,
        ...fight,
        motions: enemyCombatMotions('TObjEneRe4SorcererBee', instance.archive),
        rtIndex: ENEMY_TYPE_PARAMS[type]?.rt ?? 0xff,
        dead: false,
        state: 'idle',
        removeIn: 0,
        ai,
        lift: SORCERER.bitHeight,
        monest: null,
        parent: body,
        fake: null,
        buffs: new EntityBuffs(),
        status: new EnemyStatus(enemyAttribute(type)),
      });
    }
  }

  // The Chaos Sorcerer's inputs for this tick: its HP (the exact heal test),
  // the enemies its heal can reach and whether each bit is down.
  private sorcererFeed(e: EnemyRuntime, ai: SorcererAi): void {
    ai.hp = e.stats.hp;
    ai.maxHp = e.stats.maxHp;
    const allies: HealAlly[] = [];
    for (const o of this.enemies.values()) {
      if (o === e || o.dead || o.ai instanceof SorcererBitAi) continue;
      const p = o.instance.root.position;
      allies.push({ id: 0x1000 | o.index, x: p.x, z: p.z, hp: o.stats.hp, maxHp: o.stats.maxHp });
    }
    ai.allies = allies;
    ai.bitDown = [this.beeDown(e.index + 1), this.beeDown(e.index + 2)];
  }

  private beeDown(index: number): boolean {
    const bit = this.enemies.get(index);
    return !!bit && bit.ai instanceof SorcererBitAi && bit.ai.state === 'down';
  }

  // The Chaos Sorcerer's Resta on the enemy the heal picked (entity id in
  // `target`, null = the caster itself).
  private sorcererHeal(caster: EnemyRuntime, h: { level: number; target?: number | null }): void {
    const target = h.target == null ? caster : this.enemies.get(h.target & 0xfff);
    if (!target || target.dead) return;
    this.enemyResta(caster, target, h.level);
  }

  // CreateSpecialAttackEntity_006eeeb4 with the caster's MST: the heal lands
  // on `target` (the caster itself or an ally). ASSUMED: the player Resta's
  // heal, MST * 0.5 + power, MST of the caster's row.
  private enemyResta(caster: EnemyRuntime, target: EnemyRuntime, level: number): void {
    const ctx = this.difficultyParams;
    const def = ENEMY_TYPE_PARAMS[caster.slot.type];
    const mst = ctx?.params && def?.stats.length ? Math.max(0, ctx.params.stats(ctx.difficulty, def.stats[0]).mst) : 0;
    const heal = Math.round(mst * 0.5 + techPower(TECH.resta, level));
    target.stats.hp = Math.min(target.stats.maxHp, target.stats.hp + heal);
    this.sendEnemy(target, ENEMY_BASE_FLAGS);
    const what = target === caster ? 'itself' : `E-${target.index.toString(16)} (${target.slot.type})`;
    this.opts.log(`E-${caster.index.toString(16)} (${caster.slot.type}) casts Resta on ${what}: +${heal} HP (${target.stats.hp}/${target.stats.maxHp})`);
  }

  // A hit on a Chaos Sorcerer's bit: its own HP row; at 0 it goes down
  // (combat/enemyfsmruins.ts SorcererBitAi) with the SE 0x1e0 at the bit.
  // ASSUMED: no death plan, no drop, no EXP.
  private sorcererBitHit(e: EnemyRuntime, ai: SorcererBitAi, damage: number, critical: boolean, baseFlags: number, what: string): void {
    const flags = baseFlags | applyDamage(e.stats, damage, this.hitLanded);
    const down = (flags & FLAG_DEAD) !== 0;
    this.sendEnemy(e, flags & ~FLAG_DEAD);
    const p = e.instance.root.position;
    this.num(damage, critical, p.x, p.y + 26, p.z);
    if (down) {
      ai.down();
      this.playSeAt(0x1e0, p);
    }
    this.opts.log(`${what}hit ${e.slot.type} for ${Math.round(damage)}: ${e.stats.hp}/${e.stats.maxHp}${down ? ' (down)' : ''}`);
  }

  // --- Epsilon (combat/enemyfsmep2d.ts) ---------------------------------------

  // Its two looks are two parts of one model: the closed body (part 0, motion
  // 0) and the open one (part 1, motion 1). The exe's helper 0x005592a0 shows
  // one, hides the other and sets the motion slot on the frame the closed flag
  // changes; this does the same each frame from the brain's `open`.
  // Morfos (combat/enemyfsmep2d.ts MorfosAi, formats/enemymodels.ts): the body's
  // child mesh is shifted by the bulge (its u), the wall by trunc(bulge / 2) (its
  // v): ProcessCommandStream_0081a2b0 adds the stream value to the strips' u / v
  // of the texture group (texture 2 of the body's child, texture 0 of the wall),
  // in the UVN units (/255) of those strips. The arm (the punch's sub-entity) is
  // drawn while the swing runs, from its own attack_kabe_arm motion, once.
  private morfosArmStarted = new Set<EnemyRuntime>();
  // The exe's render_morfos draws nothing while the hidden flag (+0x3c8 & 1) is
  // set, the wall included: the body and the wall follow `hidden`. The arm is a
  // sub-entity of its own (0x0057cd9c): it is drawn while ai.armOut, which ends
  // when its motion reaches the last frame (ai.armSpent, 0x0057cd3c).
  private morfosView(e: EnemyRuntime, ai: MorfosAi, hidden: boolean): void {
    for (const child of e.instance.root.children) {
      if (child.name === 'Morfos body') {
        child.visible = !hidden;
        child.userData.uvOffsets?.get(2)?.set(ai.wallBulge / 255, 0);
      } else if (child.name === 'Morfos wall') {
        child.visible = !hidden;
        child.userData.uvOffsets?.get(0)?.set(0, ai.armBulge / 255);
      } else if (child.name === 'Morfos arm') {
        const i = e.instance.parts.findIndex((p) => p.name === 'Morfos arm');
        const a = e.instance.animators[i];
        let armOut = ai.armOut && !hidden;
        if (armOut && !this.morfosArmStarted.has(e)) {
          this.morfosArmStarted.add(e);
          if (a) {
            try {
              a.play(e.instance.archive.motion(0, a.nodeCount), 0.7, false);
            } catch (err) {
              this.opts.log(`morfos arm motion: ${(err as Error).message}`);
            }
          }
        }
        // No animator (ASSUMED: nothing to time the arm by): it is not shown.
        if (armOut && (!a || a.ended)) {
          ai.armSpent();
          armOut = false;
        }
        if (!armOut) this.morfosArmStarted.delete(e);
        child.visible = armOut;
        if (armOut) this.morfosArmPlace(e, child);
      }
    }
  }

  // The laser's origin (0x0057d0f4 gets enemy+0x4a0, body node 6 captured by the
  // draw): the bolt starts at that node's world point, given above the launch
  // ground like every shot (the base y is the root's y less the lift).
  private morfosMuzzle(e: EnemyRuntime, bolt: MorfosBolt): void {
    const node = e.instance.nodes?.[0]?.[MORFOS.muzzleNode];
    if (!node) return;
    // The draw's point (morfosnodes.ts): read before anything refreshes the matrices.
    const v = drawnWorldOrigin(node, this.morfosVec);
    bolt.placeAt(v.x, v.y - (e.instance.root.position.y - e.lift), v.z);
  }

  private readonly morfosVec = new THREE.Vector3();
  private readonly morfosCaptured = new THREE.Vector3();

  // The arm's place (0x0057cd3c: its +0x38 is the parent's +0x4ac, which the
  // body's draw writes: 0x00579f3c stores the world origin of body node 10
  // (MORFOS.armNode, counted depth first over the body's objects, the body
  // being the enemy's first part) into the parent's +0x4ac while it draws).
  // The capture happens in the draw, so the arm takes the pose of the last draw
  // (morfosnodes.ts: the node's matrixWorld as the last render left it), not this
  // tick's: the tick runs before the draw, and the body's motion and root are
  // stepped before the tick. The point goes to the root's local space with the
  // root's current transform; the arm's yaw is the root's (0x0057cc3c /
  // 0x0057cd9c). ASSUMED: the arm's first update sees the capture of the last draw
  // (the sub-entity is created and updated in the same tick as the body).
  private morfosArmPlace(e: EnemyRuntime, arm: THREE.Object3D): void {
    const node = e.instance.nodes?.[0]?.[MORFOS.armNode];
    if (!node) return;
    const captured = drawnWorldOrigin(node, this.morfosCaptured);
    arm.position.copy(armLocalFromCapture(e.instance.root, captured, this.morfosVec));
  }

  private epsilonLook = new Map<EnemyRuntime, number>();
  private epsilonBodies = new Map<EnemyRuntime, EpsilonBody>();
  private epsilonOrbs = new Map<EnemyRuntime, THREE.Mesh>();

  // Deldepth (combat/enemyfsmep2c.ts DeldepthAi): the body and the disc are both
  // placed with the disc transform (height +0x3a4, scale +0x3a8..0x3b0; the
  // yaw is the root's) and drawn only in the sub-object's form (bodyShown /
  // discShown, 0x0054a38c). Alpha (+0x3a0) is the material opacity; nothing is
  // drawn at 0 (0x0054781c).
  private deldepthView(e: EnemyRuntime, ai: DeldepthAi): void {
    const xf = ai.transform;
    for (const child of e.instance.root.children) {
      const body = child.name === 'Deldepth body';
      if (!body && child.name !== 'Deldepth disc') continue;
      child.position.set(0, xf.y, 0);
      child.scale.set(xf.sx, xf.sy, xf.sz);
      child.visible = xf.alpha > 0 && (body ? ai.bodyShown : ai.discShown);
      if (child.visible) setModelOpacity(child, xf.alpha);
    }
  }

  // Pofuilly Slime (combat/enemysplits.ts SlimeAi.view): the body is placed at
  // its height and scale and drawn only at alpha > 0 (0x00596264); the tail
  // part is drawn in the forms 9..11 (0x00599ef0, two parts), with the same
  // transform. The yaw is the root's.
  private slimeView(e: EnemyRuntime, ai: SlimeAi): void {
    const v = ai.view;
    for (const child of e.instance.root.children) {
      const body = child.name === 'Slime body';
      if (!body && child.name !== 'Slime tail') continue;
      child.position.set(0, v.height, 0);
      child.scale.set(v.sx, v.sy, v.sz);
      child.visible = v.alpha > 0 && (body || v.tail);
      if (child.visible) setModelOpacity(child, v.alpha);
    }
  }

  private epsilonView(e: EnemyRuntime, ai: EpsilonAi, r: { hidden?: boolean; motion?: EnemyAiMotion | null }): void {
    const parts = e.instance.root.children;
    if (parts.length < 2) return;
    const look = ai.open ? 1 : 0;
    parts[0].visible = !r.hidden && look === 0;
    parts[1].visible = !r.hidden && look === 1;
    if (this.epsilonLook.get(e) !== look) {
      // A new look starts its own motion (the slot goes with the look).
      this.epsilonLook.set(e, look);
      this.playEpsilonPart(e, look, look ? EPSILON_ANIM.open : EPSILON_ANIM.closed);
    } else if (r.motion) this.playEpsilonPart(e, look, r.motion);
    this.epsilonTintBody(e, ai);
    this.epsilonOrbView(e, ai, !!r.hidden || ai.isDying);
    this.epsilonFxView(e, ai, !!r.hidden || ai.isDying);
  }

  // The animators are the parts' in order (both parts have a motion).
  private playEpsilonPart(e: EnemyRuntime, part: number, m: EnemyAiMotion): void {
    const a = e.instance.animators[part];
    if (!a) return;
    try {
      a.play(e.instance.archive.motion(m.index, a.nodeCount), m.speed, m.loop);
    } catch (err) {
      this.opts.log(`enemy motion ${m.index}: ${(err as Error).message}`);
    }
  }

  // The tint: the body's materials are clones of the cache's (the other enemies
  // keep the shared ones); colour = base colour * epsilonTint, redone only when
  // one of its inputs changes (the recolour's 90 frames).
  private epsilonTintBody(e: EnemyRuntime, ai: EpsilonAi): void {
    let body = this.epsilonBodies.get(e);
    if (!body) {
      const made: EpsilonBody = { mats: [], base: [], from: NaN, to: NaN, mix: NaN, t: NaN };
      e.instance.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        const own = list.map((m) => {
          const c = m.clone();
          if (c instanceof THREE.MeshBasicMaterial) {
            made.mats.push(c);
            made.base.push(c.color.clone());
          }
          return c;
        });
        o.material = Array.isArray(o.material) ? own : own[0];
      });
      body = made;
      this.epsilonBodies.set(e, body);
    }
    if (body.from === ai.colourFrom && body.to === ai.element && body.mix === ai.colourMix && body.t === ai.colourT) return;
    body.from = ai.colourFrom;
    body.to = ai.element;
    body.mix = ai.colourMix;
    body.t = ai.colourT;
    const [r, g, b] = epsilonTint(ai.colourFrom, ai.element, ai.colourMix, ai.colourT);
    const tint = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    body.mats.forEach((m, i) => m.color.copy(body.base[i]).multiply(tint));
  }

  // The laser orb (EpsilonAi.orb while the laser is shown): a fire-coloured ball
  // at its position, the look of the Rafoie blast (ASSUMED: the exe draws a
  // Rafoie-family model entity here).
  private epsilonOrbView(e: EnemyRuntime, ai: EpsilonAi, hide: boolean): void {
    const orb = hide ? null : ai.orb;
    let mesh = this.epsilonOrbs.get(e) ?? null;
    if (!orb) {
      if (mesh) mesh.visible = false;
      return;
    }
    if (!mesh) {
      try {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff6030 }));
        this.viewer.scene.add(mesh);
      } catch {
        return;
      }
      this.epsilonOrbs.set(e, mesh);
    }
    mesh.visible = true;
    mesh.position.set(orb.x, e.instance.root.position.y - e.lift + PLAYER_AIM_HEIGHT, orb.z);
  }

  // The recolour ring and the laser line (render/epsilonfx.ts), from the
  // Epsilon's own position; the line ends at the orb sphere above.
  private epsilonFx = new Map<EnemyRuntime, EpsilonFx>();
  private epsilonFxView(e: EnemyRuntime, ai: EpsilonAi, hide: boolean): void {
    let fx = this.epsilonFx.get(e) ?? null;
    if (!fx) {
      if (hide) return;
      fx = new EpsilonFx(this.viewer.scene, e.instance.archive);
      this.epsilonFx.set(e, fx);
    }
    const p = e.instance.root.position;
    const feet = p.y - e.lift;
    const orb = hide ? null : ai.orb;
    fx.update({
      x: p.x,
      feet,
      z: p.z,
      yaw: e.instance.root.rotation.y,
      ring: hide ? null : ai.recolourRing,
      orb: orb ? { x: orb.x, y: feet + PLAYER_AIM_HEIGHT, z: orb.z } : null,
    });
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

  // --- Pig Ray (combat/barbaminion.ts) ----------------------------------------

  // SpawnPigRay (0x004b4e6c): the Pig Ray takes the highest free child slot of
  // the body (index + 11 + k, k 1..35; slots 1..10 are the joints, 11..46 the
  // PIG_RAY slots of the 0xcb row) at the spawner's destination. ASSUMED: the
  // frame count (30) and the speed term (0) are not decoded yet.
  private async spawnPigRay(body: EnemyRuntime, ev: { group: number; index: number; count: number }): Promise<void> {
    const ctx = this.difficultyParams;
    if (!ctx) return;
    let k = 35;
    while (k > 0 && this.enemies.has(body.index + 11 + k)) k--;
    const index = body.index + 11 + k;
    const slot = k > 0 ? ctx.slots[index - ctx.base] : undefined;
    const dest = BARBA_PIG_DEST[ev.group]?.[ev.index];
    if (!slot || slot.type !== 'PIG_RAY' || !dest) {
      this.opts.log(`Barba Ray E-${body.index.toString(16)}: no free PIG_RAY slot for Pig Ray ${ev.index}`);
      return;
    }
    const mode = barbaPigMode(ev.count);
    const angle = ((BARBA_PIG_HEADING[ev.group] ?? 0) / 65536) * Math.PI * 2; // ASSUMED BAMS
    const placed = {
      ...body.instance.placed,
      entity: { ...(body.instance.placed.entity as EnemySet), index: -1 - index },
      world: [dest[0], dest[1], dest[2]] as [number, number, number],
      yaw: angle,
      name: 'Pig Ray',
    };
    const spec = { ...body.instance.spec, parts: [{ model: mode, motion: { index: 0, speed: 1, loop: true } }] };
    const instance = await this.layer.spawn(placed as typeof body.instance.placed, spec as typeof body.instance.spec);
    if (!instance || this.disposed) return;
    const fight = this.childFightStats('PIG_RAY');
    const ai = new PigRayAi({ x: dest[0], z: dest[2], angle, mode, frames: 30, speed: 0, rng: () => this.rng() });
    this.enemies.set(index, {
      instance,
      index,
      slot,
      ...fight,
      motions: enemyCombatMotions(body.instance.spec.name, instance.archive),
      rtIndex: ENEMY_TYPE_PARAMS.PIG_RAY?.rt ?? 0xff,
      dead: false,
      state: 'idle',
      removeIn: 0,
      ai,
      lift: 0,
      monest: null,
      parent: body,
      fake: null,
      buffs: new EntityBuffs(),
      status: new EnemyStatus(enemyAttribute('PIG_RAY')),
    });
  }

  // The Pig Ray's events: the SE, the effects at its place, and the end of its
  // death (the model is hidden).
  private pigDrain(e: EnemyRuntime, ai: PigRayAi): void {
    for (const ev of ai.drain() as PigEvent[]) {
      if (ev.kind === 'se') {
        this.sePlayer ??= this.opts.source ? new SePlayer(this.opts.source) : null;
        this.sePlayer?.play(ev.id);
      } else if (ev.kind === 'effect') {
        if (ev.remove) continue;
        const p = e.instance.root.position;
        this.particle({ id: ev.id }, new THREE.Vector3(p.x, p.y, p.z));
      } else {
        e.instance.root.visible = false;
      }
    }
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
    const baseY = e.instance.root.position.y;
    const spit = new LilySpit(x, z, angle, baseY);
    let mesh: THREE.Mesh | null = null;
    try {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9be04a }));
      this.viewer.scene.add(mesh);
    } catch {
      mesh = null;
    }
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

  // HildebearCheckEntityCount_0051a924: the live Mothmants of the same group
  // (the same Monest, or none) that already target the player `clientId`.
  private countMothmantTargets(parent: EnemyRuntime | null, clientId: number, self: MothmantAi): number {
    let n = 0;
    for (const c of this.enemies.values()) {
      if (c.dead || c.parent !== parent || !(c.ai instanceof MothmantAi) || c.ai === self) continue;
      if (c.ai.targetId === clientId && c.ai.state !== 'dead') n++;
    }
    return n;
  }

  // spawn_mothmant_from_monest: the Monest's next MOTHMANT slot.
  // The Monest's states decide its own death: a killing hit sends it to the
  // flinch (not yet active) or the kill (active). The kill plays its animation,
  // the body sinks, and the dead state (9) removes it once no child is alive.
  // The wire's kill (6x0A, 6x76, drop, EXP) went out at the killing hit (killEnemy).
  private tickMonest(e: EnemyRuntime, ended: boolean): void {
    const m = e.monest!;
    const alive = [...this.enemies.values()].filter((c) => c.parent === e && !c.dead).length;
    const r = m.tick(alive, ended, e.stats.hp <= Math.trunc(e.stats.maxHp / 2));
    if (r.motion) this.playEnemyMotion(e, r.motion);
    if (r.spawn) void this.spawnMothmant(e, m.spawned - 1);
    if (r.sink) e.instance.root.position.y -= r.sink;
    if (r.removed && e.state !== 'death') this.monestRemove(e);
  }

  // The Monest's body leaves at its dead state (9): the death plan of its kind
  // runs (deathPlanFor), with no death motion of its own (the kill's animation
  // is the last one shown).
  private monestRemove(e: EnemyRuntime): void {
    e.state = 'death';
    e.removeIn = 0;
    const plan = deathPlanFor(e.instance.spec.name, e.slot.type, { area: this.area, episode: this.game.info?.episode ?? 1 });
    if (plan) {
      e.death = { run: new DeathRun(plan), acc: 0, dissolve: null, fade: false };
      if (plan.instant) e.instance.root.visible = false;
    }
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
    const ai = new MothmantAi({
      x: mp.x,
      z: mp.z,
      angle: monest.instance.root.rotation.y,
      turnRate: 1536,
      speed: enemySpeeds(params && mi !== null ? params.movement(difficulty, mi) : null, 0.5).engagedMove,
      attack,
      radius: collisionRadius('TObjEneBm3Fly'),
      spawnLift: MONEST.height,
      siblingsOn: (id, self) => this.countMothmantTargets(monest, id, self),
      rng: () => this.rng(),
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

  // --- Sinow Beat's mirage (combat/enemyfsmmines.ts) ------------------------------
  //
  // The real body casts the mirage: the 4 child slots after its own (newserv:
  // default_num_children 4; SinowberillAllocateAllyEntity 0x0058f834 gives a
  // clone entity id and enemy index +1 + i) each get a clone, a full Sinow Beat
  // of the same stats that chases and fights like the body and goes away at the
  // first hit. Every client runs its own cast (the exe sends nothing for it).

  private sinowClones = new Map<number, Array<EnemyRuntime | null>>();
  private sinowBaseEvp = new Map<number, number>();
  // Clone slots being built (their instance is async).
  private sinowBuilding = new Set<number>();

  private sinowTick(e: EnemyRuntime, ai: SinowAi): void {
    // +0x2d0 = +0x3e4 / 2 while the mirage is out (short division).
    const base = this.sinowBaseEvp.get(e.index) ?? e.stats.evp;
    this.sinowBaseEvp.set(e.index, base);
    e.stats.evp = ai.evpScale === 1 ? base : Math.trunc(base * ai.evpScale);
    if (!ai.ally) for (const ev of ai.events.splice(0)) this.sinowEvent(e, ai, ev);
  }

  private sinowEvent(e: EnemyRuntime, _ai: SinowAi, ev: SinowEvent): void {
    // The Gold's technique (0x0058dde4): the cast's effect on the Gold, then
    // the buff (Shifta / Deband: ASSUMED on the Gold alone, as Gibbon's enrage).
    if (ev.kind === 'tech') {
      const at = e.instance.root.position;
      this.overlay?.techEffect(ev.tech === 'resta' ? 'resta' : 'support', at.x, at.y, at.z, 20);
      if (ev.tech !== 'resta') this.buffEnemy(e, ev.tech === 'shifta' ? GROUP.shifta : GROUP.deband, supportPower(ev.level), `Gold E-${e.index.toString(16)}`, false);
      this.opts.log(`Gold E-${e.index.toString(16)} casts ${ev.tech} (level ${ev.level})`);
      return;
    }
    const list = this.sinowClones.get(e.index) ?? [];
    this.sinowClones.set(e.index, list);
    if (ev.kind === 'dismiss') {
      for (const c of list) if (c && !c.dead && c.ai instanceof SinowAi) c.ai.dismiss();
      this.opts.log(`Sinow E-${e.index.toString(16)}: the mirage is dispelled`);
      return;
    }
    this.opts.log(`Sinow E-${e.index.toString(16)}: casts the mirage (itself in place ${ev.main})`);
    let n = 0;
    for (let place = 0; place < SINOW_MIRAGE.slots; place++) {
      if (place === ev.main) continue;
      void this.activateClone(e, list, n++, place, ev);
    }
  }

  private async activateClone(parent: EnemyRuntime, list: Array<EnemyRuntime | null>, i: number, place: number, ev: Extract<SinowEvent, { kind: 'mirage' }>): Promise<void> {
    let clone = list[i] ?? null;
    if (clone?.dead) return;
    if (!clone) clone = await this.spawnSinowClone(parent, list, i);
    if (!clone || this.disposed || parent.dead || !(clone.ai instanceof SinowAi)) return;
    const root = clone.instance.root;
    const gy = this.opts.ground?.(ev.x, ev.z, parent.instance.root.position.y + 30) ?? parent.instance.root.position.y;
    const f = clone.ai.activate(ev.x, ev.z, ev.angle, place, ev.targetId, ev.tx, ev.tz);
    root.position.set(f.x, gy, f.z);
    root.rotation.y = f.angle;
    root.visible = true;
    for (const c of root.children) c.visible = true;
    if (f.motion) this.playEnemyMotion(clone, f.motion);
  }

  // SinowberillAllocateAllyEntity: child slot i of the body, a dormant clone.
  private async spawnSinowClone(parent: EnemyRuntime, list: Array<EnemyRuntime | null>, i: number): Promise<EnemyRuntime | null> {
    const index = parent.index + 1 + i;
    const ctx = this.difficultyParams;
    const slot = ctx?.slots[index - ctx.base];
    if (!ctx || !slot || slot.set !== parent.slot.set || this.enemies.has(index) || this.sinowBuilding.has(index)) return list[i] ?? null;
    this.sinowBuilding.add(index);
    try {
      const pp = parent.instance.root.position;
      const placed = {
        ...parent.instance.placed,
        entity: { ...(parent.instance.placed.entity as EnemySet), index: -1 - index },
        world: [pp.x, pp.y, pp.z] as [number, number, number],
        name: 'Sinow clone',
      };
      const instance = await this.layer.spawn(placed as typeof parent.instance.placed, parent.instance.spec);
      if (!instance || this.disposed) return null;
      instance.root.visible = true;
      for (const c of instance.root.children) c.visible = false;
      const fight = this.childFightStats(parent.slot.type);
      const gold = parent.slot.type === 'SINOW_GOLD';
      const mv = ctx.params ? ctx.params.movement(ctx.difficulty, gold ? 0x10 : 6) : null;
      const ai = new SinowAi({
        x: pp.x,
        z: pp.z,
        angle: 0,
        gold,
        ultimate: this.ultimate,
        movement: mv,
        attack: fight.attack,
        radius: collisionRadius('TObjEneMe3ShinowaReal'),
        ally: true,
        rng: () => this.rng(),
      });
      const clone: EnemyRuntime = {
        instance,
        index,
        slot,
        ...fight,
        // The clone's kill sends the exp request of its (child) entity; the
        // child slot has no drop table.
        exp: 0,
        motions: enemyCombatMotions('TObjEneMe3ShinowaReal', instance.archive),
        rtIndex: 0xff,
        dead: false,
        state: 'idle',
        removeIn: 0,
        ai,
        lift: 0,
        monest: null,
        parent,
        fake: null,
        buffs: new EntityBuffs(),
        status: new EnemyStatus(enemyAttribute(parent.slot.type)),
      };
      this.enemies.set(index, clone);
      list[i] = clone;
      return clone;
    } finally {
      this.sinowBuilding.delete(index);
    }
  }

  // --- Pan Arms / Pofuilly Slime (combat/enemysplits.ts) ---------------------

  // A child entity of a splitter in its own slot (`index`), drawn with
  // `model` of the head's BML. Its wave visibility follows the head's.
  private async spawnSplitChild(head: EnemyRuntime, index: number, type: string, model: number, motion: { index: number; speed: number; loop: boolean }, ai: EnemyBrain, at: { x: number; z: number }): Promise<EnemyRuntime | null> {
    const ctx = this.difficultyParams;
    const slot = ctx?.slots[index - ctx.base];
    if (!ctx || !slot || slot.type !== type || this.enemies.has(index)) {
      this.opts.log(`E-${head.index.toString(16)} (${head.slot.type}): no ${type} slot at E-${index.toString(16)}`);
      return null;
    }
    const hp = head.instance.root.position;
    const placed = {
      ...head.instance.placed,
      entity: { ...(head.instance.placed.entity as EnemySet), index: -1 - index },
      world: [at.x, hp.y - head.lift, at.z] as [number, number, number],
    };
    const spec = { ...head.instance.spec, parts: [{ model, motion }] };
    const instance = await this.layer.spawn(placed as typeof head.instance.placed, spec as typeof head.instance.spec);
    if (!instance || this.disposed) return null;
    const runtime: EnemyRuntime = {
      instance,
      index,
      slot,
      ...this.childFightStats(type),
      motions: enemyCombatMotions(head.instance.spec.name, instance.archive),
      rtIndex: ENEMY_TYPE_PARAMS[type]?.rt ?? 0xff,
      dead: false,
      state: 'idle',
      removeIn: 0,
      ai,
      lift: 0,
      monest: null,
      parent: head,
      fake: null,
      buffs: new EntityBuffs(),
      status: new EnemyStatus(enemyAttribute(type)),
    };
    instance.root.visible = head.instance.root.visible;
    this.enemies.set(index, runtime);
    return runtime;
  }

  // On entering the floor: each Pan Arms gets its hidden Hidoom / Migium
  // (slots + 1 / + 2, models 1 / 2), each slime control its first slime.
  private async spawnSplitters(): Promise<void> {
    const ctx = this.difficultyParams;
    for (const e of [...this.enemies.values()]) {
      const at = { x: e.instance.root.position.x, z: e.instance.root.position.z, angle: e.instance.root.rotation.y };
      const mv = (row: number) => (ctx?.params ? ctx.params.movement(ctx.difficulty, row) : null);
      if (e.ai instanceof PanArmsAi) {
        const pan = e.ai;
        // MovementData rows 0x32 (Hidoom) / 0x33 (Migium); Hidoom's Resta
        // level is Migium's iparam1.
        const migMv = mv(0x33);
        const hid = new PanHalfAi('hidoom', { ...at, movement: mv(0x32), restaLevel: migMv?.iparam[0] ?? 0, rng: () => this.rng() });
        const mig = new PanHalfAi('migium', { ...at, movement: migMv, rng: () => this.rng() });
        hid.sibling = mig;
        mig.sibling = hid;
        const h = await this.spawnSplitChild(e, e.index + 1, 'HIDOOM', 1, { index: 24, speed: 0.8, loop: true }, hid, at);
        const m = await this.spawnSplitChild(e, e.index + 2, 'MIGIUM', 2, { index: 25, speed: 0.8, loop: true }, mig, at);
        if (this.disposed) return;
        for (const c of [h, m]) if (c) for (const part of c.instance.root.children) part.visible = false;
        // Without both halves it never splits (PanArmsAi checks halves).
        if (h && m) pan.halves = [hid, mig];
        else {
          for (const c of [h, m]) if (c) this.dropQuietly(c);
          this.opts.log(`E-${e.index.toString(16)} (${e.slot.type}): its halves are missing, it will not split`);
        }
      } else if (e.ai instanceof SlimeControl) {
        for (const part of e.instance.root.children) part.visible = false;
        const first = await this.spawnSlime(e, e.ai, at.x, at.z, at.angle, false);
        if (this.disposed) return;
        // No slime could be built: the control has nothing to wait for.
        if (!first) this.slimeControlDone(e, true);
      } else if (e.ai instanceof EpsilonAi) {
        // epsilon_constructor builds its four Epsigards (slots + 1 .. + 4, model 2).
        for (let i = 0; i < 4; i++) await this.spawnSplitChild(e, e.index + 1 + i, 'EPSIGARD', 2, { index: 2, speed: 1, loop: true }, e.ai.children[i], at);
        if (this.disposed) return;
      }
    }
  }

  private async spawnSlime(control: EnemyRuntime, c: SlimeControl, x: number, z: number, angle: number, thrown: boolean, throwAngle?: number | undefined): Promise<EnemyRuntime | null> {
    const k = c.take();
    if (k < 0) return null;
    // Rare = param6 & 1 (ASSUMED, as the Rappy's): the puddle's morph motion.
    const rare = (Math.trunc((control.instance.placed.entity as EnemySet).params[5] ?? 0) & 1) !== 0;
    // The crawl's map queries (SlimeAi.ground / wall) take heights relative to the floor
    // under the body: the floor is the root's height less its lift (as the draw places it).
    let self: EnemyRuntime | null = null;
    const floorY = () => (self ? self.instance.root.position.y - self.lift : 0);
    const ground = this.opts.ground;
    const wall = this.opts.wallBlocks;
    const ai = new SlimeAi({
      x,
      z,
      angle,
      movement: this.difficultyParams?.params ? this.difficultyParams.params.movement(this.difficultyParams.difficulty, 0x30) : null,
      thrown,
      throwAngle,
      rare,
      rng: () => this.rng(),
      // Without a map the crawl keeps the brain's flat-ground default.
      ...(ground
        ? {
            ground: (x: number, z: number, fromY: number) => {
              const floor = floorY();
              const g = ground(x, z, floor + fromY);
              return g === null ? null : g - floor;
            },
          }
        : {}),
      ...(wall
        ? {
            wall: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
              const floor = floorY();
              return wall({ x: a.x, y: a.y + floor, z: a.z }, { x: b.x, y: b.y + floor, z: b.z }, 0x8000);
            },
          }
        : {}),
    });
    const r = await this.spawnSplitChild(control, control.index + 1 + k, 'POFUILLY_SLIME', 0, ai.motion ?? { index: 10, speed: 0.5, loop: true }, ai, { x, z });
    self = r;
    if (!r) {
      c.died(k);
      return null;
    }
    r.slimeSlot = k;
    this.slimeView(r, ai);
    return r;
  }

  // 0x00597914 / 0x005987c8: a copy of the slime is thrown out of it into the
  // control's first free slot (none left: nothing happens).
  private async splitSlime(e: EnemyRuntime, what: string): Promise<void> {
    const control = e.parent;
    if (!control || !(control.ai instanceof SlimeControl) || !control.ai.slots.includes('free')) return;
    const p = e.instance.root.position;
    // The copy's heading: 0x00597914 takes ROUND(65535 * rand) as a short BAMS angle,
    // the direction is (sin, 0, cos) of it (ASSUMED: the exe's rand is this.rng).
    const throwAngle = ((Math.round(65535 * this.rng()) & 0xffff) / 0x10000) * Math.PI * 2;
    const r = await this.spawnSlime(control, control.ai, p.x, p.z, e.instance.root.rotation.y, true, throwAngle);
    if (r) this.opts.log(`${what}: E-${e.index.toString(16)} (${e.slot.type}) splits into E-${r.index.toString(16)}`);
  }

  // The Hidoom and Migium HP while split (the Pan Arms shows their sum).
  private panHalfHp(ai: PanArmsAi): number {
    let sum = 0;
    for (const h of ai.halves) {
      const r = this.runtimeOf(h);
      if (r && !r.dead) sum += r.stats.hp;
    }
    return sum;
  }

  private panEvent(e: EnemyRuntime, ai: PanArmsAi, ev: PanEvent): void {
    const what = `E-${e.index.toString(16)} (${e.slot.type})`;
    if (ev.kind === 'emerged') {
      this.opts.log(`${what} emerges`);
    } else if (ev.kind === 'split') {
      // c1 (0x00587a04): each half gets (HP + 1) / 2, truncated, and keeps it
      // as its split HP (+0x3c4, Hidoom's call threshold).
      const each = Math.trunc((e.stats.hp + 1) / 2);
      for (const h of ai.halves) {
        const r = this.runtimeOf(h);
        if (!r || r.dead) continue;
        r.stats.hp = each;
        r.stats.maxHp = Math.max(r.stats.maxHp, each);
        r.splitHp = each;
        r.instance.root.position.copy(e.instance.root.position);
      }
      this.opts.log(`${what} splits into Hidoom and Migium (${each} HP each)`);
    } else if (ev.kind === 'merged') {
      // 0x00582ab8 / 0x005822e4: HP = the halves' HP added, with no clamp to
      // the Pan Arms's own max (a Resta'd half can push it over).
      e.stats.hp = Math.max(1, this.panHalfHp(ai));
      this.sendEnemy(e, ENEMY_BASE_FLAGS);
      this.opts.log(`${what}: Hidoom and Migium merge (${e.stats.hp}/${e.stats.maxHp} HP)`);
    } else {
      // Both halves died while split: the Pan Arms only sends 6x76 (no drop,
      // no EXP) and is gone.
      e.dead = true;
      this.game.sendEntitySetFlags(0x1000 | e.index, this.floor, 8);
      this.layer.remove(e.instance);
      this.enemies.delete(e.index);
      if (this.lockOn === e) this.lockOn = null;
      this.opts.log(`${what}: Hidoom and Migium are dead, the set is cleared`);
    }
  }

  // A splitter (or its child) died, by a local kill (`local`: this client
  // sends the 6x76s) or another client's 6x0A.
  private splitterDied(e: EnemyRuntime, local: boolean): void {
    // A Recobox's Recons die with it, an Epsilon's Epsigards go (combat/enemyfsmep2d.ts).
    if (e.ai instanceof RecoboxAi || e.ai instanceof EpsilonAi) {
      for (const c of [...this.enemies.values()]) if (c.parent === e) this.dropQuietly(c);
    }
    // The merged Pan Arms dies alone: its hidden halves are dropped.
    if (e.ai instanceof PanArmsAi) {
      for (const h of e.ai.halves) {
        const r = this.runtimeOf(h);
        if (!r) continue;
        h.kill();
        this.layer.remove(r.instance);
        this.enemies.delete(r.index);
      }
    }
    const control = e.parent;
    if (e.ai instanceof SlimeAi && e.slimeSlot !== undefined && control?.ai instanceof SlimeControl) {
      control.ai.died(e.slimeSlot);
      if (control.ai.finished) this.slimeControlDone(control, local);
    }
  }

  // The control's update (0x005956d4): with no slot holding a live slime it
  // sends the set's 6x76 (set_monster_spawn_initdata_as_dead 0x008113e4) and
  // is deleted. Every client runs it on its own slots: a split (0x00597914 ->
  // 0x00595bc8 -> 0x00595d74) builds the copy locally and sends no
  // subcommand, so another client never sees the copies. This client only
  // sends the 6x76 for its own kill (`local`), so another client's kill of
  // the last slime it knew of does not clear a set whose copies live here.
  private slimeControlDone(control: EnemyRuntime, local: boolean): void {
    if (control.dead) return;
    control.dead = true;
    if (local) this.game.sendEntitySetFlags(0x1000 | control.index, this.floor, 8);
    this.layer.remove(control.instance);
    this.enemies.delete(control.index);
  }

  // A Recon comes out of its Recobox: slot box + 1 + child, model 0 of the box's BML.
  private async spawnRecon(box: EnemyRuntime, ai: RecoboxAi, sp: ReconSpawn): Promise<void> {
    // The Recon starts at the box's y (its lift is above the ground under the spot).
    const g = this.opts.ground?.(sp.x, sp.z, sp.boxY + 30) ?? null;
    if (g !== null) sp.recon.startFromBox(sp.boxY, g);
    const r = await this.spawnSplitChild(box, box.index + 1 + sp.child, 'RECON', 0, { index: 8, speed: 0.7, loop: true }, sp.recon, { x: sp.x, z: sp.z });
    if (!r) ai.spawnFailed(sp.recon);
    else this.opts.log(`Recobox E-${box.index.toString(16)} sent Recon E-${r.index.toString(16)}`);
  }

  // A child removed without a kill (no 6x76, no EXP).
  private dropQuietly(e: EnemyRuntime): void {
    e.dead = true;
    e.ai?.kill();
    this.layer.remove(e.instance);
    this.enemies.delete(e.index);
    if (this.lockOn === e) this.lockOn = null;
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
    for (const [i, a] of e.instance.animators.entries()) {
      if (e.instance.parts[i]?.ownMotion) continue; // the view plays it (the Morfos' arm)
      try {
        a.play(e.instance.archive.motion(m.index, a.nodeCount), m.speed, m.loop);
      } catch (err) {
        this.opts.log(`enemy motion ${m.index}: ${(err as Error).message}`);
      }
    }
  }

  // The Ill Gill scythe's weapon special on the local player (FUN_007753b4, the player's special
  // handler: case 7 ice, case 10 thunder, case 0xb insta-kill; the attacker is an enemy, so the
  // B branch of freeze_activation_check / thunder_special_attack_shock_chance applies). The
  // resists are the player's own (playerresist.ts): ice reads EIC (+0x2fa, 0x007771fc), thunder
  // reads ETH (+0x2f8, 0x00777115 for the chance and 0x007759c1 for the damage), insta-kill reads
  // EDK (+0x2fc, 0x007758c5). The status boosts of an enemy attacker are 1.0 / 0 (ASSUMED).
  // Returns whether the attack's normal hit still lands: false for ice and thunder (the special
  // is their whole effect, the thunder's own damage aside), true for the insta-kill.
  private illGillSpecial(e: EnemyRuntime, special: IllGillSpecial, angle: number): boolean {
    const what = `E-${e.index.toString(16)} (${e.slot.type})`;
    const killer = 0x1000 | e.index;
    const el = this.selfElements();
    // The B branch's chance: resist / -100 + 0.75, floored at 0 (freeze_activation_check 0x007771a0,
    // thunder_special_attack_shock_chance 0x007770d0). The freeze lands when it beats the roll.
    if (special.kind === 'freeze') {
      const statusChance = statusChanceFromResist(el.eic);
      if (statusChance > this.rng()) this.inflictStatus(STATUS.freeze, what);
      else this.opts.log(`${what}: ice missed`);
      return false;
    }
    if (special.kind === 'shock') {
      const statusChance = statusChanceFromResist(el.eth);
      // The thunder's damage: (100 - ETH) * 0.002 * (level / (5 - power) + (1 + power) * 20) * 5.
      const dmg = Math.round(((100 - el.eth) * 0.002 * (special.level / (5 - special.power) + (1 + special.power) * 20)) * 5);
      if (dmg >= 1) this.damage.hit(dmg, angle, 0, killer);
      if (this.rng() < statusChance) this.inflictStatus(STATUS.shock, what);
      return false;
    }
    // The insta-kill's roll: (power - EDK) * 0.01 - 0.5 for a player, against the roll; the boss
    // areas refuse it. The kill sets the HP to 0.
    const roll = this.rng();
    const killChance = (special.power - el.edk) * 0.01 - 0.5;
    if (!this.inBossArea() && killChance > roll) {
      this.opts.log(`${what}: instant kill (${Math.round(killChance * 100)}%)`);
      this.damage.hit(this.damage.hp, 0, 0, killer);
    } else this.opts.log(`${what}: instant kill (${Math.round(killChance * 100)}%) missed`);
    return true;
  }

  // One enemy melee landing on a player: the hit roll and the damage of
  // FUN_00777664 / FUN_007732b8 with the attack's own multiplier.
  private enemyHitsPlayer(e: EnemyRuntime, clientId: number, knockback: number, mult: number, kbScale?: number, attackRow?: number, special?: IllGillSpecial | null): void {
    if (clientId !== this.game.selfId) return; // other clients resolve their own hits
    const view = this.view;
    const attacker = attackRow ? this.enemyAttackerRow(e, attackRow) : this.enemyAttackerOf(e);
    if (!view || !attacker) return;
    const from = view.playerPositions().get(clientId);
    const p = e.instance.root.position;
    const stats = this.selfStats();
    if (special) {
      const angle = from ? Math.atan2(from.x - p.x, from.z - p.z) : 0;
      // The freeze and the shock take the place of the normal hit; the insta-kill keeps it.
      if (!this.illGillSpecial(e, special, angle)) return;
    }
    // Deband / Zalure move the player's DFP (+0x2d2); a freeze lowers EVP.
    const defender: DefenderStats = { hp: this.damage.hp, maxHp: this.damage.maxHp, evp: this.status.evp(stats.evp), dfp: this.selfBuffs.dfp(stats.dfp) };
    // The generic hit check has no attack-type or combo multiplier for an
    // enemy's melee: accuracy 1.0.
    const chance = (attacker.ata - defender.evp * 0.2) * 0.01;
    let total = 0;
    let landed = false;
    let critical = false;
    if (chance > 0 && this.rng() <= chance) {
      landed = true;
      const r = rollDamage(attacker, defender, 0, this.rng, mult);
      total = r.damage;
      critical = r.critical;
    }
    const angle = from ? Math.atan2(from.x - p.x, from.z - p.z) : 0;
    // cause_knockback(kbScale * the damage try_hit_entity returned).
    this.damage.hit(total, angle, kbScale !== undefined ? kbScale * total : knockback, 0x1000 | e.index, critical && total >= 1);
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
      this.overlay.setTarget(null, { row: 0, camera: this.viewer.camera });
      this.overlay.setTarget(null, { row: 0, camera: this.viewer.camera, ally: true });
      if (this.hud) {
        this.hud.targetCard = null;
        this.hud.allyCard = null;
      }
      this.lockOn = null;
      this.allyLock = null;
      return;
    }
    let best: EnemyRuntime | null = null;
    let bestSq = 220 * 220; // ASSUMED lock-on range
    for (const e of this.enemies.values()) {
      if (e.dead || !e.instance.root.visible || (e.ai instanceof ClawAi && e.ai.hidden) || lockConcealed(e) || !splitLockOk(e)) continue;
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
    // The point moves toward the camera by the target's hit box radius (PROVEN: init_reticle
    // copies the box's radius into the reticle, create_target_reticles_for_weapon_or_tech
    // `fVar9 = pcVar8[sVar3].radius`; PositionAndRenderReticlePrimitives calls
    // CalculatePositionTowardsCamera with it). The point's height (+22) stays ASSUMED.
    this.overlay.setTarget(best ? { x: best.instance.root.position.x, y: best.instance.root.position.y + 22, z: best.instance.root.position.z } : null, {
      row: reticleRow('enemy'),
      camera: this.viewer.camera,
      radius: best ? this.hitRadiusOf(best) : 0,
    });
    if (this.hud) this.hud.targetCard = best ? this.targetCardOf(best) : null;
    this.updateAllyLock(from);
  }

  // The support target: the nearest eligible party member for each Resta / Anti / Reverser
  // on the palette (group 1 = 3, not disabled), the nearest of those. Resta and Anti pick a
  // living ally, Reverser a dead one (reverserTarget). Not in a Challenge game for Reverser
  // (CanPlayerCastTechnique_0069a0c4). ASSUMED: the exe shows one cursor per configured
  // record; here one cursor, the nearest.
  private updateAllyLock(from: { x: number; z: number }): void {
    const me = this.game.self;
    const view = this.view;
    this.allyLock = null;
    if (!me || !view || !this.overlay) return;
    const techs = new Set<number>();
    for (let i = 0; i < 10; i++) {
      const slot = this.opts.paletteSlot?.(i);
      if (slot && !slot.disabled && slot.group1 === 3 && SUPPORT_TARGET_TECHS.includes(slot.group2)) techs.add(slot.group2);
    }
    const candidates: SupportCandidate[] = [];
    for (const [id, p] of view.playerPositions()) {
      if (id === me.clientId) continue;
      candidates.push({ id, x: p.x, z: p.z, dead: this.isPlayerDead(id) });
    }
    let best: { id: number; distance: number; tech: number } | null = null;
    for (const tech of techs) {
      if (tech === TECH.reverser && this.game.info?.challenge) continue;
      const level = this.techLevel(tech);
      if (level === null) continue;
      const hit = nearestSupportTarget(from, candidates, techData(tech, level, me.charClass).rangeH, tech === TECH.reverser);
      if (hit && (!best || hit.distance < best.distance)) best = { ...hit, tech };
    }
    const row = reticleRow('support');
    if (!best) {
      this.overlay.setTarget(null, { row, camera: this.viewer.camera, ally: true });
      if (this.hud) this.hud.allyCard = null;
      return;
    }
    this.allyLock = best.id;
    const p = view.playerPositions().get(best.id);
    if (p) {
      this.overlay.setTarget({ x: p.x, y: p.y + PLAYER_RETICLE_HEIGHT, z: p.z }, { row, camera: this.viewer.camera, ally: true });
    }
    if (this.hud) this.hud.allyCard = p ? this.allyCardOf(best.id) : null;
  }

  // The player card's text for a party member (QuickMenuUpdatePlayerInfo: the name, the section ID).
  private allyCardOf(clientId: number): PlayerTargetCardText | null {
    const p = this.game.players.get(clientId);
    if (!p) return null;
    return playerTargetCardText({ name: p.name, sectionId: p.sectionId ?? 9 });
  }

  // The lock-on cursor's model: bm_ply_lock_on_cursor.bml (LoadReticleModel_007a41d0),
  // njcm chunk 0 (obj_f_maincarsol.nj, the triangle) and chunk 2 (obj_f_blackcarsol.nj, the outline).
  private async loadReticleModels(): Promise<void> {
    try {
      const bml = new BmlArchive((await this.files.readFirst(['bm_ply_lock_on_cursor.bml'])).data);
      const geometry = (name: string): THREE.BufferGeometry => {
        const model = bml.has(name) ? (parseNinjaChunkFile(bml.get(name)).object?.model ?? null) : null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(model ? modelTriangles(model) : new Float32Array(0), 3));
        return g;
      };
      this.overlay?.setReticleModels(geometry('obj_f_maincarsol.nj'), geometry('obj_f_blackcarsol.nj'));
    } catch (err) {
      this.opts.log(`lock-on cursor unavailable (${(err as Error).message})`);
    }
  }

  // The unitxt text tables for the target card (loaded once; the card falls back to
  // the port's names until they are in).
  private unitxtLoading = false;
  private unitxt: string[][] | null = null;
  private loadUnitxtText(): void {
    if (this.unitxtLoading) return;
    this.unitxtLoading = true;
    void (async () => {
      try {
        this.unitxt = parseUnitxt((await this.files.readFirst(['unitxt_e.prs', 'unitxt_j.prs'])).data);
      } catch (err) {
        this.opts.log(`target card text unavailable (${(err as Error).message})`);
      }
    })();
  }

  // The target card's text for an enemy (ui_target_window_attribute, combat/targetcard.ts).
  private targetCardOf(e: EnemyRuntime): TargetCardText {
    const kind = e.slot.type;
    const base = (ENEMY_TYPE_NAMES[kind]?.[0] ?? kind).replace(/ \([^)]*\)$/, '');
    return targetCardText({
      name: base,
      attribute: enemyAttribute(kind),
      difficulty: this.game.info?.difficulty ?? 0,
      texts: this.unitxt,
      monsterId: graveKillerId(kind),
    });
  }

  private selfAnimator() {
    const me = this.game.self;
    return me ? (this.view?.playerAnimator(me.clientId) ?? null) : null;
  }

  // Particles of an effect on a player (render/playerfx.ts); `follow` keeps
  // them with the player (flag 0x10).
  private fxOn(clientId: number, specs: readonly FxSpec[], follow = false): void {
    if (specs.length) void this.playerFx?.play(clientId, specs, { follow });
  }

  // The battle win particle on a leading battle player, one emission per call
  // (quest/battlerun.ts calls it on every 30 Hz update, as the exe does).
  winEffect(clientId: number): void {
    this.fxOn(clientId, WIN_FX, true);
  }

  // The look of the local player's states (combat/playerfx.ts).
  private selfFx(e: PlayerDamageFx): void {
    const id = this.game.selfId;
    if (e.kind === 'hit') {
      this.fxOn(id, [...(e.critical ? CRITICAL_HIT_FX : HIT_SPARK), ...attributeFx(this.game.self?.charClass ?? 0)]);
      // The critical's SE 0x42 and flash at the hit point (the player's feet + HIT_POINT_DY).
      if (e.critical) {
        this.playSe(CRITICAL_SE);
        const p = this.view?.playerPositions().get(id);
        if (p) void this.fx?.models.flash(new THREE.Vector3(p.x, p.y + HIT_POINT_DY, p.z));
      }
    }
    else if (e.kind === 'block') this.fxOn(id, BLOCK_FX);
    else this.fxOn(id, REVIVE_FX);
  }

  // The dead marker of a player (particle 0xaf): TriggerDespawnEffect on 6x4E,
  // gone when the player is revived or leaves. Not on Pioneer 2
  // (is_current_map_safe).
  private showSoul(clientId: number, on: boolean): void {
    const old = this.souls.get(clientId);
    if (!on) {
      old?.stop();
      this.souls.delete(clientId);
      return;
    }
    const fx = this.playerFx;
    if (old || !fx || this.area === 0) return;
    this.souls.set(clientId, { stop: () => {} });
    void fx.play(clientId, SOUL_FX).then((h) => {
      if (this.souls.has(clientId) && !this.disposed) this.souls.set(clientId, h);
      else h.stop();
    });
  }

  // A status effect pulse on a player (the infliction or a 45-frame period):
  // its sound and particle (combat/playerfx.ts statusPulse).
  private statusPulse(clientId: number, type: StatusType, onset: boolean): void {
    const p = statusPulse(type, onset);
    if (p.se !== null) this.playSe(p.se);
    this.fxOn(clientId, statusFx(type), true);
    if (type === STATUS.freeze && onset) this.playerIce(clientId);
  }

  // The ice block of a player's freeze: the same object as an enemy's (the
  // exe's CreateItemEffectHandler_00500fe8 on the player entity, combat/hitmodels.ts
  // IceBlock). ASSUMED: the player has no hit box pointer (+0x2b4 / +0xa4), so the
  // target radius is the default 1.5, and the block sits at the hit point height.
  // It shatters when the freeze ends or the player dies.
  private playerIce(clientId: number): void {
    const self = clientId === this.game.selfId;
    const center = (): THREE.Vector3 | null => {
      const p = this.view?.playerPositions().get(clientId);
      return p ? new THREE.Vector3(p.x, p.y + HIT_POINT_DY, p.z) : null;
    };
    const frozen = (): boolean => {
      if (self ? this.damage.dead : this.deadPlayers.has(clientId)) return false;
      const s = self ? this.status : this.remoteStatus.get(clientId);
      return !!s && s.has(STATUS.freeze);
    };
    this.fx?.ice({ center, frozen, radius: ICE_DEFAULT_RADIUS });
  }

  // The ticks of the remote players' status effects (their copies run them
  // too); the local one is PlayerStatus's own tick (tickStatus).
  private tickRemoteStatus(): void {
    if (this.area === 0) return;
    for (const [id, rs] of this.remoteStatus) {
      if (!this.game.players.has(id)) this.remoteStatus.delete(id);
      else rs.tick(100, this.deadPlayers.has(id), this.game.info?.difficulty ?? 0);
    }
    for (const id of [...this.souls.keys()]) if (id !== this.game.selfId && !this.game.players.has(id)) this.showSoul(id, false);
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
    // is_player_allowed_to_attack (0x00699510): no attack while paralyzed or
    // shocked (character flags & 0x20006), and none in a hub: its last test is
    // is_player_in_unsafe_map (0x0068a3fc), so the hubs refuse every attack
    // (the palette press is dropped, nothing is sent).
    if (!this.status.canAttack || !inUnsafeMap(this.area)) return;
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
        // ASSUMED: every attack motion starts at frame 0. The Mechgun's three steps
        // share one looping motion (index 25), and play() would otherwise keep it
        // running from where the last swing stopped.
        animator.frame = 0;
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
    // dispatch_action_attack_step1 (PsoBB.exe 0x006a0f58): the attack faces the
    // primary target, the nearest one in the reticle (update_player_targeting_info
    // and get_player_primary_target_position, 0x006a0f58 -> 0x00588704 / 0x00588769),
    // and the heading if there is none. The 6x43 carries that angle, and our own
    // handler then turns us to it. ASSUMED: the exe aims at the hitbox centre,
    // the port at the enemy's origin.
    const from = view.playerPositions().get(me.clientId);
    const primary = from ? this.weaponTargets(type, from)[0] : undefined;
    if (from && primary) {
      const p = primary.instance.root.position;
      me.angle = facingOf(p.x - from.x, p.z - from.z);
    }
    // modify_direction in each dispatch_action_attack_step (see attackHeading): a confused
    // player on an unsafe map strikes at a random heading (should_do_confused_movement).
    const confused = this.status.has(STATUS.confusion) && inUnsafeMap(this.area);
    this.game.sendAttack(step, attackHeading(me.angle, confused, () => Math.floor(Math.random() * (RAND_MAX_C + 1))), type);
    // The weapon's attacks_per_step sets the Mechgun's bursts (combat/attack.ts burstCount).
    const weapon = this.equippedWeapon();
    this.attack.begin(step, type, weapon ? burstCount(weapon.data1[1], weapon.data1[2]) : 1);
    if (type === 2) this.specialStartFx();
  }

  // The special attack's start (state 0x0069c4a0 case 2): the handler's type 0
  // (the weapon particle of Flame / Burning / Shock / Thunder / Storm /
  // Tempest) and SE 0x40 (combat/techlightning.ts specialStart).
  private specialStartFx(): void {
    const me = this.game.self;
    const w = this.equippedWeapon();
    const pos = me ? this.view?.playerPositions().get(me.clientId) : null;
    if (!me || !w || !pos) return;
    this.playSe(SE.specialStart);
    const start = specialStart(weaponSpecialByte(w.data1).index);
    // ASSUMED: the weapon position (+0x300) and the weapon node are 20 above the feet.
    if (start) this.particle({ id: start.particle }, new THREE.Vector3(pos.x, pos.y + CAST_HEIGHT, pos.z));
  }

  // Equipped weapon of the local player (first equipped 00xxxx item): the
  // session's character file, which net/items.ts keeps in step with equips,
  // else the join snapshot.
  private equippedWeapon(): { data1: Uint8Array } | null {
    return this.equippedItem((d1) => d1[0] === 0);
  }

  // The local player's SetContext from the worn equipment (the same sources as equippedItem). The beat
  // time is the exe's clock (liveBeatTime, combat/beattime.ts: the local clock on the base the last B1
  // set); the nearby players and the colored ring count stay at their defaults (ASSUMED, see
  // defaultSetContext).
  private liveSetContext(): SetContext {
    const beat = liveBeatTime();
    const char = this.opts.character?.();
    if (char) return defaultSetContext(wornEquipment(char.inventory.filter((i) => (i.flags & 8) !== 0).map((i) => i.data)), beat);
    const inv = this.game.selfSnapshot.inventory;
    const count = Math.min(30, inv[0]);
    const worn: ItemData[] = [];
    for (let i = 0; i < count; i++) {
      const o = 4 + i * 0x1c;
      const flags = new DataView(inv.buffer, inv.byteOffset).getUint32(o + 4, true);
      if (flags & 8) worn.push(readItemData(inv, o + 8));
    }
    return defaultSetContext(wornEquipment(worn), beat);
  }

  // The local player's elemental resists from the worn equipment (combat/playerresist.ts). Zero
  // until the ItemPMT has loaded (no item stats to read before it).
  private selfElements(): PlayerElements {
    const pmt = this.loadedItemPmt;
    if (!pmt) return classBaseElements(0);
    const ctx = this.liveSetContext();
    return playerElements(ctx.worn, pmt, ctx);
  }

  // The first equipped item whose data1 matches (the equip flag 8 of the same two sources).
  private equippedItem(match: (data1: Uint8Array) => boolean): { data1: Uint8Array } | null {
    const char = this.opts.character?.();
    if (char) {
      const w = char.inventory.find((i) => (i.flags & 8) !== 0 && match(i.data.data1));
      return w ? { data1: Uint8Array.from(w.data.data1) } : null;
    }
    const inv = this.game.selfSnapshot.inventory;
    const count = Math.min(30, inv[0]);
    for (let i = 0; i < count; i++) {
      const o = 4 + i * 0x1c;
      const flags = new DataView(inv.buffer, inv.byteOffset).getUint32(o + 4, true);
      if (!(flags & 8)) continue;
      const data1 = inv.subarray(o + 8, o + 8 + 12);
      if (match(data1)) return { data1 };
    }
    return null;
  }

  // A shield (armour class 1, subtype 2: items.ts slotMatches SLOT_SHIELD) in the
  // shield slot: the 6x4A block then runs the shield's empty do_attack.
  private equippedShield(): boolean {
    return this.equippedItem((d1) => d1[0] === 1 && d1[1] === 2) !== null;
  }

  private pmtSync: ItemPMT | null = null;

  // The ItemPMT once itemPmt() has loaded it (null before; the held weapons
  // of the field read it, render/heldweapon.ts).
  get loadedItemPmt(): ItemPMT | null {
    return this.pmtSync;
  }

  // Motion class of the equipped weapon: ItemPMT's weapon kind table
  // (ASSUMED to be the motion set's weapon class; 0 = bare hands).
  private weaponClass(): number {
    const w = this.equippedWeapon();
    if (!w || !this.pmtSync) return 0;
    return this.pmtSync.weaponKinds[w.data1[1]] ?? 0;
  }

  // The local player's skeleton as the gun's origin provider (the lobby view's model).
  private weaponOriginOfSelf(clientId: number): WeaponOriginProvider {
    return (ref, out) => this.view?.weaponOriginOf(clientId, ref, out) ?? false;
  }

  // The equipped weapon's attach index: its ItemPMT byte +0x1f (item +0x1f2). Without an
  // ItemPMT entry the hand node is used (ASSUMED).
  private weaponAttach(): number {
    const w = this.equippedWeapon();
    if (!w || !this.pmtSync) return HAND_NODE;
    return this.pmtSync.getWeapon(w.data1[1], w.data1[2])?.projectile ?? HAND_NODE;
  }

  private weaponRange(attackType: AttackType): WeaponRange {
    const w = this.equippedWeapon();
    const fallback: WeaponRange = { horizontal: 14, vertical: 18, horizontalHalfAngle: 0x127d, verticalHalfAngle: 0x127d, maxTargets: 1 };
    if (!w || !this.pmtSync) return fallback;
    return this.pmtSync.weaponRange(w.data1[1], w.data1[2], attackType) ?? fallback;
  }

  // The weapon's reach from the player for the Middle key (combat/weaponaim.ts inWeaponReach):
  // the range and cone of the Middle slot's attack when it is an attack, else the basic one
  // (ASSUMED: the exe's per-target-info table is not ported).
  private middleReach(slot: { group1: number; group2: number; disabled: boolean } | null | undefined): WeaponReach | null {
    const me = this.game.self;
    if (!me) return null;
    const attackType = (slot && !slot.disabled && slot.group1 === 2 && slot.group2 <= 2 ? slot.group2 : 0) as AttackType;
    const range = this.weaponRange(attackType);
    const p = me.position;
    return { x: p.x, y: p.y, z: p.z, heading: me.angle, maxDist: range.horizontal + range.vertical, halfAngle: range.horizontalHalfAngle * BAMS_TO_RAD };
  }

  // The enemies the weapon reaches from `from` inside its cone around the
  // heading, nearest first. The exe's reticle does this for each enemy
  // (check_enemy_is_targetable, 0x007a2b5c, sorted by
  // find_targets_for_weapons_and_techs, which keys on the XZ distance to the box centre);
  // its first target is the primary one. The test is weaponaim.ts inMeleeReach: the reach
  // with the box radius, the apex (the weapon, or vertical_distance behind it), the horizontal
  // cone and the elevation cone (no height window).
  private weaponTargets(attackType: AttackType, from: { x: number; y: number; z: number }): EnemyRuntime[] {
    const me = this.game.self;
    if (!me) return [];
    const range = this.weaponRange(attackType);
    const aim: MeleeAim = { heading: me.angle, horizontal: range.horizontal, vertical: range.vertical, hAngle: range.horizontalHalfAngle, vAngle: range.verticalHalfAngle };
    // The weapon point is the player's weapon_position (player +0x300, UpdatePlayerWeaponPosition_0077a1f4):
    // x and z are the feet, y is the feet plus 0.5 * the bloodstain offset (weaponPositionY; the offset
    // is ASSUMED 0, so the point is the feet).
    const weapon = { x: from.x, y: weaponPositionY(from.y), z: from.z };
    const keys = new Map<EnemyRuntime, number>();
    const targets: EnemyRuntime[] = [];
    for (const e of this.enemies.values()) {
      if (e.dead) continue;
      // An enemy whose wave has not spawned yet is not in the room (its model
      // is hidden by render/waves.ts), so it cannot be hit.
      if (!struckShown(e) || concealed(e) || !splitStruckOk(e)) continue;
      const p = e.instance.root.position;
      // The exe's per-box loop (check_enemy_is_targetable): every enabled box with the kind bit is a
      // candidate with its own centre (position2) and radius; the enemy is a target when one passes.
      // The centre is the origin plus the row's offset, ASSUMED unrotated (the exe rotates the offset by
      // the enemy's yaw). The entity gates (0x60000000 / 0x40800 on the entity flags) are not ported.
      const rows = this.enemyBoxRows(e);
      if (rows) {
        const boxes = rows.map((r) => ({ x: p.x + r.offset[0], y: p.y + r.offset[1], z: p.z + r.offset[2], radius: r.radius, flags: r.flags }));
        const key = meleeReachAny(weapon, aim, boxes);
        if (key === Infinity) continue;
        keys.set(e, key);
        targets.push(e);
        continue;
      }
      // No box table is known for this enemy (ASSUMED: the port's point test with the family's radius).
      // ASSUMED: a box counts from its surface; the Dragon's seven body boxes
      // all sit at its origin, the biggest with radius 15 (combat/dragon.ts
      // DRAGON_BODY_BOXES). Every other enemy keeps the point test.
      // A De Rol Le segment's box has radius 50 (0x009a47f0); ASSUMED: it
      // counts from its surface in height too.
      // A Barba Ray part's box has radius 50 (BARBA_PART_RADIUS, 0x004ba2d8); ASSUMED: its height window is De Rol Le's.
      const seg = e.ai instanceof DrlSegmentAi || e.ai instanceof BarbaPartAi;
      // A Vol Opt monitor's box is the exe's row for its index (volooptMonitorRows).
      const monitor = this.voloptMonitorRows(e) !== null;
      const reach = e.ai instanceof DragonAi ? DRAGON_BODY_BOXES.reach : e.ai instanceof GoldDragonAi ? GOL_BODY_BOXES.reach : e.ai instanceof BarbaPartAi ? BARBA_PART_RADIUS : seg ? DRL_SEGMENT.radius : monitor || e.ai instanceof SmChildAi ? this.hitRadiusOf(e) : 0;
      // ASSUMED: the box centre is the root plus the aim height (aimHeightOf); the Dragon's
      // boxes sit at its origin.
      const centre = { x: p.x, y: e.ai instanceof DragonAi || e.ai instanceof GoldDragonAi ? p.y : p.y + this.aimHeightOf(e), z: p.z };
      if (!inMeleeReach(weapon, aim, centre, reach)) continue;
      keys.set(e, (p.x - weapon.x) ** 2 + (p.z - weapon.z) ** 2);
      targets.push(e);
    }
    targets.sort((a, b) => keys.get(a)! - keys.get(b)!);
    return targets;
  }

  // The enemy's box rows (formats/enemyboxes.ts): a Vol Opt monitor's own row set, else the set type's
  // table for its area and variant. Null when no table is known.
  private enemyBoxRows(e: EnemyRuntime): readonly CollisionBoxRow[] | null {
    const monitor = this.voloptMonitorRows(e);
    if (monitor) return monitor;
    return enemyBoxTable(slotSetType(e.slot), this.area, slotVariant(e.slot))?.rows ?? null;
  }

  // Battle Mode: the remote players a melee strike reaches (combat/pvp.ts pvpInReach, the
  // enemies' cone and range), nearest first with their squared distance. None outside the battle
  // phase (no friendly fire in the field), and not a dead remote (its death marker is up).
  private pvpTargetsInReach(attackType: AttackType, from: { x: number; y: number; z: number }): Array<{ id: number; d: number }> {
    const me = this.game.self;
    const view = this.view;
    if (!this.battlePvp || !me || !view) return [];
    const range = this.weaponRange(attackType);
    const maxDist = range.horizontal + range.vertical;
    const halfAngle = range.horizontalHalfAngle * BAMS_TO_RAD;
    const out: Array<{ id: number; d: number }> = [];
    for (const [id, p] of view.playerPositions()) {
      if (id === this.game.selfId || !this.game.players.has(id) || this.souls.has(id)) continue;
      if (!pvpInReach(from, p, me.angle, halfAngle, maxDist)) continue;
      out.push({ id, d: (p.x - from.x) ** 2 + (p.y - from.y) ** 2 + (p.z - from.z) ** 2 });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  // The strike's targets: the enemies in reach and the remote players of pvpTargetsInReach,
  // nearest first, cut to `cap` (the weapon's target count).
  private pickStrikeTargets(enemies: EnemyRuntime[], from: { x: number; y: number; z: number }, attackType: AttackType, cap: number): StrikeTarget[] {
    const players = this.pvpTargetsInReach(attackType, from);
    return nearestTargets<StrikeTarget>(
      [
        ...enemies.map((e) => ({ d: e.instance.root.position.distanceToSquared(from), value: { enemy: e, player: -1 } })),
        ...players.map((p) => ({ d: p.d, value: { enemy: null, player: p.id } })),
      ],
      cap,
    );
  }

  // One strike: targets in reach, hit roll, damage, and the 6x commands.
  private resolveHit(attackType: AttackType, step: number): void {
    const me = this.game.self;
    const view = this.view;
    if (!me || !view) return;
    const from = view.playerPositions().get(me.clientId);
    if (!from) return;
    const range = this.weaponRange(attackType);
    const cap = Math.max(1, range.maxTargets);
    const enemies = this.weaponTargets(attackType, from);
    // A gun (GUN_KINDS, firesGunBullet) fires bullets (combat/gunbullet.ts): the shot now, the
    // damage at the bullet's arrival (tickGunBullets). The 6x46 goes with the listed targets.
    const weapon = attackType !== 2 ? this.equippedWeapon() : undefined;
    const kind = weapon?.data1[1] ?? -1;
    const variant = weapon?.data1[2] ?? -1;
    // Battle Mode: the remote players in reach are targets too (pickStrikeTargets). The nearest
    // `cap` of both kinds go in the 6x46 (player entity ids are client ids); the victim
    // rolls a player's hit on its own copy (onRemoteStrikeTargets), so only the enemies are hit here.
    const picked = this.pickStrikeTargets(enemies, from, attackType, cap);
    // The 6x46 goes out on every strike, zero targets included: the exe's
    // send_0x60_0x46_attack_end (0x00699248) gates on the weapon's targeting entry (reticle type 2),
    // not on the target count. A strike that hits nothing sends the 8-byte {count 0} body, which
    // is how a remote player's Mechgun spin is driven.
    this.game.sendAttackTargets(picked.map(strikeEntityId));
    if (firesGunBullet(kind, variant)) {
      this.gunShot(attackType, step, from, picked, range, kind, variant);
      return;
    }
    const hit = picked.flatMap((t) => (t.enemy ? [t.enemy] : []));
    if (!hit.length) return;
    const attacker = this.attackerStats();
    this.strike = { attackType, step };
    for (const e of hit) {
      if (attackType === 2) {
        // The special's hits take the split in applyEnemyHit (0x00597914, the combo step).
        this.specialHit(e, attacker, step);
        continue;
      }
      let damage = 0;
      let critical = false;
      let miss = true;
      const defender = this.enemyDefenderOf(e);
      if (rollHit(attacker, defender, attackType, step, this.rng)) {
        const r = rollDamage(attacker, defender, attackType, this.rng);
        damage = r.damage;
        critical = r.critical;
        miss = false;
      }
      this.applyEnemyHit(e, ENEMY_BASE_FLAGS, damage, critical, '', true, { miss });
      if (damage >= 1) this.gainPb(damage, false);
    }
    this.strike = null;
  }

  // A gun's shot at its hit frame: begin_gun_bullet_attack once per pellet (PsoBB.exe
  // 0x005e6578; unk_shoot_shotgun 0x005fe004 for the Shot's five). The pellet's shot
  // callback (the item's +0x238, shotVisualOf) makes the visual: the default 0x005e4678 a
  // muzzle particle 9 at the hand and the gun_bullet.xj trail; the egg callback 0x005e4264
  // the egg effect object (ShotEffect) with particle 0x9f on it, and no muzzle or model.
  // Either way, a pellet with a listed target that no wall stops makes a bullet that lands
  // after its frame count (the damage is unchanged). A pellet without a target goes ahead at its angle.
  private gunShot(attackType: AttackType, step: number, from: { x: number; y: number; z: number }, hit: StrikeTarget[], range: WeaponRange, kind: number, variant: number): void {
    const me = this.game.self;
    if (!me) return;
    // Each Mechgun burst turns the held barrel by 0x2000 (do_mechguns_attack; render/weaponspin.ts).
    if (kind === MECHGUN_KIND) this.view?.addWeaponSpinBurst(me.clientId);
    const visual = shotVisualOf(kind, variant);
    const trails = visual === 'default' ? (this.tracers ??= this.newTracers()) : null;
    // ASSUMED: the shooter bytes +0xf3 / +0xf4 (bulletTextureIndex) are not mapped to the
    // port's player state yet, so the bullets use variant 0 (both bytes read as 0).
    const texture = bulletTextureIndex(0, 0);
    // The bullet starts at the attach node's world point (PerformItemAttack 0x005e8a45 ->
    // get_weapon_position: a node of the weapon's walk, or a body node for -1 / -2), the feet +
    // WEAPON_HEIGHT without a skeleton (ASSUMED). The exe's line test uses the player's
    // weapon_position x / z (+0x300 / +0x308), not the start's; the start's x / z are taken from
    // the node here (ASSUMED).
    const origin = this.opts.weaponOrigin ?? this.weaponOriginOfSelf(me.clientId);
    const attach = this.weaponAttach();
    const start = gunBulletStart(attach, from, origin, { x: 0, y: 0, z: 0 });
    // The Mechgun's second call starts at +0x24c, the same walk pushed from body node 0x23 (UpdateWeaponPosition_005e74ec).
    const secondStart = kind === MECHGUN_KIND ? gunBulletStart(attach, from, origin, { x: 0, y: 0, z: 0 }, SECOND_START_BODY_NODE) : start;
    // The Rifle's hook muzzle (ExecutePartisanWeaponAttack 0x005fb310) comes before the shot, at
    // get_weapon_position(item, 1). For group_idx 8..11 and 13 it is the only muzzle of the shot.
    if (rifleHookMuzzle(kind, variant)) {
      const muzzle = gunBulletStart(RIFLE_HOOK_MUZZLE_ATTACH, from, origin, { x: 0, y: 0, z: 0 });
      this.particle({ id: MUZZLE_PARTICLE }, new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z));
    }
    let madeBullet = false;
    for (let i = 0; i < pelletCount(kind); i++) {
      const at = i === 1 && kind === MECHGUN_KIND ? secondStart : start;
      const t = hit[pelletTargetIndex(kind, i)];
      let target: { centre: { x: number; y: number; z: number }; radius: number } | null = null;
      if (t?.enemy) {
        const p = t.enemy.instance.root.position;
        target = { centre: { x: p.x, y: p.y + this.aimHeightOf(t.enemy), z: p.z }, radius: this.hitRadiusOf(t.enemy) };
      } else if (t) {
        // A remote player: its hit box centre, which is the feet at rest (the player's
        // embedded box has position1 = 0, combat/playerfx.ts HIT_POINT_DY). Radius 0 as before (combat/pvp.ts).
        const p = this.view?.playerPositions().get(t.player);
        if (p) target = { centre: { x: p.x, y: p.y, z: p.z }, radius: 0 };
      }
      const shot: GunShot = planGunShot(
        at,
        { heading: me.angle, angleBams: pelletAngleBams(kind, i), horizontalDistance: range.horizontal },
        target,
        (a, b) => (this.opts.wallBlocks ? this.opts.wallBlocks(a, b) : false),
        bulletSpeed(kind, variant),
        pelletAllowed(kind, i, madeBullet),
      );
      if (shot.bullet) madeBullet = true;
      if (visual === 'none') {
        // No callback (0x238 = 0): no trail. A muzzle comes from the item's hook: the Rifle's is at
        // node 1 (above), so only the other hooks (ASSUMED for 0x65) get one here, once per trigger.
        if (i === 0 && !rifleHookMuzzle(kind, variant)) this.particle({ id: MUZZLE_PARTICLE }, new THREE.Vector3(start.x, start.y, start.z));
      } else if (trails) {
        this.particle({ id: MUZZLE_PARTICLE }, new THREE.Vector3(at.x, at.y, at.z));
        trails.spawn(at, shot.end, shot.frames, texture);
      } else {
        this.eggShot(at, shot);
      }
      if (shot.bullet && t && target) this.gunBullets.push({ entity: t.enemy, player: t.enemy ? -1 : t.player, start: at, origCentre: target.centre, ticks: shot.frames, attackType, step });
    }
  }

  // create_particle_effect 0x005e4264 -> 0x005e407c: the egg object at the hand, flying to the
  // callback's point (ShotEffect), and its particle 0x9f emitting from it while it lives
  // (track: the emitter follows the object; the particles stay where they were made).
  private eggShot(start: { x: number; y: number; z: number }, shot: GunShot): void {
    const effect = ShotEffect.make(start, shot.dir, shot.flight);
    if (!effect) return;
    this.shotEffects.push(effect);
    const at = () => new THREE.Vector3(effect.pos.x, effect.pos.y, effect.pos.z);
    void this.fx?.spawn({ id: EGG_PARTICLE, duration: Infinity }, at, false, true, () => effect.alive);
  }

  // The bullet tracers of this view: gun_bullet.xj is loaded from item.bml once they are created.
  private newTracers(): GunTracers {
    const tracers = new GunTracers(this.viewer.scene);
    void loadGunBulletModels(this.files, this.opts.log).then((models) => tracers.setModels(models));
    return tracers;
  }

  // The trails and the bullets, once per game tick. A bullet lands when its frames run out.
  private tickGunBullets(): void {
    this.tracers?.tick();
    // The egg objects: the shooter's presence is their owner check (0x005c57ac).
    const owner = this.game.self != null;
    for (const effect of this.shotEffects) effect.tick(owner);
    this.shotEffects = this.shotEffects.filter((effect) => effect.alive);
    for (let i = this.gunBullets.length - 1; i >= 0; i--) {
      const b = this.gunBullets[i];
      if (--b.ticks > 0) continue;
      this.gunBullets.splice(i, 1);
      this.landGunBullet(b);
    }
  }

  // gun_bullet_collision_check (PsoBB.exe 0x005c7120): a target that is gone takes
  // nothing; one that moved 8 or more in XZ since the shot is missed (the miss text
  // only when it moved towards the shooter); otherwise the weapon's hit roll and damage.
  private landGunBullet(b: GunBulletRun): void {
    const e = b.entity;
    if (!e) {
      // A remote player (Battle mode): the victim rolls the hit on its own copy from the 6x46 sent at the shot.
      this.opts.log(`gun bullet reaches player ${b.player + 1}: its victim rolls the hit`);
      return;
    }
    if (this.disposed || e.dead || !struckShown(e) || concealed(e) || !splitStruckOk(e)) return;
    const p = e.instance.root.position;
    const now = { x: p.x, y: p.y + this.aimHeightOf(e), z: p.z };
    if (bulletMissed(b.origCentre, now)) {
      if (movedTowards(b.origCentre, now, b.start)) {
        const at = this.hitPoint(e);
        this.overlay?.miss(at.x, at.y, at.z);
      }
      this.opts.log(`gun bullet misses E-${e.index.toString(16)}: it moved`);
      return;
    }
    const attacker = this.attackerStats();
    this.strike = { attackType: b.attackType, step: b.step };
    const defender = this.enemyDefenderOf(e);
    let damage = 0;
    let critical = false;
    let miss = true;
    if (rollHit(attacker, defender, b.attackType, b.step, this.rng)) {
      const r = rollDamage(attacker, defender, b.attackType, this.rng);
      damage = r.damage;
      critical = r.critical;
      miss = false;
    }
    this.applyEnemyHit(e, ENEMY_BASE_FLAGS, damage, critical, '', true, { miss });
    if (damage >= 1) this.gainPb(damage, false);
    this.strike = null;
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
        this.applyEnemyHit(e, ENEMY_BASE_FLAGS, 0, false, `${name} MISS: `, true, { miss: true });
      }
      return;
    }
    // EpsigardProcessSpecialAttack_0055ab30: the open Epsilon's own element
    // special (fire / ice / thunder / instant kill) only shows the "0".
    if (e.ai instanceof EpsilonAi && !e.ai.invulnerable && e.ai.immuneToSpecial(type)) {
      const ip = e.instance.root.position;
      this.num(0, false, ip.x, ip.y + 26, ip.z);
      this.opts.log(`${name}: E-${e.index.toString(16)} (${e.slot.type}) is immune to this element`);
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
      this.applyEnemyHit(e, ENEMY_BASE_FLAGS | (type === SPECIAL.charge ? FLAG_MISSED : 0), 0, false, `${name} MISS (${out.note}) `, true, { miss: true });
      return;
    }
    // The special landed: its handler's particles (weapon_special_handlers).
    this.specialFx(e, sp.index);
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
    this.applyEnemyHit(e, flags, damage, critical, what, true, { kind: out.strikeMult !== null ? 'weapon' : specialHitFx(type) });
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
    // The blast object (PhotonBlast_Constructor_0067ec51) starts the slot state; its
    // effect ends the object, which clears the state (ASSUMED: the start is the fire).
    const self = this.game.selfId;
    // CreatePhotonBlast: another player's blast in the room blocks this one (no
    // state, no effect; the release and the gauge still go out, ASSUMED).
    // The joined players are the caster alone (ASSUMED, photonblast.ts).
    const blocked = pbBlockedBy(this.pbSlots, self);
    const participants = pbParticipants([{ slot: self, field: 0 }]);
    if (blocked) this.opts.log('photon blast: a blast is already in the room, none made');
    else this.pbSlots.start(participants);
    this.techHits.push({
      ticks: pbTechHitTicks(participants.length, true),
      apply: () => {
        this.photonBlastEffect(type, gauge, targets, !blocked);
        if (!blocked) this.pbSlots.end(self, participants);
      },
    });
    return true;
  }

  private photonBlastEffect(type: number, gauge: number, targets: EnemyRuntime[], withEffect = true): void {
    const me = this.game.self;
    const mag = this.equippedMag();
    this.game.sendPhotonBlastDone(gauge);
    if (this.pb.spend() === 'notReady') this.game.sendPhotonBlastReady(false);
    this.pb.firing = false;
    if (me) {
      this.attacking.delete(me.clientId);
      this.view?.resetGait(me.clientId);
    }
    if (!me || !mag || !withEffect) return;
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
      const heal = chopToInt(Math.max(0, s.mst) * 0.5 + power);
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
  private applyEnemyHit(e: EnemyRuntime, baseFlags: number, damage: number, critical: boolean, what: string, byPlayer = true, fx: HitVisual = {}): void {
    // The number rule of this one strike (fx.number); the flag is restored after it, so a
    // direct num() call elsewhere (the Epsilon immune "0") is not silenced by it.
    const quiet = this.hitQuiet;
    this.hitQuiet = fx.number === false;
    try {
      this.applyEnemyHitRule(e, baseFlags, damage, critical, what, byPlayer, fx);
    } finally {
      this.hitQuiet = quiet;
    }
  }

  private applyEnemyHitRule(e: EnemyRuntime, baseFlags: number, damage: number, critical: boolean, what: string, byPlayer = true, fx: HitVisual = {}): void {
    const me = this.game.self;
    if (byPlayer && damage >= 1 && !e.ai?.invulnerable) haptic('hit'); // browser vibration (input/haptics.ts)
    this.hitMissed = fx.miss === true;
    const landed = fx.landed ?? fx.miss !== true;
    // 0x200 (took_damage) needs the total at 1.0 or more (EntityHitEntity 0x007738c4): a landed
    // roll that rounds to a sub-1 total is 0x100 here, and the flinch below follows it. A technique
    // group passes its own threshold (fx.took, entity_hit_by_tech's groups).
    const took = fx.took ?? TOOK_DAMAGE_MIN;
    this.hitLanded = tookDamage(damage, landed, took);
    if (e.ai?.invulnerable) {
      // EntityHitEntity / entity_hit_by_tech: the number 0 and nothing else.
      const ip = e.instance.root.position;
      this.num(0, false, ip.x, ip.y + 26, ip.z, true);
      // Gi Gue's barrier answers a blocked hit with a bomb (combat/enemyfsmep2a.ts).
      if (e.ai instanceof GiGueAi && me && byPlayer) e.ai.blocked(me.clientId);
      // The invulnerable flag: entity_hit_by_tech / the weapon hit show the
      // "0" text and do nothing.
      this.opts.log(`${what}E-${e.index.toString(16)} (${e.slot.type}) is invulnerable`);
      return;
    }
    // The Morfos' front shield (MorfosOnHit_00579f98) is decided on the attacker's client.
    if (byPlayer && me && e.ai instanceof MorfosAi) {
      const at = this.view?.playerPositions().get(me.clientId);
      if (at && e.ai.guard(at.x, at.z)) {
        this.opts.log(`${what}E-${e.index.toString(16)} (${e.slot.type}) blocks the hit with its shield`);
        return;
      }
    }
    this.hitFx(e, damage, critical, fx);
    if (e.ai instanceof VoloptPartAi) {
      this.voloptPartHit(e, e.ai, damage, critical, baseFlags, byPlayer, what);
      return;
    }
    if (e.ai instanceof DarkFalzPartAi) {
      this.falzPartHit(e, e.ai, damage, critical, baseFlags, byPlayer, what);
      return;
    }
    if (e.ai instanceof VoloptForm2Ai) {
      // The body's one pool is its HP (row 37); the strike marks a hit box and
      // the next tick's reaction splits the damage over the marked parts.
      const ai = e.ai;
      const me = this.view?.playerPositions().get(this.game.selfId);
      ai.hit(damage, me?.x ?? ai.x, me?.z ?? ai.z, byPlayer);
      if (damage >= 1) this.voloptLastHit.set(e.index, byPlayer);
      e.stats.hp = ai.hp;
      this.sendEnemy(e, baseFlags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED) | (ai.hp <= 0 ? FLAG_DEAD : 0), Math.max(0, ai.maxHp - ai.hp));
      const p = e.instance.root.position;
      this.num(damage, critical, p.x, p.y + 26, p.z);
      this.opts.log(`${what}hit Vol Opt's body for ${Math.round(damage)}: ${ai.hp}/${ai.maxHp}, parts ${ai.partHp.join('/')}`);
      return;
    }
    if (e.ai instanceof GoldDragonAi) {
      // The Gol Dragon (combat/goldragon.ts): the same contract as the Dragon.
      const ai = e.ai;
      if (damage >= 1) {
        ai.hit(damage);
        this.golLastHit.set(e.index, byPlayer);
      }
      e.stats.hp = ai.hp;
      this.sendEnemy(e, baseFlags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED) | (ai.hp <= 0 ? FLAG_DEAD : 0), Math.max(0, ai.maxHp - ai.hp));
      const p = e.instance.root.position;
      this.num(damage, critical, p.x, p.y + 40, p.z);
      this.opts.log(`${what}hit the Gol Dragon for ${Math.round(damage)}: ${ai.hp}/${ai.maxHp}`);
      return;
    }
    if (e.ai instanceof DragonAi) {
      // The entity's own hp goes down (the clamp, the roars and the death are
      // the brain's); the 6x0A carries max - hp, unclamped, as the exe sends it
      // before its next update clamps.
      const ai = e.ai;
      if (damage >= 1) {
        ai.hit(damage);
        this.dragonLastHit.set(e.index, byPlayer);
      }
      e.stats.hp = ai.hp;
      this.sendEnemy(e, baseFlags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED) | (ai.hp <= 0 ? FLAG_DEAD : 0), Math.max(0, ai.maxHp - ai.hp));
      const p = e.instance.root.position;
      this.num(damage, critical, p.x, p.y + 40, p.z);
      this.opts.log(`${what}hit the Dragon for ${Math.round(damage)}: ${ai.hp}/${ai.maxHp}`);
      return;
    }
    if (e.ai instanceof SmChildAi) {
      this.smChildHit(e, e.ai, damage, critical, baseFlags, byPlayer, what);
      return;
    }
    if (e.ai instanceof DrlSegmentAi) {
      this.deRolLeSegmentHit(e, e.ai, damage, critical, baseFlags, what);
      return;
    }
    if (e.ai instanceof BarbaPartAi) {
      this.barbaPartHit(e, e.ai, damage, critical, baseFlags, byPlayer, what);
      return;
    }
    if (e.ai instanceof BarbaRayAi) {
      // The body's hit (combat/barbaray.ts hitRoot): the shell, then the body pool.
      // The entity is refilled to max, so its 6x0A carries this hit's damage.
      const ai = e.ai;
      ai.hitRoot(damage);
      e.stats.hp = e.stats.maxHp;
      if (damage >= 1) this.barbaLastHit.set(e.index, byPlayer);
      this.sendEnemy(e, baseFlags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED), Math.max(0, chopToInt(damage)));
      this.barbaDrain(e, ai);
      const p = e.instance.root.position;
      this.num(damage, critical, p.x, p.y + 26, p.z);
      this.opts.log(`${what}hit Barba Ray for ${Math.round(damage)}: shell ${ai.shellHp}, body ${ai.bodyHp}`);
      return;
    }
    if (e.ai instanceof DeRolLeAi) {
      // ProcessPlayerHealing_00433edc: the shell pool, then the body pool; no
      // flinch, no death here (the brain's death check runs on its own).
      // The entity's HP is refilled to max after each hit, so its 6x0A
      // (prepare_send_packet0x60_subcommand0xa: damage_taken = max - hp)
      // carries this one hit; the other clients feed it into their pools.
      const ai = e.ai;
      const pool = ai.hit(damage);
      e.stats.hp = ai.bodyHp;
      if (damage >= 1) this.drlLastHitLocal.set(e.index, byPlayer);
      this.sendEnemy(e, baseFlags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED), Math.max(0, chopToInt(damage)));
      const p = e.instance.root.position;
      this.num(damage, critical, p.x, p.y + 26, p.z);
      this.opts.log(`${what}hit De Rol Le's ${pool} for ${Math.round(damage)}: shell ${ai.shellHp}/${ai.shellMax}, body ${ai.bodyHp}/${ai.bodyMax}`);
      return;
    }
    if (e.ai instanceof SorcererBitAi) {
      this.sorcererBitHit(e, e.ai, damage, critical, baseFlags, what);
      return;
    }
    if (e.ai instanceof OlgaFlowAi) {
      // Olga Flow (combat/olgaflowai.ts): the brain owns the death. The hit takes the HP (clamped at 0)
      // and the 6x0A goes out without the dead flag; the death hold runs in the brain and the kill
      // (6x76, drop, EXP) comes at its end (tickOlga's 'killed' event).
      const ai = e.ai;
      if (damage >= 1) {
        ai.hit(damage);
        this.olgaLastHit.set(e.index, byPlayer);
      }
      e.stats.hp = ai.hp;
      this.sendEnemy(e, baseFlags | (this.hitLanded ? FLAG_HIT : FLAG_MISSED), Math.max(0, ai.maxHp - ai.hp));
      const p = e.instance.root.position;
      this.num(damage, critical, p.x, p.y + 40, p.z);
      this.opts.log(`${what}hit Olga Flow for ${Math.round(damage)}: ${ai.hp}/${ai.maxHp}`);
      return;
    }
    if (e.ai instanceof GalgryphonAi) {
      // The Gal Gryphon's brain owns its death: the hit takes the HP (clamped at 0) and the 6x0A goes out
      // without the dead flag, so no kill (6x76, drop, EXP) here. The brain's death gate (hp <= 0, the
      // leader's death script) runs the kill at its leave. ASSUMED: the exe's hit reaction does not take the
      // generic kill (its update, dump 226140, has no on-killed call; the kill is the death script's).
      const flags = (baseFlags | applyDamage(e.stats, damage, landed)) & ~FLAG_DEAD;
      if (damage >= 1) this.galgryphonLastHit.set(e.index, byPlayer);
      this.sendEnemy(e, flags);
      const p = e.instance.root.position;
      this.num(damage, critical, p.x, p.y + 26, p.z);
      this.opts.log(`${what}hit the Gal Gryphon for ${Math.round(damage)}: ${e.stats.hp}/${e.stats.maxHp}`);
      return;
    }
    let flags = baseFlags | applyDamage(e.stats, damage, landed, took);
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
    this.num(damage, critical, p.x, p.y + 26, p.z);
    // The enemy turns on its attacker (unknown_enemy_behavior_4).
    // 0x00597914 (the took-damage handler): the combo step 2 of the attacker (this.strike) splits a
    // Pofuilly Slime that is not flinching; the split is made after its flinch (the order is free: the copy
    // takes the body's spot, not the hit).
    const slimeSplit = e.ai instanceof SlimeAi && slimeSplitsOnHit(e.ai.state, this.strike?.step, damage, byPlayer, (flags & FLAG_DEAD) !== 0);
    if (damage >= 1 && me && byPlayer) e.ai?.onDamage(me.clientId);
    if (slimeSplit) void this.splitSlime(e, 'the combo step 2 hit');
    // The Pofuilly's no-damage hit: EntityHitEntity sets +0x30 0x100 and the generic
    // path (0x00543efb) calls its slot +0xfc, state 11 (SlimeAi.hitNoDamage).
    if (e.ai instanceof SlimeAi && byPlayer && !landed) {
      const motion = e.ai.hitNoDamage();
      if (motion) this.playEnemyMotion(e, motion);
    }
    // 0x0054615c: a hit on the Death Gunner while it shoots stuns its group.
    const groupStun = damage >= 1 && e.ai instanceof GunnerAi && e.ai.superArmor;
    if (groupStun) {
      const g = this.gunnerGroups.find((x) => x.members.includes(e));
      if (g) {
        g.control.stunGroup(g.members.filter((m) => !m.dead).map((m) => m.ai as GunnerAi));
        this.opts.log(`Death Gunner E-${e.index.toString(16)} hit while shooting: the group is stunned`);
      }
    }
    // A landed melee hit sets the Mothmant's +0x2e0 bit 2 before the kill picks its death state (0x005187a0).
    if (e.ai instanceof MothmantAi && fx.kind === 'weapon' && landed) e.ai.noteMeleeHit();
    // A locked enemy skips its damage reaction (vtable +0x88 / +0x100).
    if (flags & FLAG_DEAD) this.killEnemy(e, flags);
    else if (e.monest) {
      // A Monest's own hit reaction (MothmanProcessState_0051a8dc via vtable 0x100).
      if (damage >= 1 && !e.status.locked) {
        const motion = e.monest.hit((this.game.info?.difficulty ?? 0) === 3);
        if (motion) this.playEnemyMotion(e, motion);
      }
    } else if (e.ai instanceof MothmantAi) {
      // A Mothmant's landed hit (its vtable 0x100 = 0x00589ab0): the flinch (6),
      // from any state, unless the status lock skips the hit (EnemyUpdateLoop 0x158).
      if (damage >= 1 && !e.status.locked) e.ai.flinch();
    } else if (this.hitLanded && !groupStun && !e.status.locked && !e.ai?.superArmor && (e.ai?.flinches?.(damage, e.stats.maxHp) ?? true)) this.playDamage(e);
    this.opts.log(
      `${what}hit E-${e.index.toString(16)} (${e.slot.type}) for ${Math.round(damage)}: ${e.stats.hp}/${e.stats.maxHp} HP${flags & FLAG_DEAD ? ' (dead)' : ''}`,
    );
  }

  // The number or the "MISS" over a hit (combat/hitfx.ts). Silent for a strike with
  // HitVisual.number false, unless `always` (the invulnerable "0").
  private num(damage: number, critical: boolean, x: number, y: number, z: number, always = false): void {
    if (this.hitQuiet && !always) return;
    if (this.hitMissed) this.overlay?.miss(x, y, z);
    else this.overlay?.damage(damage, critical, x, y, z);
  }

  // The hit point on an enemy: ASSUMED its body centre, 26 above the origin
  // (the height of the damage number); the exe's hit box position is not
  // modelled.
  private hitPoint(e: EnemyRuntime): THREE.Vector3 {
    const p = e.instance.root.position;
    return new THREE.Vector3(p.x, p.y + 26, p.z);
  }

  // A particle effect of particleentry.dat at a point.
  private particle(p: ParticleSpawn, at: THREE.Vector3 | (() => THREE.Vector3 | null), follow = false): void {
    void this.fx?.spawn(p, at, follow);
  }

  // The visuals of one landed hit (EntityHitEntity / entity_hit_by_tech,
  // combat/hitfx.ts): the spark or the critical spark and the kind particle at
  // the hit point, SE 0x42 for a critical. A failed roll shows nothing but the
  // MISS number; a hit that does no damage shows only its 0.
  private hitFx(e: EnemyRuntime, damage: number, critical: boolean, fx: HitVisual): void {
    if (fx.miss || !(damage > 0)) return;
    const kind = fx.kind ?? 'weapon';
    const crit = critical && kind === 'weapon';
    const at = this.hitPoint(e);
    for (const p of hitParticles(kind, crit, e.status.attribute)) this.particle(p, at);
    if (crit) {
      this.playSe(CRITICAL_SE);
      void this.fx?.models.flash(at);
    }
  }

  // The special's own particles when it lands (weapon_special_handlers).
  private specialFx(e: EnemyRuntime, special: number): void {
    const hit = this.hitPoint(e);
    const me = this.game.self;
    const own = me ? this.view?.playerPositions().get(me.clientId) : null;
    for (const p of specialHandlerParticles(special)) {
      // The attacker's weapon position (player +0x300) is its feet plus half the bloodstain
      // offset, zero (combat/weaponorigin.ts weaponPositionY, exe 0077a1f4).
      const at = p.at === 'player' && own ? new THREE.Vector3(own.x, weaponPositionY(own.y), own.z) : hit;
      this.particle(p, at);
    }
    // Burning, Shock / Thunder and Storm / Tempest: the objects of combat/techlightning.ts.
    const at: TechVec3 = { x: hit.x, y: hit.y, z: hit.z };
    if (special === SPECIAL_ID.burning) this.techfx?.burning(at);
    else if (special === SPECIAL_ID.shock || special === SPECIAL_ID.thunder) this.techfx?.shock(at, () => this.rng());
    else if (special === SPECIAL_ID.storm || special === SPECIAL_ID.tempest) this.techfx?.storm(at, () => this.rng());
    // Flame: two spiralling emitters (combat/hitfx.ts flamePoint).
    if (special === 25) {
      const yaw = e.instance.root.rotation.y;
      for (const side of [0, 1] as const) {
        let k = 0;
        void this.fx?.spawn(
          { id: FLAME_PARTICLE, delay: 0, duration: FLAME_FRAMES },
          () => {
            const q = flamePoint(hit, yaw, side, k++);
            return new THREE.Vector3(q.x, q.y, q.z);
          },
          false,
          true,
        );
      }
    }
  }

  private statusKind(type: StatusType): EnemyStatusKind | null {
    return type === STATUS.freeze ? 'freeze' : type === STATUS.shock ? 'shock' : type === STATUS.paralysis ? 'paralysis' : type === STATUS.confusion ? 'confusion' : null;
  }

  // What a status shows and sounds on an enemy (combat/hitfx.ts statusApplyFx /
  // statusTickFx): the particles follow the enemy from its lock-on cursor
  // position (y + 22, like the reticle); the sounds are SEs 0xd..0x11.
  private statusFx(e: EnemyRuntime, type: StatusType, tick: boolean): void {
    const kind = this.statusKind(type);
    if (!kind) return;
    const f = tick ? statusTickFx(kind) : statusApplyFx(kind);
    const lockon = (): THREE.Vector3 | null => {
      if (e.dead) return null;
      const p = e.instance.root.position;
      return new THREE.Vector3(p.x, p.y + 22, p.z);
    };
    // The freeze's ice object particle (0x12e) is made once at the hit; the
    // others follow the entity (flag 0x10).
    if (f.particle) this.particle(f.particle, lockon() ?? this.hitPoint(e), kind !== 'freeze');
    if (f.se !== null) this.playSeAt(f.se, e.instance.root.position);
    // The freeze's ice block (combat/hitmodels.ts IceBlock): around the hit box,
    // it ends with the freeze (the entity's flag 0x20) or with the enemy.
    if (kind === 'freeze' && !tick) {
      const sub = Math.max(0, Math.trunc((e.slot.set as EnemySet).params[5]));
      const radius = collisionRadius(e.instance.spec.name, sub, this.ultimate);
      this.fx?.ice({
        center: () => (this.enemies.get(e.index) === e ? this.hitPoint(e) : null),
        frozen: () => !e.dead && e.status.has(STATUS.freeze),
        radius: iceRadius(radius),
      });
    }
  }

  // The steps of a dying enemy's plan (combat/deathfx.ts), once per game
  // frame: its sounds and particles at their points, the dissolve of the dark
  // enemies (a per-material alpha, combat/hitmodels.ts Dissolve). True when the
  // enemy ends now.
  private deathSteps(e: EnemyRuntime, dt: number, ended: boolean): boolean {
    const d = e.death!;
    d.acc += dt * GAME_TICKS_PER_SECOND;
    let frames = Math.min(5, Math.floor(d.acc));
    d.acc -= Math.floor(d.acc);
    const anim = e.instance.animators[0];
    while (frames-- > 0) {
      // The slime's fade starts on the frame after its kill (0x00597594 runs in the death state).
      const fading = d.fade;
      // A Mothmant's own death state moves the body (the fall) and reports its landing and its end.
      const mf = e.ai instanceof MothmantAi ? e.ai.deathTick(ended) : null;
      if (mf) {
        const p = e.instance.root.position;
        p.x += mf.dx;
        p.y += mf.dy;
        p.z += mf.dz;
      }
      const ends = this.applyDeath(e, d.run.tick(anim?.frame ?? 0, ended, false, mf?.landed ?? false));
      // A wolf's motion turns and slides after the frame's steps (the exe's phase 0 block).
      if (d.savage) {
        const m = d.savage.tick(ended);
        e.instance.root.position.x += m.dx;
        e.instance.root.position.z += m.dz;
        e.instance.root.rotation.y = m.yaw;
      }
      if (ends) return true;
      if (mf?.dead) return true;
      if (fading && e.ai instanceof SlimeAi && e.ai.stepDeathFade()) return true;
      if (d.dissolve) {
        const f = d.dissolve.tick();
        setModelOpacity(e.instance.root, f.opacity);
        if (f.done) {
          // The steps that wait for the dissolve (the purple pool), then it is gone.
          this.applyDeath(e, d.run.tick(anim?.frame ?? 0, ended, true));
          return true;
        }
      }
    }
    return false;
  }

  // One frame's actions of a death plan: sounds, particles, pools, fragments,
  // the dissolve and the sink. True when the enemy ends now.
  private applyDeath(e: EnemyRuntime, act: DeathActions): boolean {
    const d = e.death!;
    const p = e.instance.root.position;
    for (const se of act.se) this.playSeAt(se, p);
    for (const s of act.spawn) this.particle(s.p, this.deathPoint(e, s.at));
    for (const q of act.pools) void this.fx?.decals.add(q.pool, q.delay, this.deathPoint(e, q.at));
    for (const table of act.fragments) {
      const part = e.instance.parts[0];
      if (this.fx && part?.model !== undefined) this.fx.fragments.spawn(e.instance.archive, part.model, table, this.deathPoint(e, { base: 'body' }), e.instance.root.rotation.y, () => this.rng());
    }
    if (act.dissolve) d.dissolve = new Dissolve();
    if (act.fade) d.fade = true;
    if (act.sink) p.y -= act.sink;
    return act.remove;
  }

  // A death plan's point: the origin or the body point (26 up, ASSUMED), pushed
  // along the heading (the exe turns its offset by the enemy's yaw: forward
  // along it, side across it, the blood stain's distance from the stats row, a
  // random spot on a ring).
  private deathPoint(e: EnemyRuntime, pt: DeathPoint): THREE.Vector3 {
    const o = e.instance.root.position;
    const yaw = e.instance.root.rotation.y;
    let f = pt.forward ?? 0;
    if (pt.bloodForward !== undefined) f += (e.blood ?? 0) * pt.bloodForward;
    const side = pt.killSide && e.death?.savage ? e.death.savage.side : (pt.side ?? 0);
    let x = o.x + Math.sin(yaw) * f + Math.cos(yaw) * side;
    let z = o.z + Math.cos(yaw) * f - Math.sin(yaw) * side;
    if (pt.ring) {
      const r = pt.ring[0] + this.rng() * (pt.ring[1] - pt.ring[0]);
      const a = this.rng() * Math.PI * 2;
      x += Math.sin(a) * r;
      z += Math.cos(a) * r;
    }
    return new THREE.Vector3(x, o.y + (pt.base === 'body' ? 26 : 0) + (pt.up ?? 0), z);
  }

  private dropDead(index: number, e: EnemyRuntime): void {
    this.layer.remove(e.instance);
    this.enemies.delete(index);
    if (this.lockOn === e) this.lockOn = null;
  }

  // A dead Gibbles' sink (GibblesAi.tickDead), one game tick at a time: the
  // model follows the brain's lift below the floor, and it goes at the end.
  private tickGibblesSink(e: EnemyRuntime, ai: GibblesAi): void {
    ai.tickDead(e.instance.animators.every((a) => a.ended));
    const root = e.instance.root;
    const lift = ai.lift;
    if (lift !== e.lift) {
      const y = this.opts.ground?.(root.position.x, root.position.z, root.position.y - e.lift + 30) ?? null;
      root.position.y = (y ?? root.position.y - e.lift) + lift;
      e.lift = lift;
    }
    if (ai.removed) this.dropDead(e.index, e);
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
  // The hubs refuse a cast too (0x0069a128: is_player_in_unsafe_map).
  castTechnique(tech: number): boolean {
    const me = this.game.self;
    const view = this.view;
    const name = TECH_NAMES[tech] ?? `technique ${tech}`;
    if (!me || !view || tech < 0 || tech > 18) return false;
    if (this.cast || this.attack?.active || this.damage.busy || this.damage.dead || this.status.immobile) return false;
    if (!inUnsafeMap(this.area)) return false;
    const level = this.techLevel(tech);
    if (level === null) {
      this.opts.log(`${name}: not learned`);
      return false;
    }
    if (tech === TECH.reverser && this.game.info?.challenge) {
      // CanPlayerCastTechnique_0069a0c4: return1_if_challenge_quest() refuses
      // Reverser (technique 0x11) in a Challenge game.
      this.opts.log(`${name}: not allowed in Challenge Mode`);
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
      const dead = this.reverserTarget(data.rangeH);
      sent = dead === null ? [] : [{ entityId: dead }];
    } else if (tech === TECH.resta || tech === TECH.anti || tech === TECH.shifta || tech === TECH.deband) {
      sent = this.playerTargets(data).map((id) => ({ entityId: id }));
    } else if (kind === 'one') sent = targets.slice(0, 1).map((e) => ({ entityId: 0x1000 | e.index }));
    else if (kind === 'list') sent = targets.map((e) => ({ entityId: 0x1000 | e.index }));
    this.game.sendCastTechnique(tech, level, sent);
    // The charge sound (InstantiateTechniqueEffect_006e104c: TechniqueSoundEffect,
    // SE 0xa3 for the Foie family, 0xa4 for the Barta family; ASSUMED once, local).
    if (isFireTech(tech)) this.playSe(tech <= TECH.rafoie ? FIRE_SE.chargeFoie : FIRE_SE.chargeBarta);
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
    // InstantiateTechniqueEffect_006e104c: the charge sound object (local player
    // only) plays for charge + 0x32 + cast frames (combat/techlightning.ts).
    const chargeSe = CHARGE_SE[tech];
    if (chargeSe !== undefined) {
      this.playSe(chargeSe);
      this.chargeSe = { id: chargeSe, ticks: data.charge + CHARGE_SE_PADDING + data.cast };
    }
    // The cast light on the caster (the same call, ASSUMED for the local player only).
    this.levelUpFx?.castLight(me.clientId, castLightColor(tech), castLightFrames(data.charge, data.cast), CAST_LIGHT_AMBIENT);
    return true;
  }

  // The map's wall ray for the NPC follower's head (SinowberillHead_CheckWall_007b18e0 with the given mask;
  // 0x2100 for the move target): the hit point and its surface normal, or null when the ray is clear or no map
  // collision is loaded. The normal is ASSUMED up when the map gives none.
  npcWallHit(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, mask: number): { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | null {
    const hit = this.opts.wallHit?.(from, to, mask);
    if (!hit) return null;
    return { point: { x: hit.x, y: hit.y, z: hit.z }, normal: hit.normal ?? { x: 0, y: 1, z: 0 } };
  }

  // The live enemies as the NPC attack AI reads them (quest/npcai.ts pickAttackTarget):
  // entity id (0x1000 | index), the xz of the hit point, and one entry per collision box
  // (xz of the box centre, targetable = flag 0x8000, formats/enemyboxes.ts boxTargetable).
  npcEnemies(): Array<{ id: number; x: number; z: number; boxes: EnemyBoxHit[] }> {
    const out: Array<{ id: number; x: number; z: number; boxes: EnemyBoxHit[] }> = [];
    for (const e of this.enemies.values()) {
      if (e.dead || !struckShown(e) || concealed(e) || !splitStruckOk(e)) continue;
      const p = this.hitPoint(e);
      out.push({ id: 0x1000 | e.index, x: p.x, z: p.z, boxes: this.enemyBoxHits(e) });
    }
    return out;
  }

  // The boxes of an enemy in the xz plane: origin + RotY * position1 (the exe's position2,
  // check_enemy_is_targetable). An enemy with no known box table is one targetable box at its
  // origin (ASSUMED, the port's former rule).
  private enemyBoxHits(e: EnemyRuntime): EnemyBoxHit[] {
    const root = e.instance.root;
    const { x, z } = root.position;
    const rows = this.voloptMonitorRows(e) ?? enemyBoxTable(slotSetType(e.slot), this.area, slotVariant(e.slot))?.rows ?? null;
    if (!rows) return [{ x, z, targetable: true }];
    const c = Math.cos(root.rotation.y);
    const s = Math.sin(root.rotation.y);
    return rows.map((r) => {
      const [ox, , oz] = r.offset;
      return { x: x + ox * c + oz * s, z: z - ox * s + oz * c, targetable: boxTargetable(r) };
    });
  }

  // The local player's HP and TP for the NPC head's status flags (quest/npcai.ts headStatusFlags;
  // the owner's record A). ASSUMED: the state word 0x30 is not read (0).
  npcOwnerStatus(): PlayerRatioStatus {
    return { hp: this.damage.hp, hpMax: this.damage.maxHp, tp: this.tp, tpMax: this.progression?.maxTp ?? 0, stateFlags30: 0 };
  }

  // The local player's dead flag (the owner's character flag 0x800 of SinowberillChallengePlayer_Update_007aefd4's
  // outer test, .c:794719). The head does nothing while its owner is dead.
  npcOwnerDead(): boolean {
    return this.damage.dead;
  }

  // An NPC player's technique (quest/npcai.ts npcAttackCast): the owner's client sends the
  // 6x47 / 6x48 under the NPC's client id and runs the caster's release on this client.
  // The effect is the target's own client's (combat/techniques.ts remote rules): Resta heals
  // and Anti cures the owner here (the owner is the target of 0xf / 0x10), Reverser's effect
  // on a non-player target is not ported. Returns the cast's ticks, or null when it did not go out.
  // ASSUMED: the NPC's level is 0, its MST is the owner's, its eligibility and TP are not checked,
  // and the release is at once (the exe waits for the motion's release frame).
  npcCastTechnique(npc: { clientId: number; charClass: number }, tech: number, targetIds: readonly number[]): number | null {
    const view = this.view;
    const me = this.game.self;
    if (!view || !me || tech < 0 || tech > 18 || !view.playerAnimator(npc.clientId)) return null;
    const name = `NPC ${npc.clientId}'s ${TECH_NAMES[tech] ?? `technique ${tech}`}`;
    const level = 0;
    const data = techData(tech, level, npc.charClass);
    this.game.sendNpcCastTechnique(npc.clientId, tech, level, targetIds.map((id) => ({ entityId: id })));
    this.remoteCast(npc.clientId, tech);
    this.game.sendNpcCastTechniqueComplete(npc.clientId, tech, level);
    const selfTarget = targetIds.includes(me.clientId);
    if (tech === TECH.resta && selfTarget && !this.damage.dead) {
      const heal = restaHeal(level, this.selfStats().mst, npc.charClass);
      this.damage.hp = Math.min(this.damage.maxHp, this.damage.hp + heal);
      this.opts.log(`${name}: +${heal} HP to you (${this.damage.hp})`);
    } else if (tech === TECH.anti && selfTarget) {
      this.applyAnti(level, name);
    } else if (tech === TECH.reverser) {
      this.opts.log(`${name}: no effect on this client (not ported)`);
    }
    if (isFireTech(tech)) {
      // The head's state-2 cast (SinowberillHead_CastTechnique_007b2e20 -> HandlePlayerTechCastState_007b2bc0):
      // the Foie family is a flying object made at the NPC, aimed at its first 6x47 target that is still
      // there at release, and its hit uses the caster's MST / class (ASSUMED: the owner's MST, the NPC's
      // own level 0). The release is the charge ticks (ASSUMED; the exe waits for the motion's release frame).
      // Another client's copy of the hit comes with its own 6x0A, so only this client's hits land here.
      const mst = this.selfStats().mst;
      const listed = targetIds.length > 0;
      this.techHits.push({
        ticks: data.charge,
        apply: () => {
          const from = view.playerPositions().get(npc.clientId);
          if (!from) return;
          const first = targetIds.map((id) => this.enemies.get(id & 0xfff)).find((e) => !!e && !e.dead && this.enemies.has(e.index));
          this.spawnFire(tech, level, from, me.angle, listed, first, null, (e) => this.techHitEnemy(tech, level, mst, npc.charClass, e));
        },
      });
    }
    return data.charge + data.cast;
  }

  private chargeSe: { id: number; ticks: number } | null = null;

  // One game tick of the local cast (ProcessHeavySpecialAttackState).
  private tickCast(): void {
    if (this.chargeSe && --this.chargeSe.ticks <= 0) {
      this.sePlayer?.stop(this.chargeSe.id);
      this.chargeSe = null;
    }
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
    if (isFireTech(tech)) return this.pickFireTargets(data, from, me.angle);
    if (techElement(tech) === null && tech !== TECH.jellen && tech !== TECH.zalure) return [];
    const half = data.angleH * BAMS_TO_RAD;
    const list: Array<{ e: EnemyRuntime; d: number }> = [];
    for (const e of this.enemies.values()) {
      if (e.dead || !e.instance.root.visible || lockConcealed(e) || !techRecordOk(e)) continue;
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

  // The targeting system's pick for a technique of the Foie / Barta families
  // (combat/techfire.ts pickTechTargets: check_enemy_is_targetable). ASSUMED: the
  // lock-on cursor is not a manually chosen primary target, the weapon position
  // is the player's weapon_position (the feet, weaponPositionY: check_enemy_is_targetable
  // measures from weapon_position, DEVLOG 2026-10-23) and an enemy's hit box is a round box of
  // its collision radius centred on its hit box (aimHeightOf).
  private pickFireTargets(data: TechniqueData, from: THREE.Vector3, heading: number): EnemyRuntime[] {
    const cands: Candidate[] = [];
    const byId = new Map<number, EnemyRuntime>();
    for (const e of this.enemies.values()) {
      if (e.dead || !e.instance.root.visible || lockConcealed(e) || !techRecordOk(e)) continue;
      const p = e.instance.root.position;
      cands.push({ id: e.index, x: p.x, y: p.y + this.aimHeightOf(e), z: p.z, radius: this.hitRadiusOf(e) });
      byId.set(e.index, e);
    }
    const out: Candidate[] = [];
    pickTechTargets(from.x, weaponPositionY(from.y), from.z, heading, data, cands, null, out);
    return out.map((c) => byId.get(c.id)!);
  }

  // The height an enemy is aimed at: the centre of its hit box (combat/techfire.ts
  // enemyAimHeight, from the type's box table; AIM_HEIGHT where it is not known).
  private aimHeightOf(e: EnemyRuntime): number {
    const rows = this.voloptMonitorRows(e);
    if (rows) return rowsAimHeight(rows);
    return enemyAimHeight(slotSetType(e.slot), this.area, slotVariant(e.slot));
  }

  // A Vol Opt monitor's own box rows (formats/enemyboxes.ts childBoxTable, the exe's
  // row for the monitor's creation index & 3; ASSUMED: the index is the loop counter).
  // Null for every other enemy.
  private voloptMonitorRows(e: EnemyRuntime): readonly CollisionBoxRow[] | null {
    if (!(e.ai instanceof VoloptPartAi) || e.ai.part.kind !== 'monitor') return null;
    return childBoxTable(VOLOPT_SET_TYPE, e.ai.part.index)?.rows ?? null;
  }

  // An enemy's round hit box (combat/enemyai.ts collisionRadius), once.
  private hitRadiusOf(e: EnemyRuntime): number {
    const monitor = this.voloptMonitorRows(e);
    if (monitor) return rowsRadius(monitor) ?? 0;
    let r = this.fireRadius.get(e);
    if (r === undefined && e.ai instanceof DrlSegmentAi) r = DRL_SEGMENT.radius;
    if (r === undefined && e.ai instanceof BarbaPartAi) r = BARBA_PART_RADIUS;
    if (e.ai instanceof SmChildAi) return e.ai.entity ? e.ai.entity.hitRadius : SM_PART_RADIUS;
    if (r === undefined) {
      const sub = Math.max(0, Math.trunc(((e.slot.set as EnemySet | undefined)?.params?.[5] as number | undefined) ?? 0));
      r = collisionRadius(e.instance.spec.name, sub, this.ultimate);
      this.fireRadius.set(e, r);
    }
    return r;
  }

  // The flying objects, once per game tick, against the enemies that are there.
  private tickFire(): void {
    if (!this.techFire.active) return;
    const pool = this.fireTargets;
    let n = 0;
    for (const e of this.enemies.values()) {
      if (e.dead || !struckShown(e) || concealed(e) || !splitStruckOk(e)) continue;
      const p = e.instance.root.position;
      const t = pool[n] ?? (pool[n] = { id: 0, x: 0, z: 0, radius: 0, y: 0 });
      t.id = e.index;
      t.x = p.x;
      t.y = p.y + this.aimHeightOf(e);
      t.z = p.z;
      t.radius = this.hitRadiusOf(e);
      n++;
    }
    this.techFire.tick(pool, n);
  }

  // unknown_cast_tech for the Foie / Barta families: the object is made at the cast
  // point `cast` (techCastPoint; null: feet + WEAPON_HEIGHT, ASSUMED, for the NPC and the
  // other players' copies), aimed at the first 6x47 target's hit box when there is one (its
  // position now), straight ahead when there is none; a listed target that is gone makes
  // nothing. Rafoie needs the target and follows it. `onHit` null: another
  // player's copy (its damage comes with their 6x0A).
  private spawnFire(tech: number, level: number, from: THREE.Vector3, heading: number, listed: boolean, first: EnemyRuntime | undefined, cast: { x: number; y: number; z: number } | null, onHit: ((e: EnemyRuntime) => void) | null): boolean {
    const name = TECH_NAMES[tech];
    // unknown_cast_tech makes no attack technique object where is_current_map_safe
    // is 0 (the cities: Pioneer 2).
    if (this.area === 0) return false;
    const aimed = tech !== TECH.gifoie && tech !== TECH.rabarta;
    if (aimed && listed && !first) {
      this.opts.log(`${name}: the target is gone`);
      return false;
    }
    const tp = aimed && first ? first.instance.root.position : null;
    const aim = tp && first ? { x: tp.x, y: tp.y + this.aimHeightOf(first), z: tp.z } : null;
    const rafoie = tech === TECH.rafoie;
    const org = cast ?? { x: from.x, y: castOriginY(tech, from.y), z: from.z };
    const obj = makeFireObject({
      tech,
      level,
      x: rafoie && aim ? aim.x : org.x,
      y: rafoie && aim ? aim.y : org.y,
      z: rafoie && aim ? aim.z : org.z,
      heading: aim && !rafoie ? Math.atan2(aim.x - org.x, aim.z - org.z) : heading,
      aim: rafoie ? null : aim,
      targetId: rafoie && first ? first.index : null,
      ground: this.opts.ground ?? null,
    });
    if (!obj) {
      this.opts.log(`${name}: no target`);
      return false;
    }
    this.techFire.start(obj, onHit ? (_o, t) => {
      const e = this.enemies.get(t.id);
      if (e && !e.dead) onHit(e);
    } : null);
    return true;
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
  private reverserTarget(rangeH: number): number | null {
    const me = this.game.self;
    const positions = this.view?.playerPositions();
    const from = me && positions?.get(me.clientId);
    if (!me || !positions || !from) return null;
    let best: number | null = null;
    let bestD = rangeH;
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

  // The Moon Atomizer's 6x33 target (items.ts use): the Reverser's pick at the
  // object's range 10 (FUN_0069a1e0 / 0x41200000; ASSUMED: the record (4,9) of
  // FUN_007a401c is this nearest-dead pick, its filler not traced).
  atomizerTarget(): number | null {
    return this.reverserTarget(ATOMIZER_RANGE);
  }

  // The Star Atomizer's 6x66 list (FUN_005de664 on record (4,10)): the caster,
  // then the three others in range (ASSUMED filler, combat/buffs.ts). Null when
  // there is no position for the caster.
  starTargets(): number[] | null {
    const positions = this.view?.playerPositions();
    if (!positions) return null;
    return nearbyAtomizerList(this.game.selfId, (id) => positions.get(id), ATOMIZER_RANGE);
  }

  // The local dispatch of a 6x33 / 6x66 this client sent (checked_call_packet0x60_subcommand
  // runs the table handler for the sender too): the same effects as a received one.
  atomizerEcho(packet: Uint8Array): void {
    this.receiveAtomizer(packet);
  }

  // Whether a client id is a player of this game (self included).
  private isPresent(id: number): boolean {
    return id === this.game.selfId ? !!this.view?.playerPositions().get(id) : this.game.players.has(id);
  }

  // 6x33 (FUN_0069a1e0): a valid sender and target make a Reverser-type object
  // (0x1d) at the sender with the target as its one target; the target that is
  // this client, while dead, is revived (the object's hit is the Reverser's revive,
  // ASSUMED). The object is drawn as the Reverser's (castObjects, draw only).
  private onRevivePlayer(sender: number, target: number): void {
    if (!this.isPresent(sender) || !this.isPresent(target)) return;
    this.castObjects(TECH.reverser, ATOMIZER_OBJECT_LEVEL, ATOMIZER_RANGE, sender, [target], false);
    if (target === this.game.selfId && this.damage.dead) this.reviveSelf(`player ${sender}'s Moon Atomizer`);
  }

  // 6x66 (FUN_005de5a4): the caster (list[0]) must be a player. Each listed player
  // that is not dead gets its HP set to its max (ClampEntityHP_00770b58 with max_hp1:
  // a full heal, not a revive: the dead are skipped). On an unsafe map the caster
  // gets 0x19 and each healed player 0xc2 (create_particle_effect at its body).
  // ASSUMED: the same-area test (+0x3f0) holds for every listed player.
  private onStarAtomizer(list: readonly number[]): void {
    const caster = list[0];
    if (caster === undefined || caster === NO_CLIENT || !this.isPresent(caster)) return;
    const unsafe = inUnsafeMap(this.area);
    list.slice(0, 4).forEach((id, i) => {
      if (id === NO_CLIENT || !this.isPresent(id) || this.isPlayerDead(id)) return;
      if (id === this.game.selfId) this.damage.hp = this.damage.maxHp;
      else this.party.refill(id);
      const p = this.view?.playerPositions().get(id);
      if (!unsafe || !p) return;
      const at = new THREE.Vector3(p.x, p.y + CAST_HEIGHT, p.z);
      if (i === 0) this.particle({ id: STAR_CASTER_PARTICLE }, at);
      this.particle({ id: STAR_TARGET_PARTICLE }, at);
    });
  }

  // The Atomizers' packets (6x33 and 6x66), from a received subcommand or the local echo.
  private receiveAtomizer(packet: Uint8Array): void {
    const revive = parseRevivePlayer(packet);
    if (revive) {
      this.onRevivePlayer(revive.clientId, revive.target);
      return;
    }
    const list = parseStarAtomizer(packet);
    if (list) this.onStarAtomizer(list);
  }

  // unknown_cast_tech through render/techlightning.ts TechObjects, for the local
  // release and for another player's 6x48 (those draw only: their damage comes
  // from their own client's 6x0A).
  private castObjects(tech: number, level: number, rangeH: number, clientId: number, ids: readonly number[], damage: boolean): void {
    const pos = this.view?.playerPositions().get(clientId);
    if (!pos || !this.techObjects) return;
    const local = clientId === this.game.selfId;
    const who = local ? this.game.self : this.game.players.get(clientId);
    this.techObjects.cast(tech, level, { id: clientId, pos: { x: pos.x, y: pos.y, z: pos.z }, angle: who?.angle ?? 0, boost: techBoost(who?.charClass ?? 0, tech), damage }, ids, rangeH);
  }

  // What the technique objects ask of the world: the live enemies as sphere
  // targets, entities by their 6x47 id (0x1000 | enemy index, else a client id),
  // and the damage of the local player's objects (techHitEnemy).
  // The Megid's map ray (cast_ray_at_map_collision_geometry, mask 0x100; no collision: no wall).
  private techWall(): WallHit {
    return (from, to) => this.opts.wallHit?.(from, to, MEGID_WALL_MASK) ?? null;
  }

  private techWorld(): TechWorld {
    const live = (e: EnemyRuntime | undefined): e is EnemyRuntime => !!e && !e.dead && struckShown(e) && !concealed(e) && splitStruckOk(e);
    const enemyOf = (id: number): EnemyRuntime | undefined => (id >= 0x1000 ? this.enemies.get(id - 0x1000) : undefined);
    return {
      rng: () => this.rng(),
      wall: this.techWall(),
      enemies: () => {
        const out = [];
        for (const e of this.enemies.values()) {
          if (!live(e)) continue;
          const p = this.hitPoint(e);
          out.push({ id: 0x1000 | e.index, x: p.x, y: p.y, z: p.z, radius: collisionRadius(e.instance.spec.name) });
        }
        return out;
      },
      origin: (id) => {
        const e = enemyOf(id);
        if (id >= 0x1000) return live(e) ? { x: e.instance.root.position.x, y: e.instance.root.position.y, z: e.instance.root.position.z } : null;
        const p = this.view?.playerPositions().get(id);
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      },
      point: (id) => {
        const e = enemyOf(id);
        if (id >= 0x1000) {
          if (!live(e)) return null;
          const p = this.hitPoint(e);
          return { x: p.x, y: p.y, z: p.z };
        }
        // A player's hit box is the embedded one (position1 0, radius 5), so its
        // point is the feet: the Gizonde's bolts and sparks use it (DEVLOG 2026-10-23).
        const p = this.view?.playerPositions().get(id);
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      },
      hit: (id, tech, level) => {
        const e = enemyOf(id);
        const me = this.game.self;
        if (!live(e) || !me) return;
        this.techHitEnemy(tech, level, this.selfStats().mst, me.charClass, e);
        // MegidEntity_ProcessHit plays SE 0xb0 itself (techlightning.ts); the others have none.
      },
    };
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
    // The objects of combat/techlightning.ts: what the exe draws, sounds and hits
    // for the Zonde family, Grants, Megid and the supports.
    if (ownsTechnique(c.tech)) this.castObjects(c.tech, c.level, c.data.rangeH, me.clientId, c.sent, true);
    if (c.tech === TECH.resta) {
      const heal = restaHeal(c.level, mst, me.charClass);
      // entity_hit_by_tech: the green HP text over every other healed player.
      for (const id of c.sent) {
        const q = id !== me.clientId ? view.playerPositions().get(id) : null;
        if (q) this.overlay?.float(restaFloat(heal), q.x, q.y + 26, q.z);
      }
      const before = this.damage.hp;
      if (!this.damage.dead) this.damage.hp = Math.min(this.damage.maxHp, this.damage.hp + heal);
      this.opts.log(`${name} Lv${c.level + 1}: +${heal} HP (${before} -> ${this.damage.hp}); other players heal on their own clients`);
      return;
    }
    if (techElement(c.tech) === null) {
      this.releaseSupport(c);
      return;
    }
    if (isFireTech(c.tech)) {
      const first = c.targets.find((e) => !e.dead && this.enemies.has(e.index));
      const listed = c.targets.length > 0;
      const cast = techCastPoint(c.tech, from, this.weaponClass(), this.weaponOriginOfSelf(me.clientId), { x: 0, y: 0, z: 0 });
      if (this.spawnFire(c.tech, c.level, from, first ? Math.atan2(first.instance.root.position.x - from.x, first.instance.root.position.z - from.z) : me.angle, listed, first, cast, (e) => this.techHitEnemy(c.tech, c.level, mst, me.charClass, e)))
        this.opts.log(`${name} Lv${c.level + 1}: the object flies${first ? ` at E-${first.index.toString(16)}` : ' straight ahead'}`);
      return;
    }
    // The Zonde family, Grants and Megid run as objects (castObjects above).
    if (ownsTechnique(c.tech)) return;
    // Who is hit: single-target techniques take the first target, Rafoie
    // explodes around it, the others reach every target in range.
    let hits = c.targets.filter((e) => !e.dead);
    if (c.data.targets <= 1) hits = hits.slice(0, 1);
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
    this.buffPlayerFx(this.game.selfId, group);
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

  // The support hook on a player object (the player vtable's +0x11c..+0x128 are the same
  // four functions as the enemy's): the same emitter as on an enemy, made before the
  // stat change, following the player (FindEntityById takes ids below 0xc as players).
  private buffPlayerFx(clientId: number, group: BuffGroup): void {
    this.particle(
      { id: SUPPORT_PARTICLE[group], orient: SUPPORT_ORIENT[group] },
      () => this.view?.playerPositions().get(clientId)?.clone() ?? null,
      true,
    );
  }

  // entity_hit_by_tech(shifta / deband) on another player (the remote copy's slot).
  private applyRemoteBuff(id: number, group: BuffGroup, power: number, what: string): void {
    this.buffPlayerFx(id, group);
    let b = this.remoteBuffs.get(id);
    if (!b) {
      b = new EntityBuffs();
      this.remoteBuffs.set(id, b);
    }
    if (b.apply(group, power)) this.opts.log(`${what}: player ${id} ${buffName(group)}`);
  }

  // entity_hit_by_tech(jellen / zalure) on an enemy; the caster's client
  // reports it with 6x0A (vtable +0x130, 0x00787578: unchanged total damage).
  private buffEnemy(e: EnemyRuntime, group: BuffGroup, power: number, what: string, own: boolean): void {
    // entity_hit_by_tech's invulnerable block (0x00773bf9) takes Jellen and Zalure too (its
    // exclusions are Resta, Anti, Reverser, Shifta, Deband and the always-zero group): the
    // "0" and nothing else, no effect and no 6x0A.
    if ((group === GROUP.jellen || group === GROUP.zalure) && e.ai?.invulnerable) {
      const p = e.instance.root.position;
      this.overlay?.damage(0, false, p.x, p.y + 26, p.z);
      this.opts.log(`${what}E-${e.index.toString(16)} (${e.slot.type}) is invulnerable`);
      return;
    }
    // The enemy's support hook (combat/buffs.ts SUPPORT_PARTICLE): made before the stat
    // change, so a refused cast shows it too; one emission at the enemy's feet that
    // follows it (create_particle_effect_3 / 13, flag 0x10).
    this.particle({ id: SUPPORT_PARTICLE[group], orient: SUPPORT_ORIENT[group] }, () => (e.dead ? null : e.instance.root.position.clone()), true);
    if (!e.buffs.apply(group, power)) return;
    const attackSlot = group === GROUP.jellen || group === GROUP.shifta;
    const slot = attackSlot ? e.buffs.attack : e.buffs.defense;
    const stat =
      attackSlot && e.attacker
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

  // The Medical Center's check (classic/shop.ts MedicalCounter).
  medicalNeeds(): number {
    return medicalNeeds({
      hp: this.damage.hp,
      maxHp: this.damage.maxHp,
      tp: this.tp,
      maxTp: this.progression?.maxTp ?? 0,
      statusFlags: this.status.flags,
      attackBuff: this.selfBuffs.attack.type,
      defenseBuff: this.selfBuffs.defense.type,
    });
  }

  // 6x31 on the local player (Player_DisableMovement_0068fd74):
  // PlayerRestoreHealthAndTP_0068fda4 (hp = max HP, tp = max TP), vtable +0xe4
  // = Enemy_ClearStatusEffectsAndForces_0077962c (both status slots and both
  // technique slots, Shifta / Deband included), then the took-damage and dead
  // flags (& 0xfffff1ff; the web client keeps no such flag word, and a dead
  // player cannot reach the counter, so the HP is left alone then). The
  // emptied status slots go out as 6x0D (sync).
  medicalTreatment(): void {
    if (!this.damage.dead) this.damage.hp = this.damage.maxHp;
    this.tp = this.progression?.maxTp ?? this.tp;
    this.status.reset();
    this.selfBuffs.clear();
    this.opts.log(`medical center: ${this.damage.hp} HP / ${this.tp} TP, status cleared`);
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
    // Epsilon's open element blocks the technique of its group (immuneToTech,
    // EpsigardProcessTechHit_0055aa5c): no damage, no status, a "0" (the exe
    // calls 0x0077535c with 0 there). Invulnerable Epsilon takes the "0" of
    // applyEnemyHit instead.
    if (e.ai instanceof EpsilonAi && !e.ai.invulnerable && e.ai.immuneToTech(techGroup(tech))) {
      const ip = e.instance.root.position;
      this.num(0, false, ip.x, ip.y + 26, ip.z);
      this.opts.log(`${name}: E-${e.index.toString(16)} (${e.slot.type}) is immune to the element`);
      return;
    }
    if (tech === TECH.megid) {
      // Instant death with chance (power - EDK) * 0.01 (no boss-map check:
      // ASSUMED the floor is not a boss map).
      const chance = megidChance(level, e.resist.edk);
      const kill = this.rng() < chance;
      // The exe shows no number for Megid (its spark only), kill or not: techHitShowsNumber.
      this.applyEnemyHit(e, ENEMY_BASE_FLAGS, kill ? e.stats.hp : 0, false, `${name} (${Math.round(chance * 100)}%) `, true, { kind: techHitFx(tech), landed: kill, number: techHitShowsNumber(tech) });
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
    const hits = e.ai instanceof SlimeAi ? e.ai.hits : 0;
    this.applyEnemyHit(e, ENEMY_BASE_FLAGS, damage, false, `${name} (power ${Math.round(techPower(tech, level, charClass))}) `, true, {
      kind: techHitFx(tech),
      took: techTookDamageMin(tech),
      number: techHitShowsNumber(tech),
    });
    // 0x005987c8: Gibarta / Rabarta (technique group 2) split a Pofuilly Slime.
    if ((tech === TECH.gibarta || tech === TECH.rabarta) && e.ai instanceof SlimeAi && e.ai.hits > hits && !e.dead) void this.splitSlime(e, name);
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
    // The other players in the 6x47 list take Shifta / Deband the same way (the
    // level 2 gate is the local rule); their slots feed the party windows' icons.
    if ((group === GROUP.shifta || group === GROUP.deband) && level >= 2) {
      for (const id of cast.targets) {
        if (id === self || id >= 0x1000 || !this.game.players.has(id)) continue;
        this.applyRemoteBuff(id, group, supportPower(level), name);
      }
    }
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
      this.reviveSelf(name);
    }
  }

  // A Reverser or a Moon Atomizer on the local dead player: the HP / TP rule of
  // reviveRestore (PlayerResetDeadState_0068fdc8), then the revive state, which
  // sends 6x4F and closes the dead prompt (onRevived).
  private reviveSelf(from: string): void {
    const r = reviveRestore(this.damage.maxHp, this.progression?.maxTp ?? this.tp, {
      quest: this.opts.questRunning?.() ?? false,
      unsafe: inUnsafeMap(this.area),
    });
    this.damage.revive(r.hp);
    if (r.tp !== null && this.progression) this.tp = r.tp;
    this.opts.log(`${from}: revived`);
  }

  // Another player's 6x48 for the Foie / Barta families: their object runs here too
  // (action_launch_tech -> unknown_cast_tech) from their position toward the first
  // enemy of their 6x47; it hits nothing here, their client reports the damage.
  private remoteFire(clientId: number, tech: number, sentLevel: number): void {
    const cast = this.remoteCasts.get(clientId);
    const from = this.view?.playerPositions().get(clientId);
    const p = this.game.players.get(clientId);
    if (!cast || cast.tech !== tech || !from || !p) return;
    const level = remoteTechLevel(sentLevel, this.techOverride.get(clientId) ?? 0);
    const ids = cast.targets.filter((id) => id >= 0x1000).map((id) => id - 0x1000);
    const first = ids.map((id) => this.enemies.get(id)).find((e) => e && !e.dead);
    this.spawnFire(tech, level, from, p.angle, ids.length > 0, first, null, null);
  }

  // Another player's Resta: the green "HP+n" over every healed player but this
  // one. ASSUMED: the caster's MST is unknown here, so n is the level's power
  // plus MST 0 (the exe uses the caster's real value).
  // The caster's Resta on this client: the entity's hit on every 6x47 target (combat/techniques.ts
  // remoteRestaHeal). The local player takes round(caster MST * 0.5 + power) when it is listed and
  // alive; the other targets show the green "HP+n" (their own clients heal them).
  private remoteResta(clientId: number, sentLevel: number): void {
    const cast = this.remoteCasts.get(clientId);
    if (!cast || cast.tech !== TECH.resta) return;
    const level = remoteTechLevel(sentLevel, this.techOverride.get(clientId) ?? 0);
    const caster = this.game.players.get(clientId);
    const charClass = Math.max(0, caster?.charClass ?? 0);
    // ASSUMED: an unknown caster MST (no 6x70 / 6x30 yet) is 0.
    const casterMst = caster?.mst ?? 0;
    const heal = restaHeal(level, casterMst, charClass);
    for (const id of cast.targets) {
      const q = id !== this.game.selfId && id < 0x1000 ? this.view?.playerPositions().get(id) : null;
      if (q) this.overlay?.float(restaFloat(heal), q.x, q.y + 26, q.z);
    }
    const mine = remoteRestaHeal(cast.targets, this.game.selfId, this.damage.dead, level, casterMst, charClass);
    if (mine > 0) {
      const before = this.damage.hp;
      this.damage.hp = Math.min(this.damage.maxHp, this.damage.hp + mine);
      this.opts.log(`${caster?.name ?? `client ${clientId}`} casts Resta on you: +${mine} HP (${before} -> ${this.damage.hp})`);
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
    // The weapon's range carries the live set factor (EntityHitEntity_00773350 reads battleparams_attacks->atp_range_min).
    const a = playerAttacker(me.charClass, stats, weaponForCombat(w?.data1, this.pmtSync, this.liveSetContext()));
    // Shifta / Jellen move ATP (+0x2cc) and its spread (+0x2ce); the
    // equipment ATP (+0x31c) is not touched.
    return { ...a, atp: this.selfBuffs.atp(a.atp), atpSpread: this.selfBuffs.atpSpread(a.atpSpread) };
  }

  // The Dubchics the Dubwitch e links (kill_dubwitch's scan: class, param6 == 0
  // i.e. slot type DUBCHIC, and the same spawn section), still alive.
  private dubwitchDubchics(e: EnemyRuntime): EnemyRuntime[] {
    const section = (e.slot.set as EnemySet).section;
    return [...this.enemies.values()].filter(
      (d) => d !== e && !d.dead && d.ai instanceof DubchicAi && d.slot.type === 'DUBCHIC' && (d.slot.set as EnemySet).section === section,
    );
  }

  // update_dubwitch's wake (state 0): a linked Dubchic is dead or lying down.
  private dubwitchWake(e: EnemyRuntime): boolean {
    const section = (e.slot.set as EnemySet).section;
    return [...this.enemies.values()].some(
      (d) =>
        d !== e &&
        d.ai instanceof DubchicAi &&
        d.slot.type === 'DUBCHIC' &&
        (d.slot.set as EnemySet).section === section &&
        (d.dead || d.ai.lying),
    );
  }

  // A Dubwitch killed by another client (the 6x0A's dead flag): its kill runs
  // here too, so the section's Dubchics die for good without the EXP or drop
  // requests (those are the killer's).
  private dubwitchRemoteKill(e: EnemyRuntime): void {
    for (const d of this.dubwitchDubchics(e)) {
      if (!(d.ai instanceof DubchicAi)) continue;
      d.ai.markLinkedDead();
      d.dead = true;
      this.playDeath(d);
    }
  }

  // 6x0A (dead) was sent: 6x76, the drop request and the EXP request, then the
  // death motion (the enemy is removed when it ends).
  private killEnemy(e: EnemyRuntime, _flags: number): void {
    e.dead = true;
    // The Chaos Sorcerer's bits go with it (SorcererDestructor_005a4f28 marks both).
    if (e.ai instanceof SorcererAi) for (const n of [1, 2]) {
      const bit = this.enemies.get(e.index + n);
      if (bit) this.dropQuietly(bit);
    }
    // The death handler (+0x104) sends the mirage clones away first.
    if (e.ai instanceof SinowAi && !e.ai.ally) {
      e.ai.kill();
      for (const ev of e.ai.events.splice(0)) this.sinowEvent(e, e.ai, ev);
    }
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
    this.splitterDied(e, true);
    // kill_dubwitch (0x00619050): the Dubwitch's kill effects, then its
    // section's Dubchics die for good. Their own on-kill (EXP and the drop
    // request, 0x005558bc) runs here, the killer's side.
    if (e.ai instanceof DubwitchAi) {
      const at = e.instance.root.position;
      this.particle({ id: 0x45 }, new THREE.Vector3(at.x, at.y, at.z));
      this.particle({ id: 0x46 }, new THREE.Vector3(at.x, at.y, at.z));
      for (const d of this.dubwitchDubchics(e)) {
        if (!(d.ai instanceof DubchicAi)) continue;
        d.ai.markLinkedDead();
        this.killEnemy(d, ENEMY_BASE_FLAGS | FLAG_DEAD);
        this.opts.log(`E-${d.index.toString(16)} (Dubchic) dies with its Dubwitch E-${e.index.toString(16)}`);
      }
    }
    // A Hidoom / Migium (0x00587720) and a slime (0x00598648) only run
    // on_enemy_killed (0x00787534: EXP and the drop request); their set entry
    // is cleared by the Pan Arms / the slime control, not by their own 6x76.
    if (!(e.ai instanceof PanHalfAi || e.ai instanceof SlimeAi)) this.game.sendEntitySetFlags(0x1000 | e.index, this.floor, 8);
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
    const amount = killExp(e.exp, { episode2: this.game.info?.episode === 2, killer: true, multiplier: this.expMultiplier, ...(this.challengeExpMultiplier === null ? {} : { challenge: this.challengeExpMultiplier }) });
    const anchor = e.instance.root.position.clone();
    anchor.y += 22;
    this.hud?.expPopup(amount, () => anchor);
    // A Monest's body is removed by its kill state (tickMonest).
    if (e.monest) e.monest.die();
    else this.playDeath(e);
  }

  // --- level and EXP ---------------------------------------------------------

  // PlyLevelTbl, for a Challenge Mode template (quest/cmoderun.ts).
  challengeLevelTable(): Promise<LevelTable | null> {
    return this.levelTable();
  }

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
      // The counters: extension_data2 of the raw slots 8..12 (combat/materials.ts).
      materialCounts: [0, 1, 2, 3, 4].map((t) => inv[4 + (8 + t) * 0x1c + 3] ?? 0),
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
    // The material bonuses (bytes 1 / 2) and counters (raw slots 8..12) in the
    // join snapshot (6x70 reads bytes 1 / 2) and the raw save (the bytes are u8).
    const writeMaterials = (inv: Uint8Array | null | undefined) => {
      if (!inv || inv.length < 0x34c) return;
      inv[1] = p.hpMaterials & 0xff;
      inv[2] = p.tpMaterials & 0xff;
      p.materialCounts.forEach((n, t) => (inv[4 + (8 + t) * 0x1c + 3] = n));
    };
    writeMaterials(this.game.selfSnapshot.inventory);
    writeMaterials(this.opts.fullCharacter?.());
    const c = this.opts.character?.();
    if (c) {
      c.level = p.level + 1;
      c.exp = p.exp;
      Object.assign(c.stats, p.stats);
      c.hpFromMaterials = p.hpMaterials;
      c.tpFromMaterials = p.tpMaterials;
      c.materialCounts = [...p.materialCounts];
      p.materialCounts.forEach((n, t) => {
        const it = c.inventory[8 + t];
        if (it) it.extensionData2 = n;
      });
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
        // The 6x30 handler writes the battleparams MST (0x006928e4): the caster MST of its Resta.
        other.mst = c.mst;
        // The stat block takes the command's atp / evp / dfp / ata (the non-local branch of
        // UpdatePlayerStatsAndLevelMessage_006928e4); the strike and the Battle hit check read it.
        const cs = applyLevelChangeStats(other.combatStats, c);
        if (cs) other.combatStats = cs;
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
      haptic('levelup'); // browser vibration (input/haptics.ts)
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
    // 6x2F names its player by the inner client id (HandlePlayerHPModification_006933c0 reads
    // get_player_optcall(+0x0A), the dump's version; Ghidra's FUN_006933c0 reads the local player,
    // the asm at 0x006933c0 agrees with the dump). The local player's own HP takes it here.
    if (sub === 0x2f && body.length >= 0x0c) {
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      if (dv.getUint16(0x0a, true) === this.game.selfId && !this.damage.dead) {
        const hp = applyHpModification(this.damage.hp, this.damage.maxHp, dv.getUint32(4, true), dv.getInt16(8, true));
        if (hp !== null) this.damage.hp = hp;
      }
    }
    // Remote HP for the party members' windows; the handlers below still run.
    this.party.receive(sub, body);
    if (sub === 0x2c || sub === 0x2d) {
      this.onHoldPacket(sub, body);
      return;
    }
    if (sub === 0x12) {
      this.onDragonAction(body);
      return;
    }
    if (sub === 0x10 || sub === 0x11) {
      this.onEnemyTargetState(body);
      return;
    }
    if (sub === 0xa0 || sub === 0x9f) {
      this.onGalgryphonSub(sub, body);
      return;
    }
    if (sub === 0xa4) {
      this.onOlgaAction(body);
      return;
    }
    if (sub === 0xa8) {
      this.onGolAction(body);
      return;
    }
    if (sub === 0xdc) {
      this.onSaintMilionAction(body);
      return;
    }
    if (sub === 0xa9 || sub === 0xaa) {
      this.onBarbaAction(body);
      return;
    }
    if (sub === 0x13 || sub === 0x14) {
      this.onDeRolLeAction(sub, body);
      return;
    }
    if (sub === 0x19) {
      this.onDarkFalzSub(body);
      return;
    }
    if (sub === 0x15 || sub === 0x16 || sub === 0x17 || sub === 0x18 || sub === 0x84 || sub === 0x85) {
      this.onVoloptSub(sub, body);
      return;
    }
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
      const cast = this.remoteCasts.get(t.clientId);
      if (isFireTech(t.tech)) this.remoteFire(t.clientId, t.tech, t.level);
      else if (ownsTechnique(t.tech)) {
        // unknown_cast_tech on this client: the object of that technique at the caster, at the 6x47 targets.
        if (cast && cast.tech === t.tech) {
          const level = remoteTechLevel(t.level, this.techOverride.get(t.clientId) ?? 0);
          this.castObjects(t.tech, level, techData(t.tech, level, this.game.players.get(t.clientId)?.charClass ?? 0).rangeH, t.clientId, cast.targets, false);
        }
      } else if (pos) this.overlay?.techEffect(el ?? (t.tech === TECH.resta ? 'resta' : 'support'), pos.x, pos.y, pos.z, 20);
      if (t.tech === TECH.resta) this.remoteResta(t.clientId, t.level);
      if (el === null) this.remoteSupport(t.clientId, t.tech, t.level);
      return;
    }
    if (sub >= 0x43 && sub <= 0x45) {
      const a = parseAttack(body);
      if (!a || a.clientId === this.game.selfId) return;
      this.remoteStrike.set(a.clientId, { step: a.step, attackType: a.attackType });
      this.remoteAttack(a.clientId, a.step, a.angle);
      return;
    }
    if (sub === 0x46) {
      // The sender's burst on this client (burstSpinsOnReceipt): its Mechgun barrel turns, whatever the target count.
      if (burstSpinsOnReceipt(clientId, this.game.selfId, inUnsafeMap(this.area))) this.view?.addWeaponSpinBurst(clientId);
      this.onRemoteStrikeTargets(clientId, body);
    }
    if (sub === 0x0a) {
      const s = parseEnemyState(body);
      if (!s) return;
      const e = this.enemies.get(s.enemyIndex);
      if (!e) return;
      if (e.ai instanceof VoloptPartAi) {
        // The part's HP is max - damage_taken; the brain looks at it on its
        // next tick (hit reaction, death). The dead flag is ignored.
        if (s.flags & FLAG_HIT && s.totalDamage > 0) e.ai.owner.damageTaken(e.ai.part.entity, s.totalDamage);
        e.stats.hp = e.ai.part.hp;
        return;
      }
      if (e.ai instanceof DarkFalzPartAi) {
        // The part's HP is max - damage_taken; the brain looks at it on its next
        // tick (the die hook). The dead flag is ignored: the brain owns the death.
        const part = e.ai.part;
        if (part && s.flags & FLAG_HIT && s.totalDamage > 0) {
          e.ai.owner.damageTaken(e.ai.entity, s.totalDamage);
          this.falzLastHit.set(this.falzHead?.index ?? e.index, false);
          this.falzLastHit.set(e.index, false);
          e.stats.hp = part.hp;
        }
        return;
      }
      if (e.ai instanceof VoloptForm2Ai) {
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          e.ai.setDamageTaken(s.totalDamage);
          this.voloptLastHit.set(e.index, false);
          e.stats.hp = e.ai.hp;
          this.opts.log(`Vol Opt's body hit (6x0A from another client): ${e.ai.hp}/${e.ai.maxHp}`);
        }
        return;
      }
      if (e.ai instanceof VoloptAi) return;
      if (e.ai instanceof OlgaFlowAi) {
        // restore_enemy_status (6x0A from another client): the total damage sets the HP; a body at 0 starts its
        // death hold in the brain (hit(0)), as the hit path does.
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          e.ai.setHp(e.ai.maxHp - s.totalDamage, e.ai.maxHp);
          e.ai.hit(0);
          e.stats.hp = e.ai.hp;
        }
        return;
      }
      if (e.ai instanceof GoldDragonAi) {
        // restore_enemy_status (6x0A from another client), as the Dragon's.
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          e.ai.setDamageTaken(s.totalDamage);
          e.stats.hp = e.ai.hp;
          this.golLastHit.set(e.index, false);
          this.opts.log(`the Gol Dragon was hit (6x0A from another client): ${e.ai.hp}/${e.ai.maxHp}`);
        }
        return;
      }
      if (e.ai instanceof DragonAi) {
        // restore_enemy_status: hp = max - damage_taken, and the hit flag makes
        // the clamp run on this client too. The dead flag is ignored: the brain
        // owns its death (state 0x15).
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          e.ai.setDamageTaken(s.totalDamage);
          e.stats.hp = e.ai.hp;
          this.dragonLastHit.set(e.index, false);
          this.opts.log(`the Dragon was hit (6x0A from another client): ${e.ai.hp}/${e.ai.maxHp}`);
        }
        return;
      }
      if (e.ai instanceof SmChildAi) {
        // restore_enemy_status: hp = max - damage_taken, and the hit flag; the
        // dead flag is ignored (the body's brain owns the deaths).
        if (s.flags & FLAG_HIT && s.totalDamage > 0) {
          const c = e.ai;
          if (c.part) c.owner.setPartDamageTaken(c.index, s.totalDamage);
          else c.entity?.setDamageTaken(s.totalDamage);
          if (c.part) this.smLastHit.set(c.index, false);
          this.opts.log(`Saint-Milion's ${c.part ? 'part ' + c.index : 'tentacle ' + (c.index - SM_PART_COUNT)} was hit (6x0A from another client)`);
        }
        return;
      }
      if (e.ai instanceof DrlSegmentAi) {
        // restore_enemy_status and the hit flag run the segment's +0x100
        // (0x004354c4) on this client too: the same pools as the striker's.
        if (s.flags & FLAG_HIT && s.totalDamage > 0) {
          const went = e.ai.owner.hitSegment(e.ai.index, s.totalDamage);
          if (e.parent) e.parent.stats.hp = e.ai.owner.bodyHp;
          this.opts.log(`De Rol Le's segment ${e.ai.index} hit for ${s.totalDamage} (${went}, 6x0A from another client): segment ${e.ai.segment.pool}, body ${e.ai.owner.bodyHp}`);
        }
        return;
      }
      if (e.ai instanceof BarbaPartAi) {
        // The same part pool as the striker's (restore_enemy_status and the hit flag).
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          const went = e.ai.hit(s.totalDamage);
          e.stats.hp = BARBA_HP;
          if (e.parent) this.barbaDrain(e.parent, e.ai.owner);
          this.opts.log(`Barba Ray's part ${e.ai.index} hit for ${s.totalDamage} (${went}, 6x0A from another client)`);
        }
        return;
      }
      if (e.ai instanceof BarbaRayAi) {
        // restore_enemy_status and the hit flag: the same root pool path on this client.
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          e.ai.hitRoot(s.totalDamage);
          e.stats.hp = e.stats.maxHp;
          this.barbaLastHit.set(e.index, false);
          this.barbaDrain(e, e.ai);
          this.opts.log(`Barba Ray's body hit for ${s.totalDamage} (6x0A from another client): shell ${e.ai.shellHp}, body ${e.ai.bodyHp}`);
        }
        return;
      }
      if (e.ai instanceof GalgryphonAi) {
        // restore_enemy_status: hp = max - damage_taken, and the hit flag. The dead flag is ignored: the
        // brain owns the death (its gate runs on the leader), as the De Rol Le's.
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          e.stats.hp = Math.max(0, e.stats.maxHp - s.totalDamage);
          this.galgryphonLastHit.set(e.index, false);
          this.opts.log(`the Gal Gryphon was hit (6x0A from another client): ${e.stats.hp}/${e.stats.maxHp}`);
        }
        return;
      }
      if (e.ai instanceof DeRolLeAi) {
        // restore_enemy_status sets hp = max - damage_taken and the hit flag
        // 0x200 (vtable +0x88, 0x00777ba4) makes UpdateDerolle run the pool
        // handler (+0x100, ProcessPlayerHealing_00433edc) on this client
        // too. The dead flag is ignored: the brain owns its death (0x1e..0x20).
        if (s.flags & FLAG_HIT && s.totalDamage > 0 && !e.dead) {
          const pool = e.ai.hit(s.totalDamage);
          e.stats.hp = e.ai.bodyHp;
          this.drlLastHitLocal.set(e.index, false);
          this.opts.log(`De Rol Le's ${pool} hit for ${s.totalDamage} (6x0A from another client): shell ${e.ai.shellHp}, body ${e.ai.bodyHp}`);
        }
        return;
      }
      const newHp = Math.max(0, e.stats.maxHp - s.totalDamage);
      // Another player's strike: the spark and the number over the enemy.
      // ASSUMED: the exe makes them in EntityHitEntity on the striker's client;
      // whether a 6x0A receiver shows them was not traced, so this follows the
      // port's own client (the damage is the HP the packet took away).
      const lost = e.stats.hp - newHp;
      if (lost > 0 && !e.dead) {
        const p = this.hitPoint(e);
        this.hitFx(e, lost, false, { kind: 'weapon' });
        this.overlay?.damage(lost, false, p.x, p.y, p.z);
      }
      e.stats.hp = newHp;
      // restore_enemy_status: the status bits that are new on this enemy.
      if (!(s.flags & FLAG_DEAD)) {
        for (const t of e.status.receiveFlags(s.flags, this.ultimate)) {
          this.statusFx(e, t, false);
          this.opts.log(`E-${e.index.toString(16)} ${STATUS_NAME[t]} (6x0A from another client)`);
        }
        if (e.status.locked) this.lockEnemy(e, true);
      }
      if (s.flags & FLAG_DEAD) {
        if (!e.dead) {
          e.dead = true;
          this.splitterDied(e, false);
          // A Monest's death runs through its own states (set_monest_dead).
          if (e.monest) e.monest.die();
          else this.playDeath(e);
          if (e.ai instanceof DubwitchAi) this.dubwitchRemoteKill(e);
        }
      } else if (s.flags & 0x200) {
        // The hit flag runs the hit handler (vtable +0x100) here too: the
        // Sinow's sends its mirage clones away, a clone leaves.
        if (e.ai instanceof SinowAi || e.ai instanceof MorfosAi) e.ai.onDamage(clientId);
        if (e.ai instanceof MericarolAi || e.ai instanceof GibbonAi) e.ai.onDamage(clientId);
        if (e.ai instanceof GeeAi || e.ai instanceof GiGueAi || e.ai instanceof GibblesAi) e.ai.onDamage(clientId);
        if (e.ai instanceof ZuAi) e.ai.onDamage(clientId);
        if (e.ai instanceof ExeBrain) e.ai.onDamage(clientId); // the enemy base's hit handler (+0x100) runs here too
        if (e.ai?.flinches?.(0, e.stats.maxHp) ?? true) this.playDamage(e);
      }
      return;
    }
    // Another player taking damage / dying / being revived: its hit and death
    // motions (combat/playerdamage.ts documents the commands).
    if (sub === 0x4a || sub === 0x4b || sub === 0x4c) {
      if (clientId === this.game.selfId) return;
      const kind: HitMotionKind = sub === 0x4a ? 'block' : sub === 0x4c ? 'heavy' : 'light';
      const h = sub === 0x4a ? null : parseHitByEnemy(body);
      // action_get_hit_flinch / action_get_hit_fall (0x0069aa2c / 0x0069aaf4):
      // a dead player takes no hit; otherwise the packet's heading and velocity
      // become the player's and its hit state runs (the knockback slides it).
      if (h && this.deadPlayers.has(clientId)) return;
      if (h) this.view?.setPlayerAngle(clientId, h.angle);
      this.playRemoteMotion(clientId, kind, h ? { vx: h.vx, vz: h.vz } : undefined);
      return;
    }
    if (sub === 0x4d) {
      const d = parsePlayerDeath(body);
      if (!d || d.clientId === this.game.selfId) return;
      this.playRemoteMotion(d.clientId, 'death');
      this.deadPlayers.add(d.clientId);
      this.remoteStatus.delete(d.clientId); // ASSUMED: dying ends every effect
      this.opts.log(`player ${d.clientId} died (6x4D flags 0x${d.deathFlags.toString(16)})`);
      return;
    }
    if (sub === 0x4e) {
      // HandlePlayerRootObjectDespawn_0069ad04: the dead marker (soul).
      if (clientId !== this.game.selfId) this.showSoul(clientId, true);
      return;
    }
    // 6x33 (Moon Atomizer) and 6x66 (Star Atomizer): see receiveAtomizer.
    if (sub === 0x33 || sub === 0x66) {
      this.receiveAtomizer(body);
      return;
    }
    if (sub === 0x4f) {
      if (clientId === this.game.selfId) return;
      this.deadPlayers.delete(clientId);
      this.showSoul(clientId, false);
      this.playRemoteMotion(clientId, 'revive');
      return;
    }
    if (sub === 0x9c) {
      const u = parseEnemyStatusUltimate(body);
      const e = u ? this.enemies.get(u.enemyIndex) : undefined;
      if (!u || !e || clientId === this.game.selfId) return;
      const t = e.status.receiveUltimate(u.bits, this.ultimate, e.dead);
      if (t !== null) {
        this.statusFx(e, t, false);
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
      // The remote copy of the player runs the same infliction and ticks, so
      // its particles and sounds play here too.
      const id = st.clientId;
      let rs = this.remoteStatus.get(id);
      if (!rs) {
        rs = new PlayerStatus({
          sendAdd: () => {},
          sendRemove: () => {},
          poisonDamage: () => {},
          pulse: (type, onset) => this.statusPulse(id, type, onset),
          log: () => {},
        });
        this.remoteStatus.set(id, rs);
      }
      if (st.add) rs.receiveAdd(st.value);
      else rs.receiveRemove(st.value);
      return;
    }
    // 6x49 from another player (in this room, so the blast takes the local branch of
    // CreatePhotonBlast): the same gate and end timing as the local blast (ASSUMED
    // the remote's blast object is made at the same point as the local one).
    if (sub === 0x49) {
      if (clientId === this.game.selfId) return;
      if (pbBlockedBy(this.pbSlots, clientId)) {
        this.opts.log(`player ${clientId}: photon blast ${body[0] ?? '?'} (6x49), blocked by a blast in the room`);
        return;
      }
      const participants = pbParticipants([{ slot: clientId, field: 0 }]);
      this.pbSlots.start(participants);
      this.techHits.push({ ticks: pbTechHitTicks(participants.length, true), apply: () => this.pbSlots.end(clientId, participants) });
      this.opts.log(`player ${clientId}: photon blast ${body[0] ?? '?'} (6x49)`);
      return;
    }
    if (sub === 0x5f) this.opts.log(`item dropped (6x5F, ${body.length} bytes)`);
  }

  // Plays a hit / block / death / revive motion on a remote player, with the
  // sound and particles of the handler its copy runs (combat/playerfx.ts), and
  // keeps its gait suppressed until the motion has ended (the heavy hit's
  // stand-up included); a death holds until the player is revived.
  private remoteHooks = new Map<number, (dt: number) => void>();
  // `knock` is the 6x4B / 6x4C velocity: the light and heavy states slide the
  // player by it each tick (combat/playerdamage.ts KnockbackSlide), until the
  // stand-up starts (the exe's physics run in the fall, not in the stand-up).
  private playRemoteMotion(clientId: number, kind: HitMotionKind, knock?: { vx: number; vz: number }): void {
    const view = this.view;
    const p = this.game.players.get(clientId);
    if (!view || !p) return;
    const animator = view.playerAnimator(clientId);
    if (!animator) return;
    const old = this.remoteHooks.get(clientId);
    if (old) this.viewer.frameHooks.delete(old);
    this.remoteHooks.delete(clientId);
    this.hurt.add(clientId);
    animator.paused = false;
    const motionType = MOTION_TYPE[p.charClass] ?? 0;
    animator.play(hitMotion(motionType, 0, kind), 1);
    // The entry sounds and, on a remote copy, the attribute particle.
    if (kind === 'light' || kind === 'heavy') {
      this.playSe(kind === 'heavy' ? SE_HIT_HEAVY : SE_HIT_LIGHT);
      this.fxOn(clientId, attributeFx(p.charClass));
    } else if (kind === 'block') {
      this.playSe(SE_BLOCK);
      this.fxOn(clientId, BLOCK_FX);
    } else if (kind === 'revive') {
      this.fxOn(clientId, REVIVE_FX);
    }
    if (kind === 'death') return;
    let stage: HitMotionKind = kind;
    let landed = false;
    let age = 0;
    // The knockback: one damped step per game tick (the exe's tick, 30 a second).
    const slide = knock && (kind === 'light' || kind === 'heavy') ? new KnockbackSlide() : null;
    if (slide && knock) slide.start(knock.vx, knock.vz);
    let slideTicks = 0;
    const done = () => {
      slide?.stop();
      this.viewer.frameHooks.delete(hook);
      this.remoteHooks.delete(clientId);
      this.hurt.delete(clientId);
      view.resetGait(clientId);
    };
    const hook = (dt: number) => {
      if (this.disposed) return done();
      age += dt * GAME_TICKS_PER_SECOND;
      if (slide) {
        slideTicks += dt * GAME_TICKS_PER_SECOND;
        for (; slideTicks >= 1; slideTicks--) {
          const step = slide.tick();
          if (step) view.pushPlayer(clientId, step.dx, step.dz);
        }
      }
      if (stage === 'heavy' && !landed && animator.frame > HEAVY_LAND_FRAME) {
        landed = true;
        this.playSe(heavyLandSe(p.charClass));
      }
      if (age > 150) return done(); // a stalled motion must not hold the player
      if (age < 1 || !animator.ended) return;
      if (stage === 'heavy') {
        stage = 'getup';
        age = 0;
        slide?.stop();
        animator.play(hitMotion(motionType, 0, 'getup'), 1);
        return;
      }
      done();
    };
    this.remoteHooks.set(clientId, hook);
    this.viewer.frameHooks.add(hook);
  }

  // Battle Mode: a remote player's strike at its hit frame (6x46) that names the local player
  // is the hit on the local player (combat/pvp.ts; the victim's copy of the attacker's hit
  // check, ASSUMED to run at the 6x46). The damage goes through PlayerDamage.hit with the
  // attacker as the killer; the 6x4B / 6x4C of the flinch carries the new HP, and onPvpHit
  // sends the 6x8F.
  private onRemoteStrikeTargets(clientId: number, body: Uint8Array): void {
    if (!this.battlePvp || this.damage.dead || clientId === this.game.selfId || !this.view) return;
    const t = parseAttackTargets(body);
    if (!t || !t.targets.includes(this.game.selfId)) return;
    const me = this.game.self;
    const from = this.view.playerPositions().get(clientId);
    const remote = this.game.players.get(clientId);
    // The remote's worn weapon (6x25 / 6x26 keep remote.weapon in step): its range and ATA.
    const attacker = remoteAttacker(remote?.charClass ?? -1, remote?.combatStats ?? null, weaponForCombat(remote?.weapon, this.pmtSync));
    if (!me || !from || !attacker) return;
    const stats = this.selfStats();
    // Deband / Zalure move the DFP (+0x2d2); a freeze lowers EVP (as enemyHitsPlayer).
    const defender: DefenderStats = { hp: this.damage.hp, maxHp: this.damage.maxHp, evp: this.status.evp(stats.evp), dfp: this.selfBuffs.dfp(stats.dfp) };
    const strike = this.remoteStrike.get(clientId) ?? { step: 0, attackType: 0 };
    const type = (strike.attackType === 1 ? 1 : 0) as AttackType;
    const r = pvpStrike(attacker, defender, type, strike.step, this.rng);
    if (!r.landed) return;
    // The direction from the attacker to the local player (the enemyHitsPlayer convention).
    const angle = Math.atan2(me.position.x - from.x, me.position.z - from.z);
    this.damage.hit(r.damage, angle, pvpKnockback(this.damage.maxHp, r.total), clientId, r.critical);
    this.gainPb(r.total, true);
    this.onPvpHit?.(clientId, r.damage);
    this.opts.log(`hit by ${remote?.name ?? `player ${clientId + 1}`} for ${r.damage}: ${this.damage.hp}/${this.damage.maxHp}`);
  }

  // Battle Mode: the local player's PvP strike was credited by the victim's 6x8F (quest/battlerun.ts).
  // ASSUMED: the attacker's PB gauge takes that damage as dealt.
  pvpDealt(damage: number): void {
    if (damage >= 1) this.gainPb(damage, false);
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
    // A Mothmant's lethal kill picks its death state: 7 the ground kill, 8 the fall (MothmantAi.beginDeath).
    const mothKind = e.ai instanceof MothmantAi ? e.ai.beginDeath() : null;
    const plan = mothKind ? mothmantDeathPlan(mothKind) : deathPlanFor(e.instance.spec.name, e.slot.type, { area: this.area, episode: this.game.info?.episode ?? 1 });
    if (plan) {
      e.death = { run: new DeathRun(plan), acc: 0, dissolve: null, fade: false };
      if (plan.instant) e.instance.root.visible = false;
      // A wolf's kill side, turn and slide come from its velocity at the kill (ASSUMED: the last step).
      if (e.ai instanceof WolfAi) e.death.savage = new SavageDeathMotion(e.instance.root.rotation.y, e.ai.killVelocity());
    }
    // A Barbarous Wolf's death arms its packmates' howl countdown (armPackHowl).
    if (e.ai instanceof WolfAi) {
      const wolves = [...this.enemies.values()].flatMap((x) => (x.ai instanceof WolfAi ? [x.ai] : []));
      armPackHowl(e.ai, wolves, () => this.rng());
    }
    const m = e.ai?.deathMotion ?? e.motions.death;
    if (!mothKind) e.ai?.kill();
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
  itemPmt(): Promise<ItemPMT | null> {
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

  // A quest's set_enemy_*_data (quest/miscops.ts): replace one battle
  // parameter row for the game's difficulty. Enemies created afterwards read
  // it, as the client's own table is edited in place.
  overrideBattleParam(kind: BattleParamKind, index: number, row: Uint8Array): void {
    const difficulty = this.game.info?.difficulty ?? 0;
    void this.battleParams().then((p) => p?.override(kind, difficulty, index, row));
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
    const ask = () => fetchStreamFiles(this.game.conn, this.opts.log);
    this.streamed ??= this.opts.streamFiles?.().catch(ask) ?? ask();
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
    this.battleTraps?.dispose();
    this.battleTraps = null;
    this.viewer.renderHooks.delete(this.smoothHook);
    this.techFire.clear();
    this.gunBullets = [];
    this.shotEffects = [];
    this.tracers?.dispose();
    this.tracers = null;
    this.enemies.clear();
    this.view = null;
    this.overlay?.dispose();
    this.overlay = null;
    this.hpReadout?.remove();
    this.hpReadout = null;
    this.hud?.dispose();
    this.levelUpFx?.dispose();
    this.levelUpFx = null;
    this.techObjects = null;
    this.techfx?.dispose();
    this.techfx = null;
    this.fx?.dispose();
    this.fx = null;
    for (const h of this.remoteHooks.values()) this.viewer.frameHooks.delete(h);
    this.remoteHooks.clear();
    this.souls.clear();
    this.playerFx?.dispose();
    this.playerFx = null;
    this.hud = null;
    this.voloptViews.clear();
    this.voloptBodyAnim.clear();
    this.voloptLastHit.clear();
    this.voloptHead = null;
    this.voloptBody = null;
    this.resetDarkFalz();
  }
}
