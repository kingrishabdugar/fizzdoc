// Photo Editor: frame the photo in a shape, turn and flip it, set light and colour, pick a look, add words
// and emoji, then save. Every change redraws from the original photo, so edits never pile up blur.
// Layout: a dark editing area with the photo always in view, a bar of tabs (Looks, Crop, Light, Text) and
// one panel at a time. Edits show as they are made; there is no apply step.
import './remove-bg.css';
import './photo-edit.css';
import { FILTERS, NONE, adjustPixels, combine, fit, frame, turned, type Adjust, type Filter } from '../engine/photo';
import type { Output } from '../engine/local';
import { stickerText } from './sticker-text';
import { bringIntoView, button, decode, element, encode, iconButton, row, saveButton, slider, tabs, throttle } from './editor-ui';
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
type Slider = (typeof SLIDERS)[number];
const SIZES = [100, 75, 50, 25];
const TABS = ['looks', 'crop', 'light', 'text'] as const;
type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, UiKey> = { looks: 'pe.looks', crop: 'pe.crop', light: 'pe.light', text: 'st.text' };

export async function openPhotoEditor(file: File, viewer: HTMLElement): Promise<PhotoEditor> {
  const photo = await decode(file);
  const state = { shape: 'original' as Shape, zoom: 1, cx: 0.5, cy: 0.5, turns: 0, flipX: false, flipY: false, look: 'original' as Filter, own: { ...NONE } as Adjust };
  let chosen: Slider = 'brightness'; // the slider shown on phones, and the one a sideways swipe changes
  /** The kept part of the turned photo: [x, y, width, height] in photo pixels. */
  const kept = () => {
    const [tw, th] = turned(photo.width, photo.height, state.turns);
    return { tw, th, box: frame(tw, th, SHAPES[state.shape], state.zoom, state.cx, state.cy) };
  };
  const lang = document.documentElement.lang || undefined;
  const number = new Intl.NumberFormat(lang, { signDisplay: 'exceptZero' });
  const decimal = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  viewer.classList.add('bg-editor', 'pe-editor');
  const stage = element('div', 'bg-stage');
  const canvas = element('canvas', 'bg-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('pe.preview'));
  stage.append(canvas);
  let text: ReturnType<typeof stickerText> | undefined;
  let original = false;

  /**
   * Draws the edited photo onto `target` with its longest side at most `longest` px (and its area at most
   * `maxArea`). `plain` skips colour and text; `fill` paints behind see-through parts.
   */
  const paint = (target: HTMLCanvasElement | OffscreenCanvas, longest: number, plain = false, fill?: string, maxArea?: number) => {
    const { tw, th, box } = kept();
    const [x, y, w, h] = box;
    [target.width, target.height] = fit(w, h, longest, maxArea);
    const context = target.getContext('2d') as CanvasRenderingContext2D;
    const s = target.width / w;
    // Flip on screen, then turn, then draw the photo centred: the frame picks the kept part.
    context.setTransform(s, 0, 0, s, -x * s, -y * s);
    context.translate(tw / 2, th / 2);
    context.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
    context.rotate((state.turns * Math.PI) / 2);
    context.drawImage(photo, -photo.width / 2, -photo.height / 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const adjust = combine(FILTERS[state.look], state.own);
    if (!plain && Object.values(adjust).some(Boolean)) {
      const pixels = context.getImageData(0, 0, target.width, target.height);
      adjustPixels(pixels.data, adjust);
      context.putImageData(pixels, 0, 0);
    }
    if (fill) {
      // Behind the photo, after the colour changes, so a white background stays white.
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = fill;
      context.fillRect(0, 0, target.width, target.height);
      context.globalCompositeOperation = 'source-over';
    }
    // The text's selection box only shows while the Text tab is open.
    if (!plain) text?.draw(context, target.width, target.height, target === canvas && tab() === 'text');
  };
  const draw = throttle(() => paint(canvas, PREVIEW, original));

  // ---- Top bar: hold to compare, and save ----
  const top = element('div', 'pe-top');
  const compare = iconButton('compare', t('bg.compare'), 'bg-btn bg-compare pe-compare');
  top.append(compare, saveButton(t('ws.download')));

  // ---- Tabs ----
  const ui = tabs(viewer, TABS, (key) => [key, t(LABELS[key])], () => draw());
  const panels = ui.panels;
  const tab = () => ui.current();

  // ---- Looks: each one shows the photo with that look ----
  const lookRow = row(t('pe.looks'), 'pe-looks');
  const lookButtons = (Object.keys(FILTERS) as Filter[]).map((look) => {
    const node = button('', 'pe-look');
    const thumb = element('canvas');
    [thumb.width, thumb.height] = fit(photo.width, photo.height, 160);
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
  panels.looks.append(lookRow);

  // ---- Crop and turn, and the size, which follows the crop ----
  const shapeRow = row(t('pe.shape'), 'pe-chips');
  const shapeButtons = (Object.keys(SHAPES) as Shape[]).map((shape) => {
    const node = button(t(`pe.${shape}` as UiKey));
    node.onclick = () => {
      Object.assign(state, { shape, zoom: 1, cx: 0.5, cy: 0.5 });
      sync();
    };
    return node;
  });
  shapeRow.append(...shapeButtons);
  const zoom = slider(t('pe.zoom'), 1, 3, 0.05, (v) => `${decimal.format(v)}×`, (value) => {
    state.zoom = value;
    sync();
  });
  const dragHint = element('p', 'bg-hint', t('pe.dragHint'));
  const turnRow = row(t('pe.turn'), 'pe-chips');
  const turnButton = (label: UiKey, act: () => void) => {
    const node = button(t(label));
    node.onclick = () => {
      act();
      sync();
    };
    return node;
  };
  const flipH = turnButton('pe.flipH', () => {
    state.flipX = !state.flipX;
    state.cx = 1 - state.cx;
  });
  const flipV = turnButton('pe.flipV', () => {
    state.flipY = !state.flipY;
    state.cy = 1 - state.cy;
  });
  // The photo is flipped after it is turned, so with one flip on, a turn goes the other way inside.
  const turn = (right: boolean) => {
    const mirrored = state.flipX !== state.flipY;
    state.turns = (state.turns + (right !== mirrored ? 1 : 3)) % 4;
    [state.cx, state.cy] = right ? [1 - state.cy, state.cx] : [state.cy, 1 - state.cx];
  };
  turnRow.append(turnButton('pe.left', () => turn(false)), turnButton('pe.right', () => turn(true)), flipH, flipV);
  const sizeSelect = element('select');
  sizeSelect.setAttribute('aria-label', t('bg.size'));
  const sizeLabel = element('label', 'pe-size', t('bg.size'));
  sizeLabel.append(sizeSelect);
  panels.crop.append(shapeRow, zoom.wrap, dragHint, turnRow, sizeLabel);

  // ---- Light and colour: on phones one ruler at a time, picked with the chips; on laptops all four ----
  const chipRow = row(t('pe.light'), 'pe-chips pe-light-chips');
  const chips = SLIDERS.map((key) => {
    const node = button(t(`pe.${key}` as UiKey));
    node.onclick = () => {
      chosen = key;
      sync();
    };
    return node;
  });
  const reset = button(t('pe.reset'));
  reset.onclick = () => {
    state.own = { ...NONE };
    sync();
  };
  chipRow.append(...chips, reset);
  const sliders = SLIDERS.map((key) =>
    slider(t(`pe.${key}` as UiKey), -100, 100, 1, (v) => number.format(v), (value) => {
      state.own[key] = value;
      draw();
    }),
  );
  panels.light.append(chipRow, ...sliders.map((s) => s.wrap), element('p', 'bg-hint', t('pe.swipeHint')));

  /** Reflects the state in the controls and redraws. */
  function sync() {
    shapeButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.keys(SHAPES)[i] === state.shape)));
    lookButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(Object.keys(FILTERS)[i] === state.look)));
    chips.forEach((node, i) => node.setAttribute('aria-pressed', String(SLIDERS[i] === chosen)));
    sliders.forEach((s, i) => {
      s.set(state.own[SLIDERS[i]]);
      s.wrap.classList.toggle('on', SLIDERS[i] === chosen);
    });
    flipH.setAttribute('aria-pressed', String(state.flipX));
    flipV.setAttribute('aria-pressed', String(state.flipY));
    zoom.set(state.zoom);
    const movable = state.shape !== 'original' || state.zoom > 1;
    dragHint.hidden = !movable;
    canvas.classList.toggle('pe-movable', movable);
    canvas.tabIndex = movable ? 0 : -1; // arrow keys move the frame too
    // The centre the frame really has (it stops at the photo's edges), so the next drag starts from there.
    const { tw, th, box } = kept();
    const [bx, by, w, h] = box;
    state.cx = (bx + w / 2) / tw;
    state.cy = (by + h / 2) / th;
    const picked = sizeSelect.value || '100';
    sizeSelect.replaceChildren(
      ...SIZES.map((pct) => {
        const [sw, sh] = fit(w, h, Math.round((Math.max(w, h) * pct) / 100), Infinity);
        return new Option(t(pct === 100 ? 'bg.original' : 'bg.widthOption', { w: sw, h: sh }), String(pct));
      }),
    );
    sizeSelect.value = picked;
    draw();
  }

  // ---- Dragging on the photo: Crop moves the photo in the frame, Light changes the chosen slider, Text moves words ----
  let drag: { id: number; x: number; y: number; cx: number; cy: number; value: number } | undefined;
  const clamp = (value: number, half: number) => Math.min(1 - half, Math.max(half, value));
  const startDrag = (event: PointerEvent) => {
    if (drag || event.defaultPrevented || event.button !== 0) return; // one finger at a time; a text layer took it
    if (tab() === 'crop' ? !canvas.classList.contains('pe-movable') : tab() !== 'light') return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: state.cx, cy: state.cy, value: state.own[chosen] };
  };
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.id) return;
    const rect = canvas.getBoundingClientRect();
    if (tab() === 'light') {
      // The photo's full width is the whole range, -100 to +100.
      state.own[chosen] = Math.round(Math.min(100, Math.max(-100, drag.value + ((event.clientX - drag.x) / rect.width) * 200)));
      sliders[SLIDERS.indexOf(chosen)].set(state.own[chosen]);
    } else {
      const { tw, th, box } = kept();
      const [, , w, h] = box;
      // Dragging the photo right shows more of its left side: the frame's centre moves the other way.
      state.cx = clamp(drag.cx - ((event.clientX - drag.x) / rect.width) * (w / tw), w / tw / 2);
      state.cy = clamp(drag.cy - ((event.clientY - drag.y) / rect.height) * (h / th), h / th / 2);
    }
    draw();
  });
  for (const type of ['pointerup', 'pointercancel'] as const)
    canvas.addEventListener(type, (event) => {
      if (event.pointerId === drag?.id) drag = undefined;
    });
  // Without a pointer: arrow keys move the frame (Shift for bigger steps).
  canvas.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step || !canvas.classList.contains('pe-movable')) return;
    event.preventDefault();
    const by = event.shiftKey ? 0.1 : 0.02;
    state.cx += step[0] * by;
    state.cy += step[1] * by;
    sync();
  });

  // ---- Hold to see the original ----
  const showOriginal = (on: boolean) => {
    original = on;
    compare.setAttribute('aria-pressed', String(on));
    draw();
  };
  compare.addEventListener('pointerdown', () => showOriginal(true));
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) compare.addEventListener(type, () => showOriginal(false));
  compare.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') showOriginal(true);
  });
  compare.addEventListener('keyup', () => showOriginal(false));

  // The text layers come from the Sticker Maker; registered first, so a touch on a layer moves the layer.
  text = stickerText(canvas, draw, () => tab() !== 'text');
  panels.text.append(text.panel);
  canvas.addEventListener('pointerdown', startDrag);
  viewer.replaceChildren(top, stage, ui.tabList, ...TABS.map((key) => panels[key]));
  ui.show('looks');
  sync();
  bringIntoView(viewer);

  return {
    async save(options) {
      await document.fonts.ready;
      const [, , w, h] = kept().box;
      const format = options.format === 'png' ? 'png' : options.format === 'webp' ? 'webp' : 'jpg';
      const longest = Math.round((Math.max(w, h) * Number(sizeSelect.value)) / 100);
      // JPG has no see-through pixels: a clear part of the photo becomes white instead of black.
      const render = async (maxArea?: number) => {
        const out = new OffscreenCanvas(1, 1);
        paint(out, longest, false, format === 'jpg' ? '#ffffff' : undefined, maxArea);
        return { out, ...(await encode(out, format)) };
      };
      // Full size first; a phone that can't make a canvas that big (about 16.7 million pixels on iPhone) gets the largest it can.
      const { out, blob, ext } = await render(Infinity).catch(() => render());
      return { blob, name: `${file.name.replace(/\.[^.]+$/, '')}-edited.${ext}`, summary: `${out.width} × ${out.height} px` };
    },
    destroy() {
      photo.close();
      viewer.classList.remove('bg-editor', 'pe-editor');
      delete viewer.dataset.tab;
      viewer.replaceChildren();
    },
  };
}
