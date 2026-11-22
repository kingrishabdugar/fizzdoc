// Reads QR codes and barcodes in tests with ZXing, the same decoder family phone camera apps use.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm')).buffer as ArrayBuffer } });

/** The text in the first code ZXing finds in a PNG or JPG file, or undefined. */
export async function readCode(image: Uint8Array) {
  const [found] = await readBarcodes(image, { tryHarder: true });
  return found?.text;
}

/** A barcode picture (PNG) made with ZXing, for tests that need a code to read. */
export async function makeCode(text: string, format: 'EAN13' | 'QRCode' | 'Code128') {
  const { prepareZXingModule: prepareWriter, writeBarcode } = await import('zxing-wasm/writer');
  prepareWriter({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/writer/zxing_writer.wasm')).buffer as ArrayBuffer } });
  const { image, error } = await writeBarcode(text, { format, scale: 4 });
  if (!image) throw new Error(error);
  return Buffer.from(await image.arrayBuffer());
}
