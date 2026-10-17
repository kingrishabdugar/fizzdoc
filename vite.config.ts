/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin, type Rollup } from 'vite';
import { PAGES, SITE_LANGS, fileName, llms, llmsFor, llmsFull, notFoundPage, offlineText, renderPage, robots, sitemap } from './src/seo.ts';
import { SITE } from './src/site.ts';
import { ocrAssets } from './vite-plugins/ocr-assets.ts';
import { whisperAssets } from './vite-plugins/whisper-assets.ts';
import { ORT_WEBGPU, backgroundAssets } from './vite-plugins/background-assets.ts';

/**
 * The repo's star count, baked into the pages at build time so visitors' browsers never call GitHub.
 * GitHub's API rate-limits shared build machines (Cloudflare Pages), so two public mirrors back it up.
 */
async function fetchStars(): Promise<number | undefined> {
  const repo = new URL(SITE.repo).pathname.slice(1);
  const sources: [string, (json: any) => unknown, Record<string, string>?][] = [
    [`https://api.github.com/repos/${repo}`, (j) => j.stargazers_count, process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}],
    [`https://ungh.cc/repos/${repo}`, (j) => j.repo?.stars],
    [`https://img.shields.io/github/stars/${repo}.json`, (j) => Number(j.value)],
  ];
  for (const [url, pick, headers] of sources) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'fizzdoc-build', ...headers }, signal: AbortSignal.timeout(5000) });
      const stars = response.ok ? pick(await response.json()) : undefined;
      if (typeof stars === 'number' && Number.isInteger(stars) && stars >= 0) return stars;
      console.warn(`star count: ${url} answered ${response.status}`);
    } catch {
      console.warn(`star count: ${url} unreachable`);
    }
  }
  return undefined; // offline build: the buttons simply show no count
}

/** Serves each tool page in dev and writes one prerendered HTML file per page at build. */
function pages(): Plugin {
  let build = false;
  let stars: number | undefined;
  return {
    name: 'fizzdoc-pages',
    enforce: 'post',
    async configResolved(config) {
      build = config.command === 'build';
      stars = await fetchStars();
    },
    transformIndexHtml(html, ctx) {
      if (build) return html; // rendered per page in generateBundle, once asset tags are injected
      const path = new URL(ctx.originalUrl ?? '/', 'http://localhost').pathname;
      return renderPage(html, PAGES.find((p) => p.path === path) ?? PAGES[0], false, stars);
    },
    generateBundle(_, bundle) {
      const index = bundle['index.html'];
      if (index?.type !== 'asset') throw new Error('index.html missing from bundle');
      const template = String(index.source);
      for (const page of PAGES) {
        const source = renderPage(template, page, true, stars);
        if (page.path === '/') index.source = source;
        else this.emitFile({ type: 'asset', fileName: fileName(page), source });
      }
      // Cloudflare Pages answers unknown paths with this page and a real 404 status.
      this.emitFile({ type: 'asset', fileName: '404.html', source: notFoundPage(template, stars) });
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(today) });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() });
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llms() });
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: llmsFull() });
      for (const lang of SITE_LANGS.filter((l) => l !== 'en')) this.emitFile({ type: 'asset', fileName: `${lang}/llms.txt`, source: llmsFor(lang) });
    },
  };
}

const sizeOf = (item: Rollup.OutputAsset | Rollup.OutputChunk) =>
  item.type === 'asset' ? (typeof item.source === 'string' ? Buffer.byteLength(item.source) : item.source.length) : Buffer.byteLength(item.code);

/** Static hosts refuse files over 25 MiB (Cloudflare Pages); fail the build here instead of at deploy. */
function sizeGuard(): Plugin {
  const LIMIT = 25 * 1024 * 1024;
  return {
    name: 'fizzdoc-size-guard',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const [name, item] of Object.entries(bundle)) {
        const size = sizeOf(item);
        if (size > LIMIT) this.error(`${name} is ${(size / 1048576).toFixed(1)} MiB; static hosts accept at most 25 MiB per file. Split it into parts.`);
      }
    },
  };
}

/**
 * Writes /sw.js (src/sw.js) with the list of files it keeps on the device for offline use: the code of
 * every tool and theme.js. Files over 5 MB are left out: the ONNX runtime is only used by Audio to Text and
 * Remove Background, which keep their runtimes and models in their own caches.
 */
function serviceWorker(): Plugin {
  return {
    name: 'fizzdoc-service-worker',
    enforce: 'post',
    generateBundle(_, bundle) {
      // theme.js runs before every page paints, so it must be there offline too.
      const assets = ['/theme.js', ...Object.values(bundle)
        .filter((item) => item.fileName.startsWith('assets/') && sizeOf(item) <= 5 * 1024 * 1024)
        .map((item) => `/${item.fileName}`)
        .sort()];
      const source = readFileSync('src/sw.js', 'utf8').replace('[/* ASSETS */]', JSON.stringify(assets)).replace('{/* OFFLINE */}', JSON.stringify(offlineText()));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [pages(), ocrAssets(), whisperAssets(), backgroundAssets(), serviceWorker(), sizeGuard()],
  // Audio to Text runs Whisper on ONNX Runtime's CPU build; its WebGPU build is too big to host.
  // Remove Background imports the real WebGPU build by its own name, 'ort-webgpu'.
  resolve: { alias: { 'onnxruntime-web/webgpu': 'onnxruntime-web/wasm', 'ort-webgpu': ORT_WEBGPU } },
  worker: { format: 'es' },
  // Fonts are always files: the CSP (default-src 'self') rightly refuses fonts from data: URLs.
  build: { target: 'es2022', assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
  test: { include: ['tests/**/*.test.ts'] },
});
