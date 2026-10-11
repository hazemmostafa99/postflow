import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = new URL(request.url).searchParams.toString();
  const response = await fetch(
    `${API_BASE}/api/phone-contacts${query ? `?${query}` : ""}`,
    {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    },
  );
  const data = await response.json().catch(() => null);
  return NextResponse.json(data, { status: response.status });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const response = await fetch(`${API_BASE}/api/phone-contacts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-clerk-user-id": userId,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return NextResponse.json(data, { status: response.status });
}
