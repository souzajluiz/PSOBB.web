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

// Per-slot blast state (the exe's something_about_photon_blasts, the global at
// 0x00a90420, 36 bytes per room slot 0..3). GetPhotonBlastData_0067e334 (dump
// 547338) returns 1 or 2 for a slot whose state is non-zero, and the status
// icon code (QuickMenuUpdateShiftaStatusIcons_007426d8, dump 712999; the party
// windows, dump 713040) draws the photon blast icon from that alone, not from
// the gauge.
//   Writers (every store to 0x00a90420 in the disassembly): 0 in the init
//   (0x0067ded3, 0x006801e4) and the shutdown (0x0067e060); 2 in the blast
//   object's constructor PhotonBlast_Constructor_0067ec51 (0x0067ed22), for each
//   participant slot (+0x60..+0x6c, below 4), after the copy of the blast data.
//   State 1 has no store in the exe (the 1 branch of GetPhotonBlastData is dead
//   code as far as the direct stores show; ASSUMED none through a register base).
//   Clear: the blast object's destructor PlayerBaseDestructor_0067ddc6 (dump
//   547137) clears every participant slot of the object when its caster slot
//   (+0x3c) is below 4, whatever else set the slot since.
//   Lifetime: the constructor runs in CreatePhotonBlast (dump 547409), called
//   from ResetWeaponStateForUnsafeMap (dump 585705) on a weapon special's
//   state 3 with flag 8 (Player__UpdateWeaponAttackAnimation, dump 585590). The
//   object's update sets the due-for-destruction bit (+0x8 bit 0,
//   0x00 67ee70 / 0x0067eedc) when its frame counter passes its delay (remote
//   branch) or in phase 2 of its state machine (the local SpawnBossEntity_
//   0067f5b4, dump 548066: the damage, then `+8 |= 1`), and
//   RecursiveGameObjectUpdate_0081888c (dump 836060) destructs it on the next
//   walk. So the state lives from the blast's start to its effect.
//   Participants (ASSUMED in the port): the caster only. The exe also adds the
//   same-room players that are in a weapon special (the joined blasts), which
//   the port does not model.
export const PB_SLOT_NONE = 0;
export const PB_SLOT_ONE = 1; // no store in the exe (see above)
export const PB_SLOT_BLAST = 2;

export class PhotonBlastSlots {
  private readonly state = [PB_SLOT_NONE, PB_SLOT_NONE, PB_SLOT_NONE, PB_SLOT_NONE];

  // PhotonBlast_Constructor_0067ec51: each participant below 4 gets state 2.
  start(participants: readonly number[]): void {
    for (const slot of participants) if (slot >= 0 && slot < 4) this.state[slot] = PB_SLOT_BLAST;
  }

  // PlayerBaseDestructor_0067ddc6: when the caster slot is below 4, every
  // participant below 4 goes back to 0.
  end(caster: number, participants: readonly number[]): void {
    if (!(caster >= 0 && caster < 4)) return;
    for (const slot of participants) if (slot >= 0 && slot < 4) this.state[slot] = PB_SLOT_NONE;
  }

  // The init (0x0067ded3) and the shutdown (0x0067e060) clear all four.
  reset(): void {
    for (let i = 0; i < 4; i++) this.state[i] = PB_SLOT_NONE;
  }

  get(slot: number): number {
    return slot >= 0 && slot < 4 ? this.state[slot] : PB_SLOT_NONE;
  }

  // GetPhotonBlastData_0067e334 returns 1 or 2: the slot has a blast icon.
  active(slot: number): boolean {
    const s = this.get(slot);
    return s === PB_SLOT_ONE || s === PB_SLOT_BLAST;
  }
}

