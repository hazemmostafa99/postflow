import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { path } = await context.params;
  if (path.length > 2 || !/^[a-f\d]{24}$/i.test(path[0]) || (path[1] && !["pause", "resume", "disconnect", "force-disconnect", "remove"].includes(path[1]))) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  try {
    const response = await fetch(`${process.env.API_URL || "http://localhost:8000"}/api/extensions/browser-connections/${path.join("/")}`, {
      method: request.method,
      headers: { "x-clerk-user-id": userId, "Content-Type": "application/json" },
      ...(request.method === "PATCH" ? { body: await request.text() } : {}),
      cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "Could not update browser connection" }, { status: 503 });
  }
}

export const PATCH = forward;
export const POST = forward;
