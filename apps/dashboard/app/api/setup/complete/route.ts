// 마법사 마지막 단계: 세팅 세션이 있는 휴대폰만 위키에 첫 세팅을 쓴다.
// #17의 방어를 그대로 거친다: 출처(BASE_URL origin) -> 세션(via=setup) -> 본문 크기·형식 -> zod 검증(runSetup 안).
import { MAX_JSON_BYTES } from "@/lib/auth/form";
import { authState } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { runSetup } from "@/lib/setup/complete";
import { guardRequest, json, tryConnectStore } from "@/lib/setup/route-deps";
import { getWikiWriter } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await guardRequest(req, MAX_JSON_BYTES);
  if (!g.ok) return json(g.status, g.body);

  let writer;
  try {
    writer = getWikiWriter();
  } catch {
    return json(503, { ok: false, code: "read_only", message: "위키에 쓸 수 없는 설정이에요. 서버의 WIKI_REPO_PATH를 확인해 주세요" });
  }
  const result = await runSetup(g.value, writer, config.get("familyId"), undefined, undefined, tryConnectStore());
  const res = json(result.status, result.body);
  if (result.status === 200) {
    // 세팅이 끝났으니 이 세션과 남은 QR 토큰을 모두 닫는다(세션 쿠키는 서명형이라 서버에서 폐기할 수 없고, 쿠키를 지운다.
    // 훔친 쿠키가 있어도 이후 /setup·이 API는 needsSetup=false라 쓸 수 없다).
    authState().tokens.revokeAll();
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
