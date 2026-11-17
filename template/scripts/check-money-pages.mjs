#!/usr/bin/env node
/**
 * Conversion parity for money pages: no speed, markup or migration change may touch an affiliate or buy
 * link, a product image, a price or a table. The affiliate archetype's launch gate (archetypes.md).
 *
 *   node scripts/check-money-pages.mjs https://staging.example.org /melhor-fogao/ /melhor-geladeira/ --source https://old.example.org
 *   npm run check:money -- <deployed> </page/> … (--source <old site URL> | --source-dir recon/source-html)
 *       [--content ".entry-content"] [--ignore ".related-posts"] [--mask-dates]
 *
 * Compares the DEPLOYED page with the same page on the SOURCE: the old site while it is still up (--source,
 * defaults to `sourceUrl` in aw-migration.json), or HTML you captured before it went (--source-dir: one file
 * per page, `/` → `_.html`, `/a/b/` → `_a_b_.html`, optionally gzipped). Then drives the deployed page in real Chrome.
 *
 *  1. LINKS. Every outbound link in the content area, in order: href, rel, target, text and class identical to
 *     the source (a hashed utility class such as gb-button-1a2b3c4d is ignored). Count and every href.
 *  2. CONTENT. Every table (count, rows, every cell, so prices and specs) and the whole content text identical.
 *  3. BROWSER, at 390 px and 1440 px, after scrolling the whole page: every outbound link is rendered (not
 *     display:none, not zero-size, not transparent, not pointer-events:none, not hidden by an ancestor), and
 *     elementFromPoint at its centre lands on it, so nothing covers it and it is clickable. Every content image
 *     has loaded and is visible. An anchor with no text and no image is counted, not tested (the source has it too).
 *
 * Exits 1 on ANY difference, and prints each. A conversion difference is a stop, not a note.
 *
 *  --content   selector of the content area on both sides (default: .entry-content, then article, then main)
 *  --ignore    comma-separated selectors removed from BOTH sides before comparing, for blocks removed on purpose
 *              (a related-posts widget). Name each one in the PR: it is the only thing allowed to differ
 *  --mask-dates  treat month names (English and Portuguese) and years as equal: for a site whose titles carry
 *              the current month and year, written at request time
 *
 * The comparison runs inside the browser's own HTML parser (DOMParser, no scripts run, nothing fetched), so
 * the script needs no HTML-parsing dependency.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';

const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = ['source', 'source-dir', 'content', 'ignore'];
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const maskDates = argv.includes('--mask-dates');
const consumed = new Set(FLAGS_WITH_VALUE.map(value).filter(Boolean));
const positional = argv.filter((a) => !a.startsWith('--') && !consumed.has(a));
const base = positional.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '');
const paths = positional.filter((a) => a.startsWith('/'));

let manifest = {};
try { manifest = JSON.parse(readFileSync('aw-migration.json', 'utf8')); } catch { /* optional */ }
const sourceUrl = (value('source') ?? (value('source-dir') ? undefined : manifest.sourceUrl))?.replace(/\/$/, '');
const sourceDir = value('source-dir');
if (!base || !paths.length || (!sourceUrl && !sourceDir)) {
  console.error('usage: node scripts/check-money-pages.mjs <https://deployed-host> </money-page/> [</more/> …] (--source <old site URL> | --source-dir <dir>) [--content <selector>] [--ignore <selectors>] [--mask-dates]');
  process.exit(1);
}
const CONTENT = value('content') ?? '.entry-content, article, main';
const IGNORE = (value('ignore') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const OWN_HOSTS = new Set([new URL(base).host, ...[manifest.hosts?.staging, manifest.hosts?.production, manifest.sourceUrl, sourceUrl].filter(Boolean).map((u) => { try { return new URL(u).host; } catch { return ''; } })].filter(Boolean));

async function sourceHtml(path) {
  if (sourceDir) {
    const stem = path === '/' ? '_' : path.replace(/\//g, '_');
    for (const file of [`${sourceDir}/${stem}.html`, `${sourceDir}/${stem}.html.gz`]) {
      if (existsSync(file)) { const raw = readFileSync(file); return file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8'); }
    }
    throw new Error(`no captured source for ${path} in ${sourceDir} (expected ${stem}.html)`);
  }
  const res = await fetch(`${sourceUrl}${path}`, { headers: { 'user-agent': 'Money-Page-Check/1.0' } });
  if (res.status !== 200) throw new Error(`source ${sourceUrl}${path} answered HTTP ${res.status}`);
  return res.text();
}

/* The extraction, run in the page: parse HTML text with DOMParser (inert) and read links, tables and text. */
function extract(html, { content, ignore, own, mask }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector(content);
  if (!root) return { missing: true };
  const area = root.cloneNode(true);
  area.querySelectorAll('script, style, noscript, iframe, form').forEach((n) => n.remove());
  for (const selector of ignore) area.querySelectorAll(selector).forEach((n) => n.remove());
  const norm = (t) => t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\b/g;
  const masked = (t) => (mask ? t.replace(MONTHS, '[month]').replace(/\b20\d\d\b/g, '[year]') : t);
  const ownRe = new RegExp(`^https?://(?:${[...own].map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
  const links = [...area.querySelectorAll('a[href]')].map((a) => ({
    href: (a.getAttribute('href') ?? '').trim(),
    rel: (a.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean).sort().join(' '),
    target: a.getAttribute('target') ?? '',
    text: norm(a.textContent ?? ''),
    cls: (a.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && !/^[a-z-]*button-[0-9a-f]{8}$/.test(c)).sort().join(' '),
  })).filter((l) => /^https?:/i.test(l.href) && !ownRe.test(l.href));
  const tables = [...area.querySelectorAll('table')].flatMap((t) => [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => masked(norm(c.textContent ?? ''))).join(' | ')));
  return { links, tables, text: masked(norm(area.textContent ?? '')) };
}

const problems = [];
const report = [];
const browser = await puppeteer.launch({ headless: true, protocolTimeout: 180000, args: ['--no-sandbox'] });
const parser = await browser.newPage();
await parser.setJavaScriptEnabled(false);
await parser.setContent('<!doctype html><title>parse</title>');
const parse = (html) => parser.evaluate(extract, html, { content: CONTENT, ignore: IGNORE, own: [...OWN_HOSTS], mask: maskDates });

for (const path of paths) {
  const fail = (message) => problems.push(`${path}: ${message}`);
  let source;
  try { source = await sourceHtml(path); } catch (error) { fail(error.message); continue; }
  const res = await fetch(`${base}${path}`, { headers: { 'user-agent': 'Money-Page-Check/1.0' } });
  if (res.status !== 200) { fail(`HTTP ${res.status} on the deployed page`); continue; }
  const [live, old] = [await parse(await res.text()), await parse(source)];
  if (live.missing || old.missing) { fail(`content area "${CONTENT}" not found on the ${live.missing ? 'deployed page' : 'source'}; pass --content`); continue; }

  if (live.links.length !== old.links.length) fail(`${live.links.length} outbound links, source has ${old.links.length}`);
  for (let i = 0; i < Math.min(live.links.length, old.links.length); i += 1) {
    for (const k of ['href', 'rel', 'target', 'text', 'cls']) {
      if (live.links[i][k] !== old.links[i][k]) fail(`link ${i + 1} ${k}: "${live.links[i][k]}" ≠ source "${old.links[i][k]}"`);
    }
  }
  if (JSON.stringify(live.tables) !== JSON.stringify(old.tables)) {
    const at = live.tables.findIndex((row, i) => row !== old.tables[i]);
    fail(`tables differ (${live.tables.length} rows vs source ${old.tables.length}); first difference at row ${at + 1}: "${live.tables[at] ?? ''}" ≠ "${old.tables[at] ?? ''}"`);
  }
  if (live.text !== old.text) fail('content text differs from the source');
  report.push({ path, links: live.links.length, tableRows: live.tables.length, chars: live.text.length });
}
await parser.close();

/* Browser: rendered, clickable and loaded, on both viewports. */
const VIEWPORTS = [['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { width: 1440, height: 900 }]];
for (const [name, viewport] of VIEWPORTS) {
  for (const path of paths) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    try {
      await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}nobadge=1`, { waitUntil: 'load', timeout: 90000 });
    } catch (error) { problems.push(`${path} (${name}): ${error.message}`); await page.close(); continue; }
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } });
    await new Promise((r) => setTimeout(r, 1500));
    const r = await page.evaluate((content, hostList) => {
      const own = new RegExp(`^https?://(?:${hostList.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
      const area = document.querySelector(content);
      if (!area) return { missing: true };
      const links = [...area.querySelectorAll('a[href]')].filter((a) => /^https?:/i.test(a.getAttribute('href')) && !own.test(a.getAttribute('href')));
      const bad = []; let empty = 0;
      for (const a of links) {
        if (!(a.textContent ?? '').trim() && !a.querySelector('img')) { empty += 1; continue; }
        a.scrollIntoView({ block: 'center' });
        const rect = a.getClientRects()[0] ?? a.getBoundingClientRect(); // a link that wraps: its first line box
        const style = getComputedStyle(a);
        const hiddenBy = (() => { for (let e = a; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || e.hidden) return e.className.toString().slice(0, 30) || e.tagName; } return null; })();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const reachable = top && (top === a || a.contains(top));
        if (!rect.width || !rect.height || hiddenBy || style.pointerEvents === 'none' || !reachable) {
          bad.push({ href: a.href.slice(0, 70), text: (a.textContent ?? '').trim().slice(0, 30), size: [Math.round(rect.width), Math.round(rect.height)], hiddenBy, covered: !reachable, by: top ? `${top.tagName}.${top.className.toString().slice(0, 30)}` : null });
        }
      }
      const imgs = [...area.querySelectorAll('img')].filter((i) => i.getAttribute('src'));
      const imgBad = imgs.filter((i) => !i.complete || !i.naturalWidth || !i.getBoundingClientRect().width).map((i) => i.getAttribute('src').slice(-50));
      return { links: links.length, empty, bad, images: imgs.length, imgBad };
    }, CONTENT, [...OWN_HOSTS]);
    await page.close();
    if (r.missing) { problems.push(`${path} (${name}): content area "${CONTENT}" not found`); continue; }
    if (r.bad.length) problems.push(`${path} (${name}): ${r.bad.length} of ${r.links} outbound links not rendered or not clickable: ${JSON.stringify(r.bad.slice(0, 3))}`);
    if (r.imgBad.length) problems.push(`${path} (${name}): ${r.imgBad.length} of ${r.images} content images not loaded/visible: ${r.imgBad.slice(0, 3).join(', ')}`);
    console.log(`${path.padEnd(46)} ${name.padEnd(8)} outbound links ${String(r.links).padStart(3)} (${r.empty} empty anchors) rendered+clickable: ${r.bad.length === 0 ? 'yes' : 'NO'}  | images ${r.images} loaded: ${r.imgBad.length === 0 ? 'yes' : 'NO'}`);
  }
}
await browser.close();
console.log('\nsource comparison:');
for (const r of report) console.log(`  ${r.path.padEnd(46)} ${r.links} outbound links · ${r.tableRows} table rows · ${r.chars} chars of text: identical to the source`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} conversion difference(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\n✓ no conversion difference');
