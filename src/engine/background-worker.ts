// Background removal, in a worker so the page stays responsive. Everything comes from our own
// origin: the models from /bg/<model>/ and ONNX Runtime from /bg/ort/ (WebGPU build) or
// /whisper/ort/ (CPU build), all stored in parts and joined here. The first run downloads them
// into the browser's Cache Storage; later runs, even offline, load from there.
//
// The model sees the photo at 512x512 and returns a soft mask; matte.ts then fits it to the
// full-size photo, so the cut-out keeps the photo's own resolution.
import type * as Ort from 'onnxruntime-web';
import { planesFromRGBA, refine } from './matte';

export type BackgroundModel = 'birefnet-lite' | 'u2netp';
/** `fast` asks for speed over the finest edges: animations use it, with many frames to do. */
/** `lite` (phones, or a device where the big model once crashed the tab) always uses the small model. */
export type ToBackground = { type: 'run'; id: number; image: ImageBitmap; fast?: boolean; lite?: boolean } | { type: 'mask'; id: number; image: ImageBitmap; fast?: boolean; lite?: boolean };
export type FromBackground =
  | { type: 'setup'; loaded: number; total: number }
  | { type: 'progress'; id: number; fraction: number }
  /** The cut-out: the photo's pixels with the background made transparent, at full size. */
  | { type: 'done'; id: number; width: number; height: number; rgba: ArrayBuffer; model: BackgroundModel }
  /** Just the model's mask, for video and GIF frames that are refined by the caller. */
  | { type: 'mask'; id: number; size: number; mask: Float32Array; model: BackgroundModel }
  | { type: 'error'; id?: number; code: 'BG_SETUP_FAILED' | 'BACKGROUND_FAILED' };

const post = (message: FromBackground, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

// Bump when a model or the runtime changes, so old copies are dropped instead of mixed in.
const CACHE = 'fizzdoc-bg-1';
const ORIGIN = self.location.origin;
const MODELS: Record<BackgroundModel, { size: number; mean: number[]; std: number[]; logits: boolean }> = {
  // BiRefNet-lite returns logits; U²-Net small returns 0–1 values that rembg stretches to the full range.
  'birefnet-lite': { size: 512, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], logits: true },
  u2netp: { size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], logits: false },
};
/** Long side of the reduced copy the refinement works on; the result is applied at full size. */
const REFINE_SIZE = 1280;
/** Smaller for video and GIF frames: many of them, each shown only briefly. */
const REFINE_SIZE_FAST = 640;

interface Manifest {
  files: { path: string; size: number; parts: string[] }[];
}
type Wanted = { url: string; size: number; parts: string[] };

async function listing(base: string): Promise<Wanted[]> {
  const manifest: Manifest = await (await fetch(`${base}manifest.json`)).json();
  return manifest.files.map((file) => ({ url: `${base}${file.path}`, size: file.size, parts: file.parts.map((part) => `${base}${part}`) }));
}

/** Downloads whatever isn't cached yet, joining parts and reporting bytes as they arrive. */
async function fetchAll(cache: Cache, wanted: Wanted[]) {
  const missing = [];
  for (const file of wanted) if (!(await cache.match(file.url))) missing.push(file);
  if (!missing.length) return;
  const total = wanted.reduce((sum, file) => sum + file.size, 0);
  let loaded = total - missing.reduce((sum, file) => sum + file.size, 0);
  post({ type: 'setup', loaded, total });
  for (const file of missing) {
    const chunks: Uint8Array[] = [];
    for (const part of file.parts) {
      const response = await fetch(part);
      if (!response.ok || !response.body) throw new Error(`${part}: ${response.status}`);
      const reader = response.body.getReader();
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        chunks.push(read.value);
        loaded += read.value.length;
        post({ type: 'setup', loaded: Math.min(loaded, total), total });
      }
    }
    await cache.put(file.url, new Response(new Blob(chunks as BlobPart[]), { headers: { 'content-type': 'application/octet-stream' } }));
  }
  post({ type: 'setup', loaded: total, total });
}

