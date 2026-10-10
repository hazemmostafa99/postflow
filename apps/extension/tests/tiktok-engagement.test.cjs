const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

const targetUrl = 'https://www.tiktok.com/@ema.d120/video/7695090241077644565';

function loadEngagement(body, href = targetUrl) {
  const { document, window } = parseHTML(`<html><body>${body}</body></html>`);
  window.setTimeout = setTimeout;
  const context = vm.createContext({
    document,
    globalThis: {},
    location: new URL(href),
    URL,
    window,
  });
  const source = readFileSync(
    resolve(__dirname, '../src/platforms/tiktok/engagement.ts'),
    'utf8',
  );
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return context.globalThis.PostFlowTikTokEngagement;
}

function videoCard(counts = {}) {
  return `
    <article data-e2e="recommend-list-item-container">
      <div id="xgwrapper-0-7695090241077644565"></div>
      <div data-e2e="like-icon" aria-label="Like video ${counts.likes ?? '0'} likes">
        <strong data-e2e="like-count">${counts.likes ?? '0'}</strong>
      </div>
      <div data-e2e="comment-icon" aria-label="Read or add comments ${counts.comments ?? '0'} comments">
        <strong data-e2e="comment-count">${counts.comments ?? '0'}</strong>
      </div>
      <div data-e2e="favorite-icon" aria-label="Add to Favorites. ${counts.favorites ?? '0'} added to Favorites">
        <strong data-e2e="favorite-count">${counts.favorites ?? '0'}</strong>
      </div>
      <div data-e2e="share-icon" aria-label="Share video ${counts.shares ?? '0'} shares">
        <strong data-e2e="share-count">${counts.shares ?? '0'}</strong>
      </div>
    </article>
  `;
}

test('parses TikTok compact and localized numeric counters', () => {
  const api = loadEngagement('');
  assert.equal(api.parseTikTokCount('0'), 0);
  assert.equal(api.parseTikTokCount('1.2K'), 1200);
  assert.equal(api.parseTikTokCount('2M'), 2_000_000);
  assert.equal(api.parseTikTokCount('١٢'), 12);
  assert.equal(api.parseTikTokCount('Share'), null);
});

test('extracts all four counters from the exact TikTok post action bar', async () => {
  const api = loadEngagement(videoCard({ likes: '1.2K', comments: '8', favorites: '3', shares: '4' }));
  assert.deepEqual({ ...(await api.check(targetUrl, 100)) }, {
    status: 'SUCCESS',
    reactionCount: 1200,
    commentCount: 8,
    favoriteCount: 3,
    shareCount: 4,
  });
});

test('returns partial data and leaves an uncounted Share action unknown', async () => {
  const body = videoCard({ likes: '12', comments: '2', favorites: '1', shares: 'Share' });
  const api = loadEngagement(body);
  assert.deepEqual({ ...(await api.check(targetUrl, 2_000)) }, {
    status: 'PARTIAL',
    reactionCount: 12,
    commentCount: 2,
    favoriteCount: 1,
    reason: 'TikTok did not expose every engagement counter',
  });
});

test('does not read counters when the current page does not match the requested post', async () => {
  const api = loadEngagement(videoCard(), 'https://www.tiktok.com/@ema.d120/video/1111111111111111111');
  assert.deepEqual({ ...(await api.check(targetUrl, 100)) }, {
    status: 'CHECK_FAILED',
    reason: 'TikTok page does not match the requested post',
  });
});
