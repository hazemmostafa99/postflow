type InstagramIdentityApi = {
  detect: () => {
    sessionDetected: boolean;
    externalUsername?: string;
    source: string;
  };
};

type InstagramContentComposerApi = {
  execute: (message: {
    jobId?: string;
    expectedUsername?: string;
    targetType?: string;
    post?: { content?: string; mediaUrls?: string[] };
  }) => Promise<{
    success: boolean;
    status: 'PUBLISHED' | 'UNKNOWN' | 'FAILED';
    canceled?: boolean;
    reason?: string;
    postUrl?: string;
  }>;
};

const detector = (globalThis as typeof globalThis & {
  PostFlowInstagramIdentity?: InstagramIdentityApi;
}).PostFlowInstagramIdentity;
const composer = (globalThis as typeof globalThis & {
  PostFlowInstagramComposer?: InstagramContentComposerApi;
}).PostFlowInstagramComposer;

console.info('[PostFlow][Instagram] Content script loaded', {
  href: location.href,
  detectorAvailable: Boolean(detector),
  composerAvailable: Boolean(composer),
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'INSTAGRAM_EXECUTE_JOB') return;
  if (!composer) {
    sendResponse({ success: false, status: 'FAILED', reason: 'Instagram composer is unavailable' });
    return;
  }
  console.info('[PostFlow][Instagram] Publishing command received', {
    jobId: message.jobId,
    expectedUsername: message.expectedUsername,
    targetType: message.targetType,
  });
  void composer.execute(message)
    .then((result) => {
      console.info('[PostFlow][Instagram] Publishing command completed', {
        status: result.status,
        success: result.success,
        canceled: result.canceled === true,
      });
      sendResponse(result);
    })
    .catch((error) => {
      console.error('[PostFlow][Instagram] Publishing command failed', error);
      sendResponse({
        success: false,
        status: 'FAILED',
        reason: error instanceof Error ? error.message : 'Instagram composer failed',
      });
    });
  return true;
});
