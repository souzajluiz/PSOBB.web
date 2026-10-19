# Protocol and file formats

Notes verified in practice against newserv. Primary source: `newserv/src/CommandFormats.hh`.

## BB command header

```
u16 size     total size including header, excluding padding
u16 command
u32 flag
```

- **Encrypted commands** are zero-padded to a multiple of 8 bytes.
- **The initial cleartext `03` is NOT padded.** newserv sent 380 bytes for `size = 0x17C`. A reader that always expects `(size + 7) & ~7` bytes hangs here (first bug found).
- **Several commands often arrive in one TCP/WebSocket chunk** (`E6` + `19`). `BBConnection` keeps a backlog, so a `waitFor()` registered after an `await` still sees them (second bug found, in Chrome).

## Login flow (port 12000, `bb-data1`)

| # | Dir | Cmd | Content |
|---|---|---|---|
| 1 | S→C | `03` | `copyright[0x60]`, `server_key[0x30]`, `client_key[0x30]` (+ newserv after-message). Cleartext. |
| 2 | C→S | `93` | Login, `guild_card_number = 0` |
| 3 | S→C | `E6` | `error_code`, `player_tag`, `guild_card_number`, `security_token`, `client_config[0x28]`, … (0 = OK) |
| 4 | S→C | `19` | Redirect: `be_u32 address`, `le_u16 port` |
| 5 | C→S | `93` | Login again on the new connection, now with `guild_card_number`, `security_token`, `client_config` from step 3 |
| 6 | S→C | `E6` | Accepted |
| 7 | C→S | `E3` | Preview request: `i32 slot`, `u32 unused` |
| 8 | S→C | `E5` / `E4` | `E5` = preview (`i32 slot` + `PlayerDispDataV4Preview` 0x7C); `E4` = `{slot, error=2}` empty slot |

newserv's reasoning (from `on_93_BB`): the BB client needs a reconnect during the data-server phase or it won't know where to connect for character selection.

### `93` login body (`C_LoginWithoutHardwareInfo_BB_93`, 0xA4 bytes)

| Off | Field |
|---|---|
| 00 | `player_tag` = 0x00010000 |
| 04 | `guild_card_number` |
| 08 | `sub_version` |
| 0C | `language` |
| 0D | `character_slot` |
| 0E | `connection_phase` (0 initial, 1 choose char, 2 create char, 3 dressing room, 4 login server, 5 lobby) |
| 0F | `client_code` |
| 10 | `security_token` |
| 14 | `username[0x30]` |
| 44 | `password[0x30]` |
| 74 | `menu_id` |
| 78 | `preferred_lobby_id` |
| 7C | `client_config[0x28]` (first connect: version string, e.g. `Ver. 1.25.13`) |

### Character preview (`PlayerDispDataV4Preview`, 0x7C)

| Off | Field |
|---|---|
| 00 | `exp` |
| 04 | `level` (0-based) |
| 08 | `visual` (0x70): `guild_card_number` string[0x10], shared visual config[0x40] (`section_id` @+0x20, `char_class` @+0x21, `costume`/`skin`/`face`/`head`/`hair` @+0x28..), `name` UTF-16[0x10] with `\tE` prefix |
| 78 | `play_time_seconds` |

## Character creation

On the data-server connection (after the second `E6`): `E5` with `{i32 slot, PlayerDispDataV4Preview}`. `PlayerVisualConfigV4` inside it: `guild_card_number` string[0x10], shared config (`name_color` @+0x08, `section_id` @+0x20, `char_class` @+0x21, `costume`/`skin`/`face`/`head`/`hair` u16 @+0x28..+0x30, `hair_r/g/b` u16 @+0x32..+0x36, `proportion_x/y` f32 @+0x38/+0x3C), `name` UTF-16 with `\tE` prefix @+0x50. Server answers `E4 {slot, result=1}`.

What PsoBB.exe puts in it for a new character (decompiled, see DEVLOG "character creation"):
- `guild_card_number` = `sprintf("%10d", guild card)` (FUN_004f34a8).
- `version` (@+0x23) = 3 and `class_flags` (@+0x24) = the class's default (`0x009b5f60`; e.g. HUmar 0x25, RAcast 0x51, FOnewearl 0x8A); `name_color` 0xFFFFFFFF, `extra_model` 0, `validation_flags & 0xF5`.
- `section_id` from FUN_004e7200, computed once when the character is confirmed. Starting at the first character after `\tE`: `sum = c0 + (narrow(c0) ? 0x2D : 0x53)`, then for each following character (at most 16) `sum += c`, plus 0x2D when switching from wide to narrow and 0x53 when switching from narrow to wide (narrow = `c < 0x100` or U+FF61..U+FF91). `section_id = (char_class + sum) % 10`. The class is part of the formula: "souzajluiz" is Pinkal (5) as a HUmar and Redria (6) as a HUnewearl. `sectionIdForName(name, charClass)` in `bbsession.ts` implements it.
- The name buffer is 12 UTF-16 units including `\tE`, so 10 visible characters.

## Game server → lobby

| # | Dir | Cmd | Content |
|---|---|---|---|
| 1 | C→S | `93` | `connection_phase = 4`, `character_slot`, plus guild card / token / client config |
| 2 | S→C | `E6`, `B1`, `E7` | accepted, server time, full character (0x3994 bytes) |
| 3 | S→C | `07` | main menu: entries of 0x2C (`menu_id`, `item_id`, u8, u8, UTF-16 name[0x10], u8 episode, u8 flags). newserv: *Go to lobby*, *Patches*, *Disconnect* |
| 4 | C→S | `10` | `{menu_id, item_id}` |
| 5 | S→C | `83`, `C5`, `67` | lobby list, challenge ranks, **join lobby** |

**`07` entry 0 is the menu title**, not an item: newserv sends `{menu_id, item_id = 0xFFFFFFFF, name = menu name}` first (`send_menu_t`). PsoBB.exe's 07 handler (0x0079ba38) compares that name with `L"BLOCK"`: otherwise it is a ship menu, the name is kept as the ship name (0x00aab2ec, shown later as `<ship>:<block>-<lobby>` in the lobby) and the window is titled with the client's own `L"Ship Select"` (`L"Block Select"` for block menus). `10` may be answered by another `07` (sub-menu, e.g. *Patches*) instead of `67`; `BBSession.connectGameServer` / `selectMenuItem` expose these steps for the classic UI.

`67` / `68` (join / one more player) = `LobbyFlags` (0x0C: `client_id`, `leader_id`, `disable_udp`, `lobby_number`, `block_number`, …) + entries of 0x520: `PlayerLobbyDataBB` (0x44: `guild_card_number` @+4, `client_id` @+0x1C, name UTF-16 @+0x20), `PlayerInventory` (0x34C), `PlayerDispDataV4` (0x190: stats with `level` @+0x18, visual @+0x24). `69`: player left, `flag` = client id.

## Full character file (`E7`, `SC_SyncSaveFiles_BB_E7`, 0x3994 bytes)

Sent by the game server after the phase-4 `93`, before the `07` menu, so it is already in `BBConnection`'s backlog when the menu arrives; `BBSession.enterLobby` takes it with `conn.poll(0xE7)` and fills `session.character` (`net/charfile.ts`). Layouts from newserv `SaveFileFormats.hh`, `PlayerInventory.hh`, `PlayerSubordinates.hh`, `LevelTable.hh`.

| Off | Size | Field |
|---|---|---|
| 0000 | 0x2EA4 | `PSOBBCharacterFile` |
| 2EA4 | 0x2B8 | `PSOBBBaseSystemFile` (key config etc.) |
| 315C | 0x838 | `PSOBBFullTeamMembership` (team name UTF-16 @+0x14) |

`PSOBBCharacterFile`:

| Off | Field |
|---|---|
| 0000 | `PlayerInventory` (0x34C): u8 `num_items`, `hp_from_materials`, `tp_from_materials`, `language`; 30 × `PlayerInventoryItem` (0x1C) |
| 034C | `PlayerDispDataV4` (0x190): stats (u16 ATP, MST, EVP, HP, DFP, ATA, LCK, ESP; f32 ×2; u32 `level` (0-based) @+0x18, `exp` @+0x1C, `meseta` @+0x20), visual (0x70) @+0x24, config (0xE8), `technique_levels_v1[0x14]` @+0x17C |
| 04E8 | u32 `play_time_seconds` |
| 06F4 | u32 `death_count` |
| 06F8 | `PlayerBank200` (0x12C8): u32 `num_items`, u32 `meseta`, 200 × {`ItemData`, u16 `amount`, u16 `present`} |
| 19C0 | `GuildCardBB` (0x108): u32 number, name, team name, description, …, language @+0x105 |
| 29EC / 2B44 | auto reply / info board (UTF-16, 0xAC) |

`PlayerInventoryItem`: u8 `state` (1 = held, 2 = equipped), u8, u8 `extension_data1`, u8 `extension_data2`, u32 `flags` @+4 (0x04 equippable, **0x08 equipped**, 0x100 kill count, 0x400 wrapped), `ItemData` @+8.

`ItemData` (0x14): `data1[12]`, u32 `id`, `data2[4]`. `data1[0]` = class (0 weapon, 1 armor/shield/unit, 2 mag, 3 tool, 4 meseta). Weapon: `[1..2]` kind, `[3]` grind, `[4]` special (0x80 unidentified, 0x40 wrapped), `[6..11]` three (stat, percent) pairs (1 native, 2 A.beast, 3 machine, 4 dark, 5 hit). Armor/shield: `[5]` slots, `data1w[3]` DFP bonus, `data1w[4]` EVP bonus. Unit: `data1w[3]` modifier (+/++/−/−−). Mag: `[2]` level, `[3]` photon blasts (LLRRRCCC), `data1w[2..5]` DEF/POW/DEX/MIND ×100, `data2` = synchro, IQ, flags (PB slots), color. Tool: `[5]` stack count; tech disk: `[2]` level − 1, `[4]` technique.

Technique level t = `technique_levels_v1[t]` + `inventory.items[t].extension_data1` (+1 for display); 0xFF = not learned (newserv `get_technique_level`).

## BB stream file (`04EB` / `01EB` / `03EB` / `02EB`)

On the data-server connection the client asks for the stream file: `04EB` (no body) → `01EB` with `flag` = entry count, entries of 0x4C {u32 size, u32 CRC32, u32 offset, char name[0x40]}; then `03EB` with `flag` = chunk index → `02EB` {u32 chunk_index, data ≤ 0x6800}. Files are concatenated in index order. newserv sends `BattleParamEntry*.dat` (6), `PlyLevelTbl.prs`, `ItemMagEdit.prs`, **`ItemPMT.prs`**. `BBSession.streamFiles()` downloads it.

## Item parameter table (`ItemPMT.prs`)

Not in `data.gsl`: on BB the server provides it (stream file above). `formats/itempmt.ts` ports newserv's V4 `BinaryItemParameterTableT`. PRS-compressed REL; the root (REL footer @size−0x10) holds 0x17 u32 offsets: weapon, armor, unit, tool, mag tables, weapon kinds, photon colors, ranges, weapon sale divisors (f32 per class), non-weapon sale divisors, mag feed (8 × 11 × 8 bytes), star values (u8 from id 0xB1), specials ({u16 type, u16 amount}), weapon effects, stat boosts (6 bytes), shield effects, max tech levels (19 × 12), combinations (0x10), sound remaps, tech boosts (0x18), unwrap, unsealable, ranged specials. Weapon/armor/unit/mag/tool tables are `ArrayRef {u32 count, u32 offset}` lists (weapons and tools: one per `data1[1]`; armor table: [armors, shields]). Entry sizes: weapon 0x2C, armor/shield 0x20, unit 0x14, mag 0x1C, tool 0x18, all starting with `ItemBaseV4 {u32 id, u16 type, u16 skin, u32 team_points}`. Bare arrays have no stored length: as in newserv, the length runs to the next pointer target found in the REL relocation table.

## Item names

`ItemBase.id` indexes **unitxt collection 1** (`parseUnitxt` numbering; newserv uses `get(BB_V4, ENGLISH, 1)`). Weapon special names are in the same collection at 0x256 + special (`SpecialStarsBeginIndex`, e.g. 599 = "Draw"), technique names are collection 5, and tech disks use the tech-disk tool's name ("Disk:") + technique + " Lv.N" (Ryuker/Reverser hide Lv.1). `formats/itemnames.ts` `ItemNames.describe` follows newserv `describe_item`: `[Wrapped] [????] [Special] Name [+grind] [K:kills] [N/AB/M/D[/hit]]`; armor `(N slots) +xDEF +yEVP`; units `Name+`/`++`/`-`/`--`; mags `LVn def/pow/dex/mind sync% IQ PB:… (color)`; stackable tools `xN`.

The text table must come from the same build as the ItemPMT, because the client indexes it with the PMT ids. In the test client folder (Ephinea) neither text table matches newserv's PMT: `data.gsl:unitxt_e.prs` has 946 item strings (Saber at 156) and the loose `unitxt_j.prs` (English text) has 1550 (Saber at 289, specials at 1048), while newserv's PMT puts Saber at 177 and specials at 599, matching newserv's own `system/text-sets/bb-v4/unitxt_e.prs` (1081 strings). `ItemNames.textMatches` checks that every id is in range and that entry 0x256 + special count is `????`; the Inventory panel tries the client's unitxt first and falls back to newserv's text set (dev server `/newserv-text/`). newserv's `names-v4.json` differs from that unitxt in four hand-corrected strings ("Ressurection", two trailing spaces).


## Lobby traffic

