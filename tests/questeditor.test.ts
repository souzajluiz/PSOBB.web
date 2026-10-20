// Quest editor model: history, entity / event edits with undo and redo, the .dat
// and .bin byte codecs, header edits, coordinate helpers. Pure logic: no DOM,
// no three.js, none of the write-side modules (those are exercised by their own
// tests). When a newserv checkout with BB quests is around, every quest is also
// loaded into the model and written back to .dat bytes that parse to the same
// entities and events.
//
// Run: node tests/questeditor.test.ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { parseQuestDat } from '../client/src/formats/questdat.ts';
import { parseEventFile } from '../client/src/formats/events.ts';
import { sectionToWorld } from '../client/src/formats/setdata.ts';
import { applyHeader, newQuestBin, upgradeToFullHeader } from '../client/src/questeditor/binhead.ts';
import { buildQuestDatBytes, encodeActions, formatActions, parseActionText, serializeEnemySet, serializeEvents, serializeObjectSet } from '../client/src/questeditor/datcodec.ts';
import { worldToSection, nearestSection, degreesToBams, bamsToDegrees, wrapBams } from '../client/src/questeditor/geom.ts';
import { History, type Command } from '../client/src/questeditor/history.ts';
import { createEnemy, createEvent, createObject, QuestDocument, type Change } from '../client/src/questeditor/model.ts';
import { floorToArea, gameEpisode } from '../client/src/questeditor/areas.ts';
import { errorLine, findLabels, wordAt } from '../client/src/questeditor/panel_script.ts';
import { paletteEntries } from '../client/src/questeditor/panel_entities.ts';
import { adminSession, buildPublishBody, defaultPublishName, listQuestDirectories, PUBLISH_NAME_RE, publishQuest, toBase64 } from '../client/src/questeditor/publish.ts';
import { buildPackage } from '../client/src/questeditor/io.ts';
import { parseEnemySets, parseObjectSets } from '../client/src/formats/setdata.ts';

let failures = 0;
let checks = 0;
const check = (cond: boolean, msg: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 40) console.log(`FAIL ${msg}`);
  }
};
// JSON with sorted keys, so field order does not matter.
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !ArrayBuffer.isView(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x));
const eq = (a: unknown, b: unknown, msg: string) => check(canon(a) === canon(b), `${msg}: ${canon(a)} != ${canon(b)}`);
const throws = (fn: () => void, msg: string) => {
  try {
    fn();
    check(false, `${msg} (did not throw)`);
  } catch {
    check(true, msg);
  }
};

// --- History -------------------------------------------------------------------
{
  const h = new History();
  let v = 0;
  const set = (to: number, key?: string): Command => {
    const from = v;
    const cmd = (f: number, t: number): Command => ({
      label: `to ${t}`,
      redo: () => (v = t),
      undo: () => (v = f),
      ...(key ? { mergeKey: key, merge: (n: Command) => (n as unknown as { to: number }).to !== undefined ? cmd(f, (n as unknown as { to: number }).to) : null } : {}),
    });
    return Object.assign(cmd(from, to), { to });
  };
  check(!h.canUndo && !h.canRedo && !h.dirty, 'empty history');
  h.run(set(1));
  h.run(set(2));
  eq(v, 2, 'run');
  h.undo();
  eq(v, 1, 'undo');
  check(h.canRedo, 'can redo');
  h.redo();
  eq(v, 2, 'redo');
  h.undo();
  h.run(set(5));
  check(!h.canRedo, 'new command clears redo');
  h.undo();
  h.undo();
  eq(v, 0, 'undo all');
  check(h.undo() === null, 'undo on empty');
  h.redo();
  h.redo();
  // merging
  h.markClean();
  check(!h.dirty, 'clean after markClean');
  h.run(set(10, 'drag'));
  h.run(set(11, 'drag'));
  h.run(set(12, 'drag'));
  eq(h.size.undo, 3, 'moves after a save merge with each other, not into the saved entry');
}
{
  // merge: 3 moves -> 1 entry; seal splits
  const h = new History();
  let v = 0;
  const mk = (f: number, t: number): Command => ({
    label: 'move',
    redo: () => (v = t),
    undo: () => (v = f),
    mergeKey: 'drag',
    merge: (n) => mk(f, (n as unknown as { to: number }).to),
  });
  const move = (to: number) => Object.assign(mk(v, to), { to });
  h.run(move(1));
  h.run(move(2));
  h.run(move(3));
  eq(h.size.undo, 1, 'three drags merge');
  h.seal();
  h.run(move(4));
  eq(h.size.undo, 2, 'seal splits the run');
  h.undo();
  eq(v, 3, 'undo one run');
  h.undo();
  eq(v, 0, 'undo merged run goes back to the start');
  // dirty tracking
  h.redo();
  h.markClean();
  check(!h.dirty, 'clean');
  h.undo();
  check(h.dirty, 'dirty after undo');
  h.redo();
  check(!h.dirty, 'clean again after redo');
  h.run(move(9));
  check(h.dirty, 'dirty after a new command');
  const lim = new History(3);
  for (let i = 0; i < 6; i++) lim.run({ label: 'x', redo() {}, undo() {} });
  eq(lim.size.undo, 3, 'history limit');
}

