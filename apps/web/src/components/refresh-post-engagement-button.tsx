"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EngagementResult {
  ok?: boolean;
  result?: { status?: "SUCCESS" | "PARTIAL" | "CHECK_FAILED"; reason?: string };
  error?: string;
}

export function RefreshPostEngagementButton({ postId, postUrl }: { postId: string; postUrl: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<EngagementResult>).detail;
      setRefreshing(false);
      if (!detail?.ok) {
        setMessage(detail?.error ?? "Connect the PostFlow extension to refresh analytics.");
        return;
      }
      const status = detail.result?.status;
      setMessage(status === "SUCCESS" ? "Analytics refreshed." : detail.result?.reason ?? "Analytics partially refreshed.");
      if (status === "SUCCESS" || status === "PARTIAL") {
        window.setTimeout(() => window.location.reload(), 700);
      }
    };
    window.addEventListener("postflow:engagement-sync-finished", onFinished);
    return () => window.removeEventListener("postflow:engagement-sync-finished", onFinished);
  }, []);

  function refresh() {
    setRefreshing(true);
    setMessage(null);
    window.dispatchEvent(new CustomEvent("postflow:sync-post-engagement", {
      detail: { id: postId, postUrl },
    }));
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
        <RefreshCw className={refreshing ? "animate-spin" : ""} />
        {refreshing ? "Refreshing..." : "Refresh analytics"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}

export function RefreshAllPostEngagementButton({ postId }: { postId: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<{ ok?: boolean; results?: Array<{ result?: { status?: string } }>; error?: string }>).detail;
      setRefreshing(false);
      if (!detail?.ok) {
        setMessage(detail?.error ?? "Connect the PostFlow extension to refresh analytics.");
        return;
      }
      const results = detail.results ?? [];
      const succeeded = results.filter((item) => item.result?.status === "SUCCESS").length;
      const failed = results.length - succeeded;
      setMessage(`${succeeded} refreshed${failed ? `, ${failed} failed` : ""}.`);
      if (succeeded) window.setTimeout(() => window.location.reload(), 700);
    };
    window.addEventListener("postflow:engagement-sync-finished", onFinished);
    return () => window.removeEventListener("postflow:engagement-sync-finished", onFinished);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => {
        setRefreshing(true);
        setMessage(null);
        window.dispatchEvent(new CustomEvent("postflow:sync-post-engagement", { detail: { postId } }));
      }}>
        <RefreshCw className={refreshing ? "animate-spin" : ""} />
        {refreshing ? "Refreshing all..." : "Refresh all analytics"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
