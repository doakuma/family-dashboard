// /settings용: PIN만으로 세션 발급
import { NextResponse } from "next/server";
import { authState, isSameOrigin, verifyAdminPin } from "@/lib/auth/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const redirect = (to: string) => new NextResponse(null, { status: 303, headers: { Location: to, "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new NextResponse("forbidden", { status: 403 });
  const pin = String((await req.formData()).get("pin") ?? "");
  const result = verifyAdminPin(pin);
  if (result.status !== "ok") return redirect(`/settings?e=${result.status}`);
  const res = redirect("/settings");
  res.cookies.set(SESSION_COOKIE, authState().codec.sign("pin"), sessionCookieOptions());
  return res;
}
