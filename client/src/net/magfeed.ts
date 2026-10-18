// Feeding a MAG, as PsoBB.exe (Ephinea 1.25.13) does it on the feeder's own
// client (the server is not asked; newserv's apply_mag_feed_result is a port
// of the same code and keeps its copy of the inventory in step):
//
//   MAG window, state 7 (ChallengePlayerListWindow_HandleInput_007526c8) ->
//   Player_UpdateStateAndSync_0068dcc8: 6x28 {mag id, item id}
//   (Player_SendFeedMagPacket_0068dcf8), one of the item removed
//   (Inventory_RemoveItemSimple_006a6540), then the weapon is taken off when
//   it can no longer be equipped (Player_ValidateAndUnequipWeapon_0068dd44).
//   The 6x28 also runs here (action_feed_mag -> feed_mag -> the mag's vtable
//   +0x9c, ExecuteMagFeed_005da00c):
//   - a tool (data1[0] = 3) gives the row of its PMT index (pmt_weapon_bb_t
//     +0, newserv's result_index_for_fed_item: Monomate 0 .. Star Atomizer 10)
//     in the mag's feed table (ItemPMT mag +0x0c, pmt_get_mag_feed_item:
//     tables 0..7, 8 bytes per row: def, pow, dex, mind, iq, sync);
//   - the feed timer (item +0x1b4 / +0x1b8): the first feed starts it at
//     0x189c frames (get_mag_feed_timer: CreateItemObject_006dc358 is a stub
//     returning 0, so never 0x1fa4), later ones add 1 to the count; it runs
//     down by 1 per frame (unknown_check_if_time_to_feed_mag) and clears the
//     count at 0. "Give Items" is off while the count is 2 or more
//     (0x00752edc, 2.0 at 0x00973e64);
//   - SE 0x580 at the owner and the particle 0x9B at the mag's two sides
//     (when the mag is drawn);
//   - mag_feed: def, pow, dex, mind (mag_feed_def / _pow / the two functions
//     the dump calls _mind / _dex, which write dex at +8 and mind at +10 of
//     item_instance_mag_data {iq, sync, def, pow, dex, mind}): a rise, or a
//     fall smaller than the stat's part within its level (value % 100), is
//     added while the mag level is below 200; at 200 a rise stops at 99 in
//     the level; iq (mag_feed_iq) and sync (mag_adjust_synchro) are clamped
//     to 0..200 and 0..120; the level (data1[2]) becomes the sum of the four
//     stats / 100 (mag_get_level_from_stats);
//   - ProcessMagEvolution_005da254: levels 10..34 with ItemMagEdit evolution
//     stage 0 -> stage 1 by class (mag_evolution_stage_0: hunters Varuna 1,
//     rangers Kalki 0xD, forces Vritra 0x19); 35..49 with stage < 2 ->
//     mag_evolution_stage_1; 50+ on multiples of 5 with stage < 4 ->
//     mag_special_evolution (level 100+) else mag_evolution_stage_2. The
//     branch tables of stage 1 / 2 and the special one are taken from
//     newserv's port (the stage 1 table and mag_evolution_alignment were
//     checked against the exe); a new type adds its photon blast
//     (mag_add_photon_blast_1, ItemData::add_mag_photon_blast).

import type { ItemData } from '../formats/itemnames.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
import { prsDecompress } from '../formats/prs.ts';

export const FEED_TIMER_FRAMES = 0x189c; // get_mag_feed_timer
export const FEED_COUNT_LIMIT = 2; // 0x00973e64
export const SE_FEED = 0x580; // ExecuteMagFeed_005da00c
export const SE_MAG_LEVEL = 0x96; // MAG window state 10 (a stat level shown rising)
export const MAG_TYPES = 0x53; // get_item_mag_edit_evolution_stage clamps to 0x52

const w16 = (d: Uint8Array, i: number) => d[i * 2] | (d[i * 2 + 1] << 8);
const set16 = (d: Uint8Array, i: number, v: number) => {
  d[i * 2] = v & 0xff;
  d[i * 2 + 1] = (v >> 8) & 0xff;
};
// data1w indices of the four stats.
const DEF = 2;
const POW = 3;
const DEX = 4;
const MIND = 5;

export function magLevel(d: Uint8Array): number {
  return Math.trunc(w16(d, DEF) / 100) + Math.trunc(w16(d, POW) / 100) + Math.trunc(w16(d, DEX) / 100) + Math.trunc(w16(d, MIND) / 100);
}

// ItemMagEdit.prs (REL): root at footer - 0x10, root +0x14 points at one
// evolution stage per mag type (get_item_mag_edit_evolution_stage; newserv
// MagMetadataTable evolution_number_table).
export function parseMagEvolution(file: Uint8Array, compressed = true): Uint8Array {
  const d = compressed ? prsDecompress(file) : file;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const root = dv.getUint32(d.length - 0x10, true);
  const table = dv.getUint32(root + 0x14, true);
  return d.slice(table, table + MAG_TYPES);
}

