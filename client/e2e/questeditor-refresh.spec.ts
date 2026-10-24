// Quest editor UI refresh: adding an entity from the palette must update the entity list,
// the Undo button and the title (regression: named flush() parts were skipped after the
// pending set was cleared, so only flush(['all']) ever refreshed the page).
// Standalone: needs only the Vite dev server (PW_BASE_URL, default the checkout's Vite).
import { expect, test } from '@playwright/test';

test('adding a Booma from the palette refreshes the list, Undo and the title', async ({ page }) => {
  await page.goto('/questeditor.html');

  // Fresh quest: New -> Create.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.qe-entity-list')).toBeVisible();
  await expect(page.locator('.qe-panel', { hasText: 'entities on this floor' }).getByText(/\d+ of \d+ entities/)).toHaveText('1 of 1 entities');

  const booma = page.locator('.qe-palette-row', { has: page.locator('.name', { hasText: /^Booma$/ }) });
  await booma.getByRole('button', { name: '+', exact: true }).click();

  const info = page.locator('.qe-panel', { hasText: 'entities on this floor' }).getByText(/\d+ of \d+ entities/);
  await expect(info).toHaveText('2 of 2 entities');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(page.locator('.qe-title')).toHaveText('New quest *');
  await expect(page.locator('.qe-entity-row')).toHaveCount(2);
});
