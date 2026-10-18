// Photon blasts: the MAG's photon blast gauge, firing one from the action
// palette and what the six basic blasts do, as PsoBB.exe runs them (Ephinea
// 1.25.13, addresses are VAs).
//
// The gauge (player +0x4e4 block, +0x3c charge, +0x40 flags).
//   Damage dealt: unknown_melee_attack_2 (0x006997a0) and the ranged hit
//     (the weapon hit routine) compute calculate_pb_gain_from_hit inline:
//     gain = trunc(damage) / ((level + 1) * 15) (0x0093daa4 / 0x0093daa0),
//     at least 0 (0x0093da9c), level = the 0-based level (stats +0x18)
//     clamped to the class's maximum; then vtable +0x134. The special attack
//     (HandleSpecialAttack) adds nothing for the attacker.
//   Damage taken: try_hit_entity (0x007732b8 tail) on a local player defender:
//     calculate_pb_gain_from_hit (0x0069b4f0) of trunc(damage * 20).
//   vtable +0x134 = try_set_pb_charge (0x0069b550): only the local player
//     (+0x32c == 1), alive, with a MAG equipped, on a field
//     (is_current_map_safe) and a non-empty second palette page
//     (IsCharacterNameEmpty_006ab35c(+0x5ac, 1)); then set_pb_charge
//     (0x006a7e84): nothing at 100 (0x00966680) or more; charge + gain below
//     100 stays, else the charge is set to 100 and 6x39 (photon blast ready,
//     0x006a7ec4) goes out. subtract_pb_charge (0x006a7ee0) sends 6x3A when
//     the charge drops below 100 again.
//
// Firing. A palette slot with group 1 = 5 (the palette input dispatch of
// the player's input state, 0x0068a5xx area) starts input state
// use_photon_blast with group 2 at +0x4e6 when
// CanPlayerCastTechInCurrentState_0069a8c0 allows it: character flags without
// 0x20006, standing / walking / running / casting (+0x328 & 0x11e), the ready
// flag (+0x524 & 2) set and no blast already going (+0x524 & 1), no menu
// open, on a field. handle_input_state_use_photon_blast's
// dispatch: 0x708 invulnerable frames, the targeting system's list, then 6x49
// {client id} {i8 pb number, u8 0, u16 target count, u16 round(charge), u16 0,
// {u16 entity id, u16 hit box} x count} with size (0x34 - 2 * (0x14 - 2 *
// count)) >> 2. Its receiver (0x0069a6b4) sets +0x524 |= 4, joins the
// blast (0x006a836c), copies the targets and enters the state; when the
// motion passes its release frame (HandlePhotonBlastAnimationTransition_
// 0069f8e0) 6x37 {client id} {u16 round(charge), u16 0} goes out
// (SendPhotonBlastCompletionPacket_0069f93c).
//
// The effect (HandlePhotonBlastDamage_0067fa2c / ApplyPhotonBlastEffects_
// 0067ef10), per target, with the blast's base power from the table
// 0x009cb4e0 (0x2c bytes per blast: 500, 350, 1200, 500, 150, 0) and the
// caster's MAG synchro / IQ (data2[0] / data2[1]):
//   0 Farlla:  synchro * (ATP + equipment ATP) * 0.025 + IQ * 2.5 + base
//   1 Estlla:  EVP * synchro * 0.15 + IQ * 15 + base
//   2 Golla:   synchro * (ATP + equipment ATP) * 0.075 + IQ * 7.5 + base
//   3 Pilla:   ATA * synchro * 0.075 + IQ * 7.5 + base
//   4 Leilla:  IQ * 0.5 + base
//   5 Mylla & Youlla: min(IQ * 0.1, 20)
//   (0x0093bcf4 .. 0x0093bd14), then power *= gauge total * blasts joined *
//   0.01 (0x0093bc90). 0..3 hit each enemy target with entity_hit_by_tech
//   group 4 (the Grants group: damage = power * (100 - ELT) * 0.002); 4 runs
//   group 6 (Resta: HP + MST * 0.5 + power) on the caster and the party; 5
//   runs Anti (Reverser on a dead player), Deband and Shifta with that power
//   on them.

