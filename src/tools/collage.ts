// Collage Maker: 2 to 9 photos in a grid, each one moved and zoomed inside its own frame, with a gap, round
// corners, a background colour and words or emoji on top. The preview works from small copies of the photos;
// saving decodes each one at full size, one at a time, so phones don't run out of memory.
import './remove-bg.css';
import './photo-edit.css';
import { LAYOUTS, cells, fit, frame, place, type Cell } from '../engine/photo';
import type { Output } from '../engine/local';
import { stickerText } from './sticker-text';
import { button, element, iconButton, row, slider, tabs } from './editor-ui';
import { t, type UiKey } from '../i18n';

export interface Collage {
  save(options: { format?: string }): Promise<Output>;
  update(files: File[]): void;
  destroy(): void;
}

/** Longest side of the on-screen preview, and of the small copy kept of each photo for it. */
const PREVIEW = 1200;
/** At most this many photos; the rest of the list is left out. */
const MAX = 9;
/** Collage shapes as width ÷ height; A4 is for printing. */
const SHAPES = { square: 1, portrait: 4 / 5, story: 9 / 16, wide: 16 / 9, a4: 210 / 297 } as const;
type Shape = keyof typeof SHAPES;
/** Saved size by the short side, in pixels: social posts, sharp, and A4 at 300 dpi. */
const SIZES = [1080, 2160, 2480];
const TABS = ['layout', 'photo', 'space', 'text'] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, [import('./editor-ui').Icon, UiKey]> = {
  layout: ['layout', 'co.layout'],
  photo: ['photo', 'co.photo'],
  space: ['space', 'co.space'],
  text: ['text', 'st.text'],
};
const BACKGROUNDS = { white: '#ffffff', black: '#111111' } as const;

/** Where a photo sits inside its frame; it follows the photo when the list is reordered. */
interface Crop {
  zoom: number;
  cx: number;
  cy: number;
}

