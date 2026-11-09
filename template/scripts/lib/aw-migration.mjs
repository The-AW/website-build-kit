import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const MANIFEST_FILE = 'aw-migration.json';
export const CONFIG_DIR = '.aw';
export const COMPATIBILITY_DATE = '2026-07-01';

export function readMigrationManifest(cwd = process.cwd()) {
  const path = join(cwd, MANIFEST_FILE);
  if (!existsSync(path)) throw new Error(`${MANIFEST_FILE} not found in the project root.`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${MANIFEST_FILE} is not valid JSON: ${error.message}`);
  }
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error(`${MANIFEST_FILE} must declare schemaVersion: 1.`);
  }
  return manifest;
}

const validUrl = (value, { httpsOnly = false } = {}) => {
  try {
    const url = new URL(value);
    if (httpsOnly && url.protocol !== 'https:') return null;
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
};

const placeholderHost = (host) =>
  host.split('.').includes('example') ||
  host.split('.').includes('placeholder') ||
  host === 'example.com' ||
  host.endsWith('.example.com') ||
  host === 'example.org' ||
  host.endsWith('.example.org') ||
  host === 'example.net' ||
  host.endsWith('.example.net') ||
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host.endsWith('.invalid') ||
  host.endsWith('.test') ||
  host.endsWith('.local');

const placeholderWorker = (name) => /(?:template|replace|placeholder|your[-_]?site|example)/i.test(name);
const validWorker = (name) => typeof name === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(name);
const validId = (value) =>
  typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value) && new Set(value.toLowerCase()).size > 1;

export function validateMigrationManifest(manifest, environment, { phase = 'build', cwd = process.cwd() } = {}) {
  const errors = [];
  const add = (message) => errors.push(message);
  if (!['staging', 'production'].includes(environment)) add('Environment must be staging or production.');
  if (!['build', 'deploy'].includes(phase)) add('Phase must be build or deploy.');
  if (!manifest || manifest.schemaVersion !== 1) add(`${MANIFEST_FILE} must declare schemaVersion: 1.`);

  const hosts = manifest?.hosts ?? {};
  const hostUrls = {};
  for (const env of ['staging', 'production']) {
    const url = validUrl(hosts[env], { httpsOnly: true });
    if (!url || url.pathname !== '/' || url.port) {
      add(`hosts.${env} must be an HTTPS origin with no path, credentials, query, fragment, or port.`);
      continue;
    }
    hostUrls[env] = url;
    if (placeholderHost(url.hostname.toLowerCase())) {
      add(`hosts.${env} is still a placeholder (${url.hostname}).`);
    }
  }
  if (hostUrls.staging && hostUrls.production && hostUrls.staging.hostname === hostUrls.production.hostname) {
    add('Staging and production hosts must be different; refusing an environment/host mix-up.');
  }

  const workers = manifest?.targets?.workers ?? {};
  const cloudflareTarget = manifest?.targets?.cloudflare?.[environment] ?? {};
  for (const env of ['staging', 'production']) {
    const name = workers[env];
    if (!validWorker(name)) add(`targets.workers.${env} must be a valid Cloudflare Worker name.`);
    if (placeholderWorker(name ?? '')) add(`targets.workers.${env} is still a placeholder (${name}).`);
  }
  if (workers.staging && workers.production && workers.staging === workers.production) {
    add('Staging and production must use different Worker names.');
  }

  const choice = manifest?.forms?.choice;
  if (!['none', 'private_crm'].includes(choice)) add('forms.choice must be "none" or "private_crm".');
  if (choice === 'private_crm') {
    const contactRoute = join(cwd, 'src/pages/api/contact.ts');
    const crmAdapter = manifest?.forms?.crmAdapter;
    const adapterPath = typeof crmAdapter === 'string' && crmAdapter.trim()
      ? resolve(cwd, crmAdapter)
      : '';
    if (!existsSync(contactRoute)) add('forms.choice is private_crm but src/pages/api/contact.ts is missing.');
    else if (!/submitToExistingCrm\s*\(/.test(readFileSync(contactRoute, 'utf8'))) {
      add('The contact route is still the KV-only draft; it must call the site adapter for AW\'s existing private CRM.');
    }
    if (!adapterPath || !existsSync(adapterPath)) add('forms.choice is private_crm but forms.crmAdapter does not point to the site-specific existing CRM adapter.');
    else if (/NOT_IMPLEMENTED|IMPLEMENT_EXISTING_PRIVATE_CRM/i.test(readFileSync(adapterPath, 'utf8'))) {
      add(`CRM adapter ${crmAdapter} is still the unimplemented template stub.`);
    }
  }

  if (manifest?.template && environment === 'production') {
    add('The untouched starter is not a production release; complete aw-migration.json first.');
  }
  const source = validUrl(manifest?.sourceUrl);
  if (!source || placeholderHost(source.hostname.toLowerCase())) {
    add('sourceUrl must be a real WordPress origin (HTTP or HTTPS), not an example/test host.');
  }
  const repo = validUrl(manifest?.targets?.repositoryUrl, { httpsOnly: true });
  const repoParts = repo?.pathname.split('/').filter(Boolean).map((part) => part.replace(/\.git$/i, '')) ?? [];
  if (!repo || !/github\.com$/i.test(repo.hostname) || repoParts.length !== 2 ||
      repoParts.some((part) => /^(owner|repo|client-site|example|template|placeholder)$/i.test(part))) {
    add('targets.repositoryUrl must identify this site\'s real GitHub owner/repository, not a placeholder.');
  }
  if (environment === 'production' && hostUrls.production && placeholderHost(hostUrls.production.hostname.toLowerCase())) {
    add('A production build cannot use an example, local, test, or invalid hostname.');
  }

  if (phase === 'deploy') {
    if (manifest?.template) add('Deploy refused: the starter manifest is still marked template=true.');
    if (!validId(cloudflareTarget.accountId)) add(`targets.cloudflare.${environment}.accountId must be the 32-character Cloudflare account ID.`);
    if (!validId(cloudflareTarget.zoneId)) add(`targets.cloudflare.${environment}.zoneId must be the 32-character Cloudflare zone ID.`);
    const inventories = manifest?.inventories ?? {};
    const routePath = typeof inventories.routes === 'string' ? resolve(cwd, inventories.routes) : '';
    if (!routePath || !existsSync(routePath)) {
      add('Deploy requires the route inventory named in inventories.routes.');
    } else if (!readFileSync(routePath, 'utf8').split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith('#'))) {
      add('The route inventory must contain at least one inventoried route.');
    }
    const mediaPath = typeof inventories.media === 'string' ? resolve(cwd, inventories.media) : '';
    if (!mediaPath || !existsSync(mediaPath)) {
      add('Deploy requires the media inventory named in inventories.media.');
    } else {
      const mediaLines = readFileSync(mediaPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const columns = (mediaLines[0] ?? '').replace(/^\uFEFF/, '').split(',').map((value) => value.replace(/^"|"$/g, '').trim().toLowerCase());
      const requiredColumns = ['source_url', 'local_path', 'status', 'sha256', 'alt', 'usage'];
      if (requiredColumns.some((column) => !columns.includes(column))) {
        add(`The media inventory must include columns: ${requiredColumns.join(', ')}.`);
      }
      if (mediaLines.length < 2) add('The media inventory must include at least one reviewed asset or explicit no-media row.');
    }
    const redirectPath = typeof inventories.redirects === 'string' ? resolve(cwd, inventories.redirects) : '';
    const redirectRules = new Set();
    if (!redirectPath || !existsSync(redirectPath)) {
      add('Deploy requires the redirect map named in inventories.redirects.');
    } else {
      for (const line of readFileSync(redirectPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [source, destination, status] = trimmed.split(/\s+/);
        if (!source || !destination || !status) {
          add(`Invalid redirect rule in ${inventories.redirects}: ${trimmed}`);
          continue;
        }
        redirectRules.add(`${source} ${destination} ${status}`);
      }
    }
    if (!Array.isArray(inventories.redirectExceptions)) {
      add('inventories.redirectExceptions must be an array of reviewed exceptions.');
    } else {
      const exceptionRules = new Set();
      const allowedStatuses = new Set(['200', '301', '302', '303', '307', '308']);
      inventories.redirectExceptions.forEach((entry, index) => {
        if (!entry || typeof entry.source !== 'string' || !entry.source.trim() ||
            typeof entry.destination !== 'string' || !entry.destination.trim() ||
            typeof entry.reason !== 'string' || !entry.reason.trim() ||
            !allowedStatuses.has(String(entry.status))) {
          add(`inventories.redirectExceptions[${index}] must include source, destination, supported status and reason.`);
          return;
        }
        const rule = `${entry.source} ${entry.destination} ${entry.status}`;
        exceptionRules.add(rule);
        if (!redirectRules.has(rule)) add(`Reviewed redirect exception is missing from ${inventories.redirects}: ${rule}`);
      });
      for (const rule of redirectRules) {
        if (!exceptionRules.has(rule)) add(`Redirect rule is missing from inventories.redirectExceptions: ${rule}`);
      }
    }
    if (environment === 'production') {
      const acceptance = manifest?.acceptance?.criteria;
      if (!Array.isArray(acceptance) || acceptance.length === 0) add('Production deploy requires recorded acceptance.criteria in aw-migration.json.');
      if (!manifest?.acceptance?.recordedBy || !manifest?.acceptance?.recordedAt || Number.isNaN(Date.parse(manifest.acceptance.recordedAt))) {
        add('Production deploy requires acceptance.recordedBy and a valid acceptance.recordedAt timestamp.');
      }
      const rollback = manifest?.rollback ?? {};
      if (!rollback.snapshotPath || !existsSync(resolve(cwd, rollback.snapshotPath))) {
        add('Production deploy requires an existing rollback snapshot at rollback.snapshotPath.');
      }
      if (!validUrl(rollback.wordpressOrigin)) add('Production deploy requires rollback.wordpressOrigin to preserve the WordPress origin.');
      if (!Array.isArray(rollback.restoreSteps) || rollback.restoreSteps.length === 0) {
        add('Production deploy requires rollback.restoreSteps.');
      }
      if (rollback.cloudwaysRetirement?.requested &&
          (!rollback.cloudwaysRetirement.backupVerified || !rollback.cloudwaysRetirement.sharedServerDependenciesChecked)) {
        add('Cloudways retirement is blocked until backupVerified and sharedServerDependenciesChecked are true.');
      }
    }
  }

  const host = hostUrls[environment];
  const worker = workers[environment];
  if (host && validWorker(worker)) {
    const siteUrl = host.origin;
    return {
      ok: errors.length === 0,
      errors,
      siteUrl,
      hostname: host.hostname.toLowerCase(),
      worker,
      accountId: cloudflareTarget.accountId ?? '',
      zoneId: cloudflareTarget.zoneId ?? '',
      environment,
      phase,
    };
  }
  return { ok: false, errors, siteUrl: null, hostname: null, worker: worker ?? null, environment, phase };
}

export function createWranglerConfig(manifest, environment, cwd = process.cwd()) {
  const result = validateMigrationManifest(manifest, environment, { phase: 'build', cwd });
  if (!result.siteUrl || !result.worker) throw new Error(result.errors.join('\n'));
  const runtimeEnabled = manifest.forms.choice === 'private_crm';
  const assetsDirectory = resolve(cwd, runtimeEnabled ? 'dist/client' : 'dist');
  /** @type {Record<string, any>} */
  const config = {
    "$schema": "../node_modules/wrangler/config-schema.json",
    name: result.worker,
    workers_dev: false,
    preview_urls: false,
    compatibility_date: COMPATIBILITY_DATE,
    assets: {
      directory: assetsDirectory,
      ...(runtimeEnabled ? { binding: 'ASSETS' } : {}),
      not_found_handling: runtimeEnabled ? 'none' : '404-page',
      html_handling: 'auto-trailing-slash'
    },
    observability: { enabled: true },
    routes: [{ pattern: result.hostname, custom_domain: true }]
  };
  if (validId(result.accountId)) config.account_id = result.accountId;
  if (runtimeEnabled) config.compatibility_flags = ['nodejs_compat'];
  return config;
}

export function validateWranglerDeployConfig(config, target) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['selected Worker config must be a JSON object.'];
  }
  if (config.account_id !== target.accountId) {
    errors.push(`account_id must match the manifest ${target.environment} account ID (${target.accountId}).`);
  }
  if (config.name !== target.worker) {
    errors.push(`name must match the manifest ${target.environment} Worker (${target.worker}).`);
  }
  const routes = Array.isArray(config.routes) ? config.routes : [];
  if (config.route !== undefined || routes.length !== 1 || routes[0]?.pattern !== target.hostname || routes[0]?.custom_domain !== true) {
    errors.push(`routes must contain exactly one custom-domain route for ${target.hostname}, with no alternate route.`);
  }
  if (config.workers_dev !== false) {
    errors.push('workers_dev must be false so the Worker is not exposed on an alternate workers.dev hostname.');
  }
  if (config.preview_urls !== false) {
    errors.push('preview_urls must be false so the Worker is not exposed on an alternate preview hostname.');
  }
  return errors;
}

export function writeWranglerConfig(manifest, environment, cwd = process.cwd()) {
  const config = createWranglerConfig(manifest, environment, cwd);
  const directory = join(cwd, CONFIG_DIR);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `wrangler-${environment}.jsonc`);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

export function formatTargetErrors(result) {
  return result.errors.map((message) => `  - ${message}`).join('\n');
}
