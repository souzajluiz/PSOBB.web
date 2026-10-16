# Architecture

## Overview

```
┌──────────────────────── Chrome ────────────────────────┐
│  client/ (TypeScript, Vite, three.js)                  │
│   ├─ formats/  PRS, GSL, AFS, REL/XJ, XVM  ◄── user's data/ folder
│   ├─ net/      BBCrypt, BBConnection, BBSession         │
│   └─ render/   three.js scene (maps, models)            │
└──────────────┬─────────────────────────────────────────┘
               │ WebSocket (binary, end-to-end encrypted)
┌──────────────▼──────────────┐
│ bridge/ (Node + ws)         │  pure byte relay, port allowlist
└──────────────┬──────────────┘
               │ TCP
┌──────────────▼──────────────┐
│ newserv (C++)               │  login, lobbies, games, quests, drops
└─────────────────────────────┘
```

## Decisions

### Rewrite the client for the web instead of emulating the `.exe`

`PsoBB.exe` is Win32 + Direct3D 8 + DirectInput + DirectSound + WinSock. Emulating x86 and D3D in a browser would be slow and fragile. The client is therefore **reimplemented** in TypeScript, and the two decompilations serve as the specification (see [REFERENCES.md](REFERENCES.md)).

### three.js instead of Godot

The matching decompilation aims at a Godot port. For a **web-first** target, three.js wins on three counts:
- No Godot export templates (more than 1 GB).
- No COOP/COEP or SharedArrayBuffer requirements.
- The PSO format parsers (PRS, NJ/XJ, XVM) run directly in the browser, where the user's data already is.

Game logic recovered from the decompilation is engine-agnostic, so this choice can be revisited.

### Dumb relay instead of a protocol gateway

Browsers cannot open TCP sockets. The bridge only copies bytes between WebSocket and TCP. Encryption and the whole protocol live in the browser. This keeps things simple:
- The bridge is about 60 lines and fully generic.
- The web client speaks exactly the original client's protocol, so newserv needs no changes.
- A BB redirect (command `19`) just means "reconnect through the bridge to another port".

**Security:** the bridge only accepts ports in `ALLOWED_PORTS` and listens on `127.0.0.1` only. Without the allowlist it would be an open TCP proxy.

### User-supplied assets

The browser reads the `data/` folder of the user's own PSOBB installation. Nothing from SEGA enters the repository or a deployment.

### BB key file

The client needs a `.nsk` key file. During development Vite serves it from the local newserv checkout (`vendor/newserv/system/blueburst/keys/`) at `/keys/<name>.nsk`. The key is never committed to this repository.

## Testing

- `tests/oracle.test.ts` compares every TS port with the newserv binary using real data. It covers the BB cipher with the `default` and `default4` keys, PRS on 20 files from `data.gsl`, and all 1524 GSL entries.
- `tests/login.live.ts` runs a real BB login through the bridge against a running newserv.
- **Chrome:** every UI feature is exercised in Chrome (via claude-in-chrome) before it is committed.
