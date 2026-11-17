import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  D1_LEADS_ROUTE, createWranglerConfig, leadsEnabledFor, validateMigrationManifest, validateWranglerDeployConfig,
} from './lib/aw-migration.mjs';

/**
 * forms.choice "d1_leads": what the manifest must say, what Worker config it generates, and what the
 * deploy validator refuses. The Worker itself is exercised in test-lead-api.mjs (handler) and
 * test-leads-worker.mjs (a real build under wrangler dev).
 */
const ID = '1234567890abcdef1234567890abcdef';
const ZONE = 'abcdef1234567890abcdef1234567890';
const DB = (n) => ({ name: `client-leads-${n}`, id: n === 'staging' ? '11111111-2222-4333-8444-555555555555' : '66666666-7777-4888-8999-000000000000' });

const manifest = (forms = {}) => ({
  schemaVersion: 1,
  template: false,
  sourceUrl: 'https://old-client.org',
  hosts: { staging: 'https://staging.client.co.uk', production: 'https://client.co.uk' },
  targets: {
    repositoryUrl: 'https://github.com/The-AW/mae-sample-migration',
    cloudflare: { staging: { accountId: ID, zoneId: ZONE }, production: { accountId: ID, zoneId: ZONE } },
    workers: { staging: 'client-staging', production: 'client-production' },
  },
  inventories: { routes: 'recon/urls.txt', media: 'recon/media.csv', redirects: 'public/_redirects', redirectExceptions: [] },
  forms: {
    choice: 'd1_leads',
    turnstileSiteKeys: { staging: '0x4AAAAAAAstaging000000', production: '0x4AAAAAAAproduction0000' },
    leadsDatabases: { staging: DB('staging'), production: DB('production') },
    rateLimiterNamespaceIds: { staging: '4001', production: '4002' },
    ...forms,
  },
});

let dir;
const site = (files = {}) => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), 'kit-leads-'));
  const all = { 'src/pages/api/leads.ts': `${D1_LEADS_ROUTE}\n`, 'migrations/0001_create_leads.sql': '-- schema\n', ...files };
  for (const [rel, body] of Object.entries(all)) { if (body === undefined) continue; mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); }
  return dir;
};
const errors = (m, env = 'staging', cwd = dir) => validateMigrationManifest(m, env, { phase: 'build', cwd }).errors.join(' | ');
test.afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

test('a complete d1_leads manifest validates for both environments (production stays closed)', () => {
  site();
  assert.equal(errors(manifest(), 'staging'), '');
  assert.equal(errors(manifest(), 'production'), '');
});

test('staging accepts submissions; production stays closed until productionEnabled', () => {
  assert.equal(leadsEnabledFor(manifest(), 'staging'), true);
  assert.equal(leadsEnabledFor(manifest(), 'production'), false);
  assert.equal(leadsEnabledFor(manifest({ productionEnabled: true }), 'production'), true);
  assert.equal(leadsEnabledFor({ ...manifest(), forms: { choice: 'none', productionEnabled: true } }, 'production'), false, 'no runtime, no form');
});

test('private_crm has the same gate: staging on, production closed until productionEnabled', () => {
  const crm = (extra = {}) => ({ ...manifest(), forms: { choice: 'private_crm', crmAdapter: 'src/lib/crm-adapter.mjs', ...extra } });
  assert.equal(leadsEnabledFor(crm(), 'staging'), true);
  assert.equal(leadsEnabledFor(crm(), 'production'), false);
  assert.equal(leadsEnabledFor(crm({ productionEnabled: true }), 'production'), true);
});

test('the route file is required, and it must be the kit handler', () => {
  site({ 'src/pages/api/leads.ts': undefined });
  assert.match(errors(manifest()), /src\/pages\/api\/leads\.ts is missing\. Create it with:\nexport const prerender = false;/);
  site({ 'src/pages/api/leads.ts': 'export const prerender = false;\nexport async function POST() { return new Response("ok"); }\n' });
  assert.match(errors(manifest()), /must use the kit handler/);
});

