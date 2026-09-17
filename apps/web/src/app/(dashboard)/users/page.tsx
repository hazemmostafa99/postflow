import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { InviteForm } from "./invite-form";
import { UserManagementTable } from "./user-management-table";

const API_BASE = process.env.API_URL || "http://localhost:8000";

async function api(path: string, userId: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "x-clerk-user-id": userId },
    cache: "no-store",
  });
  return response.ok ? response.json() : [];
}

export default async function UsersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [users, teams] = await Promise.all([
    api("/api/users", userId),
    api("/api/teams", userId),
  ]);

  return (
    <div className="space-y-6">
      <UserManagementTable users={users} teams={teams} />
      <InviteForm teams={teams} />
    </div>
  );
}
