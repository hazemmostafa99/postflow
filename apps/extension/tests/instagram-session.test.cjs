const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let now = 100_000;
  const stored = {};
  const instagramCookies = {};
  const tabs = new Map();
  const requests = [];
  const listeners = {};
  const event = (name) => ({
    addListener(callback) { listeners[name] = callback; },
    removeListener(callback) { if (listeners[name] === callback) delete listeners[name]; },
  });
  const chrome = {
    alarms: { create: async () => {}, onAlarm: event('alarm') },
    tabs: {
      onUpdated: event('updated'), onRemoved: event('removed'),
      query: async () => Array.from(tabs.values()).map((entry) => entry.tab),
      get: async (id) => tabs.get(id)?.tab,
      sendMessage: async (id, _message, options) => {
        const entry = tabs.get(id);
        if (!entry || (options.documentId && options.documentId !== entry.documentId)) throw new Error('Document closed');
        return entry.read ? entry.read() : entry.evidence;
      },
    },
    storage: { local: { get: async () => stored, set: async (value) => Object.assign(stored, value) } },
    runtime: { onMessage: event('message') },
    cookies: {
      get: async ({ name }) => instagramCookies[name] ? { value: instagramCookies[name] } : null,
    },
  };
  const cache = new Map();
  function load(path) {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, {
      exports, chrome, Date: class extends Date { static now() { return now; } }, URL,
      console: { info() {}, error() {}, warn() {} },
      require: (name) => load(resolve(dirname(path), name.replace(/\.js$/, '.ts'))),
    });
    return exports;
  }
  const apiFetch = async (path, body) => {
    requests.push({ path, body });
    if (path.startsWith('/api/jobs/')) return { status: 'RUNNING' };
    return { status: body.externalUsername && body.externalUsername !== 'account.a' ? 'ACCOUNT_MISMATCH' : body.evidenceState === 'LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : 'CONNECTED', workerStatus: 'IDLE' };
  };
  function tab(id, state = 'VERIFIED', username = 'account.a') {
    const url = `https://www.instagram.com/reels/reel-${id}/`;
    tabs.set(id, { tab: { id, url }, documentId: `doc-${id}`, evidence: { evidenceState: state, externalUsername: state === 'VERIFIED' ? username : undefined, source: state === 'VERIFIED' ? 'profile-link' : 'none', url } });
  }
  const { InstagramSessionManager } = load(resolve(__dirname, '../src/platforms/instagram/session-manager.ts'));
  const manager = new InstagramSessionManager(apiFetch);
  return { manager, tab, tabs, stored, requests, listeners, load, apiFetch, setInstagramCookies: (value) => Object.assign(instagramCookies, value), advance: (ms) => { now += ms; } };
}

test('cookie-backed Instagram identity binds by account id without persisting a username', async () => {
  const h = harness();
  h.setInstagramCookies({ ds_user_id: '17890000000001', sessionid: 'session-token' });
  h.tab(1, 'CHECKING');
  const result = await h.manager.observe(1, 'doc-1');
  assert.equal(result.snapshot.externalAccountId, '17890000000001');
  assert.equal(result.snapshot.username, undefined);
  assert.equal(h.requests[0].body.externalAccountId, '17890000000001');
  assert.equal(h.requests[0].body.externalUsername, undefined);
  assert.equal(h.stored.instagramDetectedAccountId, '17890000000001');
  assert.equal(h.stored.instagramDetectedUsername, null);
});

test('repeated identical evidence is served from the short-lived cache', async () => {
  const h = harness(); h.tab(1);
  await h.manager.observe(1, 'doc-1');
  await h.manager.observe(1, 'doc-1');
  assert.equal(h.requests.length, 1);
});

test('loading analytics does not erase a fresh verified account', async () => {
  const h = harness(); h.tab(1); h.tab(2, 'CHECKING');
  await h.manager.observe(1, 'doc-1');
  await h.manager.observe(2, 'doc-2');
  assert.equal(h.stored.instagramSessionSnapshot.state, 'VERIFIED');
  assert.equal(h.stored.instagramDetectedUsername, 'account.a');
  assert.equal(h.requests[1].body.evidenceState, 'CHECKING');
  assert.equal(await h.manager.verifyTab(2, 'doc-2', 'account.a'), false);
});

test('an unbound loading session is not logged as an API failure', async () => {
  const h = harness(); h.tab(1, 'CHECKING');
  const { InstagramSessionManager } = h.load(resolve(__dirname, '../src/platforms/instagram/session-manager.ts'));
  const manager = new InstagramSessionManager(async () => null);
  const result = await manager.observe(1, 'doc-1');
  assert.equal(result.persisted, false);
  assert.equal(result.snapshot.state, 'CHECKING');
  assert.equal(await manager.verifyTab(1, 'doc-1', 'account.a'), false);
});

