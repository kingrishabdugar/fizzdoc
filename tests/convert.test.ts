import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { csvToXlsx, jsonToXlsx, pdfToText, textToHtml, xlsxToCsv, xlsxToJson } from '../src/engine/convert';
import type { LocalError } from '../src/engine/local';

const file = (name: string, type = '') =>
  new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type });
const textFile = (name: string, content: string) => new File([content], name, { type: 'text/plain' });
const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe('pdfToText', () => {
  // The first pdf.js test also pays for loading pdf.js, which can pass 5 s on a busy machine.
  it('reconstructs reading order, headings, paragraphs, lists and page breaks (txt)', async () => {
    const result = await pdfToText(file('rich-text.pdf'), { format: 'txt' });
    expect(result.name).toBe('rich-text.txt');
    expect(result.blob.type).toContain('text/plain');
    const text = await result.blob.text();
    expect(text).toContain('Annual Report');
    // wrapped, hyphenated line is joined back into one word and one paragraph
    expect(text).toContain('test reading order reconstruction and hyphen joining logic.');
    expect(text).not.toContain('rea-');
    // a real paragraph gap produces a blank line between paragraphs
    expect(text).toMatch(/logic\.\n\nSecond paragraph/);
    expect(text).toContain('First item');
    expect(text).toContain('Page two content.');
    expect(result.summary).toMatch(/^2 pages · \d+ words$/);
  }, 30_000);

  it('marks headings and list items in markdown, and separates pages with a rule', async () => {
    const result = await pdfToText(file('rich-text.pdf'), { format: 'md' });
    expect(result.name).toBe('rich-text.md');
    expect(result.blob.type).toContain('text/markdown');
    const text = await result.blob.text();
    expect(text).toContain('# Annual Report');
    expect(text).toContain('## Section One');
    expect(text).toContain('- First item');
    expect(text).toContain('- Second item');
    expect(text).toContain('\n\n---\n\n');
  });

  it('rejects a password-protected PDF', async () => {
    await expect(pdfToText(file('user-password.pdf'), { format: 'txt' })).rejects.toThrow('PDF_PASSWORD');
  });

  it('rejects a PDF with no extractable text', async () => {
    await expect(pdfToText(file('blank.pdf'), { format: 'txt' })).rejects.toThrow('NO_TEXT');
  });
});

