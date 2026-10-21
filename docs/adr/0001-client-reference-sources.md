# ADR 0001: Client behaviour comes from the two client reference repositories

- **Status:** accepted
- **Date:** 2026-10-19

## Context

PSOBB.web replicates the original Blue Burst client faithfully: positions,
textures, timings, rules and state machines come from the client's code, not
from captures or guesses. Two community repositories on gitlab.psobb.io carry
that code in usable form, and they complement each other:

- **original-psobb-client-source**
  (https://gitlab.psobb.io/psobb/original-psobb-client-source): a Ghidra dump
  of the Ephinea `PsoBB.exe` (~13300 functions) with community names that keep
  the address as a suffix (`InitializeItemBML_005d7ccc`), plus `headers/` and
  `notes/`. Every exe address cited in this repository's code and docs is in
  this address space.
- **psobb-client-source**
  (https://gitlab.psobb.io/psobb/psobb-client-source): a matching
  decompilation of the Japanese `PsoBB.exe`. Each function in `src/` is C (or
  C++) that compiles byte-for-byte to the original under the same VC7.1
  compiler, so its control flow, types, constants and struct offsets are exact
  rather than Ghidra's guesses. `config/psobb/symbols.txt` lists ~5700
  functions of that build; `notes/`, `analysis/` and `reverse-engineering/`
  carry the research. It is a different build, so its addresses do not match
  the Ephinea dump: functions are matched between the two by name, called
  functions, strings and constants, never by address.

## Decision

1. Anything that must come from the client is looked up in **both**
   repositories, always:
   - **original-psobb-client-source first**, to find the function by address
     or name (`tools/refsrc.sh`), and for its notes and headers.
   - **psobb-client-source next**, for the same function's matching C when it
     has been decompiled there. Where the two disagree, the matching C wins,
     because it is verified against the binary byte for byte.
   - `tools/exedata.py` for data tables, and Ghidra headless
     (`tools/ghidra/decomp.sh`) only for what neither repository resolves.
2. Code and docs keep citing Ephinea addresses (the original-psobb-client-source
   names). When a value was confirmed in the matching decompilation, the
   comment or DEVLOG entry says so and names its JP function
   (`psobb-client-source src/FUN_00401094.c`).
3. Both repositories are cloned **outside** this repository, under
   `../refsrc/` (`../refsrc/original-psobb-client-source` and
   `../refsrc/psobb-client-source`), and are never committed here.
4. They are used as a **specification only**. Nothing is copied from them:
   not their C or pseudo-code, and above all not psobb-client-source's
   `assets/PsoBB.exe`, its vendored proprietary `tools/MSVC7.1/` kit, its
   archives or its Ghidra project. This code is written fresh in TypeScript.

## Consequences

- Every work item, including the briefs handed to agents, names both
  repositories as sources, with the lookup order above.
- Values confirmed by the matching C need no capture or headless run to be
  trusted; values only seen in the Ghidra dump stay as they are, and
  "ASSUMED" still marks anything taken from neither.
- Contributors need both clones (about 2 GB for psobb-client-source) to check
  a citation; `docs/REFERENCES.md` has the setup.
