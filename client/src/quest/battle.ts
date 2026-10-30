// Battle Mode (PSOBB "Battle" games and the b88xxx quests), following PsoBB.exe
// (Ephinea 1.25.13 VAs; the Ghidra dump names are misleading: everything called
// "SinowberillChallenge*" in the battle code is the battle controller, the
// player class or the battle rules).
//
// Pure logic, no three.js and no network, so it runs in Node tests:
//   - the rule struct the ba_* opcodes fill (0x30 bytes at g_BaRuleId, the same
//     layout newserv calls BattleRules; the exe's opcode bodies validate and
//     remap exactly as BattleSetup.apply does) and the validated copy the
//     battle works from (the struct at 0xa94290, set by the SetChallenge*
//     validators: effectiveRules);
//   - the score weights (nine floats the opcodes write; BSS in the exe, so 0
//     until a quest sets them), the score groups of a player (player +0x834 ..
//     +0x880) and the points formula (CalculateTextHeightOffset_00691600);
//   - the places table (the exchange sort of UpdateState2_006aea34);
//   - the controller (SinowberillChallengeEntity, vtable 0x00b3a650 states
//     0..6) as a 30 Hz frame state machine;
//   - the 6x7D / 6xCF / 6x8F / 6xD0 / 6x9B / 6x80 / 6x83 payloads.

// --- the rules ----------------------------------------------------------------

export const TECH_DISK = { allow: 0, forbidAll: 1, limitLevel: 2 } as const;
export const WEAPON_ARMOR = { allow: 0, clearAndAllow: 1, forbidAll: 2, forbidRares: 3 } as const;
export const MAG_MODE = { allow: 0, forbidAll: 1 } as const;
export const TOOL_MODE = { allow: 0, clearAndAllow: 1, forbidAll: 2 } as const;
export const TRAP_MODE = { default: 0, allPlayers: 1 } as const;
export const MESETA_MODE = { allow: 0, forbidAll: 1, clearAndAllow: 2 } as const;
export const RESPAWN_MODE = { allow: 0, forbid: 1, limitLives: 2 } as const;

export interface BattleRules {
  techDisk: number; // +00
  weaponAndArmor: number; // +01
  mag: number; // +02
  tool: number; // +03
  trapMode: number; // +04
  unusedF817: number; // +05
  respawn: number; // +06
  replaceChar: number; // +07
  dropWeapon: number; // +08 (0 = the weapon is dropped on death; inverted from the opcode)
  teams: number; // +09
  hideReticle: number; // +0A
  meseta: number; // +0B
  deathLevelUp: number; // +0C
  trapCounts: [number, number, number, number]; // +0D, by internal trap type
  sonar: number; // +11
  sonarCount: number; // +12
  forbidScapeDolls: number; // +13
  unknownA1: number; // +14
  lives: number; // +18
  maxTechLevel: number; // +1C
  charLevel: number; // +20
  timeLimit: number; // +24 minutes
  deathTechLevelUp: number; // +28
  boxDropArea: number; // +2C
}

export const BATTLE_RULES_SIZE = 0x30;

export function newBattleRules(): BattleRules {
  return {
    techDisk: 0, weaponAndArmor: 0, mag: 0, tool: 0, trapMode: 0, unusedF817: 0, respawn: 0, replaceChar: 0,
    dropWeapon: 0, teams: 0, hideReticle: 0, meseta: 0, deathLevelUp: 0, trapCounts: [0, 0, 0, 0], sonar: 0,
    sonarCount: 0, forbidScapeDolls: 0, unknownA1: 0, lives: 0, maxTechLevel: 0, charLevel: 0, timeLimit: 0,
    deathTechLevelUp: 0, boxDropArea: 0,
  };
}

export function encodeBattleRules(r: BattleRules, boxDropCount = r.boxDropArea): Uint8Array {
  const b = new Uint8Array(BATTLE_RULES_SIZE);
  const dv = new DataView(b.buffer);
  b.set([r.techDisk, r.weaponAndArmor, r.mag, r.tool, r.trapMode, r.unusedF817, r.respawn, r.replaceChar, r.dropWeapon, r.teams, r.hideReticle, r.meseta, r.deathLevelUp], 0);
  b.set(r.trapCounts, 0x0d);
  b[0x11] = r.sonar;
  b[0x12] = r.sonarCount;
  b[0x13] = r.forbidScapeDolls;
  dv.setUint32(0x14, r.unknownA1 >>> 0, true);
  dv.setUint32(0x18, r.lives >>> 0, true);
  dv.setUint32(0x1c, r.maxTechLevel >>> 0, true);
  dv.setUint32(0x20, r.charLevel >>> 0, true);
  dv.setUint32(0x24, r.timeLimit >>> 0, true);
  dv.setUint16(0x28, r.deathTechLevelUp & 0xffff, true);
  dv.setUint32(0x2c, boxDropCount >>> 0, true);
  return b;
}

export function decodeBattleRules(b: Uint8Array): BattleRules {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    techDisk: b[0], weaponAndArmor: b[1], mag: b[2], tool: b[3], trapMode: b[4], unusedF817: b[5], respawn: b[6],
    replaceChar: b[7], dropWeapon: b[8], teams: b[9], hideReticle: b[10], meseta: b[11], deathLevelUp: b[12],
    trapCounts: [b[0x0d], b[0x0e], b[0x0f], b[0x10]], sonar: b[0x11], sonarCount: b[0x12], forbidScapeDolls: b[0x13],
    unknownA1: dv.getUint32(0x14, true), lives: dv.getUint32(0x18, true), maxTechLevel: dv.getUint32(0x1c, true),
    charLevel: dv.getUint32(0x20, true), timeLimit: dv.getUint32(0x24, true), deathTechLevelUp: dv.getUint16(0x28, true),
    boxDropArea: dv.getUint32(0x2c, true),
  };
}

// The tables the opcodes index (PsoBB.exe .data 0x00969788.. read with
// tools/exedata.py) and the value stored when the argument is out of range.
const TECH_TABLE = [1, 0, 2];
const WEAPON_TABLE = [2, 0, 1, 3];
const MAG_TABLE = [1, 0];
const TOOL_TABLE = [2, 0, 1];
const BOOL_TABLE = [0, 1];
const INVERTED_TABLE = [1, 0];
const RESPAWN_TABLE = [1, 0, 2];
// ba_set_trap_count: the quest's trap type 0..3 -> the internal type
// (g_QuestTrapArgStringArray; newserv: damage 0, slow 2, confuse 3, freeze 1).
export const TRAP_TYPE_TO_INTERNAL = [0, 2, 3, 1] as const;
export const TRAP_NAMES = ['damage', 'freeze', 'slow', 'confuse'] as const; // by internal type

