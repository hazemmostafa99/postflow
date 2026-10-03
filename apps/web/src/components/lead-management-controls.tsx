"use client";

import { FormEvent, useRef, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

interface LeadEditorProps {
  mode: "create" | "edit";
  id?: string;
  initialNumber?: string;
  initialCategory?: string;
}

function responseMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  }
  return fallback;
}

function LeadEditor({ mode, id, initialNumber = "", initialCategory = "" }: LeadEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [number, setNumber] = useState(initialNumber);
  const [category, setCategory] = useState(initialCategory);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isCreate = mode === "create";

  function open() {
    setNumber(initialNumber);
    setCategory(initialCategory);
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
        body: JSON.stringify({ number, category }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(data, "Could not save this phone number."));
      dialogRef.current?.close();
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this phone number.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={isCreate
          ? "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          : "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"}
        aria-label={isCreate ? undefined : `Edit ${initialNumber}`}
      >
        {isCreate ? <><Plus className="h-4 w-4" /> Add number</> : <Pencil className="h-3.5 w-3.5" />}
      </button>

      <dialog ref={dialogRef} className="m-auto w-[min(420px,calc(100%-2rem))] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/40">
        <form onSubmit={submit} className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="page-kicker">Leads</p>
              <h2 className="mt-1 text-lg font-semibold">{isCreate ? "Add phone number" : "Edit phone number"}</h2>
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
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Category <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              <input
                type="text"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="e.g. Interested buyers"
                maxLength={80}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>

          {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} disabled={saving} className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCreate ? "Add number" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function AddLeadButton() {
  return <LeadEditor mode="create" />;
}

export function LeadActions({ id, number, category }: { id: string; number: string; category: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete ${number}? This action cannot be undone.`)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/phone-contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      window.alert("Could not delete this phone number. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <LeadEditor mode="edit" id={id} initialNumber={number} initialCategory={category} />
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        aria-label={`Delete ${number}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-500/20 text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
