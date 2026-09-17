import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, FileText, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const API_BASE = process.env.API_URL || "http://localhost:8000";

interface Job {
  _id: string;
  status: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface Post {
  _id: string;
  content: string;
  status: string;
  createdAt: string;
  jobs: Job[];
}

interface Group {
  _id: string;
}

async function fetchPosts(clerkUserId: string): Promise<Post[]> {
  try {
    const res = await fetch(`${API_BASE}/api/posts`, {
      headers: { "x-clerk-user-id": clerkUserId },
      next: { revalidate: 10 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchGroups(clerkUserId: string): Promise<Group[]> {
  try {
    const res = await fetch(`${API_BASE}/api/groups`, {
      headers: { "x-clerk-user-id": clerkUserId },
      next: { revalidate: 10 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

function countThisMonth(posts: Post[]): number {
  const now = new Date();
  return posts.filter((post) => {
    const created = new Date(post.createdAt);
    return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
  }).length;
}

function statusLabel(status: string): string {
  if (status === "SUCCESS") return "Published";
  if (status === "FAILED") return "Failed";
  if (status === "RUNNING") return "Running";
  return "Pending";
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "primary",
}: {
  title: string;
  value: number;
  description: string;
  icon: typeof FileText;
  tone?: "primary" | "amber" | "red";
}) {
  const iconClass =
    tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-primary";

  return (
    <Card className="border-0 shadow-sm ring-1 ring-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${iconClass}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value.toLocaleString()}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [posts, groups] = await Promise.all([
    fetchPosts(userId),
    fetchGroups(userId),
  ]);

  const jobs = posts.flatMap((post) =>
    post.jobs.map((job) => ({
      ...job,
      postId: post._id,
      postContent: post.content,
    }))
  );

  const activeJobs = jobs.filter((job) => job.status === "PENDING" || job.status === "RUNNING");
  const failedJobs = jobs.filter((job) => job.status === "FAILED");
  const successfulJobs = jobs.filter((job) => job.status === "SUCCESS");
  const recentJobs = [...jobs]
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
    .slice(0, 6);

  return (
    <div className="page-shell">
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total posts" value={posts.length} description={`${countThisMonth(posts)} created this month`} icon={FileText} />
        <StatCard title="Connected groups" value={groups.length} description="Available in the new post form" icon={Users} />
        <StatCard title="Active jobs" value={activeJobs.length} description="Pending or currently publishing" icon={Clock} tone="amber" />
        <StatCard title="Failed jobs" value={failedJobs.length} description={`${successfulJobs.length} successful jobs`} icon={AlertCircle} tone="red" />
      </section>

      <section className="grid gap-4 lg:grid-cols-7">
        <Card className="border-0 shadow-sm ring-1 ring-border lg:col-span-5">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest publishing jobs from the backend.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentJobs.length === 0 ? (
              <div className="flex h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                <Clock className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="font-medium text-foreground">No activity yet</p>
                <p className="mt-1 text-xs">Publishing updates will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentJobs.map((job) => (
                  <Link
                    key={job._id}
                    href={`/posts/${job.postId}`}
                    className="flex items-start gap-3 rounded-lg border border-border bg-background/60 px-3 py-3 transition-colors hover:bg-accent"
                  >
                    {job.status === "FAILED" ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    ) : job.status === "SUCCESS" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-foreground">
                          {job.postContent || "Media post"}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(job.updatedAt ?? job.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{statusLabel(job.status)}</p>
                      {job.error && <p className="mt-1 line-clamp-2 text-xs text-red-500">{job.error}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm ring-1 ring-border lg:col-span-2">
          <CardHeader>
            <CardTitle>Queue health</CardTitle>
            <CardDescription>Current visible publishing state.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Successful</span>
              <span className="font-semibold text-emerald-600">{successfulJobs.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">In progress</span>
              <span className="font-semibold text-amber-600">{activeJobs.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Failed</span>
              <span className="font-semibold text-red-600">{failedJobs.length}</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
