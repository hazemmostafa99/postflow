type PlatformSessionMessage = {
  platform?: string;
  sessionDetected?: boolean;
  externalAccountId?: string;
  externalUsername?: string;
};

type InstagramPreShareCheckMessage = {
  jobId?: string;
  expectedUsername?: string;
};

type ApiFetch = (
  path: string,
  body?: Record<string, unknown>,
  method?: string,
  includeFailureDetails?: boolean,
) => Promise<unknown>;

export function isInstagramPage(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

export function reportInstagramSession(
  apiFetch: ApiFetch,
  message: PlatformSessionMessage,
): Promise<unknown> {
  console.info('[PostFlow][Instagram] Reporting session to API', {
    sessionDetected: message.sessionDetected === true,
    externalUsername: message.externalUsername || null,
  });
  return apiFetch(
    '/api/extensions/platform-session',
    {
      platform: 'INSTAGRAM',
      sessionDetected: message.sessionDetected === true,
      ...(typeof message.externalAccountId === 'string' && message.externalAccountId.trim()
        ? { externalAccountId: message.externalAccountId.trim() }
        : {}),
      ...(typeof message.externalUsername === 'string' && message.externalUsername.trim()
        ? { externalUsername: message.externalUsername.trim() }
        : {}),
    },
    'POST',
    true,
  );
}

export function registerInstagramSessionWorker(apiFetch: ApiFetch): void {
  console.info('[PostFlow][Instagram] Session worker registered');
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'INSTAGRAM_PRE_SHARE_CHECK') {
      if (!isInstagramPage(sender.tab?.url)) {
        sendResponse({ ok: false, reason: 'Pre-share checks must come from instagram.com.' });
        return;
      }

      const request = message as InstagramPreShareCheckMessage;
      const expectedUsername = request.expectedUsername?.trim().toLowerCase();
      if (!request.jobId || !expectedUsername) {
        sendResponse({ ok: false, reason: 'Instagram pre-share identity data is incomplete.' });
        return;
      }

      void (async () => {
        const stored = await chrome.storage.local.get([
          'instagramSessionDetected',
          'instagramDetectedUsername',
        ]);
        const detectedUsername = typeof stored.instagramDetectedUsername === 'string'
          ? stored.instagramDetectedUsername.trim().toLowerCase()
          : '';
        if (stored.instagramSessionDetected !== true || detectedUsername !== expectedUsername) {
          console.warn('[PostFlow][Instagram] Pre-share identity rejected', {
            jobId: request.jobId,
            expectedUsername,
            detectedUsername: detectedUsername || null,
          });
          return {
            ok: false,
            reason: 'Instagram account changed or is no longer verified before Share.',
          };
        }

        const latestJob = await apiFetch(
          `/api/jobs/${encodeURIComponent(request.jobId!)}`,
          undefined,
          'GET',
          true,
        ) as {
          status?: string;
          apiFetchError?: boolean;
        } | null;
        if (!latestJob || latestJob.apiFetchError || latestJob.status !== 'RUNNING') {
          console.warn('[PostFlow][Instagram] Pre-share job-status check rejected', {
            jobId: request.jobId,
            status: latestJob?.status || 'UNAVAILABLE',
          });
          return {
            ok: false,
            canceled: latestJob?.status === 'CANCEL_REQUESTED' || latestJob?.status === 'CANCELED',
            reason: latestJob?.status === 'CANCEL_REQUESTED' || latestJob?.status === 'CANCELED'
              ? 'Instagram job was canceled before Share.'
              : 'Instagram job is no longer eligible for Share.',
          };
        }

        console.info('[PostFlow][Instagram] Pre-share checks passed', {
          jobId: request.jobId,
          expectedUsername,
        });
        return { ok: true };
      })()
        .then(sendResponse)
        .catch((error) => {
          console.error('[PostFlow][Instagram] Pre-share check failed', error);
          sendResponse({
            ok: false,
            reason: 'Could not verify the Instagram job before Share.',
          });
        });
      return true;
    }

    if (message?.type !== 'PLATFORM_SESSION_STATUS' || message.platform !== 'INSTAGRAM') {
      return;
    }
    console.info('[PostFlow][Instagram] Session message received', {
      tabId: sender.tab?.id ?? null,
      tabUrl: sender.tab?.url ?? null,
      sessionDetected: message.sessionDetected === true,
      externalUsername: message.externalUsername || null,
    });
    if (!isInstagramPage(sender.tab?.url)) {
      console.warn('[PostFlow][Instagram] Ignoring message from non-Instagram tab', {
        tabUrl: sender.tab?.url ?? null,
      });
      sendResponse({ ok: false, error: 'Instagram session reports must come from instagram.com.' });
      return;
    }
    void reportInstagramSession(apiFetch, message)
      .then(async (result) => {
        const response = result as {
          connection?: {
            status?: string;
            workerStatus?: string;
            detectedExternalUsername?: string;
          };
          status?: string;
          workerStatus?: string;
          detectedExternalUsername?: string;
        } | null;
        const connection = response?.connection ?? response;
        if (response && 'apiFetchError' in response) {
          console.error('[PostFlow][Instagram] API rejected session report', response);
        } else {
          console.info('[PostFlow][Instagram] API accepted session report', {
            connected: Boolean(connection),
            status: connection?.status || 'UNKNOWN',
            workerStatus: connection?.workerStatus || 'UNKNOWN',
            detectedExternalUsername: connection?.detectedExternalUsername || message.externalUsername || null,
          });
        }
        await chrome.storage.local.set({
          instagramSessionDetected: message.sessionDetected === true,
          instagramDetectedUsername:
            connection?.detectedExternalUsername || message.externalUsername || null,
          instagramConnectionStatus: connection?.status || 'UNKNOWN',
          instagramWorkerStatus: connection?.workerStatus || 'UNKNOWN',
        });
        sendResponse(result);
      })
      .catch((error) => {
        console.error('[PostFlow][Instagram] Session report failed', error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Could not report Instagram session.',
        });
      });
    return true;
  });
}
