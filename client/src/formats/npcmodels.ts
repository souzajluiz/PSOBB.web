// NPC set entries (map_*e.dat and quest .dat enemy chunks) -> model, motion
// table and talk parameters, reverse-engineered from PsoBB.exe (Ephinea
// 1.25.13; addresses are VAs).
//
// Construction (the same per-area factory table as the enemies, 0x009fba60,
// formats/enemymodels.ts): every humanoid NPC factory allocates a 0x3c0-byte
// object and runs an initializer that
//   1. calls one of three base constructors, which differ only in the motion
//      table they hand to Player__ApplyWeaponAnimationData (the motion slot
//      setup shared with the players, FUN_007aa4c8):
//        SpawnEnemyTypeA_00609010            table 0x0092f470 (women)
//        InitializeChallengePlayerObject_0060c858  table 0x0092f79c (men)
//        ConstructEnemyTypeA_0060a580        table 0x0092f5a4 (TObjNpcHFW00 / NFW01)
//      Each table has two 0x10-byte rows {u16 mode, u16 next, u32 motion,
//      f32 frames per tick, u32 flags}: row 0 = idle {1, -, 0, 0.9, 1},
//      row 1 = walk {1, -, 2 | 1 | 3, 1.4, 0x20000002}. The motion indices are
//      NJS_ACTION entries of plymotionnpctown.cpt (see NPC_TOWN_MOTIONS);
//   2. sets obj+0x34 (model) and obj+0x24 (texture list) from either
//        - a BML model set (LoadBML_005b7a84 with an asset descriptor {bml,
//          models, motions, counts}: model entry 0, *(set+0x42c)+8 / +0xC), or
//        - a REL model (load_rel_asset: *root is the NJS_OBJECT) plus a
//          separate texture archive (LoadPvmFileTls; the PC client reads the
//          .gvm names as .xvm);
//   3. SetupEnemyObject_00606bc8: collision box 0x009c3e8c, turn parameters
//      0x009c3eb0 (+8 = 0x400 BAMS per tick).
// Every NPC model is a 64-node player-style skeleton (n_*_body.nj), which is
// why the town motions (also 64 nodes) drive all of them.
//
// The set entry's parameters (InitializeEnemyBaseObject_00606c28 and the
// set_params override at 0x00606a34; param1..5 are floats at +0x35c..+0x36c):
//   param2  "display on" register (+0x3a8): the NPC is shown only while that
//           quest register is non-zero (0 = always shown);
//   param3  "display off" register (+0x3ac): hidden while it is non-zero;
//           a value >= 1000 (0x0092f134) means register (value - 1000) of the
//           area's own script instead of the quest's (+0x394 = 1), see
//           UpdateMovementRestriction_00606f10;
//   param4  talk action (+0x3b4): 100..999 runs the talk label in the quest
//           script (g_CurrentQuestPointer), >= 1000 in the area script
//           (g_CurrentQuestDataPointer, map_city_on_e.bin & co., see
//           cityScriptFile); it is also the id the script's `message` opcode
//           names the speaker by (opcode_message .c:604178 matches +0x3b4);
//   param5  talk label (+0x3b0): the label the talk thread starts at; 0 or
//           less = the NPC cannot be talked to (EnemyObjectUpdate_0060648c);
//   draw distance (+0x3a0) 400 when param4 > 0, else 250.

import { parseNjMotion, type NjMotion } from './njmotion.ts';
import { prcDecompress } from './prc.ts';
import { RelFile } from './rel.ts';

export type NpcMotionFamily = 'female' | 'male' | 'hfw';

// Motion tables of the three base constructors: [idle, walk] NJS_ACTION
// indices into plymotionnpctown.cpt with their frames-per-tick speed.
export const NPC_MOTION_TABLES: Record<NpcMotionFamily, { table: number; idle: { motion: number; speed: number }; walk: { motion: number; speed: number } }> = {
  female: { table: 0x0092f470, idle: { motion: 0, speed: 0.9 }, walk: { motion: 2, speed: 1.4 } },
  male: { table: 0x0092f79c, idle: { motion: 0, speed: 0.9 }, walk: { motion: 1, speed: 1.4 } },
  hfw: { table: 0x0092f5a4, idle: { motion: 0, speed: 0.9 }, walk: { motion: 3, speed: 1.4 } },
};

