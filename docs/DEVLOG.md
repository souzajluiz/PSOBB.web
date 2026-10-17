# Devlog

## 2026-10-17: real 3D characters in the classic screens

**What changed:**
- Character creation now draws the real player model (`buildPlayerModel` with the proportion morph) instead of the capsule placeholder. It is animated and seen through the creation camera decoded from `PsoBB.exe`.
- SELECT CHARACTER shows the selected slot's character, spinning, as `FUN_00406ab4` does.
- The `E5` preview parser exposes the visual config.
- New files: `classic/playerview.ts` (shared model, motion and projection code) and `classic/charselect_preview.ts`. `classic/charcreate_model.ts` was rewritten.

**Creation camera (object `FUN_004eb334`, vtable `0x00afd318`):**
- `FUN_004ea5a8` computes the eye: `+0x3c..+0x44` = (r·sin yaw, dist·sin pitch + height, r·cos yaw), with r = dist·cos pitch. The target `+0x48..+0x50` is (0, height, 0). `FUN_004d1ff4` copies eye, target and angle `+0x54` (0x438e) into the global camera.
- Pitch and yaw are eased to 0 (`FUN_007a8c74(a, 0, 0xc0)`), so the camera looks horizontally from (0, height, dist).
- `FUN_004ea854` (camera state 0):
  - the step's mode (0 = HEAD/FACE/HAIR/SKIN, 1 = PROPORTION/AUTO, 2 = other steps) is adopted only after it has been requested for 31 frames;
  - target distance and height: mode 0 = 0.5·h and 0.91·h; mode 1 = 25 and 11; mode 2 = 1.25·h and 0.55·h;
  - h comes from `FUN_004e68cc`: the class table `0x009b11e0` (value at proportion_y = 1, value at 0), lerped by proportion_y, which is reset to 0 outside 0..1;
  - each value moves with its own velocity (`+0x88`, `+0x8c`). The velocity grows by 0.003 per frame up to 0.1. Within 0.1 of the target it shrinks by 0.003, down to 0.00667, and it stops within 0.00667;
  - starting values: distance 30 and height 10.5 (`DAT_00a72230`), mode 2.

**Projection (`FUN_0082eea0` / `FUN_0082ebc8`, angle in ECX):**
- a = ((angle·85)/100)/2 in integer BAMS, read from the disassembly (`LEA`/`ADD` chain, then the `0x51eb851f` multiply).
- fovy = 2·trunc_BAMS(atan(tan(a)/1.1333334)). The result goes to `D3DXMatrixPerspectiveFov` with aspect 4/3.
- Angle 0x3555 gives fovy 57.49° (focal 437.5 px for 480 lines). Angle 0x438e gives 73.74° (focal 320.0 px).

**Two passes:**
- The model pass is `FUN_004e7824` → `FUN_004eb3b8`, `FUN_004e7844`, `FUN_004eb430`:
  - angle 0x3555, near 1, far 10000;
  - the viewport is shifted by ox = −128·(W/640)·k (`_DAT_0091d8f0` = −128). `FUN_0082f308` clips it to x = |ox|..W, so the projection centre sits at (W + |ox|)/2: x = 384 of 640 normally.
  - k (`DAT_00a72234`) is 1, except in the PROPORTION and AUTO editors (`FUN_004f2f28`, `FUN_004f2988`). Once their fade reaches 1, k drops by 1/30 per frame down to 0, which centres the model. While they close, k = max(k, 1 − fade).
  - The model is at the origin, turned by `DAT_00a72120` (0; analog rotation is not reproduced).
- The ruler (`FUN_004ea030`) is drawn by the editors in the 2D pass, after `FUN_004d2968` has reset the viewport to full and the projection to the camera's angle 0x438e (near 1, far 21000).
- The captures confirm both projections:
  - the ruler spacing in 05/06/07 is exactly 48 px per unit at 1800 lines (320/25·3.75), centred at y = 11;
  - the feet, drawn with the narrower angle, reach well below the y = 0 line;
  - in 08 the spacing is 51 px with the height already at 11, which is the camera still easing in from a mode-0 step.
- The ruler quad's color is #404040 in sRGB (it was a linear 0.25 by mistake). Its strip order and colors come from `0x009b8c28`.

**Motions:**
- Both screens load `charamakingmot.bml` (`FUN_004e9a68`, `FUN_004072b8`). Its 49 entries are plain NMDM chunks: an `NJS_MOTION` at +8, offsets relative to it, long-form angle keys.
- Both screens use the same 16-byte motion records (`0x009b1580` for creation, `0x009a2ec0` for select): {mode 1, next 0, entry, speed 1.0, flags 0}.
- Records 0/1/2 are the idle `B02` for male / female / FOmarl (entries 33, 1, 0). Records 3..5 are `B01` (31, 32, 30) and 6..8 are `C10` (47, 48, 46).
- The type is 0 when class_flags & 1 (`FUN_004e9370`), or on select when !(class_flags & 2) (`FUN_0040733c`). FOmarl (class 6) is 2.
- `PlayerAnimator` now takes any `MotionSource`, so these motions play through it.
- `tests/motions.test.ts` decodes the 9 records (2074 keys) and plays them on FOmar, FOmarl and HUnewearl.
- During creation, the section ID is 0xFF until the name is confirmed, so the emblem texture is the empty ring `'z'`: `buildPlayerModel` gained an `emblemSectionId` override.

