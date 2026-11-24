import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MEDIA_SKIPPED_MARKER } from './lib/legacy-media.mjs';
import {
  contactRuntime,
  readMigrationManifest,
  validateMigrationManifest,
  validateWranglerDeployConfig,
} from './lib/aw-migration.mjs';
import { describeGate, readCommit, recordUnmerged, releaseGate, stampArgs } from './lib/release-gate.mjs';

const env = process.argv[2];
const flags = new Set();
/* `--allow-unmerged "<reason>"` (or `--allow-unmerged=<reason>`) carries a value, so it
   is taken out of argv before the plain flags. `null` means it was not given. */
let allowUnmerged = null;
for (let i = 3; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--allow-unmerged') {
    allowUnmerged = process.argv[i + 1] ?? '';
    i++;
  } else if (arg.startsWith('--allow-unmerged=')) {
    allowUnmerged = arg.slice('--allow-unmerged='.length);
  } else {
    flags.add(arg);
  }
}
const dryRun = flags.has('--dry-run');
const confirmProduction = flags.has('--confirm-production');
const reset = '\x1b[0m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';

function refuse(message, errors = []) {
  console.error(`\n${red}✗ ${message}${reset}`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error('');
  process.exit(1);
}

if (!['staging', 'production'].includes(env)) {
  refuse('usage: node scripts/deploy-aw.mjs <staging|production> [--dry-run] [--confirm-production] [--allow-unmerged "<reason>"]');
}
if (env === 'production' && !dryRun && !confirmProduction) {
  refuse('production writes require the explicit --confirm-production command flag. Use --dry-run first.');
}
if (allowUnmerged !== null && (!allowUnmerged.trim() || allowUnmerged.startsWith('--'))) {
  refuse('--allow-unmerged needs a reason: --allow-unmerged "<why production may differ from the default branch>".');
}

/*
 * Production = origin/<default branch> (lib/release-gate.mjs), checked before anything
 * else: the build takes minutes and the answer does not depend on it. A dry-run writes
 * nothing, so it reports what a real deploy would refuse and carries on. Staging may come
 * from any branch and is never gated; it is still stamped with its commit below.
 */
let gate = null;
let unmergedDeploy = false;
if (env === 'production') {
  gate = releaseGate();
  if (!gate.ok) {
    const { headline, lines } = describeGate(gate);
    if (dryRun) {
      console.error(`\n${yellow}! dry-run only — a real deploy would refuse: ${headline}${reset}`);
      for (const line of lines) console.error(`  ${line}`);
      console.error('');
    } else if (allowUnmerged === null) {
      console.error(`\n${red}✗ ${headline}${reset}`);
      for (const line of lines) console.error(`  ${line}`);
      console.error('');
      process.exit(1);
    } else {
      unmergedDeploy = true;
      const target = gate.defaultBranch ? `origin/${gate.defaultBranch}` : 'the default branch';
      console.error(`\n${red}${bold}⚠ ⚠ ⚠  DEPLOYING UNMERGED CODE TO PRODUCTION (--allow-unmerged)  ⚠ ⚠ ⚠${reset}`);
      for (const p of gate.problems) console.error(`${red}  - ${p.what}${reset}`);
      console.error(`${red}  Reason given: ${allowUnmerged}${reset}`);
      console.error(`${red}  Production will NOT equal ${target} until this is merged, pushed and deployed again from it.${reset}`);
      console.error(`${red}  The reason, commit and date are appended to BUILD-STATE.md after the deploy.${reset}\n`);
    }
  } else if (allowUnmerged !== null) {
    console.log(`${dim}--allow-unmerged ignored: HEAD is origin/${gate.defaultBranch}, so there is nothing to record.${reset}`);
  }
} else if (allowUnmerged !== null) {
  console.log(`${dim}--allow-unmerged ignored: staging may deploy from any branch.${reset}`);
}
const commit = gate?.commit ?? readCommit();
const stamp = stampArgs(commit, { unmerged: unmergedDeploy, windowsShell: process.platform === 'win32' });

let manifest;
try {
  manifest = readMigrationManifest();
} catch (error) {
  refuse(error.message);
}
if (existsSync(MEDIA_SKIPPED_MARKER)) {
  refuse('the last build SKIPPED the migrated-media steps (the originals were not available), so it has no images and is not deployable.', [
    `${MEDIA_SKIPPED_MARKER} is present. Build again on a machine that has the originals (npm run build:${env}); a normal build removes it.`,
  ]);
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

const wranglerConfig = contactRuntime(manifest)
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

/* The Workers static-assets file cap is enforced at upload, after the build has spent its minutes. */
run(process.execPath, [fileURLToPath(new URL('./check-file-count.mjs', import.meta.url))], 'static-assets file count');

/* Validate the exact file passed to Wrangler above, after Astro may have emitted
   a runtime config, and immediately before the deploy call below. */
/* The stamp makes the Worker version itself say which commit is live
   (`wrangler versions list`, the dashboard's Deployments tab). */
const deployArgs = ['--no-install', 'wrangler', 'deploy', '--config', wranglerConfig, ...stamp];
if (dryRun) deployArgs.push('--dry-run');
if (!stamp.length) console.log(`${dim}not a git work tree: this deploy carries no commit stamp${reset}`);
run(npx, deployArgs, dryRun ? `${env} Wrangler dry-run` : `${env} Wrangler deploy`);

if (unmergedDeploy) {
  const file = recordUnmerged({ gate, reason: allowUnmerged, worker: target.worker });
  console.error(`\n${red}${bold}⚠ unmerged production deploy recorded in ${file}. Commit and push that record, then merge and deploy again from the default branch to close it.${reset}`);
}

console.log(dryRun
  ? `${dim}✓ no live Worker was changed; production requires --confirm-production for a real deploy${reset}`
  : `${dim}✓ deploy command completed for ${target.worker}${commit.sha ? ` at ${commit.short}${commit.branch ? ` (${commit.branch})` : ''}` : ''}; run the site-specific live smoke checks${reset}`);
