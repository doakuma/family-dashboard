import { addDays, monthGrid, nextOccurrence } from "./date";
import type { ApiState } from "./schema";
import { needsSetup, type DashboardState, type Event } from "./types";

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
      // 공유 그룹 id만(상세 시트용, 결정 0006). 깨진 원문 토큰은 파서가 심볼 키로만 들고 있어 여기서 골라 담지 않으면 나가지 않는다.
      ...(e.share ? { share: e.share } : {}),
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

/**
 * 달력 둘러보기 응답에 실을 일정: 그 달 달력 칸(앞뒤 이웃 달 날짜 포함)의 일정 + 오늘·내일 일정.
 * 오늘·내일은 보고 있는 달과 상관없이 오늘 일정·야간 화면이 쓰므로 항상 포함한다.
 * events/YYYY-MM.md가 없는 달은 자연히 빈 달이 된다.
 */
export function eventsForMonthView(events: readonly Event[], month: string, today: string): Event[] {
  const grid = monthGrid(month);
  const [from, to] = [grid[0] ?? "", grid.at(-1) ?? ""];
  const tomorrow = addDays(today, 1);
  return events.filter((e) => (e.date >= from && e.date <= to) || e.date === today || e.date === tomorrow);
}
