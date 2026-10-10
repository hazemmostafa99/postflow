"use client";

import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  CircleDotDashed,
  Clock3,
  Link2,
  Loader2,
  Monitor,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Power,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopbarPortal } from "@/components/topbar-portal";
import { connectionRows, connectionActionPath, isCurrentConnection, type ConnectionPlatform, type ExtensionConnection } from "./connection-platforms";
import { PlatformDetails } from "./platform-details";

export interface FacebookConnection {
  _id: string;
  installationId?: string;
  legacyFacebookConnectionId?: string | null;
  platformAccounts?: ConnectionPlatform[];
  extensionInstanceId?: string;
  extensionInstanceIdMasked?: string;
  activeExtensionInstallationId?: string | null;
  displayName?: string;
  facebookUserId?: string;
  detectedFacebookUserId?: string;
  status: string;
  workerStatus: string;
  lifecycle?: string | null;
  installationStatus?: string | null;
  facebookSessionDetected: boolean;
  lastSeenAt?: string;
  lastHeartbeat?: string;
  isOnline?: boolean;
  connectivity?: "ONLINE" | "OFFLINE";
  connectivityReason?: string;
  archivedAt?: string | null;
  archivedByClerkUserId?: string | null;
  archiveReason?: string | null;
  hasPendingReconnectApproval?: boolean;
}

export type OperationalState = "READY" | "PUBLISHING" | "ATTENTION" | "OFFLINE" | "SETUP";
export type ConnectionFilter = "ALL" | "READY" | "PUBLISHING" | "ATTENTION" | "OFFLINE";
export type LifecycleStatus = "ACTIVE" | "PAUSED" | "REVOKE_PENDING" | "REVOKED";
type DashboardView = "ACTIVE" | "ARCHIVED";

export interface ConnectionView {
  connection: FacebookConnection;
  state: OperationalState;
  stateLabel: string;
  message: string;
  lifecycle: LifecycleStatus | null;
  lifecycleLabel: string;
  lifecycleMessage: string;
  lastActivity?: string;
  lastActivityAt: number;
}

export type LifecycleAction = "rename" | "pause" | "resume" | "disconnect" | "force-disconnect" | "remove" | "restore";

const OFFLINE_AFTER_MS = 2 * 60 * 1000;

const STATE_PRIORITY: Record<OperationalState, number> = {
  ATTENTION: 0,
  OFFLINE: 1,
  SETUP: 2,
  PUBLISHING: 3,
  READY: 4,
};

const STATE_STYLES: Record<OperationalState, string> = {
  READY: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PUBLISHING: "border-blue-200 bg-blue-50 text-blue-700",
  ATTENTION: "border-red-200 bg-red-50 text-red-700",
  OFFLINE: "border-border bg-muted text-muted-foreground",
  SETUP: "border-amber-200 bg-amber-50 text-amber-700",
};

const LIFECYCLE_STYLES: Record<LifecycleStatus, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PAUSED: "border-blue-200 bg-blue-50 text-blue-700",
  REVOKE_PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  REVOKED: "border-red-200 bg-red-50 text-red-700",
};

const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  REVOKE_PENDING: "Disconnecting",
  REVOKED: "Disconnected",
};

const LIFECYCLE_MESSAGES: Record<LifecycleStatus, string> = {
  ACTIVE: "This connection can claim new publishing and maintenance work.",
  PAUSED: "Paused from the dashboard. In-flight jobs finish; no new work is claimed until you resume.",
  REVOKE_PENDING: "Graceful disconnect in progress. The current job finishes, then the extension stops.",
  REVOKED: "Disconnected. Worker APIs are blocked and the local credential is invalidated.",
};

const FILTER_OPTIONS: Array<{ value: ConnectionFilter; label: string }> = [
  { value: "ALL", label: "All connections" },
  { value: "READY", label: "Ready" },
  { value: "PUBLISHING", label: "Publishing" },
  { value: "ATTENTION", label: "Needs attention" },
  { value: "OFFLINE", label: "Offline" },
];

const BACKEND_UNAVAILABLE_MESSAGE =
  "The connections service is unavailable. Nothing changed — try again in a moment.";

export function normalizeLifecycle(connection: FacebookConnection): LifecycleStatus | null {
  const raw = (connection.lifecycle ?? connection.installationStatus ?? "").toUpperCase();
  if (raw === "ACTIVE" || raw === "PAUSED" || raw === "REVOKE_PENDING" || raw === "REVOKED") {
    return raw;
  }
  // Legacy installations without a lifecycle field behave like ACTIVE until
  // the next register issues a credential.
  return connection.extensionInstanceId ? "ACTIVE" : null;
}

function newestActivity(connection: FacebookConnection): { value?: string; timestamp: number } {
  const values = [connection.lastSeenAt, connection.lastHeartbeat]
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: new Date(value).getTime() }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);

  return values[0] ?? { timestamp: 0 };
}

