// Remote Resta and confusion steering in Forest 1 of a fresh party field.
//
// Remote Resta (render/combat.ts remoteResta, combat/techniques.ts restaHits): a fake party
// member "Vicky" (the next client slot, a copy of the local player) casts Resta Lv3 (6x47 with this
// player in the target list, then 6x48). entity_hit_by_tech (0x00773afc) runs on every copy of
// the hit players on this client: the local player's HP and Vicky's own copy in PartyHp both rise by
// chop(MST * 0.5 + power); no packet carries the heal. The real two-client Resta is not run here
// (only one browser plays; the other client is faked, like fieldhud-status.spec.ts).
//
// Confusion (modify_direction 0x0068c038): a confused player in a field gets a random heading per
// movement poll. The spec holds W and samples where the leg aims: confused, it keeps changing.
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { expect, test } from '@playwright/test';
import { consoleLog, leaveToLobby, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const TECH_RESTA = 15;
const LEVEL = 2; // 0-based on the wire: Lv3, the 6x47 list heals from here
const STATUS_CONFUSION = 0x12;

test('remote Resta heals the local player and the caster copy; confusion steers at random', async ({ page }) => {
  const logs = consoleLog(page);
  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'rcs' }));

  await test.step('Forest 1', async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect
      .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
      .toBe('1:false');
    await page.waitForTimeout(2000);
  });

  let slot = 0;
  await test.step('Vicky joins, Vicky and the local player are hurt', async () => {
    slot = await page.evaluate(() => {
      const game = (window as any).classicGame.game;
      const self = game.self;
      const s = (game.selfId + 1) & 3;
      game.addLocalPlayer({
        ...self,
        clientId: s,
        guildCardNumber: 4243,
        name: 'Vicky',
        level: 125,
        mst: 400,
        position: { x: self.position.x + 40, y: self.position.y, z: self.position.z },
      });
      return s;
    });
    await expect
      .poll(() => peek(page, (w) => w.classicGame.view.combat.party.get(w.classicGame.game.selfId + 1 & 3) !== undefined), { timeout: 10_000 })
      .toBe(true);
    await page.evaluate((s) => {
      const combat = (window as any).classicGame.view.combat;
      combat.damage.hp = 1;
      combat.party.setHp(s, 1);
    }, slot);
  });

  await test.step('Vicky casts Resta Lv3 on us: both HP values rise by the same heal', async () => {
    const r = await page.evaluate(
      ([s, tech, level]) => {
        const w = (window as any).classicGame;
        const combat = w.view.combat;
        const me = w.game.selfId;
        const before = { mine: combat.damage.hp, vicky: combat.party.get(s).hp };
        // 6x47 {tech, level, count 1, [me, hitbox 0]} then 6x48 {tech, level} (net/game.ts builders)
        const cast = new Uint8Array(12);
        const dv = new DataView(cast.buffer);
        cast[0] = 0x47;
        cast[1] = 3;
        dv.setUint16(2, s, true);
        cast[4] = tech;
        cast[6] = level;
        cast[7] = 1;
        dv.setUint16(8, me, true);
        combat.onSubcommand(0x47, s, cast);
        const done = new Uint8Array(8);
        const dd = new DataView(done.buffer);
        done[0] = 0x48;
        done[1] = 2;
        dd.setUint16(2, s, true);
        dd.setUint16(4, tech, true);
        dd.setUint16(6, level, true);
        combat.onSubcommand(0x48, s, done);
        return { before, after: { mine: combat.damage.hp, vicky: combat.party.get(s).hp }, maxMine: combat.damage.maxHp };
      },
      [slot, TECH_RESTA, LEVEL] as const,
    );
    // chop(400 * 0.5 + power) >= 200: a fresh character is healed to full, Vicky (Lv 125) gains it all.
    expect(r.after.mine).toBe(r.maxMine);
    expect(r.after.vicky - r.before.vicky).toBeGreaterThanOrEqual(200);
  });

  await test.step('confused: the leg heading is random while W is held', async () => {
    const aims = async (): Promise<number[]> => {
      const out: number[] = [];
      await page.keyboard.down('w');
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(100);
        out.push(
          await peek(page, (w) => {
            const m = w.classicGame.view.view.mover;
            return Math.round((Math.atan2(m.legEnd().x - m.x, m.legEnd().z - m.z) + 7) * 20);
          }),
        );
      }
      await page.keyboard.up('w');
      return out;
    };
    const plain = new Set(await aims());
    await page.waitForTimeout(500);
    await page.evaluate((t) => (window as any).classicGame.view.combat.inflictStatus(t, 'test'), STATUS_CONFUSION);
    expect(await peek(page, (w) => w.classicGame.view.view.legState().confused)).toBe(true);
    const confused = new Set(await aims());
    expect(confused.size).toBeGreaterThan(plain.size + 2);
  });

  await leaveToLobby(page);
});
