"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type PendingSyncResult = {
  ok?: boolean;
  results?: Array<{ result?: { status?: string } }>;
  error?: string;
};

export function RefreshPendingPostsButton() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<PendingSyncResult>).detail;
      setIsRefreshing(false);
      if (!detail?.ok) {
        setMessage(detail?.error ?? "Connect the PostFlow extension to refresh statuses.");
        return;
      }

      const published = detail.results?.filter((item) => item.result?.status === "PUBLISHED").length ?? 0;
      setMessage(published ? `${published} post${published === 1 ? "" : "s"} updated.` : "Pending statuses checked.");
      window.setTimeout(() => window.location.reload(), 700);
    };

    window.addEventListener("postflow:pending-sync-finished", onFinished);
    return () => window.removeEventListener("postflow:pending-sync-finished", onFinished);
  }, []);

  function refresh() {
    setIsRefreshing(true);
    setMessage(null);
    window.dispatchEvent(new CustomEvent("postflow:sync-pending-posts"));
  }

  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" onClick={refresh} disabled={isRefreshing}>
        <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
        {isRefreshing ? "Checking..." : "Refresh pending"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
