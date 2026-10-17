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

On BB the server, not the leader, then sends `6x72` (resume) to **every player except the joiner** once the leader's `6x70` arrived (`send_resume_game`). The web client sends `6x6D`, `6x71` and `6x70`. It does not send `6x6B`/`6x6C`/`6x6E`: newserv checks the entity counts of every floor's map against its own (including enemy children), which needs the full entity expansion; nor `6x6F`, since the client does not track quest flags. The BC0 data is sent as a literal-only stream (newserv `bc0_encode`: one control byte with a 1 bit per literal, LSB first, then up to 8 bytes).

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

Player start: the floor's `TObjPlayerSet` with `param1` = client id and `param4` = 0 when arriving from a lower floor, 1 when returning from a higher one. Area warps: `TObjAreaWarpForest` (type 2) with the destination floor in `param4` (Forest 1 has one to floor 2 and one back to floor 0); `TObjCityAreaWarp` (0x44, the Pioneer 2 teleporter, which opens a destination menu in the original).

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
