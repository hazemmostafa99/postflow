const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadWorker(chrome) {
  const source = readFileSync(
    resolve(__dirname, '../src/platforms/tiktok/worker.ts'),
    'utf8',
  );
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  const context = vm.createContext({ URL, chrome, exports: {}, module: { exports: {} } });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

test('allowlists only HTTPS TikTok hosts', () => {
  const { isTikTokPage } = loadWorker({});
  assert.equal(isTikTokPage('https://www.tiktok.com/@creator'), true);
  assert.equal(isTikTokPage('https://m.tiktok.com/login'), true);
  assert.equal(isTikTokPage('http://www.tiktok.com/'), false);
  assert.equal(isTikTokPage('https://tiktok.com.evil.example/'), false);
});

test('rejects session reports from a nested or non-TikTok document', () => {
  let listener;
  let apiCalls = 0;
  const chrome = {
    runtime: { onMessage: { addListener: (value) => { listener = value; } } },
    storage: { local: { set: async () => {} } },
  };
  const { registerTikTokSessionWorker } = loadWorker(chrome);
  registerTikTokSessionWorker(async () => { apiCalls += 1; });
  let response;
  listener(
    { type: 'PLATFORM_SESSION_STATUS', platform: 'TIKTOK', sessionDetected: true, externalUsername: 'creator' },
    { frameId: 1, tab: { url: 'https://www.tiktok.com/' } },
    (value) => { response = value; },
  );
  assert.equal(response.ok, false);
  assert.equal(apiCalls, 0);
});

test('forwards a normalized verified identity without PostFlow credentials', async () => {
  let listener;
  let request;
  const chrome = {
    runtime: { onMessage: { addListener: (value) => { listener = value; } } },
    storage: { local: { set: async () => {} } },
  };
  const { registerTikTokSessionWorker } = loadWorker(chrome);
  registerTikTokSessionWorker(async (...args) => {
    request = args;
    return { status: 'CONNECTED' };
  });
  const response = await new Promise((resolveResponse) => {
    listener(
      { type: 'PLATFORM_SESSION_STATUS', platform: 'TIKTOK', sessionDetected: true, externalUsername: '@Creator.Account' },
      { frameId: 0, tab: { url: 'https://www.tiktok.com/foryou' } },
      resolveResponse,
    );
  });
  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), [
    '/api/extensions/platform-session',
    { platform: 'TIKTOK', sessionDetected: true, externalUsername: 'Creator.Account' },
    'POST',
    true,
  ]);
});
