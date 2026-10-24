// Long watch of the Episode 2 enemy state machines, room by room (HANDOFF to-do 2).
// ep2-floors-smoke.spec.ts placed the player on the first placed enemy and watched 10 s, so the
// waves that need a trigger never started on floors 1, 5, 7 and 10. Here, for each wave group
// (room, wave) of the floor that has enemies, the spec:
//  - warps away to the Lab (floor 0) and back, so the floor loads with its events unrun
//    (warpTo returns early on the current floor);
//  - places the player inside the group's room: on the event trigger object (o.dat type 8, the
//    TObjEvtCollision) of one of the group's wave events when the floor has one, else at the
//    room's map section (render/gamefield roomAt is the nearest section circle);
//  - watches the enemies for WATCH_S seconds (default 30, EP2_WATCH_SECONDS), sampling their FSM
//    states every 0.5 s: a state change is a tick that ran; it records per enemy type the states
//    seen, the changes, the dead count, and the group's wave event flags before and after.
// Floors: EP2_WATCH_FLOORS (default 1,5,7,10). The Lab warp is the reset; nothing is forced
// (no 6x67, no kill). Against a local newserv (e2e/README.md).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webep2';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webep2';
const WATCH_MS = Number(process.env.EP2_WATCH_SECONDS ?? 30) * 1000;
const FLOORS = (process.env.EP2_WATCH_FLOORS ?? '1,5,7,10').split(',').map((s) => Number(s.trim()));
const POLL_MS = 500;
const LAB_FLOOR = 0;

interface GroupInfo {
  floor: number;
  area: number;
  room: number;
  wave: number;
  eventIds: number[];
  trigger: { index: number; x: number; y: number; z: number; radius: number; eventId: number } | null;
  sectionCentre: [number, number, number] | null;
  enemiesOfGroup: number; // entries of the floor's set data in this (room, wave)
}

interface TypeStat {
  built: number;
  states: string[];
  changes: number;
  dead: number;
  live: number;
  ais: string[];
}

interface GroupResult extends GroupInfo {
  placedBy: 'trigger' | 'section' | 'none';
  playerRoom: number;
  eventFlagsBefore: number[];
  eventFlagsAfter: number[];
  maxBuilt: number;
  stateChanges: number;
  types: Record<string, TypeStat>;
  dead: number;
  waveSpawned: boolean;
  pageErrors: string[];
  failed: string[];
  consoleIssues: string[];
  warpError: string;
}

// Floor data for the room lookup: the wave events, the enemy entries of the floor's set data, the
// flags of the events, the event trigger objects and the map sections.
const floorData = (page: Page) =>
  peek(page, (w) => {
    const v = w.classicGame.view;
    const f = v.field;
    const fw = f.waves.get(v.debug().floor());
    const trig = (v.fieldObjects?.triggers ?? []) as Array<{ index: number; x: number; y: number; z: number; radius: number; eventId: number; fired: boolean }>;
    return {
      floor: v.debug().floor() as number,
      area: (f.viewer?.area ?? -1) as number,
      events: (fw?.events ?? []).map((e: any) => ({ index: e.index, id: e.id, type: e.type, room: e.room, wave: e.wave, delay: e.delay })),
      flags: fw ? [...fw.flags] : [],
      enemies: (fw?.enemies ?? []).map((e: any) => ({ key: e.key, room: e.room, wave: e.wave, flags: e.flags })),
      triggers: trig.map((t) => ({ index: t.index, x: t.x, y: t.y, z: t.z, radius: t.radius, eventId: t.eventId, fired: t.fired })),
      sections: (f.sections ?? []).map((s: any) => ({ id: s.id, position: s.position })),
      playerRoom: v.debug().room() as number,
    };
  });

// The enemies the combat view built, with their set entry's room / wave and FSM state.
const enemyStates = (page: Page) =>
  peek(page, (w) => {
    const c = w.classicGame.view.combat;
    return [...c.enemies.values()].map((e: any) => ({
      entity: e.index as number,
      type: String(e.slot?.type ?? '?'),
      room: e.slot?.set?.section ?? -1,
      wave: e.slot?.set?.wave ?? -1,
      ai: e.ai ? String(e.ai.constructor?.name ?? 'anon') : 'none',
      state: e.ai ? String(e.ai.state ?? '-') : '-',
      dead: !!e.dead,
    }));
  });