// LoadNpcTownMotion_00607418: LoadAndProcessRelAsset_005b9568 reads it as a
// PRC (u32 size, u32 seed, encrypted PRS) REL whose root's first pointer is the
// NJS_ACTION array (4 entries, {object, motion}).
export const NPC_TOWN_MOTION_FILE = 'plymotionnpctown.cpt';
export const NPC_NODES = 64;

// The NJS_ACTION array of plymotionnpctown.cpt: 0 idle (30 frames), 1..3 the
// walk of each motion family. Angle keys are 16-bit (NJS_MKEY_SA), like the
// player motions.
export function parseNpcTownMotions(file: Uint8Array): NjMotion[] {
  const rel = new RelFile(prcDecompress(file));
  const actions = rel.u32(rel.root);
  const out: NjMotion[] = [];
  // The array has no count; it ends where the root record starts (the
  // entries are {u32 object, NJS_MOTION *motion}).
  for (let o = actions; o + 8 <= rel.root; o += 8) out.push(parseNjMotion(rel, rel.u32(o + 4), NPC_NODES, { shortAngles: true }));
  return out;
}

export type NpcModelSource =
  | { kind: 'bml'; bml: string; descriptor: number }
  | { kind: 'rel'; rel: string; textures: string };

export interface NpcClass {
  type: number;
  name: string; // client class name (newserv Map.cc)
  factory: number;
  init: number;
  family: NpcMotionFamily;
  // Fixed model, or chosen at construction time (see npcModelFor).
  model: NpcModelSource | 'tekker' | 'ngc';
}

const bml = (bml: string, descriptor: number): NpcModelSource => ({ kind: 'bml', bml, descriptor });
const rel = (rel: string, textures: string): NpcModelSource => ({ kind: 'rel', rel, textures });

