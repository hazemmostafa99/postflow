const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(responseText) {
  const events = [];
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  class XMLHttpRequest {
    addEventListener() {}
    open() {}
    send() {}
  }
  const response = {
    clone: () => ({ text: async () => responseText }),
  };
  const window = {
    fetch: async () => response,
    addEventListener: () => undefined,
    dispatchEvent: (event) => events.push(event.detail),
    postMessage: () => undefined,
  };
  const context = vm.createContext({
    console: { log: () => undefined, warn: () => undefined },
    CustomEvent,
    Date,
    decodeURIComponent,
    FormData: class FormData {},
    URL,
    URLSearchParams,
    window,
    XMLHttpRequest,
  });
  const source = readFileSync(resolve(__dirname, '../src/graphql-spy.ts'), 'utf8');
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return { context, events };
}

function composerRequestBody() {
  return new URLSearchParams({
    fb_api_req_friendly_name: 'CometComposerStoryCreateMutation',
    variables: JSON.stringify({ input: { video_id: '987654321' } }),
  }).toString();
}

test('carries an encoded composer video id into its successful response event', async () => {
  const app = setup('{"data":{"composer_submit":{"ok":true}}}');
  await app.context.window.fetch('/api/graphql/', {
    method: 'POST',
    body: composerRequestBody(),
  });
  await Promise.resolve();

  const trusted = app.events.find((event) => event.isStoryCreateResponse === true);
  assert.ok(trusted);
  assert.deepEqual(JSON.parse(JSON.stringify(trusted.videoIds)), ['987654321']);
  assert.equal(typeof trusted.requestStartedAt, 'number');
});

test('does not trust request video metadata when the composer mutation returns errors', async () => {
  const app = setup('{"errors":[{"message":"publish failed"}]}');
  await app.context.window.fetch('/api/graphql/', {
    method: 'POST',
    body: composerRequestBody(),
  });
  await Promise.resolve();

  assert.equal(app.events.some((event) => event.isStoryCreateResponse === true), false);
});