- **Chat `06`:** `u32 unused, u32 guild_card_number`, UTF-16 text. Sent as `\tE<text>`; received as `<name>\t\tE<text>`.
  The original client turns `\n` into spaces, logs `<name> > <text>` (30 lines, shown in the main menu's Log Window) and shows a word balloon over the speaker for round(len × 3.3 + 55.5) frames (see DEVLOG 2026-10-17, lobby HUD).
- **Subcommands `60`/`62`:** `u8 sub, u8 size_in_dwords, u16 client_id`, payload. Implemented:

| Sub | Meaning | Payload |
|---|---|---|
| `1F` | joined; asks others for positions | `i32 floor` |
| `20` | set position (answer to 1F) | `i32 floor, f32 x, y, z, u32 angle` |
| `3E`/`3F` | stop at / set position | `u16 near_enemy, u16 angle, i16 floor, i16 room, f32 x, y, z` |
| `40` | walk to | `f32 x, z, u32 flags` |
| `42` | run to | `f32 x, z` |

## Games (team rooms)

Implemented in `client/src/net/game.ts` (`Game extends Lobby`), tested live by `tests/game.live.ts`. Sources: newserv `CommandFormats.hh`, `ReceiveCommands.cc` (`on_C1_BB`, `on_10_game_menu`, `on_1D`, `on_6F`, `on_61_98`, `on_84`), `ReceiveSubcommands.cc`, `ServerState.cc` (`send_lobby_join_notifications`), and the real-client captures in newserv's `tests/` (`GC-ForestGameRareMagFeed`: create alone and warp; `GC-XB-CrossplayForestGame`: a second player joins). The GC captures use the same command and subcommand numbers as BB except for the 4-byte header.

| Step | Dir | Cmd | Content |
|---|---|---|---|
| Create | C→S | `C1` | `C_CreateGame_BB_C1` (0x50): `menu_id`, `item_id` (0), name UTF-16[0x10] @08, password UTF-16[0x10] @28, `difficulty` @48 (0–3), `battle_mode` @49, `challenge_mode` @4A, `episode` @4B (1, 2, 3 = Episode 4), `solo_mode` @4C. newserv keeps 14 characters of the name. |
| List | C→S | `08` | empty |
| | S→C | `08` | `S_MenuItem_PC_BB_08` entries (0x2C), flag = number of games. The first entry is the server name (item 0, flags 4). Per game: `item_id` = game id, `difficulty_tag` = 0x22 + difficulty, `num_players`, name, `episode` byte = `max_clients << 4 | episode` (`0x10 | episode` for solo), `flags`: 2 password, 4 not joinable (BB), 0x10 battle, 0x20 challenge, episode << 6 |
| Join | C→S | `10` | `{menu_id = 0x44000044, item_id = game id}`; with a password: flag 2 and UTF-16 password[0x10] @08 (0x28 bytes) |
| Refused | S→C | `01` / `0101` | lobby message box (text after an 8-byte header), e.g. "another player is currently loading" |
| Joined | S→C | `64` | `S_JoinGame_BB_64` (0x1A0), flag = player count: `Variations` (16 × `{u32 layout, u32 entities}`) @000, `PlayerLobbyDataBB[4]` @080 **in slot order** (empty slots zero), `client_id` @190, `leader_id` @191, `disable_udp`, `difficulty` @193, `battle_mode`, `event`, `section_id` @196, `challenge_mode`, `random_seed` @198, `episode` @19C, `solo_mode` @19E, `is_in_quest` @19F |
| | S→C | `1D` | ping; newserv **holds every command for the joiner** (the other players' sync) until the client answers `1D` |
| Others | S→C | `65` | the joiner's full entry (same layout as `68`) |
| Left | S→C | `66` | flag = client id; data `{client_id, leader_id, disable_udp, 0}` |

Loading sequence of the joining client (captures, mirrored by `Game`): `1D` reply, `8A` (game name; the server answers `8A` with UTF-16 text), then after loading the floor `6x3F` (position), `6x1F` (floor), `6x3B`, `6F`. The server answers `6F` with `B1` (time) and the client sends `99`. Another client may only join once `6F` cleared the loading flag (otherwise `01` "currently loading").

When `65` arrives, the players already in the game send state to the joiner with private commands (`62`/`6D`, flag = joiner's client id). newserv registers exactly which ones it expects (`expected_game_state_sync_commands`) and disconnects a client that sends an unexpected one:

| Sender | Order (capture) | Subcommands |
|---|---|---|
| leader | 1 | `6x6D` item state (`6D`, BC0-compressed `G_SyncItemState_6x6D_Decompressed`: next drop number per floor, next item id per player = 0x00010000 + 0x00200000 × client + items used, floor item counts) |
| leader | 2–4 | `6x6B` enemy, `6x6C` object, `6x6E` set flag states (BC0) |
| leader | 5–6 | `6x6F` quest flags (`62`), `6x71` unblock join (`62`, header only) |
| everyone | 7 | `6x70` own player (`6D`, `G_SyncPlayerDispAndInventory_BB_6x70`, 0x4C0) |

On BB the server, not the leader, then sends `6x72` (resume) to **every player except the joiner** once the leader's `6x70` arrived (`send_resume_game`). The web client sends all of them (`net/joinsync.ts`): `6x6B`/`6x6C`/`6x6E` with the game-wide counts of floors 0..0x11 (newserv checks them against every floor's map, enemy children included), `6x6F` with `use_apply_mask` 1 (the receiver copies only the 282 flags listed at 0x00969c60). Without a game view (node scripts) it sends `6x6D`, `6x6F`, `6x71` and `6x70`. The BC0 data is sent as a literal-only stream (newserv `bc0_encode`: one control byte with a 1 bit per literal, LSB first, then up to 8 bytes).

`6x70` (BB, offsets from the subcommand start): extended header `{0x70, 0, client_id, u32 size}`; `G_6x70_Base_V1` @008 (`client_id` u16 @008, `room` @00A, `game_flags` @00C, position @010, angle (3 × i32 BAMS) @01C, `current_hp` @02A, bonus HP/TP @02C/@02E, status effects @030, `language32` @06C, `player_tag` @070, guild card @074, telepipe @080 (owner 0xFFFF = none), death flags @09C, hold state @0A0, `area` @0B4, `player_flags` @0B8, `technique_levels_v1` @0BC); `PlayerVisualConfigV4` @0D0; `PlayerStats` @140; `num_items` @164; `PlayerInventoryItem[30]` @168; `floor` @4B0. newserv re-encodes it for the joiner and fills `client_id` and the guild card itself. **The joiner gets the other players' appearance only from `6x70`** (`64` carries names and guild cards).

Extended subcommands (`6D`, and `6C`/`62` for large payloads) have size byte 0 and a `u32` byte size after the 4-byte header; `Lobby.onSubcommands` reads both forms.

| Sub | Meaning | Payload |
|---|---|---|
| `1F` | set floor and ask for positions (others answer `6x20`) | `i32 floor` |
| `21` | inter-level warp | `i32 floor` |
| `22` / `23` | player invisible / visible (while changing floors) | none |
| `3B` | clear temporary photon blast state flags (sent after each floor load) | none |
| `3F` | set position | `u16 near_enemy, u16 angle, i16 floor, i16 room, f32 x, y, z` |
| `40` | walk to | `f32 x, z, u32 flags` (8 = near an enemy) |

Warp (capture): `6x21 {floor}`, `6x22`, …load…, `6x3F`, `6x1F {floor}`, `6x3B`, `6x23`.

Leave: `98` with `C_CharacterData_BB_61_98` (0x824: inventory, `PlayerDispDataV4`, `PlayerRecordsEntry_BB` {client id, challenge 0x140, battle 0x18} @4DC, `ChoiceSearchConfig` @638, info board UTF-16[0xAC] @650, blocked senders[0x1E] @7A8, `auto_reply_enabled` @820). newserv keeps its own inventory/disp for BB and only stores the records, choice search, info board and blocked senders, so the web client fills them from the `00E7` save data (`PSOBBCharacterFile`: info board @2B44, battle records @2C9C, challenge records @2CB8, choice search @2E20). It answers with `00E7` (save data). Then `84 {menu_id = 0x33000033, item_id = lobby id}` → `67`.

### Floors and map files

Floor → area (newserv `default_floor_to_area`): Episode 1 floor = area (0 Pioneer 2, 1–2 Forest, 3–5 Caves, 6–7 Mines, 8–10 Ruins, 11–14 bosses); Episode 2 area = 0x12 + floor; Episode 4: 0x2D, 0x24..0x2C, 0x2E.

The map files of a floor come from the client's `SetDataTableOn.rel` (`SetDataTableOff.rel` for solo; newserv also has `*Ulti.rel` tables for Episode 1 Ultimate, not present in Ephinea's client), parsed by `client/src/formats/setdatatable.ts` and checked against newserv's `disassemble-set-data-table` (`tests/setdatatable.test.ts`). REL root → area table `{u32 layouts, u32 count}` → layout table `{u32 entities, u32 count}` → entries of three C string pointers: object list basename, enemy+event list basename, area setup name. With the floor's `{layout, entities}` from `64`:

- objects `<object basename>o.dat`, enemies `<enemy basename>e.dat`, events `<enemy basename>.evt`; on floor 0 the suffix is `_s` / `_c1` / `_d` for solo / challenge / battle;
- render geometry: the setup name plus `n.rel` (`map_forest01n.rel`, `map_cave01_00n.rel`), or with `_00` added (`map_city00` → `map_city00_00n.rel`, `map_labo00`, the Episode 2 jungle maps); `map_boss04` is drawn from `map_darkfalz00n.rel`. This is the same pairing as `setVariantsForMap` in `formats/setdata.ts`;
- the server only picks among the free-play variation counts of newserv's `num_free_play_variations_for_floor` (the table also holds quest-only layouts, e.g. Cave layouts 03–05).

All 235 free-play floor variations of the three episodes resolve to a render map, a collision map and set files in Ephinea's client.

Player start: the floor's `TObjPlayerSet` with `param1` = client id and `param4` = 0 when arriving from a lower floor, 1 when returning from a higher one.

### Warps, doors and switches

Implemented in `client/src/render/fieldobjects.ts`, `warpmenu.ts` and `gamefield.ts`, tested by `tests/warpmenu.test.ts`. Objects are built from a per-area factory table of `{u32 type, create function, f32 250000.0, 0}` entries (pointer array at `0x00a06be0` by area id; Forest 1 at `0x00a0db20`, Pioneer 2 at `0x00a0df20`).

| Type | Object | Radius | Destination / behaviour |
|---|---|---|---|
| `0x0002` | `TObjAreaWarpForest` (create `FUN_007bac58`, base ctor `FUN_00668b74` / `FUN_0066982c`) | 10.0 | `param4` |
| `0x0019` | `TObjWarpBoss` (`FUN_0066c4b4`) | 19.0 | floor from the table at `0x0097f380` (18 floors per episode, `FUN_0080c340`); locked until switch flag `param5` unless on Pioneer 2 |
| `0x0043` | `TObjCityMainWarp`, the Ragol teleporter (`FUN_0064a8dc`) | 25.0 | destination menu (`param5` = Episode 2 warp type, clamped 0..2) |
| `0x0044` | `TObjCityAreaWarp`, the lobby teleporter (`FUN_0064ad68` → `FUN_0064ade4`) | 23.0 | floor 0x0F: the client leaves the game (`98` + `84`) |
| `0x0140`, `0x0201`, `0x0280` | Ruins / CCA floor warps (newserv) | 10.0 (not traced) | `param4` |

Base update `FUN_006698e0`: while the local player is within the radius (`FUN_00669a58`, 3D distance; the web client checks horizontally within ±30 in height), the object opens its menu (vtable +0x34), polls it (+0x40) and on Decide warps (+0x44, `FUN_00669650`). Leaving the radius closes the menu; Cancel keeps it closed until the player has left once (+0xbc). Control is disabled while the menu is open (`FUN_00791748(0)`).

- Area and boss warps (`FUN_00669410`): one item, the destination area's name, unitxt group 10 index from the table at `0x0097c660` (`FUN_0079313c`). Window at position-table entry 0x35 = (267, 130), sized by `FUN_0073608c`: width = text + 20, height = 14 + 20.
- Ragol teleporter (`FUN_00649cec`): one item per set bit of the mask `DAT_00a8f4fc` computed by `FUN_0064a428` (quest bits `DAT_00a8f500` ORed in). Bit *i* → floor `table[i]`, name unitxt(10, `text[i]`): Episode 1 floors `0x00936260` / text `0x00936300`, Episode 2 `0x009362a0` / `0x00936340`, Episode 4 `0x00936404` / `0x00936430`. Masks: Episode 1 `0xA5` & `0xFFFE03FF` → Forest 1, Cave 1, Mine 1, Ruins 1; Episode 2 `0x215` (type 1: & `0xFFFE780F` → VR Temple Alpha, VR Spaceship Alpha; type 2: & `0xFFFE7FF0` → Central Control Area, Seabed Upper; then & `0xFFFF87FF`); Episode 4 `0x3F` & `0xFFFFFCFF` → Crater East/West/South/North, Crater Interior, Desert 1. The quest-flag checks (`FUN_0064a650`, flags `0x1F9`/`0x201`/`0x207`... per newserv) only OR in bits the base mask already has, and `FUN_006dc358` returns 0, so this client offers every destination in free play. Window at entry 0x34 = (176, 130), width 288 (`FUN_00736138`), height = items × 20 − 6 + 20, capped at 160 (`FUN_007361d0`, scrolling), items centred (`FUN_00736458`). The names come from Ephinea's loose `unitxt_j.prs` (`data.gsl:unitxt_e.prs` has empty Episode 4 entries).

#### Boss warp: gathering the party (`6x6A`)

Code: `client/src/render/bosswarp.ts`, wired in `gamefield.ts`. Test: `tests/bossrooms.test.ts`. A boss warp does not warp the player who steps in: it asks, gathers the party, then warps whoever is standing in it. The object keeps the state at `+0xE0` (what `6x6A` carries), the state it is currently running at `+0xE2` and a substate at `+0xE4`; its update notices a state change, lets the old state clean up with substate `-1`, copies `+0xE0` to `+0xE2` and restarts at substate 0:

| State | Handler | Behaviour |
|---|---|---|
| 0 idle / confirmation | `0x0066B9E0` | inside the radius: the Yes/No window (unitxt 11:0x54 "This transporter can transport more than one player…", GUI position 0x38 = (244, 224), width 368.0, cursor on "No") and the player list (position 0x36 = (17, 224)) with a tick per player already at the warp and `0xFFFFFF00` for a player whose movement is disabled. "Yes" sends `6x6A` state 1; "No", a cancel or leaving the radius disables the local player's movement and waits. The floor leader sends `6x6A` state 2 as soon as all four players are on this floor inside the radius |
| 1 gather players | `0x0066B5F8` | arms a 300-frame timer, plays sound effect 6, shows unitxt 11:0x55 ("The transporter was activated"); the leader sends `6x6A` state 2 when the timer runs out or everyone is inside |
| 2 warp | `0x0066B4FC` | 0x96-frame warp animation; offline the local player inside the radius is warped at once; then state 3 |
| 3 destination occupied | `0x0066B370` | one-line window, unitxt 11:0x53 ("Battle going on in the next area…", position 0x37 = (228, 224)); back to state 0 once the destination is free |
| 4 locked | — | until the switch flag is set (newserv; the flag check is skipped on Pioneer 2, `FUN_0066C838`) |

The leader's automatic advance is gated by the global at `0x009C9558`, which is **1 in the image** and only cleared by the quest opcode `warp_off` (`warp_on` sets it), so free play gathers normally.

| Sub | Meaning | Payload |
|---|---|---|
| `6A` | set boss warp state (`G_SetBossWarpState_6x6A`, 8 bytes) | `{6A, 02, u16 entity id (0x4000 + object index), u16 state, u16 unused}` |

`checked_call_packet0x60_subcommand` sends the subcommand **and then runs the client's own handler**, so the sender applies the same state change; this client does the same (`Game.sendBossWarpState` + `BossWarp.receive`).

Doors open when their switch flags are set. `TObjDoor` (0x80, Forest; ctor `FUN_006573d4`, update `FUN_00656e28` → `FUN_00656eb4`): flag = `param4 & 0xFF`, number on the door = `(param4 >> 8) % 10`, `param6` = unlock camera (0x50 frames). States: 0 locked until the flag is set (`FUN_00816eec`); 2 closed: opens when a player on the floor is within 70.0 (`0x00937964`); 4 opening, +1.8 motion frames per frame (`0x0093795c`); 5 open until no player is within 100.0 (`0x0093796c`); 3 closing, −1.8 per frame. Collision is on while closed (`FUN_007b52c4`) and off while open (`FUN_007b52ec`). Cave / Mine / Ruins doors (0xC1, 0xC2, 0xCE, 0x100, 0x102, 0x144–0x14B) take their flags from `param4`/`param5` as newserv documents and reuse the Forest door's distances.

Switches: `TObjDoorKey` (0x81, ctor `FUN_00658b0c` on the generic switch `FUN_0062998c`, radius 20.0 at +0xcc) sets flag `param4` and sends `6x05`:

| Sub | Meaning | Payload (after the 4-byte header `{05, 03, u16 entity id}`) |
|---|---|---|
| `05` | write switch flag (`G_WriteSwitchFlag_6x05`, 0x0C) | `u16 client_id, u16 unused, u16 flag, u8 floor, u8 flags` (1 = set, 2 = play the unlock sound) |

The entity id of an object is 0x4000 + its index counted over the object lists (`o.dat`) of all floors in order (newserv `MapState::object_state_for_index`); wave events use 0xFFFF. Real-client capture (newserv `DCv1-DCv2-PCv2-CrossplayPrivateDrops`): `05 03 68 40 00 00 FC 8C 07 00 01 01`. Received `6x05` set or clear the flag on that floor.

### Object models

Implemented in `client/src/formats/objectmodels.ts` (type → archive table) and `render/objectview.ts` (floor layer), tested by `tests/waves.test.ts`. The per-area factory table above gives the constructor; every class also has a loader, run when the area is loaded, that reads one BML with `LoadBML_005b7a84` into a global (entries by position, models first and then motions, exactly as for enemy archives) and usually a separate texture archive with `FUN_008009dc("<name>.gvm")` — on Blue Burst the file is `<name>.xvm`. `FUN_005b8610(i)` / `FUN_005b8624(i)` / `FUN_005b8638(i)` (thiscall on the archive) return model *i*, its texture list and motion *i*; the render functions draw a model with `FUN_00835090` (static) or `FUN_00835574` (model, frame), pick the texture list with `FUN_00829cc8` and set the texture id of every mesh with `FUN_0081a588(model, id)`.

| Object | Archive (loader) | Models |
|---|---|---|
| `TObjAreaWarpForest` / `TObjMapWarpForest` | `fs_obj_warp.bml` + `fs_obj_warp.xvm` (`0x0066ad38`) | base 0 (4 for the map warp) and beam 1 (5) with motion 0 (2), frame +4.0 per frame (`0x00939a2c`); the beam's texture id is `{3, 2}[param6 & 1]` (`FUN_00669ab0`) |
| `TObjWarpBoss` | `bm_obj_warpboss.bml`, `bm_obj_warpboss_ancient.bml` (Ruins), `bm_obj_warpboss_jungle.bml` (Episode 2 / Seabed) (`FUN_0066cc28`) | base 0 plus model 2 with motion 1 while locked, or model 1 with motion 0 when open (`FUN_0066c89c`, `FUN_0066cadc`) |
| `TObjCityMainWarp` / `TObjCityAreaWarp` / `TObjCityMapWarp` | `bm_obj_city_common.bml` + `bm_obj_city_common.xvm` (`FUN_00645b18`) | 12 + 0 with motion 5, 1 with motion 6, 13 + 3 with motion 7 |
| `TObjDoor` (Forest) | `fe_obj_doa_kanban.bml` + `fe_obj_door.xvm` (`FUN_0065753c`) | locked: door 4, laser 3 with motion 1 (+1.0 per frame, `0x00937990`), sign 0 with texture id = the door number in the colour of `0x009c7b04[digit]`, lamps 1 and 2 with texture 0x15; unlocked: door 4 with motion 0 at the state machine's frame, lamps with texture 0x16 (`FUN_006571f4` → `0x009c7ad8`) |
| Cave / Mine / Ruins / VR / Seabed / Lab / Episode 4 doors | one archive each (`bm_fs_obj_do_doa0{1,2,3}`, `bm_fs_obj_ki_doa{,2}`, `bm_fe_obj_o_door0{1,3,4}l`, `fs_obj_door07_m`, `fs_obj_o_door0{5,6}l`, `fs_obj_o_vs2door01l`, `fs_obj_ex_doa01`, `bm_obj_door_ruins`, `bm_obj_door_space`, `bm_o_door_seabed01[_u]`, `bm_obj_door_labo`, `bm_obj_labodoor_nrm`, `bm_obj_beamdoa`, `bm_o_jungle_doormain`, `bm_obj_ep4_door`) | model 0 with motion 0; the `*r.gvm` texture list is used while locked and the `*g.gvm` one when open. Ultimate Episode 1 loads the `_a` archives (online flag `DAT_009f9860` and difficulty 3). |
| `TObjDoorKey` (switch) | `abeno_fs_obj001_fosuno.bml` + `fe_obj_switch.xvm` (`FUN_00658d00`) | base 1 always, glow 2 while the flag is set, digit 0 with texture id = `clamp(param6, 0, 9)` in colour `0x009c7ce0[digit]` (`FUN_00658824` / `FUN_0065893c`) |
| Other switches | `bm_fs_obj_do_doa_panel` / `fs_obj_key_jungle` (Episode 2, Seabed), `bm_fs_obj_ki_doa_panel`, `bm_fs_obj_o_doorpanel`, `bm_fs_obj_o_doorswitch01`, `bm_fd_obj_n_switch` | model 0 (`0x0062b0c8`, `FUN_0062c050`, `FUN_0062ab64`, `FUN_0062a0a8`) |
| Boxes | `fe_obj_hako01_hahen02` + `fs_obj_hako01_{n,a}.gvm`, `bm_obj_seabed_con` (Seabed), `bm_obj_ep4_container` (Episode 4), and their rare counterparts (`FUN_0064f674`, `FUN_0064f448`) | model 1 (normal) or 2 (rare); collision sphere `0x009c77ac` (radius 9, 6 units up) |

The door's collision box comes from `InitEnemyCollisionBoxes_007b9a88(&box, 1)` in the constructor (0x2C bytes: position, radius, half-width, type, flags). Every door but a few uses 20 × 10 half extents 20 units up; the Forest door is 40 × 10 at floor level, the jungle gate 80 × 20, the laser door 30 × 10. While the door is closed the client sets flag 1 on the box (`FUN_007b52c4`) and clears it when the door opens (`FUN_007b52ec`); `render/collision.ts` keeps these boxes in `CollisionWorld.obstacles` and refuses a move that ends inside one.

### Wave events (`<enemy basename>.evt`)

Implemented in `client/src/formats/events.ts` (file), `render/waves.ts` (state machine) and `render/gamefield.ts` (wiring), tested by `tests/waves.test.ts` and `tests/game.live.ts`. The floor's event file is the SetDataTable's enemy basename + `.evt` (`LoadMapEventTableByVariant_0080cf78`), loaded whole into `g_MapEventTablesArray[floor]`.

```
00 u32 action_stream_offset   (from the start of the file)
04 u32 entries_offset         (0x10)
08 u32 entry_count
0C u32 format                 (0, or 'evt2' for the random-wave quest format)
entries (0x14 each):
  00 u32 event_id   several entries may share an id
  04 u16 flags      runtime: 2 handler built, 4 active, 8 actions run, 0x10 all enemies dead
  06 u16 event_type index into the handler table 0x00a11e24; 1 = the wave handler, 0 = nothing
  08 u16 room       the wave's enemies are the e.dat entries with this room
  0A u16 wave       and this wave number
  0C u32 delay      frames between the trigger and the spawn
  10 u32 action_offset
```

Action stream (`ProcessQuestEventCommands_0080cc44`, dispatch table `0x00a11da0` of `{reader, handler}` pairs; operands read by `FUN_0080ccd8` (u16) and `FUN_0080cd18` (u32)):

| Opcode | Action | Handler |
|---|---|---|
| `00` | nop | — |
| `01` | stop | `FUN_0080cd40` |
| `08 u16 u16` | `construct_objects(room, group)` | `FUN_0080cd4c` → `FUN_00810ae8` |
| `09 u16 u16` | `construct_enemies(room, wave)` | `FUN_0080cd64` → `FUN_00810e54` |
| `0A u16` | `set_switch_flag(flag)`, sends `6x05` | `FUN_0080cd7c` |
| `0B u16` | `clear_switch_flag(flag)`, sends `6x05` with flags 0 | `FUN_0080cddc` |
| `0C u32` | `trigger_event(id)`, sends `6x67` | `FUN_0080ce24` |
| `0D u16 u16` | `construct_enemies` then stop | `FUN_0080ce74` |

**Triggering.** `TObjEvtCollision` (`o.dat` type 0x0008, ctor `FUN_00659ebc`, update `FUN_00659d98`): radius `param1`, event id `param4`, idle for 3 frames after construction; when the local player is inside the radius it sends `6x67` with its own entity id and sets its own set flag 8, so it fires once. `FUN_008003e0` both sends a subcommand and runs its handler locally, so the sender handles its own `6x67`. The handler `FUN_00659f5c` calls `set_active_map_event_on_floor` for the current floor (the **first** event with that id whose flag 2 is clear gets a handler and `flags |= 6`); for another floor it only sets flag 4 on every event with that id, and `set_active_map_events` builds their handlers when that floor is entered.

**Handler** (`quest_event_handler_constructor`, `update_quest_event`): state 0 counts the delay down and then constructs every e.dat entry of the event's room and wave that is neither built (flag 2) nor dead (flag 8) (`unknown_enemy_spawn`, `0x00811188`); state 1 waits until none of them is alive (`DerolleHasUninitializedSubordinate_00787f04`) and sets flag 0x10; state 2 sets flag 8, runs the action stream and, if it triggered no further event, shows the room-unlocked message to the players in the room; then it clears flag 4 and the handler is destroyed (clearing flag 2). The first `set_switch_flag` of a run sends flags byte 3 (set + unlock sound, `g_QuestEventInitialized`), the rest 1.

| Sub | Meaning | Payload (after the 4-byte header) |
|---|---|---|
| `67` | trigger set event (`G_TriggerSetEvent_6x67`, 0x10) | `u32 floor, u32 event id, u32 client id`; entity id 0x4000 + object index for a trigger object, 0xFFFF for an action |
| `76` | set entity set flags (`G_SetEntitySetFlags_6x76`, 8) | `u16 floor, u16 flags`; entity id 0x1000 + enemy slot or 0x4000 + object index. Flag 8 = defeated, which is what advances a wave |

Enemy entity ids are 0x1000 + the enemy slot counted over all floors: one `e.dat` entry takes one slot plus its children (Monest 30 Mothmants, Pofuilly 4 copies, Pan Arms 2, boss parts…), ported from newserv's `SuperMap::add_enemy_and_children` into `formats/enemyids.ts`. newserv checks these ids when it tracks wave state, so the counts must match.

**Battle music** (`FUN_0069821c` → `FUN_008114b0`): battle while an enemy of the local player's room is built and not dead; after the last one dies the calm music returns 90 frames (0x5A) later. The player's room is the one on the player object (+0x28); the web client resolves it from the map sections the position falls into.

## Quests

Implemented in `client/src/net/quests.ts` (menus and the file transfer),
`client/src/formats/questbin.ts` + `questdat.ts` + `questopcodes.ts` (the two
files), `client/src/quest/vm.ts` + `session.ts` + `run.ts` (the script VM and
the game wiring). Tested by `tests/quests.test.ts` (every Blue Burst quest
newserv ships) and `tests/quest.live.ts` (the whole exchange against newserv).

Sources: newserv `CommandFormats.hh`, `SendCommands.cc`
(`send_quest_menu`, `send_open_quest_file`, `send_quest_file_chunk`,
`send_quest_barrier_if_all_clients_ready`), `ReceiveCommands.cc`
(`on_09`, `on_10_quest_categories`, `on_10_quest_menu`, `set_lobby_quest`,
`on_13_A7_V3_V4`, `on_AC_V3_BB`, `on_quest_loaded`), `QuestScript.hh`/`.cc`,
`Map.hh`; and, for the client side, `refsrc` `headers/quests.h` plus the named
Ghidra dump (addresses below).

### Picking a quest and receiving its files

| Step | Dir | Cmd | Content |
|---|---|---|---|
| Ask for the menu | C→S | `A2` | empty |
| Categories | S→C | `A2` | `S_QuestMenuEntry_BB_A2_A4` (0x13C), flag = count: `menu_id`, `item_id` = category id, UTF-16 `name[0x20]` @08, UTF-16 `short_description[0x78]` @48, `u8 disabled` @138. Category entries use `menu_id` 0x01000001 (Ep1/Ep3/Ep4) or 0x02000002 (Ep2) |
| Open a category | C→S | `10` | `{menu_id, item_id}` |
| Quest list | S→C | `A2` | same entries, `menu_id` 0x55010155 (Ep1) or 0x55020255 (Ep2), `item_id` = the server's quest number |
| Ask about a quest | C→S | `09` | `C_MenuItemInfoRequest_09` `{menu_id, item_id}`. newserv answers nothing for a **category** (its short description already came with the entry) |
| Description | S→C | `A3` | plain UTF-16 text (same shape as `1A`/`D5`); `header.flag` carries the Challenge stage number (51–59 Ep1, 61–65 Ep2) or is ignored |
| Load a quest | C→S | `10` | `{menu_id, item_id}` |
| Open file | S→C | `44` | `S_OpenFile_BB_44_A6` (0x50): `u8 unused[0x22]`, `u16 type` @22, ASCII `filename[0x10]` @24, `u32 file_size` @34, ASCII `name[0x18]` @38 (`"PSO/<quest name>"`). Sent once for the `.bin`, once for the `.dat` |
| Confirm | C→S | `44` | `C_OpenFileConfirmation_44_A6`: ASCII `filename[0x10]`, flag echoed |
| Chunk | S→C | `13` | `S_WriteFile_13_A7` (0x414): ASCII `filename[0x10]`, `u8 data[0x400]`, `u32 data_size` @410; flag = chunk index (offset / 0x400) |
| Confirm chunk | C→S | `13` | ASCII `filename[0x10]`, flag = the chunk index |
| Barrier | C→S | `AC` | empty: this client has the files |
| Start | S→C | `AC` | empty: every client is loaded, the quest starts |

- The client only considers a file complete when a chunk is **shorter than
  0x400**; newserv therefore appends one zero byte to a file whose size is a
  multiple of 0x400 (PRS stops at its own end marker, so the byte is never
  read). `net/quests.ts` honours the short-chunk rule and also stops at the
  announced size, so a server that does not pad still works.
- newserv keeps `V3_V4_QUEST_LOAD_MAX_CHUNKS_IN_FLIGHT` = 4 chunks in flight
  and sends chunk `flag + 4` on each acknowledgement, so the acknowledgements
  are what drives the transfer.
- `A6` / `A7` are the same pair for **download quests** (what the original
  client would write to the memory card). newserv sends them when a client
  picks a quest from a lobby rather than from a game; `A4` is the download
  quest menu and `A5` its description. `QuestClient` handles both and marks
  the result with `download: true`.
- Both files arrive **PRS-compressed**. The client decompresses them into one
  buffer in `decompress_received_quest_files` (PsoBB.exe `0x006d0174`) and then
  sets the quest-load state to 7 ("ready to start").
- The server names the files after **its own** quest number (`quest58.bin`),
  which is not always the number in the `.bin` header: `q058` ships with 105
  in its header.

### `.bin`: the script file

`PSOQuestHeaderBB` (newserv `QuestScript.hh`):

| Off | Field |
|---|---|
| 0000 | `u32 text_offset` — start of the bytecode |
| 0004 | `u32 label_table_offset` — start of the `u32` label table |
| 0008 | `u32 size` — total size of the three sections |
| 000C | `u16 unknown_a1` (0xFFFF), `u16 unknown_a2` (0xFFFF) |
| 0010 | `u16 quest_number` (0xFFFF for challenge quests), `u16 unknown_a6` |
| 0014 | `u8 episode` (0 = Ep1, 1 = Ep2, 2 = Ep4), `u8 max_players` (0 means 4), `u8 joinable`, `u8 unknown_a4` |
| 0018 | UTF-16 `name[0x20]` |
| 0058 | UTF-16 `short_description[0x80]` |
| 0158 | UTF-16 `long_description[0x120]` |
| 0398 | end of the header Qedit writes |
| 0398 | `u32 unknown_a5`; 039C `u16 solo_unlock_flags[8]` |
| 03AC | `FloorAssignment floor_assignments[0x10]` (8 bytes: `floor`, `area`, `type`, `layout_var`, `entities_var`, 3 unused; 0xFF = unused) |
| 042C | `CreateItemMaskEntry create_item_mask_entries[0x40]` (0x38 each) |
| 122C | end of the full header |

The extension past 0x398 only exists when `text_offset` and
`label_table_offset` both point past it. All 335 Blue Burst quest files newserv
ships carry it; the assembler fills `floor_assignments` with the immediates of
the first 16 `bb_map_designate` opcodes it emits.

The **label table** is one `u32` per label and a label's file offset is
`text_offset + table[label]`. **Label 0 is the quest entry point**:
`quest_start_thread(0)` (PsoBB.exe `0x006bc76c`), whose `QuestThread2`
constructor (`0x006bc800`) sets `pc = objcode_labels[label]` and marks the
thread dead when that entry is 0xFFFFFFFF.

**Bytecode**: one opcode byte, except that `0xF8` and `0xF9` introduce a
two-byte opcode (`(first << 8) | second`), which is the client's three
256-entry opcode spaces. Dispatch is a 772-entry table of
(`setup_func`, `opcode_func`) pairs (`.c:559261`): the setup shim reads the
inline argument bytes with `quest_read_objcode_{1,2,4}` and tail-calls the
body. `client/src/formats/questopcodes.ts` is generated from newserv's
602-entry `DEFAULT_OPCODE_DEFS` by `tools/gen-quest-opcodes.ts`; 528 of them
apply to BB.

Two argument sources, both live in the same VM:

- **Inline**: the setup shim reads the bytes listed in the table.
- **Arg stack**: an opcode flagged `F_ARGS` reads **no inline bytes at all**.
  Its arguments were pushed on `g_QuestOpcodeArgStack[8]` by the preceding
  `arg_push*` opcodes (0x48–0x4E, `.c:611281`–`.c:611345`):
  `arg_pushr r` pushes the register's **value**, `arg_pushl`/`b`/`w` the
  immediate, `arg_pusha r` the register's address, `arg_pusho l` the label.
  `opcode_setup_a` (`.c:602676`) clears the stack after the call. Register
  arguments of an `F_ARGS` opcode are therefore pushed as plain immediates
  holding the register number, which is what real quests do: newserv
  disassembles `arg_pushb 0x3C; set_player_start_position` as `r60-r63`.

Registers are `g_pQuestGlobalRegisters[256]` (every index masked with 0xFF);
the float opcodes (`flet`, `fadd`, …) reinterpret the same dwords. The call
stack is `quest_stack[]`, bounded in practice by the 376 bytes of local state a
`QuestThread2` keeps (about 94 dwords).

A `.bin`'s label table mixes code labels with data labels (strings, NPC stat
blocks, camera splines), so anything that walks the bytecode statically starts
at label 0 and follows the arguments whose data type is `SCRIPT`, and treats
the next label's offset as the end of a label's body.

