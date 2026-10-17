// English text recognition via tesseract.js, entirely self-hosted: the worker, wasm core and
// language data are fetched from our own origin (see vite-plugins/ocr-assets.ts) so nothing leaves
// the visitor's browser and the page's CSP (script-src 'self', connect-src 'self') is satisfied.
// Everything here is loaded with a dynamic import so the ~6 MB of OCR assets are only fetched the
// first time an OCR tool actually runs.
import type { PDFFont } from 'pdf-lib';
import { LocalError, openPdf, type Output } from './local';

export interface Word {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OcrResult {
  text: string;
  words: Word[];
  width: number;
  height: number;
}

// One fixed core build (LSTM-only, SIMD) instead of feature-detecting at runtime — every
// browser this site otherwise supports (the build targets es2022) already has wasm SIMD.
const ocrAsset = (name: string) => `${import.meta.env.BASE_URL}ocr/${name}`;
const MAX_SIDE = 3000; // downscaling past this saves time on phone photos without hurting accuracy
const RENDER_DPI = 260; // sharp enough for OCR, small enough to stay fast at a few hundred pages

async function withWorker<T>(
  onProgress: ((fraction: number) => void) | undefined,
  run: (worker: Tesseract.Worker) => Promise<T>,
): Promise<T> {
  // Offline, tesseract.js waits forever for files it can't load, so stop at once when they aren't on this device.
  if (navigator.onLine === false) {
    for (const name of ['worker.min.js', 'tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm', 'eng.traineddata.gz'])
      if (!(await caches.match(ocrAsset(name), { ignoreVary: true }))) throw new Error(`${name} is not on this device`);
  }
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1 /* OEM.LSTM_ONLY */, {
    workerPath: ocrAsset('worker.min.js'),
    corePath: ocrAsset('tesseract-core-simd-lstm.js'),
    langPath: ocrAsset(''), // trimmed of its trailing slash by tesseract.js; matches ocrAsset('eng.traineddata.gz')
    workerBlobURL: false,
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  try {
    return await run(worker);
  } finally {
    await worker.terminate();
  }
}

/** tesseract.js only nests words under blocks → paragraphs → lines unless asked for flat text. */
function flattenWords(page: Tesseract.Page): Tesseract.Word[] {
  return (page.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((p) => p.lines.flatMap((line) => line.words)));
}

/** Scales a bbox by `factor` (used to undo the downscale applied before OCR). */
function scaleWord(word: Word, factor: number): Word {
  return {
    text: word.text,
    confidence: word.confidence,
    bbox: {
      x0: word.bbox.x0 * factor,
      y0: word.bbox.y0 * factor,
      x1: word.bbox.x1 * factor,
      y1: word.bbox.y1 * factor,
    },
  };
}

/** How much to shrink an image's long side so it doesn't exceed `maxSide`; 1 if it already fits. */
export function downscaleFactor(width: number, height: number, maxSide = MAX_SIDE): number {
  const longSide = Math.max(width, height);
  return longSide > maxSide ? maxSide / longSide : 1;
}

async function decodeImage(file: File): Promise<ImageBitmap> {
  try {
    // 'from-image' bakes in the EXIF orientation so bboxes come out already right-side up.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new LocalError('BAD_IMAGE');
  }
}

/** Recognizes the English text in a photo or scan. Bboxes are in the original image's pixels. */
/**
 * True when recognition looks unreliable: little or no text found, or low average confidence
 * (typical of sideways photos and scripts other than English).
 */
export function unsure(words: { text: string; confidence: number }[]): boolean {
  const chars = words.reduce((sum, w) => sum + w.text.length, 0);
  if (chars < 3) return true;
  return words.reduce((sum, w) => sum + w.confidence * w.text.length, 0) / chars < 60;
}

export async function ocrImage(file: File, onProgress?: (fraction: number) => void): Promise<OcrResult> {
  const original = await decodeImage(file);
  // Read the size before close(): a closed ImageBitmap reports 0 × 0.
  const size = { width: original.width, height: original.height };
  const factor = downscaleFactor(size.width, size.height);
  const width = Math.round(size.width * factor);
  const height = Math.round(size.height * factor);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(original, 0, 0, width, height);
  original.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });

  const data = await withWorker(onProgress, (worker) => worker.recognize(blob, {}, { blocks: true }).then((r) => r.data));
  const unscale = 1 / factor;
  return {
    text: data.text,
    width: size.width,
    height: size.height,
    words: flattenWords(data)
      .filter((w) => w.text.trim())
      .map((w) => scaleWord({ text: w.text, confidence: w.confidence, bbox: w.bbox }, unscale)),
  };
}

// ---------- Searchable PDF ----------

export interface PageBox {
  /** Unrotated page box size, in PDF points (its CropBox, or MediaBox if there is none). */
  width: number;
  height: number;
  /** The page's /Rotate value, degrees clockwise. */
  rotation: number;
}

/**
 * Maps a pixel in a raster rendered at `scale` px/pt (top-left origin, y-down, in the page's
 * visually-rotated orientation — i.e. what pdf.js's default viewport produces) back to PDF
 * content-stream space (bottom-left origin, y-up), so text drawn there lines up once a viewer
 * applies the page's own /Rotate on top.
 */
export function imageToPdfPoint(px: number, py: number, scale: number, box: PageBox): { x: number; y: number } {
  const { width: w, height: h } = box;
  const rotation = (((Math.round(box.rotation / 90) * 90) % 360) + 360) % 360;
  const visualHeight = rotation === 90 || rotation === 270 ? w : h;
  const vx = px / scale;
  const vy = visualHeight - py / scale;
  switch (rotation) {
    case 90:
      return { x: w - vy, y: vx };
    case 180:
      return { x: w - vx, y: h - vy };
    case 270:
      return { x: vy, y: h - vx };
    default:
      return { x: vx, y: vy };
  }
}

