// ── Configuration ──

import './posting-config.js';

import {
  API_BASE_URL,
  AUTOMATIC_ANALYTICS_ENABLED,
  BUILD_ENV,
} from './env.js';
import {
  getSafeFacebookProfileUrl,
  normalizePublishJob,
  type ProfileFeedPublishTarget,
  type PublishJob,
} from './publishing-target.js';
import { registerInstagramSessionWorker } from './platforms/instagram/worker.js';
import {
  checkPendingJobs as checkPlatformJobs,
  handlePlatformQueueResume,
  pausePlatformQueue,
  resumePlatformQueue,
  isPlatformQueuePaused,
} from './job-orchestrator.js';
import {
  ENGAGEMENT_MAINTENANCE_WAKE_INTERVAL_MINUTES,
  PENDING_MAINTENANCE_WAKE_INTERVAL_MINUTES,
  getMaintenanceAlarmFirstRunAt,
  getMaintenanceStartupJitterMs,
} from './maintenance-schedule.js';
import {
  getEngagementTabBehavior,
  normalizeFacebookEngagementPermalink,
  type EngagementSyncMode,
} from './engagement-sync-policy.js';
import {
  createMaintenanceDiagnosticsSnapshot,
  incrementMaintenanceMetric,
  isMaintenanceDiagnosticsSnapshot,
  maskExtensionInstanceId,
  type MaintenanceDiagnosticsSnapshot,
  type MaintenanceMetricName,
  type MaintenanceWorkType,
} from './maintenance-diagnostics.js';
import {
  normalizeRecoveryCandidates,
  type RecoveryCandidate,
} from './extension-recovery.js';

console.info(
  `[PostFlow] ${BUILD_ENV === 'production' ? 'PROD' : 'DEV'} environment | API: ${API_BASE_URL} | Automatic analytics: ${AUTOMATIC_ANALYTICS_ENABLED ? 'ON' : 'OFF'}`,
);

const HEARTBEAT_ALARM = 'postflow-heartbeat';
const HEARTBEAT_INTERVAL_MINUTES = 1;
const REGISTER_RETRY_ALARM = 'postflow-register-retry';
// Chrome clamps alarm delays to its minimum interval, but keeping this below a
// minute makes a missing dashboard handshake recover quickly instead of
// leaving the popup on “Checking…” for a full minute.
const REGISTER_RETRY_DELAY_MINUTES = 0.5;
const PENDING_POST_SYNC_ALARM = 'postflow-pending-post-sync';
const PENDING_POST_SYNC_INTERVAL_MINUTES =
  PENDING_MAINTENANCE_WAKE_INTERVAL_MINUTES;
const MANUAL_MAINTENANCE_ALARM = 'postflow-manual-maintenance';
const MANUAL_MAINTENANCE_INTERVAL_MINUTES = 1;
const ENGAGEMENT_SYNC_ALARM = 'postflow-engagement-sync';
const ENGAGEMENT_SYNC_INTERVAL_MINUTES =
  ENGAGEMENT_MAINTENANCE_WAKE_INTERVAL_MINUTES;
const MAINTENANCE_BATCH_LIMIT = 3;
const MAINTENANCE_EXECUTION_BUDGET_MS = 45_000;
const PENDING_POST_SYNC_ALARM_INITIALIZED_KEY = 'pendingPostSyncAlarmInitialized';
const ENGAGEMENT_SYNC_ALARM_INITIALIZED_KEY = 'engagementSyncAlarmInitialized';
const MAINTENANCE_DIAGNOSTICS_KEY = 'maintenanceDiagnosticsV1';
const EXTENSION_INSTANCE_ID_KEY = 'extensionInstanceId';
const EXTENSION_NAME_KEY = 'extensionName';
const EXTENSION_CREDENTIAL_KEY = 'extensionCredential';
const EXTENSION_CREDENTIAL_ISSUED_AT_KEY = 'credentialIssuedAt';
const EXTENSION_LIFECYCLE_STATUS_KEY = 'extensionLifecycleStatus';
const RECOVERY_CANDIDATES_KEY = 'extensionRecoveryCandidates';
const TAB_ACTION_RETRY_COUNT = 6;
const TAB_ACTION_RETRY_DELAY_MS = 500;
const FACEBOOK_NOTIFICATIONS_URL = 'https://www.facebook.com/notifications/';
const POSTING_TIMING = (globalThis as { PostFlowPostingTiming?: PostFlowPostingTimingConfig }).PostFlowPostingTiming!;

// ── Helpers ──

let extensionInstanceIdPromise: Promise<string> | null = null;

// Writes sanitized phone-sync diagnostics to the service worker DevTools console.
function logPhoneSync(
  level: 'info' | 'warn' | 'error',
  message: string,
  details?: Record<string, string | number>,
) {
  const prefix = `[PostFlow][Phone Collector] ${message}`;
  if (level === 'error') console.error(prefix, details ?? '');
  else if (level === 'warn') console.warn(prefix, details ?? '');
  else console.info(prefix, details ?? '');
}

interface ApiFetchFailure {
  apiFetchError: true;
  status: number;
  message?: string;
}

async function persistRecoveryCandidates(value: unknown): Promise<RecoveryCandidate[]> {
  const candidates = normalizeRecoveryCandidates(value);
  if (candidates.length) {
    await chrome.storage.local.set({ [RECOVERY_CANDIDATES_KEY]: candidates });
  } else {
    await chrome.storage.local.remove(RECOVERY_CANDIDATES_KEY);
  }
  return candidates;
}

// Identifies structured API failures returned only to callers that request details.
function isApiFetchFailure(value: unknown): value is ApiFetchFailure {
  return typeof value === 'object' && value !== null &&
    'apiFetchError' in value && value.apiFetchError === true &&
    'status' in value && typeof value.status === 'number';
}

// Checks that the backend returned every non-negative count needed by the popup.
function isPhoneSyncResult(value: unknown): value is PhoneSyncResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return ['submitted', 'valid', 'duplicates', 'invalid', 'added', 'alreadyExisted']
    .every((key) => Number.isInteger(result[key]) && Number(result[key]) >= 0);
}

// Converts HTTP/network status codes into safe, actionable sync errors for the popup.
function phoneSyncErrorForStatus(status: number): PhoneSyncResponse {
  if (status === 401) {
    return { ok: false, code: 'AUTH_REQUIRED', httpStatus: status, error: 'Your PostFlow session has expired. Sign in and try again.' };
  }
  if (status === 403) {
    return { ok: false, code: 'FORBIDDEN', httpStatus: status, error: 'Your account is not allowed to sync phone numbers.' };
  }
  if (status === 0) {
    return { ok: false, code: 'NETWORK_ERROR', httpStatus: status, error: 'Could not reach PostFlow. Check your connection and try again.' };
  }
  if (status >= 500) {
    return { ok: false, code: 'SERVER_ERROR', httpStatus: status, error: 'PostFlow is temporarily unavailable. Your selection is saved for retry.' };
  }
  return { ok: false, code: 'API_REJECTED', httpStatus: status, error: 'PostFlow rejected the sync request. Your selection is saved for retry.' };
}

function createExtensionInstanceId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `pfi_${randomId}`;
}

function isPostFlowDashboardUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' && url.hostname === 'fitcure.online') ||
      (url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        url.port === '3001')
    );
  } catch {
    return false;
  }
}

export async function getExtensionInstanceId(): Promise<string> {
  if (!extensionInstanceIdPromise) {
    extensionInstanceIdPromise = (async () => {
      const result = await chrome.storage.local.get(EXTENSION_INSTANCE_ID_KEY);
      const existing = result[EXTENSION_INSTANCE_ID_KEY];
      if (typeof existing === 'string' && existing.trim()) return existing;

      const extensionInstanceId = createExtensionInstanceId();
      await chrome.storage.local.set({ [EXTENSION_INSTANCE_ID_KEY]: extensionInstanceId });
      console.log(
        '[PostFlow] Created extension instance ID:',
        maskExtensionInstanceId(extensionInstanceId),
      );
      return extensionInstanceId;
    })();
  }

  return extensionInstanceIdPromise;
}

type MaintenanceDiagnosticDetails = {
  jobId?: string;
  status?: string;
  outcome?: string;
  reasonCode?: string;
  retryAt?: string;
  manualOnly?: boolean;
  itemCount?: number;
};

let maintenanceDiagnosticsSnapshotPromise:
  | Promise<MaintenanceDiagnosticsSnapshot>
  | null = null;
let maintenanceDiagnosticsWriteQueue: Promise<void> = Promise.resolve();

async function getMaintenanceDiagnosticsSnapshot(): Promise<MaintenanceDiagnosticsSnapshot> {
  if (!maintenanceDiagnosticsSnapshotPromise) {
    maintenanceDiagnosticsSnapshotPromise = (async () => {
      const stored = await chrome.storage.local.get(MAINTENANCE_DIAGNOSTICS_KEY);
      const snapshot = stored[MAINTENANCE_DIAGNOSTICS_KEY];
      return isMaintenanceDiagnosticsSnapshot(snapshot)
        ? snapshot
        : createMaintenanceDiagnosticsSnapshot();
    })();
  }
  return maintenanceDiagnosticsSnapshotPromise;
}

