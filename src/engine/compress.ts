// Shrinks PDFs, Office packages and images by recompressing their embedded raster pictures.
// Text, fonts and vector drawing are never touched, so PDF text stays selectable.
import { unzlibSync, zipSync, type Zippable } from 'fflate';
import { LocalError, baseName, bytes, type Output } from './local';


export interface Level {
  level: 'light' | 'strong';
}

const LONG_SIDE = { light: 2000, strong: 1400 } as const;
const QUALITY = { light: 0.8, strong: 0.6 } as const;

export type PdfLevel = 'low' | 'medium' | 'high' | 'extreme';

/** Per level: the most pixels per inch of page an image keeps, and the JPEG quality it is saved at. */
export const PDF_LEVELS: Record<PdfLevel, { dpi: number; quality: number }> = {
  low: { dpi: 200, quality: 0.85 },
  medium: { dpi: 150, quality: 0.75 },
  high: { dpi: 110, quality: 0.6 },
  extreme: { dpi: 72, quality: 0.45 },
};

function formatSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** "42% smaller (1.2 MB → 700 KB)", or "Already optimized" when nothing shrank. */
function shrinkSummary(before: number, after: number) {
  if (after >= before) return 'Already optimized';
  return `${Math.round((1 - after / before) * 100)}% smaller (${formatSize(before)} → ${formatSize(after)})`;
}

function scaleFor(width: number, height: number, maxSide: number) {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height };
  const factor = maxSide / long;
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

/**
 * The only bit of image processing that needs a real browser (canvas + image decoders). Kept
 * behind this small interface so the object-walking logic below can be unit-tested in Node with
 * a fake implementation.
 */
export interface ImageCodec {
  /** Downscales (only if bigger than `maxSide` on the long edge) and re-encodes JPEG bytes as JPEG. */
  recompressJpeg(source: Uint8Array, maxSide: number, quality: number): Promise<{ data: Uint8Array; width: number; height: number }>;
  /** Same, starting from raw RGBA pixels instead of already-encoded JPEG bytes. */
  recompressRaw(rgba: Uint8Array, width: number, height: number, maxSide: number, quality: number): Promise<{ data: Uint8Array; width: number; height: number }>;
}

async function viaCanvas(source: ImageBitmapSource, maxSide: number, quality: number) {
  const probe = await createImageBitmap(source);
  const { width, height } = scaleFor(probe.width, probe.height, maxSide);
  const bitmap = width === probe.width && height === probe.height ? probe : await createImageBitmap(probe, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { data: await bytes(blob), width, height };
}

export const browserCodec: ImageCodec = {
  recompressJpeg: (source, maxSide, quality) => viaCanvas(new Blob([source as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), maxSide, quality),
  async recompressRaw(rgba, width, height, maxSide, quality) {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.length), width, height), 0, 0);
    return viaCanvas(canvas, maxSide, quality);
  },
};

/**
 * Walks every indirect object, recompresses the image XObjects it can safely handle and saves the
 * result. Exported (bytes in, bytes out, codec injectable) so this logic is testable without a
 * browser; `compressPdf` below is the thin wrapper the app actually calls.
 */
