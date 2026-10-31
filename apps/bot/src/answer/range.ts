// 보조 해석기(LLM 실패·형식 오류 때만): 질문 속 상대 날짜를 서울 기준 절대 날짜 범위로 바꾼다.
// MVP 스펙 rev 63: 날짜 판단은 LLM이 하고, 이 해석기는 LLM 범위가 없거나 형식이 틀릴 때만 answer.ts가 부른다. LLM 값을 덮어쓰지 않는다.
// MVP 스펙 rev 62 '날짜 해석': 주는 일요일~토요일(대시보드 달력과 같다, 자산 지도 달력(core/asset-map.ts)도 같다).
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
const PAST_END = /^(?:어(?!야)|겠|지|나|니|죠|을|는|다|네|냐|음|까|군|걸|ㅋ|ㅎ|[?？]|\s|$)/;
/** 과거로 보지 않는 꼴: "~던"(회상 수식), "~기로/자고/라고 했(었)…"(전언·약속), "~다 올/갈/와"(연결형 "갔다 올"). 일치한 부분만 지운다. */
const NOT_PAST = [/(?:기로|자고|라고|다고)\s*(?:했|하였)[가-힣]*/g, /[가-힣]다\s*(?:올|갈|오는|가는|와서|가서)/g, /[가-힣]던(?![가-힣])/g];
const DATE_WORD = /\d\s*월|\d\s*일|\d\/\d|\d{4}-\d{2}|[일월화수목금토]요일|주말|오늘|내일|모레|어제|그제|그저께|글피|(?:이번|다음|지난|저번)\s*(?:주|달)/;
/** 판단할 문장: 날짜 표현이 든 문장, 없으면 물음표 문장, 없으면 마지막 문장 */
function judgedSentence(text: string): string {
  const parts = text.split(/(?<=[?？!！.。\n])/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  return parts.find((p) => DATE_WORD.test(p)) ?? parts.find((p) => /[?？]$/.test(p)) ?? parts[parts.length - 1] ?? text;
}
/** 받침 ㅆ 음절(했·갔·봤·샀·됐·였·었·았…) 뒤에 어미가 오면 과거형. '있'("뭐 있어?")과 '겠'(추측·미래 "비 오겠지?")은 과거형이 아니라 뺀다("있었지"·"있었겠지"는 '었'으로 잡힌다). */
function isPast(full: string): boolean {
  let text = judgedSentence(full);
  for (const re of NOT_PAST) text = text.replace(re, " ");
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i) - 0xac00;
    if (c >= 0 && c <= 11171 && c % 28 === 20 && text[i] !== "있" && text[i] !== "겠" && PAST_END.test(text.slice(i + 1))) return true;
  }
  return false;
}
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
    if (past ? first <= today : monthEnd(first.slice(0, 7)) >= today) return first;
  }
  return `${y}-${mm}-01`;
}

type Found = DateRange | DateRange[] | undefined;

type Resolved = DateRange | { error: "too_long" | "ambiguous" } | undefined;

const CONTRAST = /말고|아니고/;
/** "A 말고 B"를 앞(A)·뒤(B)로 나눈다. 없으면 undefined. */
export function splitContrast(text: string): { before: string; after: string } | undefined {
  const m = CONTRAST.exec(text);
  return m ? { before: text.slice(0, m.index), after: text.slice(m.index + m[0].length) } : undefined;
}

const pad2 = (n: number | string) => String(Number(n)).padStart(2, "0");
/** 절대 날짜 표현. 해가 없으면 과거형은 가장 최근에 지난 날, 아니면 다가오는 날. */
const ABS_DATES: RegExp[] = [
  /(\d{4})-(\d{2})-(\d{2})/g,
  /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
  /(?<![\d/])()(\d{1,2})\/(\d{1,2})(?![\d/])/g,
];
function ymdDate(y: string | undefined, mo: string, d: string, today: string, past: boolean): string | undefined {
  const k = `${pad2(mo)}-${pad2(d)}`;
  const full = y ? `${y}-${k}` : dayFor(k, today, past);
  return full && isDate(full) && full.slice(5) === k ? full : undefined;
}
/** 앞쪽 글에서 마지막 절대 날짜(M월 D일 등)를 풀어 낸다. */
function lastAbsolute(text: string, today: string, past: boolean): string | undefined {
  let best: { at: number; date: string | undefined } | undefined;
  for (const re of ABS_DATES) {
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      if (!best || at > best.at) best = { at, date: ymdDate(m[1] || undefined, m[2] ?? "", m[3] ?? "", today, past) };
    }
  }
  return best?.date;
}
/** 월을 말하지 않은 "N일": 과거형이면 지난 N일, 아니면 다가오는 N일(오늘 포함). */
function nextDayOfMonth(n: number, today: string, past: boolean): string | undefined {
  for (let i = 0; i <= 14; i++) {
    const c = `${addMonths(today.slice(0, 7), past ? -i : i)}-${pad2(n)}`;
    if (isDate(c) && (past ? c < today : c >= today)) return c;
  }
  return undefined;
}
const WEEK_MOD = /(다다음|다음|이번|지난|저번)\s*주(?!말)/;
const DAY_ONLY = /(?<![\d/])(?<!월\s*)(\d{1,2})\s*일(?!요일|정)/;
const LOOKS_DATE = /\d\s*월|\d\s*일(?!요일|정)|\d\/\d|\d{4}-\d/;
/** 앞쪽에 날짜만 남고 다른 말이 없으면(토요일 말고) 그 날짜는 범위가 아니라 빼는 조건이다. */
const FILLER = /일정|약속|스케줄|[에은는이가도의\s]/g;

/**
 * 해석 결과: 범위 | 너무 김·띄엄띄엄 | 날짜 표현 없음(undefined).
 * "A 말고 B": B가 실제 질문이다. B에 날짜가 있으면 B만. B가 "N일"만이면 A가 절대 날짜일 때 그 달, 아니면 다가오는 N일.
 * B가 요일만이면 A의 주 수식을 물려받는다. B가 날짜처럼 보이는데 못 읽으면 되묻는다.
 * B에 날짜가 없으면 "토요일에 핼러윈 말고"처럼 A에 날짜 외의 말이 있을 때만 A의 날짜를 쓴다("토요일 말고 …"의 토요일은 뺀다).
 */
export function resolveRange(text: string, today: string): Resolved {
  const past = isPast(text);
  const parts = splitContrast(text);
  if (!parts) return resolveOne(text, today, past);
  const { before, after } = parts;
  const mod = WEEK_MOD.exec(before)?.[1];
  const inherits = mod && /[일월화수목금토]요일/.test(after) && !WEEK_MOD.test(after);
  const r = resolveOne(inherits ? `${mod} 주 ${after}` : after, today, past);
  if (r) return r;
  const n = DAY_ONLY.exec(after);
  if (n) {
    const base = lastAbsolute(before, today, past);
    const d = base ? `${base.slice(0, 7)}-${pad2(n[1] ?? "")}` : nextDayOfMonth(Number(n[1]), today, past);
    return d && isDate(d) ? { from: d, to: d } : { error: "ambiguous" };
  }
  if (LOOKS_DATE.test(after)) return { error: "ambiguous" };
  const o = { rest: "" };
  const br = resolveOne(before, today, past, o);
  if (br && !("error" in br) && !o.rest.replace(FILLER, "")) return undefined;
  return br;
}

function resolveOne(text: string, today: string, past: boolean, out?: { rest: string }): Resolved {
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
    const full = ymdDate(y, mo, d, today, past);
    return full ? day(full) : undefined;
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

  if (out) out.rest = s;
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