/** Replaces characters the standard WinAnsi encoding can't represent, so embedding never throws. */
export function sanitizeForFont(font: PDFFont, text: string): string {
  let out = '';
  for (const char of text) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += '?';
    }
  }
  return out;
}

/** A recognized word's baseline, already in PDF content-stream space, ready to draw. */
interface PlacedWord {
  text: string;
  /** Baseline start. */
  x: number;
  y: number;
  /** Baseline direction, radians. */
  angle: number;
  /** Font size that matches the word's height. */
  size: number;
  /** Extra horizontal stretch (folded into the text matrix) so the word's width matches its bbox. */
  hScale: number;
}

/** Turns one recognized word into placement data for an invisible text-layer draw. */
export function placeWord(word: Word, font: PDFFont, scale: number, box: PageBox): PlacedWord | null {
  const text = sanitizeForFont(font, word.text.trim());
  if (!text) return null;
  const left = imageToPdfPoint(word.bbox.x0, word.bbox.y1, scale, box);
  const right = imageToPdfPoint(word.bbox.x1, word.bbox.y1, scale, box);
  const top = imageToPdfPoint(word.bbox.x0, word.bbox.y0, scale, box);
  const width = Math.hypot(right.x - left.x, right.y - left.y);
  const size = Math.hypot(top.x - left.x, top.y - left.y);
  if (width < 0.5 || size < 0.5) return null;
  const natural = font.widthOfTextAtSize(text, size) || width;
  return {
    text,
    x: left.x,
    y: left.y,
    angle: Math.atan2(right.y - left.y, right.x - left.x),
    size,
    hScale: Math.min(20, Math.max(0.02, width / natural)),
  };
}

async function hasRealText(page: { getTextContent(): Promise<{ items: unknown[] }> }): Promise<boolean> {
  const content = await page.getTextContent();
  const text = content.items.map((item) => (item as { str?: string }).str ?? '').join('').trim();
  // A handful of stray glyphs (e.g. a page number pdf.js can already read) shouldn't
  // count as "has a text layer" and block OCR of an otherwise-scanned page.
  return text.length > 3;
}

/** Adds an invisible, searchable text layer to a scanned PDF; pages that already have real text
 * are left untouched. The visible content of every page is never modified. */
export async function ocrPdf(file: File, onProgress?: (fraction: number) => void): Promise<Output> {
  const allWords: { text: string; confidence: number }[] = [];
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const {
    beginText,
    endText,
    popGraphicsState,
    pushGraphicsState,
    setFontAndSize,
    setTextMatrix,
    setTextRenderingMode,
    showText,
    TextRenderingMode,
  } = await import('pdf-lib');
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch (error) {
    // pdf-lib can't decrypt any protected PDF (even an owner-only one), so treat it like a
    // password prompt rather than pretending to OCR a file we can't safely re-save. Matched by
    // message, not `instanceof EncryptedPDFError`: pdf-lib's compiled error classes lose their
    // prototype chain when they extend the native Error (a known quirk of its ES5 output).
    const encrypted = error instanceof Error && /is encrypted/.test(error.message);
    throw new LocalError(encrypted ? 'PDF_PASSWORD' : 'INVALID_PDF');
  }

  const doc = await openPdf(bytes);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const scale = RENDER_DPI / 72;
  let recognized = 0;

  try {
    await withWorker(undefined, async (worker) => {
      for (let number = 1; number <= doc.numPages; number++) {
        const srcPage = await doc.getPage(number);
        if (await hasRealText(srcPage)) {
          srcPage.cleanup();
          onProgress?.(number / doc.numPages);
          continue;
        }

        const viewport = srcPage.getViewport({ scale });
        const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await srcPage
          .render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport })
          .promise;
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const box: PageBox = { width: srcPage.view[2] - srcPage.view[0], height: srcPage.view[3] - srcPage.view[1], rotation: srcPage.rotate };
        const originX = srcPage.view[0];
        const originY = srcPage.view[1];
        srcPage.cleanup();

        const { data } = await worker.recognize(blob, {}, { blocks: true });
        allWords.push(...flattenWords(data).map((w) => ({ text: w.text, confidence: w.confidence })));
        const target = pages[number - 1];
        const fontKey = target.node.newFontDictionary(font.name, font.ref);
        const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
        for (const word of flattenWords(data)) {
          const placed = placeWord({ text: word.text, confidence: word.confidence, bbox: word.bbox }, font, scale, box);
          if (!placed) continue;
          const cos = Math.cos(placed.angle);
          const sin = Math.sin(placed.angle);
          ops.push(
            setFontAndSize(fontKey, placed.size),
            setTextMatrix(cos * placed.hScale, sin * placed.hScale, -sin, cos, placed.x + originX, placed.y + originY),
            showText(font.encodeText(placed.text)),
          );
        }
        ops.push(endText(), popGraphicsState());
        target.pushOperators(...ops);
        recognized++;
        onProgress?.(number / doc.numPages);
      }
    });
  } finally {
    await doc.loadingTask.destroy();
  }
  const saved = await pdf.save();
  const name = `${file.name.replace(/\.[^.]+$/, '')}-ocr.pdf`;
  return {
    blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    name,
    summary: `${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'} · ${recognized} recognized`,
    notes: unsure(allWords) ? ['ocr.unsure'] : [],
  };
}
