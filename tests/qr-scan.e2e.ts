import { expect, test } from '@playwright/test';
import { makeCode } from './read-code';

const photo = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/png', buffer });

test('reads a QR code and a barcode from photos, and offers the right action for each', async ({ page }) => {
  await page.goto('/qr-code-scanner/');
  const input = page.locator('.scan input[type=file]');
  const results = page.getByRole('list', { name: 'Codes found' });

  await input.setInputFiles(photo('wifi.png', await makeCode('WIFI:T:WPA;S:Home Net;P:secret;;', 'QRCode')));
  await expect(page.locator('.scan .status')).toHaveText('Found 1.');
  await expect(results).toContainText('Wi-Fi network: Home Net');
  await expect(results.getByRole('button', { name: 'Copy password' })).toBeVisible();

  await input.setInputFiles(photo('ean.png', await makeCode('5901234123457', 'EAN13')));
  await expect(results.locator('li').first()).toContainText('EAN-13');
  await expect(results.locator('li').first()).toContainText('5901234123457');

  await input.setInputFiles(photo('upi.png', await makeCode('upi://pay?pa=shop%40okicici&pn=Ram%20Stores&am=250&cu=INR', 'QRCode')));
  await expect(results.locator('li').first()).toContainText('Pay Ram Stores (shop@okicici) ₹250');
  await expect(results.getByRole('link', { name: 'Pay with a UPI app' })).toHaveAttribute('href', /^upi:\/\/pay/);

  await input.setInputFiles(photo('link.png', await makeCode('https://fizzdoc.com/', 'QRCode')));
  const open = results.getByRole('link', { name: 'Open' });
  await expect(open).toHaveAttribute('href', 'https://fizzdoc.com/');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(results.locator('li')).toHaveCount(4);
});

test('a picture with no code says so', async ({ page }) => {
  await page.goto('/qr-code-scanner/');
  await page.locator('.scan input[type=file]').setInputFiles('tests/fixtures/photo.png');
  await expect(page.locator('.scan .status')).toHaveText('No code found. Try a sharper or closer photo.');
});
