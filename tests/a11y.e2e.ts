import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PAGES } from '../src/seo';

/** Serious and critical WCAG 2.2 A/AA findings on the page as it is now, one line each. */
export async function problems(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(' ')}`));
}

// Other languages share the markup of the English pages, so the English set covers every template.
for (const { path } of PAGES.filter((page) => page.lang === 'en'))
  test(`passes the accessibility check at ${path}`, async ({ page }) => {
    await page.goto(path);
    expect(await problems(page)).toEqual([]);
  });

// Dark colours come from one set of tokens, so a home page, a tool and a text page cover them.
for (const path of ['/', '/compress-pdf/', '/privacy/'])
  test(`passes the accessibility check in the dark theme at ${path}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(path);
    expect(await problems(page)).toEqual([]);
  });

// ---- Tools with a file open: the editors build their controls in the page ----
const file = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const choose = (page: Page, ...names: string[]) => page.locator('#file-input').setInputFiles(names.map(file));
/** A canvas in the page as text, to tell whether a key press changed the picture. */
const picture = (page: Page) => page.locator('#viewer canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

test('the editors pass the accessibility check with a file open', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/photo-editor/');
  await choose(page, 'big-photo.jpg');
  await expect(page.getByRole('tab', { name: 'Text' })).toBeVisible();
  expect(await problems(page), 'photo editor').toEqual([]);

  await page.goto('/collage-maker/');
  await choose(page, 'big-photo.jpg', 'photo.jpg');
  await expect(page.getByRole('img', { name: 'Preview of the collage' })).toBeVisible();
  expect(await problems(page), 'collage maker').toEqual([]);

  await page.goto('/redact-pdf/');
  await choose(page, 'rich-text.pdf');
  await expect(page.locator('.redact-page canvas').first()).toHaveAttribute('width', /\d/);
  expect(await problems(page), 'redact').toEqual([]);

  await page.goto('/edit-pdf/');
  await choose(page, 'text-only.pdf');
  await expect(page.locator('#viewer').getByRole('button', { name: 'Undo' })).toBeVisible();
  expect(await problems(page), 'edit pdf').toEqual([]);

  await page.goto('/split-audio/');
  await choose(page, 'tone.mp3');
  await expect(page.locator('#file-list')).toContainText('0:06');
  expect(await problems(page), 'split audio').toEqual([]);
});

// ---- Keyboard only: no mouse, no clicks ----
test('merges PDFs with the keyboard alone', async ({ page }) => {
  await page.goto('/merge-pdf/');
  await choose(page, 'form.pdf', 'bookmarks.pdf');
  await page.getByRole('button', { name: 'Merge PDFs' }).press('Enter');
  await expect(page.locator('#status')).toContainText('Done');
});

test('photo editor text: arrow keys move it, Delete removes it', async ({ page }) => {
  await page.goto('/photo-editor/');
  await choose(page, 'big-photo.jpg');
  await page.getByRole('tab', { name: 'Text' }).press('Enter');
  await page.getByRole('button', { name: 'Add text' }).press('Enter');
  const canvas = page.locator('#viewer canvas').first();
  await canvas.focus();
  const before = await picture(page);
  await canvas.press('ArrowUp');
  await canvas.press('Shift+ArrowLeft');
  // The preview repaints on the next frame, so wait for it.
  await expect.poll(() => picture(page)).not.toBe(before);
  await canvas.press('Delete');
  await expect(page.getByRole('textbox', { name: 'Your text' })).toBeHidden();
});

test('redaction: Enter adds a box on the focused page, arrows move it, Delete removes it', async ({ page }) => {
  await page.goto('/redact-pdf/');
  await choose(page, 'rich-text.pdf');
  const overlay = page.locator('.redact-overlay').first();
  await expect(page.locator('.redact-page canvas').first()).toHaveAttribute('width', /\d/);
  await overlay.focus();
  await overlay.press('Enter');
  const box = overlay.locator('.redact-box');
  await expect(box).toHaveCount(1);
  const left = await box.evaluate((node: HTMLElement) => node.style.left);
  await overlay.press('ArrowRight');
  expect(await box.evaluate((node: HTMLElement) => node.style.left)).not.toBe(left);
  const width = await box.evaluate((node: HTMLElement) => node.style.width);
  await overlay.press('Shift+ArrowRight');
  expect(await box.evaluate((node: HTMLElement) => node.style.width)).not.toBe(width);
  await overlay.press('Delete');
  await expect(box).toHaveCount(0);
});

test('background brush: with Erase on, Space paints where the keyboard ring is', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ baseURL });
  // The small background model keeps this quick; the brush works the same on both.
  await context.addInitScript(() => localStorage.setItem('fizzdoc-bg-crashed', String(Date.now())));
  const page = await context.newPage();
  await page.goto('/remove-background/');
  await choose(page, 'big-photo.jpg');
  await expect(page.getByRole('button', { name: 'Blur' })).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('.bg-busy')).toBeHidden();
  expect(await problems(page), 'remove background').toEqual([]);
  // Restore brings a piece of the photo back wherever it is painted, so the picture changes.
  await page.getByRole('button', { name: 'Restore', exact: true }).press('Enter');
  const canvas = page.locator('.bg-canvas');
  await canvas.focus();
  await canvas.press('Shift+ArrowLeft');
  await canvas.press('Shift+ArrowUp');
  await canvas.press('Space');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await context.close();
});
