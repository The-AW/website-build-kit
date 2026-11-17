/**
 * forms.choice "d1_leads", built for real and run under `wrangler dev --local`.
 *
 *   npm run test:leads-worker
 *
 * The unit tests drive the handler with stand-ins. This one builds the template with the choice on
 * (the real Astro adapter, the real generated config) and asks the running Worker what a visitor
 * would see, because the failures that matter here are routing, not logic: an API route that was
 * prerendered, a page that became on-demand, a binding the generated config never declared.
 *
 *  - the build succeeds and the emitted config carries LEADS_DB, the rate limiter and the vars
 *  - pages stay prerendered (200 from assets), an unknown path is a real 404
 *  - POST /api/leads reaches the handler (JSON from OUR code, no-store), and GET does not answer 200
 *  - over plain http the handler refuses (wrangler dev terminates TLS and forwards http, so the
 *    HTTPS-only check is what answers here; the accepted path is test-lead-api.mjs)
 *
 * ⚠ It works IN PLACE, because the template's node_modules and Astro config cannot be moved: it swaps
 * aw-migration.json, adds src/pages/api/leads.ts, builds into dist/, and restores everything in a finally.
 * It refuses to run (skips, with the reason) on a project that already has a contact route or a
 * forms.choice, so a real site's files are never touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { D1_LEADS_ROUTE } from './lib/aw-migration.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const at = (rel) => join(ROOT, rel);
const MANIFEST = at('aw-migration.json');
const ROUTE = at('src/pages/api/leads.ts');
const original = readFileSync(MANIFEST, 'utf8');
const API_DIR = at('src/pages/api');
const pristine = !existsSync(API_DIR) && JSON.parse(original).forms?.choice === 'none';
const wrangler = at('node_modules/wrangler/bin/wrangler.js');
const ID = '1234567890abcdef1234567890abcdef';
const ZONE = 'abcdef1234567890abcdef1234567890';

const fixtureManifest = {
  schemaVersion: 1, template: false, sourceUrl: 'https://old-client.org',
  hosts: { staging: 'https://staging.client.co.uk', production: 'https://client.co.uk' },
  targets: {
    repositoryUrl: 'https://github.com/The-AW/mae-sample-migration',
    cloudflare: { staging: { accountId: ID, zoneId: ZONE }, production: { accountId: ID, zoneId: ZONE } },
    workers: { staging: 'client-staging', production: 'client-production' },
  },
  inventories: { routes: 'recon/urls.txt', media: 'recon/media.csv', redirects: 'public/_redirects', redirectExceptions: [] },
  forms: {
    choice: 'd1_leads',
    turnstileSiteKeys: { staging: '0x4AAAAAAAexample000000' },
    leadsDatabases: { staging: { name: 'client-leads-staging', id: '11111111-2222-4333-8444-555555555555' } },
    rateLimiterNamespaceIds: { staging: '4001', production: '4002' },
  },
  acceptance: { criteria: [], recordedBy: '', recordedAt: '' },
  rollback: { snapshotPath: '', wordpressOrigin: '', restoreSteps: [], cloudwaysRetirement: { requested: false, backupVerified: false, sharedServerDependenciesChecked: false } },
};

let server;
let built;
let config;
let base;

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  if (!pristine || !existsSync(wrangler)) return;
  writeFileSync(MANIFEST, `${JSON.stringify(fixtureManifest, null, 2)}\n`);
  mkdirSync(API_DIR, { recursive: true });
  writeFileSync(ROUTE, `${D1_LEADS_ROUTE}\n`);
  const run = spawnSync(process.execPath, [at('scripts/build.mjs'), 'staging'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: 'true' } });
  built = { code: run.status, out: `${run.stdout}${run.stderr}` };
  if (run.status !== 0) return;
  config = JSON.parse(readFileSync(at('dist/server/wrangler.json'), 'utf8'));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  writeFileSync(at('dist/server/.dev.vars'), `TURNSTILE_SECRET_KEY=test-secret\nLEADS_RATE_LIMIT_HMAC_SECRET=${'h'.repeat(40)}\n`);
  server = spawn(process.execPath, [wrangler, 'dev', '--config', 'dist/server/wrangler.json', '--local', '--port', String(port), '--ip', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  });
  for (let i = 0; i < 90; i += 1) {
    try { if ((await fetch(`${base}/contact/`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('wrangler dev did not start');
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once('exit', resolve);
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
      else server.kill();
      setTimeout(resolve, 5000);
    });
  }
  if (!pristine) return;
  writeFileSync(MANIFEST, original);
  rmSync(API_DIR, { recursive: true, force: true }); // it did not exist before: pristine means no src/pages/api at all
  rmSync(at('dist'), { recursive: true, force: true });
  rmSync(at('.aw/wrangler-staging.jsonc'), { force: true });
});

const ready = (t) => {
  if (!pristine) { t.skip('this project already has a contact route or forms.choice (src/pages/api exists, or forms.choice is not none): refusing to rewrite a real site\'s files'); return false; }
  if (!existsSync(wrangler)) { t.skip('wrangler is not installed (npm ci in template/)'); return false; }
  return true;
};

test('the template builds with forms.choice d1_leads, and the emitted config carries the bindings', (t) => {
  if (!ready(t)) return;
  assert.equal(built.code, 0, built.out.slice(-2000));
  assert.deepEqual(config.assets.run_worker_first, ['/api/*']);
  assert.equal(config.assets.not_found_handling, '404-page');
  assert.equal(config.vars.LEADS_ENABLED, 'true');
  assert.equal(config.d1_databases[0].binding, 'LEADS_DB');
  assert.equal(config.ratelimits[0].name, 'LEADS_RATE_LIMITER');
  assert.equal(config.ratelimits[0].simple.limit, 10);
});

test('pages stay prerendered and an unknown path is a real 404', async (t) => {
  if (!ready(t) || built.code !== 0) return;
  const page = await fetch(`${base}/contact/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(`${base}/no-such-page/`)).status, 404);
});

test('POST /api/leads reaches the handler with its bindings; over http it is refused', async (t) => {
  if (!ready(t) || built.code !== 0) return;
  const res = await fetch(`${base}/api/leads`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://staging.client.co.uk' }, body: JSON.stringify({ name: 'T P', email: 't@example.invalid', message: 'm', consent: true }),
  });
  assert.equal(res.status, 403);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ok, false, 'a JSON refusal from the handler, not Astro\'s HTML 404');
});

test('GET /api/leads is not an answer', async (t) => {
  if (!ready(t) || built.code !== 0) return;
  const res = await fetch(`${base}/api/leads`);
  assert.notEqual(res.status, 200);
});
