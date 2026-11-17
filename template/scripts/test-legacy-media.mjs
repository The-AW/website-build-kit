/**
 * The migrated-media tools, end to end, on a fixture with `media.legacyUploads: true`
 * (build.md §5b).
 *
 *   npm run test:legacy-media
 *
 * Builds a small "migrated" site in a temp directory: pages that reference old
 * `/wp-content/uploads/` URLs, the originals outside `public/`, and the manifest flag on. Then
 * runs the real pipeline over it (stage → measure → convert → link → rewrite → checks) and the
 * real generated Worker under `wrangler dev --local`. It asserts what a site depends on:
 *
 *  - only the uploads the pages use are staged and deployed; originals are untouched
 *  - each used PNG/JPG is one WebP sized from the measured width; GIF and favicon stay as they are
 *  - every reference is rewritten, the first image is eager with fetchpriority, `height` follows the WebP
 *  - a repeat run converts nothing; a dangling reference, a missing original and a full disk each FAIL
 *  - the file-count gate refuses over the cap
 *  - the Worker: an old URL is ONE 301 to a file that serves 200; an unknown URL is a REAL 404
 *    (status, not just body), for pages, uploads and HEAD
 *  - with the flag off the generated config is the kit's own (`404-page`, no Worker)
 *
 * The browser step (measure-image-widths) skips with a reason when no Chrome is installed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWranglerConfig, validateMigrationManifest, validateWranglerDeployConfig } from './lib/aw-migration.mjs';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(TEMPLATE, 'scripts');
const UP = 'wp-content/uploads/2024/01';
const ID = '1234567890abcdef1234567890abcdef';
const ZONE = 'abcdef1234567890abcdef1234567890';

const manifest = (legacyUploads) => ({
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
  media: { legacyUploads },
  forms: { choice: 'none', crmAdapter: '' },
});

const run = (cwd, script, args = [], env = {}) => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(SCRIPTS, script), ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const photo = (w, h, channels = 3) => {
  const data = Buffer.alloc(w * h * channels);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 7 + ((i / channels / w) | 0) * 13 + Math.random() * 40) & 255;
  return { data, info: { width: w, height: h, channels } };
};

let dir;
let pngBytes;
const originals = {};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kit-legacy-'));
  const put = (rel, body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put('aw-migration.json', JSON.stringify(manifest(true)));

  // The originals, outside public/ and outside Git: what the old site's media library held.
  const src = (name) => join(dir, 'media/source/legacy', UP, name);
  const make = async (name, w, h, kind, channels = 3) => {
    const { data, info } = photo(w, h, channels);
    mkdirSync(dirname(src(name)), { recursive: true });
    await sharp(data, { raw: info })[kind]().toFile(src(name));
    originals[name] = createHash('sha256').update(readFileSync(src(name))).digest('hex');
  };
  await make('hero.png', 1200, 800, 'png');
  await make('product.png', 600, 400, 'png', 4);   // alpha
  await make('bg.jpg', 1500, 500, 'jpeg');
  await make('unused.png', 900, 600, 'png');       // in the library, on no page
  await make('cropped-icon-32x32.png', 32, 32, 'png');
  mkdirSync(dirname(src('anim.gif')), { recursive: true });
  await sharp(photo(40, 40, 3).data, { raw: { width: 40, height: 40, channels: 3 } }).gif().toFile(src('anim.gif'));
  originals['anim.gif'] = createHash('sha256').update(readFileSync(src('anim.gif'))).digest('hex');
  pngBytes = statSync(src('hero.png')).size;

  // The BUILT site: what `astro build` emitted, with old URLs in every place one can hide.
  const page = (body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<link rel="icon" href="/${UP}/cropped-icon-32x32.png">
<meta property="og:image" content="https://staging.client.co.uk/${UP}/hero.png">
<script type="application/ld+json">{"@type":"Article","image":"https://old-client.org/${UP}/hero.png"}</script>
<link rel="stylesheet" href="/_astro/site.css">${head}</head><body><header><img src="/${UP}/anim.gif" width="40" height="40" alt=""></header><main>${body}</main></body></html>`;
  put('dist/index.html', page(`<img src="/${UP}/hero.png" srcset="/${UP}/hero-300x200.png 300w, /${UP}/hero.png 1200w" sizes="300px" width="300" height="200" alt="hero" loading="lazy"><p class="bg">x</p>`));
  put('dist/post/index.html', page(`<img src="/${UP}/product-150x100.png" width="150" height="150" alt="product" loading="lazy"><img src="/${UP}/product.png" width="150" height="100" alt="p2" loading="lazy">`));
  put('dist/_astro/site.css', `.bg{background-image:url(/${UP}/bg.jpg)}`);
  put('dist/404.html', '<!doctype html><html><head><title>404</title></head><body><main>Fixture not found page</main></body></html>');
  put('dist/sitemap.xml', '<urlset></urlset>');

  // The worker and what it imports, exactly as the template ships them.
  for (const f of ['src/legacy-worker.ts', 'src/lib/legacy-uploads.ts', 'src/lib/upload-fallback.ts']) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(TEMPLATE, f), join(dir, f));
  }
  put('src/data/attachment-redirects.json', JSON.stringify({ '/hero-attachment/': '/post/' }));
  put('public/_headers', '/wp-content/uploads/*\n  Cache-Control: public, max-age=31536000, immutable\n');
});

// Best effort: on Windows a just-stopped workerd can hold the directory for a moment.
after(() => { try { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* a temp directory is not an assertion */ } });

