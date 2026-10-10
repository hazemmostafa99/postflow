const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Loads the dashboard TSX module in a sandbox with stubbed imports so the
// exported pure helpers (lifecycle mapping, action availability, confirm
// specs, view derivation) can be tested directly.
function loadDashboard() {
  const source = readFileSync(
    resolve(__dirname, '../src/app/(dashboard)/connections/connections-dashboard.tsx'),
    'utf8',
  );
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
  });
  const moduleExports = {};
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    exports: moduleExports,
    module: { exports: moduleExports },
    // Module imports are only dereferenced inside component bodies, which the
    // tests never render, so an empty object is a sufficient stub.
    require: () => ({}),
    // ACTION_ITEMS builds icon JSX at module load; createElement must tolerate
    // undefined element types.
    React: { createElement: () => null, Fragment: Symbol('Fragment') },
    Date,
    Intl,
    URL,
  });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context);
  return context.module.exports;
}

const {
  normalizeLifecycle,
  getConnectionView,
  availableActions,
  getConfirmSpec,
  matchesFilter,
} = loadDashboard();

test('an Instagram-only extension is ready in the original dashboard', () => {
  const view = getConnectionView(makeConnection({ facebookSessionDetected: false, facebookUserId: undefined,
    platformAccounts: [{ platform: 'INSTAGRAM', connectionId: 'ig', status: 'CONNECTED', workerStatus: 'IDLE', sessionDetected: true }] }), Date.now());
  assert.equal(view.state, 'READY');
});

test('publishing on Instagram is visible even if Facebook needs login', () => {
  const view = getConnectionView(makeConnection({ status: 'LOGIN_REQUIRED',
    platformAccounts: [{ platform: 'INSTAGRAM', connectionId: 'ig', status: 'CONNECTED', workerStatus: 'PUBLISHING', sessionDetected: true }] }), Date.now());
  assert.equal(view.state, 'PUBLISHING');
});

test('extensions without Facebook only offer implemented shared lifecycle controls', () => {
  const actions = availableActions(makeConnection({ installationId: 'ext', legacyFacebookConnectionId: null }));
  assert.deepEqual(Array.from(actions), ['rename', 'pause', 'disconnect', 'force-disconnect', 'remove']);
});

function makeConnection(overrides = {}) {
  return {
    _id: 'conn-1',
    status: 'CONNECTED',
    workerStatus: 'READY',
    facebookSessionDetected: true,
    facebookUserId: '100000000000001',
    detectedFacebookUserId: '100000000000001',
    extensionInstanceId: 'ext-instance-1',
    lastHeartbeat: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    isOnline: true,
    connectivity: 'ONLINE',
    lifecycle: 'ACTIVE',
    ...overrides,
  };
}

test('normalizeLifecycle maps backend lifecycle values', () => {
  assert.equal(normalizeLifecycle(makeConnection({ lifecycle: 'PAUSED' })), 'PAUSED');
  assert.equal(normalizeLifecycle(makeConnection({ lifecycle: 'REVOKE_PENDING' })), 'REVOKE_PENDING');
  assert.equal(normalizeLifecycle(makeConnection({ lifecycle: 'REVOKED' })), 'REVOKED');
  assert.equal(normalizeLifecycle(makeConnection({ lifecycle: 'ACTIVE' })), 'ACTIVE');
});

test('normalizeLifecycle falls back to installationStatus, then legacy instance ID', () => {
  assert.equal(
    normalizeLifecycle(makeConnection({ lifecycle: null, installationStatus: 'PAUSED' })),
    'PAUSED',
  );
  // Legacy installation: no lifecycle field, but an instance ID means it
  // behaves like ACTIVE until the next register issues a credential.
  assert.equal(
    normalizeLifecycle(makeConnection({ lifecycle: null, installationStatus: null })),
    'ACTIVE',
  );
  assert.equal(
    normalizeLifecycle(makeConnection({ lifecycle: null, installationStatus: null, extensionInstanceId: undefined })),
    null,
  );
});

test('getConnectionView surfaces every administrative lifecycle distinctly', () => {
  const now = Date.now();
  for (const [lifecycle, label] of [
    ['ACTIVE', 'Active'],
    ['PAUSED', 'Paused'],
    ['REVOKE_PENDING', 'Disconnecting'],
    ['REVOKED', 'Disconnected'],
  ]) {
    const view = getConnectionView(makeConnection({ lifecycle }), now);
    assert.equal(view.lifecycle, lifecycle);
    assert.equal(view.lifecycleLabel, label);
    assert.ok(view.lifecycleMessage.length > 0, `missing message for ${lifecycle}`);
  }
});