export function getConnectionView(connection: FacebookConnection, now: number): ConnectionView {
  const activity = newestActivity(connection);
  const rawStatus = connection.status?.toUpperCase();
  const workerStatus = connection.workerStatus?.toUpperCase();
  const offline = typeof connection.isOnline === "boolean"
    ? !connection.isOnline
    : !activity.timestamp || now - activity.timestamp > OFFLINE_AFTER_MS;
  const lifecycle = normalizeLifecycle(connection);
  const base = {
    connection,
    lastActivity: activity.value,
    lastActivityAt: activity.timestamp,
    lifecycle,
    lifecycleLabel: lifecycle ? LIFECYCLE_LABELS[lifecycle] : "Active",
    lifecycleMessage: lifecycle ? LIFECYCLE_MESSAGES[lifecycle] : LIFECYCLE_MESSAGES.ACTIVE,
  };

  // Administrative lifecycle wins over operational health when the extension
  // is disconnected: worker APIs are blocked regardless of Facebook state.
  if (lifecycle === "REVOKED") {
    return {
      ...base,
      state: "ATTENTION",
      stateLabel: "Disconnected",
      message: "This extension is disconnected. Restore it from Archived connections or remove it.",
    };
  }

  if (offline || rawStatus === "DISCONNECTED") {
    const offlineMessage = connection.connectivityReason
      ? `${connection.connectivityReason} Open this Chrome profile to reconnect iPostFlow.`
      : "Open this Chrome profile to reconnect iPostFlow.";
    return { ...base, state: "OFFLINE", stateLabel: "Offline", message: offlineMessage };
  }

  if (connection.platformAccounts) {
    const accounts = connection.platformAccounts.filter((account) => account.connectionId);
    if (accounts.some((account) => account.workerStatus === "PUBLISHING")) {
      return { ...base, state: "PUBLISHING", stateLabel: "Publishing", message: "This extension is processing a publishing job." };
    }
    if (accounts.some((account) => account.status === "CONNECTED" && account.sessionDetected && ["IDLE", "ONLINE", "READY"].includes(account.workerStatus))) {
      return { ...base, state: "READY", stateLabel: "Ready", message: "Connected and available for publishing. See platform details for individual account health." };
    }
    return accounts.length
      ? { ...base, state: "ATTENTION", stateLabel: "Needs attention", message: "Check the platform details below for login or verification requirements." }
      : { ...base, state: "SETUP", stateLabel: "Setup incomplete", message: "Sign in to a platform in this Chrome profile to detect its account." };
  }

  if (rawStatus === "ACCOUNT_MISMATCH" || workerStatus === "ACCOUNT_MISMATCH") {
    return { ...base, state: "ATTENTION", stateLabel: "Account mismatch", message: "The signed-in Facebook account does not match this connection." };
  }

  if (rawStatus === "BLOCKED" || workerStatus === "BLOCKED") {
    return { ...base, state: "ATTENTION", stateLabel: "Facebook blocked", message: "Facebook stopped this worker. Review the account before publishing." };
  }

  if (rawStatus === "LOGIN_REQUIRED" || workerStatus === "LOGIN_REQUIRED") {
    return { ...base, state: "ATTENTION", stateLabel: "Login required", message: "Sign in to Facebook in this Chrome profile." };
  }

  if (workerStatus === "CHECKPOINT_OR_VERIFICATION") {
    return { ...base, state: "ATTENTION", stateLabel: "Verification required", message: "Complete Facebook verification in this Chrome profile." };
  }

  if (workerStatus === "CAPTCHA_OR_CHALLENGE") {
    return { ...base, state: "ATTENTION", stateLabel: "Challenge required", message: "Complete the Facebook challenge before publishing continues." };
  }

  if (workerStatus === "MANUAL_INTERVENTION_REQUIRED") {
    return { ...base, state: "ATTENTION", stateLabel: "Action required", message: "Open Facebook in this Chrome profile and resolve the interruption." };
  }

  if (workerStatus === "PUBLISHING") {
    return { ...base, state: "PUBLISHING", stateLabel: "Publishing", message: "This account is processing a publishing job." };
  }

  const identityMatches = Boolean(
    connection.facebookUserId &&
      connection.detectedFacebookUserId &&
      connection.facebookUserId === connection.detectedFacebookUserId,
  );

  if (rawStatus !== "CONNECTED" || !connection.facebookSessionDetected || !identityMatches) {
    return { ...base, state: "SETUP", stateLabel: "Setup incomplete", message: "Open Facebook with the extension to verify this account." };
  }

  return { ...base, state: "READY", stateLabel: "Ready", message: "Connected and available for publishing." };
}

