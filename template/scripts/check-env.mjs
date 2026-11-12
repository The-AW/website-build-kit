import { existsSync, readFileSync } from 'node:fs';
import { leadsEnabledFor, readMigrationManifest, validateMigrationManifest } from './lib/aw-migration.mjs';

const env = process.env.PUBLIC_SITE_ENV;
const reset = '\x1b[0m';
const red = '\x1b[31m';
const green = '\x1b[32m';
const fail = (message, details = []) => {
  console.error(`\n${red}✗ ${message}${reset}`);
  for (const detail of details) console.error(`  - ${detail}`);
  console.error('');
  process.exit(1);
};

if (!['staging', 'production'].includes(env)) {
  fail('PUBLIC_SITE_ENV must be staging or production; refusing an unlabelled build.');
}

let manifest;
try {
  manifest = readMigrationManifest();
} catch (error) {
  fail(error.message);
}
const target = validateMigrationManifest(manifest, env, { phase: 'build' });
if (!target.ok) fail(`invalid ${env} migration target`, target.errors);

const configPath = `.aw/wrangler-${env}.jsonc`;
if (!existsSync(configPath)) fail(`generated ${configPath} is missing; build through scripts/build.mjs.`);
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  fail(`${configPath} is not valid JSON.`);
}

const routes = config.routes ?? [];
if (config.name !== target.worker) {
  fail(`${configPath} names Worker ${JSON.stringify(config.name)}, but ${env} requires ${target.worker}.`);
}
if (routes.length !== 1 || routes[0]?.pattern !== target.hostname || routes[0]?.custom_domain !== true) {
  fail(`${configPath} does not target only the manifest's ${env} hostname ${target.hostname}.`);
}
if (config.workers_dev !== false) {
  fail(`${configPath} must set workers_dev: false to prevent an alternate workers.dev hostname.`);
}
if (config.preview_urls !== false) {
  fail(`${configPath} must set preview_urls: false to prevent alternate preview hostnames.`);
}
if (config.assets?.not_found_handling !== '404-page') {
  fail(`${configPath} must preserve a real 404 with not_found_handling: 404-page.`);
}
if (manifest.forms.choice === 'private_crm') {
  if (config.assets?.binding !== 'ASSETS') {
    fail(`${configPath} must bind assets as ASSETS for prerendered pages in contact runtime mode.`);
  }
  if (!Array.isArray(config.assets?.run_worker_first) || config.assets.run_worker_first.length !== 1 || config.assets.run_worker_first[0] !== '/api/*') {
    fail(`${configPath} must route only /api/* to the Worker before static asset lookup.`);
  }
}
if (manifest.forms.choice === 'none' && (config.kv_namespaces?.length || config.bindings?.some((binding) => binding.type === 'kv_namespace'))) {
  fail('static-only migrations must not carry KV bindings.');
}
if (manifest.forms.choice === 'private_crm') {
  const expectedLeads = leadsEnabledFor(manifest, env) ? 'true' : 'false';
  if (config.vars?.LEADS_ENABLED !== expectedLeads) {
    fail(
      `${configPath} must set vars.LEADS_ENABLED="${expectedLeads}" for the ${env} environment.`,
      env === 'production' && expectedLeads === 'false'
        ? ['Set forms.productionEnabled: true in aw-migration.json only after staging submission is verified and the test record deleted.']
        : [],
    );
  }
}
if (config.name === manifest.targets.workers[env === 'staging' ? 'production' : 'staging']) {
  fail(`${env} config points at the other environment's Worker.`);
}

console.log(`${green}✓${reset} ${env} target verified: ${target.siteUrl} → ${target.worker}; environments use distinct Worker names.`);
