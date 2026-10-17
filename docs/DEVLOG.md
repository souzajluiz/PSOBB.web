# Devlog

## 2026-10-16: title effects and the window renderer from the decompiled code

**What changed:**
- The title's light beam is now the original particle effects, not a drawing.
- The flash and the pulsing "PRESS ENTER KEY" are drawn as `PsoBB.exe` draws them.
- The Login menu and the login window use the client's generic window renderer and its textures. The renderer lives in `stage.ts` so other screens can reuse it.

**Light beam (effects 0x1e3–0x1e5):**
- `FUN_0050a0ec(pos, id, 1)` creates an emitter. Ids below 0x200 index `particleentry.dat` in `data.gsl` (512 entries of 0x98 bytes).
- Entries 0x1e3 `title_a`, 0x1e4 `title_b` and 0x1e5 `title_seiunn` hold all the parameters. Their textures are GBIX 700460 and 700151 of `effect_nt.xvm`, which are textures #5 and #43. The id-to-index table is filled from `effect_nt.gvm`'s texlist (code at 0x00501c4c).
- Emitter (`FUN_00508f58`): adds `number` (+0x44) to an accumulator each frame and spawns one particle per whole unit.
- `title_a`/`title_b` are type 2 (`FUN_0051145c`, update `FUN_0051095c`, render `FUN_00511004`):
  - they start at a random offset in a flat 10×1×10 (5×1×5) box around (0, 0, −47);
  - each frame they step |`vacume` + rand·`speed_x`| ≈ 0.2 units away from the emitter (`FUN_007a8f28`);
  - with `tex_flags` 4 they are drawn as streaks along the step's on-screen direction, 7·|step| (1.3·|step|) long and 0.05·|step| (0.03·|step|) high, through renderer type 4 (rotated quad).
  - Particles moving in depth give the fanned rays; particles moving sideways give the horizontal core.
- `title_seiunn` is type 0 (`FUN_0050ec4c`, update `FUN_0050dbb8`, render `FUN_0050e698`):
  - slow (0.08–0.12 units per frame) bluish clouds in random XZ directions, damped by 0.9969 per frame;
  - they live 350–650 frames;
  - they are drawn from the 4×4 atlas, with frame = round(15·age).
- Colours and fades follow the update code:
  - RGB = clamp(age·slope + base) × fade, with fade = min(age/+0x58, (1−age)/+0x5c);
  - the effect_nt renderers with flag 1 premultiply the fade, and the blend is SRCALPHA/ONE (`FUN_007a902c`, ninja blend 8/10).
- Projection (renderers at 0x801b40–0x802114):
  - screen = centre + (x, −y)·D/−z, and the sprite half-size is D/−z · 16 · size;
  - the title sets the screen centre to (124, 201) with `FUN_004d434c`, from constants 0x0096e27c/78 × the viewport scale;
  - D = 240·cot(fov/2) for the default perspective (`FUN_0082eea0`, angle 0x3555 → fov 57.5°, D = 437.44).
  - On the reference capture the rays converge at x = 124 of the stretched 640-wide screen, and the core sits at y ≈ 201.
- `f128_ray_left/right01..20` (`f128_ray.prs`) are **not** this effect. They are referenced only from 0x00410b7b, the pre-title logo/ad code.
- The simulation is deterministic (seeded MSVC-style rand) and replays from frame 0 when the clock jumps back.

**Flash (`FUN_006f475c`, frames 150–170 of 300):**
- k = frame%300 − 150, and the grey level is the low byte of trunc(255·(1 − k·4.2/20)).
- The value goes negative from k = 5 and the byte wraps, so the original strobes; this is reproduced as is.
- It is an additive quad of texture 12, UV (0.574, 0)–(0.824, 0.25), from (319.5, 199.5) to (185.6, 65.6). The corners are reversed, so the image is mirrored on both axes.
- The rectangle comes from 0x0096e1c0 (200), 0x0096e1c8 (320), 0x0096e1c4 (128), 0x0096e148 (−0.5) and the size factor 4.2 at 0x0096e154.

**"PRESS ENTER KEY" (title menu child, vtable 0x00b3eaf8):**
- `FUN_006ff0d4` draws entry 10 of the sprite set at 0x009cff00 + 10·0x20 through `FUN_0082b6bc`:
  - position (193, 338), scale 1;
  - a 256×32 quad with texels (0,0)–(255,31) of title texture 0 (UV = texel/256, clamped to 1).
- Material alpha = (sin(3°·(frame%120)) + 1)/2 (`FUN_006fede0`, frame%120 by the 0x88888889 multiply).
- In state 0, Enter creates the account object `FUN_007617e8`.

**Login window:**
- `FUN_007617e8` reads ACCOUNT/PASSWORD from the registry. Its `FUN_00761c48` builds the "Login" menu that psobb.io shows. It is the original menu, not a psobb.io addition:
  - `FUN_0073566c(&{210, 300}, 5, unitxt(41,2) "Login")`, size {220, 120};
  - items unitxt(41,3..6);
  - a fifth, unselectable item in colour 0xffffcc33 showing "[account]" or unitxt(41,7) "Empty" (`FUN_00761bc0`).
- The credential window is the "Input UserID" YesNo window (`CreateChatShortcutMenuYesNoWindow_0073840c(140, 330, 360, 100, 4)`):
  - "UserID" and "Password" label/value rows, with ':' at +154 and the value at +166 (`RenderInfoCounterEntity_0072e930`);
  - "Confirm" and "Cancel" centred at +202.5. `login.ts` now draws this window.
- Generic window renderer (vtable 0x00b40a38, render `FUN_007352d0`). The texlist is `f256_hyouji.prs` (`FUN_00712d14`).
  - Frame (`FUN_00710f80`):
    - a nine-slice of the 96×96 texel block of texture 1: 32×32 corners (half size when the window is under 64), tiles in steps of 32 with the last tile cut;
    - the height is rounded up to a multiple of 4.
    - The x87 code was checked by running the dumped instructions in a small numeric interpreter for several sizes.
  - Layout (`FUN_0071b900`, `FUN_0071bc28`): content = window inset by 10, plus 6 under a title. Items are 0x14 apart (`FUN_00735c90`).
  - Title pill (`FUN_00760b85`):
    - drawn at (x, y−13) (template 0x00974d00);
    - left cap 40×27, middle max(0, textWidth−112)+80 stretched from texels +20..+60, right cap +40..+80;
    - rows by state from 0x00974bf8: teal 98, orange 125, green 152.
    - The text is centred, 4 px below the pill top (`FUN_00760dac`).
  - Selection bar (`FUN_007120ec`): additive, texture 2, texels (151,57) orange or (151,76) green. The 16-px caps span x−2..x+14 and the right side mirrors it.
- psobb.io's widescreen patch draws these windows with a uniform scale, centred horizontally (`inWindowSpace`), while the background, logo and particles stay stretched. Both were measured on the capture: the window at x = 210 lands at 120 + 210·1.875 of 1440 px.

**Measured, not decompiled:** item text height and font size (Tahoma bold, 11 px virtual; rows centred 7.5 px below the row top), the selection bar height (16), and the selected item's text colour.

**Result:** full-frame SSIM 0.727 → 0.771, PSNR 20.4 → 21.2 (frame 885).

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
