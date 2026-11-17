/**
 * CI for a site whose media is kept outside Git: the gates build must not be permanently red, and it must
 * not be deployable (build.md §5b, `media.legacyUploads`).
 *
 *   npm run test:media-skip
 *
 * Runs the real `scripts/build.mjs` with the flag on and NO originals on the machine:
 *   - plain staging build: FAILS, saying the media is missing (a missing download is a failure)
 *   - staging with AW_ALLOW_MISSING_MEDIA=1 (what the gates workflow sets when media-available says so): the media
 *     steps are SKIPPED with a notice, everything else runs, exit 0, and .aw/media-skipped.json marks it undeployable
 *   - deploy-aw refuses while that marker exists
 *   - a production build with the switch on FAILS before it builds anything
 * and the plan function behind it, in both directions.
 *
 * ⚠ In place, like test-leads-worker.mjs: it swaps aw-migration.json, builds into dist/ and restores in a finally.
 * It skips, with the reason, on a project that already has originals or a contact route.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { MEDIA_SKIPPED_MARKER, legacyMediaPlan, legacyOriginalsPresent } from './lib/legacy-media.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const at = (rel) => join(ROOT, rel);
const MANIFEST = at('aw-migration.json');
const original = readFileSync(MANIFEST, 'utf8');
const pristine = !existsSync(at('media/source/legacy')) && !existsSync(at('src/pages/api')) && JSON.parse(original).forms?.choice === 'none';
const ID = '1234567890abcdef1234567890abcdef';
const ZONE = 'abcdef1234567890abcdef1234567890';

const fixture = {
  schemaVersion: 1, template: false, sourceUrl: 'https://old-client.org',
  hosts: { staging: 'https://staging.client.co.uk', production: 'https://client.co.uk' },
  targets: {
    repositoryUrl: 'https://github.com/The-AW/mae-sample-migration',
    cloudflare: { staging: { accountId: ID, zoneId: ZONE }, production: { accountId: ID, zoneId: ZONE } },
    workers: { staging: 'client-staging', production: 'client-production' },
  },
  inventories: { routes: 'recon/urls.txt', media: 'recon/media.csv', redirects: 'public/_redirects', redirectExceptions: [] },
  media: { legacyUploads: true },
  forms: { choice: 'none', crmAdapter: '' },
};

const build = (environment, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [at('scripts/build.mjs'), environment], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: 'true', NODE_TEST_CONTEXT: undefined, AW_ALLOW_MISSING_MEDIA: undefined, ...extraEnv },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

before(() => { if (pristine) writeFileSync(MANIFEST, `${JSON.stringify(fixture, null, 2)}\n`); });
after(() => {
  if (!pristine) return;
  writeFileSync(MANIFEST, original);
  rmSync(at('dist'), { recursive: true, force: true });
  rmSync(at('.aw'), { recursive: true, force: true });
});

test('the plan: skip only on staging, only when asked, only when the originals are missing', () => {
  const plan = (over) => legacyMediaPlan({ enabled: true, environment: 'staging', originalsPresent: false, allowMissing: false, ...over }).action;
  assert.equal(plan({}), 'refuse', 'a missing download is a failure unless CI says it is expected');
  assert.equal(plan({ allowMissing: true }), 'skip');
  assert.equal(plan({ originalsPresent: true }), 'run');
  assert.equal(plan({ originalsPresent: true, allowMissing: true }), 'run', 'present media is never skipped');
  assert.equal(plan({ allowMissing: true, environment: 'production' }), 'refuse-production');
  assert.equal(plan({ environment: 'production' }), 'refuse');
  assert.equal(plan({ enabled: false, allowMissing: true, environment: 'production' }), 'run', 'flag off: nothing to skip');
});

test('originals present means at least one file under the originals directory', () => {
  assert.equal(legacyOriginalsPresent(join(ROOT, 'scripts')), false);
});

test('staging build with no originals and no switch FAILS, naming the missing media', (t) => {
  if (!pristine) return t.skip('this project has originals or a contact route: not rewriting its files');
  const r = build('staging');
  assert.equal(r.code, 1, r.out.slice(-1500));
  assert.match(r.out, /media\/source\/legacy\/wp-content\/uploads is missing/);
  assert.match(r.out, /AW_ALLOW_MISSING_MEDIA=1/);
  assert.equal(existsSync(at(MEDIA_SKIPPED_MARKER)), false, 'a refused build leaves no marker');
});

test('with AW_ALLOW_MISSING_MEDIA=1 the media steps are skipped with a notice, the rest runs, and the build is marked undeployable', (t) => {
  if (!pristine) return t.skip('this project has originals or a contact route: not rewriting its files');
  const r = build('staging', { AW_ALLOW_MISSING_MEDIA: '1' });
  assert.equal(r.code, 0, r.out.slice(-2000));
  assert.match(r.out, /SKIPPED/);
  assert.doesNotMatch(r.out, /legacy-media-stage|rewrite-webp-refs/);
  assert.match(r.out, /every alt says something/, 'the other gates still ran');
  assert.ok(existsSync(at(MEDIA_SKIPPED_MARKER)));
  const marker = JSON.parse(readFileSync(at(MEDIA_SKIPPED_MARKER), 'utf8'));
  assert.match(marker.reason, /cannot be deployed/);

  // ...and the deploy refuses it, before it reads a token or touches Cloudflare.
  const deploy = spawnSync(process.execPath, [at('scripts/deploy-aw.mjs'), 'staging', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(deploy.status, 1);
  assert.match(`${deploy.stdout}${deploy.stderr}`, /SKIPPED the migrated-media steps/);
});

test('a production build with the switch on FAILS before building anything', (t) => {
  if (!pristine) return t.skip('this project has originals or a contact route: not rewriting its files');
  const r = build('production', { AW_ALLOW_MISSING_MEDIA: '1' });
  assert.equal(r.code, 1, r.out.slice(-1500));
  assert.match(r.out, /never allowed|production build/);
});