// prettier-ignore
export const NPC_CLASSES: readonly NpcClass[] = [
  { type: 0x01, name: 'TObjNpcFemaleBase',   factory: 0x00609164, init: 0x00609230, family: 'female', model: bml('bm_n_ebw_i_body.bml', 0x009c4110) },
  { type: 0x02, name: 'TObjNpcFemaleChild',  factory: 0x00609448, init: 0x00609514, family: 'female', model: bml('bm_n_ecw_i_body.bml', 0x009c412c) },
  { type: 0x03, name: 'TObjNpcFemaleDwarf',  factory: 0x0060972c, init: 0x006097f8, family: 'female', model: bml('bm_n_efsw_i_body.bml', 0x009c4148) },
  { type: 0x04, name: 'TObjNpcFemaleFat',    factory: 0x00609a10, init: 0x00609adc, family: 'female', model: bml('bm_n_efw_i_body.bml', 0x009c4164) },
  { type: 0x05, name: 'TObjNpcFemaleMacho',  factory: 0x00609cf4, init: 0x00609dc0, family: 'female', model: bml('bm_n_emw_i_body.bml', 0x009c4180) },
  { type: 0x06, name: 'TObjNpcFemaleOld',    factory: 0x00609fd8, init: 0x0060a0a4, family: 'female', model: bml('bm_n_eow_i_body.bml', 0x009c419c) },
  { type: 0x07, name: 'TObjNpcFemaleTall',   factory: 0x0060a2bc, init: 0x0060a388, family: 'female', model: bml('bm_n_etw_i_body.bml', 0x009c41b8) },
  { type: 0x08, name: 'TObjNpcMaleBase',     factory: 0x0060c9ac, init: 0x0060ca78, family: 'male',   model: bml('bm_n_ebm_i_body.bml', 0x009c438c) },
  { type: 0x09, name: 'TObjNpcMaleChild',    factory: 0x0060cc90, init: 0x0060cd5c, family: 'male',   model: bml('bm_n_ecm_i_body.bml', 0x009c43a8) },
  { type: 0x0a, name: 'TObjNpcMaleDwarf',    factory: 0x0060cf74, init: 0x0060d040, family: 'male',   model: bml('bm_n_efsm_i_body_3.bml', 0x009c43c4) },
  { type: 0x0b, name: 'TObjNpcMaleFat',      factory: 0x0060d258, init: 0x0060d324, family: 'male',   model: bml('bm_n_efm_i_body.bml', 0x009c43e0) },
  { type: 0x0c, name: 'TObjNpcMaleMacho',    factory: 0x0060d53c, init: 0x0060d608, family: 'male',   model: bml('bm_n_emm_i_body.bml', 0x009c43fc) },
  { type: 0x0d, name: 'TObjNpcMaleOld',      factory: 0x0060d820, init: 0x0060d8ec, family: 'male',   model: bml('bm_n_eom_i_body.bml', 0x009c4418) },
  { type: 0x0e, name: 'TObjNpcMaleTall',     factory: 0x0060db04, init: 0x0060dbd0, family: 'male',   model: bml('bm_n_etm_i_body.bml', 0x009c4434) },
  { type: 0x19, name: 'TObjNpcSoldierBase',  factory: 0x0061097c, init: 0x00610a48, family: 'male',   model: bml('bm_n_gunb2_i_body.bml', 0x009c4764) },
  { type: 0x1a, name: 'TObjNpcSoldierMacho', factory: 0x00610c60, init: 0x00610d2c, family: 'male',   model: bml('bm_n_gunm_i_body.bml', 0x009c4780) },
  { type: 0x1b, name: 'TObjNpcGovernorBase', factory: 0x0060a6d4, init: 0x0060a7a0, family: 'male',   model: bml('bm_n_soutoku_i_body.bml', 0x009c41d8) },
  // The tekker: load_tekker_assets (0x00607c58) picks the descriptor by the
  // local character's section id (0x009c408c[section id]).
  { type: 0x1c, name: 'TObjNpcConnoisseur',  factory: 0x00607acc, init: 0x00607b98, family: 'male',   model: 'tekker' },
  { type: 0x1d, name: 'TObjNpcCloakroomBase',factory: 0x006077e8, init: 0x006078b4, family: 'female', model: bml('bm_n_trunk_i_body.bml', 0x009c3f88) },
  { type: 0x1e, name: 'TObjNpcExpertBase',   factory: 0x00608d4c, init: 0x00608e18, family: 'male',   model: bml('bm_n_hakase_i_body.bml', 0x009c40f0) },
  { type: 0x1f, name: 'TObjNpcNurseBase',    factory: 0x006103b4, init: 0x00610480, family: 'female', model: bml('bm_n_nurse_i_body.bml', 0x009c4710) },
  { type: 0x20, name: 'TObjNpcSecretaryBase',factory: 0x00610698, init: 0x00610764, family: 'female', model: bml('bm_n_hisyo_i_body.bml', 0x009c4748) },
  { type: 0x21, name: 'TObjNpcHHM00',        factory: 0x0060af08, init: 0x0060afd4, family: 'male',   model: rel('npc_a00_data.rel', 'n_a00_w_body.xvm') },
  { type: 0x22, name: 'TObjNpcNHW00',        factory: 0x0060fea4, init: 0x0060ff70, family: 'female', model: rel('npc_b00_data.rel', 'n_b00_body.xvm') },
  { type: 0x24, name: 'TObjNpcHRM00',        factory: 0x0060b770, init: 0x0060b83c, family: 'male',   model: rel('npc_d00_data.rel', 'n_d00_w_body.xvm') },
  { type: 0x25, name: 'TObjNpcARM00',        factory: 0x00605cdc, init: 0x00605da8, family: 'male',   model: rel('npc_e00_data.rel', 'n_e00_w_body.xvm') },
  { type: 0x26, name: 'TObjNpcARW00',        factory: 0x00605f88, init: 0x00606054, family: 'female', model: rel('npc_f00_data.rel', 'n_f00_w_body.xvm') },
  { type: 0x27, name: 'TObjNpcHFW00',        factory: 0x0060a9d8, init: 0x0060aaa4, family: 'hfw',    model: rel('npc_g00_data.rel', 'n_g00_body.xvm') },
  { type: 0x28, name: 'TObjNpcNFM00',        factory: 0x0060e430, init: 0x0060e4fc, family: 'male',   model: rel('npc_h00_data.rel', 'n_h00_body.xvm') },
  { type: 0x29, name: 'TObjNpcNFW00',        factory: 0x0060e960, init: 0x0060ea2c, family: 'female', model: rel('npc_i00_data.rel', 'n_i00_body.xvm') },
  { type: 0x2b, name: 'TObjNpcNHW01',        factory: 0x0061013c, init: 0x00610208, family: 'female', model: rel('npc_b01_data.rel', 'n_b01_e_body.xvm') },
  { type: 0x2c, name: 'TObjNpcAHM01',        factory: 0x006024b4, init: 0x00602580, family: 'male',   model: rel('npc_c01_data.rel', 'n_c01_e_body.xvm') },
  { type: 0x2d, name: 'TObjNpcHRM01',        factory: 0x0060ba08, init: 0x0060bad4, family: 'male',   model: rel('npc_d01_data.rel', 'n_d01_e_body.xvm') },
  { type: 0x30, name: 'TObjNpcHFW01',        factory: 0x0060ac70, init: 0x0060ad3c, family: 'hfw',    model: rel('npc_g01_data.rel', 'n_g01_e_body.xvm') },
  { type: 0x31, name: 'TObjNpcNFM01',        factory: 0x0060e6c8, init: 0x0060e794, family: 'male',   model: rel('npc_h01_data.rel', 'n_h01_e_body.xvm') },
  { type: 0x32, name: 'TObjNpcNFW01',        factory: 0x0060ebf8, init: 0x0060ecc4, family: 'female', model: rel('npc_i01_data.rel', 'n_i01_e_body.xvm') },
  { type: 0xd0, name: 'TObjNpcKenkyu',       factory: 0x0060bc80, init: 0x0060bd4c, family: 'male',   model: bml('bm_npc_kenkyu.bml', 0x009c4240) },
  { type: 0xd1, name: 'TObjNpcSoutokufu',    factory: 0x00610f44, init: 0x00611010, family: 'male',   model: bml('bm_npc_soutokufu.bml', 0x009c479c) },
  { type: 0xd2, name: 'TObjNpcHosa',         factory: 0x0060b180, init: 0x0060b24c, family: 'male',   model: bml('bm_npc_hosa.bml', 0x009c4200) },
  { type: 0xd3, name: 'TObjNpcKenkyuW',      factory: 0x0060c250, init: 0x0060c31c, family: 'male',   model: bml('bm_npc_kenkyu_w.bml', 0x009c4278) },
  { type: 0xf0, name: 'TObjNpcHosa2',        factory: 0x0060b468, init: 0x0060b534, family: 'male',   model: bml('bm_npc_hosa2.bml', 0x009c421c) },
  { type: 0xf1, name: 'TObjNpcKenkyu2',      factory: 0x0060bf68, init: 0x0060c034, family: 'male',   model: bml('bm_npc_kenkyu2.bml', 0x009c425c) },
  // TObjNpcNgcBase 0xf2..0xff: InitializeEnemyObject_0060ef70 with the BML
  // set g_DerolleTypeBMLDataPointers[type - 0xf2] (0x00a8e938 + 4 * i), which
  // InitializeDerolleBMLData_0060fca4 fills per map type (NGC_MODELS).
  ...Array.from({ length: 14 }, (_, i) => ({
    type: 0xf2 + i,
    name: `TObjNpcNgcBase(0x${(0xf2 + i).toString(16).toUpperCase().padStart(4, '0')})`,
    factory: [0x0060ee80, 0x0060f074, 0x0060f164, 0x0060f254, 0x0060f344, 0x0060f434, 0x0060f524, 0x0060f614, 0x0060f704, 0x0060f7f4, 0x0060f8e4, 0x0060f9d4, 0x0060fac4, 0x0060fbb4][i],
    init: 0x0060ef70,
    family: 'male' as const,
    model: 'ngc' as const,
  })),
  // Momoka (the Principal's receptionist, government quests).
  { type: 0x100, name: '__MOMOKA__',         factory: 0x0060e128, init: 0x0060e1f4, family: 'female', model: bml('bm_npc_momoka.bml', 0x009c44a0) },
];

