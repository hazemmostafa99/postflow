import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  Link2,
  Search,
  UsersRound,
} from "lucide-react";
import { TopbarPortal } from "@/components/topbar-portal";
import { DeleteButton } from "@/components/delete-button";

const API_BASE = process.env.API_URL || "http://localhost:8000";
const GROUPS_PER_PAGE = 20;

interface Group {
  _id: string;
  facebookConnectionId?: string;
  externalId: string;
  name: string;
  url: string;
  status: string;
  lastSeenAt: string;
}

interface FacebookConnection {
  _id: string;
  displayName?: string;
  facebookUserId?: string;
}

interface GroupsResponse {
  groups: Group[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function emptyGroupsResponse(page: number): GroupsResponse {
  return {
    groups: [],
    pagination: { page, limit: GROUPS_PER_PAGE, total: 0, totalPages: 1 },
  };
}

async function fetchGroups(
  userId: string,
  page: number,
  search: string,
  connectionId: string,
): Promise<{ data: GroupsResponse; unavailable: boolean }> {
  try {
    const url = new URL(`${API_BASE}/api/groups`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(GROUPS_PER_PAGE));
    if (search) url.searchParams.set("search", search);
    if (connectionId) url.searchParams.set("connectionId", connectionId);

    const response = await fetch(url.toString(), {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    });
    if (!response.ok) return { data: emptyGroupsResponse(page), unavailable: true };
    return { data: await response.json(), unavailable: false };
  } catch {
    return { data: emptyGroupsResponse(page), unavailable: true };
  }
}

async function fetchConnections(userId: string): Promise<FacebookConnection[]> {
  try {
    const response = await fetch(`${API_BASE}/api/extensions/connections`, {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    });
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function connectionLabel(connection: FacebookConnection): string {
  if (connection.displayName?.trim()) return connection.displayName.trim();
  if (connection.facebookUserId) {
    return `Facebook account ending ${connection.facebookUserId.slice(-4)}`;
  }
  return "Unnamed Facebook connection";
}

function pageHref(page: number, search: string, connectionId: string): string {
  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set("search", search);
  if (connectionId) query.set("connectionId", connectionId);
  return `/groups?${query.toString()}`;
}

export const metadata = {
  title: "Groups - iPostFlow",
  description: "Browse and filter Facebook groups synced with iPostFlow.",
};

export default async function GroupsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; search?: string; connectionId?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;
  const requestedPage = Number(params?.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const search = params?.search?.trim().slice(0, 128) ?? "";
  const connectionId = params?.connectionId?.trim().slice(0, 64) ?? "";

  const [{ data, unavailable }, connections] = await Promise.all([
    fetchGroups(userId, page, search, connectionId),
    fetchConnections(userId),
  ]);
  const { groups, pagination } = data;
  const connectionNames = new Map(
    connections.map((connection) => [connection._id, connectionLabel(connection)]),
  );
  const hasFilters = Boolean(search || connectionId);

  return (
    <div className="page-shell">
      <TopbarPortal>
        <form
          action="/groups"
          method="get"
          role="search"
          className="grid w-full min-w-0 flex-1 grid-cols-2 gap-2 sm:flex xl:w-auto xl:flex-none"
        >
          <div className="relative col-span-2 min-w-0 sm:col-span-1 sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Search groups"
              aria-label="Search groups"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <select
            name="connectionId"
            defaultValue={connectionId}
            aria-label="Filter by Facebook connection"
            className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-48"
          >
            <option value="">All connections</option>
            {connections.map((connection) => (
              <option key={connection._id} value={connection._id}>
                {connectionLabel(connection)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-4 w-4" />
            Filter
          </button>
        </form>
      </TopbarPortal>

      {unavailable && (
        <p role="alert" className="rounded-md border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Groups could not be loaded. Your synced group data has not been changed.
        </p>
      )}

      <section aria-label="Group summary" className="grid gap-4 sm:grid-cols-3">
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Matching groups</p>
          <p className="mt-2 text-2xl font-semibold">{pagination.total.toLocaleString()}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Shown on this page</p>
          <p className="mt-2 text-2xl font-semibold">{groups.length.toLocaleString()}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Facebook connections</p>
          <p className="mt-2 text-2xl font-semibold">{connections.length.toLocaleString()}</p>
        </div>
      </section>

      {unavailable ? null : groups.length === 0 ? (
        <section className="surface flex min-h-60 flex-col items-center justify-center border-dashed px-6 text-center">
          <div className="soft-icon mb-4"><UsersRound className="h-5 w-5" /></div>
          <h2 className="text-sm font-semibold text-foreground">
            {hasFilters ? "No groups match these filters" : "No synced groups yet"}
          </h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
            {hasFilters
              ? "Try a different group name or Facebook connection."
              : "Open Facebook with the iPostFlow extension to discover and sync your groups."}
          </p>
          {hasFilters && (
            <Link href="/groups" className="mt-4 text-sm font-medium text-primary hover:underline">
              Clear filters
            </Link>
          )}
        </section>
      ) : (
        <>
          <section className="surface overflow-hidden" aria-label="Synced Facebook groups">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60">
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Group</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Connection</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Status</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Last synced</th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groups.map((group) => (
                    <tr key={group._id} className="transition-colors hover:bg-accent/50">
                      <td className="max-w-md px-4 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="soft-icon h-9 w-9"><UsersRound className="h-4 w-4" /></span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{group.name}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{group.externalId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Link2 className="h-3.5 w-3.5" />
                          {group.facebookConnectionId
                            ? connectionNames.get(String(group.facebookConnectionId)) ?? "Unknown connection"
                            : "Legacy sync"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {group.status.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{formatDate(group.lastSeenAt)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={group.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${group.name} on Facebook`}
                            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            Facebook <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <DeleteButton
                            endpoint={`/api/groups/${encodeURIComponent(group._id)}`}
                            label={`\"${group.name}\"`}
                            compact
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <nav aria-label="Group pages" className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {pagination.total.toLocaleString()} {pagination.total === 1 ? "group" : "groups"} - page {pagination.page} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Link
                href={pageHref(pagination.page - 1, search, connectionId)}
                aria-disabled={pagination.page <= 1}
                className={`rounded-md border border-border bg-card px-3 py-1.5 transition-colors ${pagination.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-accent"}`}
              >
                Previous
              </Link>
              <Link
                href={pageHref(pagination.page + 1, search, connectionId)}
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
