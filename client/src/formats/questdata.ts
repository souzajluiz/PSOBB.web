// Typed data labels of quest scripts: the structures that the opcodes reference
// through a label (`set_enemy_physical_data`, `prepare_npc_visual`, `window_msg`
// style strings, `get_vector_from_path`, ...). Layouts follow newserv
// (src/BattleParamsIndex.hh, src/LevelTable.hh, src/PlayerSubordinates.hh,
// src/CommonFileFormats.hh, MIT). All values are little-endian.
//
// `decodeTypedData` splits a label's bytes into named fields, `encodeTypedData`
// builds them back. The disassembler only uses a decoded form when the encoder
// reproduces the bytes exactly, so a label that does not fit its type stays as
// `.data` hex.

export type TypedDataKind =
  | 'PLAYER_STATS'
  | 'PLAYER_VISUAL_CONFIG'
  | 'RESIST_DATA'
  | 'ATTACK_DATA'
  | 'MOVEMENT_DATA'
  | 'VECTOR4F_LIST';

// One field of a record. `bits` is the raw integer / float bit pattern (floats
// as their IEEE 754 single bits), `bytes` is hex-coded raw bytes, `text` is a
// string (ASCII or UTF-16 code units, NUL-terminated and padded to the field).
export type FieldValue = { int: number } | { float: number } | { bytes: Uint8Array } | { text: string };

export interface FieldDef {
  name: string;
  off: number;
  t: 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'bytes' | 'ascii' | 'utf16';
  n?: number | undefined; // byte count of bytes / ascii / utf16 fields
}

export interface FixedLayout {
  kind: Exclude<TypedDataKind, 'VECTOR4F_LIST'>;
  size: number;
  fields: readonly FieldDef[];
}

const f = (name: string, off: number, t: FieldDef['t'], n?: number): FieldDef => (n === undefined ? { name, off, t } : { name, off, t, n });

const CHAR_STATS = ['atp', 'mst', 'evp', 'hp', 'dfp', 'ata', 'lck'] as const;

