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
