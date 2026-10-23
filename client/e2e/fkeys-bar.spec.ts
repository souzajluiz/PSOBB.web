// The on-screen function-key bar (ui/webcontrols.ts, input/fkeys.ts): on a Mac
// (navigator platform stubbed) the bar shows F1..F12 over the classic page, and a
// click on F1 sends an F1 keydown and keyup to the game canvas, at least 120 ms
// apart, without taking the keyboard focus from the canvas. Browser convenience,
// not PsoBB.exe behaviour. Needs only the Vite dev server (no login).
import { expect, test } from '@playwright/test';

test('the F-key bar shows on a Mac, and a click on F1 holds F1 at the canvas', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel', configurable: true });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: 'macOS' }), configurable: true });
  });
  await page.goto('/classic.html');

  const bar = page.locator('.wc-fkeys');
  await expect(bar).toBeVisible();
  await expect(bar.locator('button')).toHaveCount(12);

  // The game's canvas is the focusable one (classic/stage.ts sets tabIndex 0).
  const canvas = page.locator('canvas[tabindex="0"]');
  await expect(canvas).toHaveCount(1);
  await canvas.focus();
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[tabindex="0"]')!;
    const log: Array<[string, number, string]> = [];
    (window as unknown as { __fkeys: typeof log }).__fkeys = log;
    for (const type of ['keydown', 'keyup'] as const) {
      c.addEventListener(type, (e) => {
        if (e.key === 'F1') log.push([type, performance.now(), document.activeElement?.tagName ?? '']);
      });
    }
  });

  await bar.locator('button', { hasText: /^F1$/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fkeys: unknown[] }).__fkeys.length)).toBe(2);

  const [[downType, downAt, downFocus], [upType, upAt]] = await page.evaluate(() => (window as unknown as { __fkeys: [string, number, string][] }).__fkeys);
  expect(downType).toBe('keydown');
  expect(upType).toBe('keyup');
  expect(upAt - downAt).toBeGreaterThanOrEqual(120);
  expect(downFocus).toBe('CANVAS'); // the click did not move the keyboard focus
  await expect(canvas).toBeFocused();
});
