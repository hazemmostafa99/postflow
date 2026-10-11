"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

export function RetryPublishingButton({ jobId }: { jobId: string }) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (!window.confirm("Retry this failed post? A new publishing attempt will be queued.")) return;
    setRetrying(true);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Retry failed");
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not retry this post. Please try again.");
      setRetrying(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void retry()}
      disabled={retrying}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      {retrying ? "Retrying..." : "Retry publish"}
    </button>
  );
}
