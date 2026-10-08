const { test } = require('node:test');
const assert = require('node:assert/strict');

// Copied from popup.ts for testing - these are pure functions
function lifecycleLabel(status) {
  switch (status) {
    case 'ACTIVE':
      return { text: 'Connected and ready', className: 'ready', showDashboardLink: false };
    case 'PAUSED':
      return { text: 'Paused from PostFlow dashboard', className: 'paused', showDashboardLink: true };
    case 'REVOKE_PENDING':
      return { text: 'Disconnecting after current task', className: 'disconnecting', showDashboardLink: true };
    case 'REVOKED':
      return { text: 'Disconnected from PostFlow', className: 'revoked', showDashboardLink: true };
    default:
      return { text: 'Checking...', className: '', showDashboardLink: false };
  }
}

function facebookHealthLabel(status) {
  switch (status) {
    case 'CONNECTED':
      return { text: 'Facebook ready', className: 'ready' };
    case 'LOGIN_REQUIRED':
      return { text: 'Login required', className: 'attention' };
    case 'ACCOUNT_MISMATCH':
      return { text: 'Wrong Facebook account', className: 'attention' };
    case 'BLOCKED':
      return { text: 'Facebook blocked or verification required', className: 'attention' };
    case 'CHECKPOINT_OR_VERIFICATION':
      return { text: 'Facebook checkpoint or verification required', className: 'attention' };
    case 'CAPTCHA_OR_CHALLENGE':
      return { text: 'Facebook captcha or challenge', className: 'attention' };
    case 'MANUAL_INTERVENTION_REQUIRED':
      return { text: 'Manual intervention required', className: 'attention' };
    default:
      return { text: 'Facebook status unknown', className: 'attention' };
  }
}

test('lifecycleLabel returns correct text and class for ACTIVE', () => {
  const result = lifecycleLabel('ACTIVE');
  assert.equal(result.text, 'Connected and ready');
  assert.equal(result.className, 'ready');
  assert.equal(result.showDashboardLink, false);
});

test('lifecycleLabel returns correct text and class for PAUSED', () => {
  const result = lifecycleLabel('PAUSED');
  assert.equal(result.text, 'Paused from PostFlow dashboard');
  assert.equal(result.className, 'paused');
  assert.equal(result.showDashboardLink, true);
});

test('lifecycleLabel returns correct text and class for REVOKE_PENDING', () => {
  const result = lifecycleLabel('REVOKE_PENDING');
  assert.equal(result.text, 'Disconnecting after current task');
  assert.equal(result.className, 'disconnecting');
  assert.equal(result.showDashboardLink, true);
});

test('lifecycleLabel returns correct text and class for REVOKED', () => {
  const result = lifecycleLabel('REVOKED');
  assert.equal(result.text, 'Disconnected from PostFlow');
  assert.equal(result.className, 'revoked');
  assert.equal(result.showDashboardLink, true);
});

test('lifecycleLabel returns default for unknown status', () => {
  const result = lifecycleLabel('UNKNOWN');
  assert.equal(result.text, 'Checking...');
  assert.equal(result.className, '');
  assert.equal(result.showDashboardLink, false);
});

test('facebookHealthLabel returns correct text for CONNECTED', () => {
  const result = facebookHealthLabel('CONNECTED');
  assert.equal(result.text, 'Facebook ready');
  assert.equal(result.className, 'ready');
});

test('facebookHealthLabel returns correct text for LOGIN_REQUIRED', () => {
  const result = facebookHealthLabel('LOGIN_REQUIRED');
  assert.equal(result.text, 'Login required');
  assert.equal(result.className, 'attention');
});

test('facebookHealthLabel returns correct text for ACCOUNT_MISMATCH', () => {
  const result = facebookHealthLabel('ACCOUNT_MISMATCH');
  assert.equal(result.text, 'Wrong Facebook account');
  assert.equal(result.className, 'attention');
});

test('facebookHealthLabel returns correct text for BLOCKED', () => {
  const result = facebookHealthLabel('BLOCKED');
  assert.equal(result.text, 'Facebook blocked or verification required');
  assert.equal(result.className, 'attention');
});

test('facebookHealthLabel returns correct text for CHECKPOINT_OR_VERIFICATION', () => {
  const result = facebookHealthLabel('CHECKPOINT_OR_VERIFICATION');
  assert.equal(result.text, 'Facebook checkpoint or verification required');
  assert.equal(result.className, 'attention');
});

test('facebookHealthLabel returns correct text for CAPTCHA_OR_CHALLENGE', () => {
  const result = facebookHealthLabel('CAPTCHA_OR_CHALLENGE');
  assert.equal(result.text, 'Facebook captcha or challenge');
  assert.equal(result.className, 'attention');
});

test('facebookHealthLabel returns correct text for MANUAL_INTERVENTION_REQUIRED', () => {
  const result = facebookHealthLabel('MANUAL_INTERVENTION_REQUIRED');
  assert.equal(result.text, 'Manual intervention required');
  assert.equal(result.className, 'attention');
});

test('facebookHealthLabel returns default for unknown status', () => {
  const result = facebookHealthLabel('UNKNOWN');
  assert.equal(result.text, 'Facebook status unknown');
  assert.equal(result.className, 'attention');
});

// Test the canClaimNewWork logic (pure function extracted for testing)
function canClaimNewWork(lifecycle) {
  if (!lifecycle) return true;
  if (lifecycle === 'PAUSED' || lifecycle === 'REVOKE_PENDING' || lifecycle === 'REVOKED') {
    return false;
  }
  return true;
}

test('canClaimNewWork returns true when no lifecycle status is set', () => {
  assert.equal(canClaimNewWork(null), true);
  assert.equal(canClaimNewWork(''), true);
  assert.equal(canClaimNewWork(undefined), true);
});

test('canClaimNewWork returns true for ACTIVE lifecycle', () => {
  assert.equal(canClaimNewWork('ACTIVE'), true);
});

test('canClaimNewWork returns false for PAUSED lifecycle', () => {
  assert.equal(canClaimNewWork('PAUSED'), false);
});

test('canClaimNewWork returns false for REVOKE_PENDING lifecycle', () => {
  assert.equal(canClaimNewWork('REVOKE_PENDING'), false);
});

test('canClaimNewWork returns false for REVOKED lifecycle', () => {
  assert.equal(canClaimNewWork('REVOKED'), false);
});