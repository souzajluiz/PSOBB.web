// An enemy's technique hit on the local player: entity_hit_by_tech (0x00773afc) with the player as the
// defender (the vtable +0x60 call on the player) and an enemy as the attacker. The enemy casts pass
// tech_id = -1 (~foie in the dump: HandleVoloptTechHit, SpawnVoloptForm7HazardsAndCheckHits, the
// Dark Falz and Olga call sites, dump 190519..218432), so the early miss roll (get_player_tech_resist_
// chance, the case where tech_id != -1) and the tech boost never run for an enemy attacker.
//
// THE GROUPS (technique_group, dump 70351; the switch at 0x00773e3f, jump table 0x00977ea0):
//   0 fixed damage  : base * 0.2 (0x00978250), no resist.
//   1 Foie family   : (100 - EFR) * 0.002 * base; EFR = player +0x2f6.
//   2 Gibarta/Rabarta: (100 - EIC) * 0.002 * base; EIC = +0x2fa; then the freeze roll.
//   3 Zonde family  : (100 - ETH) * 0.002 * base; ETH = +0x2f8; then the shock roll.
//   4 Grants        : (100 - ELT) * 0.002 * base; ELT = +0x2fe.
//   5 Megid         : no damage; instant kill when the roll < (power - EDK) * 0.01; EDK = +0x2fc.
//   0x13 Barta      : (100 - EIC) * 0.002 * base; no status.
// Other groups are not damage groups here (the support groups act on the player's buffs).
//
// THE BASE (ASSUMED the attacker is a monster, id >= 0xc, so the player-attacker boost branch is
// skipped): base = max(0, bpMst) * 0.5 (0x00978278) + max(0, power). The MST term is dropped when the
// defender's +0x2d8 (its last killer's entity id, network.h) is >= 0x4000. power is the caller's
// argument: the technique's power (techPower(tech, level), e.g. Zonde level * 20 + 240, 0x0092092c /
// 0x00920930, the level from the enemy's battleparams) or the enemy's fixed row value.
//
// THE STATUS ROLLS. The freeze (group 2) and the shock (group 3) need the defender's state (+0x32c)
// to be 1, or CheckPlayerInvincibility(attacker) (CheckPlayerInvincibility_0077524c, called with the
// attacker in eax, dump 748478: 0 for any entity id above 0xfff, so an enemy attacker never passes it).
// A normal player's +0x32c is 0 (the challenge modes set 1..7, SinowberillChallengePlayer_SetChallengeType,
// dump 552703); so the enemy's freeze / shock lands only in state 1 (VERIFIED in the disassembly: the
// group-2 test at 0x774b22..0x774b30, the group-3 test at 0x774872..0x774880 use ebp = defender).
// The chances, for an enemy attacker (id 0x1000..0x3fff): max(0, resist / -100 + 0.75) with the
// resist EIC (group 2) or ETH (group 3) (0x00978264 = -100, 0x00978268 = 0.75; the quadratic branch of
// the group-2 chance is for player attackers only).
// The group-2 roll (FUN_007751b0) is always drawn; the group-3 roll only when the state gate passes.
//
// ApplyHitEffects_00773ab0 (the state-1 text) runs after every path; it is inert for state 0.
//
// THE RNG. Every handled path draws once before the switch (FUN_007751b0 at dump line 83), so
// `rng` is called in the exe's order: the first draw is the Megid roll (or unused), then the group-2
// roll after the damage, or the group-3 roll when its state gate passes.

import { statusChanceFromResist, type PlayerElements } from './playerresist.ts';

const f32 = Math.fround;

// The technique_group values the enemy hit uses (dump 70351).
export const ENEMY_HIT_GROUP = {
  fixed: 0,
  foie: 1,
  gibarta: 2,
  zonde: 3,
  grants: 4,
  megid: 5,
  barta: 0x13,
} as const;

export interface EnemyTechInput {
  group: number;
  // param_4 of entity_hit_by_tech (clamped at 0 here, as the exe's max(power, 0)).
  power: number;
  // The attacker's battleparams MST (bpMst, the +0x2 short of the enemy's battleparams).
  mst: number;
  // The defender's +0x2d8 (the last killer's entity id). ASSUMED 0 when the port does not keep it.
  lastKiller?: number;
  // DAT_00a9cd68 == 3 (Ultimate).
  ultimate?: boolean;
  // The defender's +0x32c (1 is the challenge state that lets a status land). A normal player is 0.
  defenderState?: number;
  // The local player's resist block (playerresist.ts).
  elements: PlayerElements;
  // FUN_007751b0: a float in [0, 1).
  rng: () => number;
}

