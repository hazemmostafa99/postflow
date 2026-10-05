"use client";

import { useMemo, useState } from "react";
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

async function requestPendingRefresh(jobId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/maintenance-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "PENDING_APPROVAL" }),
    });
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    return response.ok
      ? { ok: true }
      : { ok: false, error: detail.error ?? "Could not queue pending-status refresh." };
  } catch {
    return { ok: false, error: "Could not queue pending-status refresh." };
  }
}

export function RefreshPostStatusControls({
  jobs,
}: {
  jobs: RefreshJob[];
}) {
  const pendingJobs = useMemo(() => jobs, [jobs]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!pendingJobs.length) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={activeJobId !== null}
        onClick={() => {
          setMessage(null);
          setActiveJobId(pendingJobs[0].id);
          void requestPendingRefresh(pendingJobs[0].id).then((result) => {
            setActiveJobId(null);
            setMessage(result.ok
              ? "Refresh requested for the owning extension."
              : result.error ?? "Could not queue pending-status refresh.");
          });
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

  return (
    <div className="mt-2 flex items-center gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={isRefreshing} onClick={() => {
        setIsRefreshing(true);
        setMessage(null);
        void requestPendingRefresh(job.id).then((result) => {
          setIsRefreshing(false);
          setMessage(result.ok
            ? "Refresh requested for the owning extension."
            : result.error ?? "Could not queue pending-status refresh.");
        });
      }}>
        <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
        {isRefreshing ? "Checking..." : (job.postUrl ? "Check approval status" : "Find post link")}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
