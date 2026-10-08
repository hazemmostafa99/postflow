const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadRecoveryHelpers() {
  const source = readFileSync(
    resolve(__dirname, '../src/extension-recovery.ts'),
    'utf8',
  );
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  const moduleExports = {};
  const context = vm.createContext({
    exports: moduleExports,
    module: { exports: moduleExports },
  });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

const {
  normalizeRecoveryCandidates,
  recoveryCandidateLabel,
  reconnectNeedsConfirmation,
} = loadRecoveryHelpers();

test('normalizes only valid, non-sensitive recovery candidate fields', () => {
  const candidates = normalizeRecoveryCandidates([
    null,
    { connectionId: '  conn-1  ', displayName: '  Office PC ', facebookUserId: '1234', activeInstallationOnline: true, credentialHash: 'secret' },
    { connectionId: '' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates)), [{
    connectionId: 'conn-1',
    displayName: 'Office PC',
    facebookUserId: '1234',
    activeInstallationOnline: true,
  }]);
  assert.equal('credentialHash' in candidates[0], false);
});

test('labels named and unnamed recovery candidates without exposing a full identity', () => {
  assert.equal(
    recoveryCandidateLabel({ connectionId: '1', displayName: 'Office PC', activeInstallationOnline: false }),
    'Office PC',
  );
  assert.equal(
    recoveryCandidateLabel({ connectionId: '2', facebookUserId: '100000009876', activeInstallationOnline: false }),
    'Facebook account ending 9876',
  );
});

test('requires stronger confirmation for an online previous installation', () => {
  assert.equal(reconnectNeedsConfirmation({ connectionId: '1', activeInstallationOnline: true }), true);
  assert.equal(reconnectNeedsConfirmation({ connectionId: '2', activeInstallationOnline: false }), false);
});
