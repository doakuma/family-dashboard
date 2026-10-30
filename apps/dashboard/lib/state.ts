import "server-only";
import { toPublicState, todayIn, type ApiState, type DashboardState } from "@hsh/core";
import { FsWikiRepository } from "@hsh/core/node";
import { resolve } from "node:path";
import { SampleWeatherSource, createWeatherSource } from "./weather";

let wiki: FsWikiRepository | undefined;

/** 위키 저장소는 처음 쓸 때 만든다(빌드 중 모듈만 불러올 때 환경 검사로 죽지 않게). */
function getWiki(): FsWikiRepository {
  if (wiki) return wiki;
  const path = process.env.WIKI_REPO_PATH;
  if (path) wiki = new FsWikiRepository({ root: path, push: false });
  else if (process.env.NODE_ENV === "production") {
    // 운영에서 예시 위키를 조용히 보여 주면 가족 데이터가 안 보이는 걸 모르고 지나간다.
    throw new Error("WIKI_REPO_PATH가 필요해요 (family-wiki를 clone한 경로)");
  } else {
    // 개발·시안: 예시 위키를 읽기 전용으로
    wiki = new FsWikiRepository({ root: resolve(process.cwd(), "../../fixtures/sample-wiki"), readOnly: true });
  }
  return wiki;
}
const weather = createWeatherSource();

let lastWarnings = "";
/** 위키 읽기 경고를 서버 로그에 남긴다. 폴링마다 반복되지 않게 내용이 바뀔 때만. */
function logWikiWarnings(warnings: string[]) {
  const sig = warnings.join("\n");
  if (sig === lastWarnings) return;
  lastWarnings = sig;
  for (const w of warnings) console.warn(`[wiki] ${w}`);
}

/** at: 시안용 고정 시각. 예시 날씨도 그 날짜 기준으로 만든다. */
export async function getDashboardState(at?: Date): Promise<DashboardState> {
  const source = at ? new SampleWeatherSource(() => at) : weather;
  const [state, days] = await Promise.all([getWiki().read(), source.week().catch(() => [])]);
  logWikiWarnings(state.warnings);
  // 경고는 화면 상태에 싣지 않는다(허용 목록으로 골라 담는다)
  const { config, members, events, tasks, anniversaries } = state;
  return { config, members, events, tasks, anniversaries, weather: days, updatedAt: new Date().toISOString() };
}

/** /api/state 응답과 첫 화면이 같이 쓰는 공개용 상태(태블릿에 필요한 필드만) + 세팅 필요 여부 */
export async function getApiState(at?: Date): Promise<ApiState> {
  const state = await getDashboardState(at);
  return toPublicState(state, todayIn(at ?? new Date()));
}