/** Persist small operational counters and emit a sanitized structured event. */
function recordMaintenanceDiagnostic(
  event: string,
  workType: MaintenanceWorkType,
  metric?: MaintenanceMetricName,
  details: MaintenanceDiagnosticDetails = {},
): Promise<void> {
  const operation = maintenanceDiagnosticsWriteQueue.then(async () => {
    const [snapshot, extensionInstanceId] = await Promise.all([
      getMaintenanceDiagnosticsSnapshot(),
      getExtensionInstanceId(),
    ]);
    const metricValue = metric
      ? incrementMaintenanceMetric(snapshot, workType, metric)
      : undefined;
    if (metric) {
      await chrome.storage.local.set({
        [MAINTENANCE_DIAGNOSTICS_KEY]: snapshot,
      });
    }
    console.info('[MaintenanceDiagnostic]', {
      event,
      workType,
      extensionInstanceId: maskExtensionInstanceId(extensionInstanceId),
      ...(metric ? { metric, metricValue } : {}),
      ...details,
    });
  });
  maintenanceDiagnosticsWriteQueue = operation.catch((error) => {
    console.warn('[MaintenanceDiagnostic] Could not persist diagnostic event', {
      event,
      workType,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return operation;
}

function getMaintenanceWorkTypeForRequest(
  path: string,
  body?: Record<string, unknown>,
): MaintenanceWorkType | null {
  if (
    path.includes('/pending-sync') ||
    path.startsWith('/api/jobs/pending') ||
    body?.type === 'PENDING_APPROVAL'
  ) {
    return 'PENDING_APPROVAL';
  }
  if (
    path.includes('/engagement') ||
    body?.type === 'ENGAGEMENT'
  ) {
    return 'ENGAGEMENT';
  }
  return null;
}

async function getClerkUserId(): Promise<string | null> {
  const result = await chrome.storage.local.get('clerkUserId');
  return (result.clerkUserId as string) ?? null;
}

async function getExtensionName(): Promise<string> {
  const result = await chrome.storage.local.get(EXTENSION_NAME_KEY);
  return typeof result[EXTENSION_NAME_KEY] === 'string'
    ? result[EXTENSION_NAME_KEY].trim()
    : '';
}

async function getExtensionCredential(): Promise<string | null> {
  const result = await chrome.storage.local.get(EXTENSION_CREDENTIAL_KEY);
  const credential = result[EXTENSION_CREDENTIAL_KEY];
  return typeof credential === 'string' && credential.trim()
    ? credential.trim()
    : null;
}

// Persists the single-use installation credential issued by the backend. The
// credential is a random revocable bearer token; only its SHA-256 hash lives on
// the server, so the extension must keep the raw value to authenticate.
async function persistExtensionCredential(credential?: string): Promise<void> {
  if (typeof credential !== 'string' || !credential.trim()) return;
  await chrome.storage.local.set({
    [EXTENSION_CREDENTIAL_KEY]: credential.trim(),
    [EXTENSION_CREDENTIAL_ISSUED_AT_KEY]: Date.now(),
  });
  console.log('[PostFlow] Installation credential stored');
}

async function getExtensionLifecycleStatus(): Promise<string | null> {
  const result = await chrome.storage.local.get(EXTENSION_LIFECYCLE_STATUS_KEY);
  const status = result[EXTENSION_LIFECYCLE_STATUS_KEY];
  return typeof status === 'string' && status.trim() ? status.trim() : null;
}

async function persistExtensionLifecycleStatus(status?: string): Promise<void> {
  if (typeof status !== 'string' || !status.trim()) return;
  await chrome.storage.local.set({ [EXTENSION_LIFECYCLE_STATUS_KEY]: status.trim() });
  console.log('[PostFlow] Installation lifecycle status stored:', status);
}

async function clearExtensionLifecycleStatus(): Promise<void> {
  await chrome.storage.local.remove(EXTENSION_LIFECYCLE_STATUS_KEY);
  console.log('[PostFlow] Installation lifecycle status cleared');
}

/**
 * The credential is intentionally not recoverable from the API. If local
 * extension storage lost it while the server installation is still active,
 * treat this as a fresh reinstall instead of retrying the same ID forever.
 */
async function resetInstallationIdentityAfterCredentialLoss(): Promise<void> {
  await chrome.storage.local.remove([
    EXTENSION_INSTANCE_ID_KEY,
    EXTENSION_CREDENTIAL_KEY,
    EXTENSION_CREDENTIAL_ISSUED_AT_KEY,
    EXTENSION_LIFECYCLE_STATUS_KEY,
    RECOVERY_CANDIDATES_KEY,
    'extensionConnectionStage',
  ]);
  extensionInstanceIdPromise = null;
  console.warn('[PostFlow] Installation credential is unavailable; starting a fresh installation registration');
}

// Uses shared authentication and URL fallback; detailed failures are opt-in for UI workflows.
export async function apiFetch(
  path: string,
  body?: Record<string, unknown>,
  method?: string,
  includeFailureDetails = false,
  allowCredentialReset = true,
) {
  if (!path || !path.startsWith('/')) {
    console.warn('[PostFlow] Refusing API call with invalid path:', path);
    return includeFailureDetails ? { apiFetchError: true, status: 400 } : null;
  }

  const [clerkUserId, extensionInstanceId, extensionCredential] =
    await Promise.all([
      getClerkUserId(),
      getExtensionInstanceId(),
      getExtensionCredential(),
    ]);
  if (!clerkUserId) {
    console.warn('[PostFlow] No user ID found — skipping API call:', path);
    return includeFailureDetails ? { apiFetchError: true, status: 401 } : null;
  }

  const httpMethod = method || (body ? 'POST' : 'GET');
  const urls = [`${API_BASE_URL}${path}`];
  if (BUILD_ENV === 'development') {
    try {
      const apiUrl = new URL(API_BASE_URL);
      if (apiUrl.hostname === 'localhost') {
        urls.push(`${apiUrl.protocol}//127.0.0.1:${apiUrl.port}${path}`);
      }
    } catch {
      // The build script validates API_BASE_URL; keep the primary URL if it is malformed.
    }
  }

  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: httpMethod,
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          'x-clerk-user-id': clerkUserId,
          'x-extension-instance-id': extensionInstanceId,
          ...(extensionCredential
            ? { 'x-extension-credential': extensionCredential }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle empty responses (like 200 OK with no JSON)
      const text = await response.text();
      if (!response.ok) {
        console.warn('[PostFlow] API error', {
          status: response.status,
          method: httpMethod,
          path,
          url,
          response: text.slice(0, 300),
        });
        let message: string | undefined;
        try {
          const parsed = JSON.parse(text) as { message?: string };
          message = typeof parsed.message === 'string' ? parsed.message : undefined;
        } catch {
          // Keep the compact status-only error for non-JSON responses.
        }
        if (
          response.status === 403 &&
          allowCredentialReset &&
          (path === '/api/extensions/register' || path === '/api/extensions/heartbeat') &&
          message &&
          /x-extension-credential header is required|installation credential is invalid/i.test(message)
        ) {
          await resetInstallationIdentityAfterCredentialLoss();
          return apiFetch(path, body, httpMethod, includeFailureDetails, false);
        }
        if (
          response.status === 403 &&
          message &&
          /revoked|credential has been revoked|installation has been revoked/i.test(message)
        ) {
          await handleRevokedInstallation();
        }
        const maintenanceWorkType = getMaintenanceWorkTypeForRequest(
          path,
          body,
        );
        if (response.status === 401 && maintenanceWorkType && message) {
          if (
            message.includes('another Facebook connection') ||
            message.includes('not linked to a verified Facebook connection')
          ) {
            void recordMaintenanceDiagnostic(
              'ownership.rejected',
              maintenanceWorkType,
              'ownershipRejections',
              { reasonCode: 'OWNERSHIP_REJECTED' },
            );
          } else if (message.toLowerCase().includes('expired')) {
            void recordMaintenanceDiagnostic(
              'lease.expired',
              maintenanceWorkType,
              'leaseExpirations',
              { reasonCode: 'CLAIM_EXPIRED' },
            );
          } else if (
            message.includes('already claimed') ||
            message.includes('Maintenance claim required') ||
            message.includes('Invalid')
          ) {
            void recordMaintenanceDiagnostic(
              'lease.conflict',
              maintenanceWorkType,
              'leaseConflicts',
              { reasonCode: 'CLAIM_CONFLICT' },
            );
          }
        }
        return includeFailureDetails
          ? { apiFetchError: true, status: response.status, message }
          : null;
      }

      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastError = err;
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(
    `[PostFlow] Network error: ${httpMethod} ${urls[0]} (${path}) - ${errorMessage}`,
    lastError,
  );
  return includeFailureDetails ? { apiFetchError: true, status: 0 } : null;
}

registerInstagramSessionWorker(apiFetch);

// Reads persisted review state and submits only selected, valid normalized numbers.
async function syncPhoneNumbersToBackend(): Promise<PhoneSyncResponse> {
  const stored = await chrome.storage.local.get('phoneCollectorState');
  const state = stored.phoneCollectorState as PhoneCollectorState | undefined;
  const selectedNumbers = Array.from(new Set(
    (state?.numbers ?? [])
      .filter((number) =>
        number.status === 'valid' && number.selected &&
        typeof number.normalized === 'string' && /^\+[1-9]\d{1,14}$/.test(number.normalized),
      )
      .map((number) => number.normalized!),
  ));

  if (!selectedNumbers.length) {
    logPhoneSync('warn', 'Sync stopped: no valid numbers are selected.', { code: 'NO_NUMBERS_SELECTED' });
    return {
      ok: false,
      code: 'NO_NUMBERS_SELECTED',
      error: 'Select at least one valid number before syncing.',
    };
  }
  if (!state?.source || !['facebook', 'generic'].includes(state.source.type) || !state.source.url) {
    logPhoneSync('error', 'Sync stopped: collection source is missing.', { code: 'INVALID_RESPONSE' });
    return {
      ok: false,
      code: 'INVALID_RESPONSE',
      error: 'The collection source is missing. Collect the numbers again before syncing.',
    };
  }
  const category = state.syncCategory?.trim().replace(/\s+/g, ' ');
  if (category && category.length > 80) {
    logPhoneSync('warn', 'Sync stopped: category is too long.', { code: 'INVALID_RESPONSE' });
    return {
      ok: false,
      code: 'INVALID_RESPONSE',
      error: 'Category may contain at most 80 characters.',
    };
  }

  logPhoneSync('info', 'Sending selected numbers to PostFlow.', { selected: selectedNumbers.length });
  const response = await apiFetch(
    '/api/phone-contacts/sync',
    { numbers: selectedNumbers, source: state.source, ...(category ? { category } : {}) },
    'POST',
    true,
  );
  if (isApiFetchFailure(response)) {
    const error = phoneSyncErrorForStatus(response.status);
    logPhoneSync('error', 'PostFlow sync request failed.', {
      ...(error.code ? { code: error.code } : {}),
      ...(typeof error.httpStatus === 'number' ? { httpStatus: error.httpStatus } : {}),
    });
    return error;
  }
  if (!isPhoneSyncResult(response)) {
    logPhoneSync('error', 'PostFlow returned an unexpected sync result.', { code: 'INVALID_RESPONSE' });
    return {
      ok: false,
      code: 'INVALID_RESPONSE',
      error: 'PostFlow returned an unexpected sync result. Your selection is saved for retry.',
    };
  }
  logPhoneSync('info', 'Sync response received.', {
    added: response.added,
    alreadyExisted: response.alreadyExisted,
    invalid: response.invalid,
  });
  return { ok: true, result: response };
}

// Locates collector scripts next to the service worker in either extension layout.
function getPhoneCollectorScriptFiles(): string[] {
  const background = chrome.runtime.getManifest().background;
  const serviceWorkerPath = background && "service_worker" in background
    ? background.service_worker
    : "";
  const scriptDirectory = serviceWorkerPath.includes("/")
    ? serviceWorkerPath.slice(0, serviceWorkerPath.lastIndexOf("/") + 1)
    : "";
  return [
    "libphonenumber-max.js",
    "phone-collector/phone-extractor.js",
    "phone-collector/phone-normalizer.js",
    "phone-collector/content.js",
  ].map((path) => `${scriptDirectory}${path}`);
}

// Scans the current HTTP(S) tab by installing the collector into its isolated content context.
async function collectPhoneNumbersFromActiveTab(): Promise<PhoneCollectionResponse> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined || !tab.url) {
      return { ok: false, code: "NO_ACTIVE_TAB", error: "No active page is available." };
    }

    let pageUrl: URL;
    try {
      pageUrl = new URL(tab.url);
    } catch {
      return { ok: false, code: "UNSUPPORTED_PAGE", error: "This page cannot be scanned." };
    }
    if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
      return {
        ok: false,
        code: "UNSUPPORTED_PAGE",
        error: "Browser pages and local files cannot be scanned.",
      };
    }

    let collectorReady = false;
    try {
      const ping = await chrome.tabs.sendMessage(tab.id, { type: "PHONE_COLLECTOR_PING" });
      collectorReady = ping?.collectorReady === true;
    } catch {
      // A missing content script is expected on pages where the collector has not run yet.
    }

    if (!collectorReady) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: getPhoneCollectorScriptFiles(),
        });
      } catch {
        return {
          ok: false,
          code: "CONTENT_SCRIPT_UNAVAILABLE",
          error: "Unable to scan this page. Reload it and try again.",
        };
      }
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "PHONE_COLLECTOR_COLLECT",
      }) as PhoneCollectionResponse | undefined;
      return response?.ok
        ? response
        : {
            ok: false,
            code: "COLLECTION_FAILED",
            error: response?.error ?? "Could not collect numbers from this page.",
          };
    } catch {
      return {
        ok: false,
        code: "CONTENT_SCRIPT_UNAVAILABLE",
        error: "The page collector did not respond. Reload the page and try again.",
      };
    }
  } catch {
    return {
      ok: false,
      code: "COLLECTION_FAILED",
      error: "Could not access the active page.",
    };
  }
}

export async function updateJobStatus(
  jobId: string,
  body: {
    status: string;
    error?: string;
    submissionResult?: {
      status: 'PUBLISHED' | 'PENDING_APPROVAL' | 'UNKNOWN';
      postUrl?: string;
      reason?: string;
    };
  },
) {
  if (body.status === 'RUNNING') {
    await chrome.storage.local.set({ extensionWorkerStatus: 'PUBLISHING' });
  } else if (body.status === 'SUCCESS' || body.status === 'FAILED' || body.status === 'CANCELED') {
    await chrome.storage.local.set({ extensionWorkerStatus: 'IDLE' });
  }
  return apiFetch(`/api/jobs/${jobId}/status`, body);
}

// ── Registration ──

let registrationPromise: Promise<boolean> | null = null;

function registerExtension(): Promise<boolean> {
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    const clerkUserId = await getClerkUserId();
    if (!clerkUserId) {
      await chrome.storage.local.set({ extensionConnectionStage: 'waiting-for-dashboard' });
      chrome.alarms.create(REGISTER_RETRY_ALARM, {
        delayInMinutes: REGISTER_RETRY_DELAY_MINUTES,
      });
      return false;
    }

    await chrome.storage.local.set({ extensionConnectionStage: 'connecting' });
    const result = await apiFetch(
      '/api/extensions/register',
      undefined,
      'POST',
    );
    if (result) {
      await chrome.alarms.clear(REGISTER_RETRY_ALARM);
      const registrationStatus = typeof result.status === 'string'
        ? result.status
        : 'ACTIVE';
      // A revoked or disconnecting installation must never be reactivated by
      // register; stop the connection handshake and surface the outcome.
      if (registrationStatus === 'REVOKED' || registrationStatus === 'REVOKE_PENDING') {
        console.warn(
          `[PostFlow] Registration halted (${registrationStatus})`,
          typeof result.reason === 'string' ? result.reason : '',
        );
        await chrome.storage.local.set({
          extensionConnectionStage: registrationStatus === 'REVOKED'
            ? 'revoked'
            : 'revoke-pending',
        });
        await persistExtensionLifecycleStatus(registrationStatus);
        if (registrationStatus === 'REVOKED') {
          await handleRevokedInstallation();
        }
        return false;
      }
      // The backend issues a fresh credential on first registration and when a
      // legacy installation is upgraded; persist it for future requests.
      if (typeof result.credentialIssued === 'string' && result.credentialIssued) {
        await persistExtensionCredential(result.credentialIssued);
      }
      const recoveryCandidates = await persistRecoveryCandidates(
        result.candidates,
      );
      await persistExtensionLifecycleStatus(
        registrationStatus === 'RECOVERY_AVAILABLE' ||
          registrationStatus === 'NEW_INSTALLATION'
          ? 'ACTIVE'
          : registrationStatus,
      );
      if (registrationStatus === 'RECOVERY_AVAILABLE' || recoveryCandidates.length) {
        await chrome.storage.local.set({ extensionConnectionStage: 'recovery-required' });
        console.log('[PostFlow] Recovery choice required before binding this installation');
        return true;
      }
      await chrome.storage.local.set({ extensionConnectionStage: 'verifying-facebook' });
      console.log('[PostFlow] Registered with backend:', registrationStatus);
      const facebookReady = await refreshFacebookSession();
      await chrome.storage.local.set({
        extensionConnectionStage: facebookReady ? 'connected' : 'facebook-required',
      });
      return true;
    }

    await chrome.storage.local.set({ extensionConnectionStage: 'backend-unavailable' });
    chrome.alarms.create(REGISTER_RETRY_ALARM, {
      delayInMinutes: REGISTER_RETRY_DELAY_MINUTES,
    });
    return false;
  })().finally(() => {
    registrationPromise = null;
  });

  return registrationPromise;
}

// ── Heartbeat ──

async function sendHeartbeat() {
  const result = await apiFetch(
    '/api/extensions/heartbeat',
    undefined,
    'POST',
  );
  if (result && typeof result.status === 'string') {
    console.log(
      `[PostFlow] Heartbeat sent at ${new Date().toISOString()} | lifecycle: ${result.status}`,
    );
    if (result.status === 'REVOKE_PENDING') {
      console.warn('[PostFlow] Extension is disconnecting; finishing in-flight work');
    }
    await persistExtensionLifecycleStatus(result.status);
    // If the backend says REVOKED, we must stop all worker activity immediately.
    if (result.status === 'REVOKED') {
      await handleRevokedInstallation();
    }
  }
}

async function handleRevokedInstallation(): Promise<void> {
  console.warn('[PostFlow] Installation revoked — stopping all worker activity');
  // Clear the credential so no further authenticated requests can be made.
  await chrome.storage.local.remove(EXTENSION_CREDENTIAL_KEY);
  await chrome.storage.local.remove(EXTENSION_CREDENTIAL_ISSUED_AT_KEY);
  // Clear all maintenance alarms so no new work is attempted.
  await chrome.alarms.clear(PENDING_POST_SYNC_ALARM);
  await chrome.alarms.clear(ENGAGEMENT_SYNC_ALARM);
  await chrome.alarms.clear(MANUAL_MAINTENANCE_ALARM);
  // Clear the heartbeat alarm so no more heartbeats are sent.
  await chrome.alarms.clear(HEARTBEAT_ALARM);
  // Clear the register retry alarm.
  await chrome.alarms.clear(REGISTER_RETRY_ALARM);
  // Update local state.
  await chrome.storage.local.set({
    extensionConnectionStage: 'revoked',
    [EXTENSION_LIFECYCLE_STATUS_KEY]: 'REVOKED',
    extensionWorkerStatus: 'OFFLINE',
  });
  // Notify any open popups.
  chrome.runtime.sendMessage({ type: 'LIFECYCLE_REVOKED' }).catch(() => undefined);
}

