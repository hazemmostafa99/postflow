const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function setup(html, href = 'https://www.facebook.com/profile.php?id=12345') {
  const { document, window, Element, HTMLElement } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({
    document,
    Element,
    HTMLElement,
    URL,
    window: {
      location: new URL(href),
      getComputedStyle: () => ({ display: '', visibility: '', opacity: '1' }),
    },
  });
  for (const file of ['publish-response.ts', 'profile-tracking.ts']) {
    const source = readFileSync(resolve(__dirname, '../src', file), 'utf8');
    vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  }
  return { document, context };
}

test('normalizes only supported profile-owned permalink shapes', () => {
  const { context } = setup('<main></main>');
  assert.equal(
    context.normalizeFacebookProfilePostUrl(
      'https://www.facebook.com/profile.php?id=12345&story_fbid=777&ref=share',
      '12345',
    ),
    'https://www.facebook.com/profile.php?id=12345&story_fbid=777',
  );
  assert.equal(
    context.normalizeFacebookProfilePostUrl('https://www.facebook.com/permalink.php?story_fbid=777&id=12345', '12345'),
    'https://www.facebook.com/permalink.php?id=12345&story_fbid=777',
  );
  assert.equal(
    context.normalizeFacebookProfilePostUrl('https://www.facebook.com/12345/posts/777/?ref=feed', '12345'),
    'https://www.facebook.com/12345/posts/777/',
  );
  assert.equal(
    context.normalizeFacebookProfilePostUrl('https://www.facebook.com/12345/videos/888/?ref=feed', '12345'),
    'https://www.facebook.com/12345/videos/888/',
  );
  assert.equal(context.normalizeFacebookProfilePostUrl('https://www.facebook.com/other-name/posts/777/', '12345'), null);
  assert.equal(context.normalizeFacebookProfilePostUrl('https://www.facebook.com/99999/videos/888/', '12345'), null);
  assert.equal(context.normalizeFacebookProfilePostUrl('https://www.facebook.com/profile.php?id=99999&story_fbid=777', '12345'), null);
});

