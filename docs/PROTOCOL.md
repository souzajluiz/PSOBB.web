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
