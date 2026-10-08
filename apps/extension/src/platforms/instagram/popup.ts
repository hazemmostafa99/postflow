type InstagramPopupState = {
  instagramSessionDetected?: boolean;
  instagramDetectedUsername?: string | null;
  instagramConnectionStatus?: string | null;
};

function renderInstagramState(state: InstagramPopupState): void {
  const statusElement = document.getElementById('instagram-status');
  const detailElement = document.getElementById('instagram-detail');
  const dotElement = document.getElementById('instagram-dot');
  if (!statusElement || !detailElement || !dotElement) return;

  const detected = state.instagramSessionDetected === true;
  const connectionStatus = state.instagramConnectionStatus || 'UNKNOWN';
  const username = typeof state.instagramDetectedUsername === 'string'
    ? state.instagramDetectedUsername
    : '';
  statusElement.textContent = detected ? 'Session detected' : 'Not detected';
  const readableStatus = connectionStatus.replace(/_/g, ' ');
  detailElement.textContent = username
    ? `@${username} · ${readableStatus}`
    : `Open Instagram · ${readableStatus}`;
  dotElement.className = `status-dot ${detected ? 'synced' : 'not-synced'}`;
}

export function initInstagramPopup(): void {
  const keys = [
    'instagramSessionDetected',
    'instagramDetectedUsername',
    'instagramConnectionStatus',
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
