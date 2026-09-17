import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, userId } = await params;
  const response = await fetch(`${API_BASE}/api/teams/${id}/members/${userId}`, {
    method: "DELETE",
    headers: { "x-clerk-user-id": clerkUserId },
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
