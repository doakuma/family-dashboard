import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new NextResponse("forbidden", { status: 403 });
  const res = new NextResponse(null, { status: 303, headers: { Location: "/", "cache-control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