test('publishing refresh revalidates the current Instagram document for the bound account', async () => {
  const h = harness(); h.tab(1);
  await h.manager.observe(1, 'doc-1');
  assert.equal(await h.manager.refresh('account.a'), true);
  assert.equal(h.requests.at(-1).body.evidenceState, 'VERIFIED');
  assert.equal(h.stored.instagramDetectedUsername, 'account.a');
});

test('startup refresh recovers when extension reload invalidates the cached document listener', async () => {
  const h = harness();
  h.setInstagramCookies({ ds_user_id: '17890000000001', sessionid: 'session-token' });
  h.tab(1);
  await h.manager.observe(1, 'doc-1');
  h.tabs.get(1).read = async () => { throw new Error('Extension context invalidated'); };
  const { InstagramSessionManager } = h.load(resolve(__dirname, '../src/platforms/instagram/session-manager.ts'));
  const restarted = new InstagramSessionManager(h.apiFetch);
  assert.equal(await restarted.refresh('17890000000001'), true);
  assert.equal(h.stored.instagramDetectedAccountId, '17890000000001');
  assert.equal(h.stored.instagramDetectedUsername, null);
});

test('publishing refresh rejects a different account without rebinding', async () => {
  const h = harness(); h.tab(1, 'VERIFIED', 'account.b');
  await h.manager.observe(1, 'doc-1');
  assert.equal(await h.manager.refresh('account.a'), false);
  assert.equal(h.stored.instagramSessionSnapshot.state, 'ACCOUNT_MISMATCH');
});

test('refresh cannot use an old rendered document after another tab logs out', async () => {
  const h = harness(); h.tab(1); h.tab(2, 'LOGIN_REQUIRED');
  await h.manager.observe(1, 'doc-1');
  await h.manager.observe(2, 'doc-2');
  assert.equal(await h.manager.refresh('account.a'), false);
  assert.equal(h.stored.instagramSessionSnapshot.state, 'LOGIN_REQUIRED');
});

test('loading evidence expires rather than becoming login-required', async () => {
  const h = harness(); h.tab(1); h.tab(2, 'CHECKING');
  await h.manager.observe(1, 'doc-1'); h.advance(5 * 60_000 + 1);
  await h.manager.observe(2, 'doc-2');
  assert.equal(h.stored.instagramSessionSnapshot.state, 'STALE');
  assert.equal(h.stored.instagramSessionDetected, true);
  assert.equal(h.requests[1].body.evidenceState, 'STALE');
});

test('explicit login evidence revokes verification and checking cannot restore it', async () => {
  const h = harness(); h.tab(1); h.tab(2, 'LOGIN_REQUIRED'); h.tab(3, 'CHECKING');
  await h.manager.observe(1, 'doc-1'); await h.manager.observe(2, 'doc-2'); await h.manager.observe(3, 'doc-3');
  assert.equal(h.stored.instagramSessionSnapshot.state, 'LOGIN_REQUIRED');
  assert.equal(h.stored.instagramSessionDetected, false);
});

test('a different observed account blocks pre-share without rebinding', async () => {
  const h = harness(); h.tab(1, 'VERIFIED', 'account.b');
  assert.equal(await h.manager.verifyTab(1, 'doc-1', 'account.a'), false);
  assert.equal(h.stored.instagramSessionSnapshot.state, 'ACCOUNT_MISMATCH');
});

test('navigation during an evidence request discards its response', async () => {
  const h = harness(); h.tab(1);
  h.tabs.get(1).read = async () => {
    h.listeners.updated(1, { status: 'loading' });
    return h.tabs.get(1).evidence;
  };
  await h.manager.observe(1, 'doc-1');
  assert.equal(h.requests.length, 0);
});

test('closed documents and tabs cannot report an old identity', async () => {
  const h = harness(); h.tab(1);
  await h.manager.observe(1, 'old-document');
  h.tabs.delete(1); h.listeners.removed(1);
  await h.manager.observe(1, 'doc-1');
  assert.equal(h.requests.length, 0);
});

test('queued observations serialize backend writes in observation order', async () => {
  const h = harness(); h.tab(1); h.tab(2, 'LOGIN_REQUIRED');
  await Promise.all([h.manager.observe(1, 'doc-1'), h.manager.observe(2, 'doc-2')]);
  assert.equal(h.requests[0].body.evidenceState, 'VERIFIED');
  assert.equal(h.requests[1].body.evidenceState, 'LOGIN_REQUIRED');
  assert.equal(h.stored.instagramSessionSnapshot.state, 'LOGIN_REQUIRED');
});

