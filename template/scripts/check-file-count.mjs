#!/usr/bin/env node
/**
 * Count the files a deploy will upload against the Workers static-assets cap, before the deploy
 * (build.md §5b).
 *
 *   node scripts/check-file-count.mjs [assetsDir] [--limit=20000] [--warn=0.9]
 *   npm run check:file-count
 *
 * Workers Free allows 20,000 files per version (25 MiB each); Paid allows 100,000. Wrangler
 * reports an overrun only at upload time, after the build has spent its minutes, and the number
 * is easy to cross without noticing: legacy uploads multiply (a WordPress library holds every
 * size of every image, and one AVIF+WebP ladder per image multiplies that again). On a
 * 615-post migration the full inventory was 39,268 media paths against a cap of 20,000; the
 * used images alone were 9,521.
 *
 * Fails above the limit, and on any single file over 25 MiB; warns at 90%. Pass `--limit=100000`
 * only on an account that has the Paid plan. `scripts/deploy-aw.mjs` runs it again immediately
 * before `wrangler deploy`.
 */
import { existsSync, statSync } from 'node:fs';
import { assetsDirectory, walk } from './lib/legacy-media.mjs';

const flags = new Map(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')));
const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? assetsDirectory();
const limit = Number(flags.get('limit') ?? 20000);
const warnAt = Number(flags.get('warn') ?? 0.9);
const MAX_BYTES = 25 * 1024 * 1024;

if (!existsSync(dir)) {
  console.error(`✗ check-file-count: ${dir} does not exist; run the build first.`);
  process.exit(1);
}

let count = 0;
const tooBig = [];
for (const file of walk(dir)) {
  count += 1;
  const size = statSync(file).size;
  if (size > MAX_BYTES) tooBig.push(`${file} (${(size / 1048576).toFixed(1)} MiB)`);
}

const pct = Math.round((count / limit) * 100);
if (count > limit) {
  console.error(`✗ check-file-count: ${count.toLocaleString('en')} files in ${dir}, over the ${limit.toLocaleString('en')}-file cap (${pct}%).\n  Deploy only what pages use, one file per image, and re-run. See build.md §5b.`);
  process.exit(1);
}
if (tooBig.length) {
  console.error(`✗ check-file-count: ${tooBig.length} file(s) over the 25 MiB per-file cap:\n  ${tooBig.slice(0, 10).join('\n  ')}`);
  process.exit(1);
}
console.log(`${count >= limit * warnAt ? '!' : '✓'} check-file-count: ${count.toLocaleString('en')} of ${limit.toLocaleString('en')} files (${pct}%) in ${dir}${count >= limit * warnAt ? ' — close to the cap' : ''}`);
