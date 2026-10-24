# Quest file writers

The read side of the quest formats lives in `formats/questbin.ts`, `formats/questdat.ts`, `formats/questopcodes.ts`
and `formats/prs.ts`. The write side, the foundation of a quest editor, is:

| File | Exports |
|---|---|
| `formats/prscompress.ts` | `prsCompress` |
| `formats/questwrite.ts` | `serializeQuestBin`, `serializeQuestDat`, `buildQuestDat`, `setQuestDatChunk`, `buildQuestBin` |
| `formats/qst.ts` | `parseQst`, `packQst` |
| `formats/questasm.ts` | `disassembleQuest`, `assembleQuest`, `QuestAssemblyError` |
| `formats/questdata.ts` | `decodeTypedData`, `encodeTypedData`, `decodeCString` (the typed data labels of the disassembly) |

Formats follow newserv (`src/QuestScript.cc`, `src/Quest.cc`, `src/CommandFormats.hh`, MIT). Nothing was copied from
phantasmal-world. Blue Burst only.

## Types

```ts
// formats/prscompress.ts
prsCompress(data: Uint8Array): Uint8Array            // valid PRS; prsDecompress(prsCompress(x)) equals x

// formats/questwrite.ts
serializeQuestBin(bin: QuestBin): Uint8Array         // decompressed .bin
serializeQuestDat(dat: QuestDat | { chunks: readonly QuestDatChunkInput[] }): Uint8Array   // decompressed .dat
interface QuestDatChunkInput { type: number; floor: number; data: Uint8Array }
buildQuestDat(chunks: readonly QuestDatChunkInput[]): QuestDat
setQuestDatChunk(dat: QuestDat, type: number, floor: number, data: Uint8Array): QuestDat   // empty data removes
buildQuestBin(input: NewQuestBinInput): QuestBin     // header fields + code + label offsets (used by the assembler)

// formats/qst.ts
parseQst(bytes: Uint8Array): ParsedQst
interface ParsedQst { name: string; files: QstFile[]; binFilename: string; datFilename: string; bin: QuestBin; dat: QuestDat }
interface QstFile { filename: string; compressed: Uint8Array; data: Uint8Array }   // data = decompressed
packQst(bin: QuestBin, dat: QuestDat, opts?: { filename?: string; name?: string }): Uint8Array

// formats/questasm.ts
disassembleQuest(bin: QuestBin, opts?: { header?: boolean }): string
assembleQuest(text: string, headerOptions?: AssembleHeaderOptions): QuestBin
interface AssembleHeaderOptions {
  questNumber?; episode? /* header byte 0|1|2 */; maxPlayers?; joinable?; name?; shortDescription?; longDescription?;
  soloUnlockFlags?: number[]; floorAssignments?: QuestFloorAssignment[];
  unknownA1?; unknownA2?; unknownA4?; unknownA5?; unknownA6?; createItemMask?: Uint8Array[] /* 0x38 bytes each */
}
class QuestAssemblyError extends Error { line: number }   // 1-based, 0 when not tied to a line
```

Typical editor flow:

```ts
const bin = parseQuestBin(prsDecompress(binFile));         // or parseQst(bytes).bin
const text = disassembleQuest(bin);                        // edit the text
const edited = assembleQuest(text);                        // QuestBin, throws QuestAssemblyError
const edited2 = assembleQuest(scriptOnlyText, { name, questNumber, ... });   // options win over directives
const qst = packQst(edited, dat, { filename: 'q9999' });   // downloadable .qst
const binFileBytes = prsCompress(serializeQuestBin(edited));   // or the pair for the server's quest folder
```

## `.bin` writer

