const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = vm.createContext({ exports: {}, Date });
vm.runInContext(ts.transpile(readFileSync(resolve(__dirname, '../src/app/(dashboard)/connections/connection-platforms.ts'), 'utf8'), {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
}), context);
const { connectionRows, connectionActionPath, isCurrentConnection } = context.exports;
const now = Date.now();
const legacy = { _id: 'fb', status: 'CONNECTED', workerStatus: 'ONLINE', facebookSessionDetected: true };
const extension = { _id: 'extension', displayName: 'Work', status: 'ACTIVE', lastHeartbeat: new Date(now).toISOString(),
  legacyFacebookConnectionId: 'fb', accounts: [{ platform: 'INSTAGRAM', connectionId: 'ig', username: 'creator', status: 'CONNECTED', workerStatus: 'IDLE', sessionDetected: true }] };

test('keeps one original-style row with platform details and explicit installation identity', () => {
  const rows = connectionRows([legacy], [extension], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, 'fb');
  assert.equal(rows[0].installationId, 'extension');
  assert.equal(rows[0].displayName, 'Work');
  assert.equal(rows[0].platformAccounts[0].username, 'creator');
  assert.equal(rows[0].connectivity, 'ONLINE');
  assert.equal(legacy.displayName, undefined);
});

test('keeps extensions without Facebook visible and never joins by name', () => {
  const rows = connectionRows([{ ...legacy, displayName: 'Work' }], [{ ...extension, legacyFacebookConnectionId: null }], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, 'extension');
  assert.equal(rows[0].legacyFacebookConnectionId, null);
  assert.equal(rows[0].platformAccounts[0].connectionId, 'ig');
});

test('does not duplicate archived Facebook connections in the active list', () => {
  assert.equal(connectionRows([], [extension], now).length, 0);
});

test('revoked extensions are excluded from Active even with a recent heartbeat', () => {
  assert.equal(connectionRows([legacy], [{ ...extension, status: 'REVOKED' }], now).length, 0);
});

test('Active keeps current paused/offline/disconnecting connections manageable, but excludes historical records', () => {
  for (const lifecycle of ['ACTIVE', 'PAUSED', 'REVOKE_PENDING']) {
    assert.equal(isCurrentConnection({ ...legacy, lifecycle, isOnline: false }), true);
  }
  for (const lifecycle of ['REVOKED', 'LEGACY', undefined]) {
    assert.equal(isCurrentConnection({ ...legacy, lifecycle }), false);
  }
  assert.equal(isCurrentConnection({ ...legacy, lifecycle: 'ACTIVE', archivedAt: '2026-10-09' }), false);
});

test('only current connections contribute rows and dashboard totals', () => {
  const rows = connectionRows([], [
    { ...extension, legacyFacebookConnectionId: null },
    { ...extension, _id: 'old', legacyFacebookConnectionId: null, status: 'REVOKED' },
  ], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].installationId, 'extension');
});

test('shared controls target the installation; legacy recovery remains account-scoped', () => {
  const [row] = connectionRows([legacy], [extension], now);
  assert.equal(connectionActionPath(row, 'rename'), '/api/extensions/browser-connections/extension');
  assert.equal(connectionActionPath(row, 'pause'), '/api/extensions/browser-connections/extension/pause');
  assert.equal(connectionActionPath(row, 'disconnect'), '/api/extensions/browser-connections/extension/disconnect');
  assert.equal(connectionActionPath(row, 'force-disconnect'), '/api/extensions/browser-connections/extension/force-disconnect');
  assert.equal(connectionActionPath(row, 'remove'), '/api/extensions/browser-connections/extension/remove');
  assert.equal(connectionActionPath({ ...row, archivedAt: '2026-10-09' }, 'rename'), '/api/extensions/connections/fb');
});

test('an archived installation is excluded from Active and retained in historical rows without Facebook', () => {
  const archived = { ...extension, legacyFacebookConnectionId: null, status: 'REVOKED', archivedAt: '2026-10-09T00:00:00Z', archiveReason: 'REMOVED' };
  assert.equal(connectionRows([], [archived], now).length, 0);
  const [row] = connectionRows([], [archived], now, true);
  assert.equal(row.installationId, 'extension');
  assert.equal(row.archivedAt, archived.archivedAt);
  assert.equal(row.platformAccounts[0].connectionId, 'ig');
});

test('legacy Facebook archival remains available on the legacy endpoint', () => {
  assert.equal(connectionActionPath(legacy, 'remove'), '/api/extensions/connections/fb');
});

test('expanded platform diagnostics render each account, status, and session without exposing full Facebook IDs', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const detailsContext = vm.createContext({ exports: {}, React });
  vm.runInContext(ts.transpile(readFileSync(resolve(__dirname, '../src/app/(dashboard)/connections/platform-details.tsx'), 'utf8'), {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  }), detailsContext);
  const html = renderToStaticMarkup(React.createElement(detailsContext.exports.PlatformDetails, { accounts: [
    { platform: 'FACEBOOK', connectionId: 'fb', accountId: '12345678901234', status: 'CONNECTED', workerStatus: 'ONLINE', sessionDetected: true },
    { platform: 'INSTAGRAM', connectionId: 'ig', username: 'creator', status: 'LOGIN_REQUIRED', workerStatus: 'LOGIN_REQUIRED', sessionDetected: false },
    { platform: 'TIKTOK', connectionId: null, status: 'NOT_DETECTED', workerStatus: 'OFFLINE', sessionDetected: false },
  ] }));
  for (const label of ['Platform details', 'Facebook', 'Instagram', 'TikTok', '@creator', 'login required', 'Not detected', 'Worker status', '••••1234']) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(!html.includes('12345678901234'));
});
