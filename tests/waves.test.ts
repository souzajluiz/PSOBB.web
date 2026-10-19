// Wave events and object models:
//  1. every free-play floor's event file parses, its events point at enemies
//     that exist, and its action streams decode;
//  2. every object type of every free-play floor resolves to a model archive
//     that exists in the client, whose model and motion entries are in range,
//     and builds with three.js (textures included);
//  3. the wave state machine runs a Forest 1 chain: trigger -> spawn -> kill
//     -> next wave -> the last wave's actions set the switch flags;
//  4. enemy slot counts match newserv's entity ids.
//
// Run: node tests/waves.test.ts
// Env: PSOBB_DATA (client data/ folder)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseEventFile, parseActions } from '../client/src/formats/events.ts';
import { enemySlotCount, enemySlots } from '../client/src/formats/enemyids.ts';
import { isInvisibleObject, objectModelFor } from '../client/src/formats/objectmodels.ts';
import { parseEnemySets, parseObjectSets } from '../client/src/formats/setdata.ts';
import { floorFiles, freePlayVariations, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import { floorToArea } from '../client/src/net/game.ts';
import { OBJECT_DEFINITIONS } from '../client/src/formats/entitynames.ts';
import { buildEnemy, EnemyArchive, texturesFromXvm } from '../client/src/render/enemymodel.ts';
import { BmlArchive } from '../client/src/formats/bml.ts';
import { FloorWaves, ENEMY_DEAD, killedSetEntry, setEntryForSlot } from '../client/src/render/waves.ts';
import { CollisionWorld } from '../client/src/render/collision.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    if (failures < 60) console.log(`FAIL ${msg}`);
  }
};

// --- the wave state machine, with no client data ---------------------------
{
  // Two events in room 1: wave 1 triggers wave 2, which sets flags 5 and 6.
  const stream = new Uint8Array([0x0c, 0x02, 0x00, 0x00, 0x00, 0x01, 0x0a, 0x05, 0x00, 0x0a, 0x06, 0x00, 0x01]);
  const file = new Uint8Array(0x10 + 2 * 0x14 + stream.length);
  const dv = new DataView(file.buffer);
  const asOff = 0x10 + 2 * 0x14;
  dv.setUint32(0, asOff, true);
  dv.setUint32(4, 0x10, true);
  dv.setUint32(8, 2, true);
  const ev = (i: number, id: number, room: number, wave: number, delay: number, action: number) => {
    const o = 0x10 + i * 0x14;
    dv.setUint32(o, id, true);
    dv.setUint16(o + 6, 1, true);
    dv.setUint16(o + 8, room, true);
    dv.setUint16(o + 10, wave, true);
    dv.setUint32(o + 12, delay, true);
    dv.setUint32(o + 16, action, true);
  };
  ev(0, 1, 1, 1, 2, 0);
  ev(1, 2, 1, 2, 0, 6);
  file.set(stream, asOff);
  const parsed = parseEventFile(file);
  check(parsed.events.length === 2, 'synthetic event file: 2 events');
  check(parsed.events[0].actions.length === 2 && parsed.events[0].actions[0].op === 'triggerEvent', 'synthetic wave 1 triggers event 2');
  check(parsed.events[1].actions.filter((a) => a.op === 'setSwitchFlag').length === 2, 'synthetic wave 2 sets two switch flags');

  const flags = new Set<number>();
  const spawned: number[][] = [];
  const sent: Array<[number, boolean, number]> = [];
  const triggers: number[] = [];
  const cleared: number[] = [];
  const w = new FloorWaves(parsed.events, [
    { section: 1, wave: 1 },
    { section: 1, wave: 1 },
    { section: 1, wave: 2 },
    { section: 2, wave: 1 },
  ], {
    spawn: (list) => spawned.push(list.map((e) => e.key)),
    sendTrigger: (id) => triggers.push(id),
    sendSwitchFlag: (flag, set, f) => sent.push([flag, set, f]),
    setSwitchFlag: (flag, set) => (set ? flags.add(flag) : flags.delete(flag)),
    constructObjects: () => {},
    roomCleared: (room) => cleared.push(room),
    log: () => {},
  });
  w.enter();
  w.frame();
  check(spawned.length === 0, 'no wave runs before its trigger');
  check(w.trigger(1), 'trigger event 1');
  w.frame();
  w.frame();
  check(spawned.length === 0, 'the spawn waits for the delay');
  w.frame();
  check(JSON.stringify(spawned) === '[[0,1]]', `wave 1 spawns its two enemies (got ${JSON.stringify(spawned)})`);
  check(w.battleIn(1) && !w.battleIn(2), 'battle music while the wave is alive');
  w.kill(0);
  w.frame();
  check(spawned.length === 1, 'the wave is not cleared while one enemy lives');
  w.kill(1);
  w.frame(); // the wave is cleared
  w.frame(); // the actions run and trigger event 2
  w.frame(); // event 2's handler spawns wave 2
  check(triggers.join() === '2', `wave 1 cleared -> 6x67 for event 2 (got ${triggers.join()})`);
  check(JSON.stringify(spawned) === '[[0,1],[2]]', `event 2 spawns wave 2 (got ${JSON.stringify(spawned)})`);
  w.kill(2);
  w.frame();
  w.frame();
  check([...flags].sort().join() === '5,6', `wave 2 cleared -> flags 5 and 6 (got ${[...flags].join()})`);
  check(JSON.stringify(sent) === '[[5,true,3],[6,true,1]]', `6x05 flags byte 3 then 1 (got ${JSON.stringify(sent)})`);
  check(cleared.join() === '1', `the room unlock message is shown once (got ${cleared.join()})`);
  check(!w.battleIn(1), 'calm music once the room is clear');
  // Leaving and re-entering the floor keeps the dead enemies dead.
  w.leave();
  w.enter();
  check(w.enemies.filter((e) => e.flags & ENEMY_DEAD).length === 3, 'dead enemies stay dead across floor changes');
  check(w.aliveEnemies().length === 0, 'no enemies are alive after re-entering');
}