const BY_TYPE = new Map(NPC_CLASSES.map((c) => [c.type, c]));

export function npcClass(type: number): NpcClass | null {
  return BY_TYPE.get(type) ?? null;
}

// The tekker's archive per section id (0x009c408c, 10 descriptor pointers).
// prettier-ignore
export const TEKKER_MODELS: readonly NpcModelSource[] = [
  bml('bm_n_kanteifs_i_body.bml', 0x009c4004), bml('bm_n_kanteif_i_body.bml', 0x009c3fd4),
  bml('bm_n_kanteifs2_i_body.bml', 0x009c401c), bml('bm_n_kanteib_i_body.bml', 0x009c3fa4),
  bml('bm_n_kanteif2_i_body.bml', 0x009c3fec), bml('bm_n_kanteit_i_body.bml', 0x009c4064),
  bml('bm_n_kanteio_i_body.bml', 0x009c4034), bml('bm_n_kanteit2_i_body.bml', 0x009c407c),
  bml('bm_n_kanteio2_i_body.bml', 0x009c404c), bml('bm_n_kanteib2_i_body.bml', 0x009c3fbc),
];

// TObjNpcNgcBase archives (descriptor of each g_DerolleTypeBMLDataPointers
// index), and which indices InitializeDerolleBMLData_0060fca4 loads for each
// map type (get_unknown_map_type_indicator 0x00807e68 = 0x0097f040[area]):
// 0xd (Pioneer 2, the Lab) all of them (list 0x009c44e0), 6 the list at
// 0x009c46ac, 7 0x009c46c4, 8..10 0x009c46d4; other maps load none.
// prettier-ignore
export const NGC_MODELS: readonly NpcModelSource[] = [
  bml('bm_n_michel_t_body.bml', 0x009c45c0), bml('bm_n_karen_t_body.bml', 0x009c4590),
  bml('bm_n_leo_w_body.bml', 0x009c45a8), bml('bm_n_paganini_t_body.bml', 0x009c45f0),
  bml('bm_n_delta_w_body.bml', 0x009c4560), bml('bm_n_nol_t_body.bml', 0x009c45d8),
  bml('bm_n_elly_t_body.bml', 0x009c4578), bml('bm_ncchild_body.bml', 0x009c4638),
  bml('bm_ncwoman_body.bml', 0x009c4698), bml('bm_ncman_body.bml', 0x009c4650),
  bml('bm_gunsinei_body.bml', 0x009c4608), bml('bm_nctrunk_body.bml', 0x009c4668),
  bml('bm_nctrunk2_body.bml', 0x009c4680), bml('bm_kenkyuw2_body.bml', 0x009c4620),
];
export const NGC_LISTS: Record<number, readonly number[]> = {
  0xd: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  6: [4, 0xb],
  7: [2],
  8: [1, 2, 10],
  9: [1, 2, 10],
  10: [1, 2, 10],
};