test('the schema, the Turnstile key, the database and the rate-limit namespace are required where the form is open', () => {
  site();
  rmSync(join(dir, 'migrations'), { recursive: true });
  assert.match(errors(manifest()), /needs the leads schema in migrations\//);
  site();
  assert.match(errors(manifest({ turnstileSiteKeys: {} })), /turnstileSiteKeys\.staging must contain the public Turnstile site key/);
  assert.match(errors(manifest({ leadsDatabases: {} })), /leadsDatabases\.staging must name the D1 database/);
  assert.match(errors(manifest({ leadsDatabases: { staging: { name: 'x', id: 'not-a-uuid' } } })), /leadsDatabases\.staging must name the D1 database/);
  assert.match(errors(manifest({ rateLimiterNamespaceIds: {} })), /rateLimiterNamespaceIds\.staging must be a positive integer string/);
  assert.match(errors(manifest({ rateLimiterNamespaceIds: { staging: '4001', production: '4001' } })), /must differ between staging and production/);
  // Production is closed, so its key and database are not demanded yet.
  assert.equal(errors(manifest({ turnstileSiteKeys: { staging: 'k' }, leadsDatabases: { staging: DB('staging') } }), 'production'), '');
});

test('opening production needs the acceptance record, its own widget and its own database', () => {
  site();
  const open = (extra = {}) => manifest({ productionEnabled: true, productionAcceptance: { stagingSubmissionVerified: true, testRecordDeleted: true, acceptedOn: '2026-11-17', acceptedBy: 'Site Owner' }, ...extra });
  assert.equal(errors(open(), 'production'), '');
  assert.match(errors(manifest({ productionEnabled: true }), 'production'), /productionAcceptance is missing/);
  assert.match(errors(open({ productionAcceptance: { stagingSubmissionVerified: false, testRecordDeleted: true, acceptedOn: '2026-11-17', acceptedBy: 'x' } }), 'production'), /stagingSubmissionVerified must be true/);
  assert.match(errors(open({ productionAcceptance: { stagingSubmissionVerified: true, testRecordDeleted: false, acceptedOn: '17/11/2026', acceptedBy: '' } }), 'production'), /testRecordDeleted must be true.*acceptedOn must be the ISO date.*acceptedBy must name/);
  assert.match(errors(open({ turnstileSiteKeys: { staging: 'same', production: 'same' } }), 'production'), /production must be its own widget/);
  assert.match(errors(open({ leadsDatabases: { staging: DB('staging'), production: DB('staging') } }), 'production'), /production must be its own D1 database/);
  assert.match(errors(open({ productionEnabled: 'yes' }), 'production'), /productionEnabled must be a boolean/);
});

test('the generated config binds D1 and the rate limiter, sets the non-secret vars, and routes /api/* first', () => {
  site();
  const staging = createWranglerConfig(manifest(), 'staging', dir);
  assert.deepEqual(staging.vars, { LEADS_ENABLED: 'true', LEADS_ALLOWED_ORIGINS: 'https://staging.client.co.uk', TURNSTILE_ALLOWED_HOSTNAME: 'staging.client.co.uk' });
  assert.deepEqual(staging.d1_databases, [{ binding: 'LEADS_DB', database_name: 'client-leads-staging', database_id: DB('staging').id, migrations_dir: '../migrations' }]);
  assert.deepEqual(staging.ratelimits, [{ name: 'LEADS_RATE_LIMITER', namespace_id: '4001', simple: { limit: 10, period: 60 } }]);
  assert.deepEqual(staging.assets.run_worker_first, ['/api/*']);
  assert.equal(staging.assets.not_found_handling, '404-page', 'a real static 404 is unchanged');
  assert.ok(staging.compatibility_flags.includes('nodejs_compat'));
  const production = createWranglerConfig(manifest(), 'production', dir);
  assert.equal(production.vars.LEADS_ENABLED, 'false', 'production is generated closed');
  assert.equal(production.ratelimits[0].namespace_id, '4002');
  assert.ok(!JSON.stringify(staging).match(/SECRET|INGESTION/), 'no secret name or CRM var in the config');
});

test('private_crm: no D1 or rate limiter; LEADS_ENABLED follows the gate; production needs a recorded acceptance', () => {
  site({ 'src/pages/api/leads.ts': 'export const prerender = false;\nexport async function POST() { return submitToExistingCrm({}); }\n', 'src/lib/crm-adapter.mjs': 'export const x = 1;\n' });
  const crmManifest = (extra = {}) => ({ ...manifest(), forms: { choice: 'private_crm', crmAdapter: 'src/lib/crm-adapter.mjs', ...extra } });
  const crm = createWranglerConfig(crmManifest(), 'staging', dir);
  assert.deepEqual(crm.vars, { LEADS_ENABLED: 'true' });
  assert.equal(crm.d1_databases, undefined);
  assert.equal(crm.ratelimits, undefined);
  assert.deepEqual(crm.assets.run_worker_first, ['/api/*']);
  const crmErrors = (m, env) => validateMigrationManifest(m, env, { phase: 'build', cwd: dir }).errors.join(' | ');
  assert.match(crmErrors(crmManifest(), 'production'), /forms\.productionEnabled must be true/);
  assert.match(crmErrors(crmManifest({ productionEnabled: true }), 'production'), /productionAcceptance is missing/);
  const accepted = { stagingSubmissionVerified: true, testRecordDeleted: true, acceptedOn: '2026-11-17', acceptedBy: 'Example Person' };
  assert.doesNotMatch(crmErrors(crmManifest({ productionEnabled: true, productionAcceptance: accepted }), 'production'), /productionEnabled|productionAcceptance/);
  assert.deepEqual(createWranglerConfig(crmManifest({ productionEnabled: true, productionAcceptance: accepted }), 'production', dir).vars, { LEADS_ENABLED: 'true' });
});

test('the deploy validator refuses a config that disagrees with the manifest, in each direction', () => {
  site();
  const target = (env = 'staging', m = manifest()) => ({ ...validateMigrationManifest(m, env, { phase: 'build', cwd: dir }), accountId: ID });
  const good = { ...createWranglerConfig(manifest(), 'staging', dir), account_id: ID, main: 'entry.mjs' };
  assert.deepEqual(validateWranglerDeployConfig(good, target(), { requireWorkerEntrypoint: true }), []);
  const refuse = (config, pattern, t = target()) => assert.match(validateWranglerDeployConfig({ ...good, ...config }, t, { requireWorkerEntrypoint: true }).join(' | '), pattern);

  refuse({ vars: { ...good.vars, LEADS_ENABLED: 'false' } }, /LEADS_ENABLED must be "true"/);
  refuse({ vars: { ...good.vars, LEADS_ALLOWED_ORIGINS: 'https://elsewhere.example.org' } }, /exact site host/);
  refuse({ vars: { ...good.vars, TURNSTILE_SECRET_KEY: 'oops' } }, /secrets must not be stored in Wrangler vars/);
  refuse({ vars: { ...good.vars, LEADS_INGESTION_URL: 'https://crm.example.org' } }, /CRM ingestion vars must not be configured/);
  refuse({ d1_databases: [] }, /needs a LEADS_DB D1 binding/);
  refuse({ ratelimits: [] }, /ratelimits must bind LEADS_RATE_LIMITER at 10 requests per 60 seconds/);
  refuse({ ratelimits: [{ ...good.ratelimits[0], simple: { limit: 1000, period: 60 } }] }, /ratelimits must bind/);
  // Production, closed: a config that opens it without the acceptance record is refused.
  const prod = { ...createWranglerConfig(manifest(), 'production', dir), account_id: ID, main: 'entry.mjs' };
  assert.deepEqual(validateWranglerDeployConfig(prod, target('production'), { requireWorkerEntrypoint: true }), []);
  assert.match(validateWranglerDeployConfig({ ...prod, vars: { ...prod.vars, LEADS_ENABLED: 'true' } }, target('production'), { requireWorkerEntrypoint: true }).join(' | '), /must keep production closed/);
});

test('d1_leads and media.legacyUploads together need the site-owned Worker that calls legacyRedirect', () => {
  site();
  assert.match(errors({ ...manifest(), media: { legacyUploads: true } }), /needs a site-owned src\/worker\.ts that calls legacyRedirect\(\)/);
});
