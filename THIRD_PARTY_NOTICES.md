# Third-party notices

The deployed site ships these third-party components in `assets/`:

| Component | License | Source |
|---|---|---|
| qpdf 12.2.0 | Apache-2.0 | https://github.com/qpdf/qpdf |
| @neslinesli93/qpdf-wasm 0.3.0 (Emscripten build and JS loader) | ISC | https://github.com/neslinesli93/qpdf-wasm |
| zlib (compiled into qpdf) | zlib | https://zlib.net |
| libjpeg-turbo (compiled into qpdf) | IJG and BSD-3-Clause | https://libjpeg-turbo.org |
| pdf.js (pdfjs-dist: rendering, text extraction, editor) | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pdf-lib (JPG → PDF, compression, OCR text layer, editing) with pako, @pdf-lib/standard-fonts, @pdf-lib/upng, tslib | MIT (tslib: 0BSD) | https://github.com/Hopding/pdf-lib |
| fflate (Office files, ZIP output) | MIT | https://github.com/101arrowz/fflate |
| Tesseract OCR engine (tesseract.js, tesseract.js-core) | Apache-2.0 | https://github.com/naptha/tesseract.js |
| English language data (@tesseract.js-data/eng, tessdata 4.0.0 best_int) | Apache-2.0 data, MIT package | https://github.com/tesseract-ocr/tessdata |
| Mermaid 12.0.0 (Mermaid to Image page only), bundling d3, dagre-d3-es, cytoscape, chevrotain, DOMPurify, KaTeX, marked, roughjs, dayjs, lodash-es, stylis, khroma, elkjs and others | MIT, ISC, BSD-3-Clause, Apache-2.0, Unlicense; DOMPurify used under Apache-2.0 (dual MPL-2.0 OR Apache-2.0); elkjs EPL-2.0, source at https://github.com/kieler/elkjs | https://github.com/mermaid-js/mermaid |
| Whisper tiny speech model (OpenAI; ONNX conversion by onnx-community) and Transformers.js 4.3.0 with ONNX Runtime Web (Audio to Text pages only), bundling @huggingface/jinja, @huggingface/tokenizers, protobufjs, flatbuffers, long, guid-typescript, platform | Apache-2.0 (model, Transformers.js, tokenizers, flatbuffers, long); MIT (ONNX Runtime, jinja, platform); BSD-3-Clause (protobufjs); ISC (guid-typescript) | https://github.com/openai/whisper, https://github.com/huggingface/transformers.js, https://github.com/microsoft/onnxruntime |
| BiRefNet-lite background model (ZhengPeng7/BiRefNet; 512 px ONNX export by studioludens and 1024 px export by onnx-community, weights stored as 16-bit) and U²-Net small (xuebinqin/U-2-Net; ONNX by BritishWerewolf), run with ONNX Runtime Web's WebGPU build (Remove Background page only) | MIT (BiRefNet, ONNX Runtime); Apache-2.0 (U²-Net) | https://github.com/ZhengPeng7/BiRefNet, https://github.com/xuebinqin/U-2-Net, https://github.com/microsoft/onnxruntime |
| gifuct-js 2.1.2 and gifenc 1.0.3 (Remove GIF Background page only); Mediabunny 1.61.3 (Remove Video Background page only) | MIT (gifuct-js, gifenc); MPL-2.0 (Mediabunny, used unmodified) | https://github.com/matt-way/gifuct-js, https://github.com/mattdesl/gifenc, https://github.com/Vanilagy/mediabunny |
| Inter typeface (@fontsource-variable/inter) | SIL Open Font License 1.1 | https://rsms.me/inter |
| Archify (generator and runtime of `public/architecture.html`) | MIT | https://github.com/tt-a1i/archify |
| JetBrains Mono typeface (embedded in `public/architecture.html`) | SIL Open Font License 1.1 | https://github.com/JetBrains/JetBrainsMono |

The full copyright notices and license texts ship with the site at [`/third-party-licenses.txt`](public/third-party-licenses.txt).

No AGPL components are included. Keep this table and that file in sync when adding an engine.

## Trademarks

PDF is an open standard (ISO 32000). Microsoft Word, Excel and PowerPoint are trademarks of Microsoft; Google Docs, Sheets and Slides are trademarks of Google; iPhone and Live Text are trademarks of Apple; iLovePDF, Smallpdf, Adobe Acrobat, PDF24 and Stirling-PDF belong to their respective owners. These names appear only to describe file formats and compatibility, or for comparison. Fizzdoc is an independent project and is not affiliated with, sponsored by or endorsed by any of them.
