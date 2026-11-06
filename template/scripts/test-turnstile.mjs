import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTurnstile } from '../src/lib/turnstile.ts';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

test('the published CSP permits the Turnstile iframe and does not block its API script', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const match = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m);
  assert.ok(match, 'public/_headers must declare the template CSP');

  const directives = new Map(
    match[1]
      .split(';')
      .map((part) => {
        const [name, ...sources] = part.trim().split(/\s+/);
        return [name, sources.join(' ')];
      })
      .filter(([name]) => name),
  );
  assert.ok(
    directives.get('frame-src')?.split(/\s+/).includes('https://challenges.cloudflare.com'),
    'frame-src must allow Cloudflare Turnstile',
  );

  const effectiveScriptSources = directives.get('script-src') ?? directives.get('default-src');
  assert.ok(
    !effectiveScriptSources || effectiveScriptSources.split(/\s+/).includes('https://challenges.cloudflare.com'),
    'an effective script policy must allow the Cloudflare Turnstile API script',
  );
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validResponse(overrides = {}) {
  return {
    success: true,
    hostname: 'www.example.com',
    action: 'contact',
    ...overrides,
  };
}

test('submits only the secret and token, then requires success, hostname and action', async () => {
  let captured;
  const fetcher = async (url, init) => {
    captured = { url: String(url), init };
    return jsonResponse(validResponse());
  };

  const result = await verifyTurnstile('challenge-token', 'private-secret', 'www.example.com', fetcher);

  assert.deepEqual(result, { ok: true });
  assert.equal(captured.url, SITEVERIFY_URL);
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual([...new URLSearchParams(captured.init.body)], [
    ['secret', 'private-secret'],
    ['response', 'challenge-token'],
  ]);
  assert.equal(captured.init.body.has('remoteip'), false);
});

test('normalizes host case but rejects a different hostname', async () => {
  const fetcher = async () => jsonResponse(validResponse({ hostname: 'WWW.EXAMPLE.COM' }));
  assert.deepEqual(
    await verifyTurnstile('token', 'secret', 'www.example.com', fetcher),
    { ok: true },
  );

  const wrongHost = async () => jsonResponse(validResponse({ hostname: 'attacker.example' }));
  assert.deepEqual(
    await verifyTurnstile('token', 'secret', 'www.example.com', wrongHost),
    { ok: false, reason: 'invalid' },
  );
});

test('rejects failed, wrong-action, incomplete and malformed Siteverify responses', async () => {
  for (const payload of [
    { success: false },
    validResponse({ action: 'login' }),
    { success: true, hostname: 'www.example.com' },
  ]) {
    assert.deepEqual(
      await verifyTurnstile('token', 'secret', 'www.example.com', async () => jsonResponse(payload)),
      { ok: false, reason: 'invalid' },
    );
  }

  const malformed = async () => new Response('not-json', { status: 200 });
  assert.deepEqual(
    await verifyTurnstile('token', 'secret', 'www.example.com', malformed),
    { ok: false, reason: 'unavailable' },
  );
});

test('rejects absent, whitespace-only and overlong tokens without calling Siteverify', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return jsonResponse(validResponse());
  };

  for (const token of [undefined, '', '   ', 'x'.repeat(2049)]) {
    assert.deepEqual(
      await verifyTurnstile(token, 'secret', 'www.example.com', fetcher),
      { ok: false, reason: 'invalid' },
    );
  }
  assert.equal(calls, 0);
});

test('fails closed when the secret is missing, the service fails, or the request times out', async () => {
  let calls = 0;
  const unusedFetcher = async () => {
    calls += 1;
    return jsonResponse(validResponse());
  };
  assert.deepEqual(
    await verifyTurnstile('token', undefined, 'www.example.com', unusedFetcher),
    { ok: false, reason: 'unavailable' },
  );
  assert.equal(calls, 0);

  assert.deepEqual(
    await verifyTurnstile('token', 'secret', 'www.example.com', async () => jsonResponse({}, 503)),
    { ok: false, reason: 'unavailable' },
  );
  assert.deepEqual(
    await verifyTurnstile('token', 'secret', 'www.example.com', async () => {
      throw new Error('network unavailable');
    }),
    { ok: false, reason: 'unavailable' },
  );

  const stalled = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
        once: true,
      });
    });
  assert.deepEqual(
    await verifyTurnstile('token', 'secret', 'www.example.com', stalled, 5),
    { ok: false, reason: 'unavailable' },
  );
});
