#!/usr/bin/env node
/**
 * The migrated-media contract holds on this build (build.md §5b, `media.legacyUploads`).
 *
 *   node scripts/check-legacy-media.mjs [assetsDir]
 *   npm run check:legacy-media
 *
 *  1. The built site has a prerendered 404 page (`404.html`). With `not_found_handling: "none"`
 *     the Worker serves it for unknown paths; with none there, an unknown URL has no body.
 *  2. Every attachment redirect (`src/data/attachment-redirects.json`, `{ "/slug/": "/target/" }`)
 *     resolves in ONE hop: its target is not itself a source in the map or in `public/_redirects`,
 *     is not itself, and is a route or file the build produced.
 *  3. `public/_headers` caches `/wp-content/uploads/*` as immutable. Filenames of uploads are a
 *     contract: replace a file under the same name and the cache will not notice for a year.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTACHMENTS_FILE, assetsDirectory } from './lib/legacy-media.mjs';

const dir = process.argv[2] ?? assetsDirectory();
const problems = [];
if (!existsSync(dir)) {
  console.error(`✗ check-legacy-media: ${dir} does not exist; run the build first.`);
  process.exit(1);
}

if (!existsSync(join(dir, '404.html'))) problems.push(`${dir}/404.html is missing: the Worker has no page to serve for an unknown URL.`);

const attachments = existsSync(ATTACHMENTS_FILE) ? JSON.parse(readFileSync(ATTACHMENTS_FILE, 'utf8')) : {};
const redirected = new Set();
if (existsSync('public/_redirects')) {
  for (const line of readFileSync('public/_redirects', 'utf8').split(/\r?\n/)) {
    if (line.trim() && !line.trim().startsWith('#')) redirected.add(line.trim().split(/\s+/)[0]);
  }
}
const exists = (route) => {
  const path = decodeURIComponent(route.split(/[?#]/)[0]);
  return existsSync(join(dir, path)) || existsSync(join(dir, path, 'index.html')) || existsSync(join(dir, `${path.replace(/\/$/, '')}.html`));
};
for (const [source, target] of Object.entries(attachments)) {
  if (source === target) problems.push(`${source} redirects to itself`);
  else if (target in attachments) problems.push(`${source} → ${target}, which is itself an attachment redirect (two hops)`);
  else if (redirected.has(target)) problems.push(`${source} → ${target}, which public/_redirects redirects again (two hops)`);
  else if (!/^https?:/i.test(target) && !exists(target)) problems.push(`${source} → ${target}, which the build did not produce`);
}

const headers = existsSync('public/_headers') ? readFileSync('public/_headers', 'utf8') : '';
const block = /^\/wp-content\/uploads\/\*\s*\n((?:[ \t]+.*\n?)+)/m.exec(headers)?.[1] ?? '';
if (!/max-age=31536000/.test(block) || !/immutable/.test(block)) {
  problems.push('public/_headers has no `/wp-content/uploads/*` rule with `public, max-age=31536000, immutable`.');
}

if (problems.length) {
  console.error(`✗ check-legacy-media: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 25)) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ check-legacy-media: 404 page present, ${Object.keys(attachments).length} attachment redirect(s) resolve in one hop, uploads cached immutable`);