const bytes = async (cache: Cache, url: string) => new Uint8Array(await (await cache.match(url))!.arrayBuffer());

/** WebGPU when the device has a usable GPU; the CPU otherwise. */
async function hasGpu() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/** Phones with little memory get the small model straight away: the big one needs about 1.5 GB. */
function pickModel(gpu: boolean): BackgroundModel {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return gpu || memory === undefined || memory >= 4 ? 'birefnet-lite' : 'u2netp';
}

interface Engine {
  model: BackgroundModel;
  gpu: boolean;
  session: Ort.InferenceSession;
  ort: typeof Ort;
}
let engine: Promise<Engine> | undefined;
const gpuReady = hasGpu();
/** Whether the loaded small model was picked for speed (rather than for lack of memory). */
let speedPick = false;

async function start(model?: BackgroundModel, allowGpu = true): Promise<Engine> {
  const cache = await caches.open(CACHE);
  const gpu = allowGpu && (await gpuReady);
  const chosen = model ?? pickModel(gpu);
  const runtime = gpu ? `${ORIGIN}/bg/ort/` : `${ORIGIN}/whisper/ort/`;
  const runtimeFiles: Wanted[] = gpu
    ? await listing(runtime)
    : [{ url: `${runtime}ort-wasm-simd-threaded.wasm`, size: 14_300_000, parts: [`${runtime}ort-wasm-simd-threaded.wasm`] }];
  const modelFiles = await listing(`${ORIGIN}/bg/${chosen}/`);
  await fetchAll(cache, [...modelFiles, ...runtimeFiles]);

  const ort: typeof Ort = gpu ? await import('ort-webgpu') : await import('onnxruntime-web/wasm');
  // The runtime is handed its binary directly: its own loader would import it from a blob: URL,
  // which the page's CSP rightly refuses.
  ort.env.wasm.wasmBinary = await bytes(cache, runtimeFiles[0].url);
  ort.env.wasm.wasmPaths = runtime;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  const modelBytes = await bytes(cache, modelFiles[0].url);
  const create = (providers: string[]) => ort.InferenceSession.create(modelBytes, { executionProviders: providers, graphOptimizationLevel: 'all' });
  return { model: chosen, gpu, session: await create(gpu ? ['webgpu', 'wasm'] : ['wasm']), ort };
}

/** The model's 0–1 mask for the picture, at the model's own square size. */
async function predict(engine: Engine, image: ImageBitmap): Promise<Float32Array> {
  const { size, mean, std, logits } = MODELS[engine.model];
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const n = size * size;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) input[c * n + i] = (pixels[i * 4 + c] / 255 - mean[c]) / std[c];
  }
  const session = engine.session;
  const outputs = await session.run({ [session.inputNames[0]]: new engine.ort.Tensor('float32', input, [1, 3, size, size]) });
  const raw = (await outputs[session.outputNames[0]].getData()) as Float32Array;
  const mask = new Float32Array(n);
  if (logits) {
    for (let i = 0; i < n; i++) mask[i] = 1 / (1 + Math.exp(-raw[i]));
  } else {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, raw[i]);
      hi = Math.max(hi, raw[i]);
    }
    for (let i = 0; i < n; i++) mask[i] = (raw[i] - lo) / (hi - lo || 1);
  }
  for (const tensor of Object.values(outputs)) tensor.dispose();
  return mask;
}

/**
 * Runs the model. If the graphics chip can't (an unusual GPU or driver), the same model runs on the
 * CPU; if that can't either (usually: not enough memory), the small model takes over.
 */
