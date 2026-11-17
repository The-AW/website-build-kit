#!/usr/bin/env node
/**
 * After the build: point every reference at the WebP that is actually deployed, make the
 * markup honest about it, and FAIL if anything points at a file that is not there
 * (build.md §5b).
 *
 *   node --experimental-strip-types scripts/rewrite-webp-refs.mjs [assetsDir]
 *   npm run legacy:rewrite
 *
 * Reads  .aw/webp-manifest.json   original → { webp, w, h }   (webp-legacy-media)
 *        .aw/legacy-used.json     the used originals           (legacy-media-stage)
 * Edits  every .html .css .json .xml .txt .webmanifest in the assets directory, in place:
 *
 *  1. URL tokens: `/wp-content/uploads/<name>.png|jpg|jpeg` (relative, or on the site's own
 *     hosts from aw-migration.json: `<img src>`, srcset, og:image, twitter:image, JSON-LD, CSS
 *     url(), search indexes) becomes `<name>.webp`. A size variant that is not itself a used
 *     file (`name-300x200.png`) goes straight to its hosted original's WebP, saving the 301.
 *     Favicon/touch-icon PNGs, which stay PNG, are left alone.
 *  2. <img>: srcset is rebuilt from files that exist, with their real widths (a single
 *     candidate drops srcset and sizes); `height` follows the deployed file's aspect ratio at
 *     the unchanged `width`, so nothing shifts when the image arrives.
 *  3. Above the fold: the first upload image inside <main> (the first product or featured
 *     image) is not lazy and gets fetchpriority=high. Everything below stays lazy. A page
 *     whose first screen is a CSS background (the home hero) preloads it instead, because a
 *     background cannot carry fetchpriority.
 *
 * Then verifies, and exits non-zero if either fails:
 *  - no reference to a PNG/JPG upload remains that is not deployed as WebP (or kept as it is);
 *  - EVERY upload reference left in the output, of any type, is a file in the assets directory.
 *    Run it after link-legacy-media, so the deployed files are there to be found.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationManifest } from './lib/aw-migration.mjs';
import { USED_LIST, WEBP_MANIFEST, assetsDirectory, ownHosts, uploadTokenRegex } from './lib/legacy-media.mjs';
import { isConverted, uploadCandidates } from '../src/lib/upload-fallback.ts';

const assetsDir = process.argv[2] ?? assetsDirectory();
if (!existsSync(WEBP_MANIFEST) || !existsSync(USED_LIST)) {
  console.error(`✗ rewrite-webp-refs: ${WEBP_MANIFEST} or ${USED_LIST} is missing; run legacy-media-stage and webp-legacy-media first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(WEBP_MANIFEST, 'utf8'));
const used = new Set(JSON.parse(readFileSync(USED_LIST, 'utf8')).paths);
const byWebp = new Map(Object.values(manifest).map((m) => [m.webp, m]));

const hosts = ownHosts(readMigrationManifest());
const TOKEN = uploadTokenRegex(hosts, 'png|jpe?g');

const stats = { files: 0, urls: 0, variants: 0, imgs: 0, srcsetDropped: 0, srcsetKept: 0, heights: 0, eager: 0, preloads: 0, left: new Map() };

function resolve(rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  const hit = uploadCandidates(decoded).find((c) => used.has(c));
  if (!hit) return null;
  const entry = manifest[hit];
  if (!entry) return null; // deployed as it is (the icons)
  return { entry, exact: hit === decoded };
}

function rewriteUrls(text) {
  return text.replace(TOKEN, (whole, host, rawPath) => {
    const r = resolve(rawPath);
    if (!r) { stats.left.set(rawPath, (stats.left.get(rawPath) ?? 0) + 1); return whole; }
    stats.urls += 1;
    if (r.exact) return `${host}${rawPath.replace(/\.(?:png|jpe?g)$/i, '.webp')}`;
    stats.variants += 1;
    return `${host}${encodeURI(r.entry.webp)}`;
  });
}

const attr = (tag, name) => new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i').exec(tag)?.[2];
const setAttr = (tag, name, value) => {
  const re = new RegExp(`(\\s${name}=)(["']).*?\\2`, 'i');
  return re.test(tag) ? tag.replace(re, `$1"${value}"`) : tag.replace(/\s*\/?>$/, ` ${name}="${value}"$&`);
};
const dropAttr = (tag, name) => tag.replace(new RegExp(`\\s${name}=(["']).*?\\1`, 'i'), '');
const pathOf = (url) => { try { return decodeURIComponent(url.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0]); } catch { return ''; } };

function fixImg(tag) {
  const src = attr(tag, 'src');
  const entry = src && byWebp.get(pathOf(src));
  if (!entry) return tag;
  stats.imgs += 1;
  let out = tag;
  // srcset from files that exist, with their real widths.
  const set = attr(out, 'srcset');
  if (set) {
    const candidates = new Map([[entry.webp, entry.w]]);
    for (const part of set.split(',')) {
      const e = byWebp.get(pathOf(part.trim().split(/\s+/)[0]));
      if (e) candidates.set(e.webp, e.w);
    }
    if (candidates.size > 1) {
      const list = [...candidates].sort((a, b) => a[1] - b[1]).map(([p, w]) => `${encodeURI(p)} ${w}w`).join(', ');
      out = setAttr(out, 'srcset', list);
      stats.srcsetKept += 1;
    } else {
      out = dropAttr(dropAttr(out, 'srcset'), 'sizes');
      stats.srcsetDropped += 1;
    }
  } else {
    out = dropAttr(out, 'sizes');
  }
  // Same displayed width, the deployed file's aspect ratio.
  const w = Number(attr(out, 'width'));
  if (w > 0) {
    const h = Math.max(1, Math.round((w * entry.h) / entry.w));
    if (Number(attr(out, 'height')) !== h) { out = setAttr(out, 'height', String(h)); stats.heights += 1; }
  }
  return out;
}

function aboveTheFold(html) {
  let out = html;
  const main = out.search(/<main\b|<div[^>]*\bid="content"/i);
  if (main < 0) return out;
  const rest = out.slice(main);
  const m = /<img\b[^>]*>/i.exec(rest);
  if (!m || !/\/wp-content\/uploads\//.test(m[0])) return out;
  let tag = dropAttr(m[0], 'loading');
  tag = setAttr(dropAttr(tag, 'fetchpriority'), 'fetchpriority', 'high');
  stats.eager += 1;
  return out.slice(0, main) + rest.slice(0, m.index) + tag + rest.slice(m.index + m[0].length);
}

// A CSS background cannot carry fetchpriority: a page whose first screen is a background
// image (the home hero, `background-size: cover`) preloads it instead.
function preloadHero(html) {
  const css = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const block of html.matchAll(css)) {
    const bg = /background-image:url\((\/wp-content\/uploads\/[^)"']+\.webp)\)/.exec(block[1]);
    if (!bg) continue;
    const at = html.search(/<link\b[^>]*rel="stylesheet"/i);
    if (at < 0) return html;
    stats.preloads += 1;
    return `${html.slice(0, at)}<link rel="preload" as="image" href="${bg[1]}" fetchpriority="high">${html.slice(at)}`;
  }
  return html;
}

function processHtml(text, isHome) {
  let out = rewriteUrls(text);
  out = out.replace(/<img\b[^>]*>/gi, fixImg);
  out = aboveTheFold(out);
  return isHome ? preloadHero(out) : out;
}

const SKIP_DIRS = new Set(['wp-content', 'fonts', 'img', 'cdn-cgi']);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
    else if (/\.(?:html|css|json|xml|txt|webmanifest)$/i.test(e.name)) files.push(p);
  }
})(assetsDir);

const problems = [];
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = file.endsWith('.html') ? processHtml(before, file === join(assetsDir, 'index.html')) : rewriteUrls(before);
  if (after !== before) writeFileSync(file, after);
  stats.files += 1;
  // Verify the result: every upload reference that is left, of any type, is a deployed file.
  for (const m of after.matchAll(uploadTokenRegex(hosts))) {
    let p; try { p = decodeURIComponent(m[2]); } catch { continue; }
    if (!existsSync(join(assetsDir, p))) problems.push(`${file}: references ${p}, which is not in ${assetsDir}`);
  }
}
for (const [p, n] of stats.left) {
  let d = p; try { d = decodeURIComponent(p); } catch { /* raw */ }
  if (isConverted(d) && !(used.has(d) && !manifest[d])) problems.push(`${p}: ${n} reference(s) to a PNG/JPG upload that is not deployed as WebP`);
}
if (problems.length) {
  console.error(`✗ rewrite-webp-refs: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 25)) console.error(`  ${p}`);
  process.exit(1);
}
const decoded = (p) => { try { return decodeURIComponent(p); } catch { return p; } };
const kept = [...stats.left.keys()].filter((p) => used.has(decoded(p)));
console.log(`✓ rewrite-webp-refs: ${stats.files} files scanned; ${stats.urls} URLs → .webp (${stats.variants} variant→original); ${stats.imgs} <img>: srcset dropped ${stats.srcsetDropped}, kept ${stats.srcsetKept}, height fixed ${stats.heights}; ${stats.eager} above-the-fold image(s) not lazy, ${stats.preloads} hero preload(s); ${new Set(kept).size} icon file(s) left as PNG`);