export async function compressPdfBytes(input: Uint8Array, level: PdfLevel, codec: ImageCodec = browserCodec): Promise<Uint8Array> {
  const { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } = await import('pdf-lib');
  let pdf;
  try {
    pdf = await PDFDocument.load(input);
  } catch (error) {
    // pdf-lib's custom error classes lose their prototype chain once compiled to ES5, so
    // `instanceof EncryptedPDFError` doesn't work here — match its (stable) message instead.
    throw new LocalError(/is encrypted/.test((error as Error).message) ? 'PDF_PASSWORD' : 'INVALID_PDF');
  }

  // An image can't show more detail than its page holds at the level's DPI, so its long side is capped
  // there (A4 at 150 DPI: 1754 px). This uses the largest page, not the size each image is drawn at;
  // reading the placement from the content streams would shrink images drawn small even further.
  const { dpi, quality } = PDF_LEVELS[level];
  const pages = pdf.getPages();
  const longestPage = pages.length ? Math.max(...pages.map((page) => Math.max(...Object.values(page.getSize())))) : 842;
  const maxSide = Math.round((longestPage / 72) * dpi);
  const context = pdf.context;
  const SUBTYPE = PDFName.of('Subtype'), IMAGE = PDFName.of('Image'), FILTER = PDFName.of('Filter');
  const DCT = PDFName.of('DCTDecode'), FLATE = PDFName.of('FlateDecode');
  const GRAY = PDFName.of('DeviceGray'), RGB = PDFName.of('DeviceRGB');
  const WIDTH = PDFName.of('Width'), HEIGHT = PDFName.of('Height');
  const COLORSPACE = PDFName.of('ColorSpace'), BPC = PDFName.of('BitsPerComponent');
  const DECODE_PARMS = PDFName.of('DecodeParms'), LENGTH = PDFName.of('Length');
  const SMASK = PDFName.of('SMask'), ICC = PDFName.of('ICCBased'), N = PDFName.of('N');

  /** 1 or 3 for gray or RGB data, including colour-profiled (ICCBased) gray and RGB as saved by browsers and most PDF makers. */
  const channels = (colorSpace: unknown) => {
    if (colorSpace === GRAY) return 1;
    if (colorSpace === RGB) return 3;
    if (!(colorSpace instanceof PDFArray) || colorSpace.lookup(0) !== ICC) return undefined;
    const profile = colorSpace.lookup(1);
    const n = profile instanceof PDFRawStream ? profile.dict.lookup(N) : undefined;
    return n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3) ? n.asNumber() : undefined;
  };

  // Soft masks must stay single-channel images, so they are never re-encoded as (RGB) JPEG. Their
  // parent image can be: a soft mask may have a different size from the image it belongs to.
  const softMasks = new Set<unknown>();
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.lookup(SUBTYPE) === IMAGE) softMasks.add(object.dict.get(SMASK));
  }

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    if (dict.lookup(SUBTYPE) !== IMAGE || softMasks.has(ref)) continue;
    // A colour-key mask, stencil mask or custom decode array would no longer match the image after
    // it is recompressed, and a /Matte soft mask expects the exact original colours, so those are left untouched.
    if (dict.has(PDFName.of('Mask')) || dict.has(PDFName.of('Decode')) || dict.has(PDFName.of('ImageMask'))) continue;
    const mask = dict.lookup(SMASK);
    if (mask instanceof PDFRawStream && mask.dict.has(PDFName.of('Matte'))) continue;

    const width = dict.lookup(WIDTH);
    const height = dict.lookup(HEIGHT);
    if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) continue;
    const w = width.asNumber();
    const h = height.asNumber();
    const filter = dict.lookup(FILTER);
    const components = channels(dict.lookup(COLORSPACE));
    const bpc = dict.lookup(BPC);
    const is8bit = !bpc || (bpc instanceof PDFNumber && bpc.asNumber() === 8);
    const original = object.getContents();

    let recompressed: { data: Uint8Array; width: number; height: number } | undefined;
    try {
      if (filter === DCT && is8bit && components) {
        recompressed = await codec.recompressJpeg(original, maxSide, quality);
      } else if (filter === FLATE && is8bit && !dict.has(DECODE_PARMS) && components) {
        const decoded = unzlibSync(original);
        if (decoded.length === w * h * components) {
          const rgba = new Uint8Array(w * h * 4);
          for (let i = 0, p = 0; i < decoded.length; i += components, p += 4) {
            rgba[p] = decoded[i];
            rgba[p + 1] = decoded[i + (components === 1 ? 0 : 1)];
            rgba[p + 2] = decoded[i + (components === 1 ? 0 : 2)];
            rgba[p + 3] = 255;
          }
          recompressed = await codec.recompressRaw(rgba, w, h, maxSide, quality);
        }
      }
    } catch {
      recompressed = undefined; // an image this build can't safely decode is left as-is
    }
    if (!recompressed || recompressed.data.length >= original.length) continue;

    // Re-encoding always yields a plain baseline JPEG (canvas has no single-channel output), so a
    // gray source becomes DeviceRGB here; when that isn't smaller the image above is left
    // alone, so a gray image that already compresses well simply keeps its original gray data.
    // An RGB colour space (with its colour profile, if any) still describes the new pixels, so it is kept.
    const newDict = dict.clone(context);
    newDict.set(FILTER, DCT);
    newDict.delete(DECODE_PARMS);
    newDict.set(WIDTH, PDFNumber.of(recompressed.width));
    newDict.set(HEIGHT, PDFNumber.of(recompressed.height));
    if (components === 1) newDict.set(COLORSPACE, RGB);
    newDict.set(BPC, PDFNumber.of(8));
    newDict.set(LENGTH, PDFNumber.of(recompressed.data.length));
    context.assign(ref, PDFRawStream.of(newDict, recompressed.data));
  }

  return pdf.save({ useObjectStreams: true });
}