const warp = (page: Page, floor: number) => page.evaluate((f) => (window as any).classicGame.view.warpTo(f), floor);

test('Episode 2: wave groups of floors 1, 5, 7, 10 watched for a long time, one room at a time', async ({ page }, info: TestInfo) => {
  test.setTimeout(14_400_000);
  const logs = consoleLog(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => failed.push(`failed ${r.failure()?.errorText ?? '?'} ${r.url()}`));
  const name = `e2w${Date.now() % 100000}`;

  await logIn(page, USER, PASSWORD);
  await reachLobby(page);
  await openPartyMenu(page);
  await key(page, 'ArrowDown'); // Create a PARTY
  await key(page, 'Enter');
  await key(page, 'ArrowDown'); // EPISODE 2
  await key(page, 'Enter');
  await expect.poll(() => peek(page, (w) => w.classicLobby.party?.create?.episode)).toBe(2);
  await key(page, 'Enter'); // Party Name
  await page.keyboard.type(name, { delay: 30 });
  await key(page, 'Enter');
  await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
  await key(page, 'Enter');
  await expectInGame(page, logs, name);

  const results: GroupResult[] = [];
  const floorSummary: Record<number, { groups: number; noTrigger: string[]; states: Record<string, string[]> }> = {};

  for (const floor of FLOORS) {
    // Discovery: the floor's groups, from one load.
    await warp(page, LAB_FLOOR).catch(() => {});
    await page.waitForTimeout(2000);
    let discoveryError = '';
    try {
      await warp(page, floor);
    } catch (e) {
      discoveryError = String((e as Error).message ?? e).slice(0, 300);
    }
    await page.waitForTimeout(3000);
    const d = await floorData(page);
    expect(d.floor, `floor ${floor} reached`).toBe(floor);
    const groups = groupsOf(d, floor);
    console.log(`ep2w floor ${floor} (area 0x${d.area.toString(16)}): ${groups.length} groups, ${d.triggers.length} triggers, ${d.events.length} events, ${d.enemies.length} set entries ${discoveryError}`);
    floorSummary[floor] = { groups: groups.length, noTrigger: [], states: {} };

    for (const g of groups) {
      await test.step(`floor ${floor} room ${g.room} wave ${g.wave}`, async () => {
        const mark = { errors: errors.length, failed: failed.length, logs: logs.length };
        // A fresh load of the floor for each group: its events have not run yet.
        await warp(page, LAB_FLOOR).catch(() => {});
        await page.waitForTimeout(1500);
        let warpError = '';
        try {
          await warp(page, floor);
        } catch (e) {
          warpError = String((e as Error).message ?? e).slice(0, 300);
        }
        await page.waitForTimeout(3000);
        const before = await floorData(page);
        const trig = before.triggers.filter((t) => g.eventIds.includes(t.eventId));
        const t = trig[0] ?? null;
        const target = t
          ? { x: t.x, y: t.y + 5, z: t.z, by: 'trigger' as const }
          : g.sectionCentre
            ? { x: g.sectionCentre[0], y: g.sectionCentre[1] + 5, z: g.sectionCentre[2], by: 'section' as const }
            : null;
        if (target) {
          await page.evaluate(
            ([x, y, z]) => {
              const v = (window as any).classicGame.view;
              v.placePlayer(v.game.selfId, x, y, z, 0);
            },
            [target.x, target.y, target.z],
          );
        }
        await page.waitForTimeout(500);
        const playerRoom = (await floorData(page)).playerRoom;
        const eventFlagsBefore = before.flags.filter((_, i) => g.eventIds.includes(before.events[i]?.id));

        const prev = new Map<number, string>();
        const types: Record<string, TypeStat> = {};
        let stateChanges = 0;
        let maxBuilt = 0;
        let dead = 0;
        let waveSpawned = false;
        const ticks = Math.ceil(WATCH_MS / POLL_MS);
        for (let i = 0; i < ticks; i++) {
          await page.waitForTimeout(POLL_MS);
          const list = (await enemyStates(page)).filter((e) => e.room === g.room && e.wave === g.wave);
          if (list.length) waveSpawned = true;
          maxBuilt = Math.max(maxBuilt, list.length);
          for (const e of list) {
            const sig = `${e.ai}:${e.state}:${e.dead ? 'dead' : 'live'}`;
            const st = (types[e.type] ??= { built: 0, states: [], changes: 0, dead: 0, live: 0, ais: [] });
            if (!st.ais.includes(e.ai)) st.ais.push(e.ai);
            if (!st.states.includes(e.state)) st.states.push(e.state);
            const was = prev.get(e.entity);
            if (was !== undefined && was !== sig) {
              st.changes++;
              stateChanges++;
            }
            prev.set(e.entity, sig);
          }
        }
        // Built count per type and the dead / live split at the end of the watch.
        const finalList = (await enemyStates(page)).filter((e) => e.room === g.room && e.wave === g.wave);
        for (const e of finalList) {
          const st = (types[e.type] ??= { built: 0, states: [], changes: 0, dead: 0, live: 0, ais: [] });
          st.built++;
          if (e.dead) {
            st.dead++;
            dead++;
          } else st.live++;
        }
        const after = await floorData(page);
        const eventFlagsAfter = after.flags.filter((_, i) => g.eventIds.includes(after.events[i]?.id));

        const newErrors = errors.slice(mark.errors);
        const r: GroupResult = {
          ...g,
          placedBy: target ? target.by : 'none',
          playerRoom,
          eventFlagsBefore,
          eventFlagsAfter,
          maxBuilt,
          stateChanges,
          types,
          dead,
          waveSpawned,
          pageErrors: newErrors,
          failed: failed.slice(mark.failed),
          consoleIssues: logs.slice(mark.logs).filter((l) => /^(error|warning|pageerror)/.test(l)).slice(0, 20),
          warpError: discoveryError || warpError,
        };
        results.push(r);
        if (!target) floorSummary[floor].noTrigger.push(`room ${g.room} wave ${g.wave}`);
        for (const [type, st] of Object.entries(types)) {
          const key = `${g.room}/${g.wave}`;
          (floorSummary[floor].states[type] ??= []).push(`${key}: ${st.states.join(',')} chg ${st.changes}`);
        }
        console.log(`ep2w ${JSON.stringify(r)}`);
      });
    }
  }

  const summary = JSON.stringify({ results, floorSummary }, null, 1);
  const fs = await import('node:fs');
  fs.writeFileSync(info.outputPath('ep2-watch-summary.json'), summary);
  console.log(`ep2w summary\n${summary}`);
  console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
  expect(results.filter((r) => r.warpError).map((r) => `${r.floor}/${r.room}: ${r.warpError}`)).toEqual([]);
  expect(errors).toEqual([]);
  expect(failed.filter((f) => !KNOWN_MISSING.some((k) => f.includes(k)))).toEqual([]);
});