const f32 = Math.fround;

export const PB_FULL = 100; // 0x00966680
export const PB_INVULN_FRAMES = 0x708;
export const PB_TAKEN_SCALE = 20;
export const PB_GAIN_DIVISOR = 15; // 0x0093daa0

export const PB_NAMES = ['Farlla', 'Estlla', 'Golla', 'Pilla', 'Leilla', 'Mylla & Youlla'] as const;
// Base power of each blast (0x009cb4e0 + type * 0x2c).
export const PB_BASE = [500, 350, 1200, 500, 150, 0] as const;
// The three floats after it, the same for every blast (15, 150, 10); ASSUMED
// 150 is the reach of the blast's target list.
export const PB_RANGE = 150;
export const PB_MAX_TARGETS = 10;

// The gauge gain of damage dealt (`taken` = false) or taken.
export function pbGain(damage: number, level: number, taken: boolean, maxLevel = 199): number {
  const lv = Math.max(0, Math.min(maxLevel, level));
  const d = Math.trunc(taken ? f32(damage * PB_TAKEN_SCALE) : damage);
  return Math.max(0, f32(d / f32((lv + 1) * PB_GAIN_DIVISOR)));
}

export interface PbCaster {
  atp: number; // +0x2cc (with Shifta)
  equipAtp: number; // *(i16 *)+0x31c
  evp: number; // +0x2d0
  ata: number; // +0x2d4
  synchro: number; // MAG data2[0]
  iq: number; // MAG data2[1]
}

// The blast's power before the gauge factor.
export function pbBasePower(type: number, c: PbCaster): number {
  const base = PB_BASE[type] ?? 0;
  switch (type) {
    case 0:
      return f32(f32(c.synchro * (c.atp + c.equipAtp)) * f32(0.025)) + f32(c.iq * 2.5) + base;
    case 1:
      return f32(f32(c.evp * c.synchro) * f32(0.15)) + f32(c.iq * 15) + base;
    case 2:
      return f32(f32(c.synchro * (c.atp + c.equipAtp)) * f32(0.075)) + f32(c.iq * 7.5) + base;
    case 3:
      return f32(f32(c.ata * c.synchro) * f32(0.075)) + f32(c.iq * 7.5) + base;
    case 4:
      return f32(c.iq * 0.5) + base;
    case 5:
      return Math.min(f32(c.iq * f32(0.1)), 20);
    default:
      return 0;
  }
}

// power * gauge total * blasts joined * 0.01.
export function pbPower(type: number, c: PbCaster, total = PB_FULL, joined = 1): number {
  return f32(f32(total * joined * 0.01) * pbBasePower(type, c));
}

// Group 4's damage on an enemy.
export function pbDamage(power: number, elt: number): number {
  return f32(f32((100 - elt) * f32(0.002)) * power);
}

export type PbGaugeEvent = 'ready' | 'notReady';

// The local player's gauge.
export class PhotonBlastGauge {
  charge = 0;
  firing = false;

  get ready(): boolean {
    return this.charge >= PB_FULL;
  }

  // set_pb_charge. Returns 'ready' when it reached 100 (6x39).
  add(gain: number): PbGaugeEvent | null {
    if (this.charge >= PB_FULL || !(gain > 0)) return null;
    const v = f32(this.charge + gain);
    if (v < PB_FULL) {
      this.charge = v;
      return null;
    }
    this.charge = PB_FULL;
    return 'ready';
  }

  // The gauge empties when the blast goes off (ASSUMED: the client's own
  // reset was not traced; subtract_pb_charge sends 6x3A when it falls
  // below 100).
  spend(): PbGaugeEvent | null {
    const was = this.charge;
    this.charge = 0;
    return was >= PB_FULL ? 'notReady' : null;
  }
}
