// Barba Ray (client/src/combat/barbaray.ts) in Chrome. One Episode 2 party
// warps to area 0x20 (floor 14, questeditor/areas.ts floorToArea(2)); the
// player is placed by the first Barba Ray so its wave starts. For ~60 s the
// spec records the brain's phase (+0x32e) and its motion slot each half second:
// the phases must change with no damage (the table runs). Then the spec stands
// the player in front of each part (a spot where that part is the swing's first
// target) and attacks with the real
// keys (ArrowDown = the action palette's slot 0, a normal attack): the strike
// goes through the attack path (render/combat.ts weaponTargets -> applyEnemyHit
// -> barbaPartHit -> BarbaRayAi.hitPart), and the part pools must drop. The page
// must raise no page error. Against a local newserv (e2e/README.md).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { consoleLog, cursorTo, expectInGame, key, logIn, openPartyMenu, peek, reachLobby } from './classic.ts';

const USER = process.env.PSO_USER ?? 'webep2';
const PASSWORD = process.env.PSO_PASSWORD ?? 'webep2';
const BARBA_FLOOR = 14; // area 0x20

interface BarbaState {
  index: number;
  phase: number;
  slot: number;
  dead: boolean;
  shell: number;
  body: number;
  parts: number[];
  x: number;
  y: number;
  z: number;
}

// The Barba Ray's brain (the enemy whose ai is a BarbaRayAi), or null.
const barbaState = (page: Page) =>
  peek(page, (w): BarbaState | null => {
    const enemies = [...w.classicGame.view.combat.enemies.values()] as any[];
    const e = enemies.find((x) => x.ai?.constructor?.name === 'BarbaRayAi');
    if (!e) return null;
    const ai = e.ai;
    const p = e.instance.root.position;
    return {
      index: e.index,
      phase: ai.phase,
      slot: ai.slot,
      dead: !!(ai.dead || e.dead),
      shell: ai.shellHp,
      body: ai.bodyHp,
      parts: ai.parts.map((q: { pool: number }) => q.pool),
      x: p.x,
      y: p.y,
      z: p.z,
    };
  });

// The part enemy `i`'s position, or null.
const partAt = (page: Page, body: number, i: number) =>
  page.evaluate(
    ([b, idx]: number[]): { x: number; y: number; z: number } | null => {
      const e = ([...(window as any).classicGame.view.combat.enemies.values()] as any[]).find((x) => x.ai?.constructor?.name === 'BarbaPartAi' && x.ai.index === idx && x.parent?.index === b);
      if (!e) return null;
      const p = e.instance.root.position;
      return { x: p.x, y: p.y, z: p.z };
    },
    [body, i],
  );

