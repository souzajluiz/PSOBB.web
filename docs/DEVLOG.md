# Devlog

## 2026-10-16: map viewer

**What landed:**
- **Parsers:** REL, Ninja object trees with XJ models, the "fmt2" map `n.rel`, and XVM textures (software-decoded DXT1/DXT3/16-bit, including Xbox unswizzling).
- **Viewer:** a three.js map viewer tab with orbit and WASD camera, reading data from a picked folder or from the Vite dev endpoint `/psobb-data`.

**How the formats were worked out:**
- The decomp's map loader notes gave the `n.rel` header: section count at +8, sections at +0x10, NJTL at +0x14, 0x34-byte sections with sub-arrays at +0x20/+0x28 and +0x24/+0x2C.
- The rest came from hex-walking `map_city00_00n.rel`: 16-byte static entries, the NJS_OBJECT and XJ model layouts, vertex types 4, 5 and 7, and material records whose type numbers line up with the client's render-state setter table.
- XVR formats were surveyed across all 203 `.xvm` files: bytes per texel 0.5 means DXT1, 1 means DXT3, and 2 means 16-bit. The flags turned out to be a mipmaps bit (×4/3 size) and an alpha bit.

**Tests:**
- `tests/formats.test.ts` parses all 175 `n.rel` maps (133,488 models) and all 203 `.xvm` archives (7,821 textures).
- 16 Episode 2 maps initially failed. Their entries with flags `0x10224` point at non-object records, so they are now skipped and counted (403 entries total).

**Verified in Chrome:**
- Pioneer 2 (`map_city00_00`): 185 meshes, 15,843 triangles, 246 textures.
- Forest 1: 631 meshes, 24,152 triangles.
- Also loaded: Jungle 7 and Seabed 2. No console errors.

**Security:** the dev endpoint rejects path traversal (`..%2F` gets 403) and only exists in `vite dev`, which is bound to 127.0.0.1.

## 2026-10-16: login in Chrome

**What landed:**
- **Vite + TypeScript client** (`client/`): login form, character slots and a live protocol log.
- **`BBSession`:** full data-server login, i.e. `03` → `93` → `E6` → `19` redirect → reconnect → `93` (with guild card, token and client config) → `E6`, then `E3` per slot → `E4`/`E5`.
- **Key file:** Vite serves the `.nsk` from the local newserv checkout at `/keys/`, so it is never committed.

**Bug found in Chrome:** `E6` and `19` arrived in the same WebSocket message. `waitFor(0x19)` was registered only after `await waitFor(0xE6)` resumed, and by then the `19` had already been dispatched. `BBConnection` now keeps a backlog of unclaimed commands.

**Verified in Chrome:** login as `webtest` gets guild card 2122363817 and four empty slots (`E4`).

## 2026-10-16: foundation

**Starting point:** the `psobb-master` folder was the 2015 Tethealla server (Windows binaries and server data only, no client). The plan: switch the server to newserv and reimplement the client for the browser.

**Environment:**
- **REA MCP:** failed because the default Node was v16 and `rea-agents@6.4.0` needs ≥ 22.19. Fixed by pointing the MCP config at Node v24.18.
- **newserv:** `phosg`, `resource_dasm` and `newserv` built into `vendor/` with a local prefix. Nothing installed system-wide besides `brew install asio libiconv`.
- **Client:** the Ephinea installer was extracted with `7zz`, never executed. Maps live in `data/scene/`; spawn `.dat` files live in `data.gsl`.

**TS ports, all verified against the newserv CLI:**
- `BBCrypt`: ciphertext byte-identical to `newserv encrypt-data --bb` (keys `default` and `default4`).
- `prsDecompress`: 19 real files identical. `chatsensor.prs` is rejected by both newserv and the port.
- `GSLArchive`: 1524 entries, the same count as `newserv extract-gsl`, with identical content.

**Live login through the bridge:**
- **Bug 1, race:** `03` arrived before `BBConnection` installed its handler. The transport now queues early data.
- **Bug 2, framing:** the cleartext `03` is not padded to 8 bytes. Only encrypted commands are padded.
- **Result:** `E6 error_code=0`, then `19` (redirect). Login OK.
