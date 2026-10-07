"use client";

import { FormEvent, useRef, useState } from "react";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";

/** Display labels for the stored qualification status values. */
export const LEAD_QUALIFICATION_STATUSES = [
  { value: "UNREVIEWED", label: "Needs review" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "NOT_QUALIFIED", label: "Not qualified" },
] as const;

export type LeadQualificationStatus =
  (typeof LEAD_QUALIFICATION_STATUSES)[number]["value"];

/** Friendly label for a stored status, defaulting legacy/unknown values to the needs-review label. */
export function leadStatusLabel(
  status?: LeadQualificationStatus | null | string,
): string {
  return (
    LEAD_QUALIFICATION_STATUSES.find((option) => option.value === status)
      ?.label ?? "Needs review"
  );
}

const NOTES_MAX_LENGTH = 2000;

/** Extracts the server's message field from a failed response body. */
export function responseMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  }
  return fallback;
}

interface LeadEditorProps {
  mode: "create" | "edit";
  id?: string;
  initialNumber?: string;
  initialCategory?: string;
  initialGroup?: string;
  initialStatus?: LeadQualificationStatus;
  initialNotes?: string;
  /** When provided, the dialog reports the saved lead instead of refreshing the route. */
  onSaved?: (data: unknown) => void;
}

export function LeadEditor({
  mode,
  id,
  initialNumber = "",
  initialCategory = "",
  initialGroup = "",
  initialStatus = "UNREVIEWED",
  initialNotes = "",
  onSaved,
}: LeadEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [number, setNumber] = useState(initialNumber);
  const [category, setCategory] = useState(initialCategory);
  const [group, setGroup] = useState(initialGroup);
  const [status, setStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isCreate = mode === "create";

  function open() {
    setNumber(initialNumber);
    setCategory(initialCategory);
    setGroup(initialGroup);
    setStatus(isCreate ? "UNREVIEWED" : initialStatus);
    setNotes(isCreate ? "" : initialNotes);
    setError("");
    dialogRef.current?.showModal();
  }

  function close() {
    if (!saving) dialogRef.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const endpoint = isCreate
        ? "/api/phone-contacts"
        : `/api/phone-contacts/${encodeURIComponent(id!)}`;
      const response = await fetch(endpoint, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number,
          category,
          group,
          qualificationStatus: status,
          notes,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Could not save this phone number."));
      dialogRef.current?.close();
      if (onSaved) onSaved(data);
      else router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this phone number.");
    } finally {
      setSaving(false);
    }
  }

  const notesRemaining = NOTES_MAX_LENGTH - notes.length;

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={isCreate
          ? "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}
        aria-label={isCreate ? undefined : `Edit ${initialNumber}`}
      >
        {isCreate ? <><Plus className="h-4 w-4" /> Add number</> : <Pencil className="h-3.5 w-3.5" />}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={isCreate ? "add-lead-title" : "edit-lead-title"}
        className="m-auto w-[min(460px,calc(100%-2rem))] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/40"
      >
        <form onSubmit={submit} className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="page-kicker">Leads</p>
              <h2 id={isCreate ? "add-lead-title" : "edit-lead-title"} className="mt-1 text-lg font-semibold">
                {isCreate ? "Add phone number" : "Edit phone number"}
              </h2>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              Phone number
              <input
                type="tel"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder="+20 100 123 4567"
                maxLength={40}
                required
                autoFocus
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Category <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              <input
                type="text"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="e.g. Facebook Marketplace"
                maxLength={80}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Group <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              <input
                type="text"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                placeholder="e.g. Villas"
                maxLength={80}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Qualification status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as LeadQualificationStatus)}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {LEAD_QUALIFICATION_STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Notes
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Context about this lead, e.g. buying intent, budget, follow-up details"
                maxLength={NOTES_MAX_LENGTH}
                rows={4}
                className="resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-right text-xs text-muted-foreground">
                {notesRemaining.toLocaleString()}/{NOTES_MAX_LENGTH.toLocaleString()} characters remaining
              </span>
            </label>
          </div>

          {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} disabled={saving} className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCreate ? "Add number" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function AddLeadButton({ onSaved }: { onSaved?: (data: unknown) => void }) {
  return <LeadEditor mode="create" onSaved={onSaved} />;
}