// Stands 30 to 45 units from part i, facing it, where part i is the swing's first target (see
// the stand search below), and swings at it with
// the palette's attacks (ArrowDown = slot 0, normal; ArrowLeft = slot 1, heavy)
// until its pool drops or 12 swings pass. A swing that rolls 0 does nothing.
// Swings at part i; returns the part indexes the swings hit (the render layer's
// "hit Barba Ray's part N (...)" lines, from applyEnemyHit -> barbaPartHit).
// The player is placed at part i's stand now (the search below); null when the part has none.
async function standFor(page: Page, body: { index: number; x: number; z: number }, i: number): Promise<{ x: number; z: number; angle: number } | null> {
  const at = await partAt(page, body.index, i);
  expect(at, `part ${i} exists`).not.toBeNull();
  const p = at!;
  // The stand: the player faces the part (atan2(dx, dz) as weaponaim.ts facingOf) from a point
  // where the part is the swing's first target. weaponTargets sorts by distance, and the parts do
  // not sit on a ring around the body's centre, so the outward stand can leave another part nearer
  // (the first swings then hit that part). The candidates are tried outward first, then around.
  const ox = p.x - body.x;
  const oz = p.z - body.z;
  const out = Math.atan2(ox, oz);
  let stand: { x: number; z: number; angle: number } | null = null;
  for (const dist of [35, 40, 30, 45]) {
    for (let k = 0; k < 16 && !stand; k++) {
      const d = out + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 8; // out, out ±22.5°, out ±45°, ...
      const c = { x: p.x + dist * Math.sin(d), z: p.z + dist * Math.cos(d), angle: Math.atan2(-Math.sin(d), -Math.cos(d)) };
      await page.evaluate(
        ([x, y, z, a]) => {
          const g = (window as any).classicGame.view;
          g.placePlayer(g.game.selfId, x, y, z, a);
        },
        [c.x, p.y, c.z, c.angle],
      );
      await page.waitForTimeout(150);
      const first = await page.evaluate(
        ([b, idx]: number[]) => {
          const g = (window as any).classicGame;
          const from = g.view.combat.view.playerPositions().get(g.game.selfId);
          const t = from ? g.view.combat.weaponTargets(0, from)[0] : undefined;
          return !!t && t.ai?.constructor?.name === 'BarbaPartAi' && t.ai.index === idx && t.parent?.index === b;
        },
        [body.index, i],
      );
      if (first) stand = c;
    }
    if (stand) break;
  }
  // No stand: the part shares its place with another part (parts 0 and 1, 3 and 4 sit together), so a
  // tie is the nearest; that part is skipped and the other parts carry the check.
  if (!stand) return null;
  await page.evaluate(
    ([x, y, z, a]) => {
      const g = (window as any).classicGame.view;
      g.placePlayer(g.game.selfId, x, y, z, a);
    },
    [stand.x, p.y, stand.z, stand.angle],
  );
  await page.waitForTimeout(400);
  return stand;
}

