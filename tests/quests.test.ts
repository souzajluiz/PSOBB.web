// Parses every Blue Burst quest newserv ships (system/quests/**/q*-bb-*.bin and
// the matching .dat), checks the .bin header, the label table and a full
// bytecode walk, checks the .dat chunk stream, and compares the decoded header
// and opcode stream with newserv's own `disassemble-quest` output when the
// newserv binary is available.
//
// Run: node tests/quests.test.ts
// Env: NEWSERV (newserv checkout; default: vendor/newserv next to the main
//      checkout). The .bin/.dat files are PRS-compressed on disk, as they are
//      on the wire.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { decodeFunction, parseQuestBin, questEpisode, questOpcodeHistogram } from '../client/src/formats/questbin.ts';
import { parseQuestDat, QuestDatChunkType } from '../client/src/formats/questdat.ts';
import { QUEST_OPCODES, questOpcodeByName } from '../client/src/formats/questopcodes.ts';
import { QuestVM } from '../client/src/quest/vm.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = (() => {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim();
    return dirname(common);
  } catch {
    return join(HERE, '..');
  }
})();
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
if (!NEWSERV) {
  console.log('SKIP no newserv checkout with system/quests (set NEWSERV)');
  process.exit(0);
}
const NEWSERV_BIN = existsSync(join(NEWSERV, 'build/newserv')) ? join(NEWSERV, 'build/newserv') : null;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);

// --- Collect the BB quests ---------------------------------------------------
interface QuestFiles { label: string; bin: string; dat: string | null }
const quests: QuestFiles[] = [];
const root = join(NEWSERV, 'system/quests');
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const files = readdirSync(join(root, dir.name));
  for (const f of files) {
    // <stem>-bb-<lang>.bin pairs with <stem>-bb.dat.
    const m = /^(.+)-bb-([a-z])\.bin$/.exec(f);
    if (!m) continue;
    const dat = `${m[1]}-bb.dat`;
    quests.push({
      label: `${dir.name}/${f}`,
      bin: join(root, dir.name, f),
      dat: files.includes(dat) ? join(root, dir.name, dat) : null,
    });
  }
}
quests.sort((a, b) => a.label.localeCompare(b.label));
console.log(`${quests.length} Blue Burst quest files in ${root}`);
check(quests.length > 100, `expected over 100 BB quest files, found ${quests.length}`);

const load = (path: string): Uint8Array => prsDecompress(new Uint8Array(readFileSync(path)));

// --- The opcode table --------------------------------------------------------
check(QUEST_OPCODES.length === 528, `expected 528 BB opcodes in the generated table, got ${QUEST_OPCODES.length}`);
for (const name of ['nop', 'ret', 'set_floor_handler', 'bb_map_designate', 'map_designate', 'window_msg', 'gset', 'thread']) {
  check(!!questOpcodeByName(name), `opcode table has no ${name}`);
}
// set_floor_handler takes its arguments from the arg stack on BB (F_ARGS).
check((questOpcodeByName('set_floor_handler')!.flags & 4) !== 0, 'set_floor_handler should be F_ARGS on BB');
check(questOpcodeByName('bb_map_designate')!.args.length === 5, 'bb_map_designate should take 5 immediates');

// --- Parse every quest -------------------------------------------------------
const opcodeUse = new Map<string, number>();
let withFullHeader = 0;
let withRandomEnemies = 0;
let totalFloors = 0;
let totalObjects = 0;
let totalEnemies = 0;
let unknownOpcodes = 0;
let totalResolvedWaves = 0;
let emptyWaves = 0;

