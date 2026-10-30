// 한국어 상대 날짜 표현 -> 절대 날짜 범위. 결정적(LLM 없음), 브라우저 안전, 서울 달력 기준 문자열만 쓴다.
//
// 주의 시작 기준: **월요일 시작**(월~일). "이번 주" = 오늘이 낀 월~일, "이번 주말" = 그 주의 토~일.
// 그래서 일요일에 "이번 주 토요일"은 어제(6일 전)를 뜻한다. 요일만("토요일") 말하면 오늘 이후 가장 가까운 그 요일(오늘 포함).
import { addDays, addMonths, diffDays, weekdayOf } from "./date";
import { isDate } from "./wiki/format";

export interface DateRange {
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD, from 이상 */
  to: string;
}

const WD = "일월화수목금토";

/** 그 주의 월요일 */
export const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));

const weekOffset = (s: string): number | undefined => {
  if (/다다음주/.test(s)) return 2;
  if (/다음주|담주/.test(s)) return 1;
  if (/지난주|저번주/.test(s)) return -1;
  if (/이번주|금주/.test(s)) return 0;
  return undefined;
};

/**
 * 메시지 안의 상대/절대 날짜 표현을 범위로 바꾼다. 못 알아보면 undefined.
 * 우선순위: "M월 D일" > 오늘·내일·모레·어제 > 주/요일/주말 > 달.
 * 지원: 오늘/내일/모레/글피/어제, (이번|다음|다다음|지난) 주 X요일, X요일(가장 가까운 날), (이번|다음) 주말·주말,
 *       이번 주/다음 주/다다음 주/지난 주, 이번 달/다음 달/지난 달, M월 D일(올해, 한 달 넘게 지났으면 내년).
 */
export function resolveDateRange(text: string, today: string): DateRange | undefined {
  const s = text.replace(/\s+/g, "");
  const one = (d: string): DateRange => ({ from: d, to: d });

  const md = /(\d{1,2})월(\d{1,2})일/.exec(s);
  if (md) {
    const year = Number(today.slice(0, 4));
    const at = (y: number) => `${y}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
    let d = at(year);
    if (!isDate(d)) return undefined;
    if (diffDays(d, today) > 31 && isDate(at(year + 1))) d = at(year + 1);
    return one(d);
  }

  if (/모레/.test(s)) return one(addDays(today, 2)); // "내일모레"도 모레
  if (/글피/.test(s)) return one(addDays(today, 3));
  if (/내일/.test(s)) return one(addDays(today, 1));
  if (/오늘/.test(s)) return one(today);
  if (/어제/.test(s)) return one(addDays(today, -1));

  const wk = weekOffset(s);
  const wdMatch = new RegExp(`([${WD}])요일`).exec(s);
  const weekend = /주말/.test(s);

  if (weekend) {
    const sat = addDays(mondayOf(today), (wk ?? 0) * 7 + 5);
    return { from: sat, to: addDays(sat, 1) };
  }
  if (wdMatch) {
    const wd = WD.indexOf(wdMatch[1] ?? "");
    if (wk === undefined) return one(addDays(today, (wd - weekdayOf(today) + 7) % 7));
    return one(addDays(mondayOf(today), wk * 7 + ((wd + 6) % 7)));
  }
  if (wk !== undefined) {
    const mon = addDays(mondayOf(today), wk * 7);
    return { from: mon, to: addDays(mon, 6) };
  }

  const mo = /다다음달|다음달|이번달|금월|지난달|저번달/.exec(s)?.[0];
  if (mo) {
    const off = mo === "다다음달" ? 2 : mo === "다음달" ? 1 : mo === "이번달" || mo === "금월" ? 0 : -1;
    const month = addMonths(today.slice(0, 7), off);
    return { from: `${month}-01`, to: addDays(`${addMonths(month, 1)}-01`, -1) };
  }
  return undefined;
}
