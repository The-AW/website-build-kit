/**
 * `POST /api/leads` for `forms.choice: "d1_leads"`: the whole request path, as one function that
 * takes its bindings as arguments, so node:test can drive it with a stand-in D1, rate limiter
 * and Siteverify (scripts/test-lead-api.mjs). src/lib/lead-route.ts is the thin Astro wrapper.
 *
 * Order matters, and every step fails CLOSED:
 *
 *   1. LEADS_ENABLED is "true"            (production stays closed until the acceptance record exists)
 *   2. HTTPS, exact same Origin, request host = TURNSTILE_ALLOWED_HOSTNAME, origin in LEADS_ALLOWED_ORIGINS
 *   3. Content-Type application/json, body at most 16 KiB (counted while reading, not trusted from the header)
 *   4. rate limit per visitor: LEADS_RATE_LIMITER keyed by an HMAC of the IP, never the IP itself
 *   5. field validation + consent
 *   6. Turnstile Siteverify: success, the exact hostname, action "contact"
 *   7. one parameterised INSERT into D1 (src/lib/lead-store.ts)
 *
 * The rate limit runs BEFORE Siteverify and the insert, so a flood costs one cheap counter check.
 * Nothing the visitor typed is ever logged; a store failure logs a fixed reason only.
 */
import { isSameOrigin } from './origin.ts';
import { rateLimitKey } from './rate-limit.ts';
import { CONTACT_PATH, LEAD_MESSAGES, validateLeadSubmission } from './lead-submission.ts';
import { storeLead, type LeadDatabase } from './lead-store.ts';
import { verifyTurnstile } from './turnstile.ts';

export const MAX_BODY_BYTES = 16 * 1024;

export interface LeadEnv {
  LEADS_ENABLED?: string;
  /** Comma-separated exact origins, e.g. "https://www.example.org". */
  LEADS_ALLOWED_ORIGINS?: string;
  TURNSTILE_ALLOWED_HOSTNAME?: string;
  TURNSTILE_SECRET_KEY?: string;
  LEADS_DB?: LeadDatabase;
  LEADS_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  LEADS_RATE_LIMIT_HMAC_SECRET?: string;
  /** This site's production hostname, written on every lead row in the shared database. */
  LEADS_SITE?: string;
}

export interface LeadDeps {
  fetcher?: typeof fetch;
  now?: Date;
  /** Turnstile Siteverify timeout, ms. */
  timeoutMs?: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** Read the body with a hard cap, counting bytes as they arrive. */
export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) return { ok: false };
  if (!request.body) return { ok: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch { /* the limit has already been enforced */ }
        return { ok: false };
      }
      chunks.push(part.value);
    }
  } catch {
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

export async function handleLeadPost(request: Request, env: LeadEnv, ip: string | undefined, deps: LeadDeps = {}): Promise<Response> {
  const requestUrl = new URL(request.url);

  if (env.LEADS_ENABLED !== 'true') return json({ ok: false, error: LEAD_MESSAGES.unavailable }, 500);
  if (requestUrl.protocol !== 'https:' || !isSameOrigin(request.url, request.headers.get('origin'))) {
    return json({ ok: false, error: LEAD_MESSAGES.origin }, 403);
  }
  const allowedOrigins = (env.LEADS_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const expectedHostname = env.TURNSTILE_ALLOWED_HOSTNAME?.trim().toLowerCase();
  if (!expectedHostname || !allowedOrigins.includes(requestUrl.origin)) {
    return json({ ok: false, error: LEAD_MESSAGES.unavailable }, 500);
  }
  if (requestUrl.hostname.toLowerCase() !== expectedHostname) return json({ ok: false, error: LEAD_MESSAGES.origin }, 403);

  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return json({ ok: false, error: LEAD_MESSAGES.notJson }, 400);
  const parsed = await readJson(request);
  if (!parsed.ok) return json({ ok: false, error: LEAD_MESSAGES.unreadable }, 400);

  const visitor = ip?.trim() || request.headers.get('cf-connecting-ip')?.trim();
  const limiter = env.LEADS_RATE_LIMITER;
  const rateSecret = env.LEADS_RATE_LIMIT_HMAC_SECRET;
  if (!visitor || !limiter || !rateSecret || rateSecret.length < 32) return json({ ok: false, error: LEAD_MESSAGES.unavailable }, 500);
  try {
    const allowed = await limiter.limit({ key: await rateLimitKey(visitor, rateSecret) });
    if (!allowed.success) return json({ ok: false, error: LEAD_MESSAGES.rateLimited }, 429);
  } catch {
    return json({ ok: false, error: LEAD_MESSAGES.unavailable }, 500);
  }

  const validated = validateLeadSubmission(parsed.value);
  if (!validated.ok) return json({ ok: false, error: LEAD_MESSAGES.fields, errors: validated.errors }, 400);
  if (!validated.value.turnstileToken) return json({ ok: false, error: LEAD_MESSAGES.challenge, resetTurnstile: true }, 403);

  const captcha = await verifyTurnstile(validated.value.turnstileToken, env.TURNSTILE_SECRET_KEY, expectedHostname, deps.fetcher ?? fetch, deps.timeoutMs ?? 5_000, visitor);
  if (!captcha.ok) {
    return json({
      ok: false,
      error: captcha.reason === 'invalid' ? LEAD_MESSAGES.challengeInvalid : LEAD_MESSAGES.challengeUnavailable,
      resetTurnstile: true,
    }, captcha.reason === 'invalid' ? 403 : 500);
  }

  const stored = await storeLead(env.LEADS_DB, {
    site: env.LEADS_SITE?.trim().toLowerCase() ?? '',
    name: validated.value.name,
    email: validated.value.email,
    phone: validated.value.phone,
    message: validated.value.message,
    sourceUrl: `${requestUrl.origin}${CONTACT_PATH}`,
    userAgent: request.headers.get('user-agent'),
    utm: validated.value.utm,
  }, deps.now);
  if (!stored.ok) {
    /* A lead that reached a verified human and was then not stored is the worst failure this route
       has. Record why: a fixed reason and description only, never the submission itself. */
    console.warn(JSON.stringify({ event: 'lead_store_failure', reason: stored.reason, detail: stored.detail }));
    return json({ ok: false, error: LEAD_MESSAGES.notStored, resetTurnstile: true }, 500);
  }
  return json({ ok: true, message: LEAD_MESSAGES.sent }, 200);
}
