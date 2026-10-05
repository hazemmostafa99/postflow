"use client";

import { Download, UserRound, Users, X } from "lucide-react";
import { useRef } from "react";

export function ReportExportControl({
  query,
  allowTeams,
}: {
  query: string;
  allowTeams: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
        title="Export performance as CSV"
      >
        <Download className="h-3.5 w-3.5" />
        Export CSV
      </button>

      <dialog
        ref={dialogRef}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="m-auto w-[min(460px,calc(100%-2rem))] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/45"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="page-kicker">CSV export</p>
              <h2 className="mt-1 text-lg font-semibold">Choose report type</h2>
              <p className="mt-1 text-sm text-muted-foreground">The current dates and report filters will be applied.</p>
            </div>
            <button type="button" onClick={close} aria-label="Close export dialog" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <a
              href={`/api/reports/export?${query}&type=members`}
              onClick={close}
              className="rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="soft-icon"><UserRound className="h-5 w-5" /></span>
              <span className="mt-3 block text-sm font-semibold">Member Performance</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">One CSV row for each visible member.</span>
            </a>

            {allowTeams ? (
              <a
                href={`/api/reports/export?${query}&type=teams`}
                onClick={close}
                className="rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="soft-icon"><Users className="h-5 w-5" /></span>
                <span className="mt-3 block text-sm font-semibold">Team Performance</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">One CSV row for each visible team.</span>
              </a>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 opacity-60" aria-disabled="true">
                <span className="soft-icon"><Users className="h-5 w-5" /></span>
                <span className="mt-3 block text-sm font-semibold">Team Performance</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">Available to team leaders, managers, and admins.</span>
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