const chromeAvailable = (() => {
  try {
    const probe = "import('puppeteer').then(async (p) => { const { existsSync } = await import('node:fs'); process.stdout.write(existsSync(p.default.executablePath()) ? 'chrome' : 'none'); }).catch(() => process.stdout.write('none'))";
    return spawnSync(process.execPath, ['-e', probe], { cwd: TEMPLATE, encoding: 'utf8' }).stdout === 'chrome';
  } catch { return false; }
})();

test('stage: only the uploads pages use are staged, as hard links; the originals are untouched', () => {
  const r = run(dir, 'legacy-media-stage.mjs');
  assert.equal(r.code, 0, r.out);
  const staged = (name) => join(dir, '.aw/legacy-src', UP, name);
  for (const used of ['hero.png', 'product.png', 'bg.jpg', 'anim.gif', 'cropped-icon-32x32.png']) assert.ok(existsSync(staged(used)), `${used} staged`);
  assert.equal(existsSync(staged('unused.png')), false, 'an upload no page uses is not staged');
  // A hard link: same inode as the original, no extra bytes.
  assert.equal(statSync(staged('hero.png')).ino, statSync(join(dir, 'media/source/legacy', UP, 'hero.png')).ino);
  const list = JSON.parse(readFileSync(join(dir, '.aw/legacy-used.json'), 'utf8'));
  // hero-300x200.png and product-150x100.png were never downloaded: they stand for their originals.
  assert.deepEqual(list.paths.map((p) => p.split('/').pop()).sort(), ['anim.gif', 'bg.jpg', 'cropped-icon-32x32.png', 'hero.png', 'product.png']);
  assert.deepEqual(list.missing, []);
});

test('measure: the rendered width of each upload image comes from the built pages (real Chrome)', { skip: chromeAvailable ? false : 'no Chrome for puppeteer (npx puppeteer browsers install chrome)' }, () => {
  const r = run(dir, 'measure-image-widths.mjs', ['dist']);
  assert.equal(r.code, 0, r.out);
  const widths = JSON.parse(readFileSync(join(dir, 'src/data/image-render-widths.json'), 'utf8'));
  assert.equal(widths[`/${UP}/hero.png`], 300);
  assert.equal(widths[`/${UP}/product.png`], 150);
});