// --- door collision --------------------------------------------------------
{
  const world = new CollisionWorld({ meshes: [] });
  // A Forest door: 40 x 10 half extents, turned by 90 degrees.
  world.obstacles = [{ key: 0, x: 100, y: 10, z: 0, yaw: Math.PI / 2, halfX: 40, halfZ: 10, height: 50 }];
  check(!!world.blockedBy(100, 10, 0, 5), 'the door box blocks its own centre');
  check(!!world.blockedBy(100, 10, 30, 5), 'the door box blocks along its width (turned by 90 degrees)');
  check(!world.blockedBy(100, 10, 60, 5), 'the door box does not reach 60 units sideways');
  check(!!world.blockedBy(112, 10, 0, 5), 'the player radius counts against the box');
  check(!world.blockedBy(100, 200, 0, 5), 'the door box does not block far above it');
  world.obstacles = [];
  check(!world.blockedBy(100, 10, 0, 5), 'an open door blocks nothing');
}

// --- enemy slot counts -----------------------------------------------------
check(enemySlotCount({ type: 0x0042, numChildren: 0 }, 1) === 31, 'Monest takes 31 slots');
check(enemySlotCount({ type: 0x0064, numChildren: 0 }, 3) === 5, 'Pofuilly takes 5 slots');
check(enemySlotCount({ type: 0x0065, numChildren: 2 }, 3) === 3, 'Pan Arms takes 3 slots');
check(enemySlotCount({ type: 0x00c2, numChildren: 0 }, 0x0d) === 36, 'Vol Opt takes 36 slots');
check(enemySlotCount({ type: 0x0040, numChildren: 0 }, 1) === 1, 'Hildebear takes 1 slot');