// 0x0097f040: map type per area (newserv area numbers 0..46).
// prettier-ignore
export const MAP_TYPE_BY_AREA: readonly number[] = [
  0xd, 0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 0xb, 0xb, 0xb, 0xb, 0xe, 0xc, 0xc, 0xd, 4, 4, 5, 5, 6,
  6, 6, 6, 6, 7, 7, 0xb, 0xb, 0xb, 0xb, 6, 6, 8, 8, 8, 8, 9, 0xa, 0xa, 0xa, 0xb, 0xd, -1,
];

export interface NpcModelContext {
  area: number;
  sectionId?: number; // the local character's section id (the tekker)
}

// Which archive the NPC's constructor draws with, or null when the client
// would not draw it (an NgcBase index its map type does not load).
export function npcModelFor(type: number, ctx: NpcModelContext): { cls: NpcClass; source: NpcModelSource } | null {
  const cls = npcClass(type);
  if (!cls) return null;
  if (cls.model === 'tekker') {
    const s = ctx.sectionId ?? 0;
    return { cls, source: TEKKER_MODELS[s >= 0 && s < 10 ? s : 0] };
  }
  if (cls.model === 'ngc') {
    const i = type - 0xf2;
    const list = NGC_LISTS[MAP_TYPE_BY_AREA[ctx.area] ?? -1];
    if (!list?.includes(i)) return null;
    return { cls, source: NGC_MODELS[i] };
  }
  return { cls, source: cls.model };
}

