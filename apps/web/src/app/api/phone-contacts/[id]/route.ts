import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

async function proxyMutation(request: Request, id: string, method: "PATCH" | "DELETE") {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = method === "PATCH" ? await request.text() : undefined;
  const response = await fetch(
    `${API_BASE}/api/phone-contacts/${encodeURIComponent(id)}`,
    {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        "x-clerk-user-id": userId,
      },
      body,
    },
  );
  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const data = await response.json().catch(() => null);
  return NextResponse.json(data, { status: response.status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyMutation(request, id, "PATCH");
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyMutation(request, id, "DELETE");
}
