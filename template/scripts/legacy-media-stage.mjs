#!/usr/bin/env node
/**
 * Find the uploads the BUILT pages use, and stage exactly those (build.md §5b).
 *
 *   node --experimental-strip-types scripts/legacy-media-stage.mjs [assetsDir]
 *   npm run legacy:stage
 *
 * Runs after `astro build`. The used set comes from the rendered output, not from the media
 * library: every `/wp-content/uploads/…` reference in the built HTML, CSS, JSON, XML and text
 * (`src`, `srcset`, `og:image`, JSON-LD, CSS `url()`, search indexes). A WordPress library is
 * typically 3–5× the used set once every `-WxH` size variant is counted.
 *
 * Reads   media/source/legacy/wp-content/uploads/   the originals, outside Git and outside
 *                                                   public/ (Astro would copy them into dist)
 *         recon/media.csv                           optional: a `sha256` per `source_url`/`local_path`
 * Writes  .aw/legacy-src/wp-content/uploads/        HARD LINKS to the used originals (no copy)
 *         .aw/legacy-used.json                      { paths, missing, references }
 *
 * A reference resolves to the file it names, or, when a `-WxH`/`-scaled` variant was never
 * downloaded, to the original it stands for. A reference that resolves to nothing, or an
 * original whose bytes differ from the inventory's hash, FAILS the build:
 * LEGACY_MEDIA_ALLOW_MISSING=1 downgrades it to a warning while downloads continue.
 * The free-disk guard runs first (lib/legacy-media.mjs).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readMigrationManifest } from './lib/aw-migration.mjs';
import { LEGACY_ORIGINALS, LEGACY_STAGE, TEXT_FILE, UPLOADS, USED_LIST, assetsDirectory, guardDisk, ownHosts, uploadTokenRegex, walk } from './lib/legacy-media.mjs';
import { uploadCandidates } from '../src/lib/upload-fallback.ts';

const assetsDir = process.argv[2] ?? assetsDirectory();
if (!existsSync(assetsDir)) {
  console.error(`✗ legacy-media-stage: ${assetsDir} does not exist; run the build first.`);
  process.exit(1);
}
const originals = join(LEGACY_ORIGINALS, UPLOADS);
const originalsLabel = `${LEGACY_ORIGINALS}/${UPLOADS}`; // forward slashes in messages on every platform
if (!existsSync(originals)) {
  console.error(`✗ legacy-media-stage: ${originalsLabel} is missing.\n  Put the downloaded originals there (path = the old URL path); they stay out of Git.`);
  process.exit(1);
}
await guardDisk(assetsDir, 'legacy-media-stage');

const manifest = readMigrationManifest();
const token = uploadTokenRegex(ownHosts(manifest));

// Every referenced upload path, decoded, with how many places name it.
const referenced = new Map();
const skip = new Set([join(assetsDir, 'wp-content')]);
for (const file of walk(assetsDir, skip)) {
  if (!TEXT_FILE.test(file)) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(token)) {
    let path;
    try { path = decodeURIComponent(m[2]); } catch { continue; }
    referenced.set(path, (referenced.get(path) ?? 0) + 1);
  }
}

// Optional integrity: a sha256 per downloaded file, from the media inventory.
const hashes = new Map();
const inventory = manifest?.inventories?.media;
if (typeof inventory === 'string' && existsSync(inventory)) {
  const [head, ...rows] = readFileSync(inventory, 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = head.replace(/^\uFEFF/, '').split(',').map((c) => c.replace(/^"|"$/g, '').trim().toLowerCase());
  const at = { url: cols.indexOf('source_url'), sha: cols.indexOf('sha256') };
  if (at.url >= 0 && at.sha >= 0) {
    for (const row of rows) {
      const cells = row.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      let path;
      try { path = decodeURIComponent(new URL(cells[at.url]).pathname); } catch { continue; }
      if (cells[at.sha]) hashes.set(path, cells[at.sha].toLowerCase());
    }
  }
}

const isFile = (c) => existsSync(join(LEGACY_ORIGINALS, c)) && statSync(join(LEGACY_ORIGINALS, c)).isFile();
/* The original a reference stands for. Pages already rewritten by rewrite-webp-refs name
   `<stem>.webp`: the original is the PNG/JPG with that stem, so staging a finished dist again
   gives the same set instead of a wall of "missing". */
const original = (path) => {
  for (const c of uploadCandidates(path)) {
    if (isFile(c)) return c;
    if (/\.webp$/i.test(c)) {
      const source = ['png', 'jpg', 'jpeg', 'PNG', 'JPG', 'JPEG'].map((ext) => c.replace(/\.webp$/i, `.${ext}`)).find(isFile);
      if (source) return source;
    }
  }
  return undefined;
};

const used = new Set();
const missing = [];
const corrupt = [];
for (const path of [...referenced.keys()].sort()) {
  const hit = original(path);
  if (!hit) { missing.push(path); continue; }
  const want = hashes.get(hit);
  if (want && createHash('sha256').update(readFileSync(join(LEGACY_ORIGINALS, hit))).digest('hex') !== want) { corrupt.push(hit); continue; }
  used.add(hit);
}

// Stage hard links; fall back to a copy only if the filesystem refuses links.
let linked = 0, copied = 0;
for (const path of used) {
  const from = join(LEGACY_ORIGINALS, path);
  const to = join(LEGACY_STAGE, path);
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) {
    if (statSync(to).ino === statSync(from).ino) continue;
    rmSync(to);
  }
  try { linkSync(from, to); linked += 1; } catch { copyFileSync(from, to); copied += 1; }
}
// A link for an upload no page uses any more would keep the deploy's file count dishonest.
let swept = 0;
(function sweep(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sweep(p);
    // Windows paths use backslashes; the used set is URL paths.
    else if (!used.has(`/${p.slice(LEGACY_STAGE.length + 1).replace(/\\/g, '/')}`)) { rmSync(p); swept += 1; }
  }
})(join(LEGACY_STAGE, UPLOADS));

mkdirSync(dirname(USED_LIST), { recursive: true });
writeFileSync(USED_LIST, `${JSON.stringify({ paths: [...used].sort(), missing, references: referenced.size })}\n`);

const problems = [
  ...missing.map((p) => `${p}: referenced by a page, no such original in ${originalsLabel}`),
  ...corrupt.map((p) => `${p}: bytes differ from the sha256 in ${inventory}`),
];
console.log(`${problems.length ? '✗' : '✓'} legacy-media-stage: ${referenced.size} referenced upload paths → ${used.size} original files used (${linked} hard-linked${copied ? `, ${copied} COPIED` : ''}, ${swept} stale removed); ${missing.length} missing, ${corrupt.length} altered`);
if (problems.length) {
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  if (process.env.LEGACY_MEDIA_ALLOW_MISSING === '1') console.warn('  LEGACY_MEDIA_ALLOW_MISSING=1: continuing. Not acceptable for a production build.');
  else process.exit(1);
}
