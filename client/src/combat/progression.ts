// The local player's level, EXP and the stats that follow from them: max HP /
// TP, the EXP a kill is worth, and the level-up itself. Pure logic; the owner
// (render/combat.ts) feeds it the server's 6xBF / 6x30 and draws the result
// (classic/hud.ts).
//
// From PsoBB.exe (Ephinea 1.25.13, addresses are VAs):
//   - Max HP / TP, unknown_set_total_stats (0x0077xxxx, `.c:745936`):
//       max_hp = round(hp_from_materials + (stats.hp + level) * HP_FACTOR[job])
//       max_tp = round(tp_from_materials + (stats.mst + level) * TP_FACTOR[job])
//     where `level` is the 0-based level (battleparams_stats +0x18), the
//     material bonuses are the inventory's bytes 1 and 2 (player +0x2c0 / +0x2c2,
//     set by the player constructor from param_5[1] / param_5[2]), and the
//     factors are GetFloatTableValue_006ac420 / _006ac434: {hp, tp} pairs at
//     0x00968fc4 indexed by ValidatePlayerClassIndex_00694788 (player +0x3e4,
//     0 hunter / 1 ranger / 2 force) = {2.0, 1.0} {1.85, 1.0} {1.45, 1.5}; an
//     android (flags +0x964 & 0x10) takes the TP factor at 0x009691b0 = 0.0,
//     and a class with flag 4 gets max_tp = 0.
//   - 6xBF (handle_packet0x60_subcommand0xbf @ 0x006928c0) calls the player's
//     vtable +0x30, add_to_player_exp_and_clamp (0x006947dc): exp += amount,
//     clamped to [0, exp threshold of level 199].
//   - 6x30 (UpdatePlayerStatsAndLevelMessage_006928e4): for the local player
//     HandleInvincibilityAndEquipmentReset_00692c14 levels up from the level
//     table while the EXP reaches the next threshold
//     (ApplyCharacterStatAllocation_00692e84, at most to level 199), and hands
//     the stat differences to the level-up message (ChallengeEntityObject,
//     0x0073f97c); other players take the stats the command carries. Then, on
//     a field floor, max HP / TP are recomputed, HP and TP are refilled, and
//     "Level Up" (u"Level Up" @ 0x0093c818, "Level Down" @ 0x0093c800 when the
//     command's second u16 is 1) is shown over the player's head.
//   - The EXP a kill shows (handle_experience, `.c:762698`):
//       exp = enemy bp exp * (episode 2 ? 13 : 10), * 10 for the killer or * 8
//       for a player who only tagged it, / 100, * the lobby EXP multiplier
//     (unknown_xp_multiplier, set by 6xDD). newserv computes the amount it
//     grants with the same factors (ReceiveSubcommands.cc
//     on_enemy_exp_request_bb).

import { MAX_LEVEL, type BaseStats, type LevelTable } from '../formats/plyleveltbl.ts';

// Class flags (player +0x964, newserv class_flags_for_class): 0x10 android,
// 0x20 hunter, 0x40 ranger, 0x80 force.
// prettier-ignore
export const CLASS_FLAGS: readonly number[] = [0x25, 0x2a, 0x31, 0x45, 0x51, 0x52, 0x86, 0x89, 0x8a, 0x32, 0x85, 0x46];
const FLAG_ANDROID = 0x10;
const FLAG_RANGER = 0x40;
const FLAG_FORCE = 0x80;

// {hp, tp} factors per job, 0x00968fc4 (hunter, ranger, force).
export const HP_TP_FACTORS: readonly (readonly [number, number])[] = [
  [2.0, 1.0],
  [1.85, 1.0],
  [1.45, 1.5],
];
// 0x009691b0: the TP factor of an android.
export const ANDROID_TP_FACTOR = 0.0;

export type Job = 0 | 1 | 2;

export function jobOf(charClass: number): Job {
  const f = CLASS_FLAGS[charClass] ?? 0x20;
  return f & FLAG_FORCE ? 2 : f & FLAG_RANGER ? 1 : 0;
}

export function isAndroid(charClass: number): boolean {
  return ((CLASS_FLAGS[charClass] ?? 0) & FLAG_ANDROID) !== 0;
}

// The x87 ROUND of the decompiled code: round half to even, on float32 math.
export function roundEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function maxHpFor(charClass: number, hpStat: number, level: number, hpMaterials = 0): number {
  const factor = Math.fround(HP_TP_FACTORS[jobOf(charClass)][0]);
  return Math.max(1, roundEven(Math.fround(hpMaterials + Math.fround((hpStat + level) * factor))));
}

export function maxTpFor(charClass: number, mstStat: number, level: number, tpMaterials = 0): number {
  if (isAndroid(charClass)) return 0;
  const factor = Math.fround(HP_TP_FACTORS[jobOf(charClass)][1]);
  return Math.max(0, roundEven(Math.fround(tpMaterials + Math.fround((mstStat + level) * factor))));
}

// The EXP number handle_experience shows over a killed enemy.
// `challenge` is the Challenge Mode EXP multiplier (exp_multiplication): when a
// quest is running in a Challenge game, handle_experience (.c:762736) rounds
// the amount times it before the division by 100.
export function killExp(enemyExp: number, opts: { episode2: boolean; killer: boolean; multiplier?: number; challenge?: number }): number {
  let scaled = enemyExp * (opts.episode2 ? 13 : 10) * (opts.killer ? 10 : 8);
  if (opts.challenge !== undefined) scaled = Math.round(Math.fround(Math.fround(scaled) * Math.fround(opts.challenge)));
  return Math.trunc(scaled / 100) * (opts.multiplier ?? 1);
}

export interface CharacterStats7 extends BaseStats {}

