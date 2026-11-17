#!/usr/bin/env node
/**
 * Measure the real rendered width of every uploaded image on the built site (build.md §5b).
 *
 *   node scripts/measure-image-widths.mjs [assetsDir] [--base=http://host:port] [--out=file.json] [--backgrounds]
 *   npm run legacy:widths
 *
 * Serves the built assets directory itself (or uses --base) and loads every built page in
 * headless Chrome at three viewports (390, 768, 1440 CSS px) with image downloads blocked, since
 * layout comes from CSS and the width/height attributes and needs no bandwidth. Records, per
 * `<img src>` under /wp-content/uploads/, the largest rendered width seen.
 * webp-legacy-media sizes each WebP at about 2× that.
 *
 * The output (src/data/image-render-widths.json) is COMMITTED DATA, not build output: re-run it
 * when page layout or content changes. It takes minutes on a large site (a 615-post migration:
 * 1,100 pages), so the build reads the committed file instead of re-measuring. Paths are the raw
 * `<img src>` paths, decoded. Resumable: a checkpoint file survives a crash or a sleeping laptop.
 *
 *   --backgrounds  second pass (run after the first; it merges into the same file): pages whose
 *                  CSS declares `background-image:url(/wp-content/uploads/…)` (a hero, category
 *                  tiles, `background-size: cover`). Records, per image, the larger of the
 *                  element's width and 1.5× its height, for the element and its ::before/::after.
 */
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';
import { WIDTHS_FILE, assetsDirectory, walk } from './lib/legacy-media.mjs';

const flags = new Map(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split(/=(.*)/s)));
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BACKGROUNDS = flags.has('backgrounds');
const assetsDir = positional[0] ?? assetsDirectory();
const out = flags.get('out') ?? WIDTHS_FILE;
if (!existsSync(assetsDir)) {
  console.error(`✗ measure-image-widths: ${assetsDir} does not exist; run the build first.`);
  process.exit(1);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.avif': 'image/avif' };
/* Images are blocked in the browser anyway; this only has to hand back pages, CSS and scripts. */
function serve(dir) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const base = normalize(join(dir, pathname));
      if (!base.startsWith(normalize(dir))) { res.writeHead(403).end(); return; }
      const file = [base, join(base, 'index.html'), `${base}.html`].find((f) => existsSync(f) && statSync(f).isFile());
      if (!file) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
const served = flags.get('base') ? null : await serve(assetsDir);
const base = (flags.get('base') ?? served.base).replace(/\/$/, '');

const SKIP = new Set(['wp-content', 'fonts', 'legacy', 'img', 'cdn-cgi', '_astro'].map((d) => join(assetsDir, d)));
const pages = [];
for (const file of walk(assetsDir, SKIP)) {
  if (!file.endsWith('index.html')) continue;
  const rel = file.slice(assetsDir.length, -'index.html'.length).replace(/\\/g, '/');
  pages.push(rel || '/');
}
pages.sort();
const crawl = BACKGROUNDS
  ? pages.filter((p) => readFileSync(join(assetsDir, p, 'index.html'), 'utf8').includes('background-image:url(/wp-content/uploads'))
  : pages;
if (BACKGROUNDS) console.log(`--backgrounds: ${crawl.length} page(s) declare upload backgrounds`);

const VIEWPORTS = [390, 768, 1440];
const STATE = `${out}.${BACKGROUNDS ? 'bg-' : ''}progress.json`; // checkpoint
const widths = BACKGROUNDS && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {}; // decoded src path → max rendered css px
const donePages = new Set();
if (existsSync(STATE)) {
  const st = JSON.parse(readFileSync(STATE, 'utf8'));
  Object.assign(widths, st.widths);
  for (const p of st.done) donePages.add(p);
  console.log(`resuming: ${donePages.size}/${crawl.length} pages already measured`);
}
const launch = () => puppeteer.launch({ headless: true, protocolTimeout: 120000, args: ['--no-sandbox'] });
let browser = await launch();
const save = () => writeFileSync(STATE, JSON.stringify({ widths, done: [...donePages] }));

async function measure(page, p) {
  const seen = {};
  for (const w of VIEWPORTS) {
    await page.setViewport({ width: w, height: 900 });
    await page.goto(`${base}${p}?nobadge=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const rows = BACKGROUNDS
      ? await page.evaluate(() => {
          const found = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (!r.width) continue;
            for (const pseudo of [null, '::before', '::after']) {
              const bg = getComputedStyle(el, pseudo).backgroundImage;
              for (const m of bg.matchAll(/url\("?([^")]+)"?\)/g)) found.push({ src: m[1], w: Math.max(r.width, r.height * 1.5) });
            }
          }
          return found;
        })
      : await page.evaluate(() => [...document.images].map((i) => ({ src: i.getAttribute('src') || '', w: i.getBoundingClientRect().width })));
    for (const { src, w: rw } of rows) {
      let path; try { path = decodeURIComponent(new URL(src, `${base}${p}`).pathname); } catch { continue; }
      if (path.startsWith('/wp-content/uploads/')) seen[path] = Math.max(seen[path] ?? 0, Math.ceil(rw));
    }
  }
  return seen; // merged only when all three viewports succeeded
}
async function newPage() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => (['image', 'media', 'font'].includes(r.resourceType()) ? r.abort() : r.continue()));
  return page;
}
const todo = crawl.filter((p) => !donePages.has(p));
let page = await newPage();
for (const [i, p] of todo.entries()) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const seen = await measure(page, p);
      for (const [path, w] of Object.entries(seen)) widths[path] = Math.max(widths[path] ?? 0, w);
      donePages.add(p);
      break;
    } catch (e) {
      console.error(`retry ${p} (${attempt}): ${String(e.message).slice(0, 80)}`);
      try { await browser.close(); } catch { /* already gone */ }
      browser = await launch();
      page = await newPage();
      if (attempt >= 3) throw e;
    }
  }
  if ((i + 1) % 50 === 0) { save(); console.log(`${donePages.size}/${crawl.length} pages`); }
}
await browser.close();
served?.server.close();
const sorted = Object.fromEntries(Object.entries(widths).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(out, `${JSON.stringify(sorted)}\n`);
rmSync(STATE, { force: true });
const vals = Object.values(sorted);
console.log(`✓ measure-image-widths: ${crawl.length} pages, ${vals.length} image paths; max rendered ${vals.length ? Math.max(...vals) : 0} px; zero-width ${vals.filter((v) => v === 0).length} → ${out}`);
