import { tables } from './convert';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

const fileTitle = (name: string) => name.replace(/\.[^.]*$/, '') || 'Spreadsheet';

/** Prepare every workbook sheet for the browser's print-to-PDF flow. */
export async function xlsxToHtml(file: File): Promise<{ html: string; title: string }> {
  const sheets = await tables(file);
  const body = sheets
    .map(
      ({ name, rows }) => `
<section class="sheet">
  <h1>${escapeHtml(name)}</h1>
  <table><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n')}</tbody></table>
</section>`,
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fileTitle(file.name))}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { color: #172033; font: 10pt/1.4 Arial, sans-serif; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  h1 { font-size: 18pt; margin: 0 0 12pt; overflow-wrap: anywhere; }
  table { border-collapse: collapse; table-layout: auto; width: 100%; }
  td { border: 1px solid #aab2c0; padding: 4pt 6pt; overflow-wrap: anywhere; vertical-align: top; }
  tr { break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>${body}</body>
</html>`;
  return { html, title: fileTitle(file.name) };
}
