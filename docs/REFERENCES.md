# References

## 1. newserv (fuzziqersoftware/newserv): MIT

https://github.com/fuzziqersoftware/newserv

- **The server** this project talks to. Built into `vendor/` by `scripts/setup-newserv.sh`.
- **Specification:** `src/CommandFormats.hh` (commands), `src/PSOEncryption.cc` (ciphers), `src/Compression.cc` (PRS), `src/GSLArchive.cc` and `src/AFSArchive.cc`, `src/Map.cc` (maps), `src/ReceiveCommands.cc` (server-side flow, e.g. `on_93_BB`).
- **Test oracle:** its CLI (`encrypt-data`, `decompress-prs`, `extract-gsl`, …) produces the expected outputs for `tests/oracle.test.ts`.
- **Ported code:** `BBCrypt`, `prsDecompress`, `GSLArchive` and `AFSArchive`. Each file cites its origin; MIT allows this as long as the notice is kept.

## 2. original-psobb-client-source (gitlab.psobb.io)

https://gitlab.psobb.io/psobb/original-psobb-client-source

Ghidra dump of `psobb.exe` with community-curated headers and notes:
- `headers/network.h`: 6x subcommand layouts (movement `6x40/42/3E`, attacks `6x43-45`, …)
- `notes/quest_opcodes_*.md`: quest opcode semantics
- `notes/_wiki_combat_formulas.md`, `notes/_wiki_item_tables.md`
- `headers/rendering.h`: rendering mapping

Used as a **specification**. Ghidra pseudo-code is not copied.

## 3. Matching decompilation of PsoBB.exe (private repository)

A decompilation that produces C compiling byte-for-byte to the original binary under the same VC7.1 compiler. Its stated goal is readable game logic for a port. Here it is used:
- **As the source of truth for game logic:** rules, state machines, entities, ninja/shinobi math.
- **As reference only.** Its README states it is private and contains SEGA's binary and a proprietary toolchain, so **nothing from it is copied or linked in this public repository**.

## Others

- **Tethealla** (old server, GPL-3): the data files in the original `map/`, `quest/` and `drop/` folders share the same formats.
- **Ephinea PSOBB client:** source of the `data/` files used locally for testing. Not committed.
