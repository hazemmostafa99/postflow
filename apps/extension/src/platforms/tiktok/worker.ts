export type TikTokSessionApiFetch = (
  path: string,
  body?: Record<string, unknown>,
  method?: string,
  includeFailureDetails?: boolean,
) => Promise<any>;

let sessionApiFetch: TikTokSessionApiFetch | null = null;

const TIKTOK_CONTENT_SCRIPT_FILES = [
  'platforms/tiktok/identity.js',
  'shared/media/media-runtime.js',
  'platforms/tiktok/selectors.js',
  'platforms/tiktok/composer.js',
  'platforms/tiktok/engagement.js',
  'platforms/tiktok/content.js',
];

type TikTokSessionEvidence = {
  evidenceState?: string;
  sessionDetected?: boolean;
  externalUsername?: string;
  source?: string;
  diagnostics?: Record<string, unknown>;
};

function getTikTokContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest?.();
  const workerPath = manifest?.background && 'service_worker' in manifest.background
    ? manifest.background.service_worker
    : 'dist/background.js';
  const directory = workerPath.includes('/')
    ? workerPath.slice(0, workerPath.lastIndexOf('/') + 1)
    : '';
  return TIKTOK_CONTENT_SCRIPT_FILES.map((file) => `${directory}${file}`);
}

function safeTikTokUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