// --- Entity codec ----------------------------------------------------------------
{
  const o = createObject(0x20, 3, 5, [1.5, -2, 30.25]);
  o.rotation = [0, 0x4000, -0x2000];
  o.group = 7;
  o.unknownA3 = 3;
  o.params = [1.5, 2.5, -3.5, 4, -5, 6];
  const back = parseObjectSets(serializeObjectSet(o))[0];
  eq({ ...back, floor: 3, index: 0 }, { ...o, index: 0 }, 'object roundtrip');
  const e = createEnemy(0x44, 2, 9, [10, 0, -10]);
  e.rotation = [0, 0x8000, 0];
  e.numChildren = 2;
  e.wave = 4;
  e.wave2 = 5;
  e.unknownA1 = 6;
  e.params = [0.5, 1, 1.5, 2, 2.5, -3, 4];
  const eb = parseEnemySets(serializeEnemySet(e))[0];
  eq({ ...eb, index: 0 }, { ...e, index: 0 }, 'enemy roundtrip');
}

// --- Events ----------------------------------------------------------------------------
{
  const ev1 = createEvent(100, 2, 1);
  ev1.delay = 30;
  ev1.actions = [{ op: 'setSwitchFlag', flag: 3 }, { op: 'constructObjects', room: 2, group: 1 }, { op: 'triggerEvent', eventId: 0x1234 }, { op: 'constructEnemies', room: 2, wave: 2, stop: true }];
  const ev2 = createEvent(101, 3, 1);
  ev2.flags = 4;
  ev2.actions = [{ op: 'clearSwitchFlag', flag: 9 }, { op: 'nop' }];
  const bytes = serializeEvents([ev1, ev2]);
  const file = parseEventFile(bytes);
  eq(file.events.length, 2, 'event count');
  eq(file.events[0].actions, ev1.actions, 'actions roundtrip (ends with 0d)');
  eq(file.events[1].actions, [...ev2.actions, { op: 'stop' }], 'a missing terminator is added');
  eq([file.events[1].id, file.events[1].flags, file.events[1].room, file.events[0].delay], [101, 4, 3, 30], 'event fields');
  eq(parseEventFile(serializeEvents([])).events, [], 'empty event file');
  eq(encodeActions([]), Uint8Array.from([1]), 'empty action list is a stop');
  const text = formatActions(ev1.actions);
  eq(parseActionText(text), ev1.actions, 'action text roundtrip');
  eq(parseActionText('# comment\nconstruct_enemies 1 0x10 ; spawn\nstop'), [{ op: 'constructEnemies', room: 1, wave: 16, stop: false }, { op: 'stop' }], 'action text comments and hex');
  throws(() => parseActionText('jump 3'), 'unknown action name');
  throws(() => parseActionText('construct_enemies 1'), 'missing operand');
  throws(() => parseActionText('stop 1'), 'extra operand');
  throws(() => parseActionText('set_switch_flag 70000'), 'operand out of range');
}

