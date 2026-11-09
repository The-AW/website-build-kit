/**
 * Verify that built search directives and canonicals match the declared environment.
 *
 * Runs from build.mjs after the static output and staging headers exist.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const errors = [];
const add = (message) => errors.push(message);

const root = ['dist/client', 'dist'].find((directory) => existsSync(directory));
if (!root) {
  console.error('check-sitemap: no dist/ — run a build first.');
  process.exit(1);
}

const walk = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const htmlFiles = walk(root).filter((file) => file.endsWith('.html'));
const robotsPath = join(root, 'robots.txt');
const headersPath = join(root, '_headers');
const robots = existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : '';
let environment = process.env.PUBLIC_SITE_ENV;
if (!environment) environment = /^Disallow:\s*\/\s*$/mi.test(robots) ? 'staging' : 'production';
if (!['staging', 'production'].includes(environment)) {
  console.error(`check-sitemap: unsupported PUBLIC_SITE_ENV ${JSON.stringify(environment)}.`);
  process.exit(1);
}

let migrationManifest;
if (existsSync('aw-migration.json')) {
  try {
    migrationManifest = JSON.parse(readFileSync('aw-migration.json', 'utf8'));
  } catch {
    add('aw-migration.json is not valid JSON while checking output mode and canonical host.');
  }
}
let expectedSiteUrl = process.env.PUBLIC_SITE_URL?.trim() || migrationManifest?.hosts?.[environment];
const contactRuntime = migrationManifest?.forms?.choice === 'private_crm';
let expectedOrigin = '';
try {
  expectedOrigin = new URL(expectedSiteUrl).origin;
} catch {
  add(`No valid ${environment} site URL is available for canonical/sitemap checks.`);
}

const sitemapFiles = readdirSync(root).filter((file) => /^sitemap.*\.xml$/i.test(file));
const attribute = (tag, name) => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match?.[2] ?? '';
};
const hasNoindex = (html) =>
  [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) =>
    attribute(match[0], 'name').toLowerCase() === 'robots' && /\bnoindex\b/i.test(attribute(match[0], 'content')),
  );
const hasGlobalNoindexHeader = (headers) => {
  let rule = '';
  for (const line of headers.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) {
      rule = line.trim();
      continue;
    }
    if (rule === '/*' && /^\s+X-Robots-Tag:\s*noindex\b/i.test(line)) return true;
  }
  return false;
};
const routeFor = (file) =>
  ('/' + relative(root, file).split(sep).join('/')
    .replace(/index\.html$/, '')
    .replace(/\.html$/, '/'))
    .replace(/\/+/g, '/')
    .replace(/([^/])$/, '$1/');

if (contactRuntime) {
  const pagesRoot = 'src/pages';
  if (!existsSync(pagesRoot)) {
    add('forms.choice private_crm requires src/pages so static routes can be verified.');
  } else {
    const routeFiles = walk(pagesRoot).filter((file) => /\.(?:astro|md|mdx|js|ts)$/.test(file));
    const apiFiles = routeFiles.filter((file) => relative(pagesRoot, file).split(sep).join('/').startsWith('api/'));
    if (!apiFiles.length) add('forms.choice private_crm requires an on-demand API route under src/pages/api/.');
    for (const file of routeFiles) {
      const source = readFileSync(file, 'utf8');
      const route = relative(pagesRoot, file).split(sep).join('/');
      const isApi = route.startsWith('api/');
      const declaration = isApi
        ? /^[ \t]*export\s+const\s+prerender\s*=\s*false\b/m
        : /^[ \t]*export\s+const\s+prerender\s*=\s*true\b/m;
      if (!declaration.test(source)) {
        add(isApi
          ? `${route} must explicitly export prerender = false so its API is served by the Worker.`
          : `${route} must explicitly export prerender = true; only API routes may remain on-demand.`);
      }
    }
  }
  if (!existsSync(join(root, '404.html'))) {
    add(`Hybrid contact mode must include ${root}/404.html as a prerendered asset for Cloudflare's real 404 handling.`);
  }
}

if (!htmlFiles.length) add(`No HTML pages were built under ${root}/.`);
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const canonicalTags = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attribute(tag, 'rel').toLowerCase() === 'canonical');
  const path = routeFor(file);
  if (canonicalTags.length !== 1) {
    add(`${path} must emit exactly one canonical link; found ${canonicalTags.length}.`);
    continue;
  }
  try {
    const canonical = new URL(attribute(canonicalTags[0], 'href'));
    if (canonical.origin !== expectedOrigin) {
      add(`${path} canonical host ${canonical.origin} does not match ${environment} host ${expectedOrigin || '(unset)'}.`);
    }
  } catch {
    add(`${path} canonical URL is missing or invalid.`);
  }
}

const noindexed = htmlFiles
  .filter((file) => hasNoindex(readFileSync(file, 'utf8')))
  .map(routeFor);

if (environment === 'staging') {
  if (sitemapFiles.length) add(`Staging must not emit sitemap files; found ${sitemapFiles.join(', ')}.`);
  if (!robots) add('Staging build must include robots.txt.');
  if (/^Sitemap\s*:/mi.test(robots)) add('Staging robots.txt must not advertise a sitemap.');
  if (!/^Disallow:\s*\/\s*$/mi.test(robots)) add('Staging robots.txt must disallow crawling with "Disallow: /".');
  if (noindexed.length !== htmlFiles.length) {
    const missing = htmlFiles.filter((file) => !hasNoindex(readFileSync(file, 'utf8'))).map(routeFor);
    add(`Every staging HTML page must carry a robots noindex meta tag; missing on ${missing.join(', ') || '(none)'}.`);
  }
  const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
  if (!/^\s*X-Robots-Tag:\s*noindex\b/im.test(headers)) {
    add('Staging _headers must include X-Robots-Tag: noindex on every response.');
  }
  if (!errors.length) {
    console.log(`${GREEN}✓${RESET} staging is noindex: ${htmlFiles.length} HTML pages, robots disallow-all, response header set, no sitemap, canonicals on ${expectedOrigin}${RESET}`);
    process.exit(0);
  }
} else {
  if (!sitemapFiles.length) add('Production build must emit a sitemap.');
  if (!sitemapFiles.includes('sitemap-index.xml')) add('Production build must emit sitemap-index.xml.');
  if (!robots) add('Production build must include robots.txt.');
  if (!/^Allow:\s*\/\s*$/mi.test(robots)) add('Production robots.txt must include "Allow: /".');
  const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
  if (hasGlobalNoindexHeader(headers)) add('Production _headers must not globally apply X-Robots-Tag: noindex.');
  const sitemapDirectives = robots.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^Sitemap\s*:/i.test(line));
  const expectedSitemap = `${expectedSiteUrl?.replace(/\/$/, '')}/sitemap-index.xml`;
  if (sitemapDirectives.length !== 1 || sitemapDirectives[0]?.replace(/^Sitemap\s*:\s*/i, '') !== expectedSitemap) {
    add(`Production robots.txt must reference exactly ${expectedSitemap}.`);
  }

  const listed = new Set();
  for (const file of sitemapFiles) {
    const xml = readFileSync(join(root, file), 'utf8');
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const loc = match[1].trim().replace(/&amp;/g, '&');
      try {
        const url = new URL(loc);
        if (url.origin !== expectedOrigin) {
          add(`${file} URL ${loc} does not use production host ${expectedOrigin || '(unset)'}.`);
        }
        if (/sitemap.*\.xml$/i.test(url.pathname)) {
          const childFile = url.pathname.split('/').filter(Boolean).at(-1);
          if (childFile && !existsSync(join(root, childFile))) add(`${file} references missing sitemap ${loc}.`);
        } else {
          listed.add(url.pathname);
        }
      } catch {
        add(`${file} contains an invalid <loc>: ${loc}`);
      }
    }
  }

  const contradictions = noindexed.filter((path) => listed.has(path));
  if (contradictions.length) {
    add(`${contradictions.length} URL(s) are in the sitemap AND serve noindex: ${contradictions.join(', ')}`);
  }
  if (!errors.length) {
    console.log(`${GREEN}✓${RESET} production sitemap, robots and canonicals use ${expectedOrigin}; ${listed.size} URLs listed, ${noindexed.length} noindex pages, no overlap${RESET}`);
    process.exit(0);
  }
}

console.error(`\n${RED}✗ check-sitemap refused ${environment} build:${RESET}`);
for (const error of errors) console.error(`  - ${error}`);
if (environment === 'production' && noindexed.some((path) => path === '/')) {
  console.error(`${DIM}The scaffold homepage is intentionally noindex until the site replaces the unbuilt page.${RESET}`);
}
console.error('');
process.exit(1);