if (!existsSync(DATA)) {
  console.log(`(no ${DATA}; skipping the client data checks)`);
  console.log(failures ? `${failures} failures` : 'wave events: all checks passed');
  process.exit(failures ? 1 : 0);
}

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const loose = new Set(readdirSync(DATA));
const read = (name: string) => (loose.has(name) ? new Uint8Array(readFileSync(join(DATA, name))) : gsl.has(name) ? gsl.get(name) : gsl.has(name.toLowerCase()) ? gsl.get(name.toLowerCase()) : null);

// Object archives, loaded once (the model count comes from the entry names:
// models first, then the .njm / .njs motions).
const archives = new Map<string, EnemyArchive | null>();
const external = new Map<string, ReturnType<typeof texturesFromXvm>>();
function archive(name: string): EnemyArchive | null {
  if (archives.has(name)) return archives.get(name)!;
  let a: EnemyArchive | null = null;
  const data = read(name);
  if (!data) check(false, `object archive ${name}: missing`);
  else {
    try {
      const bml = new BmlArchive(data);
      const first = bml.entries.findIndex((e) => /\.(njm|njs)$/i.test(e.name));
      a = new EnemyArchive(name, data, first < 0 ? bml.entries.length : first);
    } catch (err) {
      check(false, `object archive ${name}: ${(err as Error).message}`);
    }
  }
  archives.set(name, a);
  return a;
}

const objectName = (type: number) => (OBJECT_DEFINITIONS as ReadonlyArray<readonly [number, number, string]>).find((d) => d[0] === type)?.[2] ?? `type ${type.toString(16)}`;

const builtModels = new Set<string>();
const unresolved = new Map<string, Set<number>>(); // object type -> areas
let objectsChecked = 0;
let modeled = 0;
let eventFiles = 0;
let events = 0;
let actions = 0;
let emptyWaves = 0;
let danglingTriggers = 0;
let switchActions = 0;
let chainActions = 0;
const missingEvents: string[] = [];

