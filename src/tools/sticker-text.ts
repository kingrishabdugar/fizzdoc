// Words and emoji on a WhatsApp sticker: layers that can be dragged, resized and turned on the picture.
// The Sticker Maker draws it over the cut-out, both in the preview and in the saved 512×512 sticker.
import '@fontsource/bangers/400.css';
import '@fontsource/kalam/700.css';
import '@fontsource/teko/700.css';
import '@fontsource-variable/baloo-2/wght.css';
import './sticker-text.css';
import { t, type UiKey } from '../i18n';

// Each style falls back to Baloo 2 for Hindi and other Devanagari text the first font doesn't have.
const STYLES = {
  funny: { weight: 400, family: "'Bangers', 'Baloo 2 Variable', sans-serif" },
  cute: { weight: 800, family: "'Baloo 2 Variable', sans-serif" },
  cozy: { weight: 700, family: "'Kalam', 'Baloo 2 Variable', sans-serif" },
  big: { weight: 700, family: "'Teko', 'Baloo 2 Variable', sans-serif" },
  serious: { weight: 700, family: "'Inter Variable', 'Baloo 2 Variable', sans-serif" },
  // Emoji are drawn with the device's own colour emoji font.
  emoji: { weight: 400, family: "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif" },
} as const;
type Style = keyof typeof STYLES;
const COLORS = { white: '#ffffff', black: '#111111', green: '#25d366', yellow: '#ffd60a', red: '#ff3b30', blue: '#2f80ed' } as const;
const EMOJI = ['😂', '🤣', '😍', '🥰', '😎', '🥳', '😭', '😡', '🤔', '🙏', '👍', '👏', '🔥', '💯', '❤️', '🎉'];

/** One piece of text. Position and size are fractions of the sticker's width, so the preview and the 512 px file match. */
interface Words {
  text: string;
  style: Style;
  color: string;
  x: number;
  y: number;
  size: number;
  angle: number;
}

const font = (words: Words, px: number) => `${STYLES[words.style].weight} ${px}px ${STYLES[words.style].family}`;
const lines = (words: Words) => (words.style === 'big' ? words.text.toUpperCase() : words.text).split('\n');

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/**
 * The "Text" panel and the text layers. `redraw` repaints the preview; `painting` says whether a brush
 * tool is on, in which case the picture belongs to the brush and the text can't be dragged.
 */
