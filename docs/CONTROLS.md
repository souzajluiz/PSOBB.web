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
| F9 | team_chat (28) | missing | not ported | Exe: `TeamChatMenu_Update_00717260` (dump 678207, called from 677720): opens and closes the per-slot team window. The port has the 07EA send and receive (`net/team.ts`) but no team chat line or window (DEVLOG 2026-10-23, team chat). |
| F10 | team_chat_toggle (29) | missing | not ported | Exe: dump 678385: while that window is open, toggles the lock bit (0x80) that sends the chat line as team chat (`SendChatMessageDispatcher_0077d710`, dump 754350). Same reason as F9. |
| F11 | keyboard_controls_toggle (30) | missing | not ported | Exe: `ChallengePlayerInfoWindow_UpdateTextInputHandler_0072f130` (dump 697159), character option 0x1000000. The port has no mouse-control mode. |
| F12 | main_menu_2 (31) | wired | `render/fieldhud.ts` key(), `classic/lobby.ts` key() | Read through `bindingKey(BINDING.mainMenu2)`, so a rebound F12 follows the config. |
| Shift+F1..F12 | the same roles, option 0x2000000 | missing | `input/shortcuts.ts` functionKeyAction | The option flag is not in the port; it is taken as clear (plain F keys only). The chat shortcut form is not ported. |
| Alt+F1..F12 | lobby emotes (`EMOTE_KEYS` f1..f12) | wired | `render/lobbyview.ts` (altEmoteKey, line ~707); `formats/emotes.ts` line 33 | Alt keeps the F keys off the shortcuts (the exe's `is_alt_pressed_` check). |
| Alt+1..0 | lobby emotes (digits) | wired | `render/lobbyview.ts`; `formats/emotes.ts` | |
| Alt+A..Z | lobby emotes (letters) | wired | `render/lobbyview.ts`; `formats/emotes.ts` | Letters in `EMOTE_KEYS`; the set is the port's (ASSUMED to match the exe's emote table). |
| 1..0 | palette_bar_slot_1..0 (35..44) | wired | `render/combat.ts` ~1405 (HOTBAR_KEYS) | Skipped while Shift, Alt or Ctrl is held (dump 555862). |
| Numpad 0..9 | the same bindings (keycode pairs) | partial | `render/combat.ts` ~1405 | Works only when the browser reports the digit (NumLock on). With NumLock off the numpad keys report their navigation names and do not match. |
| Tab | not an input enum role | missing | `classic/gamelist.ts` line 224 (the game list only) | The manual's "Tab menu / character info change" is not a configurable role in the enum; the exe handler was not located. |
| Q | autorun (4), default row unbound | wired (manual key) | `input/automove.ts`; `render/lobbyview.ts` ~754 | The exe's preset rows 4 and 5 are 0 in every preset (`input/keyconfig.ts` PRESET_CODES), so the manual's Q and E are the fallback when the row has no key (ASSUMED). |
| E | autowalk (5), default row unbound | wired (manual key) | `input/automove.ts`; `render/lobbyview.ts` ~754 | Same as Q. |
| W / A / S / D | move_forwards..move_right (0..3) | wired | `render/combat.ts` line 243; `render/lobbyview.ts` ~757 | |
| Space | begin_chat_input (9) | wired | `classic/field.ts` line 203; `classic/lobby.ts` line 673 | |
| Ctrl | switch_palette (18) | wired | `render/fieldhud.ts` line 694 | Flips the palette; the menu locks it. |
| Esc | Cancel (always) | wired | `input/keyconfig.ts` menuKeyOf | ASSUMED: the exe keeps Escape as a second Cancel (the caption says ESC/BACK SPACE). |
| Backspace | menu_back (7) | wired | `input/keyconfig.ts` menuKeyOf; `classic/fieldwindows.ts` listKey | |
| Enter | menu_accept (6) | wired | `input/keyconfig.ts` menuKeyOf | |
| Home | main_menu_1 (8) | wired | `render/fieldhud.ts` line 670; `classic/lobby.ts` line 652 | |
| PageUp / PageDown | not an input enum role | missing | `classic/chat.ts` ChatLog (line ~127) | The Log Window draws the newest lines with no scroll state. The exe handler was not located. |
| End | symbol_chat_open (14) | wired (field) | `classic/field.ts` line 198 | The lobby's symbol list is the Home menu's (F7). |
| Ctrl+End | quickmenu (14) with Ctrl | missing | not ported | Exe: `unknown_handle_quickmenu` (dump 682493), `quick_menu_constructor`. The quick menu window is not in the port. |
| Up | camera (19) | wired | `render/lobbyview.ts` ~745 | Recentres the camera. |
| Left / Down / Right (action palette) | palette_left / middle / right (16 / 15 / 17) | wired | `render/combat.ts` ~1384 (PALETTE_KEYS) | Left = slot 2, Down = slot 1, Right = slot 3 (`input/keyconfig.ts` header). |
| Left / Down / Right / Up (menus) | select_left..up (12..10) | wired | `input/keyconfig.ts` menuKeyOf | |
| Print Screen | not an input enum role | missing | not ported | |

## Summary

- **Wired:** movement, the menu keys, Home, F12, F2..F8 (F5..F8 in the field and the lobby), Space, Ctrl, End (field), the action palette, the hotbar 1..0, the camera,
  Alt emotes, Q / E auto run and walk (the manual's keys, see the ASSUMED list).
- **Partial:** F1 (help list, field only), numpad (NumLock on only).
- **Missing:** F9..F11 (team chat, DEVLOG 2026-10-23; keyboard control mode),
  Shift+F (option flag), Ctrl+End (quick menu), PageUp / PageDown (log scroll), Tab,
  Print Screen.

## ASSUMED

- F2..F4 open the leaf with the main panel behind it (the leaf as the menu shows it when
  picked from the list). The exe may draw the leaf alone.
- Shift+F uses option 0x2000000 cleared (the port has no such flag).
- Q and E are the manual's keys when bindings 4 and 5 are unbound (the exe's presets
  leave them unbound).
- Auto run and walk: a direction key (W / S / A / D) turns the setting off; the exe turns
  it off on the forward key's ramp and when the player stops. Walk is a half forward push
  (fb 64) and run a full one (fb 128); the exe passes the speed itself.
- Esc is a second Cancel.
- Disabled shortcut entries do nothing (the exe's ValidateMenuItemCondition path).
- F1 help list: 320 x 240 anchor, width 360, 12 rows of 20 px (the exe builds its list at 320 x 240 with width 0.1; the row step and text colour were not read). F1 toggles only; the exe's close key (`g_KeyboardSharedState[0x12]`, ASSUMED Escape) is not confirmed.
- F1 is field only (the lobby's F-key path does not handle the help kind).
- The Home leaves in the field use the game's connection (a Game is a Lobby) and the lobby's team client.
