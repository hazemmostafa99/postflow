import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  try {
    const response = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(id)}/tiktok-reconciliation`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-clerk-user-id": userId }, body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({ error: "Reconciliation failed" }));
    return NextResponse.json(payload, { status: response.status });
  } catch { return NextResponse.json({ error: "Could not reconcile TikTok job" }, { status: 503 }); }
}
