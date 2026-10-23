// The trade zone bits (exe g_TradeStateFlags bits 0..3, one per player slot): the
// TObjTradeCollision map objects set and clear them, and the trade reads them.
//
// Exe side (PsoBB.exe 1.25.13, dump refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//   the object: entity type 0x57 (TObjTradeCollision, the port's entitynames.ts) is
//     created by CreateDerolleMapObject_00667ab4, the factory in the object table at
//     0x00a06f80 (record 87 -> 0x00667ab4; read with tools/exedata.py, checked against
//     the .data pointer table, not against the dump's name, which is the generic one)
//   the check: DerolleMapObjectVisibilityCheck_00667bb5 (dump 531369; disassembly
//     0x667bb5..0x667c3a). Per slot 0..3, in order:
//       no player in the slot (GetPlayer_0068d5a8 null)            -> clear (ClearTradeStateFlag_00825ff4)
//       scene != logged_in (11), or g_QuestStarted == 1,
//         or the player's floor != g_CurrentFloor                  -> clear
//       squared XZ distance < radius^2 (the radius is the object's
//         +0xac, init data param 1)                                -> clear
//       otherwise, when the object's initdata param 4 (+0x84) is non-zero -> set (SetTradeStateFlag_00825fe0)
//   the reads: IsTradeStateFlagSet_00825ac0 in ValidateTradePartner_00825a74 and
//     ValidateLocalPlayerTradeState_00825bac: a CLEAR bit runs ProcessTradeAcceptance_00825ae4
//     (the partner / I are cancelled out of the trade).
//
// So a trade is allowed only where a collision object with a non-zero param 4 has the
// player OUTSIDE its radius (the bit is set there), and it is cancelled inside the radius.
// That reads inverted for a "zone"; the exe is taken as written. ASSUMED: nothing else
// writes the bits (the dump's writers are the two helpers and the reset at 838511, which
// keeps bits 0..3).
//
// ASSUMED (the port): the check runs once per game tick while a field floor is loaded
// (the exe's object update rate is not traced); outside a field (the lobby, where the port
// loads no set objects) the trade keeps the permissive reading (inZone is true), as before.

import type { Vec3 } from '../formats/setdata.ts';

// The entity type of TObjTradeCollision (entitynames.ts 0x0057).
export const TRADE_COLLISION_TYPE = 0x57;
// The player slots the bits cover (g_TradeStateFlags bits 0..3).
export const TRADE_ZONE_SLOTS = 4;
// The logged_in scene (exe enum scene, dump line 90487).
export const SCENE_LOGGED_IN = 11;

// A TObjTradeCollision on the floor: its world position (XZ), the radius (init data
// param 1, set record +0x28) and the param 4 (set record +0x34, an i32).
export interface TradeZoneObject {
  x: number;
  z: number;
  radius: number;
  param4: number;
}

// The players as the exe reads them (GetPlayer_0068d5a8 and the player's +0x38 / +0x3f0).
export interface TradeZoneWorld {
  // The player in a slot, or null when the slot is empty.
  player(slot: number): { x: number; z: number; floor: number } | null;
  // g_CurrentFloor.
  floor: number;
  // get_current_scene() == logged_in and g_QuestStarted != 1: false clears every bit.
  counts: boolean;
}

// One object's check (DerolleMapObjectVisibilityCheck_00667bb5): the new flags.
export function tradeZoneCheck(flags: number, obj: TradeZoneObject, world: TradeZoneWorld): number {
  let out = flags;
  // The radius is compared as the exe's float32 (fmul of the loaded radius, then fstps).
  const r2 = Math.fround(obj.radius * obj.radius);
  for (let slot = 0; slot < TRADE_ZONE_SLOTS; slot++) {
    const bit = 1 << slot;
    const p = world.player(slot);
    if (!p || !world.counts || p.floor !== world.floor) {
      out &= ~bit;
      continue;
    }
    const dx = p.x - obj.x;
    const dz = p.z - obj.z;
    if (dx * dx + dz * dz < r2) {
      out &= ~bit;
      continue;
    }
    if (obj.param4 !== 0) out |= bit;
  }
  return out;
}

// The trade's view of the zone bits (net/tradeio.ts inTradeZone).
export class TradeZone {
  flags = 0;
  private inField = false;

  // A field floor is loaded: the bits are driven by its collision objects.
  enterField(): void {
    this.inField = true;
  }

  leaveField(): void {
    this.inField = false;
  }

  // IsTradeStateFlagSet_00825ac0 for a slot. Outside a field the port keeps the permissive reading.
  inZone(slot: number): boolean {
    if (!this.inField) return true;
    return ((this.flags >> slot) & 1) === 1;
  }

  check(obj: TradeZoneObject, world: TradeZoneWorld): void {
    this.flags = tradeZoneCheck(this.flags, obj, world);
  }
}

// The collision object of a placed set entry: its XZ position and the two parameters.
export function tradeZoneObject(world: Vec3, params: readonly number[]): TradeZoneObject {
  return { x: world[0], z: world[2], radius: params[0] ?? 0, param4: params[3] ?? 0 };
}
