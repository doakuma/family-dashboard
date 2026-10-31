// 날짜 풀이표: 기준일(오늘)만으로 계산한 "그대로 찾아 쓰는" 표. LLM이 달력 칸을 세다 틀리지 않게 답을 풀어 쓴다.
// MVP 스펙 rev 62 규칙 그대로(주는 일~토, "이번 주 일요일"=돌아오는 일요일, 과거형은 가장 최근에 지난 날 ...).
// 오너 확인 대기 항목은 지금 range.ts 동작을 따르고 "(확인 대기)"로 표시한다. 순수 함수, 브라우저 안전.
import { WEEKDAYS_KO, addDays, addMonths, diffDays, weekdayOf } from "./date";

const monthEnd = (m: string) => addDays(`${addMonths(m, 1)}-01`, -1);
const pad = (n: number) => String(n).padStart(2, "0");
const PENDING = "(확인 대기)";

/** 날짜 하나에 붙는 라벨들(없으면 표에 싣지 않는다) */
function labelsFor(today: string, d: string): string[] {
  const dow = weekdayOf(today);
  const sunday = addDays(today, -dow);
  const coming = addDays(today, (7 - dow) % 7);
  const out: string[] = [];
  const rel = ({ 0: "오늘", 1: "내일", 2: "모레", [-1]: "어제", [-2]: "그저께" } as Record<number, string>)[diffDays(today, d)];
  if (rel) out.push(rel);
  const dd = weekdayOf(d);
  if (dd === 0) {
    // 일요일은 예외: 이번 주 일요일 = 돌아오는 일요일
    if (d === coming) out.push("이번 주 일요일");
    else if (d === addDays(coming, 7)) out.push("다음 주 일요일");
    else if (d === addDays(coming, 14)) out.push(`다다음 주 일요일${PENDING}`);
    else if (d === addDays(sunday, -7)) out.push(`지난 주 일요일(지난 주 첫날)${PENDING}`);
    else if (d === sunday) out.push("이번 주 첫날 일요일(이미 지남)");
  } else {
    const w = Math.floor(diffDays(sunday, d) / 7);
    const lab = ({ [-1]: "지난 주", 0: "이번 주", 1: "다음 주", 2: "다다음 주" } as Record<number, string>)[w];
    if (lab) out.push(`${lab} ${WEEKDAYS_KO[dd]}요일`);
  }
  return out;
}

export function buildDateGuide(today: string): string {
  const dow = weekdayOf(today);
  const sunday = addDays(today, -dow);
  const coming = addDays(today, (7 - dow) % 7);
  const y = Number(today.slice(0, 4));
  const lines: string[] = [];

  lines.push("### 날짜 → 말 (이 표에서 그대로 찾는다. 직접 세지 않는다)");
  for (let n = -14; n <= 27; n++) {
    const d = addDays(today, n);
    const labels = labelsFor(today, d);
    if (labels.length) lines.push(`- ${d} ${WEEKDAYS_KO[weekdayOf(d)]} = ${labels.join(", ")}`);
  }

  lines.push("", "### 요일만 말할 때 (오늘 포함 다가오는 날 / 과거형이면 가장 최근에 지난 날, 오늘 제외)");
  for (let t = 0; t < 7; t++) {
    const up = addDays(today, (t - dow + 7) % 7);
    const back = ((((dow - t - 1) % 7) + 7) % 7) + 1;
    lines.push(`- ${WEEKDAYS_KO[t]}요일 → ${up}${up === today ? "(오늘)" : ""} / 과거형 ${addDays(today, -back)}`);
  }

  lines.push("", "### 주·주말 범위 (주는 일~토, 주말은 토·일)");
  lines.push(`- 이번 주 = ${sunday} ~ ${addDays(sunday, 6)}, 다음 주 = ${addDays(sunday, 7)} ~ ${addDays(sunday, 13)}, 지난 주 = ${addDays(sunday, -7)} ~ ${addDays(sunday, -1)}`);
  const split = `되묻기(오늘이 일요일이라 토요일과 일요일이 떨어져 있다, qFrom·qTo 비움)${PENDING}`;
  lines.push(
    `- 이번 주말 = ${dow === 0 ? split : `${addDays(sunday, 6)} ~ ${coming}`}, 다음 주말 = ${dow === 0 ? split : `${addDays(sunday, 13)} ~ ${addDays(coming, 7)}`}, 지난 주말 = ${addDays(sunday, -1)} ~ ${sunday}${PENDING}`,
  );

  lines.push("", "### 달 (다가오는 달 / 과거형이면 이미 시작한 가장 최근 달)");
  for (let m = 1; m <= 12; m++) {
    const mm = pad(m);
    let up = `${y}-${mm}`;
    for (let i = 0; i <= 1; i++) {
      const c = `${y + i}-${mm}`;
      if (monthEnd(c) >= today) {
        up = c;
        break;
      }
    }
    let past = `${y}-${mm}`;
    for (let i = 0; i <= 1; i++) {
      const c = `${y - i}-${mm}`;
      if (`${c}-01` <= today) {
        past = c;
        break;
      }
    }
    lines.push(`- ${m}월 → ${up}-01~${monthEnd(up)} / 과거형 ${past}-01~${monthEnd(past)}`);
  }
  const m0 = today.slice(0, 7);
  const span = (m: string) => `${m}-01~${monthEnd(m)}`;
  lines.push(`- 이번 달 = ${span(m0)}, 다음 달 = ${span(addMonths(m0, 1))}, 지난 달 = ${span(addMonths(m0, -1))}`);

  const md = today.slice(5);
  const yday = addDays(today, -1).slice(5);
  lines.push("", "### 연도 없는 날짜(M월 D일)의 해");
  lines.push(
    md === "01-01"
      ? `- 그 외: 01-01~12-31은 ${y}년 / 과거형: 01-01~12-31은 ${y - 1}년 (연도를 말하면 그대로)`
      : `- 그 외: ${md}~12-31은 ${y}년, 01-01~${yday}는 ${y + 1}년 / 과거형: 01-01~${yday}는 ${y}년, ${md}~12-31은 ${y - 1}년 (연도를 말하면 그대로)`,
  );
  lines.push("- 2월 29일은 윤년에만 있어 없는 해는 건너뛴다.");
  return lines.join("\n");
}
