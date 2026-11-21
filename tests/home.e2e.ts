import { expect, test } from '@playwright/test';

test('a visited tool shows under "Your tools", a pinned one comes first, and both survive a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#mine')).toBeHidden();

  await page.goto('/merge-pdf/');
  await page.goto('/compress-image/');
  await page.getByRole('button', { name: 'Pin to home' }).click();
  await expect(page.getByRole('button', { name: 'Pinned to home' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/');
  const mine = page.locator('#mine .tool-card strong');
  await expect(mine).toHaveText(['Compress Image', 'Merge PDF']);
  // Pinning from the list moves Merge PDF to the front.
  await page.getByRole('button', { name: 'Pin Merge PDF' }).click();
  await expect(mine).toHaveText(['Merge PDF', 'Compress Image']);
  await page.reload();
  await expect(mine).toHaveText(['Merge PDF', 'Compress Image']);
  await expect(page.getByRole('button', { name: 'Pin Merge PDF' })).toHaveAttribute('aria-pressed', 'true');
});

test('filter tabs show one kind of tool at a time, and the format links open their tab', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('group', { name: 'Show tools for' });
  await tabs.getByRole('button', { name: 'Audio tools' }).click();
  await expect(page.locator('#audio')).toBeVisible();
  await expect(page.locator('#pdf')).toBeHidden();
  await tabs.getByRole('button', { name: 'All' }).click();
  await expect(page.locator('#pdf')).toBeVisible();
  await page.goto('/#excel');
  await expect(page.locator('#excel')).toBeVisible();
  await expect(page.locator('#word')).toBeHidden();
});