### `.dat`: the quest's own set data

A stream of typed chunks, walked by `HandleQuestDat` (PsoBB.exe `0x006ba0da`,
`refsrc` `headers/quests.h`); cross-checked against newserv
`Map.hh MapFile::SectionHeader`:

```
00 u32 type          0 = end, 1 = objects, 2 = enemies, 3 = events,
                     4 = random enemy locations, 5 = random enemy definitions
04 u32 section_size  this chunk, including the 0x10 header
08 u32 floor         0..0x11
0C u32 data_size     payload size
10 payload[data_size]
```

The payloads are byte-for-byte what a free-play file holds: 0x44 per object and
0x48 per enemy (`formats/setdata.ts`), and the events payload is an `.evt` file
(`formats/events.ts`, header + entries + action stream, offsets relative to the
payload). Several chunks of the same type may name the same floor; the client
appends them in order and re-indexes the floor's lists
(`AssignMapObjectIds` `0x0080eda0`, `AssignEnemyIds` `0x0080ee4c`).

Over the 335 BB quest files newserv ships: 1146 floors, 119701 objects, 75405
enemies, 19094 wave events that resolve to enemies and 257 that only run an
action stream; 84 floors carry the type 4/5 random-enemy sections (which go
with the `evt2` event format and are **not** parsed here).

### Which floors come from the quest

`HandleQuestDat` takes a per-floor mode from the map designation set while the
quest's start label runs. `process_map_designate_v3_BB` (PsoBB.exe `.c:613155`;
the v2 form is `.c:613132`) writes `floor_map_designations[floor]` =
{`map`, `map_variant`, `objset`} and `g_QuestData8_00a95628[floor]` = the type:

| type | Meaning |
|---|---|
| 0 | the quest's own set data (the `.dat` chunks) on the designated map and variation |
| 1 | the **offline** free-play template of that map and variation |
| 2 | the **online** free-play template |
| 3 | nothing at all |

The geometry is always the designated map's:
`MapLoader_LoadAndSwapGeometry_00806fcc` reads `floor_map_designations[floor]`
and indexes the map's asset-prefix list with `map_variant`, which is the same
(area, layout, entities) lookup the free-play set data table does.

The three opcodes that set it:

| Opcode | Name | Arguments |
|---|---|---|
| `C4` | `map_designate` | `regsA[0]` = floor (and the area), `[1]` = type, `[2]` = major variation; the minor variation is zeroed |
| `F80D` | `map_designate_ex` | `regsA[0..4]` = floor, area, type, layout var, entities var |
| `F951` | `bb_map_designate` | the same five as immediates (`I8` each) |

`set_episode` (`F8BC`) resets every designation.

Running the start label of each of the 166 BB-English quests reproduces the
`floor_assignments` the assembler wrote into the header in **164** of them. The
two that differ are honest: `q035` designates floor 0 somewhere the start label
does not reach, and `q142` designates floors 5 and 7 twice, so the VM ends on
the later value while the header keeps the first.

### Floor handlers and the quest threads

`set_floor_handler` (0x95, `F_ARGS`: floor, label) stores the label in
`floor_handlers[floor]` (`set_floor_handler` at `.c:615036`, 0x12 entries,
0xFFFFFFFF = none). When the player arrives on a floor,
`quest_start_floor_thread` (`.c:615128`) builds a new `QuestThread2` at that
label. `clr_floor_handler` clears it. Every BB quest uses it: 1133 occurrences
across the 335 files.

`thread` (0x04) and `thread_stg` (0xB1) spawn a thread at a label too; each
thread has its own pc, call stack and arg stack, and runs until it yields
(`sync` = end of frame, `ret` on an empty stack, `exit`, or a message window).

### Quest flags, counters and switch flags

| Opcode | Name | Effect |
|---|---|---|
| `13`/`14`/`15` | `gset` / `gclear` / `grev` | set / clear / invert flag A; each sends `6x75` on BB |
| `16`/`17` | `glet` / `gget` | set flag A from a register / read it into one |
| `F925`/`F926` | `read_counter` / `write_counter` | quest counters 0–15 |
| `F82B`/`F82C` | `set_switch_flag_sync` / `clear_switch_flag_sync` | switch flag on a floor, **synced** with `6x05` |
| `90`/`91` | `switch_on` / `switch_off` | switch flag, deliberately **not** synced |
| `F82D`/`F82E` | `read_switch_flag` / `read_switch_flag_on_floor` | read one back |
| `D9`/`EF` | `sync_register` / `sync_register2` | write a register and send `6x77` |

- `6x75` `G_UpdateQuestFlag_V3_BB_6x75` (0x0C): `{75, 02, unused}`, `u16 flag`
  (< 0x400) @04, `u16 action` @06 (0 = set, 1 = clear), `u16 difficulty` @08,
  `u16 unused`.
- `6x6F` `G_SetQuestFlags_BB_6x6F` (0x208): the whole flag table, 0x200 bytes =
  4 difficulties × 0x80, **MSB-first** bits within each byte
  (newserv `PlayerSubordinates.hh` `FlagsTable<0x400, 4, Difficulty>`), then
  `u32 use_apply_mask` (the client always sends 1). Sent by the leader to a
  joining player.
- `6x77` `G_SyncQuestRegister_6x77` (0x0C): `u16 register_number` @04 (< 0x100),
  `u16 unused`, `u32 value` @08.

`net/game.ts` keeps the current difficulty's 0x80 bytes in `Game.questFlags`,
updates them from `6x75` and `6x6F`, and sends `6x75` when the VM sets one.

### Opcodes the VM runs

`client/src/quest/vm.ts` implements the opening set: control flow (`nop`,
`ret`, `sync`, `exit`, `thread`, `thread_stg`, `call`, `jmp`, `jmp_on/off`, the
sixteen `jmp*`/`ujmp*` comparisons, `switch_jmp`, `switch_call`, `va_start`,
`va_end`, `va_call`), the arg stack, registers and the stack (`let`, `leti`,
`letb`, `letw`, `leta`, `leto`, `set`, `clear`, `rev`, `stack_push*`,
`stack_pop*`, `sync_register`, `sync_register2`), integer and float arithmetic
(`add`…`xori`, `flet`…`fdivi`, `dec2float`, `float2dec`), quest flags, counters
and switch flags (above), the map designations, `set_episode`,
`set_floor_handler`, `clr_floor_handler`, `initial_floor`, `set_mainwarp`,
`clear_mainwarp`, `go_floor`, `override_warp_dest_floor`,
`restore_warp_dest_floor`, `set_ult_map`, `set_area_total`,
`set_current_area_number`, `set_area_title`, the message windows (`message`,
`window_msg`, `add_msg`, `message_end`, `window_msg_end`, `list`), the quest
board (`set_quest_board_handler`, `clear_quest_board_handler`, `disp_msg_qb`,
`close_msg_qb`), the completion callbacks (`set_qt_*` / `clr_qt_*`), NPC
creation (`npc_crp`, `npc_crptalk`, `npc_crp_id`, `npc_crptalk_id`,
`npc_crppk`, `npc_kill`, `npc_text`, `npc_text_id`), the coordinate handlers
(`at_coords_call`, `at_coords_talk`, `set_obj_param`),
`construct_delayed_object` / `construct_delayed_enemy`, and the state getters
(`get_client_id`, `get_difficulty_level_v1/v2`, `get_number_of_players`,
`get_players_present`, `get_player_room`, `get_coord_of_player`,
`get_player_state`, `get_player_hp_tp`, `p_dead`, `p_hpstat`, `chk_ene_num`,
`if_zone_clear`, `gettime`, `get_random`, `get_game_version`,
`dark_falz_is_dead`, `qexit`).

