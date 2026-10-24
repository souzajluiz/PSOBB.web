// Optimal PRS parse (prsCompressOptimal) against the greedy one and newserv.
//
// Round trip through prsDecompress on random and repetitive data, never larger
// than prsCompress, the window edge (distance 8191), and, when a newserv build
// is present, the same size as newserv's `compress-prs --optimal` on the BB
// quests (the parses can differ in ties, so only sizes are compared).
//
// Run: node tests/prscompress.test.ts
// Env: NEWSERV (newserv checkout; default: vendor/newserv next to the main checkout).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { prsCompress, prsCompressOptimal } from '../client/src/formats/prscompress.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = (() => {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim();
    return dirname(common);
  } catch {
    return join(HERE, '..');
  }
})();

let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const rng = (() => {
  let s = 987654321;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x100000000;
})();
const randomBytes = (n: number, alphabet = 256): Uint8Array => Uint8Array.from({ length: n }, () => (rng() * alphabet) | 0);

const cases: Record<string, Uint8Array> = {
  empty: new Uint8Array(0),
  one: Uint8Array.of(7),
  two: Uint8Array.of(1, 1),
  three: Uint8Array.of(1, 2, 1),
  zeros: new Uint8Array(100000),
  random: randomBytes(5000),
  smallAlphabet: randomBytes(20000, 4),
  text: new TextEncoder().encode('the quick brown fox jumps over the lazy dog. '.repeat(500)),
  mixed: Uint8Array.from({ length: 70000 }, (_, i) => (i % 97 < 60 ? (i * 7) & 0xff : (rng() * 8) | 0)),
  pairs: Uint8Array.from({ length: 4000 }, (_, i) => (i % 5 === 0 ? 0xaa : (rng() * 256) | 0)),
  // A copy at distance 8191, the largest long-copy distance.
  farEdge: (() => {
    const a = new Uint8Array(8191 + 300);
    a.set(randomBytes(8191));
    a.copyWithin(8191, 0, 300);
    return a;
  })(),
  // Runs of exactly 256 and lengths that straddle the 9 / 10 boundary.
  runs: Uint8Array.from({ length: 30000 }, (_, i) => (Math.floor(i / 9) % 3 === 0 ? 0x55 : (i * 31) & 0xff)),
  shortDist: Uint8Array.from({ length: 3000 }, (_, i) => (i % 256 < 128 ? i & 0x3f : (rng() * 256) | 0)),
};

// --- Round trip and size ---------------------------------------------------------
for (const [name, data] of Object.entries(cases)) {
  const opt = prsCompressOptimal(data);
  check(same(prsDecompress(opt), data), `optimal ${name}: round trip failed`);
  const greedy = prsCompress(data);
  check(opt.length <= greedy.length, `optimal ${name}: ${opt.length} bytes, greedy ${greedy.length}`);
}
// 391 extended copies of 256 bytes at 26 bits each (plus the terminator): 1275 bytes.
check(prsCompressOptimal(cases.zeros).length <= 1275, `optimal: 100000 zeros gave ${prsCompressOptimal(cases.zeros).length} bytes`);
check(prsCompressOptimal(cases.text).length < cases.text.length / 20, 'optimal: repeated text compressed poorly');

// Random data expands by at most the control bytes plus the terminator.
{
  const data = randomBytes(10000);
  const opt = prsCompressOptimal(data);
  check(opt.length <= Math.ceil((data.length * 9) / 8) + 4, `optimal: random data gave ${opt.length} bytes`);
}

// Several seeds, random lengths and alphabets: round trip and size.
for (let t = 0; t < 40; t++) {
  const n = 1 + Math.floor(rng() * 6000);
  const alphabet = [2, 3, 16, 256][t % 4];
  const data = randomBytes(n, alphabet);
  // Repeat a slice further back so long copies at a range of distances appear.
  if (n > 1000) {
    const from = Math.floor(rng() * (n - 800));
    data.copyWithin(n - 500, from, from + 300);
  }
  const opt = prsCompressOptimal(data);
  check(same(prsDecompress(opt), data), `optimal seed ${t} (n=${n}, alphabet ${alphabet}): round trip failed`);
  check(opt.length <= prsCompress(data).length, `optimal seed ${t}: larger than greedy`);
}

// --- Time on a ~100 KB input -----------------------------------------------------
{
  const data = Uint8Array.from({ length: 100 * 1024 }, (_, i) => (i % 113 < 80 ? (i * 13) & 0xff : (rng() * 40) | 0));
  const t0 = performance.now();
  const opt = prsCompressOptimal(data);
  const ms = performance.now() - t0;
  console.log(`optimal 100 KB: ${data.length} -> ${opt.length} bytes (greedy ${prsCompress(data).length}) in ${ms.toFixed(0)} ms`);
  check(same(prsDecompress(opt), data), 'optimal 100 KB: round trip failed');
  check(ms < 10000, `optimal 100 KB took ${ms.toFixed(0)} ms`);
}

// --- newserv ----------------------------------------------------------------------
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find(
  (d) => d && existsSync(join(d, 'system/quests')),
);
const NEWSERV_BIN = NEWSERV && existsSync(join(NEWSERV, 'build/newserv')) ? join(NEWSERV, 'build/newserv') : null;
if (!NEWSERV || !NEWSERV_BIN) {
  console.log('SKIP newserv size comparison (no newserv build with system/quests; set NEWSERV)');
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'prsopt-'));
  try {
    const quests: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/-bb-[a-z]\.bin$|-bb\.dat$/.test(e.name)) quests.push(p);
      }
    };
    walk(join(NEWSERV, 'system/quests'));
    quests.sort();
    // Every 8th file keeps the run short; the sizes are what is compared.
    let compared = 0;
    let ours = 0;
    let theirs = 0;
    for (let k = 0; k < quests.length; k += 8) {
      const raw = prsDecompress(new Uint8Array(readFileSync(quests[k])));
      const input = join(tmp, 'in.bin');
      const output = join(tmp, 'out.prs');
      writeFileSync(input, raw);
      execFileSync(NEWSERV_BIN, ['compress-prs', '--optimal', input, output], { stdio: 'ignore' });
      const ns = readFileSync(output);
      const mine = prsCompressOptimal(raw);
      check(same(prsDecompress(new Uint8Array(ns)), raw), `newserv output for ${quests[k]} does not round trip here`);
      check(mine.length === ns.length, `${quests[k]}: optimal ${mine.length} bytes, newserv ${ns.length}`);
      compared++;
      ours += mine.length;
      theirs += ns.length;
    }
    console.log(`newserv: ${compared} quests, optimal sizes ${ours} (ours) vs ${theirs} (newserv)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('OK');
