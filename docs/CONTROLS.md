# Keyboard controls: the PSOBB manual against the port

The official PSOBB manual's keyboard map (the user's screenshot, 2026-10-23) checked
binding by binding. The exe role is the input enum of the named dump
(`refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c`, `unknown_input_type`,
line 86172) and its key config index (`client/src/input/keyconfig.ts` BINDING). The
status says what the port does: **wired** (the key does what the manual says),
**partial** (some of it), **missing** (no key handler, or the window it opens is not in
the port). File references are to `client/src/`.

## Function keys and the other rows

| Key | Exe role (binding) | Port status | Where | Notes |
|---|---|---|---|---|
| F1 | function_key_info_menu (20) | partial (field) | `input/shortcuts.ts` functionKeyAction (kind 'help'); `render/fieldhud.ts` drawHelp | Toggles the F-key help list: 12 rows of group 11 0x161..0x16c (exe `unknown_render_help_menu`, flag 0x200 at the player menu object, dump 682584). Geometry ASSUMED. The exe's other branch (flag 0x400, when CanEnter is non-zero) is not read by its render path (not confirmed). Lobby: no-op. |
| F2 | equipment_menu_shortcut (21) -> menu 0x09 | wired (field) | `input/shortcuts.ts` FKEY_MENU_ID; `render/fieldhud.ts` key(); `classic/fieldmenu.ts` openShortcut | Lobby: no-op, Equip is off in the lobby (ValidateMenuItemCondition). |
| F3 | technique_menu_shortcut (22) -> 0x03 | wired (field) | same | No-op on a safe map (Technique is off there). |
| F4 | mag_menu_shortcut (23) -> 0x17 | wired (field) | same | Lobby: no-op (MAG is off in the lobby). |
| F5 | guild_card_menu_shortcut (24) -> 0x0E | wired | `input/shortcuts.ts`; `classic/homeleaves.ts` (the Guild Card leaf, shared by the field and the lobby) | Field and lobby: opens `classic/guildcardmenu.ts`. |
| F6 | simple_mail_menu_shortcut (25) -> 0x13 | wired | `classic/homeleaves.ts` (Simple Mail, `classic/simplemail.ts`) | Field and lobby. Needs the session's mailbox (no-op before the lobby connection). |
| F7 | symbol_chat_menu_shortcut (26) -> 0x12 | wired | `classic/homeleaves.ts` (Symbol Chat list, `classic/symbolchatlist.ts`) | Field and lobby. The End key's field picker (`classic/field.ts` key()) is a different window (send). |
| F8 | team_menu_shortcut (27) -> 0x25 | wired (needs a team) | `classic/homeleaves.ts` (Team Member List, `classic/teammenu.ts`) | Field and lobby. Greyed out of a team (ValidateMenuItemCondition, `classic/fieldmenu.ts` validateMenuEntry). |
| F9 | team_chat (28) | wired | `classic/teamchat.ts` (window), `classic/lobby.ts`, `render/fieldhud.ts` | Lobby and field. Exe: `TeamChatMenu_Update_00717260` (dump 678207, called from 677720): toggles the team log window (the quick menu's +0x48 list, position (8, 380) as literals at dump 677488). Opening sets the lock too (0x180). No team test, as in the exe. Same Shift test as the menu keys (option 0x2000000 clear: no Shift). |
| F10 | team_chat_toggle (29) | wired (window open) | `classic/teamchat.ts` (lock), `classic/chat.ts` ChatLine.sendText | Lobby and field, only while the team window is open. Exe: dump 678385 toggles the lock bit 0x80; `SendChatMessageDispatcher_0077d710` (754225) then sends the typed or shortcut line as team chat (07EA via `HandleTeamOperationSuccessFromChat_0077d784`, 754294, scene logged_in 0x0b). Received 07EA lines are kept in the team log (handler 0x007c1a4c). |
| F11 | keyboard_controls_toggle (30) | wired | `input/shortcuts.ts` functionKeyAction (kind 'keyboardToggle'); `classic/options.ts` toggleKeyboardControls; `input/keyconfig.ts` setKeyboardControls | Exe: `ChallengePlayerInfoWindow_UpdateTextInputHandler_0072f130` (dump 697159) flips character option 0x1000000 (Options row 2, Keyboard Controls ON / OFF) and sends 0x01ED. Same Shift test as the menu keys; not read while a chat line is open. The keys then follow the option (see Keyboard Controls OFF below). |
| F12 | main_menu_2 (31) | wired | `render/fieldhud.ts` key(), `classic/lobby.ts` key() | Read through `bindingKey(BINDING.mainMenu2)`, so a rebound F12 follows the config. |
| Shift+F1..F12 | handle_chat_shortcuts (dump 674857): the raw F keys, slots 0..11 | partial | `input/shortcuts.ts` chatShortcutIndex; `render/fieldhud.ts` key(); `classic/lobby.ts` key(); `classic/chat.ts` ChatLine.useShortcut; `net/chatshortcut.ts` | Option 0x2000000 clear (the default): Shift+F sends the slot, plain F is the menu key. Option set: plain F sends the slot and Shift+F is the menu (the Options window's Function Key row). A slot is the save's record at 0x1FAC (text or symbol chat), sent with the chat cooldown (dropped while it runs). Not ported: the Chat > Shortcut leaf (0x11) editor. A word-select record (type 2) sends 6x74 (`Lobby.sendWordSelect`, 2026-10-23). |
| Alt+F1..F12 | lobby emotes (`EMOTE_KEYS` f1..f12) | wired | `render/lobbyview.ts` (altEmoteKey, line ~707); `formats/emotes.ts` line 33 | Alt keeps the F keys off the shortcuts (the exe's `is_alt_pressed_` check). |
| Alt+1..0 | lobby emotes (digits) | wired | `render/lobbyview.ts`; `formats/emotes.ts` | |
| Alt+A..Z | lobby emotes (letters) | wired | `render/lobbyview.ts`; `formats/emotes.ts` | Letters in `EMOTE_KEYS`; the set is the port's (ASSUMED to match the exe's emote table). |
| 1..0 | palette_bar_slot_1..0 (35..44) | wired | `render/combat.ts` ~1405 (HOTBAR_KEYS) | Skipped while Shift, Alt or Ctrl is held (dump 555862). |
| Numpad 0..9 | the same bindings (keycode pairs) | partial | `render/combat.ts` ~1405 | Works only when the browser reports the digit (NumLock on). With NumLock off the numpad keys report their navigation names and do not match. |
| Tab | not an input enum role (hard-coded key 0x51, camera mode 0) | wired (field) | `input/keyconfig.ts` `paletteChannelDown`; `render/combat.ts` frame | Exe: `ProcessCameraInput_00708bd4` (dump 665913, lines 666092 / 666096) reads `unknown_is_key_pressed(0x51)` and `was_key_pressed(0x51)` and ORs `g_KeyboardSharedState[0xe]`, the palette-left bit (role 16, case 0x10). So Tab is a second Left key. It is outside the key config's table, so it works with Keyboard Controls OFF too. The port reads it in the field (the lobby's Tab is not traced, ASSUMED none). The game list's own Tab (`classic/gamelist.ts`) is another window. |
| Q | autorun (4), default row unbound | wired (manual key) | `input/automove.ts`; `render/lobbyview.ts` ~754 | The exe's preset rows 4 and 5 are 0 in every preset (`input/keyconfig.ts` PRESET_CODES), so the manual's Q and E are the fallback when the row has no key (ASSUMED). |
| E | autowalk (5), default row unbound | wired (manual key) | `input/automove.ts`; `render/lobbyview.ts` ~754 | Same as Q. |
| W / A / S / D | move_forwards..move_right (0..3) | wired | `render/combat.ts` (`render/combat.ts` ~1408, read at call time); `classic/lobby.ts` moveKeyOf; `render/lobbyview.ts` ~757 | Off with Keyboard Controls OFF (no key for roles 0..3). |
| Space | begin_chat_input (9) | wired | `classic/field.ts` (Input Start, `KEYS.chat`); `classic/lobby.ts` (same) | Off with Keyboard Controls OFF: the manual's "only when keyboard enabled". |
| Ctrl | switch_palette (18) | wired | `render/fieldhud.ts` line 694 | Flips the palette; the menu locks it. |
| Esc | Cancel (always) | wired | `input/keyconfig.ts` menuKeyOf | ASSUMED: the exe keeps Escape as a second Cancel (the caption says ESC/BACK SPACE). |
| Backspace | menu_back (7) | wired | `input/keyconfig.ts` menuKeyOf; `classic/fieldwindows.ts` listKey | |
| Enter | menu_accept (6) | wired | `input/keyconfig.ts` menuKeyOf | |
| Home | main_menu_1 (8) | wired | `render/fieldhud.ts` line 670; `classic/lobby.ts` line 652 | |
| PageUp / PageDown | pso_keycode page_up (8) / page_down (9), raw keys (not a role) | partial | `classic/lobby.ts` key() and `classic/fieldmenu.ts` key() (Log Window, Home > Chat, leaf 0x15); `classic/chat.ts` ChatLog.page, logPageKey | Plain keys only (`was_key_pressed_no_modifiers`, dump 807503). The Log Window moves a page (380 px = 19 rows) per press in the lobby and in the field: PageUp shows older lines. Exe: ChallengePlayerListWindow_HandleInput_00752238 (dump 724833, +-380). A new line returns the view to the newest. The ship lobby list and the party menu page too in the exe (dump 143023, 784044, +-140), not in the port. |
| End | quickmenu (14, the enum name; the config row is "Symbol Chat Open") | wired (field, with the palette flipped) | `classic/field.ts` key() (`view.paletteFlipped()`); `classic/quickmenuwindow.ts` | Exe: `unknown_handle_quickmenu` (dump 682493) opens `quick_menu_constructor` only when the action palette is flipped (`Player_CheckPaletteFlipState_0068ce14`, dump 558030, dump 682545): the End key alone does nothing on palette 1, so the manual's Ctrl+End is the chord (Ctrl flips the palette). The lobby's End is not gated (ASSUMED, see below). The lobby's symbol list is the Home menu's (F7). |
| Ctrl+End | quickmenu (14) with the palette flipped (Ctrl) | wired (field) | `classic/field.ts` key(); `render/fieldhud.ts` `paletteFlipped()` | The Ctrl tab flips the palette (`classic/palette.ts`); the next End opens the quick menu. Held-palette branch (`g_KeyboardSharedState[0xf]`) not ported (ASSUMED, see below). |
| Up | camera (19) | wired | `render/lobbyview.ts` ~745 | Recentres the camera. |
| Left / Down / Right (action palette) | palette_left / middle / right (16 / 15 / 17) | wired | `render/combat.ts` ~1384 (PALETTE_KEYS) | Left = slot 2, Down = slot 1, Right = slot 3 (`input/keyconfig.ts` header). |
| Left / Down / Right / Up (menus) | select_left..up (12..10) | wired | `input/keyconfig.ts` menuKeyOf | |
| Print Screen | not an input enum role | missing | not ported | |

## Summary

- **Wired:** movement, the menu keys, Home, F11 (Keyboard Controls), F12, F2..F8 (F5..F8 in the field and the lobby), Space, Ctrl, End with Ctrl (field), Tab (field, the Left key), the action palette, the hotbar 1..0, the camera,
  Alt emotes, Q / E auto run and walk (the manual's keys, see the ASSUMED list).
- **Partial:** F1 (help list, field only), numpad (NumLock on only), Shift+F chat shortcuts
  (no slot editor; word select sends 6x74, receive is not ported), PageUp / PageDown (the Log Window only: lobby and field; the ship lobby list and the party menu page in the exe, not ported).
- **Missing:** Print Screen, the mouse controls (option 0x700000).

## Keyboard Controls OFF

The character option 0x1000000 (Options > Keyboard Controls row, F11) is the switch. Set = OFF.
ProcessCameraInput_00708bd4 (dump 665913) reads each role's key through
`GetKeyboardInputsWhenDisabled_00791b34` (exe 0x00791b34: `0x0097b8e0 + role * 8`) when the
option is set, instead of the key config. That table (keycode_1 is 0 for roles 0..44, so
keycode_2 is the key) keeps:

- Decide Enter (6), Cancel Backspace (7), Menu Home (8), the arrows (10..13);
- F1..F12 (20..31);
- the hotbar 1..0 (35..44) on the numpad: 1..9 and 0 (keycodes 0x68..0x76 and 0x67).

Every other role is 0 (no key): Move Forward / Backward / Left / Right (0..3), the lock
moves (4, 5), Input Start Space (9), Symbol Chat End (14), the action palette (15..17),
Ctrl (18) and Camera Up (19). So with Keyboard Controls OFF the keyboard does not move,
does not open the chat with Space, and does not open the palette: the menus, the function
keys and the numpad hotbar still answer. Tab still presses the palette's Left slot (its test is
outside the table, dump 666092). The table lives in `input/keyconfig.ts`
(`KEYBOARD_OFF_KEYS`); `setKeyboardControls` swaps the keys in use.

## ASSUMED

- F2..F4 open the leaf with the main panel behind it (the leaf as the menu shows it when
  picked from the list). The exe may draw the leaf alone.
- Shift+F and the chat form: the option 0x2000000 meaning is the newserv comment's (0 =
  menu shortcuts, 1 = chat shortcuts). The two dump readers agree with it: the menu
  reader (unknown_handle_fkey_inputs) needs Shift when the option is set, the chat reader
  (handle_chat_shortcuts) needs Shift when it is clear. The raw F keys are read for the
  chat slots (was_key_pressed(f1..f12)), not the key config's bindings.