/** Recompresses the JPEG and simple raster images embedded in a PDF; text stays selectable. */
export async function compressPdf(file: File, options: { level: PdfLevel }, codec: ImageCodec = browserCodec): Promise<Output> {
  const input = await bytes(file);
  const output = await compressPdfBytes(input, options.level, codec);
  const smaller = output.length < input.length;
  const final = smaller ? output : input;
  return {
    blob: new Blob([final as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    name: `${baseName(file)}-compressed.pdf`,
    summary: shrinkSummary(input.length, final.length),
  };
}

/** Recompresses the JPEGs embedded in a Word, Excel or PowerPoint file; other picture formats are left as-is. */
export async function compressOffice(file: File, options: Level, codec: ImageCodec = browserCodec): Promise<Output> {
  const { unzipSync } = await import('fflate');
  const input = await bytes(file);
  let entries;
  try {
    entries = unzipSync(input);
    if (!entries['[Content_Types].xml']) throw new Error();
  } catch {
    throw new LocalError('NOT_OFFICE');
  }

  const maxSide = LONG_SIDE[options.level];
  const quality = QUALITY[options.level];
  for (const path of Object.keys(entries)) {
    if (!/^(?:word|xl|ppt)\/media\/.+\.jpe?g$/i.test(path)) continue; // PNG/GIF/EMF would need relationship rewrites to change format, so they're left alone
    try {
      const result = await codec.recompressJpeg(entries[path], maxSide, quality);
      if (result.data.length < entries[path].length) entries[path] = result.data as Uint8Array<ArrayBuffer>;
    } catch {
      // unreadable image: leave it as-is
    }
  }

  // [Content_Types].xml first, as some Office versions expect it early in the archive.
  const ordered: Zippable = { '[Content_Types].xml': entries['[Content_Types].xml'] };
  for (const [path, data] of Object.entries(entries)) if (path !== '[Content_Types].xml') ordered[path] = data;
  const zipped = zipSync(ordered, { level: 9 });

  const smaller = zipped.length < input.length;
  const final = smaller ? zipped : input;
  const extension = file.name.split('.').pop() ?? 'docx';
  return {
    blob: new Blob([final as Uint8Array<ArrayBuffer>], { type: file.type }),
    name: `${baseName(file)}-compressed.${extension}`,
    summary: shrinkSummary(input.length, final.length),
  };
}

export interface ConvertOptions {
  format: 'jpeg' | 'png' | 'webp' | 'original';
  /** 0.1–1, ignored for png. */
  quality: number;
  /** Percent, e.g. 50 or 200; wins over width/height when given. */
  scale?: number;
  width?: number;
  height?: number;
  keepAspect?: boolean;
  /** Largest file allowed, in KB (e.g. 100 for a form that says "under 100 KB"). */
  targetKb?: number;
}

/** Works out the output pixel size for one image; pure so it can be unit-tested without a browser. */
export function targetSize(width: number, height: number, options: ConvertOptions): { width: number; height: number } {
  let w = width;
  let h = height;
  if (options.scale) {
    w = width * (options.scale / 100);
    h = height * (options.scale / 100);
  } else if (options.width && options.height) {
    if (options.keepAspect) {
      const factor = Math.min(options.width / width, options.height / height);
      w = width * factor;
      h = height * factor;
    } else {
      w = options.width;
      h = options.height;
    }
  } else if (options.width) {
    w = options.width;
    h = height * (options.width / width);
  } else if (options.height) {
    h = options.height;
    w = width * (options.height / height);
  }
  const clamp = (n: number) => Math.min(16384, Math.max(1, Math.round(n)));
  return { width: clamp(w), height: clamp(h) };
}

const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function outputType(file: File, format: ConvertOptions['format']): string {
  if (format !== 'original') return `image/${format}`;
  return file.type === 'image/jpeg' || file.type === 'image/webp' ? file.type : 'image/png'; // anything else (gif, bmp…) becomes lossless PNG
}

/** Resizes the bitmap in steps of roughly half, which looks better than one big jump for large downscales. */
async function resizeBitmap(bitmap: ImageBitmap, width: number, height: number): Promise<ImageBitmap> {
  let current = bitmap;
  let w = bitmap.width;
  let h = bitmap.height;
  while (w > width * 2 && h > height * 2) {
    w = Math.max(width, Math.round(w / 2));
    h = Math.max(height, Math.round(h / 2));
    current = await createImageBitmap(current, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  }
  if (w !== width || h !== height) current = await createImageBitmap(current, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  return current;
}

function uniqueName(used: Set<string>, name: string) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const [, stem, ext = ''] = /^(.*?)(\.[^.]+)?$/.exec(name)!;
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`)) i++;
  const alt = `${stem}-${i}${ext}`;
  used.add(alt);
  return alt;
}

/** True if an image file carries EXIF or XMP metadata (JPEG APP1, PNG eXIf/iTXt, WebP EXIF/XMP chunks). */
function hasMetadata(data: Uint8Array) {
  const head = new TextDecoder('latin1').decode(data.subarray(0, 256 * 1024));
  return /Exif\0\0|eXIf|EXIF|XMP |x:xmpmeta/.test(head);
}

/** Long sides to try, largest first: WhatsApp's everyday size, then smaller only when needed. */
const FIT_SIDES = [1600, 1280, 1024, 800, 640, 480, 320];

/**
 * The best-looking JPEG/WebP under `maxBytes`, the way messaging apps do it: keep the picture large
 * and lower the quality first (never below 50% while it is 1000px or more), and only then step the
 * size down. Returns null when even 320px at low quality is too big.
 */
async function fitToSize(bitmap: ImageBitmap, maxBytes: number, type: string) {
  const long = Math.max(bitmap.width, bitmap.height);
  const sides = [...new Set([Math.min(long, FIT_SIDES[0]), ...FIT_SIDES.filter((side) => side < long)])];
  for (const side of sides) {
    const width = Math.max(1, Math.round((bitmap.width * side) / long));
    const height = Math.max(1, Math.round((bitmap.height * side) / long));
    const resized = side === long ? bitmap : await resizeBitmap(bitmap, width, height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // forms want JPEG, which has no transparency
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(resized, 0, 0, width, height);
    const encode = async (quality: number) => bytes(await canvas.convertToBlob({ type, quality }));
    const best = await encode(0.92);
    if (best.length <= maxBytes) return { data: best, width, height };
    let low = side >= 1000 ? 0.5 : 0.35;
    let fit = await encode(low);
    if (fit.length > maxBytes) continue;
    let high = 0.92;
    for (let step = 0; step < 6; step++) {
      const middle = (low + high) / 2;
      const data = await encode(middle);
      if (data.length <= maxBytes) [low, fit] = [middle, data];
      else high = middle;
    }
    return { data: fit, width, height };
  }
  return null;
}

/** Resizes and/or recompresses one or more images; metadata such as EXIF/GPS is dropped as a side effect of re-encoding. */
export async function convertImages(files: File[], options: ConvertOptions): Promise<Output> {
  if (options.width !== undefined && (options.width < 1 || options.width > 16384)) throw new LocalError('BAD_SIZE');
  if (options.height !== undefined && (options.height < 1 || options.height > 16384)) throw new LocalError('BAD_SIZE');
  if (options.scale !== undefined && !(options.scale >= 1 && options.scale <= 1000)) throw new LocalError('BAD_SCALE');
  if (options.targetKb !== undefined && !(options.targetKb >= 5)) throw new LocalError('BAD_TARGET');

  const used = new Set<string>();
  const outputs: { name: string; data: Uint8Array }[] = [];
  let totalBefore = 0;
  let totalAfter = 0;
  let lastSize = { width: 0, height: 0 };

  for (const file of files) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new LocalError('BAD_IMAGE');
    }
    if (options.targetKb) {
      const type = options.format === 'webp' ? 'image/webp' : 'image/jpeg';
      const fitted = await fitToSize(bitmap, options.targetKb * 1024, type);
      if (!fitted) throw new LocalError('TARGET_TOO_SMALL');
      lastSize = fitted;
      totalBefore += file.size;
      totalAfter += fitted.data.length;
      outputs.push({ name: uniqueName(used, `${baseName(file)}.${IMAGE_EXT[type]}`), data: fitted.data });
      continue;
    }
    const size = targetSize(bitmap.width, bitmap.height, options);
    // A browser tab can't hold much more than this in one picture; stop before it runs out of memory.
    if (size.width * size.height > 100_000_000) throw new LocalError('TOO_LARGE');
    lastSize = size;
    const resized = size.width === bitmap.width && size.height === bitmap.height ? bitmap : await resizeBitmap(bitmap, size.width, size.height);
    const type = outputType(file, options.format);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#fff'; // JPEG has no transparency; fill white behind it first.
      ctx.fillRect(0, 0, size.width, size.height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(resized, 0, 0, size.width, size.height);
    const blob = await canvas.convertToBlob(type === 'image/png' ? { type } : { type, quality: options.quality });
    let data = await bytes(blob);
    // Same format and size but no smaller: keep the original, unless it carries EXIF/XMP (e.g. GPS) that re-encoding strips.
    if (type === file.type && resized === bitmap && data.length >= file.size) {
      const original = await bytes(file);
      if (!hasMetadata(original)) data = original;
    }
    totalBefore += file.size;
    totalAfter += data.length;
    const extension = IMAGE_EXT[type] ?? 'png';
    outputs.push({ name: uniqueName(used, `${baseName(file)}.${extension}`), data });
  }

  // Say what changed in size, so "nothing to gain" is visible too.
  const saving =
    totalAfter < totalBefore
      ? ` · ${Math.round((1 - totalAfter / totalBefore) * 100)}% smaller`
      : totalAfter === totalBefore ? ' · Already optimized' : '';
  if (outputs.length === 1) {
    const [only] = outputs;
    const ext = only.name.split('.').pop();
    return {
      blob: new Blob([only.data as Uint8Array<ArrayBuffer>]),
      name: options.targetKb ? `${baseName(files[0])}-${options.targetKb}kb.${ext}` : `${baseName(files[0])}-${lastSize.width}x${lastSize.height}.${ext}`,
      summary: `1 image · ${lastSize.width} × ${lastSize.height}${saving}`,
    };
  }

  const zipped = zipSync(Object.fromEntries(outputs.map(({ name, data }) => [name, [data, { level: 0 }]])) as Zippable);
  const summary = `${outputs.length} images${saving}`;
  return { blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name: 'images-resized.zip', summary };
}