// Returns true if the local lifecycle status allows claiming new work.
export async function canClaimNewWork(): Promise<boolean> {
  const lifecycle = await getExtensionLifecycleStatus();
  if (!lifecycle) return true; // No status yet (first register), allow.
  if (lifecycle === 'PAUSED' || lifecycle === 'REVOKE_PENDING' || lifecycle === 'REVOKED') {
    console.log('[PostFlow] Skipping new work claim — lifecycle:', lifecycle);
    return false;
  }
  return true;
}

// ── Session reporting ──

type FacebookConnectionSessionResponse = {
  connection?: {
    displayName?: string | null;
    status?: string;
    workerStatus?: string;
    facebookUserId?: string;
    detectedFacebookUserId?: string;
  };
  recoveryCandidates?: RecoveryCandidate[];
};

let facebookIdentityVerified = false;
let facebookConnectionStatus = 'UNKNOWN';
let facebookIdentityCheckPromise: Promise<boolean> | null = null;

async function reportSession(sessionDetected: boolean, facebookUserId?: string | null) {
  const normalizedFacebookUserId = typeof facebookUserId === 'string' && facebookUserId.trim()
    ? facebookUserId.trim()
    : undefined;
  const verificationPromise = (async () => {
    const result = await apiFetch('/api/extensions/session', {
      sessionDetected,
      ...(normalizedFacebookUserId ? { facebookUserId: normalizedFacebookUserId } : {}),
    }) as FacebookConnectionSessionResponse | null;
    const connection = result?.connection;
    if (connection) {
      const connectionDisplayName = typeof connection.displayName === 'string'
        ? connection.displayName.trim()
        : '';
      if (connectionDisplayName) {
        await chrome.storage.local.set({ [EXTENSION_NAME_KEY]: connectionDisplayName });
      } else {
        await chrome.storage.local.remove(EXTENSION_NAME_KEY);
      }
    }
    const recoveryCandidates = await persistRecoveryCandidates(
      result?.recoveryCandidates,
    );
    if (recoveryCandidates.length > 0 && !connection) {
      await chrome.storage.local.set({
        extensionConnectionStage: 'recovery-required',
      });
    } else if (connection) {
      await chrome.storage.local.set({ extensionConnectionStage: 'connected' });
    }
    facebookConnectionStatus = connection?.status ?? 'UNKNOWN';
    facebookIdentityVerified = Boolean(
      sessionDetected &&
      connection?.status === 'CONNECTED' &&
      connection.facebookUserId &&
      connection.detectedFacebookUserId &&
      connection.facebookUserId === connection.detectedFacebookUserId,
    );
    await chrome.storage.local.set({
      facebookIdentityVerified,
      facebookConnectionStatus,
      extensionWorkerStatus: connection?.workerStatus ?? (facebookIdentityVerified ? 'IDLE' : 'UNKNOWN'),
      expectedFacebookUserId: connection?.facebookUserId ?? null,
      detectedFacebookUserId: connection?.detectedFacebookUserId ?? normalizedFacebookUserId ?? null,
    });

    if (facebookIdentityVerified) {
      console.log('[PostFlow] Facebook identity verified:', connection?.facebookUserId);
      void checkPendingJobs();
      void syncManualMaintenanceRequests();
    } else {
      console.warn('[PostFlow] Facebook identity verification failed', {
        sessionDetected,
        facebookUserId: normalizedFacebookUserId,
        status: facebookConnectionStatus,
        expectedFacebookUserId: connection?.facebookUserId,
      });
    }
    return facebookIdentityVerified;
  })();
  facebookIdentityCheckPromise = verificationPromise;
  return verificationPromise;
}

export async function refreshFacebookSession() {
  try {
    const cookie = await chrome.cookies.get({
      url: 'https://www.facebook.com/',
      name: 'c_user',
    });
    const rawValue = cookie?.value?.trim() ?? '';
    let facebookUserId: string | null = null;
    try {
      const decodedValue = decodeURIComponent(rawValue);
      facebookUserId = /^\d+$/.test(decodedValue) ? decodedValue : null;
    } catch {
      facebookUserId = /^\d+$/.test(rawValue) ? rawValue : null;
    }
    return reportSession(Boolean(facebookUserId), facebookUserId);
  } catch (error) {
    console.warn('[PostFlow] Could not read Facebook session cookie', error);
    return false;
  }
}

async function completeExtensionRecovery(options: {
  connectionId?: string;
  createNewConnection?: boolean;
  confirmReplacement?: boolean;
  approvalToken?: string;
}): Promise<{ ok: boolean; error?: string; confirmationRequired?: boolean }> {
  const result = await apiFetch(
    '/api/extensions/reconnect',
    options,
    'POST',
    true,
  );
  if (isApiFetchFailure(result)) {
    const confirmationRequired = Boolean(
      result.status === 409 &&
      result.message?.includes('REPLACEMENT_CONFIRMATION_REQUIRED'),
    );
    return {
      ok: false,
      confirmationRequired,
      error: confirmationRequired
        ? 'The previous extension is still online. Confirm that you want this installation to replace it.'
        : result.message ?? 'Could not reconnect this installation.',
    };
  }

  // Reconnect keeps the selected connection record and its display name. Make
  // the local popup identity follow that recovered connection instead of
  // continuing to show the temporary name from this fresh installation.
  const recoveredDisplayName = typeof result?.displayName === 'string'
    ? result.displayName.trim()
    : '';
  if (recoveredDisplayName) {
    await chrome.storage.local.set({ [EXTENSION_NAME_KEY]: recoveredDisplayName });
  } else {
    await chrome.storage.local.remove(EXTENSION_NAME_KEY);
  }
  await persistRecoveryCandidates([]);
  await persistExtensionLifecycleStatus('ACTIVE');
  await chrome.storage.local.set({ extensionConnectionStage: 'connected' });
  await refreshFacebookSession();
  return { ok: true };
}

chrome.cookies.onChanged.addListener((changeInfo) => {
  const domain = changeInfo.cookie.domain.replace(/^\./, '').toLowerCase();
  const isFacebookDomain = domain === 'facebook.com' || domain.endsWith('.facebook.com');
  if (changeInfo.cookie.name !== 'c_user' || !isFacebookDomain) return;
  void refreshFacebookSession();
});

type ExtensionWorkerStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'IDLE'
  | 'PUBLISHING'
  | 'BLOCKED'
  | 'LOGIN_REQUIRED'
  | 'ACCOUNT_MISMATCH'
  | 'CHECKPOINT_OR_VERIFICATION'
  | 'CAPTCHA_OR_CHALLENGE'
  | 'MANUAL_INTERVENTION_REQUIRED';

export async function reportWorkerStatus(workerStatus: ExtensionWorkerStatus, reason?: string) {
  await chrome.storage.local.set({
    extensionWorkerStatus: workerStatus,
    extensionWorkerReason: reason ? reason.slice(0, 500) : null,
  });
  const result = await apiFetch('/api/extensions/status', {
    workerStatus,
    ...(reason ? { reason: reason.slice(0, 500) } : {}),
  });
  if (result) {
    console.log('[PostFlow] Worker status reported:', workerStatus);
  }
}

function workerStatusForPublishFailure(status: unknown): ExtensionWorkerStatus {
  switch (status) {
    case 'TEMPORARY_BLOCK':
      return 'BLOCKED';
    case 'CAPTCHA_OR_CHALLENGE':
      return 'CAPTCHA_OR_CHALLENGE';
    case 'CHECKPOINT_OR_VERIFICATION':
      return 'CHECKPOINT_OR_VERIFICATION';
    case 'LOGIN_REQUIRED':
      return 'LOGIN_REQUIRED';
    case 'ACCOUNT_MISMATCH':
      return 'ACCOUNT_MISMATCH';
    default:
      return 'MANUAL_INTERVENTION_REQUIRED';
  }
}

async function waitForVerifiedFacebookIdentity(timeoutMs = 5000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (facebookIdentityVerified) return true;
    if (facebookIdentityCheckPromise) return facebookIdentityCheckPromise;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// ── Group storage (existing logic) ──

let pendingGroupSync: Promise<unknown> = Promise.resolve();

async function syncGroupsToBackend(groups: FacebookGroup[]) {
  if (!(await waitForVerifiedFacebookIdentity())) {
    console.warn('[PostFlow] Refusing group sync until Facebook identity is verified', {
      status: facebookConnectionStatus,
    });
    await chrome.storage.local.set({ groupsSyncStatus: 'identity-required' });
    return null;
  }
  const result = await apiFetch('/api/groups/sync', {
    groups: groups.map((g) => ({
      externalId: g.id,
      name: g.name,
      url: g.url,
      numericId: g.numericId,
    })),
  });
  if (result) {
    await chrome.storage.local.set({
      groupsSyncStatus: 'synced',
      groupsSyncCount: groups.length,
      groupsLastSyncedAt: Date.now(),
    });
    console.log('[PostFlow] Groups synced to backend:', result);
  } else {
    await chrome.storage.local.set({ groupsSyncStatus: 'error' });
  }
  return result;
}

function normalizeStoredGroupName(text: string): string {
  return text
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoisyStoredGroupName(text: string): boolean {
  const normalized = normalizeStoredGroupName(text).toLowerCase();
  return [
    'غير مقروءة',
    'مطلوب الموافقة',
    'approval required',
    'requires approval',
    'unread',
    'new post',
    'learn more about this group',
    'about this group',
  ].some((needle) => normalized.includes(needle.toLowerCase()));
}

function shouldReplaceStoredGroupName(prev: FacebookGroup | undefined, next: FacebookGroup): boolean {
  if (!prev) return true;

  const nextName = normalizeStoredGroupName(next.name);
  const prevName = normalizeStoredGroupName(prev.name);
  if (!nextName || nextName.length < 2) return false;

  return (
    isNoisyStoredGroupName(prevName) ||
    prevName === prev.id ||
    prevName === prev.numericId ||
    (
      next.nameSource === 'graphql' &&
      prevName.length > nextName.length + 20
    )
  );
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'postflow-content') return;

  port.onMessage.addListener(async (message) => {
    if (message.type !== 'GROUPS_DETECTED') return;

    if (!(await waitForVerifiedFacebookIdentity())) {
      console.warn('[PostFlow] Ignoring groups detected before Facebook identity verification');
      return;
    }

    const incoming = message.groups as FacebookGroup[];

    const result = await chrome.storage.local.get('facebookGroups');
    const existing = (result.facebookGroups ?? []) as FacebookGroup[];

    const merged = new Map<string, FacebookGroup>();
    for (const g of existing) merged.set(g.id, g);
    for (const g of incoming) {
      const prev = merged.get(g.id);
      const replaceName = shouldReplaceStoredGroupName(prev, g);
      merged.set(g.id, {
        ...prev,
        ...g,
        name: replaceName ? normalizeStoredGroupName(g.name) : prev?.name ?? normalizeStoredGroupName(g.name),
        nameSource: replaceName ? g.nameSource : prev?.nameSource ?? g.nameSource,
        numericId: g.numericId ?? prev?.numericId,
        url: `https://www.facebook.com/groups/${g.id}/`,
      });
    }

    const mergedList = Array.from(merged.values());
    await chrome.storage.local.set({ facebookGroups: mergedList });
    console.log(`[PostFlow] Storage: ${mergedList.length} groups total`);

    // Sync to backend
    pendingGroupSync = syncGroupsToBackend(mergedList).catch((err) => {
      console.error('[PostFlow] Group backend sync failed:', err);
    });
  });

  port.onDisconnect.addListener(() => {
    console.log('[PostFlow] Content script disconnected');
  });
});

