// Shared Job Orchestration
// Platform-agnostic job execution flow using platform adapters.

import { apiFetch, updateJobStatus, getExtensionInstanceId, canClaimNewWork, reportWorkerStatus } from './background.js';
import { maskExtensionInstanceId } from './maintenance-diagnostics.js';
import { normalizePublishJob } from './publishing-target.js';
import type { PublishJob } from './publishing-target.js';
import { getPlatformAdapter } from './platforms/registry.js';
import { PLATFORM_FEATURE_FLAGS, isPlatformEnabled } from './posting-config.js';
import { PUBLISHING_STEPS } from './platform-adapter.js';

// Platform-scoped queue pause state
interface PlatformQueuePause {
  platform: string;
  reason: string;
  status?: string;
  jobId?: string;
  pausedAt: number;
}

const platformQueuePauses = new Map<string, PlatformQueuePause>();

let isProcessingJob = false;

export function getPlatformQueuePause(platform: string): PlatformQueuePause | null {
  return platformQueuePauses.get(platform) || null;
}

export function isPlatformQueuePaused(platform: string): boolean {
  return platformQueuePauses.has(platform);
}

export function pausePlatformQueue(platform: string, reason: string, status?: string, jobId?: string): void {
  platformQueuePauses.set(platform, {
    platform,
    reason,
    status,
    jobId,
    pausedAt: Date.now(),
  });
  console.warn(`[PostFlow] ${platform} publishing queue paused`, { reason, status, jobId });
}

export function resumePlatformQueue(platform: string): void {
  platformQueuePauses.delete(platform);
  console.log(`[PostFlow] ${platform} publishing queue resumed`);
}

export async function checkPendingJobs(): Promise<void> {
  // Check if any platform is enabled
  const enabledPlatforms = Object.entries(PLATFORM_FEATURE_FLAGS)
    .filter(([, enabled]) => enabled)
    .map(([platform]) => platform);
  
  if (enabledPlatforms.length === 0) {
    console.log('[PostFlow] No platforms enabled for publishing');
    return;
  }

  // Check if we can claim new work (installation lifecycle)
  if (!(await canClaimNewWork())) {
    return;
  }

  // Check if any platform queue is paused
  const allPaused = enabledPlatforms.every((p) => isPlatformQueuePaused(p));
  if (allPaused) {
    console.warn('[PostFlow] All platform publishing queues are paused; skipping job check');
    return;
  }

  if (isProcessingJob) {
    return;
  }

  isProcessingJob = true;

  try {
    const job = normalizePublishJob(await apiFetch('/api/jobs/next'));
    if (!job) {
      console.log('[PostFlow] No pending jobs');
      return;
    }

    await executeJob(job);
  } finally {
    isProcessingJob = false;
  }
}

