import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const response = await fetch(`${API_BASE}/api/posts/${encodeURIComponent(id)}/schedule`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-clerk-user-id": userId,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  return NextResponse.json(data, { status: response.status });
}
