const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpile(readFileSync(resolve(__dirname, '../src/shared/connections/index.ts'), 'utf8'), {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
}), context);
const { connectionIdentityUpdate } = context.exports;
test('stores the installation ID and shared name, not an account ID or credential', () => {
  const installationId = '012345678901234567890123';
  assert.deepEqual(JSON.parse(JSON.stringify(connectionIdentityUpdate({ installationId, connectionDisplayName: 'الشغل', connectionId: 'facebook-id', credentialHash: 'secret' }))), {
    extensionInstallationId: installationId, extensionName: 'الشغل',
  });
});
test('ignores legacy or malformed API metadata', () => {
  for (const value of [null, {}, { connectionId: 'old', displayName: 'Old' },
    { installationId: 'wrong', connectionDisplayName: 'Name' },
    { installationId: '012345678901234567890123', connectionDisplayName: '' },
    { rootConnectionId: '012345678901234567890123', connectionDisplayName: 'Draft' }]) {
    assert.equal(connectionIdentityUpdate(value), null);
  }
});
