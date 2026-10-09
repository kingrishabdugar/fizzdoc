// Remove Background: the background goes as soon as a picture is chosen, then the person picks
// what goes behind (nothing, a colour, their own photo, or a blur), the size, and touches up any
// spot the model missed. Built for big buttons and few decisions; everything stays on the device.
import './remove-bg.css';
import { compose, frameFor, removeBackground, render, subjectBox, type Backdrop, type Layout, type Look, type SaveFormat } from '../engine/background';
import { decodeGif, encodeGif, type GifFrame } from '../engine/gif';
import type { Output } from '../engine/local';
import { t } from '../i18n';

export interface BackgroundEditor {
  save(options: { format?: string; width?: string }, onProgress?: (fraction: number) => void): Promise<Output>;
  destroy(): void;
}

const SWATCHES: [key: 'white' | 'black' | 'blue' | 'red' | 'green' | 'gray', color: string][] = [
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['blue', '#1e6fd9'],
  ['red', '#d7262e'],
  ['green', '#1d9a5b'],
  ['gray', '#9ca3af'],
];
/** Longest side of the on-screen preview; saving always works from the full-size cut-out. */
const PREVIEW = 1600;
const TILE = 64;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

export async function openBackgroundEditor(file: File, viewer: HTMLElement, preset: Record<string, string> = {}): Promise<BackgroundEditor> {
  // Videos: the first frame is the preview; the whole video is done when it's saved.
  const video = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name) ? await import('../engine/video-background') : undefined;
  const info = video && (await video.videoInfo(file));
  let photo: ImageBitmap;
  if (info) photo = info.first;
  else
    try {
      photo = await createImageBitmap(file);
    } catch {
      const { LocalError } = await import('../engine/local');
      throw new LocalError('BAD_IMAGE');
    }
  // Animated GIFs: every frame gets its background removed, and the result is saved as a GIF.
  let gifFrames: GifFrame[] = [];
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    try {
      gifFrames = decodeGif(await file.arrayBuffer()).frames;
    } catch {
      gifFrames = []; // unreadable as an animation: treat it as a still picture
    }
  }
  const animated = gifFrames.length > 1;
  const W = photo.width;
  const H = photo.height;

  // ---- Layout ----
  viewer.classList.add('bg-editor');
  const stage = element('div', 'bg-stage');
  const canvas = element('canvas', 'bg-canvas');
  const scale = Math.min(1, PREVIEW / Math.max(W, H));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('bg.previewLabel'));
  const busy = element('div', 'bg-busy');
  const busyText = element('p', '', t('bg.working', { pct: 0 }));
  busyText.setAttribute('role', 'status');
  const bar = element('div', 'progress');
  bar.append(element('span'));
  busy.append(element('span', 'bg-spinner'), busyText, bar);
  stage.append(canvas, busy);
  const compare = element('button', 'bg-btn bg-compare', t('bg.compare'));
  compare.type = 'button';
  compare.disabled = true;
  const note = element('p', 'bg-note');
  note.setAttribute('aria-live', 'polite');

  const group = (title: string) => {
    const box = element('fieldset', 'bg-group');
    box.append(element('legend', '', title));
    return box;
  };
  const backdrops = group(t('bg.background'));
  const choices = element('div', 'bg-choices');
  backdrops.append(choices);
  const styleBox = group(t('bg.style'));
  const sizeBox = group(t('bg.size'));
  const touch = group(t('bg.touch'));
  viewer.replaceChildren(stage, compare, note, backdrops, styleBox, sizeBox, touch);

  // Before the cut-out is ready, the photo itself is shown under the progress.
  const preview = canvas.getContext('2d')!;
  preview.drawImage(photo, 0, 0, canvas.width, canvas.height);

  // ---- Remove the background ----
  const setBar = (fraction: number) => {
    const pct = Math.min(100, Math.round(fraction * 100));
    bar.style.setProperty('--pct', `${pct}%`);
    return pct;
  };
  const onSetup = (loaded: number, total: number) => {
    setBar(loaded / total);
    busyText.textContent = t('bg.preparing', { loaded: Math.round(loaded / 1e6), total: Math.round(total / 1e6) });
  };
  // Frames of an animation: their own photos and cut-outs, and how long each one shows.
  const frames: { photo: ImageBitmap; cut: ImageBitmap; delay: number }[] = [];
  let cutout!: ImageData;
  let model = '';
  if (animated) {
    for (const [i, frame] of gifFrames.entries()) {
      const framePhoto = await createImageBitmap(frame.image);
      const result = await removeBackground(await createImageBitmap(framePhoto), {
        fast: true,
        onSetup,
        onProgress: (fraction) => {
          busyText.textContent = t('bg.frame', { n: i + 1, total: gifFrames.length });
          setBar((i + fraction) / gifFrames.length);
        },
      });
      frames.push({ photo: framePhoto, cut: await createImageBitmap(result.cutout), delay: frame.delay });
      ({ cutout, model } = result);
    }
    note.textContent = t('bg.gifNote');
  } else {
    const started = performance.now();
    let ready = started; // when the one-time download finished
    ({ cutout, model } = await removeBackground(await createImageBitmap(photo), {
      fast: !!info,
      onSetup: (loaded, total) => {
        onSetup(loaded, total);
        ready = performance.now();
      },
      onProgress: (fraction) => {
        busyText.textContent = t('bg.working', { pct: setBar(fraction) });
      },
    }));
    if (info) {
      // A rough idea of the wait: this frame's time, for every frame at 30 per second.
      const minutes = Math.max(1, Math.round(((performance.now() - ready) / 1000) * info.duration * 30 / 60));
      note.textContent = t('bg.videoNote', { min: minutes });
    } else if (model === 'u2netp') note.textContent = t('bg.lite');
  }
  busy.hidden = true;

  // The full-size cut-out lives on its own canvas; touch-ups change it in place.
  const cut = new OffscreenCanvas(W, H);
  const cutContext = cut.getContext('2d', { willReadFrequently: true })!;
  cutContext.putImageData(cutout, 0, 0);
  const pixels = cutout.data;
  let original: Uint8ClampedArray | undefined; // the photo's pixels, read only when "Restore" is first used

  let backdrop: Backdrop = { kind: 'none' };
  let ownPhoto: ImageBitmap | undefined;
  // Animations play in the preview; `shown` is the frame on screen.
  let shown = 0;
  // Finishing touches for still pictures: shadow, outline, and which part of the photo is shown.
  let layout: Layout = 'photo';
  let shadow = false;
  let outline: string | undefined;
  let frame: [number, number, number, number] = [0, 0, W, H];
  const look = (): Look => ({ frame, shadow, outline });
  /** Re-measures the subject (after a touch-up or a new crop) and resizes the preview to the frame. */
  const reframe = () => {
    frame = frameFor(layout, layout === 'photo' ? undefined : subjectBox(pixels, W, H), W, H);
    const s = Math.min(1, PREVIEW / Math.max(frame[2], frame[3]));
    const width = Math.max(1, Math.round(frame[2] * s));
    const height = Math.max(1, Math.round(frame[3] * s));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  const draw = () => (animated ? compose(canvas, frames[shown].cut, frames[shown].photo, backdrop) : compose(canvas, cut, photo, backdrop, look()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const play = () => {
    draw();
    timer = setTimeout(() => {
      shown = (shown + 1) % frames.length;
      play();
    }, Math.max(20, frames[shown].delay));
  };

  // ---- Backdrop choices ----
  const buttons: HTMLButtonElement[] = [];
  // onPick returns false when nothing was picked yet (a file or colour dialog is still to come).
  const choice = (label: string, onPick: () => void | boolean, swatch?: string) => {
    const button = element('button', 'bg-choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    const chip = element('span', 'bg-chip');
    if (swatch) chip.style.background = swatch;
    button.append(chip, element('span', '', label));
    button.onclick = () => {
      if (onPick() === false) return;
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      draw();
    };
    buttons.push(button);
    choices.append(button);
    return button;
  };
  // For videos, "no background" is a green screen (see engine/video-background.ts).
  const none = choice(info ? t('bg.greenScreen') : t('bg.none'), () => {
    backdrop = info && video ? { kind: 'color', color: video.GREEN_SCREEN } : { kind: 'none' };
  }, info && video ? video.GREEN_SCREEN : undefined);
  if (!info) none.querySelector('.bg-chip')!.classList.add('bg-chip-clear');
  const colors = new Map<string, HTMLButtonElement>();
  for (const [key, color] of SWATCHES)
    colors.set(
      key,
      choice(t(`bg.${key}`), () => {
        backdrop = { kind: 'color', color };
      }, color),
    );
  const picker = element('input');
  picker.type = 'color';
  picker.value = '#ffd166';
  picker.className = 'bg-hidden';
  picker.setAttribute('aria-label', t('bg.custom'));
  const custom = choice(t('bg.custom'), () => {
    picker.click();
    backdrop = { kind: 'color', color: picker.value };
  });
  custom.querySelector('.bg-chip')!.classList.add('bg-chip-rainbow');
  picker.oninput = () => {
    backdrop = { kind: 'color', color: picker.value };
    (custom.querySelector('.bg-chip') as HTMLElement).style.background = picker.value;
    for (const other of buttons) other.setAttribute('aria-pressed', String(other === custom));
    draw();
  };
  choices.append(picker);
  const upload = element('input');
  upload.type = 'file';
  upload.accept = 'image/*';
  upload.className = 'bg-hidden';
  const photoChoice = choice(t('bg.photo'), () => {
    if (!ownPhoto) {
      upload.click();
      return false;
    }
    backdrop = { kind: 'image', image: ownPhoto };
  });
  photoChoice.querySelector('.bg-chip')!.classList.add('bg-chip-photo');
  upload.onchange = async () => {
    const chosen = upload.files?.[0];
    if (!chosen) return;
    try {
      ownPhoto?.close();
      ownPhoto = await createImageBitmap(chosen);
    } catch {
      return;
    }
    backdrop = { kind: 'image', image: ownPhoto };
    for (const other of buttons) other.setAttribute('aria-pressed', String(other === photoChoice));
    draw();
  };
  choices.append(upload);
  const blur = choice(t('bg.blur'), () => {
    backdrop = { kind: 'blur', amount: 0.012 };
  });
  blur.querySelector('.bg-chip')!.classList.add('bg-chip-blur');
  // Pages like "white background" start with that colour picked.
  (colors.get(preset.bg as 'white') ?? none).click();

  // ---- Style: shadow, outline, crop ----
  const toggle = (label: string, onChange: (on: boolean) => void) => {
    const button = element('button', 'bg-btn', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      onChange(on);
      draw();
    };
    return button;
  };
  const styleTools = element('div', 'bg-tools');
  const cropSelect = element('select');
  cropSelect.setAttribute('aria-label', t('bg.crop'));
  cropSelect.append(new Option(t('bg.cropPhoto'), 'photo'), new Option(t('bg.cropSubject'), 'subject'), new Option(t('bg.cropSquare'), 'square'));
  cropSelect.onchange = () => {
    layout = cropSelect.value as Layout;
    reframe();
    fillSizes();
    draw();
  };
  const cropLabel = element('label', 'bg-brush', t('bg.crop'));
  cropLabel.append(cropSelect);
  styleTools.append(
    toggle(t('bg.shadow'), (on) => (shadow = on)),
    toggle(t('bg.outline'), (on) => (outline = on ? '#ffffff' : undefined)),
    cropLabel,
  );
  styleBox.append(styleTools);
  styleBox.hidden = animated || !!info; // for still pictures

  // ---- Size ----
  const sizeSelect = element('select');
  sizeSelect.setAttribute('aria-label', t('bg.size'));
  // Sizes follow the shown part of the photo (the whole photo, or the crop).
  const fillSizes = () => {
    const [, , fw, fh] = frame;
    const kept = sizeSelect.value === 'custom' ? 'custom' : '';
    sizeSelect.replaceChildren(new Option(t('bg.original', { w: fw, h: fh }), String(fw)));
    for (const w of [2000, 1080, 600].filter((w) => w < fw)) sizeSelect.append(new Option(t('bg.widthOption', { w, h: Math.round((fh * w) / fw) }), String(w)));
    sizeSelect.append(new Option(t('bg.customSize'), 'custom'));
    sizeSelect.value = kept || String(fw);
    widthInput.max = String(Math.max(fw * 4, 8000));
    if (!kept) widthInput.value = String(fw);
    updateSize();
  };
  const widthInput = element('input');
  widthInput.type = 'number';
  widthInput.min = '16';
  widthInput.max = String(Math.max(W * 4, 8000));
  widthInput.value = String(W);
  widthInput.hidden = true;
  widthInput.setAttribute('aria-label', t('bg.widthLabel'));
  const sizeNote = element('span', 'bg-size-note');
  const updateSize = () => {
    widthInput.hidden = sizeSelect.value !== 'custom';
    const w = outputWidth();
    sizeNote.textContent = widthInput.hidden ? '' : `× ${Math.round((frame[3] * w) / frame[2])} px`;
  };
  sizeSelect.onchange = updateSize;
  widthInput.oninput = updateSize;
  sizeBox.append(sizeSelect, widthInput, sizeNote);
  function outputWidth() {
    const w = sizeSelect.value === 'custom' ? Math.round(Number(widthInput.value)) : Number(sizeSelect.value);
    return Number.isFinite(w) && w >= 16 ? Math.min(w, Number(widthInput.max)) : frame[2];
  }
  fillSizes();

  // ---- Touch up ----
  touch.append(element('p', 'bg-hint', t('bg.touchHint')));
  const tools = element('div', 'bg-tools');
  const modes: HTMLButtonElement[] = [];
  let mode: 'erase' | 'restore' | null = null;
  const modeButton = (key: 'erase' | 'restore') => {
    const button = element('button', 'bg-btn', t(`bg.${key}`));
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      mode = mode === key ? null : key;
      for (const other of modes) other.setAttribute('aria-pressed', String(other === button && mode === key));
      stage.classList.toggle('painting', mode !== null);
      // The brush works on the picture: bring it into view.
      if (mode) stage.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    modes.push(button);
    return button;
  };
  const brush = element('input');
  brush.type = 'range';
  brush.min = '4';
  brush.max = '80';
  brush.value = '24';
  brush.setAttribute('aria-label', t('bg.brush'));
  const brushLabel = element('label', 'bg-brush', t('bg.brush'));
  brushLabel.append(brush);
  const undo = element('button', 'bg-btn', t('ed.undo'));
  undo.type = 'button';
  undo.disabled = true;
  const redo = element('button', 'bg-btn', t('bg.redo'));
  redo.type = 'button';
  redo.disabled = true;
  // Zoom, for careful work on small details (most useful on phones).
  let zoom = 1;
  let baseWidth = 0;
  const zoomBy = (step: number) => {
    if (zoom === 1) baseWidth = canvas.getBoundingClientRect().width;
    zoom = Math.min(4, Math.max(1, zoom + step));
    stage.classList.toggle('zoomed', zoom > 1);
    canvas.style.width = zoom > 1 ? `${Math.round(baseWidth * zoom)}px` : '';
    zoomOut.disabled = zoom === 1;
    zoomIn.disabled = zoom === 4;
  };
  const zoomIn = element('button', 'bg-btn', t('ed.zoomIn'));
  zoomIn.type = 'button';
  zoomIn.onclick = () => zoomBy(1);
  const zoomOut = element('button', 'bg-btn', t('ed.zoomOut'));
  zoomOut.type = 'button';
  zoomOut.disabled = true;
  zoomOut.onclick = () => zoomBy(-1);
  tools.append(modeButton('erase'), modeButton('restore'), brushLabel, undo, redo, zoomOut, zoomIn);
  touch.append(tools);
  touch.hidden = animated || !!info; // touch-ups are for still pictures

  // Each stroke remembers the 64×64 tiles it changed, so Undo restores just those.
  type Snapshot = Map<number, ImageData>;
  const history: Snapshot[] = [];
  const future: Snapshot[] = [];
  let stroke: Snapshot | undefined;
  const tilesX = Math.ceil(W / TILE);
  const remember = (x0: number, y0: number, x1: number, y1: number) => {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++)
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
        const key = ty * tilesX + tx;
        if (stroke!.has(key)) continue;
        const w = Math.min(TILE, W - tx * TILE);
        const h = Math.min(TILE, H - ty * TILE);
        const copy = new ImageData(w, h);
        for (let row = 0; row < h; row++) {
          const from = ((ty * TILE + row) * W + tx * TILE) * 4;
          copy.data.set(pixels.subarray(from, from + w * 4), row * w * 4);
        }
        stroke!.set(key, copy);
      }
  };
  const putTile = (key: number, tile: ImageData) => {
    const tx = key % tilesX;
    const ty = Math.floor(key / tilesX);
    for (let row = 0; row < tile.height; row++) pixels.set(tile.data.subarray(row * tile.width * 4, (row + 1) * tile.width * 4), ((ty * TILE + row) * W + tx * TILE) * 4);
    cutContext.putImageData(tile, tx * TILE, ty * TILE);
  };
  /** The tiles as they are now, for the same keys as `snapshot`. */
  const current = (snapshot: Snapshot): Snapshot => {
    const now: Snapshot = new Map();
    for (const [key, tile] of snapshot) {
      const tx = key % tilesX;
      const ty = Math.floor(key / tilesX);
      now.set(key, cutContext.getImageData(tx * TILE, ty * TILE, tile.width, tile.height));
    }
    return now;
  };
  const step = (from: Snapshot[], to: Snapshot[]) => {
    const last = from.pop();
    if (!last) return;
    to.push(current(last));
    for (const [key, tile] of last) putTile(key, tile);
    undo.disabled = !history.length;
    redo.disabled = !future.length;
    if (layout !== 'photo') reframe();
    draw();
  };
  undo.onclick = () => step(history, future);
  redo.onclick = () => step(future, history);

  /** One round dab of the brush at full-size coordinates, soft at its rim. */
  const dab = (cx: number, cy: number, radius: number) => {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(W - 1, Math.ceil(cx + radius));
    const y1 = Math.min(H - 1, Math.ceil(cy + radius));
    if (x1 < x0 || y1 < y0) return;
    remember(x0, y0, x1, y1);
    if (mode === 'restore' && !original) {
      const reader = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
      reader.drawImage(photo, 0, 0);
      original = reader.getImageData(0, 0, W, H).data;
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        if (d >= 1) continue;
        const strength = d < 0.6 ? 1 : (1 - d) / 0.4;
        const o = (y * W + x) * 4;
        if (mode === 'erase') pixels[o + 3] = Math.round(pixels[o + 3] * (1 - strength));
        else {
          const a = Math.max(pixels[o + 3], Math.round(255 * strength));
          if (a > pixels[o + 3]) {
            pixels[o] = original![o];
            pixels[o + 1] = original![o + 1];
            pixels[o + 2] = original![o + 2];
            pixels[o + 3] = a;
          }
        }
      }
    cutContext.putImageData(cutout, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (!mode || event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    stroke = new Map();
    let last: [number, number] | undefined;
    const paint = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const [fx, fy, fw, fh] = frame;
      const x = fx + ((e.clientX - box.left) / box.width) * fw;
      const y = fy + ((e.clientY - box.top) / box.height) * fh;
      // The brush size is set in screen pixels, so it feels the same at any zoom.
      const radius = (Number(brush.value) / 2) * (fw / box.width);
      // Fill the gap between pointer events so fast strokes stay continuous.
      const steps = last ? Math.max(1, Math.ceil(Math.hypot(x - last[0], y - last[1]) / (radius / 3))) : 1;
      for (let i = 1; i <= steps; i++) dab(last ? last[0] + ((x - last[0]) * i) / steps : x, last ? last[1] + ((y - last[1]) * i) / steps : y, radius);
      last = [x, y];
      draw();
    };
    paint(event);
    const end = () => {
      canvas.removeEventListener('pointermove', paint);
      if (stroke?.size) {
        history.push(stroke);
        future.length = 0;
      }
      if (history.length > 30) history.shift();
      stroke = undefined;
      undo.disabled = !history.length;
      redo.disabled = !future.length;
      if (layout !== 'photo') {
        reframe();
        draw();
      }
    };
    canvas.addEventListener('pointermove', paint);
    canvas.addEventListener('pointerup', end, { once: true });
    canvas.addEventListener('pointercancel', end, { once: true });
  });

  // ---- Before and after ----
  compare.disabled = false;
  const showOriginal = (on: boolean) => {
    if (on) {
      preview.clearRect(0, 0, canvas.width, canvas.height);
      const [fx, fy, fw] = animated ? [0, 0, W] : frame;
      const s = canvas.width / fw;
      preview.drawImage(animated ? frames[shown].photo : photo, -fx * s, -fy * s, W * s, H * s);
    } else draw();
    compare.classList.toggle('active', on);
  };
  compare.addEventListener('pointerdown', () => showOriginal(true));
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) compare.addEventListener(type, () => showOriginal(false));
  compare.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') showOriginal(true);
  });
  compare.addEventListener('keyup', () => showOriginal(false));
  if (animated) play();
  else draw();

  const base = file.name.replace(/\.[^.]+$/, '');
  return {
    async save(options, onProgress) {
      if (video) {
        const w = outputWidth();
        const { blob, extension } = await video.replaceVideoBackground(file, { backdrop, width: w, height: Math.round((H * w) / W), onProgress });
        return { blob, name: `${base}-new-bg.${extension}`, summary: `${w} × ${Math.round((H * w) / W)} px` };
      }
      onProgress?.(0.2);
      if (animated) {
        const w = outputWidth();
        const h = Math.max(1, Math.round((H * w) / W));
        const canvas = new OffscreenCanvas(w, h);
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const rendered = frames.map((frame, i) => {
          compose(canvas, frame.cut, frame.photo, backdrop);
          onProgress?.(0.2 + (0.5 * (i + 1)) / frames.length);
          return { data: context.getImageData(0, 0, w, h).data, delay: frame.delay };
        });
        const bytes = encodeGif(rendered, w, h, backdrop.kind === 'none');
        onProgress?.(1);
        return {
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' }),
          name: `${base}-${backdrop.kind === 'none' ? 'no-bg' : 'new-bg'}.gif`,
          summary: `${w} × ${h} px`,
        };
      }
      const chosen = (['png', 'jpg', 'webp'] as SaveFormat[]).find((f) => f === options.format) ?? (backdrop.kind === 'none' ? 'png' : 'jpg');
      const w = outputWidth();
      const h = Math.max(1, Math.round((frame[3] * w) / frame[2]));
      const blob = await render(cut, photo, backdrop, w, h, chosen, look());
      onProgress?.(1);
      return {
        blob,
        name: `${base}-${backdrop.kind === 'none' ? 'no-bg' : 'new-bg'}.${chosen}`,
        summary: `${w} × ${h} px`,
      };
    },
    destroy() {
      clearTimeout(timer);
      for (const frame of frames) {
        frame.photo.close();
        frame.cut.close();
      }
      photo.close();
      ownPhoto?.close();
      viewer.classList.remove('bg-editor');
      viewer.replaceChildren();
    },
  };
}
