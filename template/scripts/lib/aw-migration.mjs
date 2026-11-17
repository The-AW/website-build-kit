import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const MANIFEST_FILE = 'aw-migration.json';
export const CONFIG_DIR = '.aw';
export const COMPATIBILITY_DATE = '2026-07-01';

/**
 * How the Worker takes its hostname: `targets.cloudflare.<env>.attach`.
 *
 *  - `custom_domain` (default): a Worker custom domain. Cloudflare REPLACES the hostname's DNS record
 *    with a Worker record, so a hostname that already points at the old server cannot take it without
 *    an override, and rolling back means recreating the DNS record (an NXDOMAIN gap, up to the zone's
 *    SOA negative TTL, as much as 30 minutes).
 *  - `route` (the documented default for CUTTING OVER an existing hostname, docs/production-cutover.md):
 *    a zone route `<host>/*` over the EXISTING proxied DNS record. Cutover changes no DNS, and rollback
 *    is deleting the route: the old origin answers again within seconds. Needs the zone id.
 * Exactly one route either way.
 */
export const ATTACH_MODES = ['custom_domain', 'route'];
export function expectedRoute(target) {
  return target.attach === 'route'
    ? { pattern: `${target.hostname}/*`, zone_id: target.zoneId }
    : { pattern: target.hostname, custom_domain: true };
}

/**
 * Contact runtimes (Astro server output, /api/* Worker-first):
 *  - `private_crm`: forward to AW's existing private CRM through a site-written adapter.
 *  - `d1_leads`: store each lead in the site's OWN Cloudflare D1 database (binding LEADS_DB,
 *    schema in migrations/). No CRM and no shared secret. The simple default when no CRM is
 *    required. The runtime pieces ship in the template (src/lib/lead-api.ts and friends); the
 *    site adds one route file and this manifest block.
 */
export const CONTACT_RUNTIME_CHOICES = ['private_crm', 'd1_leads'];
export const contactRuntime = (manifest) => CONTACT_RUNTIME_CHOICES.includes(manifest?.forms?.choice);

/** The two-line route that enables d1_leads (src/lib/lead-route.ts holds the handler). The prerender line is
 *  written out because check-sitemap reads the route file for it: an API route must say it is on-demand. */
export const D1_LEADS_ROUTE = "export const prerender = false;\nexport { POST } from '../../lib/lead-route';";

/**
 * Whether the lead API may accept submissions in this environment (d1_leads and private_crm).
 *
 * Staging is on so the form can be exercised. Production stays closed until
 * `forms.productionEnabled` is true AND `forms.productionAcceptance` records the staging round
 * trip that proves the chain works: the switch and the evidence for throwing it live in the same
 * reviewed file. A closed form renders without a widget and the API answers "unavailable", which
 * is a safe state to ship; a form that looks live and cannot submit is not.
 */
export function leadsEnabledFor(manifest, environment) {
  if (!CONTACT_RUNTIME_CHOICES.includes(manifest?.forms?.choice)) return false;
  if (environment === 'staging') return true;
  return manifest?.forms?.productionEnabled === true;
}

function acceptanceErrors(manifest) {
  const errors = [];
  const acceptance = manifest?.forms?.productionAcceptance;
  if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) {
    return ['forms.productionEnabled is true but forms.productionAcceptance is missing; record the staging acceptance that justifies it.'];
  }
  if (acceptance.stagingSubmissionVerified !== true) {
    errors.push('forms.productionAcceptance.stagingSubmissionVerified must be true: submit the staging form and confirm the lead arrived (the D1 row, or the CRM record for private_crm).');
  }
  if (acceptance.testRecordDeleted !== true) {
    errors.push('forms.productionAcceptance.testRecordDeleted must be true: delete the synthetic record after verifying it.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acceptance.acceptedOn ?? '')) {
    errors.push('forms.productionAcceptance.acceptedOn must be the ISO date (YYYY-MM-DD) of that acceptance.');
  }
  if (typeof acceptance.acceptedBy !== 'string' || !acceptance.acceptedBy.trim()) {
    errors.push('forms.productionAcceptance.acceptedBy must name the person who accepted it.');
  }
  return errors;
}

