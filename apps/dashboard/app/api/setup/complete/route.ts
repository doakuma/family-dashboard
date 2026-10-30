// 마법사 마지막 단계: 세팅 세션이 있는 휴대폰만 위키에 첫 세팅을 쓴다.
// #17의 방어를 그대로 거친다: 세션(via=setup) -> 출처(BASE_URL origin) -> 본문 크기·형식 -> zod 검증(applySetup 안).
import { NextResponse } from "next/server";
import { MAX_JSON_BYTES, readSmallJson } from "@/lib/auth/form";
import { authState, isSameOrigin, readSession } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { runSetup } from "@/lib/setup/complete";
import { getWikiWriter } from "@/lib/state";

export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json(403, { ok: false, code: "forbidden", message: "허용되지 않은 출처예요" });
  const session = await readSession();
  if (session?.via !== "setup") return json(401, { ok: false, code: "no_session", message: "세션이 끝났어요. 태블릿의 QR코드를 다시 찍어 주세요" });

  const read = await readSmallJson(req, MAX_JSON_BYTES);
  if (!read.ok) return json(read.status, { ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요" });

  let writer;
  try {
    writer = getWikiWriter();
  } catch {
    return json(503, { ok: false, code: "read_only", message: "위키에 쓸 수 없는 설정이에요. 서버의 WIKI_REPO_PATH를 확인해 주세요" });
  }
  const result = await runSetup(read.value, writer);
  const res = json(result.status, result.body);
  if (result.status === 200) {
    // 세팅이 끝났으니 이 세션과 남은 QR 토큰을 모두 닫는다(세션 쿠키는 서명형이라 서버에서 폐기할 수 없고, 쿠키를 지운다.
    // 훔친 쿠키가 있어도 이후 /setup·이 API는 needsSetup=false라 쓸 수 없다).
    authState().tokens.revokeAll();
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
