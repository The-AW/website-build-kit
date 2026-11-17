#!/usr/bin/env node
/**
 * Deploy every USED raster upload as ONE WebP (build.md §5b).
 *
 *   node --experimental-strip-types scripts/webp-legacy-media.mjs
 *   npm run legacy:webp
 *
 * Reads   .aw/legacy-src/wp-content/uploads/   the used originals (legacy-media-stage)
 *         .aw/legacy-used.json                 which they are
 *         src/data/image-render-widths.json    largest rendered width per <img src>, measured by
 *                                              measure-image-widths (committed data)
 * Writes  .aw/legacy-media/wp-content/uploads/ what is deployed (link-legacy-media puts it in dist)
 *         .aw/webp-cache/                      content-addressed WebP outputs
 *         .aw/webp-manifest.json               original path → { webp, w, h, bytes, srcBytes, srcW, rendered },
 *                                              read by rewrite-webp-refs
 *
 * Rules
 *  - PNG/JPG/JPEG become `<same path>.webp`: quality 78, alpha kept, metadata dropped, EXIF
 *    orientation applied. Width = about 2× the largest rendered width (CSS px), never more than
 *    1600, never an upscale. A file never measured (a link target, a social image, a CSS
 *    background) is sized by the 1600 cap alone.
 *  - GIF, SVG and anything already WebP/AVIF are deployed as they are. Favicon and
 *    apple-touch-icon PNGs stay PNG (iOS touch icons cannot be WebP).
 *  - Deterministic and idempotent: the cache key is the source's SHA-256, the target width,
 *    the quality and the libvips version; a repeat run converts nothing.
 *  - The originals are never modified.
 *
 * Measured on a 615-post migration: 9,521 used uploads, 2.9 GB → 99 MB.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { LEGACY_DEPLOY, LEGACY_STAGE, UPLOADS, USED_LIST, WEBP_CACHE, WEBP_MANIFEST, WIDTHS_FILE, guardDisk } from './lib/legacy-media.mjs';
import { deployedPath, isConverted, uploadCandidates } from '../src/lib/upload-fallback.ts';

export const QUALITY = 78;
export const CAP = 1600;       // widest WebP ever deployed
export const DPR = 2;          // sharp on 2x screens
export const MIN_WIDTH = 64;   // never a degenerate thumbnail
const KEEP_AS_IS = /\/cropped-[^/]*-(?:32x32|180x180|192x192|270x270)\.png$/i; // <link rel=icon|apple-touch-icon>

if (!existsSync(join(LEGACY_STAGE, UPLOADS)) || !existsSync(USED_LIST)) {
  console.error(`✗ webp-legacy-media: ${LEGACY_STAGE}/${UPLOADS} or ${USED_LIST} is missing; run scripts/legacy-media-stage.mjs first.`);
  process.exit(1);
}
await guardDisk(LEGACY_DEPLOY, 'webp-legacy-media');

const used = JSON.parse(readFileSync(USED_LIST, 'utf8')).paths;
const usedSet = new Set(used);
const rawWidths = existsSync(WIDTHS_FILE) ? JSON.parse(readFileSync(WIDTHS_FILE, 'utf8')) : {};

// Measured widths are keyed by the <img src> path; a src that is a size variant we do not
// host (…-300x200.png) stands for the hosted original it redirects to.
// The file may have been measured before the rewrite (a .png src) or after it (a .webp src).
const byDeployed = new Map(used.map((p) => [deployedPath(p), p]));
const widths = new Map();
for (const [path, w] of Object.entries(rawWidths)) {
  const candidates = uploadCandidates(path);
  const target = candidates.find((c) => usedSet.has(c)) ?? candidates.map((c) => byDeployed.get(c)).find(Boolean);
  if (target) widths.set(target, Math.max(widths.get(target) ?? 0, w));
}

function link(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) {
    if (statSync(to).ino === statSync(from).ino) return;
    rmSync(to);
  }
  try { linkSync(from, to); } catch { copyFileSync(from, to); }
}

const libvips = sharp.versions.vips ?? 'unknown';
const manifest = {};
const keep = new Set();
let tmpCounter = 0, converted = 0, cached = 0, kept = 0, srcBytes = 0, outBytes = 0, unmeasured = 0;

async function convert(path) {
  const bytes = readFileSync(join(LEGACY_STAGE, path));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const meta = await sharp(bytes).metadata();
  const swap = (meta.orientation ?? 1) >= 5; // 90/270 degree EXIF rotations swap the axes
  const natW = swap ? meta.height : meta.width;
  const rendered = widths.get(path) ?? 0;
  if (!rendered) unmeasured += 1;
  const target = rendered > 0 ? Math.min(CAP, Math.max(MIN_WIDTH, Math.ceil(rendered * DPR))) : CAP;
  const outW = Math.min(natW, target);
  const cacheFile = join(WEBP_CACHE, `${sha.slice(0, 24)}-${outW}-q${QUALITY}-v${libvips}.webp`);
  let info;
  if (existsSync(cacheFile)) {
    cached += 1;
    info = await sharp(cacheFile).metadata();
  } else {
    mkdirSync(WEBP_CACHE, { recursive: true });
    // Identical images at different paths share one cache file: a unique temp name per write.
    const tmp = `${cacheFile}.${process.pid}-${++tmpCounter}.tmp`;
    info = await sharp(bytes)
      .rotate()
      .resize({ width: outW, withoutEnlargement: true, kernel: 'lanczos3' })
      .webp({ quality: QUALITY, alphaQuality: 90, effort: 4, smartSubsample: true })
      .toFile(tmp);
    renameSync(tmp, cacheFile);
    converted += 1;
  }
  const dest = deployedPath(path);
  link(cacheFile, join(LEGACY_DEPLOY, dest));
  keep.add(dest);
  const size = statSync(cacheFile).size;
  manifest[path] = { webp: dest, w: info.width, h: info.height, bytes: size, srcBytes: bytes.length, srcW: natW, rendered };
  srcBytes += bytes.length;
  outBytes += size;
}

// A fixed-size worker pool; sharp threads libwebp internally as well.
const queue = [];
for (const path of used) {
  if (isConverted(path) && !KEEP_AS_IS.test(path)) queue.push(path);
  else {
    link(join(LEGACY_STAGE, path), join(LEGACY_DEPLOY, path));
    keep.add(path);
    kept += 1;
  }
}
let next = 0, done = 0;
async function lane() {
  while (next < queue.length) {
    const path = queue[next++];
    try { await convert(path); } catch (e) { console.error(`✗ webp-legacy-media: ${path}: ${e.message}`); process.exit(1); }
    if (++done % 1000 === 0) console.log(`  webp-legacy-media: ${done}/${queue.length}`);
  }
}
sharp.concurrency(2);
await Promise.all(Array.from({ length: 4 }, lane));

// Remove stale deployed files (an image no longer used keeps the file count honest).
(function sweep(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sweep(p);
    else if (!keep.has(`/${p.slice(LEGACY_DEPLOY.length + 1).replace(/\\/g, '/')}`)) rmSync(p); // URL paths, not Windows ones
  }
})(join(LEGACY_DEPLOY, UPLOADS));

mkdirSync(dirname(WEBP_MANIFEST), { recursive: true });
writeFileSync(WEBP_MANIFEST, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))))}\n`);
const mb = (n) => (n / 1048576).toFixed(1);
console.log(`✓ webp-legacy-media: ${queue.length} converted to WebP (${converted} new, ${cached} from cache), ${kept} deployed as they are; ${mb(srcBytes)} MB → ${mb(outBytes)} MB (${srcBytes ? ((1 - outBytes / srcBytes) * 100).toFixed(0) : 0}% smaller)`);
if (unmeasured) {
  console.log(Object.keys(rawWidths).length === 0
    ? `  ${unmeasured} image(s) have no measured width (${WIDTHS_FILE} is missing or empty) and are sized by the ${CAP}px cap. Run \`npm run legacy:widths\` against a build to size them from the page layout.`
    : `  ${unmeasured} image(s) were never measured (links, social images, backgrounds): sized by the ${CAP}px cap.`);
}
