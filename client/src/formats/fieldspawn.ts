// Field arrival kind: which TObjPlayerSet source a player gets when it enters a
// floor of a game (PsoBB.exe, get_warp_type at dump Psobb.exe-05112026.c line 833294,
// read by SinowberillChallengePlayer_UpdatePosition_006884ac at 554167..554176).
//
// The floor block (0xac9d4c) holds the previous floor (+0x0), the current floor
// (+0x4) and the flag word (+0x20, bit 0 = 0xac9d6c & 1). A floor change runs
// MapStateTransitionHandler_008155a8 (833251): prev = cur, cur = the staged floor.
// get_warp_type then answers, in order:
//   prev > 0x11                  -> 4 (signed compare: -1 does not match)
//   flag bit 0                   -> 2
//   episode 1 and prev = Vol Opt -> 1 when cur is in 8..10, else 0
//   cur - prev < 0               -> 0, else 1
// and the stored kind maps 0 -> 1, 1 or 2 -> 0, anything else -> 1 (554167..554176).
//
// The flag bit 0 is set by handle_packet0x64 (780138, the game join) and cleared by
// ClearLobbyFlagIfNotLobby_008156b0 (833329) at the first floor load whose previous
// map is not the lobby (805576, 805328). The placement runs after that clear, so
// the flag only reaches the placement of the first floor a game enters from the
// lobby (floor 0, Pioneer 2): the port's enter() gives that arrival source 0 directly.
//
// Vol Opt is map 13 (boss_volopt, dump enum map_id). ASSUMED: for episode 1 the
// floor index is the map id (the default floor table, floorToArea), so floor 13
// is Vol Opt and floors 8..10 are the Ruins; the designations a quest sets are not
// checked here.

const MAX_FLOOR_INDEX = 0x11;
const BOSS_VOLOPT = 13;

// The get_warp_type value of a floor change (prev = the floor left, cur = the
// floor entered; prev -1 is "no previous floor").
export function fieldWarpType(prev: number, cur: number, flagBit0: boolean, episode: number): number {
  if (prev > MAX_FLOOR_INDEX) return 4;
  if (flagBit0) return 2;
  if (episode === 1 && prev === BOSS_VOLOPT) return cur >= 8 && cur <= 10 ? 1 : 0;
  return cur - prev < 0 ? 0 : 1;
}

// The TObjPlayerSet source of a warp type (the mapping at 554167..554176).
export function fieldArrivalSource(warpType: number): number {
  return warpType === 1 || warpType === 2 ? 0 : 1;
}

// The source of a floor change from `prev` to `cur`, without the flag.
export function floorChangeSource(prev: number, cur: number, episode: number): number {
  return fieldArrivalSource(fieldWarpType(prev, cur, false, episode));
}

// The first set of each client id among the sets of one source (the exe's loop at
// 554182..554190 takes the first match of client id and source). No other source
// is used: a client id without a set of this source has no set (the exe then puts
// it at the origin, 554194), so the caller must not fall back to another source.
export function spawnsOfSource<T extends { clientId: number; source: number }>(sets: readonly T[], source: number): Map<number, T> {
  const out = new Map<number, T>();
  for (const s of sets) if (s.source === source && !out.has(s.clientId)) out.set(s.clientId, s);
  return out;
}
