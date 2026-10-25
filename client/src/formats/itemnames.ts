// Item names and one-line descriptions.
//
// Names: the item's ItemPMT entry `id` indexes unitxt collection 1 (on BB;
// newserv calls it "collection 0" of its own TextSet numbering for GC and uses
// `text_index->get(BB_V4, ENGLISH, 1)` for BB). Weapon special names follow the
// same table at SPECIAL_STARS_BEGIN_INDEX + special, technique names are
// collection 5 and "Disk:" is the tech-disk tool's own name.
//
// The description format follows newserv src/ItemNameIndex.cc describe_item
// (MIT license): "[Wrapped] [????] [Special] Name [+grind] [bonuses]".

import { SPECIAL_STARS_BEGIN_INDEX, type ItemPMT } from './itempmt.ts';

// ItemData (0x14 bytes): data1[12], u32 id, data2[4]
export interface ItemData {
  data1: Uint8Array; // 12 bytes
  id: number;
  data2: Uint8Array; // 4 bytes
}

export function readItemData(src: Uint8Array, offset: number): ItemData {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return {
    data1: src.slice(offset, offset + 12),
    id: dv.getUint32(offset + 12, true),
    data2: src.slice(offset + 16, offset + 20),
  };
}

export function itemFromHex(hex: string): ItemData {
  const b = new Uint8Array(20);
  const clean = hex.replace(/\s+/g, '');
  for (let i = 0; i < clean.length / 2 && i < 20; i++) b[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return readItemData(b, 0);
}

const w16 = (d: Uint8Array, i: number) => d[i * 2] | (d[i * 2 + 1] << 8); // data1w[i]
const s16 = (v: number) => (v & 0x8000 ? v - 0x10000 : v);

export const TECH_NAMES = [
  'Foie', 'Gifoie', 'Rafoie', 'Barta', 'Gibarta', 'Rabarta', 'Zonde', 'Gizonde', 'Razonde', 'Grants',
  'Deband', 'Jellen', 'Zalure', 'Shifta', 'Ryuker', 'Resta', 'Anti', 'Reverser', 'Megid',
];

export const MAG_COLORS = [
  'red', 'blue', 'yellow', 'green', 'purple', 'black', 'white', 'cyan', 'brown', 'orange', 'light-blue', 'olive',
  'turquoise', 'fuchsia', 'grey', 'cream', 'pink', 'dark-green', 'costume',
];

// newserv StaticGameData.cc; used when no text table matches the PMT.
const SPECIAL_NAMES = [
  '', 'Draw', 'Drain', 'Fill', 'Gush', 'Heart', 'Mind', 'Soul', 'Geist', "Master's", "Lord's", "King's", 'Charge',
  'Spirit', 'Berserk', 'Ice', 'Frost', 'Freeze', 'Blizzard', 'Bind', 'Hold', 'Seize', 'Arrest', 'Heat', 'Fire',
  'Flame', 'Burning', 'Shock', 'Thunder', 'Storm', 'Tempest', 'Dim', 'Shadow', 'Dark', 'Hell', 'Panic', 'Riot',
  'Havoc', 'Chaos', "Devil's", "Demon's",
];

const S_RANK_SPECIALS = [
  '', 'Jellen', 'Zalure', 'HP-Revival', 'TP-Revival', 'Burning', 'Tempest', 'Blizzard', 'Arrest', 'Chaos', 'Hell',
  'Spirit', 'Berserk', "Demon's", 'Gush', 'Geist', "King's",
];
const S_RANK_CHARS = '\0ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_';

// ItemData.cc DEFAULT_TOOL_LIMITS_V3_V4, indexed by data1[1] (last entry repeats)
const TOOL_STACK_LIMITS = [10, 10, 1, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1, 1, 1, 1, 99, 1];
export function maxStackSize(item: ItemData): number {
  if (item.data1[0] !== 3) return 1;
  return TOOL_STACK_LIMITS[Math.min(item.data1[1], TOOL_STACK_LIMITS.length - 1)];
}

export function isSRankWeapon(item: ItemData): boolean {
  const [c0, c1] = item.data1;
  return c0 === 0 && ((c1 > 0x6f && c1 < 0x89) || (c1 > 0xa4 && c1 < 0xaa));
}

// ItemData::primary_identifier
export function primaryIdentifier(item: ItemData): number {
  const d = item.data1;
  if (d[0] === 4) return 0x04000000;
  if (d[0] === 3 && d[1] === 2) return (0x03020000 | (d[4] << 8) | d[2]) >>> 0;
  if (d[0] === 2) return 0x02000000 | (d[1] << 16);
  if (isSRankWeapon(item)) return (d[0] << 24) | (d[1] << 16);
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8)) >>> 0;
}