**SELECT CHARACTER preview (`FUN_00406ab4` → `FUN_00406b50`, vtable `0x00af2308`):**
- Mode 0 (`FUN_0040680c`): position (17, −10.5, −40), Y rotation 0xf3d5, spinning.
- Update `FUN_00406bd8` is driven by the request `+0x100` set by the scene (`FUN_00413b84`): 1 on every cursor change, then 2 if the slot holds a character.
  - State 1 builds the model from the current character (`FUN_004eba6c`) and starts record 0/1/2.
  - State 2 waits for the model.
  - State 3 turns it by −0x100 BAMS per frame. Motion changes: B01 at frames 900 and 1800 (`FUN_00407008`), C10 at 1350 (`FUN_00406fc8`), and back to idle at 2250 (`FUN_00407048`).
  - Render `FUN_00407098` runs in state 3 only.
- The select scene sets no camera or projection of its own. The view is taken as the identity and the projection as the client default (0x3555) over the whole window. That puts the model at x ≈ 506 of the 4:3 screen (≈ 560 of the 16:10 window), to the right of the CHARACTERS box. **No capture with a character exists to confirm this.**

**Slot icons (`FUN_0040e004`):**
- A container (vtable `0x00af2c38`) holds one child per slot (`FUN_0040de04`, vtable `0x00af2c48`; count 4 from `0x008fa268`). `FUN_00401664(3)` → `FUN_0040e15c` sets them up.
- Each child is a 180×38 quad of `f256_player_tex` (u 0..0.703, v 0.594..0.742), the "TRANSFERRING DATA" bar:
  - it flies from (131, 182) to its slot in 14 frames at 1/15 per frame, alpha +1/15 (`FUN_0040df24`);
  - it fades out by 1/15 (`FUN_0040dfcc`);
  - it is drawn white with that alpha (`FUN_0040de9c`).
- The child draws only when the slot record's field +0xc is set. `FUN_006c44d0` writes 0 there, and that is the only reference to `DAT_00a95e3c`, so on Blue Burst the overlay never shows. It is implemented and kept hidden.

**`E5` preview:**
- `parsePreview` now also returns `classFlags`, `costume`, `skin`, `face`, `head`, `hair`, `hairColor` and `proportion` (shared config +0x24..+0x3c).
- Live, against newserv: account webtest has slot 0 = HUmar "WebHunter", proportion (0.5, 0.5).
- Characters made by older tools carry class_flags 0. The preview falls back to the class's own flags.

