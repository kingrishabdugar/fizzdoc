import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { PAGES, SITE_LANGS } from '../src/seo';
import { SITE, TOOLS } from '../src/site';

const file = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const fixture = (name: string) => file(`${name}.pdf`);

/** Records every request and console CSP violation, so tests can prove nothing leaves the page. */
function watch(page: Page) {
  const requests: { url: string; method: string; body: string | null }[] = [];
  const violations: string[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
  page.on('console', (m) => m.text().includes('Content Security Policy') && violations.push(m.text()));
  return { requests, violations };
}

async function downloadBytes(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  return { name: download.suggestedFilename(), bytes: readFileSync((await download.path())!) };
}

test('merges two PDFs locally without sending any file data', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/merge-pdf/');
  await page.locator('#file-input').setInputFiles([fixture('form'), fixture('bookmarks')]);
  await expect(page.locator('#file-list li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Merge PDFs' }).click();

  await expect(page.locator('#status')).toContainText('Done — 6 pages');
  await expect(page.locator('#warnings')).toContainText('Bookmarks from the second and later files');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('form-merged.pdf');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  const origin = new URL(baseURL!).origin;
  for (const request of seen.requests) {
    if (request.url.startsWith('blob:')) continue;
    expect(new URL(request.url).origin, request.url).toBe(origin);
    expect(request.method, request.url).toBe('GET');
    expect(request.body, request.url).toBeNull();
  }
  expect(seen.violations).toEqual([]);
});

test('shows real progress and a prefilled problem report without the file name', async ({ page }) => {
  // Remember the highest percentage the bar reached; small jobs finish too fast to catch otherwise.
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const bar = document.getElementById('progress');
      if (!bar) return;
      new MutationObserver(() => {
        const pct = Number(bar.dataset.pct ?? 0);
        (window as unknown as { maxPct: number }).maxPct = Math.max((window as unknown as { maxPct: number }).maxPct ?? 0, pct);
      }).observe(bar, { attributes: true });
    });
  });
  await page.goto('/split-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await expect(page.locator('#file-list')).toContainText('3 pages');
  await page.locator('#pages').fill('2-3');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('Done — 2 pages');
  expect(await page.evaluate(() => (window as unknown as { maxPct?: number }).maxPct)).toBe(100);
  await expect(page.locator('#progress')).toBeHidden();

  const link = page.locator('#report-link');
  await expect(link).toHaveText('Slow or not working? Report it on GitHub');
  await link.evaluate((a) => a.addEventListener('click', (event) => event.preventDefault()));
  await link.click();
  const url = new URL((await link.getAttribute('href'))!);
  expect(url.origin + url.pathname).toBe(`${SITE.repo}/issues/new`);
  expect(url.searchParams.get('template')).toBe('bug_report.yml');
  expect(url.searchParams.get('tool')).toMatch(/\/split-pdf\/$/);
  expect(url.searchParams.get('browser')).toContain('Mozilla');
  expect(url.searchParams.get('extra')).toMatch(/Files: 1, .*3 pages/);
  expect(url.searchParams.get('extra')).toContain('Time:');
  expect(url.toString()).not.toContain('mixed');
});

test('alternative pages describe only Fizzdoc, link to the matching tools and say they are not affiliated', async ({ page }) => {
  await page.goto('/ilovepdf-alternative/');
  await expect(page.locator('h1')).toHaveText('A private, free alternative to iLovePDF');
  await expect(page.locator('#compare')).toHaveText('How Fizzdoc works');
  await expect(page.locator('main')).toContainText('not affiliated');
  // Only Fizzdoc is described: no claims about the other service.
  await expect(page.locator('main')).not.toContainText('hours');
  await page.locator('.tool-grid a', { hasText: 'Merge PDF' }).click();
  await expect(page).toHaveURL(/\/merge-pdf\/$/);

  await page.goto('/alternatives/');
  await expect(page.locator('section:has(#compare) .proof-grid a')).toHaveCount(7);
  await page.goto('/hi/');
  await expect(page.locator('footer a[href="/alternatives/"]')).toHaveText('जाने-पहचाने टूल्स के विकल्प');
});

test('the Aadhaar unlock page explains the password format and unlocks on the device', async ({ page }) => {
  await page.goto('/unlock-aadhaar-pdf/');
  await expect(page.locator('h1')).toHaveText('Remove the password from an e-Aadhaar PDF');
  await expect(page.locator('#faq')).toBeVisible();
  await expect(page.locator('main')).toContainText('SURE1990');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill('test-only');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('#status')).toContainText('Done — 3 pages');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('user-password-unlocked.pdf');
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
});

test('unlocks a protected PDF after a wrong then a right password', async ({ page }) => {
  await page.goto('/unlock-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill('wrong');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog).toContainText('Try again (2 of 3)');
  await dialog.locator('input').fill('test-only');
  await dialog.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.locator('#status')).toContainText('Done — 3 pages');
  const { name } = await downloadBytes(page);
  expect(name).toBe('user-password-unlocked.pdf');
});

test('explains bad page ranges and cancels cleanly', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await expect(page.locator('#file-list')).toContainText('3 pages');
  await page.locator('#pages').fill('9');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('This PDF has 3 pages. Use page numbers from 1 to 3');

  // A range past the end keeps what exists: "1-5" on a one-page bill is just page 1.
  await page.locator('#file-input').setInputFiles(fixture('blank'));
  await expect(page.locator('#file-list')).toContainText('1 page');
  await page.locator('#pages').fill('1-5');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('1 page');
  await expect(page.locator('#download')).toBeVisible();
  await page.locator('#pages').fill('2');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('This PDF has only 1 page');

  await page.goto('/unlock-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toContainText('needs its password');
  await expect(page.getByRole('button', { name: 'Remove password' })).toBeEnabled();
});

