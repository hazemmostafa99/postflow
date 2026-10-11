import { applyInstagramEvidence, isFreshInstagramSession, type InstagramSessionEvidence, type InstagramSessionSnapshot } from './session-state.js';

export type InstagramSessionApiFetch = (path: string, body?: Record<string, unknown>, method?: string, includeFailureDetails?: boolean) => Promise<unknown>;
export function isInstagramPage(value: string | undefined): boolean {
  try { const host = new URL(value ?? '').hostname; return host === 'instagram.com' || host.endsWith('.instagram.com'); } catch { return false; }
}

const INSTAGRAM_CONTENT_SCRIPT_FILES = [
  'platforms/instagram/identity.js',
  'platforms/instagram/selectors.js',
  'platforms/instagram/caption.js',
  'platforms/instagram/composer.js',
  'platforms/instagram/engagement.js',
  'platforms/instagram/content.js',
];

function getInstagramContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest?.();
  const background = manifest?.background;
  const workerPath = background && 'service_worker' in background
    ? background.service_worker
    : 'dist/background.js';
  const directory = workerPath.includes('/')
    ? workerPath.slice(0, workerPath.lastIndexOf('/') + 1)
    : '';
  return INSTAGRAM_CONTENT_SCRIPT_FILES.map((file) => `${directory}${file}`);
}

