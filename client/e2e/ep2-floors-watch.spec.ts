// Long watch of the Episode 2 enemy state machines, room by room (HANDOFF to-do 2).
// ep2-floors-smoke.spec.ts placed the player on the first placed enemy and watched 10 s, so the
// waves that need a trigger never started on floors 1, 5, 7 and 10. Here, for each wave group
// (room, wave) of the floor that has enemies, the spec:
//  - warps away to the Lab (floor 0) and back, so the floor loads with its events unrun
//    (warpTo returns early on the current floor). The round trip keeps the wave flags of this game, so
//    after any chain kill in the game the group runs in a fresh game (startGame: a new login and party);
//    the summary's `session` says which game a group ran in and `fresh` counts those games;
//  - places the player inside the group's room: on the event trigger object (o.dat type 8, the
//    TObjEvtCollision) of one of the group's wave events when the floor has one, else at the
//    room's map section (render/gamefield roomAt is the nearest section circle);
//  - watches the enemies for WATCH_S seconds (default 30, EP2_WATCH_SECONDS), sampling their FSM
//    states every 0.5 s: a state change is a tick that ran; it records per enemy type the states
//    seen, the changes, the dead count, and the group's wave event flags before and after.
// Floors: EP2_WATCH_FLOORS (default 1,5,7,10). The Lab warp is the reset; nothing is forced
// (no 6x67, no kill) except for a chained group (label 'chained'): the group's wave event is started
// by trigger_event from another wave event's action stream (the chain), so the spec places the player
// on the first link of the chain that has a trigger object, then kills the built enemies of each link
// in chain order (combat applyEnemyHit with 9999 damage: the kill flow, 6x76 and the wave's
// enemies-dead flag), which runs the next link's trigger_event; then it watches.
// Once a group's wave is built, the player is walked into its reach if the trigger left it more than
// 150 units away (engageWave): the Sinow search radius is 200, so a trigger that far from the wave
// otherwise never engages it (the enemies cycle lost -> home -> spawn, invulnerable throughout).
// Each floor has a time cap (EP2_FLOOR_CAP_S, default 1500 s; the old 300 s cap ran only 2 of floor 10's 33 groups): a group that starts after the cap is not
// run (counted in notRun). One screenshot per floor (client/test-results, JPEG).
// Against a local newserv (e2e/README.md).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, openPartyMenu, peek, reachLobby } from './classic.ts';
import { freshUser, logInWithCharacter } from './fresh-field.ts';

