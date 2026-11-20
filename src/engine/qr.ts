// QR codes, made on the device: what goes in the code (payload) and how it looks (svg).
// uqr turns text into the grid of dark and light squares; everything visual is drawn here, so the
// preview and every download come from the same SVG.
import { encode } from 'uqr';

export type Kind = 'url' | 'text' | 'email' | 'phone' | 'sms' | 'whatsapp' | 'upi' | 'wifi' | 'vcard' | 'event' | 'location' | 'crypto';
export type Fields = Record<string, string>;

/** Wi-Fi and MECARD-style fields escape these with a backslash. */
const esc = (value = '') => value.replace(/([\\;,:"])/g, '\\$1');
/** vCard and iCal text values escape commas, semicolons and backslashes, and fold newlines. */
const ical = (value = '') => value.replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
const digits = (value = '') => value.replace(/[^\d+]/g, '');
const query = (pairs: [string, string | undefined][]) => {
  const kept = pairs.filter(([, value]) => value);
  return kept.length ? `?${kept.map(([key, value]) => `${key}=${encodeURIComponent(value!)}`).join('&')}` : '';
};
/** 2026-11-20T09:30 (a datetime-local value) as 20261120T093000. */
const stamp = (value = '') => value.replace(/[-:]/g, '').replace(/^(\d{8}T\d{4})$/, '$100');

/** The text a phone reads from the code: a link, a Wi-Fi login, a contact card, a UPI payment… */
export function payload(kind: Kind, f: Fields): string {
  switch (kind) {
    case 'url': {
      const url = (f.url ?? '').trim();
      return !url || /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
    }
    case 'text':
      return f.text ?? '';
    case 'email':
      return f.to || f.subject || f.body ? `mailto:${f.to ?? ''}${query([['subject', f.subject], ['body', f.body]])}` : '';
    case 'phone':
      return f.phone ? `tel:${digits(f.phone)}` : '';
    case 'sms':
      return f.phone ? `SMSTO:${digits(f.phone)}:${f.message ?? ''}` : '';
    case 'whatsapp':
      return f.phone ? `https://wa.me/${digits(f.phone).replace(/^\+/, '')}${query([['text', f.message]])}` : '';
    case 'upi':
      // NPCI's UPI deep link; every UPI app (GPay, PhonePe, Paytm, BHIM) reads it.
      return f.pa ? `upi://pay${query([['pa', f.pa.trim()], ['pn', f.pn], ['am', f.am], ['cu', 'INR'], ['tn', f.tn]])}` : '';
    case 'wifi':
      return f.ssid
        ? `WIFI:T:${f.security === 'nopass' ? 'nopass' : f.security || 'WPA'};S:${esc(f.ssid)};${f.security === 'nopass' || !f.password ? '' : `P:${esc(f.password)};`}${f.hidden === 'true' ? 'H:true;' : ''};`
        : '';
    case 'vcard': {
      if (!f.first && !f.last && !f.org && !f.phone && !f.email) return '';
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${ical(f.last)};${ical(f.first)};;;`,
        `FN:${ical([f.first, f.last].filter(Boolean).join(' ') || f.org)}`,
        f.org && `ORG:${ical(f.org)}`,
        f.title && `TITLE:${ical(f.title)}`,
        f.phone && `TEL;TYPE=CELL:${digits(f.phone)}`,
        f.email && `EMAIL:${f.email}`,
        f.website && `URL:${f.website}`,
        f.address && `ADR:;;${ical(f.address)};;;;`,
        'END:VCARD',
      ];
      return lines.filter(Boolean).join('\n');
    }
    case 'event':
      return f.summary
        ? ['BEGIN:VEVENT', `SUMMARY:${ical(f.summary)}`, f.start && `DTSTART:${stamp(f.start)}`, f.end && `DTEND:${stamp(f.end)}`, f.location && `LOCATION:${ical(f.location)}`, 'END:VEVENT']
            .filter(Boolean)
            .join('\n')
        : '';
    case 'location':
      return f.lat && f.lng ? `geo:${Number(f.lat)},${Number(f.lng)}` : '';
    case 'crypto':
      return f.wallet ? `${f.coin || 'bitcoin'}:${f.wallet.trim()}${query([['amount', f.amount]])}` : '';
  }
}

export type Dots = 'square' | 'rounded' | 'extra' | 'classy' | 'dots';
export type Eye = 'square' | 'rounded' | 'circle';
export interface Style {
  dots: Dots;
  eyeFrame: Eye;
  eyeBall: Eye;
  color: string;
  /** Second colour of the gradient; unused when gradient is 'none'. */
  color2: string;
  gradient: 'none' | 'linear' | 'radial';
  eyeColor: string;
  /** A colour, or '' for a see-through background. */
  background: string;
  /** Quiet zone, in modules. */
  margin: number;
  ecc: 'L' | 'M' | 'Q' | 'H';
  /** A data: URL, so the SVG stays one self-contained file. */
  logo?: string;
  /** Logo width as a share of the code, 0.1–0.3. */
  logoSize: number;
  frame: 'none' | 'label' | 'box';
  frameText: string;
  frameColor: string;
}

export const DEFAULT_STYLE: Style = {
  dots: 'square',
  eyeFrame: 'square',
  eyeBall: 'square',
  color: '#000000',
  color2: '#1e6fd9',
  gradient: 'none',
  eyeColor: '#000000',
  background: '#ffffff',
  margin: 4,
  ecc: 'M',
  logoSize: 0.22,
  frame: 'none',
  frameText: 'SCAN ME',
  frameColor: '#000000',
};

/** Corner radius (in modules) and which corners may round: top-left, top-right, bottom-right, bottom-left. */
const CORNERS: Record<Exclude<Dots, 'dots'>, [number, boolean[]]> = {
  square: [0, [false, false, false, false]],
  rounded: [0.3, [true, true, true, true]],
  extra: [0.5, [true, true, true, true]],
  classy: [0.5, [true, false, true, false]],
};
const EYE_RADIUS: Record<Eye, number> = { square: 0, rounded: 0.25, circle: 0.5 };

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (value: number) => +value.toFixed(3);

/** WCAG contrast ratio of two #rrggbb colours (1–21). Phone cameras want about 3 or more. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The code as an SVG document. Units are modules; the caller sets the pixel size. */
export function svg(text: string, style: Style): { svg: string; width: number; height: number } {
  // A logo hides some modules, so it needs the strongest error correction.
  const qr = encode(text, { ecc: style.logo ? 'H' : style.ecc, border: 0 });
  const size = qr.size;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && qr.data[y][x];
  const eye = (x: number, y: number) => (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  // The logo's square, centred, with the modules under it left out.
  const logoSide = style.logo ? Math.round(size * style.logoSize) | 1 : 0;
  const logoAt = (size - logoSide) / 2;
  const underLogo = (x: number, y: number) => logoSide > 0 && x >= logoAt - 0.5 && y >= logoAt - 0.5 && x < logoAt + logoSide + 0.5 && y < logoAt + logoSide + 0.5;

  let dots = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!dark(x, y) || eye(x, y) || underLogo(x, y)) continue;
      if (style.dots === 'dots') {
        dots += `M${x + 0.5} ${y + 0.05}a0.45 0.45 0 1 1 0 0.9a0.45 0.45 0 1 1 0-0.9z`;
        continue;
      }
      // A corner rounds only where both of its neighbours are light, so joined modules stay joined.
      const [r, allowed] = CORNERS[style.dots];
      const up = dark(x, y - 1);
      const down = dark(x, y + 1);
      const left = dark(x - 1, y);
      const right = dark(x + 1, y);
      const [tl, tr, br, bl] = [!up && !left, !up && !right, !down && !right, !down && !left].map((free, i) => (free && allowed[i] ? r : 0));
      dots +=
        `M${x + tl} ${y}H${x + 1 - tr}` +
        (tr ? `a${tr} ${tr} 0 0 1 ${tr} ${tr}` : '') +
        `V${y + 1 - br}` +
        (br ? `a${br} ${br} 0 0 1 -${br} ${br}` : '') +
        `H${x + bl}` +
        (bl ? `a${bl} ${bl} 0 0 1 -${bl} -${bl}` : '') +
        `V${y + tl}` +
        (tl ? `a${tl} ${tl} 0 0 1 ${tl} -${tl}` : '') +
        'z';
    }

  const m = style.margin;
  const frameR = EYE_RADIUS[style.eyeFrame] * 6;
  const ballR = EYE_RADIUS[style.eyeBall] * 3;
  const eyes = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]
    .map(
      ([x, y]) =>
        `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="${frameR}" fill="none" stroke="${style.eyeColor}" stroke-width="1"/>` +
        `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${ballR}" fill="${style.eyeColor}"/>`,
    )
    .join('');

  const fill = style.gradient === 'none' ? style.color : 'url(#qr-fill)';
  const gradient =
    style.gradient === 'linear'
      ? `<linearGradient id="qr-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${size}" y2="${size}"><stop offset="0" stop-color="${style.color}"/><stop offset="1" stop-color="${style.color2}"/></linearGradient>`
      : style.gradient === 'radial'
        ? `<radialGradient id="qr-fill" gradientUnits="userSpaceOnUse" cx="${size / 2}" cy="${size / 2}" r="${size * 0.7}"><stop offset="0" stop-color="${style.color}"/><stop offset="1" stop-color="${style.color2}"/></radialGradient>`
        : '';
  const logo = style.logo
    ? `<image href="${xml(style.logo)}" x="${n(logoAt + 0.15)}" y="${n(logoAt + 0.15)}" width="${n(logoSide - 0.3)}" height="${n(logoSide - 0.3)}" preserveAspectRatio="xMidYMid meet"/>`
    : '';

  // The frame: a label under the code, or a border around it with the label at the bottom.
  const width = size + 2 * m;
  const box = style.frame === 'box';
  const pad = box ? 1.5 : 0;
  const label = style.frame !== 'none' && style.frameText.trim() ? size * 0.16 : 0;
  const outer = width + 2 * pad;
  const height = outer + (label ? label + (box ? 0 : 1) : 0);
  const textSize = label * 0.55;
  const frame =
    style.frame === 'none'
      ? ''
      : (box ? `<rect x="0.5" y="0.5" width="${n(outer - 1)}" height="${n(height - 1)}" rx="2" fill="none" stroke="${style.frameColor}" stroke-width="1"/>` : '') +
        (label
          ? `<rect x="${box ? 0 : m}" y="${n(height - label)}" width="${n(box ? outer : size)}" height="${n(label)}" rx="${box ? 0 : 1}" fill="${style.frameColor}"/>` +
            `<text x="${n(outer / 2)}" y="${n(height - label / 2)}" fill="${contrast(style.frameColor, '#ffffff') >= 3 ? '#ffffff' : '#000000'}" font-family="system-ui, sans-serif" font-weight="700" font-size="${n(textSize)}" text-anchor="middle" dominant-baseline="central">${xml(style.frameText.trim())}</text>`
          : '');
  const background = style.background ? `<rect width="${n(outer)}" height="${n(height)}" fill="${style.background}"${box ? ' rx="2"' : ''}/>` : '';

  return {
    width: outer,
    height,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(outer)} ${n(height)}" shape-rendering="${style.dots === 'square' ? 'crispEdges' : 'geometricPrecision'}">` +
      (gradient ? `<defs>${gradient}</defs>` : '') +
      background +
      frame +
      `<g transform="translate(${n(m + pad)} ${n(m + pad)})"><path d="${dots}" fill="${fill}"/>${eyes}${logo}</g>` +
      '</svg>',
  };
}
