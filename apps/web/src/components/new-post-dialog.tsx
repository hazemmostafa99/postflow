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
          className="fixed inset-0 z-50 flex min-h-screen items-center justify-center overflow-y-auto bg-stone-950/55 p-0 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-post-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="my-auto flex h-dvh w-full max-w-5xl flex-col overflow-hidden border border-border bg-card shadow-2xl sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:rounded-lg">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h2 id="new-post-title" className="text-base font-semibold">
                  Create new post
                </h2>
                <p className="text-xs text-muted-foreground">
                  Facebook profiles and groups
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CreatePostForm onCancel={close} onSuccess={close} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
