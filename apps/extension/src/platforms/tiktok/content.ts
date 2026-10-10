type TikTokIdentityApi = {
  detect: () => {
    evidenceState: 'VERIFIED' | 'CHECKING' | 'LOGIN_REQUIRED';
    sessionDetected: boolean;
    externalUsername?: string;
    source: string;
  };
  diagnostics?: () => Record<string, unknown>;
};

type TikTokEngagementApi = {
  check: (targetUrl: string, timeoutMs?: number) => Promise<{
    status: 'SUCCESS' | 'PARTIAL' | 'CHECK_FAILED';
    reactionCount?: number;
    commentCount?: number;
    favoriteCount?: number;
    shareCount?: number;
    reason?: string;
  }>;
};

const tiktokIdentity = (globalThis as typeof globalThis & {
  PostFlowTikTokIdentity?: TikTokIdentityApi;
}).PostFlowTikTokIdentity;
const tiktokEngagement = (globalThis as typeof globalThis & {
  PostFlowTikTokEngagement?: TikTokEngagementApi;
}).PostFlowTikTokEngagement;

let lastExecution: { jobId: string; result: Record<string, unknown>; completedAt: number } | null = null;

let tiktokExtensionContextInvalidated = false;
let tiktokIdentityInterval: number | undefined;

function stopTikTokIfContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!/extension context invalidated|context invalidated/i.test(message)) return false;
  tiktokExtensionContextInvalidated = true;
  if (tiktokIdentityInterval !== undefined) window.clearInterval(tiktokIdentityInterval);
  return true;
}

function reportTikTokIdentity(): void {
  if (tiktokExtensionContextInvalidated) return;
  const detection = tiktokIdentity?.detect();
  if (!detection || detection.evidenceState === 'CHECKING') return;
  try {
    chrome.runtime.sendMessage(
      {
        type: 'PLATFORM_SESSION_STATUS',
        platform: 'TIKTOK',
        sessionDetected: detection.sessionDetected,
        evidenceState: detection.evidenceState,
        ...(detection.externalUsername
          ? { externalUsername: detection.externalUsername }
          : {}),
      },
      () => {
        try {
          if (chrome.runtime.lastError && !stopTikTokIfContextInvalidated(chrome.runtime.lastError.message)) {
            console.warn('[PostFlow][TikTok] Session worker unavailable');
          }
        } catch (error) {
          if (!stopTikTokIfContextInvalidated(error)) console.warn('[PostFlow][TikTok] Session callback failed');
        }
      },
    );
  } catch (error) {
    if (!stopTikTokIfContextInvalidated(error)) console.warn('[PostFlow][TikTok] Session report failed', error);
  }
}

reportTikTokIdentity();
 tiktokIdentityInterval = window.setInterval(reportTikTokIdentity, 15_000);

try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (tiktokExtensionContextInvalidated) return;
    try {
      if (message?.type === 'TIKTOK_COMPOSER_READY') {
        const targetType = message.targetType === 'TIKTOK_PHOTO' ? 'TIKTOK_PHOTO' : 'TIKTOK_VIDEO';
        void tiktokComposer.prepare(targetType).then((ready) => {
          const diagnostics = tiktokComposer.diagnostics(targetType);
          console.info('[PostFlow][TikTok] Composer readiness probe', { ready, ...diagnostics, url: location.href });
          sendResponse({ ready, diagnostics });
        }).catch(() => sendResponse({ ready: false, diagnostics: tiktokComposer.diagnostics(targetType) }));
        return true;
      }
      if (message?.type === 'TIKTOK_COMPOSER_PING') {
        sendResponse({ ok: true, busy: tiktokComposer.isBusy(), lastExecution });
        return;
      }
      if (message?.type === 'CHECK_TIKTOK_POST_ENGAGEMENT') {
        if (!tiktokEngagement || typeof message.postUrl !== 'string') {
          sendResponse({ ok: false, result: { status: 'CHECK_FAILED', reason: 'TikTok engagement extractor is unavailable' } });
          return;
        }
        console.info('[PostFlow][TikTok] Engagement check received', { postUrl: message.postUrl });
        void tiktokEngagement.check(message.postUrl)
          .then((result) => {
            console.info('[PostFlow][TikTok] Engagement check completed', { status: result.status });
            sendResponse({ ok: true, result });
          })
          .catch((error) => {
            console.warn('[PostFlow][TikTok] Engagement check failed', {
              reason: error instanceof Error ? error.message : 'TikTok engagement check failed',
            });
            sendResponse({
              ok: true,
              result: {
                status: 'CHECK_FAILED',
                reason: error instanceof Error ? error.message : 'TikTok engagement check failed',
              },
            });
          });
        return true;
      }
      if (message?.type === 'TIKTOK_EXECUTE_JOB') {
        console.info('[PostFlow][TikTok] Composer execution started', { jobId: message.jobId, url: location.href });
        void tiktokComposer.execute(message).then((result) => {
          lastExecution = { jobId: message.jobId, result: result as Record<string, unknown>, completedAt: Date.now() };
          console.info('[PostFlow][TikTok] Composer execution finished', {
            jobId: message.jobId,
            status: result.status,
            success: result.success,
            reason: result.reason,
          });
          sendResponse(result);
        }).catch((error: unknown) => {
          const result = { success: false, status: 'FAILED', reason: 'TikTok composer failed' };
          lastExecution = { jobId: message.jobId, result, completedAt: Date.now() };
          if (!stopTikTokIfContextInvalidated(error)) sendResponse(result);
        });
        return true;
      }
      if (message?.type !== 'TIKTOK_GET_SESSION_EVIDENCE') return;
      const evidence = tiktokIdentity?.detect();
      sendResponse(
        evidence
          ? {
            ...evidence,
            ...(tiktokIdentity?.diagnostics ? { diagnostics: tiktokIdentity.diagnostics() } : {}),
            url: location.href,
          }
          : { evidenceState: 'CHECKING', source: 'detector-unavailable', url: location.href },
      );
    } catch (error) {
      if (!stopTikTokIfContextInvalidated(error)) sendResponse({ ok: false, reason: 'TikTok content script unavailable' });
    }
  });
} catch (error) {
  stopTikTokIfContextInvalidated(error);
}
