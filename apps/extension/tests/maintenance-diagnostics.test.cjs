const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadDiagnostics() {
  const source = readFileSync(resolve(__dirname, '../src/maintenance-diagnostics.ts'), 'utf8');
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  const context = vm.createContext({ Date, exports: {}, module: { exports: {} } });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

test('masks extension instance IDs and increments work-specific counters', () => {
  const {
    createMaintenanceDiagnosticsSnapshot,
    incrementMaintenanceMetric,
    maskExtensionInstanceId,
  } = loadDiagnostics();
  const snapshot = createMaintenanceDiagnosticsSnapshot(
    new Date('2026-10-04T20:00:00.000Z'),
  );
  assert.equal(maskExtensionInstanceId('pfi_1234567890'), 'pfi_…7890');
  assert.equal(maskExtensionInstanceId(undefined), 'missing');
  assert.equal(
    incrementMaintenanceMetric(
      snapshot,
      'ENGAGEMENT',
      'resultSuccesses',
      new Date('2026-10-04T20:01:00.000Z'),
    ),
    1,
  );
  assert.equal(snapshot.counters.ENGAGEMENT.resultSuccesses, 1);
  assert.equal(snapshot.counters.PENDING_APPROVAL.resultSuccesses, 0);
});