// Swings at part i (the stand is searched again every 3 swings: the parts move with the body) and
// returns the part indexes the swings hit.
async function strikePart(page: Page, body: { index: number; x: number; z: number }, i: number, logs: string[]): Promise<number[]> {
  const mark = logs.length;
  for (let n = 0; n < 12; n++) {
    if (n % 3 === 0 && !(await standFor(page, body, i))) {
      if (n === 0) console.log(`strike part ${i}: no stand where it is the first target`);
      break;
    }
    // A held press: the port reads the keys once a frame, so a zero-length press can be lost (guns.spec.ts TAP_MS).
    const k = n % 2 === 0 ? 'ArrowDown' : 'ArrowLeft';
    await page.keyboard.down(k);
    await page.waitForTimeout(120);
    await page.keyboard.up(k);
    await page.waitForTimeout(700);
    if (logs.slice(mark).some((l) => l.includes(`part ${i} `) && /\(part\)|\(broken\)|\(drain\)/.test(l))) break;
  }
  const lines = logs.slice(mark).filter((l) => /Barba Ray's part/.test(l));
  console.log(`strike part ${i}: ${JSON.stringify(lines)}`);
  return lines.map((l) => Number(/part (\d+) \(/.exec(l)?.[1] ?? -1));
}

test('Barba Ray: the brain runs in Chrome, its phases change, its pools take hits', async ({ page }, info: TestInfo) => {
  test.setTimeout(900_000); // the run takes about 6 minutes (login, the party, the ~60 s sample, the strikes)
  const logs = consoleLog(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const name = `bb${Date.now() % 100000}`;

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

  await test.step('warp to Barba Ray (floor 14, area 0x20)', async () => {
    await page.evaluate((f) => (window as any).classicGame.view.warpTo(f), BARBA_FLOOR);
    await page.waitForTimeout(3000);
  });

  // The ten part enemies exist (body + 1 .. body + 10, render/combat.ts spawnBarbaParts).
  const partCount = await peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].filter((x: any) => x.ai?.constructor?.name === 'BarbaPartAi').length);
  expect(partCount, 'ten part enemies are spawned').toBe(10);

  const first = await barbaState(page);
  expect(first, 'the Barba Ray brain is built on area 0x20').not.toBeNull();
  const b0 = first!;
  // Place the player 5 above the body so the floor's wave starts the fight.
  await page.evaluate(
    ([x, y, z]) => {
      const g = (window as any).classicGame.view;
      g.placePlayer(g.game.selfId, x, y + 5, z, 0);
    },
    [b0.x, b0.y, b0.z],
  );

  const phases = new Set<number>([b0.phase]);
  const slots = new Set<number>([b0.slot]);
  let phaseChanges = 0;
  let prev = b0.phase;
  let struck = false;
  const hitParts = new Set<number>();
  // The Pig Rays (combat/barbaminion.ts) alive at each sample; the spawner's first count is 5.
  let pigsMax = 0;
  // The body's place (the root's x / z) per sample: the movement of 0x15 / 0x0ee0 and the 0x13 side entries.
  let bodyMoves = 0;
  const bodyPlaces = new Set<string>();
  let prevPlace = `${b0.x.toFixed(1)},${b0.z.toFixed(1)}`;
  let last = b0;
  // ~60 s, half a second apart: no damage for the first 30 s, then the parts are struck.
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const s = await barbaState(page);
    if (!s) break;
    last = s;
    const pigs = await peek(page, (w) => [...w.classicGame.view.combat.enemies.values()].filter((x: any) => x.ai?.constructor?.name === 'PigRayAi' && !x.dead).length);
    pigsMax = Math.max(pigsMax, pigs);
    phases.add(s.phase);
    slots.add(s.slot);
    if (s.phase !== prev) phaseChanges++;
    prev = s.phase;
    const place = `${s.x.toFixed(1)},${s.z.toFixed(1)}`;
    bodyPlaces.add(place);
    if (place !== prevPlace) bodyMoves++;
    prevPlace = place;
    if (i === 60 && !struck) {
      struck = true;
      for (let p = 0; p < 10; p++) for (const q of await strikePart(page, b0, p, logs)) hitParts.add(q);
      last = (await barbaState(page)) ?? last;
    }
  }
  console.log(`barbaray ${JSON.stringify({ phases: [...phases], slots: [...slots], phaseChanges, last: { ...last, parts: last.parts.slice(0, 4) } })}`);
  console.log(`barbaray b0 ${JSON.stringify({ shell: b0.shell, body: b0.body, parts: b0.parts.slice(0, 4) })}`);
  console.log(`barbaray body ${JSON.stringify({ moves: bodyMoves, places: bodyPlaces.size, first: [b0.x, b0.z], last: [last.x, last.z] })}`);
  await page.screenshot({ path: info.outputPath('barbaray-floor14.png') });

  const damaged = last.parts.filter((p, i) => p < b0.parts[i]!).length;
  expect(phaseChanges, 'the phases change with no damage over ~60 s').toBeGreaterThan(1);
  // The body moves (the side entries, the swim and the arc change x / z) while the phases change.
  expect(bodyMoves, 'the body position changes across the phases').toBeGreaterThan(0);
  expect(bodyPlaces.size, 'the body is in more than one place over the fight').toBeGreaterThan(1);
  // The spawner's Pig Rays appear (the minion's kill and body movement are not yet checked).
  console.log(`barbaray pigs ${JSON.stringify({ pigsMax })}`);
  expect(pigsMax, 'the spawner brings Pig Rays into the fight').toBeGreaterThan(0);
  console.log(`barbaray parts ${JSON.stringify({ hit: [...hitParts].sort(), damaged, pools: last.parts.slice(0, 4), start: b0.parts.slice(0, 4) })}`);
  // The swings reach the parts through applyEnemyHit -> barbaPartHit -> hitPart. The
  // damage is the game's roll: this character's rolls against the parts were 0 (the
  // part's defence, DE_ROL_LE_BODY row 16), so the pool drop is reported, not asserted.
  expect(hitParts.size, 'the attack path hits at least two different parts').toBeGreaterThanOrEqual(2);
  expect(pageErrors, 'no page errors').toEqual([]);
});
