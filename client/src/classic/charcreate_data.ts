// Character creation (TCharaMaking) data decompiled from PsoBB.exe (Ephinea
// build). Addresses are virtual addresses in the exe (image base 0x400000).
// See docs/DEVLOG.md, "character creation", for how each table is used.
//
// Textures: ccconsole_e.xvm. The exe asks for "ccconsole_e.pvm" through the
// table at 0x009b75c0 (English, German, French and Spanish share it) and
// loads it into the texture list 0x009b8c20 (FUN_004ea4a4).
//   0-5   class illustrations (top 256 rows), 6 their bottom 40 rows
//   7     class face strips, "information" labels, key icons, 8x8 frame pieces
//   8     window frame pieces, small class names, HUNTER/RANGER/FORCE tabs
//   9     colored bars, gray header pill pieces
//   10    20 px headings ("CHARACTER CREATION", "AUTO", ...)
//   11    16 px labels ("FACE", "OK", "CANCEL", ...)
//   12    class names ("Hunter", "Humar", ...)
//   13-18 hexback0_256, hexback1_256, hexback2..5_128 (background)
//   19    hex buttons, digits, section ID icons, color chips

export const TEXTURE_FILES = ['ccconsole_e.xvm', 'ccconsole_j.xvm'];

// Sprite: [w, h, anchorX, anchorY, u0, v0, u1, v1, texture]. UVs are in
// 1/256 of the texture whatever its size (FUN_0082b6bc divides by 256.0).
// FUN_004e9e84 picks the table: indices below 0x93 come from the common table
// at 0x009b76e0, the others from the language table (0x009b8260 for Japanese
// and Chinese, 0x009b8680 for the rest). They are concatenated here, so
// SPRITES[i] is the sprite the code calls i.
export type SpriteDef = readonly [number, number, number, number, number, number, number, number, number];