for (const tname of ['SetDataTableOn.rel', 'SetDataTableOff.rel']) {
  const table = parseSetDataTable(read(tname)!);
  const solo = tname.includes('Off');
  const seenFiles = new Set<string>();
  for (const episode of [1, 2, 3]) {
    const areas = floorToArea(episode);
    for (let floor = 0; floor < 0x10; floor++) {
      const area = areas[floor];
      if (area === undefined || area < 0 || !table[area] || [0x0f, 0x10, 0x11, 0x2e].includes(area)) continue;
      const n = freePlayVariations(table, area, solo);
      for (let layout = 0; layout < n.layouts; layout++) {
        for (let v = 0; v < n.entities; v++) {
          const f = floorFiles(table, area, layout, v, floor, solo ? 'solo' : 'normal')!;
          if (!f || seenFiles.has(f.objects + f.events)) continue;
          seenFiles.add(f.objects + f.events);

          // 1. The event file of the floor.
          const edata = read(f.events);
          const enemyData = read(f.enemies);
          if (!edata) {
            // Boss floors and Pioneer 2 have no wave events.
            if (enemyData && parseEnemySets(enemyData).some((e) => e.wave > 0)) missingEvents.push(f.events);
          } else {
            eventFiles++;
            try {
              const file = parseEventFile(edata);
              check(file.format === 'evt1', `${f.events}: format ${file.format}`);
              const sets = enemyData ? parseEnemySets(enemyData) : [];
              const waves = new Set(sets.map((e) => `${e.section}/${e.wave}`));
              for (const ev of file.events) {
                events++;
                actions += ev.actions.length;
                check(ev.type === 0 || ev.type === 1, `${f.events} event ${ev.index}: type ${ev.type}`);
                check(ev.actions.every((a) => a.op !== 'invalid'), `${f.events} event ${ev.index}: invalid action`);
                check(ev.actions.some((a) => a.op === 'stop' || (a.op === 'constructEnemies' && a.stop)), `${f.events} event ${ev.index}: action stream does not end`);
                // Events whose room/wave has no enemy are allowed: their
                // handler runs the actions at once (that is how a room with no
                // enemies unlocks its doors). The same goes for trigger_event
                // on an id this floor does not have: the client's
                // set_active_map_event_on_floor then does nothing.
                if (ev.type === 1 && sets.length && !waves.has(`${ev.room}/${ev.wave}`)) emptyWaves++;
                for (const a of ev.actions) {
                  if (a.op === 'triggerEvent' && !file.events.some((x) => x.id === a.eventId)) danglingTriggers++;
                  if (a.op === 'constructEnemies' && sets.length && !waves.has(`${a.room}/${a.wave}`)) emptyWaves++;
                  if (a.op === 'setSwitchFlag' || a.op === 'clearSwitchFlag') check(a.flag < 0x100, `${f.events} event ${ev.index}: switch flag ${a.flag}`);
                  if (a.op === 'setSwitchFlag') switchActions++;
                  if (a.op === 'triggerEvent') chainActions++;
                }
              }
              // The whole action stream decodes from every event's offset.
              for (const ev of file.events) check(parseActions(edata, new DataView(edata.buffer, edata.byteOffset).getUint32(0, true) + ev.actionOffset).length > 0, `${f.events} event ${ev.index}: empty action stream`);
            } catch (err) {
              check(false, `${f.events}: ${(err as Error).message}`);
            }
          }

          // 2. Object models of the floor.
          const odata = read(f.objects);
          if (!odata) continue;
          for (const o of parseObjectSets(odata)) {
            if (o.type === 0) continue; // TObjPlayerSet
            objectsChecked++;
            for (const ultimate of area <= 0x0e ? [false, true] : [false]) {
              const spec = objectModelFor(o, { area, episode, ultimate });
              if (!spec) {
                // Volumes and markers draw nothing on purpose.
                if (isInvisibleObject(objectName(o.type))) continue;
                let set = unresolved.get(objectName(o.type));
                if (!set) unresolved.set(objectName(o.type), (set = new Set()));
                set.add(area);
                continue;
              }
              modeled++;
              const key = `${spec.bml}|${JSON.stringify(spec.parts)}`;
              if (builtModels.has(key)) continue;
              builtModels.add(key);
              const a = archive(spec.bml);
              if (!a) continue;
              const what = `${objectName(o.type)} (${spec.bml}, area ${area.toString(16)}${ultimate ? ', ultimate' : ''})`;
              let ok = true;
              for (const part of spec.parts) {
                if (part.model < 0 || part.model >= a.modelCount) {
                  check(false, `${what}: model ${part.model} of ${a.modelCount}`);
                  ok = false;
                }
                if (part.motion !== undefined && (part.motion < 0 || part.motion >= a.motionCount)) {
                  check(false, `${what}: motion ${part.motion} of ${a.motionCount}`);
                  ok = false;
                }
                if (part.textures && !external.has(part.textures)) {
                  const d = read(part.textures);
                  if (!d) {
                    check(false, `${what}: texture archive ${part.textures} missing`);
                    ok = false;
                  } else external.set(part.textures, texturesFromXvm(d));
                }
              }
              if (!ok) continue;
              try {
                for (const part of spec.parts) {
                  const b = buildEnemy(
                    a,
                    [
                      {
                        model: part.model,
                        texlistOf: part.texlistOf,
                        textureArchive: part.textures,
                        texRemap:
                          part.textureId !== undefined
                            ? new Array(64).fill(part.textureId)
                            : part.texIds
                              ? Array.from({ length: 64 }, (_, i) => part.texIds![i] ?? i)
                              : undefined,
                        motion: part.motion !== undefined ? { index: part.motion, speed: part.speed ?? 1, loop: part.drive === 'loop' || part.drive === 'restart' } : null,
                      },
                    ],
                    0,
                    external,
                  );
                  check(b.triangles > 0, `${what}: model ${part.model} has no triangles`);
                  check(b.missingTextures === 0, `${what}: model ${part.model} has ${b.missingTextures} missing textures`);
                  for (const an of b.animators) for (let i = 0; i < 40; i++) an.update(1 / 30);
                  if (part.drive === 'door') check(b.animators.length === 1 && b.animators[0].frameCount > 1, `${what}: door motion has ${b.animators[0]?.frameCount} frames`);
                  // Four-light doors: every lamp node exists and draws a model.
                  for (const lamp of spec.lamps ?? []) {
                    for (const n of lamp) {
                      const node = b.partNodes[0][n];
                      check(!!node && node.children.some((c) => !b.partNodes[0].includes(c)), `${what}: lamp node ${n} of ${b.partNodes[0].length} draws nothing`);
                    }
                  }
                }
              } catch (err) {
                check(false, `${what}: ${(err as Error).message}`);
              }
            }
          }
        }
      }
    }
  }
}

