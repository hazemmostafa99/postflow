import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const response = await fetch(`${API_BASE}/api/invitations`, { method: "POST", headers: { "Content-Type": "application/json", "x-clerk-user-id": userId }, body: JSON.stringify(body) });
  return NextResponse.json(await response.json(), { status: response.status });
}
