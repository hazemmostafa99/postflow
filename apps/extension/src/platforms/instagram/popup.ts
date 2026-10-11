type InstagramPopupState = {
  instagramSessionDetected?: boolean;
  instagramDetectedAccountId?: string | null;
  instagramConnectionStatus?: string | null;
  instagramConnectionError?: string | null;
  extensionLifecycleStatus?: string | null;
  clerkUserId?: string | null;
};

function renderInstagramState(state: InstagramPopupState): void {
  const statusElement = document.getElementById('instagram-status');
  const detailElement = document.getElementById('instagram-detail');
  const dotElement = document.getElementById('instagram-dot');
  const retryButton = document.getElementById('retry-instagram') as HTMLButtonElement | null;
  if (!statusElement || !detailElement || !dotElement) return;

  const detected = state.instagramSessionDetected === true;
  const connectionStatus = state.instagramConnectionStatus || 'UNKNOWN';
  const connected = detected && connectionStatus === 'CONNECTED';
  const accountIdDetected = typeof state.instagramDetectedAccountId === 'string'
    && state.instagramDetectedAccountId.length > 0;
  statusElement.textContent = connected ? 'Connected'
    : connectionStatus === 'UNKNOWN' ? 'Not checked'
      : detected ? 'Signed in, not connected' : 'Not connected';
  const readableStatus = connectionStatus.replace(/_/g, ' ');
  detailElement.textContent = state.instagramConnectionError || (accountIdDetected
    ? `Account identity linked - ${readableStatus}`
    : `Open Instagram - ${readableStatus}`);
  dotElement.className = `status-dot ${connected ? 'synced' : detected ? 'not-synced' : 'offline'}`;
  if (retryButton) retryButton.hidden = connected || !state.clerkUserId ||
    ['REVOKED', 'REVOKE_PENDING'].includes(state.extensionLifecycleStatus ?? '');
}

export function initInstagramPopup(): void {
  const keys = [
    'instagramSessionDetected',
    'instagramDetectedAccountId',
    'instagramConnectionStatus',
    'instagramConnectionError',
    'extensionLifecycleStatus',
    'clerkUserId',
  ];
  void chrome.storage.local.get(keys).then((state) => {
    renderInstagramState(state as InstagramPopupState);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !keys.some((key) => key in changes)) return;
    void chrome.storage.local.get(keys).then((state) => {
      renderInstagramState(state as InstagramPopupState);
    });
  });
}
