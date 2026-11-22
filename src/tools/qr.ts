// QR Code Generator: type what the code should hold, style it, download it. The preview and every
// download come from the same SVG (engine/qr.ts), and nothing leaves the device, logos included.
import { DEFAULT_STYLE, contrast, payload, svg, type Dots, type Eye, type Fields, type Kind, type Style } from '../engine/qr';
import { t, type UiKey } from '../i18n';
import './qr.css';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

type Field = [name: string, type: 'text' | 'url' | 'email' | 'tel' | 'number' | 'textarea' | 'datetime-local' | 'password' | 'select' | 'checkbox', options?: string[]];
const FIELDS: Record<Kind, Field[]> = {
  url: [['url', 'url']],
  text: [['text', 'textarea']],
  email: [['to', 'email'], ['subject', 'text'], ['body', 'textarea']],
  phone: [['phone', 'tel']],
  sms: [['phone', 'tel'], ['message', 'textarea']],
  whatsapp: [['phone', 'tel'], ['message', 'textarea']],
  upi: [['pa', 'text'], ['pn', 'text'], ['am', 'number'], ['tn', 'text']],
  wifi: [['ssid', 'text'], ['password', 'password'], ['security', 'select', ['WPA', 'WEP', 'nopass']], ['hidden', 'checkbox']],
  vcard: [['first', 'text'], ['last', 'text'], ['phone', 'tel'], ['email', 'email'], ['org', 'text'], ['title', 'text'], ['website', 'url'], ['address', 'textarea']],
  event: [['summary', 'text'], ['start', 'datetime-local'], ['end', 'datetime-local'], ['location', 'text']],
  location: [['lat', 'number'], ['lng', 'number']],
  crypto: [['coin', 'select', ['bitcoin', 'ethereum', 'litecoin']], ['wallet', 'text'], ['amount', 'number']],
};
const KINDS = Object.keys(FIELDS) as Kind[];
/** What a new code holds before anything is typed, so the preview is never empty. */
const SAMPLE: Partial<Record<Kind, Fields>> = { url: { url: 'https://fizzdoc.com' } };

