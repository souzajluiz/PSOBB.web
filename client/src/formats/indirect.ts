// Indirect-object table of a map (map_*i.bin) and the draw rule it feeds.
//
// Indirect objects are n.rel entries with flag 0x200 (formats/nrel.ts): their
// `object` points at a mesh-less record whose first word points at the real
// model and whose +0x0C holds an id. Only Episode 2 maps have them (Jungle,
// Seabed, Gol Dragon's map_boss06; map_boss07 has a file but no such entry).
//
// File (Ephinea PsoBB.exe; load_map_data reads "<map>" + "i.bin" (0x0097f268,
// referenced at 0x0080b74d) after the n.rel, only while
// CheckFrustumIntersectionResult_0078b208() < 3; lobbies keep at most 0x100
// bytes), big-endian, byte-swapped in place (ReverseTamEndianness_0080a60c):
//   char magic[4] "ind0", u32 count (BE), then count rows of 8 bytes:
//   u16 id (BE), u8 stage (0..2), u8 b3, u8 info, u8 pad[3]
// MapGeometry_InitializeMeshTrees_0080a650 matches each indirect entry's id
// against the rows (linear search, first match). With a row, the record gets
// an IndTexObject (IndTexObject_Constructor_00504b58, info = its indinfo.dat
// row) in its mesh slot, record +8 = {0, 1, 2}[stage] (u32 table 0x0097f11c),
// +0x0E = b3 (identity byte table 0x0097f114), +0x0F = info. Without one the
// slot stays empty.
//
// Draw loops (map_nrel_process_chunk_static_meshes, its call to
// ConfigureIndTexStageForMesh at 0x00806d38, and the animated loops of
// render_map_geometry_, calls at 0x008063fb..0x00806a47): a static indirect entry without 0x80 / 0x400
// and every animated indirect entry is drawn only when its record got an
// IndTexObject; the draw is ConfigureIndTexStageForMesh_00504c04, then the
// model, then ClearIndTexState_00504c78. 0x80 entries draw the model plainly
// (their GameCube hook is a no-op), 0x400 entries only call that hook.
//
// The distortion itself never runs on PC: ConfigureIndTexStageForMesh only
// sets up the bump stage (indirect.dat 64x64 du/dv texture on stage 0,
// BUMPENVMAT00 / 01 = 1.0, pixel shader 0) for an IndTex generator registered
// in g_IndTexActiveList_00a72b10 with the same info index, and nothing
// registers one: the list and its count 0x00a72b0c are only cleared
// (0x005036c8, ResetIndirectTexState_00504cd0), and the call in the
// IndTexObject constructor (0x00504bc4) has an empty body. The JP build
// (psobb-client-source's PsoBB.exe, read with objdump: the ctor stores
// vtable 0x00afcae8 at 0x00504baa and calls the empty 0x00504bd0; list
// 0x00a70690 / count 0x00a7068c are only read or cleared) is the same. So the faithful
// render is the model as it is, gated by the row lookup.

import { ENTRY_GC_EFFECT, ENTRY_GC_ONLY, ENTRY_INDIRECT, type MapGeometry } from './nrel.ts';

export const INDIRECT_MAGIC = 'ind0';

// u32 table 0x0097f11c: record +8 by the row's stage byte.
const STAGE_VALUES = [0, 1, 2] as const;

export interface IndirectRow {
  id: number;
  stage: number; // raw byte 2
  stageValue: number; // record +8 (0x0097f11c[stage]); -1 past the table
  b3: number; // byte 3 (record +0x0E through the identity table 0x0097f114)
  info: number; // byte 4: indinfo.dat row (< 0x40), record +0x0F
}

export interface IndirectTable {
  rows: IndirectRow[];
}

export function parseIndirectBin(data: Uint8Array): IndirectTable {
  if (data.length < 8) throw new Error(`i.bin too short (${data.length} bytes)`);
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== INDIRECT_MAGIC) throw new Error(`i.bin magic "${magic}"`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = dv.getInt32(4, false);
  if (count < 0 || 8 + count * 8 > data.length) throw new Error(`i.bin: ${count} rows in ${data.length} bytes`);
  const rows: IndirectRow[] = [];
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 8;
    const stage = data[o + 2];
    rows.push({ id: dv.getInt16(o, false), stage, stageValue: STAGE_VALUES[stage as 0 | 1 | 2] ?? -1, b3: data[o + 3], info: data[o + 4] });
  }
  return { rows };
}

// The row an indirect entry gets (MapGeometry_InitializeMeshTrees_0080a650:
// the first row with its id), or null.
export function indirectRow(table: IndirectTable | null, id: number): IndirectRow | null {
  if (!table) return null;
  return table.rows.find((r) => r.id === id) ?? null;
}

// The i.bin of a map: the n.rel name with "n.rel" replaced by "i.bin".
export function indirectFileFor(nrelName: string): string {
  return nrelName.replace(/n\.rel$/i, 'i.bin');
}

// Whether the exe's draw loops draw an entry with this table (null: no i.bin,
// every indirect record keeps an empty slot). Entries without flag 0x200 are
// not indirect and always pass.
export function indirectEntryDrawn(entry: { flags: number; animated: boolean; indirectId: number | null }, table: IndirectTable | null): boolean {
  if (!(entry.flags & ENTRY_INDIRECT)) return true;
  if (!entry.animated && entry.flags & ENTRY_GC_EFFECT) return true; // drawn plainly, no slot test
  if (!entry.animated && entry.flags & ENTRY_GC_ONLY) return false; // only the GameCube hook
  return entry.indirectId !== null && indirectRow(table, entry.indirectId) !== null;
}

// Clears `rendered` on the indirect entries the exe would not draw; returns
// how many.
export function applyIndirectTable(geometry: MapGeometry, table: IndirectTable | null): number {
  let hidden = 0;
  for (const s of geometry.sections) {
    for (const e of s.entries) {
      if (e.rendered && !indirectEntryDrawn(e, table)) {
        e.rendered = false;
        hidden++;
      }
    }
  }
  return hidden;
}
