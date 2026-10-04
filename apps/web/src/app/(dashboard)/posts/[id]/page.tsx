import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Clock, ExternalLink, UserRound, Users } from "lucide-react";
import { RefreshGroupStatusButton, RefreshPostStatusControls } from "@/components/refresh-post-status-controls";
import { RefreshPostEngagementButton, RefreshAllPostEngagementButton } from "@/components/refresh-post-engagement-button";
import { ScheduledTime } from "@/components/scheduled-time";
import { PostScheduleEditor } from "@/components/post-schedule-editor";
import { PostControlButtons } from "@/components/post-control-buttons";

const API_BASE = process.env.API_URL || "http://localhost:8000";

interface Group {
  _id: string;
  name: string;
  url: string;
  externalId?: string;
}

interface FacebookConnection {
  _id: string;
  displayName?: string;
  facebookUserId?: string;
}

interface Job {
  _id: string;
  targetType?: "GROUP" | "PROFILE_FEED";
  groupId?: Group;
  facebookConnectionId?: FacebookConnection | string;
  status: string;
  submissionStatus?: "PUBLISHED" | "PENDING_APPROVAL" | "UNKNOWN";
  postUrl?: string;
  submissionReason?: string;
  attempts: number;
  error?: string;
  completedAt?: string;
  submittedAt?: string;
  engagement?: {
    reactionCount?: number;
    commentCount?: number;
    lastSyncedAt: string;
  };
  lastEngagementSyncAt?: string;
  lastEngagementSyncError?: string;
  scheduledFor?: string;
}

interface Post {
  _id: string;
  content: string;
  mediaUrls: string[];
  status: string;
  createdAt: string;
  createdBy?: {
    clerkUserId: string;
    userId?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    role?: string;
    status?: string;
    teamId?: string | null;
  };
  startTime?: string;
  jobs: Job[];
}

async function fetchPost(clerkUserId: string, postId: string): Promise<Post | null> {
  try {
    const res = await fetch(`${API_BASE}/api/posts/${postId}`, {
      headers: { "x-clerk-user-id": clerkUserId },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
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

function getCreatorLabel(createdBy?: Post["createdBy"]): string {
  return createdBy?.fullName || createdBy?.email || createdBy?.clerkUserId || "Unknown";
}

function isProfileJob(job: Job): boolean {
  return job.targetType === "PROFILE_FEED" || (!job.groupId && Boolean(job.facebookConnectionId));
}

function isGroupJob(job: Job): job is Job & { groupId: Group } {
  return !isProfileJob(job) && Boolean(job.groupId);
}

function getProfileLabel(connection?: FacebookConnection | string): string {
  if (connection && typeof connection === "object") {
    if (connection.displayName) return connection.displayName;
    if (connection.facebookUserId) return `Facebook ending ${connection.facebookUserId.slice(-4)}`;
  }
  return "Facebook profile feed";
}

function getTargetLabel(job: Job): string {
  return isProfileJob(job) ? `${getProfileLabel(job.facebookConnectionId)} · Profile feed` : job.groupId?.name ?? "Facebook group";
}

function getTargetSummary(jobs: Job[]): string {
  const profileCount = jobs.filter(isProfileJob).length;
  const groupCount = jobs.filter(isGroupJob).length;
  if (profileCount && groupCount) return `${groupCount} groups · ${profileCount} profile feeds`;
  if (profileCount) return `${profileCount} profile feed${profileCount === 1 ? "" : "s"}`;
  return `${groupCount} group${groupCount === 1 ? "" : "s"}`;
}

function JobStatusBadge({ job }: { job: Job }) {
  const { status } = job;
  if (status === "PENDING" || status === "RUNNING") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        {status === "RUNNING" ? "Running" : "Pending"}
      </span>
    );
  }
  if (status === "PAUSED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
        Paused
      </span>
    );
  }
  if (status === "CANCEL_REQUESTED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
        Canceling
      </span>
    );
  }
  if (status === "CANCELED") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
        Canceled
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
        Failed
      </span>
    );
  }
  if (job.submissionStatus === "PENDING_APPROVAL") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
        Pending approval
      </span>
    );
  }
  if (job.submissionStatus === "UNKNOWN") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
        Status unknown
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      Success
    </span>
  );
}