export const SPRITES: readonly SpriteDef[] = [
  // 0x009b76e0: 0x93 common sprites
  [46,40,0,0,0,0,46,40,19], [46,40,0,0,48,0,94,40,19], [46,40,0,0,96,0,142,40,19], [46,40,23,20,0,0,46,40,19], [46,40,23,20,48,0,94,40,19], [46,40,23,20,96,0,142,40,19],
  [46,40,0,0,114,0,160,40,19], [34,28,0,0,192,0,226,28,19], [48,40,0,0,0,42,48,82,19], [13,40,0,0,48,42,61,82,19], [48,40,0,0,64,42,112,82,19], [13,40,0,0,112,42,125,82,19],
  [256,256,0,0,0,0,255,255,13], [256,256,0,0,0,0,255,255,14], [128,128,0,0,0,0,255,255,15], [128,128,0,0,0,0,255,255,16], [128,128,0,0,0,0,255,255,17], [128,128,0,0,0,0,255,255,18],
  [16,16,0,0,128,73,144,89,19], [16,16,0,0,144,73,160,89,19], [16,16,0,0,160,73,176,89,19], [16,16,0,0,128,41,144,57,19], [16,16,0,0,144,41,160,57,19], [16,16,0,0,160,41,176,57,19],
  [16,16,0,0,176,41,192,57,19], [16,16,0,0,192,41,208,57,19], [16,16,0,0,208,41,224,57,19], [16,16,0,0,224,41,240,57,19], [16,16,0,0,240,41,256,57,19], [16,16,0,0,128,57,144,73,19],
  [16,16,0,0,144,57,160,73,19], [23,15,0,0,160,57,183,72,19], [32,32,0,0,185,57,217,89,19], [32,32,0,0,72,88,104,120,19], [32,32,0,0,72,120,104,152,19], [21,21,0,0,0,88,21,109,19],
  [21,21,0,0,24,88,45,109,19], [21,21,0,0,0,112,21,133,19], [21,21,0,0,24,112,45,133,19], [21,21,0,0,0,136,21,157,19], [21,21,0,0,24,136,45,157,19], [21,21,0,0,48,136,69,157,19],
  [21,21,0,0,48,112,69,133,19], [21,21,0,0,48,88,69,109,19], [46,40,0,0,0,162,46,202,19], [46,40,0,0,48,162,94,202,19], [46,40,0,0,96,162,142,202,19], [46,40,0,0,144,162,190,202,19],
  [46,40,0,0,192,162,238,202,19], [46,40,0,0,0,202,46,242,19], [46,40,0,0,48,202,94,242,19], [46,40,0,0,96,202,142,242,19], [46,40,0,0,144,202,190,242,19], [46,40,0,0,192,202,238,242,19],
  [32,32,0,0,89,90,121,122,9], [44,32,0,0,120,90,164,122,9], [84,56,42,28,0,90,84,146,9], [32,32,0,16,122,210,154,242,7], [32,32,0,16,162,210,194,242,7], [32,32,0,16,202,210,234,242,7],
  [21,21,0,10,194,210,215,231,7], [25,111,0,0,0,98,25,209,8], [25,111,0,0,27,98,52,209,8], [25,111,0,0,54,98,79,209,8], [24,24,0,0,123,175,147,199,7], [24,24,0,0,157,175,181,199,7],
  [24,24,0,0,191,175,215,199,7], [8,8,0,0,156,149,164,157,7], [8,8,0,0,180,149,188,157,7], [8,8,0,0,164,141,172,149,7], [8,8,0,0,164,165,172,173,7], [8,8,0,0,156,141,164,149,7],
  [8,8,0,0,180,141,188,149,7], [8,8,0,0,156,165,164,173,7], [8,8,0,0,180,165,188,173,7], [8,8,0,0,190,141,198,149,7], [8,8,0,0,214,141,222,149,7], [8,8,0,0,190,165,198,173,7],
  [8,8,0,0,214,165,222,173,7], [54,12,0,0,98,0,152,12,8], [88,12,0,0,98,14,186,26,8], [59,12,0,0,98,28,157,40,8], [75,12,0,0,98,42,173,54,8], [54,12,0,0,98,56,152,68,8],
  [58,12,0,0,98,70,156,82,8], [59,12,0,0,98,84,157,96,8], [75,12,0,0,98,98,173,110,8], [53,12,0,0,98,112,151,124,8], [58,12,0,0,98,126,156,138,8], [68,12,0,0,98,140,166,152,8],
  [87,12,0,0,98,154,185,166,8], [120,24,0,0,0,0,120,24,7], [120,24,0,0,0,26,120,50,7], [120,24,0,0,0,52,120,76,7], [120,24,0,0,0,78,120,102,7], [120,24,0,0,0,104,120,128,7],
  [120,24,0,0,0,130,120,154,7], [120,24,0,0,0,156,120,180,7], [120,24,0,0,0,182,120,206,7], [120,24,0,0,0,208,120,232,7], [120,24,0,0,122,0,242,24,7], [120,24,0,0,122,26,242,50,7],
  [120,24,0,0,122,52,242,76,7], [172,28,86,14,0,0,172,28,9], [172,28,86,14,0,30,172,58,9], [172,28,86,14,0,60,172,88,9], [168,256,0,0,0,0,168,256,0], [168,40,0,0,0,0,168,40,6],
  [138,256,0,0,0,0,138,256,1], [138,40,0,0,0,40,138,80,6], [85,256,0,0,170,0,255,256,0], [85,40,0,0,170,0,255,40,6], [93,256,0,0,140,0,233,256,1], [93,40,0,0,140,40,233,80,6],
  [155,256,0,0,0,0,155,256,2], [155,40,0,0,0,80,155,120,6], [121,256,0,0,0,0,121,256,3], [121,40,0,0,0,120,121,160,6], [168,256,0,0,0,0,168,256,4], [168,40,0,0,0,160,168,200,6],
  [64,256,0,0,170,0,234,256,4], [64,40,0,0,170,160,234,200,6], [105,256,0,0,0,0,105,256,5], [105,40,0,0,0,200,105,240,6], [94,256,0,0,157,0,251,256,2], [94,40,0,0,157,80,251,120,6],
  [115,256,0,0,123,0,238,256,3], [115,40,0,0,123,120,238,160,6], [113,256,0,0,107,0,220,256,5], [113,40,0,0,107,200,220,240,6], [32,32,0,0,0,0,32,32,8], [32,32,0,0,32,0,64,32,8],
  [32,32,0,0,64,0,96,32,8], [32,8,0,0,0,32,32,40,8], [32,8,0,0,32,32,64,40,8], [32,8,0,0,64,32,96,40,8], [32,32,0,0,0,64,32,96,8], [32,32,0,0,32,64,64,96,8],
  [32,32,0,0,64,64,96,96,8], [112,19,0,0,122,78,234,97,7], [112,19,0,0,122,99,234,118,7], [112,19,0,0,122,120,234,139,7], [32,32,0,0,122,141,154,173,7], [128,28,64,14,88,125,216,153,9],
  [128,28,64,14,0,157,128,185,9], [128,28,64,14,0,188,128,216,9], [128,28,64,14,0,219,128,247,9],
  // 0x009b8680: English sprites (0x93+)
  [59,16,0,0,140,72,199,88,11], [58,16,0,0,0,36,58,52,11], [52,16,0,0,60,36,112,52,11], [102,16,0,0,114,36,216,52,11], [128,16,0,0,0,54,128,70,11], [58,16,0,0,130,54,188,70,11],
  [138,16,0,0,0,72,138,88,11], [201,16,0,0,0,90,201,106,11], [58,16,0,0,176,108,234,124,11], [34,16,0,0,177,126,211,142,11], [118,16,0,0,57,126,175,142,11], [50,16,0,0,0,126,50,142,11],
  [154,16,0,0,101,215,255,231,11], [63,20,31,10,143,88,206,108,10], [62,20,31,10,0,44,62,64,10], [56,20,28,10,64,44,120,64,10], [106,20,53,10,122,44,228,64,10], [131,20,65,10,0,66,131,86,10],
  [63,20,31,10,133,66,196,86,10], [141,20,70,10,0,88,141,108,10], [205,20,102,10,0,110,205,130,10], [62,20,31,10,179,132,241,152,10], [225,20,112,10,0,0,225,20,10], [252,20,126,10,0,22,252,42,10],
  [177,20,88,10,0,132,177,152,10], [95,20,47,10,0,176,95,196,10], [160,20,80,10,0,154,160,174,10], [32,16,0,8,0,144,32,160,11], [93,16,0,8,0,162,93,178,11], [63,16,0,8,0,180,63,196,11],
  [65,16,0,8,0,198,65,214,11], [96,16,0,8,0,216,96,232,11], [103,16,0,8,0,234,103,250,11], [74,18,37,9,0,0,74,18,12], [75,18,37,9,76,0,151,18,12], [60,18,30,9,153,0,213,18,12],
  [67,18,33,9,0,20,67,38,12], [110,18,55,9,69,20,179,38,12], [73,18,36,9,0,40,73,58,12], [93,18,46,9,75,40,168,58,12], [65,18,32,9,0,60,65,78,12], [70,18,35,9,67,60,137,78,12],
  [71,18,35,9,0,80,71,98,12], [91,18,45,9,73,80,164,98,12], [64,18,32,9,0,100,64,118,12], [70,18,35,9,66,100,136,118,12], [83,18,41,9,0,120,83,138,12], [107,18,53,9,85,120,192,138,12],
  [94,15,47,7,110,145,204,160,11], [94,15,47,7,110,162,204,177,11], [94,15,47,7,110,179,204,194,11], [94,15,47,7,110,196,204,211,11],
];

