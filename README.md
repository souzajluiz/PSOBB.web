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
| Quests: the server's quest menu (A2/A3), the 44/13 file pair and the AC barrier, the `.bin` script and the `.dat` set data, a script VM that runs a quest's opening | ✅ all 335 BB quest files parse; "Lost HEAT SWORD" loaded and played live in Chrome |
| Combat: attack combo (6x43-6x45/6x46/6x0A), the player taking damage and dying (6x4A-6x4F, 6x89), enemy AI (notice, chase, melee), damage numbers and the lock-on reticle | ✅ Forest families from the exe tables; two clients live against newserv |
| NPCs (Pioneer 2, Lab, quests) with the client's models and motions, talk, the area script, the Hunter's Guild counter, a quest from the counter to the reward (6x24, 6x69, 6xC9) | ✅ 66 NPC archives build; Mop-up Operation #1 taken and paid live in Chrome |
| Boss rooms: enemy child objects (Vol Opt's monitors and pillars, Sorcerer bits, Belra arms, De Rol Le / Barba Ray and Saint-Milion parts), boss warp gathering (6x6A) and boss music phases | ✅ live in Chrome |

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
node tests/game.live.ts          # two clients: create/list/join a game, movement, warp to Forest 1, switch flag (6x05), wave event (6x67), attack and kill an enemy (6x43/6x46/6x0A/6x76/6x60/6xC8), taking damage and dying (6x4A-6x4F, 6x89), back to lobby
node tests/fieldbgm.test.ts      # area -> BGM table, interactive-music sequencer, chained-Ogg links of data/ogg/slbgm_*.ogg
node tests/warpmenu.test.ts      # Ragol teleporter entries, warp windows, boss warp table, doors, warps found in the set data
node tests/setdatatable.test.ts  # SetDataTable*.rel vs newserv; every free-play floor resolves to map files
node tests/combat.test.ts        # damage/accuracy formulas, attack combo timing, enemy slot ids and battle params vs newserv
node tests/combatdepth.test.ts   # player hit/death motions and the 6x4A-6x4F flow, enemy AI (search radius, chase, melee, recovery) and its exe tables
node tests/enemies.test.ts       # every free-play enemy resolves to its model archive, model and idle motion; builds them and their child objects
node tests/bossrooms.test.ts     # boss warp gathering (6x6A state machine) and the boss music phases (6x15/6x19/6xA4/6xA5)
node tests/itemmodels.test.ts    # every ItemPMT item resolves to an item.bml floor model; BC0, item subcommands, inventory rules
node tests/items.live.ts         # two clients: drop/pick up items, split a stack, meseta, equip/use, break Forest 1 boxes
node tests/waves.test.ts         # every free-play floor's .evt parses; every object type resolves to a model and builds; wave state machine and door collision
node tests/quests.test.ts        # every BB quest newserv ships: .bin header, label table, full bytecode walk, .dat chunks, VM run, vs newserv disassemble-quest-script
node tests/npcs.test.ts          # every NPC entry of every free-play floor and BB quest resolves; all NPC models build; the area script reaches the counters
node tests/questflow.test.ts     # Mop-up Operation #1 from its start to the reward in the VM; 6x24 / 6x69 / 6xC9 layouts; npcplayerchar.dat
node tests/quest.live.ts         # the quest menu (A2/09/10), the 44/13 download, the AC barrier, then run the quest's start label
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
client/src/quest/    quest script VM, session and game wiring
client/src/data/     data/ folder access (File System Access API, dev server)
tests/               oracle tests against newserv, live tests
scripts/             newserv setup
docs/                documentation
```

## Deploy

One Docker image runs newserv, the built client and the relay on one HTTP port; see [docs/DEPLOY.md](docs/DEPLOY.md) (Dokploy steps included).