// The weights the nine score opcodes write, in the order the opcodes come.
export const SCORE_WEIGHT_OPCODES = [
  'ba_player_give_damage_score', // F848 -> player +0x870
  'ba_player_take_damage_score', // F849 -> +0x860
  'ba_enemy_give_damage_score', // F84A -> +0x86c
  'ba_enemy_take_damage_score', // F84B -> +0x85c
  'ba_player_kill_score', // F84C -> +0x840
  'ba_player_death_score', // F84D -> +0x850
  'ba_enemy_kill_score', // F84E -> +0x83c
  'ba_enemy_death_score', // F84F -> +0x84c
  'ba_meseta_score', // F850 -> +0x87c / +0x880
] as const;

export interface ScoreWeights {
  playerGive: number;
  playerTake: number;
  enemyGive: number;
  enemyTake: number;
  playerKill: number;
  playerDeath: number;
  enemyKill: number;
  enemyDeath: number;
  meseta: number;
}

export const newScoreWeights = (): ScoreWeights => ({
  playerGive: 0, playerTake: 0, enemyGive: 0, enemyTake: 0, playerKill: 0, playerDeath: 0, enemyKill: 0, enemyDeath: 0, meseta: 0,
});

const WEIGHT_KEYS: Record<string, keyof ScoreWeights> = {
  ba_player_give_damage_score: 'playerGive',
  ba_player_take_damage_score: 'playerTake',
  ba_enemy_give_damage_score: 'enemyGive',
  ba_enemy_take_damage_score: 'enemyTake',
  ba_player_kill_score: 'playerKill',
  ba_player_death_score: 'playerDeath',
  ba_enemy_kill_score: 'enemyKill',
  ba_enemy_death_score: 'enemyDeath',
  ba_meseta_score: 'meseta',
};

const f32 = Math.fround;

// opcode_give_damage_score and its eight siblings: (float)r[b+1] / (float)r[b+2] + (float)r[b].
export function weightFromRegs(r0: number, r1: number, r2: number): number {
  return f32(f32(f32(r1 | 0) / f32(r2 | 0)) + f32(r0 | 0));
}

export const OPCODE_BA_INITIAL_FLOOR_TABLE = [0x10, 0x11] as const;

// ba_initial_floor (opcode_ba_initial_floor .c:606737): 0 = Temple (floor 0x10),
// 1 = Spaceship (0x11), 2..0x11 = Episode 1 floors 0..0xF, 0x12 and above: no
// effect (newserv QuestScript.cc documents the table the exe builds on the stack;
// its floor-id arrays are not readable from the dump: ASSUMED identity above 1).
export function baInitialFloor(v: number): number | null {
  if (v > 0x11 || v < 0) return null;
  if (v < 2) return OPCODE_BA_INITIAL_FLOOR_TABLE[v]!;
  return v - 2;
}

// What the ba_* opcodes accumulate. The VM holds one; the battle controller
// reads it when ba_start fires.
export class BattleSetup {
  rules: BattleRules = newBattleRules();
  weights: ScoreWeights = newScoreWeights(); // BSS in the exe: kept between quests
  // set_score_announce: up to 8 minutes, 0 = free slot (opcode_set_score_announce).
  announce: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  trapDamage = 700.0; // battle_quest_damage_trap_power (initialize_damage_trap_power_scales .c:492245)
  trapsHitOwner = false; // g_BATrapsCanTargetOwnerPlayer
  showSelfTraps = true; // g_BATrapOwnerTargetingDisabled == 0 (never read by the exe)
  winEffects = true; // g_SinowberillChallengeTargetPlayer, 1 at start (.c:602043)
  initialFloor: number | null = null;
  started = false;
  message = '';

  // Executes one ba_* opcode. `arg(i)` is an integer argument, `regs` the
  // register file (the R_REG_SET_FIXED opcodes read it at `reg(0)`), `text` the
  // string argument. Returns false when the name is not a battle opcode.
  apply(name: string, io: { arg(i: number): number; reg(i: number): number; regs: Int32Array; text(i: number): string }): boolean {
    const r = this.rules;
    const v = io.arg(0) >>> 0;
    const pick = (table: number[], dflt: number) => (v >= table.length ? dflt : table[v]!);
    switch (name) {
      case 'ba_initial_floor':
        this.initialFloor = baInitialFloor(io.arg(0));
        return true;
      case 'clear_ba_rules':
        // opcode_set_ba_rules (.c:612301): the rules, not the weights or the announcements.
        this.rules = newBattleRules();
        return true;
      case 'ba_set_tech_disk_mode': r.techDisk = pick(TECH_TABLE, 2); return true;
      case 'ba_set_weapon_and_armor_mode': r.weaponAndArmor = pick(WEAPON_TABLE, 2); return true;
      case 'ba_set_forbid_mags': r.mag = pick(MAG_TABLE, 1); return true;
      case 'ba_set_tool_mode': r.tool = pick(TOOL_TABLE, 2); return true;
      case 'ba_set_trap_mode': r.trapMode = pick(BOOL_TABLE, 0); return true;
      case 'ba_set_unused_F817': r.unusedF817 = pick(BOOL_TABLE, 0); return true;
      case 'ba_set_respawn': r.respawn = pick(RESPAWN_TABLE, 2); return true;
      case 'ba_set_replace_char': r.replaceChar = pick(BOOL_TABLE, 1); return true;
      case 'ba_dropwep': r.dropWeapon = pick(INVERTED_TABLE, 1); return true;
      case 'ba_teams': r.teams = pick(BOOL_TABLE, 0); return true;
      case 'ba_hide_target_reticle': if (v < 2) r.hideReticle = v; return true;
      case 'ba_set_meseta_drop_mode': if (v < 3) r.meseta = v; return true;
      case 'ba_death_lvl_up': r.deathLevelUp = v & 0xff; return true;
      case 'ba_set_trap_count': {
        const base = io.reg(0);
        const type = io.regs[base]! | 0;
        if (type >= 0 && type < 4) r.trapCounts[TRAP_TYPE_TO_INTERNAL[type]!] = io.regs[(base + 1) & 0xff]! & 0xff;
        return true;
      }
      case 'ba_enable_sonar': if (v < 2) r.sonar = v; return true;
      case 'ba_sonar_count': r.sonarCount = v & 0xff; return true;
      case 'ba_forbid_scape_dolls': if (v < 2) r.forbidScapeDolls = v; return true;
      case 'ba_set_lives': r.lives = v > 99 ? 0 : v; return true;
      case 'ba_set_max_tech_level': r.maxTechLevel = v !== 0xff && v > 0x1d ? 0 : v; return true;
      case 'ba_set_char_level': r.charLevel = v > 199 ? 0 : v; return true;
      case 'ba_set_time_limit': r.timeLimit = v > 0x278d0 ? 0 : v; return true;
      case 'ba_death_tech_level_up': if (v < 0x1e) r.deathTechLevelUp = v; return true;
      case 'ba_set_box_drop_area': r.boxDropArea = io.regs[io.reg(0)]! >>> 0; return true;
      case 'clear_score_announce': this.announce.fill(0); return true;
      case 'set_score_announce': {
        const free = this.announce.indexOf(0);
        if (free >= 0) this.announce[free] = v & 0xffff;
        return true;
      }
      case 'set_trap_damage': {
        const b = io.reg(0);
        this.trapDamage = weightFromRegs(io.regs[b]!, io.regs[(b + 1) & 0xff]!, io.regs[(b + 2) & 0xff]!);
        return true;
      }
      case 'ba_set_trapself': this.trapsHitOwner = true; return true;
      case 'ba_clear_trapself': this.trapsHitOwner = false; return true;
      case 'ba_show_self_traps': this.showSelfTraps = true; return true;
      case 'ba_hide_self_traps': this.showSelfTraps = false; return true;
      case 'enable_win_pfx': this.winEffects = true; return true;
      case 'disable_win_pfx': this.winEffects = false; return true;
      case 'ba_start':
        this.message = io.text(0);
        this.started = true;
        return true;
      default: {
        const key = WEIGHT_KEYS[name];
        if (!key) return false;
        const b = io.reg(0);
        this.weights[key] = weightFromRegs(io.regs[b]!, io.regs[(b + 1) & 0xff]!, io.regs[(b + 2) & 0xff]!);
        return true;
      }
    }
  }
}

