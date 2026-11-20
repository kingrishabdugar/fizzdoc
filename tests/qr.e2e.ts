import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readCode } from './read-code';

/** Downloads the code and reads it back the way a phone camera app would. */
async function scan(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download QR code' }).click()]);
  const bytes = readFileSync((await download.path())!);
  return { text: await readCode(bytes), width: bytes.readUInt32BE(16), name: download.suggestedFilename() };
}

const template = (page: Page, name: string) => page.getByRole('group', { name: 'Templates' }).getByRole('button', { name, exact: true });

const fill = async (page: Page, kind: string, values: Record<string, string>) => {
  await page.getByRole('button', { name: kind, exact: true }).click();
  for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(value);
};

test('makes a UPI, Wi-Fi and link QR code that scans, in every template', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/qr-code-generator/');
  // A link is ready to download before anything is typed.
  expect((await scan(page)).text).toBe('https://fizzdoc.com');

  await fill(page, 'UPI payment', { 'UPI ID (like name@okhdfcbank)': 'shop@okicici', 'Name shown to the payer': 'Ram Stores', 'Amount in ₹ (optional)': '250' });
  const upi = 'upi://pay?pa=shop%40okicici&pn=Ram%20Stores&am=250&cu=INR';
  for (const name of ['Classic', 'Rounded', 'Dots', 'Ocean gradient', 'Sunset gradient', 'Forest', 'Scan me label', 'UPI payment frame', 'Wi-Fi label', 'Radial gradient']) {
    await template(page, name).click();
    expect((await scan(page)).text, name).toBe(upi);
  }
  // A see-through code is read where it is printed or placed: on white, as a JPG is saved.
  await template(page, 'See-through background').click();
  await page.getByLabel('Format', { exact: true }).selectOption('jpg');
  expect((await scan(page)).text).toBe(upi);
  await page.getByLabel('Format', { exact: true }).selectOption('png');

  await template(page, 'Classic').click();
  await fill(page, 'Wi-Fi', { 'Network name': 'Home;Net', Password: 'secret' });
  expect((await scan(page)).text).toBe('WIFI:T:WPA;S:Home\\;Net;P:secret;;');
});

test('a logo switches to the strongest error correction, and the code still scans', async ({ page }) => {
  await page.goto('/qr-code-generator/');
  const ecc = page.getByLabel('Error correction');
  await expect(ecc).toBeEnabled();
  await page.locator('.qr-file').setInputFiles(fileURLToPath(new URL('./fixtures/big-photo.jpg', import.meta.url)));
  await expect(page.getByRole('button', { name: 'Remove logo' })).toBeVisible();
  await expect(ecc).toBeDisabled();
  await expect(ecc).toHaveValue('H');
  await page.getByRole('button', { name: 'Extra rounded' }).click();
  expect((await scan(page)).text).toBe('https://fizzdoc.com');
  await page.getByRole('button', { name: 'Remove logo' }).click();
  await expect(ecc).toBeEnabled();
});

test('saves PNG at the chosen size, and SVG, JPG and PDF under the chosen name', async ({ page }) => {
  await page.goto('/qr-code-generator/');
  await page.getByLabel('Size', { exact: true }).selectOption('2048');
  await page.getByLabel('File name', { exact: true }).fill('shop');
  const png = await scan(page);
  expect([png.name, png.width]).toEqual(['shop.png', 2048]);
  expect((await scan(page)).text).toBe('https://fizzdoc.com');
  for (const [format, name] of [['svg', 'shop.svg'], ['jpg', 'shop.jpg'], ['pdf', 'shop.pdf']]) {
    await page.getByLabel('Format', { exact: true }).selectOption(format);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download QR code' }).click()]);
    expect(download.suggestedFilename()).toBe(name);
    const head = readFileSync((await download.path())!).subarray(0, 5).toString('latin1');
    expect(head).toBe({ svg: '<svg ', jpg: '\xff\xd8\xff\xe0\x00', pdf: '%PDF-' }[format]);
  }
});

test('warns about low contrast and light-on-dark codes', async ({ page }) => {
  await page.goto('/qr-code-generator/');
  const warn = page.locator('.qr-warn');
  await expect(warn).toHaveText('');
  await template(page, 'Light on dark').click();
  await expect(warn).toContainText('Light dots on a dark background');
  await template(page, 'Classic').click();
  await page.locator('.qr-color input').first().fill('#dddddd');
  await expect(warn).toContainText('Low contrast');
});

test('the QR generator passes the accessibility check and works from the keyboard', async ({ page }) => {
  await page.goto('/qr-code-generator/');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`))).toEqual([]);
  await page.getByRole('button', { name: 'Wi-Fi', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Wi-Fi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.qr-preview')).toHaveAttribute('aria-label', 'Fill in the details and your code appears here.');
  await page.getByLabel('Network name').focus();
  await page.keyboard.type('Cafe');
  await expect(page.locator('.qr-preview')).toHaveAttribute('aria-label', 'QR code for: WIFI:T:WPA;S:Cafe;;');
});