test('password-protects a PDF after checking both entries match', async ({ page }) => {
  await page.goto('/protect-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  await page.locator('#new-password').fill('s3cret');
  await page.locator('#confirm-password').fill('typo');
  await page.getByRole('button', { name: 'Protect PDF' }).click();
  await expect(page.locator('#status')).toContainText('do not match');
  await page.locator('#confirm-password').fill('s3cret');
  await page.getByRole('button', { name: 'Protect PDF' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('text-only-protected.pdf');
  expect(bytes.toString('latin1')).toContain('/Encrypt');
});

test('turns images into a PDF and PDF pages into images', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/jpg-to-pdf/');
  await page.locator('#file-input').setInputFiles([file('photo.png'), file('photo.jpg')]);
  await page.getByRole('button', { name: 'Create PDF' }).click();
  await expect(page.locator('#status')).toContainText('Done — 2 pages');
  expect((await downloadBytes(page)).name).toBe('photo-and-more.pdf');

  await page.goto('/pdf-to-jpg/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await expect(page.locator('#status')).toContainText('Done — 3 images');
  await expect(page.locator('#download')).toHaveText('Download ZIP');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('mixed-images.zip');
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(seen.violations).toEqual([]);
});

test('cleans Office metadata and extracts Office images', async ({ page }) => {
  await page.goto('/remove-word-metadata/');
  await page.locator('#file-input').setInputFiles(file('report.docx'));
  await page.getByRole('button', { name: 'Remove metadata' }).click();
  await expect(page.locator('#status')).toContainText('Done — Metadata removed');
  const clean = await downloadBytes(page);
  expect(clean.name).toBe('report-clean.docx');

  await page.goto('/extract-images-from-excel/');
  await page.locator('#file-input').setInputFiles(file('sheet.xlsx'));
  await page.getByRole('button', { name: 'Extract images' }).click();
  await expect(page.locator('#status')).toContainText('Done — 1 image');
  expect((await downloadBytes(page)).name).toBe('sheet-images.zip');

  await page.locator('#file-input').setInputFiles(file('report.docx'));
  await expect(page.locator('#status')).toContainText('That file type can’t be used with this tool.');
});

test('compresses a PDF and reports the saving', async ({ page }) => {
  await page.goto('/compress-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  await page.getByRole('button', { name: 'Compress PDF' }).click();
  await expect(page.locator('#status')).toContainText(/smaller|Already optimized/);
  expect((await downloadBytes(page)).name).toBe('text-only-compressed.pdf');
});

test('resizes and converts images with the chosen options', async ({ page }) => {
  await page.goto('/resize-image/');
  await page.locator('#file-input').setInputFiles(file('photo.png'));
  await page.locator('input[name="width"]').fill('60');
  await page.getByRole('button', { name: 'Resize images' }).click();
  await expect(page.locator('#status')).toContainText('60 × 40');
  expect((await downloadBytes(page)).name).toBe('photo-60x40.png');

  // A scale outside 1–1000 % is refused up front instead of making a 1×1 image or exhausting memory.
  await page.locator('input[name="width"]').fill('');
  for (const scale of ['0', '-50', '99999']) {
    await page.locator('input[name="scale"]').fill(scale);
    await page.getByRole('button', { name: 'Resize images' }).click();
    await expect(page.locator('#status')).toHaveText('The scale must be between 1% and 1000%.');
  }
  await page.locator('input[name="scale"]').fill('');

  await page.goto('/convert-image/');
  await page.locator('#file-input').setInputFiles([file('photo.png'), file('photo.jpg')]);
  await page.locator('input[name="quality"]').fill('50');
  await expect(page.locator('.options output')).toHaveText('50%');
  await page.getByRole('button', { name: 'Convert images' }).click();
  await expect(page.locator('#status')).toContainText('Done — 2 images');
  expect((await downloadBytes(page)).name).toBe('images-resized.zip');

  // Compressing an already-small image never makes it bigger.
  await page.goto('/compress-image/');
  await page.locator('#file-input').setInputFiles(file('photo.jpg'));
  await page.locator('input[name="quality"]').fill('100');
  await page.getByRole('button', { name: 'Compress images' }).click();
  expect((await downloadBytes(page)).bytes.length).toBeLessThanOrEqual(readFileSync(file('photo.jpg')).length);
});

test('compresses a photo under a form’s size limit while keeping it as large as possible', async ({ page }) => {
  await page.goto('/compress-image-to-50kb/');
  await expect(page.locator('input[name="targetKb"]')).toHaveValue('50');
  await page.locator('#file-input').setInputFiles(file('big-photo.jpg'));
  await page.getByRole('button', { name: 'Compress images' }).click();
  await expect(page.locator('#status')).toContainText('smaller');
  const small = await downloadBytes(page);
  expect(small.name).toBe('big-photo-50kb.jpg');
  expect(small.bytes.length).toBeLessThanOrEqual(50 * 1024);
  // It lowers the quality before it shrinks the picture, so the photo stays as large as it can.
  const widthNow = async () => Number(/(\d+) × \d+/.exec((await page.locator('#status').textContent())!)![1]);
  expect(await widthNow()).toBeGreaterThanOrEqual(800);
  await page.locator('input[name="targetKb"]').fill('100');
  await page.getByRole('button', { name: 'Compress images' }).click();
  await expect(page.locator('#status')).toContainText('smaller');
  expect(await widthNow()).toBeGreaterThanOrEqual(1000);
  expect((await downloadBytes(page)).bytes.length).toBeLessThanOrEqual(100 * 1024);

  await page.locator('input[name="targetKb"]').fill('5');
  await page.getByRole('button', { name: 'Compress images' }).click();
  await expect(page.locator('#status')).toContainText('too small for this image');
});

test('converts PDFs to text, Markdown, Word and PowerPoint', async ({ page }) => {
  const seen = watch(page);
  for (const [slug, button, name] of [
    ['pdf-to-text', 'Extract text', 'rich-text.txt'],
    ['pdf-to-markdown', 'Convert to Markdown', 'rich-text.md'],
    ['pdf-to-word', 'Convert to Word', 'rich-text.docx'],
    ['pdf-to-powerpoint', 'Convert to PowerPoint', 'rich-text.pptx'],
  ]) {
    await page.goto(`/${slug}/`);
    await page.locator('#file-input').setInputFiles(fixture('rich-text'));
    await page.getByRole('button', { name: button }).click();
    await expect(page.locator('#status')).toContainText('Done');
    expect((await downloadBytes(page)).name).toBe(name);
  }
  expect(seen.violations).toEqual([]);

  await page.goto('/pdf-to-text/');
  await page.locator('#file-input').setInputFiles(fixture('blank'));
  await page.getByRole('button', { name: 'Extract text' }).click();
  await expect(page.locator('#status')).toContainText('Run OCR PDF first');
});

/** All text pdf.js can still find in a PDF, page by page. */
async function pdfText(bytes: Buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('').trim());
  return pages;
}

test('redacts marked areas for good and turns PDFs into scanned PDFs', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/redact-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('rich-text'));
  await page.getByPlaceholder('Find a word or number to hide').fill('section one');
  await page.getByRole('button', { name: 'Mark all' }).click();
  await expect(page.locator('.redact-count')).toHaveText('Matches marked: 1');
  await expect(page.locator('.redact-page').first().locator('.redact-box')).toHaveCount(1);

  // Drag a box over the title, then undo and redo it.
  await page.locator('.redact-overlay').first().scrollIntoViewIfNeeded();
  const box = (await page.locator('.redact-overlay').first().boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.redact-count')).toHaveText('Marked areas: 2');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.redact-count')).toHaveText('Marked areas: 1');

  await page.getByRole('button', { name: 'Save redacted PDF' }).click();
  await expect(page.locator('#status')).toContainText('2 pages');
  const redacted = await downloadBytes(page);
  expect(redacted.name).toBe('rich-text-redacted.pdf');
  // The text outside the marks stays searchable; the marked heading is gone.
  const [first, second] = await pdfText(redacted.bytes);
  expect(first).toContain('Annual Report');
  expect(first).toContain('Second paragraph here after a gap.');
  expect(first).not.toMatch(/section one/i);
  expect(second).toBe('Page two content.');

  await page.goto('/pdf-to-scanned-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('rich-text'));
  await expect(page.locator('select[name="look"]')).toHaveValue('scanned');
  await page.getByRole('button', { name: 'Make scanned PDF' }).click();
  await expect(page.locator('#status')).toContainText('2 pages');
  const scanned = await downloadBytes(page);
  expect(scanned.name).toBe('rich-text-scanned.pdf');
  expect(await pdfText(scanned.bytes)).toEqual(['', '']);
  expect(seen.violations).toEqual([]);
  expect(seen.requests.filter((r) => !r.url.startsWith(page.url().split('/').slice(0, 3).join('/')))).toEqual([]);
});

test('keeps only the text that shows outside the marks, or none when asked', async ({ page }) => {
  const { StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([595, 842]);
  sheet.drawText('Invoice for Asha Verma', { x: 50, y: 780, size: 18, font });
  sheet.drawText('Card 4111 1111 1111 1111', { x: 50, y: 740, size: 18, font });
  // An old "redaction" that only covers the words, and text in white on white: neither shows on the page.
  sheet.drawText('Salary 98,000', { x: 50, y: 700, size: 18, font });
  sheet.drawRectangle({ x: 45, y: 694, width: 200, height: 26, color: rgb(0, 0, 0) });
  sheet.drawText('Invisible note', { x: 50, y: 660, size: 18, font, color: rgb(1, 1, 1) });
  sheet.drawText('X', { x: 50, y: 620, size: 18, font, color: rgb(1, 1, 1) });
  sheet.drawText('Paid by cheque 556677', { x: 50, y: 580, size: 18, font });
  sheet.drawRectangle({ x: 115, y: 574, width: 200, height: 26, color: rgb(0, 0, 0) });
  const file = { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };

  await page.goto('/redact-pdf/');
  await page.locator('#file-input').setInputFiles(file);
  await page.getByRole('button', { name: 'Find personal info' }).click();
  await expect(page.locator('.redact-count')).toHaveText('Personal details marked: 1. Check each one before saving.');
  await page.getByRole('button', { name: 'Save redacted PDF' }).click();
  const [text] = await pdfText((await downloadBytes(page)).bytes);
  expect(text).toBe('Invoice for Asha Verma');

  await page.getByLabel('Keep the rest of the text searchable').uncheck();
  await page.getByRole('button', { name: 'Save redacted PDF' }).click();
  expect(await pdfText((await downloadBytes(page)).bytes)).toEqual(['']);
});

test('scrolls the redact pages with a finger, and draws with one after “Draw boxes”', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/redact-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('rich-text'));
  const scroll = page.locator('.redact-scroll');
  await expect(page.locator('.redact-page').first().locator('canvas')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  // A swipe on the page scrolls (the pages or the whole site) and draws nothing.
  const scrolled = () => scroll.evaluate((el) => el.scrollTop + scrollY);
  const before = await scrolled();
  const area = (await scroll.boundingBox())!;
  const middle = { x: area.x + area.width / 2, y: area.y + area.height * 0.7 };
  await drag(middle, { x: middle.x, y: middle.y - 300 });
  await expect.poll(scrolled).toBeGreaterThan(before + 100);
  await expect(page.locator('.redact-box')).toHaveCount(0);

  // With "Draw boxes" on, the same finger drag marks an area.
  const draw = page.getByRole('button', { name: 'Draw boxes' });
  await draw.tap();
  await expect(draw).toHaveAttribute('aria-pressed', 'true');
  const sheet = (await page.locator('.redact-overlay').first().boundingBox())!;
  const visible = (await scroll.boundingBox())!;
  const start = { x: sheet.x + 40, y: Math.max(sheet.y, visible.y) + 20 };
  await drag(start, { x: start.x + 150, y: start.y + 60 });
  await expect(page.locator('.redact-count')).toHaveText('Marked areas: 1');
  await context.close();
});

test('finds and marks personal details in one click, and leaves amounts and dates alone', async ({ page }) => {
  const { StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = ['Contact asha@example.com or +91 98765 43210', 'Total 1,250.00 paid on 12-03-2024', 'PAN ABCDE1234F'];
  const pdfPage = doc.addPage([595, 842]);
  lines.forEach((text, i) => pdfPage.drawText(text, { x: 50, y: 780 - i * 40, size: 16, font }));
  await page.goto('/redact-pdf/');
  await page.locator('#file-input').setInputFiles({ name: 'details.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await page.getByRole('button', { name: 'Find personal info' }).click();
  await expect(page.locator('.redact-count')).toHaveText('Personal details marked: 3. Check each one before saving.');
  const marks = page.locator('.redact-page').first().locator('.redact-box');
  await expect(marks).toHaveCount(3);

  // The marks sit on the first and third lines, not on the amount and date line in between.
  const overlay = (await page.locator('.redact-overlay').first().boundingBox())!;
  const scale = overlay.width / 595;
  const lineTop = (i: number) => overlay.y + (842 - 780 + i * 40 - 16) * scale;
  for (const mark of await marks.all()) {
    const { y, height } = (await mark.boundingBox())!;
    const middle = y + height / 2;
    const onLine = [0, 2].some((i) => middle > lineTop(i) && middle < lineTop(i) + 24 * scale);
    expect(onLine, `mark at ${middle}`).toBe(true);
  }

  // The button stays on while its marks are there; a second click takes them off again.
  const personal = page.getByRole('button', { name: 'Find personal info' });
  await expect(personal).toHaveAttribute('aria-pressed', 'true');
  await personal.click();
  await expect(marks).toHaveCount(0);
  await expect(personal).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(marks).toHaveCount(3);
  await expect(personal).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(personal).toHaveAttribute('aria-pressed', 'false');
  // Found again, nothing is marked twice.
  await personal.click();
  await expect(page.locator('.redact-count')).toHaveText('Personal details marked: 3. Check each one before saving.');
  await expect(marks).toHaveCount(3);
});

test('transcribes speech on the device, with a one-time setup, and writes text and subtitles', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const seen = watch(page);
  await page.goto('/audio-to-text/');
  await expect(page.locator('.drop strong')).toHaveText('Choose an audio or video file');
  await expect(page.locator('.options')).toContainText('downloads the speech model (58 MB) once');
  await expect(page.locator('.options')).toContainText('Works best on clear English speech');
  await page.locator('#file-input').setInputFiles(file('speech.wav'));
  await page.locator('select[name="language"]').selectOption('english');
  await page.getByRole('button', { name: 'Transcribe' }).click();
  // The first run downloads the model once, and says so.
  await expect(page.locator('#status')).toContainText('one-time setup', { timeout: 30_000 });
  await expect(page.locator('#status')).toContainText('Done — TXT', { timeout: 150_000 });
  await expect(page.locator('.transcript-preview')).toContainText('ask not what your country can do for you');
  const text = await downloadBytes(page);
  expect(text.name).toBe('speech.txt');
  expect(text.bytes.toString()).toMatch(/fellow Americans/i);

  // The subtitle page starts on SRT, and the model now loads from the browser's cache: no setup.
  await page.goto('/subtitle-generator/');
  await expect(page.locator('select[name="format"]')).toHaveValue('srt');
  await page.locator('#file-input').setInputFiles(file('speech.wav'));
  const statuses: string[] = [];
  const timer = setInterval(async () => statuses.push(await page.locator('#status').innerText().catch(() => '')), 200);
  await page.getByRole('button', { name: 'Create subtitles' }).click();
  await expect(page.locator('#status')).toContainText('Done — SRT', { timeout: 120_000 });
  clearInterval(timer);
  expect(statuses.some((s) => s.includes('one-time setup'))).toBe(false);
  const srt = await downloadBytes(page);
  expect(srt.name).toBe('speech.srt');
  expect(srt.bytes.toString()).toMatch(/^1\n00:00:0\d,\d{3} --> 00:00:\d\d,\d{3}\n.*country/s);

  const origin = new URL(baseURL!).origin;
  for (const request of seen.requests) {
    if (request.url.startsWith('blob:') || request.url.startsWith('data:')) continue;
    expect(new URL(request.url).origin, request.url).toBe(origin);
    expect(request.body, request.url).toBeNull();
  }
  expect(seen.violations).toEqual([]);
});

test('says plainly when a file has no sound it can read', async ({ page }) => {
  await page.goto('/video-to-text/');
  await page.locator('#file-input').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
  await page.getByRole('button', { name: 'Transcribe video' }).click();
  await expect(page.locator('#status')).toContainText('can’t read the sound in this file');
});

test('trims, splits and merges audio without re-encoding, with a preview first', async ({ page }) => {
  const { parseAudio } = await import('../src/engine/audio');
  const seconds = (bytes: Buffer) => parseAudio(new Uint8Array(bytes)).duration;
  const seen = watch(page);

  await page.goto('/split-audio/');
  await page.locator('#file-input').setInputFiles(file('tone.mp3'));
  await expect(page.locator('#file-list')).toContainText('0:06');
  await page.getByLabel('Start', { exact: true }).fill('1');
  await page.getByLabel('Start', { exact: true }).press('Enter');
  await page.getByLabel('End', { exact: true }).fill('0:04.0');
  await page.getByLabel('End', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Save audio' }).click();
  await expect(page.locator('#status')).toContainText('1 file · 0:03');
  await expect(page.locator('#result audio')).toBeVisible();
  const trimmed = await downloadBytes(page);
  expect(trimmed.name).toBe('tone-trimmed.mp3');
  expect(seconds(trimmed.bytes)).toBeCloseTo(3, 1);

  await page.getByRole('tab', { name: 'Split into parts' }).click();
  await page.getByLabel('Equal parts').fill('3');
  await page.getByRole('button', { name: 'Apply' }).nth(1).click();
  await expect(page.locator('.au-part')).toHaveCount(3);
  await page.getByLabel('Keep: Part 2').uncheck();
  await page.getByRole('button', { name: 'Save audio' }).click();
  await expect(page.locator('#status')).toContainText('2 files · 0:04');
  await expect(page.locator('.au-result audio')).toHaveCount(2);
  expect((await downloadBytes(page)).name).toBe('tone-parts.zip');

  await page.goto('/merge-audio/');
  await page.locator('#file-input').setInputFiles([file('tone.m4a'), file('tone.m4a')]);
  await page.getByRole('button', { name: 'Merge audio' }).click();
  await expect(page.locator('#status')).toContainText('2 files · 0:12');
  await expect(page.locator('#result audio')).toBeVisible();
  const merged = await downloadBytes(page);
  expect(merged.name).toBe('tone-merged.m4a');
  expect(seconds(merged.bytes)).toBeCloseTo(12, 0);

  await page.goto('/merge-audio/');
  await page.locator('#file-input').setInputFiles([file('tone.mp3'), file('tone.m4a')]);
  await page.getByRole('button', { name: 'Merge audio' }).click();
  await expect(page.locator('#status')).toContainText('all MP3 or all M4A');
  expect(seen.violations).toEqual([]);
  expect(seen.requests.filter((r) => !/^(http:\/\/localhost[:/]|blob:|data:)/.test(r.url))).toEqual([]);
});

test('prepares Word and Markdown documents for Save as PDF without running their scripts', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/word-to-pdf/');
  await page.locator('#file-input').setInputFiles(file('rich.docx'));
  await page.getByRole('button', { name: 'Convert to PDF' }).click();
  await expect(page.locator('#status')).toContainText('Save as PDF');
  await expect(page.locator('#download')).toHaveText('Save as PDF');
  expect(await page.locator('.print-frame').getAttribute('srcdoc')).toContain('<table');

  await page.goto('/markdown-to-pdf/');
  await page.locator('#file-input').setInputFiles(file('notes.md'));
  await page.getByRole('button', { name: 'Create PDF' }).click();
  const frame = page.frameLocator('.print-frame');
  await expect(frame.locator('h1')).toHaveText('Notes');
  await expect(frame.locator('strong')).toHaveText('bold');
  await expect(frame.locator('script')).toHaveCount(0);
  expect(seen.violations).toEqual([]);
});

test('converts between Excel and CSV', async ({ page }) => {
  await page.goto('/csv-to-excel/');
  await page.locator('#file-input').setInputFiles(file('data.csv'));
  await page.getByRole('button', { name: 'Convert to Excel' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const xlsx = await downloadBytes(page);
  expect(xlsx.name).toBe('data.xlsx');

  await page.goto('/excel-to-csv/');
  await page.locator('#file-input').setInputFiles({ name: 'data.xlsx', mimeType: '', buffer: xlsx.bytes });
  await page.getByRole('button', { name: 'Convert to CSV' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const csv = await downloadBytes(page);
  expect(csv.name).toBe('data.csv');
  expect(csv.bytes.toString('utf8')).toContain('007,"Smith, Jane",12.5');
});

test('converts JSON to Excel and back, and points at broken JSON', async ({ page, baseURL }) => {
  const seen = watch(page);
  const records = [{ id: 1, name: 'Asha', address: { city: 'Pune' } }, { id: 2, name: 'Ben', active: true }];
  await page.goto('/json-to-excel/');
  await page.locator('#file-input').setInputFiles({ name: 'people.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(records)) });
  await page.getByRole('button', { name: 'Convert to Excel' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const xlsx = await downloadBytes(page);
  expect(xlsx.name).toBe('people.xlsx');

  await page.goto('/excel-to-json/');
  await expect(page.getByLabel('The first row has the column names')).toBeChecked();
  await page.locator('#file-input').setInputFiles({ name: 'people.xlsx', mimeType: '', buffer: xlsx.bytes });
  await page.getByRole('button', { name: 'Convert to JSON' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const json = await downloadBytes(page);
  expect(json.name).toBe('people.json');
  expect(JSON.parse(json.bytes.toString('utf8'))).toEqual([
    { id: 1, name: 'Asha', 'address.city': 'Pune', active: null },
    { id: 2, name: 'Ben', 'address.city': null, active: true },
  ]);

  await page.goto('/json-to-excel/');
  await page.locator('#file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('[\n  {"a": 1},\n  {"b": 2,}\n]') });
  await page.getByRole('button', { name: 'Convert to Excel' }).click();
  await expect(page.locator('#status')).toContainText('line 3');
  expect(seen.violations).toEqual([]);
  expect(seen.requests.filter((r) => !r.url.startsWith(baseURL!) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'))).toEqual([]);
});

test('draws Mermaid code as a PNG or SVG on the device, with a preview and plain errors', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/mermaid-to-image/');
  // The sample diagram means the page works before anything is chosen.
  await expect(page.getByRole('button', { name: 'Create image' })).toBeEnabled();
  await page.locator('textarea[name="code"]').fill('sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi');
  await page.getByRole('button', { name: 'Create image' }).click();
  await expect(page.locator('#status')).toContainText('Done — PNG');
  await expect(page.locator('.image-preview')).toBeVisible();
  const png = await downloadBytes(page);
  expect(png.name).toBe('diagram.png');
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
  const width = png.bytes.readUInt32BE(16);
  expect(width).toBeGreaterThan(400); // 2× by default

  await page.locator('select[name="format"]').selectOption('svg');
  await page.locator('input[name="transparent"]').check();
  await page.getByRole('button', { name: 'Create image' }).click();
  await expect(page.locator('#status')).toContainText('Done — SVG');
  const svg = (await downloadBytes(page)).bytes.toString('utf8');
  const root = /^<svg[^>]*>/.exec(svg)![0];
  expect(root).toMatch(/ width="\d+"/);
  expect(root).toMatch(/ height="\d+"/);
  expect(svg).toContain('Alice');
  expect(svg).not.toContain('<script');

  await page.locator('textarea[name="code"]').fill('flowchart TD\n  A -->');
  await page.getByRole('button', { name: 'Create image' }).click();
  await expect(page.locator('#status')).toContainText('The diagram code has a mistake: Parse error on line');
  await page.locator('textarea[name="code"]').fill('');
  await expect(page.getByRole('button', { name: 'Create image' })).toBeDisabled();

  // A .mmd file works too.
  await page.locator('#file-input').setInputFiles({ name: 'plan.mmd', mimeType: 'text/plain', buffer: Buffer.from('pie title Pets\n "Dogs" : 3\n "Cats" : 2') });
  await page.locator('select[name="format"]').selectOption('png');
  await page.getByRole('button', { name: 'Create image' }).click();
  await expect(page.locator('#status')).toContainText('Done — PNG');
  expect((await downloadBytes(page)).name).toBe('plan.png');
  expect(seen.violations).toEqual([]);
  expect(seen.requests.filter((r) => !r.url.startsWith(baseURL!) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'))).toEqual([]);
});

test('Mermaid pages preselect their format and load examples with one click', async ({ page }) => {
  await page.goto('/mermaid-to-svg/');
  await expect(page.locator('select[name="format"]')).toHaveValue('svg');
  await expect(page.locator('.example')).toHaveCount(6);
  await page.locator('.example', { hasText: 'sequenceDiagram' }).getByRole('button', { name: 'Try this example' }).click();
  await expect(page.locator('textarea[name="code"]')).toHaveValue(/^sequenceDiagram/);
  await page.getByRole('button', { name: 'Create SVG' }).click();
  await expect(page.locator('#status')).toContainText('Done — SVG');
  expect((await downloadBytes(page)).name).toBe('diagram.svg');

  await page.goto('/mermaid-to-png/');
  await expect(page.locator('select[name="format"]')).toHaveValue('png');
  await page.goto('/excel-to-json/');
  await expect(page.locator('.example-table')).toContainText('Asha');
  await expect(page.locator('.example-pair pre')).toContainText('"Member": true');
});

test('edits PDF text in place and saves on the device', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/edit-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  const viewer = page.locator('#viewer');
  const undo = page.getByRole('button', { name: 'Undo' });
  // Undo while still typing reverts that edit, so only the next one is saved.
  await viewer.locator('.edit-hitbox').nth(1).click();
  await page.keyboard.type('Oops');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await viewer.locator('.edit-hitbox').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Replaced text');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save PDF' }).click();
  await expect(page.locator('#status')).toContainText('1 edit');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('text-only-edited.pdf');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  // The line itself was rewritten in the file, not covered up.
  expect((await pdfText(bytes))[0]).toContain('Replaced text');
  const origin = new URL(baseURL!).origin;
  for (const request of seen.requests) if (!request.url.startsWith('blob:')) expect(new URL(request.url).origin).toBe(origin);
  expect(seen.violations).toEqual([]);
});

test('fits the PDF editor page to a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/edit-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('chrome-text'));
  const scroll = page.locator('.edit-scroll');
  const sheet = page.locator('.edit-page').first();
  await expect(sheet.locator('canvas')).toBeVisible();
  const [box, area] = [await sheet.boundingBox(), await scroll.boundingBox()];
  // The whole page width is on screen, from its left edge.
  expect(box!.x).toBeGreaterThanOrEqual(area!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(area!.x + area!.width);
  // Zoomed in, the left edge can still be scrolled to.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await scroll.evaluate((el) => (el.scrollLeft = 0));
  const zoomed = await sheet.boundingBox();
  expect(zoomed!.x).toBeGreaterThanOrEqual((await scroll.boundingBox())!.x);
});

test('keeps the PDF’s own font when the edited line can be rewritten in place', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/edit-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('chrome-text'));
  await page.getByRole('button', { name: 'Edit text: Billed to: Asha Verma, Pune' }).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Billed to: Pune Verma, Asha');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save PDF' }).click();
  await expect(page.locator('#status')).toContainText('1 edit');
  const { bytes } = await downloadBytes(page);
  const [text] = await pdfText(bytes);
  expect(text).toContain('Billed to: Pune Verma, Asha');
  expect(text).not.toContain('Asha Verma, Pune');
  expect(text).toContain('Thank you for your business.');
  expect(seen.violations).toEqual([]);
});

/** A PNG of printed English text, drawn by the browser: a stand-in for a photo or scan. */
async function textImage(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 220;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = '64px Arial, sans-serif';
    context.fillText('Private invoice total', 40, 130);
    return canvas.toDataURL('image/png');
  });
  return { name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

test('recognizes text in an image and lets you select it on the picture', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const seen = watch(page);
  await page.goto('/image-to-text/');
  await page.locator('#file-input').setInputFiles(await textImage(page));
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await expect(page.locator('#status')).toContainText('recognized', { timeout: 90_000 });
  await expect(page.locator('#viewer')).toContainText('invoice');
  // The overlay must match the picture's shape (900 × 220), and each word box must sit on its word.
  expect(await page.locator('.ocr-frame').evaluate((el) => (el as HTMLElement).style.aspectRatio)).toBe('900 / 220');
  const word = await page.locator('.ocr-word').first().boundingBox();
  const frame = await page.locator('.ocr-frame').boundingBox();
  expect(word!.x - frame!.x).toBeGreaterThan(10);
  expect(word!.width).toBeGreaterThan(20);
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('scan.txt');
  expect(bytes.toString()).toMatch(/Private invoice total/i);
  // Clear English text: no warning that the result may be wrong.
  await expect(page.locator('#warnings li')).toHaveCount(0);

  // A photo without readable text gets a note saying the result may be wrong, and why.
  await page.locator('#file-input').setInputFiles(file('photo.png'));
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await expect(page.locator('#status')).toContainText('recognized', { timeout: 90_000 });
  await expect(page.locator('#warnings')).toContainText('Some of this text may be wrong');
  const origin = new URL(baseURL!).origin;
  for (const request of seen.requests) if (!request.url.startsWith('blob:')) expect(new URL(request.url).origin).toBe(origin);
  expect(seen.violations).toEqual([]);
});

test('makes a scanned PDF searchable', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/jpg-to-pdf/');
  await page.locator('#file-input').setInputFiles(await textImage(page));
  await page.getByRole('button', { name: 'Create PDF' }).click();
  const scanned = await downloadBytes(page);

  await page.goto('/ocr-pdf/');
  await page.locator('#file-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanned.bytes });
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await expect(page.locator('#status')).toContainText('1 recognized', { timeout: 90_000 });
  const ocr = await downloadBytes(page);
  expect(ocr.name).toBe('scan-ocr.pdf');

  await page.goto('/pdf-to-text/');
  await page.locator('#file-input').setInputFiles({ name: 'scan-ocr.pdf', mimeType: 'application/pdf', buffer: ocr.bytes });
  await page.getByRole('button', { name: 'Extract text' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  expect((await downloadBytes(page)).bytes.toString()).toMatch(/invoice/i);
});

test('numbers and watermarks PDF pages, and converts between image formats', async ({ page }) => {
  await page.goto('/add-page-numbers-to-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await page.locator('select[name="style"]').selectOption('page-of');
  await page.getByRole('button', { name: 'Add page numbers' }).click();
  await expect(page.locator('#status')).toContainText('3 pages numbered');
  expect((await downloadBytes(page)).name).toBe('mixed-numbered.pdf');

  await page.goto('/watermark-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await page.locator('input[name="text"]').fill('DRAFT');
  await page.getByRole('button', { name: 'Add watermark' }).click();
  await expect(page.locator('#status')).toContainText('3 pages watermarked');

  // Any script works: text the standard PDF fonts can't show is drawn by the browser, never dropped.
  await page.locator('input[name="text"]').fill('गोपनीय CONFIDENTIAL');
  await page.getByRole('button', { name: 'Add watermark' }).click();
  await expect(page.locator('#status')).toContainText('3 pages watermarked');
  const stamped = await PDFDocument.load((await downloadBytes(page)).bytes);
  for (const p of stamped.getPages()) expect(p.node.Resources()!.lookup(PDFName.of('XObject'))).toBeTruthy();

  await page.goto('/pdf-to-png/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  await page.getByRole('button', { name: 'Convert to PNG' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  expect((await downloadBytes(page)).name).toMatch(/\.(png|zip)$/);
  
  // The resolution select sets the image size: a 400 pt wide page is 400 px at 72 DPI, 834 at 150 and 1667 at 300.
  for (const [dpi, width] of [['72', 400], ['150', 834], ['300', 1667]] as const) {
    await page.goto('/pdf-to-png/');
    await expect(page.locator('select[name="dpi"]')).toHaveValue('150');
    await page.locator('#file-input').setInputFiles(fixture('blank'));
    await page.locator('select[name="dpi"]').selectOption(dpi);
    await page.getByRole('button', { name: 'Convert to PNG' }).click();
    await expect(page.locator('#status')).toContainText('Done — 1 image');
    const png = await downloadBytes(page);
    expect(png.name).toBe('blank.png');
    expect(png.bytes.readUInt32BE(16)).toBe(width);
  }

  await page.goto('/png-to-jpg/');
  await expect(page.locator('select[name="format"]')).toHaveCount(0);
  await page.locator('#file-input').setInputFiles(file('photo.png'));
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  expect((await downloadBytes(page)).name).toMatch(/\.jpg$/);
});

test('asks for a GitHub star at the top, the bottom and after a download', async ({ page }) => {
  await page.goto('/');
  for (const star of [page.locator('.star-btn'), page.locator('.star-hero'), page.locator('.star-big')]) {
    await expect(star).toHaveAttribute('href', SITE.repo);
    await expect(star).toHaveAttribute('target', '_blank');
  }
  await page.goto('/merge-pdf/');
  await expect(page.locator('.star-nudge a')).toHaveAttribute('href', SITE.repo);
});

test('serves every language with hreflang links, a language menu and a one-time tip', async ({ page, request }) => {
  const other = SITE_LANGS.find((lang) => lang !== 'en');
  test.skip(!other, 'no translations yet');
  const html = await (await request.get(`/${other}/merge-pdf/`)).text();
  expect(html).toContain(`<html lang="${other}">`);
  expect(html).toContain(`<link rel="alternate" hreflang="en" href="${SITE.url}/merge-pdf/">`);
  expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE.url}/merge-pdf/">`);
  expect(html).toContain('id="ui-strings"');

  await page.goto('/merge-pdf/');
  await expect(page.locator('#lang-tip')).toBeVisible();
  await page.locator('#lang-select').selectOption(`/${other}/merge-pdf/`);
  await expect(page).toHaveURL(new RegExp(`/${other}/merge-pdf/$`));
  await expect(page.locator('html')).toHaveAttribute('lang', other!);
  await expect(page.locator('#lang-tip')).toBeHidden(); // shown once only
  await expect(page.locator('.crumbs a').first()).toHaveAttribute('href', `/${other}/`);
});

test('remembers the chosen theme across pages', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/merge-pdf/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('dragged cards spring back and do not open their link', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.tool-card').first();
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
  expect(await card.evaluate((el) => el.style.transform)).toContain('translate');
  await page.mouse.up();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => card.evaluate((el) => el.style.transform)).toBe('');
});

test('reorders merge files by dragging', async ({ page }) => {
  await page.goto('/merge-pdf/');
  await page.locator('#file-input').setInputFiles([fixture('form'), fixture('bookmarks'), fixture('links')]);
  await page.locator('#file-list li').nth(2).dragTo(page.locator('#file-list li').nth(0));
  await expect(page.locator('#file-list .file-name')).toHaveText(['links.pdf', 'form.pdf', 'bookmarks.pdf']);
});

test('ripples on background clicks only', async ({ page }) => {
  await page.goto('/');
  await page.mouse.click(8, 400);
  await expect(page.locator('.tap-ripple')).toHaveCount(1);
  await expect(page.locator('.tap-ripple')).toHaveCount(0);
});

for (const { path, tool } of PAGES) {
  test(`serves search-ready HTML at ${path}`, async ({ request }) => {
    const html = await (await request.get(path)).text();
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toMatch(/<title>[^<]{20,70}<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]{80,160}">/);
    expect(html).toContain(`<link rel="canonical" href="${SITE.url}${path}">`);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toContain('FAQPage');
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="${SITE.url}/og(/[a-z]{2})?\\.png">`));
    if (tool) expect(html).toContain(`data-tool="${tool.op}"`);
  });
}

test('answers unknown links with a not-found page that search engines skip', async ({ request }) => {
  const html = await (await request.get('/404.html')).text();
  expect(html).toContain('<h1>Page not found</h1>');
  expect(html).toContain('<meta name="robots" content="noindex, follow">');
  expect(html).not.toContain('rel="canonical"');
  expect(html).toContain('href="/merge-pdf/"');
});

test('explains extra dropped files, lets any job be canceled and keeps qpdf chatter out of the console', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (m) => m.type() === 'error' && logged.push(m.text()));
  await page.goto('/compress-pdf/');
  const drop = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    for (const name of ['a.pdf', 'b.pdf']) data.items.add(new File(['%PDF-1.4'], name, { type: 'application/pdf' }));
    return data;
  });
  await page.locator('#drop').dispatchEvent('drop', { dataTransfer: drop });
  await expect(page.locator('#status')).toHaveText('This tool works on one file at a time, so the first file was added.');
  await expect(page.locator('#file-list li')).toHaveCount(1);

  await page.goto('/ocr-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('blank'));
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#status')).toContainText('Canceled');
  await expect(page.getByRole('button', { name: 'Recognize text' })).toBeEnabled();

  await page.goto('/unlock-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();
  await page.locator('#password').fill('wrong');
  await page.keyboard.press('Enter');
  await expect(page.locator('#password-hint')).toContainText('2');
  expect(logged.filter((line) => line.includes('this.program'))).toEqual([]);
});

test('finds a tool from the home page search without anything leaving the page', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search tools' });
  const results = page.locator('#tool-results');
  await search.fill('pdf to word');
  await expect(results.getByRole('option').first()).toHaveText('PDF to Word');
  await search.press('ArrowDown');
  await expect(results.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowUp');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/pdf-to-word\/$/);

  await page.goto('/hi/');
  await page.locator('#tool-search').fill('ऑडियो');
  // Only audio tools come up, under their Hindi names.
  const hindi = JSON.parse(readFileSync(new URL('../src/i18n/hi.json', import.meta.url), 'utf8')) as { tools: Record<string, { name: string }> };
  const audioNames = TOOLS.filter((tool) => tool.format === 'audio').map((tool) => hindi.tools[tool.slug].name);
  await expect(results.getByRole('option').first()).toBeVisible();
  const found = await results.getByRole('option').allInnerTexts();
  expect(found.length).toBeGreaterThanOrEqual(2);
  for (const name of found) expect(audioNames, name).toContain(name.trim());
  await page.locator('#tool-search').fill('zzqx');
  await expect(results).toBeHidden();
  await expect(page.locator('#tool-search-status')).toBeVisible();
  await page.locator('#tool-search').press('Escape');
  await expect(page.locator('#tool-search')).toHaveValue('');

  // The format chips jump to their group.
  await page.goto('/');
  await page.locator('.formats-row a[href="#audio"]').click();
  await expect(page).toHaveURL(/#audio$/);
  await expect(page.locator('#audio')).toBeInViewport();
  expect(seen.violations).toEqual([]);
  expect(seen.requests.filter((r) => !r.url.startsWith(baseURL!) && !r.url.startsWith('data:'))).toEqual([]);
});

test('wraps long file names instead of widening the page on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/merge-audio/');
  const long = 'Krish Theme Krishna Theme Shri Krishna Govinda Hare Murari Soulful Flute Cover by Kiran (Official Audio)';
  const mp3 = readFileSync(file('tone.mp3'));
  await page.locator('#file-input').setInputFiles([
    { name: `${long} part 1.mp3`, mimeType: 'audio/mpeg', buffer: mp3 },
    { name: `${long} part 2.mp3`, mimeType: 'audio/mpeg', buffer: mp3 },
  ]);
  await expect(page.locator('#file-list .file-name')).toHaveText([`${long} part 1.mp3`, `${long} part 2.mp3`]);
  // The list is drawn again once each track's length is read; measure after that.
  await expect(page.locator('#file-list li').first()).toContainText(/\d+:\d\d/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const row = await page.locator('#file-list li').first().boundingBox();
  expect(row!.x + row!.width).toBeLessThanOrEqual(390);
});

test('publishes sitemap, robots.txt and llms.txt', async ({ request }) => {
  const licenses = await (await request.get('/third-party-licenses.txt')).text();
  for (const part of ['Apache License', 'pdf-lib (MIT)', 'fflate (MIT)', 'Independent JPEG Group', 'Open Font License']) expect(licenses).toContain(part);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const { path } of PAGES) expect(sitemap).toContain(`<loc>${SITE.url}${path}</loc>`);
  expect(await (await request.get('/robots.txt')).text()).toContain(`Sitemap: ${SITE.url}/sitemap.xml`);
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toContain('## Tools');
  // The "why" section sits right after the summary, and states the real tool and language counts.
  expect(llms.indexOf('## Why Fizzdoc')).toBeLessThan(llms.indexOf('## Tools'));
  expect(llms).toContain(`${TOOLS.length} tools for PDF, Word, Excel, PowerPoint, images, audio, JSON and Mermaid`);
  expect(llms).toContain(`In ${SITE_LANGS.length} languages`);
  expect(await (await request.get('/llms-full.txt')).text()).toContain('## Watermark PDF');
  expect(await (await request.get('/robots.txt')).text()).toContain('User-agent: *\nAllow: /');
  expect((await request.get('/og.png')).headers()['content-type']).toBe('image/png');
});

test('removes a picture’s background on the device, keeps its full size, and puts a new one behind', async ({ page }) => {
  test.setTimeout(240_000);
  const seen = watch(page);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no smooth scrolling while the test measures
  await page.goto('/remove-background/');
  // A plain subject on a soft background, drawn here so the test needs no photo fixture.
  const photo = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(900, 600);
    const c = canvas.getContext('2d')!;
    const sky = c.createLinearGradient(0, 0, 0, 600);
    sky.addColorStop(0, '#dfe9f3');
    sky.addColorStop(1, '#f7f2e8');
    c.fillStyle = sky;
    c.fillRect(0, 0, 900, 600);
    c.fillStyle = '#c0392b';
    c.beginPath();
    c.arc(450, 300, 170, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2c3e50';
    c.fillRect(420, 120, 60, 80);
    return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())];
  });
  await page.locator('#file-input').setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await expect(page.getByRole('button', { name: 'Blur' })).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('.bg-busy')).toBeHidden();

  /** Alpha (or red, for JPG) at a few points of a downloaded picture, read back by the browser. */
  const sample = async (bytes: Buffer, type: string) =>
    page.evaluate(
      async ([data, mime]) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data as number[])], { type: mime as string }));
        const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        c.drawImage(bitmap, 0, 0);
        const at = (fx: number, fy: number) => [...c.getImageData(Math.floor(bitmap.width * fx), Math.floor(bitmap.height * fy), 1, 1).data];
        return { width: bitmap.width, height: bitmap.height, corner: at(0.02, 0.02), centre: at(0.5, 0.5) };
      },
      [[...bytes], type],
    );

  // No background: a transparent PNG at the original size.
  await page.getByRole('button', { name: 'Download image' }).click();
  await expect(page.locator('#status')).toContainText('900 × 600 px');
  const clear = await downloadBytes(page);
  expect(clear.name).toBe('ball-no-bg.png');
  const png = await sample(clear.bytes, 'image/png');
  expect([png.width, png.height]).toEqual([900, 600]);
  expect(png.corner[3]).toBeLessThan(20);
  expect(png.centre).toEqual([192, 57, 43, 255]);

  // White behind, saved smaller: a JPG with white corners.
  await page.getByRole('button', { name: 'White' }).click();
  await page.getByRole('combobox', { name: 'Size' }).selectOption('600');
  await page.getByRole('button', { name: 'Download image' }).click();
  await expect(page.locator('#status')).toContainText('600 × 400 px');
  const white = await downloadBytes(page);
  expect(white.name).toBe('ball-new-bg.jpg');
  const jpg = await sample(white.bytes, 'image/jpeg');
  expect([jpg.width, jpg.height]).toEqual([600, 400]);
  for (const v of jpg.corner.slice(0, 3)) expect(v).toBeGreaterThan(245);

  // Touch up: erasing the middle makes it see-through, and Undo brings it back.
  await page.getByRole('button', { name: 'None' }).click();
  await page.getByRole('combobox', { name: 'Size' }).selectOption('900');
  await page.getByRole('button', { name: 'Erase' }).click();
  // The picture scrolls into view for the brush.
  await expect(page.locator('.bg-canvas')).toBeInViewport();
  const box = (await page.locator('.bg-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Download image' }).click();
  await expect(page.locator('#status')).toContainText('900 × 600 px');
  expect((await sample((await downloadBytes(page)).bytes, 'image/png')).centre[3]).toBeLessThan(20);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Download image' }).click();
  await expect(page.locator('#status')).toContainText('900 × 600 px');
  expect((await sample((await downloadBytes(page)).bytes, 'image/png')).centre[3]).toBe(255);

  expect(seen.violations).toEqual([]);
  expect(seen.requests.filter((r) => !r.url.startsWith(page.url().split('/').slice(0, 3).join('/')) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'))).toEqual([]);
});

test('phones use the small background model, so the big one never loads and the tab stays alive', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  for (const phone of [true, false]) {
    // A phone, and a laptop where the big model crashed the tab once before.
    const context = await browser.newContext(phone ? { ...devices['Pixel 7'], baseURL } : { baseURL });
    if (!phone) await context.addInitScript(() => localStorage.setItem('fizzdoc-bg-crashed', String(Date.now())));
    const page = await context.newPage();
    const fetched: string[] = [];
    page.on('request', (request) => fetched.push(new URL(request.url()).pathname));
    await page.goto('/remove-background/');
    const photo = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(600, 400);
      const c = canvas.getContext('2d')!;
      c.fillStyle = '#e8eef5';
      c.fillRect(0, 0, 600, 400);
      c.fillStyle = '#c0392b';
      c.beginPath();
      c.arc(300, 200, 110, 0, Math.PI * 2);
      c.fill();
      return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())];
    });
    await page.locator('#file-input').setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
    await expect(page.locator('.bg-note')).toContainText('lighter model', { timeout: 200_000 });
    expect(fetched.some((path) => path.startsWith('/bg/u2netp/'))).toBe(true);
    expect(fetched.filter((path) => path.startsWith('/bg/birefnet') || path.startsWith('/bg/ort/'))).toEqual([]);
    await page.getByRole('button', { name: 'Download image' }).click();
    await expect(page.locator('#status')).toContainText('600 × 400 px');
    await context.close();
  }
});

test('shares Fizzdoc: the phone’s share sheet, or links to the big networks and a copy button', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto('/merge-pdf/');
  await page.getByRole('button', { name: 'Share Fizzdoc' }).click();
  const menu = page.locator('#share-pop');
  await expect(menu).toBeVisible();
  const whatsapp = menu.getByRole('link', { name: 'Share on WhatsApp' });
  await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=Merge%20PDF.*fizzdoc\.com%2Fmerge-pdf%2F$/);
  await expect(menu.getByRole('link', { name: 'Share on LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Ffizzdoc.com%2Fmerge-pdf%2F');
  await menu.getByRole('button', { name: 'Copy link' }).click();
  await expect(menu.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://fizzdoc.com/merge-pdf/');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // The same links sit under the star call-out on every page.
  await expect(page.locator('.share-cta .share-link')).toHaveCount(8);
  await context.close();

  // On a phone the system share sheet opens instead of the menu.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mobile = await phone.newPage();
  await mobile.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => ((window as unknown as { shared: ShareData }).shared = data) });
  });
  await mobile.goto('/hi/');
  await mobile.locator('#share-btn').tap();
  expect(await mobile.evaluate(() => (window as unknown as { shared: ShareData }).shared.url)).toBe('https://fizzdoc.com/hi/');
  await expect(mobile.locator('#share-pop')).toBeHidden();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await phone.close();
});
