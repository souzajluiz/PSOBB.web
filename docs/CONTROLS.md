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
| F1 | function_key_info_menu (20) | missing | not ported | Toggles the F-key help window (flags 0x200 / 0x400, dump 682260 and `unknown_render_help_menu`). The port has no such window. |
| F2 | equipment_menu_shortcut (21) -> menu 0x09 | wired (field) | `input/shortcuts.ts` FKEY_MENU_ID; `render/fieldhud.ts` key(); `classic/fieldmenu.ts` openShortcut | Lobby: no-op, Equip is off in the lobby (ValidateMenuItemCondition). |
| F3 | technique_menu_shortcut (22) -> 0x03 | wired (field) | same | No-op on a safe map (Technique is off there). |
| F4 | mag_menu_shortcut (23) -> 0x17 | wired (field) | same | Lobby: no-op (MAG is off in the lobby). |
| F5 | guild_card_menu_shortcut (24) -> 0x0E | partial | `classic/lobby.ts` key() (the lobby's Guild Card window) | Field: no-op. The field menu's Guild Card entry is also a no-op in the field (the window is lobby-only). |
| F6 | simple_mail_menu_shortcut (25) -> 0x13 | partial | `classic/lobby.ts` key() (Simple Mail window) | Field: no-op, same reason as F5. |
| F7 | symbol_chat_menu_shortcut (26) -> 0x12 | partial | `classic/lobby.ts` key() (Symbol Chat list, preview) | Field: no-op. The End key's field picker (`classic/field.ts` key()) is a different window (send). |
| F8 | team_menu_shortcut (27) -> 0x25 | partial | `classic/lobby.ts` key() (Team Member List) | Needs a team (validate); field: no-op. |
| F9 | team_chat (28) | missing | not ported | Exe: `TeamChatMenu_Update_00717260` (dump 678299). The manual calls F9 the Team Log window. No team chat window in the port's chat line. |
| F10 | team_chat_toggle (29) | missing | not ported | Exe: dump 678385, the same team chat window. The manual calls F10 normal / team chat. |
| F11 | keyboard_controls_toggle (30) | missing | not ported | Exe: `ChallengePlayerInfoWindow_UpdateTextInputHandler_0072f130` (dump 697159), character option 0x1000000. The port has no mouse-control mode. |
| F12 | main_menu_2 (31) | wired | `render/fieldhud.ts` key(), `classic/lobby.ts` key() | Read through `bindingKey(BINDING.mainMenu2)`, so a rebound F12 follows the config. |
| Shift+F1..F12 | handle_chat_shortcuts (dump 674857): the raw F keys, slots 0..11 | partial | `input/shortcuts.ts` chatShortcutIndex; `render/fieldhud.ts` key(); `classic/lobby.ts` key(); `classic/chat.ts` ChatLine.useShortcut; `net/chatshortcut.ts` | Option 0x2000000 clear (the default): Shift+F sends the slot, plain F is the menu key. Option set: plain F sends the slot and Shift+F is the menu (the Options window's Function Key row). A slot is the save's record at 0x1FAC (text or symbol chat), sent with the chat cooldown (dropped while it runs). Not ported: the Chat > Shortcut leaf (0x11) editor, and the word-select record (type 2). |
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
| PageUp / PageDown | pso_keycode page_up (8) / page_down (9), raw keys (not a role) | partial | `classic/lobby.ts` key() (Log Window); `classic/chat.ts` ChatLog.page | Lobby only: the Log Window (Home > Chat > Log Window, leaf 0x15) moves a page (380 px = 19 rows) per press; PageUp shows older lines. Exe: ChallengePlayerListWindow_HandleInput_00752238 (dump 724833, `ListWindow_UpdateRenderProgress` +-380). The field has no Log Window leaf in the port, so the keys do nothing there. A new line returns the view to the newest. |
| End | symbol_chat_open (14) | wired (field) | `classic/field.ts` line 198 | The lobby's symbol list is the Home menu's (F7). |
| Ctrl+End | quickmenu (14) with Ctrl | missing | not ported | Exe: `unknown_handle_quickmenu` (dump 682493), `quick_menu_constructor`. The quick menu window is not in the port. |
| Up | camera (19) | wired | `render/lobbyview.ts` ~745 | Recentres the camera. |
| Left / Down / Right (action palette) | palette_left / middle / right (16 / 15 / 17) | wired | `render/combat.ts` ~1384 (PALETTE_KEYS) | Left = slot 2, Down = slot 1, Right = slot 3 (`input/keyconfig.ts` header). |
| Left / Down / Right / Up (menus) | select_left..up (12..10) | wired | `input/keyconfig.ts` menuKeyOf | |
| Print Screen | not an input enum role | missing | not ported | |

## Summary

- **Wired:** movement, the menu keys, Home, F12, F2..F4 in the field, F5..F8 in the
  lobby, Space, Ctrl, End (field), the action palette, the hotbar 1..0, the camera,
  Alt emotes, Q / E auto run and walk (the manual's keys, see the ASSUMED list).
- **Partial:** F5..F8 (lobby only), numpad (NumLock on only), Shift+F chat shortcuts
  (no slot editor, no word select), PageUp / PageDown (lobby Log Window only).
- **Missing:** F1 (help window), F9..F11 (team chat window and keyboard control mode),
  Ctrl+End (quick menu), Tab, Print Screen.

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
  The word-select record sends nothing here, and the lobby sends no symbol chat (the port's
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
- Auto run and walk: a direction key (W / S / A / D) turns the setting off; the exe turns
  it off on the forward key's ramp and when the player stops. Walk is a half forward push
  (fb 64) and run a full one (fb 128); the exe passes the speed itself.
- Esc is a second Cancel.
- Disabled shortcut entries do nothing (the exe's ValidateMenuItemCondition path).