export async function openCollage(files: File[], viewer: HTMLElement): Promise<Collage> {
  const state = { layout: 0, shape: 'square' as Shape, gap: 1.5, corners: 0, background: '#ffffff' as string };
  const crops = new Map<File, Crop>();
  const thumbs = new Map<File, ImageBitmap>();
  let photos: File[] = [];
  let selected = 0;
  const lang = document.documentElement.lang || undefined;
  const percent = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const decimal = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /** A small copy of a photo for the preview (and nothing bigger kept in memory). */
  const thumb = async (file: File) => {
    let full: ImageBitmap;
    try {
      full = await createImageBitmap(file);
    } catch {
      const { LocalError } = await import('../engine/local');
      throw new LocalError('BAD_IMAGE');
    }
    const [w, h] = fit(full.width, full.height, PREVIEW);
    const small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    full.close();
    return small;
  };

  viewer.classList.add('bg-editor', 'pe-editor', 'co-editor');
  const stage = element('div', 'bg-stage');
  const canvas = element('canvas', 'bg-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('co.preview'));
  stage.append(canvas);

  const layoutCells = (): Cell[] => {
    const [counts, columns] = LAYOUTS[photos.length][state.layout] ?? LAYOUTS[photos.length][0];
    return cells(counts, columns);
  };
  /** Collage size for a longest side, from the shape. */
  const sized = (longest: number): [number, number] => {
    const ratio = SHAPES[state.shape];
    return ratio >= 1 ? [longest, Math.round(longest / ratio)] : [Math.round(longest * ratio), longest];
  };
  /** Draws photo `i` (any size of it: the frame works in fractions) into its cell. */
  const drawCell = (context: CanvasRenderingContext2D, image: ImageBitmap, i: number, W: number, H: number) => {
    const short = Math.min(W, H);
    const [dx, dy, dw, dh] = place(layoutCells()[i], W, H, (state.gap / 100) * short);
    const crop = crops.get(photos[i]) ?? { zoom: 1, cx: 0.5, cy: 0.5 };
    const [sx, sy, sw, sh] = frame(image.width, image.height, dw / dh, crop.zoom, crop.cx, crop.cy);
    context.save();
    context.beginPath();
    context.roundRect(dx, dy, dw, dh, (state.corners / 100) * short);
    context.clip();
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    context.restore();
    return [dx, dy, dw, dh];
  };
  let text: ReturnType<typeof stickerText> | undefined;
  /** The preview, from the small copies. */
  const paint = () => {
    [canvas.width, canvas.height] = sized(PREVIEW);
    const context = canvas.getContext('2d')!;
    context.fillStyle = state.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    photos.forEach((file, i) => {
      const image = thumbs.get(file);
      if (!image) return;
      const [dx, dy, dw, dh] = drawCell(context, image, i, canvas.width, canvas.height);
      // The picked photo is outlined while the Photo tab is open.
      if (ui.current() === 'photo' && i === selected) {
        context.lineWidth = Math.max(3, canvas.width * 0.004);
        context.strokeStyle = '#ffb547';
        context.strokeRect(dx, dy, dw, dh);
      }
    });
    text?.draw(context, canvas.width, canvas.height, ui.current() === 'text');
  };
  let queued = false;
  const draw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };

  // ---- Top bar: save ----
  const top = element('div', 'pe-top');
  const note = element('p', 'bg-hint co-note');
  const save = iconButton('save', t('ws.download'), 'pe-save');
  save.onclick = () => document.getElementById('run')?.click(); // the page's own save, with its progress and result
  top.append(note, save);

  const ui = tabs(viewer, TABS, (key) => [LABELS[key][0], t(LABELS[key][1])], () => draw());
  const panels = ui.panels;

  // ---- Layout: the grid, the shape and the size ----
  const layoutRow = row(t('co.layout'), 'pe-looks co-layouts');
  const shapeRow = row(t('pe.shape'), 'pe-chips');
  const shapeButtons = (Object.keys(SHAPES) as Shape[]).map((shape) => {
    const node = button(t(shape === 'a4' ? 'co.a4' : (`pe.${shape}` as UiKey)));
    node.onclick = () => {
      state.shape = shape;
      sync();
    };
    return node;
  });
  shapeRow.append(...shapeButtons);
  const sizeSelect = element('select');
  const sizeLabel = element('label', 'pe-size', t('bg.size'));
  sizeLabel.append(sizeSelect);
  panels.layout.append(layoutRow, shapeRow, sizeLabel);

  // ---- Photo: pick one, then move and zoom it in its frame ----
  const zoom = slider(t('pe.zoom'), 1, 3, 0.05, (v) => `${decimal.format(v)}×`, (value) => {
    current().zoom = value;
    draw();
  });
  const resetPhoto = button(t('pe.reset'));
  resetPhoto.onclick = () => {
    crops.set(photos[selected], { zoom: 1, cx: 0.5, cy: 0.5 });
    sync();
  };
  panels.photo.append(element('p', 'bg-hint', t('co.tapHint')), zoom.wrap, resetPhoto, element('p', 'bg-hint', t('co.order')));
  const current = () => {
    const file = photos[selected];
    if (!crops.has(file)) crops.set(file, { zoom: 1, cx: 0.5, cy: 0.5 });
    return crops.get(file)!;
  };

  // ---- Space: gap, corners and background ----
  const gap = slider(t('co.gap'), 0, 5, 0.25, (v) => `${percent.format(v)}%`, (value) => {
    state.gap = value;
    draw();
  });
  const corners = slider(t('co.corners'), 0, 10, 0.5, (v) => `${percent.format(v)}%`, (value) => {
    state.corners = value;
    draw();
  });
  const backgroundRow = row(t('bg.background'), 'pe-chips');
  const backgroundButtons = (Object.keys(BACKGROUNDS) as (keyof typeof BACKGROUNDS)[]).map((key) => {
    const node = button(t(`bg.${key}` as UiKey));
    node.onclick = () => {
      state.background = BACKGROUNDS[key];
      sync();
    };
    return node;
  });
  const colour = element('input');
  colour.type = 'color';
  colour.value = '#ff8a00';
  colour.oninput = () => {
    state.background = colour.value;
    sync();
  };
  const colourLabel = element('label', 'bg-btn co-colour', t('bg.custom'));
  colourLabel.append(colour);
  backgroundRow.append(...backgroundButtons, colourLabel);
  panels.space.append(gap.wrap, corners.wrap, backgroundRow);

  /** Reflects the state in the controls and redraws. */
  function sync() {
    // The layouts for this many photos, each drawn as its grid.
    const options = LAYOUTS[photos.length] ?? [];
    if (state.layout >= options.length) state.layout = 0;
    layoutRow.replaceChildren(
      ...options.map(([counts, columns], index) => {
        const node = button('', 'pe-look');
        const mini = element('canvas');
        [mini.width, mini.height] = sized(96);
        const context = mini.getContext('2d')!;
        context.fillStyle = '#3f3f46';
        for (const cell of cells(counts, columns)) {
          const [x, y, w, h] = place(cell, mini.width, mini.height, 4);
          context.fillRect(x, y, w, h);
        }
        node.append(mini);
        node.setAttribute('aria-label', `${t('co.layout')} ${index + 1}`);
        node.setAttribute('aria-pressed', String(index === state.layout));
        node.onclick = () => {
          state.layout = index;
          sync();
        };
        return node;
      }),
    );
    shapeButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.keys(SHAPES)[i] === state.shape)));
    backgroundButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.values(BACKGROUNDS)[i] === state.background)));
    colourLabel.setAttribute('aria-pressed', String(!(Object.values(BACKGROUNDS) as string[]).includes(state.background)));
    gap.set(state.gap);
    corners.set(state.corners);
    if (photos.length) zoom.set(current().zoom);
    const picked = sizeSelect.value || String(SIZES[0]);
    sizeSelect.replaceChildren(
      ...SIZES.map((short) => {
        const ratio = SHAPES[state.shape];
        const [w, h] = ratio >= 1 ? [Math.round(short * ratio), short] : [short, Math.round(short / ratio)];
        return new Option(t('bg.widthOption', { w, h }), String(short));
      }),
    );
    sizeSelect.value = picked;
    draw();
  }

  // ---- On the picture: tap a photo to pick it, drag to move it in its frame ----
  let drag: { id: number; x: number; y: number; cx: number; cy: number } | undefined;
  const hitCell = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const short = Math.min(canvas.width, canvas.height);
    return layoutCells().findIndex((cell) => {
      const [dx, dy, dw, dh] = place(cell, canvas.width, canvas.height, (state.gap / 100) * short);
      return x >= dx && x <= dx + dw && y >= dy && y <= dy + dh;
    });
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (drag || event.defaultPrevented || event.button !== 0 || ui.current() !== 'photo') return;
    const index = hitCell(event);
    if (index < 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    selected = index;
    const crop = current();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: crop.cx, cy: crop.cy };
    sync();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.id) return;
    const image = thumbs.get(photos[selected]);
    if (!image) return;
    const rect = canvas.getBoundingClientRect();
    const short = Math.min(canvas.width, canvas.height);
    const [, , dw, dh] = place(layoutCells()[selected], canvas.width, canvas.height, (state.gap / 100) * short);
    const crop = current();
    const [, , sw, sh] = frame(image.width, image.height, dw / dh, crop.zoom, crop.cx, crop.cy);
    // Dragging the photo right shows more of its left side; the frame stops at the photo's edges.
    const clamp = (v: number, half: number) => Math.min(1 - half, Math.max(half, v));
    const scale = canvas.width / rect.width;
    crop.cx = clamp(drag.cx - (((event.clientX - drag.x) * scale) / dw) * (sw / image.width), sw / image.width / 2);
    crop.cy = clamp(drag.cy - (((event.clientY - drag.y) * scale) / dh) * (sh / image.height), sh / image.height / 2);
    draw();
  });
  for (const type of ['pointerup', 'pointercancel'] as const)
    canvas.addEventListener(type, (event) => {
      if (event.pointerId === drag?.id) drag = undefined;
    });

  /** Follows the file list: new photos get a small copy, removed ones are let go, the order is the list's. */
  async function update(list: File[]) {
    const next = list.slice(0, MAX);
    note.textContent = list.length > MAX ? t('co.max') : '';
    for (const file of next) if (!thumbs.has(file)) thumbs.set(file, await thumb(file));
    for (const [file, image] of thumbs)
      if (!next.includes(file)) {
        image.close();
        thumbs.delete(file);
        crops.delete(file);
      }
    if (next.length !== photos.length) state.layout = 0;
    photos = next;
    selected = Math.min(selected, photos.length - 1);
    sync();
  }

  text = stickerText(canvas, draw, () => ui.current() !== 'text');
  panels.text.append(text.panel);
  await update(files);
  viewer.replaceChildren(top, stage, ui.tabList, ...TABS.map((key) => panels[key]));
  ui.show('layout');
  requestAnimationFrame(() => requestAnimationFrame(() => viewer.scrollIntoView({ block: 'start', behavior: 'instant' })));

  return {
    update: (list) => void update(list),
    async save(options) {
      await document.fonts.ready;
      const format = options.format === 'png' ? 'png' : options.format === 'webp' ? 'webp' : 'jpg';
      const short = Number(sizeSelect.value);
      const ratio = SHAPES[state.shape];
      const [W, H] = fit(...((ratio >= 1 ? [Math.round(short * ratio), short] : [short, Math.round(short / ratio)]) as [number, number]), Infinity);
      const out = new OffscreenCanvas(W, H);
      const context = out.getContext('2d') as unknown as CanvasRenderingContext2D;
      context.fillStyle = state.background;
      context.fillRect(0, 0, W, H);
      // One photo at a time at full size, let go as soon as it is drawn.
      for (const [i, file] of photos.entries()) {
        const image = await createImageBitmap(file);
        drawCell(context, image, i, W, H);
        image.close();
      }
      text?.draw(context, W, H);
      const type = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
      const blob = await out.convertToBlob({ type, quality: 0.92 });
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[blob.type] ?? format;
      return { blob, name: `collage.${ext}`, summary: `${W} × ${H} px` };
    },
    destroy() {
      for (const image of thumbs.values()) image.close();
      viewer.classList.remove('bg-editor', 'pe-editor', 'co-editor');
      delete viewer.dataset.tab;
      viewer.replaceChildren();
    },
  };
}
