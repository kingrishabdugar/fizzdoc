import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync, zlibSync } from 'fflate';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { compressOffice, compressPdfBytes, convertImages, targetSize, type ImageCodec } from '../src/engine/compress';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const file = (name: string, bytes: Uint8Array, type = '') => new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

const photo = fixture('photo.jpg'); // real 120x80 JPEG, reused from local.test.ts

/** A codec that shrinks whatever it is given without touching real image data, so the object-walking
 * logic in compress.ts can be tested without a browser. */
function fakeCodec(shrink: boolean): ImageCodec {
  const scaled = (width: number, height: number, maxSide: number) => {
    const long = Math.max(width, height);
    if (long <= maxSide) return { width, height };
    const factor = maxSide / long;
    return { width: Math.round(width * factor), height: Math.round(height * factor) };
  };
  return {
    async recompressJpeg(source, maxSide) {
      const { width, height } = scaled(120, 80, maxSide);
      return { data: new Uint8Array(shrink ? Math.ceil(source.length / 2) : source.length + 1).fill(9), width, height };
    },
    async recompressRaw(_rgba, width, height, maxSide) {
      const size = scaled(width, height, maxSide);
      const bytes = shrink ? 10 : width * height * 3 + 1;
      return { data: new Uint8Array(bytes).fill(9), width: size.width, height: size.height };
    },
  };
}

async function pdfWithJpeg() {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(photo);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return pdf.save();
}

/** Adds a bare, unreferenced Image XObject straight to the context — enumerateIndirectObjects finds
 * it regardless, so a page/content-stream is not needed to exercise the walking logic. */
async function pdfWithFlateImage(width: number, height: number, colorSpace: 'DeviceRGB' | 'DeviceGray', extra: Record<string, unknown> = {}) {
  const pdf = await PDFDocument.create();
  const components = colorSpace === 'DeviceGray' ? 1 : 3;
  const pixels = new Uint8Array(width * height * components).fill(128);
  const stream = pdf.context.stream(zlibSync(pixels), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: colorSpace,
    BitsPerComponent: 8,
    Filter: 'FlateDecode',
    ...extra,
  });
  pdf.context.register(stream);
  return pdf.save();
}

function findImage(pdf: PDFDocument) {
  const [, object] = pdf.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'))!;
  return object as PDFRawStream;
}