// --- the Episode 4 quest NPC (set type 0x118) ----------------------------------
//
// Factory 0x00602a14 -> CreateEnemyObject_00602ae0 (dump .c:463396, a 0x508-byte
// object; the dump's name for the state dispatcher, ChallengeEntityStateDispatcher_
// 00602c1c (.c:463444), is misleading). The set entry's u16 at +0x3c (param6) holds
// the flags in bit 0 (the walk-around flag of the other NPCs) and the NPC index in
// bits 8..13; the object keeps the index at +0x3c0. The dispatcher sets
// emote_id = index * 0x70 + g_ChallengeEntityEmoteIdBase (.c:463494; 0x70 = the
// npcplayerchar.dat record size, formats/npcplayerchar.ts) and loads the object's BML
// as g_ChallengeEntityBMLAssetPointers[GetChallengeValue_004e6f24(emote_id)] (.c:463504).
// That table (0x009b1620, 23 pointers to bml_asset_file_info) starts with the player
// body sets planj.bml .. pllnj.bml (exedata.py read 009b1620 p / the struct's name),
// and GetChallengeValue returns the record's class byte +0x31 (.c:263785) for a record
// without the challenge flags (ASSUMED: this NPC's flags are clear; the other branch
// reads the quest state). So the model is the player class's own body set
// (`pl<letter>nj.bml`, the same file the player models load), dressed with the
// record's appearance (ASSUMED: the dispatcher's texture setup is not traced; the NPC
// players of 6x69 use the same appearance). The motion row (idle / walk) of the
// dispatcher is not traced: the town idle / walk of the class stands in (ASSUMED).
export const QUEST_NPC_TYPE = 0x118;

// The npcplayerchar.dat record of a 0x118 entry (6 bits of param6's u16 from bit 8).
export function questNpcTemplate(param6: number): number {
  return ((param6 & 0xffff) >> 8) & 0x3f;
}

// --- set entry parameters -----------------------------------------------------

export interface NpcParams {
  // Quest register that must be non-zero for the NPC to be shown (0 = none),
  // and register that hides it while non-zero.
  displayOnReg: number;
  displayOffReg: number;
  // Those registers belong to the area script (>= 1000 in the set entry).
  displayAreaScript: boolean;
  action: number; // param4
  label: number; // param5; <= 0: no talk
  // Which script the talk label runs in (none when it cannot talk).
  script: 'quest' | 'area' | null;
  drawDistance: number;
}

// float -> int with round-to-nearest (the exe's fistp under the default
// rounding control).
const fround = (v: number) => Math.round(v);