export interface EnemyTechOutcome {
  // false for a group this path does not handle (the support groups).
  handled: boolean;
  // The damage after the (short) cast, 0 when there is none.
  damage: number;
  freeze: boolean;
  shock: boolean;
  // Megid: the kill roll's result and its chance (the kill sets the HP to 0 in the exe).
  megidKill: boolean;
  megidChance: number;
}

// The 16-bit signed cast the exe applies to the rounded damage ((short)local_30).
const wrap16 = (v: number): number => (v << 16) >> 16;

// The resist of the element the group reads (undefined for group 0 and the groups with no resist).
function groupResist(group: number, el: PlayerElements): number | undefined {
  switch (group) {
    case ENEMY_HIT_GROUP.foie:
      return el.efr;
    case ENEMY_HIT_GROUP.gibarta:
    case ENEMY_HIT_GROUP.barta:
      return el.eic;
    case ENEMY_HIT_GROUP.zonde:
      return el.eth;
    case ENEMY_HIT_GROUP.grants:
      return el.elt;
    case ENEMY_HIT_GROUP.megid:
      return el.edk;
    default:
      return undefined;
  }
}

// The damage of one enemy technique on the local player (the groups' damage, before the status rolls).
export function enemyTechOnPlayer(i: EnemyTechInput): EnemyTechOutcome {
  const none: EnemyTechOutcome = { handled: false, damage: 0, freeze: false, shock: false, megidKill: false, megidChance: 0 };
  const group = i.group;
  if (!(group === 0 || group === 1 || group === 2 || group === 3 || group === 4 || group === 5 || group === 0x13)) return none;
  const power = Math.max(0, f32(i.power));
  const mstTerm = (i.lastKiller ?? 0) < 0x4000 ? Math.max(0, i.mst) : 0;
  const base = f32(f32(mstTerm * 0.5) + power);
  const state = i.defenderState ?? 0;
  const r1 = i.rng(); // FUN_007751b0 before the switch (dump line 83)

  if (group === ENEMY_HIT_GROUP.megid) {
    // The kill is taken on (power - EDK) * 0.01 (0x0097826c) against the roll, no damage otherwise. The
    // gate (FUN_00807db8 = 1 blocks Megid) reads a table at 0x0097f040 indexed by the attacker's entity id;
    // for the monster ids the table holds no 0xb, so the gate is open (ASSUMED from the register flow).
    const edk = i.elements.edk;
    const chance = f32(f32(power - wrap16(edk)) * f32(0.01));
    const blocked = i.ultimate === true && (i.lastKiller ?? 0) > 0xfff;
    const kill = !blocked && r1 < chance;
    return { handled: true, damage: 0, freeze: false, shock: false, megidKill: kill, megidChance: chance };
  }

  if (group === 0) {
    const damage = wrap16(Math.trunc(f32(base * f32(0.2))));
    return { handled: true, damage, freeze: false, shock: false, megidKill: false, megidChance: 0 };
  }

  const resist = groupResist(group, i.elements) ?? 0;
  const damage = wrap16(Math.trunc(f32(f32((100 - wrap16(resist)) * f32(0.002)) * base)));
  if (group === ENEMY_HIT_GROUP.gibarta) {
    // Freeze: the roll is drawn at once; it lands on a state-1 player (the gate above).
    const r3 = i.rng();
    const chance = statusChanceFromResist(i.elements.eic);
    return { handled: true, damage, freeze: state === 1 && r3 < chance, shock: false, megidKill: false, megidChance: 0 };
  }
  if (group === ENEMY_HIT_GROUP.zonde) {
    // Shock: the roll is drawn only when the state gate passes (dump line 364).
    if (state !== 1) return { handled: true, damage, freeze: false, shock: false, megidKill: false, megidChance: 0 };
    const r = i.rng();
    const chance = statusChanceFromResist(i.elements.eth);
    return { handled: true, damage, freeze: false, shock: r < chance, megidKill: false, megidChance: 0 };
  }
  return { handled: true, damage, freeze: false, shock: false, megidKill: false, megidChance: 0 };
}
