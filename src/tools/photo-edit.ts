// Photo Editor: frame the photo in a shape, turn and flip it, set light and colour, pick a look, add words
// and emoji, then save. Every change redraws from the original photo, so edits never pile up blur.
import './remove-bg.css';
import './photo-edit.css';
import { FILTERS, NONE, adjustPixels, combine, fit, frame, turned, type Adjust, type Filter } from '../engine/photo';
import type { Output } from '../engine/local';
import { t, type UiKey } from '../i18n';

export interface PhotoEditor {
  save(options: { format?: string }): Promise<Output>;
  destroy(): void;
}

/** Longest side of the on-screen preview; saving works from the full-size photo. */
const PREVIEW = 1200;
/** Frame shapes as width ÷ height; 0 keeps the photo's own. */
const SHAPES = { original: 0, square: 1, portrait: 4 / 5, wide: 16 / 9, story: 9 / 16 } as const;
type Shape = keyof typeof SHAPES;
const SLIDERS = ['brightness', 'contrast', 'saturation', 'warmth'] as const;
const SIZES = [100, 75, 50, 25];

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const button = (label: string, className = 'bg-btn') => {
  const node = element('button', className, label);
  node.type = 'button';
  return node;
};

export async function openPhotoEditor(file: File, viewer: HTMLElement): Promise<PhotoEditor> {
  let photo: ImageBitmap;
  try {
    photo = await createImageBitmap(file); // also turns phone photos the right way up (EXIF)
  } catch {
    const { LocalError } = await import('../engine/local');
    throw new LocalError('BAD_IMAGE');
  }
  const state = { shape: 'original' as Shape, zoom: 1, cx: 0.5, cy: 0.5, turns: 0, flipX: false, flipY: false, look: 'original' as Filter, own: { ...NONE } as Adjust };
  /** The kept part of the turned photo: [x, y, width, height] in photo pixels. */
  const kept = () => {
    const [tw, th] = turned(photo.width, photo.height, state.turns);
    return { tw, th, box: frame(tw, th, SHAPES[state.shape], state.zoom, state.cx, state.cy) };
  };

  viewer.classList.add('bg-editor', 'pe-editor');
  const stage = element('div', 'bg-stage');
  const canvas = element('canvas', 'bg-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('pe.preview'));
  stage.append(canvas);
  const compare = button(t('bg.compare'), 'bg-btn bg-compare');
  let text: ReturnType<typeof import('./sticker-text').stickerText> | undefined;
  let original = false;

  /** Draws the edited photo onto `target` with its longest side at most `longest` px. `plain` skips colour and text. */
  const paint = (target: HTMLCanvasElement | OffscreenCanvas, longest: number, plain = false, fill?: string) => {
    const { tw, th, box } = kept();
    const [x, y, w, h] = box;
    [target.width, target.height] = fit(w, h, longest);
    const context = target.getContext('2d') as CanvasRenderingContext2D;
    if (fill) {
      context.fillStyle = fill;
      context.fillRect(0, 0, target.width, target.height);
    }
    const s = target.width / w;
    // Flip on screen, then turn, then draw the photo centred: the frame picks the kept part.
    context.setTransform(s, 0, 0, s, -x * s, -y * s);
    context.translate(tw / 2, th / 2);
    context.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
    context.rotate((state.turns * Math.PI) / 2);
    context.drawImage(photo, -photo.width / 2, -photo.height / 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (plain) return;
    const adjust = combine(FILTERS[state.look], state.own);
    if (Object.values(adjust).some(Boolean)) {
      const pixels = context.getImageData(0, 0, target.width, target.height);
      adjustPixels(pixels.data, adjust);
      context.putImageData(pixels, 0, 0);
    }
    text?.draw(context, target.width, target.height, target === canvas);
  };
  // Sliders fire fast: draw at most once a frame.
  let queued = false;
  const draw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint(canvas, PREVIEW, original);
    });
  };

  const group = (title: string) => {
    const box = element('fieldset', 'bg-group');
    box.append(element('legend', '', title));
    return box;
  };
  const row = (label: string) => {
    const node = element('div', 'bg-tools');
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', label);
    return node;
  };
  const slider = (label: string, min: number, max: number, step: number, onInput: (value: number) => void) => {
    const range = element('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.setAttribute('aria-label', label);
    range.oninput = () => onInput(Number(range.value));
    const wrap = element('label', 'bg-brush pe-slider', label);
    wrap.append(range);
    return { range, wrap };
  };

  // ---- Crop and turn ----
  const cropBox = group(t('pe.crop'));
  const shapeRow = row(t('pe.shape'));
  const shapeButtons = (Object.keys(SHAPES) as Shape[]).map((shape) => {
    const node = button(t(`pe.${shape}` as UiKey));
    node.onclick = () => {
      Object.assign(state, { shape, zoom: 1, cx: 0.5, cy: 0.5 });
      sync();
    };
    return node;
  });
  shapeRow.append(...shapeButtons);
  const zoom = slider(t('pe.zoom'), 1, 3, 0.05, (value) => {
    state.zoom = value;
    sync();
  });
  const turnRow = row(t('pe.turn'));
  const left = button(t('pe.left'));
  left.onclick = () => {
    state.turns = (state.turns + 3) % 4;
    sync();
  };
  const right = button(t('pe.right'));
  right.onclick = () => {
    state.turns = (state.turns + 1) % 4;
    sync();
  };
  const flipH = button(t('pe.flipH'));
  flipH.onclick = () => {
    state.flipX = !state.flipX;
    sync();
  };
  const flipV = button(t('pe.flipV'));
  flipV.onclick = () => {
    state.flipY = !state.flipY;
    sync();
  };
  turnRow.append(left, right, flipH, flipV);
  const dragHint = element('p', 'bg-hint', t('pe.dragHint'));
  cropBox.append(shapeRow, zoom.wrap, dragHint, turnRow);

  // ---- Light and colour ----
  const lightBox = group(t('pe.light'));
  const sliders = SLIDERS.map((key) =>
    slider(t(`pe.${key}` as UiKey), -100, 100, 1, (value) => {
      state.own[key] = value;
      draw();
    }),
  );
  const reset = button(t('pe.reset'));
  reset.onclick = () => {
    state.own = { ...NONE };
    sync();
  };
  lightBox.append(...sliders.map((s) => s.wrap), reset);

  // ---- Looks: each button shows the photo with that look ----
  const looksBox = group(t('pe.looks'));
  const lookRow = row(t('pe.looks'));
  lookRow.classList.add('pe-looks');
  const lookButtons = (Object.keys(FILTERS) as Filter[]).map((look) => {
    const node = button('', 'bg-btn pe-look');
    const thumb = element('canvas');
    [thumb.width, thumb.height] = fit(photo.width, photo.height, 96);
    const context = thumb.getContext('2d')!;
    context.drawImage(photo, 0, 0, thumb.width, thumb.height);
    const pixels = context.getImageData(0, 0, thumb.width, thumb.height);
    adjustPixels(pixels.data, FILTERS[look]);
    context.putImageData(pixels, 0, 0);
    node.append(thumb, element('span', '', t(`pe.${look}` as UiKey)));
    node.onclick = () => {
      state.look = look;
      sync();
    };
    return node;
  });
  lookRow.append(...lookButtons);
  looksBox.append(lookRow);

  // ---- Size ----
  const sizeBox = group(t('bg.size'));
  const sizeSelect = element('select');
  sizeSelect.setAttribute('aria-label', t('bg.size'));
  sizeBox.append(sizeSelect);

  /** Reflects the state in the controls and redraws. */
  function sync() {
    shapeButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.keys(SHAPES)[i] === state.shape)));
    lookButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.keys(FILTERS)[i] === state.look)));
    flipH.setAttribute('aria-pressed', String(state.flipX));
    flipV.setAttribute('aria-pressed', String(state.flipY));
    zoom.range.value = String(state.zoom);
    sliders.forEach((s, i) => (s.range.value = String(state.own[SLIDERS[i]])));
    const movable = state.shape !== 'original' || state.zoom > 1;
    dragHint.hidden = !movable;
    canvas.classList.toggle('pe-movable', movable);
    // Sizes follow the kept part of the photo.
    const [, , w, h] = kept().box;
    const chosen = sizeSelect.value || '100';
    sizeSelect.replaceChildren(
      ...SIZES.map((pct) => {
        const [sw, sh] = fit(w, h, Math.round((Math.max(w, h) * pct) / 100));
        return new Option(t(pct === 100 ? 'bg.original' : 'bg.widthOption', { w: sw, h: sh }), String(pct));
      }),
    );
    sizeSelect.value = chosen;
    draw();
  }

  // ---- Move the photo inside the frame by dragging (unless a text layer took the touch) ----
  let pan: { x: number; y: number; cx: number; cy: number } | undefined;
  const clamp = (value: number, half: number) => Math.min(1 - half, Math.max(half, value));
  const startPan = (event: PointerEvent) => {
    if (event.defaultPrevented || event.button !== 0 || !canvas.classList.contains('pe-movable')) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pan = { x: event.clientX, y: event.clientY, cx: state.cx, cy: state.cy };
  };
  canvas.addEventListener('pointermove', (event) => {
    if (!pan) return;
    const rect = canvas.getBoundingClientRect();
    const { tw, th, box } = kept();
    const [, , w, h] = box;
    // Dragging the photo right shows more of its left side: the frame's centre moves the other way.
    state.cx = clamp(pan.cx - ((event.clientX - pan.x) / rect.width) * (w / tw), w / tw / 2);
    state.cy = clamp(pan.cy - ((event.clientY - pan.y) / rect.height) * (h / th), h / th / 2);
    draw();
  });
  for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => (pan = undefined));

  const showOriginal = (on: boolean) => {
    original = on;
    compare.classList.toggle('active', on);
    draw();
  };
  compare.addEventListener('pointerdown', () => showOriginal(true));
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) compare.addEventListener(type, () => showOriginal(false));
  compare.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') showOriginal(true);
  });
  compare.addEventListener('keyup', () => showOriginal(false));

  // The text layers come from the Sticker Maker; registered first, so a touch on a layer moves the layer.
  text = (await import('./sticker-text')).stickerText(canvas, draw, () => false);
  canvas.addEventListener('pointerdown', startPan);
  viewer.replaceChildren(stage, compare, cropBox, lightBox, looksBox, text.panel, sizeBox);
  sync();

  return {
    async save(options) {
      await document.fonts.ready;
      const [, , w, h] = kept().box;
      const format = options.format === 'png' ? 'png' : options.format === 'webp' ? 'webp' : 'jpg';
      const out = new OffscreenCanvas(1, 1);
      // JPG has no see-through pixels: a clear part of the photo becomes white instead of black.
      paint(out, Math.round((Math.max(w, h) * Number(sizeSelect.value)) / 100), false, format === 'jpg' ? '#ffffff' : undefined);
      const blob = await out.convertToBlob({ type: format === 'jpg' ? 'image/jpeg' : `image/${format}`, quality: 0.92 });
      return {
        blob,
        name: `${file.name.replace(/\.[^.]+$/, '')}-edited.${format}`,
        summary: `${out.width} × ${out.height} px · ${Math.max(1, Math.round(blob.size / 1024))} KB`,
      };
    },
    destroy() {
      photo.close();
    },
  };
}
