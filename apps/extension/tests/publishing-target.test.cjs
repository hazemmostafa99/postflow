const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTargetHelpers() {
  const source = readFileSync(resolve(__dirname, '../src/publishing-target.ts'), 'utf8');
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  const context = vm.createContext({ URL, encodeURIComponent, exports: {}, module: { exports: {} } });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

test('normalizes a target-aware profile job without a group', () => {
  const { normalizePublishJob } = loadTargetHelpers();
  const job = normalizePublishJob({
    id: 'job-1',
    post: { content: 'hello', mediaUrls: [] },
    target: {
      type: 'PROFILE_FEED',
      facebookConnectionId: 'connection-1',
      facebookUserId: '12345',
      name: 'Personal profile',
      url: 'https://www.facebook.com/profile.php?id=12345',
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(job)), {
    id: 'job-1',
    post: { content: 'hello', mediaUrls: [] },
    target: {
      type: 'PROFILE_FEED',
      facebookConnectionId: 'connection-1',
      facebookUserId: '12345',
      name: 'Personal profile',
      url: 'https://www.facebook.com/profile.php?id=12345',
    },
  });
});

test('keeps legacy group payloads executable during the transition', () => {
  const { normalizePublishJob } = loadTargetHelpers();
  const job = normalizePublishJob({
    _id: 'job-2',
    postId: { content: 'hello' },
    groupId: { _id: 'group-1', externalId: 'community', url: 'https://www.facebook.com/groups/community/' },
  });
  assert.equal(job?.target.type, 'GROUP');
  assert.equal(job?.target.url, 'https://www.facebook.com/groups/community/');
});

test('accepts only the expected Facebook-owned profile URL', () => {
  const { getSafeFacebookProfileUrl } = loadTargetHelpers();
  const target = {
    type: 'PROFILE_FEED',
    facebookConnectionId: 'connection-1',
    facebookUserId: '12345',
    url: 'https://www.facebook.com/profile.php?id=12345&ref=bookmarks',
  };
  assert.equal(getSafeFacebookProfileUrl(target), 'https://www.facebook.com/profile.php?id=12345');
  assert.equal(getSafeFacebookProfileUrl({ ...target, url: 'https://example.com/profile.php?id=12345' }), null);
  assert.equal(getSafeFacebookProfileUrl({ ...target, url: 'https://www.facebook.com/profile.php?id=99999' }), null);
});
