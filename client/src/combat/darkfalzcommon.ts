// Dark Falz, the shared pieces (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
//
// Sources (docs/adr/0001-client-reference-sources.md): the Ephinea Ghidra dump
// for the names and the shapes (the family after `UpdateVoloptAiState` is Dark
// Falz's: it dispatches through `unknown_falz_state_functions` and tests
// `map_id2 == 0xE`; a mislabelled BML symbol, `g_VoloptBmlData`, is shared with
// Vol Opt), the executable itself for every state function the dump never
// defined as a function (read from the disassembly; the state tables and the
// numbers come from tools/exedata.py), and the JP C for the leaf functions
// that exist in it. The JP files that belong to this fight, matched by their
// callees and constants and not by name:
//   FUN_0044e5b4.cpp  the ZAKO scene's enter function (sound 0x369, then the
//                     three player/overlay setters): Ephinea 0x0044E4A4.
//   FUN_0045f328.c    the Darvant's death: parent kill count (+0x394) += 1,
//                     +0x3b0 = 0, state (+0x37c) = 3 (the dump's
//                     VoloptUpdatePhaseState): Ephinea 0x0045F238.
//   FUN_0045f314.c    "if state != 3 run the above": Ephinea 0x0045F224, the
//                     Darvant's vtable +0x114 (the die hook of every form too).
//   FUN_0045d52c.cpp  form 3's SetAnim (frame 0, id, mode from the table
//                     0x009A4440 + id * 0x14): Ephinea 0x0045D43C.
//   FUN_0045f178.c    a state's enter function copying a global into the
//                     timer (+0x3a0): the pattern of every enter below.
//   FUN_00457a78.c /  form 2's enter functions that load the timer (+0x3a0)
//   FUN_00457a6c.c    from a field / a global.
//   FUN_0045a9e4.c    form 1's APPEAR enter (timer = global, frame = 0).
// The other JP files that grep to "Volopt" or "Falz" are float initialisers
// (1.0 / 8.0 / 1.5), flag-word setters and Vol Opt's own leaf functions.
//
// The fight is four classes: the control object (TBoss4DarkFalz 0xC8, the scene
// machine of 16 scenes), the Darvants (80 in the ZAKO scene, more that form 1
// spits out), and the three forms. Each form is an enemy of its own in the exe
// (entity id control + 0x200 / 0x1FF / 0x1FE); here the control brain owns all
// of them and render/combat.ts gives each a hit proxy, as it does for Vol Opt.
//
// Sync, as the exe has it: every client runs every state machine. The room
// leader (unknown_is_player_the_party_leader_for_current_floor) alone runs the
// "lead" procedures (the decisions) and speaks through 6x19 (G_DarkFalzActions:
// {entity = the control's, u16 phase = scene or 0xFFFF, u32 packed action or
// 0xFFFFFFFF}); the sender applies the packet itself first
// (checked_call_packet0x60_subcommand). The receiver is
// HandleVoloptEntityStateTransition 0x0044CE6C.

import { BAMS_TO_RAD } from './enemyai.ts';
import type { EnemyShot } from './enemyshots.ts';

export const BAMS = BAMS_TO_RAD;
export type Vec3 = [number, number, number];

// Entity ids relative to the control's (newserv Map.cc TBoss4DarkFalz: the root,
// 0x1FD Darvants, then DARK_FALZ_3, _2, _1).
export const DF_ID = { control: 0, darvant: 1, lastDarvant: 0x1fd, form3: 0x1fe, form2: 0x1ff, form1: 0x200 } as const;
export const DF_DARVANT_MAX = 0x1fd;

// The control's scenes (table 0x009A5940, stride 0x14: name, enter, leave, lead,
// all). The names are the exe's.
export const SCENE = {
  editor: 0,
  waitCasket: 1,
  demoWarp0: 2,
  demoWarp1: 3,
  zako: 4,
  appType1: 5,
  type1: 6,
  appType2: 7,
  type2: 8,
  dieType2: 9,
  getRing: 10,
  demoWarp2: 11,
  demoWarp3: 12,
  type3: 13,
  dieType3: 14,
  olEnding: 15,
} as const;
export const SCENE_NAMES = ['EDITOR', 'WAIT_CASKET', 'DEMO_WARP0', 'DEMO_WARP1', 'ZAKO', 'APP TYPE1', 'TYPE1', 'APP TYPE2', 'TYPE2', 'DIE TYPE2', 'GET RING', 'DEMO_WARP2', 'DEMO_WARP3', 'TYPE3', 'DIE TYPE3', 'OL ENDING'] as const;

// Waits the scenes load into +0x388 (static initialiser 0x0044DCB4 and the enter
// functions' literals).
export const SCENE_FRAMES = {
  demoWarp0: 120, // [0xA44EAC]
  demoWarp1: 30, // literal 0x1E
  appType1: 0x146, // counts up; 0x2D the casket object, 0xB9 dark1.adx, past 0x145 the end
  appType1Casket: 0x2d,
  appType1Music: 0xb9,
  appType2: 300, // [0xA44EB0]
  dieType2: 280, // [0xA44EB4]
  getRing: 142, // [0xA44EB8]
  demoWarp2: 114, // [0xA44DAC]
  demoWarp3: 126, // [0xA44DB0]
  dieType3: 302, // [0xA44EBC]
  olEnding: 0x1c6, // literal
} as const;