test('accepts modern unscoped video shapes only for confirmed profile-video tracking', () => {
  const { context } = setup('<main></main>');
  const cases = [
    ['https://www.facebook.com/profile-name/videos/888/?ref=feed', 'https://www.facebook.com/profile-name/videos/888/'],
    ['https://www.facebook.com/reel/999/?ref=feed', 'https://www.facebook.com/reel/999/'],
    ['https://www.facebook.com/watch/?v=777&ref=watch_permalink', 'https://www.facebook.com/watch/?v=777'],
    ['https://www.facebook.com/share/v/share-token/', 'https://www.facebook.com/share/v/share-token/'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(context.normalizeFacebookProfilePostUrl(input, '12345'), null);
    assert.equal(context.normalizeFacebookProfilePostUrl(input, '12345', true), expected);
  }
});

test('derives an owner-scoped profile video URL from a publish response', () => {
  const { context } = setup('<main></main>');
  const candidates = context.getProfileResponseCandidateUrls({
    videoIds: ['888'],
  }, '12345');

  assert.deepEqual(
    JSON.parse(JSON.stringify(candidates)),
    ['https://www.facebook.com/12345/videos/888/'],
  );
});

test('finds a new matching profile post and rejects old or unrelated posts', () => {
  const app = setup(`
    <div role="article" id="old">
      <a href="https://www.facebook.com/profile.php?id=12345&story_fbid=100">old</a>
      <time datetime="2026-09-30T11:00:00.000Z"></time>
      <div>same profile text</div>
    </div>
    <div role="article" id="wrong">
      <a href="https://www.facebook.com/profile.php?id=99999&story_fbid=200">wrong</a>
      <div>same profile text</div>
    </div>
    <div role="article" id="new">
      <a href="https://www.facebook.com/profile.php?id=12345&story_fbid=300">new</a>
      <time datetime="2026-09-30T12:00:30.000Z"></time>
      <div>same profile text</div>
    </div>
  `);
  const old = app.document.querySelector('#old');
  const result = app.context.findPublishedProfilePost({
    root: app.document,
    expectedFacebookUserId: '12345',
    submittedText: 'same profile text',
    submittedAt: Date.parse('2026-09-30T12:00:00.000Z'),
    existingPostElements: new Set([old]),
    existingPostUrls: new Set(['https://www.facebook.com/profile.php?id=12345&story_fbid=100']),
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/profile.php?id=12345&story_fbid=300');
});

test('media-only profile matching requires a fresh timestamp', () => {
  const app = setup(`
    <div role="article" id="undated">
      <a href="https://www.facebook.com/profile.php?id=12345&story_fbid=400">post</a>
      <video src="blob:old-video"></video>
    </div>
    <div role="article" id="fresh">
      <a href="https://www.facebook.com/profile.php?id=12345&story_fbid=500">post</a>
      <time datetime="2026-09-30T12:00:05.000Z"></time>
      <video src="blob:new-video"></video>
    </div>
  `);
  const result = app.context.findPublishedProfilePost({
    root: app.document,
    expectedFacebookUserId: '12345',
    submittedText: '',
    submittedAt: Date.parse('2026-09-30T12:00:00.000Z'),
    existingPostElements: new Set(),
    existingPostUrls: new Set(),
    submittedMediaCount: 1,
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/profile.php?id=12345&story_fbid=500');
});

test('accepted profile video can use a new undated permalink absent before submit', () => {
  const app = setup(`
    <div role="article" id="new-video">
      <a href="https://www.facebook.com/12345/videos/600/">post</a>
      <video src="blob:new-video"></video>
    </div>
  `);
  const result = app.context.findPublishedProfilePost({
    root: app.document,
    expectedFacebookUserId: '12345',
    submittedText: '',
    submittedAt: Date.parse('2026-09-30T12:00:00.000Z'),
    existingPostElements: new Set(),
    existingPostUrls: new Set(),
    submittedMediaCount: 1,
    allowUndatedMedia: true,
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/12345/videos/600/');
});

test('accepted profile video still rejects an undated permalink present before submit', () => {
  const app = setup(`
    <div role="article" id="old-video">
      <a href="https://www.facebook.com/12345/videos/600/">post</a>
      <video src="blob:old-video"></video>
    </div>
  `);
  const result = app.context.findPublishedProfilePost({
    root: app.document,
    expectedFacebookUserId: '12345',
    submittedText: '',
    submittedAt: Date.parse('2026-09-30T12:00:00.000Z'),
    existingPostElements: new Set(),
    existingPostUrls: new Set(['https://www.facebook.com/12345/videos/600']),
    submittedMediaCount: 1,
    allowUndatedMedia: true,
  });
  assert.equal(result, null);
});

test('accepted profile video can capture a new reel permalink while rejecting its snapshot', () => {
  const app = setup(`
    <div role="article" id="new-reel">
      <a href="https://www.facebook.com/reel/700/">post</a>
      <div>Video processing</div>
    </div>
  `);
  const options = {
    root: app.document,
    expectedFacebookUserId: '12345',
    submittedText: '',
    submittedAt: Date.parse('2026-09-30T12:00:00.000Z'),
    existingPostElements: new Set(),
    submittedMediaCount: 1,
    allowUndatedMedia: true,
  };
  assert.equal(
    app.context.findPublishedProfilePost({ ...options, existingPostUrls: new Set() })?.postUrl,
    'https://www.facebook.com/reel/700/',
  );
  assert.equal(
    app.context.findPublishedProfilePost({
      ...options,
      existingPostUrls: new Set(['https://www.facebook.com/reel/700']),
    }),
    null,
  );
});

test('accepted profile video derives its reel URL from data-video-id before the link hydrates', () => {
  const app = setup(`
    <div data-pagelet="TimelineFeedUnit_0">
      <div role="article">
        <div>Video processing</div>
        <div data-video-id="1636327731333442"></div>
      </div>
    </div>
  `);
  const result = app.context.findPublishedProfilePost({
    root: app.document,
    expectedFacebookUserId: '12345',
    submittedText: '',
    submittedAt: Date.parse('2026-09-30T12:00:00.000Z'),
    existingPostElements: new Set(),
    existingPostUrls: new Set(),
    submittedMediaCount: 1,
    allowUndatedMedia: true,
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/reel/1636327731333442/');
});

test('closed profile composer is acceptance evidence only for video posts', () => {
  const app = setup('<div role="dialog" id="composer"></div>');
  const dialog = app.document.querySelector('#composer');
  dialog.remove();

  assert.equal(
    app.context.getAcceptedProfileVideoEvidence(dialog, true),
    'Facebook closed the profile composer after accepting the video',
  );
  assert.equal(app.context.getAcceptedProfileVideoEvidence(dialog, false), null);
});
