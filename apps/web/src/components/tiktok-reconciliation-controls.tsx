"use client";

import { useState } from "react";

export function TikTokReconciliationControls({ jobId, status, postUrl, reason }: {
  jobId: string; status: "PROCESSING" | "UNKNOWN"; postUrl?: string; reason?: string;
}) {
  const [url, setUrl] = useState(postUrl ?? "");
  const [note, setNote] = useState(reason ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (nextStatus: "PUBLISHED" | "PROCESSING" | "UNKNOWN") => {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/tiktok-reconciliation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, ...(url.trim() ? { postUrl: url.trim() } : {}), ...(note.trim() ? { reason: note.trim() } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.message || "Could not update TikTok status");
      setMessage(nextStatus === "PUBLISHED" ? "Marked published." : nextStatus === "PROCESSING" ? "Still processing recorded." : "Left as unknown.");
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update TikTok status"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
      <p className="font-medium">TikTok needs manual confirmation. This never republishes the job.</p>
      <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.tiktok.com/@account/video/123" className="h-9 w-full rounded-md border border-amber-200 bg-background px-2.5 text-foreground outline-none focus:ring-2 focus:ring-amber-400/30" />
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={status === "PROCESSING" ? "Optional processing note" : "Why the result is still unknown"} className="h-9 w-full rounded-md border border-amber-200 bg-background px-2.5 text-foreground outline-none focus:ring-2 focus:ring-amber-400/30" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !url.trim()} onClick={() => submit("PUBLISHED")} className="rounded-md bg-amber-700 px-2.5 py-1.5 font-medium text-white disabled:opacity-50">Confirm published</button>
        {status === "PROCESSING" && <button type="button" disabled={busy} onClick={() => submit("PROCESSING")} className="rounded-md border border-amber-300 px-2.5 py-1.5 font-medium disabled:opacity-50">Still processing</button>}
        <button type="button" disabled={busy} onClick={() => submit("UNKNOWN")} className="rounded-md border border-amber-300 px-2.5 py-1.5 font-medium disabled:opacity-50">Keep unknown</button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
