// Open any file: shows a PDF, Word document, spreadsheet, image, text or Markdown file on the page.
// Nothing is converted or saved. A document turned into HTML goes in a sandboxed frame, so nothing
// inside a file can run a script or reach the page around it.
import { openPdf } from '../engine/local';
import { t } from '../i18n';
import './viewer.css';

/** Rows shown at first; a sheet with more gets a "Show all rows" button. */
const ROWS = 2000;
/** Plain text shown at first; a bigger file is cut there, and the page says so. */
const TEXT_BYTES = 2_000_000;

type Kind = 'pdf' | 'docx' | 'sheet' | 'image' | 'markdown' | 'text';

export function kindOf(file: File): Kind | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1].toLowerCase() ?? '';
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (['xlsx', 'csv', 'tsv'].includes(ext)) return 'sheet';
  if (file.type.startsWith('image/')) return 'image';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (file.type.startsWith('text/') || ['txt', 'json', 'log', 'xml', 'yml', 'yaml', 'srt', 'vtt'].includes(ext)) return 'text';
  return undefined;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** A converted document, shown without scripts and cut off from the page (an empty sandbox). */
function frame(html: string, title: string) {
  const node = element('iframe', 'vw-frame');
  node.setAttribute('sandbox', '');
  node.title = title;
  node.srcdoc = html;
  return node;
}

export async function openViewer(file: File, viewer: HTMLElement) {
  const kind = kindOf(file);
  const cleanup: (() => void)[] = [];
  viewer.classList.add('vw');

  if (kind === 'pdf') {
    const doc = await openPdf(file);
    cleanup.push(() => void doc.loadingTask.destroy());
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const pages = element('div', 'vw-pages');
    // Pages are drawn as they come near the screen, so a long PDF opens at once.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          void draw(entry.target as HTMLCanvasElement);
        }
      },
      { rootMargin: '800px 0px' },
    );
    cleanup.push(() => observer.disconnect());
    const draw = async (canvas: HTMLCanvasElement) => {
      const page = await doc.getPage(Number(canvas.dataset.page));
      const natural = page.getViewport({ scale: 1 });
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (Math.min(pages.clientWidth, natural.width * 1.5) / natural.width) * dpr });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    };
    for (let n = 1; n <= doc.numPages; n++) {
      const canvas = element('canvas', 'vw-page');
      canvas.dataset.page = String(n);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', t('vw.page', { n, total: doc.numPages }));
      // The first page's shape holds the place until each page is drawn.
      canvas.style.aspectRatio = `${first.width} / ${first.height}`;
      pages.append(canvas);
      observer.observe(canvas);
    }
    viewer.replaceChildren(pages);
  } else if (kind === 'docx') {
    const { html, title } = await (await import('../engine/office')).docxToHtml(file);
    viewer.replaceChildren(frame(html, title || file.name));
  } else if (kind === 'markdown') {
    const { html, title } = await (await import('../engine/convert')).textToHtml(file);
    viewer.replaceChildren(frame(html, title || file.name));
  } else if (kind === 'sheet') {
    const sheets = await (await import('../engine/convert')).tables(file);
    const show = (all: boolean) =>
      viewer.replaceChildren(
        ...sheets.flatMap(({ name, rows }) => {
          const table = element('table', 'vw-table');
          for (const cells of all ? rows : rows.slice(0, ROWS)) {
            const row = table.insertRow();
            for (const cell of cells) row.insertCell().textContent = cell;
          }
          const scroller = element('div', 'vw-scroll');
          scroller.tabIndex = 0; // a wide table scrolls with the arrow keys
          scroller.setAttribute('role', 'region');
          scroller.setAttribute('aria-label', name);
          scroller.append(table);
          const parts: HTMLElement[] = sheets.length > 1 ? [element('h3', 'vw-sheet', name), scroller] : [scroller];
          if (!all && rows.length > ROWS) {
            const more = element('button', 'button', t('vw.showAll', { n: rows.length }));
            more.type = 'button';
            more.onclick = () => show(true);
            parts.push(element('p', 'hint', t('vw.firstRows', { n: ROWS })), more);
          }
          return parts;
        }),
      );
    show(false);
  } else if (kind === 'image') {
    const url = URL.createObjectURL(file);
    cleanup.push(() => URL.revokeObjectURL(url));
    const image = element('img', 'vw-image');
    image.src = url;
    image.alt = file.name;
    viewer.replaceChildren(image);
  } else if (kind === 'text') {
    const text = element('pre', 'vw-text', await file.slice(0, TEXT_BYTES).text());
    text.tabIndex = 0; // long lines scroll with the arrow keys
    viewer.replaceChildren(...(file.size > TEXT_BYTES ? [element('p', 'hint', t('vw.cut')), text] : [text]));
  } else {
    viewer.replaceChildren(element('p', 'note', t('vw.unknown')));
  }

  return {
    // Nothing to save: the page has no action button for this tool.
    save: () => Promise.reject(new Error('view')),
    destroy() {
      for (const done of cleanup) done();
      viewer.classList.remove('vw');
    },
  };
}
