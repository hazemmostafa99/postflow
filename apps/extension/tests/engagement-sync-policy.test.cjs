const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPolicy() {
  const source = readFileSync(resolve(__dirname, '../src/engagement-sync-policy.ts'), 'utf8');
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  const context = vm.createContext({ URL, exports: {}, module: { exports: {} } });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

test('automatic analytics always stays in a background tab', () => {
  const { getEngagementTabBehavior } = loadPolicy();
  assert.deepEqual(
    JSON.parse(JSON.stringify(getEngagementTabBehavior('AUTOMATIC'))),
    { initiallyActive: false, allowForegroundRetry: false },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getEngagementTabBehavior('MANUAL'))),
    { initiallyActive: false, allowForegroundRetry: true },
  );
});

test('accepts supported post permalinks and rejects feeds or pending URLs', () => {
  const { normalizeFacebookEngagementPermalink } = loadPolicy();
  for (const postUrl of [
    'https://www.facebook.com/groups/123/posts/456/',
    'https://www.facebook.com/reel/123/',
    'https://www.facebook.com/profile-name/posts/456/',
    'https://www.facebook.com/permalink.php?id=123&story_fbid=456',
    'https://www.facebook.com/watch/?v=456',
    'https://www.facebook.com/watch?v=456',
  ]) {
    assert.ok(normalizeFacebookEngagementPermalink(postUrl));
  }
  for (const invalidUrl of [
    'https://www.facebook.com/groups/123/',
    'https://www.facebook.com/groups/123/pending_posts/456/',
    'https://example.com/groups/123/posts/456/',
  ]) {
    assert.equal(normalizeFacebookEngagementPermalink(invalidUrl), null);
  }
});
