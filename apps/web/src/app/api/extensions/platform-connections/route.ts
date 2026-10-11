import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const platform = new URL(request.url).searchParams.get("platform")?.toUpperCase();
    const query = platform === "TIKTOK" || platform === "INSTAGRAM"
      ? `?platform=${platform}`
      : "";
    const response = await fetch(`${API_BASE}/api/extensions/platform-connections${query}`, {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Could not load platform connections" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_BASE}/api/extensions/platform-connections`, {
      method: "POST",
      headers: {
        "x-clerk-user-id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Could not create platform connection" },
      { status: 503 },
    );
  }
}
