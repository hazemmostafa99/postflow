import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const response = await fetch(`${API_BASE}/api/users/${id}/team-assignment`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-clerk-user-id": userId,
    },
    body: JSON.stringify(await request.json()),
  });

  return NextResponse.json(await response.json(), { status: response.status });
}
