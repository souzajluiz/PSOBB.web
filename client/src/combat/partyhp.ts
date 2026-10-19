// The other players' HP as the local client keeps it, for the party members'
// windows (classic/hud.ts PartyWindows). PsoBB.exe (Ephinea 1.25.13) holds a
// player entity per client with hp / max_hp1; the 6x subcommands that change
// a remote player's HP:
//   6x4B / 6x4C (action_get_hit_flinch / _fall, 0x0069aa2c / 0x0069aaf4):
//     ClampEntityHP_00770b58(player, current_hp) unless the player is dead.
//   6x2F (HandlePlayerHPModification_006933c0): {u32 type, i16 amount, u16
//     client id}, ignored for a dead player; type 0 sets (ClampEntityHP),
//     1 adds (add_player_hp), 2 adds max_hp1 (back to full).
//   6x30 (UpdatePlayerStatsAndLevelMessage_006928e4): new stats and level;
//     on a field (is_player_in_unsafe_map) unknown_set_total_stats and
//     hp = max_hp1.
//   6x4D (action_die_2): the player is dead (name drawn red).
//   6x4F (0x0069aea8): the revive state (0x0069d8f4).
//   6x70 (join sync): current_hp at +0x2a, bonus_hp_from_materials at
//     +0x2c, PlayerStats at +0x140 (hp at +0x146, level at +0x158).
// max_hp1 is the player's computed max HP (combat/progression.ts maxHpFor,
// the same formula the local player uses).
//
// ASSUMED: equipment HP bonuses are not counted in a remote max HP (the local
// one does not count them either); a player first seen through a 64 / 65
// entry starts at full HP until a command says otherwise; a revived player
// (6x4F) has max HP / 2 (PlayerRestoreHealthAndTP_0068fddc on a field, which
// the local Reverser revive uses: combat/buffs.ts reverserHp); 6x9A what 0 /
// 3 (subtract / add HP, newserv G_UpdateEntityStat_6x9A) applies to a player
// whose client id is the entity index (its handler 0x00779df4 is not
// decoded).

import { maxHpFor } from './progression.ts';
import { reverserHp } from './buffs.ts';

export interface PartyMemberStats {
  charClass: number;
  level: number; // 1-based
  hpStat: number; // PlayerStats char_stats.hp
  hpMaterials: number;
}

export interface PartyMemberHp {
  hp: number;
  maxHp: number;
  dead: boolean;
}

export class PartyHp {
  private members = new Map<number, PartyMemberHp>();

  get(clientId: number): PartyMemberHp | undefined {
    return this.members.get(clientId);
  }

  remove(clientId: number): void {
    this.members.delete(clientId);
  }

  clear(): void {
    this.members.clear();
  }

  // A player's stats became known (64 / 65 entry, 6x70, 6x30): recompute
  // max_hp1; `hp` is the current HP when the command carries it.
  stats(clientId: number, s: PartyMemberStats, hp?: number): PartyMemberHp {
    const maxHp = s.charClass >= 0 ? maxHpFor(s.charClass, s.hpStat, s.level - 1, s.hpMaterials) : 0;
    let m = this.members.get(clientId);
    if (!m) {
      m = { hp: maxHp, maxHp, dead: false };
      this.members.set(clientId, m);
    }
    m.maxHp = maxHp;
    if (hp !== undefined) m.hp = hp;
    m.hp = Math.min(m.hp, maxHp);
    return m;
  }

  // ClampEntityHP_00770b58.
  setHp(clientId: number, hp: number): void {
    const m = this.members.get(clientId);
    if (!m || m.dead) return;
    m.hp = Math.max(0, Math.min(m.maxHp, hp));
  }

  // add_player_hp.
  addHp(clientId: number, amount: number): void {
    const m = this.members.get(clientId);
    if (!m || m.dead) return;
    m.hp = Math.max(0, Math.min(m.maxHp, m.hp + amount));
  }

  // 6x30 on a field: back to full.
  refill(clientId: number): void {
    const m = this.members.get(clientId);
    if (m) m.hp = m.maxHp;
  }

  died(clientId: number): void {
    const m = this.members.get(clientId);
    if (!m) return;
    m.dead = true;
    m.hp = 0;
  }

  revived(clientId: number): void {
    const m = this.members.get(clientId);
    if (!m) return;
    m.dead = false;
    m.hp = reverserHp(m.maxHp);
  }

  // The HP subcommands of the file header. `body` starts at the subcommand
  // byte; returns whether it was one of them.
  receive(sub: number, body: Uint8Array): boolean {
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if ((sub === 0x4b || sub === 0x4c) && body.length >= 8) {
      this.setHp(dv.getUint16(2, true), dv.getUint16(6, true));
      return true;
    }
    if (sub === 0x2f && body.length >= 0x0c) {
      const type = dv.getUint32(4, true);
      const amount = dv.getInt16(8, true);
      const id = dv.getUint16(0x0a, true);
      if (type === 0) this.setHp(id, amount);
      else if (type === 1) this.addHp(id, amount);
      else if (type === 2) this.addHp(id, this.members.get(id)?.maxHp ?? 0);
      return true;
    }
    if (sub === 0x9a && body.length >= 8) {
      const id = dv.getUint16(4, true);
      const what = body[6];
      if (what === 0) this.addHp(id, -body[7]);
      else if (what === 3) this.addHp(id, body[7]);
      return true;
    }
    // 6x31 (Medical Center): Player_DisableMovement_0068fd74 sets the
    // sender's HP to its max HP (ClampEntityHP_00770b58).
    if (sub === 0x31 && body.length >= 4) {
      const id = dv.getUint16(2, true);
      this.setHp(id, this.members.get(id)?.maxHp ?? 0);
      return true;
    }
    if (sub === 0x4d && body.length >= 4) {
      this.died(dv.getUint16(2, true));
      return true;
    }
    if (sub === 0x4f && body.length >= 4) {
      this.revived(dv.getUint16(2, true));
      return true;
    }
    return false;
  }
}

// 6x70 (G_SyncPlayerDispAndInventory_BB_6x70): the fields PartyHp needs.
export function syncHp(body: Uint8Array): { clientId: number; hp: number; hpMaterials: number; hpStat: number; level: number } | null {
  if (body.length < 0x160 || body[0] !== 0x70) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    clientId: dv.getUint16(0x08, true),
    hp: dv.getUint16(0x2a, true),
    hpMaterials: dv.getUint16(0x2c, true),
    hpStat: dv.getUint16(0x146, true),
    level: dv.getUint32(0x158, true) + 1,
  };
}