/** One-click looks. Each sets the whole style, so picking one after another never mixes them. */
const TEMPLATES: [name: string, style: Partial<Style>][] = [
  ['classic', {}],
  ['rounded', { dots: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded' }],
  ['dots', { dots: 'dots', eyeFrame: 'circle', eyeBall: 'circle' }],
  ['ocean', { dots: 'extra', eyeFrame: 'rounded', eyeBall: 'circle', gradient: 'linear', color: '#0b3d91', color2: '#1aa3c9', eyeColor: '#0b3d91' }],
  ['sunset', { dots: 'classy', eyeFrame: 'rounded', eyeBall: 'rounded', gradient: 'linear', color: '#b4235a', color2: '#f08a24', eyeColor: '#b4235a' }],
  ['forest', { dots: 'rounded', eyeFrame: 'circle', eyeBall: 'circle', color: '#14532d', eyeColor: '#15803d' }],
  ['scan', { dots: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', frame: 'label', frameText: 'SCAN ME' }],
  ['upi', { dots: 'extra', eyeFrame: 'rounded', eyeBall: 'rounded', color: '#1a237e', eyeColor: '#e65100', frame: 'box', frameText: 'PAY WITH UPI', frameColor: '#1a237e' }],
  ['wifi', { dots: 'dots', eyeFrame: 'rounded', eyeBall: 'circle', color: '#111827', eyeColor: '#2563eb', frame: 'label', frameText: 'JOIN WI-FI', frameColor: '#2563eb' }],
  ['night', { dots: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', color: '#ffffff', eyeColor: '#facc15', background: '#111827' }],
  ['radial', { dots: 'dots', eyeFrame: 'circle', eyeBall: 'circle', gradient: 'radial', color: '#7c3aed', color2: '#111827', eyeColor: '#7c3aed' }],
  ['clear', { dots: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', background: '' }],
];
/** A small sample code as a picture: its frame text stays part of the picture, not the button's name. */
const thumb = (style: Style) => Object.assign(document.createElement('img'), { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg('Fizzdoc', style).svg)}`, alt: '' });
/** Built-in logo icons: name, circle colour, white line drawing on a 24×24 grid. */
const ICONS: [name: string, color: string, glyph: string][] = [
  ['wifi', '#2563eb', '<path d="M5 10.5a10 10 0 0 1 14 0M7.5 13a6.5 6.5 0 0 1 9 0M10 15.5a3 3 0 0 1 4 0"/><circle cx="12" cy="18" r=".6" fill="#fff"/>'],
  ['upi', '#e65100', '<path d="M8 7h8M8 10.5h8M10 7c3.5 0 3.5 7 0 7H8l6 4"/>'],
  ['chat', '#16a34a', '<path d="M6 17.5 7 14a6 6 0 1 1 2.5 2.4z"/>'],
  ['phone', '#0f766e', '<path d="M8 6h2l1 3-1.5 1a7 7 0 0 0 3.5 3.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A10 10 0 0 1 6.5 7.5 1.5 1.5 0 0 1 8 6z"/>'],
  ['email', '#7c3aed', '<rect x="6" y="8" width="12" height="9" rx="1.5"/><path d="m6.5 9 5.5 4 5.5-4"/>'],
  ['location', '#dc2626', '<path d="M12 19s5-4.5 5-8.5a5 5 0 0 0-10 0c0 4 5 8.5 5 8.5z"/><circle cx="12" cy="10.5" r="1.8"/>'],
  ['link', '#111827', '<path d="M10.5 13.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M13.5 10.5a3 3 0 0 0-4.2 0L7 12.8a3 3 0 0 0 4.2 4.2l.8-.8"/>'],
];
const SIZES = ['256', '512', '1024', '2048', '4096'];
const FORMATS = ['png', 'svg', 'jpg', 'webp', 'pdf'] as const;
type Format = (typeof FORMATS)[number];

/** The code at `px` pixels wide as an image file. */
async function raster(code: { svg: string; width: number; height: number }, px: number, type: string, fillWhite: boolean): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code.svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = Math.round((px * code.height) / code.width);
  const context = canvas.getContext('2d')!;
  // JPG has no see-through pixels: a clear background becomes white rather than black.
  if (fillWhite) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), type, 0.95));
}

export function openQr(root: HTMLElement, preset: Record<string, string> = {}) {
  let kind: Kind = KINDS.includes(preset.kind as Kind) ? (preset.kind as Kind) : 'url';
  const values: Record<Kind, Fields> = Object.fromEntries(KINDS.map((k) => [k, { ...SAMPLE[k] }])) as Record<Kind, Fields>;
  let style: Style = { ...DEFAULT_STYLE };

  root.classList.add('qr');
  const form = element('div', 'qr-form');
  const side = element('div', 'qr-side');
  root.replaceChildren(form, side);

  // ---- What the code holds ----
  const kindGroup = element('div', 'qr-kinds');
  kindGroup.setAttribute('role', 'group');
  kindGroup.setAttribute('aria-label', t('qr.kind'));
  const fields = element('div', 'qr-fields');
  const kindButtons = KINDS.map((k) => {
    const button = element('button', 'qr-chip', t(`qr.k.${k}` as UiKey));
    button.type = 'button';
    button.onclick = () => {
      kind = k;
      showFields();
      update();
    };
    return button;
  });
  kindGroup.append(...kindButtons);
  const showFields = () => {
    kindButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(KINDS[i] === kind)));
    fields.replaceChildren(
      ...FIELDS[kind].map(([name, type, options]) => {
        const label = element('label', type === 'checkbox' ? 'qr-check' : 'qr-field', t(`qr.f.${name}` as UiKey));
        const value = values[kind][name] ?? '';
        let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (type === 'textarea') input = Object.assign(element('textarea'), { rows: 3, value });
        else if (type === 'select') {
          input = element('select');
          input.append(...options!.map((o) => new Option(t(`qr.o.${o}` as UiKey), o)));
          input.value = value || options![0];
          input.setAttribute('aria-label', t(`qr.f.${name}` as UiKey));
        } else {
          input = Object.assign(element('input'), { type, value });
          if (type === 'checkbox') (input as HTMLInputElement).checked = value === 'true';
          if (name === 'lat' || name === 'lng' || name === 'am' || name === 'amount') input.setAttribute('step', 'any');
        }
        input.name = name;
        input.addEventListener('input', () => {
          values[kind][name] = input instanceof HTMLInputElement && input.type === 'checkbox' ? String(input.checked) : input.value;
          update();
        });
        if (type === 'checkbox') label.prepend(input);
        else label.append(input);
        return label;
      }),
    );
  };

  // ---- How it looks ----
  const design = element('div', 'qr-design');
  /** A row of buttons, each showing what it does on a small sample code. */
  const picker = <K extends keyof Style>(key: K, label: UiKey, choices: Style[K][], sample: (value: Style[K]) => Partial<Style>) => {
    const group = element('div', 'qr-picks');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(label));
    const buttons = choices.map((value) => {
      const button = element('button', 'qr-pick');
      button.type = 'button';
      button.title = t(`qr.s.${String(value)}` as UiKey);
      button.setAttribute('aria-label', button.title);
      button.append(thumb({ ...DEFAULT_STYLE, margin: 1, ...sample(value) }));
      button.onclick = () => {
        style = { ...style, [key]: value };
        update();
      };
      return button;
    });
    group.append(...buttons);
    const sync = () => buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(style[key] === choices[i])));
    const wrap = element('div', 'qr-row');
    wrap.append(element('span', 'qr-label', t(label)), group);
    return { wrap, sync };
  };
  const templates = element('div', 'qr-picks qr-templates');
  templates.setAttribute('role', 'group');
  templates.setAttribute('aria-label', t('qr.templates'));
  templates.append(
    ...TEMPLATES.map(([name, look]) => {
      const button = element('button', 'qr-pick');
      button.type = 'button';
      button.title = t(`qr.t.${name}` as UiKey);
      button.setAttribute('aria-label', button.title);
      button.append(thumb({ ...DEFAULT_STYLE, ...look, margin: 1 }));
      button.onclick = () => {
        style = { ...DEFAULT_STYLE, ...look, logo: style.logo, logoSize: style.logoSize };
        update();
      };
      return button;
    }),
  );
  const dots = picker('dots', 'qr.dots', ['square', 'rounded', 'extra', 'classy', 'dots'] as Dots[], (dots) => ({ dots }));
  const eyeFrame = picker('eyeFrame', 'qr.eyeFrame', ['square', 'rounded', 'circle'] as Eye[], (eyeFrame) => ({ eyeFrame, eyeColor: '#2563eb' }));
  const eyeBall = picker('eyeBall', 'qr.eyeBall', ['square', 'rounded', 'circle'] as Eye[], (eyeBall) => ({ eyeBall, eyeColor: '#2563eb' }));

  const colorInput = (key: 'color' | 'color2' | 'eyeColor' | 'background' | 'frameColor', label: UiKey) => {
    const input = Object.assign(element('input'), { type: 'color' });
    input.addEventListener('input', () => {
      style = { ...style, [key]: input.value };
      update();
    });
    const wrap = element('label', 'qr-color', t(label));
    wrap.append(input);
    return { wrap, sync: () => (input.value = style[key] || '#ffffff') };
  };
  const select = <K extends keyof Style>(key: K, label: UiKey, choices: string[], cast: (v: string) => Style[K] = (v) => v as Style[K]) => {
    const input = element('select');
    input.append(...choices.map((c) => new Option(t(`qr.s.${c}` as UiKey), c)));
    input.addEventListener('change', () => {
      style = { ...style, [key]: cast(input.value) };
      update();
    });
    input.setAttribute('aria-label', t(label));
    const wrap = element('label', 'qr-field', t(label));
    wrap.append(input);
    return { wrap, input, sync: () => (input.value = String(style[key])) };
  };
  const color = colorInput('color', 'qr.color');
  const gradient = select('gradient', 'qr.gradient', ['none', 'linear', 'radial']);
  const color2 = colorInput('color2', 'qr.color2');
  const eyeColor = colorInput('eyeColor', 'qr.eyeColor');
  const background = colorInput('background', 'qr.background');
  const clear = Object.assign(element('input'), { type: 'checkbox' });
  clear.addEventListener('change', () => {
    style = { ...style, background: clear.checked ? '' : '#ffffff' };
    update();
  });
  const clearLabel = element('label', 'qr-check', t('qr.clear'));
  clearLabel.prepend(clear);
  const colors = element('div', 'qr-colors');
  colors.append(color.wrap, gradient.wrap, color2.wrap, eyeColor.wrap, background.wrap, clearLabel);

  // Pictures (a logo, a background) are read here and shrunk so the SVG stays small; never sent anywhere.
  const picture = (key: 'logo' | 'image', add: UiKey, remove: UiKey, max: number) => {
    const input = Object.assign(element('input'), { type: 'file', accept: 'image/*', className: 'qr-file' });
    input.setAttribute('aria-label', t(add));
    const choose = element('button', 'button', t(add));
    choose.type = 'button';
    choose.onclick = () => input.click();
    const drop = element('button', 'button', t(remove));
    drop.type = 'button';
    drop.onclick = () => {
      style = { ...style, [key]: undefined };
      update();
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        style = { ...style, [key]: key === 'logo' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85) };
        update();
      } catch {
        warn.textContent = t('qr.logoBad');
      }
    });
    return { input, choose, drop };
  };
  const logo = picture('logo', 'qr.logo', 'qr.logoRemove', 512);
  const image = picture('image', 'qr.image', 'qr.imageRemove', 1200);
  // Ready-made icons for the most common codes, drawn here (no brand logos).
  const iconRow = element('div', 'qr-picks');
  iconRow.setAttribute('role', 'group');
  iconRow.setAttribute('aria-label', t('qr.icons'));
  iconRow.append(
    ...ICONS.map(([name, color, glyph]) => {
      const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="${color}"/><g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`)}`;
      const pick = element('button', 'qr-pick');
      pick.type = 'button';
      pick.title = t(`qr.i.${name}` as UiKey);
      pick.setAttribute('aria-label', pick.title);
      pick.append(Object.assign(element('img'), { src, alt: '' }));
      pick.onclick = () => {
        style = { ...style, logo: src };
        update();
      };
      return pick;
    }),
  );
  const logoSize = Object.assign(element('input'), { type: 'range', min: '10', max: '30', value: String(DEFAULT_STYLE.logoSize * 100) });
  logoSize.addEventListener('input', () => {
    style = { ...style, logoSize: Number(logoSize.value) / 100 };
    update();
  });
  const logoSizeLabel = element('label', 'qr-range', t('qr.logoSize'));
  logoSizeLabel.append(logoSize);
  const logoRow = element('div', 'qr-row qr-inline');
  logoRow.append(logo.choose, logo.input, logo.drop, logoSizeLabel);
  const imageRow = element('div', 'qr-row qr-inline');
  imageRow.append(image.choose, image.input, image.drop);

  const frame = select('frame', 'qr.frame', ['none', 'label', 'box']);
  const frameText = Object.assign(element('input'), { type: 'text', maxLength: 24 });
  frameText.addEventListener('input', () => {
    style = { ...style, frameText: frameText.value };
    update();
  });
  const frameTextLabel = element('label', 'qr-field', t('qr.frameText'));
  frameTextLabel.append(frameText);
  const frameColor = colorInput('frameColor', 'qr.frameColor');
  const frameRow = element('div', 'qr-colors');
  frameRow.append(frame.wrap, frameTextLabel, frameColor.wrap);

  const margin = Object.assign(element('input'), { type: 'range', min: '0', max: '8', value: String(DEFAULT_STYLE.margin) });
  margin.addEventListener('input', () => {
    style = { ...style, margin: Number(margin.value) };
    update();
  });
  const marginLabel = element('label', 'qr-range', t('qr.margin'));
  marginLabel.append(margin);
  const ecc = select('ecc', 'qr.ecc', ['L', 'M', 'Q', 'H'], (v) => v as Style['ecc']);
  const moreRow = element('div', 'qr-colors');
  moreRow.append(marginLabel, ecc.wrap);

  const section = (title: UiKey, ...children: HTMLElement[]) => {
    const box = element('fieldset', 'qr-section');
    box.append(element('legend', '', t(title)), ...children);
    return box;
  };
  design.append(
    section('qr.templates', templates),
    section('qr.shapes', dots.wrap, eyeFrame.wrap, eyeBall.wrap),
    section('qr.colors', colors),
    section('qr.logoTitle', iconRow, logoRow, element('p', 'hint', t('qr.logoHint'))),
    section('qr.imageTitle', imageRow, element('p', 'hint', t('qr.imageHint'))),
    section('qr.frameTitle', frameRow),
    section('qr.more', moreRow),
  );
  form.append(section('qr.content', kindGroup, fields), design);

  // ---- Preview and download ----
  const preview = element('div', 'qr-preview');
  preview.setAttribute('role', 'img');
  const check = element('p', 'qr-check-result');
  check.setAttribute('role', 'status');
  const warn = element('p', 'qr-warn');
  warn.setAttribute('role', 'status');
  const format = element('select');
  format.append(...FORMATS.map((f) => new Option(f.toUpperCase(), f)));
  const formatLabel = element('label', 'qr-field', t('qr.format'));
  format.setAttribute('aria-label', t('qr.format'));
  formatLabel.append(format);
  const size = element('select');
  size.append(...SIZES.map((s) => new Option(`${s} px`, s)));
  size.value = '1024';
  const sizeLabel = element('label', 'qr-field', t('qr.size'));
  size.setAttribute('aria-label', t('qr.size'));
  sizeLabel.append(size);
  format.addEventListener('change', () => (size.disabled = format.value === 'svg'));
  const name = Object.assign(element('input'), { type: 'text', value: 'qr-code', spellcheck: false });
  const nameLabel = element('label', 'qr-field', t('qr.name'));
  nameLabel.append(name);
  const download = element('button', 'button primary', t('qr.download'));
  download.type = 'button';
  const copy = element('button', 'button', t('qr.copy'));
  copy.type = 'button';
  copy.hidden = !('ClipboardItem' in window);
  const share = element('button', 'button', t('qr.share'));
  share.type = 'button';
  share.hidden = !navigator.canShare;
  const exportRow = element('div', 'qr-colors');
  exportRow.append(formatLabel, sizeLabel, nameLabel);
  const actions = element('div', 'actions');
  actions.append(download, copy, share);
  side.append(preview, check, warn, exportRow, actions);

  let current: ReturnType<typeof svg> | undefined;
  function update() {
    for (const p of [dots, eyeFrame, eyeBall]) p.sync();
    for (const c of [color, color2, eyeColor, background, frameColor]) c.sync();
    gradient.sync();
    frame.sync();
    ecc.sync();
    color2.wrap.hidden = style.gradient === 'none';
    clear.checked = !style.background;
    background.wrap.hidden = !style.background;
    frameText.value = style.frameText;
    frameTextLabel.hidden = frameColor.wrap.hidden = style.frame === 'none';
    margin.value = String(style.margin);
    logo.drop.hidden = logoSizeLabel.hidden = !style.logo;
    image.drop.hidden = !style.image;
    // A logo covers part of the code, so the strongest error correction is used and can't be changed.
    ecc.input.disabled = !!style.logo;
    if (style.logo) ecc.input.value = 'H';

    const text = payload(kind, values[kind]);
    const problems: string[] = [];
    if (!text) {
      current = undefined;
      preview.replaceChildren(element('p', 'hint', t('qr.empty')));
      preview.setAttribute('aria-label', t('qr.empty'));
    } else
      try {
        current = svg(text, style);
        preview.innerHTML = current.svg;
        preview.setAttribute('aria-label', t('qr.previewOf', { text: text.length > 80 ? `${text.slice(0, 80)}…` : text }));
      } catch {
        current = undefined;
        preview.replaceChildren(element('p', 'hint', t('qr.tooLong')));
        preview.setAttribute('aria-label', t('qr.tooLong'));
      }
    // Phone cameras need dark dots on a light background, with enough difference between them.
    const bg = style.background || '#ffffff';
    const dark = [style.color, ...(style.gradient === 'none' ? [] : [style.color2]), style.eyeColor];
    if (dark.some((c) => contrast(c, bg) < 3)) problems.push(t('qr.lowContrast'));
    else if (style.background && dark.some((c) => contrast(c, '#000000') > contrast(bg, '#000000'))) problems.push(t('qr.inverted'));
    warn.textContent = problems.join(' ');
    scanCheck(text);
    download.disabled = copy.disabled = share.disabled = !current;
  }

  // Reads the finished code back, as a phone camera would, a moment after the last change.
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let checking = 0;
  const scanCheck = (text: string) => {
    clearTimeout(checkTimer);
    check.textContent = '';
    delete check.dataset.ok;
    if (!current) return;
    const code = current;
    const job = ++checking;
    checkTimer = setTimeout(async () => {
      try {
        const { readCodes } = await import('../engine/scan');
        const found = await readCodes(await raster(code, 600, 'image/png', true));
        if (job !== checking) return;
        const ok = found.some((f) => f.text === text);
        check.dataset.ok = String(ok);
        check.textContent = t(ok ? 'qr.scanOk' : 'qr.scanBad');
      } catch {
        // The reader couldn't load (offline before first use): no verdict rather than a wrong one.
      }
    }, 400);
  };

  const fileFor = async (as: Format): Promise<File> => {
    const code = current!;
    const px = Number(size.value);
    const base = (name.value.trim() || 'qr-code').replace(/[\\/:*?"<>|]+/g, '-');
    if (as === 'svg') return new File([code.svg], `${base}.svg`, { type: 'image/svg+xml' });
    if (as === 'pdf') {
      // Printed at 300 dpi: 1024 px is about 87 mm wide.
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const png = await pdf.embedPng(await (await raster(code, px, 'image/png', false)).arrayBuffer());
      const width = (px / 300) * 72;
      const height = (width * code.height) / code.width;
      pdf.addPage([width, height]).drawImage(png, { x: 0, y: 0, width, height });
      return new File([(await pdf.save()) as Uint8Array<ArrayBuffer>], `${base}.pdf`, { type: 'application/pdf' });
    }
    const type = `image/${as === 'jpg' ? 'jpeg' : as}`;
    return new File([await raster(code, px, type, as === 'jpg')], `${base}.${as}`, { type });
  };
  download.onclick = async () => {
    const file = await fileFor(format.value as Format);
    const url = URL.createObjectURL(file);
    const link = Object.assign(element('a'), { href: url, download: file.name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    warn.textContent = t('qr.saved', { name: file.name });
  };
  copy.onclick = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': fileFor('png') })]);
      warn.textContent = t('qr.copied');
    } catch {
      warn.textContent = t('qr.copyFailed');
    }
  };
  share.onclick = async () => {
    const file = await fileFor('png');
    if (navigator.canShare?.({ files: [file] }))
      try {
        await navigator.share({ files: [file] });
      } catch {
        // closed the share sheet: nothing to do
      }
  };

  showFields();
  update();
}