export const BATTLE_OPCODES = new Set<string>([
  'ba_initial_floor', 'clear_ba_rules', 'ba_set_tech_disk_mode', 'ba_set_weapon_and_armor_mode', 'ba_set_forbid_mags',
  'ba_set_tool_mode', 'ba_set_trap_mode', 'ba_set_unused_F817', 'ba_set_respawn', 'ba_set_replace_char', 'ba_dropwep',
  'ba_teams', 'ba_start', 'ba_death_lvl_up', 'ba_set_meseta_drop_mode', 'ba_hide_target_reticle', 'ba_set_trap_count',
  'ba_show_self_traps', 'ba_hide_self_traps', 'ba_enable_sonar', 'ba_sonar_count', 'clear_score_announce',
  'set_score_announce', 'ba_set_box_drop_area', 'ba_set_trapself', 'ba_clear_trapself', 'ba_set_lives',
  'ba_set_max_tech_level', 'ba_set_char_level', 'ba_set_time_limit', 'set_trap_damage', 'enable_win_pfx',
  'disable_win_pfx', 'ba_forbid_scape_dolls', 'ba_death_tech_level_up',
  ...Object.keys(WEIGHT_KEYS),
]);

// --- the validated rules a battle runs on -------------------------------------

export interface EffectiveRules extends BattleRules {
  active: boolean;
}

const lt = (v: number, n: number) => (v < n ? v : 0);

// InitializeSinowberillChallenge_006afd1c copies the rule struct into the state
// at 0xa94290 through validators that reset an out-of-range value to 0
// (SetChallengeDifficulty .. SetChallengeState11, .c:594094..594290); the teams
// flag only holds with four players (.c:601863).
export function effectiveRules(r: BattleRules, playerCount: number): EffectiveRules {
  return {
    active: true,
    techDisk: lt(r.techDisk, 3),
    weaponAndArmor: lt(r.weaponAndArmor, 4),
    mag: lt(r.mag, 2),
    tool: lt(r.tool, 3),
    trapMode: lt(r.trapMode, 2),
    unusedF817: lt(r.unusedF817, 2),
    respawn: lt(r.respawn, 3),
    replaceChar: lt(r.replaceChar, 2),
    dropWeapon: lt(r.dropWeapon, 2),
    teams: r.teams === 1 && playerCount === 4 ? 1 : 0,
    hideReticle: lt(r.hideReticle, 2),
    meseta: lt(r.meseta, 3),
    deathLevelUp: r.deathLevelUp < 200 ? r.deathLevelUp : 0,
    trapCounts: r.trapCounts.map((c) => (c > 20 ? 20 : c)) as [number, number, number, number],
    sonar: lt(r.sonar, 2),
    sonarCount: r.sonarCount < 100 ? r.sonarCount : 0,
    forbidScapeDolls: lt(r.forbidScapeDolls, 2),
    unknownA1: r.unknownA1,
    lives: r.lives < 100 ? r.lives : 0,
    maxTechLevel: r.maxTechLevel === 0xff || r.maxTechLevel < 0x1e ? r.maxTechLevel : 0,
    charLevel: r.charLevel <= 199 ? r.charLevel : 0,
    timeLimit: r.timeLimit <= 0x278d0 ? r.timeLimit : 0,
    deathTechLevelUp: r.deathTechLevelUp < 0x1e ? r.deathTechLevelUp : 0,
    boxDropArea: r.boxDropArea,
  };
}

// Team numbers the way InitializeSinowberillChallenge assigns them: with teams on
// and four players, the present slots alternate starting with team 2
// (slots 0 and 2 = 2, slots 1 and 3 = 1); otherwise nobody has a team (0).
export function assignTeams(present: boolean[], teamsOn: boolean): number[] {
  const out = [0, 0, 0, 0];
  if (!teamsOn) return out;
  let flip = 1;
  for (let i = 0; i < 4; i++) {
    if (!present[i]) continue;
    flip = 1 - flip;
    out[i] = flip === 0 ? 2 : 1;
  }
  return out;
}

// --- what the rules do to the local character -----------------------------------

export interface LocalRestrictions {
  removeWeapons: boolean; // weapons and armor / shield / units out of the inventory (phases 1..3, all three modes)
  removeMags: boolean;
  removeTools: boolean;
  clearTechs: boolean; // tech disk mode FORBID_ALL: every technique reset
  limitTechLevel: number | null; // LIMIT_LEVEL: the cap (0..29)
  replaceCharLevel: number | null; // the overlay level (stats from level 1)
  clearMeseta: boolean;
  removeScapeDolls: boolean;
  keepWeaponOnDeath: boolean; // unknown_flags_2 keap_weapon_on_drop
  lives: number | null; // respawn mode LIMIT_LIVES
  traps: [number, number, number, number] | null; // trap mode ALL_PLAYERS: counts by internal type
  sonarCount: number | null;
}