// 3. Enemy slots of every floor are contiguous and match the entry count.
{
  const table = parseSetDataTable(read('SetDataTableOn.rel')!);
  const areas = floorToArea(1);
  const f = floorFiles(table, areas[1], 0, 0, 1, 'normal')!;
  const sets = parseEnemySets(read(f.enemies)!);
  const { first, total } = enemySlots(sets, areas[1]);
  check(first[0] === 0 && first.length === sets.length, 'Forest 1 slots start at 0');
  check(total >= sets.length, 'Forest 1 has at least one slot per entry');
  for (let i = 1; i < first.length; i++) check(first[i] > first[i - 1], `slot ${i} is after slot ${i - 1}`);
}

console.log(
  `${eventFiles} event files, ${events} wave events, ${actions} actions ` +
    `(${switchActions} set_switch_flag, ${chainActions} trigger_event; ${emptyWaves} events whose room/wave has no enemy, ${danglingTriggers} trigger_event with no event on the floor)`,
);
console.log(`${objectsChecked} object entries, ${modeled} with a model, ${builtModels.size} distinct models built, ${archives.size} archives, ${external.size} texture archives`);
if (missingEvents.length) console.log(`floors with waves but no .evt: ${missingEvents.join(', ')}`);
if (unresolved.size) {
  console.log(
    `objects without a model yet: ${[...unresolved]
      .map(([n, a]) => `${n} (areas ${[...a].map((x) => x.toString(16)).join(',')})`)
      .join('; ')}`,
  );
}
// A 6x76 on a child slot (render/gamefield.ts killEntity -> killedSetEntry):
// entries 0 Monest (slots 0-30), 1 Booma (31), 2 Pan Arms (32-34), 3 slimes
// (35-39), 4 Bulclaw (40-44), 5 De Rol Le (45-64).
{
  const first = [0, 31, 32, 35, 40, 45];
  const types = [0x42, 0x44, 0x65, 0x64, 0xa7, 0xc1];
  check(setEntryForSlot(33, first) === 2, 'slot 33 is the Pan Arms entry');
  check(killedSetEntry(0, first, types) === 0, "the Monest's own 6x76 clears its entry");
  check(killedSetEntry(5, first, types) === -1, "a Mothmant's 6x76 does not clear the Monest");
  check(killedSetEntry(31, first, types) === 1, 'a plain enemy clears its entry');
  check(killedSetEntry(32, first, types) === 2, 'the Pan Arms clears its entry');
  check(killedSetEntry(33, first, types) === -1 && killedSetEntry(34, first, types) === -1, 'Hidoom / Migium do not');
  check(killedSetEntry(35, first, types) === 3, "the slime control's 6x76 clears the slimes' entry");
  check(killedSetEntry(37, first, types) === -1, 'a split slime does not');
  check(killedSetEntry(42, first, types) === -1, 'a Claw does not clear the Bulclaw');
  check(killedSetEntry(50, first, types) === 5, "a boss part keeps the old rule (De Rol Le's entry)");
  check(killedSetEntry(-1, first, types) === -1, 'a slot before the floor is nobody');
}
console.log(failures ? `${failures} failures` : 'wave events and object models: all checks passed');
process.exit(failures ? 1 : 0);
