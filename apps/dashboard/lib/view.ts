// 화면 판단 로직 (React 없이 테스트할 수 있게 위젯 밖에 둔다).

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

/** 위젯별 표시 개수 상한. 넘치면 "외 n건"으로 줄인다. 스크롤이 없는 화면이라 늘리지 않는다. */
export const LIMITS = {
  agenda: 6,
  checklist: 6,
  dday: 5,
  calendarCell: 2,
} as const;

export function limit<T>(list: readonly T[], max: number): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}