// Photon blast in a mag slot (0 center, 1 right, 2 left), ItemData::mag_photon_blast_for_slot
export function magPhotonBlast(item: ItemData, slot: number): number | null {
  const flags = item.data2[2];
  const pbs = item.data1[3];
  if (slot === 0) return flags & 1 ? pbs & 7 : null;
  if (slot === 1) return flags & 2 ? (pbs >> 3) & 7 : null;
  if (!(flags & 4)) return null;
  const used = (1 << (pbs & 7)) | (1 << ((pbs >> 3) & 7));
  let left = (pbs >> 6) & 3;
  for (let z = 0; z < 6; z++) {
    if (!(used & (1 << z))) {
      if (!left) return z;
      left--;
    }
  }
  return null;
}

export interface MagStats {
  level: number;
  def: number; // in hundredths of a level, as stored
  pow: number;
  dex: number;
  mind: number;
  synchro: number;
  iq: number;
  color: number;
  photonBlasts: Array<number | null>; // center, right, left
}

export function magStats(item: ItemData): MagStats {
  const d = item.data1;
  return {
    level: d[2],
    def: w16(d, 2),
    pow: w16(d, 3),
    dex: w16(d, 4),
    mind: w16(d, 5),
    synchro: item.data2[0],
    iq: item.data2[1],
    color: item.data2[3],
    photonBlasts: [0, 1, 2].map((s) => magPhotonBlast(item, s)),
  };
}

export class ItemNames {
  readonly pmt: ItemPMT;
  readonly text: string[][] | null; // unitxt collections; null = no matching table

  constructor(pmt: ItemPMT, text: string[][] | null) {
    this.pmt = pmt;
    this.text = text;
  }

  // The client indexes its text table with the PMT ids, so both must come from
  // the same build. A text table from another build gives wrong names, not an
  // error. Heuristic check: every id is in range, and the entry right after the
  // weapon specials (SPECIAL_STARS_BEGIN_INDEX + special count) is "????", the
  // unidentified-item name.
  static textMatches(pmt: ItemPMT, text: string[][]): boolean {
    const names = text[1];
    if (!names) return false;
    let maxId = 0;
    const visit = (e: { id: number } | undefined) => {
      if (e && e.id !== 0xffffffff) maxId = Math.max(maxId, e.id);
    };
    pmt.weapons.forEach((c) => c.forEach(visit));
    [pmt.armors, pmt.shields, pmt.units, pmt.mags].forEach((t) => t.forEach(visit));
    pmt.tools.forEach((c) => c.forEach(visit));
    return maxId < names.length && names[SPECIAL_STARS_BEGIN_INDEX + pmt.specials.length] === '????';
  }

  private textAt(group: number, index: number): string | undefined {
    const s = this.text?.[group]?.[index];
    return s === undefined || s === '' ? undefined : s;
  }

