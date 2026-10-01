const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const context = vm.createContext({ Number });
  const source = readFileSync(resolve(__dirname, '../src/publish-response.ts'), 'utf8');
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2020 }), context);
  return context;
}

test('accepts only story creation responses started during the active submit window', () => {
  const context = setup();

  assert.equal(context.isResponseForActivePublish({
    isStoryCreateResponse: true,
    requestStartedAt: 200,
  }, 200), true);

  assert.equal(context.isResponseForActivePublish({
    isStoryCreateResponse: true,
    requestStartedAt: 199,
  }, 200), false);

  assert.equal(context.isResponseForActivePublish({
    isStoryCreateResponse: false,
    requestStartedAt: 201,
  }, 200), false);
});