// CheckItemEquipConditions_005d5f40 bit 4: a tool whose PMT item flags
// (+0x14) have bit 4 can be given to a MAG (the MAG window's item list,
// ListWindowObject_PopulateRangedWeapons_0074b6f4).
export function isMagFood(item: ItemData, pmt: ItemPMT, wrapped: boolean): boolean {
  const d = item.data1;
  if (d[0] !== 3 || wrapped) return false;
  return ((pmt.getTool(d[1], d[2])?.itemFlags ?? 0) & 4) !== 0;
}

export interface FeedContext {
  pmt: ItemPMT;
  evolution: Uint8Array | null; // parseMagEvolution; null: no evolution
  charClass: number;
  sectionId: number;
}

// mag_feed_def and the others.
function feedStat(d: Uint8Array, which: number, delta: number): void {
  const v = w16(d, which);
  if (!(delta > 0 || (delta < 0 && -delta < v % 100))) return;
  const level = magLevel(d);
  if (level < 200) set16(d, which, v + delta);
  else if (level === 200) set16(d, which, v + Math.min(delta, 99 - (v % 100)));
}

// ItemData::compute_mag_strength_flags / mag_evolution_alignment.
export function magAlignment(d: Uint8Array): number {
  const pow = Math.trunc(w16(d, POW) / 100);
  const dex = Math.trunc(w16(d, DEX) / 100);
  const mind = Math.trunc(w16(d, MIND) / 100);
  let r = 0;
  if (dex < pow && mind < pow) r = 0x008;
  if (pow < dex && mind < dex) r |= 0x010;
  if (dex < mind && pow < mind) r |= 0x020;
  const hi = Math.max(pow, dex, mind);
  if ((pow === hi ? 1 : 0) + (dex === hi ? 1 : 0) + (mind === hi ? 1 : 0) > 1) r |= 0x100;
  return r;
}

const HUNTERS = new Set([0, 1, 2, 9]);
const RANGERS = new Set([3, 4, 5, 11]);
const MALE = new Set([0, 2, 3, 4, 7, 10]);

// ProcessMagEvolution_005da254 (branches as in newserv apply_mag_feed_result).
function evolve(item: ItemData, stage: number, charClass: number, sectionId: number): void {
  const d = item.data1;
  const level = magLevel(d);
  const type = d[1];
  const hunter = HUNTERS.has(charClass);
  const ranger = RANGERS.has(charClass);
  if (level < 10) return;
  if (level < 35) {
    if (stage < 1) d[1] = hunter ? 0x01 : ranger ? 0x0d : 0x19;
    return;
  }
  if (level < 50) {
    if (stage >= 2) return;
    const f = magAlignment(d);
    if (type === 0x0d) d[1] = f & 0x110 ? 0x02 : f & 8 ? 0x03 : f & 0x20 ? 0x0b : d[1];
    else if (type === 0x01) d[1] = f & 0x108 ? 0x0e : f & 0x10 ? 0x0f : f & 0x20 ? 0x04 : d[1];
    else if (type === 0x19) d[1] = f & 0x120 ? 0x1a : f & 8 ? 0x1b : f & 0x10 ? 0x14 : d[1];
    return;
  }
  if (level % 5 !== 0 || stage >= 4) return;
  const def = Math.trunc(w16(d, DEF) / 100);
  const pow = Math.trunc(w16(d, POW) / 100);
  const dex = Math.trunc(w16(d, DEX) / 100);
  const mind = Math.trunc(w16(d, MIND) / 100);
  if (level >= 100) {
    // mag_special_evolution
    const g = sectionId % 3;
    const index = (MALE.has(charClass) ? 0 : 1) + g * 2 + (hunter ? 0 : ranger ? 6 : 12);
    if ((g === 0 && pow + mind === def + dex) || (g === 1 && pow + dex === mind + def) || (g === 2 && pow + def === mind + dex)) {
      d[1] = [0x39, 0x3b, 0x3a, 0x3b, 0x3a, 0x3b, 0x3d, 0x3c, 0x3d, 0x3c, 0x3d, 0x3e, 0x41, 0x3f, 0x41, 0x40, 0x41, 0x40][index];
    }
  }
  if (d[1] !== type) return;
  // mag_evolution_stage_2
  const f = magAlignment(d);
  const odd = (sectionId & 1) !== 0;
  if (hunter) {
    if (f & 0x108) d[1] = odd ? (dex < mind ? 0x08 : 0x06) : dex < mind ? 0x0c : 0x05;
    else if (f & 0x010) d[1] = odd ? (mind < pow ? 0x12 : 0x10) : mind < pow ? 0x17 : 0x13;
    else if (f & 0x020) d[1] = odd ? (pow < dex ? 0x16 : 0x24) : pow < dex ? 0x07 : 0x1e;
  } else if (ranger) {
    if (f & 0x110) d[1] = odd ? (mind < pow ? 0x0a : 0x05) : mind < pow ? 0x0c : 0x06;
    else if (f & 0x008) d[1] = odd ? (dex < mind ? 0x0a : 0x26) : dex < mind ? 0x0c : 0x06;
    else if (f & 0x020) d[1] = odd ? (pow < dex ? 0x18 : 0x1e) : pow < dex ? 0x08 : 0x05;
  } else if (f & 0x120) {
    d[1] = def >= 45 ? 0x24 : odd ? (pow < dex ? 0x17 : 0x09) : pow < dex ? 0x1e : 0x1c;
  } else if (f & 0x008) {
    d[1] = def >= 45 ? 0x23 : odd ? (dex < mind ? 0x1c : 0x20) : dex < mind ? 0x1f : 0x25;
  } else if (f & 0x010) {
    d[1] = def >= 45 ? 0x24 : odd ? (mind < pow ? 0x12 : 0x0c) : mind < pow ? 0x15 : 0x11;
  }
}