describe('textToHtml', () => {
  it('turns a .txt file into a self-contained HTML document', async () => {
    const { html, title } = await textToHtml(textFile('notes.txt', 'First paragraph.\nStill first.\n\nSecond paragraph.'));
    expect(title).toBe('notes');
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('<script');
    expect(html).toContain('@page { size: A4; margin: 18mm; }');
    expect(html).toContain('First paragraph.<br>Still first.');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('escapes HTML found inside plain text', async () => {
    const { html } = await textToHtml(textFile('notes.txt', 'Use <b>tags</b> & "quotes" carefully.'));
    expect(html).toContain('&lt;b&gt;tags&lt;/b&gt;');
    expect(html).not.toContain('<b>tags</b>');
  });

  it('renders markdown headings, lists, tables, quotes and code', async () => {
    const md = [
      '# Title',
      '',
      'A paragraph with **bold**, *italic* and `code`.',
      '',
      '- one',
      '- two',
      '  - nested',
      '',
      '> a quote',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n');
    const { html } = await textToHtml(textFile('doc.md', md));
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html.replace(/\n/g, '')).toContain('<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre><code class="language-js">const x = 1;</code></pre>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('shows an image’s description instead of a stray “!” and link', async () => {
    const { html } = await textToHtml(textFile('doc.md', 'See ![A diagram](https://example.com/d.png) and [docs](https://example.com).'));
    expect(html).toContain('See <em>[A diagram]</em> and <a href="https://example.com">docs</a>.');
    expect(html).not.toContain('<img');
  });

  it('never lets markdown carry raw HTML or unsafe link schemes through', async () => {
    const md = [
      '<script>alert(1)</script>',
      '',
      '[click me](javascript:alert(1))',
      '',
      '[safe](https://example.com)',
      '',
      '<img src=x onerror=alert(1)>',
    ].join('\n');
    const { html } = await textToHtml(textFile('evil.md', md));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click me'); // link text kept, just not as a link
    expect(html).toContain('<a href="https://example.com">safe</a>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;'); // inert escaped text, not a real tag
  });
});

describe('xlsxToCsv', () => {
  it('rejects a non-Office file', async () => {
    await expect(xlsxToCsv(file('photo.png'))).rejects.toThrow('NOT_OFFICE');
  });

  it('converts the plain single-sheet fixture', async () => {
    const result = await xlsxToCsv(file('sheet.xlsx'));
    expect(result.name).toBe('sheet.csv');
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM, so Excel opens it correctly
    const text = await result.blob.text();
    expect(text).toContain('Revenue,1234');
    expect(result.summary).toBe('1 sheet · 1 row');
  });

  it('reads shared strings, numbers, dates, booleans and fills gaps, and zips multiple sheets', async () => {
    const result = await xlsxToCsv(file('rich.xlsx'));
    expect(result.name).toBe('rich-sheets.zip');
    expect(result.blob.type).toBe('application/zip');
    const entries = await unzip(result.blob);
    expect(Object.keys(entries).sort()).toEqual(['Data.csv', 'Notes.csv']);
    const data = strFromU8(entries['Data.csv']).replace(/^﻿/, '');
    const rows = data.trim().split('\r\n');
    // the grid is padded to the sheet's widest row (D4), so every row has 4 columns
    expect(rows[0]).toBe('Name,Amount,Date,');
    expect(rows[1]).toBe('Alice,100,2021-01-01,');
    expect(rows[2]).toBe(',,,'); // the skipped row comes back blank
    expect(rows[3]).toBe('Bob,,,TRUE'); // skipped column stays blank, boolean renders as TRUE
    const notes = strFromU8(entries['Notes.csv']).replace(/^﻿/, '');
    expect(notes.trim()).toBe('Just a note');
    expect(result.summary).toBe('2 sheets · 5 rows');
  });
});

describe('csvToXlsx', () => {
  it('produces a workbook that reads back to the same grid', async () => {
    const csv = 'Name,Amount,Joined\r\n"Alice, A.",100,2021-01-01\r\n"Quote ""here""",007,"multi\nline"\r\n';
    const xlsx = await csvToXlsx(new File([csv], 'people.csv', { type: 'text/csv' }));
    expect(xlsx.name).toBe('people.xlsx');
    const back = await xlsxToCsv(new File([await xlsx.blob.arrayBuffer()], 'people.xlsx'));
    const text = (await back.blob.text()).replace(/^﻿/, '');
    const rows = text.trim().split('\r\n');
    expect(rows[0]).toBe('Name,Amount,Joined');
    expect(rows[1]).toBe('"Alice, A.",100,2021-01-01'); // 100 round-trips as a number
    expect(rows[2]).toBe('"Quote ""here""",007,"multi\nline"'); // 007 stays text, not 7
  });

  it('detects semicolon and tab delimiters', async () => {
    const semi = await csvToXlsx(new File(['a;b;c\r\n1;2;3\r\n'], 'semi.csv'));
    const backSemi = await xlsxToCsv(new File([await semi.blob.arrayBuffer()], 'semi.xlsx'));
    expect((await backSemi.blob.text()).replace(/^﻿/, '').trim()).toBe('a,b,c\r\n1,2,3');

    const tab = await csvToXlsx(new File(['a\tb\tc\r\n1\t2\t3\r\n'], 'tab.csv'));
    const backTab = await xlsxToCsv(new File([await tab.blob.arrayBuffer()], 'tab.xlsx'));
    expect((await backTab.blob.text()).replace(/^﻿/, '').trim()).toBe('a,b,c\r\n1,2,3');
  });

  it('names the sheet after the file and sanitizes it to 31 chars with no reserved characters', async () => {
    const longName = 'a'.repeat(40) + '[bad]:name*?/\\';
    const xlsx = await csvToXlsx(new File(['a,b\r\n1,2\r\n'], `${longName}.csv`));
    const entries = unzipSync(new Uint8Array(await xlsx.blob.arrayBuffer()));
    const workbookXml = strFromU8(entries['xl/workbook.xml']);
    const name = /<sheet name="([^"]*)"/.exec(workbookXml)?.[1] ?? '';
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[[\]:*?/\\]/);
  });

  it('round-trips the real sheet.xlsx fixture through xlsxToCsv and back', async () => {
    const csvOut = await xlsxToCsv(file('sheet.xlsx'));
    const csvText = await csvOut.blob.text();
    const xlsx = await csvToXlsx(new File([csvText], 'sheet.csv'));
    const back = await xlsxToCsv(new File([await xlsx.blob.arrayBuffer()], 'sheet.xlsx'));
    expect((await back.blob.text()).replace(/^﻿/, '').trim()).toBe(csvText.replace(/^﻿/, '').trim());
  });
});

