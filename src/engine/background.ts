// Remove Background, page side: hands pictures to background-worker.ts and puts the cut-out on a
// new backdrop (nothing, a colour, another photo, or the original photo blurred) at any size.
import { LocalError } from './local';
import type { BackgroundModel, FromBackground, ToBackground } from './background-worker';

export interface Hooks {
  /** Speed over the finest edges, for animations with many frames. */
  fast?: boolean;
  /** First-run download of the model and runtime: bytes so far and in total. */
  onSetup?: (loaded: number, total: number) => void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (message: FromBackground) => void; reject: (error: Error) => void; hooks: Hooks }>();

function connect() {
  if (worker) return worker;
  worker = new Worker(new URL('./background-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<FromBackground>) => {
    if (data.type === 'setup') {
      for (const job of pending.values()) job.hooks.onSetup?.(data.loaded, data.total);
      return;
    }
    const job = data.id === undefined ? undefined : pending.get(data.id);
    if (data.type === 'error') {
      for (const [id, waiting] of pending)
        if (data.id === undefined || id === data.id) {
          pending.delete(id);
          waiting.reject(new LocalError(data.code));
        }
      return;
    }
    if (!job) return;
    if (data.type === 'progress') return job.hooks.onProgress?.(data.fraction);
    pending.delete(data.id);
    job.resolve(data);
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(new LocalError('BG_SETUP_FAILED'));
    pending.clear();
    worker = undefined;
  };
  return worker;
}

function ask(message: Omit<ToBackground, 'id'>, hooks: Hooks): Promise<FromBackground> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, hooks });
    connect().postMessage({ ...message, id, fast: hooks.fast }, [message.image]);
  });
}

/** The picture with its background made transparent, at the picture's full size. */
export async function removeBackground(image: ImageBitmap, hooks: Hooks = {}): Promise<{ cutout: ImageData; model: BackgroundModel }> {
  const answer = await ask({ type: 'run', image }, hooks);
  if (answer.type !== 'done') throw new LocalError('BACKGROUND_FAILED');
  return { cutout: new ImageData(new Uint8ClampedArray(answer.rgba), answer.width, answer.height), model: answer.model };
}

/** Just the model's square mask (0–1), for video and GIF frames. */
export async function maskOf(image: ImageBitmap, hooks: Hooks = {}): Promise<{ mask: Float32Array; size: number; model: BackgroundModel }> {
  const answer = await ask({ type: 'mask', image }, hooks);
  if (answer.type !== 'mask') throw new LocalError('BACKGROUND_FAILED');
  return answer;
}

export type Backdrop =
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  | { kind: 'image'; image: ImageBitmap }
  /** The original photo, blurred behind the subject; `amount` is a share of the picture's long side. */
  | { kind: 'blur'; amount: number };

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Finishing touches. `frame` is the part of the photo shown, in photo pixels (it may reach past the edges). */
export interface Look {
  frame?: [x: number, y: number, w: number, h: number];
  shadow?: boolean;
  outline?: string;
}

/** Draws `source` to fill w×h without stretching, cropping what sticks out (CSS "cover"). */
function cover(context: Context, source: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const scale = Math.max(w / source.width, h / source.height);
  const sw = w / scale;
  const sh = h / scale;
  context.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, w, h);
}

/** The cut-out's shape in one flat colour, at w×h. */
function silhouette(cutout: Canvas | ImageBitmap, w: number, h: number, color: string) {
  const shape = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const context = shape.getContext('2d')!;
  context.drawImage(cutout, 0, 0, shape.width, shape.height);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, shape.width, shape.height);
  return shape;
}

