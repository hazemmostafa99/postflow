import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const target = new URL(`${API_BASE}/api/reports/export`);
  for (const key of ["from", "to", "teamId", "userId", "type"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }

  const response = await fetch(target, {
    headers: { "x-clerk-user-id": userId },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
    });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "Content-Disposition": response.headers.get("content-disposition") ?? "attachment; filename=postflow-performance.csv",
      "Cache-Control": "no-store",
    },
  });
}
