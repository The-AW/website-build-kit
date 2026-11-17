import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHttpRedirect, httpProbeUrl } from './lib/http-redirect.mjs';

const answer = (status, location) => async () => new Response(null, { status, headers: location ? { location } : {} });
const PROBE = 'http://www.example.org/?aw-https-probe=1';

test('probe URL: https origins only, query included', () => {
  assert.equal(httpProbeUrl('https://www.example.org'), 'http://www.example.org/?aw-https-probe=1');
  assert.equal(httpProbeUrl('https://www.example.org:8443'), 'http://www.example.org:8443/?aw-https-probe=1');
  assert.equal(httpProbeUrl('http://localhost:8788'), null);
});

test('a 301 or 308 to the same URL on https passes', async () => {
  assert.equal((await checkHttpRedirect(PROBE, { fetchImpl: answer(301, 'https://www.example.org/?aw-https-probe=1') })).ok, true);
  assert.equal((await checkHttpRedirect(PROBE, { fetchImpl: answer(308, 'https://www.example.org/?aw-https-probe=1') })).ok, true);
});

test('every way it can be wrong is refused, with the reason', async () => {
  const bad = async (fetchImpl, pattern) => {
    const r = await checkHttpRedirect(PROBE, { fetchImpl });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.detail, pattern);
  };
  await bad(answer(200), /served over plain http/);
  await bad(answer(302, 'https://www.example.org/?aw-https-probe=1'), /must be a permanent redirect/);
  await bad(answer(301, 'http://www.example.org/?aw-https-probe=1'), /not https/);
  await bad(answer(301, 'https://elsewhere.example.net/?aw-https-probe=1'), /leaves the host/);
  await bad(answer(301, 'https://www.example.org/'), /query string was not preserved/);
  await bad(answer(301, 'https://www.example.org/home/?aw-https-probe=1'), /path or query/);
  await bad(answer(301), /unusable Location/);
  await bad(async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, /no answer.*ECONNREFUSED/);
});
