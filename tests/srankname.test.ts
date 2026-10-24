// The S-rank prize name window's model (client/src/quest/srankname.ts): the typed
// text, the 8-character cap, the letters-only rule, Backspace, Decide on an empty
// name (kept waiting, exe 0x006bc68c) and the name sent to the weapon (upper case).
// The GUI positions are the exe's table (0x00971f40 + 8 * entry): 0x58 and 0xd3.
// Run: node tests/srankname.test.ts
import {
  NAME_EDITOR_POS,
  NAME_LABEL_POS,
  NAME_WINDOW_SIZE,
  nameEntryAccepts,
  SRankNameEntry,
} from '../client/src/quest/srankname.ts';
import { buildSRankWeapon, S_RANK_NAME_MAX } from '../client/src/quest/cmode.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = <T>(got: T, want: T, msg: string) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const typeAll = (e: SRankNameEntry, s: string) => {
  for (const c of s) e.type(c);
  return e;
};

// The cap is the TKeyboardControl's 8 (quest/cmode.ts S_RANK_NAME_MAX, the 5-bit name of the weapon).
eq(S_RANK_NAME_MAX, 8, 'the name cap is 8');

// Allowed characters: ASCII letters only (the weapon's 5-bit table holds A..Z).
check(nameEntryAccepts('a') && nameEntryAccepts('Z'), 'letters are accepted');
for (const c of ['1', ' ', '-', '@', '[', '`', '{', 'é', '', 'ab']) check(!nameEntryAccepts(c), `"${c}" is refused`);

// Typing: letters go in, a non-letter is dropped, the cap holds.
{
  const e = typeAll(new SRankNameEntry(), 'ab-c1 de fghij');
  eq(e.text, 'abcdefgh', 'letters only, at most 8 typed');
  e.type('Z');
  eq(e.text, 'abcdefgh', 'a full name takes no more');
}

// Backspace removes the last character; on an empty text it stays empty.
{
  const e = typeAll(new SRankNameEntry(), 'Ra');
  e.backspace();
  eq(e.text, 'R', 'backspace drops one character');
  e.backspace();
  e.backspace();
  eq(e.text, '', 'backspace stops at empty');
}

// Decide: empty stays open (null), otherwise the name in upper case.
{
  const e = new SRankNameEntry();
  eq(e.decide(), null, 'Decide on an empty name is refused');
  typeAll(e, 'ragol');
  eq(e.decide(), 'RAGOL', 'Decide sends the name upper case');
  typeAll(e, 'xyzuvw');
  eq(e.decide(), 'RAGOLXYZ', 'a sent name is at most 8 letters');
}

// The name sent is the one the weapon packs: every letter of it survives the 5-bit table.
{
  const name = typeAll(new SRankNameEntry(), 'Saber').decide()!;
  const item = buildSRankWeapon(0x70, name);
  check(item !== null, 'a typed name builds an S-rank weapon');
  const w3 = ((item![6]! & 0x7f) << 8) | item![7]!;
  eq((w3 >> 5) & 0x1f, 0x13, 'the first letter S is packed as 19 (after the seed bit)');
}

// The GUI positions of the window (exe table 0x00971f40 + 8 * entry).
eq(NAME_LABEL_POS, { x: 99, y: 120 }, 'label list at GUI 0x58');
eq(NAME_EDITOR_POS, { x: 261, y: 173 }, 'editor at GUI 0xd3');
eq(NAME_WINDOW_SIZE.w, 443, 'label list width (ListWindowObject_Initialize 443.0)');

console.log(failures ? `FAILED (${failures} problems)` : 'OK');
process.exit(failures ? 1 : 0);