// ── Session + sync messages ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COMPLETE_EXTENSION_RECOVERY') {
    void completeExtensionRecovery({
      ...(typeof message.connectionId === 'string'
        ? { connectionId: message.connectionId }
        : {}),
      createNewConnection: message.createNewConnection === true,
      confirmReplacement: message.confirmReplacement === true,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not reconnect this installation.',
      }));
    return true;
  }

  if (message.type === 'RECONNECT_WITH_APPROVAL') {
    // Approval codes originate from the authenticated dashboard content
    // script, never from a Facebook page.
    if (!sender.tab?.url || !isPostFlowDashboardUrl(sender.tab.url)) {
      sendResponse({ ok: false, error: 'Reconnect approval must come from the PostFlow dashboard.' });
      return;
    }
    void completeExtensionRecovery({
      ...(typeof message.connectionId === 'string'
        ? { connectionId: message.connectionId }
        : {}),
      ...(typeof message.approvalToken === 'string'
        ? { approvalToken: message.approvalToken }
        : {}),
      confirmReplacement: message.confirmReplacement === true,
    })
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not restore this connection.',
      }));
    return true;
  }

  if (message.type === 'AUTH_CONTEXT_READY') {
    void (async () => {
      let registered = await registerExtension();
      // An install-time attempt may have been finishing just as the dashboard
      // supplied the user ID. Retry immediately instead of waiting one minute.
      if (!registered && await getClerkUserId()) {
        registered = await registerExtension();
      }
      return registered;
    })()
      .then((registered) => sendResponse({ ok: registered }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not connect extension',
      }));
    return true;
  }

  if (message.type === 'REFRESH_AUTH_CONTEXT') {
    void requestDashboardAuthContext()
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not request dashboard identity',
      }));
    return true;
  }

  if (message.type === 'SYNC_PHONE_NUMBERS') {
    if (sender.tab) {
      sendResponse({
        ok: false,
        code: 'FORBIDDEN',
        error: 'Phone sync can only be started from the extension popup.',
      } satisfies PhoneSyncResponse);
      return;
    }
    void (async () => {
      try {
        logPhoneSync('info', 'Sync request received by the extension worker.');
        const response = await syncPhoneNumbersToBackend();
        sendResponse(response);
      } catch {
        logPhoneSync('error', 'Extension worker could not complete the sync.', { code: 'NETWORK_ERROR' });
        sendResponse({
          ok: false,
          code: 'NETWORK_ERROR',
          error: 'Could not sync with PostFlow. Your selection is saved for retry.',
        } satisfies PhoneSyncResponse);
      }
    })();
    return true;
  }

  if (message.type === 'COLLECT_PHONE_NUMBERS') {
    void collectPhoneNumbersFromActiveTab()
      .then(sendResponse)
      .catch(() => sendResponse({
        ok: false,
        code: 'COLLECTION_FAILED',
        error: 'Could not collect numbers from the active page.',
      }));
    return true;
  }

  if (message.type === 'POSTING_LOG' && message.entry) {
    console.log('[PostFlow][posting-log]', message.entry);
    void (async () => {
      const result = await chrome.storage.local.get('postingLogs');
      const logs = Array.isArray(result.postingLogs) ? result.postingLogs : [];
      logs.push({ ...message.entry, tabId: sender.tab?.id ?? null });
      // Keep the latest entries only so a long-running extension cannot grow storage forever.
      await chrome.storage.local.set({ postingLogs: logs.slice(-500) });
    })().catch((err) => console.warn('[PostFlow] Could not save posting log:', err));
    return;
  }

  if (message.type === 'VERIFY_EXECUTION_IDENTITY' && typeof message.jobId === 'string') {
    void (async () => {
      if (!isCurrentExecutionResult(message, sender)) {
        sendResponse({ verified: false });
        return;
      }
      const target = activeExecution?.target;
      const verified = target?.type === 'PROFILE_FEED'
        ? await verifyProfileTargetIdentity(target)
        : await refreshFacebookSession();
      console.log('[PostFlow] Final submission identity check', {
        jobId: message.jobId,
        targetType: target?.type,
        verified,
      });
      sendResponse({ verified });
    })().catch(() => sendResponse({ verified: false }));
    return true;
  }

  if (message.type === 'PROFILE_VIDEO_PUBLISH_ACCEPTED' && typeof message.jobId === 'string') {
    void (async () => {
      if (
        !isCurrentExecutionResult(message, sender) ||
        activeExecution?.target.type !== 'PROFILE_FEED' ||
        !publishJobHasVideo(activeExecution.post)
      ) {
        sendResponse({ ok: false });
        return;
      }
      const updatedJob = await updateJobStatus(message.jobId, {
        status: 'SUCCESS',
        submissionResult: { status: 'PUBLISHED' },
      });
      if (updatedJob) {
        await saveBackgroundPostingStep(message.jobId, 'profile_video_publish_accepted_saved')
          .catch(() => undefined);
      }
      sendResponse({ ok: Boolean(updatedJob) });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'PROFILE_VIDEO_TRACKING_HEARTBEAT' && typeof message.jobId === 'string') {
    sendResponse({ ok: isCurrentExecutionResult(message, sender) });
    return;
  }

  if (message.type === 'FACEBOOK_SESSION_STATUS') {
    void reportSession(
      message.sessionDetected as boolean,
      typeof message.facebookUserId === 'string' ? message.facebookUserId : null,
    );
  }

  if (message.type === 'TRIGGER_GROUP_SYNC') {
    (async () => {
      try {
        if (!(await waitForVerifiedFacebookIdentity())) {
          await chrome.storage.local.set({ groupsSyncStatus: 'identity-required' });
          sendResponse({ ok: false, error: 'Facebook identity verification required' });
          return;
        }
        await chrome.storage.local.set({ groupsSyncStatus: 'syncing' });
        // 1. Immediately flush whatever is already cached in storage to the backend.
        //    This handles the race condition where groups were discovered before the
        //    user logged in (so the earlier sync was silently skipped due to missing userId).
        const result = await chrome.storage.local.get('facebookGroups');
        const cached = (result.facebookGroups ?? []) as FacebookGroup[];
        if (cached.length > 0) {
          console.log(`[PostFlow] Flushing ${cached.length} cached groups to backend`);
          await syncGroupsToBackend(cached);
        }

        // 2. Also tell open Facebook tabs to do a fresh DOM scan for new groups.
        const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
        if (!tabs.length) {
          console.warn('[PostFlow] Sync requested but no Facebook tabs are open');
          await chrome.storage.local.set({ groupsSyncStatus: 'not-synced' });
          sendResponse({ ok: true, scanned: false });
          return;
        }
        
        const scanPromises = tabs.map(tab => {
          if (tab.id !== undefined) {
            return chrome.tabs.sendMessage(tab.id, { type: 'SCAN_NOW' }).catch(() => null);
          }
          return Promise.resolve(null);
        });
        
        await Promise.all(scanPromises);
        // GROUPS_DETECTED is handled asynchronously through the runtime port.
        // Wait for its backend upload before telling the web app that sync ended.
        await pendingGroupSync;
        console.log(`[PostFlow] Finished scan on ${tabs.length} Facebook tab(s)`);
        sendResponse({ ok: true, scanned: true });
      } catch (err) {
        console.error('[PostFlow] Error during group sync:', err);
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true; // Keep message channel open for sendResponse
  }
  if (message.type === 'SAVE_EXTENSION_NAME') {
    void (async () => {
      const extensionName = typeof message.extensionName === 'string'
        ? message.extensionName.trim()
        : '';
      const response = await apiFetch(
        '/api/extensions/name',
        { extensionName },
        'PATCH',
        true,
      );
      if (isApiFetchFailure(response)) {
        sendResponse({
          ok: false,
          error: response.status === 409
            ? 'This name is already used by another extension.'
            : response.message ?? 'Could not save extension name',
        });
        return;
      }
      const savedName = typeof response?.displayName === 'string'
        ? response.displayName
        : '';
      await chrome.storage.local.set({ [EXTENSION_NAME_KEY]: savedName });
      sendResponse({ ok: true, extensionName: savedName });
    })().catch((error) => {
      console.error('[PostFlow] Could not save extension name:', error);
      sendResponse({ ok: false, error: 'Could not save extension name' });
    });
    return true;
  }
  if (message.type === 'TRIGGER_JOB_CHECK') {
    // A post can be created immediately after recovery while the worker's
    // in-memory Facebook identity flag is still warming up. Refresh first so
    // the one-shot dashboard signal is not lost behind the identity gate.
    void (async () => {
      if (!facebookIdentityVerified) {
        await refreshFacebookSession();
      }
      await checkPendingJobs();
    })();
  }
  if (message.type === 'GET_JOB_STATUS' && typeof message.jobId === 'string') {
    void apiFetch(`/api/jobs/${message.jobId}`)
      .then((job) => sendResponse({ ok: Boolean(job), job }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? 'Could not fetch job status' }));
    return true;
  }
  if (message.type === 'RESUME_PUBLISH_QUEUE') {
    // Support platform-specific resume
    const platform = typeof message.platform === 'string' ? message.platform.toUpperCase() : null;
    if (platform) {
      resumePlatformQueue(platform);
      void reportWorkerStatus('IDLE');
    } else {
      // Legacy: resume all platforms
      publishQueuePaused = null;
      void chrome.storage.local.remove('publishQueuePaused');
      void reportWorkerStatus('IDLE');
    }
    checkPendingJobs();
  }
});

// ── Job Execution Flow ──

let isProcessingJob = false;
let isCheckingPendingPost = false;
let isFacebookSyncBusy = false;
let publishQueuePaused: {
  reason: string;
  status?: string;
  jobId?: string;
  pausedAt: number;
} | null = null;
let pendingCheckSequence = 0;
let finishExecutionHandshake: (() => void) | null = () => {};
let activeExecution: {
  jobId: string;
  tabId: number;
  target: PublishJob['target'];
  post: PublishJob['post'];
  profileVideoNotificationBaselineKeys?: string[] | null;
} | null = null;

/**
 * Bridges the adapter-based worker to Facebook's existing result/identity
 * handlers. The Facebook content script still owns all DOM automation, but
 * these handlers need the active execution context to reject stale messages
 * and to reconcile accepted profile videos.
 */
export async function prepareFacebookExecution(
  job: PublishJob,
  tabId: number,
): Promise<string[] | null> {
  const baseline =
    job.target.type === 'PROFILE_FEED' && publishJobHasVideo(job.post)
      ? await snapshotProcessedProfileVideoNotificationKeys(job.id)
      : null;
  activeExecution = {
    jobId: job.id,
    tabId,
    target: job.target,
    post: job.post,
    profileVideoNotificationBaselineKeys: baseline,
  };
  return baseline;
}

export function clearFacebookExecution(jobId: string): void {
  if (activeExecution?.jobId === jobId) activeExecution = null;
}

interface ProcessedProfileVideoNotificationScanResult {
  key: string;
  notificationId?: string;
  postUrl: string;
}

function publishJobHasVideo(post: PublishJob['post'] | undefined): boolean {
  const mediaUrls = Array.isArray(post?.mediaUrls) ? post.mediaUrls : [];
  return mediaUrls.some((url: unknown) => typeof url === 'string' && url.startsWith('data:video/'));
}

void chrome.storage.local.get('publishQueuePaused').then((result) => {
  const paused = result.publishQueuePaused as Partial<NonNullable<typeof publishQueuePaused>> | undefined;
  if (paused && typeof paused.reason === 'string' && typeof paused.pausedAt === 'number') {
    publishQueuePaused = {
      reason: paused.reason,
      status: typeof paused.status === 'string' ? paused.status : undefined,
      jobId: typeof paused.jobId === 'string' ? paused.jobId : undefined,
      pausedAt: paused.pausedAt,
    };
    console.warn('[PostFlow] Restored paused publishing queue state', publishQueuePaused);
  }
}).catch(() => undefined);

// Platform-aware job checking using the new orchestrator.
// Legacy Facebook-only checkPendingJobs is kept for maintenance tasks.
async function checkPendingJobs() {
  // Use the new platform-aware orchestrator for publishing jobs
  await checkPlatformJobs();
}

export async function verifyProfileTargetIdentity(target: ProfileFeedPublishTarget): Promise<boolean> {
  if (!/^\d+$/.test(target.facebookUserId)) return false;
  const verified = await refreshFacebookSession();
  const identity = await chrome.storage.local.get(['expectedFacebookUserId', 'detectedFacebookUserId']);
  const expected = typeof identity.expectedFacebookUserId === 'string' ? identity.expectedFacebookUserId : null;
  const detected = typeof identity.detectedFacebookUserId === 'string' ? identity.detectedFacebookUserId : null;
  const matchesTarget = expected === target.facebookUserId && detected === target.facebookUserId;
  console.log('[PostFlow] Profile target identity check', {
    targetType: target.type,
    verified,
    matchesTarget,
  });
  return verified && matchesTarget;
}

async function failProfileIdentityMismatch(job: PublishJob): Promise<void> {
  console.warn('[PostFlow] Profile job stopped because Facebook identity did not match', {
    jobId: job.id,
    targetType: job.target.type,
  });
  await reportWorkerStatus('ACCOUNT_MISMATCH', 'Facebook account does not match this profile target');
  publishQueuePaused = {
    reason: 'Facebook account does not match this profile target',
    status: 'ACCOUNT_MISMATCH',
    jobId: job.id,
    pausedAt: Date.now(),
  };
  await chrome.storage.local.set({ publishQueuePaused });
  await updateJobStatus(job.id, { status: 'FAILED', error: 'ACCOUNT_MISMATCH' });
  isProcessingJob = false;
  activeExecution = null;
}

function getSafeFacebookGroupUrl(group: any, fallback?: string): string | null {
  const candidate = typeof fallback === 'string' ? fallback : group?.url;
  let groupId = typeof group?.externalId === 'string' ? group.externalId : '';
  try {
    const url = candidate ? new URL(candidate) : null;
    if (!groupId) groupId = url?.pathname.match(/^\/groups\/([^/]+)/i)?.[1] ?? '';
  } catch {
    // Rebuild from externalId when the stored URL is malformed.
  }
  if (!groupId || /[/?#]/.test(groupId)) return null;
  return `https://www.facebook.com/groups/${groupId}/`;
}

async function openFacebookTargetTab(targetUrl: string): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
  const existingTab = tabs.find((tab) => tab.id !== undefined);
  let lastError: unknown;

  if (existingTab?.id !== undefined) {
    for (let attempt = 0; attempt < TAB_ACTION_RETRY_COUNT; attempt += 1) {
      try {
        const updatedTab = await chrome.tabs.update(existingTab.id, {
          url: targetUrl,
          active: true,
        });
        if (updatedTab) return updatedTab;
        throw new Error('Facebook tab navigation returned no tab');
      } catch (error) {
        lastError = error;
        console.warn('[PostFlow] Facebook tab navigation is temporarily unavailable; retrying', {
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, TAB_ACTION_RETRY_DELAY_MS));
      }
    }
  }

  for (let attempt = 0; attempt < TAB_ACTION_RETRY_COUNT; attempt += 1) {
    try {
      return await chrome.tabs.create({ url: targetUrl, active: true });
    } catch (error) {
      lastError = error;
      console.warn('[PostFlow] Facebook tab creation is temporarily unavailable; retrying', {
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, TAB_ACTION_RETRY_DELAY_MS));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not open a Facebook tab');
}

async function waitForFacebookTabDocument(tabId: number, targetUrl: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  let targetPath = '';
  let targetProfileId = '';
  try {
    const expectedUrl = new URL(targetUrl);
    targetPath = expectedUrl.pathname.replace(/\/+$/, '').toLowerCase();
    targetProfileId = targetPath === '/profile.php' ? expectedUrl.searchParams.get('id') ?? '' : '';
  } catch {
    return false;
  }

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url ?? '';
      const currentFacebookUrl = currentUrl ? new URL(currentUrl) : null;
      const currentPath = currentFacebookUrl?.pathname.replace(/\/+$/, '').toLowerCase() ?? '';
      if (
        tab.status === 'complete' &&
        currentPath === targetPath &&
        (!targetProfileId || currentFacebookUrl?.searchParams.get('id') === targetProfileId)
      ) return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function parseProcessedProfileVideoNotificationScan(
  response: unknown,
): { surfaceReady: boolean; notifications: ProcessedProfileVideoNotificationScanResult[] } | null {
  if (typeof response !== 'object' || response === null) return null;
  const value = response as Record<string, unknown>;
  if (value.ok !== true || !Array.isArray(value.notifications)) return null;

  const notifications: ProcessedProfileVideoNotificationScanResult[] = [];
  const seenKeys = new Set<string>();
  for (const candidate of value.notifications) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.key !== 'string' ||
      !/^(?:notification:[^\s]+|reel:\d+)$/.test(item.key) ||
      typeof item.postUrl !== 'string' ||
      !/^https:\/\/www\.facebook\.com\/reel\/\d+\/$/.test(item.postUrl)
    ) continue;
    if (seenKeys.has(item.key)) continue;
    seenKeys.add(item.key);
    notifications.push({
      key: item.key,
      ...(typeof item.notificationId === 'string' ? { notificationId: item.notificationId } : {}),
      postUrl: item.postUrl,
    });
  }

  return {
    surfaceReady: value.surfaceReady === true,
    notifications,
  };
}

async function scanProcessedProfileVideoNotifications(
  tabId: number,
  jobId: string,
): Promise<{ surfaceReady: boolean; notifications: ProcessedProfileVideoNotificationScanResult[] } | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'GET_PROFILE_VIDEO_NOTIFICATIONS',
      jobId,
    });
    return parseProcessedProfileVideoNotificationScan(response);
  } catch {
    return null;
  }
}