  // PMT id for the item, as in ItemParameterTable::get_item_id
  itemId(item: ItemData): number | undefined {
    const [c0, c1, c2, , c4] = item.data1;
    const p = this.pmt;
    switch (c0) {
      case 0:
        return p.getWeapon(c1, isSRankWeapon(item) ? 0 : c2)?.id;
      case 1:
        if (c1 === 1) return p.armors[c2]?.id;
        if (c1 === 2) return p.shields[c2]?.id;
        if (c1 === 3) return p.units[c2]?.id;
        return undefined;
      case 2:
        return p.mags[c1]?.id;
      case 3:
        return c1 === 2 ? p.getTool(2, c4)?.id : p.getTool(c1, c2)?.id;
      default:
        return undefined;
    }
  }

  // The item's team points (ItemPMT), as newserv ItemParameterTable::get_item_team_points reads
  // them (the raw subtype, no S-rank remap). undefined when the item has no table entry.
  teamPoints(item: ItemData): number | undefined {
    const [c0, c1, c2, , c4] = item.data1;
    const p = this.pmt;
    switch (c0) {
      case 0:
        return p.getWeapon(c1, c2)?.teamPoints;
      case 1:
        if (c1 === 1) return p.armors[c2]?.teamPoints;
        if (c1 === 2) return p.shields[c2]?.teamPoints;
        if (c1 === 3) return p.units[c2]?.teamPoints;
        return undefined;
      case 2:
        return p.mags[c1]?.teamPoints;
      case 3:
        return c1 === 2 ? p.getTool(2, c4)?.teamPoints : p.getTool(c1, c2)?.teamPoints;
      default:
        return undefined;
    }
  }

