"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Phone,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  AddLeadButton,
  LEAD_QUALIFICATION_STATUSES,
  LeadEditor,
  leadStatusLabel,
  responseMessage,
  type LeadQualificationStatus,
} from "@/components/lead-management-controls";
import { TopbarPortal } from "@/components/topbar-portal";

const LEADS_PER_PAGE = 20;

export interface Lead {
  _id: string;
  normalizedNumber: string;
  category?: string;
  group?: string;
  qualificationStatus?: LeadQualificationStatus;
  notes?: string;
  source: {
    type: "facebook" | "generic" | "manual";
    url?: string;
  };
  createdAt?: string;
  lastSeenAt?: string;
}

/** Server-fetched starting data for one board section. */
export interface BoardSectionSeed {
  status: LeadQualificationStatus;
  items: Lead[];
  page: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  nextCursor: string | null;
  error: boolean;
}

interface SectionState {
  items: Lead[];
  page: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  nextCursor: string | null;
  failed: boolean;
  loadingMore: boolean;
  moreError: string;
}

interface SectionResponse {
  contacts: Lead[];
  pagination: {
    page: number;
    limit: number;
    total?: number;
    totalPages?: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

const STATUSES = LEAD_QUALIFICATION_STATUSES.map((option) => option.value);

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
}

function fromSeed(seed: BoardSectionSeed): SectionState {
  const totalPages = Math.max(1, seed.totalPages);
  return {
    items: seed.items,
    page: Math.max(1, seed.page),
    total: seed.total,
    totalPages,
    hasMore: seed.hasMore,
    nextCursor: seed.nextCursor,
    failed: seed.error,
    loadingMore: false,
    moreError: "",
  };
}

function fromResponse(
  status: LeadQualificationStatus,
  data: SectionResponse,
): SectionState {
  const totalPages = Math.max(1, data.pagination.totalPages ?? 1);
  return {
    items: data.contacts,
    page: data.pagination.page,
    total: data.pagination.total ?? data.contacts.length,
    totalPages,
    hasMore: data.pagination.hasMore,
    nextCursor: data.pagination.nextCursor,
    failed: false,
    loadingMore: false,
    moreError: "",
  };
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function timeAgo(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return formatDate(value);
}

function sourceLabel(type: Lead["source"]["type"]): string {
  if (type === "facebook") return "Facebook";
  if (type === "manual") return "Manual";
  return "Website";
}

function sourceHost(value?: string): string {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function emptyTextFor(status: LeadQualificationStatus): string {
  if (status === "UNREVIEWED") return "Nothing needs review right now.";
  if (status === "QUALIFIED") return "No qualified leads yet.";
  return "No rejected leads yet.";
}

const SECTION_PILL: Record<LeadQualificationStatus, string> = {
  UNREVIEWED:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  QUALIFIED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  NOT_QUALIFIED: "border-border bg-muted text-muted-foreground",
};

const SECTION_META: Record<
  LeadQualificationStatus,
  { description: string; dot: string }
> = {
  UNREVIEWED: {
    description: "New leads waiting for a decision",
    dot: "bg-amber-500",
  },
  QUALIFIED: {
    description: "Leads worth following up",
    dot: "bg-emerald-500",
  },
  NOT_QUALIFIED: {
    description: "Leads not moving forward",
    dot: "bg-slate-400",
  },
};

function SectionHeader({
  id,
  status,
  count,
}: {
  id: string;
  status: LeadQualificationStatus;
  count: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${SECTION_META[status].dot}`}
          />
          <h2 id={id} className="text-sm font-semibold text-foreground">
            {leadStatusLabel(status)}
          </h2>
        </div>
        <p className="mt-1 truncate pl-4 text-xs text-muted-foreground">
          {SECTION_META[status].description}
        </p>
      </div>
      <span
        className={`inline-flex h-6 min-w-7 shrink-0 items-center justify-center rounded-full border px-2 text-xs font-medium tabular-nums ${SECTION_PILL[status]}`}
      >
        {count.toLocaleString()}
      </span>
    </div>
  );
}

function shortDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function LeadCard({
  lead,
  onChangeStatus,
  onDelete,
  onSaved,
  mounted,
}: {
  lead: Lead;
  onChangeStatus: (next: LeadQualificationStatus) => Promise<void>;
  onDelete: () => void;
  onSaved: (data: unknown) => void;
  mounted: boolean;
}) {
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function changeStatus(next: LeadQualificationStatus) {
    if (statusPending) return;
    setStatusPending(true);
    setStatusError("");
    try {
      await onChangeStatus(next);
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "Could not update status.",
      );
    } finally {
      setStatusPending(false);
    }
  }

  async function remove() {
    if (deleting) return;
    if (
      !window.confirm(
        `Delete ${lead.normalizedNumber}? This action cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(
        `/api/phone-contacts/${encodeURIComponent(lead._id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          responseMessage(data, "Could not delete this phone number."),
        );
      }
      onDelete();
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Could not delete this phone number.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const status = lead.qualificationStatus ?? "UNREVIEWED";
  const category = lead.category?.trim() || "Uncategorized";
  const group = lead.group?.trim() || "Ungrouped";

  return (
    <article className="flex h-full min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <span className="sr-only">Status: {leadStatusLabel(status)}</span>

      <div className="flex items-start justify-between gap-3">
        <a
          href={`tel:${lead.normalizedNumber}`}
          className="min-w-0 truncate text-sm font-semibold text-foreground hover:text-primary"
        >
          {lead.normalizedNumber}
        </a>
        <span
          className="inline-flex h-6 max-w-[45%] shrink-0 items-center truncate whitespace-nowrap rounded-full border border-border bg-muted px-2 text-xs font-medium text-muted-foreground"
          title={group}
        >
          {group}
        </span>
      </div>

      {lead.notes ? (
        <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
          {lead.notes}
        </p>
      ) : null}

      <p className="truncate text-xs text-muted-foreground" title={category}>
        Category:{" "}
        <span className="font-medium text-foreground">{category}</span>
      </p>

      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {sourceLabel(lead.source.type)}
        </span>
        {lead.source.url ? (
          <a
            href={lead.source.url}
            target="_blank"
            rel="noreferrer"
            title={lead.source.url}
            className="inline-flex min-w-0 max-w-[200px] items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
          >
            <span className="truncate">{sourceHost(lead.source.url)}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : null}
        <span className="text-muted-foreground/40">·</span>
        <span>
          Collected{" "}
          <time dateTime={lead.lastSeenAt}>
            {mounted ? timeAgo(lead.lastSeenAt) : "—"}
          </time>
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span title={mounted ? formatDate(lead.createdAt) : undefined}>
          Added {mounted ? shortDate(lead.createdAt) : "—"}
        </span>
      </div>

      {statusError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {statusError}
        </p>
      )}
      {deleteError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {deleteError}
        </p>
      )}

      <footer className="mt-auto flex items-center gap-2 border-t border-border pt-2.5">
        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor={`lead-status-${lead._id}`}>
            Status for {lead.normalizedNumber}
          </label>
          <select
            id={`lead-status-${lead._id}`}
            value={status}
            onChange={(event) =>
              void changeStatus(event.target.value as LeadQualificationStatus)
            }
            disabled={statusPending}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-xs font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-60"
          >
            {LEAD_QUALIFICATION_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {statusPending && (
            <Loader2 className="pointer-events-none absolute right-7 top-2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <LeadEditor
            mode="edit"
            id={lead._id}
            initialNumber={lead.normalizedNumber}
            initialCategory={lead.category ?? ""}
            initialGroup={lead.group ?? ""}
            initialStatus={status}
            initialNotes={lead.notes ?? ""}
            onSaved={onSaved}
          />
          <button
            type="button"
            onClick={() => void remove()}
            disabled={deleting}
            aria-label={`Delete ${lead.normalizedNumber}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:text-red-400"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </footer>
    </article>
  );
}

function LeadSection({
  status,
  section,
  onLoadMore,
  onRetry,
  onChangeStatus,
  onDelete,
  onSaved,
  mounted,
}: {
  status: LeadQualificationStatus;
  section: SectionState;
  onLoadMore: (status: LeadQualificationStatus) => void;
  onRetry: (status: LeadQualificationStatus) => void;
  onChangeStatus: (lead: Lead, next: LeadQualificationStatus) => Promise<void>;
  onDelete: (lead: Lead) => void;
  onSaved: (lead: Lead, data: unknown) => void;
  mounted: boolean;
}) {
  const loadTriggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = loadTriggerRef.current;
    if (!target || !section.hasMore || section.loadingMore || section.failed)
      return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore(status);
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    onLoadMore,
    section.failed,
    section.hasMore,
    section.loadingMore,
    status,
  ]);

  if (section.failed) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-lg border border-red-200 bg-card p-4 dark:border-red-500/30"
      >
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-muted-foreground">
            Could not load {leadStatusLabel(status).toLowerCase()} leads.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRetry(status)}
          disabled={section.loadingMore}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {section.loadingMore ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {section.loadingMore ? "Loading…" : "Try again"}
        </button>
      </div>
    );
  }

