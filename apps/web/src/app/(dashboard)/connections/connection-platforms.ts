import type { FacebookConnection } from "./connections-dashboard";

export interface ConnectionPlatform {
  platform: string;
  connectionId: string | null;
  username: string | null;
  accountId: string | null;
  status: string;
  workerStatus: string;
  sessionDetected: boolean;
}

export interface ExtensionConnection {
  _id: string;
  displayName: string;
  status: string;
  revocationReason?: string | null;
  lastHeartbeat?: string;
  extensionInstanceIdMasked?: string;
  legacyFacebookConnectionId?: string | null;
  accounts: ConnectionPlatform[];
  archivedAt?: string | null;
  archivedByClerkUserId?: string | null;
  archiveReason?: string | null;
}

/** Active tab is the current (not archived or revoked) installation list. */
export function isCurrentConnection(connection: FacebookConnection): boolean {
  const lifecycle = connection.lifecycle ?? connection.installationStatus;
  return !connection.archivedAt && ["ACTIVE", "PAUSED", "REVOKE_PENDING"].includes(lifecycle ?? "");
}

/** Adapt existing installation bindings to the original dashboard presentation. */
export function connectionRows(
  legacy: FacebookConnection[],
  extensions: ExtensionConnection[],
  now = Date.now(),
  includeHistorical = false,
): FacebookConnection[] {
  const rows = extensions.flatMap((extension) => {
    const facebook = legacy.find((item) => item._id === extension.legacyFacebookConnectionId);
    // Archived Facebook records stay in the existing Archived tab, not both tabs.
    if (extension.legacyFacebookConnectionId && !facebook && !includeHistorical) return [];
    const online = extension.status !== "REVOKED" && Boolean(extension.lastHeartbeat &&
      now - new Date(extension.lastHeartbeat).getTime() <= 120_000);
    return [{
      ...facebook,
      _id: facebook?._id ?? extension._id,
      installationId: extension._id,
      platformAccounts: extension.accounts,
      displayName: extension.displayName,
      lifecycle: extension.status,
      revocationReason: extension.revocationReason ?? null,
      installationStatus: extension.status,
      lastHeartbeat: extension.lastHeartbeat,
      extensionInstanceIdMasked: extension.extensionInstanceIdMasked,
      status: facebook?.status ?? "PENDING",
      workerStatus: facebook?.workerStatus ?? "OFFLINE",
      facebookSessionDetected: facebook?.facebookSessionDetected ?? false,
      isOnline: online,
      connectivity: online ? "ONLINE" as const : "OFFLINE" as const,
      legacyFacebookConnectionId: facebook?._id ?? null,
      archivedAt: extension.archivedAt ?? facebook?.archivedAt,
      archivedByClerkUserId: extension.archivedByClerkUserId ?? facebook?.archivedByClerkUserId,
      archiveReason: extension.archiveReason ?? facebook?.archiveReason,
    }];
  });
  // Historical/revoked records must not leak into Active or its summary counts.
  return [...rows, ...legacy.filter((item) => !extensions.some((extension) =>
    extension.legacyFacebookConnectionId === item._id))].filter((row) => includeHistorical || isCurrentConnection(row));
}

export function connectionActionPath(connection: FacebookConnection, action: string): string {
  const useInstallation = connection.installationId &&
    (["force-disconnect", "remove"].includes(action) || (!connection.archivedAt &&
      !["REVOKED", "REVOKE_PENDING"].includes(connection.lifecycle ?? "") &&
      ["rename", "pause", "resume", "disconnect"].includes(action)));
  const base = useInstallation
    ? `/api/extensions/browser-connections/${connection.installationId}`
    : `/api/extensions/connections/${connection._id}`;
  return action === "rename" || (action === "remove" && !useInstallation) ? base : `${base}/${action}`;
}
