// Telepipes: Ryuker / the Telepipe item open a pipe on a field floor that
// takes the party to Pioneer 2, and a pipe in Pioneer 2 (TObjLuker, set data
// type 0x41, param4 = owner) that takes them back. The state each player
// keeps of its pipe and the command that shares it, after PsoBB.exe (Ephinea
// 1.25.13; the named dump calls this code Challenge* / Sinowberill*):
//
//   - Every player object holds a TelepipeState at +0x904 (newserv
//     PlayerSubordinates.hh TelepipeState, 0x18 bytes): owner u16 (0xFFFF =
//     none), floor u16, room u32, x / y / z floats, angle u32 (BAMS).
//     set_saved_telepipe_information (0x006e9070) fills it; a pipe counts as
//     open while its floor is not 0 (IsSinowberillMapObjectActive_006e839c).
//   - 6x68 G_SetTelepipeState_6x68 (0x1C, via 60): {68 07 ?? ??, state}
//     (SendTelepipeStatePacket_006e90b8; bytes 2-3 are left as they were on
//     the stack, sent as 0 here). newserv keeps it and repeats it to the
//     others; 6x70 carries it for a player who joins (+0x80).
//   - The 6x68 handler (ProcessTelepipeTeleportRequest_006e9410, table
//     0x00a100xx): owner < 4 and the pipe not the one already known
//     (CheckChallengeEntityRange_006e9104: same floor and within 0.2 on the
//     ground plane, 0x0096d920) -> store it; another player's pipe on our
//     floor appears at once.
//   - Ryuker and the Telepipe item (use_telepipe -> unknown_cast_tech(ryuker))
//     need SinowberillChallengePlayer_IsTelepipeEnabled_0068bfa0, kept by
//     SinowberillChallengePlayer_UpdateTelepipeState_00688b4c: not in battle
//     or challenge mode, not a boss map (map type 0x0B in the table at
//     0x0097f040) and not a safe map (Pioneer 2, the lobby, the Lab).
//   - Arriving through a pipe (GetTeleportTargetDataForPlayer_006e9630):
//     in Pioneer 2 the spot of the table at 0x0096d8a0 (Episodes 1 and 4) /
//     0x0096d8d0 (Episode 2) by client id, angle 0x4000 (0x0096d900); on the
//     field, the owner's pipe position and angle.

export const NO_OWNER = 0xffff;

export interface TelepipeState {
  owner: number; // client id, NO_OWNER for none
  floor: number;
  room: number;
  x: number;
  y: number;
  z: number;
  angle: number; // BAMS
}

export const SAME_PIPE_RANGE = 0.2; // 0x0096d920
// SinowberillMapObjectCheckPlayerProximity_0066ead8(.., 10.0): how near the
// Pioneer 2 pipe has to be; return1(10.0, ..) in the field pipe's state 1.
export const TELEPIPE_USE_RANGE = 10;
// Frames between using a pipe and the warp: the field pipe's state 2 counts
// to > 10 after its increment (ChallengeEntity_Update_006e88d0: 11 ticks),
// the Pioneer 2 pipe's state 1 tests the count before it (12 ticks). The
// player is held meanwhile by 6x2C {10 frames}.
export const USE_FRAMES_FIELD = 11;
export const USE_FRAMES_CITY = 12;
export const TELEPIPE_HOLD_FRAMES = 10; // SendChallengeEntityPacket_006854a8(player, 10)
// Sounds: 0x9f a pipe is made, 0xa0 its loop, 0xa1 it is used.
export const SE_TELEPIPE_OPEN = 0x9f;
export const SE_TELEPIPE_LOOP = 0xa0;
export const SE_TELEPIPE_USE = 0xa1;

// Map types (0x0097f040 by area): 0x0B = boss map.
export const BOSS_AREAS: readonly number[] = [0x0b, 0x0c, 0x0d, 0x0e, 0x1e, 0x1f, 0x20, 0x21, 0x2c];

