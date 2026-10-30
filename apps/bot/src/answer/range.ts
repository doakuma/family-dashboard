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

/** 해를 말하지 않은 날짜(MM-DD)는 오늘에서 가장 가까운 해(작년·올해·내년)로 본다. 같은 거리면 앞으로 올 쪽. */
function yearFor(monthDay: string, today: string): string {
  const y = Number(today.slice(0, 4));
  const cands = [y + 1, y, y - 1].map((yy) => `${yy}-${monthDay}`).filter(isDate);
  let best = cands[0] ?? `${y}-${monthDay}`;
  for (const c of cands) if (Math.abs(diffDays(today, c)) < Math.abs(diffDays(today, best))) best = c;
  return best;
}

type Found = DateRange | DateRange[] | undefined;

/** 해석 결과: 범위 | 너무 김·띄엄띄엄 | 날짜 표현 없음(undefined) */
export function resolveRange(text: string, today: string): DateRange | { error: "too_long" | "ambiguous" } | undefined {
  const found: DateRange[] = [];
  let s = text;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => Found) => {
    for (const m of s.matchAll(re)) {
      const r = fn(m);
      if (r) found.push(...(Array.isArray(r) ? r : [r]));
    }
    s = s.replace(re, " ");
  };
  const day = (d: string): DateRange => ({ from: d, to: d });

  // 1) 절대 날짜: "2027년 1월 5일", "2027-01-05", "11월 3일", "11/3" (해가 없으면 가장 가까운 해)
  const ymd = (y: string | undefined, mo: string, d: string): Found => {
    const k = `${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    const full = y ? `${y}-${k}` : yearFor(k, today);
    return isDate(full) && full.slice(5) === k ? day(full) : undefined;
  };
  take(/(\d{4})-(\d{2})-(\d{2})/g, (m) => ymd(m[1], m[2] ?? "", m[3] ?? ""));
  take(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m) => ymd(m[1], m[2] ?? "", m[3] ?? ""));
  take(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (m) => ymd(undefined, m[1] ?? "", m[2] ?? ""));

  // 2) 이번/다음 주(말), 요일 지정. 이어지는 요일("토요일이랑 일요일")은 앞의 주 수식을 물려받는다.
  take(
    /(다다음|다음|이번|지난|저번)\s*주(말)?(?:에|의)?((?:\s*(?:,|와|과|이랑|랑|하고|및|그리고|이나|나)?\s*[일월화수목금토]요일)+)?/g,
    (m) => {
      const monday = addDays(mondayOf(today), 7 * (WEEK_OFFSET[m[1] ?? ""] ?? 0));
      if (m[2]) return { from: addDays(monday, 5), to: addDays(monday, 6) };
      if (m[3]) return [...m[3].matchAll(/([일월화수목금토])요일/g)].map((w) => day(addDays(monday, ((WEEKDAY_INDEX[w[1] ?? ""] ?? 0) + 6) % 7)));
      return { from: monday, to: addDays(monday, 6) };
    },
  );

  // 3) 달
  take(/(다다음|다음|이번|지난|저번)\s*달/g, (m) => {
    const off = m[1] === "다다음" ? 2 : m[1] === "다음" ? 1 : m[1] === "이번" ? 0 : -1;
    const month = addMonths(today.slice(0, 7), off);
    return { from: `${month}-01`, to: monthEnd(month) };
  });
  take(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월/g, (m) => {
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return undefined;
    const mm = String(mo).padStart(2, "0");
    const first = m[1] ? `${m[1]}-${mm}-01` : yearFor(`${mm}-01`, today);
    return isDate(first) ? { from: first, to: monthEnd(first.slice(0, 7)) } : undefined;
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
  const sorted = [...found].sort((a, b) => a.from.localeCompare(b.from));
  const from = sorted[0]?.from ?? today;
  const to = found.map((r) => r.to).sort().at(-1) ?? from;
  if (diffDays(from, to) + 1 > MAX_SPAN_DAYS) return { error: "too_long" };
  // 떨어진 날짜들은 하나의 범위로 묶으면 묻지 않은 날이 끼므로 이어질 때만 받는다
  let end = sorted[0]?.to ?? from;
  for (const r of sorted) {
    if (diffDays(end, r.from) > 1) return { error: "ambiguous" };
    if (r.to > end) end = r.to;
  }
  return { from, to };
}
