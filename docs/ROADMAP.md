# Roadmap

## Phase 1: foundation ✅
- [x] Build newserv on macOS (Apple Silicon)
- [x] BB cipher in TS, tested against newserv
- [x] PRS, GSL, AFS in TS, tested against newserv
- [x] WebSocket ↔ TCP bridge with port allowlist
- [x] Live BB login through the bridge

## Phase 2: browser client 🚧
- [x] Vite + TypeScript project
- [x] Login screen in Chrome via the bridge
- [x] Follow the `19` redirect and list character slots (`E3` → `E4`/`E5`)
- [x] Character creation (`E5` on the data connection → `E4` approve)
- [x] Character select → main menu (`07`/`10`) → lobby (`93` phase 4)
- [ ] Title, login and character select screens identical to the original client
- [x] `data/` folder picker (File System Access API) + dev-server source

## Phase 3: map viewer
- [x] REL parser (footer + root pointer)
- [x] XJ parser (BB models: vertex/index buffers, strips, render-state materials)
- [x] XVM/XVR decoding (DXT1, DXT3, R5G6B5, A1R5G5B5/A4R4G4B4 swizzled) to WebGL textures
- [x] Render `map_city00_00n.rel` (Pioneer 2) and Forest with orbit + WASD camera
- [x] Enemy/object markers from `map_*e.dat` / `o.dat` (parser checked against newserv on 838 files)
- [x] Identify the Episode 2 entries with flags `0x10224`: indirect objects (`0x200`), now rendered; entries the PC client never draws are filtered
- [x] Texture addressing modes (material type 4: clamp/mirror/wrap), material colors (type 5)
- [x] Decode animated map entries (`NJS_MOTION` layout)
- [x] Play map motions (animated entries: frame += step per 30 Hz tick, wrapped at the frame count)
- [x] Texture animation (`.tam`): UV-scroll effect slots and texture swaps
- [x] Env-map texgen (material type 7: camera-space normal * matrix 0x00a21800)
- [x] Area fog and light (`fogentry.dat`, `lightentry.bin`, fog regions from set data, fades)
- [ ] Water/indirect distortion (`map_*i.bin`)
- [x] Verify handedness: the client is right-handed like three.js, so no mirroring is needed

## Phase 4: online
- [x] Lobby: 3D lobby map, player list, chat
- [x] Classic lobby HUD from the exe: chat input (Space), word balloons with name tab, Log Window, Home main menu (labels, help, view shift), Item List, information counter menus
- [ ] Classic HUD: balloon overlap avoidance and off-screen docking, sub-menu transitions, Item List row format, counter/menu leaf actions, ship-select camera
- [x] Own movement sent via `6x42` / `6x3E`, ground-following on the map collision
- [x] Other players from incoming `6x20/3E/3F/40/42`, `6x1F` answered with `6x20`
- [x] Real lobby spawn points (`TObjPlayerSet` in `map_lobby_NNo.dat`) and collision (`*c.rel`)
- [ ] Collision of lobby objects (counters, props from `o.dat`) and the real per-class hitbox radius
- [ ] Real lobby spawn points and collision (`*c.rel`)
- [x] Character models: `pl?nj.bml` (NJCM) + `pl?tex.afs`, 12 classes, appearance (dev page `models.html`)
- [ ] Exact hair/cap texture lists for hat-wearing classes; non-default android heads
- [x] Player motions (`plymotiondata.rlc`: RelChunk + PRC + NJS_MOTION with short angle keys), town idle/walk/run tables from `PsoBB.exe`
- [x] Player models in the lobby instead of capsules, idle/run animation, facing the movement
- [ ] `proportion_x/y` scaling; field (per-weapon) motion tables; other town motions (emotes, sit)

## Phase 5: game
- [x] Collision (`*c.rel`): parser, ground probe, wall rays/slide (`render/collision.ts`)
- [x] Games: create (`C1`), list (`08`), join (`10` → `64`), loading (`1D`/`8A`/`6x3F`/`6x1F`/`6F`), join sync (`6x6D`/`6x71`/`6x70`), leave (`98` + `84`) (`net/game.ts`, `tests/game.live.ts`)
- [x] Floor maps from the `64` variations via `SetDataTableOn.rel`; Pioneer 2 and field floors with collision, player starts, enemy/object markers; warps (`6x21`/`6x22`/`6x23`) by button or area warp objects
- [ ] Full join sync for real-client joiners (`6x6B`/`6x6C`/`6x6E` need the entity expansion, `6x6F` quest flags)
- [ ] Enemy models (`bm_ene_*.bml`) and motions; Pioneer 2 teleporter menu, boss warps, doors; field BGM
- [ ] Enemies, combat (formulas in `notes/_wiki_combat_formulas.md`)
- [x] Full character file (`E7`): inventory, stats, bank, techniques (`net/charfile.ts`)
- [x] ItemPMT from the server stream file, item names and descriptions (`formats/itempmt.ts`, `formats/itemnames.ts`)
- [x] Inventory panel in the Online tab
- [ ] Item use/equip commands (`6x25`/`6x26`/`6x27`), item drops, item models (`ItemModel.afs`)
- [ ] Quests (opcodes documented in the notes and in newserv's assembler)
