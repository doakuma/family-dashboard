import { describe, expect, it } from "vitest";
import type { Event } from "../types";
import { DEFAULT_EVENT_MINUTES, stableStringify, toGoogleEvent, type EventBodyContext } from "./google-event";

const ctx: EventBodyContext = { timezone: "Asia/Seoul", names: { haneul: "하늘", dad: "아빠" } };
const ev = (o: Partial<Event> = {}): Event => ({ id: "evt-a1", date: "2026-11-03", start: "15:00", end: "16:00", allDay: false, title: "치과 검진", members: ["haneul"], done: false, ...o });

describe("toGoogleEvent", () => {
  it("시간 일정: dateTime + timeZone, 끝은 그대로", () => {
    const b = toGoogleEvent(ev(), ctx);
    expect(b.summary).toBe("치과 검진");
    expect(b.start).toEqual({ dateTime: "2026-11-03T15:00:00", timeZone: "Asia/Seoul" });
    expect(b.end).toEqual({ dateTime: "2026-11-03T16:00:00", timeZone: "Asia/Seoul" });
    expect(b.status).toBe("confirmed");
  });

  it("끝 시각이 없으면 기본 길이(60분)", () => {
    expect(DEFAULT_EVENT_MINUTES).toBe(60);
    expect(toGoogleEvent(ev({ end: undefined, start: "09:30" }), ctx).end).toEqual({ dateTime: "2026-11-03T10:30:00", timeZone: "Asia/Seoul" });
  });

  it("기본 길이가 자정을 넘으면 다음 날, 월말·연말도 맞다", () => {
    expect(toGoogleEvent(ev({ end: undefined, start: "23:30" }), ctx).end).toEqual({ dateTime: "2026-11-04T00:30:00", timeZone: "Asia/Seoul" });
    expect(toGoogleEvent(ev({ date: "2026-12-31", end: undefined, start: "23:00" }), ctx).end).toEqual({ dateTime: "2027-01-01T00:00:00", timeZone: "Asia/Seoul" });
  });

  it("끝이 시작보다 빠르거나 같으면(잘못된 데이터) 기본 길이로 대신한다", () => {
    expect(toGoogleEvent(ev({ start: "10:00", end: "10:00" }), ctx).end).toEqual({ dateTime: "2026-11-03T11:00:00", timeZone: "Asia/Seoul" });
    expect(toGoogleEvent(ev({ start: "10:00", end: "09:00" }), ctx).end).toEqual({ dateTime: "2026-11-03T11:00:00", timeZone: "Asia/Seoul" });
  });

  it("종일: date + 끝 날짜는 다음 날(exclusive)", () => {
    const b = toGoogleEvent(ev({ allDay: true, start: undefined, end: undefined, date: "2026-02-28" }), ctx);
    expect(b.start).toEqual({ date: "2026-02-28" });
    expect(b.end).toEqual({ date: "2026-03-01" });
  });

  it("시작 시각이 없으면 종일로 본다", () => {
    expect(toGoogleEvent(ev({ allDay: false, start: undefined, end: undefined }), ctx).start).toEqual({ date: "2026-11-03" });
  });

  it("시간대는 설정값을 따른다", () => {
    expect(toGoogleEvent(ev(), { ...ctx, timezone: "America/New_York" }).start).toMatchObject({ timeZone: "America/New_York" });
  });

  it("설명에 담당 이름·위키 id·덮어쓰기 안내, 비공개 속성에 위키 id", () => {
    const b = toGoogleEvent(ev({ members: ["haneul", "dad", "family", "unknown"] }), ctx);
    expect(b.description).toContain("담당: 하늘, 아빠, 가족, unknown");
    expect(b.description).toContain("위키 일정 id: evt-a1");
    expect(b.description).toContain("위키에는 반영되지 않고");
    expect(b.extendedProperties.private).toEqual({ hsh: "1", hshId: "evt-a1" });
  });

  it("완료 처리된 일정은 설명에 적는다", () => {
    expect(toGoogleEvent(ev({ done: true }), ctx).description).toContain("완료 처리된 일정");
    expect(toGoogleEvent(ev(), ctx).description).not.toContain("완료");
  });

  it("공개 가능한 값만: 구성원 id 대신 이름, 가족 calendarId 같은 값은 본문에 없다", () => {
    expect(JSON.stringify(toGoogleEvent(ev(), ctx))).not.toContain("@");
  });
});

describe("stableStringify", () => {
  it("키 순서가 달라도 같은 문자열", () => {
    expect(stableStringify({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(stableStringify({ b: { d: "x", c: [1, 2] }, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
