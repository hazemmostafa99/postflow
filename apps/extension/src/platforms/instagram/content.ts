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

console.info('[PostFlow][Instagram] Content script loaded', {
  href: location.href,
  detectorAvailable: Boolean(detector),
});

let lastReportKey = '';

function reportCurrentIdentity(): void {
  const detection = detector?.detect() ?? {
    sessionDetected: false,
    source: 'detector-unavailable',
  };
  const reportKey = `${detection.sessionDetected}:${detection.externalUsername ?? ''}:${location.pathname}`;
  if (reportKey === lastReportKey) return;
  lastReportKey = reportKey;

  console.log('[PostFlow] Instagram session detected:', detection.sessionDetected, {
    externalUsername: detection.externalUsername,
    source: detection.source,
  });

  const message = {
    type: 'PLATFORM_SESSION_STATUS',
    platform: 'INSTAGRAM',
    sessionDetected: detection.sessionDetected,
    ...(detection.externalUsername
      ? { externalUsername: detection.externalUsername }
      : {}),
  };
  chrome.runtime.sendMessage(message, (response) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      console.error('[PostFlow][Instagram] Could not reach session worker', {
        message: runtimeError.message,
      });
      return;
    }
    console.info('[PostFlow][Instagram] Session worker acknowledged report', {
      response,
    });
  });
}

reportCurrentIdentity();
window.setInterval(reportCurrentIdentity, 3000);
