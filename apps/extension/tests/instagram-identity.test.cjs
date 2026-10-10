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
    JSON.parse(JSON.stringify(loadDetector('<link rel="canonical" href="https://www.instagram.com/brand.account/"><button>Edit profile</button>'))),
    { evidenceState: 'VERIFIED', sessionDetected: true, externalUsername: 'brand.account', source: 'canonical' },
  );
});

test('does not treat reserved Instagram routes as account identities', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('<link rel="canonical" href="https://www.instagram.com/explore/">'))),
    { evidenceState: 'CHECKING', sessionDetected: false, source: 'none' },
  );
});

test('uses a visible profile link when canonical metadata is unavailable', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('<header><a href="/brand.account/" aria-label="Profile">Profile</a></header>'))),
    { evidenceState: 'VERIFIED', sessionDetected: true, externalUsername: 'brand.account', source: 'profile-link' },
  );
});

test('finds the profile link on the div-based Instagram home sidebar', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('<div><a href="/brand.account/"><span>Profile</span></a></div>'))),
    { evidenceState: 'VERIFIED', sessionDetected: true, externalUsername: 'brand.account', source: 'profile-link' },
  );
});

test('does not infer the viewer from another user post URL', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(loadDetector('', 'https://www.instagram.com/other.user/p/ABC123/'))),
    { evidenceState: 'CHECKING', sessionDetected: false, source: 'none' },
  );
});

test('detects the Arabic own-profile sidebar on a Reel page', () => {
  const result = loadDetector('<div><a href="/brand.account/" aria-label="الملف الشخصي"><img alt="صورة الملف الشخصي" /></a></div>', 'https://www.instagram.com/reels/ABC123/');
  assert.equal(result.evidenceState, 'VERIFIED');
  assert.equal(result.externalUsername, 'brand.account');
});

test('detects the current Arabic profile link and avatar alt text', () => {
  const profileLabel = '\u0645\u0644\u0641 \u0634\u062e\u0635\u064a';
  const avatarAlt = '\u0635\u0648\u0631\u0629 \u0645\u0644\u0641 brand.account \u0627\u0644\u0634\u062e\u0635\u064a';
  const result = loadDetector(`<div><a href="/brand.account/"><img alt="${avatarAlt}" /><span>${profileLabel}</span></a></div>`);
  assert.equal(result.evidenceState, 'VERIFIED');
  assert.equal(result.externalUsername, 'brand.account');
});

test('uses an Arabic avatar alt only inside navigation', () => {
  const avatarAlt = '\u0635\u0648\u0631\u0629 \u0645\u0644\u0641 brand.account \u0627\u0644\u0634\u062e\u0635\u064a';
  const result = loadDetector(`<nav><a href="/brand.account/"><img alt="${avatarAlt}" /></a></nav>`);
  assert.equal(result.evidenceState, 'VERIFIED');
  assert.equal(result.externalUsername, 'brand.account');
});

test('public profile metadata and post-author avatars do not establish viewer identity', () => {
  const result = loadDetector('<link rel="canonical" href="https://www.instagram.com/other.user/"><a href="/other.user/"><img alt="other.user profile picture" /></a>', 'https://www.instagram.com/other.user/');
  assert.equal(result.evidenceState, 'CHECKING');
  assert.equal(result.externalUsername, undefined);
});

test('only an explicit login route is negative session evidence', () => {
  assert.equal(loadDetector('', 'https://www.instagram.com/accounts/login/').evidenceState, 'LOGIN_REQUIRED');
  assert.equal(loadDetector('', 'https://www.instagram.com/reels/ABC123/').evidenceState, 'CHECKING');
});
