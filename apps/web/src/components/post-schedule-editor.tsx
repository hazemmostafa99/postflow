"use client";

import { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";

interface ScheduleJob {
  _id: string;
  targetLabel: string;
  status: string;
  submissionStatus?: "PUBLISHED" | "PENDING_APPROVAL" | "PROCESSING" | "UNKNOWN";
  scheduledFor?: string;
}

interface PostScheduleEditorProps {
  postId: string;
  startTime?: string;
  jobs: ScheduleJob[];
  readOnly?: boolean;
}

function toLocalInputValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatLocalTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function PostScheduleEditor({
  postId,
  startTime: initialStartTime,
  jobs,
  readOnly = false,
}: PostScheduleEditorProps) {
  const router = useRouter();
  const [startTime, setStartTime] = useState(() => toLocalInputValue(initialStartTime));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasPendingApproval = jobs.some((job) => job.submissionStatus === "PENDING_APPROVAL");

  const preview = useMemo(() => {
    if (readOnly) {
      return jobs.flatMap((job) => {
        if (!job.scheduledFor) return [];
        const scheduledAt = new Date(job.scheduledFor);
        return Number.isNaN(scheduledAt.getTime())
          ? []
          : [{ ...job, timing: formatLocalTime(scheduledAt) }];
      });
    }

    const start = startTime ? new Date(startTime) : null;
    const firstTiming = start && !Number.isNaN(start.getTime())
      ? formatLocalTime(start)
      : "Immediately";
    return jobs.filter((job) => job.status === "PENDING").map((job, index) => ({
      ...job,
      timing: index === 0 ? firstTiming : "30–120 sec after previous",
    }));
  }, [jobs, readOnly, startTime]);

  const saveSchedule = async () => {
    setMessage(null);
    setError(null);
    if (readOnly) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: startTime ? new Date(startTime).toISOString() : null,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.message ?? "Could not update the schedule.");
        return;
      }

      setMessage(`${data?.updatedJobs ?? 0} future job${data?.updatedJobs === 1 ? "" : "s"} updated.`);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="surface space-y-4 p-4">
      <div>
        <h3 className="text-lg font-medium">Schedule</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {readOnly
            ? hasPendingApproval
              ? "Jobs are already published or pending approval. This schedule is read-only."
              : "There are no future pending jobs. This schedule is read-only."
            : "Only future pending jobs are changed. Published jobs keep their original schedule."}
        </p>
      </div>

      <div className="space-y-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Start time</span>
          <input
            type="datetime-local"
            value={startTime}
            disabled={readOnly}
            onChange={(event) => setStartTime(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-3 focus:ring-ring/20"
          />
        </label>
        {!readOnly && (
          <p className="text-xs text-muted-foreground">
            Leave blank to start now. Remaining destinations will be spaced 30–120 seconds apart.
          </p>
        )}
      </div>

      {preview.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
          <p className="mb-2 font-medium text-muted-foreground">Preview for future jobs</p>
          <div className="space-y-1">
            {preview.map((job) => (
              <div key={job._id} className="flex justify-between gap-4">
                <span className="truncate">{job.targetLabel}</span>
                <span className="shrink-0 text-muted-foreground">{job.timing}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(error || message) && (
        <p className={`text-xs ${error ? "text-red-600" : "text-emerald-600"}`}>
          {error ?? message}
        </p>
      )}

      {!readOnly && (
        <button
          type="button"
          onClick={saveSchedule}
          disabled={isSaving}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? "Saving..." : "Save schedule"}
        </button>
      )}
    </section>
  );
}