// Wave groups of the floor: one per (room, wave) of its enemy entries, with the trigger object of
// the group's wave events (type 1, the ones that construct enemies) and a section centre.
function groupsOf(d: Awaited<ReturnType<typeof floorData>>, floor: number): GroupInfo[] {
  const seen = new Map<string, GroupInfo>();
  for (const e of d.enemies) {
    const k = `${e.room}/${e.wave}`;
    if (seen.has(k)) {
      seen.get(k)!.enemiesOfGroup++;
      continue;
    }
    const eventIds = d.events.filter((ev) => ev.type === 1 && ev.room === e.room && ev.wave === e.wave).map((ev) => ev.id);
    const trig = d.triggers.find((t) => eventIds.includes(t.eventId)) ?? null;
    const sec = d.sections.find((s) => s.id === e.room);
    seen.set(k, {
      floor,
      area: d.area,
      room: e.room,
      wave: e.wave,
      eventIds,
      trigger: trig,
      sectionCentre: sec ? (sec.position as [number, number, number]) : null,
      enemiesOfGroup: 1,
    });
  }
  return [...seen.values()];
}

// Object sets the data folder does not have (see ep2-floors-smoke.spec.ts).
const KNOWN_MISSING = ['map_jungle06_00o.dat', 'map_jungle07_00o.dat'];
