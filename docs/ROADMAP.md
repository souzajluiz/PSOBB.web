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
- [ ] Play map motions, texture animation (`.tam`), UV-scroll effect slots, env-map texgen (material type 7)
- [x] Verify handedness: the client is right-handed like three.js, so no mirroring is needed

## Phase 4: online
- [x] Lobby: 3D lobby map, player list, chat
- [x] Own movement sent via `6x42` / `6x3E`, ground-following on the map collision
- [x] Other players from incoming `6x20/3E/3F/40/42`, `6x1F` answered with `6x20`
- [x] Real lobby spawn points (`TObjPlayerSet` in `map_lobby_NNo.dat`) and collision (`*c.rel`)
- [ ] Collision of lobby objects (counters, props from `o.dat`) and the real per-class hitbox radius
- [ ] Character models (`pl?smp.rel`, `pl?tex.afs`) and animations

## Phase 5: game
- [x] Collision (`*c.rel`): parser, ground probe, wall rays/slide (`render/collision.ts`)
- [ ] Enemies, combat (formulas in `notes/_wiki_combat_formulas.md`)
- [ ] Items and inventory
- [ ] Quests (opcodes documented in the notes and in newserv's assembler)
