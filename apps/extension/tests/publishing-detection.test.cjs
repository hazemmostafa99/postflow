const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function setup(html, locationHref = 'https://www.facebook.com/groups/123/') {
  const { document, window, Element, HTMLElement } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({
    document,
    Element,
    HTMLElement,
    URL,
    window: {
      location: new URL(locationHref),
      getComputedStyle: () => ({ display: '', visibility: '', opacity: '1' }),
    },
  });
  const source = readFileSync(resolve(__dirname, '../src/post-tracking/find-published-post.ts'), 'utf8');
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return { document, context };
}

function setupSubmission(html, locationHref = 'https://www.facebook.com/groups/123/') {
  const { document, Element, HTMLElement } = parseHTML(`<html><body>${html}</body></html>`);
  let now = 0;
  class Clock extends Date { static now() { return now; } }
  const logs = [];
  const context = vm.createContext({
    document,
    Element,
    HTMLElement,
    URL,
    Date: Clock,
    console: Object.fromEntries(['log', 'warn'].map((level) => [level, (...args) => logs.push(args)])),
    setTimeout: (callback, delay) => { now += delay; callback(); },
    window: {
      location: new URL(locationHref),
      getComputedStyle: () => ({ display: '', visibility: '', opacity: '1' }),
    },
  });
  for (const file of ['detect-pending-approval.ts', 'find-published-post.ts', 'wait-for-post-submission-result.ts']) {
    const source = readFileSync(resolve(__dirname, '../src/post-tracking', file), 'utf8');
    vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  }
  return { document, context };
}

function setupPending(html, locationHref = 'https://www.facebook.com/groups/123/') {
  const { document, window, Element, HTMLElement } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({
    document,
    Element,
    HTMLElement,
    URL,
    window: {
      location: new URL(locationHref),
      getComputedStyle: () => ({ display: '', visibility: '', opacity: '1' }),
    },
  });
  for (const file of ['find-published-post.ts', 'find-pending-published-post.ts']) {
    const source = readFileSync(resolve(__dirname, '../src/post-tracking', file), 'utf8');
    vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  }
  return { document, context };
}

function article({ group = '123', post = 'new', text = 'hello world', datetime = '2026-09-19T12:00:00.000Z' } = {}) {
  return `<div role="article">
    <a href="https://www.facebook.com/groups/${group}/posts/${post}/">permalink</a>
    <time datetime="${datetime}"></time>
    <div>${text}</div>
  </div>`;
}

test('re-rendered old matching post is not treated as the submitted post', () => {
  const app = setup(article({ post: 'old', datetime: '2026-09-19T11:00:00.000Z' }));
  const result = app.context.findPublishedPost({
    root: app.document,
    submittedText: 'hello world',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    existingPostElements: new Set(),
    currentGroupId: '123',
  });
  assert.equal(result, null);
});

