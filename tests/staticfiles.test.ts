// bridge/static-files.mjs (the lookup behind bridge/server.mjs): a temp
// folder with mixed-case names. Exact hits, case-mismatch hits (the exact name
// wins when both exist), traversal rejected, missing names null, directories
// matched by case too, and the listing cache refreshed when a folder changes.
// Run: node tests/staticfiles.test.ts  (on Linux too: the case rules differ)
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResolver } from '../bridge/static-files.mjs';

let failures = 0;
let checks = 0;
function eq(a: unknown, b: unknown, msg: string): void {
  checks++;
  if (a !== b) {
    failures++;
    console.error(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
}

const base = mkdtempSync(join(tmpdir(), 'staticfiles-'));
const root = join(base, 'data');
try {
  // The folder as the data zip might hold it: mixed-case names, one nested folder.
  mkdirSync(join(root, 'scene'), { recursive: true });
  mkdirSync(join(root, 'Sound'));
  writeFileSync(join(root, 'PlAnj.bml'), 'body');
  writeFileSync(join(root, 'x.prs'), 'lower');
  // On a case-folding disk (macOS) X.prs is the same file, so the two-names check is skipped there.
  const folds = readdirSync(root).includes('x.prs') && existsSync(join(root, 'X.prs'));
  if (!folds) writeFileSync(join(root, 'X.prs'), 'upper');
  writeFileSync(join(root, 'scene', 'Map_Lobby_01.xvm'), 'xvm');
  writeFileSync(join(base, 'secret.txt'), 'outside the root');

  const r = createResolver();

  // Exact hit.
  eq(r.file(root, 'PlAnj.bml'), join(root, 'PlAnj.bml'), 'exact hit');
  eq(r.file(root, 'scene/Map_Lobby_01.xvm'), join(root, 'scene', 'Map_Lobby_01.xvm'), 'exact hit in a folder');

  // Case-mismatch hit: the names the client asks for in other cases.
  eq(r.file(root, 'plAnj.bml'), join(root, 'PlAnj.bml'), 'case mismatch (lower first letter)');
  eq(r.file(root, 'PLANJ.BML'), join(root, 'PlAnj.bml'), 'case mismatch (upper)');
  eq(r.file(root, 'SCENE/map_lobby_01.XVM'), join(root, 'scene', 'Map_Lobby_01.xvm'), 'case mismatch in folder and file');
  eq(r.directory(root, 'sound'), join(root, 'Sound'), 'folder case mismatch');
  eq(r.directory(root, ''), root, 'empty path is the root folder');

  // The exact name wins when two names differ only in case.
  if (!folds) {
    eq(r.file(root, 'x.prs'), join(root, 'x.prs'), 'exact name wins over a case variant');
    eq(r.file(root, 'X.prs'), join(root, 'X.prs'), 'exact upper name wins');
  }

  // Missing names and wrong kinds.
  eq(r.file(root, 'nope.bml'), null, 'missing file is null');
  eq(r.file(root, 'scene/nope.xvm'), null, 'missing file in a folder is null');
  eq(r.file(root, 'scene'), null, 'a folder is not a file');
  eq(r.file(root, 'PlAnj.bml/x'), null, 'a file is not a folder');
  eq(r.directory(root, 'missing'), null, 'missing folder is null');

  // Traversal: nothing outside the root, whatever the case or the separators.
  eq(r.file(root, '../secret.txt'), null, 'parent segment rejected');
  eq(r.file(root, 'scene/../../secret.txt'), null, 'parent segment after a folder rejected');
  eq(r.file(root, 'SCENE/../../SECRET.TXT'), null, 'parent segment rejected in any case');
  eq(r.file(root, '/../secret.txt'), null, 'leading slash and parent segment rejected');
  eq(r.file(root, '..'), null, 'bare parent rejected');
  eq(r.directory(root, '../'), null, 'parent folder rejected');
  eq(r.file(root, 'scene\\..\\..\\secret.txt'), null, 'backslash separators rejected');
  eq(r.file(root, '/etc/passwd'), null, 'absolute path not taken from the disk');

  // The listing cache: a file added to a folder is found once its mtime moves.
  eq(r.file(root, 'late.bin'), null, 'not there yet');
  writeFileSync(join(root, 'Late.bin'), 'added');
  utimesSync(root, new Date(), new Date(Date.now() + 5000));
  eq(r.file(root, 'late.bin'), join(root, 'Late.bin'), 'a file added later is found (listing refreshed)');
} finally {
  rmSync(base, { recursive: true, force: true });
}

console.log(failures === 0 ? `ALL PASS (${checks} checks)` : `${failures} of ${checks} checks FAILED`);
process.exit(failures === 0 ? 0 : 1);
