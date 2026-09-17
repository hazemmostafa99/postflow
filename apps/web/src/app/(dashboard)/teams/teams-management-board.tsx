"use client";

import { Crown, Trash2, UserMinus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type User = { _id: string; email?: string; role: string; status: string; teamId?: string | null };
type Team = {
  _id: string;
  name: string;
  managerId?: string | null;
  manager?: User | null;
  members?: User[];
  teamLeader?: User | null;
  salesCount: number;
};

const MEMBER_ROLES = ["TEAM_LEADER", "SALES"];

export function TeamsManagementBoard({ teams, users, managers, actions }: { teams: Team[]; users: User[]; managers: User[]; actions?: ReactNode }) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    function onSearch(event: Event) {
      const detail = (event as CustomEvent<{ pathname: string; value: string }>).detail;
      if (detail?.pathname === "/teams") setSearch(detail.value);
    }
    window.addEventListener("postflow:topbar-search", onSearch);
    return () => window.removeEventListener("postflow:topbar-search", onSearch);
  }, []);
  const filteredTeams = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return teams;
    return teams.filter((team) => {
      const memberMatch = (team.members ?? []).some((member) => (member.email ?? "").toLowerCase().includes(query));
      return team.name.toLowerCase().includes(query) || (team.manager?.email ?? "").toLowerCase().includes(query) || memberMatch;
    });
  }, [search, teams]);

  return (
    <div className="space-y-4">
      {actions && (
        <div className="-mx-4 border-b border-border bg-background px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex justify-end">
          {actions}
          </div>
        </div>
      )}

      {filteredTeams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">No teams found.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredTeams.map((team) => (
            <TeamCard key={team._id} team={team} users={users} managers={managers} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team, users, managers }: { team: Team; users: User[]; managers: User[] }) {
  const router = useRouter();
  const members = team.members ?? [];
  const candidates = users.filter((user) => user.status === "ACTIVE" && !["ADMIN", "MANAGER"].includes(user.role) && user.teamId !== team._id);
  const [memberId, setMemberId] = useState(candidates[0]?._id ?? "");
  const [memberRole, setMemberRole] = useState("SALES");
  const [managerId, setManagerId] = useState(team.managerId ?? "");
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function addMember() {
    if (!memberId) return;
    await runAction(async () => fetch(`/api/admin/users/${memberId}/team-assignment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: memberRole, teamId: team._id }),
    }), "Member added.");
  }

  async function removeMember(userId: string) {
    await runAction(async () => fetch(`/api/admin/teams/${team._id}/members/${userId}`, { method: "DELETE" }), "Member removed.");
  }

  async function assignLeader(userId: string) {
    await runAction(async () => fetch(`/api/admin/users/${userId}/team-assignment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "TEAM_LEADER", teamId: team._id }),
    }), "Team leader assigned.");
  }

  async function assignManager() {
    await runAction(async () => fetch(`/api/admin/teams/${team._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ managerId: managerId || null }),
    }), "Manager updated.");
  }

  async function deleteTeam() {
    if (!confirm(`Delete ${team.name}? Members will be removed from this team, not deleted.`)) return;
    await runAction(async () => fetch(`/api/admin/teams/${team._id}`, { method: "DELETE" }), "Team deleted.");
  }

  async function runAction(request: () => Promise<Response>, successMessage: string) {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await request();
      const data = await response.json();
      setMessage(response.ok ? successMessage : data.message ?? data.error ?? "Action failed.");
      if (response.ok) router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{team.name}</h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">{team.manager?.email ?? "No manager assigned"}</p>
          </div>
          <button onClick={deleteTeam} disabled={isBusy} className="inline-flex h-8 items-center gap-2 rounded-lg border border-destructive/40 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60">
            <Trash2 className="h-4 w-4" />
            Delete Team
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <select value={managerId} onChange={(event) => setManagerId(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
            <option value="">No manager</option>
            {managers.map((manager) => <option key={manager._id} value={manager._id}>{manager.email ?? "Manager"}</option>)}
          </select>
          <button onClick={assignManager} disabled={isBusy} className="h-10 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">Save Manager</button>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_150px_auto]">
          <select value={memberId} onChange={(event) => setMemberId(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
            {candidates.length === 0 ? <option value="">No available users</option> : candidates.map((user) => <option key={user._id} value={user._id}>{user.email ?? "Unknown email"}</option>)}
          </select>
          <select value={memberRole} onChange={(event) => setMemberRole(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm">
            {MEMBER_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
          <button onClick={addMember} disabled={isBusy || !memberId} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            <UserPlus className="h-4 w-4" />
            Add Member
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Members</h4>
            <span className="text-xs text-muted-foreground">{members.length} total</span>
          </div>
          {members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No members assigned.</div>
          ) : members.map((member) => (
            <div key={member._id} className="grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{member.email ?? "Unknown email"}</p>
                  {member.role === "TEAM_LEADER" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      <Crown className="h-3 w-3" />
                      Team Leader
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Member</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{roleLabel(member.role)}</p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {member.role !== "TEAM_LEADER" && (
                  <button onClick={() => assignLeader(member._id)} disabled={isBusy} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-xs hover:bg-muted disabled:opacity-60">
                    <Crown className="h-4 w-4" />
                    Make Leader
                  </button>
                )}
                <button onClick={() => removeMember(member._id)} disabled={isBusy} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-xs hover:bg-muted disabled:opacity-60">
                  <UserMinus className="h-4 w-4" />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </article>
  );
}

function roleLabel(role: string) {
  return role.replace("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
