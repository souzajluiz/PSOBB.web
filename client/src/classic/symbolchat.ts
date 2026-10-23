// Symbol chat art (classic): the picture a 6x07 symbol chat shows over the
// speaker, and the 12-row list that picks one (the Home menu's Chat > Symbol
// Chat leaf, and the in-game End key). Pure: no DOM or three.js import, so the
// node tests load it; the balloon is classic/chat.ts and the window is
// classic/symbolchatlist.ts.
//
// Exe (PsoBB.exe 1.25.13, refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//   - ChatBubbleEntity_RenderChatParts_00720b34 (686361): sets the balloon's life
//     to 0x5a (`*(short*)(this+0x88) = 0x5a`), draws the parts with
//     symbol_chat_parts_render (675593) and plays PlayDirectionalSound(spec >> 5 & 0xf).
//   - symbol_chat_parts_render: the 4 corner objects (u16 at SymbolChatT + 4 + 2i)
//     and the 12 face parts (4 bytes at SymbolChatT + 0xc + 4i: type, x, y, flags).
//   - Corner object: UpdateListWindowElementRenderState_007141a4 (675213). The
//     object is the low byte Z: Z == 0xFF is no object (the `!= 0xff` test), the
//     cell is (Z & 7, Z >> 3 & 7) of the 32-texel grid (_DAT_0096fc20 = 32.0) on
//     hyouji texture 9 + (Z >> 6 & 3). The caller passes the colour index, the two
//     swap flags and the corner index as the callee's stack arguments (the dump
//     drops the caller's pushes; ASSUMED: colour = bits 8-10, flips = bits 11, 12,
//     newserv's layout).
//   - Face part: UIElement_UpdatePositionAndRender_00714381 (675341) with the type
//     as the element id; type 0xFF (-1) is no part. Its texel origin is the
//     table at 0x0096f920 (8-byte stride, x = the first float, y = the second):
//     ids 0x00..0x2F are 16-texel cells on a 128 x 96 grid (x = (id & 7) * 16,
//     y = (id >> 3) * 16, checked on the table). Ids 0x30..0x3B are larger
//     elements the port does not draw (ASSUMED: not symbol parts).
//   - Colours: DAT_0096f900 (= DWORD_0096fb68, 8 ARGB values): cfcfcf, f3503c,
//     ffa32f, dffd04, 79fd79, 87acfa, d58bf6, 787878. ListWindowObject_SetElementVisualState_007146b9
//     (675557, into 007146d5) sets the colour of the list window's own element
//     (the plate, not a face part) from the spec: DWORD_0096fb68[(spec >> 2) & 7].
//     The plate is not drawn here (ASSUMED), so the faces are not tinted.
//   - Sounds: DAT_00979670 (9 dwords: 1398..1405 and 1416); PlayDirectionalSound_0077d89c
//     (754395) returns for an index above 8.
//   - Validity: ChatMessage_IsValid_0077d948 (754489): bit 0 or bit 1 of the entry.
//   - Home leaf 0x12: ChatShortcutMenuWindow_Process_00758900 (728631), rows
//     GetChatMessageStringId_0077d910 (754469): an invalid entry is unitxt(11, 0xEA),
//     a valid one with an empty name unitxt(11, 0xEB), else the name. Title
//     unitxt(11, 0x44). Width 220 (0x435c0000), height 188 (ASSUMED: the second
//     float is the height).
//
// Not traced (ASSUMED in the code below): the plate's shape presets (the
// SetPositionAndSize tables at 0x0096fb88 / 0x0096fb8c, ignored here), the
// corner and face offsets inside the plate (a 64 px square centred on the
// balloon), the face sheet (hyouji texture 12, from the texel grid), the
// window's position and the in-game End picker's exact rows.

import type { SymbolChat, SymbolChatEntry } from '../net/symbolchat.ts';
import { SYMBOL_CHAT_COUNT, SYMBOL_CHAT_NO_FACE } from '../net/symbolchat.ts';

