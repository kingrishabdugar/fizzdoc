// Fizzdoc's PDF and audio engines as plain functions over local files. This is what the MCP server
// exposes; it has no MCP code of its own so it can be tested directly. Nothing here uses the
// network: files are read from disk, processed in memory and written back as new files.
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { File as NodeFile } from 'node:buffer';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { AudioError, extension, formatTime, framesBetween, parseAudio, parseTime, write, type Track } from '../../src/engine/audio';
import { LocalError, cleanOffice as cleanOfficeEngine } from '../../src/engine/local';
import { PdfError, countPages, runJob, type Job, type Qpdf } from '../../src/engine/pdf';
import { UI, type UiKey } from '../../src/i18n';

export interface Result {
  /** Files written, in order. */
  written: string[];
  /** One line describing the result, e.g. "3 files merged into 12 pages". */
  summary: string;
  /** Anything the output does not carry over from the input. */
  notes: string[];
}

/** A problem the user can fix: a wrong password, a bad page range, a missing file. */
export class ToolError extends Error {}

const wasm = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm');

// The package's types omit Emscripten's print hooks and FS.writeFile, which it does support.
type Engine = Qpdf & { FS: Qpdf['FS'] & { writeFile(path: string, data: Uint8Array): void } };
const quiet = () => {}; // qpdf's own stderr lines; errors reach the user as plain messages instead
const engine = () => (createQpdf as unknown as (options: object) => Promise<Engine>)({ locateFile: () => wasm, print: quiet, printErr: quiet });
const ui = (key: string) => UI[key as UiKey] ?? key;

