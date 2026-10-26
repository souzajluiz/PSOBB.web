// Quest editor entity clipboard: copy, cut-style copy, paste onto the same or
// another floor, repeated pastes, and paste into another document through the
// model (undo and redo included). Pure logic, no DOM.
//
// Run: node tests/questeditor-clipboard.test.ts
import { createEnemy, createObject, QuestDocument } from '../client/src/questeditor/model.ts';
import { clearClipboard, clipboardContents, copyEntities, PASTE_OFFSET, takePaste } from '../client/src/questeditor/clipboard.ts';
import type { SetEntity } from '../client/src/formats/setdata.ts';

let failures = 0;
let checks = 0;
const check = (cond: boolean, msg: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 40) console.log(`FAIL ${msg}`);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// --- Copy and paste on one floor ---------------------------------------------------
{
  clearClipboard();
  eq(takePaste(1), null, 'empty clipboard: nothing to paste');
  eq(copyEntities([]), null, 'copying an empty list leaves the clipboard empty');

  const doc = new QuestDocument();
  const a = doc.addEntity(1, createEnemy(0x40, 1, 2, [5, 0, 5]));
  const b = doc.addEntity(1, createObject(0x10, 1, 2, [-3, 1, 7]));
  doc.select([a, b]);
  const clip = copyEntities(doc.selection);
  check(clip !== null && clip.entities.length === 2, 'copy keeps both entities');
  eq(clipboardContents()?.floor, 1, 'copy records the source floor');

  // The copies are independent of the originals.
  a.position[0] = 999;
  eq(clip!.entities[0].position, [5, 0, 5], 'the clipboard holds copies, not the originals');
  a.position[0] = 5;

  const first = takePaste(1)!;
  eq(first.map((e) => e.position), [
    [5 + PASTE_OFFSET[0], 0 + PASTE_OFFSET[1], 5 + PASTE_OFFSET[2]],
    [-3 + PASTE_OFFSET[0], 1 + PASTE_OFFSET[1], 7 + PASTE_OFFSET[2]],
  ], 'first paste onto the source floor is shifted by one offset');
  const second = takePaste(1)!;
  eq(second[0].position[0], 5 + 2 * PASTE_OFFSET[0], 'second paste onto the same floor shifts by two offsets');
  eq(second.map((e) => e.kind), ['enemy', 'object'], 'paste keeps the entity kinds');
  eq(second[0].section, 2, 'paste keeps the room of the entity');
  check(second[0] !== first[0] && second[0].params !== first[0].params, 'each paste makes new copies');
}

// --- Paste onto another floor keeps the copied positions ----------------------------
{
  clearClipboard();
  const doc = new QuestDocument();
  const e = doc.addEntity(2, createEnemy(0x41, 2, 4, [1, 2, 3]));
  doc.select([e]);
  copyEntities(doc.selection);
  const onOther = takePaste(3)!;
  eq(onOther.length, 1, 'one entity pasted');
  eq(onOther[0].floor, 3, 'the paste lands on the target floor');
  eq(onOther[0].position, [1, 2, 3], 'another floor: the copied position is kept');
  eq(onOther[0].section, 4, 'another floor: the room is kept');
  // A paste elsewhere does not move the counter for the source floor.
  eq(takePaste(2)![0].position, [1 + PASTE_OFFSET[0], 2, 3 + PASTE_OFFSET[2]], 'the source floor counts its own pastes');
}

// --- Copy takes only the selection's entities of one floor --------------------------
{
  clearClipboard();
  const doc = new QuestDocument();
  const x = doc.addEntity(1, createEnemy(0x40, 1, 0));
  const y = doc.addEntity(2, createEnemy(0x40, 2, 0));
  copyEntities([x, y]);
  eq(clipboardContents()?.floor, 1, 'a mixed-floor copy keeps the first floor');
  eq(clipboardContents()?.entities.length, 1, 'a mixed-floor copy keeps only that floor');
}

// --- Paste into the model: one undo step, into another quest ------------------------
{
  clearClipboard();
  const source = new QuestDocument();
  const s1 = source.addEntity(1, createEnemy(0x44, 1, 1, [7, 0, 7]));
  source.select([s1]);
  copyEntities(source.selection);

  const target = new QuestDocument();
  const copies = takePaste(4)!;
  target.addEntities(4, copies, 'Paste');
  eq(target.entitiesOf(4).length, 1, 'pasted into another quest on floor 4');
  eq(target.entitiesOf(4)[0].position, [7, 0, 7], 'the pasted entity keeps its position');
  eq(target.selected.length, 1, 'the pasted entities are selected');
  target.undo();
  eq(target.entitiesOf(4).length, 0, 'undo removes the paste');
  target.redo();
  eq(target.entitiesOf(4).length, 1, 'redo restores the paste');
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
