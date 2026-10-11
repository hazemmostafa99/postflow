const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadContent(sendMessage) {
  let intervalCallback;
  let cleared;
  const context = {
    console: { info() {}, log() {}, warn() {}, error() {} },
    location: { href: 'https://www.instagram.com/' },
    PostFlowInstagramIdentity: {
      detect: () => ({
        sessionDetected: true,
        externalUsername: 'account.a',
        source: 'profile-link',
        evidenceState: 'VERIFIED',
      }),
    },
    chrome: {
      runtime: {
        sendMessage,
        lastError: undefined,
        onMessage: { addListener() {} },
      },
    },
    window: {
      setInterval(callback) { intervalCallback = callback; return 7; },
      clearInterval(id) { cleared = id; },
    },
  };
  const source = readFileSync(resolve(__dirname, '../src/platforms/instagram/content.ts'), 'utf8');
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return { context, intervalCallback, get cleared() { return cleared; } };
}

test('Instagram content reporting survives an invalidated extension context', () => {
  const loaded = loadContent(() => {
    throw new Error('Extension context invalidated.');
  });
  assert.equal(loaded.cleared, 7);
  assert.doesNotThrow(() => loaded.intervalCallback());
  assert.equal(loaded.cleared, 7);
});

test('Instagram content reporting still sends a normal session message', () => {
  const messages = [];
  const loaded = loadContent((message, callback) => {
    messages.push(message);
    callback(undefined);
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].platform, 'INSTAGRAM');
  assert.equal(messages[0].externalUsername, 'account.a');
  assert.equal(loaded.cleared, undefined);
});
