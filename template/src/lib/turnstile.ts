const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'unavailable' };

type SiteverifyResponse = {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
};

/**
 * Validate a browser token at Cloudflare before accepting a lead.
 *
 * Check the hostname and action. When supplied, the visitor IP goes only to
 * Siteverify, never to the CRM.
 */
export async function verifyTurnstile(
  token: string | undefined,
  secretKey: string | undefined,
  expectedHostname: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!secretKey || !expectedHostname) return { ok: false, reason: 'unavailable' };
  if (!token || token.trim().length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'invalid' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const parameters: Record<string, string> = { secret: secretKey, response: token };
    if (remoteIp?.trim()) parameters.remoteip = remoteIp.trim();
    const response = await fetcher(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };

    const result = (await response.json()) as SiteverifyResponse;
    const hostname = typeof result.hostname === 'string' ? result.hostname.toLowerCase() : '';
    if (
      result.success !== true ||
      hostname !== expectedHostname.toLowerCase() ||
      result.action !== 'contact'
    ) {
      return { ok: false, reason: 'invalid' };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
