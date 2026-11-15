// Redact PDF: mark areas by dragging on a page or by searching its text. Saving redraws every page
// as an image with the marks burned in (engine/raster.ts), so what was covered is gone from the file.
import './redact-pdf.css';
import type { Output } from '../engine/local';
import { openPdf } from '../engine/local';
import { rasterize, type Box, type RasterOptions } from '../engine/raster';
import { t } from '../i18n';
import { groupTextRuns, type TextItemLike } from './edit-pdf';

/** Width of `text` in a font like the PDF's, for placing a match inside a line; falls back to character count. */
function measurer(): (text: string, fontName: string) => number {
  const context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) return (text) => text.length;
  return (text, fontName) => {
    const name = fontName.toLowerCase();
    const family = /courier|mono/.test(name) ? 'monospace' : /times|serif|georgia|garamond|cambria/.test(name) ? 'serif' : 'sans-serif';
    context.font = `${/bold|black|heavy/.test(name) ? 'bold ' : ''}100px ${family}`;
    return context.measureText(text).width;
  };
}

/** [start, end) character ranges to cover within one line of text. */
type Finder = (text: string) => [number, number][];

/** Every case-insensitive occurrence of `query`. */
const occurrences =
  (query: string): Finder =>
  (text) => {
    const needle = query.trim().toLowerCase();
    const ranges: [number, number][] = [];
    if (!needle) return ranges;
    const haystack = text.toLowerCase();
    for (let found = haystack.indexOf(needle); found >= 0; found = haystack.indexOf(needle, found + needle.length)) {
      ranges.push([found, found + needle.length]);
    }
    return ranges;
  };

// Personal data that follows a fixed shape. Names and addresses don't, so they still need a search
// or a drag; the page asks people to check every mark before saving.
const PERSONAL: RegExp[] = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g, // emails, and UPI IDs such as name@okbank
  /\b[A-Z]{5}\d{4}[A-Z]\b/g, // Indian PAN
  /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, // IFSC bank branch code
  /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, // IBAN
  // Long numbers, spaced or not: phones, Aadhaar, card, account and social security numbers.
  /(?<![\w.,])\+?\(?\d[\d ().-]{6,}\d(?!\w|[.,]\d)/g,
];
const digits = (text: string) => text.replace(/\D/g, '').length;