test('convert: one WebP per raster, ~2x the measured width, alpha kept; GIF and favicon as they are', async () => {
  if (!chromeAvailable) writeFileSync(join(dir, 'src/data/image-render-widths.json'), JSON.stringify({ [`/${UP}/hero.png`]: 300, [`/${UP}/product.png`]: 150 }));
  const r = run(dir, 'webp-legacy-media.mjs');
  assert.equal(r.code, 0, r.out);
  const deployed = (name) => join(dir, '.aw/legacy-media', UP, name);
  const hero = await sharp(deployed('hero.webp')).metadata();
  assert.equal(hero.format, 'webp');
  assert.equal(hero.width, 600, 'about 2x the measured 300px, from a 1200px original');
  assert.ok(statSync(deployed('hero.webp')).size < pngBytes, 'smaller than the PNG it replaces');
  const product = await sharp(deployed('product.webp')).metadata();
  assert.equal(product.width, 300);
  assert.equal(product.hasAlpha, true, 'alpha kept');
  const bg = await sharp(deployed('bg.webp')).metadata();
  assert.equal(bg.width, 1500, 'never measured, never upscaled: the 1600 cap does not enlarge a 1500px original');
  assert.equal(createHash('sha256').update(readFileSync(deployed('anim.gif'))).digest('hex'), originals['anim.gif'], 'GIF byte for byte');
  assert.ok(existsSync(deployed('cropped-icon-32x32.png')), 'favicon PNG stays PNG');
  assert.equal(existsSync(deployed('hero.png')), false, 'the original PNG is not deployed');
  assert.equal(existsSync(deployed('unused.webp')), false);
  // The originals are never modified.
  for (const [name, sha] of Object.entries(originals)) {
    assert.equal(createHash('sha256').update(readFileSync(join(dir, 'media/source/legacy', UP, name))).digest('hex'), sha, `${name} untouched`);
  }
});

test('convert: a repeat run converts nothing (content-hash cache)', () => {
  const r = run(dir, 'webp-legacy-media.mjs');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\(0 new, 3 from cache\)/);
});

test('link, rewrite and checks: every reference points at a deployed file', () => {
  let r = run(dir, 'link-legacy-media.mjs', ['dist']);
  assert.equal(r.code, 0, r.out);
  assert.equal(statSync(join(dir, 'dist', UP, 'hero.webp')).ino, statSync(join(dir, '.aw/legacy-media', UP, 'hero.webp')).ino, 'hard-linked into dist, not copied');
  r = run(dir, 'rewrite-webp-refs.mjs', ['dist']);
  assert.equal(r.code, 0, r.out);

  const home = readFileSync(join(dir, 'dist/index.html'), 'utf8');
  assert.doesNotMatch(home, /\.(?:png|jpe?g)\b(?<!cropped-icon-32x32\.png)/i, 'no PNG/JPG reference left (the favicon stays)');
  assert.match(home, new RegExp(`<meta property="og:image" content="https://staging\\.client\\.co\\.uk/${UP}/hero\\.webp">`));
  assert.match(home, new RegExp(`"image":"https://old-client\\.org/${UP}/hero\\.webp"`), 'JSON-LD');
  assert.match(readFileSync(join(dir, 'dist/_astro/site.css'), 'utf8'), new RegExp(`url\\(/${UP}/bg\\.webp\\)`), 'CSS url()');
  // Both srcset candidates are the same file now: one candidate drops srcset and sizes; height follows the WebP's aspect.
  const img = /<img src="[^"]*hero\.webp"[^>]*>/.exec(home)[0];
  assert.doesNotMatch(img, /srcset|sizes/);
  assert.match(img, /height="200"/);
  assert.match(img, /fetchpriority="high"/, 'the first image in <main> is the LCP candidate');
  assert.doesNotMatch(img, /loading="lazy"/);
  // Below the first image stays lazy; the 150x150 box is corrected to the 3:2 file.
  const post = readFileSync(join(dir, 'dist/post/index.html'), 'utf8');
  const [first, second] = post.match(/<img [^>]*>/g).filter((t) => /product/.test(t));
  assert.match(first, /product\.webp/, 'a never-downloaded -WxH variant goes straight to the original\'s WebP');
  assert.match(first, /height="100"/);
  assert.match(first, /fetchpriority="high"/);
  assert.match(second, /loading="lazy"/);
  assert.doesNotMatch(second, /fetchpriority/);

  // Staging a finished (rewritten) dist again finds the same originals instead of reporting them missing.
  r = run(dir, 'legacy-media-stage.mjs', ['dist']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /5 original files used/);

  r = run(dir, 'check-file-count.mjs', ['dist']);
  assert.equal(r.code, 0, r.out);
  r = run(dir, 'check-legacy-media.mjs', ['dist']);
  assert.equal(r.code, 0, r.out);
});

test('rewrite refuses a reference to a file that is not deployed', () => {
  const html = readFileSync(join(dir, 'dist/post/index.html'), 'utf8');
  writeFileSync(join(dir, 'dist/post/index.html'), html.replace('</main>', `<img src="/${UP}/ghost.gif" alt=""></main>`));
  const r = run(dir, 'rewrite-webp-refs.mjs', ['dist']);
  writeFileSync(join(dir, 'dist/post/index.html'), html);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ghost\.gif.*not in dist/);
});

