const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadScheduleHelpers() {
  const source = readFileSync(resolve(__dirname, '../src/maintenance-schedule.ts'), 'utf8');
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  const context = vm.createContext({ exports: {}, module: { exports: {} } });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

test('startup jitter is deterministic per extension instance', () => {
  const {
    ENGAGEMENT_MAINTENANCE_WAKE_INTERVAL_MINUTES,
    MAINTENANCE_STARTUP_JITTER_MAX_MS,
    PENDING_MAINTENANCE_WAKE_INTERVAL_MINUTES,
    getMaintenanceAlarmFirstRunAt,
    getMaintenanceStartupJitterMs,
  } = loadScheduleHelpers();
  assert.equal(PENDING_MAINTENANCE_WAKE_INTERVAL_MINUTES, 10);
  assert.equal(ENGAGEMENT_MAINTENANCE_WAKE_INTERVAL_MINUTES, 15);
  const first = getMaintenanceStartupJitterMs('pfi-profile-a');
  assert.equal(first, getMaintenanceStartupJitterMs('pfi-profile-a'));
  assert.ok(first >= 0 && first <= MAINTENANCE_STARTUP_JITTER_MAX_MS);
  assert.equal(getMaintenanceAlarmFirstRunAt('pfi-profile-a', 1_000), 1_000 + first);
});

test('different instance IDs are spread across the jitter window', () => {
  const { getMaintenanceStartupJitterMs } = loadScheduleHelpers();
  const values = new Set(
    Array.from({ length: 32 }, (_, index) => getMaintenanceStartupJitterMs(`pfi-profile-${index}`)),
  );
  assert.ok(values.size > 1);
});
