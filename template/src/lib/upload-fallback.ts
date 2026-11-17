/**
 * One pattern-based fallback for old WordPress image URLs that are not deployed as such
 * (build.md §5b, `media.legacyUploads` in aw-migration.json).
 *
 * Only the images pages use are deployed, and each used PNG/JPG is deployed as ONE WebP at
 * the same path with the extension swapped (`name.png` → `name.webp`). A request for an
 * old URL is answered with a 301:
 *
 *  - the original (`name.png`, `name.jpg`, `name.jpeg`) → `name.webp`;
 *  - a WordPress size variant (`name-300x200.png`) that is not itself deployed
 *    → the hosted original's WebP (`name.webp`, or the big-image `name-scaled.webp`);
 *  - anything else is a real 404.
 *
 * No per-file rules: `_redirects` caps at 2,000. This runs only on asset misses
 * (Cloudflare serves deployed files directly), so image requests that hit never invoke
 * the Worker. Pure functions, no runtime imports, so node:test runs them as they are.
 */
const UPLOADS = '/wp-content/uploads/';
const SIZE_SUFFIX = /^(.*?)-(\d{1,5})x(\d{1,5})(\.[a-z0-9]+)$/i;
const SCALED_SUFFIX = /^(.*?)-scaled(\.[a-z0-9]+)$/i;
const CONVERTED = /\.(png|jpe?g)$/i;

/** Raster uploads that are converted to WebP; everything else is deployed as it is. */
export function isConverted(path: string): boolean {
  return CONVERTED.test(path);
}

/** The path a used upload is deployed at: PNG/JPG/JPEG → .webp, other types unchanged. */
export function deployedPath(path: string): string {
  return path.replace(CONVERTED, '.webp');
}

/** Original-style paths a requested (decoded) upload path may stand for, best first. */
export function uploadCandidates(decoded: string): string[] {
  const candidates: string[] = [decoded];
  const sized = SIZE_SUFFIX.exec(decoded);
  if (sized) candidates.push(`${sized[1]}${sized[4]}`, `${sized[1]}-scaled${sized[4]}`);
  const scaled = SCALED_SUFFIX.exec(decoded);
  if (scaled) candidates.push(`${scaled[1]}${scaled[2]}`);
  return candidates;
}

/** The decoded request path when it is an upload URL we may answer; otherwise null. */
function uploadPath(pathname: string): string | null {
  if (!pathname.startsWith(UPLOADS)) return null;
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * Where an old upload URL should go, or null for a 404. `isHosted` answers "was this
 * ORIGINAL path used by a page", whatever format it is deployed in (the list written by
 * `npm run legacy:stage`).
 */
export function uploadFallback(pathname: string, isHosted: (decodedPath: string) => boolean): string | null {
  const decoded = uploadPath(pathname);
  if (decoded === null) return null;
  // Never redirect to the URL that was just asked for (a hosted GIF/SVG is served directly).
  const hit = uploadCandidates(decoded).find((c) => isHosted(c) && deployedPath(c) !== decoded);
  return hit ? encodeURI(deployedPath(hit)) : null;
}

/**
 * The same decision for a Worker that has no bundled list: `exists` asks the assets
 * binding whether a DEPLOYED path is there. The answer is a path that exists, so a
 * redirect can never land on a 404, and a favicon-style PNG kept as it is resolves to
 * itself rather than to a WebP that was never made.
 */
export async function uploadFallbackDeployed(
  pathname: string,
  exists: (deployedPath: string) => Promise<boolean>,
): Promise<string | null> {
  const decoded = uploadPath(pathname);
  if (decoded === null) return null;
  for (const candidate of uploadCandidates(decoded)) {
    for (const target of new Set([deployedPath(candidate), candidate])) {
      if (target === decoded) continue;
      if (await exists(target)) return encodeURI(target);
    }
  }
  return null;
}
