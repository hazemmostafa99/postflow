export type RecoveryCandidate = {
  connectionId: string;
  displayName?: string;
  facebookUserId?: string;
  activeInstallationOnline: boolean;
};

/** Keep only the non-sensitive fields the recovery UI is allowed to render. */
export function normalizeRecoveryCandidates(value: unknown): RecoveryCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.connectionId !== 'string' || !item.connectionId.trim()) {
      return [];
    }
    return [{
      connectionId: item.connectionId.trim(),
      ...(typeof item.displayName === 'string' && item.displayName.trim()
        ? { displayName: item.displayName.trim() }
        : {}),
      ...(typeof item.facebookUserId === 'string' && item.facebookUserId.trim()
        ? { facebookUserId: item.facebookUserId.trim() }
        : {}),
      activeInstallationOnline: item.activeInstallationOnline === true,
    }];
  });
}

export function recoveryCandidateLabel(candidate: RecoveryCandidate): string {
  if (candidate.displayName?.trim()) return candidate.displayName.trim();
  if (candidate.facebookUserId) {
    return `Facebook account ending ${candidate.facebookUserId.slice(-4)}`;
  }
  return 'Previous connection';
}

export function reconnectNeedsConfirmation(candidate: RecoveryCandidate): boolean {
  return candidate.activeInstallationOnline;
}