// --- .dat build ---------------------------------------------------------------------------
{
  const o1 = createObject(1, 1, 0);
  const e1 = createEnemy(0x40, 1, 1);
  const bytes = buildQuestDatBytes([
    { floor: 2, objects: [], enemies: [createEnemy(0x41, 2, 0)], events: null, extra: [{ type: 4, data: Uint8Array.from([1, 2, 3]) }] },
    { floor: 1, objects: [o1], enemies: [e1], events: serializeEvents([createEvent(1, 1, 0)]), extra: [] },
  ]);
  const dat = parseQuestDat(bytes);
  eq([...dat.floors.keys()].sort(), [1, 2], 'floors in the built .dat');
  eq(dat.floors.get(1)!.objects.length + dat.floors.get(1)!.enemies.length, 2, 'entities of floor 1');
  eq(dat.floors.get(1)!.events!.events.length, 1, 'event of floor 1');
  check(dat.floors.get(2)!.randomEnemies, 'random section kept');
  eq(dat.chunks.find((c) => c.type === 4)!.data.length, 3, 'unknown payloads are not padded');
  eq(dat.warnings, [], 'no warnings');
  eq(parseQuestDat(buildQuestDatBytes([])).chunks, [], 'empty .dat');
}

// --- Geometry ------------------------------------------------------------------------------------
{
  const s = { id: 1, position: [100, 20, -50] as [number, number, number], rotation: [0.3, -1.1, 0.7] as [number, number, number] };
  for (const p of [[1, 2, 3], [-40, 7, 12.5], [0, 0, 0]] as Array<[number, number, number]>) {
    const w = sectionToWorld(s, p);
    const b = worldToSection(s, w);
    check(Math.abs(b[0] - p[0]) < 1e-9 && Math.abs(b[1] - p[1]) < 1e-9 && Math.abs(b[2] - p[2]) < 1e-9, `world <-> section ${p}`);
  }
  eq(nearestSection([{ id: 1, position: [0, 0, 0], rotation: [0, 0, 0] }, { id: 2, position: [100, 0, 0], rotation: [0, 0, 0] }], [70, 5, 3])?.id, 2, 'nearest section');
  eq(degreesToBams(90), 0x4000, 'degrees to BAMS');
  eq(bamsToDegrees(0x8000), 180, 'BAMS to degrees');
  eq([wrapBams(-1), wrapBams(0x10001), wrapBams(5)], [0xffff, 1, 5], 'wrapBams');
  eq([gameEpisode(0), gameEpisode(1), gameEpisode(2)], [1, 2, 3], 'episode mapping');
  eq([floorToArea(1)[3], floorToArea(2)[3], floorToArea(3)[3]], [3, 0x15, 0x26], 'floor to area');
}

// --- Script editor helpers -------------------------------------------------------------------------
{
  const text = '.quest_num 5\n\nstart:\n  jmp label0001\nlabel0001:   ; comment\n  ret\n';
  eq(findLabels(text), [{ name: 'start', line: 2 }, { name: 'label0001', line: 4 }], 'labels found');
  eq(wordAt('  jmp label0001', 8), 'label0001', 'word under the caret');
  eq(wordAt('  jmp label0001', 13), 'label0001', 'caret at the end of a word');
  eq([errorLine('line 12: unknown opcode'), errorLine('Error at line 3, column 4'), errorLine('7: bad'), errorLine('nothing')], [12, 3, 7, null], 'assembler error line');
}

// --- Palette -----------------------------------------------------------------------------------------
{
  const forest = paletteEntries('enemy', 1);
  check(forest.some((e) => e.type === 0x43 && e.name === 'Savage Wolf'), 'Forest 1 palette has Savage Wolf');
  check(!forest.some((e) => e.type === 0xa0), 'Forest 1 palette lacks Delsaber (Cave)');
  check(paletteEntries('object', 1).some((o) => o.type === 0), 'object palette has the player spawn');
  check(paletteEntries('enemy', null).length > forest.length, 'no area lists every type');
  eq(new Set(forest.map((e) => e.type)).size, forest.length, 'palette types are unique');
}

