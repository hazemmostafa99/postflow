import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ConnectionsDashboard, type FacebookConnection } from "./connections-dashboard";
import type { ExtensionConnection } from "./connection-platforms";

const API_BASE = process.env.API_URL || "http://localhost:8000";

interface ConnectionsResult {
  connections: FacebookConnection[];
  unavailable: boolean;
  extensions: ExtensionConnection[];
}

async function fetchConnections(userId: string): Promise<ConnectionsResult> {
  try {
    const options = {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store" as const,
    };
    const [response, platformsResponse] = await Promise.all([
      fetch(`${API_BASE}/api/extensions/connections`, options),
      fetch(`${API_BASE}/api/extensions/browser-connections`, options),
    ]);

    if (!response.ok || !platformsResponse.ok) return { connections: [], extensions: [], unavailable: true };

    return {
      connections: (await response.json()) as FacebookConnection[],
      extensions: (await platformsResponse.json()) as ExtensionConnection[],
      unavailable: false,
    };
  } catch {
    return { connections: [], extensions: [], unavailable: true };
  }
}

export const metadata = {
  title: "Connections - iPostFlow",
  description: "Monitor social accounts and iPostFlow browser connections.",
};

export default async function ConnectionsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const result = await fetchConnections(userId);

  return (
    <>
      <ConnectionsDashboard connections={result.connections} extensionConnections={result.extensions} unavailable={result.unavailable} refreshedAt={new Date().toISOString()} />
    </>
  );
}
