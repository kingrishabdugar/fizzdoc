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
  // Leaving the page normally is not a crash.
  addEventListener('pagehide', () => {
    if (pending.size) remember(false);
  });
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

// Set while the big model runs and cleared when it answers. If it is still set on the next visit, the
// tab was killed mid-run (out of memory), so this device gets the small model from then on.
const CRASHED = 'fizzdoc-bg-crashed';
const MONTH = 30 * 24 * 3600 * 1000;
const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(CRASHED, String(Date.now()));
    else localStorage.removeItem(CRASHED);
  } catch {
    // storage blocked: nothing to remember
  }
};

/** Phones, and any device where the big model crashed the tab before, use the small model. */
export function liteDevice(): boolean {
  try {
    const at = Number(localStorage.getItem(CRASHED));
    if (at && Date.now() - at < MONTH) return true;
  } catch {
    // storage blocked: decide from the device alone
  }
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return (
    nav.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820) // iPads that say "Mac"
  );
}

function ask(message: Omit<ToBackground, 'id'>, hooks: Hooks): Promise<FromBackground> {
  const id = nextId++;
  const lite = liteDevice();
  if (!lite) remember(true);
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (answer) => {
        if (!lite) remember(false);
        resolve(answer);
      },
      reject: (error) => {
        if (!lite) remember(false);
        reject(error);
      },
      hooks,
    });
    connect().postMessage({ ...message, id, fast: hooks.fast, lite }, [message.image]);
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

/** Draws `source` to fill w×h without stretching, cropping what sticks out (CSS "cover"). */
function cover(context: Context, source: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const scale = Math.max(w / source.width, h / source.height);
  const sw = w / scale;
  const sh = h / scale;
  context.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, w, h);
}

/** Paints the backdrop and the cut-out onto `canvas`, scaled to the canvas's size. */
export function compose(canvas: Canvas, cutout: Canvas | ImageBitmap, photo: ImageBitmap, backdrop: Backdrop) {
  const { width: w, height: h } = canvas;
  const context = canvas.getContext('2d') as Context;
  context.clearRect(0, 0, w, h);
  context.imageSmoothingQuality = 'high';
  if (backdrop.kind === 'color') {
    context.fillStyle = backdrop.color;
    context.fillRect(0, 0, w, h);
  } else if (backdrop.kind === 'image') {
    cover(context, backdrop.image, w, h);
  } else if (backdrop.kind === 'blur') {
    // Drawn a little larger than the canvas so the blur doesn't fade to transparent at the edges.
    const radius = Math.max(2, Math.round(Math.max(w, h) * backdrop.amount));
    context.filter = `blur(${radius}px)`;
    context.drawImage(photo, -radius * 2, -radius * 2, w + radius * 4, h + radius * 4);
    context.filter = 'none';
  }
  context.drawImage(cutout, 0, 0, w, h);
}

export type SaveFormat = 'png' | 'jpg' | 'webp';
const TYPES: Record<SaveFormat, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** The finished picture at w×h. JPG has no transparency, so a transparent backdrop becomes white. */
export async function render(cutout: Canvas | ImageBitmap, photo: ImageBitmap, backdrop: Backdrop, w: number, h: number, format: SaveFormat) {
  let canvas: OffscreenCanvas;
  try {
    canvas = new OffscreenCanvas(w, h);
    if (!canvas.getContext('2d')) throw new Error('no context');
  } catch {
    throw new LocalError('IMAGE_TOO_LARGE');
  }
  compose(canvas, cutout, photo, format === 'jpg' && backdrop.kind === 'none' ? { kind: 'color', color: '#ffffff' } : backdrop);
  return canvas.convertToBlob({ type: TYPES[format], quality: format === 'png' ? undefined : 0.92 });
}