// Named sprite indices (English table offsets are 0x93 + n).
export const SPR = {
  hexOrange: 0, // step button, selected (sprite 1 when not)
  barBody: 8, // stretched part of the gray bar behind a step label (10 when selected)
  barCap: 9, // its end (11 when selected)
  hexBack: 12, // 12..17 background tiles
  digit: 0x16, // 0x16 + n: digits 1..10 (0x15 + n for "n")
  colorR: 0x12, // R, G, B labels (0x12..0x14)
  slash: 0x20,
  tile: 0x21, // option tile, 0x22 when selected
  chip: 35, // color chips 35..43
  sectionIcon: 44, // 44 + section id
  pillBody: 0x36,
  pillCap: 0x37,
  hexCluster: 0x38,
  keyEnter: 57,
  keyEsc: 58,
  keyTab: 59,
  typeTab: 61, // 61 + type: vertical HUNTER / RANGER / FORCE
  typeSquare: 0x40, // 0x40 + type: colored 24x24 square
  frame8: 67, // 8x8 frame pieces 67..78
  className: 0x4f, // 0x4f + list index
  classFace: 0x5b, // 0x5b + list index
  typeBar: 0x67, // 0x67 + type: 172x28 colored bar
  portrait: 0x6a, // 0x6a + 2 * list index (top), +1 bottom
  window: 0x82, // 0x82..0x8a: 9-slice window frame
  infoLabel: 0x8b, // 0x8b + type: "information"
  infoBack: 0x8e,
  stepLabel: 0x93, // 0x93 + step id: HEAD FACE HAIR COSTUME SKIN COLOR BODY PROPORTION CHARACTER NAME AUTO OK
  sectionIdLabel: 0x9d,
  typeLabel: 0x9e,
  nameLabel: 0x9a,
  heading: 0xa0, // 0xa0 + n: HEAD .. AUTO (n = step), 0xa9 CHARACTER SELECT, 0xaa CHARACTER CREATION
  helpOk: 0xae,
  helpCancel: 0xaf,
  helpBack: 0xb0,
  helpChange: 0xb2,
  helpConfirm: 0xb3,
  className2: 0xb4, // 0xb4 + n: Hunter Ranger Force, then the 12 class names in list order
} as const;

