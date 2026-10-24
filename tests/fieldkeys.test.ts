// The field's Tab (palette Left alias), PageUp / PageDown (the Home menu's Log Window)
// and the End key's quick-menu gate helpers. Run: node tests/fieldkeys.test.ts
import { paletteChannelDown, PALETTE_LEFT_SLOT, TAB_KEY } from '../client/src/input/keyconfig.ts';
import { ChatLog, logPageKey, LOG_FIT, LOG_PAGE_ROWS } from '../client/src/classic/chat.ts';
import { FieldMenu, LOG_WINDOW_MENU_ID, type FieldMenuEnv } from '../client/src/classic/fieldmenu.ts';

// The log wraps its lines by measured text (gametext.ts) on an OffscreenCanvas; a width per character is enough.
const measure = { measureText: (t: string) => ({ width: String(t).length * 5 }), getImageData: () => ({ data: new Uint8ClampedArray(64) }) };
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return measure;
  }
};

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// --- Tab: a second key of the Left palette channel (ProcessCameraInput_00708bd4, dump 666092) ---
check(TAB_KEY === 'tab', 'Tab is the DOM name tab');
check(PALETTE_LEFT_SLOT === 1, 'Left is palette_slots index 1 (slot 2)');
check(paletteChannelDown(new Set(['tab']), 'arrowleft', 1) === TAB_KEY, 'Tab alone presses Left');
check(paletteChannelDown(new Set(['arrowleft']), 'arrowleft', 1) === 'arrowleft', 'the bound Left key still presses Left');
check(paletteChannelDown(new Set(['tab', 'arrowleft']), 'arrowleft', 1) === 'arrowleft', 'both keys: one channel, the bound key names it');
check(paletteChannelDown(new Set(['tab']), 'arrowleft', 0) === '', 'Tab is not Middle');
check(paletteChannelDown(new Set(['tab']), 'arrowleft', 2) === '', 'Tab is not Right');
check(paletteChannelDown(new Set(['tab']), '', 1) === TAB_KEY, 'Tab answers with Keyboard Controls OFF (no bound key)');
check(paletteChannelDown(new Set(['arrowleft']), '', 1) === '', 'the bound key does not answer with Keyboard Controls OFF');
check(paletteChannelDown(new Set(), 'arrowleft', 1) === '', 'nothing held: no press');

// --- PageUp / PageDown: plain keys only (was_key_pressed_no_modifiers) ---
const ev = (key: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
  key,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
});
check(logPageKey(ev('PageUp')) === 'up', 'PageUp pages up');
check(logPageKey(ev('PageDown')) === 'down', 'PageDown pages down');
check(logPageKey(ev('PageUp', { shift: true })) === null, 'Shift+PageUp is no page key');
check(logPageKey(ev('PageDown', { ctrl: true })) === null, 'Ctrl+PageDown is no page key');
check(logPageKey(ev('PageDown', { alt: true })) === null, 'Alt+PageDown is no page key');
check(logPageKey(ev('Home')) === null, 'Home is no page key');

// --- Home > Chat > Log Window in the field (leaf 0x15) ---
const log = new ChatLog();
for (let i = 0; i < 60; i++) log.add('', `line ${i}`);
const env = {
  text: () => '',
  rules: () => ({ lobby: false, safe: false, online: true, questStarted: false, inTeam: false }),
  android: () => false,
  itemPack: {},
  equip: {},
  tech: {},
  mag: {},
  options: { text: () => '', flags: () => null, setFlags: () => {}, send: () => {}, padConnected: () => false },
  chatLog: () => log,
} as unknown as FieldMenuEnv;
const fm = new FieldMenu(env);
const open = (id: number) => (fm as unknown as { open(id: number): void }).open(id);
const press = (e: ReturnType<typeof ev>) => fm.key({ ...e, preventDefault: () => {} } as unknown as KeyboardEvent);

check(LOG_WINDOW_MENU_ID === 0x15, 'the Log Window is leaf 0x15');
open(LOG_WINDOW_MENU_ID);
check(fm.menu.leafOpen === true, 'the Log Window hides the menu panel while it is up');
press(ev('PageUp'));
// The log keeps its last CHAT_LOG_LINES lines, so the page is clamped to the rows that exist.
const maxBack = Math.max(0, log.wrapped().length - LOG_FIT);
check(maxBack > 0 && maxBack <= LOG_PAGE_ROWS, 'the test log is short enough to clamp a page');
check(log.back === maxBack, `PageUp moves the log back, clamped to the rows that exist (${maxBack})`);
press(ev('PageUp', { shift: true }));
check(log.back === maxBack, 'Shift+PageUp does nothing');
press(ev('PageDown'));
check(log.back === 0, 'PageDown moves back to the newest');
press(ev('PageDown'));
check(log.back === 0, 'PageDown at the bottom stays at 0');
press(ev('Escape'));
check(fm.menu.leafOpen === false, 'Cancel closes the Log Window and the panel shows again');
press(ev('PageUp'));
check(log.back === 0, 'with the window closed the page keys are not the log\'s');

// With no chat (no session) the entry does nothing.
const bare = new FieldMenu({ ...env, chatLog: () => null } as unknown as FieldMenuEnv);
(bare as unknown as { open(id: number): void }).open(LOG_WINDOW_MENU_ID);
check(bare.menu.leafOpen === false, 'no chat log: the Log Window does not open');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('fieldkeys: all checks passed');