async function saveBackgroundPostingStep(
  jobId: string,
  step: string,
  details: Record<string, string | number | boolean | null | undefined> = {},
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    jobId,
    step,
    url: FACEBOOK_NOTIFICATIONS_URL,
    details,
    tabId: null,
  };
  console.log('[PostFlow][posting-log]', entry);
  const result = await chrome.storage.local.get('postingLogs');
  const logs = Array.isArray(result.postingLogs) ? result.postingLogs : [];
  logs.push(entry);
  await chrome.storage.local.set({ postingLogs: logs.slice(-500) });
}

async function snapshotProcessedProfileVideoNotificationKeys(jobId: string): Promise<string[] | null> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: FACEBOOK_NOTIFICATIONS_URL, active: false });
    tabId = tab.id;
    if (
      tabId === undefined ||
      !(await waitForFacebookTabAfterNavigation(
        tabId,
        FACEBOOK_NOTIFICATIONS_URL,
        POSTING_TIMING.facebookTabReadyTimeoutMs,
      ))
    ) throw new Error('Facebook notifications page did not finish loading');

    const identities = new Set<string>();
    const postUrls = new Set<string>();
    const startedAt = Date.now();
    let surfaceReadyAt: number | null = null;
    while (Date.now() - startedAt < POSTING_TIMING.facebookTabReadyTimeoutMs) {
      const scan = await scanProcessedProfileVideoNotifications(tabId, jobId);
      if (scan?.surfaceReady) {
        surfaceReadyAt ??= Date.now();
        for (const notification of scan.notifications) {
          identities.add(notification.key);
          identities.add(`post:${notification.postUrl}`);
          postUrls.add(notification.postUrl);
        }
        // Let Facebook hydrate the notification list before freezing the baseline.
        if (Date.now() - surfaceReadyAt >= 3000) {
          await saveBackgroundPostingStep(jobId, 'profile_video_notification_baseline_captured', {
            notificationCount: postUrls.size,
          }).catch(() => undefined);
          return [...identities];
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POSTING_TIMING.profileVideoNotificationPollIntervalMs));
    }
    throw new Error('Timed out waiting for the Facebook notifications surface');
  } catch (error) {
    console.warn('[PostFlow] Could not capture the processed-video notification baseline', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    await saveBackgroundPostingStep(jobId, 'profile_video_notification_baseline_failed', {
      reason: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    return null;
  } finally {
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function waitForNewProcessedProfileVideoNotification(
  jobId: string,
  baselineKeys: readonly string[],
): Promise<ProcessedProfileVideoNotificationScanResult | null> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: FACEBOOK_NOTIFICATIONS_URL, active: false });
    tabId = tab.id;
    if (
      tabId === undefined ||
      !(await waitForFacebookTabAfterNavigation(
        tabId,
        FACEBOOK_NOTIFICATIONS_URL,
        POSTING_TIMING.facebookTabReadyTimeoutMs,
      ))
    ) return null;

    const baseline = new Set(baselineKeys);
    const startedAt = Date.now();
    let lastRefreshAt = startedAt;
    while (Date.now() - startedAt < POSTING_TIMING.profileVideoNotificationTimeoutMs) {
      const scan = await scanProcessedProfileVideoNotifications(tabId, jobId);
      const found = scan?.notifications.find((notification) =>
        !baseline.has(notification.key) && !baseline.has(`post:${notification.postUrl}`),
      );
      if (found) {
        await saveBackgroundPostingStep(jobId, 'profile_video_notification_matched', {
          postUrl: found.postUrl,
          notificationId: found.notificationId ?? null,
        }).catch(() => undefined);
        return found;
      }

      if (Date.now() - lastRefreshAt >= POSTING_TIMING.profileVideoNotificationRefreshIntervalMs) {
        await chrome.tabs.reload(tabId).catch(() => undefined);
        await waitForFacebookTabAfterNavigation(
          tabId,
          FACEBOOK_NOTIFICATIONS_URL,
          POSTING_TIMING.facebookTabReadyTimeoutMs,
        );
        lastRefreshAt = Date.now();
      } else {
        await new Promise((resolve) => setTimeout(resolve, POSTING_TIMING.profileVideoNotificationPollIntervalMs));
      }
    }

    await saveBackgroundPostingStep(jobId, 'profile_video_notification_not_found', {
      baselineIdentityCount: baseline.size,
    }).catch(() => undefined);
    return null;
  } catch (error) {
    console.warn('[PostFlow] Profile-video notification reconciliation failed', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    await saveBackgroundPostingStep(jobId, 'profile_video_notification_check_failed', {
      reason: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    return null;
  } finally {
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

function isCurrentExecutionResult(message: any, sender: chrome.runtime.MessageSender) {
  if (!activeExecution) {
    console.warn('[PostFlow] Ignoring job result with no active execution:', message.type, message.jobId);
    return false;
  }
  if (message.jobId !== activeExecution.jobId) {
    console.warn('[PostFlow] Ignoring stale job result for non-active job:', {
      type: message.type,
      receivedJobId: message.jobId,
      activeJobId: activeExecution.jobId,
    });
    return false;
  }
  if (sender.tab?.id !== activeExecution.tabId) {
    console.warn('[PostFlow] Ignoring job result from non-active tab:', {
      type: message.type,
      jobId: message.jobId,
      receivedTabId: sender.tab?.id,
      activeTabId: activeExecution.tabId,
    });
    return false;
  }
  return true;
}

// Handle JOB result messages from content script
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'JOB_SUCCESS') {
    if (!isCurrentExecutionResult(message, sender)) return;
    void (async () => {
      console.log('[PostFlow] Job succeeded:', message.jobId);
      const completedExecution = activeExecution;
      finishExecutionHandshake?.();
      await updateJobStatus(message.jobId, {
        status: 'SUCCESS',
        submissionResult: message.submissionResult,
      });

      const completedPostHasVideo = publishJobHasVideo(completedExecution?.post);
      const shouldReconcileProfileVideoNotification = Boolean(
        completedExecution?.target.type === 'PROFILE_FEED' &&
        completedPostHasVideo &&
        message.submissionResult?.status === 'PUBLISHED' &&
        !message.submissionResult.postUrl &&
        Array.isArray(completedExecution.profileVideoNotificationBaselineKeys),
      );

      if (
        shouldReconcileProfileVideoNotification &&
        completedExecution?.target.type === 'PROFILE_FEED' &&
        Array.isArray(completedExecution.profileVideoNotificationBaselineKeys)
      ) {
        console.log('[PostFlow] Waiting for a new processed profile-video notification', {
          jobId: message.jobId,
          baselineIdentityCount: completedExecution.profileVideoNotificationBaselineKeys.length,
        });
        const identityStillMatches = await verifyProfileTargetIdentity(completedExecution.target);
        const notification = identityStillMatches
          ? await waitForNewProcessedProfileVideoNotification(
              message.jobId,
              completedExecution.profileVideoNotificationBaselineKeys,
            )
          : null;
        if (notification) {
          const updatedJob = await updateJobStatus(message.jobId, {
            status: 'SUCCESS',
            submissionResult: {
              status: 'PUBLISHED',
              postUrl: notification.postUrl,
            },
          });
          if (updatedJob) {
            await saveBackgroundPostingStep(message.jobId, 'profile_video_post_url_saved', {
              postUrl: notification.postUrl,
            }).catch(() => undefined);
            console.log('[PostFlow] Profile-video job enriched with its canonical reel URL', {
              jobId: message.jobId,
              postUrl: notification.postUrl,
            });
          } else {
            await saveBackgroundPostingStep(message.jobId, 'profile_video_post_url_update_failed', {
              postUrl: notification.postUrl,
            }).catch(() => undefined);
          }
        } else if (!identityStillMatches) {
          await saveBackgroundPostingStep(message.jobId, 'profile_video_notification_check_skipped', {
            reason: 'Facebook identity no longer matches the profile target',
          }).catch(() => undefined);
        }
      }

      isProcessingJob = false;
      activeExecution = null;

      const shouldRunAutomaticPostLinkCheck = Boolean(
        completedExecution?.target.type === 'GROUP' &&
        completedExecution.post &&
        (
          (
            message.submissionResult?.status === 'PUBLISHED' &&
            !message.submissionResult.postUrl
          ) ||
          (
            message.submissionResult?.status === 'UNKNOWN' &&
            completedPostHasVideo
          ) ||
          (
            message.submissionResult?.status === 'PENDING_APPROVAL' &&
            !message.submissionResult.postUrl &&
            message.englishGroupFlow === true
          )
        ),
      );

      if (shouldRunAutomaticPostLinkCheck && completedExecution?.target.type === 'GROUP' && completedExecution.post) {
        const syncPost: PendingFacebookPost = {
          id: message.jobId,
          groupId: completedExecution.target.groupId,
          groupExternalId: completedExecution.target.externalId,
          groupUrl: completedExecution.target.url,
          status: 'PENDING_APPROVAL',
          content: typeof completedExecution.post.content === 'string' ? completedExecution.post.content : '',
          submittedAt: new Date().toISOString(),
          mediaCount: Array.isArray(completedExecution.post.mediaUrls)
            ? completedExecution.post.mediaUrls.length
            : 0,
          videoIds: Array.isArray(message.videoIds)
            ? message.videoIds.filter((value: unknown): value is string =>
                typeof value === 'string' && /^\d+$/.test(value)
              )
            : [],
          ...(message.englishGroupFlow === true && completedPostHasVideo && message.submissionResult?.status !== 'PENDING_APPROVAL'
            ? { englishGroupVideo: true }
            : {}),
          ...(message.englishGroupFlow === true && message.submissionResult?.status === 'PENDING_APPROVAL' && !message.submissionResult.postUrl
            ? { englishPendingApprovalLookup: true }
            : {}),
        };
        console.log('[PostFlow] Starting automatic post-link check after publish result', {
          jobId: message.jobId,
          publishStatus: message.submissionResult?.status,
          hasVideo: completedPostHasVideo,
        });
        const syncResult = await checkSinglePendingPost(syncPost);
        const shouldPersistAutomaticPostLinkCheck = message.submissionResult?.status === 'PENDING_APPROVAL' ||
          syncResult.status === 'PUBLISHED' ||
          (
            message.submissionResult?.status === 'UNKNOWN' &&
            completedPostHasVideo &&
            syncResult.status === 'STILL_PENDING' &&
            Boolean(syncResult.postUrl)
          );
        const updated = shouldPersistAutomaticPostLinkCheck
          ? await persistPendingSyncResult(syncPost, syncResult)
          : false;
        console.log('[PostFlow] Automatic post-link check finished', {
          jobId: message.jobId,
          status: syncResult.status,
          postUrl: 'postUrl' in syncResult ? syncResult.postUrl : undefined,
          updated,
          persisted: shouldPersistAutomaticPostLinkCheck,
        });
        if (syncPost.englishGroupVideo === true) {
          await saveBackgroundPostingStep(message.jobId, 'english_video_post_url_persist_result', {
            status: syncResult.status,
            hasPostUrl: syncResult.status === 'PUBLISHED' && Boolean(syncResult.postUrl),
            postUrl: syncResult.status === 'PUBLISHED' ? syncResult.postUrl : undefined,
            updated,
            persisted: shouldPersistAutomaticPostLinkCheck,
          });
        }
      }

      checkPendingJobs();
    })();
  }
  if (message.type === 'JOB_FAILED') {
    if (!isCurrentExecutionResult(message, sender)) return;
    void (async () => {
      console.error('[PostFlow] Job failed:', message.jobId, message.error);
      finishExecutionHandshake?.();
      if (message.shouldPauseQueue || message.publishStatus) {
        void reportWorkerStatus(
          workerStatusForPublishFailure(message.publishStatus),
          message.error,
        );
      }
      if (message.shouldPauseQueue) {
        publishQueuePaused = {
          reason: message.error ?? 'Facebook publishing requires manual attention',
          status: message.publishStatus,
          jobId: message.jobId,
          pausedAt: Date.now(),
        };
        await chrome.storage.local.set({ publishQueuePaused });
        console.warn('[PostFlow] Publishing queue paused for manual attention', publishQueuePaused);
      }
      await updateJobStatus(message.jobId, { status: 'FAILED', error: message.error });
      isProcessingJob = false;
      activeExecution = null;
      if (!publishQueuePaused) checkPendingJobs();
    })();
  }
  if (message.type === 'JOB_CANCELED') {
    if (!isCurrentExecutionResult(message, sender)) return;
    void (async () => {
      console.warn('[PostFlow] Job canceled before Facebook submit:', message.jobId);
      finishExecutionHandshake?.();
      await updateJobStatus(message.jobId, { status: 'CANCELED' });
      isProcessingJob = false;
      activeExecution = null;
      checkPendingJobs();
    })();
  }
});

const ENGLISH_VIDEO_COPY_CAPTURE_SCRIPT_ID = 'postflow-english-video-copy-capture';
const ENGLISH_PENDING_NETWORK_CAPTURE_SCRIPT_ID = 'postflow-english-pending-network-capture';

function getBackgroundSiblingScriptFile(fileName: string): string {
  const background = chrome.runtime.getManifest().background;
  const serviceWorkerPath = background && 'service_worker' in background
    ? background.service_worker
    : '';
  const scriptDirectory = serviceWorkerPath.includes('/')
    ? serviceWorkerPath.slice(0, serviceWorkerPath.lastIndexOf('/') + 1)
    : '';
  return `${scriptDirectory}${fileName}`;
}

function getEnglishVideoCopyCaptureScriptFile(): string {
  return getBackgroundSiblingScriptFile('facebook-copy-link-capture.js');
}

async function registerEnglishVideoCopyLinkCapture(): Promise<boolean> {
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [ENGLISH_VIDEO_COPY_CAPTURE_SCRIPT_ID],
    }).catch(() => undefined);
    await chrome.scripting.registerContentScripts([{
      id: ENGLISH_VIDEO_COPY_CAPTURE_SCRIPT_ID,
      matches: ['https://www.facebook.com/groups/*'],
      js: [getEnglishVideoCopyCaptureScriptFile()],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: false,
    }]);
    return true;
  } catch (error) {
    console.warn('[PendingPostSync] Could not register early English video Copy link capture', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function unregisterEnglishVideoCopyLinkCapture(): Promise<void> {
  await chrome.scripting.unregisterContentScripts({
    ids: [ENGLISH_VIDEO_COPY_CAPTURE_SCRIPT_ID],
  }).catch(() => undefined);
}

async function isEnglishVideoCopyLinkCaptureInstalled(tabId: number): Promise<boolean> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => Boolean((window as Window & {
        __postflowFacebookCopyLinkCaptureInstalled?: boolean;
      }).__postflowFacebookCopyLinkCaptureInstalled),
    });
    return result?.result === true;
  } catch {
    return false;
  }
}

