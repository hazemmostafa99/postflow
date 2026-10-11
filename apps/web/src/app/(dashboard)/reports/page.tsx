import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileText,
  MessageCircle,
  Send,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TopbarPortal } from "@/components/topbar-portal";
import { ReportExportControl } from "@/components/report-export-control";

const API_BASE = process.env.API_URL || "http://localhost:8000";

type Metric = {
  posts: number;
  targets: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  canceled: number;
  published: number;
  pendingApproval: number;
  unknownSubmission: number;
  reactions: number;
  comments: number;
  engagement: number;
  successRate: number;
  averageCompletionSeconds: number;
};

type ReportRow = Metric & {
  id: string;
  name: string;
  email?: string;
  role?: string;
  status?: string;
  teamId?: string | null;
  teamName?: string;
  memberCount?: number;
  teamLeader?: { id: string; name: string } | null;
};

type ReportResponse = {
  generatedAt: string;
  cacheTtlSeconds: number;
  scope: { role: string; level: "COMPANY" | "TEAM" | "SELF"; teamId?: string };
  filters: { from: string; to: string; teamId?: string; userId?: string };
  totals: Metric;
  previousTotals: Metric;
  comparison: {
    postsPercent: number;
    publishedPercent: number;
    reactionsPercent: number;
    commentsPercent: number;
    successRatePoints: number;
  };
  teams: ReportRow[];
  members: ReportRow[];
  memberPagination: { page: number; limit: number; total: number; totalPages: number };
  options: {
    teams: Array<{ id: string; name: string }>;
    users: Array<{ id: string; name: string; role: string; teamId?: string | null }>;
  };
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata = {
  title: "Reports - iPostFlow",
  description: "View and filter performance reports for posts, delivery, and engagement across teams and members.",
};


async function fetchReport(userId: string, params: Record<string, string | undefined>) {
  const url = new URL(`${API_BASE}/api/reports/overview`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  try {
    const response = await fetch(url, {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { report: null, error: data.message ?? "Could not load the report." };
    }
    return { report: data as ReportResponse, error: null };
  } catch {
    return { report: null, error: "The reports service is unavailable." };
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const raw = await searchParams;
  const query = {
    from: valueOf(raw.from),
    to: valueOf(raw.to),
    teamId: valueOf(raw.teamId),
    userId: valueOf(raw.userId),
    page: valueOf(raw.page),
  };
  const { report, error } = await fetchReport(userId, query);

  if (!report) {
    return (
      <div className="page-shell">
        <div className="surface p-8 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h2 className="mt-4 text-lg font-semibold">Report unavailable</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Link href="/reports" className="mt-5 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Reset filters
          </Link>
        </div>
      </div>
    );
  }

  const isSales = report.scope.role === "SALES";
  const isCompany = report.scope.level === "COMPANY";
  const selectedTeam = report.filters.teamId;
  const availableUsers = selectedTeam
    ? report.options.users.filter((user) => user.teamId === selectedTeam)
    : report.options.users;
  const exportParams = new URLSearchParams({
    from: report.filters.from,
    to: report.filters.to,
  });
  if (report.filters.teamId) exportParams.set("teamId", report.filters.teamId);
  if (report.filters.userId) exportParams.set("userId", report.filters.userId);

  return (
    <div className="page-shell">
      <TopbarPortal>
        <form className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:flex xl:w-auto xl:items-center" action="/reports">
          <label className="min-w-0">
            <span className="sr-only">From date</span>
            <input aria-label="From date" type="date" name="from" defaultValue={report.filters.from} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground xl:w-32" />
          </label>
          <label className="min-w-0">
            <span className="sr-only">To date</span>
            <input aria-label="To date" type="date" name="to" defaultValue={report.filters.to} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground xl:w-32" />
          </label>
          {!isSales && report.options.teams.length > 0 && (
            <label className="min-w-0">
              <span className="sr-only">Team</span>
              <select aria-label="Team" name="teamId" defaultValue={selectedTeam ?? ""} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground xl:w-40">
              <option value="">All visible teams</option>
              {report.options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            </label>
          )}
          {!isSales && availableUsers.length > 0 && (
            <label className="min-w-0">
              <span className="sr-only">Member</span>
              <select aria-label="Member" name="userId" defaultValue={report.filters.userId ?? ""} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground xl:w-44">
              <option value="">All visible members</option>
              {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {formatRole(user.role)}</option>)}
            </select>
            </label>
          )}
          <div className="col-span-2 flex gap-2 sm:col-span-1">
            <button className="h-9 flex-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 xl:flex-none">Apply</button>
            <Link href="/reports" className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted">Reset</Link>
          </div>
          <div className="col-span-2 flex sm:col-span-1">
            <ReportExportControl query={exportParams.toString()} allowTeams={!isSales} />
          </div>
        </form>
      </TopbarPortal>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Posts created" value={report.totals.posts} change={report.comparison.postsPercent} icon={FileText} />
        <MetricCard title="Confirmed published" value={report.totals.published} change={report.comparison.publishedPercent} icon={CheckCircle2} />
        <MetricCard title="Processing success" value={`${report.totals.successRate}%`} change={report.comparison.successRatePoints} changeSuffix=" pts" icon={Activity} />
        <MetricCard title="Reactions" value={report.totals.reactions} change={report.comparison.reactionsPercent} icon={Activity} />
        <MetricCard title="Comments" value={report.totals.comments} change={report.comparison.commentsPercent} icon={MessageCircle} />
      </section>

      <section>
        <Card className="border-0 shadow-sm ring-1 ring-border">
          <CardHeader><CardTitle className="text-base">Delivery status</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <StatusLine label="Targets" value={report.totals.targets} icon={Send} />
            <StatusLine label="Successful jobs" value={report.totals.success} tone="text-emerald-600" />
            <StatusLine label="Failed jobs" value={report.totals.failed} tone="text-red-600" />
            <StatusLine label="Pending approval" value={report.totals.pendingApproval} tone="text-amber-600" />
            <StatusLine label="Unknown result" value={report.totals.unknownSubmission} />
            <StatusLine label="Avg. completion" value={formatDuration(report.totals.averageCompletionSeconds)} icon={Clock3} />
          </CardContent>
        </Card>
      </section>

      {isCompany && report.teams.length > 0 && (
        <ReportTable title="Team performance" description="Compare output, delivery, and engagement across teams." rows={report.teams} kind="team" report={report} />
      )}

      {!isSales && (
        <ReportTable
          title={report.scope.level === "TEAM" ? "Team members" : "Member performance"}
          description="Current-period performance for each visible member."
          rows={report.members}
          kind="member"
          report={report}
        />
      )}
    </div>
  );
}

function MetricCard({ title, value, change, changeSuffix = "%", icon: Icon }: { title: string; value: number | string; change: number; changeSuffix?: string; icon: typeof FileText }) {
  const positive = change > 0;
  return (
    <Card className="border-0 shadow-sm ring-1 ring-border">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <span className="soft-icon h-8 w-8"><Icon className="h-4 w-4" /></span>
        </div>
        <p className="mt-4 text-2xl font-semibold tracking-tight">{typeof value === "number" ? value.toLocaleString() : value}</p>
        <p className={`mt-1 text-xs ${positive ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-muted-foreground"}`}>
          {positive ? "+" : ""}{change}{changeSuffix} vs previous period
        </p>
      </CardContent>
    </Card>
  );
}

function StatusLine({ label, value, tone = "text-foreground", icon: Icon }: { label: string; value: number | string; tone?: string; icon?: typeof Send }) {
  return <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2.5 text-sm"><span className="flex items-center gap-2 text-muted-foreground">{Icon && <Icon className="h-4 w-4" />}{label}</span><strong className={tone}>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>;
}

function ReportTable({ title, description, rows, kind, report }: { title: string; description: string; rows: ReportRow[]; kind: "team" | "member"; report: ReportResponse }) {
  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-5">
        <div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
        <Users className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">{kind === "team" ? "Team" : "Member"}</th><th className="px-4 py-3 font-medium">Posts</th><th className="px-4 py-3 font-medium">Targets</th><th className="px-4 py-3 font-medium">Published</th><th className="px-4 py-3 font-medium">Success</th><th className="px-4 py-3 font-medium">Failed</th><th className="px-4 py-3 font-medium">Reactions</th><th className="px-4 py-3 font-medium">Comments</th></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No performance data matches these filters.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="px-5 py-3"><p className="font-medium">{row.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{kind === "team" ? `${row.memberCount ?? 0} members${row.teamLeader ? ` · ${row.teamLeader.name}` : ""}` : `${row.teamName ?? "No team"} · ${formatRole(row.role ?? "")}`}</p></td>
                <td className="px-4 py-3">{row.posts}</td><td className="px-4 py-3">{row.targets}</td><td className="px-4 py-3 font-medium text-emerald-600">{row.published}</td><td className="px-4 py-3">{row.successRate}%</td><td className="px-4 py-3 font-medium text-red-600">{row.failed}</td><td className="px-4 py-3">{row.reactions}</td><td className="px-4 py-3">{row.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {kind === "member" && report.memberPagination.totalPages > 1 && <Pagination report={report} />}
    </section>
  );
}

function Pagination({ report }: { report: ReportResponse }) {
  const { page, totalPages, total } = report.memberPagination;
  const href = (nextPage: number) => {
    const params = new URLSearchParams({ from: report.filters.from, to: report.filters.to, page: String(nextPage) });
    if (report.filters.teamId) params.set("teamId", report.filters.teamId);
    if (report.filters.userId) params.set("userId", report.filters.userId);
    return `/reports?${params}`;
  };
  return <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm"><span className="text-muted-foreground">{total} members</span><div className="flex items-center gap-2"><Link aria-disabled={page <= 1} href={page <= 1 ? href(1) : href(page - 1)} className={`rounded-lg border px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>Previous</Link><span className="text-xs text-muted-foreground">{page} / {totalPages}</span><Link aria-disabled={page >= totalPages} href={page >= totalPages ? href(totalPages) : href(page + 1)} className={`rounded-lg border px-3 py-1.5 ${page >= totalPages ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>Next</Link></div></div>;
}

function formatRole(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 360) / 10}h`;
}
