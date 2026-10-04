/** The scheduler's initial spread is intentionally small so a newly started
 * extension does not make every installation wake the API at the same time. */
export const MAINTENANCE_STARTUP_JITTER_MAX_MS = 2 * 60 * 1000;

/**
 * Return a stable 0..2 minute offset for one extension instance.
 *
 * The instance ID is persisted for the lifetime of an installation, so the
 * same profile keeps the same wake slot across service-worker restarts while
 * different profiles are distributed across the two-minute window.
 */
export function getMaintenanceStartupJitterMs(extensionInstanceId: string): number {
  let hash = 2166136261;
  for (const character of extensionInstanceId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % (MAINTENANCE_STARTUP_JITTER_MAX_MS + 1);
}

export function getMaintenanceAlarmFirstRunAt(
  extensionInstanceId: string,
  now = Date.now(),
): number {
  return now + getMaintenanceStartupJitterMs(extensionInstanceId);
}
