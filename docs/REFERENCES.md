# References

## 1. newserv (fuzziqersoftware/newserv): MIT

https://github.com/fuzziqersoftware/newserv

- **The server** this project talks to. Built into `vendor/` by `scripts/setup-newserv.sh`.
- **Specification:** `src/CommandFormats.hh` (commands), `src/PSOEncryption.cc` (ciphers), `src/Compression.cc` (PRS), `src/GSLArchive.cc` and `src/AFSArchive.cc`, `src/Map.cc` (maps), `src/ReceiveCommands.cc` (server-side flow, e.g. `on_93_BB`).
- **Test oracle:** its CLI (`encrypt-data`, `decompress-prs`, `extract-gsl`, …) produces the expected outputs for `tests/oracle.test.ts`.
- **Quest file writers:** `src/QuestScript.cc` / `QuestScript.hh` (header, label table, opcode syntax of the assembler), `src/Quest.cc` (`encode_qst_file`, `decode_qst_data_t`: the `.qst` framing), `src/Compression.cc` (PRS stream format the encoder emits). The syntax of `formats/questasm.ts` follows its `disassemble-quest-script --reassembly` output; see `docs/QUESTFILES.md`. phantasmal-world (DaanVandenBosch, MIT) is the inspiration for the editor but no code or format notes were taken from it.
- **Ported code:** `BBCrypt`, `prsDecompress`, `GSLArchive` and `AFSArchive`. Each file cites its origin; MIT allows this as long as the notice is kept.

## 2. original-psobb-client-source (gitlab.psobb.io): look here first

https://gitlab.psobb.io/psobb/original-psobb-client-source

**The first place to look for anything that must come from the client.** Its
`src/Psobb.exe-*.c` is a full Ghidra dump of the binary (~986k lines, ~13300
functions) whose functions are named by the community with the address kept as
a suffix, so an address found anywhere resolves to a name and a body:
`UpdateGroundItem_005c4010`, `InitializeItemBML_005d7ccc`. Running Ghidra
headless (`tools/ghidra/run_any.sh`) is the fallback for what the dump leaves
unnamed or unresolved, and for data tables, which the dump does not carry.

The dump carries the code but **not the data tables**. Most of what is missing
is a plain read at a known address, which `tools/exedata.py` does straight out
of a local `PsoBB.exe` (point `PSOBB_EXE` at your own copy; it is never
committed here), so Ghidra headless is only needed for what neither gives:

```sh
tools/exedata.py read 009a5210 u 4         # 4 uint32 (also f d i h H, b, s, p)
tools/exedata.py read 008fe09c s           # a string
tools/exedata.py motions 009a5240 8        # enemy motion table rows
tools/exedata.py xref 009a51e0             # .text references to an address
tools/exedata.py calls 0044161c 0044172a   # call targets in a range (pins an entry point)
```

Clone it anywhere and point `REFSRC` at it (the default is
`../refsrc/original-psobb-client-source`, outside this repository, and it is
never committed here):

```sh
git clone --depth 1 https://gitlab.psobb.io/psobb/original-psobb-client-source.git
tools/refsrc.sh addr 005d7ccc      # the function at that address, with its body
tools/refsrc.sh name ItemBML       # declarations whose name matches
tools/refsrc.sh body FunctionName  # one body by name
tools/refsrc.sh grep 0x5F          # every hit in headers/ and notes/
```

It also carries community-curated headers and notes:
- `headers/network.h`: 6x subcommand layouts (movement `6x40/42/3E`, attacks `6x43-45`, …)
- `notes/quest_opcodes_*.md`: quest opcode semantics
- `notes/_wiki_combat_formulas.md`, `notes/_wiki_item_tables.md`
- `headers/rendering.h`: rendering mapping

Used as a **specification**. Ghidra pseudo-code is not copied.

## 3. psobb-client-source (gitlab.psobb.io): matching decompilation

https://gitlab.psobb.io/psobb/psobb-client-source

A decompilation of the **Japanese** `PsoBB.exe` whose C compiles byte-for-byte
to the original under the same VC7.1 compiler (one function per file in
`src/`, ~5700 functions inventoried in `config/psobb/symbols.txt`, research in
`notes/`, `analysis/` and `reverse-engineering/`). Decision and lookup order:
[ADR 0001](adr/0001-client-reference-sources.md).

- **Always consulted, after the Ghidra dump:** where a function exists here,
  its control flow, constants and struct offsets are exact, and they win over
  the dump's pseudo-code.
- **Different build, different addresses:** match functions to the Ephinea
  dump by name, callees, strings and constants. Code here keeps citing the
  Ephinea addresses and names the JP file when a value was confirmed in it.
- **Reference only.** It contains SEGA's binary (`assets/PsoBB.exe`) and a
  proprietary toolchain (`tools/MSVC7.1/`), so **nothing from it is copied or
  linked in this public repository**.

Clone it next to the other one (about 2 GB), outside this repository:

```sh
cd ../refsrc
git clone --depth 1 https://gitlab.psobb.io/psobb/psobb-client-source.git
grep -rl "0x4ec" psobb-client-source/src | head   # find matching C by constant
```

## Others

- **Tethealla** (old server, GPL-3): the data files in the original `map/`, `quest/` and `drop/` folders share the same formats.
- **Ephinea PSOBB client:** source of the `data/` files used locally for testing. Not committed.
- **phantasmal-world** (DaanVandenBosch, MIT): https://github.com/DaanVandenBosch/phantasmal-world. A quest editor / viewer; its `FEATURES.md` and its behaviour (open / save .qst, undo / redo, area selection, 3D entity manipulation, events) were the reference for the feature list and UI of our own quest editor (`docs/QUESTEDITOR.md`, `client/src/questeditor/`). No code was ported; if some is, keep its MIT notice in that file.
