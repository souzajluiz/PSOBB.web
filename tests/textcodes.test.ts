// The in-string text escapes (classic/textcodes.ts: \tC<c> palette, \tE / \tJ)
// and the wrapping that keeps a colour across lines (classic/chat.ts).
// Run: node tests/textcodes.test.ts
import { activeColorEscape, expandColorTags, stripTextCodes, textColorOf, textGlyphs, TEXT_COLORS, TEXT_COLOR_G } from '../client/src/classic/textcodes.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// g_TextColorTable (0x0097dad0): ARGB words ff000000 ff0000ff ff00ff00 ff00ffff ffff0000 ffff00ff ffffff00 ffffffff ffff8080 ff8080ff
eq(TEXT_COLORS.length, 10, 'ten palette entries');
eq([textColorOf('0'), textColorOf('4'), textColorOf('7'), textColorOf('8'), textColorOf('9')], ['#000000', '#ff0000', '#ffffff', '#ff8080', '#8080ff'], 'palette numbers');
eq(textColorOf('G'), TEXT_COLOR_G, 'G is the UI table colour (default 0xffffea00)');
eq([textColorOf('x'), textColorOf(undefined)], [null, null], 'other characters keep the colour');

eq(textGlyphs('a\tC4b\tC7c', '#123456').map((g) => g.ch + g.color), ['a#123456', 'b#ff0000', 'c#ffffff'], 'colour per glyph');
eq(stripTextCodes('\tEHello \tC6world\tJ!'), 'Hello world!', '\\tE / \\tJ take 2 characters and no letter after them');
eq(stripTextCodes('\tCxab'), 'ab', 'an unknown colour letter is still skipped (3 characters)');
eq(stripTextCodes('\t\tC1ab'), 'C1ab', 'two tabs: the first escape takes the second tab (2 characters)');
eq(stripTextCodes('ab\t'), 'ab', 'a cut-off escape ends the string');
eq(textGlyphs('\tC2a\nb').map((g) => g.color), ['#00ff00', '#00ff00', '#00ff00'], 'the colour stays over a newline');
eq(activeColorEscape('x\tC4y\tC9z\tCq'), '\tC9', 'the escape to repeat on a wrapped line');
eq(activeColorEscape('plain'), '', 'no colour, nothing to repeat');

// The quest tag <color N> (quest_color_to_string: \tC%d) becomes the escape; the colour follows.
eq(expandColorTags('a<color 4>b<color 12>c<color 7 >'), 'a\tC4b\tC12c\tC7', '<color N> is \\tC<N>');
eq(stripTextCodes(expandColorTags('<color 1>Hi <color 4>there')), 'Hi there', '<color N> draws no text');
eq(textGlyphs(expandColorTags('x<color 6>y')).map((g) => g.color), ['#ffffff', '#ffff00'], '<color 6> is yellow after x');
eq(expandColorTags('<Color 2> <rX> <color x>'), '<Color 2> <rX> <color x>', 'the tag is lower-case as swscanf reads it');

if (failures) {
  console.log(`textcodes: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('textcodes: all checks passed');