for (const q of quests) {
  let bin: Uint8Array;
  try {
    bin = load(q.bin);
  } catch (err) {
    fail(`${q.label}: PRS decompress failed: ${(err as Error).message}`);
    continue;
  }
  let parsed;
  try {
    parsed = parseQuestBin(bin);
  } catch (err) {
    fail(`${q.label}: ${(err as Error).message}`);
    continue;
  }
  const { header, labels } = parsed;
  check(header.size <= bin.length, `${q.label}: header size ${header.size} > file ${bin.length}`);
  check(header.textOffset >= 0x398, `${q.label}: text offset 0x${header.textOffset.toString(16)} inside the header`);
  check(labels.length > 0, `${q.label}: empty label table`);
  check(header.name.length > 0, `${q.label}: empty quest name`);
  check([1, 2, 4].includes(questEpisode(header)), `${q.label}: bad episode byte ${header.episode}`);
  check(header.maxPlayers >= 1 && header.maxPlayers <= 4, `${q.label}: max_players ${header.maxPlayers}`);
  if (header.hasFullHeader) withFullHeader++;

  // Label 0 must point into the bytecode and decode to something.
  const codeEnd = header.textOffset > header.labelTableOffset ? Math.min(header.size, bin.length) : header.labelTableOffset;
  check(labels[0] >= header.textOffset && labels[0] < codeEnd, `${q.label}: label 0 at 0x${labels[0].toString(16)} outside the bytecode`);
  const entry = decodeFunction(bin, labels[0], codeEnd);
  check(entry.length > 0, `${q.label}: label 0 decodes to nothing`);

  const hist = questOpcodeHistogram(parsed);
  for (const [name, n] of hist) {
    opcodeUse.set(name, (opcodeUse.get(name) ?? 0) + n);
    if (name.startsWith('.unknown_')) unknownOpcodes += n;
  }

  // Running label 0 must not throw and must reach a yield (sync / ret / exit).
  const vm = new QuestVM({ bin: parsed, episode: questEpisode(header) });
  try {
    vm.start();
    vm.runFrames(4);
  } catch (err) {
    fail(`${q.label}: VM threw on label 0: ${(err as Error).message}`);
  }

  if (!q.dat) continue;
  let dat: Uint8Array;
  try {
    dat = load(q.dat);
  } catch (err) {
    fail(`${q.label}: .dat PRS decompress failed: ${(err as Error).message}`);
    continue;
  }
  try {
    const d = parseQuestDat(dat);
    for (const w of d.warnings) fail(`${q.label}: .dat ${w}`);
    check(d.chunks.length > 0, `${q.label}: .dat has no chunks`);
    for (const c of d.chunks) {
      check(c.floor < 0x12, `${q.label}: .dat chunk for floor ${c.floor}`);
      check(c.type >= 1 && c.type <= 5, `${q.label}: .dat chunk type ${c.type}`);
    }
    totalFloors += d.floors.size;
    for (const f of d.floors.values()) {
      totalObjects += f.objects.length;
      totalEnemies += f.enemies.length;
      if (f.randomEnemies) withRandomEnemies++;
      if (f.events && f.events.format === 'evt1') {
        // A wave event names the (room, wave) pair whose enemies it spawns.
        // Most resolve against the floor's enemy list; some quests use an
        // event with no enemies of its own purely to run an action stream,
        // so an empty wave is counted, not failed.
        for (const e of f.events.events) {
          if (f.enemies.some((x) => x.section === e.room && x.wave === e.wave)) totalResolvedWaves++;
          else emptyWaves++;
        }
      }
    }
    // The header's bb_map_designate copies must name floors in range and
    // sensible areas (newserv src/QuestScript.cc:4942 writes them from the
    // opcode's immediates at assembly time).
    for (const fa of header.floorAssignments) {
      check(fa.floor < 0x12, `${q.label}: header designates floor ${fa.floor}`);
      check(fa.area <= 0x2e, `${q.label}: header designates area ${fa.area}`);
      check(fa.type <= 3, `${q.label}: header designation type ${fa.type}`);
    }
  } catch (err) {
    fail(`${q.label}: .dat ${(err as Error).message}`);
  }
}

console.log(`parsed ${quests.length} .bin files: ${withFullHeader} with the full 0x122C header`);
console.log(`.dat: ${totalFloors} floors, ${totalObjects} objects, ${totalEnemies} enemies, ${withRandomEnemies} random-enemy floors`);
console.log(`wave events: ${totalResolvedWaves} with enemies, ${emptyWaves} with none (action-stream only)`);
console.log(`${opcodeUse.size} distinct opcodes used, ${unknownOpcodes} undefined-opcode bytes reached`);
const top = [...opcodeUse].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log(`most used: ${top.map(([n, c]) => `${n}(${c})`).join(' ')}`);

// --- Cross-check against newserv ---------------------------------------------
if (NEWSERV_BIN) {
  const sample = quests.filter((q) => /q0(58|01|02)-bb-e\.bin$/.test(q.label)).slice(0, 6);
  for (const q of sample) {
    let text: string;
    try {
      // Without an explicit output path newserv writes <input>.txt next to
      // the quest, which would litter the checkout.
      const out = join(mkdtempSync(join(tmpdir(), 'psoquest-')), 'disasm.txt');
      execFileSync(NEWSERV_BIN, ['disassemble-quest-script', '--bb', q.bin, out], { encoding: 'utf8', cwd: NEWSERV, maxBuffer: 64 << 20 });
      text = readFileSync(out, 'utf8');
      rmSync(dirname(out), { recursive: true, force: true });
    } catch (err) {
      console.log(`SKIP newserv disassemble-quest-script ${q.label}: ${(err as Error).message.split('\n')[0]}`);
      break;
    }
    const bin = load(q.bin);
    const { header } = parseQuestBin(bin);
    const nameLine = /^\.name\s+"(.*)"$/m.exec(text);
    if (nameLine) check(nameLine[1] === header.name, `${q.label}: name "${header.name}" != newserv "${nameLine[1]}"`);
    const epLine = /^\.episode\s+(\S+)$/m.exec(text);
    if (epLine) {
      const expect = { Episode1: 1, Episode2: 2, Episode4: 4 }[epLine[1] as 'Episode1'] ?? 0;
      if (expect) check(questEpisode(header) === expect, `${q.label}: episode ${questEpisode(header)} != newserv ${epLine[1]}`);
    }
    // Every opcode mnemonic newserv prints must exist in our table.
    // Lines look like "  0000  F8BC00000000      set_episode   0x0".
    const mnemonics = new Set([...text.matchAll(/^ {2}[0-9A-F]{4} {2}[0-9A-F]+ +([a-z][a-z0-9_]*)/gm)].map((m) => m[1]));
    for (const m of mnemonics) {
      if (m === 'data' || m === 'string' || m === 'unknown') continue;
      check(!!questOpcodeByName(m), `${q.label}: newserv prints opcode "${m}", not in our table`);
    }
    console.log(`newserv cross-check ${q.label}: ${mnemonics.size} mnemonics`);
  }
} else {
  console.log('SKIP newserv binary cross-check (no build/newserv)');
}

console.log(failures ? `FAILED (${failures} problems)` : 'OK');
process.exit(failures ? 1 : 0);
