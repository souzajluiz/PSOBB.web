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
- [x] Enemy models (`bm_ene_*.bml`, boss archives) at their spawn points with their idle motions, variants by params/difficulty/season (`formats/enemymodels.ts`, `tests/enemies.test.ts`)
- [ ] Enemy sub-objects (Belra arms, Sorcerer bits, Deldepth disc, Vol Opt phase 1, Saint-Milion parts)
- [x] Floor music: area table, Pioneer 2 / Lab BGM zones, interactive field music (chained Ogg segments, calm/battle sequencer), boss tracks
- [x] Warp menus (Ragol teleporter per episode, area and boss warps, lobby teleporter); door and switch logic with `6x05`
- [x] Door, warp, switch and box models from the per-area object factory (`formats/objectmodels.ts`, `render/objectview.ts`), door motions and door collision
- [x] Wave events: the floor's `.evt` (`formats/events.ts`), the wave state machine (`render/waves.ts`), `6x67` / `6x76` sync, enemies appearing per wave, battle music while a wave of the room is alive
- [x] Laser fences and their switches, the recovery ring and the second boss warp class; the volumes that draw nothing (fog, events, room ids, sounds, camera) are counted as invisible instead of missing
- [ ] Remaining object models (Pioneer 2 shops and their doors, the Lab city warps, jungle rocks, traps, Vol Opt's ship door), the `construct_objects` action, the door unlock camera
- [ ] Boss fight music phases, `6x6A` boss warp gathering, CCA main-gate warp menu (0x20A), Episode 2's four-light door lamps
- [x] Combat: three-attack combo (`6x43`/`6x44`/`6x45`, motion tables and hit frames from the exe), hit detection with the ItemPMT weapon ranges, the hit/damage formulas, enemy flinch/death motions, `6x46`/`6x0A`/`6x76`, kill -> `6x60` drop request and `6xC8` EXP request (`combat/`, `render/combat.ts`, `tests/combat.test.ts`)
- [ ] Combat: techniques (`6x47`/`6x48`), photon blasts, specials and status effects, the player taking damage (`6x4A`-`6x4F`), enemy AI, hit boxes per body part, damage numbers and the lock-on reticle
- [x] Full character file (`E7`): inventory, stats, bank, techniques (`net/charfile.ts`)
- [x] ItemPMT from the server stream file, item names and descriptions (`formats/itempmt.ts`, `formats/itemnames.ts`)
- [x] Inventory panel in the Online tab
- [x] Item commands: equip/unequip/use/drop from the Inventory panel (`6x25`/`6x26`/`6x27`/`6x2A`/`6xC3`/`6x29`), pickup (`6x5A` → `6x59`), server drops (`6x5D`/`6x5F`), inventory creation (`6xBE`), join item state (`6x6D`, BC0) — `net/items.ts`
- [x] Items on the floor with the client's own models (`item.bml` box models, present colours, spin) and item boxes broken with Enter (`6x0B` + `6xA2`) — `formats/itemmodels.ts`, `render/flooritems.ts`
- [ ] Item drop animation (arc from the enemy/box), the "item found" HUD line and sounds, the classic Item Pack menus (equip/use from the in-game menu), bank and shops (`6xBB`/`6xB5`/`6xB7`), tekker (`6xB8`/`6xBA`), mag feeding (`6x28`), partial-stack UI beyond "Drop 1"
- [ ] Quests (opcodes documented in the notes and in newserv's assembler)
