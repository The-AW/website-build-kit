/**
 * Does `http://` on the production host answer with a 301 to the SAME URL on `https://`?
 *
 * ⚠ THE FAILURE THIS EXISTS FOR: the old WordPress origin redirected http to https, so nobody ever
 * thought about it. A Worker route over the same proxied hostname does NOT: Cloudflare hands plain
 * http to the Worker, the Worker serves the page, and `http://host/<any path>` answered 200 on a
 * live site for hours. Every https check was green. Search engines see two URLs per page, links
 * and bookmarks made with http never consolidate, and a visitor on http is never moved to https.
 *
 * The probe carries a query string, because a redirect that drops it is the same bug for every
 * tracked or paginated URL. A 302 is refused: a temporary redirect tells crawlers to keep the http URL.
 * A refused connection is a failure too: visitors who type or follow `http://` get nothing.
 *
 * The fix is one rule, not a zone setting: a Single Redirect "http.host eq <host> and not ssl → 301 to
 * concat("https://<host>", http.request.uri.path) with the query preserved" (see docs/production-cutover.md §8).
 */

/** The URL to probe for an https origin; null for any other protocol (a local preview has no https). */
export function httpProbeUrl(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:') return null;
  return `http://${url.host}/?aw-https-probe=1`;
}

/**
 * @param {string} probeUrl the http:// URL to request
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, status: number, location: string, detail: string }>}
 */
export async function checkHttpRedirect(probeUrl, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const probe = new URL(probeUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(probeUrl, { redirect: 'manual', signal: controller.signal });
  } catch (error) {
    return { ok: false, status: 0, location: '', detail: `no answer on ${probe.protocol}//${probe.host} (${String(error?.cause?.code ?? error?.message ?? error)}): a visitor who follows an http link gets nothing` };
  } finally {
    clearTimeout(timer);
  }

  const status = response.status;
  const location = response.headers.get('location') ?? '';
  if (status !== 301 && status !== 308) {
    return {
      ok: false, status, location,
      detail: status >= 200 && status < 300
        ? `HTTP ${status}: the page is served over plain http instead of redirecting`
        : `HTTP ${status}${location ? ` → ${location}` : ''}: must be a permanent redirect (301)`,
    };
  }
  let target;
  try { if (!location) throw new Error('empty'); target = new URL(location, probe); } catch { return { ok: false, status, location, detail: `HTTP ${status} with an unusable Location (${JSON.stringify(location)})` }; }
  if (target.protocol !== 'https:') return { ok: false, status, location, detail: `HTTP ${status} → ${location}: the target is not https` };
  if (target.hostname !== probe.hostname) return { ok: false, status, location, detail: `HTTP ${status} → ${location}: leaves the host (${probe.hostname})` };
  if (target.pathname !== probe.pathname || target.search !== probe.search) {
    return { ok: false, status, location, detail: `HTTP ${status} → ${location}: the path or query string was not preserved (asked for ${probe.pathname}${probe.search})` };
  }
  return { ok: true, status, location, detail: `HTTP ${status} → ${location}` };
}
