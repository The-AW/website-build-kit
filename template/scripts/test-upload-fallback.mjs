import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployedPath, isConverted, uploadCandidates, uploadFallback, uploadFallbackDeployed } from '../src/lib/upload-fallback.ts';

// Used originals (what legacy-media-stage lists). Each PNG/JPG is deployed as .webp.
const hosted = new Set([
  '/wp-content/uploads/2024/04/image-139.png',
  '/wp-content/uploads/2024/04/image-140-300x300.png', // a size variant that is itself used
  '/wp-content/uploads/2025/12/camera-scaled.png',
  '/wp-content/uploads/2022/01/Churrasqueira-Elétrica-é-boa.png',
  '/wp-content/uploads/2023/01/logo.png',
  '/wp-content/uploads/2023/02/foto.jpg',
  '/wp-content/uploads/2023/02/foto2.jpeg',
  '/wp-content/uploads/2023/03/anim.gif',
]);
const isHosted = (p) => hosted.has(p);

// What is DEPLOYED: the WebP of every converted original, the rest as it is, and one favicon PNG kept as PNG.
const deployed = new Set([...hosted].map(deployedPath).concat('/wp-content/uploads/2023/01/cropped-icon-32x32.png'));
const exists = async (p) => deployed.has(p);

test('deployed path swaps PNG/JPG/JPEG for .webp and leaves other types alone', () => {
  assert.equal(deployedPath('/wp-content/uploads/a/b.png'), '/wp-content/uploads/a/b.webp');
  assert.equal(deployedPath('/wp-content/uploads/a/b.JPG'), '/wp-content/uploads/a/b.webp');
  assert.equal(deployedPath('/wp-content/uploads/a/b.jpeg'), '/wp-content/uploads/a/b.webp');
  assert.equal(deployedPath('/wp-content/uploads/a/b.gif'), '/wp-content/uploads/a/b.gif');
  assert.equal(deployedPath('/wp-content/uploads/a/b.svg'), '/wp-content/uploads/a/b.svg');
  assert.equal(isConverted('/x.png') && isConverted('/x.jpeg') && !isConverted('/x.gif') && !isConverted('/x.webp'), true);
});

test('an old original URL redirects to its WebP', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2024/04/image-139.png', isHosted), '/wp-content/uploads/2024/04/image-139.webp');
  assert.equal(uploadFallback('/wp-content/uploads/2023/02/foto.jpg', isHosted), '/wp-content/uploads/2023/02/foto.webp');
  assert.equal(uploadFallback('/wp-content/uploads/2023/02/foto2.jpeg', isHosted), '/wp-content/uploads/2023/02/foto2.webp');
});

test('a used size variant redirects to its own WebP', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2024/04/image-140-300x300.png', isHosted), '/wp-content/uploads/2024/04/image-140-300x300.webp');
});

test('a size variant redirects to its hosted original\'s WebP', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2024/04/image-139-239x300.png', isHosted), '/wp-content/uploads/2024/04/image-139.webp');
});

test('a size variant of a big image redirects to the -scaled original\'s WebP', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2025/12/camera-300x300.png', isHosted), '/wp-content/uploads/2025/12/camera-scaled.webp');
});

test('an unscaled original redirects to the hosted -scaled WebP', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2023/01/logo-scaled.png', isHosted), '/wp-content/uploads/2023/01/logo.webp');
});

test('percent-encoded paths are decoded for lookup and re-encoded in the target', () => {
  const target = uploadFallback('/wp-content/uploads/2022/01/Churrasqueira-El%C3%A9trica-%C3%A9-boa-150x150.png', isHosted);
  assert.equal(target, '/wp-content/uploads/2022/01/Churrasqueira-El%C3%A9trica-%C3%A9-boa.webp');
});

test('a hosted file that is deployed as it is never redirects to itself', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2023/03/anim.gif', isHosted), null);
  assert.equal(uploadFallback('/wp-content/uploads/2023/03/anim-300x200.gif', isHosted), '/wp-content/uploads/2023/03/anim.gif');
});

test('the WebP itself is served by assets, not redirected', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2024/04/image-139.webp', isHosted), null);
});

test('no hosted original means no redirect (real 404)', () => {
  assert.equal(uploadFallback('/wp-content/uploads/2024/04/unknown-300x200.png', isHosted), null);
  assert.equal(uploadFallback('/wp-content/uploads/2024/04/unknown.png', isHosted), null);
});

test('candidates list the request itself first, then the originals it may stand for', () => {
  assert.deepEqual(uploadCandidates('/u/a-300x200.png'), ['/u/a-300x200.png', '/u/a.png', '/u/a-scaled.png']);
  assert.deepEqual(uploadCandidates('/u/a-scaled.png'), ['/u/a-scaled.png', '/u/a.png']);
});

test('only /wp-content/uploads/ is handled', () => {
  assert.equal(uploadFallback('/image-139-239x300.png', isHosted), null);
  assert.equal(uploadFallback('/wp-content/plugins/x-10x10.png', isHosted), null);
});

test('malformed encoding is a 404, not a crash', () => {
  assert.equal(uploadFallback('/wp-content/uploads/%E0%A4%A-10x10.png', isHosted), null);
});

// The Worker has no bundled list: it asks the assets binding what is deployed.
test('deployed lookup: the same answers as the list, from what exists', async () => {
  const at = (p) => uploadFallbackDeployed(p, exists);
  assert.equal(await at('/wp-content/uploads/2024/04/image-139.png'), '/wp-content/uploads/2024/04/image-139.webp');
  assert.equal(await at('/wp-content/uploads/2024/04/image-140-300x300.png'), '/wp-content/uploads/2024/04/image-140-300x300.webp');
  assert.equal(await at('/wp-content/uploads/2024/04/image-139-239x300.png'), '/wp-content/uploads/2024/04/image-139.webp');
  assert.equal(await at('/wp-content/uploads/2025/12/camera-300x300.png'), '/wp-content/uploads/2025/12/camera-scaled.webp');
  assert.equal(await at('/wp-content/uploads/2023/01/logo-scaled.png'), '/wp-content/uploads/2023/01/logo.webp');
  assert.equal(await at('/wp-content/uploads/2022/01/Churrasqueira-El%C3%A9trica-%C3%A9-boa-150x150.png'), '/wp-content/uploads/2022/01/Churrasqueira-El%C3%A9trica-%C3%A9-boa.webp');
});

test('deployed lookup: a favicon PNG kept as PNG resolves to itself, not a WebP that was never made', async () => {
  assert.equal(await uploadFallbackDeployed('/wp-content/uploads/2023/01/cropped-icon-32x32-300x300.png', exists), '/wp-content/uploads/2023/01/cropped-icon-32x32.png');
});

test('deployed lookup: never to itself, and a real 404 stays null', async () => {
  const at = (p) => uploadFallbackDeployed(p, exists);
  assert.equal(await at('/wp-content/uploads/2023/03/anim.gif'), null);
  assert.equal(await at('/wp-content/uploads/2024/04/image-139.webp'), null);
  assert.equal(await at('/wp-content/uploads/2024/04/unknown.png'), null);
  assert.equal(await at('/wp-content/uploads/2024/04/unknown-300x200.png'), null);
  assert.equal(await at('/elsewhere/image-139.png'), null);
  assert.equal(await at('/wp-content/uploads/%E0%A4%A-10x10.png'), null);
});