// --- .bin header ----------------------------------------------------------------------------------
{
  const bin = newQuestBin({ episode: 1, questNumber: 77, name: 'Hello', floorAssignments: [{ floor: 1, area: 0x17, type: 0, layoutVar: 0, entitiesVar: 0 }] });
  const h = bin.header;
  eq([h.questNumber, h.episode, h.name, h.hasFullHeader, h.maxPlayers], [77, 1, 'Hello', true, 4], 'new quest header');
  eq(h.floorAssignments, [{ floor: 1, area: 0x17, type: 0, layoutVar: 0, entitiesVar: 0 }], 'new quest floors');
  eq(bin.labels.length, 1, 'one label');
  eq(bin.data[h.textOffset], 0xf8, 'start label begins with set_episode');
  const edited = applyHeader(bin, { name: 'x'.repeat(100), shortDescription: 'short', longDescription: 'long ' + 'y'.repeat(400), joinable: true, maxPlayers: 2, questNumber: 5, episode: 2 });
  eq([edited.header.name.length, edited.header.shortDescription, edited.header.longDescription.length, edited.header.joinable, edited.header.maxPlayers, edited.header.questNumber, edited.header.episode], [31, 'short', 0x11f, true, 2, 5, 2], 'header edit with truncation');
  eq(applyHeader(bin, { maxPlayers: 4 }).data[0x15], 0, 'four players is written as 0');
  const two = applyHeader(bin, {
    floorAssignments: [
      { floor: 1, area: 1, type: 0, layoutVar: 0, entitiesVar: 1 },
      { floor: 2, area: 2, type: 1, layoutVar: 0, entitiesVar: 0 },
    ],
  });
  eq(two.header.floorAssignments.map((f) => [f.floor, f.area, f.type, f.entitiesVar]), [[1, 1, 0, 1], [2, 2, 1, 0]], 'floor assignments written');
  eq(applyHeader(bin, { floorAssignments: [] }).header.floorAssignments, [], 'floor assignments cleared');
  throws(() => applyHeader(bin, { floorAssignments: Array.from({ length: 17 }, (_, i) => ({ floor: i, area: 0, type: 0, layoutVar: 0, entitiesVar: 0 })) }), 'more than 16 floors');
  // The input is not modified.
  eq(bin.header.name, 'Hello', 'applyHeader copies');
  // Upgrade of a Qedit-style header: build one by chopping the extension out.
  const small = new Uint8Array(0x398 + 8);
  small.set(bin.data.subarray(0, 0x398));
  const sdv = new DataView(small.buffer);
  sdv.setUint32(0, 0x398, true);
  sdv.setUint32(4, 0x398 + 4, true);
  sdv.setUint32(8, small.length, true);
  small[0x398] = 0x01; // ret
  sdv.setUint32(0x398 + 4, 0, true); // label 0 -> text start
  const qedit = parseQuestBin(small);
  check(!qedit.header.hasFullHeader, 'small header has no extension');
  const up = upgradeToFullHeader(qedit);
  check(up.header.hasFullHeader, 'upgraded');
  eq(up.labels.length, 1, 'upgraded label table');
  eq(up.data[up.labels[0]], 0x01, 'upgraded label 0 still points at the code');
  eq(up.header.name, 'Hello', 'upgrade keeps the header');
  eq(applyHeader(qedit, { floorAssignments: [{ floor: 3, area: 5, type: 0, layoutVar: 1, entitiesVar: 2 }] }).header.floorAssignments[0], { floor: 3, area: 5, type: 0, layoutVar: 1, entitiesVar: 2 }, 'floor assignments on a small header upgrade it');
}

