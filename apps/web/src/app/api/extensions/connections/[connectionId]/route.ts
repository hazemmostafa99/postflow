import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://localhost:8000";

async function forwardRequest(
  method: string,
  path: string,
  userId: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "x-clerk-user-id": userId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { connectionId } = await params;
  const body = await request.json();

  return forwardRequest("PATCH", `/api/extensions/connections/${connectionId}/name`, userId, {
    extensionName: body.name,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { connectionId } = await params;

  return forwardRequest("DELETE", `/api/extensions/connections/${connectionId}`, userId);
}