export function npcParams(params: readonly number[]): NpcParams {
  // 0x00606a34 (the set_params override): p >= 1000 -> (p - 1000), area script.
  const reg = (p: number) => (p >= 1000 ? { r: fround(p - 1000), area: true } : { r: fround(p), area: false });
  const on = reg(params[1] ?? 0);
  const off = reg(params[2] ?? 0);
  const action = fround(params[3] ?? 0);
  const label = fround(params[4] ?? 0);
  return {
    displayOnReg: on.r,
    displayOffReg: off.r,
    displayAreaScript: on.area || off.area,
    action,
    label,
    // EnemyObjectUpdate_0060648c state 1: 100 < action < 1000 starts the thread
    // in the quest, action > 999 in the area script.
    script: label <= 0 ? null : action > 99 && action < 1000 ? 'quest' : action > 999 ? 'area' : null,
    drawDistance: action > 0 ? 400 : 250,
  };
}

// UpdateMovementRestriction_00606f10: whether the NPC is drawn (+0x398).
export function npcShown(p: NpcParams, reg: (r: number) => number): boolean {
  if (p.displayOnReg < 1 && p.displayOffReg < 1) return true;
  let shown = true;
  if (p.displayOnReg > 0) shown = reg(p.displayOnReg) !== 0;
  if (p.displayOffReg > 0 && reg(p.displayOffReg) !== 0) shown = false;
  return shown;
}

// --- talking ---------------------------------------------------------------

// EnemyObjectUpdate_0060648c state 0: the NPC turns to the player by at most
// *(0x009c3eb0 + 8) = 0x400 BAMS per tick (ClampAngleDifference_007a8c74);
// once within that step it faces the player and the talk thread starts.
export const NPC_TURN_STEP = 0x400;
// The player has to stand within 20 units of the NPC and face it within 60
// degrees: the rule of the Pioneer 2 counters (IsEntityInFrontAndInRange
// _006d739c: distance 20.0, dot(forward, to NPC) against -0.5 at 0x0096c2a0),
// used here for every NPC. The client picks the NPC through the player's
// action target instead (the "talk" palette slot), which is not modelled.
export const NPC_TALK_RANGE = 20;
export const NPC_TALK_COS = 0.5;

// EnemyObjectUpdate_0060648c state 0: for these talk actions the NPC does not
// turn; the player is turned to face it at once (6x3E with the angle from the
// player to the NPC) and the talk starts.
// prettier-ignore
export const NPC_TALK_NO_TURN: ReadonlySet<number> = new Set([
  0x3e9, 0x3ea, 0x3ee, 0x3ef, 0x3f0, 0x3f1, 0x3f2, 0x3f3, 0x3f9, 0x419, 0x41a, 0x41b, 0x41f,
  0x427, 0x428, 0x429, 0x42a, 0x42b, 0x42c, 0x42d, 1099,
]);
// State 1: the talk camera. These actions create a camera mover
// (camera_mover_constructor(type) -> NpcCamera_Construct_004d6074, update
// 0x004d5f88); the other actions of NPC_TALK_NO_TURN keep the camera as it
// is; every other action turns the player camera aside
// (UpdateDefaultNPCCameraOrientation_004d83f4).
export const NPC_TALK_CAMERA_MOVERS: ReadonlyMap<number, number> = new Map([
  [0x3e9, 7], // 1001: the Principal (TObjNpcGovernorBase, Pioneer 2)
  [0x3ea, 9], // 1002: his secretary (TObjNpcSecretaryBase)
  [0x41a, 0x12], // 1050: TObjNpcSoutokufu (the Lab)
  [0x41b, 0x13], // 1051: TObjNpcHosa (the Lab)
  [0x41f, 0x14], // 1055: the Lab's NgcBase NPC of action 1055
]);
// The camera mover's goal per type: 0x18-byte rows {vec3 source, vec3 target}
// at 0x00909260 (world coordinates). Its update eases its source and target
// toward them with unknown_vec3_lerp (lerpPoint) and a factor of 0.725
// (0x3f39999a) every frame and hands them to SetDefaultNPCCameraView_004d33c0.
// prettier-ignore
export const NPC_CAMERA_MOVER_VIEWS: ReadonlyMap<number, { source: [number, number, number]; target: [number, number, number] }> = new Map([
  [7, { source: [-4.8, 11.7, -2015.1], target: [0.4, 20, -2032.5] }],
  [9, { source: [33.9, 12.7, -1996.6], target: [71.4, 22.4, -2006.6] }],
  [0x12, { source: [-10000, 48, -198.4], target: [-10000, 46.5, -236.3] }],
  [0x13, { source: [-10039.4, 43.3, -176.9], target: [-10063.5, 53.8, -212.1] }],
  [0x14, { source: [-9953.2, 42.4, -168.1], target: [-9924, 50, -183.9] }],
]);
export const NPC_CAMERA_MOVER_LERP = Math.fround(0.725); // 0x3f39999a
// UpdateDefaultNPCCameraOrientation_004d83f4: the camera angle goes to the
// player's heading + or - 0x6000 (the one nearer the current angle first,
// the other when a 0x100 ray to it hits a wall; unchanged when both do).
export const NPC_TALK_CAMERA_SIDE = 0x6000;