export function availableActions(connection: FacebookConnection): LifecycleAction[] {
  const lifecycle = normalizeLifecycle(connection);
  if (connection.installationId && connection.legacyFacebookConnectionId === null) {
    if (connection.archivedAt) return [];
    if (lifecycle === "REVOKED") return ["remove"];
    if (lifecycle === "REVOKE_PENDING") return ["force-disconnect", "remove"];
    return lifecycle === "PAUSED" ? ["rename", "resume", "disconnect", "force-disconnect", "remove"] : ["rename", "pause", "disconnect", "force-disconnect", "remove"];
  }
  if (connection.archivedAt) return ["rename", "restore"];
  if (lifecycle === "REVOKED") return ["rename", "remove"];
  if (lifecycle === "REVOKE_PENDING") return ["rename", "force-disconnect"];
  if (lifecycle === "PAUSED") return ["rename", "resume", "disconnect", "force-disconnect", "remove"];
  return ["rename", "pause", "disconnect", "force-disconnect", "remove"];
}

export interface ConfirmSpec {
  title: string;
  description: string;
  effects: string[];
  confirmLabel: string;
  destructive: boolean;
  typedConfirmation?: string;
}

export function getConfirmSpec(action: Exclude<LifecycleAction, "rename" | "restore">): ConfirmSpec {
  switch (action) {
    case "pause":
      return {
        title: "Pause this connection?",
        description: "The extension keeps its connection but stops taking new work.",
        effects: [
          "New publishing and maintenance claims stop immediately.",
          "Jobs already leased keep running and report their results normally.",
          "Queued jobs stay queued and wait for this or another connection.",
          "You can resume at any time from this dashboard.",
        ],
        confirmLabel: "Pause connection",
        destructive: false,
      };
    case "resume":
      return {
        title: "Resume this connection?",
        description: "The extension may claim new work again.",
        effects: [
          "Publishing and maintenance claims are allowed again.",
          "Queued jobs may start as soon as the extension checks in.",
        ],
        confirmLabel: "Resume connection",
        destructive: false,
      };
    case "disconnect":
      return {
        title: "Disconnect gracefully?",
        description: "The extension finishes its current task, then stops.",
        effects: [
          "New claims stop immediately.",
          "The current job, if any, finishes before the connection goes offline.",
          "Queued jobs stay queued — nothing is cancelled.",
          "The installation cannot reconnect without a new approval.",
        ],
        confirmLabel: "Disconnect",
        destructive: false,
      };
    case "force-disconnect":
      return {
        title: "Force disconnect now?",
        description: "This revokes the installation immediately.",
        effects: [
          "Worker APIs are blocked right away, even mid-task.",
          "An in-flight job result may be rejected; the job stays queued or retried.",
          "Queued jobs stay queued — nothing is cancelled.",
          "The local credential is invalidated; reconnecting needs a new approval.",
        ],
        confirmLabel: "Force disconnect",
        destructive: true,
        typedConfirmation: "FORCE",
      };
    case "remove":
      return {
        title: "Remove from Connections?",
        description: "The connection is archived, not deleted.",
        effects: [
          "Ownership, history, and audit records are kept.",
          "The extension loses access to worker APIs.",
          "Queued jobs stay queued and wait for another connection.",
          "You can restore it later from Archived connections.",
        ],
        confirmLabel: "Remove connection",
        destructive: true,
      };
  }
}

function accountName(connection: FacebookConnection): string {
  if (connection.displayName?.trim()) return connection.displayName.trim();
  const extensionId = connection.extensionInstanceIdMasked?.trim() || connection.extensionInstanceId?.trim();
  if (extensionId) return extensionId;
  if (connection.facebookUserId) return `Facebook account ••••${connection.facebookUserId.slice(-4)}`;
  return "Unnamed Facebook connection";
}

function accountIdentity(connection: FacebookConnection): string {
  return connection.facebookUserId
    ? `Facebook ID ending ${connection.facebookUserId.slice(-4)}`
    : "Facebook identity not verified";
}

function browserLabel(connection: FacebookConnection): string {
  return connection.installationId || connection.extensionInstanceId ? "iPostFlow extension connected" : "Legacy installation";
}

