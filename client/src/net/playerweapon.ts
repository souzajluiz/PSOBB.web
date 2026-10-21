// The weapon a player holds, read from a PlayerInventory: the inventory of the
// 0x520 join entries (65/67/68, at 0x44) and of the 6x70 sync (at 0x164).
// Layout (newserv PlayerInventory, as net/charfile.ts reads it): u8 count at
// 0, then 30 records of 0x1C from offset 4: u32 flags at +4 (0x08 = equipped),
// ItemData at +8 (data1 at +8..+19, item id u32 at +20).
//
// Remote equips: the 6x25 (equip {item id, slot}) and 6x26 (unequip {item id})
// subcommands of other players change their inventory copy; only the weapon
// slot is tracked here (the held weapon is the only equipment drawn).

export const INVENTORY_BYTES = 4 + 30 * 0x1c;
const RECORD = 0x1c;
const FLAG_EQUIPPED = 0x08;
const CLASS_WEAPON = 0; // data1[0]

function recordCount(inv: Uint8Array): number {
  return Math.min(inv[0] ?? 0, 30);
}

function itemId(inv: Uint8Array, o: number): number {
  return (inv[o + 20] | (inv[o + 21] << 8) | (inv[o + 22] << 16) | (inv[o + 23] << 24)) >>> 0;
}

// data1 (12 bytes) of the equipped weapon, or null.
export function equippedWeaponOf(inv: Uint8Array): Uint8Array | null {
  for (let i = 0; i < recordCount(inv); i++) {
    const o = 4 + i * RECORD;
    if (o + RECORD > inv.length) break;
    if (inv[o + 4] & FLAG_EQUIPPED && inv[o + 8] === CLASS_WEAPON) return inv.slice(o + 8, o + 20);
  }
  return null;
}

// Applies an equip (6x25) or unequip (6x26) of another player to its
// inventory copy, weapons only. Returns true when the equipped weapon may have
// changed (the caller then reads equippedWeaponOf again).
export function applyRemoteEquip(inv: Uint8Array, id: number, equip: boolean): boolean {
  let target = -1;
  for (let i = 0; i < recordCount(inv); i++) {
    const o = 4 + i * RECORD;
    if (o + RECORD > inv.length) break;
    if (itemId(inv, o) === (id >>> 0)) target = o;
  }
  if (target < 0 || inv[target + 8] !== CLASS_WEAPON) return false;
  if (!equip) {
    if (!(inv[target + 4] & FLAG_EQUIPPED)) return false;
    inv[target + 4] &= ~FLAG_EQUIPPED;
    return true;
  }
  // One weapon slot: the equipped weapon is unequipped first.
  for (let i = 0; i < recordCount(inv); i++) {
    const o = 4 + i * RECORD;
    if (o + RECORD <= inv.length && inv[o + 8] === CLASS_WEAPON) inv[o + 4] &= ~FLAG_EQUIPPED;
  }
  inv[target + 4] |= FLAG_EQUIPPED;
  return true;
}
