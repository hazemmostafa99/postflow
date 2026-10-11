const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports, globals) {
  const exports = {};
  vm.runInNewContext(ts.transpile(readFileSync(resolve(__dirname, `../src/platforms/tiktok/${file}.ts`), 'utf8'),
    { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }), { exports, require: (name) => imports[name], URL, ...globals });
  return exports;
}
function harness() {
  let listener; const calls = [];
  const bridge = load('bridge', { './result.js': load('result', {}, {}) }, {
    chrome: { runtime: { onMessage: { addListener(value) { listener = value; } } } },
  });
  bridge.registerTikTokPublishingBridge(async (...args) => { calls.push(args); return args[0].endsWith('submission-intent') ? { allowed: true } : { status: 'RUNNING', submittedAt: calls.length > 1 ? '2026-10-09' : undefined }; });
  const sender = { frameId: 0, url: 'https://www.tiktok.com/tiktokstudio/upload', tab: { id: 7, url: 'https://www.tiktok.com/tiktokstudio/upload' } };
  bridge.bindTikTokExecution(7, { id: 'job-1', target: { type: 'TIKTOK_VIDEO', tiktokUsername: 'creator' } });
  function send(type, overrides = {}, senderOverride = {}) {
    return new Promise((resolveResponse) => listener({ type, jobId: 'job-1', username: 'creator', ...overrides }, { ...sender, ...senderOverride }, resolveResponse));
  }
  return { bridge, calls, send };
}
test('checkpoint permission is single-use and tied to one tab/job/account', async () => {
  const h = harness();
  assert.equal((await h.send('TIKTOK_CHECK_JOB')).ok, true);
  assert.equal((await h.send('TIKTOK_ARM_SUBMISSION')).ok, true);
  assert.equal((await h.send('TIKTOK_ARM_SUBMISSION')).ok, false);
  assert.equal(h.calls.filter((call) => call[0].endsWith('submission-intent')).length, 1);
  assert.equal((await h.send('TIKTOK_CONFIRM_SUBMISSION')).ok, true);
});
for (const [name, message, sender] of [
  ['wrong job', { jobId: 'other' }, {}], ['wrong identity', { username: 'other' }, {}],
  ['nested frame', {}, { frameId: 1 }], ['foreign tab', {}, { tab: { id: 8 } }],
  ['unexpected surface', {}, { url: 'https://www.tiktok.com/foryou' }],
]) test(`rejects ${name} before authenticated API access`, async () => {
  const h = harness();
  assert.equal((await h.send('TIKTOK_ARM_SUBMISSION', message, sender)).ok, false);
  assert.equal(h.calls.length, 0);
});
test('released or restarted worker execution cannot authorize Post', async () => {
  const h = harness(); h.bridge.releaseTikTokExecution(7);
  assert.equal((await h.send('TIKTOK_ARM_SUBMISSION')).ok, false);
  assert.equal(h.calls.length, 0);
});
