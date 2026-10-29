// 날짜 유틸 — 전부 Asia/Seoul 달력 기준의 'YYYY-MM-DD' 문자열로 다룬다(Date의 시간대 함정을 피한다).

export const TZ = "Asia/Seoul";
export const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hm = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** 서울 기준 오늘 'YYYY-MM-DD' */
export const todayIn = (now: Date = new Date()) => ymd.format(now);
/** 서울 기준 지금 'HH:MM' */
export const timeIn = (now: Date = new Date()) => hm.format(now);

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (date: string, n: number) => fromUtc(toUtc(date) + n * 86_400_000);
export const diffDays = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
/** 0 = 일요일 */
export const weekdayOf = (date: string) => new Date(toUtc(date)).getUTCDay();
export const weekdayKo = (date: string) => WEEKDAYS_KO[weekdayOf(date)] ?? "";

/** 매년 반복되는 MM-DD의 다음 날짜 (오늘 포함). 2월 29일은 평년엔 2월 28일로. */
export function nextOccurrence(monthDay: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const fit = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return monthDay === "02-29" && !leap ? `${y}-02-28` : `${y}-${monthDay}`;
  };
  const thisYear = fit(year);
  return thisYear >= today ? thisYear : fit(year + 1);
}

/** 달력 칸: 그 달 1일이 있는 주의 일요일부터 말일이 있는 주의 토요일까지 (5~6주) */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = addDays(first, -weekdayOf(first));
  const nextMonth = addDays(`${month}-28`, 7).slice(0, 7);
  const last = addDays(`${nextMonth}-01`, -1);
  const end = addDays(last, 6 - weekdayOf(last));
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** 만 나이 */
export function ageOn(birth: string, today: string): number {
  const a = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  return today.slice(5) >= birth.slice(5) ? a : a - 1;
}
