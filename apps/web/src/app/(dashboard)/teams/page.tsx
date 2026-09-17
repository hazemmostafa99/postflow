import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CreateTeamForm } from "./create-team-form";
import { TeamsManagementBoard } from "./teams-management-board";

const API_BASE = process.env.API_URL || "http://localhost:8000";

async function api(path: string, userId: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "x-clerk-user-id": userId },
    cache: "no-store",
  });
  return response.ok ? response.json() : [];
}

export default async function TeamsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [teams, users, currentUser] = await Promise.all([
    api("/api/teams", userId),
    api("/api/users", userId),
    api("/api/auth/me", userId),
  ]);
  const managers = users.filter((user: { role: string; status: string }) => user.role === "MANAGER" && user.status === "ACTIVE");

  return (
    <div>
      <TeamsManagementBoard
        teams={teams}
        users={users}
        managers={managers}
      />
      {currentUser.role === "ADMIN" && <CreateTeamForm managers={managers} />}
    </div>
  );
}
