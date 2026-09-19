"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RefreshJob {
  id: string;
  groupId: string;
  groupExternalId?: string;
  groupUrl: string;
  content: string;
  submittedAt: string;
  postUrl?: string;
}

interface RefreshResultEvent {
  postId?: string;
  ok?: boolean;
  updated?: boolean;
  result?: { status?: string };
  error?: string;
}

function refreshJob(job: RefreshJob) {
  window.dispatchEvent(new CustomEvent("postflow:sync-pending-post", { detail: job }));
}

export function RefreshPostStatusControls({
  jobs,
}: {
  jobs: RefreshJob[];
}) {
  const pendingJobs = useMemo(() => jobs, [jobs]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<RefreshResultEvent>).detail;
      if (detail?.postId !== activeJobId) return;
      setActiveJobId(null);
      if (!detail.ok || detail.updated === false) {
        setMessage(detail.error ?? "Connect the PostFlow extension to refresh this post.");
        return;
      }
      setMessage(detail.result?.status === "PUBLISHED" ? "Published status confirmed." : "Still pending approval.");
      window.setTimeout(() => window.location.reload(), 700);
    };

    window.addEventListener("postflow:pending-sync-finished", onFinished);
    return () => window.removeEventListener("postflow:pending-sync-finished", onFinished);
  }, [activeJobId]);

  if (!pendingJobs.length) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={activeJobId !== null}
        onClick={() => {
          setMessage(null);
          refreshJob(pendingJobs[0]);
          setActiveJobId(pendingJobs[0].id);
        }}
      >
        <RefreshCw className={activeJobId ? "animate-spin" : ""} />
        {activeJobId ? "Checking..." : (pendingJobs[0].postUrl ? "Check approval status" : "Refresh pending")}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}

export function RefreshGroupStatusButton({ job }: { job: RefreshJob }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<RefreshResultEvent>).detail;
      if (detail?.postId !== job.id) return;
      setIsRefreshing(false);
      setMessage(detail.ok && detail.updated !== false ? (detail.result?.status === "PUBLISHED" ? "Post link found" : "Still pending") : (detail.error ?? "Refresh failed"));
      window.setTimeout(() => window.location.reload(), 700);
    };
    window.addEventListener("postflow:pending-sync-finished", onFinished);
    return () => window.removeEventListener("postflow:pending-sync-finished", onFinished);
  }, [job.id]);

  return (
    <div className="mt-2 flex items-center gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={isRefreshing} onClick={() => {
        setIsRefreshing(true);
        setMessage(null);
        refreshJob(job);
      }}>
        <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
        {isRefreshing ? "Checking..." : (job.postUrl ? "Check approval status" : "Find post link")}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