About 45 visual, audio, camera, HUD and input-lock opcodes (`fadein`, `bgm`,
`cam_*`, `hud_*`, `cine_*`, `p_action_disable`, …) are accepted as no-ops and
not reported.

**Not implemented** (decoded for their length, logged by name once, skipped).
Running the start label and every floor handler of the 166 BB-English quests
reaches these and nothing else:

| Cluster | Opcodes |
|---|---|
| Challenge mode | `cmode_stage`, `set_cmode_difficulty`, `set_cmode_base_time`, `set_cmode_rank_threshold`, `set_cmode_rank_result`, `set_cmode_grave_rates`, `set_cmode_char_template`, `cmode_check_any_player_dead`, `exp_multiplication`, `chl_create_retry_menu`, `chl_show_dead_player_list` |
| Battle Arena | `ba_initial_floor` and the rest of the `ba_*` family |
| Enemies | `set_override_enemy_bp_index`, `set_enemy_movement_data`, `set_enemy_physical_data`, `set_enemy_resist_data`, `toggle_freeze_enemies`, `unfreeze_enemies`, `animation_check`, `olga_flow_is_dead` |
| Items / player | `unequip_item`, `equip_item`, `item_create*`, `p_return_guild`, `pl_add_meseta2` |
| Misc | `enable_keyword_detect`, `npc_coords_call`, `shift_right`, `start_battlebgm` |

Nothing else is missing: the generated table covers all 528 BB opcodes, so an
unimplemented one still advances the program counter correctly.

### What the web client approximates

- The message windows, the choice list and the quest board are plain DOM
  overlays over the canvas, not the game's own text renderer. The `<rXX>`,
  `<fXX>`, `<cr>`, `<hero name>`, `<hero job>`, `<time>` and `<color X>` tokens
  are interpolated; the rest of the token list (`<pl_name>`, `<last_chat>`,
  `<team_name>`, …) is stripped, not resolved.
- `npc_crp*` records the NPC (position, angle, state, template, client id) and
  logs it; no NPC model is created and no `6x69` is sent.
- `set_player_start_position` is recorded but the player still spawns at the
  floor's `TObjPlayerSet`.
- `get_player_state` always reports "standing" for a player that is present:
  the web client does not model the action state machine.
- `playerHpTp` only answers for the local character.
- The random-enemy sections (types 4 and 5) and the `evt2` event format are
  recognised and skipped.

## BB cipher

Implemented in `client/src/net/bbcrypt.ts`, ported from newserv's `PSOBBEncryption`.

- **Key file `.nsk`** (0x1050 bytes): `initial_keys[0x48]`, `private_keys[0x1000]`, `subtype` (u64).
- **Supported subtype:** `STANDARD` (0). newserv accepts several keys and detects the one the client used by decrypting the first 8 bytes and comparing with `B4 00 93 00 00 00 00 00`.
- **Directions:** after `03`, S→C uses `BBCrypt(nsk, server_key)` and C→S uses `BBCrypt(nsk, client_key)`.
- **Seed:** each byte is XORed with `19 16 18` cyclically, followed by a Blowfish-style key schedule.
- **Stateless across 8-byte blocks**, so the header can be decrypted before the body.

## PRS

LZ77 with a bitwise control stream interleaved with the data stream. Implemented in `client/src/formats/prs.ts`; newserv's `Compression.cc` has the full commentary.

Not every `.prs` is plain PRS: `chatsensor.prs` is rejected by both newserv and the port, and the test checks this.

## GSL

Table of 0x30-byte entries (`name[0x20]`, `u32 page`, `u32 size`, `u64`), terminated by an empty name. Offsets are in 0x800-byte pages. Ephinea's `data.gsl` has 1524 files: map `.dat` (enemies/objects), `.bml`, `.xvm`, `.evt`, `.rel`, …

## AFS

`'AFS\0'`, `u32 count`, then `{u32 offset, u32 size}` per file.

## Where maps live in the client

