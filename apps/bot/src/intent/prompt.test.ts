import { DEFAULT_FAMILY_ID, type Anniversary, type Event, type Member, type Task } from "@hsh/core";
import { FsWikiRepository } from "@hsh/core/node";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROMPT_MAX_CHARS, buildSystemPrompt, llmOutputJsonSchema, llmOutputSchema } from "./prompt";

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

describe("프롬프트에 그날 기준 실제 날짜를 적는다", () => {
  const at = (today: string) => buildSystemPrompt({ ...base, today, events: [] });
  it("금요일(2026-10-30)", () => {
    const p = at("2026-10-30");
    expect(p).toContain("이번 주 일요일 = 2026-11-01, 다음 주 일요일 = 2026-11-08");
    expect(p).toContain("이번 주말 = 2026-10-31 ~ 2026-11-01, 다음 주말 = 2026-11-07 ~ 2026-11-08");
    expect(p).toContain("이번 달 = 2026-10-01 ~ 2026-10-31, 다음 달 = 2026-11-01 ~ 2026-11-30");
  });
  it("수요일(2026-11-04)", () => {
    const p = at("2026-11-04");
    expect(p).toContain("이번 주 일요일 = 2026-11-08, 다음 주 일요일 = 2026-11-15");
    expect(p).toContain("이번 주말 = 2026-11-07 ~ 2026-11-08, 다음 주말 = 2026-11-14 ~ 2026-11-15");
  });
  it("일요일 당일(2026-11-01): 이번 주 일요일은 오늘, 주말은 떨어져 되묻기", () => {
    const p = at("2026-11-01");
    expect(p).toContain("이번 주 일요일 = 2026-11-01, 다음 주 일요일 = 2026-11-08");
    expect(p).toContain("이번 주말 = 되묻기");
  });
  it("연말: 다음 달은 해를 넘는다", () => {
    expect(at("2026-12-31")).toContain("다음 달 = 2027-01-01 ~ 2027-01-31");
  });
});

describe("프롬프트 전체 상한", () => {
  const sampleRoot = fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url));
  const stressRoot = fileURLToPath(new URL("../../../../fixtures/stress-wiki", import.meta.url));
  for (const [name, root, today] of [["sample-wiki", sampleRoot, "2026-10-30"], ["stress-wiki", stressRoot, "2026-11-03"]] as const) {
    it(`${name}: ${PROMPT_MAX_CHARS}자 이내`, async () => {
      const w = await new FsWikiRepository({ root, readOnly: true, familyId: DEFAULT_FAMILY_ID }).read(DEFAULT_FAMILY_ID);
      const p = buildSystemPrompt({ today, now: "12:00", members: w.members, events: w.events, tasks: w.tasks, anniversaries: w.anniversaries });
      expect(p.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
      expect(p).toContain("## 날짜 판단 기준");
    });
  }
  it("아주 큰 위키(일정 500·할 일 300·구성원 100)도 상한 이내, 할 일은 건수 제한, 일정 id 목록은 남는다", () => {
    const events = Array.from({ length: 500 }, (_, i) => ev(`evt-${i}`, "2026-11-10", `${"긴제목".repeat(20)}${i}`));
    const tasks: Task[] = Array.from({ length: 300 }, (_, i) => ({ id: `task-${i}`, list: "todo", title: `해야 할 일 ${"길게".repeat(30)} ${i}`, done: false }));
    const crowd: Member[] = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, name: `구성원${i}`, role: "child", color: "blue" }));
    const p = buildSystemPrompt({ ...base, members: crowd, events, tasks });
    expect(p.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
    expect(p).toContain("- evt-0:");
    expect(p).not.toContain("task-100:");
    expect(p).toMatch(/- …외 \d+건/);
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
