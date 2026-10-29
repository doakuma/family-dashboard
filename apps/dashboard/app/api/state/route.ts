// 태블릿이 1분마다 폴링하는 상태 API. 골격 단계: 빈 상태를 돌려준다.
// 이후 WikiRepository.read() + WeatherSource.week()로 채운다.
import type { DashboardState } from "@hsh/core";

export const dynamic = "force-dynamic";

export function GET() {
  const state: DashboardState = {
    members: [],
    events: [],
    tasks: [],
    anniversaries: [],
    weather: [],
    updatedAt: new Date().toISOString(),
  };
  return Response.json(state);
}
