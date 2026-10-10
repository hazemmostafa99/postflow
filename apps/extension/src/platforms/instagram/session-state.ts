export type InstagramSessionState = 'VERIFIED' | 'CHECKING' | 'LOGIN_REQUIRED' | 'ACCOUNT_MISMATCH' | 'STALE';
export type InstagramSessionEvidence = {
  evidenceState: 'VERIFIED' | 'CHECKING' | 'LOGIN_REQUIRED';
  /** Stable Instagram account id (normally read from the ds_user_id cookie). */
  externalAccountId?: string;
  /** Legacy fallback only. New sessions should not persist a username. */
  externalUsername?: string;
  source: string;
  url: string;
};
export type InstagramSessionSnapshot = {
  state: InstagramSessionState;
  externalAccountId?: string;
  /** Kept only to read/migrate older snapshots. */
  username?: string;
  verifiedAt?: number;
  source?: string;
  tabId?: number;
  documentId?: string;
};
// A snapshot is only a local cache. Publishing still asks the current
// Instagram document for fresh evidence; this window prevents ordinary tab
// loads from making the connection flap between CONNECTED and LOGIN_REQUIRED.
export const INSTAGRAM_SESSION_MAX_AGE_MS = 5 * 60_000;

export function isFreshInstagramSession(snapshot: InstagramSessionSnapshot | undefined, now = Date.now()): boolean {
  return snapshot?.state === 'VERIFIED' && typeof snapshot.verifiedAt === 'number'
    && now >= snapshot.verifiedAt && now - snapshot.verifiedAt <= INSTAGRAM_SESSION_MAX_AGE_MS;
}

export function applyInstagramEvidence(
  previous: InstagramSessionSnapshot | undefined,
  evidence: InstagramSessionEvidence,
  tabId: number,
  documentId: string | undefined,
  now = Date.now(),
): InstagramSessionSnapshot {
  if (evidence.evidenceState === 'CHECKING') {
    // Unknown/loading observations are not negative authentication evidence.
    if (isFreshInstagramSession(previous, now) || previous?.state === 'LOGIN_REQUIRED' || previous?.state === 'ACCOUNT_MISMATCH') return previous!;
    return { ...previous, state: previous?.verifiedAt ? 'STALE' : 'CHECKING' };
  }
  if (evidence.evidenceState === 'LOGIN_REQUIRED') return { state: 'LOGIN_REQUIRED', tabId, documentId };
  return {
    state: 'VERIFIED',
    ...(evidence.externalAccountId ? { externalAccountId: evidence.externalAccountId } : {}),
    // Do not add a username to new snapshots when the stable account id is
    // available. The fallback keeps old installations publishable during the
    // one-time migration to cookie-backed identity.
    ...(!evidence.externalAccountId && evidence.externalUsername
      ? { username: evidence.externalUsername.toLowerCase() }
      : {}),
    verifiedAt: now,
    source: evidence.source,
    tabId,
    documentId,
  };
}