// Pioneer 2 arrival spots by client id (y 0 = the ground below).
export const P2_ARRIVAL_EP1: ReadonlyArray<readonly [number, number, number]> = [
  [-312, 0, -113],
  [-306, 0, -135],
  [-285, 0, -172],
  [-249, 0, -190],
];
export const P2_ARRIVAL_EP2: ReadonlyArray<readonly [number, number, number]> = [
  [270, -30, -220],
  [300, -30, -220],
  [330, -30, -215],
  [360, -30, -185],
];
export const P2_ARRIVAL_ANGLE = 0x4000;

// The pipe's particle effects (CreateChallengeEnemyEntity_006e8ca4,
// EnemyEntity_ConstructorComplex_006e915c): particleentry.dat 0xB1, 0xB2
// and 0xB0 (0x0096d800 + owner * 0xC, the same three for every owner), the
// third 1.8 above the ground (0x0096d91c); colour override by owner
// (0x0096d928; owner 3 keeps the entry's own colours).
export const PIPE_PARTICLES = [0xb1, 0xb2, 0xb0] as const;
export const PIPE_PARTICLE_RAISE = 1.8;
export const PIPE_COLORS: readonly number[] = [0xffb2b2, 0x99ffb2, 0xffffb2, 0];
// The flash when a pipe is used (create_particle_effect(.., 0xb3)), drawn 10
// units towards the camera (CalculatePositionTowardsCamera_006ea73c).
export const PIPE_USE_PARTICLE = 0xb3;

export function noTelepipe(owner = NO_OWNER): TelepipeState {
  return { owner, floor: 0, room: 0, x: 0, y: 0, z: 0, angle: 0 };
}

export function telepipeOpen(s: TelepipeState | undefined | null): s is TelepipeState {
  return !!s && s.owner !== NO_OWNER && s.floor !== 0;
}

// CheckChallengeEntityRange_006e9104 == 0: the stored pipe is the one at
// (floor, x, z).
export function samePipe(s: TelepipeState | undefined, floor: number, x: number, z: number): boolean {
  return !!s && s.floor === floor && Math.hypot(s.x - x, s.z - z) < SAME_PIPE_RANGE;
}

