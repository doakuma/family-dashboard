// 화면 판단 로직 (React 없이 테스트할 수 있게 위젯 밖에 둔다).
import { eventSortKey, type Event } from "@hsh/core";

/** 23시~6시는 야간 화면. time은 "HH:MM" */
export function isNight(time: string): boolean {
  return time >= "23:00" || time < "06:00";
}

/** 갱신이 이 시간(ms)보다 오래되면 "서버 연결 끊김" 경고 */
export const STALE_AFTER_MS = 3 * 60_000;

/** 연결이 끊겼거나 마지막 갱신이 3분보다 오래됐으면 true (정확히 3분은 아직 정상) */
export function isStale(opts: { offline: boolean; now: Date; updatedAt: string }): boolean {
  return opts.offline || opts.now.getTime() - new Date(opts.updatedAt).getTime() > STALE_AFTER_MS;
}

/** 위젯별 표시 개수 상한. 넘치면 "외 n건"으로 줄인다. 오늘 일정은 자동 순환 영역이라 상한이 없다. */
export const LIMITS = {
  checklist: 6,
  dday: 5,
  calendarCell: 2,
} as const;

export function limit<T>(list: readonly T[], max: number): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/** 지난 일정인지: 완료했거나 끝(없으면 시작) 시각이 지났다. 종일 일정은 하루 내내 '진행 중' */
export function isPast(e: Pick<Event, "done" | "allDay" | "start" | "end">, nowTime: string): boolean {
  if (e.done) return true;
  if (e.allDay || !e.start) return false;
  return (e.end ?? e.start) < nowTime;
}

/** 오늘 일정: 남은 일정 먼저 시간순, 지난 일정은 그 아래(역시 시간순) */
export function orderAgenda(events: readonly Event[], today: string, nowTime: string): { upcoming: Event[]; past: Event[] } {
  const list = events.filter((e) => e.date === today).sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  return { upcoming: list.filter((e) => !isPast(e, nowTime)), past: list.filter((e) => isPast(e, nowTime)) };
}
