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
| Character creation | ⏳ |
| Map viewer (`.rel` / `.xvm`) | ⏳ |
| Lobby, movement, other players | ⏳ |

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
node tests/login.live.ts         # live login through the bridge
```

The format tests look for client data in `~/Downloads/psobb-client/data` (override with `PSOBB_DATA=...`).

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
client/src/formats/  PRS, GSL, AFS (REL/XJ/XVM next)
tests/               oracle tests against newserv, live tests
scripts/             newserv setup
docs/                documentation
```