async function reattachInstagramContentScript(tabId: number): Promise<boolean> {
  const scripting = (chrome as typeof chrome & {
    scripting?: typeof chrome.scripting;
  }).scripting;
  if (!scripting?.executeScript) return false;
  try {
    await scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: getInstagramContentScriptFiles(),
    });
    console.info('[PostFlow][Instagram] Reattached content script after the existing tab stopped responding', { tabId });
    return true;
  } catch (error) {
    console.warn('[PostFlow][Instagram] Could not reattach content script to the existing tab', {
      tabId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export class InstagramSessionManager {
  private queue: Promise<unknown> = Promise.resolve();
  private refreshQueue: Promise<unknown> = Promise.resolve();
  private generation = new Map<number, number>();
  private documents = new Map<number, string>();
  private lastEvidenceReport = new Map<number, {
    documentId?: string;
    key: string;
    at: number;
    snapshot?: InstagramSessionSnapshot;
    evidence?: InstagramSessionEvidence;
    persisted: boolean;
  }>();
  private static readonly EVIDENCE_REPORT_DEDUPE_MS = 60_000;
  constructor(private apiFetch: InstagramSessionApiFetch) {
    chrome.tabs.onRemoved.addListener((tabId) => this.invalidate(tabId));
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (change.status === 'loading' || change.url) this.invalidate(tabId);
    });
    void chrome.alarms.create('postflow-instagram-session-freshness', { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'postflow-instagram-session-freshness') {
        const work = this.queue.then(() => this.expire());
        this.queue = work.catch((error) => console.warn('[PostFlow][Instagram] Session expiry failed', error));
      }
    });
  }
  private invalidate(tabId: number) {
    this.generation.set(tabId, (this.generation.get(tabId) ?? 0) + 1);
    this.lastEvidenceReport.delete(tabId);
  }

  private async readAccountId(): Promise<string | undefined> {
    try {
      const [accountCookie, sessionCookie] = await Promise.all([
        chrome.cookies.get({ url: 'https://www.instagram.com/', name: 'ds_user_id' }),
        chrome.cookies.get({ url: 'https://www.instagram.com/', name: 'sessionid' }),
      ]);
      const value = accountCookie?.value?.trim();
      return value && sessionCookie?.value && /^\d+$/.test(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /** Persist cookie-backed identity even when the newly opened tab has not
   * injected its content script yet. DOM evidence is still required before
   * Share, but connection discovery must not wait on a fragile React shell. */
  private async persistCookieIdentity(tabId: number | undefined, accountId: string): Promise<boolean> {
    const result = await this.apiFetch('/api/extensions/platform-session', {
      platform: 'INSTAGRAM',
      sessionDetected: true,
      externalAccountId: accountId,
      evidenceState: 'VERIFIED',
      evidenceSource: 'session-cookie',
    }, 'POST', true) as { apiFetchError?: boolean; status?: string; workerStatus?: string } | null;
    if (!result || result.apiFetchError || result.status === 'ACCOUNT_MISMATCH' || result.status === 'LOGIN_REQUIRED') return false;
    const snapshot: InstagramSessionSnapshot = {
      state: 'VERIFIED',
      externalAccountId: accountId,
      verifiedAt: Date.now(),
      source: 'session-cookie',
      ...(typeof tabId === 'number' ? { tabId } : {}),
    };
    await chrome.storage.local.set({
      instagramSessionSnapshot: snapshot,
      instagramSessionDetected: true,
      instagramDetectedAccountId: accountId,
      instagramDetectedUsername: null,
      instagramConnectionStatus: result.status ?? 'CONNECTED',
      instagramConnectionError: null,
      instagramWorkerStatus: result.workerStatus ?? 'IDLE',
    });
    console.info('[PostFlow][Instagram] Cookie session identity persisted', {
      tabId: tabId ?? null,
      accountIdPresent: true,
      status: result.status ?? 'CONNECTED',
    });
    return true;
  }

  /** Refresh the same installation-bound account before a publishing job. */
  async refresh(expectedAccountId?: string, expectedUsername?: string): Promise<boolean> {
    const work = this.refreshQueue.then(() => this.refreshInternal(expectedAccountId, expectedUsername));
    this.refreshQueue = work.catch(() => false);
    return work;
  }

  private async refreshInternal(expectedAccountId?: string, expectedUsername?: string): Promise<boolean> {
    const rawExpected = expectedAccountId?.trim();
    const expected = rawExpected && /^\d+$/.test(rawExpected) ? rawExpected : undefined;
    const legacyExpectedUsername = expectedUsername ?? (rawExpected && !expected ? rawExpected : undefined);
    const tabsApi = chrome.tabs as typeof chrome.tabs & {
      query?: typeof chrome.tabs.query;
      create?: typeof chrome.tabs.create;
    };
    // Keep one top-level Instagram document available for the cookie check.
    // The tab is inactive so startup/session refresh never steals focus.
    let tabs = tabsApi.query
      ? await tabsApi.query({ url: ['*://instagram.com/*', '*://*.instagram.com/*'] })
      : [];
    if (!tabs.length && tabsApi.create) {
      console.info('[PostFlow][Instagram] No Instagram tab found; opening one for cookie session check');
      const created = await tabsApi.create({ url: 'https://www.instagram.com/', active: false });
      if (created.id !== undefined) {
        await this.waitForComplete(created.id, 15_000);
        await this.waitForDocument(created.id, 3_000);
        tabs = [created];
      }
    }
    const cookieAccountId = await this.readAccountId();
    // New connections are cookie-bound. Keep the username path only for
    // legacy records that predate cookie identity, so old jobs remain
    // readable without allowing a username to become the new identity.
    if (!cookieAccountId && !legacyExpectedUsername) {
      console.info('[PostFlow][Instagram] Instagram cookies not available; waiting for login');
      return false;
    }
    if (expected && expected !== cookieAccountId) {
      console.warn('[PostFlow][Instagram] Cookie account does not match the expected account');
      return false;
    }
    const stored = await chrome.storage.local.get('instagramSessionSnapshot');
    const cached = stored.instagramSessionSnapshot as InstagramSessionSnapshot | undefined;
    let inspectedDocument = false;
    let unresponsiveDocument = false;
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      // A tabs.query result does not carry Chrome's documentId. Reuse only a
      // document observed through the top-level content-script handshake (or
      // its persisted snapshot); an unscoped message could let an old rendered
      // tab undo an explicit logout from another tab.
      let documentId = this.documents.get(tab.id)
        ?? (cached?.tabId === tab.id ? cached.documentId : undefined);
      inspectedDocument = true;
      let result: { snapshot?: InstagramSessionSnapshot; evidence?: InstagramSessionEvidence; persisted?: boolean } = {};
      if (!documentId) {
        // First ping without a document id. This avoids injecting a duplicate
        // bundle after a normal service-worker restart when the existing page
        // content script is still alive but its id was not cached.
        result = await this.observe(tab.id, undefined, { force: true });
        const accountId = result.snapshot?.externalAccountId;
        const username = result.snapshot?.username?.toLowerCase();
        if (result.persisted === true && result.snapshot?.state === 'VERIFIED' &&
          ((accountId && (!expected || accountId === expected)) ||
            (!accountId && legacyExpectedUsername && username === legacyExpectedUsername.trim().replace(/^@/, '').toLowerCase()))) {
          return true;
        }
        if (result.evidence) continue;
        if (!cookieAccountId) continue;
        unresponsiveDocument = true;
        if (await reattachInstagramContentScript(tab.id)) {
          await this.waitForDocument(tab.id, 5_000);
          documentId = this.documents.get(tab.id);
        }
        if (!documentId) continue;
      }
      result = await this.observe(tab.id, documentId, { force: true });
      const accountId = result.snapshot?.externalAccountId;
      const username = result.snapshot?.username?.toLowerCase();
      if (result.persisted === true && result.snapshot?.state === 'VERIFIED' &&
        ((accountId && (!expected || accountId === expected)) ||
          (!accountId && legacyExpectedUsername && username === legacyExpectedUsername.trim().replace(/^@/, '').toLowerCase()))) {
        return true;
      }
      // Reloading an unpacked extension invalidates content scripts that are
      // already rendered in open tabs. The cached document id then points to
      // a document with no live listener, so reattach the Instagram bundle
      // before declaring the existing session unavailable.
      if (!result.evidence && cookieAccountId) {
        unresponsiveDocument = true;
        if (await reattachInstagramContentScript(tab.id)) {
          await this.waitForDocument(tab.id, 5_000);
          const freshDocumentId = this.documents.get(tab.id);
          result = await this.observe(tab.id, freshDocumentId, { force: true });
          const freshAccountId = result.snapshot?.externalAccountId;
          const freshUsername = result.snapshot?.username?.toLowerCase();
          if (result.persisted === true && result.snapshot?.state === 'VERIFIED' &&
            ((freshAccountId && (!expected || freshAccountId === expected)) ||
              (!freshAccountId && legacyExpectedUsername && freshUsername === legacyExpectedUsername.trim().replace(/^@/, '').toLowerCase()))) {
            return true;
          }
        }
      }
    }
    // A fresh tab can take longer than the document handshake timeout. Bind
    // the installation from the authenticated cookies now; the next content
    // report will attach the exact document for publish authorization.
    if (!inspectedDocument || (unresponsiveDocument && cookieAccountId)) {
      return cookieAccountId ? this.persistCookieIdentity(tabs[0]?.id, cookieAccountId) : false;
    }
    return false;
  }

  private async waitForDocument(tabId: number, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (this.documents.has(tabId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.documents.has(tabId);
  }

  private waitForComplete(tabId: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const finish = (value: boolean) => {
        chrome.tabs.onUpdated.removeListener(listener as any);
        resolve(value);
      };
      const listener = (updatedTabId: number, change: { status?: string }) => {
        if (updatedTabId === tabId && change.status === 'complete') finish(true);
      };
      chrome.tabs.onUpdated.addListener(listener as any);
      void chrome.tabs.get(tabId).then((tab) => {
        if (tab?.status === 'complete') finish(true);
      }).catch(() => finish(false));
      setTimeout(() => finish(false), Math.max(0, timeoutMs - (Date.now() - startedAt)));
    });
  }

  async expire(): Promise<void> {
    const stored = await chrome.storage.local.get(['instagramSessionSnapshot', 'instagramConnectionStatus']);
    const snapshot = stored.instagramSessionSnapshot as InstagramSessionSnapshot | undefined;
    if (!snapshot || !['VERIFIED', 'STALE'].includes(snapshot.state) || isFreshInstagramSession(snapshot)) return;
    // A successful stale transition is terminal until a fresh document is
    // observed. Avoid sending the same STALE report on every one-minute alarm;
    // a failed report leaves the VERIFIED snapshot intact and will retry.
    if (snapshot.state === 'STALE') return;
    const result = await this.apiFetch('/api/extensions/platform-session', { platform: 'INSTAGRAM', sessionDetected: false, evidenceState: 'STALE' }, 'POST', true) as { apiFetchError?: boolean; status?: string; workerStatus?: string } | null;
    if (!result || result.apiFetchError) throw new Error('Could not persist expired Instagram evidence');
    const explicitLogout = result.status === 'LOGIN_REQUIRED' || result.status === 'ACCOUNT_MISMATCH';
    // Keep the expired VERIFIED timestamp on failure so the next alarm retries;
    // isFreshInstagramSession already denies authorization from that timestamp.
    await chrome.storage.local.set({
      // STALE is not logout: keep maintenance eligible, while publishing
      // still requires a fresh document in verifyActiveAccount.
      instagramSessionDetected: !explicitLogout,
      instagramSessionSnapshot: { ...snapshot, state: explicitLogout ? result.status : 'STALE' },
      // STALE is a cache state, not proof of logout. Keep the backend's
      // connection health until a fresh document reports LOGIN_REQUIRED.
      instagramConnectionStatus: result?.status ?? stored.instagramConnectionStatus ?? 'CONNECTED',
      instagramWorkerStatus: result?.workerStatus ?? stored.instagramWorkerStatus ?? 'ONLINE',
    });
    if (typeof snapshot.tabId === 'number') this.lastEvidenceReport.delete(snapshot.tabId);
  }

  // Serialize API writes so an older response cannot overwrite a newer state.
  observe(tabId: number, documentId?: string, options?: { force?: boolean }): Promise<{ snapshot?: InstagramSessionSnapshot; evidence?: InstagramSessionEvidence; persisted?: boolean }> {
    const generation = this.generation.get(tabId) ?? 0;
    const work = this.queue.then(() => this.inspect(tabId, documentId, generation, options?.force === true));
    this.queue = work.catch(() => undefined);
    return work;
  }

  private async inspect(tabId: number, documentId: string | undefined, generation: number, force = false) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current || !isInstagramPage(current.url) || (this.generation.get(tabId) ?? 0) !== generation) return {};
    // Never trust a pushed boolean. Ask that exact document for fresh evidence.
    let evidence = await chrome.tabs.sendMessage(tabId, { type: 'INSTAGRAM_GET_SESSION_EVIDENCE' }, documentId ? { documentId } : {})
      .catch(() => undefined) as InstagramSessionEvidence | undefined;
    const latest = await chrome.tabs.get(tabId).catch(() => null);
    if (!latest || latest.url !== current.url || (this.generation.get(tabId) ?? 0) !== generation) return {};
    if (!evidence || evidence.url !== latest.url || !['VERIFIED', 'CHECKING', 'LOGIN_REQUIRED'].includes(evidence.evidenceState)) return {};
    const cookieAccountId = await this.readAccountId();
    // The cookie is the account identity. DOM username detection is only a
    // legacy fallback and must never overwrite the stable id.
    if (cookieAccountId && evidence.evidenceState !== 'LOGIN_REQUIRED') {
      evidence = { ...evidence, evidenceState: 'VERIFIED', externalAccountId: cookieAccountId, source: 'session-cookie', externalUsername: undefined };
    }
    if (evidence.evidenceState === 'VERIFIED' &&
      ((!evidence.externalAccountId && !/^[a-z0-9._]+$/i.test(evidence.externalUsername ?? '')) ||
        !['profile-link', 'canonical', 'open-graph', 'pathname', 'session-cookie'].includes(evidence.source))) return {};
    const reportKey = [
      latest.url,
      documentId ?? '',
      evidence.evidenceState,
      evidence.source,
      evidence.externalAccountId ?? '',
      evidence.externalUsername ?? '',
    ].join('|');
    const cachedReport = this.lastEvidenceReport.get(tabId);
    if (!force && cachedReport && cachedReport.documentId === documentId && cachedReport.key === reportKey &&
      Date.now() - cachedReport.at < InstagramSessionManager.EVIDENCE_REPORT_DEDUPE_MS) {
      return {
        snapshot: cachedReport.snapshot,
        evidence: cachedReport.evidence,
        persisted: cachedReport.persisted,
      };
    }
    const stored = await chrome.storage.local.get([
      'instagramSessionSnapshot',
      'instagramRevokedDocuments',
      'instagramConnectionStatus',
    ]);
    const previous = stored.instagramSessionSnapshot as InstagramSessionSnapshot | undefined;
    const revoked = new Set<string>(Array.isArray(stored.instagramRevokedDocuments)
      ? stored.instagramRevokedDocuments.filter((value): value is string => typeof value === 'string') : []);
    if (documentId && revoked.has(documentId)) return { snapshot: previous };
    if (documentId) this.documents.set(tabId, documentId);
    let snapshot = applyInstagramEvidence(previous, evidence, tabId, documentId);
    const reportState = evidence.evidenceState === 'CHECKING' ? (snapshot.state === 'STALE' ? 'STALE' : 'CHECKING') : evidence.evidenceState;
    const result = await this.apiFetch('/api/extensions/platform-session', {
      platform: 'INSTAGRAM', sessionDetected: evidence.evidenceState === 'VERIFIED',
      evidenceState: reportState, evidenceSource: evidence.source,
      ...(evidence.externalAccountId ? { externalAccountId: evidence.externalAccountId } : {}),
      // Legacy installations without ds_user_id remain readable, but new
      // cookie-backed reports intentionally omit the username entirely.
      ...(!evidence.externalAccountId && evidence.externalUsername ? { externalUsername: evidence.externalUsername } : {}),
    }, 'POST', true) as { apiFetchError?: boolean; status?: string | number; message?: string; workerStatus?: string; detectedExternalUsername?: string } | null;
    // A null response is valid while this installation has no platform record
    // yet (for example, CHECKING before the first verified identity). Network
    // and HTTP failures are returned with apiFetchError and remain retryable.
    if (result?.apiFetchError) {
      const status = typeof result.status === 'number'
        ? result.status === 0 ? 'network/timeout (status 0)' : `HTTP ${result.status}`
        : 'unknown API error';
      const message = typeof result.message === 'string' ? `: ${result.message}` : '';
      throw new Error(`Instagram session evidence could not be persisted (${status}${message})`);
    }
    const persisted = Boolean(result);
    if (result?.status === 'ACCOUNT_MISMATCH') snapshot = { ...snapshot, state: 'ACCOUNT_MISMATCH' };
    if (snapshot.state === 'LOGIN_REQUIRED' || snapshot.state === 'ACCOUNT_MISMATCH') {
      // Previously rendered tabs may still show the old account's sidebar.
      // After explicit revocation they must load a new document to recover;
      // re-reading their stale DOM must not undo logout/account mismatch.
      for (const known of this.documents.values()) if (known !== documentId) revoked.add(known);
      if (previous?.documentId && previous.documentId !== documentId) revoked.add(previous.documentId);
    }
    // Navigation during the API call invalidates authorization, even if the
    // historical backend report was accepted. Next observation repairs it.
    if ((this.generation.get(tabId) ?? 0) !== generation) snapshot = { ...snapshot, state: 'STALE' };
    const connectionStatus = result?.status ?? (
      reportState === 'LOGIN_REQUIRED'
        ? 'LOGIN_REQUIRED'
        : stored.instagramConnectionStatus ?? 'PENDING'
    );
    const workerStatus = result?.workerStatus ?? (
      reportState === 'LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : 'OFFLINE'
    );
    await chrome.storage.local.set({
      instagramSessionSnapshot: snapshot,
      instagramRevokedDocuments: Array.from(revoked),
      // STALE means the cached proof needs refresh, not that the user logged
      // out. Keep the connection visible/eligible for maintenance; publishing
      // still gates on isFreshInstagramSession plus active refresh.
      instagramSessionDetected: isFreshInstagramSession(snapshot) || snapshot.state === 'STALE',
      instagramDetectedAccountId: snapshot.externalAccountId ?? null,
      // Remove the old UI/cache value once an id-backed session is verified.
      ...(snapshot.externalAccountId ? { instagramDetectedUsername: null } : { instagramDetectedUsername: snapshot.username ?? null }),
      instagramConnectionStatus: connectionStatus,
      instagramConnectionError: null,
      instagramWorkerStatus: workerStatus,
    });
    this.lastEvidenceReport.set(tabId, {
      documentId,
      key: reportKey,
      at: Date.now(),
      snapshot,
      evidence,
      persisted,
    });
    console.info('[PostFlow][Instagram] Session evidence evaluated', { tabId, state: snapshot.state, source: evidence.source });
    return { snapshot, evidence, persisted };
  }

  async verifyTab(tabId: number, documentId: string | undefined, expectedAccountId?: string, expectedUsername?: string): Promise<boolean> {
    const result = await this.observe(tabId, documentId, { force: true });
    const rawExpected = expectedAccountId?.trim();
    const expected = rawExpected && /^\d+$/.test(rawExpected) ? rawExpected : undefined;
    const username = (expectedUsername ?? (rawExpected && !expected ? rawExpected : undefined))?.trim().replace(/^@/, '').toLowerCase();
    return result.persisted === true && result.evidence?.evidenceState === 'VERIFIED' && result.snapshot?.tabId === tabId
      && result.snapshot?.documentId === documentId && isFreshInstagramSession(result.snapshot)
      && Boolean(
        (result.snapshot?.externalAccountId && (!expected || result.snapshot.externalAccountId === expected)) ||
        (!result.snapshot?.externalAccountId && username && result.snapshot.username === username),
      );
  }
}
