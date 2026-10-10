import { maskExtensionInstanceId } from './installation-credential';

export interface BrowserAccount {
  platform: string;
  connectionId: string | null;
  username: string | null;
  accountId: string | null;
  status: string;
  workerStatus: string;
  sessionDetected: boolean;
}

interface Installation {
  _id: unknown;
  displayName?: unknown;
  status?: unknown;
  lastHeartbeat?: unknown;
  facebookConnectionId?: unknown;
  extensionInstanceId?: unknown;
  archivedAt?: unknown;
  archivedByClerkUserId?: unknown;
  archiveReason?: unknown;
}
interface SocialConnection {
  _id?: unknown;
  activeExtensionInstallationId?: unknown;
  displayName?: unknown;
  platform?: unknown;
  externalUsername?: unknown;
  externalAccountId?: unknown;
  facebookUserId?: unknown;
  status?: unknown;
  workerStatus?: unknown;
  facebookSessionDetected?: unknown;
  sessionDetected?: unknown;
}

/** Group only by the explicit installation binding, never by name or username. */
export function groupBrowserConnections(
  installations: Installation[],
  facebook: SocialConnection[],
  platforms: SocialConnection[],
  includeRevoked = false,
) {
  return installations.filter((installation) => includeRevoked || installation.status !== 'REVOKED').map((installation) => {
    const id = String(installation._id);
    const extensionInstanceId = typeof installation.extensionInstanceId === 'string'
      ? installation.extensionInstanceId.trim()
      : '';
    const extensionInstanceIdMasked = extensionInstanceId
      ? maskExtensionInstanceId(extensionInstanceId)
      : '';
    const fb = facebook.find((connection) => String(connection.activeExtensionInstallationId ?? '') === id ||
      (!connection.activeExtensionInstallationId && String(connection._id) === String(installation.facebookConnectionId ?? '')));
    const accounts: BrowserAccount[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'].map((platform) => {
      const connection = platform === 'FACEBOOK' ? fb : platforms.find((candidate) =>
        candidate.platform === platform && String(candidate.activeExtensionInstallationId ?? '') === id);
      return {
        platform,
        connectionId: connection ? String(connection._id) : null,
        username: connection?.externalUsername ? String(connection.externalUsername) : null,
        accountId: connection?.facebookUserId || connection?.externalAccountId ? String(connection.facebookUserId ?? connection.externalAccountId) : null,
        status: String(connection?.status ?? 'NOT_DETECTED'),
        workerStatus: String(connection?.workerStatus ?? 'OFFLINE'),
        sessionDetected: Boolean(connection?.facebookSessionDetected ?? connection?.sessionDetected),
      };
    });
    const displayName = [installation.displayName, fb?.displayName]
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .find(Boolean) || extensionInstanceIdMasked || id;
    return {
      _id: id,
      installationId: id,
      displayName,
      extensionInstanceIdMasked: extensionInstanceIdMasked || 'missing',
      status: installation.status,
      lastHeartbeat: installation.lastHeartbeat,
      archivedAt: installation.archivedAt ?? null,
      archivedByClerkUserId: installation.archivedByClerkUserId ?? null,
      archiveReason: installation.archiveReason ?? null,
      legacyFacebookConnectionId: fb?._id ?? null,
      accounts,
    };
  });
}