// SinowberillChallengePlayer_ResetAll_00690674 (dump 572006), per player. The phase
// values are the effective struct's bytes (ValidateChallenge*Index validators):
//   weapons and armor: ValidateChallengePhaseIndex_006a8ecc = weaponAndArmor, 1..3
//     (all three modes call RemoveTechsAndEquipment for weapons and for armors; the
//     removal itself does not look at the mode, dump 590938);
//   mags: ValidateChallengeSubPhaseIndex_006a8edc = mag, 1 (FORBID_ALL);
//   tools: ValidateChallengeWaveIndex_006a8eec = tool, 1..2;
//   replace char: GetSinowberillChallengeState_006a8f0c = replaceChar, 1 (apply_base_stats);
//   meseta: ValidateChallengePhaseIndexC_006a8f4c = meseta, != 0 (the battleparams
//     meseta field, which the Challenge item list shows as Meseta).
// newserv does the same to the server-side character (Client::create_battle_overlay:
// remove types 0 and 1 for any mode but ALLOW, type 2 for FORBID_ALL, type 3 for a
// tool mode but ALLOW, type 3 subtype 9 for scape dolls).
export function localRestrictions(e: EffectiveRules): LocalRestrictions {
  return {
    removeWeapons: e.weaponAndArmor >= WEAPON_ARMOR.clearAndAllow && e.weaponAndArmor <= WEAPON_ARMOR.forbidRares,
    removeMags: e.mag === MAG_MODE.forbidAll,
    removeTools: e.tool === TOOL_MODE.clearAndAllow || e.tool === TOOL_MODE.forbidAll,
    clearTechs: e.techDisk === TECH_DISK.forbidAll,
    limitTechLevel: e.techDisk === TECH_DISK.limitLevel ? e.maxTechLevel : null,
    replaceCharLevel: e.replaceChar === 1 ? e.charLevel : null,
    clearMeseta: e.meseta !== MESETA_MODE.allow,
    removeScapeDolls: e.forbidScapeDolls === 1,
    keepWeaponOnDeath: e.dropWeapon === 1,
    lives: e.respawn === RESPAWN_MODE.limitLives ? e.lives : null,
    traps: e.trapMode === TRAP_MODE.allPlayers ? [...e.trapCounts] as [number, number, number, number] : null,
    sonarCount: e.sonar === 1 ? e.sonarCount : null,
  };
}

// --- sonar -----------------------------------------------------------------------
//
// The rule count reaches the player as a 4-byte value at player +0x8a0 (the dump's
// `last_attack_type`, a misnamed field): ResetAll writes it through
// SetSinowberillChallengeValue_00697944 (clamped to 0..99) when the effective enable
// byte is 1 (dump 572192; the enable is ValidateChallengePhaseIndexD_006a8f5c). The
// use is the Challenge item list's row 5 (ChallengePlayer_ProcessListSelection_0075158c
// -> state 0x11), state 0x12 of ChallengePlayer_StateMachine_00750954 (dump 723500):
// CreateSinowberillChallengeEntityManager_006b08b8 must return 1 (only on the battle
// spaceship and ruins maps, and only while g_SinowberillChallengeEntityManager_00a94b4c
// is 0), then DecrementCounterAndClamp(+0x8a0, 1).
//
// The manager (vtable 0x00b3a888, constructor 006b0970, update 006b0744; dump 602277..602400
// and the update decompiled with tools/ghidra/decomp.sh, 2026-10-23) is a proximity ping, not
// a reveal: it writes no minimap or enemy state. Its constructor sets +0x1c = 0x3de (990, the
// life) and +0x20 = 0x1e (30, the ping timer). Each frame: the life drops by one and the
// object is removed at 0 (the destructor clears the global, so a new use is allowed again);
// while the life is above 0x5a (90) the ping timer drops by one and, at 0 or less, the ping
// runs: the nearest other player's squared XZ distance (of the four slots, from 2250000 =
// 1500^2 down) gives d = sqrt, near = max(d, 200), f = 1 - (near - 200) / 1300; the sound 0xb7
// (183) plays with pitch round(256 * f) (FUN_00814664 sets the pitch), and the timer becomes
// round(-53 * f) + 60 (7 frames when a player is at 200 or less, 60 when none is within 1500).
// So the ping runs for the first 900 frames (30 s at 30 Hz) of the 990. The exe does not
// test the other players' floor, and its `+0x30 & 0x800` skip is not named (ASSUMED: no
// remote player is skipped here). The first ping comes at frame 30.
export const SONAR_LIFE_FRAMES = 0x3de; // 990: +0x1c at construction (dump 602318)
export const SONAR_PING_FRAMES = 0x1e; // 30: +0x20 at construction
export const SONAR_SILENT_LIFE = 0x5a; // 90: no ping while the life is at or below this
export const SONAR_NEAR_DIST = 200; // 0x009695cc and 0x009695e0
export const SONAR_FAR_DIST = 1500; // sqrt(0x009695e4 = 2250000)
export const SONAR_PING_SOUND = 0xb7; // 183, play_directional_sound_effect(0xb7, 0, 0, 0)

export interface SonarPing {
  sound: number;
  pitch: number; // round(256 * f); 0 = no pitch change
  interval: number; // the next ping's frames
}

// The manager object. tick() is one frame of its update; it returns the ping when one runs.
export class SonarManager {
  life = SONAR_LIFE_FRAMES;
  private ping = SONAR_PING_FRAMES;

  get alive(): boolean {
    return this.life > 0;
  }

  // me: the owner's position (null when the owner has none, then every other player is far).
  tick(me: { x: number; z: number } | null, others: ReadonlyArray<{ x: number; z: number }>): SonarPing | null {
    if (this.life <= 0) return null;
    this.life -= 1;
    if (this.life < 1) return null; // removed (the exe sets the destroy flag)
    if (this.life <= SONAR_SILENT_LIFE) return null;
    this.ping -= 1;
    if (this.ping >= 1) return null;
    let min2 = SONAR_FAR_DIST * SONAR_FAR_DIST;
    if (me) {
      for (const o of others) {
        const d2 = (me.x - o.x) ** 2 + (me.z - o.z) ** 2;
        if (d2 <= min2) min2 = d2;
      }
    }
    const near = Math.max(Math.sqrt(min2), SONAR_NEAR_DIST);
    const f = (near - SONAR_NEAR_DIST) * -0.0007692307699471712 + 1;
    const pitch = roundEven(256 * f);
    this.ping = roundEven(-53 * f) + 60;
    return { sound: SONAR_PING_SOUND, pitch, interval: this.ping };
  }
}

export class SonarStock {
  count = 0;
  // The live manager (g_SinowberillChallengeEntityManager_00a94b4c); null when none.
  manager: SonarManager | null = null;

  // ResetAll: the rule count when the enable is on, else 0.
  setFromRules(sonarCount: number | null): void {
    this.count = sonarCount === null ? 0 : Math.max(0, Math.min(99, sonarCount));
    this.manager = null;
  }

  get active(): boolean {
    return this.manager !== null;
  }

  // One frame: the manager's update; its ping (if any) is returned for the caller to play.
  // A manager that ends is dropped here (the exe's destructor clears the global).
  tick(me: { x: number; z: number } | null, others: ReadonlyArray<{ x: number; z: number }>): SonarPing | null {
    const m = this.manager;
    if (!m) return null;
    const ping = m.tick(me, others);
    if (!m.alive) this.manager = null;
    return ping;
  }

  // The use: false (nothing changes) when the map is not a battle map, a manager is alive, or
  // the stock is empty. ASSUMED: the exe's list row 5 is greyed at 0 (its writer is not traced).
  use(battleMap: boolean): boolean {
    if (!battleMap || this.active || this.count < 1) return false;
    this.manager = new SonarManager();
    this.count--;
    return true;
  }

  // The battle's exit (the manager's global is cleared with the battle).
  clear(): void {
    this.manager = null;
  }
}

// --- scoring --------------------------------------------------------------------

