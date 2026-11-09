import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertUniqueRootRouteClaims } from '../src/lib/content-routes.ts';
import { toOpenGraphLocale } from '../src/lib/seo-locale.ts';
import {
  hasCompletePostalAddress,
  hasConfiguredText,
  isValidCoordinates,
  isValidEmail,
  isValidHttpsUrl,
  isValidPhone,
} from '../src/lib/structured-data.ts';

const templateRoot = path.resolve(import.meta.dirname, '..');

function runNpm(args, options) {
  return execFileSync('npm', args, { ...options, shell: process.platform === 'win32' });
}

function articleGraph(html) {
  const match = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'built article must contain JSON-LD');
  return JSON.parse(match[1]);
}

function removeEmptyDirectories(directory, stopAt) {
  if (!existsSync(directory) || directory === stopAt) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(path.join(directory, entry.name), stopAt);
  }
  if (readdirSync(directory).length === 0) rmSync(directory, { recursive: true, force: true });
}

test('Open Graph locale follows configured BCP 47 data without inventing a territory', () => {
  assert.equal(toOpenGraphLocale('pt-BR'), 'pt_BR');
  assert.equal(toOpenGraphLocale('en-US'), 'en_US');
  assert.equal(toOpenGraphLocale('zh-Hant-TW'), 'zh_TW');
  assert.equal(toOpenGraphLocale('en'), null);
  assert.equal(toOpenGraphLocale(''), null);
  assert.equal(toOpenGraphLocale('not a locale'), null);
});

test('generic structured-data facts fail closed for placeholders and invalid values', () => {
  assert.equal(hasConfiguredText('Business Name'), false);
  assert.equal(hasConfiguredText('hello@example.com'), false);
  assert.equal(hasConfiguredText('{{ OWNER INPUT }}'), false);
  assert.equal(hasConfiguredText('A verified public description.'), true);
  assert.equal(isValidHttpsUrl('https://example.com/profile'), false);
  assert.equal(isValidHttpsUrl('https://www.example.org/profile'), true);
  assert.equal(isValidPhone('+12025550123'), true);
  assert.equal(isValidPhone('+00000000000'), false);
  assert.equal(isValidEmail('hello@example.com'), false);
  assert.equal(isValidEmail('editor@example.org'), true);
  assert.equal(hasCompletePostalAddress({ street: '1 Example Street', locality: 'Town', region: 'ST', postalCode: '00000', country: 'US' }), false);
  assert.equal(hasCompletePostalAddress({ street: '10 Main Road', locality: 'Springfield', region: 'IL', postalCode: '62701', country: 'US' }), true);
  assert.equal(isValidCoordinates(40.7, -74), true);
  assert.equal(isValidCoordinates(0, 0), false);
});

test('file-backed root route collision check refuses duplicates, reserved paths, and nested slugs', () => {
  assert.doesNotThrow(() => assertUniqueRootRouteClaims(new Set(['contact', 'rss.xml']), [
    { id: 'privacy', source: 'legal/privacy.md' },
    { id: 'care-guide', source: 'blog/care-guide.md' },
  ]));
  assert.throws(() => assertUniqueRootRouteClaims(new Set(['contact']), [
    { id: 'contact', source: 'blog/contact.md' },
  ]), /static route already claims/);
  assert.throws(() => assertUniqueRootRouteClaims(new Set(), [
    { id: 'privacy', source: 'legal/privacy.md' },
    { id: 'privacy', source: 'blog/privacy.md' },
  ]), /Route collision/);
  assert.throws(() => assertUniqueRootRouteClaims(new Set(), [
    { id: 'guides/care', source: 'blog/guides/care.md' },
  ]), /one root-level slug segment/);
});