// List order of the class selection (0x0091d990): list index -> class id.
export const CLASS_ORDER = [0, 1, 2, 9, 3, 11, 4, 5, 10, 6, 7, 8];
// First and last list index of each type (0x0091d9c0): Hunter, Ranger, Force.
export const TYPE_RANGE: ReadonlyArray<readonly [number, number]> = [[0, 3], [4, 7], [8, 11]];

// Class illustration placement (0x0091e640, 0x18 bytes per list index):
// [scale, z, x, y] while the type is highlighted, [x, y] once the class is
// chosen (then scale 1 and z -2.75).
export const PORTRAITS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0.85, -3.0625, 337, 158, 405, 127],
  [0.8, -3.140625, 435, 160, 448, 128],
  [0.94, -3.21875, 343, 125, 489, 127],
  [0.88, -3.296875, 497, 140, 476, 128],
  [0.85, -3.0625, 467, 168, 447, 122],
  [0.8, -3.140625, 389, 182, 457, 129],
  [1, -3.296875, 317, 117, 430, 132],
  [0.75, -3.21875, 534, 178, 488, 128],
  [0.85, -3.140625, 447, 130, 472, 124],
  [0.83, -3.296875, 495, 136, 465, 124],
  [0.85, -3.21875, 327, 142, 461, 129],
  [0.85, -3.0625, 384, 136, 458, 117],
];

export interface Appearance {
  costume: number;
  skin: number;
  face: number;
  head: number;
  hair: number;
  hairColor: [number, number, number];
  proportion: [number, number];
}

// Default visual config per class (0x009b5f60, 0x70 bytes per class), copied
// into the character when the class is confirmed (FUN_004eb7ec). Section ID
// is then set to 0xFF ("compute from the name") and the name cleared.
export const DEFAULT_LOOKS: ReadonlyArray<Appearance & { classFlags: number }> = [
  { classFlags: 0x25, costume: 0, skin: 1, face: 0, head: 0, hair: 0, hairColor: [133, 73, 41], proportion: [0, 0] },
  { classFlags: 0x2a, costume: 5, skin: 3, face: 0, head: 0, hair: 0, hairColor: [255, 90, 178], proportion: [0, 0] },
  { classFlags: 0x31, costume: 0, skin: 4, face: 0, head: 0, hair: 0, hairColor: [0, 0, 0], proportion: [0, 0] },
  { classFlags: 0x45, costume: 1, skin: 1, face: 0, head: 0, hair: 0, hairColor: [255, 188, 66], proportion: [0, 0] },
  { classFlags: 0x51, costume: 0, skin: 3, face: 0, head: 0, hair: 0, hairColor: [0, 0, 0], proportion: [0, 0] },
  { classFlags: 0x52, costume: 0, skin: 0, face: 0, head: 0, hair: 0, hairColor: [0, 0, 0], proportion: [0, 0] },
  { classFlags: 0x86, costume: 2, skin: 0, face: 0, head: 0, hair: 0, hairColor: [0, 90, 255], proportion: [0, 0] },
  { classFlags: 0x89, costume: 0, skin: 1, face: 0, head: 0, hair: 0, hairColor: [44, 28, 89], proportion: [0, 0] },
  { classFlags: 0x8a, costume: 4, skin: 1, face: 0, head: 0, hair: 0, hairColor: [96, 154, 253], proportion: [0, 0] },
  { classFlags: 0x32, costume: 0, skin: 4, face: 0, head: 0, hair: 0, hairColor: [0, 0, 0], proportion: [0, 0] },
  { classFlags: 0x85, costume: 1, skin: 1, face: 0, head: 0, hair: 0, hairColor: [255, 0, 0], proportion: [0, 0] },
  { classFlags: 0x46, costume: 3, skin: 0, face: 0, head: 0, hair: 0, hairColor: [255, 255, 0], proportion: [0, 0] },
];

// Number of choices per class for costume, skin (body color on androids),
// face, head and hair (0x009b5b60, 0x2c bytes per class).
export const OPTION_COUNTS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [18, 4, 5, 0, 10], [18, 4, 5, 0, 10], [0, 25, 0, 5, 0], [18, 4, 5, 0, 10], [0, 25, 0, 5, 0], [0, 25, 0, 5, 0],
  [18, 4, 5, 0, 10], [18, 4, 5, 0, 10], [18, 4, 5, 0, 10], [0, 25, 0, 5, 0], [18, 4, 5, 0, 10], [18, 4, 5, 0, 10],
];
export const APPEARANCE_FIELDS = ['costume', 'skin', 'face', 'head', 'hair'] as const;

