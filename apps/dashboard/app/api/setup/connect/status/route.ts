// 슬랙 연결 상태 조회(마법사 3단계 폴링). 코드 목록 -> 코드별 pending|connected|expired. 슬랙 ID는 응답에 없다.
import { connectStatus } from "@/lib/setup/connect";
import { MAX_CONNECT_BYTES } from "@/lib/setup/guard";
import { STATE_DIR_MISSING, connectDeps, guardRequest, json } from "@/lib/setup/route-deps";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await guardRequest(req, MAX_CONNECT_BYTES);
  if (!g.ok) return json(g.status, g.body);
  const deps = connectDeps();
  if (!deps) return json(503, STATE_DIR_MISSING);
  const r = await connectStatus(g.value, deps);
  return json(r.status, r.body);
}
