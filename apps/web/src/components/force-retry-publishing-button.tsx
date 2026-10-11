"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

export function ForceRetryPublishingButton({ jobId }: { jobId: string }) {
  const [retrying, setRetrying] = useState(false);

  async function forceRetry() {
    const confirmed = window.confirm(
      "I checked TikTok Studio Content and confirmed this post does not exist. Force retry it? TikTok may still accept a delayed submission, which could create a duplicate.",
    );
    if (!confirmed) return;
    setRetrying(true);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/force-retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmNoPost: true }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || payload.message || "Force retry failed");
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not force-retry this TikTok post. Please try again.");
      setRetrying(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void forceRetry()}
      disabled={retrying}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
      title="Use only after confirming that TikTok Studio Content does not show the post"
    >
      {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {retrying ? "Requeuing..." : "Force retry (no post)"}
      {!retrying && <RotateCcw className="h-3.5 w-3.5" />}
    </button>
  );
}