// --- The document ----------------------------------------------------------------------------------------
{
  const doc = QuestDocument.blank({ episode: 0 });
  const log: Change[] = [];
  doc.onChange((c) => log.push(c));
  eq(doc.floor, 1, 'blank quest starts on its first floor');
  eq(doc.floors.get(1)!.objects.length, 1, 'blank quest has a player spawn');
  eq(doc.areaOf(1), 1, 'area of floor 1');
  eq(doc.areaOf(0), 0, 'area of an undesignated floor is the default');
  check(!doc.dirty, 'fresh document is clean');

  const e = createEnemy(0x40, 1, 0, [5, 0, 5]);
  doc.addEntity(1, e);
  const added = doc.selection[0];
  check(doc.selection.length === 1 && added.kind === 'enemy', 'added entity is selected');
  eq(doc.floors.get(1)!.enemies.map((x) => x.index), [0], 'enemy indexed');
  check(doc.dirty, 'dirty after an edit');
  check(log.some((c) => c.kind === 'entities' && c.floor === 1), 'entities change emitted');

  // drag: many patches, one undo entry
  for (let i = 1; i <= 20; i++) doc.patchEntity(added, { position: [5 + i, 0, 5] }, `drag:1`);
  doc.seal();
  eq(added.position, [25, 0, 5], 'moved');
  doc.undo();
  eq(added.position, [5, 0, 5], 'one undo reverts the whole drag');
  doc.redo();
  eq(added.position, [25, 0, 5], 'redo reapplies it');

  // fields
  doc.patchEntity(added, { wave: 3, section: 2 });
  eq([(added as { wave: number }).wave, added.section], [3, 2], 'fields patched');
  doc.undo();
  eq([(added as { wave: number }).wave, added.section], [0, 0], 'fields reverted');
  // arrays are copied, not shared with the patch
  const pos: [number, number, number] = [1, 2, 3];
  doc.patchEntity(added, { position: pos });
  pos[0] = 99;
  eq(added.position, [1, 2, 3], 'patch copies arrays');
  doc.undo();

  // delete / undo restores order
  const b = doc.addEntity(1, createEnemy(0x41, 1, 0));
  const c2 = doc.addEntity(1, createEnemy(0x42, 1, 0));
  eq(doc.floors.get(1)!.enemies.map((x) => x.type), [0x40, 0x41, 0x42], 'three enemies');
  doc.removeEntities([added]);
  eq(doc.floors.get(1)!.enemies.map((x) => [x.type, x.index]), [[0x41, 0], [0x42, 1]], 'deleted and reindexed');
  doc.undo();
  eq(doc.floors.get(1)!.enemies.map((x) => [x.type, x.index]), [[0x40, 0], [0x41, 1], [0x42, 2]], 'undo restores the position');
  doc.select([b, c2]);
  doc.deleteSelection();
  eq(doc.floors.get(1)!.enemies.length, 1, 'delete selection');
  eq(doc.selection.length, 0, 'selection pruned after delete');
  doc.undo();
  eq(doc.floors.get(1)!.enemies.length, 3, 'undo multi delete');
  doc.redo();
  eq(doc.floors.get(1)!.enemies.length, 1, 'redo multi delete');
  doc.undo();

  // duplicate
  doc.select([added]);
  doc.duplicateSelection([10, 0, 0]);
  eq(doc.floors.get(1)!.enemies.length, 4, 'duplicate adds');
  eq(doc.selection[0].position, [added.position[0] + 10, added.position[1], added.position[2]], 'duplicate offset');
  check(doc.selection[0] !== added && doc.selection[0].params !== added.params, 'duplicate is a copy');
  doc.undo();

  // events
  const ev = doc.addEvent(1, createEvent(10, 0, 0));
  eq(doc.floors.get(1)!.events.length, 1, 'event added');
  doc.patchEvent(1, ev, { delay: 60, actions: [{ op: 'stop' }] });
  eq([ev.delay, ev.actions.length], [60, 1], 'event patched');
  doc.undo();
  eq([ev.delay, ev.actions.length], [0, 2], 'event patch undone');
  eq(doc.spawnsOf(1, ev).length, 3, 'spawn list: enemies of room 0, wave 0');
  doc.removeEvent(1, ev);
  eq(doc.floors.get(1)!.events.length, 0, 'event removed');
  doc.undo();
  eq(doc.floors.get(1)!.events.length, 1, 'event restored');

  // header / designations
  doc.setHeader({ name: 'A' }, 'header:name');
  doc.setHeader({ name: 'AB' }, 'header:name');
  doc.seal();
  eq(doc.header.name, 'AB', 'name edit');
  doc.undo();
  eq(doc.header.name, 'New quest', 'typing merges into one undo step');
  doc.setDesignation(2, { area: 2, type: 1, layoutVar: 0, entitiesVar: 0 });
  eq(doc.header.floorAssignments.map((f) => f.floor), [1, 2], 'designation added');
  eq(doc.designatedFloors(), [1, 2], 'designated floors');
  doc.setDesignation(2, null);
  eq(doc.header.floorAssignments.map((f) => f.floor), [1], 'designation removed');
  doc.undo();
  doc.undo();

  // counts and output
  const counts = doc.counts();
  eq([counts.objects, counts.enemies + counts.npcs, counts.events], [1, 3, 1], 'counts');
  const dat = doc.toQuestDat();
  eq(dat.floors.get(1)!.enemies.length, 3, 'toQuestDat enemies');
  eq(dat.floors.get(1)!.objects.length, 1, 'toQuestDat objects');
  eq(dat.floors.get(1)!.events!.events.length, 1, 'toQuestDat events');
  eq(dat.warnings, [], 'no warnings');
  doc.markSaved();
  check(!doc.dirty, 'saved');

  // a document made from the written bytes is the same
  const again = QuestDocument.fromQuest(doc.toQuestBin(), dat);
  eq(again.floors.get(1)!.enemies.map((x) => [x.type, x.position]), doc.floors.get(1)!.enemies.map((x) => [x.type, x.position]), 'reload agrees');

  // evt2 floors are read-only for events
  const locked = QuestDocument.blank();
  const lf = locked.floorEdit(1);
  lf.eventsEditable = false;
  lf.rawEvents = Uint8Array.from([0, 0, 0, 0]);
  throws(() => locked.addEvent(1, createEvent(1, 0, 0)), 'cannot add events to an evt2 floor');
  eq(locked.toDatBytes().length > 16, true, 'raw events are written back');

  // replaceWith
  const other = QuestDocument.blank({ name: 'Other' });
  doc.replaceWith(other);
  eq(doc.header.name, 'Other', 'replaceWith');
  check(!doc.history.canUndo, 'history cleared');
}

