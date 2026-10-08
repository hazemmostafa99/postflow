"use client";

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
};

function statusLabel(connection: PlatformConnection): string {
  if (connection.status === "CONNECTED" && connection.sessionDetected) return "Ready to verify";
  if (connection.status === "ACCOUNT_MISMATCH") return "Account mismatch";
  if (connection.status === "LOGIN_REQUIRED") return "Login required";
  if (connection.status === "PENDING") return "Waiting for Instagram";
  return connection.status.replaceAll("_", " ");
}

export function PlatformConnectionsPanel() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
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
      setMessage("Instagram connection data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="surface mb-6 overflow-hidden" aria-label="Instagram connections">
      <div className="border-b border-border px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instagram beta</p>
        <h2 className="mt-1 text-base font-semibold text-foreground">Connect an Instagram account</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Open Instagram in the same Chrome profile where PostFlow is installed. The extension detects the logged-in username and creates the connection automatically. Publishing is not enabled yet.
        </p>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {loading
            ? "Checking the PostFlow extension…"
            : installations.some((item) => item.status === "ACTIVE")
            ? "Waiting for the Instagram tab to report the signed-in account…"
            : "Open the PostFlow dashboard in this Chrome profile first so the extension can register."}
          {message && <p className="mt-2" role="status">{message}</p>}
        </div>
        <div className="space-y-3">
          {connections.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No Instagram connections yet.</div>
          ) : connections.map((connection) => (
            <article key={connection._id} className="rounded-md border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{connection.displayName || "Instagram account"}</p>
                  <p className="text-sm text-muted-foreground">@{connection.externalUsername || "unknown"}</p>
                </div>
                <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">{statusLabel(connection)}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Detected: {connection.detectedExternalUsername ? `@${connection.detectedExternalUsername}` : "not detected yet"}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
