import { nextOccurrence } from "./date";
import type { ApiState } from "./schema";
import { needsSetup, type DashboardState } from "./types";

/**
 * 내부 상태 -> /api/state 공개 응답. 허용 목록 방식이라 DashboardState에 필드가 늘어도 자동으로 새지 않는다.
 * today: 서버 기준 오늘(YYYY-MM-DD). 생일 나이 계산에 쓴다.
 */
export function toPublicState(state: DashboardState, today: string): ApiState {
  const births = new Map(state.members.map((m) => [m.id, m.birth]));
  return {
    familyName: state.config?.familyName,
    members: state.members.map((m) => ({ id: m.id, name: m.name, color: m.color })),
    events: state.events.map((e) => ({
      id: e.id,
      date: e.date,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      title: e.title,
      members: [...e.members],
      done: e.done,
    })),
    tasks: state.tasks.map((t) => ({ id: t.id, list: t.list, title: t.title, member: t.member, done: t.done })),
    anniversaries: state.anniversaries.map((a) => {
      const birth = a.member ? births.get(a.member) : undefined;
      const date = nextOccurrence(a.monthDay, today);
      const turns = birth && /생일/.test(a.title) ? { date, age: Number(date.slice(0, 4)) - Number(birth.slice(0, 4)) } : undefined;
      return { monthDay: a.monthDay, title: a.title, member: a.member, turns };
    }),
    weather: state.weather.map((w) => ({ date: w.date, icon: w.icon, max: w.max, min: w.min, pop: w.pop })),
    updatedAt: state.updatedAt,
    needsSetup: needsSetup(state),
    skin: state.skin,
    character: "none", // #29(캐릭터 층) 전까지 고정
  };
}
