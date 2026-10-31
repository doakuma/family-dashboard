import type { Event, LlmAdapter, LlmRequest, Member, Task } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { extractIntent, previewChange, resolveChoice } from "./extract";
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
function fake(out: unknown): LlmAdapter & { last?: LlmRequest } {
  const c: LlmAdapter & { last?: LlmRequest } = {
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
  it("오늘·날짜 풀이표·구성원·대상 id를 넣는다", () => {
    const p = buildSystemPrompt({ today: "2026-10-29", now: "22:00", members, events, tasks });
    expect(p).toContain("오늘: 2026-10-29 (목요일)");
    expect(p).toContain("2026-11-03 화 = 다음 주 화요일");
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

  it("LLM은 share를 만들거나 바꾸지 못한다 (출력에 있어도 버리고, 제목의 &토큰은 제거)", async () => {
    const add = await run({ intent: "event.add", date: "2026-11-15", start: "12:00", title: "점심 &cousins", members: ["mom"], share: "cousins" });
    expect(add.type === "change" && add.changes[0]?.payload).not.toHaveProperty("share");
    expect(add.type === "change" && add.changes[0]?.payload).toMatchObject({ title: "점심 cousins" });
    const upd = await run({ intent: "event.update", targetIds: ["evt-a1b2"], start: "16:00", share: "other" });
    expect(upd.type === "change" && upd.changes[0]?.payload).not.toHaveProperty("share");
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

  it("후보가 여럿이면 patch에 끝 시간을 넣지 않고, 고른 뒤 그 일정 길이로 계산한다", async () => {
    const r = await run({ intent: "event.update", targetIds: ["evt-a1b2", "evt-c3d4"], start: "16:00" });
    if (r.type !== "choose") throw new Error("choose 아님");
    expect(r.patch).toEqual({ start: "16:00", allDay: false });

    const ctx = { members, events, tasks, today: "2026-10-29" };
    // a1b2는 15:00-16:00(1시간) → 17:00, c3d4는 끝 시간이 없다 → end 없음
    expect(resolveChoice(r, "evt-a1b2", ctx)).toMatchObject({ changes: [{ payload: { id: "evt-a1b2", start: "16:00", end: "17:00" } }] });
    const other = resolveChoice(r, "evt-c3d4", ctx);
    expect(other.type === "change" && other.changes[0]).toEqual({ kind: "event.update", payload: { id: "evt-c3d4", start: "16:00", allDay: false } });
    expect(resolveChoice(r, "evt-zzzz", ctx).type).toBe("unknown");
  });

  it("후보 선택 후에도 자정을 넘는 길이는 계산하지 않고 되묻는다", async () => {
    const r = await run({ intent: "event.update", targetIds: ["evt-a1b2", "evt-c3d4"], start: "23:30" });
    if (r.type !== "choose") throw new Error("choose 아님");
    expect(resolveChoice(r, "evt-a1b2", { members, events, tasks, today: "2026-10-29" })).toMatchObject({ type: "unknown" });
  });

  it("미리보기: 원본 일정을 못 찾아도 죽지 않는다", () => {
    expect(previewChange({ kind: "event.update", payload: { id: "evt-none", title: "x" } }, { members, events, tasks, today: "2026-10-29" })).toBe(
      "일정 수정: evt-none",
    );
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
    expect(await run({ intent: "question" }, "뭐 있어?")).toEqual({ type: "question", query: { text: "뭐 있어?" } });
  });

  it("질문: qTense none·빈 qDatePhrase·빈 keyword는 없는 것으로 본다", async () => {
    const r = await run({ intent: "question", qDatePhrase: "", qTense: "none", qKeyword: "", qExcludeKeyword: "" }, "뭐 있어?");
    expect(r).toEqual({ type: "question", query: { text: "뭐 있어?" } });
    const r2 = await run({ intent: "question", qDatePhrase: "다음 주 화요일", qTense: "nonpast", qFrom: "2026-11-03", qTo: "2026-11-03" }, "다음 주 화요일 뭐 있어?");
    expect(r2.type === "question" && r2.query).toMatchObject({ tense: "nonpast", from: "2026-11-03", to: "2026-11-03" });
  });

  it("질문: qTense가 빈 문자열이어도 응답 전체가 bad_format이 되지 않는다", async () => {
    const r = await run({ intent: "question", qTense: "", qDatePhrase: "", qFrom: "2026-11-03", qTo: "2026-11-03" }, "다음 주 화요일 뭐 있어?");
    expect(r.type === "question" && r.query).toMatchObject({ from: "2026-11-03", to: "2026-11-03" });
  });

  it("질문: 시제·제외 조건은 형식만 검증해 담는다", async () => {
    const r = await run(
      { intent: "question", qTense: "past", qFrom: "2026-10-24", qTo: "2026-10-24", qExcludeKeyword: " 치과 ", qExcludeDates: ["2026-10-31", "토요일", "2026-10-31", "2026-02-30"], qMembers: ["haneul", "ghost"] },
      "토요일 말고 치과 말고 뭐 했어?",
    );
    expect(r.type === "question" && r.query).toMatchObject({
      tense: "past",
      from: "2026-10-24",
      to: "2026-10-24",
      excludeKeyword: "치과",
      excludeDates: ["2026-10-31"],
      memberIds: ["haneul"],
    });
  });
});