// --- the area script ---------------------------------------------------------

// Pioneer 2 / Lab NPC dialogue lives in a per-map script (same .bin format as
// a quest, uncompressed): FUN_006bbd... (.c:615860) loads
// 0x009ce700[locale * 17 + 0x0096a180[map * 2 + online]] as
// g_CurrentQuestDataPointer. Index into the 17 names below (English set
// 0x009ce744..), -1 = none.
// prettier-ignore
const AREA_SCRIPT_INDEX: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 2], [2, 2], [3, 3], [3, 3], [3, 3], [4, 4], [4, 4], [5, 5], [5, 5], [5, 5], [-1, -1], [-1, -1], [4, 4],
  [-1, -1], [-1, -1], [-1, -1], [-1, -1], [6, 7], [8, 8], [8, 8], [9, 9], [9, 9], [10, 10],
];
const AREA_SCRIPT_NAMES = [
  'map_city_off', 'map_city_on', 'map_forest', 'map_cave', 'map_machine', 'map_ancient', 'map_labo_off', 'map_labo_on',
  'map_ruin', 'map_space', 'map_jungle', 'map_seabed', 'map_wilds', 'map_crater', 'map_desert', 'map_city02_off', 'map_city02_on',
];

// File name of the area script ('e' = English, the locale letter of the
// client's language), or null.
export function cityScriptFile(area: number, online = true, locale = 'e'): string | null {
  let i: number;
  if (area === 0x2d) i = online ? 16 : 15; // Episode 4 Pioneer 2 (map_city02_*)
  else i = AREA_SCRIPT_INDEX[area]?.[online ? 1 : 0] ?? -1;
  return i >= 0 ? `${AREA_SCRIPT_NAMES[i]}_${locale}.bin` : null;
}

// --- Pioneer 2 counters (bb_p2_menu) ------------------------------------------

// p2_special_npc_menus (0x009cf100, 9 entries of 0x14 bytes: name, on enter,
// ?, is open, on open). bb_p2_menu(n) (opcode_BB_p2_menu ->
// SetBankMenuOpenFlag_006d7370) raises flag n; the counter object of that menu
// opens it on its next update (handle_p2_special_npc_menus) when the player
// stands in front of it.
export const P2_MENUS = [
  'WEAPON STORE', // 0
  'MEDICAL CENTER', // 1
  'GEAR STORE', // 2
  'ITEM STORE', // 3
  'HUNTER GUILD', // 4: CreateMedicalCenterDialog_006cafb8 (also p_talk_guild)
  'CHECK ROOM', // 5
  'JUDGMENT', // 6 (the tekker)
  'THE GOVERNMENT GENERAL', // 7: CreateMedicalCenterDialogVariant_006cb13c
  'GIVEAWAY', // 8
] as const;
export const P2_MENU_GUILD = 4;
export const P2_MENU_GOVERNMENT = 7;
export const P2_MENU_PRESENT = 8; // GIVEAWAY: the Present Counter (quest/giveaway.ts)