function maskedId(connection: FacebookConnection): string {
  const value = connection.extensionInstanceIdMasked || connection.extensionInstanceId;
  if (!value) return "Not available";
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function statusLabel(value?: string): string {
  if (!value) return "Unknown";
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeTime(value: string | undefined, now: number): string {
  if (!value) return "Never";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function exactDate(value?: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function StateIcon({ state, className = "h-5 w-5" }: { state: OperationalState; className?: string }) {
  if (state === "READY") return <CheckCircle2 className={`${className} text-emerald-600`} />;
  if (state === "PUBLISHING") return <Radio className={`${className} text-blue-600`} />;
  if (state === "ATTENTION") return <AlertTriangle className={`${className} text-red-600`} />;
  if (state === "SETUP") return <CircleDotDashed className={`${className} text-amber-600`} />;
  return <WifiOff className={`${className} text-muted-foreground`} />;
}

export function matchesFilter(view: ConnectionView, filter: ConnectionFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "READY") {
    // Paused or disconnecting connections are not "ready" even when Facebook
    // health is fine — they cannot claim new work.
    const claimable = view.lifecycle === null || view.lifecycle === "ACTIVE";
    return view.state === "READY" && claimable;
  }
  if (filter === "ATTENTION") return view.state === "ATTENTION" || view.state === "SETUP" || view.state === "OFFLINE";
  return view.state === filter;
}

async function callConnectionApi(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, data: { error: BACKEND_UNAVAILABLE_MESSAGE } };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

function actionErrorMessage(result: { status: number; data: Record<string, unknown> }): string {
  const backendError = typeof result.data.error === "string" ? result.data.error : null;
  if (result.status === 0) return BACKEND_UNAVAILABLE_MESSAGE;
  if (result.status === 409) return backendError ?? "This connection changed in another tab. Refresh and try again.";
  if (result.status === 403 || result.status === 404) return backendError ?? "This connection is no longer available.";
  if (result.status >= 500) return BACKEND_UNAVAILABLE_MESSAGE;
  return backendError ?? "The action could not be completed.";
}

function sendReconnectApprovalToExtension(payload: {
  connectionId: string;
  approvalToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("postflow:reconnect-result", onResult);
      resolve({
        ok: false,
        error: "The extension did not respond. Open this dashboard in the Chrome Profile you want to reconnect, then try again.",
      });
    }, 8_000);
    function onResult(event: Event) {
      const detail = (event as CustomEvent).detail as Record<string, unknown> | null;
      if (detail?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("postflow:reconnect-result", onResult);
      resolve({
        ok: detail.ok === true,
        ...(typeof detail.error === "string" ? { error: detail.error } : {}),
      });
    }
    window.addEventListener("postflow:reconnect-result", onResult);
    window.dispatchEvent(new CustomEvent("postflow:reconnect-approval", {
      detail: { requestId, ...payload },
    }));
  });
}

interface ConnectionsDashboardProps {
  connections: FacebookConnection[];
  unavailable: boolean;
  refreshedAt: string;
  scopeConnectionId?: string;
  extensionConnections?: ExtensionConnection[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "rename"; connection: FacebookConnection }
  | { kind: "confirm"; connection: FacebookConnection; action: Exclude<LifecycleAction, "rename" | "restore"> };

export function ConnectionsDashboard({
  connections: initialConnections,
  unavailable: initiallyUnavailable,
  refreshedAt,
  scopeConnectionId,
  extensionConnections,
}: ConnectionsDashboardProps) {
  const [connections, setConnections] = useState(() => extensionConnections ? connectionRows(initialConnections, extensionConnections) : initialConnections.filter(isCurrentConnection));
  const [unavailable, setUnavailable] = useState(initiallyUnavailable);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(refreshedAt);
  const [filter, setFilter] = useState<ConnectionFilter>("ALL");
  const [query, setQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dashboardView, setDashboardView] = useState<DashboardView>("ACTIVE");
  const [archived, setArchived] = useState<FacebookConnection[] | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const now = new Date(lastRefreshedAt).getTime();

  const refresh = useCallback(async (showSpinner = true) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const [response, platformsResponse] = await Promise.all([
        fetch("/api/extensions/connections", { cache: "no-store" }),
        fetch("/api/extensions/browser-connections", { cache: "no-store" }),
      ]);
      const data: unknown = await response.json();
      const extensions: unknown = await platformsResponse.json();
      if (!response.ok || !Array.isArray(data) || !platformsResponse.ok || !Array.isArray(extensions)) {
        setUnavailable(true);
        return;
      }
      setConnections(connectionRows(data as FacebookConnection[], extensions as ExtensionConnection[]).filter((connection) => !scopeConnectionId || connection._id === scopeConnectionId));
      setUnavailable(false);
      setLastRefreshedAt(new Date().toISOString());
    } catch {
      setUnavailable(true);
    } finally {
      if (showSpinner) setIsRefreshing(false);
    }
  }, [scopeConnectionId]);

  const refreshArchived = useCallback(async () => {
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const responses = await Promise.all([
        fetch("/api/extensions/connections/archived", { cache: "no-store" }),
        fetch("/api/extensions/connections", { cache: "no-store" }),
        fetch("/api/extensions/browser-connections", { cache: "no-store" }),
      ]);
      const [data, active, extensions] = await Promise.all(responses.map((response) => response.json()));
      if (responses.some((response) => !response.ok) || ![data, active, extensions].every(Array.isArray)) {
        setArchivedError("Archived connections could not be loaded.");
        return;
      }
      setArchived(connectionRows([...data, ...active] as FacebookConnection[], extensions as ExtensionConnection[], Date.now(), true)
        .filter((connection) => connection.archivedAt && (!scopeConnectionId || connection._id === scopeConnectionId)));
    } catch {
      setArchivedError(BACKEND_UNAVAILABLE_MESSAGE);
    } finally {
      setArchivedLoading(false);
    }
  }, [scopeConnectionId]);

  const hasPendingTransition = useMemo(
    () => connections.some((connection) => normalizeLifecycle(connection) === "REVOKE_PENDING"),
    [connections],
  );

  useEffect(() => {
    // Keep the list fresh while setup completes, and keep polling while a
    // graceful disconnect is pending so the transition resolves without a
    // full page reload.
    const refreshInterval = window.setInterval(() => {
      void refresh(false);
    }, 3_000);
    const stopRefresh = hasPendingTransition
      ? undefined
      : window.setTimeout(() => {
          window.clearInterval(refreshInterval);
        }, 60_000);

    return () => {
      window.clearInterval(refreshInterval);
      if (stopRefresh !== undefined) window.clearTimeout(stopRefresh);
    };
  }, [refresh, hasPendingTransition]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const views = useMemo(
    () => connections.map((connection) => getConnectionView(connection, now)),
    [connections, now],
  );

  const counts = useMemo(() => ({
    total: views.length,
    ready: views.filter((item) => matchesFilter(item, "READY")).length,
    publishing: views.filter((item) => matchesFilter(item, "PUBLISHING")).length,
    attention: views.filter((item) => matchesFilter(item, "ATTENTION")).length,
    offline: views.filter((item) => matchesFilter(item, "OFFLINE")).length,
  }), [views]);

  const visibleConnections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return views
      .filter((item) => matchesFilter(item, filter))
      .filter(({ connection, lifecycleLabel }) => {
        if (!normalizedQuery) return true;
        return [
          accountName(connection),
          connection.facebookUserId,
          connection.extensionInstanceId,
          connection.extensionInstanceIdMasked,
          ...(connection.platformAccounts ?? []).flatMap((account) => [account.platform, account.username, account.status]),
          statusLabel(connection.status),
          statusLabel(connection.workerStatus),
          lifecycleLabel,
        ].some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => (
        STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] ||
        b.lastActivityAt - a.lastActivityAt ||
        accountName(a.connection).localeCompare(accountName(b.connection))
      ));
  }, [filter, query, views]);

  const visibleArchived = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!archived) return [];
    return archived
      .filter((connection) => (
        !normalizedQuery ||
        [accountName(connection), connection.facebookUserId, connection.extensionInstanceId]
          .some((value) => value?.toLowerCase().includes(normalizedQuery))
      ))
      .sort((a, b) => new Date(b.archivedAt ?? 0).getTime() - new Date(a.archivedAt ?? 0).getTime());
  }, [archived, query]);

  const openRename = useCallback((connection: FacebookConnection) => {
    setRenameValue(connection.displayName ?? "");
    setDialogError(null);
    setDialog({ kind: "rename", connection });
  }, []);

  const openConfirm = useCallback((
    connection: FacebookConnection,
    action: Exclude<LifecycleAction, "rename" | "restore">,
  ) => {
    setDialogError(null);
    setDialog({ kind: "confirm", connection, action });
  }, []);

  const closeDialog = useCallback(() => {
    if (dialogBusy) return;
    setDialog({ kind: "none" });
    setDialogError(null);
  }, [dialogBusy]);

  const handleAction = useCallback((connection: FacebookConnection, action: LifecycleAction) => {
    if (action === "rename") {
      openRename(connection);
      return;
    }
    if (action === "restore") {
      void (async () => {
        setArchivedError(null);
        const result = await callConnectionApi(
          `/api/extensions/connections/${connection._id}/reconnect-approval`,
          { method: "POST" },
        );
        if (!result.ok) {
          setArchivedError(actionErrorMessage(result));
          return;
        }
        const approvalToken = typeof result.data.approvalToken === "string"
          ? result.data.approvalToken
          : "";
        if (!approvalToken) {
          setArchivedError("The backend did not return a reconnect approval. Nothing changed.");
          return;
        }
        const extensionResult = await sendReconnectApprovalToExtension({
          connectionId: connection._id,
          approvalToken,
        });
        if (!extensionResult.ok) {
          setArchivedError(extensionResult.error ?? "The extension could not restore this connection.");
          return;
        }
        setNotice(`Restored “${accountName(connection)}” in this Chrome Profile.`);
        void refresh(false);
        void refreshArchived();
      })();
      return;
    }
    openConfirm(connection, action);
  }, [openConfirm, openRename, refresh, refreshArchived]);

  const submitRename = useCallback(async () => {
    if (dialog.kind !== "rename") return;
    const name = renameValue.trim();
    if (!name) {
      setDialogError("Enter a name for this connection.");
      return;
    }
    setDialogBusy(true);
    setDialogError(null);
    const result = await callConnectionApi(
      connectionActionPath(dialog.connection, "rename"),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(actionErrorMessage(result));
      return;
    }
    setDialog({ kind: "none" });
    setNotice(`Renamed to “${name}”.`);
    void refresh(false);
  }, [dialog, renameValue, refresh]);

  const submitConfirm = useCallback(async () => {
    if (dialog.kind !== "confirm") return;
    const { connection, action } = dialog;
    const spec = getConfirmSpec(action);
    setDialogBusy(true);
    setDialogError(null);

    let result: { ok: boolean; status: number; data: Record<string, unknown> };
    if (action === "remove") {
      result = await callConnectionApi(connectionActionPath(connection, action), {
        method: connection.installationId ? "POST" : "DELETE",
      });
    } else {
      result = await callConnectionApi(
        connectionActionPath(connection, action),
        { method: "POST" },
      );
    }
    setDialogBusy(false);

    if (!result.ok) {
      setDialogError(actionErrorMessage(result));
      return;
    }
    setDialog({ kind: "none" });
    setNotice(`${spec.title.replace(/[?]$/, "")} — done.`);
    void refresh(false);
    if (dashboardView === "ARCHIVED") void refreshArchived();
  }, [dialog, refresh, dashboardView, refreshArchived]);

  const searchAndFilter = (
    <TopbarPortal>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
        <div className="relative min-w-0 sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search connections"
            aria-label="Search connections"
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        {dashboardView === "ACTIVE" && (
          <>
            <label className="sr-only" htmlFor="connection-status-filter">Filter by connection status</label>
            <select
              id="connection-status-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ConnectionFilter)}
              className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-w-40"
            >
              {FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            void refresh();
            if (dashboardView === "ARCHIVED") void refreshArchived();
          }}
          disabled={isRefreshing}
          className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-1"
        >
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>
    </TopbarPortal>
  );

  return (
    <div className="page-shell">
      {searchAndFilter}

      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{notice}</p>
        </div>
      )}

      <div className="flex items-center gap-2" role="tablist" aria-label="Connections view">
        <button
          type="button"
          role="tab"
          aria-selected={dashboardView === "ACTIVE"}
          onClick={() => setDashboardView("ACTIVE")}
          className={`h-9 rounded-lg border px-3 text-xs font-medium transition-colors ${dashboardView === "ACTIVE" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-accent"}`}
        >
          Active connections
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={dashboardView === "ARCHIVED"}
          onClick={() => {
            setDashboardView("ARCHIVED");
            if (archived === null && !archivedLoading) void refreshArchived();
          }}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${dashboardView === "ARCHIVED" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-accent"}`}
        >
          <Archive className="h-3.5 w-3.5" />
          Archived connections
        </button>
      </div>

      {dashboardView === "ARCHIVED" ? (
        <section className="surface overflow-hidden" aria-label="Archived connections">
          <div className="border-b border-border bg-muted/50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Archived connections</p>
            <p className="mt-1 text-xs text-muted-foreground">Removed connections keep their accounts, jobs, and audit history. Existing Facebook recovery uses a verified reconnect approval.</p>
          </div>
          {archivedError && (
            <div role="alert" className="flex items-start gap-2 border-b border-border bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{archivedError}</p>
            </div>
          )}
          {archivedLoading && !archived ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading archived connections…
            </div>
          ) : !archived || visibleArchived.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
              <Archive className="mb-3 h-7 w-7 text-muted-foreground/50" />
              <p className="font-medium text-foreground">No archived connections</p>
              <p className="mt-1 text-sm text-muted-foreground">Connections you remove appear here and can be restored.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleArchived.map((connection) => (
                <div key={connection._id} className="flex flex-wrap items-center gap-3 px-4 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
                    <Archive className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-foreground">{accountName(connection)}</h2>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Archived {relativeTime(connection.archivedAt ?? undefined, now)} · {accountIdentity(connection)}
                      {connection.archiveReason ? ` · ${statusLabel(connection.archiveReason)}` : ""}
                    </p>
                  </div>
                  <span className="inline-flex rounded-full border px-2.5 py-1 text-xs font-medium border-red-200 bg-red-50 text-red-700">
                    {connection.hasPendingReconnectApproval ? "Reconnect approval pending" : "Archived"}
                  </span>
                  {(!connection.installationId || connection.legacyFacebookConnectionId) ? <button
                    type="button"
                    onClick={() => handleAction(connection, "restore")}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore / reconnect
                  </button> : <p className="max-w-56 text-xs text-muted-foreground">Archived safely. Multi-platform reconnect is not yet available; accounts and jobs are retained.</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : unavailable ? (
        <UnavailableState isRefreshing={isRefreshing} onRefresh={() => void refresh()} />
      ) : connections.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section aria-label="Connection summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Total connections" value={counts.total} description="Detected browser profiles" icon={<Link2 className="h-4 w-4" />} active={filter === "ALL"} onClick={() => setFilter("ALL")} />
            <SummaryCard label="Ready" value={counts.ready} description="Available for publishing" icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} active={filter === "READY"} onClick={() => setFilter("READY")} />
            <SummaryCard label="Publishing" value={counts.publishing} description="Working right now" icon={<Radio className="h-4 w-4 text-blue-600" />} active={filter === "PUBLISHING"} onClick={() => setFilter("PUBLISHING")} />
            <SummaryCard label="Needs attention" value={counts.attention} description={`${counts.offline} offline`} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} active={filter === "ATTENTION"} onClick={() => setFilter("ATTENTION")} />
          </section>

          <section className="surface overflow-hidden" aria-label="Connections">
            <div className="hidden grid-cols-[minmax(240px,1.45fr)_minmax(250px,1.4fr)_minmax(190px,1fr)_minmax(120px,.7fr)_24px] gap-4 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-normal text-muted-foreground lg:grid">
              <span>Account and browser</span>
              <span>Lifecycle and health</span>
              <span>Platform sessions</span>
              <span>Last activity</span>
              <span className="sr-only">Details</span>
            </div>

            {visibleConnections.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
                <Search className="mb-3 h-7 w-7 text-muted-foreground/50" />
                <p className="font-medium text-foreground">No matching connections</p>
                <p className="mt-1 text-sm text-muted-foreground">Try another search or status filter.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {visibleConnections.map((item) => (
                  <ConnectionRow
                    key={item.connection._id}
                    item={item}
                    now={now}
                    onAction={handleAction}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {dialog.kind === "rename" && (
        <RenameDialog
          connection={dialog.connection}
          value={renameValue}
          onChange={setRenameValue}
          error={dialogError}
          busy={dialogBusy}
          onCancel={closeDialog}
          onSubmit={() => void submitRename()}
        />
      )}
      {dialog.kind === "confirm" && (
        <ConfirmDialog
          spec={getConfirmSpec(dialog.action)}
          error={dialogError}
          busy={dialogBusy}
          onCancel={closeDialog}
          onConfirm={() => void submitConfirm()}
        />
      )}
    </div>
  );
}

function UnavailableState({ isRefreshing, onRefresh }: { isRefreshing: boolean; onRefresh: () => void }) {
  return (
    <section role="alert" className="surface flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-red-200 bg-red-50">
        <AlertTriangle className="h-6 w-6 text-red-600" />
      </div>
      <h2 className="font-semibold text-foreground">Connections could not be loaded</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">iPostFlow could not reach the connections service. Your connection data has not been removed.</p>
      <button type="button" onClick={onRefresh} disabled={isRefreshing} className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60">
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        Try again
      </button>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="surface flex min-h-72 flex-col items-center justify-center border-dashed px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary"><Link2 className="h-7 w-7" /></div>
      <h2 className="text-base font-semibold text-foreground">Connect your first Facebook account</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Open Facebook in a Chrome profile with the iPostFlow extension installed. The account will appear here after the extension connects.</p>
    </section>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  description: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

function SummaryCard({ label, value, description, icon, active, onClick }: SummaryCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`surface p-4 text-left transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${active ? "border-primary/40 ring-1 ring-primary/15" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

const ACTION_ITEMS: Record<Exclude<LifecycleAction, "restore">, { label: string; icon: React.ReactNode; destructive?: boolean }> = {
  rename: { label: "Rename…", icon: <Pencil className="h-3.5 w-3.5" /> },
  pause: { label: "Pause", icon: <Pause className="h-3.5 w-3.5" /> },
  resume: { label: "Resume", icon: <Play className="h-3.5 w-3.5" /> },
  disconnect: { label: "Disconnect gracefully…", icon: <Power className="h-3.5 w-3.5" /> },
  "force-disconnect": { label: "Force disconnect…", icon: <Power className="h-3.5 w-3.5" />, destructive: true },
  remove: { label: "Remove from connections…", icon: <Trash2 className="h-3.5 w-3.5" />, destructive: true },
};

function ActionMenu({
  connection,
  onAction,
}: {
  connection: FacebookConnection;
  onAction: (connection: FacebookConnection, action: LifecycleAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Restore only applies to archived connections, which render their own
  // button instead of this menu.
  const actions = availableActions(connection).filter((action) => action !== "restore");

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${accountName(connection)}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {actions.map((action) => {
            const item = ACTION_ITEMS[action];
            if (!item) return null;
            return (
              <button
                key={action}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAction(connection, action);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-accent ${item.destructive ? "text-red-600" : "text-foreground"}`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectionRow({
  item,
  now,
  onAction,
}: {
  item: ConnectionView;
  now: number;
  onAction: (connection: FacebookConnection, action: LifecycleAction) => void;
}) {
  const { connection, state, stateLabel, message, lifecycle, lifecycleLabel, lifecycleMessage } = item;
  const identityMatches = Boolean(connection.facebookUserId && connection.detectedFacebookUserId && connection.facebookUserId === connection.detectedFacebookUserId);
  const platformVerified = connection.platformAccounts
    ? connection.platformAccounts.some((account) => account.status === "CONNECTED" && account.sessionDetected)
    : identityMatches;
  const lifecycleStyle = lifecycle ? LIFECYCLE_STYLES[lifecycle] : LIFECYCLE_STYLES.ACTIVE;

  return (
    <details className="group relative bg-card open:bg-muted/20">
      <summary className="grid cursor-pointer list-none gap-4 px-4 py-4 transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[minmax(240px,1.45fr)_minmax(250px,1.4fr)_minmax(190px,1fr)_minmax(120px,.7fr)_24px] lg:items-center [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${STATE_STYLES[state]}`}><StateIcon state={state} /></div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{accountName(connection)}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Monitor className="h-3.5 w-3.5 shrink-0" />{browserLabel(connection)}</p>
          </div>
        </div>

        <div className="min-w-0 pl-[52px] lg:pl-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${lifecycleStyle}`}>{lifecycleLabel}</span>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${STATE_STYLES[state]}`}>{stateLabel}</span>
            {connection.hasPendingReconnectApproval && (
              <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">Approval pending</span>
            )}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{lifecycleMessage}</p>
        </div>

        <div className="flex items-start gap-2 pl-[52px] text-sm lg:pl-0">
          {platformVerified ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="font-medium text-foreground">{connection.platformAccounts ? `${connection.platformAccounts.filter((account) => account.status === "CONNECTED" && account.sessionDetected).length} / ${connection.platformAccounts.length} detected` : identityMatches ? "Identity verified" : "Not verified"}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{connection.platformAccounts ? "Platform details below" : accountIdentity(connection)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pl-[52px] text-sm lg:pl-0" title={exactDate(item.lastActivity)}>
          <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">{relativeTime(item.lastActivity, now)}</span>
        </div>

        <ChevronDown className="absolute right-4 top-6 h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 lg:static" />
      </summary>

      <div className="border-t border-border bg-muted/30 px-4 py-4 lg:pl-[68px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Diagnostic label="Administrative lifecycle" value={lifecycleLabel} />
            <Diagnostic label="Connectivity" value={connection.connectivity === "ONLINE" ? "Online" : connection.connectivity === "OFFLINE" ? `Offline${connection.connectivityReason ? ` — ${statusLabel(connection.connectivityReason)}` : ""}` : statusLabel(connection.status)} />
            <Diagnostic label="Last heartbeat" value={exactDate(connection.lastHeartbeat)} />
            <Diagnostic label="Extension instance" value={maskedId(connection)} mono />
          </div>
          <ActionMenu connection={connection} onAction={onAction} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Diagnostic label={connection.platformAccounts ? "Facebook status" : "Connection status"} value={statusLabel(connection.status)} />
          <Diagnostic label={connection.platformAccounts ? "Facebook worker status" : "Worker status"} value={statusLabel(connection.workerStatus)} />
          <Diagnostic label="Facebook session" value={connection.facebookSessionDetected ? "Detected" : "Not detected"} />
          <Diagnostic label="Installation" value={statusLabel(connection.installationStatus ?? (connection.extensionInstanceId ? "ACTIVE" : "LEGACY"))} />
          <Diagnostic label="Expected account" value={connection.facebookUserId ? `••••${connection.facebookUserId.slice(-4)}` : "Not available"} />
          <Diagnostic label="Detected account" value={connection.detectedFacebookUserId ? `••••${connection.detectedFacebookUserId.slice(-4)}` : "Not available"} />
          <Diagnostic label="Last activity" value={exactDate(item.lastActivity)} />
          <Diagnostic label="Reconnect approval" value={connection.hasPendingReconnectApproval ? "Pending" : "None"} />
        </div>

        <div className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${STATE_STYLES[state]}`}>
          <StateIcon state={state} className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{message}</p>
            {lifecycle && lifecycle !== "ACTIVE" && (
              <p className="mt-1 font-medium">{lifecycleMessage}</p>
            )}
          </div>
        </div>
        {connection.platformAccounts && <PlatformDetails accounts={connection.platformAccounts} />}
      </div>
    </details>
  );
}

function ConfirmDialog({
  spec,
  error,
  busy,
  onCancel,
  onConfirm,
}: {
  spec: ConfirmSpec;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const needsTyped = Boolean(spec.typedConfirmation);
  const typedOk = !needsTyped || typed.trim().toUpperCase() === spec.typedConfirmation;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={spec.title}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <h2 className="text-base font-semibold text-foreground">{spec.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{spec.description}</p>

        <ul className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
          {spec.effects.map((effect) => (
            <li key={effect} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              {effect}
            </li>
          ))}
        </ul>

        {needsTyped && (
          <label className="mt-3 block text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">{spec.typedConfirmation}</span> to confirm
            <input
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !typedOk}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${spec.destructive ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary/90"}`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameDialog({
  connection,
  value,
  onChange,
  error,
  busy,
  onCancel,
  onSubmit,
}: {
  connection: FacebookConnection;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Rename connection">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <h2 className="text-base font-semibold text-foreground">Rename connection</h2>
        <p className="mt-1 text-sm text-muted-foreground">Names must be unique across your connections.</p>

        <label className="mt-3 block text-xs text-muted-foreground">
          Display name
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={accountName(connection)}
            autoFocus
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !value.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save name
          </button>
        </div>
      </div>
    </div>
  );
}

function Diagnostic({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-medium text-foreground ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</p>
    </div>
  );
}
