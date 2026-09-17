"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Manager = { _id: string; email?: string };

export function CreateTeamForm({ managers }: { managers: Manager[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function open() {
      setIsOpen(true);
    }
    window.addEventListener("postflow:add-team", open);
    return () => window.removeEventListener("postflow:add-team", open);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = form.get("name");
    const managerId = form.get("managerId") || null;

    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, managerId }),
      });
      const data = await response.json();
      setMessage(response.ok ? "Team created." : data.message ?? data.error ?? "Could not create team.");
      if (response.ok) {
        formElement.reset();
        setIsOpen(false);
        router.refresh();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex min-h-screen items-center justify-center overflow-y-auto bg-background/60 px-4 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-team-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setIsOpen(false);
      }}
    >
      <form onSubmit={submit} className="my-auto w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-team-title" className="text-sm font-semibold">Add Team</h2>
            <p className="mt-1 text-xs text-muted-foreground">Create a team and optionally assign a manager.</p>
          </div>
          <button type="button" onClick={() => setIsOpen(false)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div>
          <label className="text-sm font-medium">Team name</label>
          <input
            name="name"
            required
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            placeholder="North Cairo Sales"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Manager</label>
          <select name="managerId" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm">
            <option value="">Unassigned</option>
            {managers.map((manager) => (
              <option key={manager._id} value={manager._id}>{manager.email ?? "Manager"}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            disabled={isSubmitting}
            className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Creating..." : "Create team"}
          </button>
          <button type="button" onClick={() => setIsOpen(false)} className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
            Cancel
          </button>
        </div>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </form>
    </div>
  );
}
