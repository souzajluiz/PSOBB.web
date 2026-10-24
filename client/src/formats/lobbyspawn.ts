// Lobby spawn lookup: which TObjPlayerSet a player is placed on when it enters a
// lobby (PsoBB.exe, SinowberillChallengePlayer_UpdatePosition_006884ac, dump
// Psobb.exe-05112026.c line 554041; the name is a mis-assignment, the function
// places a player on map entry).
//
// The set is the one whose param1 (client id, ROUND) equals the player's index and
// whose param4 (source, `+0x84`) equals the arrival kind. The arrival kind comes from
// the player's stored value at +0x3d4 (the dump names it `unknown_menu_inputs_allowed`;
// the same offset is written as an input-state pointer in another player constructor,
// dump line 169758, so what the stored value holds is ASSUMED). When that value is
// -1 the kind is get_warp_type(&g_prev_floor_id) mapped as (lines 554167..554176):
// 0 -> 1, 1 or 2 -> 0, anything else -> 1. Otherwise the stored value is the kind.
// A set that matches neither puts the player at x = y = z = 0 (line 554194).

export interface LobbySpawn {
  x: number;
  y: number;
  z: number;
  angle: number; // radians, same convention as LobbyPlayer.angle
}

// The arrival source for a get_warp_type value (the mapping above).
export function lobbyArrivalSource(warpType: number): number {
  return warpType === 1 || warpType === 2 ? 0 : 1;
}

// The spawn a client id gets from the map's spawns (the exe's match, then its
// origin). `spawns` holds the sets of the arrival source, by client id; `hasSets`
// says the map has player sets at all (of any source). Null only when it has none,
// so the caller keeps its own fallback.
// ASSUMED: the exe keeps the player's heading when no set is found; the port uses 0.
export function lobbySpawnAt(spawns: ReadonlyMap<number, LobbySpawn>, clientId: number, hasSets = spawns.size > 0): LobbySpawn | null {
  if (!hasSets) return null;
  const s = spawns.get(clientId);
  return s ? { ...s } : { x: 0, y: 0, z: 0, angle: 0 };
}
