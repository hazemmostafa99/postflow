import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const response = await fetch(`${API_BASE}/api/groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-clerk-user-id": userId },
    });
    return new NextResponse(null, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Could not delete group" }, { status: 503 });
  }
}
