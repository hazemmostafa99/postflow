const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function loadDetector(html, href = 'https://www.instagram.com/') {
  const { document } = parseHTML(`<html><head>${html}</head><body></body></html>`);
  const window = { location: new URL(href) };
  const context = vm.createContext({ document, window, URL, console });
  const source = readFileSync(
    resolve(__dirname, '../src/platforms/instagram/identity.ts'),
    'utf8',
  );
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return context.PostFlowInstagramIdentity.detect();
}

test('prefers a canonical Instagram profile identity', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('<link rel="canonical" href="https://www.instagram.com/brand.account/">'))),
    { sessionDetected: true, externalUsername: 'brand.account', source: 'canonical' },
  );
});

test('does not treat reserved Instagram routes as account identities', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('<link rel="canonical" href="https://www.instagram.com/explore/">'))),
    { sessionDetected: false, source: 'none' },
  );
});

test('uses a visible profile link when canonical metadata is unavailable', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('<header><a href="/brand.account/" aria-label="Profile">Profile</a></header>'))),
    { sessionDetected: true, externalUsername: 'brand.account', source: 'profile-link' },
  );
});

test('does not infer the viewer from another user post URL', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('', 'https://www.instagram.com/other.user/p/ABC123/'))),
    { sessionDetected: false, source: 'none' },
  );
});
