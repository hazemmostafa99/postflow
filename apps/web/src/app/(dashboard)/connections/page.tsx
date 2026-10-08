import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  ConnectionsDashboard,
  type FacebookConnection,
} from "./connections-dashboard";
import { PlatformConnectionsPanel } from "./platform-connections-panel";

const API_BASE = process.env.API_URL || "http://localhost:8000";

interface ConnectionsResult {
  connections: FacebookConnection[];
  unavailable: boolean;
}

async function fetchConnections(userId: string): Promise<ConnectionsResult> {
  try {
    const response = await fetch(`${API_BASE}/api/extensions/connections`, {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    });

    if (!response.ok) return { connections: [], unavailable: true };

    return {
      connections: (await response.json()) as FacebookConnection[],
      unavailable: false,
    };
  } catch {
    return { connections: [], unavailable: true };
  }
}

export const metadata = {
  title: "Connections - iPostFlow",
  description: "Monitor Facebook accounts and iPostFlow browser connections.",
};

export default async function ConnectionsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const result = await fetchConnections(userId);

  return (
    <>
      <PlatformConnectionsPanel />
      <ConnectionsDashboard
        connections={result.connections}
        unavailable={result.unavailable}
        refreshedAt={new Date().toISOString()}
      />
    </>
  );
}