// Dressing room steps. Ids are the label sprites 0x93 + id.
export const STEP = { head: 0, face: 1, hair: 2, costume: 3, skin: 4, body: 5, proportion: 6, name: 7, auto: 8, ok: 9 } as const;
// Step lists (0x009b908c: {count, list}): 0 = human/newman, 1 = android
// (class_flags & 0x10). Modes 2-6 are the dressing room of an existing
// character and the name-only fix, not reachable from creation.
export const STEP_LISTS: ReadonlyArray<readonly number[]> = [
  [1, 2, 3, 4, 6, 7, 8, 9],
  [0, 5, 6, 7, 8, 9],
];
// What each step edits (0x009b8fc0, {field, handler} per step): appearance
// field index for the list editor (FUN_004f04a8), or the handler kind.
export const STEP_EDITOR: ReadonlyArray<{ kind: 'list' | 'hair' | 'proportion' | 'name' | 'auto' | 'ok'; field: number }> = [
  { kind: 'list', field: 3 }, // HEAD
  { kind: 'list', field: 2 }, // FACE
  { kind: 'hair', field: 4 }, // HAIR (FUN_004f070c)
  { kind: 'list', field: 0 }, // COSTUME
  { kind: 'list', field: 1 }, // SKIN COLOR
  { kind: 'list', field: 1 }, // BODY
  { kind: 'proportion', field: -1 }, // FUN_004f095c
  { kind: 'name', field: -1 }, // FUN_004f0a80
  { kind: 'auto', field: -1 }, // FUN_004f0828
  { kind: 'ok', field: -1 }, // FUN_004f0b80
];

// Heading shown in the gray pill (FUN_004ecd84(n), sprites at 0x0091db34).
// 0 CHARACTER SELECT, 1 CHARACTER CREATION, 2 DRESSING ROOM, 3 RENAME,
// 4 VOICE EFFECT, 5 + step id for the step being edited.
export const HEADINGS = [169, 170, 171, 172, 173, 160, 161, 162, 163, 164, 165, 166, 167, 168];
export const HEADING = { select: 0, creation: 1, dressingRoom: 2, step: (id: number) => 5 + id } as const;

// Key help items (0x009b9120: {count, sprites[4]}).
export const HELP_ITEMS: ReadonlyArray<readonly number[]> = [
  [SPR.keyTab, SPR.helpChange],
  [SPR.keyEnter, SPR.helpOk],
  [SPR.keyEnter, SPR.helpConfirm],
  [SPR.keyEsc, SPR.helpCancel],
  [SPR.keyEsc, SPR.helpBack],
];
export const HELP = { change: 0, ok: 1, confirm: 2, cancel: 3, back: 4 } as const;

// Bar lengths behind the option tiles by choice count - 1 (0x0091e0dc) and
// behind the R, G, B rows of the hair editor (0x0091dfe8).
export const LIST_BAR_END = [206, 219, 243, 271, 271, 284, 297, 323, 347, 347];
export const HAIR_ROW_END = 244;
// Bar end buckets for step labels (FUN_004efb84): label width + 0x90 rounded
// up to the next of these.
export const STEP_BAR_END = [0xa7, 0xb4, 0xc1, 0xce, 0xdb, 0xe7, 0xf3, 0x101, 0x10f, 0x11c, 0x129, 0x136, 0x143, 0x14f, 0x15b];
// Color chips under the tiles, by option bit (0x0091dd2c costume, 0x0091dd84
// human skin; androids use 0x0091dd58 = same as costume).
export const CHIPS_COSTUME = [35, 36, 37, 38, 39, 40, 43];
export const CHIPS_SKIN = [43, 42, 41, 40];
// Hair color bar fill colors (0x0091df68).
export const HAIR_BAR_COLORS = ['#ff0000', '#00ff00', '#0000ff'];

// unitxt groups used by the screens (FUN_00792fe8(group, index)).
export const TEXT_GROUP = {
  typeInfo: 0x12, // 7 lines per type
  classInfo: 0x13, // 7 lines per class id
  prompts: 12, // 59, 60: "Select CHARACTER NAME" / "and input a name."
  sectionNames: 72, // FUN_007930c8
} as const;