  // Bare item name (no grind, specials or counts)
  baseName(item: ItemData): string {
    const id = this.itemId(item);
    const name = id === undefined ? undefined : this.textAt(1, id);
    return name ?? `!ID:${primaryIdentifier(item).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  specialName(special: number): string {
    return this.textAt(1, SPECIAL_STARS_BEGIN_INDEX + special) ?? SPECIAL_NAMES[special] ?? `!SP:${special.toString(16)}`;
  }

  techName(tech: number): string {
    return this.textAt(5, tech) ?? TECH_NAMES[tech] ?? `!TD:${tech.toString(16)}`;
  }

  isRare(item: ItemData): boolean {
    const d = item.data1;
    if (d[0] === 0 || d[0] === 1) {
      const id = this.itemId(item);
      return id !== undefined && this.pmt.itemStars(id) >= 9;
    }
    if (d[0] === 2) return d[1] >= 0x28;
    if (d[0] === 3) {
      const t = d[1] === 2 ? this.pmt.getTool(2, d[4]) : this.pmt.getTool(d[1], d[2]);
      return !!t && (t.itemFlags & 0x80) !== 0;
    }
    return false;
  }

  // One-line description, newserv describe_item without color escapes.
  describe(item: ItemData, meseta?: number): string {
    const d = item.data1;
    if (d[0] === 4) {
      const amount = meseta ?? new DataView(item.data2.buffer, item.data2.byteOffset, 4).getUint32(0, true);
      return `${amount} Meseta`;
    }
    const tokens: string[] = [];
    const sRank = isSRankWeapon(item);
    if (d[0] === 0 && d[4] !== 0 && !sRank) {
      if (d[4] & 0x40) tokens.push('Wrapped');
      if (d[4] & 0x80) tokens.push('????');
      if (d[4] & 0x3f) tokens.push(this.specialName(d[4] & 0x3f));
    }
    if (d[0] === 0 && d[2] !== 0 && sRank) tokens.push(S_RANK_SPECIALS[d[2]] ?? `!SSP:${d[2].toString(16)}`);
    if (
      (d[0] === 1 && d[4] & 0x40) ||
      (d[0] === 2 && item.data2[2] & 0x40) ||
      (d[0] === 3 && maxStackSize(item) === 1 && d[3] & 0x40)
    ) {
      tokens.push('Wrapped');
    }

    if (d[0] === 3 && d[1] === 2) {
      const disk = this.textAt(1, this.pmt.getTool(2, d[4])?.id ?? -1) ?? 'Disk:';
      const tech = this.techName(d[4]);
      // Reverser (0x11) and Ryuker (0x0E) hide their level when it is 1
      tokens.push(d[2] === 0 && (d[4] === 0x0e || d[4] === 0x11) ? `${disk}${tech}` : `${disk}${tech} Lv.${d[2] + 1}`);
    } else {
      tokens.push(this.baseName(item));
    }

    if (d[0] === 0) {
      if (d[3] > 0) tokens.push(`+${d[3]}`);
      if (sRank) {
        // Name in 5-bit characters, big-endian words data1w[3..5]
        const be = (i: number) => (d[i * 2] << 8) | d[i * 2 + 1];
        const w3 = be(3), w4 = be(4), w5 = be(5);
        const hideType = (w3 & 0x7c00) === 0x0800;
        const idx = [(w3 >> 5) & 31, w3 & 31, (w4 >> 10) & 31, (w4 >> 5) & 31, w4 & 31, (w5 >> 10) & 31, (w5 >> 5) & 31, w5 & 31];
        let name = '';
        for (const i of idx) {
          if (i === 0) break;
          name += S_RANK_CHARS[i];
        }
        if (name) tokens.push(hideType ? `"${name}"` : `(${name})`);
      } else {
        let n = 3;
        if (d[10] & 0x80) {
          tokens.push(`K:${((d[10] << 8) | d[11]) & 0x7fff}`);
          n = 2;
        }
        const bonuses = [0, 0, 0, 0, 0];
        for (let x = 0; x < n; x++) {
          const which = d[6 + 2 * x];
          const value = d[7 + 2 * x] << 24 >> 24; // signed
          if (which === 0) continue;
          if (which > 5) tokens.push(`!PC:${which.toString(16)}${value.toString(16)}`);
          else bonuses[which - 1] = value;
        }
        if (bonuses.some((b) => b !== 0)) tokens.push(bonuses.slice(0, bonuses[4] !== 0 ? 5 : 4).join('/'));
      }
    } else if (d[0] === 1) {
      if (d[1] === 3) {
        const m = s16(w16(d, 3));
        const last = tokens.length - 1;
        if (m === 1 || m === 2) tokens[last] += '+';
        else if (m >= 3) tokens[last] += '++';
        else if (m === -1 || m === -2) tokens[last] += '-';
        else if (m <= -3) tokens[last] += '--';
        if (d[10] & 0x80) tokens.push(`K:${((d[10] << 8) | d[11]) & 0x7fff}`);
      } else {
        if (d[5] > 0) tokens.push(d[5] === 1 ? '(1 slot)' : `(${d[5]} slots)`);
        const def = s16(w16(d, 3));
        const evp = s16(w16(d, 4));
        if (def !== 0) tokens.push(`+${def}DEF`);
        if (evp !== 0) tokens.push(`+${evp}EVP`);
      }
    } else if (d[0] === 2) {
      const m = magStats(item);
      const stat = (v: number) => {
        const level = Math.floor(v / 100);
        const part = v % 100;
        if (part === 0) return `${level}`;
        if (part % 10 === 0) return `${level}.${part / 10}`;
        return `${level}.${String(part).padStart(2, '0')}`;
      };
      tokens.push(`LV${m.level}`);
      tokens.push([m.def, m.pow, m.dex, m.mind].map(stat).join('/'));
      tokens.push(`${m.synchro}%`);
      tokens.push(`${m.iq}IQ`);
      if (item.data2[2] & 7) {
        const short = ['F', 'E', 'G', 'P', 'L', 'M&Y', 'MG', 'GR'];
        const names = [m.photonBlasts[2], m.photonBlasts[0], m.photonBlasts[1]]
          .filter((p): p is number => p !== null)
          .map((p) => short[p]);
        tokens.push(`PB:${names.join(',')}`);
      }
      tokens.push(`(${MAG_COLORS[m.color] ?? `!CL:${m.color.toString(16)}`})`);
    } else if (d[0] === 3) {
      if (maxStackSize(item) > 1) tokens.push(`x${d[5]}`);
    }
    return tokens.join(' ');
  }
}