  if (section.items.length === 0) {
    return (
      <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/60 px-5 text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Phone className="h-4 w-4" />
        </div>
        <p className="text-sm text-muted-foreground">{emptyTextFor(status)}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <ol className="grid gap-2.5">
        {section.items.map((lead) => (
          <li key={lead._id} className="flex h-full">
            <LeadCard
              lead={lead}
              mounted={mounted}
              onChangeStatus={(next) => onChangeStatus(lead, next)}
              onDelete={() => onDelete(lead)}
              onSaved={(data) => onSaved(lead, data)}
            />
          </li>
        ))}
      </ol>
      {section.hasMore && (
        <div ref={loadTriggerRef} className="grid gap-2">
          <button
            type="button"
            onClick={() => onLoadMore(status)}
            disabled={section.loadingMore}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {section.loadingMore && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {section.loadingMore ? "Loading…" : "Load more leads"}
          </button>
          <span className="sr-only" aria-live="polite">
            {section.loadingMore ? "Loading more leads" : ""}
          </span>
        </div>
      )}
      {section.moreError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {section.moreError}
        </p>
      )}
    </div>
  );
}

export function QualificationBoard({
  search,
  category,
  group,
  initial,
}: {
  search: string;
  category: string;
  group: string;
  initial: Record<LeadQualificationStatus, BoardSectionSeed>;
}) {
  const [sections, setSections] = useState<
    Record<LeadQualificationStatus, SectionState>
  >(() => ({
    UNREVIEWED: fromSeed(initial.UNREVIEWED),
    QUALIFIED: fromSeed(initial.QUALIFIED),
    NOT_QUALIFIED: fromSeed(initial.NOT_QUALIFIED),
  }));
  const [mounted, setMounted] = useState(false);
  const loadingStatuses = useRef(new Set<LeadQualificationStatus>());
  const requestControllers = useRef(
    new Map<LeadQualificationStatus, AbortController>(),
  );

  useEffect(() => {
    // schedule the mounted flag asynchronously so the server and first client
    // render agree on the placeholder text before timestamps compute locally.
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      requestControllers.current.forEach((controller) => controller.abort());
      requestControllers.current.clear();
    },
    [],
  );

  async function fetchSectionPage(
    status: LeadQualificationStatus,
    cursor?: string,
    includeMetadata = false,
  ): Promise<SectionResponse> {
    const params = new URLSearchParams({
      limit: String(LEADS_PER_PAGE),
      qualificationStatus: status,
      includeMetadata: String(includeMetadata),
    });
    if (cursor) params.set("cursor", cursor);
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (group) params.set("group", group);
    const controller = new AbortController();
    requestControllers.current.get(status)?.abort();
    requestControllers.current.set(status, controller);
    try {
      const response = await fetch(`/api/phone-contacts?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not load leads.");
      return (await response.json()) as SectionResponse;
    } finally {
      if (requestControllers.current.get(status) === controller) {
        requestControllers.current.delete(status);
      }
    }
  }

  async function loadMore(status: LeadQualificationStatus) {
    const section = sections[status];
    if (
      section.loadingMore ||
      !section.hasMore ||
      !section.nextCursor ||
      section.failed ||
      loadingStatuses.current.has(status)
    )
      return;
    loadingStatuses.current.add(status);
    setSections((prev) => ({
      ...prev,
      [status]: { ...prev[status], loadingMore: true, moreError: "" },
    }));
    try {
      const data = await fetchSectionPage(status, section.nextCursor);
      setSections((prev) => {
        const current = prev[status];
        const known = new Set(current.items.map((lead) => lead._id));
        const fresh = data.contacts.filter((lead) => !known.has(lead._id));
        return {
          ...prev,
          [status]: {
            ...current,
            items: [...current.items, ...fresh],
            page: current.page + 1,
            hasMore: data.pagination.hasMore,
            nextCursor: data.pagination.nextCursor,
            loadingMore: false,
          },
        };
      });
    } catch {
      setSections((prev) => ({
        ...prev,
        [status]: {
          ...prev[status],
          loadingMore: false,
          moreError: "Could not load more leads.",
        },
      }));
    } finally {
      loadingStatuses.current.delete(status);
    }
  }

  async function retrySection(status: LeadQualificationStatus) {
    setSections((prev) => ({
      ...prev,
      [status]: { ...prev[status], loadingMore: true, moreError: "" },
    }));
    try {
      const data = await fetchSectionPage(status, undefined, true);
      setSections((prev) => ({
        ...prev,
        [status]: fromResponse(status, data),
      }));
    } catch {
      setSections((prev) => ({
        ...prev,
        [status]: {
          ...prev[status],
          failed: true,
          loadingMore: false,
          moreError: "",
        },
      }));
    }
  }

  function moveLead(lead: Lead, next: LeadQualificationStatus) {
    const current = lead.qualificationStatus ?? "UNREVIEWED";
    if (current === next) return;
    const updated = { ...lead, qualificationStatus: next };
    setSections((prev) => {
      const source = prev[current];
      const target = prev[next];
      const sourceTotal = Math.max(0, source.total - 1);
      const targetTotal = target.total + 1;
      return {
        ...prev,
        [current]: {
          ...source,
          items: source.items.filter((item) => item._id !== lead._id),
          total: sourceTotal,
          totalPages: pageCount(sourceTotal),
          hasMore: source.page < pageCount(sourceTotal),
        },
        [next]: {
          ...target,
          failed: false,
          items: [
            updated,
            ...target.items.filter((item) => item._id !== lead._id),
          ],
          total: targetTotal,
          totalPages: pageCount(targetTotal),
          hasMore: target.page < pageCount(targetTotal),
        },
      };
    });
  }

  function upsertLead(lead: Lead, updated: Lead) {
    setSections((prev) => {
      const oldStatus = lead.qualificationStatus ?? "UNREVIEWED";
      const newStatus = updated.qualificationStatus ?? oldStatus;
      const merged = updated;
      if (oldStatus === newStatus) {
        return {
          ...prev,
          [newStatus]: {
            ...prev[newStatus],
            items: prev[newStatus].items.map((item) =>
              item._id === lead._id ? merged : item,
            ),
          },
        };
      }
      const source = prev[oldStatus];
      const target = prev[newStatus];
      const sourceTotal = Math.max(0, source.total - 1);
      const targetTotal = target.total + 1;
      return {
        ...prev,
        [oldStatus]: {
          ...source,
          items: source.items.filter((item) => item._id !== lead._id),
          total: sourceTotal,
          totalPages: pageCount(sourceTotal),
          hasMore: source.page < pageCount(sourceTotal),
        },
        [newStatus]: {
          ...target,
          failed: false,
          items: [
            merged,
            ...target.items.filter((item) => item._id !== lead._id),
          ],
          total: targetTotal,
          totalPages: pageCount(targetTotal),
          hasMore: target.page < pageCount(targetTotal),
        },
      };
    });
  }

  function removeLead(lead: Lead) {
    setSections((prev) => {
      const status = lead.qualificationStatus ?? "UNREVIEWED";
      const current = prev[status];
      const total = Math.max(0, current.total - 1);
      return {
        ...prev,
        [status]: {
          ...current,
          items: current.items.filter((item) => item._id !== lead._id),
          total,
          totalPages: pageCount(total),
          hasMore: current.page < pageCount(total),
        },
      };
    });
  }

  function addLead(lead: Lead) {
    const status = lead.qualificationStatus ?? "UNREVIEWED";
    setSections((prev) => {
      const target = prev[status];
      const total = target.total + 1;
      return {
        ...prev,
        [status]: {
          ...target,
          failed: false,
          items: [
            lead,
            ...target.items.filter((item) => item._id !== lead._id),
          ],
          total,
          totalPages: pageCount(total),
          hasMore: target.page < pageCount(total),
        },
      };
    });
  }

  async function changeStatusCard(
    lead: Lead,
    next: LeadQualificationStatus,
  ): Promise<void> {
    const response = await fetch(
      `/api/phone-contacts/${encodeURIComponent(lead._id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualificationStatus: next }),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        responseMessage(data, "Could not update this lead's status."),
      );
    }
    moveLead(lead, next);
  }

  function handleEditSaved(lead: Lead, data: unknown) {
    if (!data || typeof data !== "object") return;
    const updated = data as Partial<Lead>;
    if (!updated._id) return;
    upsertLead(lead, { ...lead, ...updated } as Lead);
  }

  function handleAddSaved(data: unknown) {
    if (!data || typeof data !== "object") return;
    const lead = data as Lead;
    if (!lead._id) return;
    addLead(lead);
  }

  const allFailed = STATUSES.every((status) => sections[status].failed);
  const allEmpty = STATUSES.every(
    (status) => sections[status].total === 0 && !sections[status].failed,
  );
  const hasFilters = Boolean(search || category || group);
  const sectionProps = {
    onLoadMore: (status: LeadQualificationStatus) => void loadMore(status),
    onRetry: (status: LeadQualificationStatus) => void retrySection(status),
    onChangeStatus: changeStatusCard,
    onDelete: (lead: Lead) => removeLead(lead),
    onSaved: handleEditSaved,
    mounted,
  };

  return (
    <div className="flex flex-col gap-6">
      <TopbarPortal>
        <AddLeadButton onSaved={handleAddSaved} />
      </TopbarPortal>

      {allFailed ? (
        <section
          role="alert"
          className="surface flex min-h-56 flex-col items-center justify-center gap-4 border-red-200 px-6 text-center dark:border-red-500/30"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">
              Leads could not be loaded
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              iPostFlow could not reach the leads service. Your leads have not
              been removed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void Promise.all(STATUSES.map(retrySection))}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </section>
      ) : allEmpty ? (
        <section className="surface flex min-h-72 flex-col items-center justify-center gap-4 border-dashed px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Phone className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {hasFilters ? "No leads match your filters" : "No leads yet"}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              {hasFilters
                ? "Try a different search or clear your filters to see every lead."
                : "Add your first phone number with the “Add number” button in the toolbar to start qualifying leads."}
            </p>
          </div>
        </section>
      ) : (
        <section
          aria-label="Lead qualification board"
          className="grid items-start gap-4 lg:grid-cols-3"
        >
          <section
            aria-labelledby="needs-review-heading"
            className="surface min-w-0 overflow-hidden bg-muted/25"
          >
            <SectionHeader
              id="needs-review-heading"
              status="UNREVIEWED"
              count={sections.UNREVIEWED.total}
            />
            <div className="p-3">
              <LeadSection
                status="UNREVIEWED"
                section={sections.UNREVIEWED}
                {...sectionProps}
              />
            </div>
          </section>
          <section
            aria-labelledby="qualified-heading"
            className="surface min-w-0 overflow-hidden bg-muted/25"
          >
            <SectionHeader
              id="qualified-heading"
              status="QUALIFIED"
              count={sections.QUALIFIED.total}
            />
            <div className="p-3">
              <LeadSection
                status="QUALIFIED"
                section={sections.QUALIFIED}
                {...sectionProps}
              />
            </div>
          </section>
          <section
            aria-labelledby="not-qualified-heading"
            className="surface min-w-0 overflow-hidden bg-muted/25"
          >
            <SectionHeader
              id="not-qualified-heading"
              status="NOT_QUALIFIED"
              count={sections.NOT_QUALIFIED.total}
            />
            <div className="p-3">
              <LeadSection
                status="NOT_QUALIFIED"
                section={sections.NOT_QUALIFIED}
                {...sectionProps}
              />
            </div>
          </section>
        </section>
      )}
    </div>
  );
}
