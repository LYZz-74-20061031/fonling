const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('publishes stable PWA metadata for 智能剧情故事', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));

  assert.match(html, /<title>智能剧情故事<\/title>/);
  assert.match(html, /<h2>智能剧情故事<\/h2>/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="icon"[^>]+href="icons\/icon-192\.png">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/icon-512\.png">/);
  assert.doesNotMatch(html, /function setupPWA\(/);

  assert.equal(manifest.name, '智能剧情故事');
  assert.equal(manifest.short_name, '智能剧情故事');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.deepEqual(
    manifest.icons.map(icon => [icon.src, icon.sizes]),
    [
      ['icons/icon-192.png', '192x192'],
      ['icons/icon-512.png', '512x512'],
    ],
  );
});
