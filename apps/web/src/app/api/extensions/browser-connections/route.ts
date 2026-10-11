import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const response = await fetch(`${process.env.API_URL || "http://localhost:8000"}/api/extensions/browser-connections`, {
      headers: { "x-clerk-user-id": userId }, cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "Could not load browser connections" }, { status: 503 });
  }
}

