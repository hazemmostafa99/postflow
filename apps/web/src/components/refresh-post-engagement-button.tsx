"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EngagementResult {
  status?: "QUEUED";
  error?: string;
}

export function RefreshPostEngagementButton({ postId }: { postId: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(postId)}/maintenance-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ENGAGEMENT" }),
      });
      const detail = (await response.json().catch(() => ({}))) as EngagementResult;
      if (!response.ok) {
        setMessage(detail.error ?? "Could not queue analytics refresh.");
        return;
      }
      window.dispatchEvent(new CustomEvent("postflow:refresh-analytics"));
      setMessage("Refresh requested for the owning extension.");
    } catch {
      setMessage("Could not queue analytics refresh.");
    } finally {
      setRefreshing(false);
    }
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

export function RefreshAllPostEngagementButton({ jobIds }: { jobIds: string[] }) {
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshAll() {
    setRefreshing(true);
    setMessage(null);
    try {
      const results = await Promise.all(jobIds.map(async (jobId) => {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/maintenance-request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "ENGAGEMENT" }),
        });
        const detail = (await response.json().catch(() => ({}))) as EngagementResult;
        return response.ok ? { ok: true } : { ok: false, error: detail.error };
      }));
      const queued = results.filter((result) => result.ok).length;
      const firstError = results.find((result) => !result.ok)?.error;
      if (queued > 0) {
        window.dispatchEvent(new CustomEvent("postflow:refresh-analytics"));
      }
      setMessage(queued
        ? `${queued} analytics refresh${queued === 1 ? "" : "es"} queued for the owning extension${firstError ? "; some could not be queued" : "."}`
        : firstError ?? "Could not queue analytics refresh.");
    } catch {
      setMessage("Could not queue analytics refresh.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => {
        void refreshAll();
      }}>
        <RefreshCw className={refreshing ? "animate-spin" : ""} />
        {refreshing ? "Refreshing all..." : "Refresh all analytics"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
