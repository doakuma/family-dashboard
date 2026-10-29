import type { Event, Member, Task } from "@hsh/core";
import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest } from "../llm/client";
import { extractIntent } from "./extract";
import { buildSystemPrompt } from "./prompt";

const members: Member[] = [
  { id: "mom", name: "엄마", role: "guardian", color: "coral", slackId: "U00MOM" },
  { id: "haneul", name: "하늘", role: "child", color: "blue" },
  { id: "family", name: "가족", role: "guardian", color: "gray" },
];
const events: Event[] = [
  { id: "evt-a1b2", date: "2026-11-03", start: "15:00", end: "16:00", allDay: false, title: "치과", members: ["haneul"], done: false },
  { id: "evt-c3d4", date: "2026-11-05", start: "15:00", allDay: false, title: "치과", members: ["mom"], done: false },
];
const tasks: Task[] = [
  { id: "task-e5f6", list: "shopping", title: "우유", done: false },
  { id: "task-0002", list: "shopping", title: "사과", done: false },
];
// 2026-10-29(목) 22:00 서울
const now = new Date("2026-10-29T13:00:00Z");

/** 정해진 JSON을 돌려주고, 받은 프롬프트를 기록하는 가짜 LLM */
function fake(out: unknown): LlmClient & { last?: LlmRequest } {
  const c: LlmClient & { last?: LlmRequest } = {
    name: "fake",
    async json(req) {
      c.last = req;
      return out;
    },
  };
  return c;
}
const run = (out: unknown, text = "메시지", sender = "U00MOM") =>
  extractIntent({ text, now, senderSlackId: sender, members, events, tasks }, fake(out));

describe("프롬프트", () => {
  it("오늘·달력·구성원·대상 id를 넣는다", () => {
    const p = buildSystemPrompt({ today: "2026-10-29", now: "22:00", members, events, tasks });
    expect(p).toContain("오늘: 2026-10-29 (목요일)");
    expect(p).toContain("- 다음 주: 월 2026-11-02, 화 2026-11-03");
    expect(p).toContain("- evt-a1b2: 2026-11-03 15:00 치과 (haneul)");
    expect(p).toContain("- task-e5f6: [장보기] 우유");
  });
});

describe("extractIntent", () => {
  it("일정 추가: 구성원 검증, 미리보기", async () => {
    const r = await run({ intent: "event.add", date: "2026-11-03", start: "15:00", title: "치과", members: ["haneul"] });
    expect(r).toEqual({
      type: "change",
      changes: [{ kind: "event.add", payload: { date: "2026-11-03", start: "15:00", end: undefined, allDay: false, title: "치과", members: ["haneul"] } }],
      preview: "11/3(화) 15:00 하늘 치과",
    });
  });

  it("구성원이 없거나 모르는 id면 보낸 사람으로", async () => {
    const r = await run({ intent: "event.add", date: "2026-10-30", start: "09:00", title: "회의", members: ["ghost"] });
    expect(r.type === "change" && r.changes[0]).toMatchObject({ payload: { members: ["mom"] } });
    expect(r.type === "change" && r.preview).toBe("10/30(금) 09:00 엄마 회의 (내일)");
  });

  it("시간이 이상하면 종일로", async () => {
    const r = await run({ intent: "event.add", date: "2026-11-07", start: "3시", title: "소풍", members: ["family"] });
    expect(r.type === "change" && r.changes[0]).toMatchObject({ payload: { allDay: true, start: undefined } });
  });

  it("범위 밖 날짜·형식 오류는 unknown", async () => {
    expect((await run({ intent: "event.add", date: "2024-01-01", title: "옛날" })).type).toBe("unknown");
    expect((await run({ intent: "event.add", date: "2026-13-01", title: "x" })).type).toBe("unknown");
    expect((await run({ intent: "dance" })).type).toBe("unknown");
    expect((await run("not json")).type).toBe("unknown");
  });

  it("일정 수정: 시작만 바꾸면 길이 유지", async () => {
    const r = await run({ intent: "event.update", targetIds: ["evt-a1b2"], start: "16:00" });
    expect(r.type === "change" && r.changes[0]).toEqual({
      kind: "event.update",
      payload: { id: "evt-a1b2", start: "16:00", allDay: false, end: "17:00" },
    });
    expect(r.type === "change" && r.preview).toBe("치과: 11/3(화) 15:00 → 11/3(화) 16:00");
  });

  it("후보가 여럿이면 고르게 한다, 없는 id는 버린다", async () => {
    const r = await run({ intent: "event.update", targetIds: ["evt-a1b2", "evt-c3d4", "evt-fake"], start: "16:00" });
    expect(r).toMatchObject({ type: "choose", kind: "event.update", candidates: ["evt-a1b2", "evt-c3d4"] });
    expect((await run({ intent: "event.remove", targetIds: ["evt-fake"] })).type).toBe("unknown");
  });

  it("장보기 여러 개", async () => {
    const r = await run({ intent: "task.add", items: [{ title: "우유", list: "shopping" }, { title: "사과", list: "shopping" }] });
    expect(r.type === "change" && r.changes).toHaveLength(2);
    expect(r.type === "change" && r.preview).toBe("🛒 장보기: 우유\n🛒 장보기: 사과");
  });

  it("완료: 남은 항목만", async () => {
    const r = await run({ intent: "task.done", targetIds: ["task-e5f6"] });
    expect(r).toMatchObject({ type: "change", changes: [{ kind: "task.done", payload: { id: "task-e5f6" } }], preview: "완료: 우유" });
  });

  it("기념일: date만 줘도 MM-DD로", async () => {
    const r = await run({ intent: "anniversary.add", date: "2026-11-21", title: "결혼기념일" });
    expect(r).toMatchObject({ type: "change", changes: [{ payload: { monthDay: "11-21", member: "family" } }], preview: "🎉 매년 11월 21일 결혼기념일" });
  });

  it("제목에서 #·@를 지워 위키 형식을 지킨다", async () => {
    const r = await run({ intent: "task.add", items: [{ title: "#우유 @엄마", list: "shopping" }] });
    expect(r.type === "change" && r.changes[0]).toMatchObject({ payload: { title: "우유 엄마" } });
  });

  it("질문", async () => {
    expect(await run({ intent: "question" })).toEqual({ type: "question" });
  });
});
