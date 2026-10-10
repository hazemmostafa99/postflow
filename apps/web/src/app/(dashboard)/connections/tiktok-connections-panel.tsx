"use client";

import { AlertCircle, CheckCircle2, Clock3, RefreshCw, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type TikTokConnection = {
  _id: string;
  displayName?: string;
  externalUsername?: string;
  detectedExternalUsername?: string;
  status: string;
  sessionDetected: boolean;
  lastSeenAt?: string;
};

function connectionState(connection: TikTokConnection) {
  const matches = Boolean(
    connection.externalUsername &&
      connection.detectedExternalUsername &&
      connection.externalUsername.toLowerCase() ===
        connection.detectedExternalUsername.toLowerCase(),
  );
  if (connection.status === "CONNECTED" && connection.sessionDetected && matches) {
    return { label: "Connected", Icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  }
  if (connection.status === "ACCOUNT_MISMATCH") {
    return { label: "Wrong account", Icon: AlertCircle, tone: "text-amber-700 bg-amber-50 border-amber-200" };
  }
  if (connection.status === "LOGIN_REQUIRED") {
    return { label: "Sign in required", Icon: AlertCircle, tone: "text-amber-700 bg-amber-50 border-amber-200" };
  }
  return { label: "Checking", Icon: Clock3, tone: "text-muted-foreground bg-muted border-border" };
}

function lastSeen(value?: string): string {
  if (!value) return "Not seen yet";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Not seen yet";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  return minutes < 1 ? "Just now" : `${minutes}m ago`;
}

export function TikTokConnectionsPanel() {
  const [connections, setConnections] = useState<TikTokConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(
        "/api/extensions/platform-connections?platform=TIKTOK",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("request failed");
      setConnections((await response.json()) as TikTokConnection[]);
    } catch {
      setError("TikTok connection status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <section className="surface mb-6 overflow-hidden" aria-label="TikTok connections">
      <div className="border-b border-border bg-gradient-to-br from-slate-100 via-card to-card px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-950 text-white">
              <Video className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">TikTok beta</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Connect the signed-in TikTok account</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Open tiktok.com in the same Chrome profile. PostFlow detects the viewer account and binds it without an official publishing API.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Video publishing remains disabled while upload and duplicate-prevention checks are under review.
        </p>
      </div>

      <div className="space-y-3 p-5 sm:p-6">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="status">{error}</p>}
        {!loading && connections.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-5 py-7 text-center">
            <p className="text-sm font-medium text-foreground">No TikTok account detected yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Sign in at tiktok.com and leave the tab open briefly.</p>
          </div>
        )}
        {connections.map((connection) => {
          const state = connectionState(connection);
          const StateIcon = state.Icon;
          return (
            <article key={connection._id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{connection.displayName || "TikTok account"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Expected {connection.externalUsername ? `@${connection.externalUsername}` : "—"} · Detected {connection.detectedExternalUsername ? `@${connection.detectedExternalUsername}` : "—"} · {lastSeen(connection.lastSeenAt)}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${state.tone}`}>
                  <StateIcon className="h-3 w-3" aria-hidden="true" />
                  {state.label}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
