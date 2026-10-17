import './style.css';
import '@fontsource-variable/inter';
import { setUpEffects } from './effects';
import { setUpSearch } from './search';
import type { ErrorCode, Job, Op } from './engine/pdf';
import type { LocalError, Output } from './engine/local';
import type { Theme } from './engine/mermaid';
import type { FromWorker, ToWorker } from './engine/worker';
import type { ToolOp } from './site';
import { UI, localizeSummary, t, type UiKey } from './i18n';

/** A document for the browser's own PDF writer (print → Save as PDF): handles every script and font. */
interface Printable {
  html: string;
  title: string;
}
type Options = Record<string, string>;
type LocalJob = (files: File[], options: Options) => Promise<Output | Printable>;

type Failure = ErrorCode | LocalError['code'] | 'ENGINE_FAILED' | 'PASSWORDS_DIFFER';

const errorText = (code: Failure, vars?: Record<string, string | number>) => t(`error.${code}` as UiKey, vars);

const SUFFIX: Record<Op, string> = {
  merge: 'merged',
  split: 'pages',
  rotate: 'rotated',
  delete: 'trimmed',
  unlock: 'unlocked',
  protect: 'protected',
  clean: 'clean',
};

const MiB = 1024 * 1024;

/**
 * Largest combined input we start a job for. A policy, not a measurement: 128 MiB per GiB of
 * reported device memory, capped at 1 GiB (the engine's WASM heap tops out at 2 GiB).
 */
function inputBudget() {
  const gib = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return gib ? Math.min(gib * 128, 1024) * MiB : 512 * MiB;
}

