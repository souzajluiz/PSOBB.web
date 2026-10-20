// Runs every Blue Burst quest newserv ships through the quest VM (start label,
// then a number of frames with the default host) and reports what the VM does
// not implement: opcodes skipped, errors thrown, quests that never start.
// Not a pass / fail test: it is the work list for "all quests run".
//
// Run: node tests/questaudit.ts [frames] [filter]
// Env: NEWSERV (checkout with system/quests; default vendor/newserv).
//      FLOORS=1 also runs every floor handler the quest registered (battle quests
//      set their rules there, not in the start label).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { QuestSession } from '../client/src/quest/session.ts';
import type { LoadedQuest } from '../client/src/net/quests.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = (() => {
  try {
    return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim());
  } catch {
    return join(HERE, '..');
  }
})();
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
if (!NEWSERV) {
  console.log('SKIP no newserv checkout with system/quests');
  process.exit(0);
}
const FRAMES = Number(process.argv[2] ?? 600);
const FILTER = process.argv[3] ?? '';
const root = join(NEWSERV, 'system/quests');
const load = (p: string) => prsDecompress(new Uint8Array(readFileSync(p)));

const byOpcode = new Map<string, Set<string>>();
const errors: string[] = [];
let ran = 0;
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const files = readdirSync(join(root, dir.name));
  for (const f of files) {
    const m = /^(.+)-bb-e\.bin$/.exec(f) ?? (files.includes(f.replace(/-bb-j\.bin$/, '-bb-e.bin')) ? null : /^(.+)-bb-j\.bin$/.exec(f));
    if (!m || !files.includes(`${m[1]}-bb.dat`)) continue;
    const label = `${dir.name}/${m[1]}`;
    if (FILTER && !label.includes(FILTER)) continue;
    try {
      const bin = load(join(root, dir.name, f));
      const dat = load(join(root, dir.name, `${m[1]}-bb.dat`));
      const lq: LoadedQuest = { name: m[1], binFilename: f, datFilename: `${m[1]}-bb.dat`, bin, dat, binCompressedSize: 0, datCompressedSize: 0, download: false };
      const s = new QuestSession(lq, { log: () => {} });
      s.start();
      if (process.env.FLOORS) for (let f = 0; f < s.vm.floorHandlers.length; f++) if (s.vm.floorHandlers[f]! >= 0) s.enterFloor(f);
      for (let i = 0; i < FRAMES; i++) s.vm.frame();
      for (const name of s.vm.unimplemented.keys()) {
        if (!byOpcode.has(name)) byOpcode.set(name, new Set());
        byOpcode.get(name)!.add(label);
      }
      ran++;
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
    }
  }
}
console.log(`${ran} quests ran, ${errors.length} threw`);
for (const e of errors.slice(0, 40)) console.log(`  THROW ${e}`);
const rows = [...byOpcode.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`${rows.length} opcodes not implemented (quests using them, in the first ${FRAMES} frames):`);
for (const [name, qs] of rows) console.log(`  ${name}: ${qs.size}  e.g. ${[...qs].slice(0, 3).join(', ')}`);
