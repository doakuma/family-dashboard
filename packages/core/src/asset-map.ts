// 자산 지도: 위키에서 만든 가벼운 관계표(오늘·달력·구성원·일정/기념일 제목 → 구성원 → 날짜 → 반복).
// LLM 프롬프트에 넣어 "학원 → 미술학원 → 하늘 → 매주 목" 같은 연결을 보충한다. 순수 함수, 브라우저 안전.
import { WEEKDAYS_KO, addDays, diffDays, nextOccurrence, weekdayOf } from "./date";
import type { Anniversary, Event, Member } from "./types";

export interface AssetMapInput {
  today: string;
  members: Member[];
  events: Event[];
  anniversaries: Anniversary[];
}
export interface AssetMapOptions {
  /** 전체 글자 수 상한(기본 3000). 달력·구성원은 항상 남기고 먼 일정부터 줄인다. */
  maxChars?: number;
}
export const DEFAULT_ASSET_MAP_CHARS = 3000;

/** 지난 일정은 이만큼 전까지만 보여 준다(반복 추정에는 전부 쓴다) */
const PAST_DAYS = 14;
/** 제목 하나에 보여 줄 날짜 수 */
const MAX_DATES = 6;

const dayLabel = (d: string) => `${d}(${WEEKDAYS_KO[weekdayOf(d)]})`;

const hasBatchim = (s: string) => {
  const c = s.charCodeAt(s.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
};
/** 부르는 이름: 이름, 받침이 있으면 "하늘이" 같은 꼴을 더한다. */
export function callNames(name: string): string[] {
  return hasBatchim(name) ? [name, `${name}이`] : [name];
}

function calendar(today: string): string {
  const sunday = addDays(today, -weekdayOf(today));
  const labels = ["지난 주", "이번 주", "다음 주", "다다음 주"];
  return labels
    .map((label, w) => {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(sunday, (w - 1) * 7 + i);
        return `${WEEKDAYS_KO[weekdayOf(d)]} ${d}${d === today ? "(오늘)" : ""}`;
      });
      return `- ${label}: ${days.join(", ")}`;
    })
    .join("\n");
}

/** 같은 요일에 2번 이상이면 "매주 X" 추정 */
function weeklyGuess(dates: string[]): string | undefined {
  const count = new Map<number, number>();
  for (const d of new Set(dates)) count.set(weekdayOf(d), (count.get(weekdayOf(d)) ?? 0) + 1);
  let best: number | undefined;
  for (const [dow, n] of count) {
    if (n >= 2 && (best === undefined || n > (count.get(best) ?? 0) || (n === (count.get(best) ?? 0) && dow < best))) best = dow;
  }
  return best === undefined ? undefined : `매주 ${WEEKDAYS_KO[best]} 추정`;
}

interface Piece {
  kind: "event" | "anniversary";
  /** 오늘과의 거리(가까운 것부터 남긴다) */
  distance: number;
  line: string;
  /** 줄이 나타내는 항목 수(…외 N건 계산용) */
  count: number;
}

export function buildAssetMap(input: AssetMapInput, opts: AssetMapOptions = {}): string {
  const { today } = input;
  const maxChars = opts.maxChars ?? DEFAULT_ASSET_MAP_CHARS;
  const nameOf = (id: string) => input.members.find((m) => m.id === id)?.name ?? id;

  const head = [
    "## 오늘",
    `${today} (${WEEKDAYS_KO[weekdayOf(today)]}요일)`,
    "",
    "## 달력 (주는 일요일 시작)",
    calendar(today),
    "",
    "## 구성원 (id: 이름 / 부르는 이름)",
    ...(input.members.length ? input.members.map((m) => `- ${m.id}: ${m.name} / ${callNames(m.name).join(", ")}`) : ["- (없음)"]),
  ].join("\n");

  // 일정: 제목+구성원이 같으면 한 줄로 묶는다
  const groups = new Map<string, { title: string; members: string[]; dates: string[] }>();
  for (const e of input.events) {
    const members = [...e.members].sort();
    const key = `${e.title}\u0000${members.join(",")}`;
    const g = groups.get(key) ?? { title: e.title, members, dates: [] };
    g.dates.push(e.date);
    groups.set(key, g);
  }
  const pieces: Piece[] = [];
  for (const g of groups.values()) {
    const shown = [...new Set(g.dates)]
      .filter((d) => diffDays(today, d) >= -PAST_DAYS)
      .sort((a, b) => Math.abs(diffDays(today, a)) - Math.abs(diffDays(today, b)) || a.localeCompare(b));
    if (!shown.length) continue;
    const list = shown.slice(0, MAX_DATES).sort();
    const more = shown.length > list.length ? ` …외 ${shown.length - list.length}건` : "";
    const weekly = weeklyGuess(g.dates);
    pieces.push({
      kind: "event",
      distance: Math.abs(diffDays(today, shown[0] ?? today)),
      count: shown.length,
      line: `- ${g.title} → ${g.members.map(nameOf).join("·") || "-"} → ${list.map(dayLabel).join(", ")}${more}${weekly ? ` → ${weekly}` : ""}`,
    });
  }
  for (const a of input.anniversaries) {
    pieces.push({
      kind: "anniversary",
      distance: diffDays(today, nextOccurrence(a.monthDay, today)),
      count: 1,
      line: `- ${a.title} → ${a.member ? nameOf(a.member) : "-"} → ${a.monthDay} 매년`,
    });
  }
  pieces.sort((a, b) => a.distance - b.distance);

  // 상한 안에서 가까운 것부터 담는다(맨 끝 "…외 N건" 줄 자리를 남겨 둔다)
  const RESERVE = 40;
  let used = head.length + "\n\n## 일정 (제목 → 구성원 → 날짜 → 반복)\n\n## 기념일 (제목 → 구성원 → 날짜)".length;
  const kept: Piece[] = [];
  let dropped = 0;
  for (const p of pieces) {
    if (dropped === 0 && used + p.line.length + 1 + RESERVE <= maxChars) {
      kept.push(p);
      used += p.line.length + 1;
    } else dropped += p.count;
  }
  const lines = (kind: Piece["kind"]) => {
    const l = kept.filter((p) => p.kind === kind).sort((a, b) => a.distance - b.distance).map((p) => p.line);
    return l.length ? l : ["- (없음)"];
  };
  return [
    head,
    "",
    "## 일정 (제목 → 구성원 → 날짜 → 반복)",
    ...lines("event"),
    "",
    "## 기념일 (제목 → 구성원 → 날짜)",
    ...lines("anniversary"),
    ...(dropped ? ["", `…외 ${dropped}건 (먼 일정·기념일은 줄였어요)`] : []),
  ].join("\n");
}
