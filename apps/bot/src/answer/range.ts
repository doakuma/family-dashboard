// 질문 속 상대 날짜를 서울 기준 절대 날짜 범위로 바꾸는 결정적 해석기. LLM 값보다 우선한다.
// 주는 월요일 시작(intent/prompt.ts의 calendarTable과 같다).
import { addDays, addMonths, diffDays, isDate, weekdayOf } from "@hsh/core";

export interface DateRange {
  from: string;
  to: string;
}
/** 한 번에 보여 줄 수 있는 최대 길이(일). 슬랙 한 메시지에 담을 수 있는 양을 넘기지 않게 한다. */
export const MAX_SPAN_DAYS = 62;

const WEEKDAY_INDEX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const WEEK_OFFSET: Record<string, number> = { 지난: -1, 저번: -1, 이번: 0, 다음: 1, 다다음: 2 };
const DAY_WORDS: [string, number][] = [
  ["그저께", -2],
  ["그제", -2],
  ["어제", -1],
  ["오늘", 0],
  ["내일", 1],
  ["모레", 2],
  ["글피", 3],
];

const mondayOf = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7));
const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/** 월·일만 말하면 올해로 보되, 이미 두 달 넘게 지난 날짜면 내년으로 본다. */
function yearFor(monthDay: string, today: string): string {
  const y = Number(today.slice(0, 4));
  return diffDays(`${y}-${monthDay}`, today) > 60 ? `${y + 1}-${monthDay}` : `${y}-${monthDay}`;
}

/** 해석 결과: 범위 | 너무 김 | 날짜 표현 없음(undefined) */
export function resolveRange(text: string, today: string): DateRange | { error: "too_long" } | undefined {
  const found: DateRange[] = [];
  let s = text;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => DateRange | undefined) => {
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      const r = fn(m);
      if (r) found.push(r);
      return " ";
    });
  };
  const day = (d: string): DateRange => ({ from: d, to: d });

  // 1) 절대 날짜: "11월 3일", "11/3"
  const md = (mo: string, d: string) => {
    const k = `${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    const full = yearFor(k, today);
    return isDate(full) && full.slice(5) === k ? day(full) : undefined;
  };
  take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m) => md(m[1] ?? "", m[2] ?? ""));
  take(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (m) => md(m[1] ?? "", m[2] ?? ""));

  // 2) 이번/다음 주(말), 요일 지정
  take(/(다다음|다음|이번|지난|저번)\s*주(말)?(?:\s*([일월화수목금토])요일)?/g, (m) => {
    const monday = addDays(mondayOf(today), 7 * (WEEK_OFFSET[m[1] ?? ""] ?? 0));
    if (m[2]) return { from: addDays(monday, 5), to: addDays(monday, 6) };
    if (m[3]) return day(addDays(monday, ((WEEKDAY_INDEX[m[3]] ?? 0) + 6) % 7));
    return { from: monday, to: addDays(monday, 6) };
  });

  // 3) 달
  take(/(다다음|다음|이번|지난|저번)\s*달/g, (m) => {
    const off = m[1] === "다다음" ? 2 : m[1] === "다음" ? 1 : m[1] === "이번" ? 0 : -1;
    const month = addMonths(today.slice(0, 7), off);
    return { from: `${month}-01`, to: monthEnd(month) };
  });
  take(/(\d{1,2})\s*월/g, (m) => {
    const mo = Number(m[1]);
    if (mo < 1 || mo > 12) return undefined;
    const first = yearFor(`${String(mo).padStart(2, "0")}-01`, today);
    return { from: first, to: monthEnd(first.slice(0, 7)) };
  });

  // 4) 오늘·내일·모레 …
  s = s.replace(/내일\s*모레/g, "모레");
  for (const [w, n] of DAY_WORDS) take(new RegExp(w, "g"), () => day(addDays(today, n)));

  // 5) 주말(그냥): 다가오는 주말. 토요일이면 오늘~내일, 일요일이면 오늘만
  take(/주말/g, () => {
    const dow = weekdayOf(today);
    if (dow === 0) return day(today);
    const sat = addDays(today, 6 - dow);
    return { from: sat, to: addDays(sat, 1) };
  });

  // 6) 요일만: 오늘 이후 가장 가까운 그 요일(오늘 포함)
  take(/([일월화수목금토])요일/g, (m) => day(addDays(today, (((WEEKDAY_INDEX[m[1] ?? ""] ?? 0) - weekdayOf(today)) + 7) % 7)));

  if (!found.length) return undefined;
  const from = found.map((r) => r.from).sort()[0] ?? today;
  const to = found.map((r) => r.to).sort().at(-1) ?? from;
  if (diffDays(from, to) + 1 > MAX_SPAN_DAYS) return { error: "too_long" };
  return { from, to };
}