// ChatBubbleEntity_RenderChatParts_00720b34: the life of a symbol balloon (frames, 30 per second).
export const SYMBOL_CHAT_FRAMES = 0x5a;
// The parts' square (ASSUMED): the four corner cells tile it.
export const SYMBOL_PLATE = 64;
// _DAT_0096fc20 (32.0): the corner cell size, and the texel grid of the sheets.
export const CORNER_SIZE = 32;
// 16-texel face cells (table 0x0096f920, ids 0x00..0x2F).
export const FACE_SIZE = 16;
export const FACE_ID_LIMIT = 0x30;
// Index into the four corner sheets (hyouji 9..12) of the face cells (ASSUMED: texture 12).
export const FACE_SHEET = 3;
// DAT_0096f900 / DWORD_0096fb68 (ARGB, exe data).
export const SYMBOL_COLOURS: readonly number[] = [
  0xffcfcfcf, 0xfff3503c, 0xffffa32f, 0xffdffd04, 0xff79fd79, 0xff87acfa, 0xffd58bf6, 0xff787878,
];
// DAT_00979670: the directional sound of spec bits 5..8 (index 0..8; above 8 nothing plays).
export const SYMBOL_SOUNDS: readonly number[] = [1398, 1399, 1400, 1401, 1402, 1403, 1404, 1405, 1416];
// The Home list window (ListWindowObject_Initialize_007361d0, width 220, height 188 ASSUMED).
export const SYMBOL_LIST = { w: 220, h: 188, visible: 8 };
// unitxt group 11 (exe: 0x44 title, 0xEA invalid entry, 0xEB unnamed entry).
export const SYMBOL_TEXT = { title: 0x44, invalid: 0xea, unnamed: 0xeb } as const;

export interface CornerCell {
  sheet: number; // 0..3: hyouji texture 9 + sheet
  sx: number;
  sy: number;
  colour: number; // ARGB, multiplied over the cell
  flipH: boolean;
  flipV: boolean;
}

// A corner word (newserv ---VHCCCZZZZZZZZ): Z is the low byte; 0xFF is no object.
export function cornerCell(word: number): CornerCell | null {
  const z = word & 0xff;
  if (z === 0xff) return null;
  return {
    sheet: (z >> 6) & 3,
    sx: (z & 7) * CORNER_SIZE,
    sy: ((z >> 3) & 7) * CORNER_SIZE,
    colour: SYMBOL_COLOURS[(word >> 8) & 7], // ASSUMED: the colour index is bits 8-10
    flipH: ((word >> 11) & 1) !== 0, // ASSUMED: bit 11
    flipV: ((word >> 12) & 1) !== 0, // ASSUMED: bit 12
  };
}

export interface FaceCell {
  sx: number;
  sy: number;
  flipH: boolean;
}

// A face part: type 0xFF (or an id past the 16-texel grid) is no part. The exe
// passes the flags' bit 0 as the swap (the reverse horizontal); bit 1 is not used
// there (ASSUMED: the port does not draw it either).
export function faceCell(type: number, flags = 0): FaceCell | null {
  if (type === SYMBOL_CHAT_NO_FACE || type >= FACE_ID_LIMIT) return null;
  return { sx: (type & 7) * FACE_SIZE, sy: (type >> 3) * FACE_SIZE, flipH: (flags & 1) !== 0 };
}

// The colour of the spec's plate element (DWORD_0096fb68[(spec >> 2) & 7]); the port keeps it for the plate (ASSUMED: not drawn).
export function faceColour(spec: number): number {
  return SYMBOL_COLOURS[(spec >>> 2) & 7];
}

// The directional sound of a chat (PlayDirectionalSound_0077d89c), or null when it plays nothing.
export function symbolSoundId(spec: number): number | null {
  const i = (spec >>> 5) & 0xf;
  return i > 8 ? null : SYMBOL_SOUNDS[i];
}

// ChatMessage_IsValid_0077d948: bit 0 (present) or bit 1 (chosen) of the entry.
export function isSymbolChatValid(entry: SymbolChatEntry): boolean {
  return (entry.present & 3) !== 0;
}

