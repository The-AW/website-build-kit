import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY_BYTES, handleLeadPost } from '../src/lib/lead-api.ts';
import { LEAD_MESSAGES } from '../src/lib/lead-submission.ts';

/**
 * Every refusal path of POST /api/leads, in the order the route checks them, against stand-ins for
 * D1, the rate limiter and Siteverify. The assertion that matters on each is the same: NOTHING was
 * written. A lead route that stores a row it should have refused is the failure this file is for.
 */
const ORIGIN = 'https://www.example.org';
const URL_ = `${ORIGIN}/api/leads`;
const SECRET = 's'.repeat(40);
const GOOD = {
  name: 'Test Person', email: 'test@example.invalid', phone: '', message: 'Synthetic message.',
  turnstileToken: 'synthetic-token', consent: true,
};

function world({ enabled = 'true', limiter = true, siteverify = { success: true, hostname: 'www.example.org', action: 'contact' }, dbFails = false } = {}) {
  const w = { rows: [], siteverifyCalls: [], limitCalls: [], logs: [] };
  w.env = {
    LEADS_ENABLED: enabled,
    LEADS_ALLOWED_ORIGINS: ORIGIN,
    TURNSTILE_ALLOWED_HOSTNAME: 'www.example.org',
    TURNSTILE_SECRET_KEY: 'secret',
    LEADS_RATE_LIMIT_HMAC_SECRET: SECRET,
    LEADS_RATE_LIMITER: limiter === false ? undefined : { async limit(o) { w.limitCalls.push(o.key); return { success: limiter === true }; } },
    LEADS_DB: {
      prepare: () => ({ bind: (...values) => ({ async run() { if (dbFails) throw new Error('boom'); w.rows.push(values); return {}; } }) }),
    },
  };
  w.deps = {
    fetcher: async (url, init) => {
      w.siteverifyCalls.push({ url: String(url), body: String(init.body) });
      return new Response(JSON.stringify(siteverify), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    now: new Date('2026-11-17T10:00:00.000Z'),
  };
  return w;
}

const post = (w, { body = GOOD, headers = {}, url = URL_, ip = '203.0.113.7', raw } = {}) =>
  handleLeadPost(
    new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: raw ?? JSON.stringify(body) }),
    w.env, ip, w.deps,
  );
const read = async (res) => ({ status: res.status, body: await res.json() });
const refused = (w) => { assert.equal(w.rows.length, 0, 'a refused request stored nothing'); };

test('a valid, verified submission stores exactly one row with status new', async () => {
  const w = world();
  const { status, body } = await read(await post(w));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0][1], '2026-11-17T10:00:00.000Z');
  assert.equal(w.rows[0][6], 'https://www.example.org/contact/', 'source_url is the form page on the request origin');
  assert.equal(w.siteverifyCalls.length, 1);
  assert.match(w.siteverifyCalls[0].body, /remoteip=203\.0\.113\.7/, 'the IP goes to Siteverify only');
  assert.ok(!w.limitCalls[0].includes('203.0.113.7'), 'the limiter key is a hash, not the IP');
});

test('closed (LEADS_ENABLED not "true"): refused before anything else', async () => {
  for (const enabled of [null, 'false', '1']) {
    const w = world({ enabled });
    const r = await read(await post(w));
    assert.equal(r.status, 500);
    assert.equal(r.body.error, LEAD_MESSAGES.unavailable);
    assert.equal(w.siteverifyCalls.length + w.limitCalls.length, 0);
    refused(w);
  }
});

test('a foreign Origin, a cross-scheme Origin and plain http are refused', async () => {
  for (const [headers, url] of [
    [{ origin: 'https://attacker.invalid' }, URL_],
    [{ origin: 'http://www.example.org' }, URL_],
    [{ origin: `${ORIGIN}:8443` }, URL_],
    [{}, 'http://www.example.org/api/leads'],
  ]) {
    const w = world();
    const r = await read(await post(w, { headers, url }));
    assert.equal(r.status, 403, JSON.stringify(headers) + url);
    refused(w);
    assert.equal(w.siteverifyCalls.length, 0);
  }
});

test('a host that is not the configured hostname is refused even if its origin matches itself', async () => {
  const w = world();
  w.env.LEADS_ALLOWED_ORIGINS = 'https://other.example.org';
  const r = await read(await post(w, { url: 'https://other.example.org/api/leads', headers: { origin: 'https://other.example.org' } }));
  assert.equal(r.status, 403);
  refused(w);
});

