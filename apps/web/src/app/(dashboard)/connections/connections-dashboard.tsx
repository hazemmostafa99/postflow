"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDotDashed,
  Clock3,
  Link2,
  Loader2,
  Monitor,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  WifiOff,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TopbarPortal } from "@/components/topbar-portal";

export interface FacebookConnection {
  _id: string;
  extensionInstanceId?: string;
  displayName?: string;
  facebookUserId?: string;
  detectedFacebookUserId?: string;
  status: string;
  workerStatus: string;
  installationStatus?: string;
  facebookSessionDetected: boolean;
  lastSeenAt?: string;
  lastHeartbeat?: string;
}

type OperationalState = "READY" | "PUBLISHING" | "ATTENTION" | "OFFLINE" | "SETUP";
type ConnectionFilter = "ALL" | "READY" | "PUBLISHING" | "ATTENTION" | "OFFLINE";

interface ConnectionView {
  connection: FacebookConnection;
  state: OperationalState;
  stateLabel: string;
  message: string;
  lastActivity?: string;
  lastActivityAt: number;
}

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

const FILTER_OPTIONS: Array<{ value: ConnectionFilter; label: string }> = [
  { value: "ALL", label: "All connections" },
  { value: "READY", label: "Ready" },
  { value: "PUBLISHING", label: "Publishing" },
  { value: "ATTENTION", label: "Needs attention" },
  { value: "OFFLINE", label: "Offline" },
];

function newestActivity(connection: FacebookConnection): { value?: string; timestamp: number } {
  const values = [connection.lastSeenAt, connection.lastHeartbeat]
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: new Date(value).getTime() }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);

  return values[0] ?? { timestamp: 0 };
}

