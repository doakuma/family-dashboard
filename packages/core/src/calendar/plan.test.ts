import { describe, expect, it } from "vitest";
import type { Event } from "../types";
import { emptyMapping, type CalendarMapping } from "./mapping";
import { planCalendarSync, MASS_REMOVE_MIN } from "./plan";

const ev = (id: string, date = "2026-11-10", title = id): Event => ({ id, date, allDay: true, title, members: ["family"], done: false });
const describeBy = (e: Event) => ({ googleId: `g${e.id.replace(/\W/g, "")}`.padEnd(8, "0").replace(/[^a-v0-9]/g, "a"), hash: `h:${e.title}` });
const entry = (e: Event, hash = `h:${e.title}`) => ({ googleId: describeBy(e).googleId, hash, at: "2026-11-01T00:00:00Z" });
const base = { describe: describeBy, today: "2026-11-10" };
const map = (...es: [Event, string?][]): CalendarMapping => ({ ...emptyMapping("fp"), entries: Object.fromEntries(es.map(([e, h]) => [e.id, entry(e, h)])) });

describe("planCalendarSync", () => {
  it("기록에 없으면 추가, 내용이 같으면 건너뜀, 내용이 바뀌면 수정", () => {
    const a = ev("evt-a");
    const b = ev("evt-b");
    const c = ev("evt-c", "2026-11-10", "새 제목");
    const p = planCalendarSync({ ...base, events: [a, b, c], mapping: map([a], [c, "h:옛 제목"]) });
    expect(p.upserts.map((u) => [u.event.id, u.kind])).toEqual([["evt-b", "add"], ["evt-c", "update"]]);
    expect(p.unchanged).toBe(1);
    expect(p.removes).toEqual([]);
  });

  it("위키에서 사라진 일정은 삭제(기록의 구글 id로)", () => {
    const a = ev("evt-a");
    const gone = ev("evt-gone");
    const p = planCalendarSync({ ...base, events: [a], mapping: map([a], [gone]) });
    expect(p.removes).toEqual([{ wikiId: "evt-gone", googleId: describeBy(gone).googleId }]);
  });

  it("구글 id 규칙이 바뀌어도 따라간다(기록의 googleId와 다르면 수정)", () => {
    const a = ev("evt-a");
    const m = map([a]);
    m.entries["evt-a"]!.googleId = "zzzzz";
    expect(planCalendarSync({ ...base, events: [a], mapping: m }).upserts).toHaveLength(1);
  });

  it("처음 올릴 때 한 달보다 옛 일정은 건너뛰지만, 이미 복사한 옛 일정은 계속 따라간다", () => {
    const old = ev("evt-old", "2026-09-01");
    const oldMapped = ev("evt-oldm", "2026-09-01", "바뀐 제목");
    const p = planCalendarSync({ ...base, events: [old, oldMapped], mapping: map([oldMapped, "h:옛"]) });
    expect(p.upserts.map((u) => u.event.id)).toEqual(["evt-oldm"]);
    // 옛 일정이라도 위키에 남아 있으면 지우지 않는다
    expect(p.removes).toEqual([]);
    // 30일 전(2026-10-11)까지는 올린다
    const edge = planCalendarSync({ ...base, events: [ev("evt-e", "2026-10-11")], mapping: emptyMapping("fp") });
    expect(edge.upserts).toHaveLength(1);
    expect(planCalendarSync({ ...base, events: [ev("evt-e", "2026-10-10")], mapping: emptyMapping("fp") }).upserts).toHaveLength(0); // 31일 전
  });

  it("한 번에 하는 일은 상한까지: 삭제 먼저, 가까운 날짜 순, 나머지는 deferred", () => {
    const events = [ev("evt-3", "2026-11-12"), ev("evt-1", "2026-11-10"), ev("evt-2", "2026-11-11")];
    const gone = ev("evt-gone");
    const p = planCalendarSync({ ...base, events, mapping: map([gone]), maxOps: 2 });
    expect(p.removes).toHaveLength(1);
    expect(p.upserts.map((u) => u.event.id)).toEqual(["evt-1"]);
    expect(p.deferred).toBe(2);
  });

  it("대량 삭제가 의심되면(5건 이상이고 절반 넘음) 삭제를 보류한다", () => {
    const gone = Array.from({ length: MASS_REMOVE_MIN }, (_, i) => ev(`evt-g${i}`));
    const keep = ev("evt-keep");
    const p = planCalendarSync({ ...base, events: [keep], mapping: map([keep], ...gone.map((g): [Event] => [g])) });
    expect(p.removes).toEqual([]);
    expect(p.heldRemovals).toBe(MASS_REMOVE_MIN);
    // 절반 이하면 지운다
    const many = Array.from({ length: 12 }, (_, i) => ev(`evt-k${i}`));
    const p2 = planCalendarSync({ ...base, events: many, mapping: map(...many.map((m): [Event] => [m]), ...gone.map((g): [Event] => [g])) });
    expect(p2.removes).toHaveLength(MASS_REMOVE_MIN);
    // 적은 수의 삭제는 바로
    expect(planCalendarSync({ ...base, events: [], mapping: map([ev("evt-1")]) }).removes).toHaveLength(1);
  });

  it("allowRemovals:false면 삭제하지 않는다", () => {
    const p = planCalendarSync({ ...base, events: [], mapping: map([ev("evt-1")]), allowRemovals: false });
    expect(p.removes).toEqual([]);
    expect(p.heldRemovals).toBe(1);
  });
});