function OverallStatusBadge({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) {
    return <span className="text-zinc-500">Draft</span>;
  }
  const success = jobs.filter((j) => j.status === "SUCCESS").length;
  const failed = jobs.filter((j) => j.status === "FAILED").length;
  const pending = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING").length;
  const paused = jobs.filter((j) => j.status === "PAUSED").length;
  const canceled = jobs.filter((j) => j.status === "CANCELED").length;
  const cancelRequested = jobs.filter((j) => j.status === "CANCEL_REQUESTED").length;
  const pendingApproval = jobs.filter((j) => j.submissionStatus === "PENDING_APPROVAL").length;
  const unknown = jobs.filter((j) => j.submissionStatus === "UNKNOWN").length;

  if (cancelRequested > 0) {
    return <span className="text-red-500">Canceling current job</span>;
  }
  if (pending > 0) {
    return <span className="text-amber-500">Publishing ({pending} remaining)</span>;
  }
  if (paused > 0) {
    return <span className="text-sky-500">Paused ({paused} remaining)</span>;
  }
  if (pendingApproval > 0) {
    return <span className="text-amber-500">Pending approval ({pendingApproval})</span>;
  }
  if (unknown > 0) {
    return <span className="text-zinc-500">Submission status unknown</span>;
  }
  if (failed > 0 && success > 0) {
    return <span className="text-orange-500">Partial Success ({success}/{jobs.length})</span>;
  }
  if (failed === jobs.length) {
    return <span className="text-red-500">Failed</span>;
  }
  if (canceled === jobs.length) {
    return <span className="text-zinc-500">Canceled</span>;
  }
  if (canceled > 0) {
    return <span className="text-zinc-500">Stopped ({jobs.length - canceled}/{jobs.length})</span>;
  }
  return <span className="text-emerald-500">Published</span>;
}

export const metadata = {
  title: "Post Details — PostFlow",
};

