import { describe, expect, it } from 'vitest';
import { frameFor, subjectBox } from '../src/engine/background';

/** A w×h transparent picture with an opaque rectangle. */
function picture(w: number, h: number, [x, y, bw, bh]: number[]) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) rgba[(j * w + i) * 4 + 3] = 255;
  return rgba;
}

describe('crop to the subject', () => {
  it('finds the box around everything that is not see-through', () => {
    expect(subjectBox(picture(100, 80, [20, 10, 30, 40]), 100, 80)).toEqual([20, 10, 30, 40]);
  });

  it('ignores faint pixels and reports an empty picture', () => {
    const rgba = picture(50, 50, [0, 0, 0, 0]);
    rgba[(5 * 50 + 5) * 4 + 3] = 10;
    expect(subjectBox(rgba, 50, 50)).toBeUndefined();
  });

  it('frames the whole photo, the subject with a margin, or a square around it', () => {
    const box: [number, number, number, number] = [20, 10, 30, 40];
    expect(frameFor('photo', box, 100, 80)).toEqual([0, 0, 100, 80]);
    // 8% of the long side (40) is a 3 px margin.
    expect(frameFor('subject', box, 100, 80)).toEqual([17, 7, 36, 46]);
    const [x, y, w, h] = frameFor('square', box, 100, 80);
    expect(w).toBe(h);
    expect(w).toBe(46);
    // Centred on the subject.
    expect(x + w / 2).toBeCloseTo(35, 0);
    expect(y + h / 2).toBeCloseTo(30, 0);
  });

  it('falls back to the whole photo when nothing is left', () => {
    expect(frameFor('square', undefined, 100, 80)).toEqual([0, 0, 100, 80]);
  });
});