test('stage refuses a page that names an upload with no original, and an altered original', () => {
  const html = readFileSync(join(dir, 'dist/post/index.html'), 'utf8');
  writeFileSync(join(dir, 'dist/post/index.html'), html.replace('</main>', `<img src="/${UP}/ghost.png" alt=""></main>`));
  let r = run(dir, 'legacy-media-stage.mjs', ['dist']);
  writeFileSync(join(dir, 'dist/post/index.html'), html);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ghost\.png.*no such original/);

  mkdirSync(join(dir, 'recon'), { recursive: true });
  writeFileSync(join(dir, 'recon/media.csv'), `source_url,sha256\nhttps://old-client.org/${UP}/hero.png,${'0'.repeat(64)}\n`, { flag: 'w' });
  r = run(dir, 'legacy-media-stage.mjs', ['dist']);
  rmSync(join(dir, 'recon/media.csv'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /bytes differ/);
});

test('the free-disk guard refuses below its floor instead of copying into a full disk', () => {
  for (const script of ['legacy-media-stage.mjs', 'webp-legacy-media.mjs', 'link-legacy-media.mjs']) {
    const r = run(dir, script, ['dist'], { LEGACY_MEDIA_MIN_FREE_GB: '999999999' });
    assert.equal(r.code, 1, `${script}: ${r.out}`);
    assert.match(r.out, /below the .* floor/);
  }
});

test('the file-count gate refuses above the cap', () => {
  const r = run(dir, 'check-file-count.mjs', ['dist', '--limit=3']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /over the 3-file cap/);
});

test('check-legacy-media refuses a missing 404 page, an attachment chain and a missing immutable rule', () => {
  const fix = (name, body) => writeFileSync(join(dir, name), body);
  const original404 = readFileSync(join(dir, 'dist/404.html'), 'utf8');
  rmSync(join(dir, 'dist/404.html'));
  let r = run(dir, 'check-legacy-media.mjs', ['dist']);
  fix('dist/404.html', original404);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /404\.html is missing/);

  const map = readFileSync(join(dir, 'src/data/attachment-redirects.json'), 'utf8');
  fix('src/data/attachment-redirects.json', JSON.stringify({ '/a/': '/b/', '/b/': '/post/' }));
  r = run(dir, 'check-legacy-media.mjs', ['dist']);
  fix('src/data/attachment-redirects.json', map);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /two hops/);

  const headers = readFileSync(join(dir, 'public/_headers'), 'utf8');
  fix('public/_headers', '/*\n  X-Test: 1\n');
  r = run(dir, 'check-legacy-media.mjs', ['dist']);
  fix('public/_headers', headers);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /immutable/);
});

test('manifest: the flag is validated and drives the generated Worker config', () => {
  const on = createWranglerConfig(manifest(true), 'staging', dir);
  assert.equal(on.assets.not_found_handling, 'none');
  assert.equal(on.assets.binding, 'ASSETS');
  assert.equal(on.main, '../src/legacy-worker.ts');
  assert.equal(on.assets.run_worker_first, undefined, 'asset-first: only a miss reaches the Worker');

  // Off (the default): the kit's own config — a static 404 page and no Worker.
  const off = createWranglerConfig(manifest(false), 'staging', dir);
  assert.equal(off.assets.not_found_handling, '404-page');
  assert.equal(off.main, undefined);
  assert.equal(off.assets.binding, undefined);

  const target = (m) => validateMigrationManifest(m, 'staging', { phase: 'build', cwd: dir });
  assert.equal(target(manifest(true)).ok, true, target(manifest(true)).errors.join('; '));
  assert.match(target({ ...manifest(true), media: { legacyUploads: 'yes' } }).errors.join('; '), /must be true or false/);
  // The flag needs something that answers an unknown URL.
  const bare = mkdtempSync(join(tmpdir(), 'kit-legacy-bare-'));
  assert.match(validateMigrationManifest(manifest(true), 'staging', { phase: 'build', cwd: bare }).errors.join('; '), /neither src\/legacy-worker\.ts nor src\/worker\.ts exists/);
  rmSync(bare, { recursive: true, force: true });

  // A deploy config must agree with the flag in both directions.
  const t = { ...target(manifest(true)), accountId: ID };
  const ok = { ...on, account_id: ID };
  assert.deepEqual(validateWranglerDeployConfig(ok, t), []);
  assert.match(validateWranglerDeployConfig({ ...ok, assets: { ...ok.assets, not_found_handling: '404-page' } }, t).join('; '), /needs assets\.not_found_handling "none"/);
  assert.match(validateWranglerDeployConfig({ ...ok, main: undefined }, t).join('; '), /needs a Worker entrypoint/);
  const tOff = { ...target(manifest(false)), accountId: ID };
  assert.match(validateWranglerDeployConfig({ ...off, account_id: ID, assets: { ...off.assets, not_found_handling: 'none' } }, tOff).join('; '), /must be 404-page/);
});

