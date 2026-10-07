import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Phone, Search } from "lucide-react";
import { AddLeadButton, LeadActions } from "@/components/lead-management-controls";
import { TopbarPortal } from "@/components/topbar-portal";

const API_BASE = process.env.API_URL || "http://localhost:8000";
const LEADS_PER_PAGE = 20;

interface Lead {
  _id: string;
  normalizedNumber: string;
  category?: string;
  source: {
    type: "facebook" | "generic" | "manual";
    url?: string;
  };
  createdAt: string;
  lastSeenAt: string;
}

interface LeadsResponse {
  contacts: Lead[];
  categories: string[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function emptyLeadsResponse(page: number): LeadsResponse {
  return {
    contacts: [],
    categories: [],
    pagination: { page, limit: LEADS_PER_PAGE, total: 0, totalPages: 1 },
  };
}

// Fetches this signed-in user's leads and keeps the page renderable if the API is unavailable.
async function fetchLeads(
  clerkUserId: string,
  page: number,
  search: string,
  category: string,
): Promise<{ data: LeadsResponse; unavailable: boolean }> {
  try {
    const url = new URL(`${API_BASE}/api/phone-contacts`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(LEADS_PER_PAGE));
    if (search) url.searchParams.set("search", search);
    if (category) url.searchParams.set("category", category);

    const response = await fetch(url.toString(), {
      headers: { "x-clerk-user-id": clerkUserId },
      cache: "no-store",
    });
    if (!response.ok) return { data: emptyLeadsResponse(page), unavailable: true };
    return { data: await response.json(), unavailable: false };
  } catch {
    return { data: emptyLeadsResponse(page), unavailable: true };
  }
}

// Formats a stored timestamp consistently and avoids rendering invalid date values.
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

// Shows the safe host portion of the source URL instead of a long address in the table.
function sourceHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

// Builds a pagination link while preserving the active search and category filter.
function pageHref(page: number, search: string, category: string): string {
  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set("search", search);
  if (category) query.set("category", category);
  return `/leads?${query.toString()}`;
}

export const metadata = {
  title: "Leads - iPostFlow",
  description: "View phone leads collected with iPostFlow.",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; search?: string; category?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;
  const requestedPage = Number(params?.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const search = params?.search?.trim().slice(0, 128) ?? "";
  const category = params?.category?.trim().slice(0, 80) ?? "";
  const { data, unavailable } = await fetchLeads(userId, page, search, category);
  const { contacts, categories = [], pagination } = data;

  return (
    <div className="page-shell">
      <TopbarPortal>
        <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:flex-nowrap">
          <form action="/leads" method="get" role="search" className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex xl:flex-none">
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Search numbers or categories"
              aria-label="Search phone numbers or categories"
              className="col-span-2 h-9 min-w-0 rounded-md border border-input bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-span-1 sm:w-56"
            />
            <select
              name="category"
              defaultValue={category}
              aria-label="Filter by category"
              className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-36"
            >
              <option value="">All categories</option>
              {categories.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="h-4 w-4" />
              Filter
            </button>
          </form>
          <AddLeadButton />
        </div>
      </TopbarPortal>

      {unavailable && (
        <p role="alert" className="rounded-md border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-700">
          Leads could not be loaded. Please try again shortly.
        </p>
      )}

      <section aria-label="Lead count" className="grid gap-4 sm:grid-cols-2">
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Total leads</p>
          <p className="mt-2 text-2xl font-semibold">{pagination.total.toLocaleString()}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Shown on this page</p>
          <p className="mt-2 text-2xl font-semibold">{contacts.length.toLocaleString()}</p>
        </div>
      </section>

      {unavailable ? null : contacts.length === 0 ? (
        <div className="surface flex min-h-52 flex-col items-center justify-center gap-3 border-dashed text-center">
          <div className="soft-icon"><Phone className="h-5 w-5" /></div>
          <p className="text-sm font-medium text-muted-foreground">
            {search ? "No leads match this search." : "No leads yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60">
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Phone number</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Category</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Source</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Added</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Last collected</th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contacts.map((lead) => (
                    <tr key={lead._id} className="transition-colors hover:bg-accent/50">
                      <td className="whitespace-nowrap px-4 py-4">
                        <a href={`tel:${lead.normalizedNumber}`} className="font-medium text-foreground hover:text-primary">
                          {lead.normalizedNumber}
                        </a>
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {lead.category || "Uncategorized"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {lead.source.type === "manual" || !lead.source.url ? (
                          <span className="font-medium text-muted-foreground">Manual</span>
                        ) : (
                          <a
                            href={lead.source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[260px] items-center gap-2 text-muted-foreground hover:text-foreground"
                          >
                            <span className="shrink-0 font-medium text-foreground">
                              {lead.source.type === "facebook" ? "Facebook" : "Website"}
                            </span>
                            <span className="truncate text-xs">{sourceHost(lead.source.url)}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{formatDate(lead.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{formatDate(lead.lastSeenAt)}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <LeadActions
                          id={lead._id}
                          number={lead.normalizedNumber}
                          category={lead.category || "Uncategorized"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <nav aria-label="Lead pages" className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {pagination.total.toLocaleString()} {pagination.total === 1 ? "lead" : "leads"} - page {pagination.page} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Link
                href={pageHref(pagination.page - 1, search, category)}
                aria-disabled={pagination.page <= 1}
                className={`rounded-md border border-border bg-card px-3 py-1.5 transition-colors ${pagination.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-accent"}`}
              >
                Previous
              </Link>
              <Link
                href={pageHref(pagination.page + 1, search, category)}
                aria-disabled={pagination.page >= pagination.totalPages}
                className={`rounded-md border border-border bg-card px-3 py-1.5 transition-colors ${pagination.page >= pagination.totalPages ? "pointer-events-none opacity-40" : "hover:bg-accent"}`}
              >
                Next
              </Link>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
