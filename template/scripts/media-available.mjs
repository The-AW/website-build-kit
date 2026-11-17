#!/usr/bin/env node
/**
 * Tell CI whether this site's media is available, so a gates job can skip the media-dependent steps with a
 * notice instead of failing on every push (`media.legacyUploads`, build.md §5b).
 *
 *   node scripts/media-available.mjs            # prints a line; under GitHub Actions also writes the outputs
 *
 * Writes `available=true|false` and `skip-media=1|` to $GITHUB_OUTPUT, an `::notice` annotation and a step summary
 * when the media is missing. It always exits 0: absent media is a fact about the runner, not a failure. The build
 * decides what to do with it (the plan function in scripts/lib/legacy-media.mjs): skip on staging, refuse on production.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { legacyOriginalsPresent } from './lib/legacy-media.mjs';

let enabled = false;
try { enabled = JSON.parse(readFileSync('aw-migration.json', 'utf8')).media?.legacyUploads === true; } catch { /* no manifest: nothing media-dependent */ }
const available = !enabled || legacyOriginalsPresent();

const line = !enabled
  ? 'media: media.legacyUploads is off; nothing here depends on media kept outside Git'
  : available
    ? 'media: the originals are present; the migrated-media steps will run'
    : 'media: the originals are NOT present (kept outside Git); the migrated-media steps will be skipped and the build marked undeployable';
console.log(line);

if (process.env.GITHUB_OUTPUT && existsSync(process.env.GITHUB_OUTPUT)) {
  appendFileSync(process.env.GITHUB_OUTPUT, `available=${available}\nskip-media=${available ? '' : '1'}\n`);
}
if (!available) {
  console.log('::notice title=Media is not in this checkout::The site keeps its media outside Git, so the migrated-media steps (stage, WebP, rewrite, file count) are SKIPPED here. Types, copy, alt, sitemap and the Worker config are still checked. Run the full build on a machine that has the originals before deploying.');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Media not in this checkout\nThe migrated-media steps were skipped. This build is for the gates only and is not deployable; build on a machine with the originals before deploying.\n');
  }
}