async function registerEnglishPendingNetworkCapture(): Promise<boolean> {
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [ENGLISH_PENDING_NETWORK_CAPTURE_SCRIPT_ID],
    }).catch(() => undefined);
    await chrome.scripting.registerContentScripts([{
      id: ENGLISH_PENDING_NETWORK_CAPTURE_SCRIPT_ID,
      matches: ['https://www.facebook.com/groups/*'],
      js: [getBackgroundSiblingScriptFile('graphql-spy.js')],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: false,
    }]);
    return true;
  } catch (error) {
    console.warn('[PendingPostSync] Could not register early English pending-page network capture', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function unregisterEnglishPendingNetworkCapture(): Promise<void> {
  await chrome.scripting.unregisterContentScripts({
    ids: [ENGLISH_PENDING_NETWORK_CAPTURE_SCRIPT_ID],
  }).catch(() => undefined);
}

async function isEnglishPendingNetworkCaptureInstalled(tabId: number): Promise<boolean> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => Boolean((window as Window & {
        __postflowGraphqlSpyInstalled?: boolean;
      }).__postflowGraphqlSpyInstalled),
    });
    return result?.result === true;
  } catch {
    return false;
  }
}

/** Navigate to one post's Group page and return the content script's match.
 * The caller owns API persistence. */
