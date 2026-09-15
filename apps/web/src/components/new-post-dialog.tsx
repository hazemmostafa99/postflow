"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { CreatePostForm } from "@/components/create-post-form";

interface NewPostDialogProps {
  label?: string;
  compact?: boolean;
}

export function NewPostDialog({ label = "New Post", compact = false }: NewPostDialogProps) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [close, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors ${
          compact ? "px-4 py-2" : "px-4 py-2"
        }`}
      >
        <Plus className="w-4 h-4" />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-post-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-muted/35 px-5 py-4">
              <div>
                <h2 id="new-post-title" className="text-lg font-semibold tracking-tight">
                  New Post
                </h2>
                <p className="text-xs text-muted-foreground">
                  Write content, attach media, and choose target groups.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-5">
              <CreatePostForm onCancel={close} onSuccess={close} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
