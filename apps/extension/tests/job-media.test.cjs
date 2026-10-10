const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadMediaTypes() {
  const source = readFileSync(
    resolve(__dirname, '../src/shared/media/media-types.ts'),
    'utf8',
  );
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  const context = vm.createContext({
    Date,
    Number,
    exports: {},
    module: { exports: {} },
  });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

function loadMediaRuntime(fetchImplementation) {
  const source = readFileSync(
    resolve(__dirname, '../src/shared/media/media-runtime.ts'),
    'utf8',
  );
  class TestFile {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      this.type = options.type;
    }
  }
  class TestBlob {
    constructor(parts, options = {}) {
      this.parts = parts;
      this.size = parts.reduce((total, part) => total + (part?.size ?? part?.byteLength ?? 0), 0);
      this.type = options.type ?? '';
    }
  }
  const context = vm.createContext({
    AbortSignal,
    Blob: TestBlob,
    Date,
    Error,
    File: TestFile,
    Number,
    URL,
    fetch: fetchImplementation,
    globalThis: {},
  });
  vm.runInContext(
    ts.transpile(source, { target: ts.ScriptTarget.ES2020 }),
    context,
  );
  return context.globalThis.PostFlowJobMedia;
}

const validReference = {
  index: 0,
  contentType: 'video/mp4',
  sizeBytes: 1024,
  fileName: 'postflow-media.mp4',
  fetchPath: '/api/jobs/job-1/media/0',
  accessToken: 'a'.repeat(43),
  expiresAt: '2026-10-09T03:00:00.000Z',
};

test('accepts a bounded job-scoped media reference', () => {
  const { normalizeJobMediaReference } = loadMediaTypes();
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeJobMediaReference(validReference))),
    validReference,
  );
});

test('rejects malformed paths, tokens, and oversized attachments', () => {
  const { normalizeJobMediaReference, MAX_DELIVERED_MEDIA_BYTES } = loadMediaTypes();
  assert.equal(normalizeJobMediaReference({ ...validReference, fetchPath: 'https://evil.example/video' }), null);
  assert.equal(normalizeJobMediaReference({ ...validReference, accessToken: 'short' }), null);
  assert.equal(normalizeJobMediaReference({ ...validReference, sizeBytes: MAX_DELIVERED_MEDIA_BYTES + 1 }), null);
});

test('drops invalid media references from an otherwise valid post payload', () => {
  const { getJobMediaReferences } = loadMediaTypes();
  const references = getJobMediaReferences({
    media: [validReference, { ...validReference, contentType: 'text/html' }],
  });
  assert.equal(references.length, 1);
  assert.equal(references[0].contentType, 'video/mp4');
});

test('fetches one scoped Blob and creates the isolated File', async () => {
  let requestedUrl;
  let requestedOptions;
  const bytes = new Blob(['Hello'], { type: 'video/mp4' });
  const runtime = loadMediaRuntime(async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      status: 200,
      headers: new Map([
        ['content-length', '5'],
        ['content-type', 'video/mp4'],
      ]),
      blob: async () => bytes,
    };
  });

  const file = await runtime.fetchJobMediaFile(
    { ...validReference, sizeBytes: 5, expiresAt: '2099-01-01T00:00:00.000Z' },
    'https://api.example.test',
  );

  assert.equal(requestedUrl.href, 'https://api.example.test/api/jobs/job-1/media/0');
  assert.equal(requestedOptions.credentials, 'omit');
  assert.equal(requestedOptions.headers.Authorization, `Bearer ${validReference.accessToken}`);
  assert.equal(file.name, 'postflow-media.mp4');
  assert.equal(file.type, 'video/mp4');
});

test('does not fetch expired references or cross-origin URLs', async () => {
  let calls = 0;
  const runtime = loadMediaRuntime(async () => {
    calls += 1;
  });
  await assert.rejects(
    runtime.fetchJobMediaFile(
      { ...validReference, expiresAt: '2000-01-01T00:00:00.000Z' },
      'https://api.example.test',
    ),
    /MEDIA_ACCESS_EXPIRED/,
  );
  await assert.rejects(
    runtime.fetchJobMediaFile(
      {
        ...validReference,
        expiresAt: '2099-01-01T00:00:00.000Z',
        fetchPath: 'https://evil.example/video',
      },
      'https://api.example.test',
    ),
    /MEDIA_URL_INVALID/,
  );
  assert.equal(calls, 0);
});

test('streams an exact 25 MiB response without calling response.blob()', async () => {
  const maxBytes = 25 * 1024 * 1024;
  let blobCalls = 0;
  let cancelled = false;
  let pending = true;
  const runtime = loadMediaRuntime(async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name === 'content-type' ? 'video/mp4' : null),
    },
    blob: async () => {
      blobCalls += 1;
      throw new Error('response.blob() should not be called for streamed bodies');
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (pending) {
            pending = false;
            return { done: false, value: { byteLength: maxBytes } };
          }
          return { done: true, value: undefined };
        },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
  }));

  const file = await runtime.fetchJobMediaFile(
    { ...validReference, sizeBytes: maxBytes, expiresAt: '2099-01-01T00:00:00.000Z' },
    'https://api.example.test',
  );

  assert.equal(file.parts[0].size, maxBytes);
  assert.equal(blobCalls, 0);
  assert.equal(cancelled, false);
});

test('cancels a streamed response as soon as it exceeds 25 MiB', async () => {
  const maxBytes = 25 * 1024 * 1024;
  let blobCalls = 0;
  let cancelled = false;
  const runtime = loadMediaRuntime(async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name === 'content-type' ? 'video/mp4' : null),
    },
    blob: async () => {
      blobCalls += 1;
      throw new Error('response.blob() should not be called for streamed bodies');
    },
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: { byteLength: maxBytes + 1 } }),
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
  }));

  await assert.rejects(
    runtime.fetchJobMediaFile(
      { ...validReference, sizeBytes: maxBytes, expiresAt: '2099-01-01T00:00:00.000Z' },
      'https://api.example.test',
    ),
    /MEDIA_SIZE_INVALID/,
  );
  assert.equal(blobCalls, 0);
  assert.equal(cancelled, true);
});

test('bounds Blob-only responses when a streaming body is unavailable', async () => {
  const maxBytes = 25 * 1024 * 1024;
  let blobCalls = 0;
  const runtime = loadMediaRuntime(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'video/mp4']]),
    blob: async () => {
      blobCalls += 1;
      return { size: maxBytes + 1 };
    },
  }));

  await assert.rejects(
    runtime.fetchJobMediaFile(
      { ...validReference, sizeBytes: maxBytes, expiresAt: '2099-01-01T00:00:00.000Z' },
      'https://api.example.test',
    ),
    /MEDIA_SIZE_INVALID/,
  );
  assert.equal(blobCalls, 1);
});
