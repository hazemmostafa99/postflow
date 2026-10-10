import { InstagramSessionManager, isInstagramPage, type InstagramSessionApiFetch } from './session-manager.js';

let sessionManager: InstagramSessionManager | null = null;
const lastSessionMessageLog = new Map<number, string>();
const lastSessionResultLog = new Map<number, string>();

export async function refreshInstagramSession(expectedAccountId?: string, expectedUsername?: string): Promise<boolean> {
  if (!sessionManager) return false;
  try {
    return await sessionManager.refresh(expectedAccountId, expectedUsername);
  } catch (error) {
    console.warn('[PostFlow][Instagram] Session refresh could not read an Instagram tab', error);
    return false;
  }
}

export function registerInstagramSessionWorker(apiFetch: InstagramSessionApiFetch): void {
  const sessions = new InstagramSessionManager(apiFetch);
  sessionManager = sessions;
  console.info('[PostFlow][Instagram] Session manager registered');
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const isReport = message?.type === 'PLATFORM_SESSION_STATUS' && message.platform === 'INSTAGRAM';
    const isPreShare = message?.type === 'INSTAGRAM_PRE_SHARE_CHECK';
    if (!isReport && !isPreShare) return;
    const tabId = sender.tab?.id;
    const messageLogKey = `${tabId ?? 'unknown'}:${sender.documentId ?? 'unknown'}:${sender.tab?.url ?? ''}:${isReport ? 'SESSION_EVIDENCE' : 'PRE_SHARE_CHECK'}`;
    if (typeof tabId !== 'number' || lastSessionMessageLog.get(tabId) !== messageLogKey) {
      if (typeof tabId === 'number') lastSessionMessageLog.set(tabId, messageLogKey);
      console.info('[PostFlow][Instagram] Session message received', {
        tabId: typeof tabId === 'number' ? tabId : null,
        tabUrl: sender.tab?.url ?? null,
        kind: isReport ? 'SESSION_EVIDENCE' : 'PRE_SHARE_CHECK',
      });
    }
    if (typeof tabId !== 'number' || !sender.documentId || sender.frameId !== 0 || !isInstagramPage(sender.tab?.url)) {
      sendResponse({ ok: false, reason: 'Instagram evidence must come from the top-level Instagram document.' });
      return;
    }
    void (async () => {
      if (isReport) {
        const result = await sessions.observe(tabId, sender.documentId);
        const resultLogKey = `${sender.documentId}:${result.snapshot?.state ?? 'UNKNOWN'}:${Boolean(result.snapshot?.externalAccountId)}:${result.persisted === true}`;
        if (lastSessionResultLog.get(tabId) !== resultLogKey) {
          lastSessionResultLog.set(tabId, resultLogKey);
          console.info('[PostFlow][Instagram] Session evidence processed', {
            tabId,
            state: result.snapshot?.state ?? 'UNKNOWN',
            accountIdPresent: Boolean(result.snapshot?.externalAccountId),
            platformConnectionBound: result.persisted === true,
          });
        }
        return result;
      }
      const expected = typeof message.expectedAccountId === 'string' ? message.expectedAccountId.trim() : '';
      const expectedUsername = typeof message.expectedUsername === 'string' ? message.expectedUsername.trim() : '';
      if (!message.jobId) return { ok: false, reason: 'Instagram pre-share identity data is incomplete.' };
      if (!(await sessions.verifyTab(tabId, sender.documentId, expected || undefined, expectedUsername || undefined))) {
        return { ok: false, reason: 'The publishing tab has no fresh verified Instagram identity.' };
      }
      const job = await apiFetch(`/api/jobs/${encodeURIComponent(message.jobId)}`, undefined, 'GET', true) as { status?: string; apiFetchError?: boolean } | null;
      if (!job || job.apiFetchError || job.status !== 'RUNNING') {
        return { ok: false, canceled: job?.status === 'CANCEL_REQUESTED' || job?.status === 'CANCELED', reason: 'Instagram job is no longer eligible for Share.' };
      }
      const ok = await sessions.verifyTab(tabId, sender.documentId, expected || undefined, expectedUsername || undefined);
      return { ok, ...(ok ? {} : { reason: 'Instagram identity changed during pre-share checks.' }) };
    })().then(sendResponse).catch((error) => {
      console.error('[PostFlow][Instagram] Session check failed', error);
      sendResponse({ ok: false, reason: 'Could not verify the current Instagram session.' });
    });
    return true;
  });
}