// WAIT_CASKET's trigger: any player within sqrt(900) of this point (x, z).
export const CASKET = { x: -9860, z: -240, radiusSq: 900 } as const;

// Where the players stand: DistributePlayersInCircle (0x0044BF88: radius
// 12.5 about the origin, start half a step in, heading 0x8000) and
// RepositionPlayersInCircle (0x0044C090: radius 250 about (10000, 0), heading
// angle + 0x8000), one slot of 0x10000 / party size each.
export const CIRCLE = {
  inner: { cx: 0, cz: 0, radius: 12.5, y: 10 },
  outer: { cx: 10000, cz: 0, radius: 250, y: 10 },
} as const;

// The packed action words of the forms (see each form's file for the fields).
export const NO_PACKED = 0xffffffff;
export const NO_PHASE = 0xffff;

export const norm16 = (a: number) => ((a % 0x10000) + 0x10000) % 0x10000;
// b_minus_a: the signed shortest difference of two BAMS angles.
export const angDiff = (from: number, to: number) => {
  const d = norm16(to - from);
  return d >= 0x8000 ? d - 0x10000 : d;
};
// (1 - cos(t * 0x8000 BAMS)) * 0.5: the exe's ease (0x00455900 CalculateVoloptForm7WaveValue
// and its copies: constants 1.0, 0.5, 32768.0).
export const ease = (t: number) => (1 - Math.cos(t * Math.PI)) * 0.5;
// int_sin / int_cos of a BAMS angle.
export const sinB = (a: number) => Math.sin(a * BAMS);
export const cosB = (a: number) => Math.cos(a * BAMS);

// A form's animation: the exe steps `frame` by `step` a tick and ends the clip
// by its row's mode (UpdateVoloptForm7HazardState / VoloptForm7UpdateChargeState):
//   0 loops at 30, 1 holds at 29, 2 plays to 29 and goes on to the row's next,
//   anything else just runs. `ended` is true on the step that ended a clip.
export interface DfAnimRow {
  readonly mode: number;
  readonly next: number;
}
export class DfAnim {
  id = 0;
  frame = 0;
  step = 1;
  mode = 0;
  ended = false;
  private readonly rows: readonly DfAnimRow[];
  constructor(rows: readonly DfAnimRow[], step: number) {
    this.rows = rows;
    this.step = step;
  }
  // SetAnim: id -1 keeps the clip.
  set(id: number): void {
    if (id === -1) return;
    this.frame = 0;
    this.id = id;
    this.mode = this.rows[id]?.mode ?? 0;
  }
  tick(): void {
    let t = this.frame + this.step;
    this.ended = false;
    if (this.mode === 0) {
      if (t >= 30) {
        t -= 30;
        this.ended = true;
      }
    } else if (this.mode === 1) {
      if (t >= 29) {
        t = 29;
        this.ended = true;
      }
    } else if (this.mode === 2) {
      if (t >= 29) {
        this.ended = true;
        this.id = this.rows[this.id]?.next ?? 0;
        this.mode = this.rows[this.id]?.mode ?? 0;
        t = 0;
      }
    }
    this.frame = t >= 0 && t < 30 ? t : 0;
  }
}

// A follower waits for the leader's order in WAITNEXT and in the scenes whose
// lead procedure decides. The exe has no timeout (a lost packet would hang it;
// a leader that leaves is replaced by the next client through
// unknown_is_player_the_party_leader_for_current_floor). ASSUMED failsafe: after
// this many ticks of waiting the follower decides for itself (the lead
// procedure) so no state can hang.
export const STALL_TICKS = 600;

// What the brains tell their owner.
export type DfEvent =
  // 6x19 (the sender has applied it already).
  | { kind: 'send'; phase: number; packed: number }
  | { kind: 'questFlag'; flag: number }
  | { kind: 'se'; id: number }
  // The field music: dark1.adx (1) at APP TYPE1 frame 0xB9, dark2.adx (2) when
  // DEMO_WARP2 starts (play_bgm at 0x0044D716 / 0x0044E0DA).
  | { kind: 'bgm'; track: 1 | 2 }
  // The local player is put on the circle of the scene (the party slot is the
  // owner's: the exe walks g_EntityArray in slot order).
  | { kind: 'place'; circle: 'inner' | 'outer'; slots: number }
  // entity_hit_by_tech on a player: group 0 (the owner applies the
  // formula) or a fixed amount (fixed_damage_maybe).
  | { kind: 'hit'; clientId: number; power: number; fixed: boolean; x: number; z: number; what: string }
  | { kind: 'megid'; clientId: number; level: number; what: string }
  // A technique object's hit on a player (entity_hit_by_tech, group 0 at the
  // technique's level).
  | { kind: 'tech'; clientId: number; tech: 'rafoie' | 'rabarta' | 'gizonde'; level: number; x: number; z: number; what: string }
  // The enemy Resta on the form itself (CreateSpecialAttackEntity 0x006EEEB4).
  | { kind: 'resta'; level: number }
  // A form or a Darvant died (the dead flag, the 6x0A with it).
  | { kind: 'died'; entity: number }
  // The ending: on_enemy_killed and set_monster_spawn_initdata_as_dead.
  | { kind: 'killed'; x: number; z: number }
  // The scene changed (music, logs, the HUD).
  | { kind: 'scene'; scene: number }
  // A Darvant appeared (the owner gives it a hit proxy).
  | { kind: 'darvant'; entity: number }
  // The local player is pulled to a point (the captured player of form 3).
  | { kind: 'pull'; clientId: number; x: number; z: number };

