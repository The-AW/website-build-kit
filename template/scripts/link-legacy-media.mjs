#!/usr/bin/env node
/**
 * Put the deployed legacy uploads into the built assets directory WITHOUT copying their bytes
 * (build.md §5b).
 *
 *   node scripts/link-legacy-media.mjs [assetsDir]     # npm run legacy:link
 *
 * Astro copies `public/` into `dist/` as ordinary files, so legacy uploads under `public/`
 * double the disk cost of every build. They are staged in `.aw/legacy-media/` instead and this
 * step runs after `astro build`:
 *
 *   hard link (same inode, zero extra bytes) → copy-on-write clone (`cp -c` on APFS, `--reflink` on btrfs/XFS) → refuse
 *
 * To wrangler and every other reader a hard link is an ordinary file: it reads the bytes,
 * hashes them and uploads by hash. Symlinks are avoided on purpose. Refuses below the free-disk
 * floor (lib/legacy-media.mjs), because a fallback to a real copy would cost real bytes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { LEGACY_DEPLOY, assetsDirectory, guardDisk, walk } from './lib/legacy-media.mjs';

const assetsDir = process.argv[2] ?? assetsDirectory();
if (!existsSync(assetsDir)) {
  console.error(`✗ link-legacy-media: ${assetsDir} does not exist; run the build first.`);
  process.exit(1);
}
if (!existsSync(join(LEGACY_DEPLOY, 'wp-content'))) {
  console.log(`  link-legacy-media: nothing staged in ${LEGACY_DEPLOY}; skipped.`);
  process.exit(0);
}
await guardDisk(assetsDir, 'link-legacy-media');

let linked = 0, cloned = 0, present = 0;
for (const src of walk(join(LEGACY_DEPLOY, 'wp-content'))) {
  const dest = join(assetsDir, relative(LEGACY_DEPLOY, src));
  if (existsSync(dest)) {
    if (statSync(dest).ino === statSync(src).ino) { present += 1; continue; }
    console.error(`✗ link-legacy-media: ${dest} already exists and is a different file. Refusing to overwrite.`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  try {
    linkSync(src, dest);
    linked += 1;
  } catch {
    // A different volume cannot hard-link. A copy-on-write clone still costs no bytes; a plain copy would.
    const clone = { darwin: ['-c'], linux: ['--reflink=always'] }[process.platform];
    if (!clone) {
      console.error(`✗ link-legacy-media: cannot hard-link ${src} (different volume?) and ${process.platform} has no copy-on-write clone. Keep .aw/ and dist/ on one volume.`);
      process.exit(1);
    }
    execFileSync('cp', [...clone, src, dest]);
    cloned += 1;
  }
}
console.log(`✓ legacy media in ${assetsDir}: ${linked} hard-linked, ${cloned} cloned, ${present} already linked.`);