describe('xlsxToJson', () => {
  const json = async (result: { blob: Blob }) => JSON.parse(await result.blob.text());

  it('turns rows into typed objects keyed by the header row, one key per sheet', async () => {
    const result = await xlsxToJson(file('rich.xlsx'));
    expect(result.name).toBe('rich.json');
    expect(result.blob.type).toBe('application/json');
    expect(await json(result)).toEqual({
      Data: [
        { Name: 'Alice', Amount: 100, Date: '2021-01-01', 'Column D': null }, // blank header gets a column name
        { Name: 'Bob', Amount: null, Date: null, 'Column D': true }, // the blank row between is skipped
      ],
      Notes: [],
    });
    expect(result.summary).toBe('2 sheets · 2 rows');
  });

  it('keeps plain rows when the first row is not a header', async () => {
    const result = await xlsxToJson(file('sheet.xlsx'), { header: false });
    const rows = await json(result);
    expect(rows).toEqual([['Revenue', 1234]]);
  });

  it('names repeated headers apart', async () => {
    const xlsx = await jsonToXlsx(new File(['[["Name","Name",""],["a","b","c"]]'], 'dup.json'));
    const back = await json(await xlsxToJson(new File([await xlsx.blob.arrayBuffer()], 'dup.xlsx')));
    expect(back).toEqual([{ Name: 'a', 'Name 2': 'b', 'Column C': 'c' }]);
  });
});

describe('jsonToXlsx', () => {
  const back = async (result: { blob: Blob }, header = true) =>
    JSON.parse(await (await xlsxToJson(new File([await result.blob.arrayBuffer()], 'x.xlsx'), { header })).blob.text());

  it('writes records as rows, flattening nested objects and keeping types', async () => {
    const records = [
      { id: 1, name: 'Asha', zip: '007', active: true, address: { city: 'Pune', pin: 411001 }, tags: ['a', 'b'], note: null },
      { id: 2, name: 'Ben <&> "Co"', extra: 'x' },
    ];
    const result = await jsonToXlsx(new File([JSON.stringify(records)], 'people.json'));
    expect(result.name).toBe('people.xlsx');
    expect(result.summary).toBe('1 sheet · 2 rows');
    expect(await back(result)).toEqual([
      { id: 1, name: 'Asha', zip: '007', active: true, 'address.city': 'Pune', 'address.pin': 411001, tags: '["a","b"]', note: null, extra: null },
      { id: 2, name: 'Ben <&> "Co"', zip: null, active: null, 'address.city': null, 'address.pin': null, tags: null, note: null, extra: 'x' },
    ]);
    // The header row is bold and frozen so it stays in view.
    const sheet = strFromU8((await unzip(result.blob))['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toMatch(/<c r="A1" s="1"/);
  });

  it('makes one sheet per list in an object of lists, with safe unique names', async () => {
    const data = { Customers: [{ name: 'Asha' }], 'a/b': [[1, 2], [3, 4]], 'A/B': [{ v: 1 }] };
    const result = await jsonToXlsx(new File([JSON.stringify(data)], 'shop.json'));
    const workbook = strFromU8((await unzip(result.blob))['xl/workbook.xml']);
    expect([...workbook.matchAll(/name="([^"]*)"/g)].map((m) => m[1])).toEqual(['Customers', 'a_b', 'A_B (2)']);
    const sheets = await back(result, false);
    expect(sheets.a_b).toEqual([[1, 2], [3, 4]]);
    expect(sheets.Customers).toEqual([['name'], ['Asha']]);
  });

  it('treats a single object as one record and plain values as a value column', async () => {
    expect(await back(await jsonToXlsx(new File(['{"a": 1, "b": {"c": false}}'], 'one.json')))).toEqual([{ a: 1, 'b.c': false }]);
    expect(await back(await jsonToXlsx(new File(['["x", 2]'], 'list.json')))).toEqual([{ value: 'x' }, { value: 2 }]);
  });

  it('says where invalid JSON goes wrong', async () => {
    const error = (await jsonToXlsx(new File(['{\n  "a": 1\n  "b": 2\n}'], 'bad.json')).catch((e) => e)) as LocalError;
    expect(error.code).toBe('BAD_JSON_AT');
    expect(error.vars).toEqual({ line: 3, column: 3 });
  });
});
