import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import {
  QualificationBoard,
  type Lead,
  type BoardSectionSeed,
} from "@/components/qualification-board";
import type { LeadQualificationStatus } from "@/components/lead-management-controls";
import { TopbarPortal } from "@/components/topbar-portal";

const API_BASE = process.env.API_URL || "http://localhost:8000";
const LEADS_PER_PAGE = 20;

interface ListResponse {
  contacts?: Lead[];
  categories?: string[];
  groups?: string[];
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// Seeds one board section from the API while keeping the page renderable if the
// API is unavailable for that status.
async function fetchBoardSection(
  clerkUserId: string,
  qualificationStatus: LeadQualificationStatus,
  search: string,
  category: string,
  group: string,
): Promise<{ seed: BoardSectionSeed; categories: string[]; groups: string[] }> {
  try {
    const url = new URL(`${API_BASE}/api/phone-contacts`);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", String(LEADS_PER_PAGE));
    url.searchParams.set("qualificationStatus", qualificationStatus);
    if (search) url.searchParams.set("search", search);
    if (category) url.searchParams.set("category", category);
    if (group) url.searchParams.set("group", group);

    const response = await fetch(url.toString(), {
      headers: { "x-clerk-user-id": clerkUserId },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Unavailable");
    const data = (await response.json()) as ListResponse;
    const pagination = data.pagination ?? {
      page: 1,
      limit: LEADS_PER_PAGE,
      total: 0,
      totalPages: 1,
    };
    return {
      seed: {
        status: qualificationStatus,
        items: Array.isArray(data.contacts) ? data.contacts : [],
        page: Math.max(1, pagination.page ?? 1),
        total: pagination.total ?? 0,
        totalPages: Math.max(1, pagination.totalPages ?? 1),
        error: false,
      },
      categories: Array.isArray(data.categories)
        ? data.categories.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      groups: Array.isArray(data.groups)
        ? data.groups.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    };
  } catch {
    return {
      seed: {
        status: qualificationStatus,
        items: [],
        page: 1,
        total: 0,
        totalPages: 1,
        error: true,
      },
      categories: [],
      groups: [],
    };
  }
}

export const metadata = {
  title: "Leads - iPostFlow",
  description: "Qualify phone leads collected with iPostFlow.",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ search?: string; category?: string; group?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;
  const search = params?.search?.trim().slice(0, 128) ?? "";
  const category = params?.category?.trim().slice(0, 80) ?? "";
  const group = params?.group?.trim().slice(0, 80) ?? "";
  const hasFilters = Boolean(search || category || group);

  const [unreviewed, qualified, notQualified] = await Promise.all([
    fetchBoardSection(userId, "UNREVIEWED", search, category, group),
    fetchBoardSection(userId, "QUALIFIED", search, category, group),
    fetchBoardSection(userId, "NOT_QUALIFIED", search, category, group),
  ]);

  const categories = Array.from(
    new Set([
      ...unreviewed.categories,
      ...qualified.categories,
      ...notQualified.categories,
    ]),
  ).sort((left, right) => left.localeCompare(right));
  const groups = Array.from(
    new Set([
      ...unreviewed.groups,
      ...qualified.groups,
      ...notQualified.groups,
    ]),
  ).sort((left, right) => left.localeCompare(right));

  return (
    <div className="page-shell">
      <h1 className="sr-only">Leads qualification board</h1>
      <TopbarPortal>
        <form
          action="/leads"
          method="get"
          role="search"
          className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex xl:flex-none"
        >
          <div className="relative col-span-2 min-w-0 sm:col-span-1 sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Search leads"
              aria-label="Search phone numbers, categories, or groups"
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
          <select
            name="category"
            defaultValue={category}
            aria-label="Filter by category"
            className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-w-40"
          >
            <option value="">All categories</option>
            {categories.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <select
            name="group"
            defaultValue={group}
            aria-label="Filter by group"
            className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-w-36"
          >
            <option value="">All groups</option>
            {groups.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-4 w-4" />
            Filter
          </button>
        </form>
        {hasFilters && (
          <Link
            href="/leads"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
            Clear filters
          </Link>
        )}
      </TopbarPortal>

      <QualificationBoard
        key={`${search}|${category}|${group}`}
        search={search}
        category={category}
        group={group}
        initial={{
          UNREVIEWED: unreviewed.seed,
          QUALIFIED: qualified.seed,
          NOT_QUALIFIED: notQualified.seed,
        }}
      />
    </div>
  );
}