export function stickerText(canvas: HTMLCanvasElement, redraw: () => void, painting: () => boolean) {
  const layers: Words[] = [];
  let selected: Words | undefined;
  const measure = canvas.getContext('2d')!;

  /** The text's box (before turning), in pixels of a canvas `w` wide. */
  const box = (words: Words, w: number) => {
    const px = words.size * w;
    measure.font = font(words, px);
    const rows = lines(words);
    return { px, rows, width: Math.max(...rows.map((row) => measure.measureText(row).width)), height: rows.length * px * 1.05 };
  };

  /** Paints every layer onto a context `w`×`h`; the preview also outlines the selected one. */
  function draw(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, preview = false) {
    for (const words of layers) {
      const { px, rows, width, height } = box(words, w);
      context.save();
      context.translate(words.x * w, words.y * h);
      context.rotate((words.angle * Math.PI) / 180);
      context.font = font(words, px);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      // A thick contrasting edge, as on printed stickers, so the words read on any chat background.
      context.lineWidth = px * 0.2;
      context.strokeStyle = words.color === COLORS.white && words.style !== 'emoji' ? COLORS.black : COLORS.white;
      context.fillStyle = words.color;
      const top = -((rows.length - 1) * px * 1.05) / 2;
      rows.forEach((row, i) => context.strokeText(row, 0, top + i * px * 1.05));
      rows.forEach((row, i) => context.fillText(row, 0, top + i * px * 1.05));
      if (preview && words === selected) {
        const pad = px * 0.25;
        context.setLineDash([w * 0.012, w * 0.008]);
        context.lineWidth = Math.max(2, w * 0.004);
        context.strokeStyle = COLORS.green;
        context.strokeRect(-width / 2 - pad, -height / 2 - pad, width + pad * 2, height + pad * 2);
      }
      context.restore();
    }
  }

  // ---- Panel ----
  const panel = element('fieldset', 'bg-group st-panel');
  panel.append(element('legend', '', t('st.text')), element('p', 'bg-hint', t('st.hint')));
  const add = element('button', 'bg-btn st-add', t('st.add'));
  add.type = 'button';
  const input = element('textarea', 'st-input');
  input.rows = 2;
  input.setAttribute('aria-label', t('st.textLabel'));
  const styleRow = element('div', 'st-row');
  styleRow.setAttribute('role', 'group');
  styleRow.setAttribute('aria-label', t('st.style'));
  const styleButtons = (Object.keys(STYLES) as Style[]).filter((style) => style !== 'emoji').map((style) => {
    const button = element('button', 'bg-btn st-style', t(`st.${style}` as UiKey));
    button.type = 'button';
    button.dataset.style = style;
    button.onclick = () => change({ style });
    return button;
  });
  styleRow.append(...styleButtons);
  const colorRow = element('div', 'st-row');
  colorRow.setAttribute('role', 'group');
  colorRow.setAttribute('aria-label', t('st.color'));
  const colorButtons = (Object.entries(COLORS) as [keyof typeof COLORS, string][]).map(([name, color]) => {
    const button = element('button', 'st-swatch');
    button.type = 'button';
    button.style.setProperty('--swatch', color);
    button.setAttribute('aria-label', t(`st.${name}` as UiKey));
    button.onclick = () => change({ color });
    return button;
  });
  colorRow.append(...colorButtons);
  const slider = (label: string, min: number, max: number, step: number, key: 'size' | 'angle') => {
    const range = element('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.setAttribute('aria-label', label);
    range.oninput = () => change({ [key]: Number(range.value) });
    const wrap = element('label', 'bg-brush', label);
    wrap.append(range);
    return { range, wrap };
  };
  const size = slider(t('st.size'), 0.05, 0.4, 0.005, 'size');
  const turn = slider(t('st.turn'), -180, 180, 1, 'angle');
  const remove = element('button', 'bg-btn', t('st.delete'));
  remove.type = 'button';
  const controls = element('div', 'st-controls');
  controls.append(input, styleRow, colorRow, size.wrap, turn.wrap, remove);
  const emojiRow = element('div', 'st-row');
  emojiRow.setAttribute('role', 'group');
  emojiRow.setAttribute('aria-label', t('st.addEmoji'));
  emojiRow.append(
    ...EMOJI.map((emoji) => {
      const button = element('button', 'bg-btn st-emoji', emoji);
      button.type = 'button';
      button.onclick = () => place({ text: emoji, style: 'emoji', color: COLORS.white, x: 0.8, y: 0.2, size: 0.2, angle: 0 });
      return button;
    }),
  );
  panel.append(add, emojiRow, controls);

  /** Reflects the selected layer in the panel; with nothing selected, only "Add text" is offered. */
  const sync = () => {
    controls.hidden = !selected;
    canvas.classList.toggle('st-has-text', layers.length > 0);
    if (!selected) return;
    styleRow.hidden = colorRow.hidden = selected.style === 'emoji'; // an emoji keeps its own colours
    input.value = selected.text;
    for (const button of styleButtons) button.setAttribute('aria-pressed', String(button.dataset.style === selected.style));
    colorButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(Object.values(COLORS)[i] === selected!.color)));
    size.range.value = String(selected.size);
    turn.range.value = String(selected.angle);
  };
  // Fonts load on demand: draw again once the letters the text needs have arrived.
  const ready = (words: Words) => void document.fonts.load(font(words, 48), words.text).then(redraw, () => {});
  const select = (words?: Words) => {
    selected = words;
    sync();
    redraw();
  };
  function change(update: Partial<Words>) {
    if (!selected) return;
    Object.assign(selected, update);
    ready(selected);
    sync();
    redraw();
  }
  const place = (words: Words) => {
    layers.push(words);
    select(words);
    ready(words);
  };
  add.onclick = () => {
    place({ text: t('st.sample'), style: 'funny', color: COLORS.white, x: 0.5, y: 0.84, size: 0.14, angle: 0 });
    input.select();
    input.focus();
  };
  input.oninput = () => change({ text: input.value });
  remove.onclick = () => {
    if (selected) layers.splice(layers.indexOf(selected), 1);
    select(layers.at(-1));
  };

  // ---- Drag with one finger or the mouse; pinch to resize and turn; the wheel resizes ----
  const toCanvas = (event: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) * canvas.width) / rect.width, y: ((event.clientY - rect.top) * canvas.height) / rect.height };
  };
  const hit = (point: { x: number; y: number }) =>
    layers.findLast((words) => {
      const { px, width, height } = box(words, canvas.width);
      const a = (-words.angle * Math.PI) / 180;
      const dx = point.x - words.x * canvas.width;
      const dy = point.y - words.y * canvas.height;
      const pad = px * 0.3;
      return Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= width / 2 + pad && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= height / 2 + pad;
    });
  const pointers = new Map<number, { x: number; y: number }>();
  let grab: { dx: number; dy: number } | undefined;
  let pinch: { distance: number; turn: number; size: number; angle: number } | undefined;
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), turn: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  };
  const startGrab = (point: { x: number; y: number }) => {
    grab = selected && { dx: selected.x - point.x / canvas.width, dy: selected.y - point.y / canvas.height };
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (painting() || event.button !== 0) return;
    const point = toCanvas(event);
    const target = pointers.size ? selected : hit(point);
    if (!target) {
      if (selected) select(undefined);
      return;
    }
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point);
    if (target !== selected) select(target);
    if (pointers.size === 2) pinch = { ...pair(), size: selected!.size, angle: selected!.angle };
    else startGrab(point);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !selected) return;
    pointers.set(event.pointerId, toCanvas(event));
    if (pinch && pointers.size >= 2) {
      const now = pair();
      selected.size = Math.min(0.4, Math.max(0.05, pinch.size * (now.distance / pinch.distance)));
      selected.angle = Math.round(((((pinch.angle + now.turn - pinch.turn + 180) % 360) + 360) % 360) - 180);
    } else if (grab) {
      const point = pointers.get(event.pointerId)!;
      selected.x = Math.min(1, Math.max(0, point.x / canvas.width + grab.dx));
      selected.y = Math.min(1, Math.max(0, point.y / canvas.height + grab.dy));
    }
    sync();
    redraw();
  });
  const release = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    pinch = undefined;
    const rest = [...pointers.values()][0];
    if (rest) startGrab(rest);
    else grab = undefined;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (painting() || !selected || hit(toCanvas(event)) !== selected) return;
      event.preventDefault();
      change({ size: Math.min(0.4, Math.max(0.05, selected.size * (event.deltaY < 0 ? 1.08 : 1 / 1.08))) });
    },
    { passive: false },
  );

  sync();
  return { panel, draw };
}
