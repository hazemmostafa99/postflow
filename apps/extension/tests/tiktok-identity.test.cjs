const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function detect(html, href = 'https://www.tiktok.com/') {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const window = { location: new URL(href) };
  const context = vm.createContext({ document, window, URL, decodeURIComponent, globalThis: {} });
  const source = readFileSync(
    resolve(__dirname, '../src/platforms/tiktok/identity.ts'),
    'utf8',
  );
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return context.globalThis.PostFlowTikTokIdentity.detect();
}

test('detects the signed-in TikTok profile navigation link', () => {
  const result = detect('<nav><a data-e2e="profile-icon" href="/@brand.creator" aria-label="Profile"><img /></a></nav>');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    evidenceState: 'VERIFIED',
    sessionDetected: true,
    externalUsername: 'brand.creator',
    source: 'profile-link',
  });
});

test('supports Arabic own-profile navigation labels', () => {
  const result = detect('<a href="/@brand_creator" aria-label="الملف الشخصي">الملف الشخصي</a>');
  assert.equal(result.evidenceState, 'VERIFIED');
  assert.equal(result.externalUsername, 'brand_creator');
});

test('detects an account label on a profile/avatar navigation control', () => {
  const result = detect('<nav><button data-e2e="nav-profile-avatar" aria-label="Profile @brand.creator"></button></nav>');
  assert.equal(result.evidenceState, 'VERIFIED');
  assert.equal(result.externalUsername, 'brand.creator');
});

test('uses the pathname only when an Edit profile control proves ownership', () => {
  const result = detect('<button data-e2e="edit-profile-entrance">Edit profile</button>', 'https://www.tiktok.com/@self.account');
  assert.equal(result.evidenceState, 'VERIFIED');
  assert.equal(result.externalUsername, 'self.account');
  assert.equal(result.source, 'pathname');
});

test('accepts TikTok underscore/test-id variants of the own-profile control', () => {
  const result = detect('<button data-e2e="edit_profile_button">Edit profile</button>', 'https://www.tiktok.com/@self.account');
  assert.equal(result.evidenceState, 'VERIFIED');
  assert.equal(result.externalUsername, 'self.account');
  assert.equal(result.source, 'pathname');
});

test('does not identify the viewer from another public profile', () => {
  const result = detect('<main><a href="/@public.creator">Public creator</a></main>', 'https://www.tiktok.com/@public.creator');
  assert.equal(result.evidenceState, 'CHECKING');
  assert.equal(result.externalUsername, undefined);
});

test('treats only explicit authentication routes as login-required evidence', () => {
  assert.equal(detect('', 'https://www.tiktok.com/login').evidenceState, 'LOGIN_REQUIRED');
  assert.equal(detect('', 'https://www.tiktok.com/foryou').evidenceState, 'CHECKING');
});
