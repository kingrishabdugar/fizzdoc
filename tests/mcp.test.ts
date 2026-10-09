// The MCP server end to end, over the real protocol: every tool runs on the fixtures and the files it
// writes are opened and checked, not just found.
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PDFDocument } from 'pdf-lib';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { STAR_NOTE, createServer } from '../mcp/src/server';
import { parseAudio } from '../src/engine/audio';

let dir: string;
let client: Client;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const at = (name: string) => join(dir, name);

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = result.content.map((c) => c.text).join('\n');
  return { text, isError: !!result.isError, saved: [...text.matchAll(/^Saved: (.+)$/gm)].map((m) => m[1]) };
}

const pdf = async (path: string) => PDFDocument.load(await readFile(path));
const widths = async (path: string) => (await pdf(path)).getPages().map((p) => Math.round(p.getWidth()));
const duration = async (path: string) => parseAudio(new Uint8Array(await readFile(path))).duration;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fizzdoc-mcp-'));
  for (const name of [
    'form.pdf',
    'links.pdf',
    'bookmarks.pdf',
    'user-password.pdf',
    'tone.mp3',
    'tone.m4a',
    'tone-48k.mp3',
    'report.docx',
  ]) {
    await copyFile(fixture(name), at(name));
  }
  // Pages 100, 200 and 300 points wide, so page order can be read back; plus an author to remove.
  const doc = await PDFDocument.create();
  for (const w of [100, 200, 300]) doc.addPage([w, 400]);
  doc.setAuthor('Alice Example');
  await writeFile(at('sized.pdf'), await doc.save());

  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe('fizzdoc MCP server', () => {
  it('lists every tool with a description and says nothing leaves the computer', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'audio_info',
        'clean_office',
        'delete_pdf_pages',
        'extract_pdf_pages',
        'merge_audio',
        'merge_pdf',
        'pdf_info',
        'protect_pdf',
        'remove_pdf_metadata',
        'reorder_pdf_pages',
        'rotate_pdf',
        'split_audio',
        'split_pdf',
        'trim_audio',
        'unlock_pdf',
      ].sort(),
    );
    for (const tool of tools) expect(tool.description!.length, tool.name).toBeGreaterThan(20);
    expect(client.getInstructions()).toContain('nothing is uploaded');
  });

  it('merges PDFs next to the first file and asks for a star once', async () => {
    const first = await call('merge_pdf', { files: [at('form.pdf'), at('links.pdf'), at('bookmarks.pdf')] });
    expect(first.isError).toBe(false);
    expect(first.saved).toEqual([at('form-merged.pdf')]);
    expect((await pdf(first.saved[0])).getPageCount()).toBe(9);
    expect(first.text).toContain(STAR_NOTE);

    // Never overwrites: the same job again gets a new name, and the star note isn't repeated.
    const again = await call('merge_pdf', { files: [at('form.pdf'), at('links.pdf')] });
    expect(again.saved).toEqual([at('form-merged (2).pdf')]);
    expect(again.text).not.toContain('star');
  });

  it('extracts, reorders and deletes pages in the order given', async () => {
    const extracted = await call('extract_pdf_pages', { file: at('sized.pdf'), pages: '3, 1' });
    expect(await widths(extracted.saved[0])).toEqual([300, 100]);
    const reordered = await call('reorder_pdf_pages', { file: at('sized.pdf'), order: '3, 1-' });
    expect(await widths(reordered.saved[0])).toEqual([300, 100, 200]);
    const trimmed = await call('delete_pdf_pages', { file: at('sized.pdf'), pages: '2', output: at('out/../trimmed.pdf') });
    expect(trimmed.saved).toEqual([at('trimmed.pdf')]);
    expect(await widths(trimmed.saved[0])).toEqual([100, 300]);
  });

  it('splits by ranges or every N pages', async () => {
    const byRange = await call('split_pdf', { file: at('sized.pdf'), ranges: ['1-2', '3'] });
    expect(await Promise.all(byRange.saved.map(widths))).toEqual([[100, 200], [300]]);
    const every = await call('split_pdf', { file: at('sized.pdf'), every: 1, output_dir: dir });
    expect(every.saved).toHaveLength(3);
    expect(await widths(every.saved[2])).toEqual([300]);
  });

  it('rotates chosen pages clockwise', async () => {
    const { saved } = await call('rotate_pdf', { file: at('sized.pdf'), angle: 90, pages: '2' });
    const rotations = (await pdf(saved[0])).getPages().map((p) => p.getRotation().angle);
    expect(rotations).toEqual([0, 90, 0]);
  });

  it('removes author and XMP metadata', async () => {
    const { saved } = await call('remove_pdf_metadata', { file: at('sized.pdf') });
    const doc = await pdf(saved[0]);
    expect(doc.getAuthor()).toBeUndefined();
    expect((await readFile(saved[0])).includes('Alice Example')).toBe(false);
  });

  it('protects and unlocks, and explains a wrong or missing password', async () => {
    const locked = await call('protect_pdf', { file: at('sized.pdf'), new_password: 'open sesame' });
    expect((await call('pdf_info', { file: locked.saved[0] })).text).toContain('"pages": null');

    const noPassword = await call('extract_pdf_pages', { file: locked.saved[0], pages: '1' });
    expect(noPassword.isError).toBe(true);
    expect(noPassword.text).toMatch(/password/i);
    const wrong = await call('unlock_pdf', { file: locked.saved[0], password: 'nope' });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/password/i);

    const unlocked = await call('unlock_pdf', { file: locked.saved[0], password: 'open sesame' });
    expect(await widths(unlocked.saved[0])).toEqual([100, 200, 300]);
    const fixtureUnlocked = await call('unlock_pdf', { file: at('user-password.pdf'), password: 'test-only' });
    expect((await pdf(fixtureUnlocked.saved[0])).getPageCount()).toBe(3);
  });

  it('reports bad input in plain words without writing anything', async () => {
    const range = await call('extract_pdf_pages', { file: at('sized.pdf'), pages: '7' });
    expect(range.isError).toBe(true);
    expect(range.text).toContain('This PDF has 3 pages.');
    const missing = await call('pdf_info', { file: at('nope.pdf') });
    expect(missing.text).toContain('File not found');
    const notPdf = await call('rotate_pdf', { file: at('tone.mp3'), angle: 180 });
    expect(notPdf.isError).toBe(true);
    expect(range.saved).toEqual([]);
  });

  it('trims and splits MP3 and M4A without re-encoding', async () => {
    const info = JSON.parse((await call('audio_info', { file: at('tone.mp3') })).text);
    expect(info.format).toBe('mp3');
    const full = info.seconds as number;

    const trimmed = await call('trim_audio', { file: at('tone.mp3'), start: '0:01', end: 3 });
    expect(await duration(trimmed.saved[0])).toBeCloseTo(2, 0);

    const parts = await call('split_audio', { file: at('tone.m4a'), at: ['1', '2.5'] });
    expect(parts.saved.map((p) => p.endsWith('.m4a'))).toEqual([true, true, true]);
    const lengths = await Promise.all(parts.saved.map(duration));
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(await duration(at('tone.m4a')), 1);
    expect(full).toBeGreaterThan(3);
  });

  it('joins audio files and refuses mismatched sample rates', async () => {
    const joined = await call('merge_audio', { files: [at('tone.mp3'), at('tone.mp3')] });
    expect(await duration(joined.saved[0])).toBeCloseTo(2 * (await duration(at('tone.mp3'))), 1);
    const mixed = await call('merge_audio', { files: [at('tone.mp3'), at('tone-48k.mp3')] });
    expect(mixed.isError).toBe(true);
    expect(mixed.text).toMatch(/different audio settings/);
    const bad = await call('trim_audio', { file: at('tone.mp3'), start: '5:00' });
    expect(bad.isError).toBe(true);
  });

  it('removes Office metadata and leaves the content in place', async () => {
    const src = at('report.docx');
    const entriesBefore = unzipSync(new Uint8Array(await readFile(src)));
    const coreBefore = strFromU8(entriesBefore['docProps/core.xml'] ?? new Uint8Array());
    expect(coreBefore).toMatch(/<dc:creator[^>]*>[^<]+<\/dc:creator>/);

    const { isError, saved } = await call('clean_office', { file: src });
    expect(isError).toBe(false);
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toBe(src);

    const entriesAfter = unzipSync(new Uint8Array(await readFile(saved[0])));
    const coreAfter = strFromU8(entriesAfter['docProps/core.xml'] ?? new Uint8Array());
    expect(coreAfter).not.toMatch(/<dc:creator[^>]*>[^<]+<\/dc:creator>/);
    expect(Object.keys(entriesAfter)).toContain('word/document.xml');
  });
});
