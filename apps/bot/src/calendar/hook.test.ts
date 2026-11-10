import { DEFAULT_FAMILY_ID, type Change, type WikiRepository } from "@hsh/core";
import { describe, expect, it, vi } from "vitest";
import { CALENDAR_CHANGE_KINDS, withCalendarKick } from "./hook";

const fake = (over: Partial<WikiRepository> = {}): WikiRepository => ({
  read: vi.fn(async () => { throw new Error("unused"); }),
  apply: vi.fn(async () => ({ version: "v1", synced: true })),
  applySetup: vi.fn(async () => ({ version: "v2", synced: true })),
  applySettings: vi.fn(async () => ({ version: "v3", synced: true })),
  ...over,
});
const EVENT: Change = { kind: "event.add", payload: { date: "2026-11-03", start: "15:00", allDay: false, title: "치과", members: ["haneul"] } };
const TASK: Change = { kind: "task.add", payload: { list: "shopping", title: "우유" } };

describe("withCalendarKick", () => {
  it("일정 변경이 저장된 뒤에만 깨운다(할 일·기념일은 깨우지 않음)", async () => {
    const kick = vi.fn();
    const w = withCalendarKick(fake(), kick);
    expect(await w.apply(DEFAULT_FAMILY_ID, EVENT)).toEqual({ version: "v1", synced: true });
    expect(kick).toHaveBeenCalledTimes(1);
    await w.apply(DEFAULT_FAMILY_ID, TASK);
    expect(kick).toHaveBeenCalledTimes(1);
    for (const kind of ["event.update", "event.remove"] as const) {
      await w.apply(DEFAULT_FAMILY_ID, { kind, payload: { id: "evt-1" } });
    }
    expect(kick).toHaveBeenCalledTimes(3);
  });

  it("복사 대상 종류는 명시 목록이다: 일정 종류 전부, 나머지는 제외", () => {
    expect([...CALENDAR_CHANGE_KINDS].sort()).toEqual(["event.add", "event.remove", "event.update"]);
    const all: Change["kind"][] = ["event.add", "event.update", "event.remove", "task.add", "task.done", "anniversary.add"];
    expect(all.filter((k) => CALENDAR_CHANGE_KINDS.includes(k))).toEqual(["event.add", "event.update", "event.remove"]);
  });

  it("위키 쓰기가 실패하면 깨우지 않고 오류를 그대로 전한다", async () => {
    const kick = vi.fn();
    const w = withCalendarKick(fake({ apply: vi.fn(async () => { throw new Error("저장 실패"); }) }), kick);
    await expect(w.apply(DEFAULT_FAMILY_ID, EVENT)).rejects.toThrow("저장 실패");
    expect(kick).not.toHaveBeenCalled();
  });

  it("깨우는 쪽이 던져도 위키 쓰기 결과는 성공이다(경고만)", async () => {
    const warn = vi.fn();
    const w = withCalendarKick(fake(), () => { throw new Error("boom"); }, warn);
    await expect(w.apply(DEFAULT_FAMILY_ID, EVENT)).resolves.toMatchObject({ version: "v1" });
    expect(warn).toHaveBeenCalled();
  });

  it("read·applySetup·applySettings는 그대로 넘긴다", async () => {
    const inner = fake();
    const w = withCalendarKick(inner, vi.fn());
    await w.applySettings(DEFAULT_FAMILY_ID, { kind: "member.color", payload: { id: "a", color: "blue" } }, { author: "x" });
    expect(inner.applySettings).toHaveBeenCalledWith(DEFAULT_FAMILY_ID, expect.anything(), { author: "x" });
  });
});