test('misconfiguration fails closed: no allowed origin, no hostname, no limiter, short HMAC secret, no IP', async () => {
  const cases = [
    (w) => { w.env.LEADS_ALLOWED_ORIGINS = ''; },
    (w) => { delete w.env.TURNSTILE_ALLOWED_HOSTNAME; },
    (w) => { delete w.env.LEADS_RATE_LIMITER; },
    (w) => { w.env.LEADS_RATE_LIMIT_HMAC_SECRET = 'short'; },
  ];
  for (const mutate of cases) {
    const w = world();
    mutate(w);
    assert.equal((await post(w)).status, 500);
    refused(w);
  }
  const w = world();
  assert.equal((await post(w, { ip: '' })).status, 500);
  refused(w);
});

test('not JSON: wrong content type, malformed JSON and invalid UTF-8 are 400', async () => {
  for (const [headers, raw] of [
    [{ 'content-type': 'text/plain' }, 'x'],
    [{ 'content-type': 'application/x-www-form-urlencoded' }, 'name=a'],
    [{}, '{not json'],
    [{}, new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d])],
  ]) {
    const w = world();
    assert.equal((await post(w, { headers, raw })).status, 400);
    refused(w);
  }
});

test('a body over 16 KiB is refused whether or not the header admits its size', async () => {
  const big = JSON.stringify({ ...GOOD, message: 'x'.repeat(MAX_BODY_BYTES) });
  let w = world();
  assert.equal((await post(w, { raw: big, headers: { 'content-length': String(big.length) } })).status, 400);
  refused(w);
  // A stream with no declared length: the cap is counted while reading.
  w = world();
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const res = await handleLeadPost(new Request(URL_, { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json', origin: ORIGIN } }), w.env, '203.0.113.7', w.deps);
  assert.equal(res.status, 400);
  refused(w);
});

test('rate limited: 429 before validation, Siteverify or the insert', async () => {
  const w = world({ limiter: 'deny' });
  const r = await read(await post(w));
  assert.equal(r.status, 429);
  assert.equal(r.body.error, LEAD_MESSAGES.rateLimited);
  assert.equal(w.siteverifyCalls.length, 0);
  refused(w);
});

test('invalid fields and missing consent are 400 with per-field errors, and nothing is verified or stored', async () => {
  for (const [body, field] of [[{ ...GOOD, email: 'x' }, 'email'], [{ ...GOOD, consent: false }, 'consent']]) {
    const w = world();
    const r = await read(await post(w, { body }));
    assert.equal(r.status, 400);
    assert.ok(r.body.errors[field]);
    assert.equal(w.siteverifyCalls.length, 0);
    refused(w);
  }
});

test('no Turnstile token is 403 and asks the widget to reset', async () => {
  const w = world();
  const r = await read(await post(w, { body: { ...GOOD, turnstileToken: '' } }));
  assert.equal(r.status, 403);
  assert.equal(r.body.resetTurnstile, true);
  refused(w);
});

test('Siteverify says no, names another host, or another action: 403, nothing stored', async () => {
  for (const siteverify of [
    { success: false },
    { success: true, hostname: 'attacker.invalid', action: 'contact' },
    { success: true, hostname: 'www.example.org', action: 'login' },
  ]) {
    const w = world({ siteverify });
    const r = await read(await post(w));
    assert.equal(r.status, 403, JSON.stringify(siteverify));
    assert.equal(r.body.resetTurnstile, true);
    refused(w);
  }
});

test('Siteverify unreachable or not 200: 500 "could not verify", nothing stored', async () => {
  const w = world();
  w.deps.fetcher = async () => { throw new Error('offline'); };
  const r = await read(await post(w));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, LEAD_MESSAGES.challengeUnavailable);
  refused(w);
});

test('a D1 failure is a 500 that says the message may not have arrived, and logs no submission', async (t) => {
  const w = world({ dbFails: true });
  const warnings = [];
  t.mock.method(console, 'warn', (line) => warnings.push(String(line)));
  const r = await read(await post(w));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, LEAD_MESSAGES.notStored);
  assert.equal(warnings.length, 1);
  const logged = warnings[0];
  assert.match(logged, /lead_store_failure/);
  for (const secret of [GOOD.name, GOOD.email, GOOD.message, '203.0.113.7']) assert.equal(logged.includes(secret), false, `log leaked ${secret}`);
});

test('every response is JSON, uncacheable and nosniff', async () => {
  const w = world();
  for (const res of [await post(w), await post(world({ enabled: 'false' }))]) {
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }
});
