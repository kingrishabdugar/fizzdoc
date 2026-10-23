import { baseName, type Output } from './local';
import { docxToHtml } from './office';

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HtmlNode | string)[];
}

function decodeHtml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') {
      return ({ amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"' })[entity.toLowerCase()] ?? match;
    }
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const token = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    const value = match[0];
    if (value.startsWith('<!--') || /^<!doctype/i.test(value)) continue;
    const tag = /^<\/?\s*([a-zA-Z][\w:-]*)/.exec(value)?.[1]?.toLowerCase();
    if (!tag) {
      stack[stack.length - 1].children.push(decodeHtml(value));
      continue;
    }
    if (/^<\//.test(value)) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrText = value.slice(tag.length + 1, value.length - 1);
    const attrPattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let attr: RegExpExecArray | null;
    while ((attr = attrPattern.exec(attrText))) attrs[attr[1].toLowerCase()] = decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const node: HtmlNode = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!voidTags.has(tag) && !/\/\s*>$/.test(value)) stack.push(node);
  }
  return root;
}

const children = (node: HtmlNode, tag: string) =>
  node.children.filter((child): child is HtmlNode => typeof child !== 'string' && child.tag === tag);

function inlineMarkdown(nodes: (HtmlNode | string)[], inTable = false): string {
  return nodes.map((node) => {
    if (typeof node === 'string') {
      const escaped = node.replace(/[\\`*_{}\[\]<>!]/g, '\\$&');
      return inTable ? escaped.replace(/\|/g, '\\|') : escaped;
    }
    const inside = inlineMarkdown(node.children, inTable);
    switch (node.tag) {
      case 'strong':
      case 'b':
        return `**${inside}**`;
      case 'em':
      case 'i':
        return `*${inside}*`;
      case 's':
      case 'del':
        return `~~${inside}~~`;
      case 'a':
        return node.attrs.href
          ? `[${inside}](${node.attrs.href.replace(/[\s()<>\\]/g, (character) =>
              character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character),
            )})`
          : inside;
      case 'img':
        return node.attrs.alt || 'Image';
      case 'br':
        return '  \n';
      case 'div':
        return /break-before:page/.test(node.attrs.style ?? '') ? '\n' : inside;
      default:
        return inside;
    }
  }).join('');
}

function renderList(list: HtmlNode, depth = 0): string {
  let index = 0;
  return list.children.map((item) => {
    if (typeof item === 'string') return '';
    if (item.tag === 'ul' || item.tag === 'ol') return renderList(item, depth + 1);
    if (item.tag !== 'li') return '';
    const nested = item.children.filter((child): child is HtmlNode =>
      typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol'));
    const content = item.children.filter((child) =>
      typeof child === 'string' || (child.tag !== 'ul' && child.tag !== 'ol'));
    const marker = list.tag === 'ol' ? `${++index}.` : '-';
    return `${'  '.repeat(depth)}${marker} ${inlineMarkdown(content).trim()}\n${nested.map((child) => renderList(child, depth + 1)).join('')}`;
  }).join('');
}

function renderTable(table: HtmlNode): string {
  if (table.attrs.class === 'page-frame') {
    return table.children
      .filter((section): section is HtmlNode => typeof section !== 'string')
      .flatMap((section) => children(section, 'tr'))
      .flatMap((row) => children(row, 'td'))
      .map((cell) => renderBlocks(cell.children))
      .join('');
  }
  const rows: HtmlNode[][] = [];
  const collectRows = (node: HtmlNode) => {
    if (node.tag === 'tr') {
      rows.push(node.children.filter((cell): cell is HtmlNode =>
        typeof cell !== 'string' && (cell.tag === 'td' || cell.tag === 'th')));
    } else {
      for (const child of node.children) if (typeof child !== 'string') collectRows(child);
    }
  };
  collectRows(table);
  if (!rows.length) return '';
  const grid: string[][] = [];
  const activeRowSpans = new Map<number, number>();
  for (const [rowIndex, row] of rows.entries()) {
    const values: string[] = [];
    const occupied = new Set(activeRowSpans.keys());
    for (const column of occupied) values[column] = '';
    for (const [column, remaining] of activeRowSpans) {
      if (remaining === 1) activeRowSpans.delete(column);
      else activeRowSpans.set(column, remaining - 1);
    }
    let column = 0;
    for (const cell of row) {
      while (occupied.has(column)) column++;
      const colSpan = Math.max(1, Number(cell.attrs.colspan) || 1);
      const rowSpan = Math.max(1, Number(cell.attrs.rowspan) || 1);
      values[column] = inlineMarkdown(cell.children, true).replace(/\s+/g, ' ').trim();
      occupied.add(column);
      for (let offset = 1; offset < colSpan; offset++) {
        occupied.add(column + offset);
        values[column + offset] = '';
      }
      if (rowSpan > 1) {
        for (let offset = 0; offset < colSpan; offset++) activeRowSpans.set(column + offset, rowSpan - 1);
      }
      column += colSpan;
    }
    grid[rowIndex] = values;
  }
  const columnCount = Math.max(...grid.map((row) => row.length));
  const rowText = (row: string[]) => `| ${Array.from({ length: columnCount }, (_, column) => row[column] ?? '').join(' | ')} |`;
  return [rowText(grid[0]), `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`, ...grid.slice(1).map(rowText)].join('\n') + '\n\n';
}

function renderBlocks(nodes: (HtmlNode | string)[]): string {
  return nodes.map((node) => {
    if (typeof node === 'string') return node;
    if (['head', 'style', 'script', 'title'].includes(node.tag)) return '';
    if (/^h[1-6]$/.test(node.tag)) return `${'#'.repeat(Number(node.tag[1]))} ${inlineMarkdown(node.children).trim()}\n\n`;
    if (node.tag === 'p') return `${inlineMarkdown(node.children).trim()}\n\n`;
    if (node.tag === 'ul' || node.tag === 'ol') return `${renderList(node)}\n`;
    if (node.tag === 'table') return renderTable(node);
    if (node.tag === 'br') return '\n';
    return renderBlocks(node.children);
  }).join('');
}

export async function docxToMarkdown(file: File): Promise<Output> {
  const { html } = await docxToHtml(file);
  const document = children(parseHtml(html), 'html')[0];
  const body = document && children(document, 'body')[0];
  const markdown = body ? renderBlocks(body.children).trim() : '';
  return {
    blob: new Blob([`${markdown}\n`], { type: 'text/markdown;charset=utf-8' }),
    name: `${baseName(file)}.md`,
    summary: '1 file',
  };
}
