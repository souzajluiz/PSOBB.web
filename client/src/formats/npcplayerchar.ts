// npcplayerchar.dat: the characters a quest's NPC players use (Nol, Elly,
// Ash, ...). PsoBB.exe reads the whole 0x1C00-byte file
// (SinowberillChallenge_LoadCharacterData_007adf48 and LoadNpcPlayerData
// _00605b18, LoadAsset2Wrapper into a 0x1C00 buffer) and takes record
// `template` at template * 0x70: 64 records.
//
// Record (0x70), matched against the file: a char name[0x10] (copied to the
// UTF-16 name when that one is empty), then a visual config whose shared part
// starts at +0x20 (the PlayerVisualConfigV4 shared layout of net/lobby.ts,
// shifted by 0x10): section id +0x30, class +0x31, costume / skin / face /
// head / hair u16 +0x38..+0x40, hair r / g / b u16 +0x42..+0x46,
// proportion x / y f32 +0x48 / +0x4c; the UTF-16 name[0x10] at +0x50.

import type { PlayerAppearance } from '../render/playermodel.ts';

export const NPC_PLAYER_FILE = 'npcplayerchar.dat';
export const NPC_PLAYER_RECORD = 0x70;
export const NPC_PLAYER_COUNT = 0x1c00 / NPC_PLAYER_RECORD;

export interface NpcPlayerTemplate {
  index: number;
  name: string;
  charClass: number;
  appearance: PlayerAppearance;
}

export function parseNpcPlayerTemplates(data: Uint8Array): NpcPlayerTemplate[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: NpcPlayerTemplate[] = [];
  for (let i = 0; i < NPC_PLAYER_COUNT && (i + 1) * NPC_PLAYER_RECORD <= data.length; i++) {
    const o = i * NPC_PLAYER_RECORD;
    let name = '';
    for (let k = 0; k < 0x10; k++) {
      const c = dv.getUint16(o + 0x50 + k * 2, true);
      if (!c) break;
      name += String.fromCharCode(c);
    }
    if (!name) for (let k = 0; k < 0x10 && data[o + k]; k++) name += String.fromCharCode(data[o + k]);
    const u16 = (k: number) => dv.getUint16(o + k, true);
    out.push({
      index: i,
      name: name.replace(/\t[EJ]/g, ''),
      charClass: data[o + 0x31],
      appearance: {
        sectionId: data[o + 0x30],
        costume: u16(0x38),
        skin: u16(0x3a),
        face: u16(0x3c),
        head: u16(0x3e),
        hair: u16(0x40),
        hairR: u16(0x42),
        hairG: u16(0x44),
        hairB: u16(0x46),
        proportionX: dv.getFloat32(o + 0x48, true),
        proportionY: dv.getFloat32(o + 0x4c, true),
      },
    });
  }
  return out;
}

// 6x69 (G_NPCControl_6x69, newserv CommandFormats.hh, 0x0C bytes):
// {69, 03, u16 unused, u16 param1, u16 param2, u16 command, u16 param3}.
// Commands: 0 create a follower NPC (param1 = state, param2 = the player slot
// it takes, param3 = template), 1 stop acting (param1 = slot), 2 start acting
// (param1 = the player to follow), 3 create an attacker NPC.
// Sent by npc_crp_V3 (SinowberillChallenge_SendPositionBuffer_007b37f0: the
// first free slot, or 1 in one-person mode, followed by 6x24 to put it in
// place), npc_crp_id_V3 (UpdatePlayerStatusEffect_007b3894: the given slot),
// npc_crppk_V3 (ProcessPlayerAction_007b38fc) and npc_play
// (SendPacket0x60_007b4874: command 2).
export interface NpcControl {
  param1: number;
  param2: number;
  command: number;
  param3: number;
}

export function buildNpcControl(c: NpcControl): Uint8Array {
  const b = new Uint8Array(0x0c);
  const dv = new DataView(b.buffer);
  b[0] = 0x69;
  b[1] = 0x03;
  dv.setUint16(4, c.param1, true);
  dv.setUint16(6, c.param2, true);
  dv.setUint16(8, c.command, true);
  dv.setUint16(10, c.param3, true);
  return b;
}

export function parseNpcControl(body: Uint8Array): NpcControl | null {
  if (body.length < 0x0c || body[0] !== 0x69) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { param1: dv.getUint16(4, true), param2: dv.getUint16(6, true), command: dv.getUint16(8, true), param3: dv.getUint16(10, true) };
}

// 6x24 (G_TeleportPlayer_6x24, 0x14): {24, 05, u16 client id, u32 angle,
// f32 x, y, z} (SendPacketToPlayer_00688ee4).
export function buildTeleport(clientId: number, angle: number, x: number, y: number, z: number): Uint8Array {
  const b = new Uint8Array(0x14);
  const dv = new DataView(b.buffer);
  b[0] = 0x24;
  b[1] = 0x05;
  dv.setUint16(2, clientId, true);
  dv.setUint32(4, angle >>> 0, true);
  dv.setFloat32(8, x, true);
  dv.setFloat32(12, y, true);
  dv.setFloat32(16, z, true);
  return b;
}

// 6xC9 (G_AdjustPlayerMeseta_BB_6xC9, 8): {C9, 02, 0xFFFF, i32 amount}, the
// quest's meseta reward (opcode_pl_add_meseta2; newserv adds the meseta and
// answers 6xBE).
export function buildMesetaReward(amount: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  b[0] = 0xc9;
  b[1] = 0x02;
  dv.setUint16(2, 0xffff, true);
  dv.setInt32(4, amount | 0, true);
  return b;
}