// --- Real quests (optional) ------------------------------------------------------------------------------------
{
  const HERE = dirname(fileURLToPath(import.meta.url));
  const mainRoot = (() => {
    try {
      return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim());
    } catch {
      return join(HERE, '..');
    }
  })();
  const newserv = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(mainRoot, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
  if (!newserv) console.log('SKIP real quests (no newserv checkout with system/quests)');
  else {
    const root = join(newserv, 'system/quests');
    let quests = 0;
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const files = readdirSync(join(root, dir.name));
      for (const f of files) {
        const m = /^(.+)-bb-([a-z])\.bin$/.exec(f);
        if (!m || !files.includes(`${m[1]}-bb.dat`)) continue;
        try {
          const bin = parseQuestBin(prsDecompress(readFileSync(join(root, dir.name, f))));
          const dat = parseQuestDat(prsDecompress(readFileSync(join(root, dir.name, `${m[1]}-bb.dat`))));
          const doc = QuestDocument.fromQuest(bin, dat, m[1]);
          const out = doc.toQuestDat();
          const sig = (d: typeof dat) =>
            [...d.floors.values()]
              .sort((a, b) => a.floor - b.floor)
              .map((fl) => ({
                floor: fl.floor,
                objects: fl.objects.map((o) => [o.type, o.section, o.group, o.position, o.rotation, o.params]),
                enemies: fl.enemies.map((e) => [e.type, e.section, e.wave, e.wave2, e.numChildren, e.position, e.rotation, e.params]),
                events: fl.events?.events.map((e) => [e.id, e.type, e.room, e.wave, e.delay, e.actions]) ?? null,
                random: fl.randomEnemies,
              }));
          check(JSON.stringify(sig(dat)) === JSON.stringify(sig(out)), `${dir.name}/${f}: .dat round trip`);
          // a header edit that changes nothing leaves the script bytes alone
          const same = applyHeader(bin, { name: bin.header.name });
          check(same.labels.join() === bin.labels.join() && same.header.name === bin.header.name, `${dir.name}/${f}: header rewrite keeps the labels`);
          const full = upgradeToFullHeader(bin);
          check(full.header.hasFullHeader && full.labels.length === bin.labels.length, `${dir.name}/${f}: upgrade keeps the label count`);
          quests++;
        } catch (err) {
          check(false, `${dir.name}/${f}: ${(err as Error).message}`);
        }
      }
    }
    console.log(`real quests: ${quests} round-tripped`);
  }
}