/** Paints the backdrop and the cut-out onto `canvas`, scaled to the canvas's size. */
export function compose(canvas: Canvas, cutout: Canvas | ImageBitmap, photo: ImageBitmap, backdrop: Backdrop, look: Look = {}) {
  const { width: w, height: h } = canvas;
  const [fx, fy, fw] = look.frame ?? [0, 0, cutout.width, cutout.height];
  // Where the whole photo (and its cut-out) lands on the canvas.
  const scale = w / fw;
  const dx = -fx * scale;
  const dy = -fy * scale;
  const dw = cutout.width * scale;
  const dh = cutout.height * scale;
  const context = canvas.getContext('2d') as Context;
  context.clearRect(0, 0, w, h);
  context.imageSmoothingQuality = 'high';
  if (backdrop.kind === 'color') {
    context.fillStyle = backdrop.color;
    context.fillRect(0, 0, w, h);
  } else if (backdrop.kind === 'image') {
    cover(context, backdrop.image, w, h);
  } else if (backdrop.kind === 'blur') {
    // Drawn a little larger than needed so the blur doesn't fade to transparent at the edges;
    // a cropped frame that reaches past the photo is filled with the blurred photo too.
    const radius = Math.max(2, Math.round(Math.max(w, h) * backdrop.amount));
    context.filter = `blur(${radius}px)`;
    if (look.frame) cover(context, photo, w, h);
    context.drawImage(photo, dx - radius * 2, dy - radius * 2, dw + radius * 4, dh + radius * 4);
    context.filter = 'none';
  }
  const size = Math.max(w, h);
  if (look.shadow) {
    // A soft shadow just under and behind the subject, like a studio light from above.
    const blur = Math.max(2, Math.round(size * 0.018));
    context.save();
    context.globalAlpha = 0.45;
    context.filter = `blur(${blur}px)`;
    context.drawImage(silhouette(cutout, dw, dh, '#000'), dx, dy + Math.round(size * 0.012), dw, dh);
    context.restore();
  }
  if (look.outline) {
    // A sticker-style border: the shape in the outline colour, drawn in a ring around the subject.
    const width = Math.max(2, Math.round(size * 0.012));
    const shape = silhouette(cutout, dw, dh, look.outline);
    for (const r of [width, width / 2])
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        context.drawImage(shape, dx + Math.cos(a) * r, dy + Math.sin(a) * r, dw, dh);
      }
  }
  context.drawImage(cutout, dx, dy, dw, dh);
}

/** The smallest box around everything that isn't (nearly) see-through, or undefined if nothing is left. */
export function subjectBox(rgba: Uint8ClampedArray, w: number, h: number, threshold = 24): [x: number, y: number, w: number, h: number] | undefined {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++)
      if (rgba[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  return x1 < 0 ? undefined : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export type Layout = 'photo' | 'subject' | 'square';

/** The part of the photo to show: all of it, the subject with a margin, or a square around the subject. */
export function frameFor(layout: Layout, box: [number, number, number, number] | undefined, w: number, h: number, margin = 0.08): [number, number, number, number] {
  if (layout === 'photo' || !box) return [0, 0, w, h];
  const [bx, by, bw, bh] = box;
  const pad = Math.round(Math.max(bw, bh) * margin);
  if (layout === 'subject') return [bx - pad, by - pad, bw + pad * 2, bh + pad * 2];
  const side = Math.max(bw, bh) + pad * 2;
  return [Math.round(bx + bw / 2 - side / 2), Math.round(by + bh / 2 - side / 2), side, side];
}

export type SaveFormat = 'png' | 'jpg' | 'webp';
const TYPES: Record<SaveFormat, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** The finished picture at w×h. JPG has no transparency, so a transparent backdrop becomes white. */
export async function render(cutout: Canvas | ImageBitmap, photo: ImageBitmap, backdrop: Backdrop, w: number, h: number, format: SaveFormat, look: Look = {}) {
  let canvas: OffscreenCanvas;
  try {
    canvas = new OffscreenCanvas(w, h);
    if (!canvas.getContext('2d')) throw new Error('no context');
  } catch {
    throw new LocalError('IMAGE_TOO_LARGE');
  }
  compose(canvas, cutout, photo, format === 'jpg' && backdrop.kind === 'none' ? { kind: 'color', color: '#ffffff' } : backdrop, look);
  return canvas.convertToBlob({ type: TYPES[format], quality: format === 'png' ? undefined : 0.92 });
}
