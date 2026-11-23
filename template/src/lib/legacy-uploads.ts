/**
 * The site's real 404, for the one place a Worker still answers a path: an `/api/*` request that
 * is not the lead endpoint (src/worker.ts).
 *
 * Since 0.1.25 (2026-11-22 Worker-cost fix, first on 123achei): this file used to be the asset-miss handler for
 * `assets.not_found_handling: "none"` (old upload URLs → WebP, attachment pages → parent, anything
 * else → this 404). That ran the Worker for EVERY miss, and a crawler working through ~86k dead
 * directory-site URLs took the account over the Workers Free daily limit. The old URLs are now
 * static `_redirects` rules (scripts/legacy-redirects.mjs, using src/lib/upload-fallback.ts) and
 * unknown URLs get `not_found_handling: "404-page"`, both answered by the asset layer.
 */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** The site's prerendered 404 page, with a real 404 status. */
export async function notFound(request: Request, assets: AssetsBinding): Promise<Response> {
  const page = await assets.fetch(new Request(new URL('/404.html', request.url), { headers: { accept: 'text/html' } }));
  if (page.status !== 200) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const headers = new Headers({ 'content-type': page.headers.get('content-type') ?? 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' });
  // The asset layer applied public/_headers to /404.html; a new Response would drop them, so the 404
  // lost staging's X-Robots-Tag and the security headers. Carry them over (as Someimagem).
  for (const name of ['x-robots-tag', 'referrer-policy', 'permissions-policy', 'content-security-policy', 'x-content-type-options', 'x-frame-options']) {
    const value = page.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === 'HEAD' ? null : page.body, { status: 404, headers });
}