// Photon blast in a slot (ItemData::mag_photon_blast_for_slot).
function pbInSlot(item: ItemData, slot: number): number | null {
  const flags = item.data2[2];
  const pbs = item.data1[3];
  if (slot === 0) return flags & 1 ? pbs & 7 : null;
  if (slot === 1) return flags & 2 ? (pbs >> 3) & 7 : null;
  if (!(flags & 4)) return null;
  const used = (1 << (pbs & 7)) | (1 << ((pbs >> 3) & 7));
  let left = (pbs >> 6) & 3;
  for (let z = 0; z < 6; z++) {
    if (used & (1 << z)) continue;
    if (!left) return z;
    left--;
  }
  return null;
}

// The photon blasts a mag has, center / right / left (GetPhotonBlastValue_005dbc08
// stops at the first empty slot).
export function photonBlasts(item: ItemData): number[] {
  const out: number[] = [];
  for (let s = 0; s < 3; s++) {
    const pb = pbInSlot(item, s);
    if (pb === null) break;
    out.push(pb);
  }
  return out;
}

// mag_add_photon_blast_1 (ItemData::add_mag_photon_blast).
export function addPhotonBlast(item: ItemData, pb: number): void {
  if (pb >= 6 || [0, 1, 2].some((s) => pbInSlot(item, s) === pb)) return;
  const flags = item.data2[2];
  if (!(flags & 1)) {
    item.data1[3] |= pb;
    item.data2[2] |= 1;
  } else if (!(flags & 2)) {
    item.data1[3] |= pb << 3;
    item.data2[2] |= 2;
  } else if (!(flags & 4)) {
    let n = pb;
    if ((pbInSlot(item, 0) ?? 9) < pb) n--;
    if ((pbInSlot(item, 1) ?? 9) < pb) n--;
    if (n >= 4) return;
    item.data1[3] |= n << 6;
    item.data2[2] |= 4;
  }
}

// ExecuteMagFeed_005da00c + mag_feed: applies one item to the mag in place.
// Returns false when the item feeds nothing (not a tool with a feed row).
export function applyMagFeed(mag: ItemData, food: ItemData, ctx: FeedContext): boolean {
  const d = mag.data1;
  if (d[0] !== 2 || food.data1[0] !== 3) return false;
  const tool = ctx.pmt.getTool(food.data1[1], food.data1[2]);
  const table = ctx.pmt.mags[d[1]]?.feedTable ?? -1;
  const row = tool && table >= 0 && table < 8 ? ctx.pmt.magFeedTables[table]?.[tool.id] : undefined;
  if (!row) return false;
  feedStat(d, DEF, row.def);
  feedStat(d, POW, row.pow);
  feedStat(d, DEX, row.dex);
  feedStat(d, MIND, row.mind);
  mag.data2[1] = Math.max(0, Math.min(200, mag.data2[1] + row.iq));
  mag.data2[0] = Math.max(0, Math.min(120, mag.data2[0] + row.synchro));
  d[2] = magLevel(d);
  const type = d[1];
  const stage = ctx.evolution?.[Math.min(type, MAG_TYPES - 1)];
  if (stage !== undefined) evolve(mag, stage, ctx.charClass, ctx.sectionId);
  if (d[1] !== type) addPhotonBlast(mag, ctx.pmt.mags[d[1]]?.photonBlast ?? 0xff);
  return true;
}

// The feed timer of one mag (item +0x1b4 / +0x1b8).
export class FeedTimer {
  frames = 0;
  count = 0;

  // unknown_check_if_time_to_feed_mag (once per frame).
  tick(): void {
    if (this.frames === 0) return;
    this.frames--;
    if (this.frames === 0) this.count = 0;
  }

  fed(): void {
    if (this.frames === 0) this.frames = FEED_TIMER_FRAMES;
    else this.count++;
  }

  get canFeed(): boolean {
    return this.count < FEED_COUNT_LIMIT;
  }
}