test('pre-share checks the sending document again after fetching job status', async () => {
  const h = harness(); h.tab(1);
  const fetch = async (path, body) => {
    if (path.startsWith('/api/jobs/')) {
      h.tabs.get(1).evidence.evidenceState = 'CHECKING';
      return { status: 'RUNNING' };
    }
    return h.apiFetch(path, body);
  };
  h.load(resolve(__dirname, '../src/platforms/instagram/worker.ts')).registerInstagramSessionWorker(fetch);
  const response = await new Promise((resolve) => h.listeners.message({ type: 'INSTAGRAM_PRE_SHARE_CHECK', jobId: 'job-1', expectedUsername: 'account.a' }, { tab: h.tabs.get(1).tab, documentId: 'doc-1', frameId: 0 }, resolve));
  assert.equal(response.ok, false);
});

test('stored verification expires after all tabs close and across worker restarts', async () => {
  const h = harness(); h.tab(1);
  await h.manager.observe(1, 'doc-1');
  h.tabs.delete(1); h.advance(5 * 60_000 + 1);
  const { InstagramSessionManager } = h.load(resolve(__dirname, '../src/platforms/instagram/session-manager.ts'));
  const restarted = new InstagramSessionManager(h.apiFetch);
  await restarted.expire();
  await restarted.expire();
  assert.equal(h.stored.instagramSessionSnapshot.state, 'STALE');
  assert.equal(h.stored.instagramSessionDetected, true);
  assert.equal(h.requests[1].body.evidenceState, 'STALE');
  assert.equal(h.requests.length, 2);
});

test('a failed stale report keeps the verified cache so the alarm can retry', async () => {
  const h = harness(); h.tab(1);
  await h.manager.observe(1, 'doc-1');
  const { InstagramSessionManager } = h.load(resolve(__dirname, '../src/platforms/instagram/session-manager.ts'));
  const failed = new InstagramSessionManager(async () => null);
  h.advance(5 * 60_000 + 1);
  await assert.rejects(() => failed.expire(), /Could not persist expired Instagram evidence/);
  assert.equal(h.stored.instagramSessionSnapshot.state, 'VERIFIED');
  assert.equal(h.stored.instagramSessionDetected, true);
});

test('an iframe cannot change session health or authorize Share', async () => {
  const h = harness(); h.tab(1);
  h.load(resolve(__dirname, '../src/platforms/instagram/worker.ts')).registerInstagramSessionWorker(h.apiFetch);
  const result = await new Promise((resolve) => h.listeners.message({ type: 'INSTAGRAM_PRE_SHARE_CHECK', jobId: 'job-1', expectedUsername: 'account.a' }, { tab: h.tabs.get(1).tab, documentId: 'doc-1', frameId: 2 }, resolve));
  assert.equal(result.ok, false);
  assert.equal(h.requests.length, 0);
});

test('a pushed false boolean does not override fresh document evidence', async () => {
  const h = harness(); h.tab(1);
  h.load(resolve(__dirname, '../src/platforms/instagram/worker.ts')).registerInstagramSessionWorker(h.apiFetch);
  await new Promise((resolve) => h.listeners.message({ type: 'PLATFORM_SESSION_STATUS', platform: 'INSTAGRAM', sessionDetected: false }, { tab: h.tabs.get(1).tab, documentId: 'doc-1', frameId: 0 }, resolve));
  assert.equal(h.stored.instagramSessionSnapshot.state, 'VERIFIED');
  assert.equal(h.requests[0].body.sessionDetected, true);
});

test('an old rendered tab cannot undo an explicit logout', async () => {
  const h = harness(); h.tab(1); h.tab(2, 'LOGIN_REQUIRED');
  await h.manager.observe(1, 'doc-1'); await h.manager.observe(2, 'doc-2');
  assert.equal(await h.manager.verifyTab(1, 'doc-1', 'account.a'), false);
  assert.equal(h.stored.instagramSessionSnapshot.state, 'LOGIN_REQUIRED');
  h.tabs.get(1).documentId = 'doc-1-reloaded';
  assert.equal(await h.manager.verifyTab(1, 'doc-1-reloaded', 'account.a'), true);
});

test('navigation during the API write cannot authorize the old document', async () => {
  const h = harness(); h.tab(1);
  const { InstagramSessionManager } = h.load(resolve(__dirname, '../src/platforms/instagram/session-manager.ts'));
  const manager = new InstagramSessionManager(async (path, body) => {
    h.listeners.updated(1, { status: 'loading' });
    return h.apiFetch(path, body);
  });
  assert.equal(await manager.verifyTab(1, 'doc-1', 'account.a'), false);
  assert.equal(h.stored.instagramSessionSnapshot.state, 'STALE');
});
