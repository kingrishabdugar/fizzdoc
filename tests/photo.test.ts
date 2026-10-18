import { describe, expect, it } from 'vitest';
import { FILTERS, LAYOUTS, NONE, adjustPixels, cells, combine, fit, frame, place, turned } from '../src/engine/photo';

const pixel = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);

describe('photo edits', () => {
  it('leaves the pixels alone with every slider at 0', () => {
    const data = pixel(10, 120, 240);
    adjustPixels(data, NONE);
    expect([...data]).toEqual([10, 120, 240, 255]);
  });

  it('makes black and white grey, brightens, and warms', () => {
    const grey = pixel(200, 40, 40);
    adjustPixels(grey, FILTERS.bw);
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    const bright = pixel(100, 100, 100);
    adjustPixels(bright, { ...NONE, brightness: 50 });
    expect(bright[0]).toBe(164);
    const warm = pixel(100, 100, 100);
    adjustPixels(warm, { ...NONE, warmth: 50 });
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(warm[3]).toBe(255);
  });

  it('adds a look to the sliders, kept in range', () => {
    expect(combine(FILTERS.noir, { ...NONE, saturation: -50, contrast: 80 })).toEqual({ brightness: -5, contrast: 100, saturation: -100, warmth: 0, sepia: 0 });
  });

  it('swaps the sides on a quarter turn and keeps big pictures under the canvas limits', () => {
    expect(turned(4000, 3000, 1)).toEqual([3000, 4000]);
    expect(turned(4000, 3000, 2)).toEqual([4000, 3000]);
    expect(fit(4000, 3000, 1600)).toEqual([1600, 1200]);
    const [w, h] = fit(8000, 6000);
    expect(w * h).toBeLessThanOrEqual(16_777_216);
  });

  it('frames a shape inside the photo, zoomed and moved, never past its edges', () => {
    // A square from a 4000 × 3000 photo: 3000 px, centred.
    expect(frame(4000, 3000, 1, 1, 0.5, 0.5)).toEqual([500, 0, 3000, 3000]);
    // Twice the zoom is half the size; moved all the way right, it stops at the edge.
    expect(frame(4000, 3000, 1, 2, 1, 0.5)).toEqual([2500, 750, 1500, 1500]);
    // No shape keeps the photo's own.
    expect(frame(4000, 3000, 0, 1, 0.5, 0.5)).toEqual([0, 0, 4000, 3000]);
    // Rounding never pushes the box past an edge.
    for (const zoom of [1, 1.3, 1.6, 2.05, 2.9])
      for (const [cx, cy] of [[0, 0], [1, 1], [0.5, 1]]) {
        const [x, y, fw, fh] = frame(4032, 3024, 16 / 9, zoom, cx, cy);
        expect(x + fw).toBeLessThanOrEqual(4032);
        expect(y + fh).toBeLessThanOrEqual(3024);
      }
  });
});

describe('collage layouts', () => {
  it('has one cell per photo, filling the collage with no overlaps', () => {
    for (const [count, layouts] of Object.entries(LAYOUTS))
      for (const [counts, columns] of layouts) {
        const all = cells(counts, columns);
        expect(all.length, `${counts} ${columns ?? ''}`).toBe(Number(count));
        expect(all.reduce((sum, [, , w, h]) => sum + w * h, 0)).toBeCloseTo(1);
        for (const [i, a] of all.entries())
          for (const b of all.slice(i + 1)) {
            const apart = a[0] + a[2] <= b[0] + 1e-9 || b[0] + b[2] <= a[0] + 1e-9 || a[1] + a[3] <= b[1] + 1e-9 || b[1] + b[3] <= a[1] + 1e-9;
            expect(apart).toBe(true);
          }
      }
  });

  it('leaves the same gap around the edge and between cells', () => {
    const [left, right] = cells([2]).map((cell) => place(cell, 1000, 500, 20));
    expect(left).toEqual([20, 20, 470, 460]);
    expect(right[0] - (left[0] + left[2])).toBe(20);
    expect(1000 - (right[0] + right[2])).toBe(20);
  });
});
