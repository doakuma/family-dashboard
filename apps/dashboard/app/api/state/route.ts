// 태블릿이 1분마다 폴링하는 상태 API. 요청 때마다 위키 사본을 파싱해 돌려준다.
// ?at=ISO: 개발 모드(previewQuery)에서만 받는 고정 시각.
// ?month=YYYY-MM: 달력 둘러보기용 달(없으면 이번 달). 형식·범위(2000-01~2100-12)가 틀리거나 여러 번 주면 400.
import { parseMonth } from "@hsh/core";
import { config } from "@/lib/config";
import { parsePreview } from "@/lib/preview";
import { getApiState } from "@/lib/state";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let month: string | undefined;
  if (params.has("month")) {
    const all = params.getAll("month");
    month = all.length === 1 ? parseMonth(all[0]) : undefined;
    if (!month) return Response.json({ error: "invalid_month", message: "month는 YYYY-MM(2000-01~2100-12) 형식이어야 해요" }, { status: 400, headers: NO_STORE });
  }
  // ?at=: 시안·테스트용 고정 시각(오늘·내일 기준). previewQuery가 꺼진 운영에서는 무시한다(page와 같은 규칙).
  const { at } = parsePreview({ at: params.get("at") ?? undefined }, config.get("previewQuery"));
  return Response.json(await getApiState(at ? new Date(at) : undefined, month), { headers: NO_STORE });
}
