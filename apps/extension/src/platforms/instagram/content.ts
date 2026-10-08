type InstagramIdentityApi = {
  detect: () => {
    sessionDetected: boolean;
    externalUsername?: string;
    source: string;
  };
};

const detector = (globalThis as typeof globalThis & {
  PostFlowInstagramIdentity?: InstagramIdentityApi;
}).PostFlowInstagramIdentity;

const detection = detector?.detect() ?? {
  sessionDetected: false,
  source: 'detector-unavailable',
};

console.log('[PostFlow] Instagram session detected:', detection.sessionDetected, {
  externalUsername: detection.externalUsername,
  source: detection.source,
});

chrome.runtime.sendMessage({
  type: 'PLATFORM_SESSION_STATUS',
  platform: 'INSTAGRAM',
  sessionDetected: detection.sessionDetected,
  ...(detection.externalUsername
    ? { externalUsername: detection.externalUsername }
    : {}),
});
