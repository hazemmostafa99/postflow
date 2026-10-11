type TikTokPopupState = {
  tiktokSessionDetected?: boolean;
  tiktokDetectedUsername?: string | null;
  tiktokConnectionStatus?: string | null;
  tiktokConnectionError?: string | null;
  extensionLifecycleStatus?: string | null;
  clerkUserId?: string | null;
};

function renderTikTokState(state: TikTokPopupState): void {
  const status = document.getElementById('tiktok-status');
  const detail = document.getElementById('tiktok-detail');
  const dot = document.getElementById('tiktok-dot');
  const retryButton = document.getElementById('retry-tiktok') as HTMLButtonElement | null;
  if (!status || !detail || !dot) return;
  const detected = state.tiktokSessionDetected === true;
  const connectionStatus = state.tiktokConnectionStatus || 'UNKNOWN';
  const connected = detected && connectionStatus === 'CONNECTED';
  const username = typeof state.tiktokDetectedUsername === 'string'
    ? state.tiktokDetectedUsername
    : '';
  status.textContent = connected ? 'Connected'
    : connectionStatus === 'UNKNOWN' ? 'Not checked'
      : detected ? 'Signed in, not connected' : 'Not connected';
  detail.textContent = state.tiktokConnectionError || (username
    ? `@${username} · ${connectionStatus.replace(/_/g, ' ')}`
    : `Open TikTok · ${connectionStatus.replace(/_/g, ' ')}`);
  dot.className = `status-dot ${connected ? 'synced' : detected ? 'not-synced' : 'offline'}`;
  if (retryButton) retryButton.hidden = connected || !state.clerkUserId ||
    ['REVOKED', 'REVOKE_PENDING'].includes(state.extensionLifecycleStatus ?? '');
}

export function initTikTokPopup(): void {
  const keys = [
    'tiktokSessionDetected',
    'tiktokDetectedUsername',
    'tiktokConnectionStatus',
    'tiktokConnectionError',
    'extensionLifecycleStatus',
    'clerkUserId',
  ];
  void chrome.storage.local.get(keys).then((state) => {
    renderTikTokState(state as TikTokPopupState);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !keys.some((key) => key in changes)) return;
    void chrome.storage.local.get(keys).then((state) => {
      renderTikTokState(state as TikTokPopupState);
    });
  });
}
