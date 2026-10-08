import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

async function forwardPost(
  path: string,
  userId: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "x-clerk-user-id": userId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string; action: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { connectionId, action } = await params;

  switch (action) {
    case "pause":
      return forwardPost(`/api/extensions/connections/${connectionId}/pause`, userId);
    case "resume":
      return forwardPost(`/api/extensions/connections/${connectionId}/resume`, userId);
    case "disconnect":
      return forwardPost(`/api/extensions/connections/${connectionId}/disconnect`, userId);
    case "force-disconnect":
      return forwardPost(`/api/extensions/connections/${connectionId}/force-disconnect`, userId);
    case "reconnect-approval":
      return forwardPost(`/api/extensions/connections/${connectionId}/reconnect-approval`, userId);
    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}