`serializeQuestBin` writes header, bytecode and label table in the order the header gives (the shipped quests all have
code first, label table last, `text_offset` = `0x122C`, `size` = file size). The bytecode is `bin.data` between
`header.textOffset` and `questCodeEnd(bin)`; label offsets come from `bin.labels` (an unset label is
`textOffset + 0xFFFFFFFF`, written back as `0xFFFFFFFF`). The three offsets and `size` are recomputed. A model field is
only written when it differs from what the header bytes parse to, so the parts the model does not expose
(`unknown_a1/a2/a4/a5/a6`, the create-item mask, a floor assignment's unused bytes) stay as they are in `bin.data`, and
a field with two encodings (`max_players` 0 or 4) keeps its raw form. Names are limited to 31 / 127 / 287 UTF-16 units.

To change the code, replace `bin.data` / `bin.labels` (the assembler does: `buildQuestBin`). To change only header
fields, change `bin.header`.

`serializeQuestDat` writes each chunk as `type, 0x10 + payload size, floor, payload size, payload` and ends with the
all-zero 0x10-byte chunk. Edit by replacing chunk payloads (`setQuestDatChunk`); `QuestDat.floors` is derived and not
read by the writer.

### Random enemies (types 4 / 5, `evt2`)

Only the Episode 1 challenge quests (`challenge-ep1/c88101..c88109`, 84 floors) have them. A floor with an `evt2`
events chunk (type 3, format `'evt2'` read big-endian at +0x0C) holds wave templates (Event2Entry, 0x18 bytes); the
type 4 chunk (`RandomEnemyLocations`: room table, then 0x1C-byte spawn points) and the type 5 chunk
(`RandomEnemyDefinitions`: 0x20-byte definitions and 4-byte weights) say which enemies and where. The waves are made
from the lobby's random seed (join packet u32 at 0x198) by `formats/randomenemies.ts`, which follows newserv's
`materialize_random_sections` (`src/Map.cc:3823`): the enemies, numbered in generation order, and an evt1 events section
that chains multi-wave events through `trigger_event` (`0x0C`) with ids `event_id + wave + 10000`.

Checked against `materialize-map --bb --seed=12345678` on c88101, c88102 and c88109 (every floor): enemy type, room,
wave and child count, and event id, room, wave, delay and action offset, all equal (`tests/randomenemies.test.ts`).
Positions differ from newserv for a room whose table offset is not 0 (the exe's section start is used). The exe's
HandleQuestDat does not take types 4/5; they go to the challenge tables (`handle_dat_tables_challenge`, Ghidra dump
line 612602).

## `.qst`

44 open-file commands for `<name>.bin` and `<name>.dat`, then the 13 write-file commands (0x400-byte chunks of the
PRS-compressed files), each with the 8-byte BB command header; the 13 commands are 0x41C bytes + 4 zero bytes so the
next command is 8-aligned (newserv `encode_qst_file`). The name is `PSO/<quest name>` (the header name when it is ASCII,
else the file name), 23 characters at most. `parseQst` accepts chunks in any order, all-zero chunk indexes (assumed in
order) and write commands whose size includes the 4 padding bytes. Download quests use the same bodies with A6 (open) and
A7 (write) instead of 44 / 13: `parseQst` reads them (`download: true`) and `packQst(..., { download: true })` writes them.
ASSUMED: the BB A6/A7 files are plain PRS, like the 44 / 13 ones (the exe's receive path decompresses them without a
decrypt). The PSO V2 encrypted download format (newserv `encode_download_quest_data`: an 8-byte header, then the PRS
stream encrypted with PSO V2) is the DC / PC / GC / XB one; `parseQst` still rejects non-BB files. The cipher and the
payload are ported (see the next section); the non-BB `.qst` command structs are not.

## PSO V2 download payload

`formats/psov2.ts`, ported from newserv `src/PSOEncryption.cc` (`PSOV2Encryption`, `PSOLFGEncryption::encrypt_t`) and
`src/Quest.cc` (`PSODownloadQuestHeader` at line 173, `encode_download_quest_data` at line 839, `decode_dlq_data`).
The download quest `.bin` and `.dat` for DC v2, PC, GC and XB are written as:

- bytes 0-3: `u32le` decompressed size (the PRS stream's, or the `.dat`'s when the caller passes none);
- bytes 4-7: `u32le` encryption seed (newserv picks a random one when it is 0; the port refuses 0);
- bytes 8 on: the PRS stream XORed with the V2 keystream for that seed. The header is not encrypted.

The keystream (`PsoV2Cipher`): state `stream[0..0x38]`, seeded from the seed by the first loop (`stream[0x37] = seed`,
then 54 steps of `a, b = b - a, a` into `stream[(21k) % 0x37]`), five `update_stream` warm-ups, then 0x38 words per
refill: `stream[z] -= stream[z+0x1F]` for z in 1..0x18, `stream[z] -= stream[z-0x18]` for z in 0x19..0x37, and reads
start at index 1. Word `k` XORs the next 4 bytes little endian; a partial last word XORs its low bytes. Encryption and
decryption are the same XOR. `psoV2First(seed)` is newserv's closed form of the first word, `0xC6DCAB76 * seed - 0x9E1977BA`.

Tests: `tests/psov2.test.ts` (synthetic data only). The known answers come from an independent Python transcription of the
C++ loop (not from the port): seed `0x12345678` gives the keystream `DAE88B96 CB3060B9 AE4C4E68 F0EE2029 B20BA18A
33F1123F 3EAA77D2 03F5454B`, the first words after one refill are `EEF55018 848B6582`, and `encodeDownloadQuestData` of
bytes 0..10 with size 0x1234 gives `3412000078563412968aead9bd6536cc604746`. Round trips cover every length 0..4096
(including partial words), a PRS stream through `decodeDownloadQuestData`, and a wrong size on decode.

Not ported: the `.qst` command structs for these versions (newserv `encode_qst_file`: `S_OpenFile_DC_44_A6`,
`S_OpenFile_PC_GC_44_A6`, `S_OpenFile_XB_44_A6` and the `PSOCommandHeaderDCV3` / `PSOCommandHeaderPC` write commands,
with the `xb_filename` and the quest number), the `create_download_quest` language override of the `.bin` header, and
the download-quest menu. The cipher is not yet checked against a newserv build's output (no build is run here; the
Python transcription is the reference).

## Script text

Based on `newserv disassemble-quest-script --bb --reassembly`:

```
.version BB_V4
.quest_num 101
.name "Mop-up Operation #1"
.short_desc "..."
.long_desc "...\n..."
.episode Episode1               (and .header_episode 0x00)
.max_players 4
.joinable
.solo_unlock_flag 0x0102
.allow_create_item 00 00 ...     (0x38 hex bytes; one per create-item mask entry)
.header_unknown_a1 0xFFFF        (a2, a4, a5, a6 likewise)

start:                           label 0
  set_episode                      0x00000000
  arg_pushl                        0x00000000
  arg_pushw                        0x0096
  set_floor_handler                // 0x00000000, label0096
label0096:
  leti                             r145, 0x00000000
  switch_jmp                       r0, [label00C8, label00C9]
  set_player_start_position        // 0x00000000, r60-r63
  window_msg                       // "..."          (BB: the text comes from arg_pushs)
  bb_map_designate                 0x00, 0x00, 0x00, 0x00, 0x00
  ret
  .data 01
```

- Labels: `labelXXXX:` (hex index), `start:` (0) or any name (`loop_a:`, numbered with the lowest free index). References
  use the same names. All label arguments are label indices (not offsets).
- Operands: `rN`, `rA-rB` for fixed register runs, `[r1, r2]` register sets, `[label1, label2]` label sets, `"..."`
  strings (escapes `\n \r \t \\ \" \' \uXXXX \xNN`), integers in decimal or `0x` hex (negative allowed), floats in decimal,
  `nan`, `inf`, or `0x` raw bits. Opcode names are the canonical names of `questopcodes.ts`; Qedit aliases also parse.
- BB opcodes flagged `F_ARGS` take their arguments from the arg stack (the preceding `arg_push*`). The disassembler prints
  the pushes and, after `//`, the arguments the opcode will take. The assembler ignores the comment; if you write the
  arguments instead of pushes (`set_floor_handler 0, loop_a`) it emits the pushes for you (I8 `arg_pushb`, I16 and labels
  `arg_pushw`, I32 and floats `arg_pushl`, strings `arg_pushs`, registers `arg_pushr` / `arg_pusha` for written ones, a
  fixed register run `arg_pushb` of its first register).
- Code that is not reachable from label 0 (through `jmp`/`call`/`thread`/... and the arg stack) and does not decode as a
  clean function ending in `ret`/`exit`/`jmp`, and every byte after a terminator, is emitted as `.data` hex. `.zero N`
  and `.cstr "..."` also exist.
- Typed data labels (`formats/questdata.ts`): a data label that a code reference types through the opcode's argument
  data type (`questopcodes.ts`, newserv's `DataType`) is printed as a structure or a string instead of hex, when its size
  fits the type and it re-encodes to the same bytes:
  - `.cstr "..."`: a BB string (UTF-16 units and the zero unit; `npc_text_id`, `window_msg`'s label forms and the rest of
    the CSTRING arguments).
  - `.struct KIND` followed by `  .field name value` lines in layout order, for `PLAYER_STATS` (0x24: the battle
    parameter's stats, `set_enemy_physical_data`), `ATTACK_DATA` (0x30), `RESIST_DATA` (0x20), `MOVEMENT_DATA` (0x30) and
    `PLAYER_VISUAL_CONFIG` (0x70, `prepare_npc_visual` / `get_npc_data`: the guild card number and the name are
    strings). Integers are decimal, floats are the shortest text that gives their bits (`fmtFloat`, else `0x` bits),
    `bytes` fields are hex without spaces. Layouts follow newserv's `BattleParamsIndex.hh`, `LevelTable.hh` and
    `PlayerSubordinates.hh`.
  - `.struct VECTOR4F_LIST` with `  .vector x y z t` lines (16 bytes each; `get_vector_from_path`, `load_unk_data`: the
    path's points).
  - `.struct IMAGE_DATA` for `IMAGE_DATA` labels (`call_image_data`, newserv's `DataType::IMAGE_DATA`): the PRS
    stream decompressed to `.data` hex lines (newserv's `disassemble_label_as_image_data` prints the same). The
    assembler compresses them with `prsCompressOptimal`, so the label is typed only when that compressor gives back the
    label's stream at its start. Bytes after the stream (the label's section runs to the next label; newserv's "Extra
    data after compressed data") follow an `.extra` line as `.data` hex.
  - Untyped labels stay `.data` hex. The assembler reads the typed forms back with the same encoder, so a typed label
    round-trips byte for byte; a `.struct` block with a field name out of place, missing or out of range is an error.
  Labels the text cannot express: `.unset_label N` (referenced but 0xFFFFFFFF in the
  table), `.raw_label N 0xV` (a table value outside the code), `.label_count N` (table longer than the last label),
  `.undefined_label N` (referenced beyond the table; shipped q453 does this).
- The header's floor assignments are the arguments of the `bb_map_designate` instructions in text order (as newserv does).
  The disassembler emits `.floor_assignment F A T L E` / `.no_floor_assignments` only when the header differs;
  `AssembleHeaderOptions.floorAssignments` overrides both.
- `assembleQuest` is strict: unknown opcode, wrong argument count, out-of-range immediate, duplicate or undefined label,
  missing `start:` all throw `QuestAssemblyError` with the line. Block comments `/* */` work inside a line only.

## Differences from newserv's syntax

newserv prints `... args` after F_ARGS opcodes, names sections `labelXXXX@0xNNNN:` and uses `.data` for non-code too; ours
prints `// args`, names `labelXXXX:` and does not parse newserv's text (the directive set overlaps, the argument and
label syntax differ in details such as `.allow_create_item`'s format). `.language`, `.include` and `--qedit` mnemonics
are not supported (`.language` is ignored). Typed data labels use our `.struct` / `.cstr` / `.vector` forms (above), not
newserv's `// As PlayerStats` comment listings. A compressed image (`IMAGE_DATA`) whose stream `prsCompressOptimal` does not
reproduce stays hex: the four shipped BB copies (`call_image_data` in q142 / q143, `-bb-e` and `-bb-j`) were made by an
encoder that differs from the optimal parse at byte 18 of the stream, so they are not typed.

## Round-trip results

`tests/questwrite.test.ts` over the 335 Blue Burst quests in `vendor/newserv/system/quests`:

- parse -> `serializeQuestBin`: 335 / 335 byte-identical.
- parse -> `serializeQuestDat`: 333 / 333 identical (every file ends with the 0x10-byte zero chunk; no padding chunks).
- `disassembleQuest` -> `assembleQuest` -> `serializeQuestBin`: 335 / 335 identical, and the disassembly of the result is
  the same text. Across the 335 quests 146 labels print as typed (`.struct` / `.cstr`; the rest of the data labels are
  `.data`). A synthetic script covers every typed kind, the labels that stay `.data` (wrong size, trailing bytes), and
  the assembler's errors on malformed `.struct` blocks; random PlayerStats / ResistData / AttackData / MovementData records
  re-encode to themselves.
- `packQst` -> `parseQst`: 333 / 333 identical `.bin` and `.dat`.
- With `vendor/newserv/build/newserv`: for a sample of 27 quests `decode-qst` of our `.qst` gives our files,
  `decompress-prs` gives our `.bin`, and `disassemble-quest-script --bb` prints the same text for the original, the
  re-packed and the re-assembled `.bin`.
- `prsCompress` output is about 103 % of the shipped files' size on average (greedy LZ77 with one byte of lazy matching;
  the original tool is smaller by a few percent).