describe('compressPdfBytes', () => {
  it('recompresses a JPEG image as a smaller DCTDecode stream', async () => {
    const input = await pdfWithJpeg();
    const output = await compressPdfBytes(input, 'medium', fakeCodec(true));
    expect(output.length).toBeLessThan(input.length);
    const image = findImage(await PDFDocument.load(output));
    expect(image.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(image.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    expect((image.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(120);
    expect((image.dict.lookup(PDFName.of('Length')) as PDFNumber).asNumber()).toBe(image.getContents().length);
  });

  it('never enlarges an image that is already below the level’s resolution', async () => {
    const input = await pdfWithJpeg();
    const output = await compressPdfBytes(input, 'high', fakeCodec(true)); // 120 pt page at 110 DPI allows 183 px; the image is 120x80
    const image = findImage(await PDFDocument.load(output));
    expect((image.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(120);
    expect((image.dict.lookup(PDFName.of('Height')) as PDFNumber).asNumber()).toBe(80);
  });

  it('caps an image at the level’s DPI for the largest page', async () => {
    const sides: Record<string, number> = {};
    for (const level of ['low', 'medium', 'high', 'extreme'] as const) {
      const pdf = await PDFDocument.create();
      pdf.addPage([72, 36]); // 1 × 0.5 inch
      pdf.addPage([144, 72]); // 2 × 1 inch: the largest page
      pdf.context.register(pdf.context.stream(zlibSync(new Uint8Array(1000 * 500 * 3).fill(128)), {
        Type: 'XObject', Subtype: 'Image', Width: 1000, Height: 500, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode',
      }));
      const image = findImage(await PDFDocument.load(await compressPdfBytes(await pdf.save(), level, fakeCodec(true))));
      sides[level] = (image.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber();
    }
    expect(sides).toEqual({ low: 400, medium: 300, high: 220, extreme: 144 }); // 2 inches × DPI
  });

  it('leaves the image untouched when recompressing would not shrink it', async () => {
    const input = await pdfWithJpeg();
    const before = findImage(await PDFDocument.load(input));
    const output = await compressPdfBytes(input, 'medium', fakeCodec(false));
    const after = findImage(await PDFDocument.load(output));
    expect(after.getContents()).toEqual(before.getContents());
    expect(after.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
  });

  it('recompresses an 8-bit FlateDecode DeviceRGB image', async () => {
    const input = await pdfWithFlateImage(40, 20, 'DeviceRGB');
    const output = await compressPdfBytes(input, 'medium', fakeCodec(true));
    const image = findImage(await PDFDocument.load(output));
    expect(image.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect((image.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(40);
  });

  it('recompresses an 8-bit FlateDecode DeviceGray image, turning it into DeviceRGB', async () => {
    const input = await pdfWithFlateImage(40, 20, 'DeviceGray');
    const output = await compressPdfBytes(input, 'medium', fakeCodec(true));
    const image = findImage(await PDFDocument.load(output));
    expect(image.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
  });

  /** An RGB image with a gray soft mask (how browsers save a PNG with transparency); `matte` marks pre-blended colours. */
  async function pdfWithSoftMask(matte = false) {
    const pdf = await PDFDocument.create();
    const mask = pdf.context.register(pdf.context.stream(zlibSync(new Uint8Array(40 * 20).map((_, i) => i % 256)), {
      Type: 'XObject', Subtype: 'Image', Width: 40, Height: 20, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode',
      ...(matte ? { Matte: [0, 0, 0] } : {}),
    }));
    pdf.context.register(pdf.context.stream(zlibSync(new Uint8Array(40 * 20 * 3).fill(128)), {
      Type: 'XObject', Subtype: 'Image', Width: 40, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode', SMask: mask,
    }));
    return pdf.save();
  }
  const images = (pdf: PDFDocument) =>
    pdf.context.enumerateIndirectObjects().map(([, o]) => o).filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
  const withMask = (pdf: PDFDocument) => images(pdf).find((o) => o.dict.has(PDFName.of('SMask')))!;
  const theMask = (pdf: PDFDocument) => images(pdf).find((o) => !o.dict.has(PDFName.of('SMask')))!;

  it('recompresses an image with a soft mask but never the mask itself', async () => {
    const input = await pdfWithSoftMask();
    const maskBefore = theMask(await PDFDocument.load(input)).getContents();
    const output = await compressPdfBytes(input, 'medium', fakeCodec(true));
    const loaded = await PDFDocument.load(output);
    expect(images(loaded)).toHaveLength(2);
    expect(withMask(loaded).dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(withMask(loaded).dict.lookup(PDFName.of('SMask'))).toBe(theMask(loaded));
    expect(theMask(loaded).dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(theMask(loaded).getContents()).toEqual(maskBefore);
  });

  it('skips an image whose soft mask expects pre-blended (/Matte) colours', async () => {
    const input = await pdfWithSoftMask(true);
    const before = withMask(await PDFDocument.load(input)).getContents();
    const output = await compressPdfBytes(input, 'medium', fakeCodec(true));
    expect(withMask(await PDFDocument.load(output)).getContents()).toEqual(before);
  });

  it('recompresses colour-profiled (ICCBased) RGB and gray images, keeping an RGB profile', async () => {
    for (const n of [3, 1]) {
      const pdf = await PDFDocument.create();
      const profile = pdf.context.register(pdf.context.stream(new Uint8Array(16), { N: n }));
      pdf.context.register(pdf.context.stream(zlibSync(new Uint8Array(40 * 20 * n).fill(128)), {
        Type: 'XObject', Subtype: 'Image', Width: 40, Height: 20, ColorSpace: ['ICCBased', profile], BitsPerComponent: 8, Filter: 'FlateDecode',
      }));
      const output = await compressPdfBytes(await pdf.save(), 'medium', fakeCodec(true));
      const image = findImage(await PDFDocument.load(output));
      expect(image.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
      const colorSpace = image.dict.lookup(PDFName.of('ColorSpace'));
      if (n === 1) expect(colorSpace).toBe(PDFName.of('DeviceRGB'));
      else expect(colorSpace?.toString()).toMatch(/^\[ \/ICCBased \d+ 0 R \]$/);
    }
  });

  it('skips images with an unsupported filter or color space', async () => {
    const input = await pdfWithFlateImage(10, 10, 'DeviceRGB', { ColorSpace: 'DeviceCMYK' });
    const before = findImage(await PDFDocument.load(input));
    const output = await compressPdfBytes(input, 'medium', fakeCodec(true));
    const after = findImage(await PDFDocument.load(output));
    expect(after.getContents()).toEqual(before.getContents());
  });

  it('rejects an encrypted PDF and a file that is not a PDF at all', async () => {
    await expect(compressPdfBytes(fixture('user-password.pdf'), 'medium')).rejects.toThrow('PDF_PASSWORD');
    await expect(compressPdfBytes(new TextEncoder().encode('not a pdf'), 'medium')).rejects.toThrow('INVALID_PDF');
  });
});

describe('compressOffice', () => {
  function office(entries: Record<string, Uint8Array>) {
    return file('doc.docx', zipSync({ '[Content_Types].xml': strToU8('<Types/>'), ...entries }) as Uint8Array<ArrayBuffer>);
  }

  it('shrinks embedded JPEGs and leaves other media untouched', async () => {
    const png = new Uint8Array(50).fill(1);
    const input = office({ 'word/media/image1.jpg': photo, 'word/media/image2.png': png });
    const result = await compressOffice(input, { level: 'light' }, fakeCodec(true));
    const out = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(out['word/media/image1.jpg'].length).toBeLessThan(photo.length);
    expect(out['word/media/image2.png']).toEqual(png);
    expect(Object.keys(out)[0]).toBe('[Content_Types].xml');
  });

  it('reports "Already optimized" and returns the original bytes when nothing shrinks', async () => {
    const input = office({ 'word/media/image1.jpg': photo });
    const inputBytes = new Uint8Array(await input.arrayBuffer());
    const result = await compressOffice(input, { level: 'light' }, fakeCodec(false));
    expect(result.summary).toBe('Already optimized');
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(inputBytes);
  });

  it('rejects a file that is not an Office package', async () => {
    await expect(compressOffice(file('photo.jpg', photo, 'image/jpeg'), { level: 'light' })).rejects.toThrow('NOT_OFFICE');
  });
});

describe('targetSize', () => {
  it('scales both dimensions by a percentage', () => {
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, scale: 50 })).toEqual({ width: 500, height: 250 });
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, scale: 200 })).toEqual({ width: 2000, height: 1000 });
  });

  it('derives height from width alone, keeping aspect ratio', () => {
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, width: 400 })).toEqual({ width: 400, height: 200 });
  });

  it('derives width from height alone, keeping aspect ratio', () => {
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, height: 100 })).toEqual({ width: 200, height: 100 });
  });

  it('fits inside width and height when keepAspect is set', () => {
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, width: 400, height: 400, keepAspect: true })).toEqual({ width: 400, height: 200 });
  });

  it('stretches to the exact width and height when keepAspect is not set', () => {
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, width: 400, height: 400 })).toEqual({ width: 400, height: 400 });
  });

  it('clamps to the 1..16384 range', () => {
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, scale: 0.01 })).toEqual({ width: 1, height: 1 });
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8, scale: 5000 })).toEqual({ width: 16384, height: 16384 });
  });

  it('keeps the original size when no sizing option is given', () => {
    expect(targetSize(1000, 500, { format: 'jpeg', quality: 0.8 })).toEqual({ width: 1000, height: 500 });
  });
});

describe('convertImages validation', () => {
  it('rejects an out-of-range explicit width or height before touching any image', async () => {
    await expect(convertImages([file('photo.jpg', photo, 'image/jpeg')], { format: 'jpeg', quality: 0.8, width: 0 })).rejects.toThrow('BAD_SIZE');
    await expect(convertImages([file('photo.jpg', photo, 'image/jpeg')], { format: 'jpeg', quality: 0.8, height: 20000 })).rejects.toThrow('BAD_SIZE');
  });
});
