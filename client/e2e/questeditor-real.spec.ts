// Quest editor on a real newserv quest (vendor/newserv/system/quests/extermination/q101): open the
// .bin + .dat pair from the file dialog, drag an entity in the 3D view with the mouse, undo the drag,
// edit the script and apply it, then hand the quest to "Test in game" (no handler, then a handler
// registered by the embedding page). Standalone: needs only the Vite dev server (PW_BASE_URL) and
// the vendor quest files; the spec skips when they are missing.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const QUEST_DIR = resolve(import.meta.dirname, '../../vendor/newserv/system/quests/extermination');
const BIN = resolve(QUEST_DIR, 'q101-bb-e.bin');
const DAT = resolve(QUEST_DIR, 'q101-bb.dat');

// The editor's document as the page sees it (window.questEditor, main.ts).
const docEval = <T>(page: Page, fn: string, arg?: unknown): Promise<T> =>
  page.evaluate(
    ([src, a]) => new Function('qe', 'arg', `return (${src})(qe, arg)`)((window as any).questEditor, a),
    [fn, arg ?? null] as [string, unknown],
  ) as Promise<T>;

test.beforeAll(() => {
  test.skip(!existsSync(BIN) || !existsSync(DAT), 'vendor/newserv quest q101 is not present');
});

test('a real quest: drag an entity, undo, edit the script, Test in game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/questeditor.html');
  await expect(page.getByRole('button', { name: 'Open...', exact: true })).toBeVisible();

  // Open...: the hidden file input of the page takes the .bin and the .dat together.
  await page.locator('input[type=file]').setInputFiles([BIN, DAT]);
  await expect(page.locator('.qe-entity-list')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.qe-title')).not.toHaveText('New quest *');
  const info = page.locator('.qe-panel', { hasText: 'entities on this floor' }).getByText(/\d+ of \d+ entities/);
  await expect(info).toHaveText(/^\d+ of \d+ entities$/);

  // Script positions: q101's four player starts and its at_coords_talk circles are drawn (one
  // diamond and pole per position, a ring per radius), and the Script positions box hides them.
  const scriptMarks = await docEval<{ count: number; rings: number; objects: number }>(
    page,
    `(qe) => { const r = qe.scene.scriptRoot; return { count: qe.scene.scriptMarkerCount, rings: r.children.filter((c) => c.type === 'LineLoop').length, objects: r.children.length }; }`,
  );
  expect(scriptMarks.count).toBeGreaterThanOrEqual(7);
  expect(scriptMarks.rings).toBeGreaterThanOrEqual(3);
  expect(scriptMarks.objects).toBe(scriptMarks.count * 2 + scriptMarks.rings);
  await page.getByLabel(/Script positions/).uncheck();
  expect(await docEval<boolean>(page, `(qe) => qe.scene.scriptRoot.visible`)).toBe(false);
  await page.getByLabel(/Script positions/).check();
  expect(await docEval<boolean>(page, `(qe) => qe.scene.scriptRoot.visible`)).toBe(true);

  // The first entity of the floor, selected from its list row; wait until the 3D view draws it.
  const row = page.locator('.qe-entity-row').first();
  await row.click();
  const before = await docEval<{ index: number; pos: number[] }>(
    page,
    `(qe) => { const e = qe.document.selection[0]; return { index: qe.document.entitiesOf(qe.document.floor).indexOf(e), pos: [...e.position] }; }`,
  );
  expect(before.index).toBeGreaterThanOrEqual(0);
  await expect
    .poll(() => docEval<boolean>(page, `(qe) => !!qe.scene.screenPointOf(qe.document.selection[0])`), { timeout: 60_000 })
    .toBe(true);

  // Grab the marker and drag it 60 px right and 40 px down, in steps (one undo step).
  const grab = await docEval<{ x: number; y: number }>(page, `(qe) => qe.scene.screenPointOf(qe.document.selection[0])`);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(grab.x + (60 * i) / 8, grab.y + (40 * i) / 8);
  await page.mouse.up();

  const moved = await docEval<number[]>(page, `(qe) => [...qe.document.selection[0].position]`);
  expect(moved).not.toEqual(before.pos);
  await expect(page.locator('.qe-title')).toHaveText(/ \*$/);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();

  // Undo puts the entity back where it was.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => docEval<number[]>(page, `(qe) => [...qe.document.selection[0].position]`)).toEqual(before.pos);

  // Script tab: append a comment line (the assembler's `//`), Apply; the status says so.
  await page.getByRole('button', { name: 'Script', exact: true }).click();
  const script = page.getByRole('textbox', { name: 'Quest script' });
  await expect(script).not.toHaveValue('');
  const text = await script.inputValue();
  await script.fill(`${text}\n// e2e: edited in the Script tab\n`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.qe-script-status')).toHaveClass(/ok/);
  await expect(page.locator('.qe-script-status')).not.toHaveText('');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  expect(await docEval<number>(page, `(qe) => qe.scene.scriptMarkerCount`)).toBe(scriptMarks.count); // the script was rebuilt, same positions

  // A script that does not assemble is refused with its message, and the quest keeps its script.
  const bytesHash = `(qe) => { let h = 0; for (const b of qe.document.toQuestBin().data) h = (h * 31 + b) >>> 0; return h; }`;
  const before2 = await docEval<number>(page, bytesHash);
  await script.fill('no_such_opcode_e2e\n');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.qe-script-status')).toHaveClass(/err/);
  expect(await docEval<number>(page, bytesHash)).toBe(before2);

  // Back to the 3D view; Test in game with no handler and no opener says so.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await page.getByRole('button', { name: 'Test in game', exact: true }).click();
  await expect(page.locator('.qe-status, .qe-toast, [role=status]').filter({ hasText: 'No game target' }).first()).toBeVisible();

  // With a handler (what the admin panel registers) the package reaches it: the quest name and bytes.
  await docEval(page, `(qe) => { qe.registerTestInGame((pkg) => { window.__testPkg = { name: pkg.name, bin: pkg.binRaw.length, dat: pkg.datRaw.length }; }); }`);
  await page.getByRole('button', { name: 'Test in game', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__testPkg ?? null)).not.toBeNull();
  const pkg = await page.evaluate(() => (window as any).__testPkg);
  expect(pkg.name).toBe(await docEval<string>(page, `(qe) => qe.document.header.name`));
  expect(pkg.name).toBe('Mop-up Operation #1');
  expect(pkg.bin).toBeGreaterThan(0);
  expect(pkg.dat).toBeGreaterThan(0);

  // Publish to server only appears with an admin session (not on the dev server).
  await expect(page.getByRole('button', { name: 'Publish to server', exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
