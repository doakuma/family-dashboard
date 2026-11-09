// 설정 변경(구성원 추가·색·슬랙 재연결·지역). #17의 방어를 그대로 거친다: 출처 -> PIN 세션(via=pin) -> 본문 크기·형식 -> zod(runSettings 안).
// 상태 코드: 200, 401(세션), 403(출처), 409(충돌·세팅 전·연결 전), 411·413·415·400(본문), 422(값), 429, 503(쓸 수 없는 위키·상태 폴더).
import { isSameOrigin, readSession } from "@/lib/auth/server";
import { config } from "@/lib/config";
import { runSettings } from "@/lib/settings/api";
import { MAX_SETTINGS_BYTES, guardSettingsJson } from "@/lib/setup/guard";
import { json, tryConnectStore } from "@/lib/setup/route-deps";
import { getSettingsState, getWikiWriter } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await guardSettingsJson(req, { isSameOrigin, readSession }, MAX_SETTINGS_BYTES);
  if (!g.ok) return json(g.status, g.body);

  let repo;
  try {
    repo = getWikiWriter();
  } catch {
    return json(503, { ok: false, code: "read_only", message: "위키에 쓸 수 없는 설정이에요. 서버의 WIKI_REPO_PATH를 확인해 주세요" });
  }
  const r = await runSettings(g.value, { repo, read: async () => (await getSettingsState()).state, connect: tryConnectStore(), familyId: config.get("familyId") });
  return json(r.status, r.body);
}
