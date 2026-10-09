import { describe, expect, it } from 'vitest';
import { areaBox, regionAt } from '../src/engine/magic';

/** A w×h picture: grey everywhere, with a red square and a separate red dot. */
function picture(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([128, 128, 128, 255], i * 4);
  const paint = (x: number, y: number) => rgba.set([220, 30, 30, 255], (y * w + x) * 4);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) paint(x, y);
  paint(9, 9);
  return rgba;
}

describe('tap to remove or keep', () => {
  it('picks the connected area of the tapped colour only', () => {
    const area = regionAt(picture(12, 12), 12, 12, 3, 3);
    expect(area.reduce((a, b) => a + b, 0)).toBe(16);
    expect(areaBox(area, 12, 12)).toEqual([2, 2, 4, 4]);
    expect(area[9 * 12 + 9]).toBe(0); // same colour, but not connected
  });

  it('stays inside the allowed pixels', () => {
    const area = regionAt(picture(12, 12), 12, 12, 0, 0, 40, (i) => i % 12 < 6);
    expect(areaBox(area, 12, 12)).toEqual([0, 0, 6, 12]);
  });

  it('returns nothing when the tapped pixel is not allowed', () => {
    expect(areaBox(regionAt(picture(12, 12), 12, 12, 3, 3, 40, () => false), 12, 12)).toBeUndefined();
  });
});
