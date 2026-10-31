// The Middle key's talk reach in Pioneer 2 (render/npcview.ts nearestInReach, combat/weaponaim.ts
// inMeleeReach with the NPC's box radius). A fresh account enters the party field; the player is
// placed in front of the Hunter's Guild clerk (talk action 1011) at the reach's edge: half a unit
// inside the boundary (horizontal + vertical + NPC radius of the equipped weapon's aim) the clerk
// is the talk target, half a unit outside he is not. The talk target is read through the window
// hook (the classic game's view, combat.middleReach), not by a key press; the placement pokes
// the game's self pose as the walk would. One screenshot is kept for the look of the field.
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). PW_BASE_URL points at a Vite on its own port.
import { expect, test } from '@playwright/test';
import { consoleLog, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

// The NPC box radius the talk test counts (formats/npcmodels.ts / render/npcwander.ts NPC_RADIUS,
// ASSUMED: the exe's box radius for NPCs is not traced).
const NPC_RADIUS = 5;
const CLERK_ACTION = 1011;

test('the Middle key talk reaches the clerk exactly inside the weapon reach', async ({ page }) => {
  const logs = consoleLog(page);

  await test.step('enter Pioneer 2 on a fresh account', async () => {
    await enterFreshField(page, logs, { prefix: 'npm' });
    // peek serialises its function, so the action id is written out here (1011, the clerk).
    await expect.poll(() => peek(page, (w) => !!w.classicGame && w.classicGame.view.npcs.byAction(1011) !== null), { timeout: 60_000 }).toBe(true);
  });

  // The weapon's melee aim and the NPC's position, read once; the boundary is the aim's reach.
  const probe = await page.evaluate((action) => {
    const w = window as any;
    const v = w.classicGame.view;
    const n = v.npcs.byAction(action);
    const p = n.root.position;
    const reach = v.combat.middleReach(null);
    const a = reach.melee.aim;
    return { x: p.x, y: p.y, z: p.z, horizontal: a.horizontal, vertical: a.vertical, hAngle: a.hAngle, vAngle: a.vAngle };
  }, CLERK_ACTION);
  const boundary = probe.horizontal + probe.vertical + NPC_RADIUS;
  console.log(`clerk at ${probe.x.toFixed(2)} ${probe.y.toFixed(2)} ${probe.z.toFixed(2)}; aim h ${probe.horizontal} v ${probe.vertical} (BAMS ${probe.hAngle}/${probe.vAngle}); talk reach ${boundary}`);
  expect(boundary).toBeGreaterThan(NPC_RADIUS);

  // The player stands `dist` in front of the clerk on the z axis, facing him (angle PI looks along -z,
  // the port's facingOf convention), and the reach test reads the clerk as the talk target or not.
  const probeAt = (dist: number) =>
    page.evaluate(
      ({ action, d }) => {
        const w = window as any;
        const g = w.classicGame;
        const v = g.view;
        const n = v.npcs.byAction(action);
        const p = n.root.position;
        const z = p.z + d;
        g.game.self.position = { x: p.x, y: p.y, z };
        g.game.self.angle = Math.PI;
        v.placePlayer(g.game.selfId, p.x, p.y, z, Math.PI);
        const reach = v.combat.middleReach(null);
        const hit = v.npcs.nearestInReach(reach);
        return { inside: hit !== null, nearestD2: hit ? hit.d2 : null, npcZ: n.root.position.z, playerZ: z };
      },
      { action: CLERK_ACTION, d: dist },
    );

  await test.step('inside the reach: the clerk is the talk target', async () => {
    const inside = await probeAt(boundary - 0.5);
    console.log(`inside ${boundary - 0.5}: ${JSON.stringify(inside)}`);
    expect(inside.inside).toBe(true);
  });

  await test.step('outside the reach: no talk target', async () => {
    const outside = await probeAt(boundary + 0.5);
    console.log(`outside ${boundary + 0.5}: ${JSON.stringify(outside)}`);
    expect(outside.inside).toBe(false);
  });

  await test.step('one screenshot at the reach edge (inside)', async () => {
    await probeAt(boundary - 0.5);
    await page.waitForTimeout(400);
    await test.info().attach('talk-reach-inside', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