async function maskOf(image: ImageBitmap, fast = false, lite = false): Promise<{ mask: Float32Array; model: BackgroundModel }> {
  if (lite) {
    // Phones: the big model can use more memory than the browser allows a tab, and a tab that runs
    // out is killed outright (no error to catch), so phones go straight to the small one, on the CPU.
    const loaded = await engine?.catch(() => undefined);
    if (loaded?.model !== 'u2netp') {
      await loaded?.session.release().catch(() => {});
      engine = start('u2netp', false);
    }
    const current = await engine!;
    return { mask: await predict(current, image), model: current.model };
  }
  const fallbacks: [BackgroundModel, boolean][] = [];
  // Without a GPU the big model takes seconds per picture: fine for a photo, too slow for 40 frames.
  if (fast !== speedPick && !(await gpuReady)) {
    // Switch to the small model for animations, and back to the default for the next photo.
    const loaded = await engine?.catch(() => undefined);
    await loaded?.session.release().catch(() => {});
    engine = fast ? start('u2netp', false) : undefined;
    speedPick = fast;
  }
  engine ??= start().catch((error) => {
    // A GPU that can't even load the model: try the CPU before giving up.
    engine = undefined;
    throw error;
  });
  let current: Engine;
  try {
    current = await engine;
  } catch {
    engine = start('birefnet-lite', false).catch(() => start('u2netp', false));
    current = await engine;
  }
  if (current.gpu && current.model === 'birefnet-lite') fallbacks.push(['birefnet-lite', false]);
  if (current.model !== 'u2netp') fallbacks.push(['u2netp', false]);
  for (;;) {
    try {
      return { mask: await predict(current, image), model: current.model };
    } catch (error) {
      const next = fallbacks.shift();
      if (!next) throw error;
      console.warn(`Background removal: ${current.model} on ${current.gpu ? 'GPU' : 'CPU'} failed, trying ${next[0]} on CPU`, error);
      await current.session.release().catch(() => {});
      engine = start(...next);
      current = await engine;
    }
  }
}

/** Resizes a square mask to w×h, bilinearly, with pixel centres aligned as canvas scaling does. */
function resizeMask(mask: Float32Array, size: number, w: number, h: number) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max(((y + 0.5) * size) / h - 0.5, 0), size - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, size - 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max(((x + 0.5) * size) / w - 0.5, 0), size - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, size - 1);
      const tx = fx - x0;
      out[y * w + x] =
        mask[y0 * size + x0] * (1 - tx) * (1 - ty) + mask[y0 * size + x1] * tx * (1 - ty) + mask[y1 * size + x0] * (1 - tx) * ty + mask[y1 * size + x1] * tx * ty;
    }
  }
  return out;
}

async function cutOut(id: number, image: ImageBitmap, fast?: boolean, lite?: boolean) {
  const W = image.width;
  const H = image.height;
  post({ type: 'progress', id, fraction: 0.05 });
  const { mask, model } = await maskOf(image, fast, lite);
  post({ type: 'progress', id, fraction: 0.7 });
  // A reduced copy for the refinement, and the full-size pixels it is applied to.
  const scale = Math.min(1, (fast ? REFINE_SIZE_FAST : REFINE_SIZE) / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const smallCanvas = new OffscreenCanvas(w, h);
  const smallContext = smallCanvas.getContext('2d', { willReadFrequently: true })!;
  smallContext.imageSmoothingQuality = 'high';
  smallContext.drawImage(image, 0, 0, w, h);
  const small = planesFromRGBA(smallContext.getImageData(0, 0, w, h).data, w, h);
  const full = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  full.drawImage(image, 0, 0);
  image.close();
  const rgba = full.getImageData(0, 0, W, H).data;
  refine(rgba, W, H, small, resizeMask(mask, MODELS[model].size, w, h), MODELS[model].size);
  post({ type: 'done', id, width: W, height: H, rgba: rgba.buffer as ArrayBuffer, model }, [rgba.buffer as ArrayBuffer]);
}

self.onmessage = async ({ data }: MessageEvent<ToBackground>) => {
  try {
    if (data.type === 'run') await cutOut(data.id, data.image, data.fast, data.lite);
    else {
      const { mask, model } = await maskOf(data.image, data.fast, data.lite);
      data.image.close();
      post({ type: 'mask', id: data.id, size: MODELS[model].size, mask, model }, [mask.buffer]);
    }
  } catch (error) {
    console.error(error);
    const setup = !(await engine?.then(() => true, () => false));
    if (setup) engine = undefined; // let the next try download again
    post({ type: 'error', id: data.id, code: setup ? 'BG_SETUP_FAILED' : 'BACKGROUND_FAILED' });
  }
};
