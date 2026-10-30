// 태블릿이 1분마다 폴링하는 상태 API. 요청 때마다 위키 사본을 파싱해 돌려준다.
import { getApiState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getApiState(), { headers: { "cache-control": "no-store" } });
}
