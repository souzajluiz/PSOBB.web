// Cross-checks the TS ports against the newserv CLI (built in vendor/newserv).
// Run: node web/tests/oracle.test.ts   (Node >= 23.6, type stripping)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BBCrypt } from '../client/src/net/bbcrypt.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NEWSERV_DIR = join(ROOT, 'vendor/newserv');
const NEWSERV = join(NEWSERV_DIR, 'build/newserv');
const CLIENT_DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const tmp = mkdtempSync(join(tmpdir(), 'psobb-oracle-'));

let failures = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
}
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const newserv = (...args: string[]) => execFileSync(NEWSERV, args, { cwd: NEWSERV_DIR, stdio: 'pipe' });

// BB crypt: encrypt with newserv, decrypt + re-encrypt with TS, for each STANDARD key.
for (const key of ['default', 'default4', 'bfr1']) {
  const nsk = new Uint8Array(readFileSync(join(NEWSERV_DIR, `system/blueburst/keys/${key}.nsk`)));
  if (new DataView(nsk.buffer).getUint32(0x1048, true) !== 0) continue;
  const seed = new Uint8Array(randomBytes(48));
  const plain = new Uint8Array(randomBytes(0x400));
  writeFileSync(join(tmp, 'plain.bin'), plain);
  newserv('encrypt-data', '--bb', `--key=${key}`, `--seed=${Buffer.from(seed).toString('hex')}`,
    join(tmp, 'plain.bin'), join(tmp, 'enc.bin'));
  const expected = new Uint8Array(readFileSync(join(tmp, 'enc.bin')));

  const enc = plain.slice();
  new BBCrypt(nsk, seed).encrypt(enc);
  check(`bbcrypt encrypt matches newserv (${key})`, eq(enc, expected));
  const dec = expected.slice();
  new BBCrypt(nsk, seed).decrypt(dec);
  check(`bbcrypt decrypt round-trips (${key})`, eq(dec, plain));
}

// PRS: decompress real client .prs files and compare with newserv.
const gsl = new GSLArchive(new Uint8Array(readFileSync(join(CLIENT_DATA, 'data.gsl'))));
const prsNames = [...gsl.entries.keys()].filter((n) => n.endsWith('.prs')).slice(0, 20);
for (const name of prsNames) {
  const src = gsl.get(name);
  writeFileSync(join(tmp, 'in.prs'), src);
  try {
    newserv('decompress-prs', join(tmp, 'in.prs'), join(tmp, 'out.bin'));
  } catch {
    // Not plain PRS (newserv rejects it too); the TS port must also reject it.
    let threw = false;
    try { prsDecompress(src); } catch { threw = true; }
    check(`prs ${name} rejected by both`, threw);
    continue;
  }
  const expected = new Uint8Array(readFileSync(join(tmp, 'out.bin')));
  check(`prs ${name} (${src.length} -> ${expected.length})`, eq(prsDecompress(src), expected));
}

// GSL: compare entry list with newserv extract-gsl.
const gslDir = join(tmp, 'gsl');
newserv('extract-gsl', join(CLIENT_DATA, 'data.gsl'), gslDir);
const extracted = readdirSync(gslDir);
check(`gsl entry count ${gsl.entries.size} == newserv ${extracted.length}`, gsl.entries.size === extracted.length);
const sample = extracted.find((f) => f.endsWith('.rel'))!;
check(`gsl content ${sample}`, eq(gsl.get(sample), new Uint8Array(readFileSync(join(gslDir, sample)))));

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
