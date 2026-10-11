const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const transpiledExports = {};
const source = readFileSync(resolve(__dirname, '../src/platforms/tiktok/engagement-url.ts'), 'utf8');
vm.runInNewContext(ts.transpile(source, { target: 'ES2020', module: 'CommonJS' }), { exports: transpiledExports, URL });
const { normalizeTikTokAnalyticsPermalink } = transpiledExports;

const postId = '7695140569080745236';

test('uses the target type to correct a stored video route for a photo post', () => {
  assert.equal(
    normalizeTikTokAnalyticsPermalink(`https://www.tiktok.com/@ema.d120/video/${postId}`, 'TIKTOK_PHOTO'),
    `https://www.tiktok.com/@ema.d120/photo/${postId}`,
  );
});

test('uses the target type to correct a stored photo route for a video post', () => {
  assert.equal(
    normalizeTikTokAnalyticsPermalink(`https://www.tiktok.com/@ema.d120/photo/${postId}`, 'TIKTOK_VIDEO'),
    `https://www.tiktok.com/@ema.d120/video/${postId}`,
  );
});

test('preserves the URL media type when a job has no target type', () => {
  assert.equal(
    normalizeTikTokAnalyticsPermalink(`https://www.tiktok.com/@ema.d120/photo/${postId}`),
    `https://www.tiktok.com/@ema.d120/photo/${postId}`,
  );
});

test('rejects non-permalink TikTok URLs', () => {
  assert.equal(normalizeTikTokAnalyticsPermalink('https://www.tiktok.com/@ema.d120'), null);
  assert.equal(normalizeTikTokAnalyticsPermalink(`https://example.com/@ema.d120/video/${postId}`), null);
});