async function waitForComplete(tabId: number, timeoutMs = 15_000): Promise<boolean> {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (!current) return false;
  if (current.status === 'complete') return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      globalThis.clearTimeout(timeout);
      resolve(value);
    };
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(true);
    };
    const timeout = globalThis.setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function reattachTikTokContentScript(tabId: number): Promise<boolean> {
  const scripting = (chrome as typeof chrome & { scripting?: typeof chrome.scripting }).scripting;
  if (!scripting?.executeScript) return false;
  try {
    await scripting.executeScript({ target: { tabId, frameIds: [0] }, files: getTikTokContentScriptFiles() });
    return true;
  } catch (error) {
    console.warn('[PostFlow][TikTok] Could not reattach content script', { tabId, reason: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Recover the composer control channel after TikTok replaces/reloads the
 * upload document. A short synchronous ping avoids opening a second listener
 * when the original content script is still alive.
 */
export async function ensureTikTokComposer(tabId: number): Promise<{
  ok: boolean;
  busy?: boolean;
  lastExecution?: { jobId: string; result: Record<string, unknown>; completedAt: number } | null;
}> {
  let state = await chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_COMPOSER_PING' }).catch(() => null) as {
    ok?: boolean;
    busy?: boolean;
    lastExecution?: { jobId: string; result: Record<string, unknown>; completedAt: number } | null;
  } | null;
  if (state?.ok) return { ok: true, busy: state.busy === true, lastExecution: state.lastExecution ?? null };
  await waitForComplete(tabId, 5_000);
  state = await chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_COMPOSER_PING' }).catch(() => null) as typeof state;
  if (state?.ok) return { ok: true, busy: state.busy === true, lastExecution: state.lastExecution ?? null };
  if (!(await reattachTikTokContentScript(tabId))) return { ok: false };
  await waitForComplete(tabId, 3_000);
  state = await chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_COMPOSER_PING' }).catch(() => null) as typeof state;
  return state?.ok
    ? { ok: true, busy: state.busy === true, lastExecution: state.lastExecution ?? null }
    : { ok: false };
}

async function inspectTikTokSessionEvidence(tabId: number): Promise<TikTokSessionEvidence | null> {
  let evidence = await chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_GET_SESSION_EVIDENCE' }).catch(() => null) as TikTokSessionEvidence | null;
  // A response means a live content script is already installed. Do not
  // inject the bundle over it: top-level const declarations would collide
  // and produce "Identifier ... has already been declared". Reattach only
  // when the old document has no listener at all.
  if (!evidence) {
    if (await reattachTikTokContentScript(tabId)) {
      await waitForComplete(tabId, 3_000);
      evidence = await chrome.tabs.sendMessage(tabId, { type: 'TIKTOK_GET_SESSION_EVIDENCE' }).catch(() => null) as TikTokSessionEvidence | null;
    }
  }
  return evidence;
}

function isTikTokProfileUrl(value?: string): boolean {
  if (!value) return false;
  try {
    return /^\/@[A-Za-z0-9._]{1,24}\/?$/.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

async function waitForTikTokSessionEvidence(tabId: number, maxWaitMs = 10_000): Promise<TikTokSessionEvidence | null> {
  let evidence = await inspectTikTokSessionEvidence(tabId);
  if (evidence?.evidenceState !== 'CHECKING') return evidence;

  // TikTok reports document complete before the profile/navigation shell has
  // hydrated. Keep the conservative CHECKING state, but give the page a
  // short window to expose its own-profile controls before declaring the
  // account unavailable.
  const startedAt = Date.now();
  console.info('[PostFlow][TikTok] Session evidence still checking; waiting for profile shell', { tabId });
  while (Date.now() - startedAt < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    evidence = await inspectTikTokSessionEvidence(tabId);
    if (evidence?.evidenceState !== 'CHECKING') return evidence;
  }
  console.warn('[PostFlow][TikTok] Profile shell did not expose signed-in identity', {
    tabId,
    waitMs: Date.now() - startedAt,
    maxWaitMs,
  });
  return evidence;
}

async function hasTikTokSessionCookie(): Promise<boolean> {
  const cookiesApi = (chrome as typeof chrome & { cookies?: typeof chrome.cookies }).cookies;
  if (!cookiesApi?.get) return false;
  for (const name of ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt']) {
    const cookie = await cookiesApi.get({ url: 'https://www.tiktok.com/', name }).catch(() => null);
    if (cookie?.value) return true;
  }
  return false;
}

/** Find (or open) a TikTok tab and bind its signed-in account to this extension. */
export async function refreshTikTokSession(): Promise<boolean> {
  if (!sessionApiFetch) {
    console.warn('[PostFlow][TikTok] Session refresh skipped; API bridge is not registered');
    return false;
  }
  console.info('[PostFlow][TikTok] Session refresh started');
  let bindingFailure: { status?: number; message?: string } | null = null;
  const tabsApi = chrome.tabs as typeof chrome.tabs & { create?: typeof chrome.tabs.create };
  let tabs = await chrome.tabs.query({ url: ['*://tiktok.com/*', '*://*.tiktok.com/*'] });
  if (!tabs.length && tabsApi.create) {
    console.info('[PostFlow][TikTok] No TikTok tab found; opening one for session check');
    const created = await tabsApi.create({ url: 'https://www.tiktok.com/', active: false });
    if (created.id !== undefined) {
      await waitForComplete(created.id);
      tabs = [await chrome.tabs.get(created.id).catch(() => created)];
    }
  }

  // A cookie can confirm that the profile is authenticated even when TikTok
  // renders no profile link in the feed shell. It is only a login signal; the
  // account identity still comes from the account-owned /profile page below.
  const cookieSessionPresent = await hasTikTokSessionCookie();
  let profileProbeTabId: number | undefined;
  if (cookieSessionPresent && tabsApi.create) {
    const profileProbe = await tabsApi.create({ url: 'https://www.tiktok.com/profile', active: false });
    if (profileProbe.id !== undefined) {
      profileProbeTabId = profileProbe.id;
      await waitForComplete(profileProbe.id);
      tabs = [...tabs, await chrome.tabs.get(profileProbe.id).catch(() => profileProbe)];
    }
  }
  console.info('[PostFlow][TikTok] Session cookie check', { present: cookieSessionPresent });
  console.info('[PostFlow][TikTok] Session tabs selected', {
    count: tabs.length,
    tabs: tabs.map((tab) => ({
      tabId: tab.id,
      url: safeTikTokUrl(tab.url),
      status: tab.status ?? null,
      profileProbe: tab.id === profileProbeTabId,
    })),
  });

  const orderedTabs = [...tabs].sort((left, right) =>
    Number(isTikTokProfileUrl(right.url)) - Number(isTikTokProfileUrl(left.url)),
  );
  for (const tab of orderedTabs) {
    if (tab.id === undefined || !isTikTokPage(tab.url)) continue;
    const evidence = await waitForTikTokSessionEvidence(
      tab.id,
      isTikTokProfileUrl(tab.url) ? 10_000 : 3_000,
    );
    console.info('[PostFlow][TikTok] Session evidence inspected', {
      tabId: tab.id,
      tabUrl: safeTikTokUrl(tab.url),
      state: evidence?.evidenceState ?? 'UNAVAILABLE',
      source: evidence?.source ?? 'none',
      accountDetected: Boolean(evidence?.externalUsername),
      diagnostics: evidence?.diagnostics ?? null,
    });
    const username = normalizeUsername(evidence?.externalUsername);
    if (!username || evidence?.sessionDetected !== true || evidence.evidenceState !== 'VERIFIED') continue;
    const result = await sessionApiFetch('/api/extensions/platform-session', {
      platform: 'TIKTOK',
      sessionDetected: true,
      externalUsername: username,
    }, 'POST', true);
    if (!result || result.apiFetchError || result.status === 'ACCOUNT_MISMATCH' || result.status === 'LOGIN_REQUIRED') {
      bindingFailure = {
        status: result?.status,
        message: result?.apiFetchError
          ? result.message
          : result
            ? `TikTok connection returned ${result.status ?? 'no status'}`
            : 'No TikTok connection is bound to this extension installation',
      };
      console.warn('[PostFlow][TikTok] Session identity detected but API binding was rejected', {
        tabId: tab.id,
        status: result?.status ?? 0,
        message: bindingFailure.message,
      });
      continue;
    }
    console.info('[PostFlow][TikTok] Session identity bound to installation', {
      tabId: tab.id,
      username,
      connectionStatus: result.status ?? 'CONNECTED',
    });
    await chrome.storage.local.set({
      tiktokSessionDetected: true,
      tiktokDetectedUsername: username,
      tiktokConnectionStatus: result.status ?? 'CONNECTED',
      tiktokSessionLastCheckedAt: Date.now(),
    });
    console.info('[PostFlow][TikTok] Startup session connected', {
      tabId: tab.id,
      source: evidence.source ?? 'content-script',
      checkedAt: new Date().toISOString(),
    });
    if (profileProbeTabId !== undefined && profileProbeTabId !== tab.id) {
      await chrome.tabs.remove(profileProbeTabId).catch(() => undefined);
    }
    return true;
  }
  if (profileProbeTabId !== undefined) await chrome.tabs.remove(profileProbeTabId).catch(() => undefined);
  if (bindingFailure) {
    console.warn('[PostFlow][TikTok] Startup session check found a signed-in account but could not bind it', bindingFailure);
  } else {
    console.info('[PostFlow][TikTok] Startup session check did not find a signed-in account');
  }
  return false;
}

export function isTikTokPage(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com'));
  } catch {
    return false;
  }
}

function normalizeUsername(value: unknown): string | undefined {
  const normalized = typeof value === 'string'
    ? value.trim().replace(/^@/, '')
    : '';
  return /^[A-Za-z0-9._]{1,24}$/.test(normalized)
    ? normalized
    : undefined;
}

export function registerTikTokSessionWorker(
  apiFetch: TikTokSessionApiFetch,
): void {
  sessionApiFetch = apiFetch;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const isReport = message?.type === 'PLATFORM_SESSION_STATUS' &&
      message.platform === 'TIKTOK';
    if (!isReport) return;
    const tabUrl = sender.tab?.url;
    if (sender.frameId !== 0 || !isTikTokPage(tabUrl)) {
      sendResponse({ ok: false, reason: 'TikTok evidence must come from a top-level TikTok page.' });
      return;
    }
    const username = normalizeUsername(message.externalUsername);
    const loginRequired = message.evidenceState === 'LOGIN_REQUIRED' &&
      /^\/(?:login|signup)(?:\/|$)/i.test(new URL(tabUrl!).pathname);
    const verified = message.sessionDetected === true && Boolean(username);
    if (!verified && !loginRequired) {
      sendResponse({ ok: false, reason: 'TikTok session evidence is incomplete.' });
      return;
    }

    void apiFetch('/api/extensions/platform-session', {
      platform: 'TIKTOK',
      sessionDetected: verified,
      ...(username ? { externalUsername: username } : {}),
    }, 'POST', true).then(async (connection) => {
      const failed = Boolean(connection?.apiFetchError);
      console.info('[PostFlow][TikTok] Session report binding response', {
        tabId: sender.tab?.id,
        username: username ?? null,
        status: connection?.status ?? (failed ? connection?.status ?? 0 : 'NO_CONNECTION'),
        failed,
      });
      await chrome.storage.local.set({
        tiktokSessionDetected: verified && !failed,
        tiktokDetectedUsername: username ?? null,
        tiktokConnectionStatus: failed
          ? 'UNAVAILABLE'
          : connection?.status ?? (loginRequired ? 'LOGIN_REQUIRED' : 'PENDING'),
        tiktokSessionLastCheckedAt: Date.now(),
      });
      sendResponse({ ok: !failed });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  });
}
