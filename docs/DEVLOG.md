# Devlog

## 2026-10-16: character creation rebuilt from the decompiled code

**What changed:** choosing an empty slot on SELECT CHARACTER opens a classic character creation screen (`client/src/classic/charcreate*.ts`) whose layout, sprites, timings and flow come from PsoBB.exe's TCharaMaking code. On confirmation the character goes out as `E5`. `?screen=create` in `classic.html` jumps there offline.

**How:** the whole range 0x004d0000-0x004f8000 was decompiled in one Ghidra run (a range script that also creates functions at every code pointer found in the data sections, 864 functions), then read top-down from the scene constructor. Tables were read straight from the exe with Python.

**Scene (FUN_004df9ec):** loads `charamakingmot.bml`, the texture list `ccconsole_e.pvm` (file `ccconsole_e.xvm`, 20 textures; FUN_004ea4a4, name table 0x009b75c0, list 0x009b8c20), plays `CHARA.adx`, creates the background (FUN_004ed18c), the heading pill (FUN_004eccc8), and either the class selection (FUN_004eb8fc, new character) or the dressing room (FUN_004e2f44, existing character). A 15+3 frame wipe opens the scene (FUN_004ec3c8).

**Sprites:** everything is drawn by FUN_004e9d8c(sprite, z, pos, scale, ARGB float color) and its wrappers (FUN_004e9eb8 white, FUN_004e9ef8 alpha only, FUN_004e9d1c scale + alpha, FUN_004e9f40 alpha + gray, FUN_004e9f8c scaled about the anchor). Sprite records are 0x14 bytes `{w, h, anchorX, anchorY, u0, v0, u1, v1, texture}`; UVs are in 1/256 of the texture (FUN_0082b6bc). Indices below 0x93 come from 0x009b76e0, the rest from a language table (0x009b8260 Japanese/Chinese, 0x009b8680 others). All 199 English records are in `charcreate_data.ts`. z orders the quads (more negative is further back).

**Class selection (FUN_004eb98c, state table 0x009b8d80):**
- State 0 picks the type (Up/Down wrap over 3; Enter or Right continues), state 1 the class within it (ranges at 0x0091d9c0; Esc or Left returns), state 2 waits 10 frames and copies the class default look (0x009b5f60, 0x70 bytes per class) with section ID 0xFF and an empty name (FUN_004eb7ec). List order (0x0091d990): HUmar, HUnewearl, HUcast, HUcaseal, RAmar, RAmarl, RAcast, RAcaseal, FOmar, FOmarl, FOnewm, FOnewearl.
- Widgets (FUN_004eba40), each with fade-in/out and highlight rates:
  - HUNTER/RANGER/FORCE tabs (FUN_004f5ff4): sprite 61+type at (33, 100 + 108 type), sliding 25 px in late in the fade, gray = 0.25 + 0.75 h².
  - Class rows (FUN_004f541c/5590/5890): y = 100 + 27 i, sliding from x = -242 to 58 with a (1 - cos)/2 easing staggered per row; colored square stretched x9.625, an 8x8 piece frame, class name sprite 0x4f+i at (x+5, y+9), face strip 0x5b+i at (169, y+3); the active name blinks with sin(frame << 9).
  - Type/class banner (FUN_004f5c54): colored bar 0x67+type and "Hunter"/"Humar" text 0xb4+i at (393, 82), popping from 1.15x.
  - Illustration window (FUN_004f62ac): 9-slice 0x82..0x8a over (307..607, 100..428).
  - Illustrations (FUN_004f67ec): per-class placement table 0x0091e640 (scale, z, x, y while the type is highlighted, x, y once chosen), eased by 1/4 per frame.
  - Description box (FUN_004f4a00): "information" label 0x8b+type at (310, 255), box at (310, 274) 294 x 150. Text (FUN_004f4e94): 7 lines from unitxt group 0x12 (type, 7 per type) or 0x13 (class id x 7) at (315, 280 + 20 n), fading in after 5 frames with blurred ghost copies.
- Key help (FUN_004f4128/424c/44fc): five items (0x009b9120: Tab CHANGE, Enter OK, Enter CONFIRM, Esc CANCEL, Esc BACK) right-aligned at x = 604, y = 443.
- Input (FUN_004f3b9c): directions repeat at frame 7 and then every 3 frames.

