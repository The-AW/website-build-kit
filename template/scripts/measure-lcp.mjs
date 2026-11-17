#!/usr/bin/env node
/**
 * Observed LCP and CLS in real Chrome on a DEPLOYED site: the speed gate for money pages.
 *
 *   node scripts/measure-lcp.mjs https://staging.example.org /melhor-fogao/ /melhor-geladeira/
 *   npm run lcp -- https://staging.example.org /roundup-one/ /roundup-two/ [--runs 3] [--bar 500] [--json out.json]
 *
 * ── WHAT IT MEASURES, AND WHY NOT LIGHTHOUSE ───────────────────────────────
 * Per page and viewport (1440×900 desktop; 390×844 mobile at DPR 2, touch): one warm-up load so the
 * CDN has the page, then N measured loads (default 3), each in a FRESH incognito context so only the CDN
 * is warm, never the browser cache. No throttling. It reports the MEDIAN observed LCP and CLS (layout shifts
 * with no user input, no scrolling), the LCP element, and TTFB.
 *
 * Lighthouse simulates a slow phone, and its number is a model: on one migration it said 2.2-2.4 s for pages
 * whose real Chrome LCP was 0.33-0.49 s. A site is judged by what a browser observes, so this is the gate; the
 * Lighthouse figure is a recorded note. The public PageSpeed Insights API also answers 429 once its shared
 * anonymous quota is spent, so a launch cannot depend on it.
 *
 * ── THE BAR ────────────────────────────────────────────────────────────────
 * Money pages (the pages that carry the affiliate or buy links: product roundups, comparisons): observed LCP
 * ≤ 500 ms and CLS < 0.1, at BOTH viewports. Exits 1 when any page misses it. Other pages (home, archives) are
 * recorded, not gated: pass them with --record. The result includes THIS machine's connection to the edge; read
 * TTFB beside it. One run in 48 on a real migration was 3,260 ms: the median is the measure, never one run.
 * Measured on that migration: 8 money pages, median LCP 332-488 ms desktop and 332-408 ms mobile, CLS <= 0.011.
 *
 * `--record /path/ …` lists pages that are measured and printed but do not fail the run.
 */
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const argv = process.argv.slice(2);
const value = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const RUNS = Number(value('runs', 3));
const BAR = Number(value('bar', 500));
const CLS_BAR = 0.1;
const JSON_OUT = value('json', null);

/* Positional: first http(s) URL is the base; paths before `--record` are gated, after it recorded. */
const flagArgs = new Set([value('runs', null), value('bar', null), value('json', null)].filter(Boolean));
const positional = [];
let recording = false;
const gated = [];
const recorded = [];
for (const a of argv) {
  if (a === '--record') { recording = true; continue; }
  if (a.startsWith('--') || flagArgs.has(a)) continue;
  positional.push(a);
  if (a.startsWith('/')) (recording ? recorded : gated).push(a);
}
const base = positional.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '');
if (!base || !gated.length) {
  console.error('usage: node scripts/measure-lcp.mjs <https://deployed-host> </money-page/> [</more/> …] [--record </home/> …] [--runs 3] [--bar 500] [--json out.json]');
  process.exit(1);
}

const VIEWPORTS = [
  ['desktop', { width: 1440, height: 900, deviceScaleFactor: 1 }],
  ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 120000, args: ['--no-sandbox'] });

async function once(path, viewport) {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setViewport(viewport);
    await page.evaluateOnNewDocument(() => {
      window.__cls = 0;
      window.__lcp = null;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        const e = list.getEntries().at(-1);
        window.__lcp = { t: e.startTime, el: `${e.element?.tagName ?? '?'}${e.url ? ` ${e.url.split('/').pop()}` : ''}` };
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}nobadge=1`, { waitUntil: 'load', timeout: 90000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await page.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, ttfb: performance.getEntriesByType('navigation')[0].responseStart }));
  } finally {
    await context.close();
  }
}

const rows = [];
let failed = 0;
for (const [path, gate] of [...gated.map((p) => [p, true]), ...recorded.map((p) => [p, false])]) {
  for (const [name, viewport] of VIEWPORTS) {
    await once(path, viewport).catch(() => null); // warm the CDN
    const runs = [];
    // A run can end with no LCP entry (the page was hidden or navigated early): retry it, up to three tries per run.
    for (let i = 0, tries = 0; i < RUNS && tries < RUNS * 3; tries += 1) {
      const r = await once(path, viewport).catch(() => null);
      if (r?.lcp) { runs.push(r); i += 1; }
    }
    if (!runs.length) {
      console.log(`${path.padEnd(46)} ${name.padEnd(8)} no LCP entry in ${RUNS * 3} tries  FAIL`);
      rows.push({ path, viewport: name, gated: gate, error: 'no LCP' });
      if (gate) failed += 1;
      continue;
    }
    const row = {
      path, viewport: name, gated: gate,
      lcpMs: Math.round(median(runs.map((r) => r.lcp.t))),
      lcpRuns: runs.map((r) => Math.round(r.lcp.t)),
      cls: Math.round(median(runs.map((r) => r.cls)) * 1000) / 1000,
      ttfbMs: Math.round(median(runs.map((r) => r.ttfb))),
      element: runs[0].lcp.el,
    };
    row.pass = row.lcpMs <= BAR && row.cls < CLS_BAR;
    rows.push(row);
    if (gate && !row.pass) failed += 1;
    console.log(`${path.padEnd(46)} ${name.padEnd(8)} LCP ${String(row.lcpMs).padStart(4)} ms [${row.lcpRuns.join(', ')}]  CLS ${row.cls}  TTFB ${row.ttfbMs} ms  ${row.element}  ${gate ? (row.pass ? 'PASS' : 'FAIL') : 'recorded'}`);
  }
}
await browser.close();
if (JSON_OUT) writeFileSync(JSON_OUT, `${JSON.stringify({ base, at: new Date().toISOString(), runs: RUNS, barMs: BAR, rows }, null, 1)}\n`);
if (failed) {
  console.error(`\n✗ ${failed} gated page/viewport result(s) miss the bar (median LCP <= ${BAR} ms, CLS < ${CLS_BAR}). A median, not one run: see the runs in brackets.`);
  process.exit(1);
}
console.log(`\n✓ every gated page is at or under ${BAR} ms median LCP, CLS < ${CLS_BAR}, at 1440 and 390 px`);