/** Emails, phone numbers and ID, card or account numbers in one line of text. */
export const personalData: Finder = (text) => {
  const ranges: [number, number][] = [];
  for (const pattern of PERSONAL) {
    for (const match of text.matchAll(pattern)) {
      const numeric = pattern === PERSONAL[PERSONAL.length - 1];
      // 9 to 19 digits: skips dates, years, amounts and page numbers, keeps IDs and phone numbers.
      // Decimals (12345678.90) are amounts, not IDs.
      if (numeric && (digits(match[0]) < 9 || digits(match[0]) > 19 || /\.\d{1,2}$/.test(match[0]))) continue;
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  // Overlaps (a UPI ID inside an email, say) become one range.
  ranges.sort((x, y) => x[0] - y[0]);
  return ranges.reduce<[number, number][]>((merged, range) => {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
    return merged;
  }, []);
};

/** Boxes covering every case-insensitive match of `query`. */
export const findMatches = (items: TextItemLike[], query: string, measure = measurer()) => findBoxes(items, occurrences(query), measure);

/**
 * Boxes covering what `find` picks out of each line. A match inside a line is placed by its
 * measured share of the line, then padded generously, so a mark errs on the side of covering more.
 */
export function findBoxes(items: TextItemLike[], find: Finder, measure = measurer()): Box[] {
  const boxes: Box[] = [];
  for (const run of groupTextRuns(items)) {
    const [a, b, c, d, e, f] = run.transform;
    const size = Math.hypot(a, b) || 1;
    const [ux, uy] = [a / size, b / size]; // along the baseline
    const up = Math.hypot(c, d) || 1;
    const [vx, vy] = [c / up, d / up]; // up the glyphs
    const height = Math.max(run.height, size);
    const full = measure(run.text, run.fontName) || 1;
    const at = (index: number) => (run.width * measure(run.text.slice(0, index), run.fontName)) / full;
    for (const [from, to] of find(run.text)) {
      const start = at(from) - size * 0.35;
      const end = at(to) + size * 0.35;
      const corners = [
        [start, -height * 0.3],
        [end, -height * 0.3],
        [start, height * 1.05],
        [end, height * 1.05],
      ].map(([along, across]) => [e + ux * along + vx * across, f + uy * along + vy * across]);
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
  }
  return boxes;
}

type Viewport = { width: number; height: number; convertToViewportPoint(x: number, y: number): number[]; convertToPdfPoint(x: number, y: number): number[] };

/** Axis-aligned CSS-pixel rectangle of a PDF-space box. */
function screenBox(viewport: Viewport, box: Box, dpr: number) {
  const [ax, ay] = viewport.convertToViewportPoint(box.x0, box.y0);
  const [bx, by] = viewport.convertToViewportPoint(box.x1, box.y1);
  return { left: Math.min(ax, bx) / dpr, top: Math.min(ay, by) / dpr, width: Math.abs(bx - ax) / dpr, height: Math.abs(by - ay) / dpr };
}

const place = (element: HTMLElement, rect: ReturnType<typeof screenBox>) =>
  Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });

export interface Redactor {
  save(options: RasterOptions, onProgress?: (fraction: number) => void): Promise<Output>;
  destroy(): void;
}

export async function openRedactor(file: File, viewer: HTMLElement): Promise<Redactor> {
  const doc = await openPdf(file);

  const button = (label: string, className = 'redact-btn') => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    return element;
  };
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = t('rd.find');
  search.setAttribute('aria-label', t('rd.find'));
  const markAll = button(t('rd.markAll'));
  markAll.type = 'submit';
  const find = document.createElement('form');
  find.className = 'redact-find';
  find.append(search, markAll);
  const personal = button(t('rd.personal'));
  personal.title = t('rd.personalHint');
  personal.setAttribute('aria-pressed', 'false');
  // On touch screens a finger scrolls by default; this switch makes it draw instead.
  const draw = button(t('rd.draw'), 'redact-btn redact-draw');
  draw.setAttribute('aria-pressed', 'false');
  draw.onclick = () => {
    const on = draw.getAttribute('aria-pressed') !== 'true';
    draw.setAttribute('aria-pressed', String(on));
    viewer.classList.toggle('drawing', on);
  };
  const undo = button(t('ed.undo'));
  const clear = button(t('rd.clear'));
  const count = document.createElement('span');
  count.className = 'redact-count';
  count.setAttribute('aria-live', 'polite');
  const toolbar = document.createElement('div');
  toolbar.className = 'redact-toolbar';
  toolbar.append(find, personal, draw, undo, clear, count);
  const hint = document.createElement('p');
  hint.className = 'redact-hint';
  hint.textContent = t('rd.hint');
  const touchHint = document.createElement('p');
  touchHint.className = 'redact-hint redact-touch-hint';
  touchHint.textContent = t('rd.touchHint');
  const scroller = document.createElement('div');
  scroller.className = 'redact-scroll';
  viewer.classList.add('redact-pdf');
  viewer.replaceChildren(toolbar, hint, touchHint, scroller);

  interface PageView {
    wrapper: HTMLDivElement;
    canvas: HTMLCanvasElement;
    overlay: HTMLDivElement;
    viewport?: Viewport;
    dpr: number;
    items?: TextItemLike[];
  }
  const views: PageView[] = [];
  let marks: Box[][] = Array.from({ length: doc.numPages }, () => []);
  // The box the keyboard is moving, if any (see enableKeys).
  let keyBox: Box | undefined;
  const history: Box[][][] = [];
  const change = (next: Box[][]) => {
    history.push(marks);
    marks = next;
    refresh();
  };

  const same = (a: Box, b: Box) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
  // What "Find personal info" marked last, so the button shows as on while those marks are there
  // and a second tap takes them off again.
  let personalFound: Box[][] = [];
  const isPersonal = (box: Box, index: number) => personalFound[index]?.some((found) => same(found, box));

  function refresh() {
    const total = marks.reduce((sum, page) => sum + page.length, 0);
    count.textContent = t('rd.count', { n: total });
    personal.setAttribute('aria-pressed', String(marks.some((page, i) => page.some((box) => isPersonal(box, i)))));
    undo.disabled = !history.length;
    clear.disabled = !total;
    views.forEach(drawMarks);
  }

  function drawMarks(view: PageView, index: number) {
    const viewport = view.viewport;
    if (!viewport) return;
    view.overlay.replaceChildren(
      ...marks[index].map((box) => {
        const mark = document.createElement('div');
        mark.className = box === keyBox ? 'redact-box key' : 'redact-box';
        place(mark, screenBox(viewport, box, view.dpr));
        const remove = button('×', 'redact-remove');
        remove.setAttribute('aria-label', t('rd.remove'));
        remove.addEventListener('pointerdown', (event) => event.stopPropagation());
        remove.onclick = () => change(marks.map((page, i) => (i === index ? page.filter((other) => other !== box) : page)));
        mark.append(remove);
        return mark;
      }),
    );
  }

  const fitWidth = (pageWidth: number) => Math.min(Math.max(scroller.clientWidth - 32, 240), pageWidth * 1.5);

  async function render(index: number) {
    const view = views[index];
    const page = await doc.getPage(index + 1);
    const natural = page.getViewport({ scale: 1 });
    view.dpr = Math.min(devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (fitWidth(natural.width) / natural.width) * view.dpr });
    view.viewport = viewport;
    view.canvas.width = Math.ceil(viewport.width);
    view.canvas.height = Math.ceil(viewport.height);
    for (const element of [view.wrapper, view.canvas, view.overlay]) {
      element.style.width = `${viewport.width / view.dpr}px`;
      element.style.height = `${viewport.height / view.dpr}px`;
    }
    await page.render({ canvas: view.canvas, canvasContext: view.canvas.getContext('2d')!, viewport }).promise;
    drawMarks(view, index);
  }

  // Drag on a page to draw a mark. A mouse always draws; a finger or pen only after "Draw boxes"
  // is on, so on a phone the pages still scroll.
  function enableDrawing(view: PageView, index: number) {
    view.overlay.addEventListener('pointerdown', (event) => {
      const viewport = view.viewport;
      if (!viewport || event.button !== 0) return;
      if (event.pointerType !== 'mouse' && !viewer.classList.contains('drawing')) return;
      event.preventDefault();
      view.overlay.setPointerCapture(event.pointerId);
      const bounds = view.overlay.getBoundingClientRect();
      const toPdf = (x: number, y: number) => viewport.convertToPdfPoint((x - bounds.left) * view.dpr, (y - bounds.top) * view.dpr);
      const [sx, sy] = toPdf(event.clientX, event.clientY);
      const draft = document.createElement('div');
      draft.className = 'redact-box draft';
      view.overlay.append(draft);
      let box: Box | undefined;
      const move = (next: PointerEvent) => {
        const [ex, ey] = toPdf(next.clientX, next.clientY);
        box = { x0: Math.min(sx, ex), y0: Math.min(sy, ey), x1: Math.max(sx, ex), y1: Math.max(sy, ey) };
        place(draft, screenBox(viewport, box, view.dpr));
      };
      const up = () => {
        view.overlay.removeEventListener('pointermove', move);
        draft.remove();
        const rect = box && screenBox(viewport, box, view.dpr);
        if (box && rect && rect.width > 4 && rect.height > 4) change(marks.map((page, i) => (i === index ? [...page, box!] : page)));
      };
      view.overlay.addEventListener('pointermove', move);
      view.overlay.addEventListener('pointerup', up, { once: true });
      view.overlay.addEventListener('pointercancel', up, { once: true });
    });
  }

  // Without a pointer: on a focused page, Enter puts a box in the middle, arrow keys move it
  // (with Shift they resize it), Delete removes it and Escape lets go of it.
  function enableKeys(view: PageView, index: number) {
    view.overlay.tabIndex = 0;
    view.overlay.setAttribute('role', 'group');
    view.overlay.setAttribute('aria-label', t('rd.pageKeys', { n: index + 1 }));
    view.overlay.addEventListener('keydown', (event) => {
      const viewport = view.viewport;
      if (!viewport || event.target !== view.overlay) return;
      const { width, height } = viewport;
      const toBox = (left: number, top: number, right: number, bottom: number): Box => {
        const [ax, ay] = viewport.convertToPdfPoint(left, top);
        const [bx, by] = viewport.convertToPdfPoint(right, bottom);
        return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
      };
      const active = keyBox && marks[index].includes(keyBox) ? keyBox : undefined;
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (event.key === 'Enter' && !active) {
        const added = (keyBox = toBox(width * 0.4, height * 0.475, width * 0.6, height * 0.525));
        change(marks.map((page, i) => (i === index ? [...page, added] : page)));
      } else if (!active) return;
      else if (step) {
        const [ax, ay] = viewport.convertToViewportPoint(active.x0, active.y0);
        const [bx, by] = viewport.convertToViewportPoint(active.x1, active.y1);
        let [left, top, right, bottom] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
        const dx = step[0] * width * 0.01;
        const dy = step[1] * height * 0.01;
        if (event.shiftKey) {
          right = Math.min(width, Math.max(left + 8, right + dx));
          bottom = Math.min(height, Math.max(top + 8, bottom + dy));
        } else {
          const mx = Math.min(width - right, Math.max(-left, dx));
          const my = Math.min(height - bottom, Math.max(-top, dy));
          [left, top, right, bottom] = [left + mx, top + my, right + mx, bottom + my];
        }
        // One Undo step takes the whole box away, so moving it isn't added to the history.
        const moved = (keyBox = toBox(left, top, right, bottom));
        marks = marks.map((page, i) => (i === index ? page.map((box) => (box === active ? moved : box)) : page));
        refresh();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        keyBox = undefined;
        change(marks.map((page, i) => (i === index ? page.filter((box) => box !== active) : page)));
      } else if (event.key === 'Escape') {
        keyBox = undefined;
        refresh();
      } else return;
      event.preventDefault();
    });
  }

  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void render(Number((entry.target as HTMLElement).dataset.index));
      }
    },
    { root: scroller, rootMargin: '800px 0px' },
  );
  for (let index = 0; index < doc.numPages; index++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'redact-page';
    wrapper.dataset.index = String(index);
    // Placeholder size until the page renders, so the scrollbar is about right from the start.
    const width = fitWidth(first.width);
    Object.assign(wrapper.style, { width: `${width}px`, height: `${(width * first.height) / first.width}px` });
    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    overlay.className = 'redact-overlay';
    wrapper.append(canvas, overlay);
    scroller.append(wrapper);
    const view: PageView = { wrapper, canvas, overlay, dpr: 1 };
    views.push(view);
    enableDrawing(view, index);
    enableKeys(view, index);
    observer.observe(wrapper);
  }

  /** Marks what `find` picks out of every page's text; returns every match, per page. */
  async function markEverywhere(find: Finder, busy: HTMLButtonElement) {
    busy.disabled = true;
    const found: Box[][] = [];
    try {
      for (let index = 0; index < doc.numPages; index++) {
        const view = views[index];
        view.items ??= ((await (await doc.getPage(index + 1)).getTextContent()).items as unknown as TextItemLike[]).filter(
          (item) => typeof item.str === 'string',
        );
        found.push(findBoxes(view.items, find));
      }
    } finally {
      busy.disabled = false;
    }
    // Running the same search twice marks nothing twice.
    const fresh = found.map((page, i) => page.filter((box) => !marks[i].some((mark) => same(mark, box))));
    if (fresh.some((page) => page.length)) change(marks.map((page, i) => [...page, ...fresh[i]]));
    return found;
  }
  const sum = (pages: Box[][]) => pages.reduce((total, page) => total + page.length, 0);

  find.onsubmit = async (event) => {
    event.preventDefault();
    const query = search.value.trim();
    if (!query) return;
    const total = sum(await markEverywhere(occurrences(query), markAll));
    count.textContent = total ? t('rd.found', { n: total }) : t('rd.none', { text: query });
  };
  personal.onclick = async () => {
    if (personal.getAttribute('aria-pressed') === 'true') {
      change(marks.map((page, i) => page.filter((box) => !isPersonal(box, i))));
      return;
    }
    const found = await markEverywhere(personalData, personal);
    personalFound = found;
    refresh();
    count.textContent = sum(found) ? t('rd.personalFound', { n: sum(found) }) : t('rd.personalNone');
  };
  undo.onclick = () => {
    marks = history.pop() ?? marks;
    refresh();
  };
  clear.onclick = () => change(marks.map(() => []));
  refresh();

  return {
    save: (options, onProgress) =>
      rasterize(doc, file.name.replace(/\.pdf$/i, ''), { ...options, marks: (index) => marks[index] }, onProgress),
    destroy() {
      observer.disconnect();
      void doc.loadingTask.destroy();
      viewer.classList.remove('redact-pdf', 'drawing');
      viewer.replaceChildren();
    },
  };
}