const LAYOUTS: Record<FixedLayout['kind'], FixedLayout> = {
  // PlayerStats: CharacterStats (7 x u16), esp, attack / knockback range, level, exp, meseta.
  PLAYER_STATS: {
    kind: 'PLAYER_STATS',
    size: 0x24,
    fields: [
      ...CHAR_STATS.map((n, i) => f(n, i * 2, 'u16')),
      f('esp', 0x0e, 'u16'),
      f('attack_range', 0x10, 'f32'),
      f('knockback_range', 0x14, 'f32'),
      f('level', 0x18, 'u32'),
      f('exp', 0x1c, 'u32'),
      f('meseta', 0x20, 'u32'),
    ],
  },
  // AttackData (BattleParamsIndex.hh).
  ATTACK_DATA: {
    kind: 'ATTACK_DATA',
    size: 0x30,
    fields: [
      f('min_atp', 0x00, 'i16'),
      f('max_atp', 0x02, 'i16'),
      f('min_ata', 0x04, 'i16'),
      f('max_ata', 0x06, 'i16'),
      f('distance_x', 0x08, 'f32'),
      f('angle', 0x0c, 'u32'),
      f('distance_y', 0x10, 'f32'),
      f('a8', 0x14, 'u16'),
      f('a9', 0x16, 'u16'),
      f('a10', 0x18, 'u16'),
      f('a11', 0x1a, 'u16'),
      f('a12', 0x1c, 'u32'),
      f('a13', 0x20, 'u32'),
      f('a14', 0x24, 'u32'),
      f('a15', 0x28, 'u32'),
      f('a16', 0x2c, 'u32'),
    ],
  },
  // ResistData (BattleParamsIndex.hh).
  RESIST_DATA: {
    kind: 'RESIST_DATA',
    size: 0x20,
    fields: [
      f('evp_bonus', 0x00, 'i16'),
      f('efr', 0x02, 'u16'),
      f('eic', 0x04, 'u16'),
      f('eth', 0x06, 'u16'),
      f('elt', 0x08, 'u16'),
      f('edk', 0x0a, 'u16'),
      f('a6', 0x0c, 'u32'),
      f('a7', 0x10, 'u32'),
      f('a8', 0x14, 'u32'),
      f('a9', 0x18, 'u32'),
      f('dfp_bonus', 0x1c, 'i32'),
    ],
  },
  // MovementData (BattleParamsIndex.hh).
  MOVEMENT_DATA: {
    kind: 'MOVEMENT_DATA',
    size: 0x30,
    fields: [
      ...[1, 2, 3, 4, 5, 6].map((i) => f(`fparam${i}`, (i - 1) * 4, 'f32')),
      ...[1, 2, 3, 4, 5, 6].map((i) => f(`iparam${i}`, 0x18 + (i - 1) * 4, 'u32')),
    ],
  },
  // PlayerVisualConfigV4 (PlayerSubordinates.hh): the NPC's visual config as
  // get_npc_data reads it. The shared part starts at 0x10.
  PLAYER_VISUAL_CONFIG: {
    kind: 'PLAYER_VISUAL_CONFIG',
    size: 0x70,
    fields: [
      f('guild_card_number', 0x00, 'ascii', 0x10),
      f('unknown_a2', 0x10, 'bytes', 8),
      f('name_color', 0x18, 'u32'),
      f('extra_model', 0x1c, 'u8'),
      f('npc_saved_data_type', 0x1d, 'u8'),
      f('npc_saved_costume', 0x1e, 'u8'),
      f('npc_saved_skin', 0x1f, 'u8'),
      f('npc_saved_face', 0x20, 'u8'),
      f('npc_saved_head', 0x21, 'u8'),
      f('npc_saved_hair', 0x22, 'u8'),
      f('npc_saved_hair_r', 0x23, 'u8'),
      f('npc_saved_hair_g', 0x24, 'u8'),
      f('npc_saved_hair_b', 0x25, 'u8'),
      f('unused', 0x26, 'bytes', 2),
      f('npc_saved_proportion_y', 0x28, 'f32'),
      f('name_color_checksum', 0x2c, 'u32'),
      f('section_id', 0x30, 'u8'),
      f('char_class', 0x31, 'u8'),
      f('validation_flags', 0x32, 'u8'),
      f('version', 0x33, 'u8'),
      f('class_flags', 0x34, 'u32'),
      f('costume', 0x38, 'u16'),
      f('skin', 0x3a, 'u16'),
      f('face', 0x3c, 'u16'),
      f('head', 0x3e, 'u16'),
      f('hair', 0x40, 'u16'),
      f('hair_r', 0x42, 'u16'),
      f('hair_g', 0x44, 'u16'),
      f('hair_b', 0x46, 'u16'),
      f('proportion_x', 0x48, 'f32'),
      f('proportion_y', 0x4c, 'f32'),
      f('name', 0x50, 'utf16', 0x20),
    ],
  },
};

export const TYPED_DATA_KINDS: readonly TypedDataKind[] = ['PLAYER_STATS', 'PLAYER_VISUAL_CONFIG', 'RESIST_DATA', 'ATTACK_DATA', 'MOVEMENT_DATA', 'VECTOR4F_LIST'];

export function typedLayout(kind: Exclude<TypedDataKind, 'VECTOR4F_LIST'>): FixedLayout {
  return LAYOUTS[kind];
}

// A decoded record: the fields in layout order. VECTOR4F_LIST has one record
// per 16-byte entry, with the fields x, y, z, t.
export type TypedRecord = [string, FieldValue][];

const VECTOR_FIELDS = ['x', 'y', 'z', 't'] as const;

// Returns the records of a label of this kind, or null when its size does not fit the kind.
export function decodeTypedData(kind: TypedDataKind, data: Uint8Array): TypedRecord[] | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (kind === 'VECTOR4F_LIST') {
    if (!data.length || data.length % 16) return null;
    const out: TypedRecord[] = [];
    for (let o = 0; o < data.length; o += 16) {
      out.push(VECTOR_FIELDS.map((n, i) => [n, { float: dv.getUint32(o + i * 4, true) }] as [string, FieldValue]));
    }
    return out;
  }
  const layout = LAYOUTS[kind];
  if (data.length !== layout.size) return null;
  const rec: TypedRecord = [];
  for (const d of layout.fields) {
    const o = d.off;
    let v: FieldValue;
    switch (d.t) {
      case 'u8':
        v = { int: data[o] };
        break;
      case 'i8':
        v = { int: dv.getInt8(o) };
        break;
      case 'u16':
        v = { int: dv.getUint16(o, true) };
        break;
      case 'i16':
        v = { int: dv.getInt16(o, true) };
        break;
      case 'u32':
        v = { int: dv.getUint32(o, true) };
        break;
      case 'i32':
        v = { int: dv.getInt32(o, true) };
        break;
      case 'f32':
        v = { float: dv.getUint32(o, true) };
        break;
      case 'bytes':
        v = { bytes: data.slice(o, o + d.n!) };
        break;
      case 'ascii':
      case 'utf16': {
        const units = d.t === 'ascii' ? 1 : 2;
        let s = '';
        for (let i = 0; i + units <= d.n!; i += units) {
          const c = units === 1 ? data[o + i] : dv.getUint16(o + i, true);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        v = { text: s };
        break;
      }
    }
    rec.push([d.name, v]);
  }
  return [rec];
}

