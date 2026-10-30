// 질문 속 상대 날짜를 서울 기준 절대 날짜 범위로 바꾸는 결정적 해석기. LLM 값보다 우선한다.
// MVP 스펙 rev 62 '날짜 해석': 주는 일요일~토요일(대시보드 달력과 같다, intent/prompt.ts의 calendarTable도 같다).
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

/** 과거형으로 묻는 말("뭐 했어?", "있었지?"). 연도 없는 날짜·요일만 말한 경우 가장 최근에 지난 날로 읽는다. */
const PAST = /[았었했](?:어|지|나|니|던|죠|을|는|다|네|[?？]|\s|$)/;
const sundayOf = (d: string) => addDays(d, -weekdayOf(d));
const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/**
 * 해를 말하지 않은 날짜(MM-DD): 과거형이면 가장 최근에 지난 날(오늘은 지난 날이 아니다), 아니면 다가오는 날(오늘 포함).
 * 2월 29일처럼 없는 해가 있으면 그 해를 건너뛴다.
 */
function dayFor(monthDay: string, today: string, past: boolean): string | undefined {
  const y = Number(today.slice(0, 4));
  for (let i = 0; i <= 8; i++) {
    const c = `${past ? y - i : y + i}-${monthDay}`;
    if (isDate(c) && (past ? c < today : c >= today)) return c;
  }
  return undefined;
}

/** 해를 말하지 않은 달(MM): 과거형이면 이미 시작한 가장 최근 달, 아니면 아직 끝나지 않은 가장 가까운 달(이번 달 포함). */
function monthFor(mm: string, today: string, past: boolean): string {
  const y = Number(today.slice(0, 4));
  for (let i = 0; i <= 1; i++) {
    const first = `${past ? y - i : y + i}-${mm}-01`;
    if (past ? first < today : monthEnd(first.slice(0, 7)) >= today) return first;
  }
  return `${y}-${mm}-01`;
}

type Found = DateRange | DateRange[] | undefined;

type Resolved = DateRange | { error: "too_long" | "ambiguous" } | undefined;

/**
 * 해석 결과: 범위 | 너무 김·띄엄띄엄 | 날짜 표현 없음(undefined).
 * "A 말고 B"는 B에 날짜 표현이 있으면 B만, 없으면("핼러윈 말고 뭐 있어?") A를 읽는다.
 */
export function resolveRange(text: string, today: string): Resolved {
  const past = PAST.test(text);
  const cut = text.search(/말고|아니고/);
  if (cut >= 0) {
    const after = resolveOne(text.slice(cut).replace(/^(?:말고|아니고)/, ""), today, past);
    if (after) return after;
    return resolveOne(text.slice(0, cut), today, past);
  }
  return resolveOne(text, today, past);
}

function resolveOne(text: string, today: string, past: boolean): Resolved {
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

  // 1) 절대 날짜: "2027년 1월 5일", "2027-01-05", "11월 3일", "11/3" (해가 없으면 과거형은 가장 최근에 지난 날, 아니면 다가오는 날)
  const ymd = (y: string | undefined, mo: string, d: string): Found => {
    const k = `${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    const full = y ? `${y}-${k}` : dayFor(k, today, past);
    return full && isDate(full) && full.slice(5) === k ? day(full) : undefined;
  };
  take(/(\d{4})-(\d{2})-(\d{2})/g, (m) => ymd(m[1], m[2] ?? "", m[3] ?? ""));
  take(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m) => ymd(m[1], m[2] ?? "", m[3] ?? ""));
  take(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (m) => ymd(undefined, m[1] ?? "", m[2] ?? ""));

  // 2) 이번/다음 주(말), 요일 지정. 이어지는 요일("토요일이랑 일요일")은 앞의 주 수식을 물려받는다.
  //    주는 일~토. 단 "이번 주 일요일"은 돌아오는 일요일(일요일 당일이면 오늘), "다음 주 일요일"은 그다음 일요일.
  const weekStart = sundayOf(today);
  const comingSunday = addDays(today, (7 - weekdayOf(today)) % 7);
  const dayIn = (off: number, dow: number) => (dow === 0 && off >= 0 ? addDays(comingSunday, 7 * off) : addDays(weekStart, 7 * off + dow));
  take(
    /(다다음|다음|이번|지난|저번)\s*주(말)?(?:에|의)?((?:\s*(?:,|와|과|이랑|랑|하고|및|그리고|이나|나)?\s*[일월화수목금토]요일)+)?/g,
    (m) => {
      const off = WEEK_OFFSET[m[1] ?? ""] ?? 0;
      // 주말 = 그 주 토요일 + 일요일. 일요일 당일의 "이번 주말"은 토요일(6일 뒤)과 오늘이라 떨어져서 되묻는다.
      if (m[2]) {
        const sat = dayIn(off, 6);
        return [day(sat), day(off >= 0 ? dayIn(off, 0) : addDays(sat, 1))];
      }
      if (m[3]) return [...m[3].matchAll(/([일월화수목금토])요일/g)].map((w) => day(dayIn(off, WEEKDAY_INDEX[w[1] ?? ""] ?? 0)));
      const from = addDays(weekStart, 7 * off);
      return { from, to: addDays(from, 6) };
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
    const first = m[1] ? `${m[1]}-${mm}-01` : monthFor(mm, today, past);
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

  // 6) 요일만: 과거형이면 가장 최근에 지난 그 요일(오늘 제외), 아니면 오늘 이후 가장 가까운 그 요일(오늘 포함)
  take(/([일월화수목금토])요일/g, (m) => {
    const diff = (WEEKDAY_INDEX[m[1] ?? ""] ?? 0) - weekdayOf(today);
    const back = ((((-diff - 1) % 7) + 7) % 7) + 1; // 1..7일 전
    return day(addDays(today, past ? -back : ((diff % 7) + 7) % 7));
  });

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
