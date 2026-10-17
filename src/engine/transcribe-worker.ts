// Speech to text with Whisper, in a worker so the page stays responsive. Everything comes from our
// own origin: the model from /whisper/whisper-tiny/ (stored in parts, joined here) and ONNX Runtime
// from /whisper/ort/. The first run downloads them into the browser's Cache Storage; later runs,
// even offline, load from there.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export type ToTranscriber = { type: 'run'; audio: Float32Array; language: string | null };
export type FromTranscriber =
  | { type: 'setup'; loaded: number; total: number }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; text: string; chunks: { timestamp: [number, number | null]; text: string }[] }
  | { type: 'error'; code: 'SETUP_FAILED' | 'TRANSCRIBE_FAILED' };

const post = (message: FromTranscriber) => (self as unknown as Worker).postMessage(message);

const BASE = new URL('/whisper/', self.location.origin).href;
const MODEL = 'whisper-tiny';
const WASM = `${BASE}ort/ort-wasm-simd-threaded.wasm`;
// Bump when the model or runtime changes, so old copies are dropped instead of mixed in.
const CACHE = 'fizzdoc-whisper-1';
// Whisper hears 30-second windows; 5 seconds of overlap on each side keeps words at the edges.
const WINDOW = 30;
const STRIDE = 5;

interface Manifest {
  files: { path: string; size: number; parts: string[] }[];
}

/** Downloads whatever isn't cached yet, reporting bytes as they arrive. */
async function setUp(cache: Cache) {
  const manifest: Manifest = await (await fetch(`${BASE}${MODEL}/manifest.json`)).json();
  const wasmSize = 14_300_000; // for the progress bar only; the host sends no Content-Length to read it from
  const wanted = [
    ...manifest.files.map((file) => ({ url: `${BASE}${MODEL}/${file.path}`, size: file.size, parts: file.parts.map((p) => `${BASE}${MODEL}/${p}`) })),
    { url: WASM, size: wasmSize, parts: [WASM] },
  ];
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

let ready: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

async function load() {
  const cache = await caches.open(CACHE);
  await setUp(cache);
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = BASE;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = cache;
  // The runtime is handed its binary directly: the library's own loader would import it from a
  // blob: URL, which the page's CSP rightly refuses.
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = `${BASE}ort/`;
  wasm.wasmBinary = await (await cache.match(WASM))!.arrayBuffer();
  wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  return pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
}

/** How many windows the pipeline will run, the same way it cuts them. */
function windows(samples: number, rate = 16000) {
  const size = WINDOW * rate;
  const step = size - 2 * STRIDE * rate;
  let count = 0;
  for (let offset = 0; ; offset += step) {
    count++;
    if (offset + size >= samples) return count;
  }
}

self.onmessage = async ({ data }: MessageEvent<ToTranscriber>) => {
  let asr: AutomaticSpeechRecognitionPipeline;
  try {
    ready ??= load();
    asr = await ready;
  } catch (error) {
    console.error(error);
    ready = undefined;
    return post({ type: 'error', code: 'SETUP_FAILED' });
  }
  try {
    // Real progress: count each window as the model finishes it.
    const total = windows(data.audio.length);
    let done = 0;
    post({ type: 'progress', fraction: 0 });
    const model = asr.model as unknown as { generate: (...args: unknown[]) => Promise<unknown> };
    const generate = model.generate.bind(model);
    model.generate = async (...args) => {
      const output = await generate(...args);
      post({ type: 'progress', fraction: Math.min(1, ++done / total) });
      return output;
    };
    const result = (await asr(data.audio, {
      chunk_length_s: WINDOW,
      stride_length_s: STRIDE,
      return_timestamps: true,
      task: 'transcribe',
      ...(data.language ? { language: data.language } : {}),
    })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
    model.generate = generate;
    post({ type: 'done', text: result.text.trim(), chunks: result.chunks ?? [] });
  } catch (error) {
    console.error(error);
    post({ type: 'error', code: 'TRANSCRIBE_FAILED' });
  }
};
