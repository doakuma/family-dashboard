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
  it("자산 지도(날짜 풀이표·부르는 이름·제목 관계·기념일)를 넣는다", () => {
    expect(p).toContain("## 자산 지도");
    expect(p).toContain("## 날짜 풀이표");
    expect(p).toContain("2026-10-30 금 = 오늘, 이번 주 금요일");
    expect(p).toContain("- haneul: 하늘 / 하늘, 하늘이");
    expect(p).toContain("- 미술학원 → 하늘 → 2026-10-31(토), 2026-11-07(토) → 매주 토 추정");
    expect(p).toContain("- 하늘 생일 → 하늘 → 08-15 매년");
  });
  it("기준일 2026-10-30: 날짜 → 말 단언", () => {
    expect(p).toContain("2026-11-03 화 = 다음 주 화요일");
    expect(p).toContain("2026-11-09 월 = 다다음 주 월요일");
    expect(p).toContain("2026-11-01 일 = 모레, 이번 주 일요일");
    expect(p).toContain("2026-11-08 일 = 다음 주 일요일");
    expect(p).toContain("- 2월 → 2027-02-01~2027-02-28");
    expect(p).toContain("그 외: 10-30~12-31은 2026년, 01-01~10-29는 2027년 / 과거형: 01-01~10-29는 2026년, 10-30~12-31은 2025년");
  });
  it("기준일 11-01(일): 이번 주 = 11-01~11-07", () => {
    const q = buildSystemPrompt({ ...base, today: "2026-11-01", events: [] });
    expect(q).toContain("이번 주 = 2026-11-01 ~ 2026-11-07");
    expect(q).toContain("이번 주말 = 되묻기");
  });
  it("판단 기준·형식 규칙 문장을 명시한다", () => {
    for (const s of [
      "풀이표에서 그대로 찾아",
      "직접 세지 않는다",
      "쓰기(event.add 등)와 질문(qFrom·qTo)이 같은 기준",
      "qDatePhrase에 메시지 속 날짜 표현을 그대로",
      "\"주\"는 일~토 7일, \"주말\"은 토·일",
      "날짜를 묻는 질문은 qFrom·qTo를 비운다",
      "떨어진 날짜는 qFrom·qTo를 비운다",
      "A는 제외 칸에만",
      "같은 단어를 qKeyword와 제외에 함께 넣지 않는다",
      "메시지에 사람 이름·호칭이 나올 때만",
      "메시지에 일정 이름이 나올 때만",
      "YYYY-MM-DD만 있는 메시지도 묻는 말이면 question",
      "최대 62일",
    ]) {
      expect(p, s).toContain(s);
    }
  });
  it("예시에 지어낸 날짜를 쓰지 않고 풀이표를 가리킨다", () => {
    expect(p).not.toMatch(/예\(오늘/);
  });
});

describe("긴 위키에서도 길이 제한", () => {
  it("자산 지도 상한을 넘기지 않고, 날짜 풀이표는 남는다", () => {
    const many = Array.from({ length: 500 }, (_, i) => ev(`evt-${i}`, `2027-01-${String((i % 28) + 1).padStart(2, "0")}`, `긴 제목의 일정 ${i}번`));
    const small = buildSystemPrompt({ ...base, events: many, assetMapChars: 3300 });
    const map = small.slice(small.indexOf("## 자산 지도"), small.indexOf("## 앞으로의 일정"));
    expect(map.length).toBeLessThan(3600);
    expect(map).toContain("2026-11-03 화 = 다음 주 화요일");
    expect(map).toMatch(/…외 \d+건/);
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
  it("모델에 보내는 스키마: intent·qDatePhrase·qTense가 required, 순서는 intent -> qDatePhrase -> qTense -> 제외 -> qFrom/qTo", () => {
    const js = llmOutputJsonSchema as { properties: Record<string, unknown>; required: string[] };
    expect(js.required).toEqual(["intent", "qDatePhrase", "qTense"]);
    const keys = Object.keys(js.properties);
    const order = ["intent", "qDatePhrase", "qTense", "qExcludeKeyword", "qExcludeDates", "qFrom", "qTo"].map((k) => keys.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(keys).toContain("qExcludeKeyword");
    expect(keys).toContain("qExcludeDates");
  });
  it("시제 값은 past|nonpast|none만", () => {
    expect(llmOutputSchema.safeParse({ intent: "question", qTense: "past" }).success).toBe(true);
    expect(llmOutputSchema.safeParse({ intent: "question", qTense: "none" }).success).toBe(true);
    expect(llmOutputSchema.safeParse({ intent: "question", qTense: "future" }).success).toBe(false);
  });
  it("파서는 관대하다: qDatePhrase·qTense가 없어도, 빈 문자열이어도 받는다", () => {
    expect(llmOutputSchema.safeParse({ intent: "question" }).success).toBe(true);
    expect(llmOutputSchema.safeParse({ intent: "question", qDatePhrase: "", qTense: "none", qKeyword: "" }).success).toBe(true);
  });
});