// One score group: player +0x834 (kills), +0x844 (deaths), +0x854 (damage taken),
// +0x864 (damage given): {float score, float raw count}.
export interface ScoreGroup {
  score: number;
  raw: number;
}

// x87 frndint: round to nearest, ties to even (the FPU default the exe runs with).
export function roundEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export class PlayerScore {
  kills: ScoreGroup = { score: 0, raw: 0 };
  deaths: ScoreGroup = { score: 0, raw: 0 };
  taken: ScoreGroup = { score: 0, raw: 0 };
  given: ScoreGroup = { score: 0, raw: 0 };
  // The latest value other clients reported (6x7D what 3) or this one computed.
  points = 0;

  reset(): void {
    for (const g of [this.kills, this.deaths, this.taken, this.given]) {
      g.score = 0;
      g.raw = 0;
    }
    this.points = 0;
  }

  // HandleHitEffectText_006a9078: raw += n, score += n * weight; the weight is the
  // group's player weight when the other side is a player, else its enemy weight
  // (CalculateScaledEffectValue_006a90c4 is a stub in the dump: ASSUMED).
  private add(g: ScoreGroup, n: number, w: number): void {
    g.raw = f32(g.raw + n);
    g.score = f32(g.score + f32(n * w));
  }

  // ProcessExperienceGainEffect: this player killed `victim`.
  kill(victimIsPlayer: boolean, w: ScoreWeights): void {
    this.add(this.kills, 1, victimIsPlayer ? w.playerKill : w.enemyKill);
  }

  // DisplayExperienceTextHigherOffset: this player died to a player or an enemy.
  die(killerIsPlayer: boolean, w: ScoreWeights): void {
    this.add(this.deaths, 1, killerIsPlayer ? w.playerDeath : w.enemyDeath);
  }

  // ApplyHitEffectText: this player took `n` damage.
  takeDamage(n: number, fromPlayer: boolean, w: ScoreWeights): void {
    this.add(this.taken, n, fromPlayer ? w.playerTake : w.enemyTake);
  }

  // ApplyHitEffect / 6x8F: this player dealt `n` damage.
  giveDamage(n: number, toPlayer: boolean, w: ScoreWeights): void {
    this.add(this.given, n, toPlayer ? w.playerGive : w.enemyGive);
  }

  // CalculateTextHeightOffset_00691600: (kills) + (given - taken) - (deaths), each
  // group rounded first, plus the character's meseta times the weight while the
  // player is not dead; rounded again.
  total(w: ScoreWeights, meseta: number, dead: boolean): number {
    let v = roundEven(this.kills.score) + (roundEven(this.given.score) - roundEven(this.taken.score)) - roundEven(this.deaths.score);
    if (!dead) v = f32(v + f32(meseta * w.meseta));
    return roundEven(v);
  }
}

export interface PlaceEntry {
  id: number; // client id, -1 = empty
  place: number;
  points: number;
}

// The table current_battle_place_and_points (+ g_SinowberillChallengePlayerSlots):
// players in slot order are sorted by points descending with the exe's exchange
// sort, and each gets the index of the first entry of its tie run as its place
// (0 = first). With teams on, every player carries its team's sum.
export function rankPlayers(players: Array<{ id: number; points: number; team?: number }>, teams: boolean): PlaceEntry[] {
  let list = players.map((p) => ({ id: p.id, place: 0, points: p.points }));
  if (teams) {
    const sums = [0, 0];
    for (const p of players) sums[(p.team ?? 0) !== 1 ? 1 : 0]! += p.points;
    list = players.map((p) => ({ id: p.id, place: 0, points: sums[(p.team ?? 0) !== 1 ? 1 : 0]! }));
  }
  const n = list.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (list[i]!.points < list[j]!.points) {
        const t = list[i]!;
        list[i] = list[j]!;
        list[j] = t;
      }
    }
  }
  let p = 0;
  for (let i = 0; i < n; i++) {
    list[i]!.place = p;
    if (i < n - 1 && list[i]!.points !== list[i + 1]!.points) p = i + 1;
  }
  while (list.length < 4) list.push({ id: -1, place: 0, points: 0 });
  return list;
}

// The result window's title and place titles (PsoBB.exe: s_ChallengeScoreLabel at 0x009695a8 = "SCORE",
// g_SinowberillChallengeResultTitles at 0x009ccb64 = the pointers to "1st".."4th" at 0x00969588..0x009695a0).
export const RESULT_SCORE_LABEL = 'SCORE';
export const RESULT_TITLES = ['1st', '2nd', '3rd', '4th'] as const;

// The result rows as SinowberillChallengeEntity_PrintResults_006af27c writes them: one line per
// present player in place order, "%s %s" (s_ChallengeResultFormat at 0x0092c4f8) = the place title
// and the player's name. The exe prints no points in this list. The header is the SCORE label.
export function resultLines(entries: readonly PlaceEntry[], name: (id: number) => string): string[] {
  return [RESULT_SCORE_LABEL, ...entries.filter((e) => e.id >= 0).map((e) => `${RESULT_TITLES[e.place] ?? e.place + 1} ${name(e.id)}`)];
}

// get_ba_record (.c:609156): the local character's seven u16 battle record fields
// (place counts, disconnects, two unknown). Counters saturate at 0xFFFF.
export class BattleRecords {
  fields = [0, 0, 0, 0, 0, 0, 0];
  constructor(init?: ArrayLike<number>) {
    if (init) for (let i = 0; i < 7; i++) this.fields[i] = (init[i] ?? 0) & 0xffff;
  }
  private bump(i: number): void {
    this.fields[i] = Math.min(0xffff, this.fields[i]! + 1);
  }
  // The battle starts: a disconnect is counted (+0x1d0 + 1) until the result clears it.
  started(): void {
    this.bump(4);
  }
  // The result: the local place's counter goes up (only when somebody scored a
  // place above first, .c:600329), then the disconnect count comes down by one.
  finished(place: number, anyoneBehind: boolean): void {
    if (anyoneBehind && place >= 0 && place < 4) this.bump(place);
    this.fields[4] = Math.max(0, this.fields[4]! - 1);
  }
}

// --- the controller -------------------------------------------------------------

export type BattleState = 'init' | 'rules' | 'battle' | 'results' | 'exit' | 'accept' | 'rematch';

// Frame counts of the exe's states (30 per second).
export const RULES_FRAMES = 0xf0; // rules window, then the team window
export const READY_FRAMES = 900; // waiting for the others to finish loading
export const ACK_FRAMES = 0x1c2; // waiting for every start acknowledgment / score reply
export const LOADING_FRAMES = 0x96; // the loading bar after the start
export const DEATH_CHECK_FRAMES = 0x5a; // CheckPlayerDeath resend period
export const ALONE_FRAMES = 300; // nobody left to fight: the battle ends
export const RESULT_WAIT_FRAMES = 0x78; // results: first pause
export const RESULT_WAIT2_FRAMES = 0x5a;
export const INVULN_FRAMES = 0xe10; // invulnerability at the start and during the results

