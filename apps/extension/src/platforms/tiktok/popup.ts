type TikTokPopupState = {
  tiktokSessionDetected?: boolean;
  tiktokDetectedUsername?: string | null;
  tiktokConnectionStatus?: string | null;
};

function renderTikTokState(state: TikTokPopupState): void {
  const status = document.getElementById('tiktok-status');
  const detail = document.getElementById('tiktok-detail');
  const dot = document.getElementById('tiktok-dot');
  if (!status || !detail || !dot) return;
  const detected = state.tiktokSessionDetected === true;
  const connectionStatus = state.tiktokConnectionStatus || 'UNKNOWN';
  const username = typeof state.tiktokDetectedUsername === 'string'
    ? state.tiktokDetectedUsername
    : '';
  status.textContent = detected ? 'Session detected' : 'Not detected';
  detail.textContent = username
    ? `@${username} · ${connectionStatus.replace(/_/g, ' ')}`
    : `Open TikTok · ${connectionStatus.replace(/_/g, ' ')}`;
  dot.className = `status-dot ${detected ? 'synced' : 'not-synced'}`;
}

export function initTikTokPopup(): void {
  const keys = [
    'tiktokSessionDetected',
    'tiktokDetectedUsername',
    'tiktokConnectionStatus',
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