- A chat shortcut that comes during the cooldown is dropped; an empty slot still starts
  the cooldown (the exe sets the timer before send_chat_message, which then sends nothing).
  The word-select record sends 6x74 (lobby and field), and the lobby sends no symbol chat (the port's
  lobby has no symbol sender; the field has one).
- Log Window: the page step is 380 px (one page of 19 rows at 20 px), applied at once (the
  exe's list animates the progress over frames). A new line returns the view to the bottom
  (ChatShortcutMenuYesNoListWindow_AddItem_0073c228 resets the progress). The same handler
  also moves the progress by +-6 on two shared-state keys (g_KeyboardSharedState 8 and 9,
  dump 724833); the port does not map them (which keys they are is not traced).
- A typed line that comes during the chat cooldown is held with the input open until the
  cooldown ends (the chat window's send flag, retried each frame); Escape drops it.
- Q and E are the manual's keys when bindings 4 and 5 are unbound (the exe's presets
  leave them unbound).
- Ctrl+End (2026-10-24): the field's End opens the quick menu only with the palette flipped
  (`unknown_handle_quickmenu`, dump 682545). The palette-held branch (`g_KeyboardSharedState[0xf]`
  held opens it without End, dump 682545 / 682549) is not ported; which keys set bit 0xf is not traced.
  The lobby's End (`classic/lobby.ts`) is not gated (the same handler runs there, not verified).
- Tab (2026-10-24): camera mode 0 (the gameplay mode, `unknown_keyboard_enable_in_menu` sets mode 1
  for the menus) is the only mode with the Tab test (dump 666092). Bit 0xe has no consumer but the
  Left press (not traced in full).
- PageUp / PageDown in the field (2026-10-24): the Log Window (leaf 0x15) opens at the lobby's place
  (`LOG_WINDOW`), its page step is the lobby's (380 px); the field's other list windows do not page.
- Auto run and walk: a direction key (W / S / A / D) turns the setting off; the exe turns
  it off on the forward key's ramp and when the player stops. Walk is a half forward push
  (fb 64) and run a full one (fb 128); the exe passes the speed itself.
- Esc is a second Cancel.
- Disabled shortcut entries do nothing (the exe's ValidateMenuItemCondition path).
- F1 help list: 320 x 240 anchor, width 360, 12 rows of 20 px (the exe builds its list at 320 x 240 with width 0.1; the row step and text colour were not read). F1 toggles only; the exe's close key (`g_KeyboardSharedState[0x12]`, ASSUMED Escape) is not confirmed.
- F1 is field only (the lobby's F-key path does not handle the help kind).
- F11 is not read while a chat line is open (the exe's typing path in the same handler
  returns before the F-key test, dump 697096). The exe's text input is always on with the
  option set (`ChallengePlayerInfoWindow_UpdateTextInput_0072f248`, EnableTextInput_008411f8);
  the port does not open a typing line from the keyboard in that mode (not ported).
- Keyboard Controls OFF: the hotbar digits are the numpad keys (the table's 0x67..0x76 names);
  the port matches them by the digit's DOM key, so a top-row digit also answers (NumLock on
  reports the digit; with NumLock off the numpad names do not match).
- Q / E auto run and walk follow Keyboard Controls too (off with the option set; the exe has no key for them).
- The Home leaves in the field use the game's connection (a Game is a Lobby) and the lobby's team client.
