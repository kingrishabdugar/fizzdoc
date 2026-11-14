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
