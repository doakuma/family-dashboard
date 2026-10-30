// 질문 속 상대 날짜를 서울 기준 절대 날짜 범위로 바꾸는 결정적 해석기. LLM 값보다 우선한다.
// 스펙 rev 62 '날짜 해석'(질문·쓰기 공통):
// - 주는 일요일~토요일(대시보드 달력, intent/prompt.ts의 calendarTable과 같다). "이번 주" = 오늘이 든 일~토.
// - "X주 일요일"만 예외: 이번 주 일요일 = 돌아오는 일요일(일요일 당일이면 오늘), 다음 주 일요일 = 그다음, 지난 주 일요일 = 이번 −7.
// - 주말 단위 W0 = 오늘이 토·일이면 오늘이 든 토+일, 아니면 다가오는 토+일. "주말"·"이번 주말" = W0, "다음 주말" = W0+7, "지난 주말" = W0-7(오너 확인 전 임시).
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
 * 과거형 질문인가. 질문 문장(물음표 있는 문장이 있으면 그 마지막, 없으면 마지막 문장)에서 쉼표로 나눈 절 중
 * 서술어 끝이 과거 어미(었어/았어/했어/었지/했나/했니/었더라/있었/없었 …)인 것이 있으면 과거형이다.
 * "으면/던/다 올/기로 했(었)/하자고 했/어야"처럼 끝이 과거 어미가 아니거나 미래 약속을 되묻는 꼴은 과거로 보지 않는다.
 * 결정적 규칙이며 LLM 값은 쓰지 않는다.
 */
const PAST_END = /[었았였했갔왔봤썼줬셨](?:어요?|지요?|죠|나요?|니|더라|네요?|다|습니다|습니까|구나)?$/;
const PAST_EXCLUDE = /기로\s*했|하자고\s*했/;
export function isPastQuestion(text: string): boolean {
  const sentences = text.split(/(?<=[?？!.\n])/).map((x) => x.trim()).filter(Boolean);
  const target = [...sentences].reverse().find((x) => /[?？]$/.test(x)) ?? sentences.at(-1) ?? "";
  return target
    .split(/[,，]/)
    .map((c) => c.replace(/[^가-힣]+$/, "").trim())
    .some((c) => c !== "" && !PAST_EXCLUDE.test(c) && PAST_END.test(c));
}

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
  // "A 말고 B": 뒤쪽 날짜를 읽는다. 뒤쪽이 일부만("4일", "일요일")이면 앞쪽의 월·주 수식을 물려받고,
  // 날짜 표현이 아예 없으면("토요일에 핼러윈 말고 뭐 있어?") 앞쪽만 읽는다. 일부인데 못 읽으면 ambiguous.
  const cut = text.indexOf("말고");
  if (cut >= 0) {
    const head = text.slice(0, cut);
    const tail = text.slice(cut + 2);
    const sub = { past };
    const headWeek = head.match(/(다다음|다음|이번|지난|저번)\s*주/);
    const tailHasWeek = /주|달|오늘|내일|모레|어제|글피|그제|그저께/.test(tail);
    if (headWeek && !tailHasWeek && !/\d/.test(tail) && /[일월화수목금토]요일/.test(tail)) {
      return resolveRange(`${headWeek[0]} ${tail}`, today, sub) ?? { error: "ambiguous" };
    }
    const full = resolveRange(tail, today, sub);
    if (full) return full;
    const onlyDay = tail.match(/(?<![\d/])(\d{1,2})\s*일(?![정요])/);
    if (onlyDay && !/월|\//.test(tail)) {
      const h = resolveRange(head, today, sub);
      if (h && "from" in h && h.from === h.to) {
        const d = `${h.from.slice(0, 8)}${String(Number(onlyDay[1])).padStart(2, "0")}`;
        return isDate(d) ? { from: d, to: d } : { error: "ambiguous" };
      }
      return { error: "ambiguous" };
    }
    if (/\d|요일/.test(tail)) return { error: "ambiguous" };
    return resolveRange(head, today, sub);
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
  // 주말 단위 W0: 오늘이 토·일이면 오늘이 든 토+일, 아니면 다가오는 토+일. off주 만큼 7일씩 민다.
  const weekend = (off: number): DateRange => {
    const dow = weekdayOf(today);
    const sat = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
    return { from: addDays(sat, 7 * off), to: addDays(sat, 7 * off + 1) };
  };

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
      if (m[2]) return weekend(off);
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

  // 5) 주말(그냥) = W0
  take(/주말/g, () => weekend(0));

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
