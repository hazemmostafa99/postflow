const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}, chrome = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpile(readFileSync(resolve(__dirname, `../src/${file}.ts`), 'utf8'), {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  }), { exports, require: (name) => imports[name], chrome, URL, Date, setTimeout });
  return exports;
}
const policy = load('platforms/tiktok/result');
const media = load('shared/media/media-types');

test('strict upload and account-owned permalink allowlists', () => {
  assert.equal(policy.isTikTokUploadUrl('https://www.tiktok.com/tiktokstudio/upload'), true);
  assert.equal(policy.isTikTokUploadUrl('http://www.tiktok.com/upload'), false);
  assert.equal(policy.isTikTokUploadUrl('https://www.tiktok.com/@creator'), false);
  assert.equal(policy.normalizeTikTokPostUrl('https://www.tiktok.com/@creator/video/123?tracking=1', 'creator'), 'https://www.tiktok.com/@creator/video/123');
  assert.equal(policy.normalizeTikTokPostUrl('https://www.tiktok.com/@creator/photo/123?tracking=1', 'creator'), 'https://www.tiktok.com/@creator/photo/123');
  assert.equal(policy.normalizeTikTokPostUrl('https://www.tiktok.com/@other/video/123', 'creator'), null);
  assert.equal(policy.normalizeTikTokPostUrl('https://www.tiktok.com.evil/@creator/video/123'), null);
});

function adapter(chrome, worker = { async ensureTikTokComposer() { return { ok: false }; } }) {
  let bound = 0, released = 0;
  const { tiktokAdapter } = load('platforms/tiktok/adapter', {
    '../../shared/media/index.js': media, '../../env.js': { API_BASE_URL: 'https://api.example' }, './result.js': policy,
    './bridge.js': { bindTikTokExecution() { bound++; }, releaseTikTokExecution() { released++; } },
    './worker.js': worker,
  }, chrome);
  return { adapter: tiktokAdapter, counts: () => ({ bound, released }) };
}
function job() {
  return { id: 'job-1', platform: 'TIKTOK', target: { type: 'TIKTOK_VIDEO', tiktokUsername: 'creator' },
    post: { media: [{ index: 0, contentType: 'video/mp4', sizeBytes: 4, fileName: 'video.mp4', fetchPath: '/api/jobs/job-1/media/0',
      accessToken: 'a'.repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString() }] } };
}
function photoJob(count = 2) {
  const value = job();
  value.target.type = 'TIKTOK_PHOTO';
  value.post.media = Array.from({ length: count }, (_, index) => ({ index, contentType: 'image/png', sizeBytes: 4,
    fileName: `photo-${index}.png`, fetchPath: `/api/jobs/job-1/media/${index}`,
    accessToken: 'a'.repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString() }));
  return value;
}
test('rejects video references for another job or expired grants', () => {
  const h = adapter({}); const value = job();
  assert.equal(h.adapter.validateJob(value).valid, true);
  value.post.media[0].fetchPath = '/api/jobs/other/media/0';
  assert.equal(h.adapter.validateJob(value).valid, false);
  value.post.media[0].fetchPath = '/api/jobs/job-1/media/0';
  value.post.media[0].expiresAt = new Date(0).toISOString();
  assert.equal(h.adapter.validateJob(value).valid, false);
});
test('accepts one to four job-scoped images and rejects mixed or oversized photo posts', () => {
  const h = adapter({});
  assert.equal(h.adapter.validateJob(photoJob(1)).valid, true);
  assert.equal(h.adapter.validateJob(photoJob(4)).valid, true);
  assert.equal(h.adapter.validateJob(photoJob(5)).valid, false);
  const mixed = photoJob(2); mixed.post.media[1].contentType = 'video/mp4';
  assert.equal(h.adapter.validateJob(mixed).valid, false);
});
test('channel loss is UNKNOWN and releases execution binding', async () => {
  const h = adapter({ tabs: { async sendMessage() { throw new Error('closed'); } } });
  assert.equal((await h.adapter.execute(1, job())).status, 'UNKNOWN');
  assert.deepEqual(h.counts(), { bound: 1, released: 1 });
});

test('recovers a lost response channel by resuming the existing upload editor', async () => {
  const messages = [];
  const h = adapter({ tabs: { async sendMessage(_tabId, message) {
    messages.push(message);
    if (message.resume) return { success: true, status: 'PROCESSING', reason: 'accepted' };
    throw new Error('message channel closed');
  } } }, { async ensureTikTokComposer() { return { ok: true, busy: false }; } });
  const result = await h.adapter.execute(1, job());
  assert.equal(result.status, 'PROCESSING');
  assert.equal(messages.length, 2);
  assert.equal(messages[1].resume, true);
});
test('stale stored identities cannot authorize navigation', async () => {
  const h = adapter({ storage: { local: { async get() { return { tiktokSessionDetected: true, tiktokDetectedUsername: 'creator', tiktokSessionLastCheckedAt: Date.now() - 60000 }; } } } });
  assert.equal((await h.adapter.verifyActiveAccount(job())).verified, false);
});

test('readiness tolerates a newly created tab while its allowlisted upload URL loads', async () => {
  let probes = 0;
  const h = adapter({ tabs: {
    async get() { return ++probes === 1
      ? { status: 'loading', pendingUrl: 'https://www.tiktok.com/tiktokstudio/upload' }
      : { status: 'complete', url: 'https://www.tiktok.com/tiktokstudio/upload' }; },
    async sendMessage() { return { ready: true }; },
  } });
  assert.equal(await h.adapter.waitForReady(1, job()), true);
  assert.equal(probes, 2);
});