// The pipe whose loop sound (SE 0xA0) the local player hears: the nearest of
// the open field pipes to the listener (ASSUMED: the exe plays one loop per
// owner, the port keeps one voice and moves it to the nearest pipe). Returns
// the index into `pipes`, or -1 for none.
export function nearestPipe(pipes: readonly { x: number; z: number }[], me: { x: number; z: number } | null): number {
  let best = -1;
  let bestD = Infinity;
  pipes.forEach((p, i) => {
    const d = me ? Math.hypot(p.x - me.x, p.z - me.z) : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// SinowberillChallengePlayer_UpdateTelepipeState_00688b4c; `safe`: the area
// is in the safe map list (classic/fieldmenu.ts isSafeMap).
export function telepipeAllowed(area: number, safe: boolean, opts: { battle?: boolean; challenge?: boolean } = {}): boolean {
  return !opts.battle && !opts.challenge && !BOSS_AREAS.includes(area) && !safe;
}

// GetTeleportTargetDataForPlayer_006e9630 in Pioneer 2.
export function pioneer2Arrival(clientId: number, episode: number): { x: number; y: number; z: number; angle: number } {
  const t = (episode === 2 ? P2_ARRIVAL_EP2 : P2_ARRIVAL_EP1)[clientId & 3];
  return { x: t[0], y: t[1], z: t[2], angle: P2_ARRIVAL_ANGLE };
}

// The Medical Center spots a returning player is placed at (return_to_p2_maybe ->
// SetPlayerRespawnState_006986ec, which takes WeaponStat[0xb].flDamage's per-episode
// table + client id * 12; read with tools/exedata.py: pointers 0x009cc4ec + 4 * episode,
// 3 floats per client at 0x00968e14 (Episode 1), 0x00968e44 (Episode 2), 0x00968e74
// (Episode 4)). Episode 4 has the Episode 1 values. The angle is not in the exe's
// respawn state (ASSUMED: the P2 arrival facing).
export const P2_MEDICAL_EP1: ReadonlyArray<readonly [number, number, number]> = [
  [213, 3, -280],
  [207, 3, -280],
  [219, 3, -280],
  [225, 3, -280],
];
export const P2_MEDICAL_EP2: ReadonlyArray<readonly [number, number, number]> = [
  [7, 0, -200],
  [5, 0, -185],
  [20, 0, -211],
  [23, 0, -197],
];

// The Pioneer 2 spot of the dead prompt's Yes (GameView.returnToPioneer2). The wire
// episode: 1 Episode 1, 2 Episode 2, 3 Episode 4.
export function pioneer2ReturnArrival(clientId: number, episode: number): { x: number; y: number; z: number; angle: number } {
  const t = (episode === 2 ? P2_MEDICAL_EP2 : P2_MEDICAL_EP1)[clientId & 3];
  return { x: t[0], y: t[1], z: t[2], angle: P2_ARRIVAL_ANGLE };
}

export function readTelepipe(dv: DataView, o: number): TelepipeState {
  return {
    owner: dv.getUint16(o, true),
    floor: dv.getUint16(o + 2, true),
    room: dv.getUint32(o + 4, true),
    x: dv.getFloat32(o + 8, true),
    y: dv.getFloat32(o + 12, true),
    z: dv.getFloat32(o + 16, true),
    angle: dv.getUint32(o + 20, true),
  };
}

export function writeTelepipe(dv: DataView, o: number, s: TelepipeState): void {
  dv.setUint16(o, s.owner, true);
  dv.setUint16(o + 2, s.floor, true);
  dv.setUint32(o + 4, s.room >>> 0, true);
  dv.setFloat32(o + 8, s.x, true);
  dv.setFloat32(o + 12, s.y, true);
  dv.setFloat32(o + 16, s.z, true);
  dv.setUint32(o + 20, s.angle >>> 0, true);
}

// 6x68, whole subcommand.
export function buildTelepipeState(s: TelepipeState): Uint8Array {
  const b = new Uint8Array(0x1c);
  b[0] = 0x68;
  b[1] = 0x07;
  writeTelepipe(new DataView(b.buffer), 4, s);
  return b;
}

export function parseTelepipeState(body: Uint8Array): TelepipeState | null {
  if (body.length < 0x1c || body[0] !== 0x68) return null;
  return readTelepipe(new DataView(body.buffer, body.byteOffset, body.byteLength), 4);
}

// 6x2C G_ImposeHold_6x2C {client id, frames, particle 0, x, z, radius^2 0}
// (SendChallengeEntityPacket_006854a8): the player stays put while the pipe
// works.
export function buildImposeHold(clientId: number, frames: number, x: number, z: number): Uint8Array {
  const b = new Uint8Array(0x14);
  const dv = new DataView(b.buffer);
  b[0] = 0x2c;
  b[1] = 0x05;
  dv.setUint16(2, clientId, true);
  dv.setUint16(4, frames, true);
  dv.setFloat32(8, x, true);
  dv.setFloat32(12, z, true);
  return b;
}

// Every player's pipe as this client knows it (the +0x904 of each player).
export class TelepipeStore {
  readonly pipes = new Map<number, TelepipeState>();

  get(owner: number): TelepipeState | undefined {
    return this.pipes.get(owner);
  }

  // ProcessTelepipeTeleportRequest_006e9410: another client's 6x68. Returns
  // the state when it is stored (not the pipe already known).
  receive(s: TelepipeState): TelepipeState | null {
    if (s.owner >= 4) return null;
    if (samePipe(this.pipes.get(s.owner), s.floor, s.x, s.z)) return null;
    const copy = { ...s };
    this.pipes.set(s.owner, copy);
    return copy;
  }

  // Our own pipe (set_saved_telepipe_information), or a 6x70 joiner's.
  set(s: TelepipeState): void {
    this.pipes.set(s.owner, { ...s });
  }

  // SinowberillMapObjectConstructor_006e8388: the owner went back through
  // its pipe; floor and room are cleared, the rest is kept.
  close(owner: number): TelepipeState {
    const s = { ...(this.pipes.get(owner) ?? noTelepipe(owner)), owner, floor: 0, room: 0 };
    this.pipes.set(owner, s);
    return s;
  }

  delete(owner: number): void {
    this.pipes.delete(owner);
  }
}