// Builds the bytes of a label of this kind from its records. Throws when the
// fields are not the layout's, or a value does not fit its field.
export function encodeTypedData(kind: TypedDataKind, records: readonly TypedRecord[]): Uint8Array {
  if (kind === 'VECTOR4F_LIST') {
    const out = new Uint8Array(records.length * 16);
    const dv = new DataView(out.buffer);
    records.forEach((rec, r) => {
      if (rec.length !== 4) throw new Error('a vector has the fields x, y, z, t');
      rec.forEach(([name, v], i) => {
        if (name !== VECTOR_FIELDS[i] || !('float' in v)) throw new Error(`vector field ${name} is not ${VECTOR_FIELDS[i]}`);
        dv.setUint32(r * 16 + i * 4, v.float >>> 0, true);
      });
    });
    return out;
  }
  const layout = LAYOUTS[kind];
  if (records.length !== 1) throw new Error(`${kind} takes one record`);
  const rec = records[0];
  if (rec.length !== layout.fields.length) throw new Error(`${kind} has ${layout.fields.length} fields, got ${rec.length}`);
  const out = new Uint8Array(layout.size);
  const dv = new DataView(out.buffer);
  layout.fields.forEach((d, i) => {
    const [name, v] = rec[i];
    if (name !== d.name) throw new Error(`${kind} field ${d.name} expected, got ${name}`);
    const o = d.off;
    const int = (lo: number, hi: number): number => {
      if (!('int' in v) || v.int < lo || v.int > hi || !Number.isInteger(v.int)) throw new Error(`${kind} ${name}: an integer in ${lo}..${hi} expected`);
      return v.int;
    };
    switch (d.t) {
      case 'u8':
        out[o] = int(0, 0xff);
        break;
      case 'i8':
        dv.setInt8(o, int(-0x80, 0x7f));
        break;
      case 'u16':
        dv.setUint16(o, int(0, 0xffff), true);
        break;
      case 'i16':
        dv.setInt16(o, int(-0x8000, 0x7fff), true);
        break;
      case 'u32':
        dv.setUint32(o, int(0, 0xffffffff), true);
        break;
      case 'i32':
        dv.setInt32(o, int(-0x80000000, 0x7fffffff), true);
        break;
      case 'f32':
        if (!('float' in v)) throw new Error(`${kind} ${name}: a float expected`);
        dv.setUint32(o, v.float >>> 0, true);
        break;
      case 'bytes': {
        if (!('bytes' in v) || v.bytes.length !== d.n) throw new Error(`${kind} ${name}: ${d.n} bytes expected`);
        out.set(v.bytes, o);
        break;
      }
      case 'ascii':
      case 'utf16': {
        if (!('text' in v)) throw new Error(`${kind} ${name}: a string expected`);
        const units = d.t === 'ascii' ? 1 : 2;
        if ((v.text.length + 1) * units > d.n!) throw new Error(`${kind} ${name}: the string does not fit`);
        for (let i = 0; i < v.text.length; i++) {
          const c = v.text.charCodeAt(i);
          if (c === 0 || (units === 1 && c > 0xff)) throw new Error(`${kind} ${name}: a character cannot be stored`);
          if (units === 1) out[o + i] = c;
          else dv.setUint16(o + i * 2, c, true);
        }
        break;
      }
    }
  });
  return out;
}

// The CSTRING label: UTF-16 code units and a zero unit. Returns null when the
// label is not exactly one such string.
export function decodeCString(data: Uint8Array): string | null {
  if (data.length < 2 || data.length % 2) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let s = '';
  for (let o = 0; o < data.length; o += 2) {
    const c = dv.getUint16(o, true);
    if (c === 0) return o + 2 === data.length ? s : null;
    s += String.fromCharCode(c);
  }
  return null;
}
