// Dropping an item on the classic field (Pioneer 2). GameItems.drop (net/items.ts) sends the 6x2C
// hold on the player and runs the drop object's spot search (net/dropspot.ts), one spot a frame;
// the first spot found gets the 6x2A, then the 6x2D releases the hold. The test drops an unequipped
// item from the bag and checks:
//   - the packets: 6x2C (900 frames, at the player), then 6x2A, then 6x2D, nothing else;
//   - the item lands on the floor near the player, on a ring of the search (6 * r for r 1..6), on
//     the ground (the spot is ground + 6), with no wall between the player's eye and the spot;
//   - the item left the bag;
//   - the player moves again after the release (a held W, 300 ms).
// The drop is started with the same call as the item menu's Drop (GameItems.drop); the menu's
// keys are not under test. The packets are read by wrapping the game's send methods on the page.
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, leaveToLobby, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const HOLD_FRAMES = 900; // DROP_HOLD_FRAMES (net/dropspot.ts, the exe's 6x2C)
const RING_STEP = 6; // DROP_RING_STEP (net/dropspot.ts): ring r has its spots at 6 * r
const MOVE_MS = 300; // a held key: the port polls keys once a frame, so a tap is lost

type Pos = { x: number; y: number; z: number };
type Sent = { k: '6x2C'; frames: number; x: number; z: number } | { k: '6x2A' } | { k: '6x2D' };

const selfPos = (page: Page) =>
  peek(page, (w): Pos | null => {
    const p = w.classicGame.view.selfPose();
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  });

// Wraps the game's hold and drop sends so each one is logged in order (window.__sent).
const recordSends = (page: Page) =>
  peek(page, (w) => {
    const g = w.classicGame.game;
    const log: unknown[] = (w.__sent = []);
    const hold = g.sendImposeHold.bind(g);
    g.sendImposeHold = (frames: number, particle: number, x: number, z: number, radius2: number) => {
      log.push({ k: '6x2C', frames, x, z });
      return hold(frames, particle, x, z, radius2);
    };
    const release = g.sendReleaseHold.bind(g);
    g.sendReleaseHold = () => {
      log.push({ k: '6x2D' });
      return release();
    };
    const sub = g.sendSubcommand.bind(g);
    g.sendSubcommand = (s: number, ...rest: unknown[]) => {
      if (s === 0x2a) log.push({ k: '6x2A' });
      return (sub as (...a: unknown[]) => unknown)(s, ...rest);
    };
    return true;
  });

const sent = (page: Page) => peek(page, (w): Sent[] => w.__sent ?? []);

// The ring of a spot: its distance from the player over RING_STEP, which must be a whole ring 1..6.
const ringOf = (from: Pos, at: Pos): number => Math.round(Math.hypot(at.x - from.x, at.z - from.z) / RING_STEP);

test('a dropped item lands on a valid spot near the player, and the player moves again', async ({ page }) => {
  const logs = consoleLog(page);

  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'wdr' }));

  const itemId = await test.step('pick an unequipped item from the bag', async () => {
    const id = await peek(page, (w): number | null => {
      const inv: any[] = w.classicGame.view.items.inventory?.c?.inventory ?? [];
      const it = inv.find((i) => !i.equipped && i.data.data1[0] !== 4); // not equipped, not meseta
      return it ? (it.data.id as number) : null;
    });
    expect(id, 'the bag holds an unequipped item').not.toBeNull();
    return id!;
  });

  await test.step('drop it: 6x2C, then 6x2A, then 6x2D', async () => {
    await recordSends(page);
    const from = await selfPos(page);
    expect(from).not.toBeNull();
    await page.evaluate((id) => ((window as any).__dropId = id), itemId);
    // The same call as the item menu's Drop (GameItems.drop, amount 0: the whole item).
    await peek(page, (w) => w.classicGame.view.items.drop(w.__dropId, 0));

    await expect
      .poll(async () => (await sent(page)).some((s) => s.k === '6x2D'), { timeout: 15_000, intervals: [100] })
      .toBe(true);
    const seq = await sent(page);
    expect(seq.map((s) => s.k)).toEqual(['6x2C', '6x2A', '6x2D']);
    const hold = seq[0] as Extract<Sent, { k: '6x2C' }>;
    expect(hold.frames).toBe(HOLD_FRAMES);
    expect(hold.x).toBeCloseTo(from!.x, 3);
    expect(hold.z).toBeCloseTo(from!.z, 3);

    // The item is on the floor, where the player's drop put it.
    const floor = await peek(page, (w) => {
      const it = w.classicGame.view.items.floorItems.get(w.__dropId);
      return it ? { x: it.x as number, y: it.y as number, z: it.z as number, source: it.source as string } : null;
    });
    expect(floor, 'the dropped item is on the floor').not.toBeNull();
    expect(floor!.source).toBe('player');

    // A valid spot: a ring of the search, on the ground, with no wall between the eye and it.
    const ring = ringOf(from!, floor!);
    const d = Math.hypot(floor!.x - from!.x, floor!.z - from!.z);
    expect(ring, `spot at ${d.toFixed(2)} from the player`).toBeGreaterThanOrEqual(1);
    expect(ring).toBeLessThanOrEqual(6);
    expect(d).toBeCloseTo(ring * RING_STEP, 1);
    // The map's collision: the spot stands on the ground (the search puts it at ground + 6), and
    // the segment from the player's eye (the ground under the player + 6, as the search does) to
    // the spot is clear of walls (cast_ray_at_map_collision_geometry, mask -1).
    const geo = await page.evaluate(
      ({ from, at }) => {
        const c = (window as any).classicGame.view.collision;
        if (!c) return null;
        const eyeY = (c.groundHeight(from.x, from.z, from.y + 10) ?? from.y) + 6;
        return {
          ground: c.groundHeight(at.x, at.z, from.y) as number | null,
          wall: c.segmentHit([from.x, eyeY, from.z], [at.x, at.y, at.z], 0xffffffff) !== null,
        };
      },
      { from: from!, at: floor! },
    );
    expect(geo, 'the map has collision').not.toBeNull();
    expect(geo!.ground, 'the spot has ground').not.toBeNull();
    expect(floor!.y - geo!.ground!).toBeCloseTo(6, 1);
    expect(geo!.wall, 'a wall between the eye and the spot').toBe(false);
  });

  await test.step('the item left the bag, and the player moves again', async () => {
    const inBag = await peek(page, (w) => (w.classicGame.view.items.inventory?.c?.inventory ?? []).some((i: any) => i.data.id === w.__dropId));
    expect(inBag).toBe(false);

    await page.evaluate(() => (document.querySelector('canvas') as HTMLCanvasElement | null)?.focus());
    const before = await selfPos(page);
    await page.keyboard.down('w');
    await page.waitForTimeout(MOVE_MS);
    await page.keyboard.up('w');
    await expect
      .poll(async () => {
        const now = await selfPos(page);
        return Math.hypot(now!.x - before!.x, now!.z - before!.z);
      }, { timeout: 5_000, intervals: [200] })
      .toBeGreaterThan(1);
  });

  await test.step('leave the game cleanly', () => leaveToLobby(page));

  expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
});
