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
- [ ] Character creation (`93` phase 2 + `E5`)
- [ ] Character select → ship select → lobby (`93` phase 4/5)
- [ ] `data/` folder picker (File System Access API) and file index

## Phase 3: map viewer
- [ ] REL parser (relocation table + root pointer)
- [ ] XJ parser (BB models: vertex/index buffers)
- [ ] XVM/XVR decoding (DXT/ARGB textures) to WebGL textures
- [ ] Render `map_city00_00n.rel` (Pioneer 2) with a free camera
- [ ] Enemy/object markers from `map_*e.dat` / `o.dat`

## Phase 4: online
- [ ] Lobby: player list, chat
- [ ] Own movement sent via `6x40/6x42/6x3E` (layouts in the decomp's `headers/network.h`)
- [ ] Other players rendered from incoming `6x`
- [ ] Character models (`pl?smp.rel`, `pl?tex.afs`) and animations

## Phase 5: game
- [ ] Collision (`*c.rel`)
- [ ] Enemies, combat (formulas in `notes/_wiki_combat_formulas.md`)
- [ ] Items and inventory
- [ ] Quests (opcodes documented in the notes and in newserv's assembler)