async function executeJob(job: PublishJob): Promise<void> {
  const platform = job.platform || 'FACEBOOK';
  
  // Check if platform is enabled
  if (!isPlatformEnabled(platform)) {
    console.warn(`[PostFlow] Platform ${platform} is not enabled for publishing`);
    await updateJobStatus(job.id, { 
      status: 'FAILED', 
      error: `Platform ${platform} publishing is disabled` 
    });
    return;
  }

  // Check if this platform's queue is paused
  if (isPlatformQueuePaused(platform)) {
    console.log(`[PostFlow] Skipping ${platform} job - queue is paused`);
    return;
  }

  // Get the adapter for this platform
  const adapter = getPlatformAdapter(platform);
  if (!adapter) {
    console.error(`[PostFlow] No adapter registered for platform: ${platform}`);
    await updateJobStatus(job.id, { 
      status: 'FAILED', 
      error: `No adapter for platform: ${platform}` 
    });
    return;
  }

  // Validate job before execution
  const validation = adapter.validateJob(job);
  if (!validation.valid) {
    console.error(`[PostFlow] Job validation failed for ${platform}:`, validation.reason);
    await updateJobStatus(job.id, { 
      status: 'FAILED', 
      error: validation.reason || 'Job validation failed' 
    });
    return;
  }

  // Mark job as running
  await updateJobStatus(job.id, { status: 'RUNNING' });

  // Get target URL
  const targetUrl = adapter.getTargetUrl(job);
  if (!targetUrl) {
    await updateJobStatus(job.id, { 
      status: 'FAILED', 
      error: 'Could not determine target URL' 
    });
    return;
  }

  // Verify active account before navigation
  const accountVerification = await adapter.verifyActiveAccount(job);
  if (!accountVerification.verified) {
    const reason = accountVerification.reason || 'Account verification failed';
    console.warn(`[PostFlow] Account verification failed for ${platform}:`, reason);
    
    // Report platform-specific worker status
    await reportPlatformWorkerStatus(platform, 'ACCOUNT_MISMATCH', reason);
    
    // Pause only this platform's queue
    pausePlatformQueue(platform, reason, 'ACCOUNT_MISMATCH', job.id);
    
    await updateJobStatus(job.id, { 
      status: 'FAILED', 
      error: reason 
    });
    return;
  }

  // Open platform tab
  const tab = await openPlatformTab(targetUrl, adapter.allowedHostnames);
  if (!tab?.id) {
    await updateJobStatus(job.id, { status: 'FAILED', error: 'Could not open platform tab' });
    return;
  }

  const tabId = tab.id;

  // Wait for platform page to be ready
  const ready = await adapter.waitForReady(tabId, job);
  if (!ready) {
    await updateJobStatus(job.id, { 
      status: 'FAILED', 
      error: 'Platform page did not finish loading' 
    });
    return;
  }

  // Check for cancellation before execution
  const latestJob = await apiFetch(`/api/jobs/${job.id}`) as { status?: string } | null;
  if (latestJob?.status === 'CANCEL_REQUESTED') {
    console.warn('[PostFlow] Job was canceled before execution:', job.id);
    await updateJobStatus(job.id, { status: 'CANCELED' });
    return;
  }

  // Execute the platform-specific publishing flow
  console.log(`[PostFlow] Executing ${platform} job`, { jobId: job.id, targetType: job.target.type });
  
  const result = await adapter.execute(tabId, job);

  // Handle result
  if (result.success) {
    // When success is true, status is guaranteed to be PUBLISHED, PENDING_APPROVAL, or UNKNOWN
    const successStatus = result.status as 'PUBLISHED' | 'PENDING_APPROVAL' | 'UNKNOWN';
    await updateJobStatus(job.id, {
      status: 'SUCCESS',
      submissionResult: {
        status: successStatus,
        postUrl: result.postUrl,
        reason: result.reason,
      },
    });
  } else {
    // Check if we should pause this platform's queue
    if (result.shouldPauseQueue) {
      pausePlatformQueue(platform, result.reason || 'Platform error', result.detector, job.id);
      await reportPlatformWorkerStatus(platform, mapFailureToWorkerStatus(result.detector), result.reason);
    }

    await updateJobStatus(job.id, {
      status: 'FAILED',
      error: result.reason || 'Publishing failed',
    });
  }
}

async function openPlatformTab(
  url: string,
  allowedHostnames: readonly string[]
): Promise<chrome.tabs.Tab | null> {
  // Verify URL is allowed
  try {
    const parsed = new URL(url);
    const isAllowed = allowedHostnames.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
    );
    if (!isAllowed) {
      console.error('[PostFlow] Refusing to navigate to non-allowlisted URL:', url);
      return null;
    }
  } catch {
    console.error('[PostFlow] Invalid target URL:', url);
    return null;
  }

  // Find existing tab or create new one
  const tabs = await chrome.tabs.query({ url: allowedHostnames.map((h) => `*://${h}/*`) });
  let tab = tabs.find((t) => t.id !== undefined);
  
  if (tab?.id) {
    // Reuse existing tab
    await chrome.tabs.update(tab.id, { url, active: true });
    return tab;
  }

  // Create new tab
  return chrome.tabs.create({ url, active: true });
}

async function reportPlatformWorkerStatus(
  platform: string,
  workerStatus: string,
  reason?: string
): Promise<void> {
  const extensionInstanceId = await getExtensionInstanceId();
  const maskedId = maskExtensionInstanceId(extensionInstanceId);
  
  await chrome.storage.local.set({
    [`${platform.toLowerCase()}WorkerStatus`]: workerStatus,
    [`${platform.toLowerCase()}WorkerReason`]: reason ?? null,
  });
  
  await apiFetch('/api/extensions/platform-status', {
    platform,
    workerStatus,
    ...(reason ? { reason: reason.slice(0, 500) } : {}),
  });
  
  console.log(`[PostFlow] ${platform} worker status reported:`, workerStatus);
}

function mapFailureToWorkerStatus(detector?: string): string {
  switch (detector) {
    case 'TEMPORARY_BLOCK': return 'BLOCKED';
    case 'CAPTCHA_OR_CHALLENGE': return 'CAPTCHA_OR_CHALLENGE';
    case 'CHECKPOINT_OR_VERIFICATION': return 'CHECKPOINT_OR_VERIFICATION';
    case 'LOGIN_REQUIRED': return 'LOGIN_REQUIRED';
    case 'ACCOUNT_MISMATCH': return 'ACCOUNT_MISMATCH';
    default: return 'MANUAL_INTERVENTION_REQUIRED';
  }
}

// Message handler for platform queue resume
export function handlePlatformQueueResume(platform: string): void {
  resumePlatformQueue(platform);
  reportPlatformWorkerStatus(platform, 'IDLE');
  checkPendingJobs();
}