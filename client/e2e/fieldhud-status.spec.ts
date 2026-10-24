// The field HUD's status icons and party windows (classic/hud.ts, render/combat.ts) and the
// quest timer box, in Forest 1 of a fresh party field:
//   - Shifta and Deband on the local player (their icons 6 and 8 of the texel table) next to
//     the status window;
//   - a fake party member "Vicky" (Lv 125, the next client slot, a copy of the local player's
//     model) with the same two slots from a remote cast, shown under the status window with
//     the icons at GUI 0xbd;
//   - the quest timer box at GUI 0x24 (254, 37) with the text h'mm"ss, set the way the quest
//     VM's show_timer / winset_time do (the VM path itself is in tests/questmisc.test.ts).
// The screenshot goes to test-results (testInfo.outputPath) for comparison with the reference
// capture of the same HUD (scratchpad 13.png).
//
// Needs newserv and the bridge (ws://127.0.0.1:8080). See e2e/README.md.
import { expect, test } from '@playwright/test';
import { consoleLog, leaveToLobby, peek } from './classic.ts';
import { enterFreshField } from './fresh-field.ts';

const GROUP_SHIFTA = 9; // combat/buffs.ts GROUP.shifta
const GROUP_DEBAND = 10; // combat/buffs.ts GROUP.deband
const LEVEL = 2; // supportPower(level 2) = 2

test('status icons, party window and timer box in Forest 1', async ({ page }, testInfo) => {
  const logs = consoleLog(page);
  await test.step('a fresh account in a party field', () => enterFreshField(page, logs, { prefix: 'fhs' }));

  await test.step('Forest 1', async () => {
    await page.evaluate(() => (window as any).classicGame.view.warpTo(1));
    await expect
      .poll(() => peek(page, (w) => `${w.classicGame.view.current?.floor}:${w.classicGame.game.loading}`), { timeout: 60_000 })
      .toBe('1:false');
    await page.waitForTimeout(2000);
  });

  await test.step('Shifta and Deband on the local player: icons 6 and 8', async () => {
    await page.evaluate(
      ([shifta, deband, level]) => {
        const combat = (window as any).classicGame.view.combat;
        combat.applySelfBuff(shifta, level, 'test: Shifta');
        combat.applySelfBuff(deband, level, 'test: Deband');
      },
      [GROUP_SHIFTA, GROUP_DEBAND, LEVEL] as const,
    );
    const icons = await peek(page, (w) => w.classicGame.view.combat.selfBuffs.icons());
    expect(icons).toEqual([6, 8]);
  });

  await test.step('a fake party member, Vicky, with the same slots from a remote cast', async () => {
    await page.evaluate(
      ([shifta, deband, level]) => {
        const game = (window as any).classicGame.game;
        const combat = (window as any).classicGame.view.combat;
        const self = game.self;
        const slot = (game.selfId + 1) & 3;
        game.addLocalPlayer({
          ...self,
          clientId: slot,
          guildCardNumber: 4242,
          name: 'Vicky',
          level: 125,
          position: { x: self.position.x + 60, y: self.position.y, z: self.position.z },
        });
        combat.applyRemoteBuff(slot, shifta, level, 'test: Vicky');
        combat.applyRemoteBuff(slot, deband, level, 'test: Vicky');
      },
      [GROUP_SHIFTA, GROUP_DEBAND, LEVEL] as const,
    );
    await expect
      .poll(() => peek(page, (w) => (w.classicGame.view.combat.hud?.party?.windows ?? []).some((p: any) => p.values?.name === 'Vicky')), { timeout: 10_000 })
      .toBe(true);
    const vicky = await peek(page, (w) => {
      const p = (w.classicGame.view.combat.hud.party.windows as any[]).find((x) => x.values?.name === 'Vicky');
      return { icons: p.values.statusIcons, level: p.values.level, slot: p.slot };
    });
    expect(vicky.icons).toEqual([6, 8]);
    expect(vicky.level).toBe(125);
  });

  await test.step('the quest timer box at GUI 0x24 reads 0\'25"24', async () => {
    // window_time opens the window and winset_time sets 25 * 60 + 24 seconds; the VM
    // (quest/town.ts timerChanged) draws the same line at (254, 37).
    await page.evaluate(() => {
      const town = (window as any).classicTown;
      town.ui.setHud('quest-timer', { x: 254, y: 37, lines: ['0\'25"24'] });
    });
    await page.waitForTimeout(1500);
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('fieldhud-status.png') });
  await leaveToLobby(page);
});
