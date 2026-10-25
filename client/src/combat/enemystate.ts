// 6x10 / 6x11: an enemy's target, cursor and AI state (newserv
// G_DragonBossActions_6x10_6x11, CommandFormats.hh:3841, 0x0C bytes):
//   {u8 0x10 | 0x11, u8 3, u16 entity id} {u16 phase, u16 cursor, u32 target client id (0xFFFF none)}
//
// The exe's handlers (g_Packet0x60SubcommandTable rows 100 / 101, perm 0x0004):
//   6x10 -> ApplyEnemyTargetAndState_00423a78 (0x00423a58): the target from +8 (set_enemy_target_by_idx),
//           +0x684 = the cursor (+6), then SetEnemyAiState_0051f62c(+4) unconditionally.
//   6x11 -> ApplyEnemyTargetAndConditionalState_00423ac8 (0x00423aa8): the same, but the state is set
//           only when +4 differs from the entity's current state word (+0x32e).
// Neither touches the Dragon's x / z (+0x6a0 / +0x6a4) and neither runs phase 7; those are 6x12's
// (action_dragon, 0x00423b00).
//
// The exe never sends 6x10 / 6x11: no store of 0x10 / 0x11 as a 0x60 subcommand header reaches
// checked_call_packet0x60_subcommand in PsoBB.exe (the only 0x10 / 0x11 header bytes near a send
// belong to the 0xAD and 0xEA packets). So the port has no sender; the receive side applies what a
// remote client sends, as the handler does on every client.
//
// Newserv forwards them unchanged (ReceiveSubcommands.cc:5618, forward_subcommand_with_entity_id_transcode_t).

export const ENEMY_TARGET_STATE = {
  unconditional: 0x10, // 6x10
  conditional: 0x11, // 6x11
} as const;

export interface EnemyTargetState {
  sub: number; // 0x10 or 0x11
  entity: number; // 0x1000 | enemy index
  phase: number; // the AI state the exe writes (+4)
  cursor: number; // the sequence cursor (+6, +0x684 in the exe)
  target: number | null; // the target client id (+8); null for 0xFFFF
}

// Reads a 6x10 / 6x11 body. Null for another subcommand or a body shorter than the 0x0C the
// format and newserv use.
export function decodeEnemyTargetState(body: Uint8Array): EnemyTargetState | null {
  if (body.length < 0x0c) return null;
  if (body[0] !== ENEMY_TARGET_STATE.unconditional && body[0] !== ENEMY_TARGET_STATE.conditional) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const target = dv.getUint16(8, true); // the exe's set_enemy_target_by_idx reads the low 16 bits
  return {
    sub: body[0],
    entity: dv.getUint16(2, true),
    phase: dv.getInt16(4, true),
    cursor: dv.getInt16(6, true),
    target: target === 0xffff ? null : target,
  };
}

// Whether the handler sets the state: 6x10 always, 6x11 only on a change (the exe's
// `+4 != +0x32e` test). `current` is the enemy's state word before the packet.
export function enemyTargetStateSets(sub: number, phase: number, current: number): boolean {
  return sub !== ENEMY_TARGET_STATE.conditional || phase !== current;
}