test('temporary article renders with local media, self-canonical BlogPosting, and production sitemap inclusion', async () => {
  const articleFile = path.join(templateRoot, 'src/content/blog/content-editing-fixture.md');
  const invalidArticleFile = path.join(templateRoot, 'src/content/blog/content-editing-missing-metadata-fixture.md');
  const sourceImage = path.join(templateRoot, 'media/source/blog/content-editing-fixture.png');
  const manifestFile = path.join(templateRoot, 'src/data/image-manifest.json');
  const homepageFile = path.join(templateRoot, 'src/pages/index.astro');
  const distDirectory = path.join(templateRoot, 'dist');
  const astroCache = path.join(templateRoot, '.astro');
  const generatedImageFiles = [
    path.join(templateRoot, 'public/img/blog/content-editing-fixture-480.avif'),
    path.join(templateRoot, 'public/img/blog/content-editing-fixture-480.webp'),
    path.join(templateRoot, 'public/img/social/blog/content-editing-fixture.jpg'),
  ];
  assert.equal(existsSync(distDirectory), false, 'test refuses to overwrite an existing dist/');
  assert.equal(existsSync(articleFile), false, 'test refuses to overwrite existing blog content');
  assert.equal(existsSync(invalidArticleFile), false, 'test refuses to overwrite existing blog content');
  assert.equal(existsSync(sourceImage), false, 'test refuses to overwrite existing media');

  const originalManifest = readFileSync(manifestFile);
  const originalHomepage = readFileSync(homepageFile);
  const hadAstroCache = existsSync(astroCache);
  const imageSourceDirectory = path.dirname(sourceImage);
  const hadImageSourceDirectory = existsSync(imageSourceDirectory);
  const sourceImageRoot = path.join(templateRoot, 'media/source');

  try {
    mkdirSync(imageSourceDirectory, { recursive: true });
    mkdirSync(path.dirname(articleFile), { recursive: true });
    const sharp = (await import('sharp')).default;
    const imageBuffer = await sharp({
      create: { width: 640, height: 360, channels: 3, background: { r: 67, g: 112, b: 93 } },
    }).png().toBuffer();
    writeFileSync(sourceImage, imageBuffer);
    writeFileSync(articleFile, `---
title: 'Temporary article fixture: caring for a new baby'
seoTitle: 'Caring for a new baby — content fixture'
description: 'A temporary article fixture verifies route rendering, metadata, author and local images without publishing real content.'
publishedAt: 2026-11-09
categories: ['Tips']
image: 'blog/content-editing-fixture'
imageAlt: 'A green square illustration on a neutral background'
author:
  name: 'Temporary Content Test Author'
  type: 'Person'
draft: false
---

A temporary article body used only by the content workflow test.

![A green square illustration on a neutral background](/img/blog/content-editing-fixture-480.webp)

[Contact the site](/contact/).
`);

    runNpm(['run', 'media'], { cwd: templateRoot, stdio: 'pipe', timeout: 180_000 });
    const stagingEnv = {
      ...process.env,
      CI: 'true',
      PUBLIC_SITE_ENV: 'staging',
      PUBLIC_SITE_URL: 'https://staging.content-workflow.invalid',
    };
    writeFileSync(invalidArticleFile, `---\ntitle: 'Metadata refusal fixture'\ndescription: ''\npublishedAt: 2026-11-09\ncategories: ['Tips']\ndraft: false\n---\nTemporary invalid fixture.\n`);
    const metadataRefusal = spawnSync('npm', ['run', 'build'], {
      cwd: templateRoot,
      encoding: 'utf8',
      timeout: 240_000,
      env: stagingEnv,
      shell: process.platform === 'win32',
    });
    const refusalOutput = `${metadataRefusal.stdout ?? ''}\n${metadataRefusal.stderr ?? ''}`;
    assert.notEqual(metadataRefusal.status, 0, 'missing meta title and blank description must refuse the build');
    assert.match(refusalOutput, /seoTitle/i);
    assert.match(refusalOutput, /description/i);
    rmSync(invalidArticleFile, { force: true });
    rmSync(distDirectory, { recursive: true, force: true });

    runNpm(['run', 'build'], {
      cwd: templateRoot,
      stdio: 'pipe',
      timeout: 240_000,
      env: stagingEnv,
    });
    execFileSync(process.execPath, ['scripts/staging-headers.mjs'], {
      cwd: templateRoot,
      stdio: 'pipe',
      timeout: 30_000,
      env: stagingEnv,
    });
    execFileSync(process.execPath, ['scripts/check-sitemap.mjs'], {
      cwd: templateRoot,
      stdio: 'pipe',
      timeout: 30_000,
      env: stagingEnv,
    });

    const outputPath = path.join(distDirectory, 'content-editing-fixture/index.html');
    assert.ok(existsSync(outputPath), 'article route must render at the root slug');
    const stagingHtml = readFileSync(outputPath, 'utf8');
    const stagingCanonical = stagingHtml.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
    assert.ok(stagingCanonical && stagingCanonical === 'https://staging.content-workflow.invalid/content-editing-fixture/');
    assert.match(stagingHtml, /<title>Caring for a new baby — content fixture<\/title>/);
    assert.match(stagingHtml, /<meta name="description" content="A temporary article fixture/);
    assert.match(stagingHtml, /<h1[^>]*>Temporary article fixture: caring for a new baby<\/h1>/);
    assert.match(stagingHtml, /Temporary Content Test Author/);
    assert.match(stagingHtml, /noindex, nofollow/);
    assert.equal(existsSync(path.join(distDirectory, 'sitemap-index.xml')), false, 'staging must not publish a sitemap');
    const stagingArticle = articleGraph(stagingHtml)['@graph'].find((node) => node['@type'] === 'BlogPosting');
    assert.ok(stagingArticle);
    assert.equal(stagingArticle['@id'], `${stagingCanonical}#blogposting`);

    const productionHomepage = Buffer.from(originalHomepage.toString('utf8').replace(
      'const unbuilt = true;',
      'const unbuilt = false;',
    ));
    assert.notDeepEqual(productionHomepage, originalHomepage, 'test must find the homepage scaffold marker before production sitemap build');
    writeFileSync(homepageFile, productionHomepage);
    rmSync(distDirectory, { recursive: true, force: true });
    const productionEnv = {
      ...process.env,
      CI: 'true',
      PUBLIC_SITE_ENV: 'production',
      PUBLIC_SITE_URL: 'https://production.content-workflow.invalid',
    };
    runNpm(['run', 'build'], {
      cwd: templateRoot,
      stdio: 'pipe',
      timeout: 240_000,
      env: productionEnv,
    });
    execFileSync(process.execPath, ['scripts/check-sitemap.mjs'], {
      cwd: templateRoot,
      stdio: 'pipe',
      timeout: 30_000,
      env: productionEnv,
    });

    const productionHtml = readFileSync(outputPath, 'utf8');
    const productionCanonical = productionHtml.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
    assert.equal(productionCanonical, 'https://production.content-workflow.invalid/content-editing-fixture/');
    assert.ok(!/name="robots" content="[^"]*noindex/i.test(productionHtml));
    const graph = articleGraph(productionHtml);
    const article = graph['@graph'].find((node) => node['@type'] === 'BlogPosting');
    const image = graph['@graph'].find((node) => node['@type'] === 'ImageObject');
    const webpage = graph['@graph'].find((node) => node['@type'] === 'WebPage');
    assert.ok(article, 'new editorial content must emit BlogPosting');
    assert.equal(article.headline, 'Temporary article fixture: caring for a new baby');
    assert.equal(article.author.name, 'Temporary Content Test Author');
    assert.equal(article.mainEntityOfPage['@id'], webpage['@id']);
    assert.equal(article['@id'], `${productionCanonical}#blogposting`);
    assert.equal(article.dateModified, undefined, 'an unchanged post must not receive an invented modification date');
    assert.equal(article.image['@id'], image['@id']);
    assert.equal(image.width, 480);
    assert.equal(image.height, 270);

    const ogImage = productionHtml.match(/<meta property="og:image" content="([^"]+)"/i)?.[1];
    assert.ok(ogImage && new URL(ogImage).pathname.endsWith('/img/social/blog/content-editing-fixture.jpg'));
    assert.ok(existsSync(generatedImageFiles[1]));
    assert.ok(existsSync(generatedImageFiles[2]));

    const sitemapFiles = [];
    const findXml = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) findXml(full);
        else if (entry.name.endsWith('.xml')) sitemapFiles.push(full);
      }
    };
    findXml(distDirectory);
    assert.ok(sitemapFiles.some((file) => readFileSync(file, 'utf8').includes('/content-editing-fixture/')),
      'new published article route must appear in the generated production sitemap');
    assert.match(readFileSync(path.join(distDirectory, 'rss.xml'), 'utf8'), /\/content-editing-fixture\//);
    assert.match(productionHtml, /src="\/img\/blog\/content-editing-fixture-480\.webp"/);
    assert.ok(existsSync(path.join(distDirectory, 'img/blog/content-editing-fixture-480.webp')),
      'the featured local image must resolve in static output');
    assert.match(productionHtml, /href="\/contact\/"/);
    assert.ok(existsSync(path.join(distDirectory, 'contact/index.html')),
      'the synthetic internal link must resolve to a generated route');
  } finally {
    rmSync(articleFile, { force: true });
    rmSync(invalidArticleFile, { force: true });
    rmSync(sourceImage, { force: true });
    for (const file of generatedImageFiles) rmSync(file, { force: true });
    writeFileSync(manifestFile, originalManifest);
    writeFileSync(homepageFile, originalHomepage);
    rmSync(distDirectory, { recursive: true, force: true });
    if (!hadAstroCache) rmSync(astroCache, { recursive: true, force: true });
    if (!hadImageSourceDirectory) removeEmptyDirectories(imageSourceDirectory, sourceImageRoot);
    removeEmptyDirectories(path.join(templateRoot, 'public/img/blog'), path.join(templateRoot, 'public/img'));
    removeEmptyDirectories(path.join(templateRoot, 'public/img/social/blog'), path.join(templateRoot, 'public/img'));
  }
});
