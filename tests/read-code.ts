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
