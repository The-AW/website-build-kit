/**
 * Shared by the migrated-media tools (build.md §5b, manifest flag `media.legacyUploads`).
 *
 *   legacy-media-stage → measure-image-widths → webp-legacy-media → link-legacy-media
 *   → rewrite-webp-refs → check-file-count
 *
 * One place for the paths, the URL-token pattern and the free-disk guard, so the six scripts
 * cannot disagree about where a file lives or what counts as a reference.
 */
import { existsSync, readdirSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the verified originals live (never `public/`: Astro would copy them into dist). */
export const LEGACY_ORIGINALS = 'media/source/legacy';
export const UPLOADS = 'wp-content/uploads';
/** Hard links to the USED originals, written by legacy-media-stage. */
export const LEGACY_STAGE = '.aw/legacy-src';
/** What is deployed: the WebP outputs and the files kept as they are. */
export const LEGACY_DEPLOY = '.aw/legacy-media';
export const WEBP_CACHE = '.aw/webp-cache';
export const WEBP_MANIFEST = '.aw/webp-manifest.json';
/** The used-original list: { paths, missing, references }. */
export const USED_LIST = '.aw/legacy-used.json';
/** Largest rendered width per image, measured; committed data. */
export const WIDTHS_FILE = 'src/data/image-render-widths.json';
export const ATTACHMENTS_FILE = 'src/data/attachment-redirects.json';

/** The directory a build deploys: the adapter's client output when there is a server, else dist. */
export const assetsDirectory = () => (existsSync('dist/client') ? 'dist/client' : 'dist');

/** Hosts whose absolute upload URLs are the site's own: staging, production and the old source. */
export function ownHosts(manifest) {
  const hosts = new Set();
  for (const value of [manifest?.hosts?.staging, manifest?.hosts?.production, manifest?.sourceUrl]) {
    try { hosts.add(new URL(value).host); } catch { /* not a URL yet */ }
  }
  return [...hosts];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A reference to an upload, wherever it sits: `<img src>`, `srcset`, `og:image`, JSON-LD, CSS
 * `url()`, a sitemap. Group 1 is the host part (may be empty), group 2 the path. The path runs
 * to the first character that ends a URL in HTML, CSS, JSON or a srcset.
 */
export function uploadTokenRegex(hosts, extensions = 'png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?') {
  const hostPart = hosts.length ? `(?:https?:\\/\\/(?:${hosts.map(escapeRe).join('|')}))?` : '';
  return new RegExp(`(${hostPart})(\\/wp-content\\/uploads\\/[^\\s"'()<>,?#\\\\]*?\\.(?:${extensions}))(?![A-Za-z0-9_%.-])`, 'gi');
}

export function* walk(dir, skip = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!skip.has(path)) yield* walk(path, skip); }
    else if (entry.isFile()) yield path;
  }
}

/** Text files that may carry an upload reference. Binary and the uploads tree are not read. */
export const TEXT_FILE = /\.(?:html|css|json|xml|txt|webmanifest|js|mjs|svg)$/i;

const nearestExisting = (path) => {
  let p = path;
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  return p;
};

/** Free bytes on the volume that holds `path`. */
export function freeBytes(path) {
  const fs = statfsSync(nearestExisting(path));
  return fs.bavail * fs.bsize;
}

/**
 * Refuse to start below the free-disk floor, or pause until space returns.
 *
 * A hard link costs nothing and a fallback copy of a few thousand images costs gigabytes, so
 * the step that may copy checks first. A full disk can stop a build half way, and the half-built
 * dist/ then looks like a result.
 *
 *   LEGACY_MEDIA_MIN_FREE_GB        the floor (default 3)
 *   LEGACY_MEDIA_DISK_WAIT_MINUTES  poll every 30 s for this long before refusing (default 0:
 *                                   refuse at once)
 */
export async function guardDisk(path, label) {
  const floor = Number(process.env.LEGACY_MEDIA_MIN_FREE_GB ?? 3) * 1024 ** 3;
  const waitMs = Number(process.env.LEGACY_MEDIA_DISK_WAIT_MINUTES ?? 0) * 60_000;
  const started = Date.now();
  for (;;) {
    const free = freeBytes(path);
    if (free >= floor) return;
    const gb = (n) => (n / 1024 ** 3).toFixed(2);
    if (Date.now() - started >= waitMs) {
      console.error(`✗ ${label}: ${gb(free)} GB free, below the ${gb(floor)} GB floor. Refusing to continue; free disk space and re-run.`);
      process.exit(1);
    }
    console.warn(`  ${label}: ${gb(free)} GB free, below the ${gb(floor)} GB floor; paused, checking again in 30 s.`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}
