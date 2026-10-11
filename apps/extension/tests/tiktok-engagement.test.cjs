const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

const targetUrl = 'https://www.tiktok.com/@ema.d120/video/7695090241077644565';
const photoTargetUrl = 'https://www.tiktok.com/@ema.d120/photo/7695091961396546837';

function loadEngagement(body, href = targetUrl) {
  const { document, window } = parseHTML(`<html><body>${body}</body></html>`);
  window.setTimeout = setTimeout;
  const logs = [];
  const logger = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) };
  const context = vm.createContext({
    document,
    globalThis: { console: logger },
    console: logger,
    location: new URL(href),
    URL,
    window,
  });
  const source = readFileSync(
    resolve(__dirname, '../src/platforms/tiktok/engagement.ts'),
    'utf8',
  );
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  const api = context.globalThis.PostFlowTikTokEngagement;
  api.__logs = logs;
  return api;
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
      <div data-e2e="share-icon" aria-label="${counts.shareLabel ?? `Share video ${counts.shares ?? '0'} shares`}">
        <strong data-e2e="share-count">${counts.shares ?? '0'}</strong>
      </div>
    </article>
  `;
}

function photoCard(id, counts = {}) {
  return `
    <article data-e2e="recommend-list-item-container">
      <button data-e2e="more-menu-icon" data-more-menu-item-id="${id}"></button>
      <section data-e2e="feed-video">
        <section data-e2e="action-bar">
          <strong data-e2e="like-count">${counts.likes ?? '0'}</strong>
          <strong data-e2e="comment-count">${counts.comments ?? '0'}</strong>
          <strong data-e2e="favorite-count">${counts.favorites ?? '0'}</strong>
          <strong data-e2e="share-count">${counts.shares ?? 'Share'}</strong>
          <div data-e2e="like-icon" aria-label="Like video 0 likes"></div>
          <div data-e2e="comment-icon" aria-label="Read or add comments 0 comments"></div>
          <div data-e2e="favorite-icon" aria-label="Add to Favorites. 0 added to Favorites"></div>
          <div data-e2e="share-icon" aria-label="Share video 0 shares"></div>
        </section>
      </section>
    </article>
  `;
}

function standalonePhotoActionBar() {
  return `
    <section class="css-11fh2ar-7937d88b--SectionActionBarContainer e1ml4pxy0">
      <div><a data-e2e="video-author-avatar" href="/@ema.d120">ema.d120</a></div>
      <div data-e2e="like-icon" aria-label="Like video 1 likes"><strong data-e2e="like-count">1</strong></div>
      <div data-e2e="comment-icon" aria-label="Read or add comments 0 comments"><strong data-e2e="comment-count">0</strong></div>
      <div data-e2e="favorite-icon" aria-label="Add to Favorites. 0 added to Favorites"><strong data-e2e="favorite-count">0</strong></div>
      <div data-e2e="share-icon" aria-label="Share video 0 shares"><strong data-e2e="share-count">Share</strong></div>
    </section>
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

test('extracts only likes and comments from a TikTok video action bar', async () => {
  const api = loadEngagement(videoCard({ likes: '1.2K', comments: '8', favorites: '3', shares: '4' }));
  assert.deepEqual({ ...(await api.check(targetUrl, 100)) }, {
    status: 'SUCCESS',
    reactionCount: 1200,
    commentCount: 8,
  });
});

test('does not include favorites or shares in TikTok engagement results or diagnostics', async () => {
  const api = loadEngagement(videoCard({
    likes: '1', comments: '1', favorites: '0', shares: 'Share',
    shareLabel: 'Share video 0 shares',
  }));
  const result = await api.check(targetUrl, 100);
  const call = api.__logs.find(([name]) => name === '[PostFlow][TikTok] Engagement counters inspected');

  assert.deepEqual({ ...result }, { status: 'SUCCESS', reactionCount: 1, commentCount: 1 });
  assert.ok(call);
  assert.deepEqual(Object.keys(call[1].counters).sort(), ['commentCount', 'reactionCount']);
  assert.deepEqual({ ...call[1].result }, { status: 'SUCCESS', reactionCount: 1, commentCount: 1 });
});

test('finds likes and comments on a photo permalink with only the standalone action bar', async () => {
  const api = loadEngagement(standalonePhotoActionBar(), photoTargetUrl);
  assert.deepEqual({ ...(await api.check(photoTargetUrl, 100)) }, {
    status: 'SUCCESS',
    reactionCount: 1,
    commentCount: 0,
  });
});

test('matches the exact photo post by its more-menu ID among multiple image cards', async () => {
  const body = photoCard('1111111111111111111', {
    likes: '90', comments: '8', favorites: '2', shares: '5',
  }) + photoCard('7695091961396546837', {
    likes: '7', comments: '3', favorites: '1', shares: 'Share',
  });
  const api = loadEngagement(body, photoTargetUrl);
  assert.deepEqual({ ...(await api.check(photoTargetUrl, 100)) }, {
    status: 'SUCCESS',
    reactionCount: 7,
    commentCount: 3,
  });
});

test('returns partial data when TikTok does not expose comments', async () => {
  const body = videoCard({ likes: '12', comments: '', favorites: '1', shares: 'Share' });
  const api = loadEngagement(body);
  assert.deepEqual({ ...(await api.check(targetUrl, 2_000)) }, {
    status: 'PARTIAL',
    reactionCount: 12,
    reason: 'TikTok did not expose both likes and comments',
  });
});

test('does not read counters when the current page does not match the requested post', async () => {
  const api = loadEngagement(videoCard(), 'https://www.tiktok.com/@ema.d120/video/1111111111111111111');
  assert.deepEqual({ ...(await api.check(targetUrl, 100)) }, {
    status: 'CHECK_FAILED',
    reason: 'TikTok page does not match the requested post',
  });
});