const formatSize = (bytes: number) =>
  bytes < MiB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MiB).toFixed(1)} MB`;

function setUp(op: ToolOp) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const input = $<HTMLInputElement>('file-input')!;
  const drop = $('drop')!;
  const list = $<HTMLOListElement>('file-list')!;
  const pages = $<HTMLInputElement>('pages');
  const angle = $<HTMLSelectElement>('angle');
  const runButton = $<HTMLButtonElement>('run')!;
  const cancelButton = $<HTMLButtonElement>('cancel')!;
  const status = $('status')!;
  const progress = $('progress')!;
  const report = $('report')!;
  const reportSpeed = $('report-speed')!;
  const reportLink = $<HTMLAnchorElement>('report-link')!;
  const reorderHint = $('reorder-hint');
  const result = $('result')!;
  const download = $<HTMLAnchorElement>('download')!;
  const warnings = $<HTMLUListElement>('warnings')!;
  // Only PDF pages have the password dialog; Office tools never ask for one.
  const dialog = $<HTMLDialogElement>('password-dialog')!;
  const password = $<HTMLInputElement>('password')!;
  const passwordTitle = $('password-title')!;
  const passwordHint = $('password-hint')!;
  const newPassword = $<HTMLInputElement>('new-password');
  const confirmPassword = $<HTMLInputElement>('confirm-password');
  const workspace = $('workspace')!;
  const viewer = $('viewer');
  const optionsPanel = workspace.querySelector('.options')!;
  const codeField = optionsPanel.querySelector<HTMLTextAreaElement>('textarea[name="code"]');

  const multiple = workspace.dataset.multiple === 'true';
  // Mirrors the input's accept list (".pdf", "image/*", …) for dropped files.
  const acceptList = input.accept.split(',');
  const accepted = (file: File) =>
    acceptList.some((rule) =>
      rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) : rule.endsWith('/*') ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule,
    );
  let files: File[] = [];
  let worker: Worker | undefined;
  // Shown next to the file name: page counts on page-range tools, durations on audio tools.
  const notes = new WeakMap<File, string>();
  let counter: Worker | undefined;
  let localBusy = false;
  const busy = () => !!worker || localBusy;
  let printFrame: HTMLIFrameElement | undefined;
  // The on-page editors (Edit PDF, Redact PDF) follow the chosen file.
  type Editor = { save(options: Options, onProgress: (fraction: number) => void): Promise<Output>; destroy(): void };
  const EDITORS: Partial<Record<ToolOp, (file: File, viewer: HTMLElement) => Promise<Editor>>> = {
    'edit-pdf': async (file, view) => (await import('./tools/edit-pdf')).openEditor(file, view),
    'audio-split': async (file, view) => (await import('./tools/audio-split')).openSplitter(file, view),
    'remove-bg': async (file, view) => (await import('./tools/remove-bg')).openBackgroundEditor(file, view, options()),
    'redact-pdf': async (file, view) => {
      const redactor = await (await import('./tools/redact-pdf')).openRedactor(file, view);
      return { save: (o, onProgress) => redactor.save(rasterOptions(o), onProgress), destroy: redactor.destroy };
    },
  };
  let editor: { file: File; ready: Promise<Editor> } | undefined;

  // Real progress, when the job reports it: fills the bar and shows the percentage.
  const progressLabel = (fraction: number) => {
    const pct = Math.min(100, Math.round(fraction * 100));
    progress.dataset.pct = String(pct);
    progress.style.setProperty('--pct', `${pct}%`);
    say(t('app.workingPct', { pct }));
  };
  const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '');
  const number = (value: string | undefined) => (value ? Number(value) : undefined);
  const rasterOptions = (o: Options) => ({
    dpi: o.dpi === '300' ? 300 : 150,
    look: (o.look === 'gray' || o.look === 'scanned' ? o.look : 'color') as 'color' | 'gray' | 'scanned',
    keepText: o.keepText === 'true',
  });

  // Every tool that runs outside the qpdf worker. Engines load on first use.
  const LOCAL: Partial<Record<ToolOp, LocalJob>> = {
    'jpg-to-pdf': async (f) => (await import('./engine/local')).imagesToPdf(f),
    'pdf-to-jpg': async (f, o) => (await import('./engine/local')).pdfToImages(f[0], o.format === 'png' ? 'png' : 'jpg', Number(o.dpi) || 150),
    'page-numbers': async (f, o) =>
      (await import('./engine/stamp')).addPageNumbers(f[0], {
        position: o.position as 'bottom-center' | 'bottom-right' | 'top-right',
        start: number(o.start),
        style: o.style === 'page-of' ? 'page-of' : 'number',
      }),
    'watermark-pdf': async (f, o) =>
      (await import('./engine/stamp')).watermarkPdf(f[0], { text: o.text ?? '', opacity: (number(o.opacity) ?? 20) / 100 }),
    'office-clean': async (f) => (await import('./engine/local')).cleanOffice(f[0]),
    'office-images': async (f) => (await import('./engine/local')).extractOfficeImages(f[0]),
    'compress-pdf': async (f, o) => {
      const { PDF_LEVELS, compressPdf } = await import('./engine/compress');
      return compressPdf(f[0], { level: o.level && o.level in PDF_LEVELS ? (o.level as keyof typeof PDF_LEVELS) : 'medium' });
    },
    'office-compress': async (f, o) => (await import('./engine/compress')).compressOffice(f[0], { level: o.level === 'strong' ? 'strong' : 'light' }),
    'image-convert': async (f, o) =>
      (await import('./engine/compress')).convertImages(f, {
        format: (o.format ?? 'original') as 'jpeg' | 'png' | 'webp' | 'original',
        quality: (number(o.quality) ?? 90) / 100,
        width: number(o.width),
        height: number(o.height),
        scale: number(o.scale),
        keepAspect: o.keepAspect !== 'false',
        targetKb: number(o.targetKb),
      }),
    'pdf-to-text': async (f, o) => (await import('./engine/convert')).pdfToText(f[0], { format: o.format === 'md' ? 'md' : 'txt' }),
    'text-to-pdf': async (f) => (await import('./engine/convert')).textToHtml(f[0]),
    'excel-to-csv': async (f) => (await import('./engine/convert')).xlsxToCsv(f[0]),
    'csv-to-excel': async (f) => (await import('./engine/convert')).csvToXlsx(f[0]),
    'excel-to-json': async (f, o) => (await import('./engine/convert')).xlsxToJson(f[0], { header: o.header !== 'false' }),
    'json-to-excel': async (f) => (await import('./engine/convert')).jsonToXlsx(f[0]),
    'mermaid-image': async (f, o) =>
      (await import('./engine/mermaid')).mermaidToImage(
        f[0] ? await f[0].text() : o.code,
        { format: o.format === 'svg' ? 'svg' : 'png', scale: Number(o.scale) || 2, theme: o.theme as Theme, transparent: o.transparent === 'true' },
        f[0]?.name,
      ),
    'word-to-pdf': async (f) => (await import('./engine/office')).docxToHtml(f[0]),
    'pdf-to-word': async (f) => (await import('./engine/office')).pdfToDocx(f[0]),
    'pdf-to-powerpoint': async (f) => (await import('./engine/office')).pdfToPptx(f[0]),
    'ocr-pdf': async (f) => (await import('./engine/ocr')).ocrPdf(f[0], progressLabel),
    transcribe: async (f, o) =>
      (await import('./engine/transcribe')).transcribe(f[0], {
        format: o.format === 'srt' || o.format === 'vtt' ? o.format : 'txt',
        language: o.language || null,
        onSetup: (loaded, total) => {
          // The one-time model download fills the bar first; transcribing then refills it.
          progressLabel(loaded / total);
          say(t('app.setup', { done: Math.round(loaded / 1e6), total: Math.round(total / 1e6) }));
        },
        onProgress: progressLabel,
      }),
    'image-ocr': async (f) => {
      const [{ ocrImage }, { showTextOverlay }] = await Promise.all([import('./engine/ocr'), import('./tools/ocr-viewer')]);
      const [recognized, { unsure }] = await Promise.all([ocrImage(f[0], progressLabel), import('./engine/ocr')]);
      showTextOverlay(viewer!, f[0], recognized);
      const words = recognized.words.length;
      return {
        blob: new Blob([recognized.text], { type: 'text/plain;charset=utf-8' }),
        name: `${baseName(f[0])}.txt`,
        summary: `${words} ${words === 1 ? 'word' : 'words'} recognized`, // localized by show()
        notes: unsure(recognized.words) ? ['ocr.unsure'] : [],
      };
    },
    'edit-pdf': async (_, o) => (await editor!.ready).save(o, progressLabel),
    'redact-pdf': async (_, o) => (await editor!.ready).save(o, progressLabel),
    'remove-bg': async (_, o) => (await editor!.ready).save(o, progressLabel),
    'audio-split': async () => (await editor!.ready).save({}, progressLabel),
    'audio-merge': async (f) => {
      const { parseAudio, write, formatTime, extension } = await import('./engine/audio');
      const tracks = await Promise.all(f.map(async (file) => parseAudio(new Uint8Array(await file.arrayBuffer()))));
      const total = tracks.reduce((sum, track) => sum + track.duration, 0);
      return {
        blob: write(tracks.map((track) => ({ track, frames: track.frames }))),
        name: `${baseName(f[0])}-merged.${extension(tracks[0])}`,
        summary: `${tracks.length} files · ${formatTime(total, false)}`,
      };
    },
    'scan-pdf': async (f, o) => (await import('./engine/raster')).scanPdf(f[0], rasterOptions(o), progressLabel),
  };

  /** The editor follows the chosen file: opening a new one replaces it, removing it closes it. */
  function syncEditor() {
    const open = EDITORS[op];
    if (!open || editor?.file === files[0]) return;
    editor?.ready.then((e) => e.destroy(), () => {});
    viewer!.replaceChildren();
    editor = undefined;
    if (!files[0]) return;
    const file = files[0];
    const ready = open(file, viewer!);
    editor = { file, ready };
    ready.catch((error) => {
      files = [];
      render();
      fail(error);
    });
  }

  function fail(error: unknown) {
    const code = (error as LocalError).code as Failure | undefined;
    if (!code) console.error(error); // unexpected: keep the details for bug reports
    say(errorText(code && `error.${code}` in UI ? code : 'PROCESSING_FAILED', (error as LocalError).vars), 'error');
  }

  const options = (): Options =>
    Object.fromEntries(
      [...optionsPanel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]')].map((field) => [
        field.name,
        field instanceof HTMLInputElement && field.type === 'checkbox' ? String(field.checked) : field.value,
      ]),
    );
  let outputUrl: string | undefined;
  let dragIndex: number | null = null;

  const say = (text: string, tone: 'info' | 'error' = 'info') => {
    status.textContent = text;
    status.dataset.tone = tone;
    if (tone === 'error') report.dataset.tone = 'strong';
  };

  // The report link stands out when a job fails or runs long, and opens a bug report already filled
  // in with the page, browser and job details. Never the file itself or its name.
  let started = 0;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  function startJob() {
    started = Date.now();
    delete report.dataset.tone;
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => (report.dataset.tone = 'strong'), 20_000);
  }
  reportLink.addEventListener('click', () => {
    const size = files.reduce((sum, f) => sum + f.size, 0);
    const details = [
      files.length ? `Files: ${files.length}, ${formatSize(size)}${files.length === 1 && notes.get(files[0]) ? `, ${notes.get(files[0])}` : ''}` : '',
      started ? `Time: ${Math.round((Date.now() - started) / 1000)} s${busy() ? ' (still running)' : ''}` : '',
      status.textContent ? `Message: ${status.textContent}` : '',
      `Device memory: ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? '?'} GB · CPU cores: ${navigator.hardwareConcurrency ?? '?'}`,
    ].filter(Boolean);
    const params = new URLSearchParams({
      template: 'bug_report.yml',
      title: `${document.querySelector('h1')?.textContent?.trim() ?? op}: `,
      tool: location.origin + location.pathname,
      browser: navigator.userAgent,
      extra: details.join('\n'),
    });
    reportLink.href = `${reportLink.href.split('?')[0]}?${params}`;
  });

  let preview: HTMLElement | undefined;
  let beforeUrl: string | undefined;
  function clearResult() {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = undefined;
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    beforeUrl = undefined;
    preview?.remove();
    preview = undefined;
    result.hidden = true;
    warnings.replaceChildren();
    if (op === 'image-ocr') viewer?.replaceChildren();
    printFrame?.remove();
    printFrame = undefined;
  }

  function render() {
    list.replaceChildren(
      ...files.map((file, index) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.name;
        const size = document.createElement('span');
        size.className = 'file-size';
        const note = notes.get(file);
        size.textContent = note ? `${note} · ${formatSize(file.size)}` : formatSize(file.size);
        item.append(name, size);
        if (multiple && !busy()) enableReorder(item, index);
        const buttons: [string, string, () => void, boolean][] = [
          ['↑', t('app.moveUp'), () => files.splice(index - 1, 2, files[index], files[index - 1]), multiple && index > 0],
          ['↓', t('app.moveDown'), () => files.splice(index, 2, files[index + 1], files[index]), multiple && index < files.length - 1],
          ['×', t('app.remove'), () => files.splice(index, 1), true],
        ];
        for (const [symbol, label, action, shown] of buttons) {
          if (!shown) continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'icon-button';
          button.textContent = symbol;
          button.setAttribute('aria-label', `${label}: ${file.name}`);
          button.disabled = busy();
          button.onclick = () => {
            action();
            clearResult();
            render();
          };
          item.append(button);
        }
        return item;
      }),
    );
    // Mermaid code can be pasted instead of choosing a file.
    const pasted = !!codeField?.value.trim();
    runButton.disabled = busy() || files.length < (op === 'merge' ? 2 : pasted ? 0 : 1);
    cancelButton.hidden = !busy();
    progress.hidden = !busy();
    if (!busy()) {
      delete progress.dataset.pct;
      clearTimeout(slowTimer);
    }
    reportSpeed.hidden = !busy();
    if (reorderHint) reorderHint.hidden = files.length < 2 || busy();
    input.disabled = busy();
    drop.classList.toggle('compact', files.length > 0);
    syncEditor();
  }

  /** Desktop drag-and-drop reordering for the merge list; the arrow buttons cover touch and keyboard. */
  function enableReorder(item: HTMLLIElement, index: number) {
    item.draggable = true;
    item.ondragstart = (event) => {
      dragIndex = index;
      event.dataTransfer?.setData('text/plain', String(index));
      item.classList.add('lifted');
    };
    item.ondragend = () => {
      dragIndex = null;
      item.classList.remove('lifted');
    };
    item.ondragover = (event) => {
      if (dragIndex === null) return;
      event.preventDefault();
      item.classList.add('drop-target');
    };
    item.ondragleave = () => item.classList.remove('drop-target');
    item.ondrop = (event) => {
      event.preventDefault();
      if (dragIndex === null || dragIndex === index) return render();
      const [moved] = files.splice(dragIndex, 1);
      files.splice(index, 0, moved);
      dragIndex = null;
      clearResult();
      render();
    };
  }

  function addFiles(incoming: File[]) {
    if (busy()) return;
    const usable = incoming.filter(accepted);
    if (usable.length < incoming.length) say(t('app.wrongType'), 'error');
    else if (!multiple && usable.length > 1) say(t('app.oneFile'));
    else say('');
    if (!usable.length) return;
    files = multiple ? [...files, ...usable] : [usable[0]];
    clearResult();
    render();
    countPages();
    if (document.body.dataset.format === 'audio') void timeAudio();
  }

  /** Reads each audio file's length for the list, and says straight away if one can't be used. */
  async function timeAudio() {
    const { parseAudio, formatTime } = await import('./engine/audio');
    for (const file of files) {
      if (notes.has(file)) continue;
      try {
        notes.set(file, formatTime(parseAudio(new Uint8Array(await file.arrayBuffer())).duration, false));
      } catch (error) {
        fail(error);
      }
    }
    render();
  }

  function countPages() {
    counter?.terminate();
    counter = undefined;
    const file = files[0];
    if (!pages || !file || notes.has(file)) return;
    const current = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
    counter = current;
    const done = () => {
      current.terminate();
      if (counter === current) counter = undefined;
    };
    current.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      done();
      if (data.type !== 'count' || !data.pages) return;
      notes.set(file, `${data.pages} ${t(data.pages === 1 ? 'sum.page' : 'sum.pages')}`);
      render();
    };
    current.onerror = done;
    current.postMessage({ type: 'count', file } satisfies ToWorker);
  }

  function askPassword(file: number, attempt: number): Promise<string | null> {
    passwordTitle.textContent = files.length > 1 ? t('pw.titleFile', { file: files[file].name }) : t('pw.title');
    passwordHint.textContent =
      attempt > 1 ? t('pw.retry', { n: attempt }) : t('pw.hint');
    password.value = '';
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.onclose = () => {
        const value = dialog.returnValue === 'ok' ? password.value : null;
        password.value = '';
        resolve(value);
      };
    });
  }

  function stop() {
    worker?.terminate();
    worker = undefined;
    if (dialog?.open) dialog.close();
    render();
  }

  function finish(message: FromWorker) {
    stop();
    if (message.type === 'error') {
      const count = message.pages;
      if (message.code === 'BAD_RANGE' && count) say(t(count === 1 ? 'error.onePage' : 'error.pageCount', { count }), 'error');
      else say(errorText(message.code), 'error');
      return;
    }
    if (message.type !== 'done') return;
    const pageLabel = message.pageCount === 1 ? 'page' : 'pages';
    show(message.output, `${files[0].name.replace(/\.pdf$/i, '')}-${SUFFIX[op as Op]}.pdf`, `${message.pageCount} ${pageLabel}`);
    warnings.replaceChildren(
      ...message.warnings.map((code) => {
        const item = document.createElement('li');
        item.textContent = t(`warning.${code}`);
        return item;
      }),
    );
  }

  function show(blob: Blob, name: string, summary: string) {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    download.onclick = null;
    download.href = outputUrl;
    download.download = name;
    download.textContent = t('app.downloadExt', { ext: name.split('.').pop()!.toUpperCase() });
    say(t('app.done', { summary: localizeSummary(summary), size: formatSize(blob.size) }));
    preview?.remove();
    preview = undefined;
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    beforeUrl = undefined;
    if (blob.type.startsWith('audio/')) {
      // Listen before downloading.
      preview = Object.assign(new Audio(outputUrl), { controls: true, className: 'audio-preview' });
      result.prepend(preview);
    } else if (op === 'transcribe') {
      // Read the transcript before downloading it.
      const text = document.createElement('pre');
      text.className = 'transcript-preview';
      void blob.text().then((value) => (text.textContent = value));
      preview = text;
      result.prepend(preview);
    } else if (op === 'image-convert' && files.length === 1 && /\.(jpe?g|png|webp)$/i.test(name)) {
      // Compare the original and the result before downloading.
      beforeUrl = URL.createObjectURL(files[0]);
      preview = compareView(beforeUrl, outputUrl);
      result.prepend(preview);
    } else if (op === 'mermaid-image') {
      // See the diagram before downloading it.
      preview = Object.assign(new Image(), { src: outputUrl, alt: '', className: 'image-preview' });
      result.prepend(preview);
    }
    result.hidden = false;
    download.focus();
  }

  /** The original under the result, with a slider that moves the line between them (mouse, touch or arrow keys). */
  function compareView(before: string, after: string) {
    const view = document.createElement('figure');
    view.className = 'compare';
    const image = (src: string, className: string) => Object.assign(new Image(), { src, alt: '', className });
    const label = (text: string, className: string) => Object.assign(document.createElement('span'), { textContent: text, className });
    const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '100', value: '50', className: 'compare-range' });
    slider.setAttribute('aria-label', `${t('ws.before')} / ${t('ws.after')}`);
    const update = () => view.style.setProperty('--pos', `${slider.value}%`);
    slider.addEventListener('input', update);
    // Mouse and touch move the line to the pointer; the range input stays for the keyboard and screen readers.
    const follow = (event: PointerEvent) => {
      const box = view.getBoundingClientRect();
      slider.value = String(Math.round(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * 100));
      update();
    };
    let start: { x: number; y: number } | undefined;
    view.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      slider.focus({ preventScroll: true });
      view.setPointerCapture(event.pointerId);
      // A finger only moves the line once it slides sideways, so scrolling past the picture leaves it alone.
      start = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : undefined;
      if (!start) follow(event);
    });
    view.addEventListener('pointermove', (event) => {
      if (!view.hasPointerCapture(event.pointerId)) return;
      if (start && Math.abs(event.clientX - start.x) <= Math.abs(event.clientY - start.y) + 4) return;
      start = undefined;
      follow(event);
    });
    view.append(image(before, 'compare-before'), image(after, 'compare-after'), label(t('ws.before'), 'compare-label'), label(t('ws.after'), 'compare-label compare-label-after'), slider);
    return view;
  }

  /** Hands a prepared document to the browser's print dialog, where "Save as PDF" writes the file. */
  function printDocument(doc: Printable) {
    printFrame?.remove();
    printFrame = document.createElement('iframe');
    printFrame.className = 'print-frame';
    printFrame.title = doc.title;
    printFrame.srcdoc = doc.html;
    const frame = printFrame;
    frame.onload = () => frame.contentWindow?.print();
    document.body.append(frame);
    download.removeAttribute('download');
    download.href = '#';
    download.textContent = t('app.saveAsPdf');
    download.onclick = (event) => {
      event.preventDefault();
      frame.contentWindow?.print();
    };
    say(t('app.ready'));
    result.hidden = false;
  }

  // Local jobs can't be interrupted mid-way, so Cancel lets go of them and ignores their result.
  let localJob = 0;
  async function runLocal(job: LocalJob) {
    say(t('app.working'));
    startJob();
    localBusy = true;
    const id = ++localJob;
    render();
    try {
      const output = await job(files, options());
      if (id !== localJob) return;
      if ('html' in output) printDocument(output);
      else {
        show(output.blob, output.name, output.summary);
        warnings.replaceChildren(...(output.notes ?? []).map((key) => Object.assign(document.createElement('li'), { textContent: t(key as UiKey) })));
      }
    } catch (error) {
      if (id === localJob) fail(error);
    } finally {
      if (id === localJob) {
        localBusy = false;
        render();
      }
    }
  }

  function run() {
    if (busy()) return;
    clearResult();
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > inputBudget()) {
      say(t('app.tooBig', { size: formatSize(total), max: formatSize(inputBudget()) }), 'error');
      return;
    }
    const local = LOCAL[op];
    if (local) return void runLocal(local);
    if (newPassword && newPassword.value !== confirmPassword?.value) return say(errorText('PASSWORDS_DIFFER'), 'error');
    const job: Job = {
      op: op as Op,
      pages: pages?.value,
      angle: angle ? (Number(angle.value) as Job['angle']) : undefined,
      password: newPassword?.value,
    };
    worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = async ({ data }: MessageEvent<FromWorker>) => {
      if (data.type === 'progress') return progressLabel(data.fraction);
      if (data.type !== 'password') return finish(data);
      const answer = await askPassword(data.file, data.attempt);
      worker?.postMessage({ type: 'password', password: answer } satisfies ToWorker);
    };
    worker.onerror = () => {
      stop();
      say(errorText('ENGINE_FAILED'), 'error');
    };
    worker.postMessage({ type: 'run', job, files } satisfies ToWorker);
    say(t('app.working'));
    startJob();
    render();
  }

  input.onchange = () => {
    addFiles([...(input.files ?? [])]);
    input.value = '';
  };
  drop.ondragover = (event) => {
    event.preventDefault();
    drop.classList.add('dragging');
  };
  drop.ondragleave = () => drop.classList.remove('dragging');
  drop.ondrop = (event) => {
    event.preventDefault();
    drop.classList.remove('dragging');
    addFiles([...(event.dataTransfer?.files ?? [])]);
  };
  pages?.addEventListener('input', clearResult);
  angle?.addEventListener('change', clearResult);
  newPassword?.addEventListener('input', clearResult);
  optionsPanel.addEventListener('input', (event) => {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    // Range sliders show their value next to the label.
    if (field.type === 'range') field.previousElementSibling!.textContent = `${field.value}%`;
    clearResult();
    if (field === codeField) render();
  });
  // "Try this example" on the Mermaid pages: load the code into the editor, replacing any chosen file.
  document.querySelectorAll<HTMLButtonElement>('.example button').forEach((button) =>
    button.addEventListener('click', () => {
      if (!codeField) return;
      codeField.value = button.closest('.example')!.querySelector('pre')!.textContent!;
      files.splice(0);
      clearResult();
      render();
      codeField.scrollIntoView({ block: 'center', behavior: 'smooth' });
      codeField.focus({ preventScroll: true });
    }),
  );
  runButton.onclick = run;
  cancelButton.onclick = () => {
    localJob++;
    localBusy = false;
    stop();
    say(t('app.canceled'));
  };
  addEventListener('pagehide', () => {
    stop();
    counter?.terminate();
  });
  render();
}

setUpEffects();
setUpSearch();
const op = document.body.dataset.tool as ToolOp | '';
if (op) setUp(op);
// Offline use: keeps every opened page and the tools' code on the device (src/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