- `data/scene/map_<area>n.rel`: render geometry
- `data/scene/map_<area>c.rel`: collision
- `data/scene/map_<area>.xvm`: textures
- `data.gsl` → `map_<area>_NNe.dat` / `o.dat`: enemy/object spawns (same format as Tethealla's `map/`)

## Map set data (`map_*e.dat` / `map_*o.dat`)

Free-play enemy (`e`) and object (`o`) spawns. Parsed by `client/src/formats/setdata.ts` (port of newserv `Map.hh`). A file is a bare array of entries with no header; its size must be a multiple of the entry size. Quest `.dat` files wrap the same entries in sections; not handled here.

| Off | ObjectSetEntry (0x44) | EnemySetEntry (0x48) |
|---|---|---|
| 00 | `u16 base_type` | `u16 base_type` |
| 02 | `u16 set_flags` (runtime) | `u16 set_flags` (runtime) |
| 04 | `u16 index` (runtime) | `u16 index` (runtime) |
| 06 | `u16 floor` | `u16 num_children` (0 = default for the type) |
| 08 | `u16 entity_id` (runtime) | `u16 floor` |
| 0A | `u16 group` | `u16 entity_id` (runtime) |
| 0C | `u16 room` | `u16 room` |
| 0E | `u16 unknown_a3` | `u16 wave_number` |
| 10 | `f32 pos[3]` | `u16 wave_number2`, `u16 unknown_a1` |
| 14 | | `f32 pos[3]` |
| 1C | `i32 angle[3]` (BAMS) | |
| 20 | | `i32 angle[3]` (BAMS) |
| 28 | `f32 param1..3`, `i32 param4..6` | |
| 2C | | `f32 param1..5`, then `i16 param6, param7` at 0x40 |
| 40 / 44 | `u32` client pointer | `u32` client pointer |

- **`room` is the n.rel section id** (`MapSection.id`, not the index), and `pos` is relative to that section. World position: rotate by the section angles about X, then Z, then Y, then add the section position (newserv `ChatCommands.cc`; note newserv passes the BAMS integers to `sin`/`cos` unconverted there). Checked: all 3366 rooms in newserv's `system/maps/room-layout-index.json` match the n.rel section positions, and only 1 of 63388 placed entities has no section (`map_lobby_green_be00o.dat`).
- Only two sections in the client have X/Z angles (crater, < 0.05 rad), so the rotation order barely matters in practice.
- Names: `base_type` maps to a client class name per area (`TObjEneBm5Wolf`, `TObjContainerItem`). The table is generated from newserv by `tools/gen-entity-names.ts`. The in-game enemy depends on params and area (e.g. `0x43` is Barbarous Wolf when `param2 >= 1`, else Savage Wolf; `0x44` is Booma/Gobooma/Gigobooma by `param6`); `enemyKind()` ports newserv's `add_enemy_and_children` switch (root enemy only, children are not expanded).

### File names and n.rel pairing

`map_<area>[_<layout>]_<entities>{e,o}[_s|_c1|_d].dat`. `_off` before `e`/`o` marks the offline (solo) set; `_s`, `_c1`, `_d` are mode-specific flavors in Pioneer 2 and the Lab.

| n.rel | set data |
|---|---|
| `map_forest01n.rel` (no layouts) | `map_forest01_NN{e,o}.dat`, `map_forest01_NN_offe.dat` |
| `map_cave01_LLn.rel` (layout `LL`) | `map_cave01_LL_NN{e,o}.dat` |
| `map_city00_00n.rel`, `map_boss01n.rel`, `map_lobby_01n.rel` | same stem: `map_city00_00e.dat`, `map_boss01e.dat`, `map_lobby_01o.dat` |
| `map_jungle01_00n.rel` (one geometry; `_00` is not a layout) | `map_jungle01_NN{e,o}.dat` |
| `map_darkfalz00n.rel` | `map_boss04{e,o}.dat` |
| `map_aforest01n.rel`, `map_acave01_00n.rel`, ... | the sets of the map without the `a` (every section of the plain map is present in the `a` map with the same transform) |

111 of 175 n.rel files get set data. None for: the extra layouts `_03`..`_05` of caves/mines/ruins, `jungle04_02`, `jungle06`/`07` (quest areas), `ruins`/`space`/`seabed` `_02`, `soccer`, `vs`, `test01`. Set files left over: `map_boss01uo.dat`, `map_boss05uo.dat`, `map_forest01_gjo.dat`, `map_lobby_soccer0Xo.dat`.

Loose files override `data.gsl`; in Ephinea's client 87 of the 114 loose set files that also exist inside `data.gsl` differ from the copy inside `data.gsl`.

## REL container

The last 0x20 bytes are the footer: `u32 relocations_offset`, `u32 num_relocations`, `u32[2]`, `u32 root_offset`, `u32[3]` (newserv `RELFileFooterT`). Pointers inside are file offsets, so they can be followed without relocating.

## Map render geometry (`map_*n.rel`, "fmt2")

Root (from the decomp's map loader, `headers/assets.h`):

| Off | Field |
|---|---|
| 00 | magic `fmt2` |
| 08 | `u16 section_count` |
| 10 | `u32 sections` |
| 14 | `u32 texture_list` (NJTL: `{u32 entries, u32 count}`, entry `{u32 name, u32 attr, u32 texaddr}`; same order as the `.xvm`) |

Section (0x34): `i32 id`, `f32 pos[3]`, `i32 rot[3]` (BAMS, 0x10000 = 360°), `f32 radius`, `u32 static_entries`, `u32 animated_entries`, `u32 static_count`, `u32 animated_count`, `u32 flags`. The client applies the section rotation with the `ZXY_ANG` order (Y, then X, then Z; three.js order `YXZ`); only two sections of `map_crater01_00n.rel` rotate about more than one axis.

Entries (layouts and flag meanings from the client's map draw loop `map_nrel_process_chunk_static_meshes` and its animated twin, checked against all 175 Ephinea `map_*n.rel`):

| Entry | Layout |
|---|---|
| Static (0x10) | `u32 object`, `u32 effect`, `u32 texture_anim`, `u32 flags` |
| Animated (0x20) | `u32 object`, `u32 motion` (`NJS_MOTION`), `u32`, `f32 frame`, `f32 frame_step`, `u32 effect`, `u32 texture_anim`, `u32 flags` |
| Indirect object (0x10) | `u32 object`, `u32 ind_tex` (runtime), `f32` (runtime), `i16 ind_id`, `u8`, `u8` |
| Effect slot (0x18) | `u16 id`, `u16 texture`, `f32 u, v` (accumulated), `f32 du, dv` (per frame), runtime hook pointer at +0x14 |
| Texture anim (0xC) | `i16 animation_id` (a `.tam` id), `i16`, `i16 texture_index`, `i16 frame_counter`, `i32 frame_delay` |

| Flag | Meaning |
|---|---|
| `0x1` | fog disabled while drawing |
| `0x10` | receives the projected player shadow |
| `0x20` | `effect` is set |
| `0x40` | `texture_anim` is set; the `.tam` file swaps the texture |
| `0x80` | indirect object drawn through a GameCube-only hook (a no-op on PC), so it is drawn plainly |
| `0x100` | drawn only into the planar-reflection texture (seabed, `boss06`), never in the normal pass |
| `0x200` | `object` points at an indirect-object record, whose first word is the `NJS_OBJECT` |
| `0x400` | with `0x200` and without `0x80`: only the GameCube hook runs, so the PC client draws nothing |
| `0x10000` | runtime visibility bit, also set in the file |

- **Indirect entries** (the old "flags `0x10224`" mystery): 639 entries in Episode 2 jungle/seabed and `boss06`. `ind_id` is a row of `map_<area>i.bin`, which holds indirect-texture (distortion) parameters for waterfalls and water. The client binds a distortion texture on stage 0 and the mesh texture on stage 1. The viewer draws the plain mesh. The `i.bin` layout is big-endian: `"ind0"`, `u32 count`, then 8-byte rows `{u16 id, u8 a, u8 b, u8 texture, u8[3]}`. Every `ind_id` in the maps has a row.
- **Not drawn on PC**: 1955 entries (`0x100`, `0x200|0x400` without `0x80`, and 27 animated entries without a motion). The parser keeps them in `MapSection.entries` with `rendered: false` and leaves them out of `objects`.
- **Animated entries**: each tick the client does `frame += frame_step` and wraps at `motion.frame_count - 1`. At load, `frame_step` is overwritten with a per-map value (0.2 in the files; 0.5 for lobbies with variant < 10).
- **`NJS_MOTION`** (0xC): `u32 mdata`, `u32 frame_count`, `u16 type`, `u16 inp_fn`.
  - `type` element bits, in storage order: 1 position, 2 angle, 4 scale, …, 0x2000 quaternion. The maps use 0x3, 0x7 and 0x2001.
  - `inp_fn`: the low nibble is the element count; 0x40 means spline interpolation.
  - `mdata` has one record per node of the object tree, in depth-first order: N key-list pointers followed by N key counts.
  - Keys are 0x10 bytes: `u32 frame`, then `f32[3]` (position/scale) or `i32[3]` BAMS (angle).
  - 11954 motions decode. They are not applied yet; entries render in bind pose.

## Handedness

No mirroring is needed. The client builds a right-handed view matrix (`make_lookat_matrix`: z = eye − target, x = up × z) and a right-handed projection (`create_d3d_projection_matrix`: `_34 = -1`, `_33 = zf/(zn-zf)`, i.e. `D3DXMatrixPerspectiveFovRH`). Its Ninja rotation matrices are standard counter-clockwise rotations. That is exactly three.js' convention, so map coordinates go to three.js unchanged.

Cross-check: rendered unmirrored in the viewer, the Pioneer 2 shop banners above the counters read left to right ("… SHOP", with the P's bowl on the right). The large `map_city00.xvm` sign boards (for example texture 40) read correctly from their open side; the side facing the wall is the mirrored one. The client sets `D3DCULL_NONE` for this pass, so the maps are drawn double-sided.

## Map collision (`map_*c.rel`)

Read by `MapLoader_LoadCollision` → `copy_map_collision_data` in the client; parser in `client/src/formats/crel.ts`, queries in `client/src/render/collision.ts`. All 175 files in Ephinea's `data/scene` parse (15847 meshes, 966528 faces). Coordinates are world space (no room transform).

REL root → `u32` pointer to an array of mesh containers (0x18), terminated by a null `mesh`:

| Off | Field |
|---|---|
| 00 | `u32 mesh` → mesh header |
| 04 | `f32 x, y, z` bounding circle center (only x/z used) |
| 10 | `f32 radius` (XZ) |
| 14 | `u32 flags`: a query skips the mesh unless `flags & mask`; `0x40000000` = never ground |

Mesh header (0x10): `u32 vertex_count` (unused by the client), `u32 vertices` (`f32[3]`), `u32 face_count`, `u32 faces`.

Face (0x24): `u16 v0, v1, v2`, `u16 flags`, `f32 normal[3]`, `f32 center[3]`, `f32 radius` (XZ bounding circle).

Face flags, from the masks the client passes:

| Bit | Meaning |
|---|---|
| `0x0001` | floor (most ground) |
| `0x0002` / `0x0004` / `0x0008` / `0x0010` | shallow water / deep water / footprints / grass ground types; not ground by themselves (ground needs `flags & mask & 0xFFE1`) |
| `0x0020`, `0x0080`, `0x0800`, `0x2000` | walls for players (mask `0x28A0`) |
| `0x0040` | also ground for players (mask `0x5F`) |
| `0x0100` | mostly paired with `0x01`/`0x20`; meaning unknown |
| `0x4000` | used by some enemy ground queries |
| `0x8000` | camera collision (the only bit tested by the 0x8000 ray) |

Queries (constants read from `PsoBB.exe`):

- **Ground** (`unknown_geometry_raycast`): faces with `ny >= -1e-4`, the point inside the triangle in XZ (edge products `>= 1e-5`) and at least one vertex at or below the probe height. The highest such plane wins, so a slightly higher step still counts. Players query from `y + bloodstain_z_offset` with mask `0x5F` (`play_footstep_effects`); generic objects use `0x16EF`.
- **Walls** (`line_segment_intersects_triangle`): one-sided. The segment must go against the normal (`d·n < -1e-5`), start in front (`> 1e-5`), and cross the triangle with `t` in [0, 1]. Players cast them 5 units above the feet. First a ray along the motion (`|v| + radius`): if `dot(dir, n) <= -0.87` the player stops, otherwise it slides. Then 8 rays of hitbox radius at 45° steps push it out of walls.

## Player spawn points (`map_*o.dat`)

Object set files in `data.gsl` are bare arrays of 0x44-byte `ObjectSetEntry` records (newserv `Map.hh`): `u16 type` @0, `u16 floor` @6, `u16 room` @0xC, `f32 pos[3]` @0x10 (relative to the n.rel section whose id is `room`), `i32 angle[3]` @0x1C (BAMS), `f32 param1..3` @0x28, `i32 param4..6` @0x34.

Type `0x0000` is `TObjPlayerSet`: `param1` = client id, `param4` = source (0 = coming from a lower floor, 1 = returning from a higher floor). Each `map_lobby_NNo.dat` has 12 of them, one per client id 0–11, all in room 1 (at the origin):

| Client ids | Positions (x, z), y = 20 | Facing |
|---|---|---|
| 0–3 | (0, 135), (-20, 145), (20, 145), (0, 165) | 0x8000 (toward -Z) |
| 4–7 | (85, 50), (95, 70), (95, 30), (115, 50) | 0xC000 |
| 8–11 | (-85, 50), (-95, 30), (-95, 70), (-115, 50) | 0x4000 |

The angle uses the client's convention (direction = `(sin a, cos a)`). The web client spawns each player on the set matching its `client_id` from `67`/`68`.

## Ninja object / XJ model

- `NJS_OBJECT` (0x34): `u32 eval_flags`, `u32 model`, `f32 pos[3]`, `i32 ang[3]` (BAMS), `f32 scale[3]`, `u32 child`, `u32 sibling`. Rotation order X→Y→Z (`ZYX` in three.js), or Y→X→Z with `EVAL_ZXY_ANG` (0x20).
- XJ model (0x2C): `u32 flags`, `u32 vertex_info`, `u32 vertex_info_count`, `u32 opaque_strips`, `u32 opaque_count`, `u32 alpha_strips`, `u32 alpha_count`, `f32 center[3]`, `f32 radius`.
- Vertex info (0x10): `u32 type`, `u32 vertices`, `u32 stride`, `u32 count`. Layouts seen in maps:

  | type | stride | layout |
  |---|---|---|
  | 4 | 16 | position, D3DCOLOR |
  | 5 (also 0x10005) | 24 | position, D3DCOLOR, uv |
  | 7 | 36 | position, normal, D3DCOLOR, uv |

- Strip list entry (0x14): `u32 materials`, `u32 material_count`, `u32 indices`, `u32 index_count`, `u32`. Indices are u16 triangle strips (the client draws them with `D3DPT_TRIANGLESTRIP`).
- Material (0x10): `u32 type`, `u32 arg1`, `u32 arg2`, `u32 arg3`. These are sticky render-state changes; the type indexes the client's 9-entry `g_StandardRenderStateSetters` (read from `PsoBB.exe` at `0xa218c0`):

  | type | setter | args |
  |---|---|---|
  | 0, 1 | no-op | |
  | 2 | blend | `src`, `dst`: index into the D3D enum table at `0xa21944`, offset by 3 (0 zero, 1 one, 2 src color, 3 inv src color, 4 src alpha, 5 inv src alpha, 6 dst alpha, 7 inv dst alpha) |
  | 3 | texture | texture id (NJTL / `.xvm` order) |
  | 4 | texture addressing | U, V, read directly from the same table, which starts `[3, 2, 1, 1, …]`: **0 clamp, 1 mirror, 2 wrap, 3 wrap**. The map data agrees: UVs stay in [0, 1] for 98–100% of mode-0/3 strips and leave it for 97–99% of mode-1/2 strips. Every map strip sets a mode, so the default does not matter. |
  | 5 | material color | `arg1` ambient, `arg2` diffuse, D3DCOLOR (bytes B, G, R, A). In the normal pass only the diffuse is used, as the constant vertex color of meshes without vertex colors. Never used in maps. |
  | 6 | lighting | bool |
  | 7 | texture-coordinate generation | bool. Camera-space generated UVs (environment map), used 1295 times, mostly in Ruins. Not rendered yet. |
  | 8 | material color source | diffuse/ambient source (not seen in maps) |

## XVM textures

- `XVMH`: `u32 header_size`, `u32 count`, …; chunks start at `header_size + 8`.
- `XVRT` chunk: `u32 size` (bytes after this field), `+0x08 u32 flags` (bit 0 mipmaps, bit 1 alpha), `+0x0C u32 format`, `+0x10 u32 global index`, `+0x14 u16 width`, `+0x16 u16 height`, `+0x18 u32 data size`, pixels at `+0x40`.
- Formats found in Ephinea's `scene/*.xvm` (7821 textures): 6 = DXT1 (most), 7 = DXT3, 2 = R5G6B5, 3 = 16-bit with alpha. Uncompressed formats are Xbox-swizzled (Morton order).
- Map textures: `map_city00_00n.rel` → `map_city00.xvm`.

## Player character models

Files (loose in `data/`, not in `data.gsl`): `pl<L>nj.bml` (models), `pl<L>tex.afs` (textures), with `<L>` = `A`..`L` for class 0..11 (HUmar .. RAmarl). `O`..`Y` are extra NPC-style models. The loose `pl<L>bdy00.nj` etc. are byte-identical to the BML entries for `A`..`L`. `pl<L>smp.rel` holds the 7 proportion shapes as a REL for the character select/creation screen (`FUN_004e9a68`, `FUN_004e7a64`; not decoded here, `plZsmpnj.afs` has the same shapes). Player motions are in `data.gsl` → `plymotiondata.rlc` (not decoded yet).

Files (loose in `data/`, not in `data.gsl`): `pl<L>nj.bml` (models), `pl<L>tex.afs` (textures), with `<L>` = `A`..`L` for class 0..11 (HUmar .. RAmarl). `O`..`Y` are extra NPC-style models. The loose `pl<L>bdy00.nj` etc. are byte-identical to the BML entries for `A`..`L`. `pl<L>smp.rel` is a separate low-poly model with motions (not decoded). Player motions are in `data.gsl` → `plymotiondata.rlc` (see *Player motions* below).

### BML (`formats/bml.ts`)

Header 0x40: `u32`, `u32 count`, `u32` (0x150), …. Entries of 0x40 follow: `name[0x20]`, `u32 compressed_size` @+0x20, `u32 decompressed_size` @+0x28, `u32 compressed_texture_size` @+0x2C, `u32 decompressed_texture_size` @+0x30. Data starts at the next 0x800 boundary; each entry is PRS data followed by an optional PRS-compressed XVM. Blobs are aligned to 0x800 in `pl?nj.bml` but to 0x20 in e.g. `bm_ene_*.bml`; the reader uses 0x800 when everything fits, else 0x20.

### Ninja chunk model (`formats/njcm.ts`)

IFF chunks `{tag[4], u32 size}`: `NJTL`, `NJCM`, `POF0`, `NMDM`. Pointers are offsets from the chunk's data. The `NJCM` data starts with the root `NJS_OBJECT` (same 0x34 layout as XJ); its model is `NJS_CNK_MODEL` = `u32 vlist, u32 plist, f32 center[3], f32 radius`.

- **Vertex chunks:** `u8 type, u8 flags, u16 size` (u32 words), `u16 index_offset, u16 count`. Types 32..50; the player files use 41 (position + normal) and 44 (position + normal + Ninja flags). Ninja flags: low 16 bits = vertex index (+ `index_offset`), high 16 bits = weight/255. `flags & 3`: 0 = first weight (overwrite), 1 = middle, 2 = last (add). Seen flag values: 0x00, 0x80, 0x81, 0x82.
- **Polygon chunks:** `u8 type, u8 flags`. 1 blend (`flags` bits 3-5 src, 0-2 dst), 4 **cache** list `flags` (rest of the list is stored), 5 **draw** cached list, 8/9 texture (`u16`: bits 0-12 id; `flags` 0x80/0x40 flip U/V, 0x20/0x10 clamp U/V), 16..31 material (`u16 size` in u16 words; diffuse/ambient/specular BGRA by type bits 0/1/2), 64..75 strips (`u16 size`, `u16` count + user-offset words; per strip `i16 len` (negative = reversed), per vertex `u16 index`, then uv `i16 u,v` (65: /255, 66: /1023), …). Strip flags: 0x01 no lighting, 0x08 alpha, 0x10 double-sided, 0x40 env map. Type 89 (unknown, has a size field) appears in `plO..Rbdy00.nj` and is skipped.
- **Evaluation:** walking the tree, every node writes its transformed vertices into one vertex buffer shared by the whole tree; strips index that buffer. The body caches its main polygon list at the root and draws it at a later node, after the weighted vertices have been completed. `render/njcmmesh.ts` replays this in the bind pose and turns the writers of each vertex into skin weights; every strip of all 12 classes resolves.

### Assembly and textures (`render/playermodel.ts`, from `PsoBB.exe`)

Per-class appearance record, `0x009b5b60 + 0x2c * class` (generated into `render/playertables.ts` by `tools/gen-player-tables.py`):

| Offset | Type | Content |
|---|---|---|
| +0x00 | `i16[5]` | limits: costume, skin, face, head, hair (humans 18/4/5/0/10, androids 0/25/0/5/0; 0 = must be 0). `FUN_004e665c` resets an out-of-range value to 0 (not wrap), section ID −1 → 0, other invalid → id % 10, hair RGB outside 0..255 → 0. |
| +0x10 | `char**` | hair models `pl<L>haiNN.nj` [hair] |
| +0x14 | `char**` | cap models `pl<L>capNN.nj` [hair] (NULL entries; HUmar only `cap06`) |
| +0x18 | `char**` | head models `pl<L>hedNN.nj` [head] |
| +0x1c | `char*` | `pl<L>bdy00.nj` |
| +0x20 | `TEXLIST*[hair]` | hair texture name lists (hai and cap draw with it) |
| +0x24 | `TEXLIST*[head]` | head texture name lists |
| +0x28 | `TEXLIST*` | body texture name list |

`TEXLIST = { char** names, u32 count }`. `0x009b59e0 + 0x10 * class`: `{ u32 file id, u32 count, "PL<L>TEX.AFS", char** names }`; `names[i]` is the name of entry `i` of `pl<L>tex.afs` (sorted).

- **Texture lists** (`FUN_004e6920`): each template name `pxt<L><type>_<NN><v>_...` is copied and edited: type `b`/`t` with NN ≠ `00` → NN = costume+1 (if costume limit > 0); type `b`/`f`/`t` with v ≠ `z` → v = `a`+skin (if skin limit > 0); type `f` with N[1] ≠ `0` → N[1] = `1`+face; type `c` (emblem) → v = `a`+section ID, or `z` (empty ring) if invalid. The name is binary-searched in the class's name table (`FUN_004ed735`) to get the AFS entry (not found → entry 0). Texture id N of a part is entry N of its list. Every name these rules can produce exists, and every AFS entry is reachable except `pxtKb_01z_t_hair1/2` (FOmar).
- **Attachment** (`FUN_0068a088`): the head draws with the node matrix at +0xe80 (**node 58**) and the head list; the cap with +0xec0 (**node 59**) and the hair list; the hair with node 59, the hair list and the hair color (`FUN_004e70c4`, RGB/255 as material color). Nodes 58 and 59 have the same bind pose.

### Proportions (`proportion_x`, `proportion_y`)

Not a scale: the body and head are **morphed** between 7 shapes per class from `plZsmpnj.afs` (file id 0xdf). Entry = `SMP_BASE[class] + SMP_COUNT[class] * shape + k` (`0x009b8ea0`, `0x009b8e40`): `k` = head index for the head, `SMP_COUNT − 1` for the body (humans 2 per shape, androids 6). Each entry is an NJ file (NJTL + NJCM) with the node and vertex chunk layout of `pl<L>bdy00.nj` / `pl<L>hedNN.nj`.

- `FUN_004e686c`: unless `0 ≤ x < 1` and `0 ≤ y < 1`, both become 0.
- 9 points (`0x009b1680`, x of points 1, 2, 3, 5, 6 set by `FUN_004e9690`): P0 (0,0), P1 (⅓,0), P2 (⅔,0), P3 (⅓,½), P4 (0,1), P5 (⅓,1), P6 (⅔,1), P7 (1,1), P8 (1,0). Point 7 uses shape 4, point 8 shape 0.
- 8 triangles (`0x009b16e0`, `[a,b,c]`): [1,3,0] [0,4,3] [3,5,4] [1,3,2] [2,6,3] [3,5,6] [2,6,7] [8,7,2]. `FUN_004e877c`: x > ⅔ → 6 if 3(x−⅔) ≤ y else 7; x ≤ ⅓ → 0 if ⅔y ≤ x, else 1 if x ≤ ⅔(1−y), else 2; otherwise 3 if x ≤ ⅔(1−y), else 4 if ⅔y ≤ x, else 5.
- Weights (`FUN_004e86e4`): `wc = (x − a.x)/(c.x − a.x)`, `wb = (y − a.y − wc (c.y − a.y))/(b.y − a.y)`, `wa = 1 − wb − wc`.
- Blend (`FUN_004e7e54`, nodes in depth-first order, flags from `FUN_007aaefc`): model center; position if any shape has `!UNIT_POS` (clears the flag); body only: scale if any has `!UNIT_SCL`; vertex chunks 41/44 (`FUN_004e838c`): position, normal (renormalized), Ninja-flags weight `round(Σ w·hi16)`. The head loop blends vertices when shape `a` has a vertex list.
- In game the 3 shapes are loaded per player by `FUN_004ee448` and blended by `FUN_004ee534`; character creation does the same (`FUN_00603ce0`). The `pl<L>nj.bml` body equals shape 3 (P3) only approximately.

- `pl<L>bdy00.nj`: 64 nodes. Head (`hed00`, androids `hed00..04`), hair (`hai00..09`) and cap (`capNN`, drawn with hair style NN) attach to **body node 59** (depth-first index). Hair and cap NN share one texture list.
- `pl<L>tex.afs`: one `XVRT` per entry. Texture ids are per part; the game maps them to AFS entries from the appearance. Layout found:
  - humans/newmans: 18 costume blocks (3 to 26 entries; some hold 4 skin variants), ears ×4 skins, faces 5×4 (`base + 4*face + skin`; HUmar/RAmar interleave face/ear pairs), hair, skin and/or costume swatches, 11 emblems.
  - androids: 25 skin blocks of 5 (entries 3–4 are `hed00`'s for HUcast/RAcaseal/HUcaseal), one group of 25×k per other head, skin swatches, 11 emblems.
  - The last 11 entries are the section ID emblems (Viridia..Whitill, then an empty ring). Body texture id 0 is the emblem.
- The per-class tables are in `playermodel.ts`. The default appearance of all 12 classes looks right. Hair/cap textures of the hat-wearing classes and non-default android heads are best guesses.

## Player motions (`plymotiondata.rlc`)

Code: `formats/prc.ts`, `formats/rlc.ts`, `formats/njmotion.ts`, `formats/plymotion.ts`, `render/playeranim.ts`. Test: `tests/motions.test.ts`.

**RelChunk container** (`RelChunkVer0.20`, header **big-endian**): `char magic[0x10]`, `u32 count` @0x10 (572), `u32 table_offset` @0x14 (0x20), `u32 data_offset` @0x18 (0x1200), `u32 0`; then `count` × `{u32 offset, u32 size}`, entries 0x20-aligned. The client copies the table into a 0x12E0-byte buffer (≤ 600 entries, `FUN_006a7af4`).

**PRC entries** (little-endian): `u32 decompressed_size`, `u32 seed`, then PRS data XORed with the PSO V2 stream cipher seeded with `seed` (newserv `decrypt_pr2_data`). Each decompresses to a REL (footer as in maps) whose root points to `{u32 0, NJS_MOTION*}`.

**NJS_MOTION** in all 572 entries: 64 nodes (the `pl?bdy00.nj` skeleton, depth-first), `type` 3 (position + angle), `inp_fn` 2 (linear). Position keys are 0x10 (`u32 frame, f32 x, y, z`). Angle keys are **8 bytes**: `u16 frame, i16 x, y, z` (16-bit BAMS, `NJS_MKEY_SA`), unlike the 16-byte `i32` angle keys of map motions; the header does not say which. The key lists of each motion tile the file from offset 0 up to the mdata table, so a list at offset 0 has a 0 pointer: a list exists when its count is non-zero. Keys run from frame 0 to `frame_count - 1` (9150 of 9153 angle tracks). Entry 20, node 42 claims more keys than it has (the list runs into the next one); the decoder stops at the first frame that goes backwards. Angles that cross ±180° between keys are interpolated the short way (16-bit arithmetic); otherwise limbs would spin.

**Motion sets** (Ghidra, Ephinea `PsoBB.exe`):
- `FUN_006875a0` sets the motion type from the class (switch at `0x0093c584`): 0 male (HUmar, HUcast, RAmar, RAcast, FOnewm), 1 female (HUnewearl, RAcaseal, FOnewearl), 2 FOmarl, 3 FOmar, 4 HUcaseal, 5 RAmarl.
- Town/lobby (`DAT_00a943cc == 0`, set back by `FUN_006a7748` when leaving a game; games set 1): motion set object with vtable `0x00b3a040`. Types 1, 2, 4, 5 use set 1, types 0, 3 set 0 (`FUN_006a7508`). Tables: `0x009cc08c` → records, `0x009cc094` → rlc indices, `[set][weapon 0..18][slot 0..55]` (all weapon columns identical).
- Record (0x10): `u16 mode, u16 next_slot, u32 slot, f32 speed, u32 flags`. Modes: 1 loop, 2 play then go to `next_slot`, 3 play once and hold.
- Idle / walk / run = vtable `+0x54` / `+0x50` / `+0x70` = slots 0 / 1 / 2, or 3 / 4 / 5 for type 2 (FOmarl). Set 0: entries 201 / 200 / 207 (speed 0.9 / 1.4 / 0.8); set 1: 335 / 412 / 416 (1.0 / 1.0 / 0.8); FOmarl: 487 / 506 / 508.
- Field: vtable `0x00b39ec0`, tables `0x009cbeec` (records) and `0x009cbf04` (indices), `[type 0..5][weapon 0..18][slot 0..71]` (not used yet).

**Playback** (`FUN_007aa4c8` start, `FUN_007aa094` tick, `FUN_007a9a6c` change): `frame += step` per game tick (30/s assumed), `step` = record speed; the walk state (`FUN_006a1ef0`) and run state (`FUN_006a1898`) multiply it by 1.0 (`DAT_00a94300`) and 1.5 (`DAT_00a94324`) (`FUN_006978a0`; ×0.5 / ×0.75 in slowed states). Mode 1 wraps at `frame_count`; modes 2/3 end at `frame_count - 1`. A motion change cross-fades from the current pose at 0.2 per tick (`DAT_0097d970`, 5 ticks) and restarts the new motion at frame 0, unless the new record has flag `0x80000000` or the old one `0x40000000`.

## Items on the floor, pickup and the item commands

Code: `net/items.ts` (commands and inventory), `formats/itemmodels.ts` (which model a dropped item uses), `render/flooritems.ts` (floor layer, Enter to pick up / break a box), `ui/inventoryPanel.ts` (buttons). Tests: `tests/itemmodels.test.ts`, `tests/items.live.ts`. Command layouts are newserv's `CommandFormats.hh`; addresses are VAs in the Ephinea `PsoBB.exe`.

**Who owns the items.** On Blue Burst the server does. The client only asks:

| Direction | Command | Meaning |
| --- | --- | --- |
| S→C | `6x5F` (0x2C) | drop from a box or an enemy: `{floor, source (1 enemy / 2 box), entity index, x, z, room, drop number, ItemData}` |
| S→C | `6x5D` (0x28) | drop of meseta or of a split stack: `{floor, room, x, z, ItemData}` |
| C→S | `6x5A` (0x0C) | pickup request `{item id, floor}` |
| S→C | `6x59` (0x0C) | pickup granted `{picker, floor, item id}`, to every player including the picker |
| C→S | `6x2A` (0x18) | drop a whole item `{amount, floor, item id, x, y, z}` (forwarded to the others, not echoed) |
| C→S | `6xC3` (0x18) | drop part of a stack or meseta `{floor, x, z, item id, amount}`; item id `0xFFFFFFFF` = meseta |
| C→S | `6x29` (0x0C) | delete from the inventory `{item id, amount}` — the client sends it after the server's `6x5D` for its own split |
| C→S | `6x25` / `6x26` / `6x27` | equip `{item id, slot}` / unequip `{item id}` / use `{item id}` |
| S→C | `6xBE` (0x1C) | create an item in a player's inventory (bank, shop, tekker, unwrapped present) |
| S→C | `6x63` (0x0C) | destroy a floor item |
| C→S | `6x0B` (0x0C) + `6xA2` (0x28) | a box was broken: object state `{entity 0x4000+index, flags 1, index}` via `60`, then the drop request via `62` to the leader |
| S→C | `6x6D` | item state for a joining player: BC0-compressed `{u16 next drop number[16], u32 next item id[12], u32 item count[15], FloorItem[]}` (`FloorItem` is 0x24 bytes, same layout as inside `6x5F`) |

**Item ids.** newserv (`Lobby::reset_next_item_ids`) gives player *n* the range starting at `0x00010000 + 0x00200000 * n` and assigns the ids of the inventory in slot order: the creator of a game takes them at `64`, a joiner takes the ids the `6x6D` announces. Server drops use `0x00810000` and above.

**Pickup rules** (newserv `on_pick_up_item_generic`): the item must still exist, be visible to that player, be within a distance of 30 (`dist² ≤ 900`) and fit in the inventory; otherwise the request is dropped and the item stays on the floor.

**Box drop request.** `6xA2` extends `6x60` with the box's `param3..6`. `ignore_def` says whether the box has a fixed drop: `TObjContainerBase` (0x92), `TOContainerAncientItemCommon` (0x161) and `TObjContainerJungEx` (0x203) specialize when `param1 <= 0`, `__DESERT_CRYSTALS_BOX__` (0x38D) when `(int)param1 == 2`; every other box ignores its params. newserv reads the params from its own map, so a wrong value only logs a warning. Capture (`tests/GC-ForestGameRareMagFeed.test.txt`): `62 00 2C 00 A2 0A 00 00 01 30 7C 00 …` — `6x0B` for K-078 first, then `6xA2` with `rt_index 0x30`, the object index and the area.

**Floor item models** (`formats/itemmodels.ts`). The dropped item is one of the small boxes in `item.bml`, not the item's own model (`ItemModel.afs` holds the held/equipped weapon models):

- `FUN_005d7ccc` loads `item.bml` with the descriptor at `0x009c2794` = {`item.bml`, 14 models, 1 motion}. Entries by position: 0 `gun_bullet.xj` (its XVM carries every `ixt_box*` texture), 1 `armor_scan.xj`, 2..7 `ixm_box01..06`, 8 `ixm_box07_gift`, 9 `ixm_box08_xmas`, 10 `ixm_box09_egg`, 11 `ixm_box10_pumpkin`, 12 `ixm_box11_flower`, 13 `wxmR04_d_t_efect.xj`, then `armor_scan.njm`.
- `FUN_005d7a2c(kind)` returns model `kind + 2` with texture list 0 (`gun_bullet`'s).
- Floor item object: ctor `FUN_005c3a94` (vtable `0x00b0c020`), `+0xf5` = box kind, `+0xf0` = present colour, `+0xdc` flags (0x100 kill counter, 0x400 wrapped).
  - colour `FUN_005d68b4`: weapon `data1[5] & 0xF`, armor/shield/unit `data1[4] & 0xF`, tool `data1[3] & 0xF`, else 0.
  - kind: rare (`FUN_005d6990`: `FUN_005d693c(item) >= 9`) → 4, else the byte table `0x0092bb88[clamp(data1[0], 0, 4)]` = {0, 1, 1, 2, 3} (weapon → box01, armor/shield/unit and mag → box02, tool → box03, meseta → box04). `FUN_005d693c` is the same rarity test as the item names: ItemPMT stars for weapons and armors (`FUN_005e5450`, ids from 0xB1), tool flag 0x80, mag `data1[1] > 0x27`.
  - tools (subclass `FUN_005de2d8`): when the ItemPMT tool's `type` is not 0 the kind becomes `type + 4` (`FUN_005c3e3c`), which clamps kinds ≥ 11 back to box03 and forces colour 5 for kind 7. In the BB table that gives the event boxes: type 1 (the 29 "item" tools) → kind 5, type 2 → 6, 3 → 7, 4 → 8 (egg), 5 → 9 (pumpkin).
  - wrapped (`FUN_005d281c`: weapon/armor `data1[4] & 0x40`, non-stackable tool `data1[3] & 0x40`, mag `data2[2] & 0x40`) sets flag 0x400.
- Render `FUN_005c407c` (state 0 only) indexes the table `0x0092bac0` by kind, and flag 0x400 forces entry 6. Entries 0-4 and 8-10 (`FUN_005c37c4`) draw the kind's model; 5 (`FUN_005c39a0`) adds a texture scroll (`FUN_005cb350(1, 1, 0xb)`, step `1/256` = `0x0092bd9c` per frame); 6 and 7 (`FUN_005c383c`) draw the gift box whatever the kind, the root tinted with `0x009c2000[colour]` and its child with `0x009c2060[colour]` (6 colours each).
- Update `FUN_005c4010`: the Y angle (`+0x60`) turns `0x200` BAMS per frame (30 frames/s). No bobbing and no separate glow pass are in the floor item code; the "glow" of a rare drop is box05's scrolling texture.

**Not from the exe (fitted):** the height of a floor item (the drop commands carry only x and z, so the box is placed on the collision mesh under that point), the Enter radius for pickup (15) and for breaking a box (20), and the assumption that the scroll counter advances once per frame.

## Enemy models (`bm_ene_*.bml`, boss archives)

Code: `formats/enemymodels.ts` (table), `render/enemymodel.ts` (loader, animator), `render/enemyview.ts` (floor layer). Test: `tests/enemies.test.ts`. Addresses are VAs in the Ephinea `PsoBB.exe`.

**Type → constructor.** `0x009fba60` holds one pointer per area (47, newserv area numbers) to a list of 0x10-byte rows `{u32 set type, u32 factory, f32 distance², u32 child count}` ended by type `0xFFFF`. The factory allocates the object and runs the constructor (e.g. Forest 1: `0x44` Booma → `0x00535e50`, `0x41` Rappy → `0x00526cc4`, `0x42` Monest → `0x00519144`, `0x43` Wolf → `0x0051b26c`). Types without a row (e.g. type 0 in a few Episode 2 files) construct nothing.

**Asset descriptors.** Each enemy class has a loader (per-area lists such as `0x009fc420`, pairs of load/unload functions) that loads one archive through a descriptor `{char *bml; char **models; char **motions; u16 model_count; u16 motion_count}` (e.g. Shark `0x009bb3f4`: `bm_ene_bm1_shark.bml`, 3 models, 12 motions). `TBinModel` (`FUN_005b7a84`) reads the archive entries **by position**: the first `model_count` entries become the model array (`+0x42C`, 0x10 bytes: `+8` NJCM object, `+0xC` texture list, textures from the XVM attached to the entry), the next `motion_count` the motion array (`+0x430`, 8 bytes: `+4` NJS_MOTION). The names in the descriptor are not used (`bm4_ps_ma_body.bml` stores its motions in another order; Dubchic's motion files are named `*_me2_me2.njm`, the descriptor says `*_me2_y_me2.njm`). Header byte 9 ≠ 0 means 0x20-byte blob alignment (else 0x800); byte 8 `'P'` marks compressed entries.

**Variants.**
- Ultimate: `FUN_00520e6c` = online flag `DAT_009f9860` and difficulty `DAT_00a9cd68 == 3` (offline difficulty is capped at 2, `FUN_0077b2a8`). Loaders then pass another archive name with the same descriptor (`FUN_0051f674`): `*_a.bml` (`*_ap.bml` for Vol Opt and the rappies).
- Low detail: Episode 2 loaders load their own `*_low.bml` descriptor when `FUN_00482a20()` (`DAT_00a46c64`, a graphics option set in `FUN_00482ca0`) is 0.
- Rappy: archive from `0x009bbbc0[episode·8 + season·2 + ultimate]`, season from the lobby event (1 → Christmas `_xs`, 4 → Easter `_es`, 5 → Halloween `_hw`); Episode 4 always `bm_ene_sandlappy.bml` (`lappy_*4.bml` are not referenced). Rare (param6 & 1): Episode 1 draws model 0 with `re3_b_lappy_base_ao.xvm` (Ultimate `_niji`), Episode 2 and 4 model 1.
- Texture swaps: Gillchic draws with `me2_y_me2_z.xvm`; Sinow Gold / Spigell / Zele use a texture list copy with ids 0–2 → 3–5; Mericus/Merikle ids 0–2 → 3–5 / 6–8 (`FUN_00573100`); Monest, Barbarous Wolf and Canadine draw a model with another entry's texture list.
- Del Lily (area 0x23) loads `bm_ene_dkflower.bml` with the Poison Lily descriptor.

**Constructor.** set_params (vtable `+0x14C`, `FUN_00786848` for most) stores param1..5 at `+0x35C..+0x36C`, param6 at `+0x370`, param7 at `+0x374`. The constructor picks model entry *i* (`obj+0x34`, texture list `obj+0x24`), sets the motion table (`obj+0xD8`) and starts a slot with `FUN_007aa4c8`. Motion table rows are the player motion records (`u16 mode, u16 next, u32 motion index, f32 speed, u32 flags`); a few tables get their speeds from static initialisers (Rappy `0x00527890`, De Rol Le `0x00434340`, Barba Ray `0x004b9bd8`). Per-type model and idle rules, with addresses, are in `formats/enemymodels.ts`; examples: Booma family param6 0/1/2 → models 0/2/1; sharks → 2/0/1; Dimenian → 2 − param6; Hildebear param6 ≥ 1 → model 2 (Hildeblue) else 1.

**Motion data** (`.njm`, NMDM chunk): angle keys are 16-bit (`NJS_MKEY_SA`, 8 bytes) in every enemy motion; Episode 4 motions use quaternion keys (type `0x2000`, 0x14 bytes: `u32 frame, f32 w, x, y, z`) instead of angles. Motions with element type 7 also carry scale keys.

### Child objects

Several enemies are more than one object: the constructor creates child entities with their own model entry, archive or place in the arena. `EnemyPartSpec` carries one child (`model`, `motion`, `texlistOf`, `archive`, `place`, `offset`, `yaw`, `hidden`); a child the fight spawns later is built but not drawn (`hidden`).

| Enemy | Children |
|---|---|
| Chaos Sorcerer `0xA1` | 2 bits (newserv `BEE_R` / `BEE_L`): model entry 1 (`re4_b_bit.nj`) with model 0's texture list (`init_sorcererbee_global_config` caches `model_files[1].njcm` and `model_files[0].njtl`, stat init `0x0059AE6C`), at ±15.0 (`0x00929948`) along `(cos yaw, −sin yaw)` and 18.0 (`0x00929944`) above the body (`SorcererUpdateChargePositionOffsets_0059C770`). The body itself is drawn 22.0 above the entity (`0x0059B63C`) |
| Vol Opt `0xC2` | The controller draws nothing; in AI state 0 (`0x0043C680`) it creates, from the arena origin `g_VoloptForm2Config/-Value` = (0, 0) — the `map_boss03` section origin — 6 pillars (ctor `0x004422D4`), 24 monitors (ctor `0x0044161C`) and 1 lightning rod (`0x0043C954`). Pillars: model entry 17 (`me5p01_y_all.nj`), motion table `0x009A5240` slot 0 = `wait_me5p01_y_all` at 0.7 (started by `0x00443EF0`), ring radius 76.0 (`0x008FE56C`), `i·60°`, facing `−0x4000 − angle`. Monitors: shape `i & 3` → model `0x009A5210[shape]` = {2, 5, 8, 11} (the blue `fe_obj_vo_mo_*_ao`; `0x009A5220` = {1, 4, 7, 10} red, `0x009A5230` = {3, 6, 9, 12} broken), position `0x009A51E0[shape]` = (0, 0, −110) (shape 2: −115) turned by `(i >> 2)·60°`, static `.xj` models. The runtime array at `0x00A44860` gets the same position with y = 43.0 (shape 0) or 15.0 — the lock-on height, not the model's. Lightning rod (ctor `0x00440AD8`, not in Ultimate: `g_VoloptDifficultyMode` = `is_ultimate_mode()`): model entry 16 (`fs_obj_hiraishin_a.nj`, `+0x108`) at (0, 80, 0), motion table `0x009A4F00` slot 0 = motion 6 at 0.7 (stat init `0x004413A4`). Core (id base+0x22, init `0x00440458`): model entry 24 (`me5_y_all`), table `0x009A4E40` slot 0 = motion 14 at 0.7, drawn squashed to 0.05 in z inside the monitor the fight picks (flag `0x10000` of `+0x390`, `RenderVoloptModel`) |
| Dark Belra `0xA5` | models 1 and 2 (`re7_b1_larm/rarm.nj`) are the thrown-arm child object (ctor `0x005398B0`); its render `0x00539E5C` returns while its state `+0xB4` is 0, so at rest neither arm is drawn |
| De Rol Le `0xC1` | the body model 2 carries the ten shell segments (`init_derolle_global_config` walks `model_files[2].njcm` child/next 12 times); model 4 is the tentacle (cloned node by node by `DerolleInitializeParameters_00439444`, `tloop`), model 3 the stings: 5 of kind 0 (`0x004369BC`) and 3 of kind 1 (`0x004370B4`), both through `DerolleInitialize_00437368` (`+0x34 = model_files[3].njcm`, `+0x24 = model_files[2].njtl`); the 10 segment children (`0x004351C4`) draw nothing and park their slots (`+0x548`) at 10000.0; 4 ceiling rocks (`0x00437BA4`); models 5 and 6 the destruction debris (28 and 19 children drawn by `0x0042A034` / `0x0042A238`). Sting attack (`0x0042E824` action 0): past frame 18.0, from `+0x4D8`, sound `0x32A`; motion 0x18 sends the kind-0 stings to the five points `0x008FCC88` = (0,0,0), (±45, 0, ±30) put on the floor by the static init `0x004343C4` (`0x00782BB0`: probe from 20.0 above) plus 1.0; other motions send the kind-1 stings to the target + (sin, cos)(i·`0x5555`)·20.0, 17.0 up, pitch `0x4000`, yaw `0x8000`/`0x6800`/`0x9800` (`0x00437190`) |
| Barba Ray `0xCB` | same shape: model 1 tentacle, model 5 the `hige` tentacle that drops the Pig Rays (own archive `bm_boss7_crawfish.bml`), models 2/3 debris |
| Dark Falz `0xC8` | form 1 draws the six entries of `0x009A6140` = {7, 5, 3, 2, 4, 1}; form 2 is models 8, 9 and form 3 models 10–13 (Ultimate `df3_sl_*`); Rico's hologram (model 15) and her ring (model 18) belong to the Ultimate form-3 scene. Form 3's object (`0x0045E4F0`) starts at (10000, −10, 0) (`0x00A458FC`, static init `0x0045EC81`) |
| Saint-Milion `0x119` | the ctor `0x0076ACF0` creates 0x13 hitbox-only parts from the table `0x009F71A4` (0x30 bytes, copied to `+0xB0` and handed to `ConstructEntityHitbox_007B9CCC`), 8 parts on the boss's own matrices 5..12, and 16 spinners from a **second archive**, `bm_ene_boss09_tentacle.bml` (descriptor `0x009F7B3C`, 3 models `shokushu_body00..02` + 7 motions) |

newserv's `add_enemy_and_children` (`src/Map.cc`) builds the same sets, which is how the counts were cross-checked: Sorcerer 2, De Rol Le 0x13, Vol Opt 0x23, Barba Ray 0x2F, Saint-Milion 0x18.

**Not decoded:** where the fight moves the children it spawns once they leave their parked spawn place (tentacles, segments, rocks, Vol Opt's core, Dark Falz's forms, arms, spinners; this needs the boss state machines), Deldepth's disc, Morfos's arm/wall, Recons, Pofuilly tails, Recobox orientation, Olga Flow's height offset (`+0x4F0`). The spinner is built without a motion: its model has 59 nodes while every motion of that archive but `2nd_attack` covers 32, so the client animates a sub-tree of it (the part class `0x00766B20` keeps three model/texture/motion slots from the table `0x009F5B20` = {archive 0 chunk 0, archive 0 chunk 1, archive 1 chunk 0}).

## Combat (player attacks, damage, enemy state)

Code: `combat/attack.ts` (combo state machine, motion / hit-frame tables), `combat/formulas.ts` (hit and damage), `combat/enemymotions.ts` (damage and death motions), `render/combat.ts` (hit detection and the commands), `formats/battleparams.ts`, `formats/enemyslots.ts`, `formats/itempmt.ts` (weapon ranges). Tests: `tests/combat.test.ts`, `tests/game.live.ts`. Addresses are VAs in the Ephinea `PsoBB.exe` (1.25.13); newserv's checks are in `src/ReceiveSubcommands.cc`.

### The commands of one attack

| Command | Layout (newserv `CommandFormats.hh`) | When |
| --- | --- | --- |
| `6x43` / `6x44` / `6x45` | `G_Attack_6x43_6x44_6x45` (8): `u16 angle_y` (BAMS), `u16 attack_type` | attack 1, 2, 3 of a combo |
| `6x46` | `G_AttackFinished_Header_6x46` (8 + 4·n): `u32 target_count`, then `{u16 entity_id, u16 hitbox}` (at most 10) | once per strike, with the entities it hit |
| `6x0A` | `G_UpdateEnemyState_6x0A` (0x0C): header entity id `0x1000 \| index`, `u16 enemy_index`, `u16 total_damage`, `u32 game_flags` | once per damaged enemy |
| `6x76` | `G_SetEntitySetFlags_6x76` (8): entity id, `u16 floor`, `u16 flags` (8 = dead) | after the killing `6x0A` |
| `6x60` | `G_StandardDropItemRequest_PC_V3_BB_6x60` (0x18): `u8 floor, u8 rt_index, u16 entity_index, f32 x, f32 z, u16 room, u16 ignore_def, u8 effective_area` | a kill, sent to the leader with `62` |
| `6xC8` | `G_EnemyEXPRequest_BB_6xC8` (0x0C): entity id, `u16 enemy_index`, `u16 requesting_client_id`, `u8 is_killer` | a kill, BB only |

Order in a real client's capture (newserv `tests/GC-ForestGameRareMagFeed.test.txt`): `6x43`, `6x46`, `6x0A`, `6x76`, then `62`/`6x60`; on BB the server answers `6x5F` (the dropped floor item) and `6xBF` (EXP for every client).

`6x0A` game flags (the capture sends `0x20900E00` for a killing hit): `0x20000000` entity is an enemy, `0x00800000` on the ground, `0x00100000` activated, `0x100` missed, `0x200` hit (flinch), `0x400` the hit was over 25% of max HP, `0x800` dead. newserv keeps `total_damage` and the "last hit by" client from this command and refuses player/object/item type bits.

**Entity ids.** Each enemy *set* entry expands into one or more enemy slots (Monest + 30 Mothmants, Pan Arms + its halves, the boss parts…); the slots of all floors are numbered in order and slot *i* is entity `0x1000 + i` (`formats/enemyslots.ts`, ported from newserv's `SuperMap::add_enemy_and_children`). The id must match the server's own list: newserv's BB map files are not always the client's (its `map_city00_00e.dat` has 21 enemy sets where the Ephinea client's has 23), which shifts every later floor by 2.

### Stat block of an entity

`FUN_00770da4` (players, from `FUN_006960e4`) and `FUN_007868f8` (enemies, from every enemy constructor) fill the same fields out of `{PlayerStats, AttackData, ResistData}`:

| Offset | Field |
| --- | --- |
| `+0x2BC` / `+0x334` | max HP / HP |
| `+0x2CC` / `+0x2CE` | ATP / ATP spread |
| `+0x2D0` / `+0x2D2` | EVP / DFP |
| `+0x2D4` / `+0x2D6` | ATA / LCK |
| `+0x2F6`, `+0x2F8`, `+0x2FA`, `+0x2FC`, `+0x2FE` | EFR, ETH, EIC, EDK, ELT |
| `+0x31C` | → AttackData (its first `i16` is the equipment ATP) |

Enemies: max HP = `stats.hp + stats.level`, EVP = `stats.evp + resist.evp_bonus`, DFP = `stats.dfp + resist.dfp_bonus`, ATA = `attack.min_ata + stats.ata`, spread = `attack.max_atp − attack.min_atp`. Players: ATA = `(class_attack.min_ata + stats.ata) × 0.1` (`DAT_00978358`), class AttackData at `0x00968A60 + class × 0x30` (`{min_atp, max_atp, min_ata}`, e.g. HUmar `{5, 10, 650}`). Shifta (`+0x278`) scales ATP and spread, Zalure (`+0x284`) scales DFP (`FUN_007791b8`).

Enemy stats come from `BattleParamEntry*.dat` (`formats/battleparams.ts`): `PlayerStats[4][0x60]` at 0, `AttackData` at `0x3600`, `ResistData` at `0x7E00`, `MovementData` at `0xAE00`, indexed `[difficulty][bp index]`; the bp index per enemy type is newserv's `type_defs` (`ENEMY_TYPE_PARAMS` in `formats/entitynames.ts`). On BB the client gets the files from the server's stream file (`04EB`), like `ItemPMT.prs`.

### Hit and damage

Hit check (`FUN_007775EC` → `FUN_00777664`, enemy vtable `+0x70` / `+0x74`):

```
p = (ATA × type_mult × combo_mult − EVP × 0.2) × 0.01      (DAT_0097819C, DAT_00978198)
hit  <=>  p > 0 and rand() <= p                            (FUN_007751B0: uniform 0..1)
type_mult  = 0x009CB9DC[attack type] = {1.0, 0.7, 0.5}     (normal, heavy, special)
combo_mult = 0x009CB9E8[combo step]  = {1.0, 1.3, 1.69}
```

Damage (`FUN_007732B8`, enemy vtable `+0x5C`), per hit box flagged by the hit check:

```
d  = (ATP + spread × rand()) × 0.2                          (_DAT_009782B4)
   + equip_ATP × 0.2 × (1 + 0.01 × attribute%)              (attribute matching the target's kind)
   + Σ elemental_i × (100 − resist_i) × 0.01                (attacker +0x2EC..+0x2F4)
   − DFP × 0.2                                              (_DAT_009782A8 = −0.2)
   − hitbox_defense
if d >= 0: d ×= 0x009CB9D0[attack type] = {0.9, 1.7, 0.5}
critical when rand() × (attacker is a player ? 500 : 200) <= min(LCK, 100): d ×= 1.5
```

The sum over the hit boxes is the hit: below 1 it is a miss (flag `0x100`); otherwise flag `0x200`, flag `0x400` when it is over `max_hp × 0.25` (`FUN_0077529C`, `DAT_0097822C`), `HP −= round(total)` (`FUN_00777414`) and flag `0x800` when HP drops below 1. The number drawn over the enemy is `round(d)` of each hit box (`FUN_0078A5E8`).

### Reach

`FUN_007A19C0` builds the attack volume from the weapon's `WeaponRange` (ItemPMT, root `+0x1C`; `FUN_005E4BA8` picks the row: a `RangedSpecial` match on `data1[1]`/`data1[2]` selects entry `0xED + index`, otherwise entry `data1[1]`). Fields `{f32 a, f32 b, u32 angle, u32 angle2, u32 max_targets}`: the volume reaches `a + b`, its inner distance is `b`, `angle` is the horizontal half-angle in BAMS and `max_targets` the number of entities one strike can hit (Saber: 14 + 18 units, `0x127D` ≈ 26°, 1 target).

### Attack combo

The three attacks are player states 5, 6, 7 (`FUN_006A11FC`, `FUN_006A0CFC`, `FUN_006A07D8`); `6x43`/`6x44`/`6x45` enter them (the local player sends with `send_and_handle_60`, `FUN_008003E0`, so its own attack runs through the same handler). Entering (`FUN_006A2F54`) sets the combo step, the speed factor `+0x8A8` (1.0, or 1.25 `DAT_0093DB24` for heavy and special) and plays the field motion of slot 2 / 3 / 4 (motion set vtable `+0x3C`/`+0x40`/`+0x44`; field tables `0x009CBEEC` records and `0x009CBF04` indices, `[motion type][weapon class][slot]`).

Phases (`+0x330`, `FUN_00698FA8`): a normal attack goes straight to phase 3; heavy and special pause the motion for 6 ticks first (`+0x8BC`, `FUN_006A2AD4` plays the charge effect). In phase 3 (`FUN_00699058`) the motion frame crossing a hit frame (`FUN_007AAA30`) sends `6x46` with the targets (`FUN_00699248`) and opens the combo window (`FUN_006A2FB4`). Hit frames: `0x00968CA0 + class × 12 + step × 4`, with per-hit rows for daggers (`0x00968FDC`) and two more classes (`0x00969000`, `0x00969054`); the combo window in ticks is `0x00969078 + class × 3 + step`. A palette press before the window is lost (`FUN_006A31B0` flag 4); inside it the next attack is queued and starts when the motion ends (`FUN_006A1000`). Bare hands (class 0) end as soon as the motion does; other classes wait out the window timer.

The weapon class (`FUN_006A7B80`, 0..18, 0 = bare hands) is taken from ItemPMT's weapon kind table, which is assumed to be what the client uses for the motion set.

### The player taking damage (`6x4A`, `6x4B`/`6x4C`, `6x89`+`6x4D`, `6x4E`, `6x4F`)

The player state machine (`player+0x32E`, `input_state_1` in the reference headers) has `13 = got_hit_light`, `14 = got_hit_heavy`, `15 = dead` next to `5/6/7` (the three attacks) and `10 = evade`. Entering a state runs its handler with argument 0, which ends the previous state and plays the motion the field motion set's vtable (`0x00B39EC0`) returns; each getter is a `mov eax, N; ret`:

| state | handler | vtable | motion slot | extras |
| --- | --- | --- | --- | --- |
| 13 light hit | `handle_input_state_got_hit_light` (entry `FUN_0069ED10`) | `+0x60` → `0x006A75AC` | 11 | sound effect `0x13`, invulnerability `get_invincibility_frames()` |
| 14 heavy hit | `handle_input_state_got_hit_heavy` | `+0x58` → `0x006A759C` | 9 | sound effect `0x14`, invulnerability frames = 300 (literal) |
| 15 dead | `handle_input_state_dead` | `+0x64` → `0x006A75B4` | 12 | only when death flag `1` is clear; with it set a "dead helper object" is created instead |
| 10 evade | `handle_input_state_evade_attack` | `+0x5C` → `0x006A75A4` | 10 | what the `6x4A` handler `action_evade` (`0x0069A9C8`) plays |
| stand up | — | `+0x68` → `0x006A75BC` | 13 | the motion after a revive |

Every one of those slots has mode 3 (play once, hold the last frame) in the field tables `0x009CBEEC` / `0x009CBF04`; the flag word is `0xA0000040` for slots 9 and 11, `0x20000100` for slot 10, `0x80` for slot 12 and `0x20000400` for slot 13.

`get_invincibility_frames` reads `invincibility_frames[8 + x]` of the table at `0x009690E8` while the scene is `logged_in` = **60 ticks**, and `[12 + x]` = 120 / 150 / 180 / 210 when `player+0x2B4 == 3`.

Commands (layouts: newserv `src/CommandFormats.hh`; send sites in the exe):

| command | size | payload | sent by |
| --- | --- | --- | --- |
| `6x4A` `G_ShieldAttack_6x4A` | 4 | — | the attack did no damage; the receiver plays the evade motion |
| `6x4B` / `6x4C` `G_HitByEnemy_6x4B_6x4C` | 0x10 | `u16 angle` (`player+0x60`), `u16 current_hp` (`+0x334`), `f32 velocity_x` (`+0x30C`), `f32 velocity_z` (`+0x314`) | `dispatch_action_got_hit_light` @ `0x0069EC4C` / `dispatch_action_got_hit_heavy` @ `0x0069E7B8` |
| `6x89` `G_PlayerDeath` | 8 | `u16 killer entity` (`get_enemy_last_attacker_idx` @ `0x007778D8`), `u16 0` | `dispatch_actions_0x89_0x4d` @ `0x0069E234` |
| `6x4D` `G_PlayerDied_6x4D` | 8 | `u32 death_flags` (`player+0x92C`) | the same function, right after the `6x89` |
| `6x4E` `G_PlayerRevivable_6x4E` | 4 | — | the particle a Reverser / Moon Atomizer can target |
| `6x4F` `G_PlayerRevived_6x4F` | 4 | — | the revive |

`6x4B` vs `6x4C` is chosen at the call site by the damage as a fraction of max HP (≤ 25% → `6x4B`), the same quarter that sets the enemy-side flag `0x400`. `6x4C` additionally recomputes the facing from the knockback velocity when its squared length passes `_DAT_0093DA04`, drops the inventory on death (`Player_DropItemsOnDeath` @ `0x0068D9C4`) and calls `0x00692068`. `death_flags`: bit 0 "items already dropped", bit 1 "no drop items in inventory" (set when `CheckForDropItemInInventory` @ `0x0069248C` returned 0), bit 2 cleared on the first death frame.

### Enemy behaviour

The Forest families share one AI substrate whose dispatcher is `unknown_booma_enemy_ai` (its per-state handlers sit in `0x0052A000..0x0052C000`; `booma_constructor` installs them through `booma_vtable`, and the Hildebear, Shark, Grass Assassin and Lily constructors install the same ones). It switches on `enemy+0x32E`: 0 spawn (vtable `+0x154`), 1 wander / idle (`+0x158`), 2 (`+0x15C`), 3 chase (`+0x160`), 4 (`+0x164`), 5 attack (`+0x168`) … 9 (`+0x178`); `set_booma_enemy_killed` sets state 8 with animation 8. Each tick ends with `SetDerolleLockonTarget_0078730C` + `enable_reticle`.

Per-enemy AI record at `enemy+0x358` (7 dwords, stride `0x1C`; `+0x00` f32 target search radius, `+0x04` f32 extra wander allowance, `+0x08` i32 turn rate in BAMS per tick):

| enemy | record | installed at | search radius | turn rate |
| --- | --- | --- | --- | --- |
| Booma / Gobooma / Gigobooma | `g_BoomaHitboxParams` `0x009BC880` (per subtype) | `0x005360DD` | 225 / 250 / 300 | 1024 |
| Hildebear family | `0x009BB200` (per subtype) | the Hildebear constructor | 225 / 250 / 300 | 1024 |
| Monest | `0x009BB764` | `0x005192E8` (ctor `0x005191C0`) | 225 | 1536 |
| Savage / Barbarous Wolf | `g_SavageWolfConfig` `0x009BB9EC` | `0x0051B406` (ctor `0x0051B2E8`) | 225 | 1536 |
| Rag Rappy | `g_RappyMaxAttackRange` `0x009BC144` | `0x00526EC5` (ctor `0x00526D90`) | 150 | 1024 |
| Poison Lily | `0x009BC33C` | `0x005295A0` (ctor `0x005293AC`) | 225 | 512 |
| anything else | `DefaultEnemyCollisionParams` `0x009C3EB0` | — | 100 | 1024 |

The states, as far as they are reproduced here:

- **idle** (`unknown_enemy_behavior_1`): plays animation 2 and wanders inside `cfg[1] + the e.dat entry's wander radius (initdata_param2) + the collision radius` of its spawn point; past that it walks straight back, turning at most `cfg[2]` BAMS per tick (`ClampAngleDifference_007A8C74`).
- **target search** (`unknown_booma_enemy_find_target`): `EnemyGetNearestTargetInRange_007714CC(this, cfg[0], 0)` takes the nearest player inside `cfg[0]` that has line of sight (`EnemyAI_CheckLineOfSight_00771E14` / `cast_ray_at_map_collision_geometry`); a target on another floor is dropped.
- **notice** (`unknown_enemy_behavior_4`): idle → state 3 with animation 7 (the war cry) and substate 0.
- **chase** (`unknown_booma_enemy_chase_target`): substate 0 plays the war cry and its sound (vtable `+0x188`) until the animation ends, then animation 2 and substate 1; substate 1 steers at the target's `weapon_position` with `SorcererProcessProjectileLogic_00772AA0(this, speed, cfg[2], x, y, z, 0)` = turn by at most `cfg[2]`, step `speed` along the facing. The target is given up after `0x96` = 150 ticks of not reaching it.
- **speed** (`RemoveEnemyFromList_0052AD44`): `enemy+0x39C` (units per tick) and the animation frame step come from the enemy's `BattleParamEntry` **MovementData** — `fparam1`/`fparam2` normally and `fparam3`/`fparam4` while the "near the player" flag is set (newserv `notes/movement-data.txt` names them idle move speed / idle walking animation speed / engaged move speed / engaged animation speed; Booma: 0.8 / 0.8 / 0.5 / 0.5). `ClearEnemyHitbox_0052AC5C` sets that flag from the squared distance to the target against `0x00922330..0x0092233C` = {10000, 2500, 22500, 10000}, i.e. 50 / 100 units for a Hunter class and 100 / 150 for every other class.
- **attack**: `unknown_booma_enemy_attack_behavior` enters state 5 substate 1 and picks animation 4 or 3 by `g_BoomaAttackSuccessChance`. `unknown_enemy_behavior_2` runs it: at animation frame 7 (`check_entity_animation_elapsed_threshold(this, 7.0)`) it calls the target's `try_hit_entity(this, 1.0)` and `cause_knockback(this, 3.0)`; when the attack animation ends it sets animation 0 and waits `0xF` = 15 ticks before vtable `+0x19C` puts it back into the chase. The reach is the enemy's `AttackData.distance_x` with the half-angle `AttackData.angle` out of `0x10000` (`EnemyAI_CheckFacingArc_00772C08`): Booma 12 / `0x1C71`, Savage Wolf 20 / `0x1A00`, Hildebear 30 / `0x2200`.

`booma_constructor` also fixes the collision radii in `init_booma_subtypes_global_config`: 7 / 7 / 8, and 10 / 10 / 9 in Ultimate.

Enemy animation tables (rows `{u16 mode, u16 next, u32 motion, f32 frames per tick, u32 flags}`; mode 1 loops, flags `0x1` idle-ish, `0x4` attack, `0x8` damage, `0x10` death, `0x20` one-shot transition). Booma, `0x009BC980`: slot 0 stand (motion 9, 0.6), 2 walk (11, 0.5), 3 attack A (1, 0.65), 4 attack B (2, 0.85), 6 damage (3, 1.5), 7 war cry (10, 0.8), 8 death (5, 0.6). The `animation_id` the FSM writes is the slot number.

The MovementData index of an enemy type is not in newserv's `type_defs`; `notes/movement-data.txt` lists it separately, and for every Episode 1 type there it equals the ResistData index (Booma `0x4A`, Gobooma `0x4B`, Gigobooma `0x4C`, Hildebear `0x48`, Hildeblue `0x49`, Mothmant `0x00`, Monest `0x01`, Savage Wolf `0x02`, Barbarous Wolf `0x03`, Poison Lily `0x04`, Rag Rappy `0x18`). Monest's and the wolves' MovementData is all zeros ("loaded with assets but not used").

### Damage numbers and the lock-on reticle

The number over a hit entity is `round(d)` of each hit box, drawn by `FUN_0078A5E8` (see the damage formula above). The reticle is `enable_reticle`, called by every enemy AI state after `SetDerolleLockonTarget_0078730C` picked the lock-on target.

## Map texture animation (`map_<area>[_<layout>].tam`)

Big-endian. Loaded by `FUN_0080a4c8`, byte-swapped by `FUN_00807828` and applied per section entry by `FUN_0080ab60`.

The file is a list of blocks `{u16 type, u16 size}`, where `size` counts the bytes after this header, ending with type `0xFFFF`.

| Block | Layout | Used by |
|---|---|---|
| type & 1 (UV scroll) | `u16 count, u16 pad`, then count × `{u16 id, u16 texture, f32 scroll_u, f32 scroll_v, f32 speed_u, f32 speed_v}` | entries with flag `0x20`: the row whose `id` equals the effect slot id is copied into the slot |
| type & 2 (texture swap) | `u16 id, u16 count`, then count × `{i16 texture, i16 frames}` | entries with flag `0x40`: matched by animation id. `frames = -1` holds that texture |

- **UV scroll:** `FUN_0066f58c` creates the scroll effect for that texture and forces wrap addressing (`FUN_0081a55c`). Each tick `FUN_0066f804` adds the speed to the offset, which is kept as a short wrapped to ±255 and divided by 256.0 (`0x00939fc0`).
- **Count:** 151 files, with 1080 scrolls and 558 swaps.

## Background music

The exe requests ADX names: `title.adx` in the title constructor `FUN_006f8130`, `CHARA.adx` in `FUN_004df9ec` (character select/creation), and `LOBBY.ADX` / `city.adx` / seasonal variants in `FUN_00642c30`. The PC data stores each one as `data/ogg/<NAME>.ogg`: the same base name, upper case.

Every file has a Vorbis comment `loop_start=<sample>`. The track plays from the start, then loops from that sample to the end of the file. For example, `TITLE.ogg` is 48 kHz and `loop_start=2881152` (60 s).

`client/src/audio/bgm.ts` plays these with Web Audio, starting at the first user gesture because of the browser's autoplay policy.

### Floor music

Each area id has a scene record in the table at `0x00a160c0` (12 bytes: name, start function, end function; "CITY", "FOREST01", …). The end functions stop the music (`FUN_00815434`), so every floor starts its track afresh. The start functions pick (`client/src/audio/fieldbgm.ts`):

| Areas | Music |
|---|---|
| Pioneer 2 (0x00, 0x2D), Lab (0x12) | `FUN_007a7484` → `FUN_006428bc`: BGM zones (`TObjBgmCol`, `{x, y, z, radius, track}` from `0x00934f40` / `0x00935040`, 12 each) and a manager `FUN_00642824` that plays `FUN_00642c30` (`city.adx` outside the lobby) when nothing plays. Entering a zone (`FUN_0064278c` edge, `FUN_00642724`) plays track `0x009c6fc0[i]`: SHOP, GUILD, MEDICAL, soutoku, city (via `FUN_00642c30`), labo |
| Forest, Caves, Mines, Ruins | interactive music 0, 1, 2, 3 (`FUN_00814c7c`) |
| Dragon, De Rol Le | `dragon.adx`, `delo.adx` |
| Vol Opt | interactive 3 once the player's z ≥ 4000.0 (`FUN_00440980`, `0x008fe174`); `vol_opt1/2.adx` with the fight |
| Dark Falz | interactive 4 after 0x5A frames (`FUN_0044baa8`; `T1.adx` when `FUN_00454058`); `dark1/2.adx` with the fight |
| VR Temple / VR Spaceship (and battle areas) | interactive 7 / 8, only in Episode 2 (`DAT_00aafdb8 == 1`) |
| CCA, Jungle, Mountain, Seaside (day and night), Tower | interactive 5 |
| Seabed | interactive 6 |
| Gal Gryphon, Olga Flow, Barba Ray, Gol Dragon | `gryphon.adx`, `HALL.adx` (`FUN_0048722c`), `delo2.adx`, `dragon2.adx` |
| Crater routes / Crater Interior / Desert | interactive 9 / 10 / 11 |
| Saint-Milion | `slbgm_boss09.ogg` (`slbgm_boss09b.ogg` when `DAT_00a9b078 == 1`), `FUN_0076b688` |

### Boss music phases

Code: `client/src/audio/bossbgm.ts`. Test: `tests/bossrooms.test.ts`. A boss floor does not keep one track: the area object starts the entry track and the boss swaps it when it changes form. Every swap is a `play_bgm(name)` call (`FUN_00814AFC`, `data/adx/<name>` or, for Episode 4, `data/ogg/<name>`):

| Area | Phase 0 (entry) | Phase 1 | Phase 2 |
|---|---|---|---|
| 0x0D Vol Opt | interactive 3 (Ruins) past z 4000 | `vol_opt1.adx` (`init_volopt_stuff` `0x0043EE2C`) | `vol_opt2.adx` (form 2, `0x0043EDA4`, also `0x00440763`) |
| 0x0E Dark Falz | interactive 4 after 0x5A frames (`T1.adx` at `0x0044BAD5`) | `dark1.adx` (`0x0044D716`) | `dark2.adx` (`0x0044E0DA`) |
| 0x1F Olga Flow | `HALL.adx` (`0x0048726B`; `T2.adx` `0x0048725E` during the cutscene) | `proto1.adx` (form-1 entry `0x0048F2D8`) | `proto2.adx` (form-2 entry `0x0048F1E4`) |
| 0x0B / 0x0C / 0x1E / 0x20 / 0x21 | `dragon.adx` / `delo.adx` / `gryphon.adx` / `delo2.adx` / `dragon2.adx` | — | — |
| 0x2C Saint-Milion | `slbgm_boss09.ogg`, or `slbgm_boss09b.ogg` for the Shambertin/Kondrieu variant (`FUN_0076B688`) | — | — |

The form changes are the boss's own and the room leader broadcasts them, so a client that only watches the room learns the phase from the boss action subcommands (newserv `CommandFormats.hh`): `6x15` `G_VolOptBossActions` (`action` 0–2 = Vol Opt phase 1, 3–7 = phase 2), `6x19` `G_DarkFalzActions` (`u16 phase`, `0xFFFF` = no change), and `6xA4` / `6xA5` (Olga Flow form 1 / form 2 actions). `bossPhaseOf(area, sub, body)` maps them to a phase and `FieldMusic.setBossPhase` plays it; the phase only moves forward. Which of `dark1`/`dark2` belongs to which Dark Falz form follows from the order of the two calls — the handlers are not traced further.

Interactive music (`client/src/audio/slbgm.ts`): twelve descriptors at `0x00a16088` = `{char name[0x20] ("slbgm_forest.afs"), i32 records, i32, i32, ptr calm table, ptr battle table}`, records of five `i16` `{first, loop, count, transition, next}`. `FUN_00814c00` swaps the extension for `ogg`: `data/ogg/slbgm_forest.ogg` is a **chained Ogg Vorbis** file and every logical bitstream (link) is one segment; the streaming thread (`FUN_0086ee8c`, `FUN_0086f530`) plays queued link numbers back to back (`FUN_0086e114` → 256-entry ring at +0x708). Start (`FUN_00814c7c`): queue `calm[0].first` and `first + 1` (or `calm[next].first` for a one-link record). Each time the queue drains to the playing link (`FUN_00814f30`): in the same mode, the next link of the record until `count`, then record `next` starting at `first` the first time a record changes and at `loop` afterwards; on a mode change the record's `transition` link, then (`FUN_00815170`) `other[record].next` at its `loop` link (a transition of −1 switches at once). Battle is requested (`FUN_00814c5c`) while the player's room has an active wave event (`FUN_0069821c`, `FUN_008114b0`), calm again 0x5A frames after it is clear; the Dark Falz music ignores it. In every file the highest link the tables use is the last link of the file. Browsers decode each link separately (its own Ogg headers) and schedule them sample-accurately.

## Area fog (`fogentry.dat`)

Loose file or `data.gsl`; 0x4000 bytes = 256 entries of 0x40, little endian. `FUN_005bca88` loads it (`fogentry_a.dat`, 128 entries, when `FUN_0078b220() != 0`). Parsed by `client/src/formats/fogentry.ts`.

| Off | Field |
|---|---|
| 00 | `u32 flags`: 1 or 2; bit 1 = wobble re-evaluated every frame, bit 2 = phase counter |
| 04 | `u32 color` (D3DCOLOR, RGB) → `D3DRS_FOGCOLOR` |
| 08 | `f32 end` → `D3DRS_FOGEND` |
| 0C | `f32 start` → `D3DRS_FOGSTART` (often negative) |
| 10 | `f32 fade_step`: fade progress per frame toward this entry (≤ 0 → 0.001); 0.01 = 100 frames |
| 18 | `f32 wobble_speed` (degrees per frame) |
| 20 | `f32 end_amplitude`: `end += sin(frame * speed + end_phase) * amp` |
| 28 | `f32 start_amplitude`: same with `start_phase` |
| 30 | `f32 aux_base` (default 640) + `aux_amplitude * sin(frame * speed)` → fog object `+0x194`, not a render state |
| 3A / 3C / 3E | `u8 end_phase`, `u8 start_phase` (degrees), `u8 aux_amplitude` |

- **Render states** (`FUN_005bc440`): `FUN_0082db44(1)` sets `FOGTABLEMODE = LINEAR` and `FOGVERTEXMODE = NONE` (or the reverse when `DAT_00acbf10` selects vertex fog; table `0x0098a3e4 = {0, 3, 3, 3}`), then `FOGCOLOR`, `FOGSTART`/`FOGEND` (`FUN_0082dae0`, each clamped to ≥ 0), `FOGENABLE = 1`. `FOGDENSITY` is never set. Linear table fog is depth-based, like three.js `Fog`.
- **Sine:** `FUN_0082dcbc` takes BAMS; the angle is `(frame_counter (DAT_00a9c4ec) * speed + phase) * 65536 / 360`.
- **Fog object** (`FUN_005bc4ec`, vtable `0x00b0bae0`, up to 4 in `DAT_00a8d774`): four parameter slots (pointers at `+0x174`): 0 base, 1 override, 2 staging, 3 blend; current slot `+0x184`.
  - `FUN_005bd968(id, flags)` (base, all objects via `FUN_005bd918`) and `FUN_005bcf00(id, flags)` (override) copy the entry into slot 2; `flags & 1` = immediate, else fade. Same id as the current slot: no-op.
  - `FUN_005bce64(flags)` returns to slot 0.
  - Update `FUN_005bd2cc`: immediate → swap staging into place. Fade → slot 3 = lerp(from, to, t) per frame for color (per channel), start, end, amplitudes and phases (wobble speed copied from the target); `t += step` where step is the target's `fade_step` (the source's when fading back to the base); when `t ≥ 1` the target becomes current. Idle → re-evaluated only for wobbling entries (`FUN_005bd6d8`); others keep the value computed when they became current.
- **Base fog per area:** `FUN_005bc4ec` calls `FUN_005bd918(table_0x009c1ec0[DAT_00aafc9c], 1)`, 47 entries indexed by the area number (`DEFAULT_FOG_BY_AREA`): Forest 1 → 1 (`0x80ffaa`, 0..2000), Caves 1 → 3 (`0xff7000`, 156..791), Mines 1 → 0x0e (`0xe1e2ff`, 100..4000), Ruins 1 → 0x1e (`0x0d4015`, -100..1200).
- Map entries with flag `0x1` are drawn with fog disabled.

### Fog regions (set objects)

`TObjFogCollision` (0x07), `TObjFogCollisionSwitch` (0x18) and `TObjFogCollisionPoison` (0x160) in `map_*o.dat`. The base constructor `FUN_007ba33c` copies the set entry: `+0x68` param1 = radius, `+0x70` param3 = switch mode, `+0x84` param4 = fog id, `+0x88` param5 (0 = fade), `+0x8c` param6 = switch id.

- Every frame, for each local player, a region whose sphere holds the player (`FUN_005c2a08`: squared distance < radius²) registers `(fog id, param5 == 0)` with that player's manager (`FUN_005c2240`, managers in `DAT_00a8d7cc[12]`). The highest id wins.
- Switch regions (`FUN_005c252c`) register only while `(param3 >= 1) == switch_on(param6)`. The cave/mine dark rooms are param3 = 0, fog 0x11 (black, end 70): dark until the switch is pressed.
- Manager update (`0x005c2ce8`): registrations → `FUN_005bcee4` override (id minus 0x1000 if ≥ 0x1000, clamped to 0..255; ids like `0x102d` carry a priority bit); none → back to the base fog.
- Only 0x18 (278) and 0x160 (67) occur in the Ephinea set files. The 0x160 class is assumed to share the 0x18 layout (same params pattern).

## Area light (`lightentry.bin`)

Loose file or `data.gsl`; 0x1980 bytes = 96 entries of 0x44 (17 floats). Entry `area + (FUN_0078b220() ? 0x30 : 0)` is copied to `DAT_00a9d460` by `FUN_00793f64` → `FUN_00794034`. Parsed by `client/src/formats/lightentry.ts`.

| Off | Field | Use |
|---|---|---|
| 00 | `f32[3]` | written by the light editor from two angles (`FUN_004e3084`); not used to draw |
| 0C | `f32[3]` direction | `FUN_00843a68` → `D3DLIGHT9.Direction`, transformed by the inverse of the current matrix (camera space); not always unit length |
| 18 | `f32[2]` | unused at run time |
| 20 | `f32` ambient level | `D3DRS_AMBIENT = (l, l, l)` for models/objects (`FUN_00794a80`, `FUN_00794548`) |
| 28 | `f32[3]` color | `FUN_00843a38` → `D3DLIGHT9.Diffuse` |
| 38 | `f32[3]` ambient color | `D3DRS_AMBIENT` once at area start (`FUN_00794200`) |

The maps are unlit (vertex colors); the light applies to player and object models (`TObjLight` objects, 0x04, can override it per room: list at `DAT_00a9cda4`, not handled). The viewer uses a camera-attached `DirectionalLight` with the direction treated as pointing toward the light, and π-scaled intensities because three.js' Lambert term divides by π.

## Sound effects

### Bank files (`data/sound/*.pac`)

A bank is a run of waves with no file header. Each wave starts on a 32-byte boundary:

| Offset | Size | Field |
|---|---|---|
| `+0x00` | 16 | PCMWAVEFORMAT: format tag 1, channels, rate, byte rate, block align, bits. All waves are 16-bit mono, 22050 Hz, except `duel02.pac` #5 (44100 Hz). |
| `+0x10` | 12 | left over from the source RIFF (`data` + size, or another chunk such as `cue `); not read |
| `+0x1c` | 4 | PCM byte count |
| `+0x20` | n | PCM, then padding to the next 32-byte boundary |

The exe does not walk the file. It takes each wave's offset from records in the exe (below). For all 26 banks, walking the 32-byte aligned waves gives the same offsets in the same order. `ephinea.pac` (7 waves) has the same layout but is not in the exe's bank table. `sonicteamfx.bin` is not a bank: no loader or string in the exe names it, and it is not PCM.

### Tables in PsoBB.exe

| Address | Content |
|---|---|
| `0x00a21560` | `char*[26]` bank names: ancient, boss01–04, cave, city, common, duel01–02, forest, machine, beach, boss05–08, jungle, ruin, ship, tower, water, wilds, crater, desert, boss09 |
| `0x00a214e0` | `u32[26]` entries per bank |
| `0x00a21460` | `i32*[26]` wave slot of each entry |
| `0x00a215e0` | `rec*[26]`, 16-byte records: `+0` u8 group, `+1` u8 index, `+2` u8 flags (bit 0 = loop), `+4` u32 file offset, `+8` u32 loop start, `+0xc` u32 loop end (samples) |
| `0x00989e60` | `i32[]` area → bank |
| `0x00a1f840` | `i32[0x700]` SE id → wave slot (identity except for 127 ids) |
| `0x00a13b20` | `u32[0x700]` slot flags: bits 8–14 attenuation 0–127, bit 15 3D (when the type nibble is 0), bits 24–27 buffer type (0 or 10 = 3D), bit 28 voices of the slot may overlap, bit 31 random pitch |

`tools/gen-se-tables.py` turns these into `client/src/audio/se_tables.ts`.

### Loading

The slot table `0x00acb3a8` has 0x700 slots of 0x20 bytes: `+0` header pointer, `+4` PCM pointer, `+8` PCM size, `+0xc` record flags, `+0x10` loop start, `+0x14` loop end − start, `+0x1c` header pointer (non-zero = loaded, `FUN_00829110`).

- `FUN_00829b7c` (start-up) → `FUN_00829a04` loads `common.pac` and fills its slots. It stays resident.
- `FUN_00828d40(area)` (through `FUN_00815584`) loads bank `0x00989e60[area]`. If the area bank changes, `FUN_00828c38` frees the old one, clears the slot table, and refills common's slots. The new bank is then written on top, so for a slot in both banks, the area bank wins.
- Start-up (`FUN_00824944`) and the character screens (`FUN_004df9ec`) call `FUN_00815584(0)`, so `city.pac` is loaded on the title and character screens.
- On a bank change, `FUN_00829af8` stops the playing voices, except UI slots (0x56f–0x58f) and a few others.

### Playing

`FUN_00814298(id, pos, volume, flags)` plays a one-shot. `FUN_008144b0(id, handle, pos, volume, flags)` plays a voice that can be updated and looped.

1. `id` → slot via `0x00a1f840` (`FUN_0081443c`). In areas 0x15/0x16, ids 0x559–0x55c become 0x4b1–0x4b4. Ids ≥ 0x700 use slot 0.
2. With a 3D position: the distance to the listener (`0x00acb39c`) is measured. At 2 or less, the sound plays as 2D. At 300 or more, it is dropped, except in areas 0xe, 0x1f and 0x2c. 3D buffers get min distance 80 and max distance 500.
3. Volume: `a = clamp(-attenuation [+ volume if flags & 2], -127, 0)`, `f = (1 + a/127) * (1 + master/127) - 1`, `SetVolume(round(f³ * 6400))` (hundredths of a dB). `master` is `DAT_00ab59f8`, the SE volume option.
4. `FUN_00828e4c`: there are 64 voices (`0x00acb388`, 0x48 bytes each). If the slot's flags lack bit 28, playing voices of the same slot are stopped first (`FUN_00829c38`). The first free voice is used; if none is free, nothing plays. The DirectSound buffer is created with `CTRLVOLUME | CTRLPOSITIONNOTIFY` (plus `CTRL3D` for 3D slots). There is no pan or frequency control: a voice's pitch value (`+0x34`: −500, or random when bit 31 is set) is never applied to the PC buffer.
5. Looping (`FUN_008292dc`, record flag bit 0): a notify event is armed. When it fires, `FUN_00828978` stops the buffer, seeks to `block align × loop start`, and plays again.

### UI sound ids

| Id | Bank | Used for | Callers |
|---|---|---|---|
| `0x56f` | common | cursor move | title `FUN_006fed2c`, windows `0x734aab`…, slot list `0x412653`, char creation `FUN_004eb5f0`, `FUN_004ef208`, editors |
| `0x570` | common | confirm | windows `0x7351c5`, `0x738883`, slot list `0x412742`, char creation |
| `0x571` | common | AUTO roll done | `FUN_004f2988` |
| `0x573` | common | back (char creation) | `FUN_004ef208`, `FUN_004f0f44`, `FUN_004f1cb8`, `FUN_004f34a8` |
| `0x575` | common | not allowed | `FUN_004f0b80` (invalid name), `0x7351ac` |
| `0x57c` | common | name entry closed with an invalid name | `FUN_004f34a8` |
| `0x585` | common | cancel | slot list `0x412e4e`, windows `0x7388d0`, `FUN_00413ac0` |
| `0x420` | city | title menu confirm | `FUN_006fed2c`, `FUN_006fede0` |

`client/src/audio/se.ts` implements this: banks through the `DataSource`, PCM copied straight into `AudioBuffer`s, volume as gain `10^(ds/2000)`, the 64-voice limit and the same-slot rule. The UI calls it through the module-level `se(id)`, which `classic/main.ts` installs.
