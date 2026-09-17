"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export function InviteForm({ teams }: { teams: Array<{ _id: string; name: string }> }) {
  const [role, setRole] = useState("SALES");
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const requiresTeam = role === "SALES" || role === "TEAM_LEADER";

  useEffect(() => {
    function open() {
      setMessage("");
      setIsOpen(true);
    }
    window.addEventListener("postflow:invite-user", open);
    return () => window.removeEventListener("postflow:invite-user", open);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/admin/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), role, teamId: requiresTeam ? form.get("teamId") : null }) });
    const data = await response.json();
    setMessage(response.ok ? "Invitation sent." : data.message ?? "Could not send invitation.");
    if (response.ok) {
      formElement.reset();
      setRole("SALES");
    }
  }

  if (!isOpen) return null;

  return <div
    className="fixed inset-0 z-50 flex min-h-screen items-center justify-center overflow-y-auto bg-background/60 px-4 py-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-labelledby="invite-user-title"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) setIsOpen(false);
    }}
  >
    <form onSubmit={submit} className="my-auto w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="invite-user-title" className="text-base font-semibold">Invite a user</h2><p className="mt-1 text-xs text-muted-foreground">Send a Clerk invitation and assign the PostFlow access role.</p></div>
        <button type="button" onClick={() => setIsOpen(false)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <div><label className="text-sm font-medium">Email</label><input name="email" type="email" required className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" placeholder="name@company.com" /></div>
      <div><label className="text-sm font-medium">Role</label><select name="role" value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option>ADMIN</option><option>MANAGER</option><option>TEAM_LEADER</option><option>SALES</option></select></div>
      {requiresTeam && <div><label className="text-sm font-medium">Team</label><select name="teamId" required className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"><option value="">Select a team</option>{teams.map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}</select></div>}
      <div className="flex items-center gap-2">
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Send invitation</button>
        <button type="button" onClick={() => setIsOpen(false)} className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">Cancel</button>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </form>
  </div>;
}