// The chat send cooldown (dump 679808 is_chat_message_cooldown_over, 679819
// set_chat_message_cooldown_timer): the timer is a short on the quick-menu object
// (g_pUITextColorTable + 0x22), set to 0x2d on each send, and a send waits while
// it is 1 or more. The exe ticks it down in QuickmenuobjectHandleSelection (677732)
// only while the quick menu's chat panel (+0x38) is up (ASSUMED: the port ticks it
// in the field, every 30 Hz frame).
export const CHAT_COOLDOWN_FRAMES = 0x2d;
export function chatCooldownOver(timer: number): boolean {
  return timer < 1;
}
export function chatCooldownTick(timer: number): number {
  return timer > 0 ? timer - 1 : timer;
}

export interface SymbolRow {
  index: number;
  label: string;
  valid: boolean;
  chat: SymbolChat | null;
  // The directional sound a Home preview plays (ProcessChatMessageType_0077d880:
  // only when the present bit 0 is set); null otherwise.
  sound: number | null;
}

// The 12 rows of a symbol chat list (GetChatMessageStringId_0077d910 for each slot).
export function symbolChatRows(entries: readonly SymbolChatEntry[], text: (group: number, index: number) => string): SymbolRow[] {
  const rows: SymbolRow[] = [];
  for (let i = 0; i < SYMBOL_CHAT_COUNT; i++) {
    const e = entries[i];
    if (!e || !isSymbolChatValid(e)) {
      rows.push({ index: i, label: text(11, SYMBOL_TEXT.invalid), valid: false, chat: null, sound: null });
    } else {
      const sound = (e.present & 1) !== 0 ? symbolSoundId(e.chat.spec) : null;
      rows.push({ index: i, label: e.name || text(11, SYMBOL_TEXT.unnamed), valid: true, chat: e.chat, sound });
    }
  }
  return rows;
}

// The corners at the plate's corners: TL, TR, BL, BR (ASSUMED offsets).
function cornerOrigin(i: number, cx: number, cy: number): { x: number; y: number } {
  const x0 = cx - SYMBOL_PLATE / 2;
  const y0 = cy - SYMBOL_PLATE / 2;
  return { x: x0 + (i & 1) * CORNER_SIZE, y: y0 + (i >> 1) * CORNER_SIZE };
}

export type TintFn = (img: CanvasImageSource, colour: number) => CanvasImageSource;

function drawCell(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx: number,
  sy: number,
  size: number,
  dx: number,
  dy: number,
  flipH: boolean,
  flipV: boolean,
): void {
  ctx.save();
  ctx.translate(dx + (flipH ? size : 0), dy + (flipV ? size : 0));
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
  ctx.restore();
}

// Draws the parts of a chat centred on (cx, cy), in window space. `sheets` are
// hyouji textures 9..12 (the corner sheets; the face cells use FACE_SHEET of them).
// `tint` multiplies a corner sheet by its colour (the caller caches it); default: none.
export function drawSymbolParts(
  ctx: CanvasRenderingContext2D,
  chat: SymbolChat,
  sheets: readonly CanvasImageSource[],
  cx: number,
  cy: number,
  tint: TintFn = (img) => img,
): void {
  for (let i = 0; i < 4; i++) {
    const cell = cornerCell(chat.cornerObjects[i] ?? 0xff);
    const img = cell ? sheets[cell.sheet] : undefined;
    if (!cell || !img) continue;
    const o = cornerOrigin(i, cx, cy);
    drawCell(ctx, tint(img, cell.colour), cell.sx, cell.sy, CORNER_SIZE, o.x, o.y, cell.flipH, cell.flipV);
  }
  const face = sheets[FACE_SHEET];
  if (!face) return;
  const x0 = cx - SYMBOL_PLATE / 2;
  const y0 = cy - SYMBOL_PLATE / 2;
  for (const f of chat.faceParts) {
    const cell = faceCell(f.type, f.flags);
    if (!cell) continue;
    drawCell(ctx, face, cell.sx, cell.sy, FACE_SIZE, x0 + f.x, y0 + f.y, cell.flipH, false);
  }
}
