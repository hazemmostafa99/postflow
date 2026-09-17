"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Team = { _id: string; name: string; teamLeader?: { email?: string }; salesCount: number };
type User = { _id: string; email?: string; role: string; status: string; teamId?: string | null };

const ASSIGNABLE_ROLES = ["TEAM_LEADER", "SALES"];
const PAGE_SIZE = 10;

export function TeamMembershipTable({ users, teams }: { users: User[]; teams: Team[] }) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesRole = roleFilter === "ALL" || user.role === roleFilter;
      const matchesSearch = !query || (user.email ?? "").toLowerCase().includes(query) || teamName(user.teamId, teams).toLowerCase().includes(query);
      return matchesRole && matchesSearch;
    });
  }, [roleFilter, search, teams, users]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function resetSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function resetRoleFilter(value: string) {
    setRoleFilter(value);
    setPage(1);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Team assignments</h2>
          <p className="mt-1 text-xs text-muted-foreground">{filteredUsers.length} users</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_180px]">
          <input value={search} onChange={(event) => resetSearch(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm" placeholder="Search users or teams" />
          <select value={roleFilter} onChange={(event) => resetRoleFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
            <option value="ALL">All roles</option>
            <option value="TEAM_LEADER">Team Leader</option>
            <option value="SALES">Sales</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Team</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Assignment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleUsers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No users found.</td></tr>
            ) : visibleUsers.map((user) => (
              <AssignmentRow key={user._id} user={user} teams={teams} />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

function AssignmentRow({ user, teams }: { user: User; teams: Team[] }) {
  const router = useRouter();
  const canAssign = user.status === "ACTIVE";
  const [role, setRole] = useState(ASSIGNABLE_ROLES.includes(user.role) ? user.role : "SALES");
  const [teamId, setTeamId] = useState(user.teamId ?? teams[0]?._id ?? "");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/users/${user._id}/team-assignment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, teamId }),
      });
      const data = await response.json();
      setMessage(response.ok ? "Assigned." : data.message ?? data.error ?? "Could not assign user.");
      if (response.ok) router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium">{user.email ?? "Unknown email"}</p>
        {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
      </td>
      <td className="px-4 py-3">{roleLabel(user.role)}</td>
      <td className="px-4 py-3">{teamName(user.teamId, teams) || "No team"}</td>
      <td className="px-4 py-3"><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{statusLabel(user.status)}</span></td>
      <td className="px-4 py-3">
        <div className="grid gap-2 md:grid-cols-[150px_180px_auto]">
          <select value={role} onChange={(event) => setRole(event.target.value)} disabled={!canAssign} className="h-9 rounded-lg border border-border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            <option value="TEAM_LEADER">Team Leader</option>
            <option value="SALES">Sales</option>
          </select>
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={!canAssign || teams.length === 0} className="h-9 rounded-lg border border-border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            {teams.length === 0 ? <option value="">No teams</option> : teams.map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}
          </select>
          <button onClick={save} disabled={!canAssign || !teamId || isSaving} className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? "Saving" : "Assign"}</button>
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