// ── The real Worker ────────────────────────────────────────────────────────────

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

test('Worker: old URLs are one 301 to a file that serves; an unknown URL is a real 404', async (t) => {
  const wrangler = join(TEMPLATE, 'node_modules/wrangler/bin/wrangler.js');
  if (!existsSync(wrangler)) return t.skip('wrangler is not installed (npm ci in template/)');
  mkdirSync(join(dir, '.aw'), { recursive: true });
  const config = { ...createWranglerConfig(manifest(true), 'staging', dir), account_id: undefined };
  config.assets.directory = join(dir, 'dist');
  writeFileSync(join(dir, '.aw/wrangler-staging.jsonc'), JSON.stringify(config, null, 2));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [wrangler, 'dev', '--config', '.aw/wrangler-staging.jsonc', '--local', '--port', String(port), '--ip', '127.0.0.1'], {
    cwd: dir, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  });
  // wrangler spawns workerd as a child; on Windows killing the parent leaves it running, so take the tree.
  t.after(() => new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else server.kill();
    setTimeout(resolve, 5000);
  }));
  let up = false;
  for (let i = 0; i < 90 && !up; i += 1) {
    try { up = (await fetch(`${base}/`)).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  assert.ok(up, 'wrangler dev did not start');
  const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });

  await t.test('a deployed page and image are served from assets, 200', async () => {
    assert.equal((await get('/')).status, 200);
    const img = await get(`/${UP}/hero.webp`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/webp');
  });

  await t.test('the old PNG URL is ONE 301 to the WebP, which serves 200', async () => {
    const res = await get(`/${UP}/hero.png`);
    assert.equal(res.status, 301);
    const target = new URL(res.headers.get('location'), base);
    assert.equal(target.pathname, `/${UP}/hero.webp`);
    assert.equal((await get(target.pathname)).status, 200, 'the target is not itself redirected');
  });

  await t.test('a -WxH variant that was never deployed 301s to the original\'s WebP', async () => {
    const res = await get(`/${UP}/hero-768x512.png`);
    assert.equal(res.status, 301);
    assert.equal(new URL(res.headers.get('location'), base).pathname, `/${UP}/hero.webp`);
    const scaled = await get(`/${UP}/bg-scaled.jpg`);
    assert.equal(scaled.status, 301);
    assert.equal(new URL(scaled.headers.get('location'), base).pathname, `/${UP}/bg.webp`);
  });

  await t.test('an old attachment page 301s to its parent post', async () => {
    const res = await get('/hero-attachment/');
    assert.equal(res.status, 301);
    assert.equal(new URL(res.headers.get('location'), base).pathname, '/post/');
  });

  await t.test('REAL 404: an unknown page returns status 404 with the 404 page', async () => {
    for (const path of ['/no-such-page/', '/no-such-page', '/deep/er/missing/']) {
      const res = await get(path);
      assert.equal(res.status, 404, `${path} must be a 404, not a 200 with a 404 body`);
      assert.match(await res.text(), /Fixture not found page/);
    }
  });

  await t.test('REAL 404: an unknown upload, a variant of an unknown upload and a HEAD request', async () => {
    assert.equal((await get(`/${UP}/ghost.png`)).status, 404);
    assert.equal((await get(`/${UP}/ghost-300x200.png`)).status, 404);
    assert.equal((await get(`/${UP}/unused.png`)).status, 404, 'in the library, on no page: not deployed, not redirected');
    assert.equal((await get('/no-such-page/', { method: 'HEAD' })).status, 404);
    assert.equal((await get('/no-such-page/', { method: 'POST', body: 'x' })).status, 404);
  });
});
