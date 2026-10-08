type PlatformSessionMessage = {
  platform?: string;
  sessionDetected?: boolean;
  externalAccountId?: string;
  externalUsername?: string;
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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'PLATFORM_SESSION_STATUS' || message.platform !== 'INSTAGRAM') {
      return;
    }
    if (!isInstagramPage(sender.tab?.url)) {
      sendResponse({ ok: false, error: 'Instagram session reports must come from instagram.com.' });
      return;
    }
    void reportInstagramSession(apiFetch, message)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not report Instagram session.',
      }));
    return true;
  });
}
