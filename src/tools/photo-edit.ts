// Photo Editor: frame the photo in a shape, turn and flip it, set light and colour, pick a look, add words
// and emoji, then save. Every change redraws from the original photo, so edits never pile up blur.
// Layout: a dark editing area with the photo always in view, a bar of tabs (Looks, Crop, Light, Text) and
// one panel at a time. Edits show as they are made; there is no apply step.
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
type Slider = (typeof SLIDERS)[number];
const SIZES = [100, 75, 50, 25];
const TABS = ['looks', 'crop', 'light', 'text'] as const;
type Tab = (typeof TABS)[number];

// Our own line icons, drawn like the site's tool icons.
const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  looks: '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="9" r="5"/><circle cx="12" cy="15" r="5"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  light: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  compare: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 3v18"/>',
  save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};
const LABELS: Record<Tab, UiKey> = { looks: 'pe.looks', crop: 'pe.crop', light: 'pe.light', text: 'st.text' };

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
/** A button with one of the icons above and a visible label. */
const iconButton = (icon: keyof typeof ICONS, label: string, className: string) => {
  const node = button('', className);
  node.innerHTML = svg(ICONS[icon]);
  node.append(element('span', '', label));
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
  let tab: Tab = 'looks';
  let chosen: Slider = 'brightness'; // the slider shown on phones, and the one a sideways swipe changes
  /** The kept part of the turned photo: [x, y, width, height] in photo pixels. */
  const kept = () => {
    const [tw, th] = turned(photo.width, photo.height, state.turns);
    return { tw, th, box: frame(tw, th, SHAPES[state.shape], state.zoom, state.cx, state.cy) };
  };
  const number = new Intl.NumberFormat(document.documentElement.lang || undefined, { signDisplay: 'exceptZero' });

  viewer.classList.add('bg-editor', 'pe-editor');
  const stage = element('div', 'bg-stage');
  const canvas = element('canvas', 'bg-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('pe.preview'));
  stage.append(canvas);
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
    // The text's selection box only shows while the Text tab is open.
    text?.draw(context, target.width, target.height, target === canvas && tab === 'text');
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

  const row = (label: string, className = 'bg-tools') => {
    const node = element('div', className);
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', label);
    return node;
  };
  /** A ruler: the browser's own range input (so keys and screen readers work), with its name and a big signed value. */
  const slider = (label: string, min: number, max: number, step: number, show: (value: number) => string, onInput: (value: number) => void) => {
    const range = element('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.setAttribute('aria-label', label);
    const value = element('span', 'pe-value');
    value.setAttribute('aria-hidden', 'true'); // the range announces itself through aria-valuetext
    const head = element('span', 'pe-slider-head');
    head.append(element('span', 'pe-name', label), value);
    const wrap = element('label', 'pe-slider');
    wrap.append(head, range);
    const set = (v: number) => {
      range.value = String(v);
      value.textContent = show(v);
      range.setAttribute('aria-valuetext', value.textContent);
      // -1…1 for the fill from the middle (or 0…1 from the start for Zoom).
      range.style.setProperty('--v', String(min < 0 ? v / max : (v - min) / (max - min)));
    };
    range.oninput = () => {
      set(Number(range.value));
      onInput(Number(range.value));
    };
    return { range, wrap, set };
  };

  // ---- Top bar: hold to compare, and save ----
  const top = element('div', 'pe-top');
  const compare = iconButton('compare', t('bg.compare'), 'bg-btn pe-compare');
  const save = iconButton('save', t('ws.download'), 'pe-save');
  save.onclick = () => document.getElementById('run')?.click(); // the page's own save, with its progress and result
  top.append(compare, save);

  // ---- Tabs ----
  const tabList = element('div', 'pe-tabs');
  tabList.setAttribute('role', 'tablist');
  const panels = {} as Record<Tab, HTMLElement>;
  const tabButtons = TABS.map((key) => {
    const node = iconButton(key, t(LABELS[key]), 'pe-tab');
    node.id = `pe-tab-${key}`;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', `pe-${key}`);
    node.onclick = () => show(key);
    const panel = element('div', 'pe-panel');
    panel.id = `pe-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', node.id);
    panels[key] = panel;
    return node;
  });
  tabList.append(...tabButtons);
  // Arrow keys move between tabs.
  tabList.addEventListener('keydown', (event) => {
    const at = TABS.indexOf(tab);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(TABS[(next + TABS.length) % TABS.length]);
    tabButtons[TABS.indexOf(tab)].focus();
  });
  function show(key: Tab) {
    tab = key;
    viewer.dataset.tab = key;
    TABS.forEach((k, i) => {
      tabButtons[i].setAttribute('aria-selected', String(k === key));
      tabButtons[i].tabIndex = k === key ? 0 : -1;
      panels[k].hidden = k !== key;
    });
    draw();
  }

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
  const zoom = slider(t('pe.zoom'), 1, 3, 0.05, (v) => `${v.toFixed(1)}×`, (value) => {
    state.zoom = value;
    sync();
  });
  zoom.wrap.classList.add('from-start');
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
  const flipH = turnButton('pe.flipH', () => (state.flipX = !state.flipX));
  const flipV = turnButton('pe.flipV', () => (state.flipY = !state.flipY));
  turnRow.append(turnButton('pe.left', () => (state.turns = (state.turns + 3) % 4)), turnButton('pe.right', () => (state.turns = (state.turns + 1) % 4)), flipH, flipV);
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
  panels.light.append(chipRow, ...sliders.map((s) => s.wrap), element('p', 'bg-hint pe-swipe-hint', t('pe.swipeHint')));

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
    // Sizes follow the kept part of the photo.
    const [, , w, h] = kept().box;
    const picked = sizeSelect.value || '100';
    sizeSelect.replaceChildren(
      ...SIZES.map((pct) => {
        const [sw, sh] = fit(w, h, Math.round((Math.max(w, h) * pct) / 100));
        return new Option(t(pct === 100 ? 'bg.original' : 'bg.widthOption', { w: sw, h: sh }), String(pct));
      }),
    );
    sizeSelect.value = picked;
    draw();
  }

  // ---- Dragging on the photo: Crop moves the photo in the frame, Light changes the chosen slider, Text moves words ----
  let drag: { x: number; y: number; cx: number; cy: number; value: number } | undefined;
  const clamp = (value: number, half: number) => Math.min(1 - half, Math.max(half, value));
  const startDrag = (event: PointerEvent) => {
    if (event.defaultPrevented || event.button !== 0) return; // a text layer took it
    if (tab === 'crop' ? !canvas.classList.contains('pe-movable') : tab !== 'light') return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, cx: state.cx, cy: state.cy, value: state.own[chosen] };
  };
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    if (tab === 'light') {
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
  for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => (drag = undefined));

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
  text = (await import('./sticker-text')).stickerText(canvas, draw, () => tab !== 'text');
  panels.text.append(text.panel);
  canvas.addEventListener('pointerdown', startDrag);
  viewer.replaceChildren(top, stage, tabList, ...TABS.map((key) => panels[key]));
  show('looks');
  sync();
  viewer.scrollIntoView({ block: 'start' });

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
