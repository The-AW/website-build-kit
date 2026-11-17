/**
 * The asset-miss handler for a migrated WordPress site (build.md §5b,
 * `media.legacyUploads: true` in aw-migration.json).
 *
 * With `assets.not_found_handling: "none"` Cloudflare serves every deployed file straight
 * from the asset layer and invokes the Worker only when NOTHING matches. This is that Worker:
 *
 *  1. `/wp-content/uploads/…` that is not deployed as asked (the old `.png`/`.jpg`, a `-WxH`
 *     size variant, `-scaled`) → one 301 to the WebP that is (src/lib/upload-fallback.ts);
 *  2. an old attachment page (`/<image-slug>/`) → 301 to its parent post, from
 *     src/data/attachment-redirects.json (`{ "/slug/": "/target/" }`, one hop, built by the
 *     site's importer; `npm run check:legacy-media` fails a chain);
 *  3. anything else → the site's own prerendered 404 page, with status 404.
 *
 * ⚠ Rule 3 is the reason this file is tested against a real Worker. "none" removes
 * Cloudflare's own 404 handling, so a bug here does not look like an error: it looks like a
 * 200 with the 404 page's body, or a redirect loop, and search engines index it. See
 * scripts/test-legacy-media.mjs, which asserts the status of an unknown path.
 */
import attachmentRedirects from '../data/attachment-redirects.json';
import { uploadFallbackDeployed } from './upload-fallback';

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

const attachments = attachmentRedirects as Record<string, string>;

/** A 301 for an old WordPress URL, or null when the URL has no old-site meaning. */
export async function legacyRedirect(request: Request, assets: AssetsBinding): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);

  const exists = async (path: string): Promise<boolean> => {
    // HEAD against the asset layer: a deployed file answers 200, anything else 404.
    const probe = await assets.fetch(new Request(new URL(encodeURI(path), url), { method: 'HEAD' }));
    return probe.status === 200;
  };
  const upload = await uploadFallbackDeployed(url.pathname, exists);
  if (upload) return Response.redirect(new URL(upload, url).href, 301);

  const page = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  let decoded = page;
  try { decoded = decodeURI(page); } catch { /* keep the raw path */ }
  const target = attachments[page] ?? attachments[decoded];
  return target ? Response.redirect(new URL(target, url).href, 301) : null;
}

/** The site's prerendered 404 page, with a real 404 status. */
export async function notFound(request: Request, assets: AssetsBinding): Promise<Response> {
  const page = await assets.fetch(new Request(new URL('/404.html', request.url), { headers: { accept: 'text/html' } }));
  if (page.status !== 200) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response(request.method === 'HEAD' ? null : page.body, {
    status: 404,
    headers: { 'content-type': page.headers.get('content-type') ?? 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' },
  });
}

/** What the static Worker entry does with a request the asset layer could not match. */
export async function handleAssetMiss(request: Request, assets: AssetsBinding): Promise<Response> {
  return (await legacyRedirect(request, assets)) ?? notFound(request, assets);
}
