// 질문 속 상대 날짜를 서울 기준 절대 날짜 범위로 바꾸는 결정적 해석기. LLM 값보다 우선한다.
// 스펙 rev 62 '날짜 해석'(질문·쓰기 공통):
// - 주는 일요일~토요일(대시보드 달력, intent/prompt.ts의 calendarTable과 같다). "이번 주" = 오늘이 든 일~토.
// - "X주 일요일"만 예외: 이번 주 일요일 = 돌아오는 일요일(일요일 당일이면 오늘), 다음 주 일요일 = 그다음, 지난 주 일요일 = 이번 −7.
// - "이번/다음 주말" = 그 주 토요일 + 그다음 날 일요일. 일요일 당일의 "이번 주말"은 오늘만(진행 중인 주말).
// - 연도 없는 날짜·"M월"·요일만: 과거형 질문(했어/있었지 등)이면 가장 최근에 지난 날(오늘 제외, "M월"은 이번 달이면 이번 달),
//   그 외는 다가오는 날(오늘 포함, "M월"은 이번 달이면 이번 달). 연도를 말하면 그대로 쓴다.
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

const sundayOf = (d: string) => addDays(d, -weekdayOf(d));
const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);
/** 오늘 이후(오늘 포함) 돌아오는 일요일 */
const upcomingSunday = (d: string) => addDays(d, (7 - weekdayOf(d)) % 7);

/**
 * 과거형 질문인가: '었/았/했/였/갔/왔/봤…' 계열 어미가 있으면 과거형. 미래 약속을 되묻는 "~하기로 했지"는 제외한다.
 * 결정적 규칙이며 LLM 값은 쓰지 않는다.
 */
const PAST_CUE = /[었았했였갔왔봤썼줬셨]/;
const PAST_EXCLUDE = /기로\s*했|하자고\s*했/g;
export const isPastQuestion = (text: string): boolean => PAST_CUE.test(text.replace(PAST_EXCLUDE, " "));

/** 연도 없는 MM-DD: 과거형이면 오늘 이전 가장 최근, 아니면 오늘 이후(오늘 포함) 가장 가까운 날. 2/29처럼 없는 해는 건너뛴다. */
function yearlessDate(monthDay: string, today: string, past: boolean): string | undefined {
  const y = Number(today.slice(0, 4));
  for (let i = 0; i <= 8; i++) {
    const c = `${past ? y - i : y + i}-${monthDay}`;
    if (!isDate(c) || c.slice(5) !== monthDay) continue;
    if (past ? c < today : c >= today) return c;
  }
  return undefined;
}

export interface ResolveOptions {
  /** 과거형 질문으로 볼지. 기본은 글의 어미로 판별한다. */
  past?: boolean;
}

type Found = DateRange | DateRange[] | undefined;

/** 해석 결과: 범위 | 너무 김·띄엄띄엄 | 날짜 표현 없음(undefined) */
export function resolveRange(text: string, today: string, opts: ResolveOptions = {}): DateRange | { error: "too_long" | "ambiguous" } | undefined {
  const found: DateRange[] = [];
  const past = opts.past ?? isPastQuestion(text);
  // "이번 주 말고 다음 주": 말고 뒤에 날짜가 있으면 뒤쪽만, 없으면("토요일에 핼러윈 말고 뭐 있어?") 앞쪽만 읽는다
  const cut = text.indexOf("말고");
  if (cut >= 0) {
    const tail = resolveRange(text.slice(cut + 2), today, { past });
    if (tail) return tail;
    return resolveRange(text.slice(0, cut), today, { past });
  }
  let s = text;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => Found) => {
    for (const m of s.matchAll(re)) {
      const r = fn(m);
      if (r) found.push(...(Array.isArray(r) ? r : [r]));
    }
    s = s.replace(re, " ");
  };
  const day = (d: string): DateRange => ({ from: d, to: d });

  // 1) 절대 날짜: "2027년 1월 5일", "2027-01-05", "11월 3일", "11/3" (해가 없으면 과거형은 지난 날, 아니면 다가오는 날)
  const ymd = (y: string | undefined, mo: string, d: string): Found => {
    const k = `${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    const full = y ? `${y}-${k}` : yearlessDate(k, today, past);
    return full && isDate(full) && full.slice(5) === k ? day(full) : undefined;
  };
  take(/(\d{4})-(\d{2})-(\d{2})/g, (m) => ymd(m[1], m[2] ?? "", m[3] ?? ""));
  take(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m) => ymd(m[1], m[2] ?? "", m[3] ?? ""));
  take(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (m) => ymd(undefined, m[1] ?? "", m[2] ?? ""));

  // 2) 이번/다음 주(말), 요일 지정. 이어지는 요일("토요일이랑 일요일")은 앞의 주 수식을 물려받는다.
  take(
    /(다다음|다음|이번|지난|저번)\s*주(말)?(?:에|의)?((?:\s*(?:,|와|과|이랑|랑|하고|및|그리고|이나|나)?\s*[일월화수목금토]요일)+)?/g,
    (m) => {
      const off = WEEK_OFFSET[m[1] ?? ""] ?? 0;
      const sunday = addDays(sundayOf(today), 7 * off); // 그 주(일~토)의 시작
      const sat = addDays(sunday, 6);
      if (m[2]) return off === 0 && weekdayOf(today) === 0 ? day(today) : { from: sat, to: addDays(sat, 1) };
      if (m[3]) {
        return [...m[3].matchAll(/([일월화수목금토])요일/g)].map((w) => {
          const idx = WEEKDAY_INDEX[w[1] ?? ""] ?? 0;
          // 일요일만 예외: 이번 주 일요일 = 돌아오는 일요일(당일이면 오늘), 주 수식만큼 7일씩 민다
          return day(idx === 0 ? addDays(upcomingSunday(today), 7 * off) : addDays(sunday, idx));
        });
      }
      return { from: sunday, to: sat };
    },
  );

  // 3) 달
  take(/(다다음|다음|이번|지난|저번)\s*달/g, (m) => {
    const off = m[1] === "다다음" ? 2 : m[1] === "다음" ? 1 : m[1] === "이번" ? 0 : -1;
    const month = addMonths(today.slice(0, 7), off);
    return { from: `${month}-01`, to: monthEnd(month) };
  });
  // 연도 없는 "M월": 이번 달이면 이번 달. 아니면 과거형은 가장 최근에 지난 그 달, 아니면 다가오는 그 달
  const yearlessMonth = (mo: number, now: string, isPast: boolean): string => {
    const y = Number(now.slice(0, 4));
    const cur = Number(now.slice(5, 7));
    const yy = mo === cur ? y : isPast ? (mo < cur ? y : y - 1) : mo > cur ? y : y + 1;
    return `${yy}-${String(mo).padStart(2, "0")}-01`;
  };
  take(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월/g, (m) => {
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return undefined;
    const mm = String(mo).padStart(2, "0");
    const first = m[1] ? `${m[1]}-${mm}-01` : yearlessMonth(mo, today, past);
    return first && isDate(first) ? { from: first, to: monthEnd(first.slice(0, 7)) } : undefined;
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

  // 6) 요일만: 과거형이면 오늘 이전 가장 최근 그 요일, 아니면 오늘 이후 가장 가까운 그 요일(오늘 포함)
  take(/([일월화수목금토])요일/g, (m) => {
    const diff = (WEEKDAY_INDEX[m[1] ?? ""] ?? 0) - weekdayOf(today);
    return day(addDays(today, past ? -(((-diff % 7) + 7) % 7 || 7) : ((diff % 7) + 7) % 7));
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
