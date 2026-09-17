"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Team = { _id: string; name: string };
type User = { _id: string; email?: string; role: string; status: string; teamId?: string | null };

const ROLES = ["ADMIN", "MANAGER", "TEAM_LEADER", "SALES"];
const STATUSES = ["ACTIVE", "DISABLED"];
const TEAM_ROLES = new Set(["SALES", "TEAM_LEADER"]);
const PAGE_SIZE = 10;

export function UserManagementTable({ users, teams }: { users: User[]; teams: Team[] }) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  useEffect(() => {
    function onSearch(event: Event) {
      const detail = (event as CustomEvent<{ pathname: string; value: string }>).detail;
      if (detail?.pathname === "/users") {
        setSearch(detail.value);
        setPage(1);
      }
    }
    window.addEventListener("postflow:topbar-search", onSearch);
    return () => window.removeEventListener("postflow:topbar-search", onSearch);
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch = !query || (user.email ?? "").toLowerCase().includes(query) || teamName(user.teamId, teams).toLowerCase().includes(query);
      const matchesRole = roleFilter === "ALL" || user.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [roleFilter, search, teams, users]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function updateRoleFilter(value: string) {
    setRoleFilter(value);
    setPage(1);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold">People</h2>
          <p className="mt-1 text-xs text-muted-foreground">{filteredUsers.length} users</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[180px]">
          <select value={roleFilter} onChange={(event) => updateRoleFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
            <option value="ALL">All roles</option>
            {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Team</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleUsers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No users found.</td></tr>
            ) : visibleUsers.map((user) => (
              <UserRow key={user._id} user={user} teams={teams} />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

function UserRow({ user, teams }: { user: User; teams: Team[] }) {
  const router = useRouter();
  const [role, setRole] = useState(user.role);
  const [teamId, setTeamId] = useState(user.teamId ?? "");
  const [status, setStatus] = useState(user.status);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const requiresTeam = TEAM_ROLES.has(role);

  async function save() {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/users/${user._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, status, teamId: requiresTeam ? teamId : null }),
      });
      const data = await response.json();
      setMessage(response.ok ? "Saved." : data.message ?? data.error ?? "Could not save user.");
      if (response.ok) router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteUser() {
    if (!confirm(`Delete ${user.email ?? "this user"} from PostFlow?`)) return;
    setIsDeleting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/users/${user._id}`, { method: "DELETE" });
      const data = await response.json();
      setMessage(response.ok ? "Deleted." : data.message ?? data.error ?? "Could not delete user.");
      if (response.ok) router.refresh();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium">{user.email ?? "Unknown email"}</p>
        {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
      </td>
      <td className="px-4 py-3">
        <select value={role} onChange={(event) => setRole(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
          {ROLES.map((roleOption) => <option key={roleOption} value={roleOption}>{roleLabel(roleOption)}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={!requiresTeam} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
          <option value="">No team</option>
          {teams.map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
          {STATUSES.map((statusOption) => <option key={statusOption} value={statusOption}>{statusLabel(statusOption)}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          <button onClick={save} disabled={isSaving || (requiresTeam && !teamId)} className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? "Saving" : "Save"}</button>
          <button onClick={deleteUser} disabled={isDeleting} className="h-9 rounded-lg border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60">{isDeleting ? "Deleting" : "Delete"}</button>
        </div>
      </td>
    </tr>
  );
}

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
      <span className="text-muted-foreground">Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className="h-9 rounded-lg border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
        <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="h-9 rounded-lg border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
      </div>
    </div>
  );
}

function roleLabel(role: string) {
  return role.replace("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(status: string) {
  return status.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function teamName(teamId: string | null | undefined, teams: Team[]) {
  if (!teamId) return "";
  return teams.find((team) => team._id === teamId)?.name ?? "";
}
