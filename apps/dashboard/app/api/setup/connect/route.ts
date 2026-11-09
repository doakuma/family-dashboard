// 슬랙 연결 코드 발급(마법사 3단계 [코드 받기]). #17의 방어: 폼 출처 -> 세션(via=setup) -> 본문 제한 -> zod -> 세팅 필요 확인(끝났으면 409).
import { issueConnectCode } from "@/lib/setup/connect";
import { MAX_CONNECT_BYTES } from "@/lib/setup/guard";
import { connectDeps, guardRequest, json } from "@/lib/setup/route-deps";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await guardRequest(req, MAX_CONNECT_BYTES);
  if (!g.ok) return json(g.status, g.body);
  const r = await issueConnectCode(g.value, connectDeps());
  return json(r.status, r.body);
}
