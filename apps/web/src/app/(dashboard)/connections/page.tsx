import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Link2,
  LogIn,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const API_BASE = process.env.API_URL || "http://localhost:8000";

interface FacebookConnection {
  _id: string;
  extensionInstanceId?: string;
  displayName?: string;
  facebookUserId?: string;
  detectedFacebookUserId?: string;
  status: string;
  workerStatus: string;
  facebookSessionDetected: boolean;
  lastSeenAt?: string;
  lastHeartbeat?: string;
}

async function fetchConnections(userId: string): Promise<FacebookConnection[]> {
  try {
    const response = await fetch(`${API_BASE}/api/extensions/connections`, {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

function statusLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusStyle(status: string): string {
  if (status === "CONNECTED" || status === "IDLE" || status === "ONLINE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "ACCOUNT_MISMATCH" || status === "BLOCKED") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "LOGIN_REQUIRED" || status === "PENDING") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "CHECKPOINT_OR_VERIFICATION" || status === "CAPTCHA_OR_CHALLENGE" || status === "MANUAL_INTERVENTION_REQUIRED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-border bg-muted text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "CONNECTED" || status === "IDLE" || status === "ONLINE") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  }
  if (status === "ACCOUNT_MISMATCH") return <ShieldAlert className="h-5 w-5 text-red-600" />;
  if (status === "LOGIN_REQUIRED") return <LogIn className="h-5 w-5 text-amber-600" />;
  if (status === "BLOCKED") return <AlertTriangle className="h-5 w-5 text-red-600" />;
  if (status === "CHECKPOINT_OR_VERIFICATION" || status === "CAPTCHA_OR_CHALLENGE" || status === "MANUAL_INTERVENTION_REQUIRED") {
    return <AlertTriangle className="h-5 w-5 text-amber-600" />;
  }
  return <WifiOff className="h-5 w-5 text-muted-foreground" />;
}

function effectiveWorkerStatus(connection: FacebookConnection): string {
  const lastSeen = connection.lastSeenAt ? new Date(connection.lastSeenAt).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen > 120_000) return "OFFLINE";
  return connection.workerStatus;
}

function formatDate(value?: string): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function accountLabel(connection: FacebookConnection): string {
  if (connection.displayName) return connection.displayName;
  if (!connection.facebookUserId) return "Facebook account awaiting login";
  const suffix = connection.facebookUserId.slice(-4);
  return `Facebook account ending ${suffix}`;
}

export default async function ConnectionsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const connections = await fetchConnections(userId);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Facebook accounts</p>
          <h1 className="page-title">Connections</h1>
          <p className="page-subtitle">Chrome Profile workers and account verification status.</p>
        </div>
        <div className="soft-icon" aria-hidden="true">
          <Link2 className="h-5 w-5" />
        </div>
      </header>

      {connections.length === 0 ? (
        <Card className="border-0 shadow-sm ring-1 ring-border">
          <CardContent className="flex min-h-56 flex-col items-center justify-center text-center">
            <WifiOff className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="font-medium">No Facebook connections detected</p>
            <p className="mt-1 text-sm text-muted-foreground">Open Facebook with the PostFlow extension to register a profile.</p>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((connection) => (
            (() => {
              const workerStatus = effectiveWorkerStatus(connection);
              const displayStatus = workerStatus === "ONLINE" || workerStatus === "IDLE"
                ? connection.status
                : workerStatus;
              return (
            <Card key={connection._id} className="border-0 shadow-sm ring-1 ring-border">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="soft-icon h-10 w-10">
                    <StatusIcon status={displayStatus} />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{accountLabel(connection)}</CardTitle>
                    <CardDescription className="truncate">
                      {connection.facebookUserId ? "Verified Facebook identity" : "Identity not verified"}
                    </CardDescription>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-medium ${statusStyle(displayStatus)}`}>
                  {statusLabel(displayStatus)}
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                  <span className="text-muted-foreground">Worker</span>
                  <span className="font-medium">{statusLabel(workerStatus)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Last seen</span>
                  <span className="inline-flex items-center gap-1 text-right font-medium">
                    <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatDate(connection.lastSeenAt ?? connection.lastHeartbeat)}
                  </span>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Browser profile</p>
                  <p className="mt-1 text-sm text-foreground/75">
                    {connection.extensionInstanceId ? "PostFlow extension connected" : "Legacy installation"}
                  </p>
                </div>
                {connection.status === "ACCOUNT_MISMATCH" && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    The current Facebook account does not match this connection.
                  </div>
                )}
              </CardContent>
            </Card>
              );
            })()
          ))}
        </section>
      )}
    </div>
  );
}