test('new matching post is accepted before Facebook hydrates its timestamp', () => {
  const app = setup(`<div role="article">
    <a href="https://www.facebook.com/groups/123/posts/new-without-time/">permalink</a>
    <div>hello without timestamp</div>
  </div>`);
  const result = app.context.findPublishedPost({
    root: app.document,
    submittedText: 'hello without timestamp',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    existingPostElements: new Set(),
    currentGroupId: '123',
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/groups/123/posts/new-without-time/');
});

test('a re-rendered old post permalink is not treated as the submitted post', () => {
  const app = setup(article({ post: 'old-rerendered', text: 'video post' }));
  const result = app.context.findPublishedPost({
    root: app.document,
    submittedText: 'video post',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    existingPostElements: new Set(),
    existingPostUrls: new Set(['https://www.facebook.com/groups/123/posts/old-rerendered']),
    currentGroupId: '123',
  });
  assert.equal(result, null);
});

test('media-only posts can match a newly inserted post with media', () => {
  const app = setup(`<div role="article">
    <a href="https://www.facebook.com/groups/123/posts/video-new/">permalink</a>
    <video src="blob:video-preview"></video>
  </div>`);
  const result = app.context.findPublishedPost({
    root: app.document,
    submittedText: '',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    existingPostElements: new Set(),
    submittedMediaCount: 1,
    currentGroupId: '123',
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/groups/123/posts/video-new/');
});

test('publish detection only accepts permalinks from the target group', () => {
  const app = setup([
    article({ group: '999', post: 'wrong', text: 'same content' }),
    article({ group: '123', post: 'right', text: 'same content' }),
  ].join(''));
  const result = app.context.findPublishedPost({
    root: app.document,
    submittedText: 'same content',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    existingPostElements: new Set(),
    currentGroupId: '123',
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/groups/123/posts/right/');
});

test('publish detection falls back to the current group page when no group id is passed', () => {
  const app = setup(article({ group: '123', post: 'from-page', text: 'page scoped' }));
  const result = app.context.findPublishedPost({
    root: app.document,
    submittedText: 'page scoped',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    existingPostElements: new Set(),
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/groups/123/posts/from-page/');
});

test('explicit Facebook success evidence becomes published when no permalink appears', async () => {
  const app = setupSubmission('<div role="status">Your post is now published</div>');
  const result = await app.context.waitForPostSubmissionResult({
    root: app.document,
    submittedText: 'new post text',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    timeout: 3000,
    interval: 500,
    existingPostElements: new Set(),
    currentGroupId: '123',
    getSuccessEvidence: () => 'Facebook showed a publish success message',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'PUBLISHED' });
});

test('accepted composer evidence becomes published when Facebook shows no permalink or success text', async () => {
  const app = setupSubmission('<main></main>');
  const result = await app.context.waitForPostSubmissionResult({
    root: app.document,
    submittedText: 'new post text',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    timeout: 3000,
    interval: 500,
    existingPostElements: new Set(),
    currentGroupId: '123',
    getSuccessEvidence: () => 'Facebook accepted the composer after the Post click',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'PUBLISHED' });
});

test('current Facebook post page URL is saved as the published post URL', async () => {
  const postUrl = 'https://www.facebook.com/groups/123/posts/456/?notif_id=1&notif_t=group_post_approved&ref=notif';
  const app = setupSubmission(article({ post: '456', text: 'new post text' }), postUrl);
  const result = await app.context.waitForPostSubmissionResult({
    root: app.document,
    submittedText: 'new post text',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    timeout: 3000,
    interval: 500,
    existingPostElements: new Set(),
    currentGroupId: '123',
    getSuccessEvidence: () => 'Facebook accepted the composer after the Post click',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'PUBLISHED', postUrl: 'https://www.facebook.com/groups/123/posts/456/' });
});

test('current Facebook post page URL survives numeric and vanity group ids', async () => {
  const postUrl = 'https://www.facebook.com/groups/my-community/posts/789/';
  const app = setupSubmission(article({ group: 'my-community', post: '789', text: 'new post text' }), postUrl);
  const result = await app.context.waitForPostSubmissionResult({
    root: app.document,
    submittedText: 'new post text',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    timeout: 3000,
    interval: 500,
    existingPostElements: new Set(),
    currentGroupId: '123456789',
    getSuccessEvidence: () => 'Facebook accepted the composer after the Post click',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'PUBLISHED', postUrl: 'https://www.facebook.com/groups/my-community/posts/789/' });
});

test('Facebook redirect captures the new post URL when the post article is not hydrated yet', async () => {
  const postUrl = 'https://www.facebook.com/groups/123/posts/999/?notif_id=1';
  const app = setupSubmission('<main></main>', postUrl);
  const result = await app.context.waitForPostSubmissionResult({
    root: app.document,
    submittedText: 'new post text',
    submittedAt: Date.parse('2026-09-19T12:00:00.000Z'),
    timeout: 3000,
    interval: 500,
    existingPostElements: new Set(),
    currentGroupId: '123',
    initialPageUrl: 'https://www.facebook.com/groups/123/',
    getSuccessEvidence: () => null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'PUBLISHED', postUrl: 'https://www.facebook.com/groups/123/posts/999/' });
});

test('pending sync selects the newest matching post permalink', () => {
  const app = setupPending([
    article({ post: 'older', text: 'same pending text', datetime: '2026-09-19T12:00:00.000Z' }),
    article({ post: 'newer', text: 'same pending text', datetime: '2026-09-19T12:05:00.000Z' }),
  ].join(''));
  const result = app.context.findPendingPublishedPost({
    root: app.document,
    submittedText: 'same pending text',
    submittedAt: Date.parse('2026-09-19T12:04:00.000Z'),
    currentGroupId: '123',
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/groups/123/posts/newer/');
});

test('pending sync never replaces a saved pending post with another post having the same text', () => {
  const app = setupPending([
    article({ post: '777001', text: 'same pending text', datetime: '2026-09-19T12:05:00.000Z' }),
    article({ post: '777002', text: 'same pending text', datetime: '2026-09-19T12:04:00.000Z' }),
  ].join(''));
  const result = app.context.findPendingPublishedPost({
    root: app.document,
    submittedText: 'same pending text',
    submittedAt: Date.parse('2026-09-19T12:04:00.000Z'),
    currentGroupId: '123',
    expectedPostUrl: 'https://www.facebook.com/groups/123/pending_posts/777002/',
  });
  assert.equal(result?.postUrl, 'https://www.facebook.com/groups/123/posts/777002/');
});

test('a pending_posts permalink remains pending instead of becoming published', () => {
  const app = setupPending(article({ post: '777003', text: 'still waiting' }).replace('/posts/777003/', '/pending_posts/777003/'));
  const result = app.context.checkPendingFacebookPost({
    id: 'job-1',
    groupId: 'group-1',
    groupExternalId: '123',
    groupUrl: 'https://www.facebook.com/groups/123/',
    status: 'PENDING_APPROVAL',
    postUrl: 'https://www.facebook.com/groups/123/pending_posts/777003/',
    content: 'still waiting',
    submittedAt: '2026-09-19T12:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'STILL_PENDING' });
});

test('approved post page with the saved post id becomes published before article hydration', () => {
  const app = setupPending('<main></main>', 'https://www.facebook.com/groups/123/posts/777004/?ref=notif');
  const result = app.context.checkPendingFacebookPost({
    id: 'job-2',
    groupId: 'group-1',
    groupExternalId: '123',
    groupUrl: 'https://www.facebook.com/groups/123/',
    status: 'PENDING_APPROVAL',
    postUrl: 'https://www.facebook.com/groups/123/pending_posts/777004/',
    content: 'approved text',
    submittedAt: '2026-09-19T12:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'PUBLISHED',
    postUrl: 'https://www.facebook.com/groups/123/posts/777004/',
  });
});