test('getConnectionView marks revoked connections as disconnected regardless of health', () => {
  const view = getConnectionView(makeConnection({ lifecycle: 'REVOKED' }), Date.now());
  assert.equal(view.state, 'ATTENTION');
  assert.equal(view.stateLabel, 'Disconnected');
});

test('getConnectionView derives offline from backend connectivity', () => {
  const view = getConnectionView(
    makeConnection({ isOnline: false, connectivity: 'OFFLINE', connectivityReason: 'NO_RECENT_HEARTBEAT' }),
    Date.now(),
  );
  assert.equal(view.state, 'OFFLINE');
  assert.ok(view.message.includes('NO_RECENT_HEARTBEAT'));
});

test('getConnectionView reports READY for a healthy active connection', () => {
  const view = getConnectionView(makeConnection(), Date.now());
  assert.equal(view.state, 'READY');
  assert.equal(view.stateLabel, 'Ready');
});

test('availableActions covers each lifecycle transition', () => {
  const active = availableActions(makeConnection({ lifecycle: 'ACTIVE' }));
  assert.deepEqual([...active].sort(), [
    'disconnect',
    'force-disconnect',
    'pause',
    'remove',
    'rename',
  ]);

  const paused = availableActions(makeConnection({ lifecycle: 'PAUSED' }));
  assert.ok(paused.includes('resume'), 'paused connections can resume');
  assert.ok(!paused.includes('pause'), 'paused connections cannot pause again');

  const pending = availableActions(makeConnection({ lifecycle: 'REVOKE_PENDING' }));
  assert.deepEqual([...pending].sort(), ['force-disconnect', 'rename']);

  const revoked = availableActions(makeConnection({ lifecycle: 'REVOKED' }));
  assert.deepEqual([...revoked].sort(), ['remove', 'rename']);

  const archived = availableActions(makeConnection({ lifecycle: 'REVOKED', archivedAt: new Date().toISOString() }));
  assert.deepEqual([...archived].sort(), ['rename', 'restore']);
});

test('confirm specs explain job and queue effects', () => {
  const disconnect = getConfirmSpec('disconnect');
  assert.ok(disconnect.effects.some((effect) => effect.includes('Queued jobs stay queued')));
  assert.ok(disconnect.effects.some((effect) => effect.toLowerCase().includes('current job')));
  assert.equal(disconnect.destructive, false);

  const force = getConfirmSpec('force-disconnect');
  assert.equal(force.typedConfirmation, 'FORCE');
  assert.ok(force.effects.some((effect) => effect.includes('credential is invalidated')));

  const remove = getConfirmSpec('remove');
  assert.ok(remove.effects.some((effect) => effect.includes('kept')));
  assert.ok(remove.effects.some((effect) => effect.includes('restore')));

  const pause = getConfirmSpec('pause');
  assert.ok(pause.effects.some((effect) => effect.includes('already leased')));
  assert.equal(pause.destructive, false);

  const resume = getConfirmSpec('resume');
  assert.ok(resume.effects.some((effect) => effect.includes('Queued jobs') || effect.includes('claims are allowed')));
});

test('matchesFilter keeps paused and disconnecting connections out of Ready', () => {
  const now = Date.now();
  const readyActive = getConnectionView(makeConnection({ lifecycle: 'ACTIVE' }), now);
  const readyPaused = getConnectionView(makeConnection({ lifecycle: 'PAUSED' }), now);
  const readyPending = getConnectionView(makeConnection({ lifecycle: 'REVOKE_PENDING' }), now);

  assert.equal(matchesFilter(readyActive, 'READY'), true);
  assert.equal(matchesFilter(readyPaused, 'READY'), false, 'paused must not count as ready');
  assert.equal(matchesFilter(readyPending, 'READY'), false, 'disconnecting must not count as ready');
  assert.equal(matchesFilter(readyPaused, 'ALL'), true);
});

test('matchesFilter routes health attention states to the attention filter', () => {
  const now = Date.now();
  const mismatch = getConnectionView(
    makeConnection({ status: 'CONNECTED', workerStatus: 'ACCOUNT_MISMATCH' }),
    now,
  );
  assert.equal(mismatch.state, 'ATTENTION');
  assert.equal(matchesFilter(mismatch, 'ATTENTION'), true);
});
