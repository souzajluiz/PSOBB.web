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
| Animations | ⏳ |

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
node tests/login.live.ts         # live login through the bridge
node tests/lobby.live.ts         # two clients: create char, lobby, chat, movement
node tests/bot.live.ts webbot 120  # a bot player that runs around and echoes chat
```

The format tests and the dev server look for client data in `~/Downloads/psobb-client/data` (override with `PSOBB_DATA=...`). In the **Map viewer** tab you can also pick your PSOBB folder with *Open PSOBB data folder* (Chrome/Edge); files are read locally and never uploaded.

Player models: with the dev server running, open http://127.0.0.1:5173/models.html to view any class with a chosen costume, skin, face, head, hair and section ID.

## References

The project builds on three sources, described in [docs/REFERENCES.md](docs/REFERENCES.md):

1. **newserv**: server, file formats and protocol (MIT).
2. **original-psobb-client-source**: Ghidra dump of `psobb.exe` with protocol, opcode and formula notes.
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
