import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  readMigrationManifest,
  validateMigrationManifest,
  validateWranglerDeployConfig,
} from './lib/aw-migration.mjs';

const env = process.argv[2];
const flags = new Set(process.argv.slice(3));
const dryRun = flags.has('--dry-run');
const confirmProduction = flags.has('--confirm-production');
const reset = '\x1b[0m';
const red = '\x1b[31m';
const dim = '\x1b[2m';

function refuse(message, errors = []) {
  console.error(`\n${red}✗ ${message}${reset}`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error('');
  process.exit(1);
}

if (!['staging', 'production'].includes(env)) {
  refuse('usage: node scripts/deploy-aw.mjs <staging|production> [--dry-run] [--confirm-production]');
}
if (env === 'production' && !dryRun && !confirmProduction) {
  refuse('production writes require the explicit --confirm-production command flag. Use --dry-run first.');
}

let manifest;
try {
  manifest = readMigrationManifest();
} catch (error) {
  refuse(error.message);
}
const target = validateMigrationManifest(manifest, env, { phase: 'deploy' });
if (!target.ok) refuse(`invalid ${env} target in aw-migration.json`, target.errors);
if (env === 'staging' && target.worker === manifest.targets.workers.production) {
  refuse('staging resolves to the production Worker; refusing to overwrite production.');
}
if (env === 'production' && target.worker === manifest.targets.workers.staging) {
  refuse('production resolves to the staging Worker; refusing to deploy noindex artifacts to production.');
}

const run = (command, args, label) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) refuse(`${label} failed; no later deploy step was attempted.`);
};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(`${dim}${dryRun ? 'dry-run' : 'deploy'} ${env}: ${target.siteUrl} → Worker ${target.worker} (${target.accountId})${reset}`);
/*
 * BYOK token auth is a supported Wrangler path. Prove the configured token before
 * building or deploying; a missing Wrangler OAuth session alone is not a missing API access.
 */
run(npx, ['--no-install', 'wrangler', 'whoami'], 'Wrangler identity check');
run(process.execPath, ['scripts/build.mjs', env], `${env} build`);

const configPath = `.aw/wrangler-${env}.jsonc`;
if (!existsSync(configPath)) refuse(`missing ${configPath} after build.`);
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  refuse(`${configPath} is not valid JSON.`);
}
const sourceConfigErrors = validateWranglerDeployConfig(config, target);
if (sourceConfigErrors.length) {
  refuse(`${configPath} does not match the manifest's ${env} deploy target.`, sourceConfigErrors);
}

const wranglerConfig = manifest.forms.choice === 'private_crm'
  ? 'dist/server/wrangler.json'
  : configPath;
if (!existsSync(wranglerConfig)) refuse(`expected generated deploy config ${wranglerConfig} is missing.`);
let selectedConfig;
try {
  selectedConfig = JSON.parse(readFileSync(wranglerConfig, 'utf8'));
} catch {
  refuse(`selected deploy config ${wranglerConfig} is not valid JSON.`);
}
const selectedConfigErrors = validateWranglerDeployConfig(selectedConfig, target, { requireWorkerEntrypoint: true });
if (selectedConfigErrors.length) {
  refuse(`selected deploy config ${wranglerConfig} does not match the manifest's ${env} target.`, selectedConfigErrors);
}

/* Validate the exact file passed to Wrangler above, after Astro may have emitted
   a runtime config, and immediately before the deploy call below. */
const deployArgs = ['--no-install', 'wrangler', 'deploy', '--config', wranglerConfig];
if (dryRun) deployArgs.push('--dry-run');
run(npx, deployArgs, dryRun ? `${env} Wrangler dry-run` : `${env} Wrangler deploy`);

console.log(dryRun
  ? `${dim}✓ no live Worker was changed; production requires --confirm-production for a real deploy${reset}`
  : `${dim}✓ deploy command completed for ${target.worker}; run the site-specific live smoke checks${reset}`);