**Dressing room (FUN_004f0c10, update FUN_004eee18, render FUN_004ef530):**
- Background (FUN_004ed008): hexback tiles (textures 13-18) at x 0/256/384, then a quad from transparent at x = 140 to #181818 at 384, and #181818 (alpha 0xFF..0xEC) to 640.
- Heading (FUN_004ecb10/ecc24): gray pill sprite 0x36 stretched from x = 0 to a width that eases (12.93 px/frame max) toward heading width + 15 (100..294), cap 0x37, hex cluster 0x38 at (62, 67), heading at (27, 44) popping from 1.5x. Headings (0x0091db34): CHARACTER SELECT, CHARACTER CREATION, DRESSING ROOM, RENAME, VOICE EFFECT, then one per step.
- Steps (0x009b908c): humans and newmans FACE, HAIR, COSTUME, SKIN COLOR, PROPORTION, CHARACTER NAME, AUTO, OK; androids (class_flags & 0x10) HEAD, BODY, PROPORTION, CHARACTER NAME, AUTO, OK. Column (FUN_004efb84): hex 0/1 at (95, 80 + 44 i), bar 8/9 (10/11 selected, wobbling 9 sin(frame << 10)) from 115 to a width bucket, label 0x93+step at (144, 93 + 44 i).
- Step handlers (0x009b8fc0, {field, function}): list editor for head, face, costume, skin/body (FUN_004f04a8, counts per class at 0x009b5b60: humans 18 costumes, 4 skins, 5 faces, 10 hairs; androids 25 bodies, 5 heads), hair (FUN_004f070c: style row plus R/G/B rows, ±1 per press and ±5 per held frame), proportion (FUN_004f09d0: x wraps over 0..0.99, y clamps, 0.0133 per frame), CHARACTER NAME (FUN_004f0a80: generic text window, 12 units with `\tE`), AUTO (FUN_004f089c: Tab rolls a random look, hair color +64..192 per channel and proportions +0.125..0.5 glide over 30 frames), OK (FUN_004f0b80).
- OK needs a valid name (FUN_004e732c), computes the section ID once (FUN_004e7200, formula in PROTOCOL.md: the class is part of it), and shows the confirmation (FUN_004f00bc): TYPE / CHARACTER NAME / SECTION ID right-aligned at 243/242/202, values at x = 263, section icon 44+id at (212, 234), section name from unitxt group 72. Enter then sends the character after 7 frames. Esc in the step menu returns to the class list after 7 frames.
- The floor line (0x009b90d4) at y = 416..419: transparent at 275 to 50% #c7c7c7 at 400, then solid. The name is drawn right-aligned at (604, 396).
- The horizontal lines behind the model are 3D (FUN_004ea030): lines at y = 0 and 10..24 world units, #ffffa0 at alpha 24, shown only by the PROPORTION and AUTO editors. That matches the AUTO captures.

**Section ID fix:** `sectionIdForName` used the community formula (sum of characters mod 10). The client adds the class and a 0x2D/0x53 bonus at narrow/wide transitions (the first character counts as one). `sectionIdForName(name, charClass)` now follows FUN_004e7200, and the online tab passes the class. `createCharacter` also sends `version` 3, the class's `class_flags` and the "%10d" guild card string, as the client does.

**Model:** `CharacterModelView` (`charcreate_model.ts`: `setAppearance(classId, look)`, `setCamera(mode)`, `setVisible`, `setRuler`, `render`) is the hook for the player models being built in `render/playermodel.ts`. A three.js placeholder (capsule + head + hair cap, measuring lines, ortho framing fitted to the AUTO captures) renders into its own canvas, composited at z -100.

**Validation:** in Chrome on port 5186: class list, description text, illustrations, dressing room menu, hair editor, name, AUTO roll, confirmation (HUmar "souzajluiz" -> PINKAL) and the help items all render with no console errors. Against capture 04 (a fade-in frame where only the hex buttons are visible) the heading pill, hex cluster and the column of hex buttons line up. SSIM over the whole frame is 0.61, mostly because the step bars and labels are already shown in our frame.

**Open:**
- The right half of capture 04 shows the hex tiles through the dark band; with the decompiled colors drawn as normal alpha (0xFF at x = 384) they are hidden. The blend mode of FUN_0082b5d8's flag 0x60 is not traced yet.
- The soft keyboard of the name entry (FUN_0078eba4, at (53, 178)) is replaced by typing into a field; the word filter (FUN_00813f0c) is not reproduced.
- Exact sine arguments of a few pulses (info text ghosts), the idle demo after 900 frames (FUN_004e9640), the hex-shaped wipe (FUN_004ec000; drawn as a fade) and sounds (0x56f-0x57c) are not reproduced.
- Esc on the type list leaves creation; the original has no handler there.
- The camera values of FUN_004ea854 are not mapped to a projection yet.

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