export default async function PostDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const post = await fetchPost(userId, id);
  if (!post) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <h2 className="text-xl font-bold">Post not found</h2>
        <p className="text-muted-foreground mt-2">The post you are looking for does not exist or you do not have permission to view it.</p>
        <Link href="/posts" className="text-primary hover:underline mt-4">Return to Posts</Link>
      </div>
    );
  }
  const groupJobs = post.jobs.filter(isGroupJob);
  const publishedEngagementJobs = post.jobs.filter(
    (job) => job.submissionStatus === "PUBLISHED" && job.postUrl,
  );
  const pendingGroupJobs = groupJobs.filter(
    (job) => job.submissionStatus === "PENDING_APPROVAL",
  );

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="space-y-4">
        <Link
          href="/posts"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Posts
        </Link>
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/85 p-4 shadow-sm sm:p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">Post Details</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                Created {timeAgo(post.createdAt)}
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <UserRound className="h-4 w-4 shrink-0" />
                <span className="truncate">By {getCreatorLabel(post.createdBy)}</span>
                {post.createdBy?.role && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{post.createdBy.role}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                {getTargetSummary(post.jobs)}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 text-sm font-medium sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
            <OverallStatusBadge jobs={post.jobs} />
            <PostControlButtons postId={post._id} jobs={post.jobs} />
            {publishedEngagementJobs.length > 0 && (
              <RefreshAllPostEngagementButton postId={post._id} />
            )}
            <RefreshPostStatusControls
              jobs={pendingGroupJobs.map((job) => ({
                id: job._id,
                groupId: job.groupId._id,
                groupExternalId: job.groupId.externalId,
                groupUrl: job.groupId.url,
                content: post.content,
                submittedAt: job.submittedAt ?? post.createdAt,
                postUrl: job.postUrl,
              }))}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(280px,360px)_1fr]">
        {/* Content Column */}
        <section className="space-y-3">
          <h3 className="text-lg font-medium">Content</h3>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            {post.content ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                {post.content}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Media post</p>
            )}
            {post.mediaUrls?.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                {post.mediaUrls.map((url, index) => (
                  url.startsWith("data:video/") ? (
                    <video
                      key={`${post._id}-media-${index}`}
                      src={url}
                      controls
                      className="aspect-square w-full rounded-md border border-border bg-muted object-cover"
                    />
                  ) : (
                    <img
                      key={`${post._id}-media-${index}`}
                      src={url}
                      alt=""
                      className="aspect-square w-full rounded-md border border-border bg-muted object-cover"
                    />
                  )
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Jobs Column */}
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Publishing Jobs</h3>
          </div>

          <div className="space-y-3 lg:hidden">
            {post.jobs.map((job) => {
              const groupJob = isGroupJob(job);
              return (
                <article key={job._id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-foreground">{getTargetLabel(job)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {groupJob && (
                          <a
                            href={job.groupId.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            View Group <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {job.postUrl && (
                          <a
                            href={job.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline"
                          >
                            View Facebook post <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <JobStatusBadge job={job} />
                  </div>

                  {job.error && (
                    <div className="mt-3 flex items-start gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="whitespace-pre-wrap break-words">{job.error}</span>
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                    <div>
                      <p className="font-medium text-muted-foreground">Scheduled</p>
                      <ScheduledTime value={job.scheduledFor} className="mt-1 block text-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Engagement</p>
                      {job.engagement ? (
                        <div className="mt-1 space-y-1 text-foreground">
                          <p>{job.engagement.reactionCount ?? "-"} reactions</p>
                          <p>{job.engagement.commentCount ?? "-"} comments</p>
                          <p className="text-muted-foreground">Updated {timeAgo(job.engagement.lastSyncedAt)}</p>
                        </div>
                      ) : (
                        <p className="mt-1 text-foreground">Not synced</p>
                      )}
                      {job.lastEngagementSyncError && (
                        <p className="mt-1 break-words text-red-500">{job.lastEngagementSyncError}</p>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Attempts</p>
                      <p className="mt-1 text-foreground">{job.attempts > 0 ? job.attempts : "-"}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    {job.submissionStatus === "PUBLISHED" && job.postUrl && (
                      <RefreshPostEngagementButton postId={job._id} />
                    )}
                    {groupJob && (job.submissionStatus === "PENDING_APPROVAL" ||
                      (job.submissionStatus === "PUBLISHED" && (!job.postUrl || job.postUrl.includes("/pending_posts/")))) && (
                      <RefreshGroupStatusButton job={{
                        id: job._id,
                        groupId: job.groupId._id,
                        groupExternalId: job.groupId.externalId,
                        groupUrl: job.groupId.url,
                        content: post.content,
                        submittedAt: job.submittedAt ?? post.createdAt,
                        postUrl: job.postUrl,
                      }} />
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Target</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Scheduled</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Engagement</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Attempts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {post.jobs.map((job) => {
                  const groupJob = isGroupJob(job);
                  return (
                  <tr key={job._id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-[300px]">
                          {getTargetLabel(job)}
                        </span>
                        {job.error && (
                          <div className="mt-2 flex max-w-[360px] items-start gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="whitespace-pre-wrap break-words">{job.error}</span>
                          </div>
                        )}
                        {groupJob && (
                          <a
                            href={job.groupId.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                          >
                            View Group <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {job.postUrl && (
                          <a
                            href={job.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-amber-500 hover:underline inline-flex items-center gap-1 mt-1"
                          >
                            View Facebook post <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {job.submissionStatus === "PUBLISHED" && job.postUrl && (
                          <RefreshPostEngagementButton postId={job._id} />
                        )}
                        {groupJob && (job.submissionStatus === "PENDING_APPROVAL" ||
                          (job.submissionStatus === "PUBLISHED" && (!job.postUrl || job.postUrl.includes("/pending_posts/")))) && (
                          <RefreshGroupStatusButton job={{
                            id: job._id,
                            groupId: job.groupId._id,
                            groupExternalId: job.groupId.externalId,
                            groupUrl: job.groupId.url,
                            content: post.content,
                            submittedAt: job.submittedAt ?? post.createdAt,
                            postUrl: job.postUrl,
                          }} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top pt-4">
                      <ScheduledTime value={job.scheduledFor} className="text-xs text-muted-foreground" />
                    </td>
                    <td className="px-4 py-3 align-top pt-4">
                      <JobStatusBadge job={job} />
                    </td>
                    <td className="px-4 py-3 align-top pt-4">
                      {job.engagement ? (
                        <div className="space-y-1 text-xs">
                          <div className="flex gap-3 text-foreground">
                            <span>{job.engagement.reactionCount ?? "-"} reactions</span>
                            <span>{job.engagement.commentCount ?? "-"} comments</span>
                          </div>
                          <div className="text-muted-foreground">
                            Updated {timeAgo(job.engagement.lastSyncedAt)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not synced</span>
                      )}
                      {job.lastEngagementSyncError && (
                        <div className="mt-1 max-w-56 break-words text-xs text-red-500">{job.lastEngagementSyncError}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top pt-4 text-right text-muted-foreground">
                      {job.attempts > 0 ? job.attempts : '-'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <PostScheduleEditor
        postId={post._id}
        startTime={post.startTime}
        readOnly={post.jobs.length > 0 && !post.jobs.some((job) => job.status === "PENDING")}
        jobs={post.jobs
          .map((job) => ({
            _id: job._id,
            targetLabel: getTargetLabel(job),
            status: job.status,
            submissionStatus: job.submissionStatus,
            scheduledFor: job.scheduledFor,
          }))}
      />
    </div>
  );
}