export interface LevelUpResult {
  from: number; // 0-based levels
  to: number;
  // Differences in the order the level-up message shows them
  // (display_levelup_stats, 0x0073fa5c): HP, TP, then ATP, DFP, MST, ATA, EVP
  // (unitxt group 11 entries 0x9c..0xa0). LCK is computed but never shown.
  hp: number;
  tp: number;
  atp: number;
  dfp: number;
  mst: number;
  ata: number;
  evp: number;
  lck: number;
}

// The ATA the level-up message compares: round((weapon min ATA + ata) * 0.1)
// (BlendSinowberillChallengeState_00698088, factor at 0x0093ca14).
export const ATA_DISPLAY_FACTOR = 0.1;

export interface ProgressionState {
  charClass: number;
  level: number; // 0-based
  exp: number;
  stats: CharacterStats7;
  hpMaterials: number;
  tpMaterials: number;
}

export class PlayerProgression implements ProgressionState {
  charClass: number;
  level: number;
  exp: number;
  stats: CharacterStats7;
  hpMaterials: number;
  tpMaterials: number;
  readonly table: LevelTable;

  constructor(table: LevelTable, s: ProgressionState) {
    this.table = table;
    this.charClass = s.charClass;
    this.level = Math.max(0, Math.min(MAX_LEVEL, s.level));
    this.exp = s.exp;
    this.stats = { ...s.stats };
    this.hpMaterials = s.hpMaterials;
    this.tpMaterials = s.tpMaterials;
  }

  get maxHp(): number {
    return maxHpFor(this.charClass, this.stats.hp, this.level, this.hpMaterials);
  }

  get maxTp(): number {
    return maxTpFor(this.charClass, this.stats.mst, this.level, this.tpMaterials);
  }

  // EXP of the next level (null at the cap).
  get nextExp(): number | null {
    return this.level >= MAX_LEVEL ? null : this.table.expForLevel(this.charClass, this.level + 1);
  }

  // EXP still needed for the next level.
  get toNext(): number {
    const n = this.nextExp;
    return n === null ? 0 : Math.max(0, n - this.exp);
  }

  // 6xBF: add_to_player_exp_and_clamp.
  addExp(amount: number): void {
    const cap = this.table.maxExp(this.charClass);
    this.exp = Math.max(0, Math.min(cap, this.exp + amount));
  }

  // True when the EXP reaches the next level (what 6x30 checks before leveling).
  get canLevelUp(): boolean {
    const n = this.nextExp;
    return n !== null && this.exp >= n;
  }

  // The local player's 6x30: every level the EXP reaches, its gains from the
  // table (clamped at 0 like ClampAndApplyStatIncrement; the class maximums of
  // g_ClassMaxStats are not applied). `serverLevel` (the command's level) is
  // the floor: newserv already leveled the character, so the client never
  // ends below it.
  levelUp(serverLevel?: number, weaponMinAta = 0): LevelUpResult | null {
    const from = this.level;
    const before = { ...this.stats, maxHp: this.maxHp, maxTp: this.maxTp };
    const target = Math.min(MAX_LEVEL, Math.max(this.table.levelForExp(this.charClass, this.exp), serverLevel ?? 0));
    if (target <= from) return null;
    for (let l = from + 1; l <= target; l++) {
      const d = this.table.delta(this.charClass, l);
      const s = this.stats;
      s.atp += d.atp;
      s.mst += d.mst;
      s.evp += d.evp;
      s.hp += d.hp;
      s.dfp += d.dfp;
      s.ata += d.ata;
      s.lck += d.lck;
    }
    this.level = target;
    const ata = (v: number) => roundEven(Math.fround((weaponMinAta + v) * Math.fround(ATA_DISPLAY_FACTOR)));
    return {
      from,
      to: target,
      hp: this.maxHp - before.maxHp,
      tp: this.maxTp - before.maxTp,
      atp: this.stats.atp - before.atp,
      dfp: this.stats.dfp - before.dfp,
      mst: this.stats.mst - before.mst,
      ata: ata(this.stats.ata) - ata(before.ata),
      evp: this.stats.evp - before.evp,
      lck: this.stats.lck - before.lck,
    };
  }

  // Another source set the stats (6x30 of a remote player, or a resync).
  setStats(stats: Partial<CharacterStats7>, level?: number): void {
    Object.assign(this.stats, stats);
    if (level !== undefined) this.level = Math.max(0, Math.min(MAX_LEVEL, level));
  }
}

// The lines display_levelup_stats (0x0073fa5c) adds to the player's message
// window, one every 0x16 frames: each starts with unitxt(11, 0x59) (15
// spaces), then "LEVEL " (u"LEVEL " @ 0x00972da4) and the new displayed level,
// "HP +" (0x00972db4) / "TP +" (0x00972dc0) with the max HP / TP gain, and
// unitxt(11, 0x9c..0xa0) ("ATP" "DFP" "MST" "ATA" "EVP") + " +" (0x00972dcc)
// for each gain above zero.
export const LEVEL_UP_LINE_FRAMES = 0x16;
export const LEVEL_UP_INDENT = ' '.repeat(15);

export function levelUpLines(r: LevelUpResult, statNames: readonly string[] = ['ATP', 'DFP', 'MST', 'ATA', 'EVP']): string[] {
  const out = [`LEVEL ${r.to + 1}`];
  if (r.hp > 0) out.push(`HP +${r.hp}`);
  if (r.tp > 0) out.push(`TP +${r.tp}`);
  [r.atp, r.dfp, r.mst, r.ata, r.evp].forEach((v, i) => {
    if (v > 0) out.push(`${statNames[i]} +${v}`);
  });
  return out.map((l) => LEVEL_UP_INDENT + l);
}
