// set_cmode_char_template: Challenge Mode replaces every player with the
// starting character of its class (PsoBB.exe SendPacket0xDFSubcommand2_004db043
// -> InitializeChallengePlayerData_006aae34 -> SinowberillChallengePlayer_
// Constructor_00686258), and newserv mirrors it with Client::create_challenge_overlay
// (src/Client.cc):
//
//   - the inventory is emptied and the template's items put in (the equipped
//     ones equipped; the 30 slots are renumbered, the items get new ids);
//   - level and stats come from the level table: the class' base stats plus
//     every level's gain up to the template's level, EXP at that level's
//     threshold, ESP 40, no Meseta, no material bonuses;
//   - every technique is forgotten, then the template's techniques are
//     learned (technique, level);
//   - the bank is out of reach for the whole game.
//
// The templates are formats/challengetemplates.ts (16 per class group, read
// from the exe's tables for hunters, rangers and forces).

import {
  CHALLENGE_FORCE_TEMPLATES,
  CHALLENGE_HUNTER_TEMPLATES,
  CHALLENGE_RANGER_TEMPLATES,
  type ChallengeTemplate,
} from '../formats/challengetemplates.ts';
import { CLASS_FLAGS } from '../combat/progression.ts';
import type { LevelTable } from '../formats/plyleveltbl.ts';
import type { ItemData } from '../formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';

// (class flags & 0xE0): 0x20 hunters, 0x40 rangers, 0x80 forces
// (newserv get_challenge_template_definition).
export function challengeTemplate(charClass: number, index: number): ChallengeTemplate {
  const flags = (CLASS_FLAGS[charClass] ?? 0x20) & 0xe0;
  const list = flags === 0x80 ? CHALLENGE_FORCE_TEMPLATES : flags === 0x40 ? CHALLENGE_RANGER_TEMPLATES : CHALLENGE_HUNTER_TEMPLATES;
  const t = list[index];
  if (!t) throw new Error(`no Challenge template ${index}`);
  return t;
}

// An ItemData out of a template's 16 hex bytes (data1[12], data2[4]); the id
// comes later.
export function templateItem(hex: string, id: number): ItemData {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return { data1: b.slice(0, 12), id, data2: b.slice(12, 16) };
}

// The character `index` makes of `base`, as a new CharacterFile (base is not
// touched). `newItemId` gives the ids (increment_item_id_for_player: the
// client and newserv count the same way).
export function buildChallengeOverlay(base: CharacterFile, index: number, table: LevelTable, newItemId: () => number): CharacterFile {
  const tpl = challengeTemplate(base.charClass, index);
  const out: CharacterFile = structuredClone(base);
  const inventory: InventoryItem[] = tpl.items.map((it, i) => ({
    index: i,
    state: it.equipped ? 2 : 1,
    flags: it.equipped ? 8 : 0,
    extensionData1: 0,
    extensionData2: 0,
    equipped: it.equipped,
    data: templateItem(it.data, newItemId()),
  }));
  out.inventory = inventory;
  // reset_to_base + advance_to_level.
  const b = table.base[base.charClass];
  if (!b) throw new Error(`no level table for class ${base.charClass}`);
  const s = { atp: b.atp, mst: b.mst, evp: b.evp, hp: b.hp, dfp: b.dfp, ata: b.ata, lck: b.lck };
  for (let l = 1; l <= tpl.level; l++) {
    const d = table.delta(base.charClass, l);
    s.atp += d.atp;
    s.mst += d.mst;
    s.evp += d.evp;
    s.hp += d.hp;
    s.dfp += d.dfp;
    s.ata += d.ata;
    s.lck += d.lck;
  }
  out.stats = { ...s, esp: 40 };
  out.level = tpl.level + 1;
  out.exp = table.expForLevel(base.charClass, tpl.level);
  out.meseta = 0;
  out.hpFromMaterials = 0;
  out.tpFromMaterials = 0;
  out.techLevels = new Array<number | null>(19).fill(null);
  for (const [tech, level] of tpl.techs) out.techLevels[tech] = level + 1;
  return out;
}

// Puts the overlay's inventory, stats and techniques into the live character
// (the panels and the item code keep their reference to it).
export function applyOverlay(target: CharacterFile, overlay: CharacterFile): void {
  target.inventory.splice(0, target.inventory.length, ...overlay.inventory);
  Object.assign(target.stats, overlay.stats);
  target.level = overlay.level;
  target.exp = overlay.exp;
  target.meseta = overlay.meseta;
  target.hpFromMaterials = overlay.hpFromMaterials;
  target.tpFromMaterials = overlay.tpFromMaterials;
  target.techLevels.splice(0, target.techLevels.length, ...overlay.techLevels);
}

// The raw E7 save the join sync and 6x70 read: inventory (with Meseta), stats,
// level, EXP, materials and the technique levels (PlayerDispDataV4 @0x34C:
// stats @0, level @0x18, EXP @0x1C, technique_levels_v1 @0x17C; inventory
// bytes 1 / 2 are the HP / TP materials; a technique's level is
// technique_levels_v1[t] + inventory.items[t].extension_data1 + 1).
export function writeOverlayRaw(c: CharacterFile, raw: Uint8Array): void {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const disp = 0x34c;
  raw.fill(0, 4, 4 + 30 * 0x1c);
  raw[0] = c.inventory.length;
  raw[1] = c.hpFromMaterials;
  raw[2] = c.tpFromMaterials;
  c.inventory.forEach((it, i) => {
    const o = 4 + i * 0x1c;
    raw[o] = it.state;
    raw[o + 2] = it.extensionData1;
    raw[o + 3] = it.extensionData2;
    dv.setUint32(o + 4, it.flags >>> 0, true);
    raw.set(it.data.data1, o + 8);
    dv.setUint32(o + 20, it.data.id >>> 0, true);
    raw.set(it.data.data2, o + 24);
  });
  const st = c.stats;
  [st.atp, st.mst, st.evp, st.hp, st.dfp, st.ata, st.lck, st.esp].forEach((v, i) => dv.setUint16(disp + i * 2, v & 0xffff, true));
  dv.setUint32(disp + 0x18, c.level - 1, true);
  dv.setUint32(disp + 0x1c, c.exp, true);
  dv.setUint32(disp + 0x20, c.meseta, true);
  for (let t = 0; t < 19; t++) {
    const l = c.techLevels[t];
    raw[disp + 0x17c + t] = l === null || l === undefined ? 0xff : l - 1;
  }
}