export interface BattleSlot {
  present: boolean;
  alive: boolean; // g_SinowberillChallengeSlotData: counts as still fighting
  team: number;
  points: number;
  acked: boolean;
}

export interface Battle7D {
  what: number;
  phase: number; // byte 5
  alive: number; // byte 7
  params: [number, number, number, number];
}

export function build7D(m: Battle7D): Uint8Array {
  // G_SetBattleModeData_6x7D (0x18): {7D 06 unused16} what phase unused alive u32 params[4]
  const b = new Uint8Array(0x14);
  const dv = new DataView(b.buffer);
  b[0] = m.what;
  b[1] = m.phase;
  b[3] = m.alive;
  for (let i = 0; i < 4; i++) dv.setUint32(4 + i * 4, m.params[i]! >>> 0, true);
  return b; // sendSubcommand adds the 4-byte header
}

export function parse7D(body: Uint8Array): Battle7D | null {
  if (body.length < 0x18) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    what: body[4]!,
    phase: dv.getInt8(5),
    alive: body[7]!,
    params: [dv.getUint32(8, true), dv.getUint32(0x0c, true), dv.getUint32(0x10, true), dv.getUint32(0x14, true)],
  };
}

export const ALL_FF: [number, number, number, number] = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];

// 6xCF (G_StartBattle_BB_6xCF, 0x34): the leader tells the server the rules; the
// last dword is the box drop count (SendBattleModeBoxDropPacket_006b0194).
export function build6xCF(rules: BattleRules, boxDropCount: number): Uint8Array {
  return encodeBattleRules(rules, boxDropCount); // 0x30 bytes after a 4-byte header
}

// 6x8F (G_AddBattleDamageScores_6x8F, 8): the victim's client reports who hit it.
export function build6x8F(targetId: number, amount: number): Uint8Array {
  const b = new Uint8Array(4);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, targetId, true);
  dv.setUint16(2, amount & 0xffff, true);
  return b;
}

// 6xD0 (G_BattleModeLevelUp_BB_6xD0, 8) and 6x9B (G_LevelUpAllTechniques_6x9B, 8): the
// respawn level-ups the server validates against the rules.
export function build6xD0(levels: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, levels, true);
  return b;
}
export const build6x9B = (levels: number): Uint8Array => build6xD0(levels);

// 6x83 place-trap subcommand (VERIFIED in PsoBB.exe handle_packet0x60_subcommand0x83):
// [0] 0x83, [1] 2 (size in words), [2..3] client id, [4..5] trap type, [6..7] count
// (the owner's count before the decrement).
export function build6x83(clientId: number, trapType: number, count: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint8(0, 0x83);
  dv.setUint8(1, 2);
  dv.setUint16(2, clientId, true);
  dv.setInt16(4, trapType, true);
  dv.setInt16(6, count, true);
  return b;
}
// 6x80 trap call: [0] 0x80, [1] 2, [2..3] client id (ASSUMED: the sender's id, not traced),
// [4..5] trap number, [6..7] what (VERIFIED offsets in handle_packet0x60_subcommand0x80).
export function build6x80(clientId: number, trapNumber: number, what: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint8(0, 0x80);
  dv.setUint8(1, 2);
  dv.setUint16(2, clientId, true);
  dv.setUint16(4, trapNumber, true);
  dv.setUint16(6, what, true);
  return b;
}
// The trap number (send_packet0x60_subcommand0x80): client * 0x50 + type * 0x14 + remaining.
export const trapNumber = (clientId: number, trapType: number, remaining: number): number => clientId * 0x50 + trapType * 0x14 + remaining;

// Time shown by the timer window (set_timer_text .c:734588): H'MM"SS, "9'59"59" from 10 hours.
export function formatBattleTimer(seconds: number): string {
  const s = Math.max(0, seconds | 0);
  if (Math.floor(s / 3600) >= 10) return `9'59"59`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}'${pad(Math.floor((s % 3600) / 60))}"${pad(s % 60)}`;
}

export interface BattleHost {
  localId: number;
  leaderId: () => number;
  present: () => boolean[]; // by client id 0..3
  log?: (msg: string) => void;
  send7D: (m: Battle7D) => void;
  send6xCF: (rules: BattleRules, boxDropCount: number) => void;
  // The local player's current points / alive state.
  localPoints: () => number;
  localAlive: () => boolean;
  // UI and side effects.
  showRules: (text: string) => void;
  showTeams: (names: string[][]) => void; // the two parties' client ids resolved by the caller
  closeWindows: () => void;
  setTimer: (seconds: number) => void;
  closeTimer: () => void;
  announce: (lines: string[]) => void; // the periodic score ranking
  results: (entries: PlaceEntry[], localPlace: number) => void;
  askRematch: () => Promise<'same' | 'no' | 'lobby' | null>; // leader only
  applyRestrictions: (e: EffectiveRules) => void;
  startBattle: () => void; // controls free, invulnerability off
  endBattle: () => void;
  exit: (aborted: boolean) => void;
  records?: BattleRecords;
}

export interface BattleOptions {
  setup: BattleSetup;
  host: BattleHost;
}

// SinowberillChallengeEntity (state field +0x1c, next state +0x24, sub state +0x20).
// The win particle (SinowberillChallengePlayer_HandleDetectionLogic_00689a74,
// dump line 555440, asm 0x00689a74; the name is the community's). Each update of a
// battle player, the exe checks: the battle phase (see below); the player's own slot
// entry (word 0 = its id) has its second short (the place, word 2) at 0; the
// target getter GetSinowberillChallengeTargetPlayer_006afc7c (asm 0x006afc7c) is
// nonzero, which is the flag (opcode_ba_close_msg 1, opcode_unknownF889 0, the
// battle start 1) and some slot with a player has a place other than 0; then
// not invisible (+0x30 & 0x2000000), no stealth suit, and movement 0x408000 clear.
// It then calls create_sdjz_particle(player +0x390, 0x114) (asm 0x00689b26).
// The battle phase is unknown_is_in_battle_mode (asm 0x00687c48: the dword
// 0xa942c0 == 1 and ValidateChallengePhaseIndex_006a8eb0 == 1).
// The port keeps no invisibility, stealth or movement state of the players, so
// those three checks always pass here (ASSUMED: nothing is hidden or cloaked).
export const WIN_PARTICLE = 0x114;

// The ids that get the win particle this update: the places (rankPlayers, place 0 =
// first) when the flag is on and somebody is not first. Empty slots (id -1) never count.
export function winParticleHolders(places: readonly PlaceEntry[], winFlag: boolean): number[] {
  if (!winFlag) return [];
  const present = places.filter((p) => p.id >= 0);
  if (!present.some((p) => p.place !== 0)) return [];
  return present.filter((p) => p.place === 0).map((p) => p.id);
}