// --- Publish to server (request building; the server checks everything again) ---
{
  check(defaultPublishName('q058-bb-e', 'pair') === 'q058-bb-e.bin' && defaultPublishName('q058-bb-e', 'qst') === 'q058-bb.qst', 'publish: default names keep the BB tag');
  check(defaultPublishName('my quest!', 'pair') === 'my_quest_-bb-e.bin' && PUBLISH_NAME_RE.test(defaultPublishName('my quest!', 'qst')), 'publish: unsafe characters become _');
  check(defaultPublishName('../../x', 'pair') === '_x-bb-e.bin' || PUBLISH_NAME_RE.test(defaultPublishName('../../x', 'pair')), 'publish: a traversal stem gives a valid name');
  check(defaultPublishName('', 'pair') === 'quest-bb-e.bin', 'publish: empty stem');
  check(!PUBLISH_NAME_RE.test('q1-e.bin') && !PUBLISH_NAME_RE.test('q1-bb-e.dat') && !PUBLISH_NAME_RE.test('../q1-bb.qst'), 'publish: the name pattern needs -bb and .bin / .qst');
  check(toBase64(new Uint8Array(70000).fill(65)).length === Math.ceil(70000 / 3) * 4, 'publish: base64 of a large array');
  const pkg = buildPackage(QuestDocument.blank({ episode: 0, name: 'P' }));
  const pair = buildPublishBody(pkg, 'retrieval', 'q1-bb-e.bin');
  check(pair.confirm === 'retrieval/q1-bb-e.bin' && typeof pair.bin === 'string' && typeof pair.dat === 'string' && pair.qst === undefined, 'publish: a .bin name sends bin + dat and the confirm text');
  const qst = buildPublishBody(pkg, 'hidden', 'q1-bb.qst');
  check(qst.confirm === 'hidden/q1-bb.qst' && typeof qst.qst === 'string' && qst.bin === undefined, 'publish: a .qst name sends the qst');
  const fakeFetch = (status: number, json: unknown): typeof fetch => (async () => new Response(JSON.stringify(json), { status })) as typeof fetch;
  check((await adminSession(fakeFetch(404, {}))) === null, 'publish: no admin panel -> no session');
  check((await adminSession(fakeFetch(200, { authenticated: false, csrf: null }))) === null, 'publish: logged out -> no session');
  check((await adminSession((async () => { throw new Error('offline'); }) as unknown as typeof fetch)) === null, 'publish: network error -> no session');
  const sess = await adminSession(fakeFetch(200, { authenticated: true, csrf: 'tok', user: 'admin' }));
  check(sess?.csrf === 'tok', 'publish: a session gives the CSRF token');
  check((await listQuestDirectories(fakeFetch(200, { directories: [{ dir: 'a', files: [] }] }))).length === 1, 'publish: directories are listed');
  let sent: RequestInit | undefined;
  const spy = (async (_u: string, init: RequestInit) => {
    sent = init;
    return new Response(JSON.stringify({ ok: true, files: [], quest: { questNumber: 1, name: 'P' } }), { status: 200 });
  }) as unknown as typeof fetch;
  await publishQuest({ csrf: 'tok', user: 'admin' }, pair, spy);
  check(sent?.method === 'POST' && (sent.headers as Record<string, string>)['X-CSRF-Token'] === 'tok' && sent.credentials === 'same-origin', 'publish: POST with the CSRF header and same-origin credentials');
  let message = '';
  try {
    await publishQuest({ csrf: 'tok', user: 'admin' }, pair, fakeFetch(422, { error: 'not a valid quest: x' }));
  } catch (e) {
    message = (e as Error).message;
  }
  check(message === 'not a valid quest: x', 'publish: the server error is shown');
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