// The BattleParamEntry rows of the fight (the dump's names are in the comments).
export interface DfRow {
  hp: number;
  atp: number;
  // MovementData (fparam1.., iparam1..): the "animation speeds" struct whose
  // field 0 is fparam1, +0x18 iparam1, +0x1c iparam2, +0x20 iparam3.
  f1: number;
  i1: number;
  i2: number;
  i3: number;
  i4: number;
}
export const EMPTY_ROW: DfRow = { hp: 1, atp: 0, f1: 0, i1: 0, i2: 0, i3: 0, i4: 0 };

export interface DfRows {
  darvant: DfRow; // 53 ep1_Darvant
  df1: DfRow; // 54
  df2: DfRow; // 55
  df3: DfRow; // 56
  darvantFalz: DfRow; // 57 ep1_DarvantFalz
}

// A hit target of the fight. render/combat.ts gives each one an enemy of its
// own in the slot the exe gives it; the brain owns what a hit does.
export abstract class DfEntity {
  readonly entity: number; // offset from the control's entity id
  hp: number;
  maxHp: number;
  x = 0;
  y = 0;
  z = 0;
  dead = false;
  // Gone for good (a Darvant that sank out of sight).
  gone = false;
  // The pose snapped (a form jumped): bumped, read by render/smoothrender.ts.
  warps = 0;
  private lastX = NaN;
  private lastZ = NaN;
  // Bumps `warps` when the pose moved farther in one tick than any of the fight's
  // glides (the slowest jump is form 3's 7 frame dash, about 30 a tick).
  protected trackPose(): void {
    if (!Number.isNaN(this.lastX) && Math.hypot(this.x - this.lastX, this.z - this.lastZ) > 60) this.warps++;
    this.lastX = this.x;
    this.lastZ = this.z;
  }
  // Damage landed since the entity last looked.
  hit = false;
  byLocal = false;
  constructor(entity: number, hp: number) {
    this.entity = entity;
    this.hp = hp;
    this.maxHp = hp;
  }
  // A hit can land (the invulnerable flag 0x200 is clear and the part exists).
  abstract get targetable(): boolean;
  damage(amount: number, byLocal: boolean): number {
    const d = Math.max(0, Math.round(amount));
    if (d <= 0 || this.dead || !this.targetable) return 0;
    const taken = Math.min(d, Math.max(0, this.hp));
    this.hp -= taken;
    this.hit = true;
    this.byLocal = byLocal;
    return taken;
  }
  // restore_enemy_status: hp = max - damage_taken (the total on the wire).
  setDamageTaken(total: number): void {
    if (this.dead || !this.targetable) return;
    const hp = Math.max(0, this.maxHp - Math.max(0, Math.round(total)));
    if (hp < this.hp) {
      this.hit = true;
      this.byLocal = false;
      this.hp = hp;
    }
  }
}

// What the forms need from the fight around them.
export interface DfFight {
  readonly difficulty: number; // 0..3
  readonly ultimate: boolean;
  readonly events: DfEvent[];
  readonly rows: DfRows;
  leader(): boolean;
  random(): number;
  // The control's scene (+0x384) and its kill counters.
  readonly scene: number;
  // A packet to every client; applied here first.
  send(phase: number, packed: number): void;
  selfId(): number;
  // The control's +0x390 - +0x394: Darvants made minus Darvants dead.
  aliveDarvants(): number;
  // A shot to launch (a homing bolt).
  shoot(shot: EnemyShot): void;
  // A Darvant spat out by form 1 (ids from the control's counter +0x38c, which
  // runs 1 .. 0x1fd: VoloptForm7Hazard_CalculateOffset 0x0044CFC0); false when
  // the ids are used up.
  spawnSpit(x: number, z: number, targetX: number, targetZ: number): boolean;
  // Form 2's beam ended in Ultimate (difficulty 3): three Darvants per living player
  // about (x, y, z), the body's position (0x00458E44). Nothing on the other difficulties.
  spawnBeamDarvants(x: number, y: number, z: number): void;
  // The party: alive players (unknown_player_alive_check) and the random pick
  // GetRandomAlivePlayerEntityIndex (0x0044D084).
  alive(): readonly { clientId: number; x: number; z: number }[];
  randomAlive(): number; // 0xffff when none
  playerPos(clientId: number): { x: number; z: number } | null;
}
