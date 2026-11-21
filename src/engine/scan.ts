// Reads QR codes and barcodes with ZXing (WebAssembly). The engine comes from this site, not a CDN,
// so it passes the page's CSP and the service worker keeps it for offline use.
import { prepareZXingModule, readBarcodes, type ReadResult } from 'zxing-wasm/reader';
import wasm from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm : prefix + path) } });

export type Found = ReadResult;

/** Every code in a picture (a file, or one camera frame), up to 16. */
export function readCodes(image: Blob | ImageData, fast = false): Promise<Found[]> {
  // A camera frame is read many times a second, so it skips the slower, more thorough search.
  return readBarcodes(image, { tryHarder: !fast, tryRotate: !fast, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 16 });
}
