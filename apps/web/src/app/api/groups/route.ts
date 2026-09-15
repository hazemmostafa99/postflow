import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") ?? "";
  const page = searchParams.get("page") ?? "";
  const limit = searchParams.get("limit") ?? "";

  const url = new URL(`${API_BASE}/api/groups`);
  if (search) url.searchParams.set("search", search);
  if (page) url.searchParams.set("page", page);
  if (limit) url.searchParams.set("limit", limit);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { "x-clerk-user-id": userId },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      page || limit
        ? {
            groups: [],
            pagination: {
              page: Number(page) || 1,
              limit: Number(limit) || 20,
              total: 0,
              totalPages: 1,
            },
          }
        : [],
      { status: 503 },
    );
  }

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const response = await fetch(`${API_BASE}/api/groups`, {
    method: "DELETE",
    headers: { "x-clerk-user-id": userId },
  });
  return new NextResponse(null, { status: response.status });
}
