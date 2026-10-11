type InstagramIdentityApi = {
  detect: () => {
    sessionDetected: boolean;
    externalUsername?: string;
    source: string;
    evidenceState: 'VERIFIED' | 'CHECKING' | 'LOGIN_REQUIRED';
  };
  getProfileUrl?: () => string | undefined;
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

type InstagramEngagementApi = {
  check: (targetUrl: string, timeoutMs?: number) => Promise<{
    status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
    reactionCount?: number;
    commentCount?: number;
    reason?: string;
  }>;
};

const detector = (globalThis as typeof globalThis & {
  PostFlowInstagramIdentity?: InstagramIdentityApi;
}).PostFlowInstagramIdentity;
const composer = (globalThis as typeof globalThis & {
  PostFlowInstagramComposer?: InstagramContentComposerApi;
}).PostFlowInstagramComposer;
const engagement = (globalThis as typeof globalThis & {
  PostFlowInstagramEngagement?: InstagramEngagementApi;
}).PostFlowInstagramEngagement;

console.info('[PostFlow][Instagram] Content script loaded', {
  href: location.href,
  detectorAvailable: Boolean(detector),
  composerAvailable: Boolean(composer),
  engagementAvailable: Boolean(engagement),
});

let identityInterval: number | undefined;
let extensionContextInvalidated = false;
let lastIdentityReportKey: string | undefined;
let lastIdentityReportAt = 0;
const IDENTITY_REPORT_REFRESH_MS = 60_000;

function stopIdentityReporting(error?: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!/extension context invalidated|context invalidated/i.test(message)) return false;
  extensionContextInvalidated = true;
  if (identityInterval !== undefined) window.clearInterval(identityInterval);
  return true;
}

function reportCurrentIdentity(): void {
  if (extensionContextInvalidated) return;
  const detection = detector?.detect() ?? {
    sessionDetected: false,
    source: 'detector-unavailable',
    evidenceState: 'CHECKING',
  };
  const reportKey = [
    location.pathname,
    detection.sessionDetected ? '1' : '0',
    detection.evidenceState,
    detection.source,
    detection.externalUsername ?? '',
  ].join('|');
  const now = Date.now();
  if (reportKey === lastIdentityReportKey && now - lastIdentityReportAt < IDENTITY_REPORT_REFRESH_MS) return;
  lastIdentityReportKey = reportKey;
  lastIdentityReportAt = now;
  console.log('[PostFlow] Instagram session detected:', detection.sessionDetected, {
    source: detection.source,
  });

  const message = {
    type: 'PLATFORM_SESSION_STATUS',
    platform: 'INSTAGRAM',
    sessionDetected: detection.sessionDetected,
    // Sent only as a legacy fallback; the session manager drops it whenever
    // the cookie-backed account id is available.
    ...(detection.externalUsername
      ? { externalUsername: detection.externalUsername }
      : {}),
  };
  try {
    chrome.runtime.sendMessage(message, (response) => {
      try {
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
      } catch (error) {
        if (!stopIdentityReporting(error)) console.error('[PostFlow][Instagram] Session report callback failed', error);
      }
    });
  } catch (error) {
    if (!stopIdentityReporting(error)) console.error('[PostFlow][Instagram] Session report failed', error);
  }
}

identityInterval = window.setInterval(reportCurrentIdentity, 15_000);
reportCurrentIdentity();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'INSTAGRAM_GET_SESSION_EVIDENCE') {
    const evidence = detector?.detect();
    sendResponse(evidence ? { ...evidence, url: location.href } : { evidenceState: 'CHECKING', source: 'detector-unavailable', url: location.href });
    return;
  }
  if (message?.type === 'INSTAGRAM_GET_PROFILE_URL') {
    sendResponse({ profileUrl: detector?.getProfileUrl?.() });
    return;
  }
  if (message?.type === 'CHECK_INSTAGRAM_POST_ENGAGEMENT') {
    if (!engagement || typeof message.postUrl !== 'string') {
      sendResponse({ ok: false, result: { status: 'CHECK_FAILED', reason: 'Instagram engagement extractor is unavailable' } });
      return;
    }
    console.info('[PostFlow][Instagram] Engagement check received', {
      postUrl: message.postUrl,
    });
    void engagement.check(message.postUrl)
      .then((result) => {
        console.info('[PostFlow][Instagram] Engagement check completed', result);
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        console.error('[PostFlow][Instagram] Engagement check failed', error);
        sendResponse({
          ok: true,
          result: {
            status: 'CHECK_FAILED',
            reason: error instanceof Error ? error.message : 'Instagram engagement check failed',
          },
        });
      });
    return true;
  }
  if (message?.type !== 'INSTAGRAM_EXECUTE_JOB') return;
  if (!composer) {
    sendResponse({ success: false, status: 'FAILED', reason: 'Instagram composer is unavailable' });
    return;
  }
  console.info('[PostFlow][Instagram] Publishing command received', {
    jobId: message.jobId,
    expectedUsername: message.expectedUsername,
    targetType: message.targetType,
    captionLength: typeof message.post?.content === 'string' ? message.post.content.trim().length : 0,
  });
  void composer.execute(message)
    .then((result) => {
      console.info('[PostFlow][Instagram] Publishing command completed', {
        status: result.status,
        success: result.success,
        canceled: result.canceled === true,
        reason: result.reason,
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
