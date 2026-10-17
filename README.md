# PSOBB.web

A **Phantasy Star Online: Blue Burst** client that runs in the browser and connects to a [newserv](https://github.com/fuzziqersoftware/newserv) server.

> Personal/educational reverse-engineering and interoperability project. No game files (SEGA) are distributed here: each user points the browser at their own PSOBB installation. See [docs/LEGAL.md](docs/LEGAL.md).

## Status

| Step | State |
|---|---|
| BB cipher (Blowfish variant) in TypeScript | ✅ byte-identical to newserv |
| PRS, GSL, AFS in TypeScript | ✅ verified against newserv with real client files |
| WebSocket ↔ TCP bridge | ✅ |
| BB login (03 → 93 → E6 → 19 redirect → 93 → E6) | ✅ live in Chrome against newserv |
| Character slot previews (E3 → E4/E5) | ✅ live in Chrome |
| Map viewer: n.rel (fmt2) + XJ models + XVM textures (DXT1/DXT3/565/1555) | ✅ all 175 maps parse; rendered in Chrome |
| Character creation (E5) | ✅ live in Chrome |
| Lobby: 3D lobby map, players, chat, running (6x42/6x3E), position sync (6x1F/6x20) | ✅ live in Chrome with a bot |
| Original-style screens (`classic.html`): title with the original textures, matched to captures by SSIM | 🚧 title and select character done (SSIM 0.92); creation next |
| Map collision (`c.rel`) and real lobby spawn points (`o.dat` player sets) | ✅ 175 c.rel parse; walking uses the client's collision rules |
| Enemy/object markers from set data (`map_*e.dat` / `o.dat`) | ✅ 838 files match newserv; shown in the map viewer |
| Character models (NJCM from `pl?nj.bml`, textures by appearance), all 12 classes | ✅ dev page `models.html` |
| Player motions (`plymotiondata.rlc`) and animated models in the lobby (idle/walk/run) | ✅ live in Chrome with a bot |
| Character file (`E7`), ItemPMT from the server stream, item names, Inventory panel | ✅ 1536 item definitions and 1515 names match newserv |
| Games: create/list/join, Pioneer 2 and field floors from the server's variations, warps, back to the lobby | ✅ live in Chrome with a bot |
| Items on the floor (6x5D/6x5F/6x59) with their `item.bml` box models, pickup (6x5A), item boxes (6x0B + 6xA2), equip/unequip/use/drop from the Inventory panel | ✅ every ItemPMT item resolves to a model; two clients live against newserv |

Details and next steps: [docs/ROADMAP.md](docs/ROADMAP.md). Development log: [docs/DEVLOG.md](docs/DEVLOG.md).

## Architecture

```
 Chrome ──WebSocket──> bridge (Node) ──TCP──> newserv
   │                                            (PSO server, C++)
   └─ reads the user's PSOBB data/ folder (File System Access API)
```

Full write-up: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Protocol and file formats: [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Running locally

Requirements: macOS or Linux, Node ≥ 23.6 (tested with 24.18), CMake, Git, Chrome.

```bash
# 1. Build newserv (cloned into vendor/, not committed)
./scripts/setup-newserv.sh

# 2. Start the server
(cd vendor/newserv && ./build/newserv)

# 3. Start the WebSocket bridge
(cd bridge && npm install && npm start)

# 4. Start the web client, then open http://127.0.0.1:5173 in Chrome
(cd client && npm install && npm run dev)

# Tests
node tests/oracle.test.ts        # TS ports vs newserv (needs client files)
node tests/formats.test.ts       # parses every map n.rel and .xvm in the client
node tests/collision.test.ts     # parses every map c.rel, checks ground at player spawn points
node tests/setdata.test.ts       # enemy/object set data vs newserv disassemble-free-map
node tests/players.test.ts       # parses and builds every player class and appearance variant
node tests/motions.test.ts       # decodes every player motion, plays idle/walk/run on every class
node tests/fog.test.ts           # fogentry.dat / lightentry.bin values and the fog fade state machine
node tests/items.test.ts         # ItemPMT parser and item names vs newserv's reference tables
node tests/login.live.ts         # live login through the bridge
node tests/lobby.live.ts         # two clients: create char, lobby, chat, movement
node tests/charfile.live.ts      # character file (E7) and inventory with item names
node tests/game.live.ts          # two clients: create/list/join a game, movement, warp to Forest 1, switch flag (6x05), back to lobby
node tests/fieldbgm.test.ts      # area -> BGM table, interactive-music sequencer, chained-Ogg links of data/ogg/slbgm_*.ogg
node tests/warpmenu.test.ts      # Ragol teleporter entries, warp windows, boss warp table, doors, warps found in the set data
node tests/setdatatable.test.ts  # SetDataTable*.rel vs newserv; every free-play floor resolves to map files
node tests/enemies.test.ts       # every free-play enemy resolves to its model archive, model and idle motion; builds them
node tests/itemmodels.test.ts    # every ItemPMT item resolves to an item.bml floor model; BC0, item subcommands, inventory rules
node tests/items.live.ts         # two clients: drop/pick up items, split a stack, meseta, equip/use, break Forest 1 boxes
node tests/bot.live.ts webbot 120  # a bot player that runs around and echoes chat
```

The format tests and the dev server look for client data in `~/Downloads/psobb-client/data` (override with `PSOBB_DATA=...`). In the **Map viewer** tab you can also pick your PSOBB folder with *Open PSOBB data folder* (Chrome/Edge); files are read locally and never uploaded.

Player models: with the dev server running, open http://127.0.0.1:5173/models.html to view any class with a chosen costume, skin, face, head, hair and section ID.

## References

The project builds on three sources, described in [docs/REFERENCES.md](docs/REFERENCES.md):

1. **newserv**: server, file formats and protocol (MIT).
2. **original-psobb-client-source**: Ghidra dump of `psobb.exe` with named functions, protocol, opcode and formula notes. **Anything that has to come from the client is looked up here first** (`tools/refsrc.sh addr 005d7ccc`); Ghidra headless is the fallback.
3. **A matching decompilation of PsoBB.exe**: game logic proven byte-for-byte (private repository, used as reference only).

## Layout

```
bridge/              WebSocket <-> TCP relay
client/              Vite + TypeScript web client
client/src/net/      BB cipher, connection framing, login session
client/src/formats/  PRS, GSL, AFS, BML, REL, XJ, NJCM, map n.rel, XVM
client/src/render/   three.js scene building (Ninja objects, map viewer)
client/src/data/     data/ folder access (File System Access API, dev server)
tests/               oracle tests against newserv, live tests
scripts/             newserv setup
docs/                documentation
```