**Validation:**
- FOmar, costume 7, proportion (0.6, 0), AUTO step, compared with capture 05:
  - SSIM 0.741, PSNR 22.7 over the whole frame (0.722 against 07);
  - SSIM 0.656 on the model region (1440×900 crop 350×780 at 540, 60).
  - What remains: the hair style and face are not matched, lighting (the lobby rig; the screen's lights are not decoded), and the ruler drawn under the model rather than depth-tested against it.
- The model's size, position and the ruler line up with the capture.
- In mode 2 (e.g. COSTUME) the model sits at x = 1728 of 2880, which is (W + 576)/2.
- In Chrome:
  - the select screen with two offline slots shows FOmar and FOmarl spinning to the right of the box;
  - moving to an empty slot drops the model;
  - there are no console errors.
- `tsc`, `tests/players.test.ts` and `tests/motions.test.ts` pass.

**Open:**
- The camera and projection of the select scene; the lights of both screens.
- The analog model rotation (`FUN_004ef18c`) and the camera idle demo (states 1–4 of `0x009b8c60`).
- Under the widescreen patch, k = 1 (normal steps) shifts the viewport by 128·W/640 as the code says; no capture shows a normal step with a model.
- The creation screen does not cross-fade the model on look changes; it is rebuilt with the motion frame kept.

## 2026-10-17: enemy models and idle motions

**What changed:** the game view draws the enemies of each floor with their real models instead of markers (`render/enemyview.ts`), at their spawn position and rotation, playing their idle motion. `formats/enemymodels.ts` maps every set type (and the params that pick variants) to an archive, a model entry and a motion; `render/enemymodel.ts` loads the BML like the client (entries by position, textures shared by texture-list name, separate XVMs for texture swaps) and plays NJS_MOTION on the bones. Objects, NPCs and the two controller types without a model keep their markers. `formats/njmotion.ts` now decodes quaternion keys (Episode 4 motions) and standalone `.njm` files; `RelFile` can wrap a Ninja chunk body.

**From PsoBB.exe:** the per-area type → factory table `0x009fba60`, the asset descriptors (e.g. `0x009bb3f4`) and the loader `FUN_005b7a84`, the Ultimate (`FUN_00520e6c`) and low-detail (`FUN_00482a20`) archive choices, the rappy season table `0x009bbbc0`, and for each constructor the model choice, texture swaps and motion table slot (see PROTOCOL.md, "Enemy models", and the comments in `enemymodels.ts`). newserv's Map.cc comments were used to name params and cross-check the type names.

**Checks:** `tests/enemies.test.ts`: 94 archives match their descriptors; all 24304 enemy entries of the 235 Episode 1/2/4 free-play floor variations (online and offline tables) resolve for every difficulty, both detail levels and the seasonal events; 136 distinct models build with no missing textures and their motions play. In Chrome against newserv: Forest 1 (Booma, Wolf, Rappy, Monest), Cave 1 (sharks, Poison Lily), Jungle North (Merillia, Gibbon, Gee) and Crater East (Boota, quaternion motions) render textured and animated.

**Not done:** sub-objects drawn by separate objects (Dark Belra's arms, Sorcerer bits, Deldepth disc, Morfos arm, Recons, Pofuilly tails, Saint-Milion parts, Vol Opt phase 1), Recobox orientation, Sinow stealth, boss intro motions (the idle slot is shown), the server's rare flags (only param-driven variants), De Rol Le / Barba Ray fins and tentacles.

## 2026-10-17: character file, item table and item names

**What changed:** the full character file (`E7`) is parsed (`net/charfile.ts`) and exposed as `session.character` after `enterLobby`: inventory with equipped markers, stats, level/EXP/meseta, bank, guild card, play time, technique levels, mag stats. `BBSession.streamFiles()` downloads the BB stream file (`04EB`/`01EB`/`03EB`/`02EB`), which is where the BB client gets `ItemPMT.prs`. `formats/itempmt.ts` is a port of newserv's V4 ItemPMT reader; `formats/itemnames.ts` names items from ItemPMT ids + unitxt and formats them like newserv's `describe_item`. The Online tab shows an Inventory panel under the lobby.

**Checks:** `tests/items.test.ts` parses the ItemPMT newserv streams (rebuilt with `newserv encode-item-parameter-table` when no ItemPMT file is given) and compares 36124 values over 1536 item definitions plus specials, stat boosts, star values, max tech levels, tech boosts, combinations, mag feed tables and sale divisors with `item-parameter-table-bb-v4.json`: no mismatches. Names for 1515 item codes match `names-v4.json` (4 entries where newserv corrected the game's text are checked against the game's text). `tests/charfile.live.ts` logs in, downloads the stream file, joins the lobby and prints the character (WebHunter: Saber, Frame, Mag LV5, Monomate x4, Monofluid x4).

**Finding:** ItemPMT ids and unitxt must come from the same build. The local Ephinea client's text tables do not match newserv's ItemPMT (Saber is unitxt entry 156 in `data.gsl:unitxt_e.prs`, 289 in Ephinea's loose `unitxt_j.prs`, 177 in newserv's). With newserv, the original client would show wrong item names for the same reason. The panel falls back to newserv's bb-v4 text set on the dev server.

**Not verified against the exe:** the description format is newserv's; the client's own item-name formatting function was not traced in Ghidra yet.

## 2026-10-17: classic client from SELECT CHARACTER into the lobby

**What changed:** choosing an existing slot in `classic.html` now runs the original flow: the "Connecting.." warp, the game-server login (93 phase 4), the server's main menu as the client's **Ship Select** window over the 3D lobby, `10` *Go to lobby*, `67`, and the 3D lobby (`render/lobbyview.ts` on a WebGL canvas under the 2D stage) with the lobby name window. Checked live in Chrome against newserv: warp, Ship Select, lobby, walking with W, chat send/receive (other players' chat and joins show in the log). `tests/lobby.live.ts` still passes.

**"Connecting.." and the warp (`classic/connecting.ts`, `classic/particles.ts`):**
- `FUN_007bd97c` is a modal loop around the connection. `FUN_004178f8` builds a 3D scene and the warp object `FUN_004179e8` (vtable 0x00af3738). It fades in from black (`FUN_00409d28` mode 2 → `FUN_0040a080`: alpha 1, −1/15 per frame).
- The warp object's update `FUN_00417ccc` fixes the camera at the origin looking down −Z (`FUN_004d31f4(9)`, `FUN_004d33c0`). On its second frame it creates `FUN_00418794`, which has two children:
  - `FUN_0040bf40`: particle effects 0x13 `load_blue`, 0x15 `load_yellow`, 0x17 `loadhikari`, 0x1d `load_circle`, 0x6e `load_red` (ids at 0x008f9ec8), 100 units ahead (0x008f9edc), rotations (0x4000,0,0) except 0x17 (table 0x009a3104);
  - `FUN_00417f90`: 0x16 `load_carsol` at 65 units (0x008fb12c).
- All six are particle type 0 (spawn `FUN_0050ec4c`, update `FUN_0050dbb8`, render `FUN_0050e698`):
  - velocity (rand·+0x38 + +0x30, rand·+0x3c + +0x34, 0), turned by a random angle about Y, then by the emitter rotation. The quarter turn about X makes the rays fan out in the screen plane and fly toward the camera;
  - x/z damped by +0x50, y += +0x54, size ×= +0x2c;
  - tex_flags & 4 → streak of length +0x64·|step| and thickness +0x68·|step| (note: +0x64/+0x68 here, +0x60/+0x64 for type 2);
  - textures by GBIX of `effect_nt.xvm` (785981 = #18, 700531 = #9, 700420 = #24). `XvrTexture` now carries `gbix`.
- "Connecting.." object (vtable 0x00af2438, ctor `FUN_00407bf0`): render `FUN_00407f6c` draws "Connecting.." at (23, 331) while state < 3. `FUN_00408200` sets state 2 with the result, and update `FUN_00407c6c` waits 150 frames before state 3 (errors from unitxt group 0x36, `FUN_004080ac`). The screen keeps the warp for 150 frames after the server answers, like the original.
- The result matches capture 09 of the original (rays, colors, centre, text position) by eye.

**Ship Select (`classic/shipselect.ts`):**
- 07 handler at 0x0079ba38: entry 0's name is compared with `L"BLOCK"`; the window title is the client's `L"Ship Select"` (0x0097ce50) or `L"Block Select"` (0x0097ce68). See PROTOCOL.md.
- List window: `FUN_0073fdc4` → `FUN_0073fe9c` → `FUN_00736988`, at position-table entry 0x28.
  - Position table: `FUN_0073ec50(i)` = 0x00971f40 + 8·i, {x, y} floats. Entry 0x28 = (12, 50).
  - Size 385 × 184 from `FUN_00737f80` (0x00972dd4); the other modes are 385 × 104 and 300 × 104.
  - Items 20 px apart (`FUN_00737cdc`), left-aligned 10 px in, 6 px below the title (measured).
- Info window: `FUN_0079bb58` → `FUN_0079a8c4` → `FUN_0073a888` at entry 0xd5 = (294, 305), 342 × 144. It types unitxt 0x0F/0. `FUN_00793168(i)` is unitxt group 0x0F and `FUN_0079317c(i)` is group 0x0B.
- Measured against the capture of the original:
  - menu frame at x 13.2, y 51.6 (decoded 12, 50), 383 × 181 (decoded 385 × 184);
  - info window 340 wide (decoded 342).
- Widescreen (psobb.io): windows keep a uniform scale by height. Windows whose centre is on the right half move right by the extra width: the info window lands at 294 + 128 and the lobby window at 622 + 128 on a 768-unit screen. `classic/ingame.ts` does the same.

**Lobby (`classic/lobby.ts`):**
- Lobby name window: `FUN_0079eb78` formats `"%s:%02d-%02d"` (0x0097cef0) from the ship name, the block and lobby + 1. `FUN_0073f510` shows it in a 160 × 27 window (0x009f340c) whose right edge is at table entry 0xc0 = (622, 37). It shows "newserv:01-01" as on the capture.
- BGM: `LOBBY.ADX` for Ship Select and the lobby (`FUN_00642c30`); silence while connecting.
- `LobbyView` gained two small additive hooks: `{ labels: false }` (no 3D name sprites) and `playerPositions()` for 2D name tags. The Online tab is unchanged.

**Keyboard (default key config):**
- newserv's `default-keyboard-config.bin` (0x16C bytes, the client's `key_config`) is a list of `{u32, key id}` pairs. They follow the order of the key-config labels in unitxt group 0: Move Forward/Backward/Left/Right, Lock Move Forward, Lock Walk Forward, Decide, Cancel, Menu Open/Close, Start, Select Up/Down/Left/Right, …
- Key ids are named by the table at 0x0097b5e0 (`{id, L": NAME"}`): 0x26 W, 0x22 S, 0x10 A, 0x13 D, 0x61 ENTER, 0x50 BACK SPACE, 0x06 HOME, 0x59 SPACE, 0x5c–0x5f arrows, 0x40–0x4b F1–F12, 0x2a–0x33 1–0.
- So the defaults are: W/S/A/D move, Enter decides, Backspace cancels, Home is the menu, Space is Start, and the arrows select. The classic lobby moves with W/S/A/D only; the arrows no longer move the player there.

**Approximations (marked in the code):**
- The camera behind Ship Select slowly circles lobby 1. The original camera path is not decoded.
- The info text types 2 characters per frame (fitted).
- Ship Select fades in over 15 frames (fitted).
- The chat log (bottom left), the chat input window and the name-tag offset are provisional; their code is not found yet. The chat input opens with Space or Enter.

**Open:**
- The chat log, chat balloon and chat input code. The chat trigger key is probably "Start" (Space) but is not proven.
- The lobby menu (Home) and the info counter menus.
- The ship-select camera.
- Where the `DAT_00a48a3c` mode that picks the list size is set.
- Fresh lobby captures of the original could not be taken this session: the display was asleep, so screencapture returned black frames.

## 2026-10-17: area fog and light

**What changed:** the map viewer applies each area's fog and light the way `PsoBB.exe` does. New parsers `formats/fogentry.ts` and `formats/lightentry.ts`; `MapViewer.setArea(source, area)` (called by `load`) sets the base fog and the light, `setFogRegions(placed)` takes the fog regions from the set data, `setFogOverride(id)` switches like a region does, and `fogProbe` says where "the player" is (the orbit target by default; the lobby sets its own player). The lobby now uses the area light instead of its own lights. Map entries with flag `0x1` are drawn without fog. Details in PROTOCOL.md (Area fog, Fog regions, Area light).

**How the fog works:** a fog object with four slots (base, override, staging, blend). The area start sets the base slot from the table at `0x009c1ec0` (fog id per area). Fog-region objects register their id every frame while the player is inside their sphere; the per-player manager switches the override in, or back to the base when nobody registered. Fades blend color, start and end over `1 / fade_step` frames (100 frames = 3.3 s for 0.01). Some entries wobble start/end with a sine. Render states are plain linear table fog (`FOGSTART`/`FOGEND` clamped to ≥ 0), which is what three.js `Fog` does.

**Checks:** `tests/fog.test.ts` (fog/light values, wobble, fade length, region enter/leave). In Chrome: Forest 1 green haze (`0x80ffaa`, 0..2000), Caves 1 orange (`0xff7000`, 156..791), Mines 1 pale blue (`0xe1e2ff`, 100..4000), Ruins 1 dark green (`0x0d4015`, 0..1193 with the wobble frozen at switch time). Walking the orbit target into the Caves 1 switch room (`TObjFogCollisionSwitch`, radius 240, fog 0x11) fades to the black dark-room fog in about 3 seconds.

**Open:** the sign convention of the light direction (treated as "toward the light", which makes the default `(0, 0, 1)` a headlight); the clear color behind the fog (kept as the viewer background); which areas set `FUN_0078b220()` (alternate fog file and light set); per-room `TObjLight` overrides; switch state (all switches are off in the viewer).

## 2026-10-17: games: create, join, Pioneer 2 and the field

**What changed:**
- `net/game.ts`: games from the lobby. Create (`C1`), list (`08`), join (`10`), the join command `64`, the loading sequence, the state sync to a joining player, warps between floors and leaving to the lobby (`98` + `84`).
- `formats/setdatatable.ts`: the client's `SetDataTableOn.rel` / `Off.rel`, which turns the variations of `64` into map files.
- `render/gameview.ts`: loads the floor the player is on (render map, collision, player starts, enemy and object markers) and warps when the player walks into an area warp.
- Online tab: a Games box in the lobby (create, refresh the list, join), then Warp and Back to lobby in the game.
- `tests/game.live.ts`: two Node clients. A creates a game; B lists and joins it; both see each other; both move (`6x42`, `6x40`, `6x3E`); A warps to Forest 1 and B follows; both return to the lobby; the empty game is deleted. `tests/setdatatable.test.ts` compares the table parser with newserv and resolves every free-play floor.
- The full write-up is in PROTOCOL.md, section "Games".

**How the flow was established:** newserv's server code tells what it accepts, and its `tests/*.test.txt` captures show what a real client sends. They are GC sessions, but the command and subcommand numbers are the same as BB.
- `GC-ForestGameRareMagFeed`: a player creates a game alone and warps.
- `GC-XB-CrossplayForestGame`: a second player joins. The leader sends `6x6D`, `6x6B`, `6x6C`, `6x6E`, `6x6F`, `6x71` and `6x70` to the joiner.

`seq.py` (scratch) turned the captures into command sequences.

**Findings:**
- **newserv holds the joiner's commands until it answers `1D`.** It sends `1D` right after `64`, and queues the other players' sync commands until the reply comes. A client that ignores pings never sees the others.
- **Joins are serialized by the loading flag.** A second player gets `01` "another player is currently loading" until the first one has sent `6F`. The server answers `6F` with `B1`; `Game.ready` resolves on that `B1`.
- **On BB the server sends `6x72` (resume), not the leader.** It goes to everyone except the joiner, once the leader's `6x70` has arrived.
- **The state sync is strict.** newserv records which sync subcommands it expects from whom, and disconnects a client that sends one it did not expect.
  - It also checks the entity counts in `6x6B`, `6x6C` and `6x6E` against every floor's map, including enemy children. The web client therefore sends only `6x6D`, `6x71` and `6x70`.
  - `6x6D` holds the next item ids, 0x00010000 + 0x00200000 × client id + the items each player has used. newserv now logs that they match.
  - The BC0 payload is a literal-only stream.
- **`64` has no appearance data.** It carries `PlayerLobbyDataBB` only (names, guild cards), in slot order. Classes and appearance arrive later in each player's `6x70`. The view then rebuilds the model; the first frames show a capsule.
- **`98` must carry real records.** For BB, newserv takes the battle and challenge records, choice search, info board and blocked senders from `98`, so zeros would wipe them. They are copied from the `00E7` save data. `BBSession.fullCharacter` keeps the latest `00E7`.
- **Map files:** `SetDataTableOn.rel` maps (area, layout, entities) to an object basename, an enemy/event basename and an area setup name.
  - The geometry is the setup name + `n.rel`, or + `_00n.rel` for `map_city00`, `map_labo00` and the jungles. `map_boss04` uses `map_darkfalz00n.rel`.
  - The table also lists quest-only layouts (Cave 03–05). The server only picks within newserv's free-play counts.
  - All 235 free-play variations of Episodes 1, 2 and 4 resolve to files that exist in Ephinea's client.
- **Player starts:** `TObjPlayerSet` `param4` is 0 when arriving from a lower floor and 1 when coming back. In Forest 1, the 0 set is next to the warp from Pioneer 2 and the 1 set is next to the warp to Forest 2.
- **Area warps:** `TObjAreaWarpForest` keeps the destination floor in `param4`. Walking within 12 units of one warps the player. The Pioneer 2 teleporter (`TObjCityAreaWarp`) goes to floor 1, since its destination menu is not implemented.
- **Name length:** newserv keeps 14 characters of the game name, so the UI limits names to 14.

**Lobby/view hooks (additive):**
- `Lobby` gained `detach()` / `attach()`, `selfEntry`, extended-header subcommands, the `6x1F` floor, and the `floorChanged` event.
- `LobbyView` gained a `showPlayer` filter, which hides players on other floors and players made invisible by `6x22`.
- `LobbyView` now ignores events after `dispose()`. Its `Lobby` listeners outlive it, and the game reuses one `Game` across floor views.

**Checked in Chrome:**
- Create a game, then Pioneer 2 loads: 30 objects, 23 NPC sets, the player on its start point.
- A Node bot joins: the FOmarl model appears, runs around and chats.
- Warp to Forest 1: `map_forest01n.rel` with `map_forest01_02o.dat` / `e.dat` (111–120 objects, 59–69 enemy sets, depending on the variation).
- Back to lobby: lobby 1 again, and the game list is empty.

**Open:**
- Enemies are markers. Models from `bm_ene_*.bml` and their motions are next.
- The full sync for real-client joiners: `6x6B`, `6x6C` and `6x6E` need the client's entity expansion; `6x6F` needs the quest flags.
- The Pioneer 2 teleporter menu, boss warps (`TObjWarpBoss`), in-floor map warps (`TObjMapWarpForest`) and doors.
- Field BGM. The area track names are in the exe; only the lobby and city tracks are mapped so far.
- Ultimate Episode 1 uses `SetDataTable*Ulti.rel` on newserv, but that table is not in Ephinea's client. Whether Ultimate uses the `map_a*` geometry is not verified.

## 2026-10-17: sound effects from data/sound/*.pac

**What changed:** the classic UI now plays the game's sound effects. `formats/sepac.ts` parses the banks, `audio/se_tables.ts` is generated from the exe by `tools/gen-se-tables.py`, and `audio/se.ts` (`SePlayer`, plus a shared `se(id)`) plays them with Web Audio. The title, login window, character select and character creation call `se()` wherever the decompiled code calls `FUN_00814298`. Details are in PROTOCOL.md, "Sound effects".

**Format:** a bank is a run of 32-byte aligned waves. Each has a 0x20-byte header (PCMWAVEFORMAT, 12 leftover RIFF bytes, PCM size at `+0x1c`), then the PCM. The exe's per-bank offset records (`0x00a215e0`) match a walk of the file for all 26 banks. `tests/sound.test.ts` parses every bank: 1818 waves, 2524 s in total, each bank's count equal to the exe table's, and every loop point inside its wave.

**Engine:** an SE id maps to a slot (`0x00a1f840`), and a slot to a wave of `common.pac` (always loaded) or of the area bank (`0x00989e60[area]`; area 0 = `city.pac`, loaded at start-up and on the character screens). Volume is `round(f³·6400)` hundredths of a dB with `f = (1 + a/127)(1 + master/127) − 1`, where `a` is the slot's attenuation byte. There are 64 voices; a slot without flag bit 28 cuts its own previous voice. PC buffers have no pan or pitch control.

**Checked in Chrome:** `common.pac` and `city.pac` load into 222 slots. Every UI id (0x56f, 0x570, 0x571, 0x573, 0x575, 0x57c, 0x585, 0x420) resolves to a wave and starts a voice once the first key press unlocks audio. The cursor wave is 3107 frames at 22050 Hz with an RMS of 0.37.

## 2026-10-16: select character screen from the decompiled code

**What changed:** `classic/charselect.ts` is now built from what `PsoBB.exe` (Ephinea 1.25.13) does. Before, it was laid out by hand from a capture. A new `classic/gametext.ts` reproduces the game's 2D text layout. SSIM against the psobb.io capture went from 0.487 to 0.920 (PSNR 18.4 → 28.1), measured at the same backtext animation frame.

**The scene:** scene 6 of the scene switch `FUN_0081aac8` is `FUN_004135e0` (vtable `0x00af3370`, state table `0x009a3738`). Its children, in creation order:

| Object | Constructor / vtable | Render | What it draws |
|---|---|---|---|
| background | `FUN_004010b0` / `0x00af2028` | `FUN_004010e4` | black quad, then `f256_ad_pic_2` tiles via `FUN_00415bcc` (table `0x009a3840`, the same 640×512 layout as the title), additive |
| backtext | `FUN_004012cc` / `0x00af2060` | `FUN_0040131c` | additive quad (0,0)–(639,479), texture = counter / 3, counter 0..14 (`FUN_00401304`) |
| header | `FUN_00415154(row 0)` / `0x00af3500` | `FUN_004154b8` | 8 additive copies of the 512×40 `f512_midashi` row, color `0x1fffffff` |
| UI builder | `FUN_00401504` / `0x00af20c0` | states `0x009a2d68` | tags, slot bars, slot text, frame lines |
| message | `FUN_0040b72c` / `0x00af2810` | `FUN_0040b85c` | two centered lines |
| slot list | `FUN_004121f0` / `0x00af3158` | `FUN_00412800` | cursor bars; owns the scrollbars (`0x00af2ff8`, `FUN_00411828`) |
| help keys | `FUN_0041571c` / `0x00af3538` | `FUN_004158ec` | key caps and labels |

The 3D preview (`FUN_00406ab4`) and the per-slot icons (`FUN_0040e004`, drawn only for existing characters) are not reproduced yet.

**Blend modes:** `FUN_0082acfc(0|1, n)` sets the source and destination blend through the table in `FUN_00837468`. 8 → SRCALPHA, 10 → ONE, 6 → INVSRCALPHA. So `(8, 10)` is additive, which the canvas does with `'lighter'`. `FUN_007a902c` sets additive and `FUN_007a9044` restores normal blending. `FUN_0082bb60` takes the texture index in ECX and the vertex ARGB in EDX (read from the disassembly).

**Frame lines are data:** `FUN_004088b8(parent, id)` instantiates entry `id` of `CAdDrawLineTask.prs` (`FUN_00408c20`). The file `addrawlinetask.prs` is a REL file whose root is an array of `{count, pairs, primitives}`. Each primitive is 0x2c bytes: `{index, x0, y0, z0, ARGB0, x1, y1, z1, ARGB1, speed, width}`.
- A segment (`FUN_0040840c` / `FUN_004089f8`) grows by `speed` = 40 px per frame and is a quad `width` = 2 px wide.
- When a segment completes, it starts the segments chained to it (pair `(a, b)`). Pairs `(-1, b)` start at once.
- Entries used here:
  - 8, the header lines, created by the header;
  - 9, the footer lines, created by the message;
  - 0xb, the CHARACTERS box and tag outline;
  - 0x1c, the green panel (`0xff4da55f`).
- The other lines are `0xff368bbc`.
- Ephinea ships a loose `addrawlinetask.prs` whose right ends are at x = 853 (16:9). The `data.gsl` copy has 640, which is what the reference capture shows, so the values are taken from the `data.gsl` copy.

**Values (640×480 virtual space, 30 frames per second):**
- **Header** (`FUN_004153d4`): rows are 40 px in a 512 texture (`0x008fadac` / `0x008fada8`). Copy `i` is at x = 64 − (10 − t)²·k[i], with k = ±{1, .8, .6, .4} (`0x008fad68`), y 43..83, t = 0..10. The text drawn by `FUN_004155f0` at (620 − width, 86) is not visible in the capture.
- **Tag** (`FUN_00414d60`, `FUN_00414c94`, `FUN_00402750(0)`):
  - tag 0 of `f256_tag` at (134, 118), 174×32 (`0x008fad1c`/`0x008fad20`);
  - u 0..0.6797, v row·32/256;
  - additive, alpha +1/15 per frame.
- **Slot bars** (`FUN_00401664(0, 0)` → `FUN_0040d3ac`, render `FUN_0040d6f8`):
  - 180×38 at (131, 182 + 43·i) (`0x008f86b8`);
  - RGB(54, 188, 136), additive, alpha 0.05 per frame up to 119/255 (`0x008fa1ec`/`0x008fa1f0`);
  - they fly from slot 0 in 15 steps.
- **Slot text** (`FUN_0040e694`):
  - the name (unitxt group 0x39 entry 0 "NEW CHARACTER" when empty) at the bar origin;
  - "LV%d" (0x39/1) right-aligned 20 px lower;
  - each has a 0x111111 shadow at x + 1;
  - alpha +1/15 per frame.
- **Cursor** (`FUN_0041245c`, `FUN_00412800`):
  - drawn from `f256_ad` texture 0 (`DAT_00a3b09c`, loaded at `0x00412954`), additive;
  - three quads 16 | 148 | 16, v 224..242;
  - u 0/16/32/48 for the orange bar, 49/65/81/97 for the green "chosen" bar (`DAT_00a3b088` = 16 at `0x00412948`);
  - the cursor slot is set to alpha 255 and the others lose 25 per frame. The capture matches alpha ≈ 100 on the previous slot, i.e. it was taken about 6 frames after the cursor moved.
- **Scrollbar** (`FUN_00411828`): RGB(37, 236, 0), alpha +1/15 per frame. Its geometry is set somewhere not found yet; x 314, y 182, 3×55 are measured from the capture.
- **Message** (`FUN_0040b7d8`):
  - unitxt 0x1f/0 "Please select character." at y = 370 (+20 for the second line);
  - x = (640 − width) / 2 (`0x008f9e8c`/`0x008f9e88`);
  - alpha +25 per frame.
  - On the widescreen reference the line is centered on the whole window (768 virtual px at 16:10), so the patch must replace the 640. A residual offset of about 3.5 px remains.
- **Help keys** (`FUN_0041571c`, `FUN_004157c4`, `FUN_0041594c`):
  - 32×32 caps from `f256_player_tex`: Enter UV (122, 210), Esc (162, 210);
  - at (156, 421) and (299, 421), set by `FUN_004135e0`;
  - slide in from x = 640 as (640 − x)·(20 − t)²/400 + x;
  - alpha from 0x33, +12 per frame;
  - labels unitxt 0x31/0, 1 at (x + 32, y + 8).
- **Text** (`FUN_007ab554`, `FUN_007ac344`):
  - glyphs are drawn at virtual resolution with a 14 px cell (`0x0097db84`);
  - a space advances 7 px (`0x0097db7c`) and a newline 20 px (`0x0097db78`);
  - the width is the sum of the glyph advances;
  - the last argument (0.4/0.5) is the quad's depth, not a scale.
  - The face is fitted. Every string width in the capture matches Arial bold 11 px (NEW CHARACTER 102, "Please select character." 131, Enter 28, Cancel 36). Tahoma does not match, probably because psobb.io runs under Wine and falls back to another face.

**Validation:**
- `tools/compare.sh` against `select.png`: SSIM 0.920, PSNR 28.1.
- The best backtext frame is texture 1 (SSIM 0.917 vs 0.87 for the other four), which confirms the animation and its additive blending.
- Region SSIMs:
  - slot area 0.87, or 0.92 with the previous slot's fade set to alpha 100;
  - keys 0.89;
  - header 0.93;
  - message 0.39 (the 3.5 px offset).

**Open:**
- Where the scrollbar geometry and the 640 → 768 centering come from.
- Why the header text is invisible.
- The timing of the UI builder states, which gate when the tags and lines start. They start at frame 0 here.
- The 3D preview and slot icons for existing characters.

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

## 2026-10-16: animated players in the lobby

**Goal:** decode the player motions and replace the lobby capsules with animated character models.

**Container:** `plymotiondata.rlc` is a big-endian `RelChunkVer0.20` table of 572 PRC entries (PRS + PSO V2 cipher, newserv's PR2/PRC). Each is a REL with one `NJS_MOTION` for the 64-node body. Format in PROTOCOL.md.

**Findings:**
- Angle keys are 8 bytes (`u16 frame`, `i16` BAMS), not the 16-byte keys of map motions; the motion headers are identical (type 3, inp 2). The key lists tile each file exactly, which confirmed the size. Key lists at REL offset 0 have a 0 pointer, so a list is present when its count is non-zero (`njmotion.ts` now does this for maps too; all 11954 map motions still decode).
- The motion numbers come from `PsoBB.exe` tables. A per-player motion set object (player+0x38c) maps class → motion type (6 types), and in the town/lobby folds them into 2 sets with 56 slots. Idle/walk/run are slots 0/1/2 (3/4/5 for FOmarl). The tables (rlc index, mode, next, speed, flags) are copied into `formats/plymotion.ts`.
- Playback speed: record speed per tick, ×1.5 in the run state. Motion changes cross-fade over 5 ticks.

**Lobby:** `LobbyView` loads `pl?nj.bml`/`pl?tex.afs` per class (cached) and builds each player's model from the appearance in `67`/`68` (`LobbyPlayer.appearance`). `PlayerAnimator` plays town idle while standing and run while moving (walk after a `6x40`), for the local player and the others. The capsule stays as a stand-in until the model has loaded. Lights were added for the Lambert player materials, and the camera moved closer (70 units).

**Verified:** `tests/motions.test.ts` decodes all 572 motions (184,944 keys), checks every town table entry, and plays idle/walk/run on all 12 class models. In Chrome against newserv with the bot: HUmar idles at the spawn facing the counter, runs and turns with WASD and returns to idle on release; the RAcast bot runs between points.

**Open:**
- `proportion_x/y` are parsed but not applied.
- The 30 ticks/s rate is assumed. The game's run speed may be 8 units/tick (`DAT_00a94320`, used as `sin/cos × 8`), while the lobby moves at 120 units/s.
- The field (per-weapon) motion tables, emotes and other town slots are not used yet. Spline interpolation is not implemented (no player motion uses it).

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
