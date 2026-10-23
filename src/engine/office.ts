// Word <-> HTML and PDF <-> Word/PowerPoint conversions, all client-side.
// docx/pptx are ZIP packages of XML parts (OOXML); Node has no DOMParser, so a small
// tolerant tokenizer stands in for one below instead of pulling in a real XML library.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { fixIndic } from './convert';
import { LocalError, baseName, bytes, openPdf, renderPage, type Output } from './local';


// ---------------------------------------------------------------------------
// Tiny tolerant XML reader. Produces a plain node tree; namespace prefixes are
// kept as part of the tag name (e.g. "w:p") since OOXML always refers to them that way.
// ---------------------------------------------------------------------------

export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
  return attrs;
}

/** Parses XML into a synthetic "#root" node holding the document's top-level elements. */
export function parseXml(xml: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([a-zA-Z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const push = (node: XNode, text: string) => {
    if (!text) return;
    // Text becomes a synthetic "#text" child carrying the decoded string in its tag slot,
    // which keeps XNode to a single shape; readers ask for it with textOf().
    node.children.push({ tag: '#text', attrs: { value: text }, children: [] });
  };
  while ((match = re.exec(xml))) {
    const before = xml.slice(lastIndex, match.index);
    if (before) push(stack[stack.length - 1], decodeEntities(before));
    lastIndex = re.lastIndex;
    const [, cdata, closing, tag, attrStr, selfClose] = match;
    if (cdata !== undefined) {
      push(stack[stack.length - 1], cdata);
      continue;
    }
    if (tag === undefined) continue; // comment or processing instruction
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node: XNode = { tag, attrs: parseAttrs(attrStr ?? ''), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  const tail = xml.slice(lastIndex);
  if (tail) push(stack[stack.length - 1], decodeEntities(tail));
  return root;
}

const textOf = (node: XNode): string =>
  node.children.map((c) => (c.tag === '#text' ? c.attrs.value : textOf(c))).join('');
const el = (node: XNode, tag: string): XNode[] => node.children.filter((c) => c.tag === tag);
const first = (node: XNode, tag: string): XNode | undefined => node.children.find((c) => c.tag === tag);
function deep(node: XNode, tag: string, out: XNode[] = []): XNode[] {
  for (const child of node.children) {
    if (child.tag === tag) out.push(child);
    deep(child, tag, out);
  }
  return out;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeAttr = escapeHtml;

// ---------------------------------------------------------------------------
// docxToHtml
// ---------------------------------------------------------------------------

const HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkblue: '#000080', darkcyan: '#008080', darkgreen: '#008000', darkmagenta: '#800080', darkred: '#800000',
  darkyellow: '#808000', darkgray: '#808080', lightgray: '#c0c0c0', black: '#000000', white: '#ffffff',
};

const EMU_PER_PX = 914400 / 96;
const TWIP_PER_INCH = 1440;

interface StyleInfo { name?: string; basedOn?: string }

function loadStyles(entries: Record<string, Uint8Array>): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  const xml = entries['word/styles.xml'];
  if (!xml) return styles;
  for (const style of deep(parseXml(strFromU8(xml)), 'w:style')) {
    const id = style.attrs['w:styleId'];
    if (!id) continue;
    styles.set(id, { name: first(style, 'w:name')?.attrs['w:val'], basedOn: first(style, 'w:basedOn')?.attrs['w:val'] });
  }
  return styles;
}

/** Resolves a paragraph style id to a heading level (1-6), 'title', 'subtitle' or null. */
function headingOf(styleId: string | undefined, styles: Map<string, StyleInfo>): number | 'title' | 'subtitle' | null {
  let id = styleId;
  for (let depth = 0; id && depth < 10; depth++) {
    const named = styles.get(id)?.name ?? id;
    const heading = /^heading\s*(\d)$/i.exec(named);
    if (heading) return Math.min(6, Number(heading[1]));
    if (/^title$/i.test(named)) return 'title';
    if (/^subtitle$/i.test(named)) return 'subtitle';
    id = styles.get(id)?.basedOn;
  }
  return null;
}

interface NumFormat { fmt: string }

function loadNumbering(entries: Record<string, Uint8Array>): Map<string, Map<number, NumFormat>> {
  const numToAbstract = new Map<string, string>();
  const abstractLevels = new Map<string, Map<number, NumFormat>>();
  const xml = entries['word/numbering.xml'];
  if (!xml) return new Map();
  const root = parseXml(strFromU8(xml));
  for (const abs of deep(root, 'w:abstractNum')) {
    const id = abs.attrs['w:abstractNumId'];
    if (id === undefined) continue;
    const levels = new Map<number, NumFormat>();
    for (const lvl of el(abs, 'w:lvl')) {
      const ilvl = Number(lvl.attrs['w:ilvl'] ?? 0);
      levels.set(ilvl, { fmt: first(lvl, 'w:numFmt')?.attrs['w:val'] ?? 'decimal' });
    }
    abstractLevels.set(id, levels);
  }
  for (const num of deep(root, 'w:num')) {
    const id = num.attrs['w:numId'];
    const absId = first(num, 'w:abstractNumId')?.attrs['w:val'];
    if (id !== undefined && absId !== undefined) numToAbstract.set(id, absId);
  }
  const byNumId = new Map<string, Map<number, NumFormat>>();
  for (const [numId, absId] of numToAbstract) {
    const levels = abstractLevels.get(absId);
    if (levels) byNumId.set(numId, levels);
  }
  return byNumId;
}

const ORDERED_TYPE: Record<string, string> = {
  decimal: '1', lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I',
};

interface Rel { target: string; mode?: string; type: string }

function loadRels(entries: Record<string, Uint8Array>, path: string): Map<string, Rel> {
  const rels = new Map<string, Rel>();
  const xml = entries[path];
  if (!xml) return rels;
  for (const rel of deep(parseXml(strFromU8(xml)), 'Relationship')) {
    rels.set(rel.attrs.Id, { target: rel.attrs.Target, mode: rel.attrs.TargetMode, type: rel.attrs.Type });
  }
  return rels;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
};

function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary);
}

/** Runs (and the hyperlink or nothing that wraps them) inside one paragraph, rendered to inline HTML. */
function renderInline(node: XNode, rels: Map<string, Rel>, media: Record<string, string>): string {
  let html = '';
  for (const child of node.children) {
    if (child.tag === 'w:r') html += renderRun(child, media);
    else if (child.tag === 'w:hyperlink') {
      const rel = child.attrs['r:id'] ? rels.get(child.attrs['r:id']) : undefined;
      const inner = renderInline(child, rels, media);
      const url = rel?.target ?? '';
      html += rel && rel.mode === 'External' && /^(https?:|mailto:)/i.test(url)
        ? `<a href="${escapeAttr(url)}">${inner}</a>`
        : inner;
    } else if (child.tag === 'w:ins') html += renderInline(child, rels, media);
    // w:del (tracked deletions) is skipped: that text no longer exists in the document.
  }
  return html;
}

function renderRun(run: XNode, media: Record<string, string>): string {
  const rPr = first(run, 'w:rPr');
  let content = '';
  for (const child of run.children) {
    if (child.tag === 'w:t') content += escapeHtml(textOf(child));
    else if (child.tag === 'w:tab') content += '    ';
    else if (child.tag === 'w:br') content += child.attrs['w:type'] === 'page' ? '<div style="break-before:page"></div>' : '<br>';
    else if (child.tag === 'w:drawing') content += renderDrawing(child, media);
  }
  if (!rPr || !content) return content;
  const styles: string[] = [];
  const on = (n: XNode | undefined) => !!n && !['false', '0', 'none'].includes(n.attrs['w:val'] ?? '');
  if (on(first(rPr, 'w:b'))) content = `<strong>${content}</strong>`;
  if (on(first(rPr, 'w:i'))) content = `<em>${content}</em>`;
  if (on(first(rPr, 'w:strike'))) content = `<s>${content}</s>`;
  const underline = first(rPr, 'w:u');
  if (underline && underline.attrs['w:val'] !== 'none') content = `<u>${content}</u>`;
  const vertAlign = first(rPr, 'w:vertAlign')?.attrs['w:val'];
  if (vertAlign === 'superscript') content = `<sup>${content}</sup>`;
  if (vertAlign === 'subscript') content = `<sub>${content}</sub>`;
  const color = first(rPr, 'w:color')?.attrs['w:val'];
  if (color && /^[0-9a-f]{6}$/i.test(color)) styles.push(`color:#${color}`);
  const highlight = first(rPr, 'w:highlight')?.attrs['w:val'];
  if (highlight && HIGHLIGHTS[highlight]) styles.push(`background-color:${HIGHLIGHTS[highlight]}`);
  const size = first(rPr, 'w:sz')?.attrs['w:val'];
  if (size && Number(size) > 0) styles.push(`font-size:${Number(size) / 2}pt`);
  return styles.length ? `<span style="${styles.join(';')}">${content}</span>` : content;
}

function renderDrawing(drawing: XNode, media: Record<string, string>): string {
  const blip = deep(drawing, 'a:blip')[0];
  const rId = blip?.attrs['r:embed'];
  if (!rId) return '';
  const data = media[rId];
  if (!data) return ''; // unsupported format (e.g. EMF/WMF) or missing part: omitted, not faked
  const extent = deep(drawing, 'wp:extent')[0];
  const width = extent ? Math.round(Number(extent.attrs.cx) / EMU_PER_PX) : undefined;
  const height = extent ? Math.round(Number(extent.attrs.cy) / EMU_PER_PX) : undefined;
  const sizeAttr = width && height ? ` width="${width}" height="${height}"` : '';
  const properties = deep(drawing, 'wp:docPr')[0];
  const alt = properties?.attrs.descr || properties?.attrs.title || '';
  return `<img src="${data}"${sizeAttr} alt="${escapeAttr(alt)}">`;
}

interface TableCell { colSpan: number; rowSpan: number; shade?: string; html: string }

function renderTable(tbl: XNode, rels: Map<string, Rel>, media: Record<string, string>): string {
  const rows: TableCell[][] = [];
  const open = new Map<number, TableCell>();
  for (const tr of el(tbl, 'w:tr')) {
    const rowCells: TableCell[] = [];
    let col = 0;
    for (const tc of el(tr, 'w:tc')) {
      const tcPr = first(tc, 'w:tcPr');
      const gridSpan = Number(first(tcPr ?? tc, 'w:gridSpan')?.attrs['w:val'] ?? 1) || 1;
      const vMerge = first(tcPr ?? tc, 'w:vMerge');
      const continued = vMerge && (vMerge.attrs['w:val'] ?? 'continue') === 'continue';
      if (continued && open.has(col)) {
        open.get(col)!.rowSpan++;
      } else {
        const shd = first(tcPr ?? tc, 'w:shd')?.attrs['w:fill'];
        const html = el(tc, 'w:p').map((p) => renderParagraph(p, rels, media, new Map(), []).html).join('');
        const cell: TableCell = { colSpan: gridSpan, rowSpan: 1, shade: shd && /^[0-9a-f]{6}$/i.test(shd) ? shd : undefined, html };
        rowCells.push(cell);
        if (vMerge && (vMerge.attrs['w:val'] === 'restart')) open.set(col, cell);
        else open.delete(col);
      }
      col += gridSpan;
    }
    rows.push(rowCells);
  }
  const body = rows
    .map((row) => `<tr>${row.map((c) => `<td${c.colSpan > 1 ? ` colspan="${c.colSpan}"` : ''}${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''}${c.shade ? ` style="background-color:#${c.shade}"` : ''}>${c.html || '&nbsp;'}</td>`).join('')}</tr>`)
    .join('');
  return `<table>${body}</table>`;
}

function renderParagraph(
  p: XNode,
  rels: Map<string, Rel>,
  media: Record<string, string>,
  styles: Map<string, StyleInfo>,
  numbering: [Map<string, Map<number, NumFormat>>] | [],
): { html: string; list?: { ilvl: number; ordered: boolean } } {
  const pPr = first(p, 'w:pPr');
  const styleId = first(pPr ?? p, 'w:pStyle')?.attrs['w:val'];
  const heading = headingOf(styleId, styles);
  const inline = renderInline(p, rels, media) || '&nbsp;';
  const styleParts: string[] = [];
  const jc = first(pPr ?? p, 'w:jc')?.attrs['w:val'];
  const align = ({ both: 'justify', distribute: 'justify', start: 'left', end: 'right', left: 'left', right: 'right', center: 'center' } as Record<string, string>)[jc ?? ''];
  if (align) styleParts.push(`text-align:${align}`);
  const ind = first(pPr ?? p, 'w:ind');
  if (ind?.attrs['w:left']) styleParts.push(`margin-left:${Number(ind.attrs['w:left']) / 20}pt`);
  if (ind?.attrs['w:right']) styleParts.push(`margin-right:${Number(ind.attrs['w:right']) / 20}pt`);
  if (ind?.attrs['w:firstLine']) styleParts.push(`text-indent:${Number(ind.attrs['w:firstLine']) / 20}pt`);
  if (ind?.attrs['w:hanging']) styleParts.push(`text-indent:-${Number(ind.attrs['w:hanging']) / 20}pt`);
  if (first(pPr ?? p, 'w:pageBreakBefore')) styleParts.push('break-before:page');
  const style = styleParts.length ? ` style="${styleParts.join(';')}"` : '';

  const numPr = first(pPr ?? p, 'w:numPr');
  const numMap = numbering[0];
  if (numPr && numMap) {
    const ilvl = Number(first(numPr, 'w:ilvl')?.attrs['w:val'] ?? 0);
    const numId = first(numPr, 'w:numId')?.attrs['w:val'];
    const fmt = (numId && numMap.get(numId)?.get(ilvl)?.fmt) ?? 'decimal';
    return { html: `<li${style}>${inline}</li>`, list: { ilvl, ordered: fmt !== 'bullet' } };
  }

  if (heading === 'title') return { html: `<h1 class="title"${style}>${inline}</h1>` };
  if (heading === 'subtitle') return { html: `<p class="subtitle"${style}>${inline}</p>` };
  if (typeof heading === 'number') return { html: `<h${heading}${style}>${inline}</h${heading}>` };
  return { html: `<p${style}>${inline}</p>` };
}

/** Turns a flat sequence of blocks (some tagged as list items) into nested <ul>/<ol>. */
function nestLists(blocks: { html: string; list?: { ilvl: number; ordered: boolean } }[]): string {
  let out = '';
  const open: { ordered: boolean }[] = [];
  const close = (down: number) => {
    while (open.length > down) out += open.pop()!.ordered ? '</ol>' : '</ul>';
  };
  for (const block of blocks) {
    if (!block.list) {
      close(0);
      out += block.html;
      continue;
    }
    const { ilvl, ordered } = block.list;
    while (open.length <= ilvl) {
      open.push({ ordered });
      out += ordered ? `<ol type="${ORDERED_TYPE.decimal}">` : '<ul>';
    }
    while (open.length > ilvl + 1) close(ilvl + 1);
    if (open[ilvl].ordered !== ordered) {
      close(ilvl);
      open.push({ ordered });
      out += ordered ? '<ol>' : '<ul>';
    }
    out += block.html;
  }
  close(0);
  return out;
}

export async function docxToHtml(file: File): Promise<{ html: string; title: string }> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(await bytes(file));
  } catch {
    throw new LocalError('NOT_OFFICE');
  }
  if (!entries['word/document.xml']) throw new LocalError('NOT_OFFICE');

  const styles = loadStyles(entries);
  const numbering = loadNumbering(entries);
  const rels = loadRels(entries, 'word/_rels/document.xml.rels');
  // Images a part links to, inlined as data: URLs (the print frame never fetches anything).
  const mediaFor = (partRels: Map<string, Rel>) => {
    const media: Record<string, string> = {};
    for (const [rId, rel] of partRels) {
      const match = /^(?:word\/)?media\/(.+)$/.exec(rel.target.replace(/^\.\.\//, ''));
      if (!match) continue;
      const path = `word/media/${match[1]}`;
      const ext = match[1].split('.').pop()?.toLowerCase() ?? '';
      const mime = IMAGE_MIME[ext];
      if (mime && entries[path]) media[rId] = `data:${mime};base64,${toBase64(entries[path])}`;
    }
    return media;
  };
  const media = mediaFor(rels);

  const root = parseXml(strFromU8(entries['word/document.xml']));
  const body = deep(root, 'w:body')[0];
  const blocks: { html: string; list?: { ilvl: number; ordered: boolean } }[] = [];
  if (body) {
    for (const child of body.children) {
      if (child.tag === 'w:p') blocks.push(renderParagraph(child, rels, media, styles, [numbering]));
      else if (child.tag === 'w:tbl') blocks.push({ html: renderTable(child, rels, media) });
    }
  }
  const sectPr = body && first(body, 'w:sectPr');

  /** The section's default header or footer. Lines with page-number fields are left out: the
   *  numbers can't be reproduced on each printed page in every browser. */
  const part = (kind: 'header' | 'footer') => {
    const refs = sectPr ? el(sectPr, `w:${kind}Reference`) : [];
    const ref = refs.find((r) => r.attrs['w:type'] === 'default') ?? refs[0];
    const target = ref && rels.get(ref.attrs['r:id'])?.target.replace(/^\/?(word\/)?/, '');
    const xml = target && entries[`word/${target}`];
    const top = xml && parseXml(strFromU8(xml)).children.find((c) => c.tag === (kind === 'header' ? 'w:hdr' : 'w:ftr'));
    if (!top) return '';
    const partRels = loadRels(entries, `word/_rels/${target}.rels`);
    const partMedia = mediaFor(partRels);
    const pageField = (node: XNode) =>
      deep(node, 'w:instrText').some((n) => /\b(NUM)?PAGES?\b/.test(textOf(n))) ||
      deep(node, 'w:fldSimple').some((n) => /\b(NUM)?PAGES?\b/.test(n.attrs['w:instr'] ?? ''));
    const partBlocks: typeof blocks = [];
    for (const child of top.children) {
      if (pageField(child)) continue;
      if (child.tag === 'w:p') partBlocks.push(renderParagraph(child, partRels, partMedia, styles, [numbering]));
      else if (child.tag === 'w:tbl') partBlocks.push({ html: renderTable(child, partRels, partMedia) });
    }
    const html = nestLists(partBlocks);
    return (html.replace(/<[^>]*>/g, '').trim() || /<img/.test(html)) ? html : ''; // an empty part adds nothing
  };
  const header = part('header');
  const footer = part('footer');
  // A table's header and footer rows repeat on every printed page, in every major browser.
  const content =
    header || footer
      ? `<table class="page-frame">${header ? `<thead><tr><td>${header}</td></tr></thead>` : ''}${footer ? `<tfoot><tr><td>${footer}</td></tr></tfoot>` : ''}<tbody><tr><td>${nestLists(blocks)}</td></tr></tbody></table>`
      : nestLists(blocks);

  const pgSz = sectPr && first(sectPr, 'w:pgSz');
  const pgMar = sectPr && first(sectPr, 'w:pgMar');
  const inches = (twips?: string) => (twips && Number.isFinite(Number(twips)) ? `${(Number(twips) / TWIP_PER_INCH).toFixed(2)}in` : undefined);
  const pageWidth = inches(pgSz?.attrs['w:w']);
  const pageHeight = inches(pgSz?.attrs['w:h']);
  const pageRule = pageWidth && pageHeight ? `size: ${pageWidth} ${pageHeight};` : '';
  const marginRule = pgMar
    ? `margin: ${['w:top', 'w:right', 'w:bottom', 'w:left'].map((side) => inches(pgMar.attrs[side]) ?? '1in').join(' ')};`
    : 'margin: 1in;';

  const coreXml = entries['docProps/core.xml'] && strFromU8(entries['docProps/core.xml']);
  const titleNode = coreXml && deep(parseXml(coreXml), 'dc:title')[0];
  const docTitle = (titleNode && textOf(titleNode).trim()) || baseName(file);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title>
<style>
@page { ${pageRule} ${marginRule} }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #111; }
h1, h2, h3, h4, h5, h6 { font-family: Calibri Light, Arial, sans-serif; color: #1f3864; }
p.subtitle { font-style: italic; color: #444; }
table { border-collapse: collapse; margin: 0.5em 0; }
td { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
img { max-width: 100%; }
ul, ol { margin: 0.3em 0 0.3em 1.5em; }
a { color: #0563c1; }
table.page-frame { width: 100%; margin: 0; }
table.page-frame > * > tr > td { border: 0; padding: 0; }
table.page-frame > thead td { padding-bottom: 14pt; color: #444; }
table.page-frame > tfoot td { padding-top: 14pt; color: #444; }
</style></head>
<body>
${content}
</body></html>`;
  return { html, title: docTitle };
}

export async function docxToHtmlFile(file: File): Promise<Output> {
  const { html } = await docxToHtml(file);
  return {
    blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
    name: `${baseName(file)}.html`,
    summary: '1 file',
  };
}

// ---------------------------------------------------------------------------
// pdfToDocx
// ---------------------------------------------------------------------------

interface TextItem { str: string; transform: number[]; width: number; height: number; fontName?: string; hasEOL?: boolean }
interface Line { text: string; y: number; fontSize: number; bold: boolean; italic: boolean }
export interface DocParagraph { text: string; fontSize: number; bold: boolean; italic: boolean; bullet: boolean; numbered?: boolean }

/** Groups raw pdf.js text items (already in reading order) into visual lines. */
export function linesFromItems(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let current: { text: string; y: number; fontSize: number; bold: boolean; italic: boolean; endX: number } | null = null;
  for (const item of items) {
    const y = item.transform[5];
    const fontSize = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[3]) || 10;
    const bold = /bold|black|heavy/i.test(item.fontName ?? '');
    const italic = /italic|oblique/i.test(item.fontName ?? '');
    const x = item.transform[4];
    if (current && Math.abs(current.y - y) < fontSize * 0.3) {
      const gap = x - current.endX;
      if (gap > fontSize * 0.15 && !current.text.endsWith(' ') && item.str && !item.str.startsWith(' ')) current.text += ' ';
      current.text += item.str;
      current.endX = x + item.width;
    } else {
      if (current) lines.push(current);
      current = { text: item.str, y, fontSize, bold, italic, endX: x + item.width };
    }
    if (item.hasEOL && current) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  return lines.map((l) => ({ ...l, text: fixIndic(l.text) })).filter((l) => l.text.trim());
}

const BULLET_RE = /^[••●▪‣⁃*–-]\s+/;
// Numbered items keep their own number ("1.", "2)", "a.") so the order reads the same in Word.
const NUMBER_RE = /^(?:\d{1,3}|[a-z])[.)]\s+/i;
const isItem = (text: string) => BULLET_RE.test(text) || NUMBER_RE.test(text);

/**
 * Joins lines into paragraphs and derives style hints. A big vertical gap, a size change or a new
 * list item starts a new paragraph; the wrapped lines of one item stay together.
 */
export function paragraphsFromLines(lines: Line[]): DocParagraph[] {
  const paragraphs: DocParagraph[] = [];
  let buffer: Line[] = [];
  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.map((l) => l.text).join(' ').trim();
    const bullet = BULLET_RE.test(buffer[0].text);
    const numbered = NUMBER_RE.test(buffer[0].text);
    paragraphs.push({
      text: bullet ? text.replace(BULLET_RE, '') : text,
      fontSize: buffer[0].fontSize,
      bold: buffer.every((l) => l.bold),
      italic: buffer.every((l) => l.italic),
      bullet,
      numbered,
    });
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = buffer[buffer.length - 1];
    if (prev) {
      const gap = prev.y - line.y; // PDF y grows upward
      const lineHeight = prev.fontSize * 1.15;
      const endsList = isItem(buffer[0].text) && !isItem(line.text) && gap > lineHeight * 1.2;
      if (gap > lineHeight * 1.5 || prev.fontSize !== line.fontSize || isItem(line.text) || endsList) flush();
    }
    buffer.push(line);
  }
  flush();
  return paragraphs;
}

// Control characters are legal in PDF text but not in XML 1.0; Word refuses files that contain them.
const XML_ESCAPE = (s: string) => escapeHtml(s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')).replace(/\n/g, '</w:t></w:r><w:r><w:br/><w:r><w:t xml:space="preserve">');

type Style = 'Title' | 'Heading1' | 'Heading2' | 'Heading3';

/**
 * Heading levels by rank: the largest size above body text is Heading 1, the next Heading 2, and so
 * on. A size used for a single line at the very start (a document title) becomes Title instead.
 */
export function headingStyles(paragraphs: DocParagraph[], bodySize: number): Map<number, Style> {
  const sizes = [...new Set(paragraphs.map((p) => p.fontSize).filter((size) => size >= bodySize * 1.08))].sort((a, b) => b - a);
  const styles = new Map<number, Style>();
  const top = sizes[0];
  const titled = top !== undefined && paragraphs[0]?.fontSize === top && paragraphs.filter((p) => p.fontSize === top).length === 1;
  if (titled) styles.set(sizes.shift()!, 'Title');
  sizes.slice(0, 3).forEach((size, i) => styles.set(size, (['Heading1', 'Heading2', 'Heading3'] as const)[i]));
  return styles;
}

const DOCX_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr/><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>`;

const CONTENT_TYPES_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const RELS_ROOT_DOCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const coreXmlFor = (title: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeHtml(title)}</dc:title><dc:creator></dc:creator><cp:lastModifiedBy></cp:lastModifiedBy>
</cp:coreProperties>`;

const appXml = (words: number, pages: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>Fizzdoc</Application><Words>${words}</Words><Pages>${pages}</Pages>
</Properties>`;

/** Builds a minimal, valid .docx from already-extracted paragraphs. Pure and Node-testable. */
export function buildDocxPackage(pages: DocParagraph[][], pageSize: { widthPt: number; heightPt: number }, title: string): { zipped: Uint8Array; words: number } {
  // Body text is the size most of the characters are set in (a few short headings mustn't win).
  const bodySize = (() => {
    const chars = new Map<number, number>();
    for (const p of pages.flat()) chars.set(p.fontSize, (chars.get(p.fontSize) ?? 0) + p.text.length);
    return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
  })();

  const styles = headingStyles(pages.flat(), bodySize);

  let words = 0;
  const paragraphXml = (p: DocParagraph, pageBreakBefore: boolean) => {
    words += p.text.split(/\s+/).filter(Boolean).length;
    const style = p.bullet || p.numbered ? undefined : styles.get(p.fontSize);
    const pPr = [
      style ? `<w:pStyle w:val="${style}"/>` : p.bullet || p.numbered ? '<w:pStyle w:val="ListParagraph"/>' : '',
      pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    ].join('');
    const text = XML_ESCAPE((p.bullet ? '• ' : '') + p.text);
    const rPr = [p.bold && !style ? '<w:b/>' : '', p.italic ? '<w:i/>' : ''].join('');
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  };

  let body = '';
  pages.forEach((paragraphs, pageIndex) => {
    paragraphs.forEach((p, i) => {
      body += paragraphXml(p, pageIndex > 0 && i === 0);
    });
  });
  const twipsW = Math.round(pageSize.widthPt * 20);
  const twipsH = Math.round(pageSize.heightPt * 20);
  body += `<w:sectPr><w:pgSz w:w="${twipsW}" w:h="${twipsH}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  const pageCount = pages.length;
  const entries: Zippable = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES_DOCX),
    '_rels/.rels': strToU8(RELS_ROOT_DOCX),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(DOCX_STYLES_XML),
    'docProps/core.xml': strToU8(coreXmlFor(title)),
    'docProps/app.xml': strToU8(appXml(words, pageCount)),
  };
  return { zipped: zipSync(entries, { level: 6 }), words };
}

export async function pdfToDocx(file: File): Promise<Output> {
  const doc = await openPdf(file);
  const pages: DocParagraph[][] = [];
  let widthPt = 612;
  let heightPt = 792;
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    if (number === 1) {
      const viewport = page.getViewport({ scale: 1 });
      widthPt = viewport.width;
      heightPt = viewport.height;
    }
    const content = await page.getTextContent();
    const lines = linesFromItems(content.items as unknown as TextItem[]);
    pages.push(paragraphsFromLines(lines));
    page.cleanup();
  }
  await doc.loadingTask.destroy();

  const totalText = pages.flat().map((p) => p.text).join(' ').trim();
  if (!totalText) throw new LocalError('NO_TEXT');

  const title = baseName(file);
  const { zipped, words } = buildDocxPackage(pages, { widthPt, heightPt }, title);
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    name: `${title}.docx`,
    summary: `${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'} · ${words.toLocaleString()} words`,
  };
}

// ---------------------------------------------------------------------------
// pdfToPptx
// ---------------------------------------------------------------------------

export interface PageImage { width: number; height: number; jpeg: Uint8Array }

/** Renders every PDF page to a full-page JPEG. Browser-only (OffscreenCanvas); not unit-testable in Node. */
export async function renderPdfPagesToJpeg(file: File, dpi = 150): Promise<PageImage[]> {
  const doc = await openPdf(file);
  const images: PageImage[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const { blob, width, height } = await renderPage(page, dpi, 'image/jpeg', 0.85);
    images.push({ width, height, jpeg: await bytes(blob) });
    page.cleanup();
  }
  await doc.loadingTask.destroy();
  return images;
}

const EMU_MIN = 914400;
const EMU_MAX = 51206400;
const clampEmu = (v: number) => Math.max(EMU_MIN, Math.min(EMU_MAX, Math.round(v)));

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fizzdoc">
<a:themeElements>
<a:clrScheme name="Fizzdoc"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
<a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>
<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Fizzdoc"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Fizzdoc"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldLayoutIdLst>
</p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

function slideXml(cx: number, cy: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:pic>
<p:nvPicPr><p:cNvPr id="2" name="Page"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>
</p:spTree></p:cSld>
</p:sld>`;
}

const slideRels = (n: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.jpeg"/>
</Relationships>`;

/** Builds a minimal, valid .pptx from pre-rendered page images. Pure and Node-testable. */
export function buildPptxPackage(images: PageImage[]): Uint8Array {
  const cx = clampEmu((images[0]?.width ?? 1600) * EMU_PER_PX);
  const cy = clampEmu((images[0]?.height ?? 900) * EMU_PER_PX);
  const n = images.length;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${cx}" cy="${cy}"/>
<p:notesSz cx="${cy}" cy="${cx}"/>
</p:presentation>`;

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('\n')}
</Relationships>`;

  const entries: Zippable = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'docProps/core.xml': strToU8(coreXmlFor('Presentation')),
    'docProps/app.xml': strToU8(appXml(0, n)),
    'ppt/presentation.xml': strToU8(presentationXml),
    'ppt/_rels/presentation.xml.rels': strToU8(presentationRels),
    'ppt/slideMasters/slideMaster1.xml': strToU8(SLIDE_MASTER_XML),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8(SLIDE_MASTER_RELS),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(SLIDE_LAYOUT_XML),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8(SLIDE_LAYOUT_RELS),
    'ppt/theme/theme1.xml': strToU8(THEME_XML),
  };
  images.forEach((image, i) => {
    const n1 = i + 1;
    const scx = clampEmu(image.width * EMU_PER_PX);
    const scy = clampEmu(image.height * EMU_PER_PX);
    entries[`ppt/slides/slide${n1}.xml`] = strToU8(slideXml(scx, scy));
    entries[`ppt/slides/_rels/slide${n1}.xml.rels`] = strToU8(slideRels(n1));
    entries[`ppt/media/image${n1}.jpeg`] = [image.jpeg, { level: 0 }];
  });
  return zipSync(entries, { level: 6 });
}

export async function pdfToPptx(file: File, renderPages: (file: File) => Promise<PageImage[]> = renderPdfPagesToJpeg): Promise<Output> {
  const images = await renderPages(file);
  const zipped = buildPptxPackage(images);
  const name = baseName(file);
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
    name: `${name}.pptx`,
    summary: `${images.length} ${images.length === 1 ? 'slide' : 'slides'}`,
  };
}
