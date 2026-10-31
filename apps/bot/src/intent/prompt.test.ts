import type { Anniversary, Event, Member } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, llmOutputJsonSchema, llmOutputSchema } from "./prompt";

const members: Member[] = [
  { id: "haneul", name: "하늘", role: "child", color: "blue" },
  { id: "mom", name: "엄마", role: "guardian", color: "coral" },
];
const ev = (id: string, date: string, title: string): Event => ({ id, date, allDay: true, title, members: ["haneul"], done: false });
const anniversaries: Anniversary[] = [{ monthDay: "08-15", title: "하늘 생일", member: "haneul" }];
const base = { today: "2026-10-30", now: "12:00", members, tasks: [], anniversaries };

describe("프롬프트: 자산 지도와 날짜 판단 기준", () => {
  const p = buildSystemPrompt({ ...base, events: [ev("evt-1", "2026-10-31", "미술학원"), ev("evt-2", "2026-11-07", "미술학원")] });
  it("자산 지도(달력·부르는 이름·제목 관계·기념일)를 넣는다", () => {
    expect(p).toContain("## 자산 지도");
    expect(p).toContain("금 2026-10-30(오늘)");
    expect(p).toContain("- haneul: 하늘 / 하늘, 하늘이");
    expect(p).toContain("- 미술학원 → 하늘 → 2026-10-31(토), 2026-11-07(토) → 매주 토 추정");
    expect(p).toContain("- 하늘 생일 → 하늘 → 08-15 매년");
  });
  it("rev 62 규칙 문장을 판단 기준으로 명시한다", () => {
    for (const s of ["주는 일요일에 시작", "돌아오는 일요일", "그다음 일요일", "이번 주 토요일 + 돌아오는 일요일", "가장 최근에 지난 날", "다가오는 날(오늘 포함)", "연도를 말하면", "A는 제외 조건, B가 실제 질문", "qExcludeDates", "qExcludeKeyword", "최대 62일"]) {
      expect(p, s).toContain(s);
    }
  });
  it("쓰기 날짜도 같은 기준을 쓴다는 문장이 있다", () => {
    expect(p).toContain("쓰기(event.add 등)와 질문(qFrom·qTo)이 같은 기준");
  });
});

describe("긴 위키에서도 길이 제한", () => {
  it("자산 지도 상한을 넘기지 않는다", () => {
    const many = Array.from({ length: 500 }, (_, i) => ev(`evt-${i}`, `2027-01-${String((i % 28) + 1).padStart(2, "0")}`, `긴 제목의 일정 ${i}번`));
    const small = buildSystemPrompt({ ...base, events: many, assetMapChars: 1200 });
    const map = small.slice(small.indexOf("## 자산 지도"), small.indexOf("## 구성원 (보낸 사람"));
    expect(map.length).toBeLessThan(1400);
    expect(map).toMatch(/…외 \d+건/);
  });
});

describe("llmOutputSchema", () => {
  it("qTense가 qFrom보다 앞에 온다(모델이 시제를 먼저 정한다)", () => {
    const keys = Object.keys((llmOutputJsonSchema as { properties: Record<string, unknown> }).properties);
    expect(keys.indexOf("qTense")).toBeGreaterThan(-1);
    expect(keys.indexOf("qTense")).toBeLessThan(keys.indexOf("qFrom"));
    expect(keys).toContain("qExcludeKeyword");
    expect(keys).toContain("qExcludeDates");
  });
  it("시제 값은 past|nonpast만", () => {
    expect(llmOutputSchema.safeParse({ intent: "question", qTense: "past" }).success).toBe(true);
    expect(llmOutputSchema.safeParse({ intent: "question", qTense: "future" }).success).toBe(false);
  });
});