/**
 * media.legacyUploads (build.md §5b): a migrated WordPress site whose pages use old
 * `/wp-content/uploads/` URLs. The build stages the uploads that pages use, deploys each
 * as one WebP, and the Worker answers the old URLs (`not_found_handling: "none"` plus an
 * asset-miss handler). Off by default: every other site keeps `404-page` and no Worker.
 */
export const usesLegacyUploads = (manifest) => manifest?.media?.legacyUploads === true;
/** Worker entry for a static site with legacy uploads; a site that also runs the contact API owns src/worker.ts. */
export const LEGACY_WORKER_ENTRY = 'src/legacy-worker.ts';
export const SITE_WORKER_ENTRY = 'src/worker.ts';
export const legacyWorkerEntry = (cwd = process.cwd()) =>
  existsSync(resolve(cwd, SITE_WORKER_ENTRY)) ? SITE_WORKER_ENTRY : LEGACY_WORKER_ENTRY;

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
  const attach = cloudflareTarget.attach ?? 'custom_domain';
  if (!ATTACH_MODES.includes(attach)) add(`targets.cloudflare.${environment}.attach must be "custom_domain" or "route".`);
  if (attach === 'route' && !validId(cloudflareTarget.zoneId)) {
    add(`targets.cloudflare.${environment}.zoneId must be the 32-character zone ID: attach "route" binds the route to that zone.`);
  }
  for (const env of ['staging', 'production']) {
    const name = workers[env];
    if (!validWorker(name)) add(`targets.workers.${env} must be a valid Cloudflare Worker name.`);
    if (placeholderWorker(name ?? '')) add(`targets.workers.${env} is still a placeholder (${name}).`);
  }
  if (workers.staging && workers.production && workers.staging === workers.production) {
    add('Staging and production must use different Worker names.');
  }

  const choice = manifest?.forms?.choice;
  if (!['none', ...CONTACT_RUNTIME_CHOICES].includes(choice)) add('forms.choice must be "none", "private_crm" or "d1_leads".');
  if (choice === 'd1_leads') {
    const route = join(cwd, 'src/pages/api/leads.ts');
    if (!existsSync(route)) add(`forms.choice is d1_leads but src/pages/api/leads.ts is missing. Create it with:\n${D1_LEADS_ROUTE}`);
    else if (!/lead-route|handleLeadPost\s*\(/.test(readFileSync(route, 'utf8'))) {
      add('The /api/leads route must use the kit handler (src/lib/lead-route.ts or handleLeadPost) for forms.choice d1_leads; a hand-written route skips the origin, rate-limit and Turnstile checks.');
    }
    if (!existsSync(join(cwd, 'migrations'))) add('forms.choice d1_leads needs the leads schema in migrations/.');
    const siteKey = manifest?.forms?.turnstileSiteKeys?.[environment];
    const db = manifest?.forms?.leadsDatabases?.[environment];
    const namespace = manifest?.forms?.rateLimiterNamespaceIds?.[environment];
    if (leadsEnabledFor(manifest, environment)) {
      if (typeof siteKey !== 'string' || !siteKey.trim()) add(`forms.turnstileSiteKeys.${environment} must contain the public Turnstile site key for that host.`);
      if (!db || typeof db.name !== 'string' || !db.name.trim() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(db.id ?? '')) {
        add(`forms.leadsDatabases.${environment} must name the D1 database (name and id) that stores this environment's leads.`);
      }
    }
    if (typeof namespace !== 'string' || !/^[1-9][0-9]{0,15}$/.test(namespace)) {
      add(`forms.rateLimiterNamespaceIds.${environment} must be a positive integer string, unique in the Cloudflare account (Workers rate limiting namespace_id).`);
    }
    const namespaces = manifest?.forms?.rateLimiterNamespaceIds ?? {};
    if (namespaces.staging && namespaces.staging === namespaces.production) {
      add('forms.rateLimiterNamespaceIds must differ between staging and production, or the two environments share one counter.');
    }
    if (manifest?.forms?.productionEnabled !== undefined && typeof manifest.forms.productionEnabled !== 'boolean') {
      add('forms.productionEnabled must be a boolean.');
    }
    if (manifest?.forms?.productionEnabled === true) {
      for (const error of acceptanceErrors(manifest)) add(error);
      const keys = manifest?.forms?.turnstileSiteKeys ?? {};
      if (keys.production && keys.production === keys.staging) add('forms.turnstileSiteKeys.production must be its own widget, not the staging site key.');
      const dbs = manifest?.forms?.leadsDatabases ?? {};
      if (dbs.production?.id && dbs.production.id === dbs.staging?.id) add('forms.leadsDatabases.production must be its own D1 database, not the staging one.');
    }
  }

  const legacy = manifest?.media?.legacyUploads;
  if (legacy !== undefined && typeof legacy !== 'boolean') add('media.legacyUploads must be true or false.');
  if (legacy === true) {
    if (!existsSync(join(cwd, LEGACY_WORKER_ENTRY)) && !existsSync(join(cwd, SITE_WORKER_ENTRY))) {
      add(`media.legacyUploads is true but neither ${LEGACY_WORKER_ENTRY} nor ${SITE_WORKER_ENTRY} exists: with not_found_handling "none" something must answer an unknown URL.`);
    }
    // The contact runtime is Astro's own Worker; the asset-miss handler has to be wrapped around it by the site.
    if (CONTACT_RUNTIME_CHOICES.includes(choice)) {
      const entry = join(cwd, SITE_WORKER_ENTRY);
      if (!existsSync(entry)) add(`media.legacyUploads with a contact runtime (forms.choice private_crm or d1_leads) needs a site-owned ${SITE_WORKER_ENTRY} that calls legacyRedirect() before Astro's handler (build.md §5b).`);
      else if (!/legacyRedirect\s*\(/.test(readFileSync(entry, 'utf8'))) add(`${SITE_WORKER_ENTRY} must call legacyRedirect() (src/lib/legacy-uploads.ts); without it every old upload URL is a 404.`);
    }
  }
  if (choice === 'private_crm') {
    const leadsRoute = join(cwd, 'src/pages/api/leads.ts');
    const crmAdapter = manifest?.forms?.crmAdapter;
    const adapterPath = typeof crmAdapter === 'string' && crmAdapter.trim()
      ? resolve(cwd, crmAdapter)
      : '';
    if (!existsSync(leadsRoute)) add('forms.choice is private_crm but src/pages/api/leads.ts is missing.');
    else if (!/submitToExistingCrm\s*\(/.test(readFileSync(leadsRoute, 'utf8'))) {
      add('The /api/leads route must call the site adapter for AW\'s existing private CRM; the isolated KV-only draft is not valid.');
    }
    if (!adapterPath || !existsSync(adapterPath)) add('forms.choice is private_crm but forms.crmAdapter does not point to the site-specific existing CRM adapter.');
    else if (/NOT_IMPLEMENTED|IMPLEMENT_EXISTING_PRIVATE_CRM/i.test(readFileSync(adapterPath, 'utf8'))) {
      add(`CRM adapter ${crmAdapter} is still the unimplemented template stub.`);
    }
    if (manifest?.forms?.productionEnabled !== undefined && typeof manifest.forms.productionEnabled !== 'boolean') {
      add('forms.productionEnabled must be a boolean.');
    }
    if (environment === 'production' && manifest?.forms?.productionEnabled === true) {
      for (const error of acceptanceErrors(manifest)) add(error);
    }
    if (environment === 'production' && manifest?.forms?.productionEnabled !== true) {
      add('forms.productionEnabled must be true to build a production lead-capture form; set it only after staging submission is verified and the test record deleted.');
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
      attach: ATTACH_MODES.includes(attach) ? attach : 'custom_domain',
      environment,
      phase,
      runtimeEnabled: CONTACT_RUNTIME_CHOICES.includes(choice),
      choice,
      leadsEnabled: leadsEnabledFor(manifest, environment),
      legacyUploads: usesLegacyUploads(manifest),
    };
  }
  return {
    ok: false,
    errors,
    siteUrl: null,
    hostname: null,
    worker: worker ?? null,
    environment,
    phase,
    runtimeEnabled: CONTACT_RUNTIME_CHOICES.includes(choice),
    choice,
    leadsEnabled: leadsEnabledFor(manifest, environment),
    legacyUploads: usesLegacyUploads(manifest),
  };
}

export function createWranglerConfig(manifest, environment, cwd = process.cwd()) {
  const result = validateMigrationManifest(manifest, environment, { phase: 'build', cwd });
  if (!result.siteUrl || !result.worker) throw new Error(result.errors.join('\n'));
  const runtimeEnabled = contactRuntime(manifest);
  const legacy = usesLegacyUploads(manifest);
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
      ...(runtimeEnabled
        ? { binding: 'ASSETS', run_worker_first: ['/api/*'] }
        : legacy ? { binding: 'ASSETS' } : {}),
      // "none" only with the asset-miss handler (src/lib/legacy-uploads.ts), which serves the real 404.
      not_found_handling: legacy ? 'none' : '404-page',
      html_handling: 'auto-trailing-slash',
    },
    observability: { enabled: true },
    routes: [expectedRoute(result)]
  };
  if (validId(result.accountId)) config.account_id = result.accountId;
  if (runtimeEnabled) config.compatibility_flags = ['nodejs_compat'];
  if (manifest.forms.choice === 'd1_leads') {
    config.vars = {
      LEADS_ENABLED: leadsEnabledFor(manifest, environment) ? 'true' : 'false',
      LEADS_ALLOWED_ORIGINS: result.siteUrl,
      TURNSTILE_ALLOWED_HOSTNAME: result.hostname,
    };
    // This environment's own leads database (migrations/ holds the schema). Secrets are never here.
    const leadsDb = manifest.forms.leadsDatabases?.[environment];
    if (leadsDb?.id) {
      config.d1_databases = [{ binding: 'LEADS_DB', database_name: leadsDb.name, database_id: leadsDb.id, migrations_dir: '../migrations' }];
    }
    config.ratelimits = [{ name: 'LEADS_RATE_LIMITER', namespace_id: manifest.forms.rateLimiterNamespaceIds[environment], simple: { limit: 10, period: 60 } }];
  }
  if (manifest.forms.choice === 'private_crm') {
    // The Worker reads this to keep a production form closed until forms.productionEnabled is accepted.
    config.vars = { LEADS_ENABLED: leadsEnabledFor(manifest, environment) ? 'true' : 'false' };
  }
  // Relative to the generated file in .aw/.
  if (legacy) config.main = `../${legacyWorkerEntry(cwd)}`;
  return config;
}

