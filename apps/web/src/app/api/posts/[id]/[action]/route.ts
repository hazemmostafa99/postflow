import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";
const ALLOWED_ACTIONS = new Set(["pause", "resume", "cancel"]);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, action } = await params;
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unsupported post action" }, { status: 404 });
  }

  const response = await fetch(
    `${API_BASE}/api/posts/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      headers: { "x-clerk-user-id": userId },
    },
  );

  const data = await response.json().catch(() => null);
  return NextResponse.json(data, { status: response.status });
}
