export type MaintenanceWorkType = 'PENDING_APPROVAL' | 'ENGAGEMENT';

export type MaintenanceMetricName =
  | 'claimRequests'
  | 'claimsCreated'
  | 'emptyClaims'
  | 'leaseConflicts'
  | 'leaseExpirations'
  | 'ownershipRejections'
  | 'resultSuccesses'
  | 'resultFailures';

export type MaintenanceWorkCounters = Record<MaintenanceMetricName, number>;

export type MaintenanceDiagnosticsSnapshot = {
  version: 1;
  updatedAt: string;
  counters: Record<MaintenanceWorkType, MaintenanceWorkCounters>;
};

const EMPTY_COUNTERS: MaintenanceWorkCounters = {
  claimRequests: 0,
  claimsCreated: 0,
  emptyClaims: 0,
  leaseConflicts: 0,
  leaseExpirations: 0,
  ownershipRejections: 0,
  resultSuccesses: 0,
  resultFailures: 0,
};

export function createMaintenanceDiagnosticsSnapshot(
  now = new Date(),
): MaintenanceDiagnosticsSnapshot {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    counters: {
      PENDING_APPROVAL: { ...EMPTY_COUNTERS },
      ENGAGEMENT: { ...EMPTY_COUNTERS },
    },
  };
}

export function isMaintenanceDiagnosticsSnapshot(
  value: unknown,
): value is MaintenanceDiagnosticsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<MaintenanceDiagnosticsSnapshot>;
  return (
    snapshot.version === 1 &&
    Boolean(snapshot.counters?.PENDING_APPROVAL) &&
    Boolean(snapshot.counters?.ENGAGEMENT)
  );
}

export function incrementMaintenanceMetric(
  snapshot: MaintenanceDiagnosticsSnapshot,
  workType: MaintenanceWorkType,
  metric: MaintenanceMetricName,
  now = new Date(),
): number {
  const nextValue = (snapshot.counters[workType][metric] ?? 0) + 1;
  snapshot.counters[workType][metric] = nextValue;
  snapshot.updatedAt = now.toISOString();
  return nextValue;
}

/** Show enough of an instance ID to correlate logs without exposing it. */
export function maskExtensionInstanceId(value?: string | null): string {
  const normalized = value?.trim();
  if (!normalized) return 'missing';
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}…${normalized.slice(-2)}`;
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}
