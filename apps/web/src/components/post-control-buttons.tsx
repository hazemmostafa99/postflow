"use client";

import { useState } from "react";
import { Loader2, Pause, Play, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

type PostAction = "pause" | "resume" | "cancel";

interface ControlJob {
  status: string;
}

interface PostControlButtonsProps {
  postId: string;
  jobs: ControlJob[];
  compact?: boolean;
}

export function PostControlButtons({ postId, jobs, compact = false }: PostControlButtonsProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<PostAction | null>(null);
  const hasPending = jobs.some((job) => job.status === "PENDING");
  const hasPaused = jobs.some((job) => job.status === "PAUSED");
  const hasRunning = jobs.some((job) => job.status === "RUNNING");
  const hasCancelRequested = jobs.some((job) => job.status === "CANCEL_REQUESTED");
  const canCancel = jobs.some((job) =>
    ["PENDING", "PAUSED", "RUNNING", "CANCEL_REQUESTED"].includes(job.status),
  );

  async function runAction(action: PostAction) {
    if (
      action === "cancel" &&
      !window.confirm(
        hasRunning
          ? "Cancel remaining jobs? The group currently publishing may still finish if Facebook already accepted it."
          : "Cancel remaining jobs? This cannot be undone.",
      )
    ) {
      return;
    }

    setPendingAction(action);
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/${action}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Action failed");
      router.refresh();
    } catch {
      window.alert("Could not update this post. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  if (!hasPending && !hasPaused && !canCancel) return null;

  const buttonClass = compact
    ? "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    : "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasPending && (
        <button
          type="button"
          onClick={() => runAction("pause")}
          disabled={pendingAction !== null}
          className={`${buttonClass} border-amber-500/20 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10`}
        >
          {pendingAction === "pause" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
          Pause
        </button>
      )}

      {hasPaused && (
        <button
          type="button"
          onClick={() => runAction("resume")}
          disabled={pendingAction !== null}
          className={`${buttonClass} border-emerald-500/20 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10`}
        >
          {pendingAction === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Resume
        </button>
      )}

      {canCancel && (
        <button
          type="button"
          onClick={() => runAction("cancel")}
          disabled={pendingAction !== null || hasCancelRequested}
          className={`${buttonClass} border-red-500/20 bg-red-500/5 text-red-600 hover:bg-red-500/10`}
        >
          {pendingAction === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          {hasCancelRequested ? "Canceling" : "Cancel"}
        </button>
      )}
    </div>
  );
}
