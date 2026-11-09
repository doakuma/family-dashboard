// 마법사가 버린 연결 코드(구성원 삭제·이름·역할 변경)를 서버에서도 폐기한다. 같은 방어: 출처 -> 세션 -> 본문 -> zod -> 세팅 필요 확인.
import { revokeConnectCode } from "@/lib/setup/connect";
import { MAX_CONNECT_BYTES } from "@/lib/setup/guard";
import { STATE_DIR_MISSING, connectDeps, guardRequest, json } from "@/lib/setup/route-deps";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await guardRequest(req, MAX_CONNECT_BYTES);
  if (!g.ok) return json(g.status, g.body);
  const deps = connectDeps();
  if (!deps) return json(503, STATE_DIR_MISSING);
  const r = await revokeConnectCode(g.value, deps);
  return json(r.status, r.body);
}