// A fresh account per run (wep prefix) unless PSO_USER names one; its password is the user name.
const USER = process.env.PSO_USER ?? freshUser('wep');
const PASSWORD = process.env.PSO_PASSWORD ?? USER;
const WATCH_MS = Number(process.env.EP2_WATCH_SECONDS ?? 30) * 1000;
const FLOORS = (process.env.EP2_WATCH_FLOORS ?? '1,5,7,10').split(',').map((s) => Number(s.trim()));
// EP2_WATCH_GROUPS=80/2,71/4 runs only those (room/wave) groups.
const ONLY = (process.env.EP2_WATCH_GROUPS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const POLL_MS = 500;
const LAB_FLOOR = 0;
// EP2_WATCH_EPISODE=1 watches Episode 1 floors instead (Mines 6..10 etc.; the floor 0 warp is Pioneer 2).
const EPISODE = Number(process.env.EP2_WATCH_EPISODE ?? 2);
const FLOOR_CAP_MS = Number(process.env.EP2_FLOOR_CAP_S ?? 1500) * 1000;

// One wave event above the group in its chain: its room / wave and its trigger object, if any.
interface ChainLink {
  id: number;
  room: number;
  wave: number;
  trigger: { x: number; y: number; z: number } | null;
}

interface GroupInfo {
  floor: number;
  area: number;
  room: number;
  wave: number;
  eventIds: number[];
  delays: number[]; // the group's wave events' start delays, frames (waves.ts: the handler counts it down before building)
  trigger: { index: number; x: number; y: number; z: number; radius: number; eventId: number } | null;
  // trigger: the group's own event has a trigger object; chained: it is started by a trigger_event of
  // the chain (chain = its links, root first); event-untriggered: it has a wave event but nothing
  // starts it; section: no wave event at all.
  kind: 'trigger' | 'chained' | 'event-untriggered' | 'section';
  chain: ChainLink[];
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
  placedBy: 'trigger' | 'section' | 'none' | 'chained';
  session: number; // the game (1 = the first; each fresh game after a chain kill is a new one)
  chainKilled: string[];
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
  engage: { moved: boolean; dist: number } | null;
  raw: Array<{ type: string; ai: string; state: string; cs: string; vis: boolean; inv: boolean; locked: boolean }>;
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
      events: (fw?.events ?? []).map((e: any) => ({
        index: e.index,
        id: e.id,
        type: e.type,
        room: e.room,
        wave: e.wave,
        delay: e.delay,
        actions: (e.actions ?? []) as Array<{ op: string; eventId?: number }>,
      })),
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
      // invulnerable: the spawn state (the exe's 0x4040000 flags); vis: the enemy object is shown.
      inv: !!e.ai?.invulnerable,
      vis: !!e.instance?.root?.visible,
      // the combat's own state (tickEnemies runs only 'idle' ones) and whether a status holds the enemy.
      cs: String(e.state ?? '-'),
      locked: !!e.status?.active,
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
  // A new game (a fresh page load, a new party): its floors' wave flags are the ones the load gives.
  // The Lab round trip inside one game keeps the finished flags (0x18) of a chain killed earlier, so
  // a group whose events a kill finished is watched in a fresh game (see `linked` below).
  let session = 0;
  // Chain links a kill finished in the current game (a kill also starts the next link's events, so any
  // kill makes the rest of the game's floors dirty: every group after one runs in a fresh game).
  const killed = new Set<string>();
  const startGame = async (): Promise<void> => {
    session++;
    killed.clear();
    const name = `e2w${Date.now() % 100000}`;
    await logInWithCharacter(page, USER, PASSWORD);
    await reachLobby(page);
    await openPartyMenu(page);
    await key(page, 'ArrowDown'); // Create a PARTY
    await key(page, 'Enter');
    if (EPISODE === 2) await key(page, 'ArrowDown'); // EPISODE 2
    await key(page, 'Enter');
    await expect.poll(() => peek(page, (w) => w.classicLobby.party?.create?.episode)).toBe(EPISODE);
    await key(page, 'Enter'); // Party Name
    await page.keyboard.type(name, { delay: 30 });
    await key(page, 'Enter');
    await cursorTo(page, (w) => w.classicLobby.party.create.row, 4); // Registration (Normal)
    await key(page, 'Enter');
    await expectInGame(page, logs, name);
  };
  await startGame();

  const results: GroupResult[] = [];
  const floorSummary: Record<number, { groups: number; notRun: number; fresh: number; noTrigger: string[]; absent: string[]; states: Record<string, string[]> }> = {};

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
    floorSummary[floor] = { groups: groups.length, notRun: 0, fresh: 0, noTrigger: [], absent: [], states: {} };
    const floorStart = Date.now();

    // A game keeps the wave variants it was given (its floor loads repeat them), and a new game gives new
    // ones: a group is watched in a game whose load has it. Pending groups are picked from each load,
    // non-chained first (a trigger or section group finishes nothing); a chain kill ends the game (its
    // events stay finished), so the next group runs in a fresh game. Four games in a row without a
    // pending group give up on the rest (absent).
    const pending = groups.filter((g) => !ONLY.length || ONLY.includes(`${g.room}/${g.wave}`)).map((g) => `${g.room}/${g.wave}`);
    let misses = 0;
    let forceFresh = false;
    while (pending.length) {
      if (Date.now() - floorStart > FLOOR_CAP_MS) {
        floorSummary[floor].notRun += pending.length;
        pending.length = 0;
        break;
      }
      if (misses > 4) {
        floorSummary[floor].absent.push(...pending.map((k) => `room ${k}: not in any of the games tried`));
        pending.length = 0;
        break;
      }
      await test.step(`floor ${floor}: ${pending.length} groups pending`, async () => {
        const mark = { errors: errors.length, failed: failed.length, logs: logs.length };
        // A kill in this game leaves its events finished (0x18) for the rest of the game, and the Lab round
        // trip keeps them: a group after a kill runs in a fresh game (its events are unrun again).
        if (killed.size > 0 || forceFresh) {
          await startGame();
          forceFresh = false;
          floorSummary[floor].fresh++;
        }
        // A fresh load of the floor for each group: its events have not run yet.
        await warp(page, LAB_FLOOR).catch(() => {});
        await page.waitForTimeout(1000);
        let warpError = '';
        try {
          await warp(page, floor);
        } catch (e) {
          warpError = String((e as Error).message ?? e).slice(0, 300);
        }
        await page.waitForTimeout(2500);
        const before = await floorData(page);
        // Every game's loads pick the floor's wave variants (the event set differs between games: 33 events
        // on one game of Seabed Upper, 32 on the next), so the group's events, trigger and chain are read
        // from THIS load; a chain taken from the discovery load pointed at events that were not here and
        // the next link never started (its enemies stayed built but not shown).
        const present = groupsOf(before, floor).filter((x) => pending.includes(`${x.room}/${x.wave}`));
        if (!present.length) {
          misses++;
          forceFresh = true;
          console.log(`ep2w floor ${floor}: none of ${pending.length} pending groups in this game's load`);
          return;
        }
        misses = 0;
        present.sort((a, b) => Number(a.kind === 'chained') - Number(b.kind === 'chained'));
        const g = present[0];
        pending.splice(pending.indexOf(`${g.room}/${g.wave}`), 1);
        const trig = before.triggers.filter((t) => g.eventIds.includes(t.eventId));
        const t = trig[0] ?? null;
        // A chained group: the first link of its chain with a trigger object is placed on it (the root
        // when the root has one); the kill below starts the rest of the chain.
        const startAt = g.kind === 'chained' ? g.chain.findIndex((l) => l.trigger) : -1;
        const chainTrig = startAt >= 0 ? g.chain[startAt].trigger : null;
        const target = t
          ? { x: t.x, y: t.y + 5, z: t.z, by: 'trigger' as const }
          : chainTrig
            ? { x: chainTrig.x, y: chainTrig.y + 5, z: chainTrig.z, by: 'chained' as const }
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
        const chainKilled: string[] = [];
        const deadIds = new Set<number>(); // entities seen dead (chain kills, then the watch's samples)
        if (target?.by === 'chained') {
          // In chain order: the link's wave must be built and out of its spawn state before the kill;
          // the kill starts the next link's trigger_event, and the next iteration waits for that wave.
          // A link that does not get ready, or is left alive after the kill, stops the chain.
          for (const link of g.chain.slice(startAt)) {
            const ready = await waitReady(page, link.room, link.wave, READY_MS);
            if (!ready.ok) {
              chainKilled.push(`event ${link.id} (room ${link.room} wave ${link.wave}): not ready within ${READY_MS / 1000} s (${ready.why})`);
              break;
            }
            const k = await killWave(page, link.room, link.wave);
            for (const id of k.ids) deadIds.add(id);
            chainKilled.push(`event ${link.id} (room ${link.room} wave ${link.wave}): ready after ${ready.secs} s, hit ${k.hit}, dead ${k.ids.length}, alive after ${k.alive}`);
            if (k.alive > 0) break;
            killed.add(`${floor}:${link.id}`); // the floor is part of the key: a floor's events are its own
            await page.waitForTimeout(1000); // the next link's trigger_event and its delay
            const fd = await floorData(page);
            const li = fd.events.findIndex((ev) => ev.id === link.id);
            chainKilled.push(`  after: event ${link.id} flags ${fd.flags[li]}, next-link events ${fd.events.map((ev, k) => `${ev.id}:${fd.flags[k]}`).filter((x) => g.eventIds.some((id) => x.startsWith(`${id}:`))).join(' ')}`);
          }
        }
        const playerRoom = (await floorData(page)).playerRoom;
        const eventFlagsBefore = before.flags.filter((_, i) => g.eventIds.includes(before.events[i]?.id));

        const prev = new Map<number, string>();
        const types: Record<string, TypeStat> = {};
        let stateChanges = 0;
        let maxBuilt = 0;
        let waveSpawned = false;
        const ticks = Math.ceil(WATCH_MS / POLL_MS);
        let engaged = false;
        let engage: { moved: boolean; dist: number } | null = null;
        for (let i = 0; i < ticks; i++) {
          await page.waitForTimeout(POLL_MS);
          const list = (await enemyStates(page)).filter((e) => e.room === g.room && e.wave === g.wave);
          if (list.length && !engaged) {
            // The wave is built: walk the player into its reach once (engageWave), then just watch.
            engaged = true;
            engage = await engageWave(page, g.room, g.wave);
          }
          if (list.length) waveSpawned = true;
          maxBuilt = Math.max(maxBuilt, list.length);
          for (const e of list) {
            if (e.dead) deadIds.add(e.entity); // counted before the final list drops the dead entries
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
          if (e.dead) st.dead++;
          else st.live++;
        }
        const dead = deadIds.size;
        const after = await floorData(page);
        const eventFlagsAfter = after.flags.filter((_, i) => g.eventIds.includes(after.events[i]?.id));

        const newErrors = errors.slice(mark.errors);
        const r: GroupResult = {
          ...g,
          placedBy: target ? target.by : 'none',
          session,
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
          chainKilled,
          warpError: discoveryError || warpError,
          engage,
          raw: finalList.map((e) => ({ type: e.type, ai: e.ai, state: e.state, cs: e.cs, vis: e.vis, inv: e.inv, locked: e.locked })),
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
    const secs = Math.round((Date.now() - floorStart) / 1000);
    console.log(`ep2w floor ${floor} done in ${secs} s, ${floorSummary[floor].notRun} groups not run (cap ${FLOOR_CAP_MS / 1000} s), ${floorSummary[floor].fresh} groups in a fresh game, ${session} games in all`);
    await page.screenshot({ path: info.outputPath(`ep2-floor-${floor}.jpg`), type: 'jpeg', quality: 50 });
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
// the group's wave events (type 1, the ones that construct enemies), its chain (the wave events
// whose action streams trigger_event it) and a section centre.
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
    const chain = trig ? [] : chainOf(d, eventIds);
    const sec = d.sections.find((s) => s.id === e.room);
    seen.set(k, {
      floor,
      area: d.area,
      room: e.room,
      wave: e.wave,
      eventIds,
      delays: d.events.filter((ev) => eventIds.includes(ev.id)).map((ev) => ev.delay),
      trigger: trig,
      kind: trig ? 'trigger' : chain.length ? 'chained' : eventIds.length ? 'event-untriggered' : 'section',
      chain,
      sectionCentre: sec ? (sec.position as [number, number, number]) : null,
      enemiesOfGroup: 1,
    });
  }
  return [...seen.values()];
}

// The chain above a group's wave events: the event whose action stream trigger_event()s the current
// level, then its parent, and so on up to the root (up to 16 links). Returned root first.
function chainOf(d: Awaited<ReturnType<typeof floorData>>, eventIds: number[]): ChainLink[] {
  const links: ChainLink[] = [];
  const seen = new Set(eventIds);
  let level = eventIds;
  for (let guard = 0; guard < 16; guard++) {
    const parent = d.events.find((ev) => !seen.has(ev.id) && ev.actions.some((a) => a.op === 'triggerEvent' && level.includes(a.eventId ?? -1)));
    if (!parent) break;
    seen.add(parent.id);
    const trig = d.triggers.find((t) => t.eventId === parent.id) ?? null;
    links.unshift({ id: parent.id, room: parent.room, wave: parent.wave, trigger: trig ? { x: trig.x, y: trig.y, z: trig.z } : null });
    level = [parent.id];
  }
  return links;
}

// Waits until the chain link's wave has started: at least one living enemy of (room, wave) is built
// (visible), and every living one has left its spawn state (not invulnerable; the exe's spawn-state
// enemies take no hit, and a wave that has not started has no enemy object yet). Times out with why.
const READY_MS = Number(process.env.EP2_READY_S ?? 30) * 1000;
// Walks the player into reach of a built wave. The Sinow families (SinowBerillAi) search 200 units
// from their spawn point (BERILL.search); with no target for 90 frames ('lost') they go 'home' and
// re-spawn, and they stay invulnerable in every state but the engaged ones (chase, lunge, melee ...).
// The trigger object of a wave can sit 225+ units from the wave's enemies, so the player placed on it
// never reaches them: the wave cycles lost -> home -> spawn -> rise -> lost (the 10-25 "stuck in spawn"
// reading was this cycle and the invulnerable flag, not a stalled tick). Once the wave is built and
// the player is out of reach (more than 150 units from every living enemy), the player moves to the
// midpoint between the trigger and the wave's nearest enemy (about 120 units away). Returns the distance
// before the move (null when nothing was built).
async function engageWave(page: Page, room: number, wave: number): Promise<{ moved: boolean; dist: number } | null> {
  return page.evaluate(
    ([rm, w]) => {
      const v = (window as any).classicGame.view;
      const list = [...v.combat.enemies.values()].filter((e: any) => e.slot?.set?.section === rm && e.slot?.set?.wave === w && !e.dead && e.ai);
      const me = v.view?.playerPositions().get(v.game.selfId);
      if (!list.length || !me) return null;
      const d = (e: any) => Math.hypot(e.ai.x - me.x, e.ai.z - me.z);
      const nearest = list.reduce((a: any, b: any) => (d(a) <= d(b) ? a : b));
      const dist = d(nearest);
      if (dist <= 150) return { moved: false, dist };
      v.placePlayer(v.game.selfId, (me.x + nearest.ai.x) / 2, me.y, (me.z + nearest.ai.z) / 2, 0);
      return { moved: true, dist };
    },
    [room, wave] as const,
  );
}

async function waitReady(
  page: Page,
  room: number,
  wave: number,
  timeoutMs: number,
): Promise<{ ok: boolean; secs: number; why: string }> {
  const t0 = Date.now();
  let why = 'no enemy built';
  let engaged = false;
  for (;;) {
    const list = (await enemyStates(page)).filter((e) => e.room === room && e.wave === wave && !e.dead);
    if (list.length && !engaged) {
      engaged = true;
      await engageWave(page, room, wave);
      await page.waitForTimeout(POLL_MS);
      continue;
    }
    if (list.length && list.every((e) => e.vis && !e.inv)) return { ok: true, secs: (Date.now() - t0) / 1000, why: '' };
    if (list.length) {
      const inv = list.filter((e) => e.inv);
      why = `${inv.length} of ${list.length} invulnerable (states ${[...new Set(inv.map((e) => e.state))].join(',') || '-'})`;
    }
    if (Date.now() - t0 >= timeoutMs) return { ok: false, secs: (Date.now() - t0) / 1000, why };
    await page.waitForTimeout(POLL_MS);
  }
}

// Kills the living, non-invulnerable enemies of (room, wave) through the combat's hit path
// (applyEnemyHit, the call ep4-battle-smoke.spec.ts makes): 9999 damage, so the kill flow runs
// (6x76, the wave's enemies-dead flag). Repeats a few times for enemies that were not yet hittable.
// Returns the hits of the first pass, the entity ids that died, and the enemies still alive.
async function killWave(page: Page, room: number, wave: number): Promise<{ hit: number; ids: number[]; alive: number }> {
  let hit = 0;
  const ids = new Set<number>();
  let alive = 0;
  for (let pass = 0; pass < 8; pass++) {
    const r = await page.evaluate(
      ([rm, w]) => {
        const c = (window as any).classicGame.view.combat;
        const living = () => [...c.enemies.values()].filter((e: any) => e.slot?.set?.section === rm && e.slot?.set?.wave === w && !e.dead);
        const live = living();
        const hittable = live.filter((e: any) => !e.ai?.invulnerable);
        for (const e of hittable) c.applyEnemyHit(e, 0x20000000 | 0x00800000 | 0x00100000, 9999, false, 'e2e chain kill: ', true, {});
        const after = living();
        return {
          hit: hittable.length,
          died: hittable.filter((e: any) => e.dead || !after.includes(e)).map((e: any) => e.index as number),
          alive: after.length,
        };
      },
      [room, wave] as [number, number],
    );
    if (pass === 0) hit = r.hit;
    for (const id of r.died) ids.add(id);
    alive = r.alive;
    if (alive === 0) break;
    await page.waitForTimeout(POLL_MS);
  }
  return { hit, ids: [...ids], alive };
}

// Object sets the data folder does not have (see ep2-floors-smoke.spec.ts).
const KNOWN_MISSING = ['map_jungle06_00o.dat', 'map_jungle07_00o.dat'];
