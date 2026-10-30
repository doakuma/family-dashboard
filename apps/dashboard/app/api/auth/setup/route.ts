// QR 토큰 + PIN -> 세팅 세션. 토큰은 PIN까지 맞아야 소모된다.
import { NextResponse } from "next/server";
import { authState, isSameOrigin, verifyAdminPin } from "@/lib/auth/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const redirect = (to: string) => new NextResponse(null, { status: 303, headers: { Location: to, "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new NextResponse("forbidden", { status: 403 });
  const form = await req.formData();
  const token = String(form.get("t") ?? "");
  const pin = String(form.get("pin") ?? "");
  const { tokens, codec } = authState();

  if (!tokens.isValid(token)) return new NextResponse("forbidden", { status: 403 });
  const result = verifyAdminPin(pin);
  if (result.status !== "ok") return redirect(`/setup?t=${encodeURIComponent(token)}&e=${result.status}`);

  tokens.consume(token);
  const res = redirect("/setup");
  res.cookies.set(SESSION_COOKIE, codec.sign("setup"), sessionCookieOptions());
  return res;
}
