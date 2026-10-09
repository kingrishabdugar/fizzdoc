// "Tap to remove" and "Tap to keep": one tap picks the whole connected area of similar colour, so a
// leftover patch of background (or a missed sleeve) is fixed at once instead of painted over.
// Plain flood fill on a reduced copy of the photo; the caller blends the result in at full size.

/**
 * The connected area around (sx, sy) whose colour stays close to the tapped colour.
 * `allowed`, when given, limits the area (for example to pixels that are still visible).
 * Returns 1 for every pixel in the area, 0 elsewhere.
 */
export function regionAt(rgba: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tolerance = 40, allowed?: (i: number) => boolean): Uint8Array {
  const area = new Uint8Array(w * h);
  const x0 = Math.min(w - 1, Math.max(0, Math.round(sx)));
  const y0 = Math.min(h - 1, Math.max(0, Math.round(sy)));
  const start = y0 * w + x0;
  if (allowed && !allowed(start)) return area;
  const r = rgba[start * 4];
  const g = rgba[start * 4 + 1];
  const b = rgba[start * 4 + 2];
  const limit = tolerance * tolerance;
  const close = (i: number) => {
    const dr = rgba[i * 4] - r;
    const dg = rgba[i * 4 + 1] - g;
    const db = rgba[i * 4 + 2] - b;
    return dr * dr + dg * dg + db * db <= limit && (!allowed || allowed(i));
  };
  const stack = [start];
  area[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w])
      if (j >= 0 && j < w * h && !area[j] && close(j)) {
        area[j] = 1;
        stack.push(j);
      }
  }
  return area;
}

/** The area's box as [x, y, w, h], or undefined when it is empty. */
export function areaBox(area: Uint8Array, w: number, h: number): [number, number, number, number] | undefined {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < area.length; i++)
    if (area[i]) {
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < 0 ? undefined : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
