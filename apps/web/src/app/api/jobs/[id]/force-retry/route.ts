import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const response = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(id)}/force-retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-clerk-user-id": userId },
      body: JSON.stringify({ confirmNoPost: true }),
    });
    const payload = await response.json().catch(() => ({ error: "Force retry failed" }));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Could not force-retry the TikTok publishing job" }, { status: 503 });
  }
}
