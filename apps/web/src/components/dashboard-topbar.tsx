"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { NewPostDialog } from "@/components/new-post-dialog";

const PAGE_TITLES: Array<{ match: (path: string) => boolean; title: string }> = [
  { match: (path) => path === "/", title: "Overview" },
  { match: (path) => path === "/posts", title: "Posts" },
  { match: (path) => path.startsWith("/posts/"), title: "Post Details" },
  { match: (path) => path === "/users", title: "Users" },
  { match: (path) => path === "/teams", title: "Teams" },
];

export function DashboardTopbar({ role }: { role?: string }) {
  const pathname = usePathname();
  const title = PAGE_TITLES.find((page) => page.match(pathname))?.title ?? "PostFlow";
  const searchable = pathname === "/users" || pathname === "/teams";
  const searchPlaceholder = pathname === "/users" ? "Search users" : "Search teams";

  function search(value: string) {
    window.dispatchEvent(new CustomEvent("postflow:topbar-search", { detail: { pathname, value } }));
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input onChange={(event) => search(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm" placeholder={searchPlaceholder} />
          </div>
        )}
        {pathname === "/teams" && role === "ADMIN" && (
          <button onClick={() => window.dispatchEvent(new Event("postflow:add-team"))} className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Add Team
          </button>
        )}
        {pathname === "/users" && (role === "ADMIN" || role === "MANAGER") && (
          <button onClick={() => window.dispatchEvent(new Event("postflow:invite-user"))} className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Invite user
          </button>
        )}
        {pathname === "/" && (
          <Link href="/posts" className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            View posts
          </Link>
        )}
        {pathname === "/posts" && (
          <>
            <DeleteButton endpoint="/api/groups" label="all synced groups" buttonLabel="Delete groups" />
            <DeleteButton endpoint="/api/posts" label="all posts" buttonLabel="Delete posts" />
            <NewPostDialog />
          </>
        )}
      </div>
    </div>
  );
}