async function checkSinglePendingPost(post: PendingFacebookPost, lockAlreadyHeld = false): Promise<PendingPostSyncResult> {
  if (isProcessingJob) {
    return { status: 'CHECK_FAILED', reason: 'A new Facebook post is currently being published' };
  }
  if (isCheckingPendingPost) {
    return { status: 'CHECK_FAILED', reason: 'Another pending post check is already running' };
  }
  if (!lockAlreadyHeld && isFacebookSyncBusy) {
    return { status: 'CHECK_FAILED', reason: 'Another Facebook sync is already running' };
  }
  if (!lockAlreadyHeld) isFacebookSyncBusy = true;

  isCheckingPendingPost = true;
  const requestId = `pending-${++pendingCheckSequence}`;
  const isEnglishVideoCheck = post.englishGroupVideo === true;
  const isEnglishPendingApprovalLookup = post.englishPendingApprovalLookup === true;
  const needsEnglishCopyCapture = isEnglishVideoCheck && !isEnglishPendingApprovalLookup;
  let syncTabId: number | undefined;
  let previousActiveTabId: number | undefined;
  let registeredEnglishCopyCapture = false;
  let registeredEnglishPendingNetworkCapture = false;
  let pendingLookupRefreshTimer: ReturnType<typeof setInterval> | undefined;
  try {
    const groupUrl = getSafeFacebookGroupUrl(post, post.groupUrl);
    if (!groupUrl) {
      return { status: 'CHECK_FAILED', reason: 'Invalid Facebook group URL' };
    }
    console.log('[PendingPostSync] Starting single post check', {
      postId: post.id,
      groupUrl,
      requestId,
    });
    if (isEnglishVideoCheck) {
      await saveBackgroundPostingStep(post.id, 'english_video_fresh_tab_check_started', {
        requestId,
        groupUrl,
      });
    }
    // Status checks must never reuse or foreground the tab used for a new
    // publish. Reusing tabs here was the source of old posts appearing during
    // a different group's publish flow.
    let checkUrl = groupUrl;
    if (post.postUrl) {
      try {
        const savedUrl = new URL(post.postUrl);
        if (/^\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/[A-Za-z0-9_-]+/i.test(savedUrl.pathname)) {
          checkUrl = savedUrl.href;
        }
      } catch {
        // Fall back to the group feed when the saved pending URL is invalid.
      }
    }
    if (isEnglishPendingApprovalLookup && !post.postUrl) {
      const parsedGroupUrl = new URL(groupUrl);
      const groupPath = parsedGroupUrl.pathname.match(/^\/groups\/[^/]+/i)?.[0];
      if (!groupPath) {
        return { status: 'CHECK_FAILED', reason: 'Invalid Facebook group URL for pending-post lookup' };
      }
      checkUrl = `${parsedGroupUrl.origin}${groupPath}/pending_posts/`;
      await saveBackgroundPostingStep(post.id, 'english_pending_fresh_tab_check_started', {
        requestId,
        checkUrl,
      });
    }
    if (needsEnglishCopyCapture) {
      const [previousActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      previousActiveTabId = previousActiveTab?.id;
      await saveBackgroundPostingStep(post.id, isEnglishPendingApprovalLookup
        ? 'english_pending_copy_capture_install_started'
        : 'english_video_copy_capture_install_started', {
        mode: 'document_start',
      });
      registeredEnglishCopyCapture = await registerEnglishVideoCopyLinkCapture();
      await saveBackgroundPostingStep(post.id, isEnglishPendingApprovalLookup
        ? 'english_pending_copy_capture_install_finished'
        : 'english_video_copy_capture_install_finished', {
        installed: registeredEnglishCopyCapture,
        mode: 'document_start',
      });
    }
    if (isEnglishPendingApprovalLookup) {
      await saveBackgroundPostingStep(post.id, 'english_pending_network_capture_install_started', {
        mode: 'document_start',
      });
      registeredEnglishPendingNetworkCapture = await registerEnglishPendingNetworkCapture();
      await saveBackgroundPostingStep(post.id, 'english_pending_network_capture_install_finished', {
        installed: registeredEnglishPendingNetworkCapture,
        mode: 'document_start',
      });
    }
    const fbTab = await chrome.tabs.create({
      url: checkUrl,
      active: needsEnglishCopyCapture,
    });
    syncTabId = fbTab.id;
    if (isEnglishVideoCheck) {
      await saveBackgroundPostingStep(post.id, 'english_video_fresh_tab_created', {
        tabId: fbTab.id ?? null,
        active: fbTab.active,
      });
    }

    if (!fbTab.id || !(await waitForFacebookTabAfterNavigation(fbTab.id, checkUrl, POSTING_TIMING.facebookTabReadyTimeoutMs))) {
      console.warn('[PendingPostSync] Facebook pending-post navigation failed', { postId: post.id, checkUrl });
      if (isEnglishVideoCheck) {
        await saveBackgroundPostingStep(post.id, 'english_video_fresh_tab_not_ready', {
          tabId: fbTab.id ?? null,
        });
      }
      return { status: 'CHECK_FAILED', reason: 'Target Facebook group page did not finish loading' };
    }
    if (isEnglishPendingApprovalLookup && fbTab.id) {
      await saveBackgroundPostingStep(post.id, 'english_pending_network_capture_document_ready', {
        tabId: fbTab.id,
        installed: await isEnglishPendingNetworkCaptureInstalled(fbTab.id),
        mode: 'document_start',
      });
      const refreshIntervalMs = 15_000;
      await saveBackgroundPostingStep(post.id, 'english_pending_page_refresh_scheduled', {
        tabId: fbTab.id,
        refreshIntervalMs,
      });
      pendingLookupRefreshTimer = setInterval(() => {
        void chrome.tabs.reload(fbTab.id!).then(() => {
          void saveBackgroundPostingStep(post.id, 'english_pending_page_refreshed', {
            tabId: fbTab.id,
          });
        }).catch(() => undefined);
      }, refreshIntervalMs);
    }
    if (isEnglishVideoCheck) {
      await saveBackgroundPostingStep(post.id, 'english_video_fresh_tab_ready', {
        tabId: fbTab.id,
      });
      await saveBackgroundPostingStep(post.id, 'english_video_copy_capture_document_ready', {
        tabId: fbTab.id,
        installed: await isEnglishVideoCopyLinkCaptureInstalled(fbTab.id),
        mode: 'document_start',
      });
    }

    const startedAt = Date.now();
    let deliveryAttempts = 0;
    const pendingLookupTimeoutMs = isEnglishPendingApprovalLookup
      ? POSTING_TIMING.profileVideoPermalinkTimeoutMs
      : POSTING_TIMING.facebookTabReadyTimeoutMs;
    while (Date.now() - startedAt < pendingLookupTimeoutMs) {
      try {
        deliveryAttempts += 1;
        console.log('[PendingPostSync] Asking Facebook content script to check post', {
          postId: post.id,
          tabId: fbTab.id,
          requestId,
        });
        if (isEnglishVideoCheck && deliveryAttempts === 1) {
          await saveBackgroundPostingStep(post.id, 'english_video_content_check_sent', {
            tabId: fbTab.id,
            requestId,
          });
        }
        const response = await chrome.tabs.sendMessage(fbTab.id, {
          type: 'CHECK_PENDING_POST',
          requestId,
          post,
        });
        if (response?.ok && response.result) {
          const result = response.result as PendingPostSyncResult;
          console.log('[PendingPostSync] Facebook content script returned result', {
            postId: post.id,
            result,
          });
          if (isEnglishVideoCheck) {
            await saveBackgroundPostingStep(post.id, 'english_video_content_check_result', {
              status: result.status,
              deliveryAttempts,
              hasCopiedShareUrl: result.status === 'CONTENT_MATCHED' && Boolean(result.copiedShareUrl),
            });
          }
          if (isEnglishPendingApprovalLookup) {
            await saveBackgroundPostingStep(post.id, 'english_pending_lookup_result', {
              status: result.status,
              postUrl: 'postUrl' in result ? result.postUrl : undefined,
              reason: 'reason' in result ? result.reason : undefined,
              deliveryAttempts,
            });
          }
          if (result.status === 'CONTENT_MATCHED') {
            console.log('[PendingPostSync] English Group video content match succeeded', {
              postId: post.id,
              tabId: fbTab.id,
            });
            if (result.copiedShareUrl) {
              const canonicalPostUrl = await resolveEnglishGroupShareRedirect(
                fbTab.id,
                result.copiedShareUrl,
                post,
              );
              if (canonicalPostUrl) {
                console.log('[PendingPostSync] English video share link resolved to canonical Group post', {
                  postId: post.id,
                  canonicalPostUrl,
                });
                if (isEnglishPendingApprovalLookup) {
                  await saveBackgroundPostingStep(post.id, 'english_pending_post_url_resolved', {
                    status: /\/pending_posts\//i.test(canonicalPostUrl)
                      ? 'STILL_PENDING'
                      : 'PUBLISHED',
                    postUrl: canonicalPostUrl,
                  });
                }
                return {
                  status: /\/pending_posts\//i.test(canonicalPostUrl)
                    ? 'STILL_PENDING'
                    : 'PUBLISHED',
                  postUrl: canonicalPostUrl,
                };
              }
              console.warn('[PendingPostSync] Copied English video share link did not resolve to the expected Group', {
                postId: post.id,
              });
            }
          }
          return result;
        }
      } catch {
        // The content script can be replaced during initial navigation. Keep
        // retrying delivery, but perform only one DOM/render evaluation.
      }
      await new Promise((resolve) => setTimeout(resolve, POSTING_TIMING.facebookMessageRetryIntervalMs));
    }
    if (isEnglishPendingApprovalLookup) {
      await saveBackgroundPostingStep(post.id, 'english_pending_lookup_deadline_reached', {
        timeoutMs: pendingLookupTimeoutMs,
        deliveryAttempts,
      });
    }
    return { status: 'CHECK_FAILED', reason: 'Timed out waiting for pending post matcher' };
  } catch (err: any) {
    return { status: 'CHECK_FAILED', reason: err?.message ?? 'Pending post check failed' };
  } finally {
    if (pendingLookupRefreshTimer !== undefined) {
      clearInterval(pendingLookupRefreshTimer);
      pendingLookupRefreshTimer = undefined;
    }
    if (syncTabId !== undefined) {
      await chrome.tabs.remove(syncTabId).catch(() => undefined);
      if (isEnglishVideoCheck) {
        await saveBackgroundPostingStep(post.id, 'english_video_fresh_tab_closed', {
          tabId: syncTabId,
        }).catch(() => undefined);
      } else if (isEnglishPendingApprovalLookup) {
        await saveBackgroundPostingStep(post.id, 'english_pending_fresh_tab_closed', {
          tabId: syncTabId,
        }).catch(() => undefined);
      }
    }
    if (needsEnglishCopyCapture && previousActiveTabId !== undefined && previousActiveTabId !== syncTabId) {
      await chrome.tabs.update(previousActiveTabId, { active: true }).catch(() => undefined);
      await saveBackgroundPostingStep(post.id, isEnglishPendingApprovalLookup
        ? 'english_pending_previous_tab_restored'
        : 'english_video_previous_tab_restored', {
        tabId: previousActiveTabId,
      }).catch(() => undefined);
    }
    if (registeredEnglishCopyCapture) {
      await unregisterEnglishVideoCopyLinkCapture();
      await saveBackgroundPostingStep(post.id, isEnglishPendingApprovalLookup
        ? 'english_pending_copy_capture_unregistered'
        : 'english_video_copy_capture_unregistered', {
        mode: 'document_start',
      }).catch(() => undefined);
    }
    if (registeredEnglishPendingNetworkCapture) {
      await unregisterEnglishPendingNetworkCapture();
      await saveBackgroundPostingStep(post.id, 'english_pending_network_capture_unregistered', {
        mode: 'document_start',
      }).catch(() => undefined);
    }
    isCheckingPendingPost = false;
    if (!lockAlreadyHeld) isFacebookSyncBusy = false;
  }
}

function normalizeResolvedEnglishGroupPostUrl(
  value: string,
  post: PendingFacebookPost,
): string | null {
  try {
    const url = new URL(value);
    if (url.hostname !== 'facebook.com' && !url.hostname.endsWith('.facebook.com')) return null;
    const match = url.pathname.match(
      /^\/groups\/([^/]+)\/(posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)/i,
    );
    if (!match) return null;

    const expectedGroups = new Set(
      [post.groupId, post.groupExternalId]
        .filter((groupId): groupId is string => typeof groupId === 'string' && Boolean(groupId))
        .map((groupId) => groupId.toLowerCase()),
    );
    try {
      const groupUrlId = new URL(post.groupUrl).pathname.match(/^\/groups\/([^/]+)/i)?.[1];
      if (groupUrlId) expectedGroups.add(groupUrlId.toLowerCase());
    } catch {
      // The validated job target aliases above remain sufficient.
    }
    if (expectedGroups.size && !expectedGroups.has(match[1].toLowerCase())) return null;
    const canonicalRoute = match[2].toLowerCase() === 'pending_posts'
      ? 'pending_posts'
      : 'posts';
    return `https://www.facebook.com/groups/${match[1]}/${canonicalRoute}/${match[3]}/`;
  } catch {
    return null;
  }
}

async function resolveEnglishGroupShareRedirect(
  tabId: number,
  shareUrl: string,
  post: PendingFacebookPost,
): Promise<string | null> {
  const directPostUrl = normalizeResolvedEnglishGroupPostUrl(shareUrl, post);
  if (directPostUrl) return directPostUrl;

  let parsedShareUrl: URL;
  try {
    parsedShareUrl = new URL(shareUrl);
  } catch {
    return null;
  }
  if (
    (parsedShareUrl.hostname !== 'facebook.com' && !parsedShareUrl.hostname.endsWith('.facebook.com')) ||
    !/^\/share\/v\/[A-Za-z0-9_-]+\/?$/i.test(parsedShareUrl.pathname)
  ) return null;

  await saveBackgroundPostingStep(post.id, 'english_video_share_redirect_started', {
    tabId,
    shareUrl: parsedShareUrl.href,
  });
  await chrome.tabs.update(tabId, { url: parsedShareUrl.href, active: true });
  const startedAt = Date.now();
  let lastObservedPath = '';
  while (Date.now() - startedAt < POSTING_TIMING.facebookTabReadyTimeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url) {
        try {
          const observedUrl = new URL(tab.url);
          const observedPath = `${observedUrl.pathname}${observedUrl.search}`;
          if (observedPath !== lastObservedPath) {
            lastObservedPath = observedPath;
            await saveBackgroundPostingStep(post.id, 'english_video_share_redirect_location_changed', {
              observedPath,
              tabStatus: tab.status ?? null,
            });
          }
        } catch {
          // Continue polling until Facebook exposes a valid URL.
        }
      }
      const canonicalPostUrl = tab.url
        ? normalizeResolvedEnglishGroupPostUrl(tab.url, post)
        : null;
      if (canonicalPostUrl) {
        await saveBackgroundPostingStep(post.id, 'english_video_canonical_post_url_resolved', {
          canonicalPostUrl,
        });
        return canonicalPostUrl;
      }
    } catch {
      await saveBackgroundPostingStep(post.id, 'english_video_share_redirect_tab_unavailable');
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await saveBackgroundPostingStep(post.id, 'english_video_share_redirect_timed_out', {
    lastObservedPath: lastObservedPath || null,
  });
  return null;
}

/**
 * Wait for a real navigation cycle when reusing a tab. A same-path tab can
 * otherwise still report `complete` for the old Facebook document.
 */
async function waitForFacebookTabAfterNavigation(tabId: number, targetUrl: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  let targetPath = '';
  let targetGroupPath = '';
  let targetPostIdentity = '';
  const targetIsPost = /\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/[A-Za-z0-9_-]+/i.test(targetUrl);
  try {
    const parsedTarget = new URL(targetUrl);
    targetPath = parsedTarget.pathname.replace(/\/+$/, '').toLowerCase();
    targetGroupPath = parsedTarget.pathname.match(/^\/groups\/[^/]+/i)?.[0].toLowerCase() ?? '';
    targetPostIdentity = parsedTarget.pathname.match(/^\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/([A-Za-z0-9_-]+)/i)?.[1] ?? '';
  } catch {
    return false;
  }

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url ?? '';
      const currentPath = currentUrl ? new URL(currentUrl).pathname.replace(/\/+$/, '').toLowerCase() : '';
      const currentPostIdentity = currentPath.match(/^\/groups\/[^/]+\/(?:posts|pending_posts|permalink)\/([A-Za-z0-9_-]+)/i)?.[1] ?? '';
      const landedOnTarget = currentPath === targetPath ||
        (targetIsPost && currentPath === targetGroupPath) ||
        (targetIsPost && targetPostIdentity && currentPostIdentity === targetPostIdentity);
      if (tab.status === 'complete' && landedOnTarget && Date.now() - startedAt >= 1500) return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

let isPendingBatchRunning = false;

/** Fetch and process a small pending-post batch without opening concurrent tabs. */
async function syncPendingPostsBatch(
  manualOnly = false,
  maxItems = MAINTENANCE_BATCH_LIMIT,
): Promise<Array<{ postId: string; result: PendingPostSyncResult; updated: boolean }>> {
  if (!(await canClaimNewWork())) return [];
  if (isPendingBatchRunning || isFacebookSyncBusy || isProcessingJob) return [];
  isPendingBatchRunning = true;
  isFacebookSyncBusy = true;

  try {
    await recordMaintenanceDiagnostic(
      'claim.requested',
      'PENDING_APPROVAL',
      'claimRequests',
      { manualOnly },
    );
    const pendingPosts = await apiFetch(
      `/api/jobs/pending?limit=${Math.min(MAINTENANCE_BATCH_LIMIT, Math.max(1, maxItems))}${manualOnly ? '&manualOnly=true' : ''}`,
    );
    if (!Array.isArray(pendingPosts)) {
      console.warn('[PendingPostSync] Could not fetch pending posts');
      return [];
    }
    if (pendingPosts.length === 0) {
      await recordMaintenanceDiagnostic(
        'claim.empty',
        'PENDING_APPROVAL',
        'emptyClaims',
        { manualOnly },
      );
    }

    const results: Array<{ postId: string; result: PendingPostSyncResult; updated: boolean }> = [];
    for (const post of pendingPosts as PendingFacebookPost[]) {
      await recordMaintenanceDiagnostic(
        'claim.created',
        'PENDING_APPROVAL',
        'claimsCreated',
        { jobId: post.id, manualOnly },
      );
      let result: PendingPostSyncResult;
      try {
        result = await checkSinglePendingPost(post, true);
      } catch (err: any) {
        result = { status: 'CHECK_FAILED', reason: err?.message ?? 'Pending post check failed' };
      }

      const updated = await persistPendingSyncResult(post, result);
      await recordMaintenanceDiagnostic(
        'result.completed',
        'PENDING_APPROVAL',
        updated && result.status !== 'CHECK_FAILED'
          ? 'resultSuccesses'
          : 'resultFailures',
        {
          jobId: post.id,
          status: result.status,
          outcome: updated ? 'UPDATED' : 'NOT_UPDATED',
        },
      );
      results.push({ postId: post.id, result, updated });
      console.log('[PendingPostSync] Completed pending post check', {
        postId: post.id,
        status: result.status,
        updated,
      });
    }
    return results;
  } finally {
    isPendingBatchRunning = false;
    isFacebookSyncBusy = false;
  }
}

async function persistPendingSyncResult(post: PendingFacebookPost, result: PendingPostSyncResult): Promise<boolean> {
  const response = await apiFetch(`/api/jobs/${post.id}/pending-sync`, {
    ...result,
    ...(post.claimToken ? { claimToken: post.claimToken } : {}),
  });
  return Boolean(response);
}

let isEngagementBatchRunning = false;
let engagementCheckSequence = 0;
let isCheckingEngagement = false;

async function checkSinglePostEngagement(
  post: PublishedFacebookPost,
  lockAlreadyHeld = false,
  mode: EngagementSyncMode = 'MANUAL',
): Promise<PostEngagementSyncResult> {
  if (isProcessingJob) {
    return { status: 'CHECK_FAILED', reason: 'A new Facebook post is currently being published' };
  }
  if (isCheckingEngagement || (!lockAlreadyHeld && isFacebookSyncBusy)) {
    return { status: 'CHECK_FAILED', reason: 'Another engagement check is already running' };
  }
  if (!lockAlreadyHeld) isFacebookSyncBusy = true;
  isCheckingEngagement = true;
  const requestId = `engagement-${++engagementCheckSequence}`;
  let syncTabId: number | undefined;
  let previousActiveTabId: number | undefined;
  let foregroundRetryUsed = false;
  const tabBehavior = getEngagementTabBehavior(mode);
  const postUrl = normalizeFacebookEngagementPermalink(post.postUrl);
  if (!postUrl) {
    console.error('[PostAnalytics] Invalid stored Facebook post URL', { postId: post.id, postUrl: post.postUrl });
    isCheckingEngagement = false;
    if (!lockAlreadyHeld) isFacebookSyncBusy = false;
    return { status: 'CHECK_FAILED', reason: 'Stored Facebook post URL is invalid' };
  }
  try {
    const [previousActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    previousActiveTabId = previousActiveTab?.id;
    console.log('[PostAnalytics] Opening published post', {
      postId: post.id,
      postUrl,
      requestId,
      mode,
    });
    // Analytics runs in an isolated background tab. It must not navigate the
    // active publishing tab to a previously stored post URL.
    const fbTab = await chrome.tabs.create({
      url: postUrl,
      active: tabBehavior.initiallyActive,
    });
    syncTabId = fbTab.id;
    console.log('[PostAnalytics] Facebook tab opened', { tabId: fbTab.id, postId: post.id });
    const ready = Boolean(fbTab.id && await waitForFacebookTabAfterNavigation(fbTab.id, postUrl, POSTING_TIMING.facebookTabReadyTimeoutMs));
    console.log('[PostAnalytics] Facebook tab readiness result', { tabId: fbTab.id, postId: post.id, ready });
    if (!fbTab.id || !ready) {
      console.warn('[PostAnalytics] Facebook post navigation failed', { postId: post.id, postUrl });
      return { status: 'CHECK_FAILED', reason: 'Target Facebook post did not finish loading' };
    }

    const renderAttemptLimit = tabBehavior.allowForegroundRetry ? 2 : 1;
    for (let renderAttempt = 0; renderAttempt < renderAttemptLimit; renderAttempt += 1) {
      if (renderAttempt === 1) {
        foregroundRetryUsed = true;
        console.warn('[PostAnalytics] Empty background Facebook surface; retrying in foreground', {
          postId: post.id,
          targetType: post.targetType ?? 'GROUP',
          tabId: fbTab.id,
        });
        await chrome.tabs.update(fbTab.id, { active: true });
        await chrome.tabs.reload(fbTab.id);
        const foregroundReady = await waitForFacebookTabAfterNavigation(
          fbTab.id,
          postUrl,
          POSTING_TIMING.facebookTabReadyTimeoutMs,
        );
        if (!foregroundReady) {
          return { status: 'CHECK_FAILED', reason: 'Target Facebook post did not finish loading in foreground' };
        }
      }

      const startedAt = Date.now();
      let retryInForeground = false;
      while (Date.now() - startedAt < POSTING_TIMING.facebookTabReadyTimeoutMs) {
        try {
          console.log('[PostAnalytics] Sending engagement check to Facebook tab', {
            postId: post.id,
            tabId: fbTab.id,
            requestId,
            renderAttempt: renderAttempt + 1,
          });
          const response = await chrome.tabs.sendMessage(fbTab.id, {
            type: 'CHECK_POST_ENGAGEMENT', requestId, post: { ...post, postUrl },
          });
          console.log('[PostAnalytics] Facebook tab response received', { postId: post.id, tabId: fbTab.id, response });
          if (response?.ok && response.result) {
            if (renderAttempt === 0 && response.emptySurface === true) {
              if (!tabBehavior.allowForegroundRetry) {
                console.warn('[PostAnalytics] Empty background Facebook surface; automatic foreground retry disabled', {
                  postId: post.id,
                  targetType: post.targetType ?? 'GROUP',
                  tabId: fbTab.id,
                });
                return {
                  status: 'CHECK_FAILED',
                  reason: 'Facebook engagement did not render in the background tab',
                };
              }
              retryInForeground = true;
              break;
            }
            console.log('[PostAnalytics] Engagement check completed', { postId: post.id, result: response.result });
            return response.result as PostEngagementSyncResult;
          }
        } catch (error) {
          console.log('[PostAnalytics] Facebook content script unavailable; retrying', {
            postId: post.id,
            tabId: fbTab.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // The content script can be replaced while Facebook finishes navigation.
        }
        await new Promise((resolve) => setTimeout(resolve, POSTING_TIMING.facebookMessageRetryIntervalMs));
      }
      if (retryInForeground) continue;
      break;
    }
    console.error('[PostAnalytics] Timed out waiting for Facebook engagement content script', {
      postId: post.id,
      tabId: fbTab.id,
    });
    return { status: 'CHECK_FAILED', reason: 'Timed out waiting for engagement counters' };
  } catch (err: any) {
    return { status: 'CHECK_FAILED', reason: err?.message ?? 'Engagement check failed' };
  } finally {
    if (syncTabId !== undefined) {
      await chrome.tabs.remove(syncTabId).catch(() => undefined);
    }
    if (foregroundRetryUsed && previousActiveTabId !== undefined && previousActiveTabId !== syncTabId) {
      await chrome.tabs.update(previousActiveTabId, { active: true }).catch(() => undefined);
    }
    isCheckingEngagement = false;
    if (!lockAlreadyHeld) isFacebookSyncBusy = false;
  }
}

async function syncPublishedEngagementBatch(
  manualOnly = false,
  maxItems = MAINTENANCE_BATCH_LIMIT,
  mode: EngagementSyncMode = 'AUTOMATIC',
) {
  if (!(await canClaimNewWork())) return [];
  if (isEngagementBatchRunning || isFacebookSyncBusy || isProcessingJob) return [];
  isEngagementBatchRunning = true;
  isFacebookSyncBusy = true;
  try {
    await recordMaintenanceDiagnostic(
      'claim.requested',
      'ENGAGEMENT',
      'claimRequests',
      { manualOnly },
    );
    const queryParams = new URLSearchParams({
      limit: String(Math.min(MAINTENANCE_BATCH_LIMIT, Math.max(1, maxItems))),
      ...(manualOnly ? { manualOnly: 'true' } : {}),
    });
    const query = `/api/jobs/engagement-pending?${queryParams.toString()}`;
    const posts = await apiFetch(query);
    if (!Array.isArray(posts)) return [];
    if (posts.length === 0) {
      await recordMaintenanceDiagnostic(
        'claim.empty',
        'ENGAGEMENT',
        'emptyClaims',
        { manualOnly },
      );
    }
    const results = [];
    for (const post of posts as PublishedFacebookPost[]) {
      await recordMaintenanceDiagnostic(
        'claim.created',
        'ENGAGEMENT',
        'claimsCreated',
        { jobId: post.id, manualOnly },
      );
      const result = await checkSinglePostEngagement(post, true, mode);
      const updated = Boolean(await apiFetch(`/api/jobs/${post.id}/engagement`, {
        ...result,
        ...(post.claimToken ? { claimToken: post.claimToken } : {}),
      }));
      await recordMaintenanceDiagnostic(
        'result.completed',
        'ENGAGEMENT',
        updated && result.status !== 'CHECK_FAILED'
          ? 'resultSuccesses'
          : 'resultFailures',
        {
          jobId: post.id,
          status: result.status,
          outcome: updated ? 'UPDATED' : 'NOT_UPDATED',
        },
      );
      results.push({ postId: post.id, result, updated });
      console.log('[PostAnalytics] Engagement sync completed', { postId: post.id, result, updated });
    }
    return results;
  } finally {
    isEngagementBatchRunning = false;
    isFacebookSyncBusy = false;
  }
}

type MaintenanceCoordinatorOptions = {
  manualOnly?: boolean;
  pending?: boolean;
  analytics?: boolean;
  analyticsMode?: EngagementSyncMode;
};

let isMaintenanceCoordinatorRunning = false;

/** Give new publishing work a chance between maintenance items. */
async function yieldMaintenanceToPublishing(deadline: number): Promise<boolean> {
  if (Date.now() >= deadline) return false;
  const previousBusyState = isFacebookSyncBusy;
  isFacebookSyncBusy = false;
  try {
    await checkPendingJobs();
    return Date.now() < deadline;
  } finally {
    isFacebookSyncBusy = previousBusyState;
  }
}

/** Run maintenance in priority order with one navigation at a time. */
async function runMaintenanceCoordinator(
  options: MaintenanceCoordinatorOptions = {},
) {
  if (!(await canClaimNewWork())) return [];
  if (
    isMaintenanceCoordinatorRunning ||
    isProcessingJob ||
    isFacebookSyncBusy ||
    !facebookIdentityVerified
  ) {
    return [];
  }

  const {
    manualOnly = false,
    pending = true,
    analytics = false,
    analyticsMode = 'AUTOMATIC',
  } = options;
  isMaintenanceCoordinatorRunning = true;
  const startedAt = Date.now();
  const deadline = startedAt + MAINTENANCE_EXECUTION_BUDGET_MS;
  const results: unknown[] = [];
  console.log('[Maintenance] Coordinator started', {
    manualOnly,
    pending,
    analytics,
    analyticsMode,
  });
  try {
    for (const workType of (pending ? ['pending', ...(analytics ? ['analytics'] : [])] : analytics ? ['analytics'] : [])) {
      for (let index = 0; index < MAINTENANCE_BATCH_LIMIT; index += 1) {
        if (!(await yieldMaintenanceToPublishing(deadline))) return results;
        const batch = workType === 'pending'
          ? await syncPendingPostsBatch(manualOnly, 1)
          : await syncPublishedEngagementBatch(
              manualOnly,
              1,
              analyticsMode,
            );
        if (!batch.length) break;
        results.push(...batch);
      }
    }
    console.log('[Maintenance] Coordinator completed', {
      processed: results.length,
      elapsedMs: Date.now() - startedAt,
    });
    return results;
  } finally {
    isMaintenanceCoordinatorRunning = false;
  }
}

/** Process dashboard requests that belong to this extension's connection. */
async function syncManualMaintenanceRequests() {
  return runMaintenanceCoordinator({
    manualOnly: true,
    pending: true,
    analytics: true,
    analyticsMode: 'MANUAL',
  });
}

// ── Alarms ──

/**
 * Keep automatic maintenance wakes persistent across service-worker restarts,
 * but spread each first wake by a stable 0–2 minute offset. Storage markers
 * prevent a service-worker restart from moving an already scheduled alarm
 * back to "now + jitter".
 */
async function ensureMaintenanceAlarms(): Promise<void> {
  const [existingPendingAlarm, existingEngagementAlarm, stored] =
    await Promise.all([
      chrome.alarms.get(PENDING_POST_SYNC_ALARM),
      chrome.alarms.get(ENGAGEMENT_SYNC_ALARM),
      chrome.storage.local.get([
        PENDING_POST_SYNC_ALARM_INITIALIZED_KEY,
        ENGAGEMENT_SYNC_ALARM_INITIALIZED_KEY,
      ]),
    ]);
  const pendingAlarmInitialized =
    stored[PENDING_POST_SYNC_ALARM_INITIALIZED_KEY] === true;
  const engagementAlarmInitialized =
    stored[ENGAGEMENT_SYNC_ALARM_INITIALIZED_KEY] === true;

  if (
    !existingPendingAlarm ||
    existingPendingAlarm.periodInMinutes !== PENDING_POST_SYNC_INTERVAL_MINUTES ||
    !pendingAlarmInitialized
  ) {
    const extensionInstanceId = await getExtensionInstanceId();
    const jitterMs = getMaintenanceStartupJitterMs(extensionInstanceId);
    chrome.alarms.create(PENDING_POST_SYNC_ALARM, {
      when: getMaintenanceAlarmFirstRunAt(extensionInstanceId),
      periodInMinutes: PENDING_POST_SYNC_INTERVAL_MINUTES,
    });
    await chrome.storage.local.set({
      [PENDING_POST_SYNC_ALARM_INITIALIZED_KEY]: true,
    });
    console.log('[Maintenance] Pending scheduler armed', {
      intervalMinutes: PENDING_POST_SYNC_INTERVAL_MINUTES,
      jitterMs,
    });
  }

  if (!AUTOMATIC_ANALYTICS_ENABLED) {
    if (existingEngagementAlarm) {
      await chrome.alarms.clear(ENGAGEMENT_SYNC_ALARM);
    }
    await chrome.storage.local.remove(ENGAGEMENT_SYNC_ALARM_INITIALIZED_KEY);
    console.info('[MaintenanceDiagnostic]', {
      event: 'scheduler.disabled',
      workType: 'ENGAGEMENT',
      reasonCode: 'FEATURE_FLAG_OFF',
    });
  } else if (
    !existingEngagementAlarm ||
    existingEngagementAlarm.periodInMinutes !== ENGAGEMENT_SYNC_INTERVAL_MINUTES ||
    !engagementAlarmInitialized
  ) {
    const extensionInstanceId = await getExtensionInstanceId();
    const analyticsJitterKey = `${extensionInstanceId}:analytics`;
    const jitterMs = getMaintenanceStartupJitterMs(analyticsJitterKey);
    chrome.alarms.create(ENGAGEMENT_SYNC_ALARM, {
      when: getMaintenanceAlarmFirstRunAt(analyticsJitterKey),
      periodInMinutes: ENGAGEMENT_SYNC_INTERVAL_MINUTES,
    });
    await chrome.storage.local.set({
      [ENGAGEMENT_SYNC_ALARM_INITIALIZED_KEY]: true,
    });
    console.log('[Maintenance] Analytics scheduler armed', {
      intervalMinutes: ENGAGEMENT_SYNC_INTERVAL_MINUTES,
      jitterMs,
      backgroundOnly: true,
    });
  }

  const existingManualAlarm = await chrome.alarms.get(MANUAL_MAINTENANCE_ALARM);
  if (
    !existingManualAlarm ||
    existingManualAlarm.periodInMinutes !== MANUAL_MAINTENANCE_INTERVAL_MINUTES
  ) {
    chrome.alarms.create(MANUAL_MAINTENANCE_ALARM, {
      periodInMinutes: MANUAL_MAINTENANCE_INTERVAL_MINUTES,
    });
  }
}

async function initializeWorkerAlarms(): Promise<void> {
  if ((await getExtensionLifecycleStatus()) === 'REVOKED') {
    await handleRevokedInstallation();
    return;
  }
  chrome.alarms.create(HEARTBEAT_ALARM, {
    periodInMinutes: HEARTBEAT_INTERVAL_MINUTES,
  });
  await ensureMaintenanceAlarms();
}

void initializeWorkerAlarms();
// Remove state left by the retired English-video retry experiment. The
// finalized flow performs one fresh-tab reconciliation immediately.
void chrome.alarms.clear('postflow-english-video-link-sync');
void chrome.storage.local.remove('englishGroupVideoLinkRetries');

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REGISTER_RETRY_ALARM) {
    void registerExtension();
  }
  if (alarm.name === HEARTBEAT_ALARM) {
    sendHeartbeat();
    void refreshFacebookSession();
    checkPendingJobs(); // Also check jobs on heartbeat
  }
  if (alarm.name === PENDING_POST_SYNC_ALARM) {
    void runMaintenanceCoordinator({ pending: true });
  }
  if (alarm.name === ENGAGEMENT_SYNC_ALARM) {
    if (AUTOMATIC_ANALYTICS_ENABLED) {
      void runMaintenanceCoordinator({
        pending: false,
        analytics: true,
        analyticsMode: 'AUTOMATIC',
      });
    } else {
      void chrome.alarms.clear(ENGAGEMENT_SYNC_ALARM);
    }
  }
  if (alarm.name === MANUAL_MAINTENANCE_ALARM) {
    void syncManualMaintenanceRequests();
  }
});

// ── Startup ──

// A service-worker restart does not reinject content scripts into dashboard
// tabs that were already open. Do this on every worker startup so the Clerk
// user ID handshake is immediate instead of waiting for a dashboard refresh.
void injectPostflowBridgeIntoOpenDashboardTabs();
void registerExtension();

chrome.runtime.onStartup.addListener(() => {
  registerExtension();
  sendHeartbeat();
  checkPendingJobs();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.storage.local.set({ extensionConnectionStage: 'waiting-for-dashboard' });
  }
  void injectPostflowBridgeIntoOpenDashboardTabs();
  void registerExtension();
  void sendHeartbeat();
  void checkPendingJobs();
});

async function injectPostflowBridgeIntoOpenDashboardTabs(): Promise<void> {
  const stored = await chrome.storage.local.get('clerkUserId');
  // Avoid installing duplicate observers into already-connected dashboard
  // tabs on every service-worker wake-up. We only need the bridge when the
  // user ID has not reached extension storage yet.
  if (typeof stored.clerkUserId === 'string' && stored.clerkUserId.trim()) return;
  const tabs = await chrome.tabs.query({
    url: [
      'http://localhost:3001/*',
      'http://127.0.0.1:3001/*',
      'https://fitcure.online/*',
    ],
  });
  const scriptFile = getBackgroundSiblingScriptFile('postflow-content.js');
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [scriptFile],
      });
    } catch (error) {
      console.warn('[PostFlow] Could not connect an already-open dashboard tab', {
        tabId: tab.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
}

async function requestDashboardAuthContext(): Promise<{ ok: boolean; error?: string }> {
  const dashboardTabs = await chrome.tabs.query({
    url: [
      'http://localhost:3001/*',
      'http://127.0.0.1:3001/*',
      'https://fitcure.online/*',
    ],
  });
  if (!dashboardTabs.length) {
    return {
      ok: false,
      error: 'Open the signed-in PostFlow dashboard in this browser, then try again.',
    };
  }

  // Ensure an already-open dashboard has the bridge after an extension reload,
  // then explicitly ask it to publish its current Clerk user ID.
  await injectPostflowBridgeIntoOpenDashboardTabs();
  let requested = false;
  for (const tab of dashboardTabs) {
    if (tab.id === undefined) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'REFRESH_AUTH_CONTEXT',
      });
      requested = requested || response?.ok === true;
    } catch {
      // A tab may have navigated between query and send; try the remaining tabs.
    }
  }
  if (!requested) {
    return {
      ok: false,
      error: 'The dashboard tab is not ready. Refresh it once, then try again.',
    };
  }

  // The content bridge writes storage asynchronously. Give it a short window
  // to complete before retrying registration immediately.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await getClerkUserId()) {
      await registerExtension();
      return { ok: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    ok: false,
    error: 'The dashboard did not provide a user ID. Confirm that you are signed in and refresh the dashboard.',
  };
}