export class BattleController {
  readonly setup: BattleSetup;
  private host: BattleHost;
  state: BattleState = 'init';
  private sub = 0;
  private next: BattleState | null = null;
  private timer = 0;
  effective: EffectiveRules;
  readonly slots: BattleSlot[] = [0, 1, 2, 3].map(() => ({ present: false, alive: true, team: 0, points: 0, acked: false }));
  remaining = 0; // seconds (+0x34)
  private limitSeconds = 0; // +0x38
  private elapsedFrames = 0;
  private aloneFrames = ALONE_FRAMES; // +0x40
  private deathCheck = DEATH_CHECK_FRAMES; // +0x58
  private announceLeft: boolean[] = [];
  private scoreFlow = 0; // +0x468: 0 idle, 1 gathering, 2 print
  private replies = 0; // g_SinowberillChallengeCounter
  places: PlaceEntry[] = [];
  localPlace = -1;
  finished = false;
  startPositions: number[] | null = null;

  constructor(opts: BattleOptions) {
    this.setup = opts.setup;
    this.host = opts.host;
    this.effective = effectiveRules(opts.setup.rules, 0);
  }

  private count(): number {
    return this.slots.filter((s) => s.present).length;
  }

  private sync(): void {
    const present = this.host.present();
    for (let i = 0; i < 4; i++) this.slots[i]!.present = !!present[i];
  }

  private go(s: BattleState): void {
    this.state = s;
    this.sub = 0;
  }

  // 6x7D from another client (SinowberillChallengeData_StateHandler_006af9b4).
  receive7D(from: number, m: Battle7D): void {
    switch (m.what) {
      case 0: {
        const map: Record<number, BattleState | undefined> = { 1: 'rules', 2: 'battle', 3: 'results', 4: 'exit', 5: 'exit', 6: 'rematch' };
        const s = map[m.phase];
        if (m.phase === 5) {
          this.host.exit(true);
          this.finished = true;
          return;
        }
        if (s) this.next = s;
        break;
      }
      case 2:
        break;
      case 3: {
        const id = m.params[0];
        const slot = this.slots[id];
        if (slot) {
          if (id !== this.host.localId) slot.points = m.params[1] | 0;
          slot.alive = m.alive !== 0;
        }
        this.replies++;
        break;
      }
      case 4: {
        const slot = this.slots[m.params[0]!];
        if (slot) slot.acked = true;
        break;
      }
      case 5:
        // OnPlayerDeath: answer with our own score and wait for everybody's.
        this.sendOwnScore();
        this.scoreFlow = 1;
        break;
      case 6:
        this.startPositions = m.params.map((p) => p & 0xffff);
        this.next = 'rematch';
        break;
      default:
        break;
    }
    void from;
  }

  // CheckPlayerDeath_006ae910: 6x7D what 3 {client, points, alive}.
  sendOwnScore(): void {
    const id = this.host.localId;
    const dead = !this.host.localAlive();
    const alive = this.slotCounts(dead);
    const points = this.host.localPoints();
    const me = this.slots[id];
    if (me) {
      me.points = points;
      me.alive = alive;
    }
    this.host.send7D({ what: 3, phase: 0, alive: alive ? 1 : 0, params: [id, points >>> 0, 0xffffffff, 0xffffffff] });
  }

  // Dead players are out when respawning is forbidden, or when lives ran out.
  private slotCounts(dead: boolean): boolean {
    if (!dead) return true;
    if (this.effective.respawn === RESPAWN_MODE.forbid) return false;
    if (this.effective.respawn === RESPAWN_MODE.limitLives && this.livesLeft === 0) return false;
    return true;
  }
  livesLeft = 0;

  // The local player died. Returns what the exe's dead-player routine does
  // (unknown_dead_player_return_to_p2_related .c:573511): 'out' (no respawn),
  // or 'respawn' with the level-ups it requests.
  onLocalDeath(): { result: 'respawn' | 'out'; levelUp: number; techLevelUp: number } {
    const e = this.effective;
    if (e.respawn === RESPAWN_MODE.forbid) return { result: 'out', levelUp: 0, techLevelUp: 0 };
    if (e.respawn === RESPAWN_MODE.limitLives) {
      if (this.livesLeft <= 0) return { result: 'out', levelUp: 0, techLevelUp: 0 };
      this.livesLeft--;
    }
    return { result: 'respawn', levelUp: e.deathLevelUp, techLevelUp: e.deathTechLevelUp };
  }

  // One 30 Hz frame.
  tick(): void {
    if (this.finished) return;
    this.sync();
    if (this.next && this.next !== this.state) {
      const n = this.next;
      this.next = null;
      this.go(n);
    }
    switch (this.state) {
      case 'init': this.tickInit(); break;
      case 'rules': this.tickRules(); break;
      case 'battle': this.tickBattle(); break;
      case 'results': this.tickResults(); break;
      case 'exit': this.tickExit(); break;
      case 'rematch': this.tickRematch(); break;
      default: break;
    }
  }

  // SetupSinowberillChallengePlayerData_006b02f8.
  private tickInit(): void {
    this.sync();
    const n = this.count();
    this.effective = effectiveRules(this.setup.rules, n);
    this.limitSeconds = this.effective.timeLimit * 60;
    this.remaining = this.limitSeconds;
    this.host.setTimer(this.remaining);
    if (this.host.records) this.host.records.started();
    if (this.host.localId === this.host.leaderId()) this.host.send6xCF(this.setup.rules, this.setup.rules.boxDropArea);
    const teams = assignTeams(this.slots.map((s) => s.present), this.effective.teams === 1);
    this.slots.forEach((s, i) => {
      s.team = teams[i]!;
      s.points = 0;
      s.alive = true;
      s.acked = false;
    });
    this.livesLeft = this.effective.respawn === RESPAWN_MODE.limitLives ? this.effective.lives : 0;
    this.host.applyRestrictions(this.effective);
    this.go('rules');
  }

  // SinowberillChallengeEntity_UpdateState0_006af54c.
  private tickRules(): void {
    switch (this.sub) {
      case 0:
        this.sub = 1;
        break;
      case 1:
        this.host.showRules(this.setup.message);
        this.timer = RULES_FRAMES;
        this.sub = 2;
        break;
      case 2:
        if (--this.timer < 1) this.sub = this.effective.teams === 1 ? 3 : 5;
        break;
      case 3: {
        const parties: string[][] = [[], []];
        this.slots.forEach((s, i) => {
          if (s.present && parties[s.team !== 1 ? 1 : 0]!.length < 2) parties[s.team !== 1 ? 1 : 0]!.push(String(i));
        });
        this.host.showTeams(parties);
        this.timer = RULES_FRAMES;
        this.sub = 4;
        break;
      }
      case 4:
        if (--this.timer < 1) this.sub = 5;
        break;
      case 5:
        this.timer = READY_FRAMES;
        this.sub = 6;
        break;
      case 6:
        this.timer--;
        // Players still flagged as loading (character flag 0x2000000) hold it, up to the timeout:
        // the host reports none (the web client has no such flag).
        this.host.closeWindows();
        this.host.send7D({ what: 4, phase: 0, alive: 0, params: [this.host.localId, 0xffffffff, 0xffffffff, 0xffffffff] });
        this.slots[this.host.localId]!.acked = true;
        this.timer = ACK_FRAMES;
        this.sub = 7;
        break;
      case 7: {
        this.timer--;
        const all = this.slots.every((s) => !s.present || s.acked);
        if (all || this.timer < 1) {
          this.timer = LOADING_FRAMES;
          this.sub = 8;
        }
        break;
      }
      case 8:
        if (--this.timer < 1) {
          this.host.startBattle();
          this.go('battle');
        }
        break;
      default:
        break;
    }
  }

