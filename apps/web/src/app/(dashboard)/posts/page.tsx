import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, Clock, FileText, Image as ImageIcon, Users } from "lucide-react";
import { NewPostDialog } from "@/components/new-post-dialog";
import { ScheduledTime } from "@/components/scheduled-time";

const API_BASE = process.env.API_URL || "http://localhost:8000";
const POSTS_PER_PAGE = 10;

interface Job {
  _id: string;
  status: string;
  submissionStatus?: "PUBLISHED" | "PENDING_APPROVAL" | "UNKNOWN";
  postUrl?: string;
  submissionReason?: string;
  error?: string;
  scheduledFor?: string;
}

interface Post {
  _id: string;
  content: string;
  mediaCount: number;
  status: string;
  createdAt: string;
  jobs: Job[];
}

interface PostsResponse {
  posts: Post[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function emptyPostsResponse(page: number): PostsResponse {
  return {
    posts: [],
    pagination: { page, limit: POSTS_PER_PAGE, total: 0, totalPages: 1 },
  };
}

async function fetchPosts(clerkUserId: string, page: number): Promise<PostsResponse> {
  try {
    const url = new URL(`${API_BASE}/api/posts`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(POSTS_PER_PAGE));

    const res = await fetch(url.toString(), {
      headers: { "x-clerk-user-id": clerkUserId },
      cache: "no-store",
    });
    if (!res.ok) return emptyPostsResponse(page);
    return res.json();
  } catch {
    return emptyPostsResponse(page);
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

function PostStatusBadge({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-500/20 bg-zinc-500/10 px-2.5 py-0.5 text-xs font-medium text-zinc-500">
        Draft
      </span>
    );
  }

  const success = jobs.filter((j) => j.status === "SUCCESS").length;
  const failed = jobs.filter((j) => j.status === "FAILED").length;
  const pending = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING").length;
  const pendingApproval = jobs.filter((j) => j.submissionStatus === "PENDING_APPROVAL").length;
  const unknown = jobs.filter((j) => j.submissionStatus === "UNKNOWN").length;

  if (pending > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        Pending ({pending})
      </span>
    );
  }
  if (pendingApproval > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {pendingApproval === jobs.length ? "Pending approval" : `Approval pending (${pendingApproval})`}
      </span>
    );
  }
  if (unknown > 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-500/20 bg-zinc-500/10 px-2.5 py-0.5 text-xs font-medium text-zinc-500">
        Status unknown
      </span>
    );
  }
  if (failed > 0 && success > 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-orange-500/20 bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-600">
        Partial ({success}/{jobs.length})
      </span>
    );
  }
  if (failed === jobs.length) {
    return (
      <span className="inline-flex items-center rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-600">
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Published
    </span>
  );
}

function getFailureReason(jobs: Job[]): string | null {
  const failedJob = jobs.find((job) => job.status === "FAILED" && job.error?.trim());
  return failedJob?.error?.trim() ?? null;
}

function getScheduledTime(jobs: Job[]): string | undefined {
  return jobs
    .map((job) => job.scheduledFor)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
}

export const metadata = {
  title: "Posts - PostFlow",
  description: "Manage and track your published Facebook Group posts.",
};

export default async function PostsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const page = Math.max(1, Number(resolvedSearchParams?.page ?? 1) || 1);
  const postsResult = await fetchPosts(userId, page);
  const { posts, pagination } = postsResult;
  const visibleJobs = posts.reduce((total, post) => total + post.jobs.length, 0);
  const activeJobs = posts.flatMap((post) => post.jobs).filter((job) => job.status === "PENDING" || job.status === "RUNNING").length;

  return (
    <div className="page-shell">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Total posts</p>
          <p className="mt-2 text-2xl font-semibold">{pagination.total.toLocaleString()}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Visible jobs</p>
          <p className="mt-2 text-2xl font-semibold">{visibleJobs.toLocaleString()}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Active now</p>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{activeJobs.toLocaleString()}</p>
        </div>
      </section>

      {posts.length === 0 ? (
        <div className="surface flex flex-col items-center justify-center border-dashed py-28 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-7 w-7" />
          </div>
          <p className="text-base font-semibold text-foreground">No posts yet</p>
          <p className="mt-1 mb-6 max-w-sm text-sm text-muted-foreground">
            Create your first post and publish it to your synced groups.
          </p>
          <NewPostDialog label="Create Post" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">Content</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">Groups</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">Scheduled</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-normal text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {posts.map((post) => {
                  const failureReason = getFailureReason(post.jobs);
                  const scheduledFor = getScheduledTime(post.jobs);
                  return (
                    <tr key={post._id} className="transition-colors hover:bg-accent/70">
                      <td className="max-w-xs px-4 py-4">
                        <p className="truncate font-medium text-foreground">{post.content || "Media post"}</p>
                        {post.mediaCount > 0 && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                            <ImageIcon className="h-3.5 w-3.5" />
                            {post.mediaCount}
                          </span>
                        )}
                        {failureReason && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-600">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="line-clamp-2">{failureReason}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Users className="h-3.5 w-3.5" />
                          <span>{post.jobs.length} {post.jobs.length === 1 ? "group" : "groups"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <PostStatusBadge jobs={post.jobs} />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{timeAgo(post.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <ScheduledTime value={scheduledFor} className="text-muted-foreground" />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={`/posts/${post._id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                        >
                          View
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{pagination.total.toLocaleString()} posts - page {pagination.page} of {pagination.totalPages}</span>
            <div className="flex items-center gap-2">
              <Link
                href={pagination.page > 1 ? `/posts?page=${pagination.page - 1}` : "#"}
                aria-disabled={pagination.page <= 1}
                className={`rounded-lg border border-border bg-card px-3 py-1.5 transition-colors ${
                  pagination.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-accent"
                }`}
              >
                Previous
              </Link>
              <Link
                href={pagination.page < pagination.totalPages ? `/posts?page=${pagination.page + 1}` : "#"}
                aria-disabled={pagination.page >= pagination.totalPages}
                className={`rounded-lg border border-border bg-card px-3 py-1.5 transition-colors ${
                  pagination.page >= pagination.totalPages ? "pointer-events-none opacity-40" : "hover:bg-accent"
                }`}
              >
                Next
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
