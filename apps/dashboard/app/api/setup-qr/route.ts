// 세팅 필요 화면이 QR을 새로 받아 가는 곳(토큰은 30분마다 바뀐다). 세팅이 끝났으면 토큰을 만들지 않는다.
import { getSetupQr } from "@/lib/setup-qr";
import { getApiState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "cache-control": "no-store" };
  if (!(await getApiState()).needsSetup) return Response.json({ error: "not-needed" }, { status: 404, headers });
  return Response.json(await getSetupQr(), { headers });
}