export function validateWranglerDeployConfig(config, target, { requireWorkerEntrypoint = false } = {}) {
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
  if (config.route !== undefined || routes.length !== 1 || JSON.stringify(routes[0]) !== JSON.stringify(expectedRoute(target))) {
    errors.push(target.attach === 'route'
      ? `routes must contain exactly one zone route ${target.hostname}/* (zone ${target.zoneId}), with no alternate route.`
      : `routes must contain exactly one custom-domain route for ${target.hostname}, with no alternate route.`);
  }
  if (config.workers_dev !== false) {
    errors.push('workers_dev must be false so the Worker is not exposed on an alternate workers.dev hostname.');
  }
  if (config.preview_urls !== false) {
    errors.push('preview_urls must be false so the Worker is not exposed on an alternate preview hostname.');
  }
  if (target.legacyUploads) {
    const assets = config.assets ?? {};
    if (assets.binding !== 'ASSETS') errors.push('assets.binding must be ASSETS so the asset-miss handler can serve the 404 page and probe deployed uploads.');
    if (assets.not_found_handling !== 'none') errors.push('media.legacyUploads needs assets.not_found_handling "none": the Worker answers old upload and attachment URLs, and serves the real 404 itself.');
    if (typeof config.main !== 'string' || !config.main.trim()) errors.push('media.legacyUploads needs a Worker entrypoint (main): src/legacy-worker.ts, or a site-owned src/worker.ts.');
  } else if (config.assets?.not_found_handling !== '404-page') {
    errors.push('assets.not_found_handling must be 404-page to preserve a real static 404 response.');
  }
  if (target.runtimeEnabled) {
    const assets = config.assets ?? {};
    const workerFirst = assets.run_worker_first;
    if (assets.binding !== 'ASSETS') {
      errors.push('assets.binding must be ASSETS for the Astro Worker to serve its prerendered pages.');
    }
    if (!Array.isArray(workerFirst) || workerFirst.length !== 1 || workerFirst[0] !== '/api/*') {
      errors.push('assets.run_worker_first must be exactly ["/api/*"] so only on-demand API routes reach Astro first.');
    }
    if (requireWorkerEntrypoint && (typeof config.main !== 'string' || !config.main.trim())) {
      errors.push('selected server deploy config must include the Astro Worker main entrypoint.');
    }
  }
  if (target.choice === 'd1_leads') {
    const vars = config.vars ?? {};
    const expectedEnabled = target.leadsEnabled ? 'true' : 'false';
    if (vars.LEADS_ENABLED !== expectedEnabled) {
      errors.push(target.leadsEnabled
        ? `vars.LEADS_ENABLED must be "true" for ${target.environment}: forms.productionEnabled is set with a recorded acceptance.`
        : `vars.LEADS_ENABLED must keep ${target.environment} closed; set forms.productionEnabled with forms.productionAcceptance to open it.`);
    }
    if (vars.LEADS_ALLOWED_ORIGINS !== `https://${target.hostname}` || vars.TURNSTILE_ALLOWED_HOSTNAME !== target.hostname) {
      errors.push('Form origin and Turnstile hostname vars must match this environment’s exact site host.');
    }
    if (['TURNSTILE_SECRET_KEY', 'LEADS_RATE_LIMIT_HMAC_SECRET', 'LEADS_INGESTION_SECRET'].some((name) => name in vars)) {
      errors.push('Worker secrets must not be stored in Wrangler vars.');
    }
    if (Object.keys(vars).some((name) => /^LEADS_INGESTION/.test(name))) {
      errors.push('forms.choice d1_leads stores leads in D1; CRM ingestion vars must not be configured.');
    }
    const leadsDb = (config.d1_databases ?? []).find((d) => d?.binding === 'LEADS_DB');
    if (target.leadsEnabled && (!leadsDb || typeof leadsDb.database_id !== 'string' || !leadsDb.database_id)) {
      errors.push('d1_leads with LEADS_ENABLED needs a LEADS_DB D1 binding for this environment.');
    }
    const limits = config.ratelimits ?? [];
    if (limits.length !== 1 || limits[0]?.name !== 'LEADS_RATE_LIMITER' || limits[0]?.simple?.limit !== 10 ||
        limits[0]?.simple?.period !== 60 || typeof limits[0]?.namespace_id !== 'string') {
      errors.push('ratelimits must bind LEADS_RATE_LIMITER at 10 requests per 60 seconds.');
    }
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
