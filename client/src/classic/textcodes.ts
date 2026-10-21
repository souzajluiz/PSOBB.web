// The in-string escapes of the game's text (PsoBB.exe, Ephinea 1.25.13):
//   \tJ / \tE   language markers (2 characters, no glyph, no width);
//   \tC<c>      a colour (3 characters): '0'..'9' pick the fixed palette below
//              (g_TextColorTable, indexed by character code), 'G' the UI colour
//              table's entry +0x24 (0xffffea00 when the table is not loaded,
//              string_parse_locale_and_color_prefix and unknown_render_text3
//              use the same rule); any other <c> keeps the colour;
//   \t<x>       anything else is skipped as 2 characters.
// string_parse_locale_and_color_prefix (the text objects of windows and
// balloons) and unknown_render_text3 (0x007ab554, banner text) read the prefix
// in a loop, so several escapes can stand together; the colour then stays for
// the rest of the string, newlines included.
// Widths (CalculateTextExtent 0x007ac43c, get_width_of_window_for_text) skip
// the same escapes.

// g_TextColorTable is rgba8888[58] indexed by the character code (DAT_0097da10
// in unknown_render_text3, 0x007ab554): '0' = 0x30 sits at 0x0097dad0. Ten
// 0xAARRGGBB words read from the exe there (VERIFIED: the words are the
// colours as D3DCOLOR, the same form as the 0xffffea00 constant below), as CSS.
export const TEXT_COLORS: readonly string[] = [
  '#000000', // \tC0  0xff000000
  '#0000ff', // \tC1  0xff0000ff
  '#00ff00', // \tC2  0xff00ff00
  '#00ffff', // \tC3  0xff00ffff
  '#ff0000', // \tC4  0xffff0000
  '#ff00ff', // \tC5  0xffff00ff
  '#ffff00', // \tC6  0xffffff00
  '#ffffff', // \tC7  0xffffffff
  '#ff8080', // \tC8  0xffff8080
  '#8080ff', // \tC9  0xff8080ff
];
// \tCG with no UI colour table (unknown_render_text3: color = 0xffffea00).
export const TEXT_COLOR_G = '#ffea00';

export interface Glyph {
  ch: string;
  color: string;
}

// The colour a \tC<c> escape selects, or null when <c> leaves it unchanged.
export function textColorOf(c: string | undefined): string | null {
  if (c === 'G') return TEXT_COLOR_G;
  if (c !== undefined && c >= '0' && c <= '9') return TEXT_COLORS[c.charCodeAt(0) - 0x30]!;
  return null;
}

// The characters of `text` that draw, each with its colour (`base` until an
// escape changes it). An escape cut off by the end of the string ends it.
export function textGlyphs(text: string, base = '#ffffff'): Glyph[] {
  const out: Glyph[] = [];
  let color = base;
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (ch === '\t') {
      if (i + 1 >= text.length) break;
      if (text[i + 1] === 'C') {
        color = textColorOf(text[i + 2]) ?? color;
        i += 3;
      } else {
        i += 2;
      }
      continue;
    }
    out.push({ ch, color });
    i++;
  }
  return out;
}

// `text` without any escape.
export function stripTextCodes(text: string): string {
  return textGlyphs(text)
    .map((g) => g.ch)
    .join('');
}

// The last colour escape of `text` that selects a colour: it has to open a
// continuation line so the colour carries over a wrap.
export function activeColorEscape(text: string): string {
  let active = '';
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '\t' || i + 1 >= text.length) {
      i++;
      continue;
    }
    if (text[i + 1] === 'C') {
      if (textColorOf(text[i + 2]) !== null) active = text.slice(i, i + 3);
      i += 3;
    } else {
      i += 2;
    }
  }
  return active;
}
