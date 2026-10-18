// Everyday photo edits as plain pixel maths, so every browser gives the same result and tests can check it.

/** Slider values from -100 to 100 (0 leaves the photo as it is), and a sepia tone from 0 to 100. */
export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sepia: number;
}

export const NONE: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sepia: 0 };

/** One-tap looks. Each is a set of slider values, added to the user's own. */
export const FILTERS = {
  original: NONE,
  bw: { ...NONE, saturation: -100 },
  vivid: { ...NONE, saturation: 40, contrast: 15 },
  warm: { ...NONE, warmth: 35, saturation: 10 },
  cool: { ...NONE, warmth: -35 },
  fade: { ...NONE, brightness: 10, contrast: -30, saturation: -20 },
  sepia: { ...NONE, sepia: 80 },
  noir: { ...NONE, brightness: -5, contrast: 45, saturation: -100 },
} satisfies Record<string, Adjust>;
export type Filter = keyof typeof FILTERS;

const clamp = (value: number, low: number) => Math.max(low, Math.min(100, value));

/** A look plus the user's sliders, every value kept in range. */
export const combine = (look: Adjust, own: Adjust): Adjust => ({
  brightness: clamp(look.brightness + own.brightness, -100),
  contrast: clamp(look.contrast + own.contrast, -100),
  saturation: clamp(look.saturation + own.saturation, -100),
  warmth: clamp(look.warmth + own.warmth, -100),
  sepia: clamp(look.sepia + own.sepia, 0),
});

/** Changes RGBA pixels in place. Transparent pixels keep their transparency. */
export function adjustPixels(data: Uint8ClampedArray, a: Adjust) {
  if (!a.brightness && !a.contrast && !a.saturation && !a.warmth && !a.sepia) return;
  const lift = a.brightness * 1.28;
  const k = 1 + a.contrast / 100; // -100 is flat grey, +100 doubles the contrast
  const sat = 1 + a.saturation / 100;
  const warm = a.warmth * 0.3;
  const sepia = a.sepia / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = (data[i] - 128) * k + 128 + lift;
    let g = (data[i + 1] - 128) * k + 128 + lift;
    let b = (data[i + 2] - 128) * k + 128 + lift;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * sat + warm;
    g = y + (g - y) * sat;
    b = y + (b - y) * sat - warm;
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sepia;
      g += (sg - g) * sepia;
      b += (sb - b) * sepia;
    }
    data[i] = r; // Uint8ClampedArray rounds and keeps 0–255
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** Width and height after a quarter turn (90° or 270°) swaps them. */
export const turned = (w: number, h: number, quarterTurns: number): [number, number] => (quarterTurns % 2 ? [h, w] : [w, h]);

/** Scales w×h down so neither side passes `max` and the area stays under `maxArea` (iPhones refuse bigger canvases). */
export function fit(w: number, h: number, max = Infinity, maxArea = 16_777_216): [number, number] {
  const scale = Math.min(1, max / Math.max(w, h), Math.sqrt(maxArea / (w * h)));
  // Rounded down (with a hair of slack for float error), so the area never passes the limit.
  return [Math.max(1, Math.floor(w * scale + 1e-6)), Math.max(1, Math.floor(h * scale + 1e-6))];
}

/**
 * The part of a w×h picture kept by a frame of shape `ratio` (width ÷ height; 0 keeps the picture's own),
 * zoomed in `zoom` times, centred at (cx, cy) as fractions of the picture. Returns [x, y, width, height]
 * in pixels, always inside the picture.
 */
export function frame(w: number, h: number, ratio: number, zoom: number, cx: number, cy: number): [number, number, number, number] {
  const shape = ratio || w / h;
  const fw = Math.min(w, h * shape) / zoom;
  const fh = fw / shape;
  const x = Math.min(w - fw, Math.max(0, cx * w - fw / 2));
  const y = Math.min(h - fh, Math.max(0, cy * h - fh / 2));
  return [Math.round(x), Math.round(y), Math.round(fw), Math.round(fh)];
}
