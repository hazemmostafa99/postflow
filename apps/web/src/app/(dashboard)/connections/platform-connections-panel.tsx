"use client";

import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

type Installation = {
  _id: string;
  extensionInstanceId?: string | null;
  status?: string | null;
  lastHeartbeat?: string | null;
};

type PlatformConnection = {
  _id: string;
  platform: string;
  displayName?: string;
  externalUsername?: string;
  detectedExternalUsername?: string;
  status: string;
  workerStatus: string;
  sessionDetected: boolean;
  lastSeenAt?: string | null;
};

function isReady(connection: PlatformConnection): boolean {
  return Boolean(
    connection.status === "CONNECTED" &&
      connection.sessionDetected &&
      connection.externalUsername &&
      connection.externalUsername.toLowerCase() ===
        connection.detectedExternalUsername?.toLowerCase(),
  );
}

function getConnectionState(connection: PlatformConnection) {
  if (isReady(connection)) {
    return {
      label: "Connected",
      detail: "Session verified and ready for rollout",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      Icon: CheckCircle2,
    };
  }

  if (connection.status === "ACCOUNT_MISMATCH") {
    return {
      label: "Account mismatch",
      detail: "Open Instagram and switch to the expected account",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      Icon: AlertCircle,
    };
  }

  if (connection.status === "LOGIN_REQUIRED") {
    return {
      label: "Sign in required",
      detail: "Sign in at instagram.com in this Chrome profile",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      Icon: AlertCircle,
    };
  }

  return {
    label: "Waiting for Instagram",
    detail: "Keep an Instagram tab open while the extension checks it",
    className: "border-border bg-muted text-muted-foreground",
    Icon: Clock3,
  };
}

function formatLastSeen(value?: string | null): string {
  if (!value) return "Waiting for first session";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Waiting for first session";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function PlatformConnectionsPanel() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(initial = false) {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setMessage(null);

    try {
      const [installationResponse, connectionResponse] = await Promise.all([
        fetch("/api/extensions/installations", { cache: "no-store" }),
        fetch("/api/extensions/platform-connections", { cache: "no-store" }),
      ]);
      const nextInstallations = installationResponse.ok
        ? ((await installationResponse.json()) as Installation[])
        : [];
      const nextConnections = connectionResponse.ok
        ? ((await connectionResponse.json()) as PlatformConnection[])
        : [];
      setInstallations(nextInstallations);
      setConnections(nextConnections);
    } catch {
      setMessage("Instagram connection data could not be loaded. Try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(true), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, []);

  const activeInstallation = installations.some((item) => item.status === "ACTIVE");
  const readyCount = connections.filter(isReady).length;
  const panelState = loading
    ? { label: "Checking extension", detail: "Looking for an active Chrome session" }
    : readyCount > 0
      ? { label: "Instagram connected", detail: `${readyCount} verified account${readyCount === 1 ? "" : "s"}` }
      : activeInstallation
        ? { label: "Waiting for Instagram", detail: "Open instagram.com in this profile" }
        : { label: "Extension not detected", detail: "Open the PostFlow dashboard in Chrome" };

  return (
    <section className="surface mb-6 overflow-hidden" aria-label="Instagram connections">
      <div className="border-b border-border bg-gradient-to-br from-pink-50/80 via-card to-card px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-orange-400 text-white shadow-sm">
              <Camera className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-pink-700">Instagram beta</p>
                <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pink-700">
                  Auto-connect
                </span>
              </div>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Connect Instagram without a form</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                PostFlow watches the Instagram tab in the same Chrome profile, detects the signed-in username, and links it automatically. No API token or username entry is needed.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || refreshing}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Refresh Instagram connection status"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span className={`h-2 w-2 rounded-full ${readyCount > 0 ? "bg-emerald-500" : "bg-amber-400"}`} />
            {panelState.label}
          </span>
          <span className="text-muted-foreground">{panelState.detail}</span>
          <span className="text-muted-foreground">Updates every 5 seconds</span>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${activeInstallation ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : activeInstallation ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">Automatic connection</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {loading
                  ? "Checking whether the PostFlow extension is online..."
                  : activeInstallation
                    ? "The extension is online. Open Instagram and leave the tab visible for a moment."
                    : "Open the PostFlow dashboard in this Chrome profile first so the extension can register."}
              </p>
            </div>
          </div>

          <ol className="mt-4 space-y-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <li className="flex gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">1</span><span>Keep the extension enabled in Chrome.</span></li>
            <li className="flex gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">2</span><span>Open <span className="font-medium text-foreground">instagram.com</span> in the same profile.</span></li>
            <li className="flex gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">3</span><span>Stay signed in; PostFlow will update this card automatically.</span></li>
          </ol>

          {message && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="status">{message}</p>}
        </div>

        <div className="space-y-3">
          {connections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
              <Camera className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">No Instagram account detected yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Open Instagram in the same Chrome profile to create the connection automatically.</p>
            </div>
          ) : connections.map((connection) => {
            const state = getConnectionState(connection);
            const StateIcon = state.Icon;
            const expectedUsername = connection.externalUsername ? `@${connection.externalUsername}` : "Not bound yet";
            const detectedUsername = connection.detectedExternalUsername ? `@${connection.detectedExternalUsername}` : "Not detected";
            return (
              <article key={connection._id} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-pink-50 text-pink-700 ring-1 ring-pink-100"><Camera className="h-4 w-4" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{connection.displayName || "Instagram account"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{expectedUsername}</p>
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${state.className}`}>
                    <StateIcon className="h-3 w-3" aria-hidden="true" />
                    {state.label}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs sm:grid-cols-3">
                  <div><p className="text-muted-foreground">Expected</p><p className="mt-0.5 font-medium text-foreground">{expectedUsername}</p></div>
                  <div><p className="text-muted-foreground">Detected</p><p className="mt-0.5 font-medium text-foreground">{detectedUsername}</p></div>
                  <div><p className="text-muted-foreground">Last seen</p><p className="mt-0.5 font-medium text-foreground">{formatLastSeen(connection.lastSeenAt)}</p></div>
                </div>

                <p className={`mt-3 flex items-start gap-1.5 text-xs ${isReady(connection) ? "text-emerald-700" : "text-amber-700"}`}>
                  <StateIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{state.detail}</span>
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
