import { InstagramSessionManager, isInstagramPage, type InstagramSessionApiFetch } from './session-manager.js';

let sessionManager: InstagramSessionManager | null = null;
const lastSessionMessageLog = new Map<number, string>();
const lastSessionResultLog = new Map<number, string>();
const activeInstagramExecutions = new Map<number, string>();

export function bindInstagramExecution(tabId: number, jobId: string): void {
  activeInstagramExecutions.set(tabId, jobId);
}

export function releaseInstagramExecution(tabId: number): void {
  activeInstagramExecutions.delete(tabId);
}

async function insertInstagramCaption(tabId: number, text: string): Promise<void> {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

export async function refreshInstagramSession(expectedAccountId?: string, expectedUsername?: string): Promise<boolean> {
  if (!sessionManager) return false;
  try {
    const connected = await sessionManager.refresh(expectedAccountId, expectedUsername);
    if (connected) await chrome.storage.local.set({ instagramConnectionError: null });
    return connected;
  } catch (error) {
    console.warn('[PostFlow][Instagram] Session refresh could not read an Instagram tab', error);
    await chrome.storage.local.set({
      instagramConnectionStatus: 'UNAVAILABLE',
      instagramConnectionError: error instanceof Error ? error.message.slice(0, 240) : 'Instagram session check failed.',
    });
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
    const isCaptionInput = message?.type === 'INSTAGRAM_INSERT_CAPTION';
    if (!isReport && !isPreShare && !isCaptionInput) return;
    const tabId = sender.tab?.id;
    const kind = isReport ? 'SESSION_EVIDENCE' : isPreShare ? 'PRE_SHARE_CHECK' : 'CAPTION_INPUT';
    const messageLogKey = `${tabId ?? 'unknown'}:${sender.documentId ?? 'unknown'}:${sender.tab?.url ?? ''}:${kind}`;
    if (typeof tabId !== 'number' || lastSessionMessageLog.get(tabId) !== messageLogKey) {
      if (typeof tabId === 'number') lastSessionMessageLog.set(tabId, messageLogKey);
      console.info('[PostFlow][Instagram] Session message received', {
        tabId: typeof tabId === 'number' ? tabId : null,
        tabUrl: sender.tab?.url ?? null,
        kind,
      });
    }
    if (typeof tabId !== 'number' || !sender.documentId || sender.frameId !== 0 || !isInstagramPage(sender.tab?.url)) {
      sendResponse({ ok: false, reason: 'Instagram evidence must come from the top-level Instagram document.' });
      return;
    }
    if (isCaptionInput) {
      if (activeInstagramExecutions.get(tabId) !== message.jobId ||
        typeof message.text !== 'string' || !message.text || message.text.length > 10_000) {
        sendResponse({ ok: false, reason: 'Instagram caption execution is not authorized.' });
        return;
      }
      void insertInstagramCaption(tabId, message.text).then(() => {
        console.info('[PostFlow][Instagram] Browser caption input completed', {
          tabId,
          jobId: message.jobId,
          length: message.text.length,
        });
        sendResponse({ ok: true });
      }).catch((error) => {
        console.warn('[PostFlow][Instagram] Browser caption input failed', {
          tabId,
          jobId: message.jobId,
          reason: error instanceof Error ? error.message : String(error),
        });
        sendResponse({ ok: false, reason: 'Instagram browser caption input failed.' });
      });
      return true;
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