/** Plain-English message for any error a tool can throw. */
export function describe(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  if (error instanceof PdfError) {
    const text = ui(`error.${error.code}`);
    return error.code === 'BAD_RANGE' && error.pages ? `${text} This PDF has ${error.pages} pages.` : text;
  }
  if (error instanceof AudioError) return ui(`error.${error.code}`).replace('{detail}', error.detail);
  if (error instanceof LocalError) {
    return error.code === 'NOT_OFFICE'
      ? 'This is not an Office file (.docx, .xlsx or .pptx).'
      : `Could not process the Office file (${error.code}).`;
  }
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

async function input(path: string) {
  const full = resolve(path);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw new ToolError(`File not found: ${full}`);
  return full;
}

const stem = (path: string) => basename(path, extname(path));

/** The requested path, or one next to the input; never an existing file ("a (2).pdf" instead). */
function target(requested: string | undefined, next: string, name: string) {
  const path = requested ? resolve(requested) : join(dirname(next), name);
  if (!existsSync(path)) return path;
  const ext = extname(path);
  for (let i = 2; ; i++) {
    const candidate = `${path.slice(0, path.length - ext.length)} (${i})${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
}

async function save(path: string, bytes: Uint8Array | Blob) {
  const data = bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes;
  await writeFile(path, data, { flag: 'wx' }); // wx: fail rather than overwrite, even in a race
  return path;
}

// ---------------------------------------------------------------------------------------------
// PDF (qpdf compiled to WebAssembly: lossless, keeps forms, links and bookmarks)
// ---------------------------------------------------------------------------------------------

/** Runs one job on a fresh engine, so no file or password outlives the call. */
async function pdfJob(files: string[], job: Job, passwords: (string | undefined)[] = []) {
  const q = await engine();
  const paths: string[] = [];
  for (const [i, file] of files.entries()) {
    q.FS.writeFile(`/in${i}.pdf`, await readFile(file));
    paths.push(`/in${i}.pdf`);
  }
  // The password given is tried once; a second request means it was wrong.
  return runJob(q, paths, job, async (file, attempt) => {
    if (attempt > 1) throw new PdfError('BAD_PASSWORD');
    return passwords[file] ?? null;
  });
}

const pdfNotes = (warnings: string[]) => warnings.map((w) => ui(`warning.${w}`));
const pages = (n: number) => `${n} page${n === 1 ? '' : 's'}`;

async function onePdf(file: string, job: Job, suffix: string, output?: string, password?: string): Promise<Result> {
  const path = await input(file);
  const result = await pdfJob([path], job, [password]);
  const written = await save(target(output, path, `${stem(path)}-${suffix}.pdf`), result.output);
  return { written: [written], summary: `Saved ${pages(result.pageCount)}`, notes: pdfNotes(result.warnings) };
}

export async function pdfInfo(file: string) {
  const path = await input(file);
  const q = await engine();
  q.FS.writeFile('/in.pdf', await readFile(path));
  const count = await countPages(q, '/in.pdf');
  return {
    file: path,
    bytes: (await stat(path)).size,
    pages: count,
    note: count === null ? 'The page count needs the password (or the file is not a valid PDF).' : undefined,
  };
}

export async function mergePdf(files: string[], output?: string, passwords?: string[]): Promise<Result> {
  if (files.length < 2) throw new ToolError('Give at least two PDF files to merge.');
  const paths = await Promise.all(files.map(input));
  const result = await pdfJob(paths, { op: 'merge' }, passwords);
  const written = await save(target(output, paths[0], `${stem(paths[0])}-merged.pdf`), result.output);
  return { written: [written], summary: `${paths.length} files merged into ${pages(result.pageCount)}`, notes: pdfNotes(result.warnings) };
}

/** Keeps the listed pages in the order given: "1-3, 8" or, to reorder, "3, 1-2, 4-". */
export const extractPdfPages = (file: string, range: string, output?: string, password?: string) =>
  onePdf(file, { op: 'split', pages: range }, 'pages', output, password);

export const reorderPdfPages = (file: string, order: string, output?: string, password?: string) =>
  onePdf(file, { op: 'split', pages: order }, 'reordered', output, password);

export const deletePdfPages = (file: string, range: string, output?: string, password?: string) =>
  onePdf(file, { op: 'delete', pages: range }, 'trimmed', output, password);

export function rotatePdf(file: string, angle: 90 | 180 | 270, range?: string, output?: string, password?: string) {
  return onePdf(file, { op: 'rotate', angle, pages: range }, 'rotated', output, password);
}

export const protectPdf = (file: string, newPassword: string, output?: string, password?: string) =>
  onePdf(file, { op: 'protect', password: newPassword }, 'protected', output, password);

export const unlockPdf = (file: string, password: string, output?: string) => onePdf(file, { op: 'unlock' }, 'unlocked', output, password);

export const removePdfMetadata = (file: string, output?: string, password?: string) =>
  onePdf(file, { op: 'clean' }, 'clean', output, password);

/** Splits into several files: one per range ("1-3", "4-9"), or every N pages. */
export async function splitPdf(
  file: string,
  split: { ranges?: string[]; every?: number },
  outputDir?: string,
  password?: string,
): Promise<Result> {
  const path = await input(file);
  let ranges = split.ranges?.map((r) => r.trim()).filter(Boolean) ?? [];
  if (split.every !== undefined) {
    if (!Number.isInteger(split.every) || split.every < 1) throw new ToolError('"every" must be a whole number of pages, 1 or more.');
    // A metadata-only pass is the cheapest job that opens the file (with its password) and counts pages.
    const total = (await pdfJob([path], { op: 'clean' }, [password])).pageCount;
    ranges = [];
    for (let start = 1; start <= total; start += split.every) ranges.push(`${start}-${Math.min(start + split.every - 1, total)}`);
  }
  if (!ranges.length) throw new ToolError('Give page ranges such as ["1-3", "4-9"], or "every" to split every N pages.');
  const dir = outputDir ? resolve(outputDir) : dirname(path);
  const written: string[] = [];
  const notes = new Set<string>();
  for (const [i, range] of ranges.entries()) {
    const result = await pdfJob([path], { op: 'split', pages: range }, [password]);
    pdfNotes(result.warnings).forEach((n) => notes.add(n));
    written.push(await save(target(undefined, join(dir, 'x'), `${stem(path)}-part${i + 1}.pdf`), result.output));
  }
  return { written, summary: `Split into ${written.length} files`, notes: [...notes] };
}

// ---------------------------------------------------------------------------------------------
// Audio (MP3 cut at frame boundaries, M4A re-packaged: nothing is re-encoded)
// ---------------------------------------------------------------------------------------------

async function track(file: string): Promise<[string, Track]> {
  const path = await input(file);
  return [path, parseAudio(new Uint8Array(await readFile(path)))];
}

/** Seconds from "1:05.5", "90" or a number. */
function seconds(value: string | number, name: string) {
  const s = typeof value === 'number' ? value : parseTime(value);
  if (!Number.isFinite(s) || s < 0) throw new ToolError(`${name} must be a time like "1:30", "90" or "1:02:03.5".`);
  return s;
}

const audioNote = 'Tags such as title, artist and cover art are not copied to the new file.';

export async function audioInfo(file: string) {
  const [path, t] = await track(file);
  return { file: path, format: t.kind, duration: formatTime(t.duration), seconds: Number(t.duration.toFixed(3)), sampleRate: t.sampleRate, channels: t.channels };
}

export async function trimAudio(file: string, start: string | number, end: string | number | undefined, output?: string): Promise<Result> {
  const [path, t] = await track(file);
  const from = seconds(start, 'start');
  const to = end === undefined || end === '' ? t.duration : Math.min(seconds(end, 'end'), t.duration);
  if (from >= to) throw new ToolError(`The start must be before the end (the track is ${formatTime(t.duration)} long).`);
  const blob = write([{ track: t, frames: framesBetween(t, from, to) }]);
  const written = await save(target(output, path, `${stem(path)}-trimmed.${extension(t)}`), blob);
  return { written: [written], summary: `Kept ${formatTime(from)}–${formatTime(to)}`, notes: [audioNote] };
}

/** Cuts at each time given: two cut points make three parts. */
export async function splitAudio(file: string, at: (string | number)[], outputDir?: string): Promise<Result> {
  const [path, t] = await track(file);
  const cuts = [...new Set(at.map((v) => seconds(v, 'Each cut point')))].filter((s) => s > 0 && s < t.duration).sort((a, b) => a - b);
  if (!cuts.length) throw new ToolError(`Give at least one cut point inside the track (it is ${formatTime(t.duration)} long).`);
  const bounds = [0, ...cuts, t.duration];
  const dir = outputDir ? resolve(outputDir) : dirname(path);
  const written: string[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const blob = write([{ track: t, frames: framesBetween(t, bounds[i], bounds[i + 1]) }]);
    written.push(await save(target(undefined, join(dir, 'x'), `${stem(path)}-part${i + 1}.${extension(t)}`), blob));
  }
  return { written, summary: `Split into ${written.length} parts`, notes: [audioNote] };
}

export async function mergeAudio(files: string[], output?: string): Promise<Result> {
  if (files.length < 2) throw new ToolError('Give at least two MP3 or M4A files to join.');
  const tracks = await Promise.all(files.map(track));
  const blob = write(tracks.map(([, t]) => ({ track: t, frames: t.frames })));
  const [first, t] = tracks[0];
  const total = tracks.reduce((sum, [, x]) => sum + x.duration, 0);
  const written = await save(target(output, first, `${stem(first)}-merged.${extension(t)}`), blob);
  return { written: [written], summary: `${tracks.length} files joined · ${formatTime(total, false)}`, notes: [audioNote] };
}

// ---------------------------------------------------------------------------------------------
// Office (ZIP packages; metadata removal touches only docProps/*.xml, so content is untouched)
// ---------------------------------------------------------------------------------------------

const OFFICE_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Saves a copy of a .docx, .xlsx or .pptx without author, editor, company, title or thumbnail. */
export async function cleanOffice(file: string, output?: string): Promise<Result> {
  const path = await input(file);
  const name = basename(path);
  const type = OFFICE_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  // Node's File and the DOM File the engine was written for have the same shape; cast across.
  type EngineFile = Parameters<typeof cleanOfficeEngine>[0];
  const fileObj = new NodeFile([await readFile(path)], name, { type }) as unknown as EngineFile;
  const result = await cleanOfficeEngine(fileObj);
  const written = await save(target(output, path, result.name), result.blob);
  return { written: [written], summary: result.summary, notes: [] };
}
