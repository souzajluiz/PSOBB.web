# Devlog

## 2026-10-16: player appearance tables and proportions from PsoBB.exe

**What changed:** the guessed texture slot tables in `render/playermodel.ts` are gone. Texture lists, appearance limits and proportions now follow the client code.

**Findings:**
- The appearance record at `0x009b5b60 + 0x2c * class` holds the limits, the hair/cap/head model names and three texture *name* lists (hair, head, body). `FUN_004e6920` edits each name from the appearance: costume digits, skin letter, face digit, section ID letter. `FUN_004ed735` then binary-searches the class's sorted name table at `0x009b59e0` to find the `pl<L>tex.afs` entry. The tables are generated into `render/playertables.ts` by `tools/gen-player-tables.py`.
- Check: every name the rules can produce exists in the table, and every AFS entry is reachable except two unused FOmar textures.
- Caps use the hair list, and their textures follow the costume (e.g. RAmar `pxtDb_<costume>z_w_hg1`). The head hangs from node 58, hair/cap from node 59 (`FUN_0068a088`).
- The old guesses were wrong in the body lists of HUnewearl, RAcast, RAcaseal, FOmarl, FOnewm, FOnewearl, FOmar and RAmarl (RAmarl's teal top), and in the hair/cap lists of RAmar, FOmarl, FOnewm, FOnewearl, FOmar and RAmarl. HUmar, HUcast and HUcaseal were already right.
- `proportion_x/y` do not scale the model. They morph the body and head between 7 shapes per class from `plZsmpnj.afs`, with barycentric weights over 8 triangles of the unit square (`FUN_004e877c`, `FUN_004e86e4`, `FUN_004e7e54`). The blend covers node positions, scales and vertex positions/normals/weights. In game this runs per player (`FUN_004ee448` loads, `FUN_004ee534` blends).
- Out-of-range appearance values reset to 0 (`FUN_004e665c`); before, they wrapped around.

**Verified:** `tests/players.test.ts`:
- name resolution for every costume/skin/face/section;
- part texture ids inside their lists;
- every shape matches the node/vertex layout of the part it morphs;
- builds at 8 proportion points;
- spot checks.

In `models.html` (new proportion sliders): FOmar hats follow the costume colors, RAmarl's top is red, and RAcast at max proportions is bulkier.

**Open:** the exact normal renormalization in `FUN_004e838c` (it does not matter after shading). `pl<L>smp.rel` is not decoded. No side-by-side capture exists for each class.

## 2026-10-16: title screen rebuilt from the decompiled code

**What changed:** the title is now drawn from what `PsoBB.exe` does instead of parameters fitted to a capture.

**How:**
- Ghidra 12 headless analysis of the Ephinea `PsoBB.exe`, plus a small script (`DecompileAt.java`, kept out of the repo) that decompiles functions by address or pointer table, lists references and dumps assembly ranges.
- The exe is instrumented: each function is wrapped in fake `MessageBoxA(-1, 0, 0, 5|4)` calls and `peetles_begin/end` markers. Ghidra still decompiles it, but some function bounds need forcing.

**Findings:**
- `FUN_006fb914` loads `Title.prs` (`"%s.prs"`) into a texture list and registers the title task.
- `FUN_006f8130` constructs the title screen:
  - starts `title.adx`;
  - creates three child objects (background, menu, logo);
  - creates particle effects `0x1e3`–`0x1e5` (the light beam, still approximated).
- Background render, `FUN_006f475c`:
  - tiles from the table at `0x009a3840`: base layer texture 3, flare layer texture 13 in front;
  - every 300 frames (frames 150–170) a flash sprite, texture 12 UV (0.574, 0)–(0.824, 0.25);
  - magic circle centered at (320, 220), one turn every 900 frames;
  - ring: texture 11, size 430, UV 0–0.84;
  - inner ring: texture 12, size 178, UV 0–0.348, rotating the other way;
  - three nodes: texture 12, size 104, UV (0.3496, 0) +0.203, at offsets (±137, −79) and (0, 156);
  - color from `FUN_007a919c`: RGB(0, 88, 115), pulsing to white over frames 150→165→180 of each 300-frame cycle.
- Logo and version, `FUN_006f4cc4`: textures 1 and 2 at (64,61)–(320,317) and (320,61)–(576,317); version text at (10, 460).
- The original BB has an in-game login window (`FUN_006fede0` → `FUN_007617e8`, user name and password), so the classic UI's login window matches the original flow.

**Validation:** sweeping the frame counter, the capture matches angle ≈ 0 (frames 870–900): ring text and node positions line up. psobb.io's widescreen patch keeps these quads round, so the circle is compressed by 1/1.2 around x = 320.

## 2026-10-16: map collision and lobby spawn points

**Goal:** walk on the real collision instead of raycasting the render mesh, and start in the lobby where the original client puts you.

**Collision (`map_*c.rel`):**
- The decomp names the structs (`map_collision_mesh_container`, `map_crel_mesh`, `map_crel_face`). The REL root points to a null-terminated array of mesh containers, each with a bounding circle and node flags. Each mesh has vertices and 0x24-byte faces with flags, normal and bounding circle. The format is in PROTOCOL.md.
- The query constants come from `PsoBB.exe` itself: `objdump` on the functions named in the decomp, then reading the `.rdata` floats they load. Ground probe: `ny >= -1e-4`, a ray 10000 units down, the highest plane under the probe. Walls: one-sided segments, rays 5 units above the feet, stop when `dot <= -0.87`, otherwise slide.
- Player masks: ground `0x5F` (`play_footstep_effects`), walls `0x28A0` (`unknown_player_touching_wall_maybe`). Face statistics over all 175 files agree: `0x01` faces point up, `0x20`/`0x800`/`0x2000`/`0x8000` faces are vertical.
- `CollisionWorld.move()` follows the client's outline: one ray along the motion (stop or slide), then 8 radial rays to push out of walls, then the ground probe. The frame is sub-stepped in 4-unit steps.

**Spawn points:** `TObjPlayerSet` (object type 0) entries in `map_lobby_NNo.dat` (inside `data.gsl`). `param1` is the client id, and there are 12 per lobby around the three sides of the central counter. `loadLobbyMapData()` reads them through `ClientFiles`. Other players are also drawn on their spawn until they send a position.

**Verified:**
- `tests/collision.test.ts`: all c.rel parse and every lobby has spawns for ids 0–11. Ground is found under all 220 `TObjPlayerSet` points in maps whose `o.dat` name matches a c.rel. The exception is `boss06`, whose four spawns have no c.rel floor (probably an object platform); the test skips it.
- In Chrome against newserv: spawn at (0, 20, 135) facing the counter, walking forward stops at the counter, and walking diagonally slides along it.

**Open:**
- The per-class hitbox radius and `bloodstain_z_offset` (5 and 10 for now).
- Collision of lobby objects (`o.dat` types 0x180+) is not loaded.
- The meaning of face flags `0x0100` and `0x4000`.

## 2026-10-16: enemy and object markers

**Goal:** show where enemies and objects spawn in the map viewer.

**What landed:**
- `formats/setdata.ts` parses `map_*e.dat` / `o.dat` (bare arrays of 0x48 / 0x44 entries, layout from newserv `Map.hh`), pairs them with the n.rel files, and places them in world space.
- Names come from a table generated from newserv (`tools/gen-entity-names.ts` → `formats/entitynames.ts`), plus a port of newserv's enemy switch for in-game names ("Savage Wolf" instead of `TObjEneBm5Wolf`).
- Map viewer: set data variant selector, "Show enemies/objects" and "Labels" checkboxes, hover tooltip (name, type, section, wave, local/world position), counts in the status line. Enemies red, NPCs cyan, objects yellow.

**Verification:** `tests/setdata.test.ts`
- Parses 840 files (339 in `data.gsl`, 143 loose, 358 from Tethealla's `map/`): 34,339 enemy and 71,298 object entries.
- 838 files, 105,607 entries match `newserv disassemble-free-map --bb` on type, name, room, floor, position, Y angle, wave/group. The 2 `*e_d.dat` files are skipped because newserv's CLI treats them as objects.
- All 3366 rooms of newserv's `room-layout-index.json` match the n.rel section positions, which confirms that `room` is the section id.
- In Chrome, forest 1 shows 67 enemies and 109 objects on the paths and clearings.

**Findings:**
- The pairing is not uniform: Ep2 `jungle01_00n.rel` uses `jungle01_NN` sets (no layouts), `darkfalz00n.rel` uses `boss04`, and the `map_a*` maps reuse the plain map's sets.
- newserv's nearest-entity chat command passes BAMS angles to `sin`/`cos` as if they were radians. It doesn't matter here (the port converts them), but it is worth reporting upstream.

## 2026-10-16: map entries, texture addressing, motions, handedness

**Goal:** close the open map-rendering gaps from Phase 3.

**Method:**
- Read the decomp's map draw loop (`map_nrel_process_chunk_static_meshes` and the animated loop), the loader, the render-state setters and the camera/projection code. They served as a specification.
- Read two data tables straight from `PsoBB.exe`: `g_StandardRenderStateSetters` at `0xa218c0` and the D3D enum table at `0xa21944`.
- Checked every claim against all 175 `map_*n.rel` with throwaway scripts.
- Checked visually in a scratch three.js page.

**Findings:**
- **The "0x10224" entries are indirect objects.** Flag `0x200` means the entry points at a 0x10 record `{object, runtime ind-tex, runtime f32, i16 id}`; `id` selects a row of `map_*i.bin` (waterfall/water distortion parameters).
  - 403 such entries were skipped before. Another 236 had been "parsed" as garbage objects.
  - All 639 now resolve: jungle07 entries 108/109 are its waterfalls.
- **Not every entry is drawn.** The PC client skips:
  - `0x100` entries: drawn only into the seabed/`boss06` planar-reflection texture.
  - `0x200|0x400` entries without `0x80`: a GameCube-only hook that is empty on PC.
  - Animated entries without a motion.
  - Together that is 1955 entries. They are now kept out of `objects`. Rendered model count: 133488 → 132169.
- **Entry fields** that were "unknown u32" are now decoded:
  - `+4`/`+8` (static) and `+0x14`/`+0x18` (animated) are an effect slot (flag `0x20`) and a `.tam` texture-animation record (flag `0x40`).
  - Animated entries carry `NJS_MOTION`, current frame and frame step. 11954 motions decode (position/angle/scale keys).
- **Texture address modes:** the table read from the exe maps 0 → clamp, 1 → mirror, 2/3 → wrap, and UV ranges in the data confirm it. `MaterialCache` now gives each (texture, wrapS, wrapT) its own `THREE.Texture` clone.
- **Material type 5:** the diffuse color becomes the constant vertex color of meshes without vertex colors. It never occurs in maps.
- **Material type 7:** camera-space texgen (environment map). It is parsed but not rendered.
- **Handedness: no mirroring.** The client's view and projection matrices are both right-handed (`LookAtRH`, `PerspectiveFovRH`), its rotations are standard, and the Pioneer 2 shop banners read correctly in our render.

**Open:**
- Apply motions (an AnimationMixer in the viewer).
- `.tam` texture animation, UV-scroll effect slots, env-map texgen, indirect-texture distortion.
- The section rotation order in `mapviewer.ts` should be `YXZ` (client `ZXY_ANG` mode); this only matters for two crater sections.

## 2026-10-16: player character models

**What landed:** BML reader, Ninja chunk (NJCM) model parser, skinned three.js builder, and `models.html`, a dev page that shows any of the 12 classes with costume/skin/face/head/hair/section ID/hair color. `node tests/players.test.ts` builds every class and variant.

**Findings:**
- Class letters A..L = class 0..11. Head, hair and cap hang from body node 59.
- Chunk models share one vertex buffer across the tree. Weighted vertices are accumulated by later nodes, and the body's polygons are cached at the root and drawn at the end. Replaying that walk gives skin weights for free; all strips resolve.
- `pl?nj.bml` aligns blobs to 0x800, `bm_ene_*.bml` to 0x20.
- Texture ids are per part. The appearance → `pl?tex.afs` mapping was rebuilt from contact sheets of each archive, with the PSO v2 lists of the dashgl/psov2 viewer as ordering hints, then checked by eye. Defaults look right for all 12 classes. Hat/hair texture lists of six classes are approximate.

**Next:** player motions (`plymotiondata.rlc`, NJM), and models in the lobby instead of capsules.

## 2026-10-16: classic UI, title screen

**Goal:** the title, login and character screens must look identical to the original client.

**Reference:**
- The psobb.io macOS build (a Wine wrapper) was pointed at the local newserv. It reads `LoginHost` / `PatchHost` from `psobb.cfg`; the original file is backed up as `psobb.cfg.psobbio-original`.
- Reference captures were taken with `screencapture` while driving the client with keystrokes: title, patch notice, SELECT CHARACTER, character creation, the "Connecting.." warp.
- The captures stay local (`client/public/ref/`, ignored by git).

**Findings:**
- The UI font is Tahoma: the client's `font_tahoma.reg` sets `FONT_JPN=Tahoma`.
- Loose files in `data/` override `data.gsl` entries; `ClientFiles` resolves names the same way.
- The BB title is `title.prs`. `title_eng.prs` is the GameCube Episode I&II title, and `TitleEP4.prs` is the Episode 4 variant.
- `title.prs` layout:
  - 0: "PRESS ENTER KEY" and menu labels.
  - 1–2: logo layers.
  - 3–10: background, 640×512 in tiles.
  - 11: magic circle.
  - 12: rings.
  - 13–20: background with the strong flare.
- The UI is laid out in a 640×480 virtual screen stretched to the window. `Stage` reproduces this with a Canvas2D transform.

**Matching method:**
- `window.classicCapture()` renders the stage at 2880×1800 and posts it to a dev-only `/__capture` endpoint.
- `tools/compare.sh` reports SSIM/PSNR (ffmpeg) against the capture, globally or per region.
- Parameters were chosen by grid search:
  - The flare layer drawn opaque was best on the left background (SSIM 0.83 → 0.90).
  - Circle: 385 px, centered at (345, 256), rotated -0.2 rad.
  - An additive beam with rays was added.
- Result: SSIM 0.716 → 0.732 and PSNR 18.8 → 19.4 for the whole frame. The remaining gap is mostly the beam/ray effect and the circle's glow.

**Note:** Chrome throttles requestAnimationFrame to 2 fps while its window is covered by another app. That is not a client bug; bring the window to the front when measuring.

## 2026-10-16: character creation and the lobby

**Method:** walked the flow live with a Node script against newserv, logging every command, then wrote `Lobby` and the session steps from what came back. Struct offsets come from newserv's `CommandFormats.hh` / `PlayerSubordinates.hh`.

**What landed:**
- **Session:** `BBSession.createCharacter` (E5 → E4) and `BBSession.enterLobby` (93 phase 4 → 07 menu → 10 "Go to lobby" → 67).
- **`Lobby`:** player roster (67/68/69), chat (06), movement subcommands (6x1F/20/3E/3F/40/42), with automatic 6x20 replies to 6x1F.
- **Lobby view:**
  - Loads `map_lobby_NNn.rel` for the lobby number.
  - Players are class-colored capsules with name tags.
  - Third-person camera.
  - WASD running sends 6x42 every 150 ms and 6x3E on release.
  - Ground height comes from a raycast against the render mesh.
- **Online tab:** slot cards with Create / Play, a creation form (name, class, live section ID), the lobby with player list and chat.

**Tests:**
- `tests/lobby.live.ts` runs two clients: A sees B join (68), B gets A's chat, run, stop and angle, and A sees B leave (69). 7/7 pass.
- `tests/bot.live.ts` is a bot that circles the first player and echoes chat.

**Verified in Chrome:** login → Play → lobby 1 rendered with the bot running around; chat round trip "hello bot" → "echo: hello bot". No console errors.

**Open:**
- The section ID uses the community formula (sum of name chars mod 10); confirm it against the client.
- Spawn points are approximated (first floor found near the origin).

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
