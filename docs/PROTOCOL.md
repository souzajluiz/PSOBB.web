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

## Game server → lobby

| # | Dir | Cmd | Content |
|---|---|---|---|
| 1 | C→S | `93` | `connection_phase = 4`, `character_slot`, plus guild card / token / client config |
| 2 | S→C | `E6`, `B1`, `E7` | accepted, server time, full character (0x3994 bytes) |
| 3 | S→C | `07` | main menu: entries of 0x2C (`menu_id`, `item_id`, u8, u8, UTF-16 name[0x10], u8 episode, u8 flags). newserv: *Go to lobby*, *Patches*, *Disconnect* |
| 4 | C→S | `10` | `{menu_id, item_id}` |
| 5 | S→C | `83`, `C5`, `67` | lobby list, challenge ranks, **join lobby** |

`67` / `68` (join / one more player) = `LobbyFlags` (0x0C: `client_id`, `leader_id`, `disable_udp`, `lobby_number`, `block_number`, …) + entries of 0x520: `PlayerLobbyDataBB` (0x44: `guild_card_number` @+4, `client_id` @+0x1C, name UTF-16 @+0x20), `PlayerInventory` (0x34C), `PlayerDispDataV4` (0x190: stats with `level` @+0x18, visual @+0x24). `69`: player left, `flag` = client id.

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

Section (0x34): `i32 id`, `f32 pos[3]`, `i32 rot[3]` (BAMS, 0x10000 = 360°), `f32 radius`, `u32 static_entries`, `u32 animated_entries`, `u32 static_count`, `u32 animated_count`, `u32 flags`.

- Static entry (0x10): `u32 object`, `u32`, `u32`, `u32 flags` (usually `0x200000`; `0x10001` also seen).
- Animated entry (0x20): `u32 object`, motion data (not decoded yet).
- Some Episode 2 maps have entries with flags `0x10224` whose pointer targets another record type; skipped for now.

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
- Material (0x10): `u32 type`, `u32 arg1`, `u32 arg2`, `u32 arg3`. These are sticky render-state changes matching the client's `g_StandardRenderStateSetters`: 2 blend (`src`, `dst` Ninja blend factors), 3 texture id, 4 texture addressing, 5 material color, 6 lighting.

## XVM textures

- `XVMH`: `u32 header_size`, `u32 count`, …; chunks start at `header_size + 8`.
- `XVRT` chunk: `u32 size` (bytes after this field), `+0x08 u32 flags` (bit 0 mipmaps, bit 1 alpha), `+0x0C u32 format`, `+0x10 u32 global index`, `+0x14 u16 width`, `+0x16 u16 height`, `+0x18 u32 data size`, pixels at `+0x40`.
- Formats found in Ephinea's `scene/*.xvm` (7821 textures): 6 = DXT1 (most), 7 = DXT3, 2 = R5G6B5, 3 = 16-bit with alpha. Uncompressed formats are Xbox-swizzled (Morton order).
- Map textures: `map_city00_00n.rel` → `map_city00.xvm`.
