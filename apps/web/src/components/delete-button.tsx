"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

interface DeleteButtonProps {
  endpoint: string;
  label: string;
  buttonLabel?: string;
  onDeleted?: () => void;
  compact?: boolean;
}

export function DeleteButton({ endpoint, label, buttonLabel = "Delete", onDeleted, compact = false }: DeleteButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete ${label}? This action cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      onDeleted?.();
      window.location.reload();
    } catch {
      window.alert(`Could not delete ${label}. Please try again.`);
      setIsDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isDeleting}
      aria-label={`Delete ${label}`}
      title={compact ? `Delete ${label}` : undefined}
      className={compact
        ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/5 text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        : "inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"}
    >
      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      {!compact && buttonLabel}
    </button>
  );
}