function getConnectionView(connection: FacebookConnection, now: number): ConnectionView {
  const activity = newestActivity(connection);
  const rawStatus = connection.status?.toUpperCase();
  const workerStatus = connection.workerStatus?.toUpperCase();
  const offline = !activity.timestamp || now - activity.timestamp > OFFLINE_AFTER_MS;
  const base = {
    connection,
    lastActivity: activity.value,
    lastActivityAt: activity.timestamp,
  };

  if (offline || rawStatus === "DISCONNECTED") {
    return { ...base, state: "OFFLINE", stateLabel: "Offline", message: "Open this Chrome profile to reconnect iPostFlow." };
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

function accountName(connection: FacebookConnection): string {
  if (connection.displayName?.trim()) return connection.displayName.trim();
  if (connection.facebookUserId) return `Facebook account ••••${connection.facebookUserId.slice(-4)}`;
  return "Unnamed Facebook connection";
}

function accountIdentity(connection: FacebookConnection): string {
  return connection.facebookUserId
    ? `Facebook ID ending ${connection.facebookUserId.slice(-4)}`
    : "Facebook identity not verified";
}

function browserLabel(connection: FacebookConnection): string {
  return connection.extensionInstanceId ? "iPostFlow extension connected" : "Legacy installation";
}

function maskedId(value?: string): string {
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

function matchesFilter(state: OperationalState, filter: ConnectionFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "ATTENTION") return state === "ATTENTION" || state === "SETUP" || state === "OFFLINE";
  return state === filter;
}

interface ConnectionsDashboardProps {
  connections: FacebookConnection[];
  unavailable: boolean;
  refreshedAt: string;
}

export function ConnectionsDashboard({ connections, unavailable, refreshedAt }: ConnectionsDashboardProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<ConnectionFilter>("ALL");
  const [query, setQuery] = useState("");
  const [isRefreshing, startRefresh] = useTransition();
  const now = new Date(refreshedAt).getTime();

  const views = useMemo(
    () => connections.map((connection) => getConnectionView(connection, now)),
    [connections, now],
  );

  const counts = useMemo(() => ({
    total: views.length,
    ready: views.filter((item) => item.state === "READY").length,
    publishing: views.filter((item) => item.state === "PUBLISHING").length,
    attention: views.filter((item) => matchesFilter(item.state, "ATTENTION")).length,
    offline: views.filter((item) => item.state === "OFFLINE").length,
  }), [views]);

  const visibleConnections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return views
      .filter((item) => matchesFilter(item.state, filter))
      .filter(({ connection }) => {
        if (!normalizedQuery) return true;
        return [
          accountName(connection),
          connection.facebookUserId,
          connection.extensionInstanceId,
          statusLabel(connection.status),
          statusLabel(connection.workerStatus),
        ].some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => (
        STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] ||
        b.lastActivityAt - a.lastActivityAt ||
        accountName(a.connection).localeCompare(accountName(b.connection))
      ));
  }, [filter, query, views]);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  return (
    <div className="page-shell">
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
          <label className="sr-only" htmlFor="connection-status-filter">Filter by connection status</label>
          <select
            id="connection-status-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as ConnectionFilter)}
            className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-w-40"
          >
            {FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            type="button"
            onClick={refresh}
            disabled={isRefreshing}
            className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-1"
          >
            {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </TopbarPortal>

      {unavailable ? (
        <UnavailableState isRefreshing={isRefreshing} onRefresh={refresh} />
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

          <section className="surface overflow-hidden" aria-label="Facebook connections">
            <div className="hidden grid-cols-[minmax(240px,1.45fr)_minmax(250px,1.4fr)_minmax(190px,1fr)_minmax(120px,.7fr)_24px] gap-4 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-normal text-muted-foreground lg:grid">
              <span>Account and browser</span>
              <span>Health</span>
              <span>Facebook session</span>
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
                {visibleConnections.map((item) => <ConnectionRow key={item.connection._id} item={item} now={now} />)}
              </div>
            )}
          </section>
        </>
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

function ConnectionRow({ item, now }: { item: ConnectionView; now: number }) {
  const { connection, state, stateLabel, message } = item;
  const identityMatches = Boolean(connection.facebookUserId && connection.detectedFacebookUserId && connection.facebookUserId === connection.detectedFacebookUserId);

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
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${STATE_STYLES[state]}`}>{stateLabel}</span>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{message}</p>
        </div>

        <div className="flex items-start gap-2 pl-[52px] text-sm lg:pl-0">
          {identityMatches ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="font-medium text-foreground">{identityMatches ? "Identity verified" : "Not verified"}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{accountIdentity(connection)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pl-[52px] text-sm lg:pl-0" title={exactDate(item.lastActivity)}>
          <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">{relativeTime(item.lastActivity, now)}</span>
        </div>

        <ChevronDown className="absolute right-4 top-6 h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 lg:static" />
      </summary>

      <div className="border-t border-border bg-muted/30 px-4 py-4 lg:pl-[68px]">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Diagnostic label="Connection status" value={statusLabel(connection.status)} />
          <Diagnostic label="Worker status" value={statusLabel(connection.workerStatus)} />
          <Diagnostic label="Facebook session" value={connection.facebookSessionDetected ? "Detected" : "Not detected"} />
          <Diagnostic label="Installation" value={statusLabel(connection.installationStatus ?? (connection.extensionInstanceId ? "ACTIVE" : "LEGACY"))} />
          <Diagnostic label="Expected account" value={maskedId(connection.facebookUserId)} />
          <Diagnostic label="Detected account" value={maskedId(connection.detectedFacebookUserId)} />
          <Diagnostic label="Extension instance" value={maskedId(connection.extensionInstanceId)} mono />
          <Diagnostic label="Last activity" value={exactDate(item.lastActivity)} />
        </div>
        {state !== "READY" && state !== "PUBLISHING" && (
          <div className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${STATE_STYLES[state]}`}>
            <StateIcon state={state} className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{message}</p>
          </div>
        )}
      </div>
    </details>
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