// The blast object's joins and gate (CreatePhotonBlast, PsoBB.exe dump 547409;
// the object is built at 0x0067e9e0, the dump's PhotonBlast_Constructor_0067ec51
// name is off, its vtable store 0x00b38328 is at 0x0067ea4b).
//   Participants: the same-room players (the caster's room, the caster included)
//   whose weapon data field is not -1, in slot order (the grouping by field is
//   not modelled). The port does not track a remote's weapon field, so the
//   joined blasts are ASSUMED to be the caster alone (the caller passes its entry).
//   Gate (0x67e6c0 loop, dump 547409 "bVar1"): when any other same-room player's
//   state (the 0x00a90420 slot byte) is not 0, no blast object is made: the
//   blast does not start and its effect does not run.
export interface PbWeaponEntry {
  slot: number;
  field: number; // GetWeaponDataField, -1 = none
}

export function pbParticipants(sameRoom: readonly PbWeaponEntry[]): number[] {
  const out: number[] = [];
  for (const e of [...sameRoom].sort((a, b) => a.slot - b.slot)) {
    if (e.slot < 0 || e.slot >= 4 || e.field === -1 || out.includes(e.slot)) continue;
    out.push(e.slot);
  }
  return out;
}

// Gate: true when another player's blast state blocks a new blast (the exe's
// bVar1 in CreatePhotonBlast). `self` is the caster and is skipped.
export function pbBlockedBy(slots: PhotonBlastSlots, self: number): boolean {
  for (let i = 0; i < 4; i++) if (i !== self && slots.get(i) !== PB_SLOT_NONE) return true;
  return false;
}

// Blast end timing. The delay the constructor stores (CreatePhotonBlast passes
// (n * 150 + 100) with n = the index of the first empty participant entry; when
// all four entries are filled n stays 0, so the delay is 100: exe quirk, kept).
export const PB_DELAY_BASE = 100;
export const PB_DELAY_STEP = 150;
export function pbDelayFor(participants: number): number {
  const n = Math.max(0, Math.min(4, participants));
  return n >= 4 ? PB_DELAY_BASE : PB_DELAY_BASE + PB_DELAY_STEP * n;
}

// Counter branch (the object's +0x4c == 0, a blast from a room the local player
// is not in): UpdatePhotonBlastState_0067eed0 adds 1 to the frame counter (+0x44)
// each update and runs the effect when the delay (+0x48) is below it, so the
// effect is on update delay + 1. ASSUMED: one object update per game tick.
export function pbCounterEndUpdates(participants: number): number {
  return pbDelayFor(participants) + 1;
}

// Local branch (+0x4c != 0, the caster's room is the local player's room):
// SpawnBossEntity_0067f5b4 (dump 548066) spawns one boss entity per participant
// (phase 0 spawns, phase 1 clears the entity's flags 4 / 0x10), then phase 0 at
// index == count goes to phase 2, and phase 2 runs the damage (the 0xae sound,
// HandlePhotonBlastDamage_0067fa2c) and sets due-for-destruction. With one
// update per tick and no construction wait (ASSUMED: CheckEntityStepConstructed
// is true at once) the effect is on update 2n + 2.
export function pbLocalEndUpdates(participants: number): number {
  const n = Math.max(0, participants);
  return 2 * n + 2;
}

// The effect's update number for a blast from `participants` joined players.
// `sameRoom` picks the branch as CheckPlayerInSameRoom_0067e97c does (the local
// player is the caster or in the caster's floor and room).
export function pbEndUpdates(participants: number, sameRoom: boolean): number {
  return sameRoom ? pbLocalEndUpdates(participants) : pbCounterEndUpdates(participants);
}

// ASSUMED: the blast object is made about one second after the fire, when the
// weapon attack state machine reaches state 3 with the special flag
// (Player__UpdateWeaponAttackAnimation, dump 585590, timed by the animation;
// not traced). The fire-to-effect delay is that plus the effect's updates.
export const PB_CREATE_TICKS_ASSUMED = 30;

// tickTechHits runs an entry with `ticks` k on its (k + 1)-th call, so the
// entry for update N (the first update is the tick after the object exists)
// holds N - 1.
export function pbTechHitTicks(participants: number, sameRoom: boolean): number {
  return PB_CREATE_TICKS_ASSUMED + pbEndUpdates(participants, sameRoom) - 1;
}
