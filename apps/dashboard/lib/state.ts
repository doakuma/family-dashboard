import "server-only";
import { type DashboardState } from "@hsh/core";
import { FsWikiRepository } from "@hsh/core/node";
import { resolve } from "node:path";
import { SampleWeatherSource, createWeatherSource } from "./weather";

// WIKI_REPO_PATH가 없으면(개발·시안) 예시 위키를 읽는다.
const root = process.env.WIKI_REPO_PATH ?? resolve(process.cwd(), "../../fixtures/sample-wiki");
const wiki = new FsWikiRepository({ root, push: false });
const weather = createWeatherSource();

/** at: 시안용 고정 시각. 예시 날씨도 그 날짜 기준으로 만든다. */
export async function getDashboardState(at?: Date): Promise<DashboardState> {
  const source = at ? new SampleWeatherSource(() => at) : weather;
  const [state, days] = await Promise.all([wiki.read(), source.week().catch(() => [])]);
  return { ...state, weather: days, updatedAt: new Date().toISOString() };
}
