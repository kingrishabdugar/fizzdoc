// Collage Maker: 1 to 9 photos in a grid, each one moved and zoomed inside its own frame, with a gap, round
// corners, a background colour and words or emoji on top. The preview works from small copies of the photos;
// saving decodes each one at full size, one at a time, so phones don't run out of memory.
import './remove-bg.css';
import './photo-edit.css';
import { LAYOUTS, cells, fit, frame, place, type Cell } from '../engine/photo';
import type { Output } from '../engine/local';
import { stickerText } from './sticker-text';
import { bringIntoView, button, decode, element, encode, row, saveButton, slider, tabs, throttle, type Icon } from './editor-ui';
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
const LABELS: Record<Tab, [Icon, UiKey]> = { layout: ['layout', 'co.layout'], photo: ['photo', 'co.photo'], space: ['space', 'co.space'], text: ['text', 'st.text'] };
const BACKGROUNDS = { white: '#ffffff', black: '#111111' } as const;

/** Where a photo sits inside its frame; it follows the photo when the list is reordered. */
interface Crop {
  zoom: number;
  cx: number;
  cy: number;
}
const CENTRE: Crop = { zoom: 1, cx: 0.5, cy: 0.5 };

export async function openCollage(files: File[], viewer: HTMLElement): Promise<Collage> {
  const state = { layout: 0, shape: 'square' as Shape, gap: 1.5, corners: 0, background: '#ffffff' as string };
  const crops = new Map<File, Crop>();
  const thumbs = new Map<File, ImageBitmap>();
  let photos: File[] = [];
  let selected = 0;
  let destroyed = false;
  const lang = document.documentElement.lang || undefined;
  const percent = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const decimal = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /** A small copy of a photo for the preview (nothing bigger is kept in memory). */
  const thumb = async (file: File) => {
    const full = await decode(file);
    const [w, h] = fit(full.width, full.height, PREVIEW);
    const small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    full.close();
    return small;
  };

  const stage = element('div', 'bg-stage');
  const canvas = element('canvas', 'bg-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('co.preview'));
  stage.append(canvas);

  const layoutCells = (): Cell[] => {
    const [counts, columns] = LAYOUTS[photos.length][state.layout];
    return cells(counts, columns);
  };
  /** Collage size from its longest side, or from its short side (the saved sizes). */
  const sized = (longest: number): [number, number] => {
    const ratio = SHAPES[state.shape];
    return ratio >= 1 ? [longest, Math.round(longest / ratio)] : [Math.round(longest * ratio), longest];
  };
  const bySide = (short: number): [number, number] => {
    const ratio = SHAPES[state.shape];
    return ratio >= 1 ? [Math.round(short * ratio), short] : [short, Math.round(short / ratio)];
  };
  /** Photo `i`'s cell in pixels on a W×H collage. */
  const box = (i: number, W: number, H: number) => place(layoutCells()[i], W, H, (state.gap / 100) * Math.min(W, H));
  /** Draws a photo (any size of it: the frame works in fractions) into cell `i`. */
  const drawCell = (context: CanvasRenderingContext2D, image: ImageBitmap, i: number, W: number, H: number) => {
    const [dx, dy, dw, dh] = box(i, W, H);
    const crop = crops.get(photos[i]) ?? CENTRE;
    const [sx, sy, sw, sh] = frame(image.width, image.height, dw / dh, crop.zoom, crop.cx, crop.cy);
    context.save();
    context.beginPath();
    context.roundRect(dx, dy, dw, dh, (state.corners / 100) * Math.min(W, H));
    context.clip();
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    context.restore();
  };
  let text: ReturnType<typeof stickerText> | undefined;
  /** The preview, from the small copies. */
  const draw = throttle(() => {
    [canvas.width, canvas.height] = sized(PREVIEW);
    const context = canvas.getContext('2d')!;
    context.fillStyle = state.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    photos.forEach((file, i) => {
      const image = thumbs.get(file);
      if (image) drawCell(context, image, i, canvas.width, canvas.height);
    });
    // The picked photo is outlined while the Photo tab is open.
    if (ui.current() === 'photo' && photos.length) {
      const [dx, dy, dw, dh] = box(selected, canvas.width, canvas.height);
      context.lineWidth = Math.max(3, canvas.width * 0.004);
      context.strokeStyle = '#ffb547';
      context.strokeRect(dx, dy, dw, dh);
    }
    text?.draw(context, canvas.width, canvas.height, ui.current() === 'text');
  });

  // ---- Top bar: a note (too many photos, or one that can't be read), and save ----
  const top = element('div', 'pe-top');
  const note = element('p', 'bg-hint co-note');
  note.setAttribute('role', 'status');
  top.append(note, saveButton(t('ws.download')));

  const ui = tabs(viewer, TABS, (key) => [LABELS[key][0], t(LABELS[key][1])], () => draw());
  const panels = ui.panels;

  // ---- Layout: the grid, the shape and the size ----
  const layoutRow = row(t('co.layout'), 'pe-looks co-layouts');
  let builtLayouts = '';
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

  // ---- Photo: pick one (on the picture, or with the numbered buttons), then move and zoom it in its frame ----
  const pickRow = row(t('co.photo'), 'pe-chips');
  const zoom = slider(t('pe.zoom'), 1, 3, 0.05, (v) => `${decimal.format(v)}×`, (value) => {
    current().zoom = value;
    draw();
  });
  const resetPhoto = button(t('pe.reset'));
  resetPhoto.onclick = () => {
    crops.delete(photos[selected]);
    sync();
  };
  panels.photo.append(element('p', 'bg-hint', t('co.tapHint')), pickRow, zoom.wrap, resetPhoto, element('p', 'bg-hint', t('co.order')));
  const current = () => {
    const file = photos[selected];
    if (!crops.has(file)) crops.set(file, { ...CENTRE });
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
  // Any colour: a real button that opens the browser's own colour picker (the picker itself stays hidden).
  const picker = element('input');
  picker.type = 'color';
  picker.value = '#ff8a00';
  picker.className = 'bg-hidden';
  picker.setAttribute('aria-label', t('bg.custom'));
  picker.oninput = () => {
    state.background = picker.value;
    sync();
  };
  const custom = button(t('bg.custom'));
  custom.onclick = () => {
    state.background = picker.value;
    sync();
    picker.click();
  };
  backgroundRow.append(...backgroundButtons, custom, picker);
  panels.space.append(gap.wrap, corners.wrap, backgroundRow);

  /** Reflects the state in the controls and redraws. */
  function sync() {
    // The layout buttons are rebuilt only when the photo count or the shape changes, so focus stays put.
    const key = `${photos.length}|${state.shape}`;
    if (key !== builtLayouts) {
      builtLayouts = key;
      layoutRow.replaceChildren(
        ...(LAYOUTS[photos.length] ?? []).map(([counts, columns], index) => {
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
          node.onclick = () => {
            state.layout = index;
            sync();
          };
          return node;
        }),
      );
    }
    [...layoutRow.children].forEach((node, i) => node.setAttribute('aria-pressed', String(i === state.layout)));
    [...pickRow.children].forEach((node, i) => node.setAttribute('aria-pressed', String(i === selected)));
    shapeButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.keys(SHAPES)[i] === state.shape)));
    const preset = (Object.values(BACKGROUNDS) as string[]).includes(state.background);
    backgroundButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.values(BACKGROUNDS)[i] === state.background)));
    custom.setAttribute('aria-pressed', String(!preset));
    gap.set(state.gap);
    corners.set(state.corners);
    if (photos.length) zoom.set(current().zoom);
    const picked = sizeSelect.value || String(SIZES[0]);
    sizeSelect.replaceChildren(...SIZES.map((short) => new Option(t('bg.widthOption', { w: bySide(short)[0], h: bySide(short)[1] }), String(short))));
    sizeSelect.value = picked;
    canvas.tabIndex = ui.current() === 'photo' ? 0 : -1; // arrow keys move the picked photo
    draw();
  }

  // ---- On the picture: tap a photo to pick it, drag to move it in its frame; arrow keys do the same ----
  /** Moves the picked photo by a fraction of its frame, stopping at the photo's edges. */
  const nudge = (crop: Crop, from: { cx: number; cy: number }, dx: number, dy: number) => {
    const image = thumbs.get(photos[selected]);
    if (!image) return;
    const [, , dw, dh] = box(selected, canvas.width, canvas.height);
    const [, , sw, sh] = frame(image.width, image.height, dw / dh, crop.zoom, crop.cx, crop.cy);
    const clamp = (v: number, half: number) => Math.min(1 - half, Math.max(half, v));
    // Dragging the photo right shows more of its left side.
    crop.cx = clamp(from.cx - dx * (sw / image.width), sw / image.width / 2);
    crop.cy = clamp(from.cy - dy * (sh / image.height), sh / image.height / 2);
    draw();
  };
  let drag: { id: number; x: number; y: number; cx: number; cy: number } | undefined;
  canvas.addEventListener('pointerdown', (event) => {
    if (drag || event.defaultPrevented || event.button !== 0 || ui.current() !== 'photo') return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const index = photos.findIndex((_, i) => {
      const [dx, dy, dw, dh] = box(i, canvas.width, canvas.height);
      return x >= dx && x <= dx + dw && y >= dy && y <= dy + dh;
    });
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
    const rect = canvas.getBoundingClientRect();
    const [, , dw, dh] = box(selected, canvas.width, canvas.height);
    const scale = canvas.width / rect.width;
    nudge(current(), drag, ((event.clientX - drag.x) * scale) / dw, ((event.clientY - drag.y) * scale) / dh);
  });
  for (const type of ['pointerup', 'pointercancel'] as const)
    canvas.addEventListener(type, (event) => {
      if (event.pointerId === drag?.id) drag = undefined;
    });
  canvas.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]; // moves the photo, like a drag
    if (!step || ui.current() !== 'photo' || !photos.length) return;
    event.preventDefault();
    const by = event.shiftKey ? 0.2 : 0.05;
    const crop = current();
    nudge(crop, crop, step[0] * by, step[1] * by);
  });

  /**
   * Follows the file list: new photos get a small copy, removed ones are let go, the order is the list's.
   * A photo the browser can't read is left out and named in the note.
   */
  async function update(list: File[]) {
    const usable: File[] = [];
    const unreadable: string[] = [];
    for (const file of list.slice(0, MAX)) {
      if (!thumbs.has(file))
        try {
          thumbs.set(file, await thumb(file));
        } catch {
          unreadable.push(file.name);
          continue;
        }
      if (destroyed) return;
      usable.push(file);
    }
    for (const [file, image] of thumbs)
      if (!usable.includes(file)) {
        image.close();
        thumbs.delete(file);
        crops.delete(file);
      }
    if (!usable.length) {
      const { LocalError } = await import('../engine/local');
      throw new LocalError('BAD_IMAGE');
    }
    if (usable.length !== photos.length) state.layout = 0;
    photos = usable;
    selected = Math.min(selected, photos.length - 1);
    note.textContent = [list.length > MAX ? t('co.max') : '', unreadable.length ? `${t('error.BAD_IMAGE')} (${unreadable.join(', ')})` : ''].filter(Boolean).join(' ');
    pickRow.replaceChildren(
      ...photos.map((file, i) => {
        const node = button(String(i + 1));
        node.setAttribute('aria-label', `${i + 1}. ${file.name}`);
        node.onclick = () => {
          selected = i;
          sync();
        };
        return node;
      }),
    );
    sync();
  }
  // Updates run one after another, so a quick add-then-remove can't finish in the wrong order.
  let pending: Promise<void> = Promise.resolve();
  const queue = (list: File[]) => (pending = pending.catch(() => {}).then(() => update(list)));

  text = stickerText(canvas, draw, () => ui.current() !== 'text');
  panels.text.append(text.panel);
  await queue(files);
  viewer.classList.add('bg-editor', 'pe-editor', 'co-editor');
  viewer.replaceChildren(top, stage, ui.tabList, ...TABS.map((key) => panels[key]));
  ui.show('layout');
  bringIntoView(viewer);

  return {
    update: (list) => void queue(list),
    async save(options) {
      await pending; // the collage shows every photo in the list before it is saved
      await document.fonts.ready;
      const format = options.format === 'png' ? 'png' : options.format === 'webp' ? 'webp' : 'jpg';
      const [W, H] = bySide(Number(sizeSelect.value));
      const out = new OffscreenCanvas(W, H);
      const context = out.getContext('2d') as unknown as CanvasRenderingContext2D;
      context.fillStyle = state.background;
      context.fillRect(0, 0, W, H);
      // One photo at a time at full size, let go as soon as it is drawn.
      for (const [i, file] of photos.entries()) {
        const image = await decode(file);
        drawCell(context, image, i, W, H);
        image.close();
      }
      text?.draw(context, W, H);
      const { blob, ext } = await encode(out, format);
      return { blob, name: `collage.${ext}`, summary: `${W} × ${H} px` };
    },
    destroy() {
      destroyed = true;
      for (const image of thumbs.values()) image.close();
      viewer.classList.remove('bg-editor', 'pe-editor', 'co-editor');
      delete viewer.dataset.tab;
      viewer.replaceChildren();
    },
  };
}