  // SinowberillChallengeEntity_UpdateState2_006aea34.
  private tickBattle(): void {
    if (this.sub === 0) {
      this.elapsedFrames = 0;
      this.scoreFlow = 0;
      this.replies = 0;
      this.aloneFrames = ALONE_FRAMES;
      this.deathCheck = DEATH_CHECK_FRAMES;
      this.announceLeft = this.setup.announce.map((a) => a !== 0);
      this.sub = 1;
    }
    if (this.count() < 2) {
      // Alone: 6x7D what 0 phase 5, the abort (the others see the disconnect).
      this.host.send7D({ what: 0, phase: 5, alive: 0, params: [0, 0, 0, 0] });
      this.host.exit(true);
      this.finished = true;
      return;
    }
    const teams = this.effective.teams === 1;
    if (teams) {
      const t = [false, false];
      this.slots.forEach((s) => {
        if (s.present) t[s.team !== 1 ? 1 : 0] = true;
      });
      if (!t[0] || !t[1]) {
        this.host.send7D({ what: 0, phase: 5, alive: 0, params: [0, 0, 0, 0] });
        this.host.exit(true);
        this.finished = true;
        return;
      }
    }
    this.elapsedFrames++;
    // The clock: elapsed whole seconds against the limit (limit 0 = no limit in the
    // exe? the subtraction clamps at 0, which would end it at once: kept as is).
    const elapsedSeconds = Math.floor(this.elapsedFrames / 30);
    this.remaining = Math.max(0, this.limitSeconds - elapsedSeconds);
    this.host.setTimer(this.remaining);
    if (this.remaining === 0) {
      this.endBattle();
      return;
    }
    let fighting = 0;
    const sides = [false, false];
    this.slots.forEach((s) => {
      if (s.present && s.alive) {
        fighting++;
        sides[s.team !== 1 ? 1 : 0] = true;
      }
    });
    if ((teams && (!sides[0] || !sides[1])) || fighting < 2) {
      if (--this.aloneFrames < 1) {
        this.endBattle();
        return;
      }
    } else this.aloneFrames = 300;
    // Score announcements: the leader asks everybody at each announced minute.
    if (this.scoreFlow === 0) {
      if (this.host.localId === this.host.leaderId()) {
        for (let i = 0; i < 8; i++) {
          if (this.announceLeft[i] && Math.floor(elapsedSeconds / 60) === this.setup.announce[i]) {
            this.announceLeft[i] = false;
            this.host.send7D({ what: 5, phase: 0, alive: 0, params: ALL_FF });
          }
        }
      }
    } else if (this.scoreFlow === 1) {
      if (this.replies >= this.count()) this.scoreFlow = 2;
    } else if (this.scoreFlow === 2) {
      this.printScores();
      this.scoreFlow = 0;
      this.replies = 0;
    }
    if (--this.deathCheck < 1) {
      this.sendOwnScore();
      this.deathCheck = DEATH_CHECK_FRAMES;
    }
    this.places = this.rank();
  }

  private rank(): PlaceEntry[] {
    const list = this.slots.flatMap((s, id) => (s.present ? [{ id, points: s.points, team: s.team }] : []));
    return rankPlayers(list, this.effective.teams === 1);
  }

  // The players that get the win particle this update (winParticleHolders). Nobody once
  // the battle is finished.
  winHolders(): number[] {
    if (this.finished) return [];
    return winParticleHolders(this.places, this.setup.winEffects);
  }

  // PrintResults: the ranking lines of a mid-battle announcement.
  private printScores(): void {
    const places = this.rank();
    this.places = places;
    this.host.announce(places.filter((p) => p.id >= 0).map((p) => `${p.place + 1}:${p.id}`));
  }

  private endBattle(): void {
    this.host.send7D({ what: 0, phase: 3, alive: 0, params: [0, 0, 0, 0] });
    this.host.endBattle();
    this.go('results');
  }

  // SinowberillChallengeEntity_UpdateLoop_006ad9a8 states 0..4 (the result).
  private tickResults(): void {
    switch (this.sub) {
      case 0:
        this.sendOwnScore();
        this.scoreFlow = 1;
        this.replies = 0;
        this.timer = RESULT_WAIT_FRAMES;
        this.sub = 1;
        break;
      case 1:
        if (--this.timer < 1) {
          this.sendOwnScore();
          this.timer = RESULT_WAIT2_FRAMES;
          this.sub = 2;
        }
        break;
      case 2:
        if (--this.timer < 1) {
          this.timer = ACK_FRAMES;
          this.sub = 3;
        }
        break;
      case 3: {
        this.timer--;
        if (this.replies >= this.count() || this.timer < 1) {
          this.places = this.rank();
          const me = this.places.find((p) => p.id === this.host.localId);
          this.localPlace = me ? me.place : -1;
          const behind = this.places.some((p) => p.id >= 0 && p.place !== 0);
          this.host.records?.finished(this.localPlace, behind);
          this.host.closeTimer();
          this.host.results(this.places, this.localPlace);
          this.sub = 4;
          this.timer = 0;
        }
        break;
      }
      case 4:
        // The rematch question (leader) / waiting for the leader's answer (the others).
        if (this.host.localId === this.host.leaderId() && !this.asked) {
          this.asked = true;
          void this.host.askRematch().then((a) => {
            if (a === 'same') this.host.send7D({ what: 6, phase: 0, alive: 0, params: shuffleStarts(this.rand) });
            else this.host.send7D({ what: 0, phase: 4, alive: 0, params: [0, 0, 0, 0] });
            this.next = a === 'same' ? 'rematch' : 'exit';
            this.asked = false;
          });
        }
        break;
      default:
        break;
    }
  }
  private asked = false;
  rand: () => number = Math.random;

  private tickExit(): void {
    this.host.exit(false);
    this.finished = true;
  }

  // State 6: the floor is reset, then the same rules run again (ASSUMED: the
  // dump leaves the state after the spawn callback unread).
  private tickRematch(): void {
    this.go('init');
  }
}

// 6x7D what 6: the four start locations, a shuffled 0..3 (30 random swaps,
// .c:600519).
export function shuffleStarts(rand: () => number): [number, number, number, number] {
  const a: [number, number, number, number] = [0, 1, 2, 3];
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rand() * 4);
    const y = Math.floor(rand() * 4);
    if (x !== y) {
      const t = a[x]!;
      a[x] = a[y]!;
      a[y] = t;
    }
  }
  return a;
}
