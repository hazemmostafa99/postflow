import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Clock, ExternalLink, Users } from "lucide-react";
import { RefreshGroupStatusButton, RefreshPostStatusControls } from "@/components/refresh-post-status-controls";
import { RefreshPostEngagementButton, RefreshAllPostEngagementButton } from "@/components/refresh-post-engagement-button";

const API_BASE = process.env.API_URL || "http://localhost:8000";

interface Group {
  _id: string;
  name: string;
  url: string;
  externalId?: string;
}

interface Job {
  _id: string;
  groupId: Group;
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
}

interface Post {
  _id: string;
  content: string;
  mediaUrls: string[];
  status: string;
  createdAt: string;
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
  const pendingApproval = jobs.filter((j) => j.submissionStatus === "PENDING_APPROVAL").length;
  const unknown = jobs.filter((j) => j.submissionStatus === "UNKNOWN").length;

  if (pending > 0) {
    return <span className="text-amber-500">Publishing ({pending} remaining)</span>;
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
  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/posts"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Posts
        </Link>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Post Details</h2>
          <div className="flex items-center gap-4 text-sm font-medium">
            <OverallStatusBadge jobs={post.jobs} />
            {post.jobs.some((job) => job.submissionStatus === "PUBLISHED" && job.postUrl) && (
              <RefreshAllPostEngagementButton postId={post._id} />
            )}
            <RefreshPostStatusControls
              jobs={post.jobs.filter((job) => job.submissionStatus === "PENDING_APPROVAL").map((job) => ({
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
        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            Created {timeAgo(post.createdAt)}
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4" />
            {post.jobs.length} target groups
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Content Column */}
        <div className="md:col-span-1 space-y-4">
          <h3 className="text-lg font-medium">Content</h3>
          <div className="p-4 rounded-xl border border-border bg-card shadow-sm">
            {post.content ? (
              <p className="text-sm whitespace-pre-wrap text-foreground">
                {post.content}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Media post</p>
            )}
            {post.mediaUrls?.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {post.mediaUrls.map((url, index) => (
                  <img
                    key={`${post._id}-media-${index}`}
                    src={url}
                    alt=""
                    className="aspect-square w-full rounded-md border border-border object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Jobs Column */}
        <div className="md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Publishing Jobs</h3>
          </div>
          
          <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Group</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Engagement</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Attempts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {post.jobs.map((job) => (
                  <tr key={job._id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-[300px]">
                          {job.groupId.name}
                        </span>
                        {job.error && (
                          <div className="mt-2 flex max-w-[200px] items-start gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-300 sm:max-w-[360px]">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="whitespace-pre-wrap break-words">{job.error}</span>
                          </div>
                        )}
                        <a 
                          href={job.groupId.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                        >
                          View Group <ExternalLink className="w-3 h-3" />
                        </a>
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
                          <RefreshPostEngagementButton postId={job._id} postUrl={job.postUrl} />
                        )}
                        {(job.submissionStatus === "PENDING_APPROVAL" ||
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
                      <JobStatusBadge job={job} />
                    </td>
                    <td className="px-4 py-3 align-top pt-4">
                      {job.engagement ? (
                        <div className="space-y-1 text-xs">
                          <div className="flex gap-3 text-foreground">
                            <span>{job.engagement.reactionCount ?? "—"} reactions</span>
                            <span>{job.engagement.commentCount ?? "—"} comments</span>
                          </div>
                          <div className="text-muted-foreground">
                            Updated {timeAgo(job.engagement.lastSyncedAt)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not synced</span>
                      )}
                      {job.lastEngagementSyncError && (
                        <div className="mt-1 max-w-56 text-xs text-red-400">{job.lastEngagementSyncError}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top pt-4 text-right text-muted-foreground">
                      {job.attempts > 0 ? job.attempts : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
