import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FAMILY_ID } from "../types";
import type { CalendarSync } from "../ports";
import type { Event, WikiState } from "../types";
import { CalendarSyncError } from "./errors";
import { emptyMapping, type CalendarMapping, type CalendarMappingStore } from "./mapping";
import { CalendarReconciler, type CalendarRuntime } from "./reconcile";

const ev = (id: string, o: Partial<Event> = {}): Event => ({ id, date: "2026-11-12", start: "10:00", allDay: false, title: id, members: ["haneul"], done: false, ...o });
const NOW = new Date("2026-11-10T03:00:00Z");

function memStore(initial?: CalendarMapping) {
  let m = initial;
  const writes: CalendarMapping[] = [];
  const store: CalendarMappingStore = {
    read: async () => (m ? { mapping: structuredClone(m) } : {}),
    write: async (next) => {
      m = structuredClone(next);
      writes.push(m);
    },
  };
  return { store, get: () => m, writes };
}

function setup(o: { events?: Event[]; calendarId?: string | null; fallback?: string; warnings?: string[]; initial?: CalendarMapping; sync?: Partial<CalendarSync> } = {}) {
  const state = { events: o.events ?? [], warnings: o.warnings ?? [], members: [{ id: "haneul", name: "하늘", role: "child", color: "blue" }], config: o.calendarId === null ? undefined : { familyName: "x", timezone: "Asia/Seoul", familyColor: "blue", calendarId: o.calendarId ?? "fam@group.calendar.google.com" } } as unknown as WikiState;
  const sync = { upsert: vi.fn(async () => {}), remove: vi.fn(async () => {}), ...o.sync };
  const mem = memStore(o.initial);
  const logs: string[] = [];
  const warns: string[] = [];
  const runtime: CalendarRuntime = { context: { timezone: "Asia/Seoul", names: {} } };
  const readState = vi.fn(async () => state);
  const r = new CalendarReconciler({
    familyId: DEFAULT_FAMILY_ID,
    readState,
    sync,
    store: mem.store,
    runtime,
    fallbackCalendarId: o.fallback,
    hash: (s) => `h${s.length}:${s.slice(-12)}`,
    googleId: (_f, id) => `g${id.replace(/\W/g, "")}`.toLowerCase().replace(/[^a-v0-9]/g, "a").padEnd(5, "0"),
    now: () => NOW,
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
  });
  return { r, sync, mem, logs, warns, state, runtime, readState };
}

describe("CalendarReconciler", () => {
  it("추가 -> 기록 저장 -> 같은 내용이면 다시 하지 않음(수정 없음)", async () => {
    const t = setup({ events: [ev("evt-a"), ev("evt-b")] });
    const r1 = await t.r.run();
    expect(r1).toMatchObject({ status: "ok", added: 2, updated: 0, removed: 0, failed: 0 });
    expect(t.sync.upsert).toHaveBeenCalledTimes(2);
    expect(Object.keys(t.mem.get()!.entries).sort()).toEqual(["evt-a", "evt-b"]);
    expect(t.mem.get()!.entries["evt-a"]!.at).toBe(NOW.toISOString());
    const r2 = await t.r.run();
    expect(r2).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
    expect(t.sync.upsert).toHaveBeenCalledTimes(2);
  });

  it("제목이 바뀌면 수정, 구성원 이름이 바뀌어도(설명이 바뀜) 수정, 지워지면 삭제", async () => {
    const t = setup({ events: [ev("evt-a"), ev("evt-b")] });
    await t.r.run();
    t.state.events[0] = ev("evt-a", { title: "바뀜" });
    expect(await t.r.run()).toMatchObject({ updated: 1, added: 0 });
    t.state.members[0]!.name = "하늘이";
    expect((await t.r.run()).updated).toBe(2);
    t.state.events.splice(0, 1);
    const r = await t.r.run();
    expect(r.removed).toBe(1);
    expect(t.sync.remove).toHaveBeenCalledWith("evt-a");
    expect(Object.keys(t.mem.get()!.entries)).toEqual(["evt-b"]);
  });

  it("매 실행 처음에 캘린더 id·시간대·구성원 이름을 어댑터용 runtime에 채운다", async () => {
    const t = setup({ events: [ev("evt-a")] });
    await t.r.run();
    expect(t.runtime.calendarId).toBe("fam@group.calendar.google.com");
    expect(t.runtime.context).toEqual({ timezone: "Asia/Seoul", names: { haneul: "하늘" } });
  });

  it("config.md의 calendarId가 우선, 없으면 GOOGLE_CALENDAR_ID, 둘 다 없으면 꺼짐(아무 것도 안 함)", async () => {
    const a = setup({ events: [ev("evt-a")], fallback: "env@x.com" });
    await a.r.run();
    expect(a.runtime.calendarId).toBe("fam@group.calendar.google.com");

    const b = setup({ events: [ev("evt-a")], calendarId: null, fallback: "env@x.com" });
    await b.r.run();
    expect(b.runtime.calendarId).toBe("env@x.com");

    const c = setup({ events: [ev("evt-a")], calendarId: null });
    expect((await c.r.run()).status).toBe("disabled");
    expect(c.sync.upsert).not.toHaveBeenCalled();
    expect(c.mem.writes).toHaveLength(0);
    await c.r.run();
    expect(c.logs.filter((l) => l.includes("건너뛰어요"))).toHaveLength(1); // 안내는 한 번만
  });

  it("캘린더가 바뀌면 기록을 새로 시작한다(원문 id는 기록에 없음)", async () => {
    const t = setup({ events: [ev("evt-a")] });
    await t.r.run();
    expect(JSON.stringify(t.mem.get())).not.toContain("fam@group");
    t.state.config!.calendarId = "other@group.calendar.google.com";
    const r = await t.r.run();
    expect(r.added).toBe(1);
    expect(t.sync.upsert).toHaveBeenCalledTimes(2);
  });

  it("한 건이 실패해도 나머지는 계속하고 실패한 것은 기록하지 않아 다음에 다시 한다", async () => {
    let fail = true;
    const t = setup({
      events: [ev("evt-a"), ev("evt-b"), ev("evt-c")],
      sync: { upsert: vi.fn(async (e: Event) => { if (e.id === "evt-b" && fail) throw new CalendarSyncError("server", "구글 서버 오류예요", 503); }) },
    });
    const r1 = await t.r.run();
    expect(r1).toMatchObject({ status: "ok", added: 2, failed: 1, errors: { server: 1 } });
    expect(Object.keys(t.mem.get()!.entries).sort()).toEqual(["evt-a", "evt-c"]);
    expect(t.warns.join("\n")).toMatch(/1건 실패\(server 1\)/);
    fail = false;
    expect(await t.r.run()).toMatchObject({ added: 1, failed: 0 });
  });

  it("연달아 3건 실패하면 그 실행은 멈춘다(느린 재시도를 건마다 반복하지 않음)", async () => {
    const t = setup({ events: ["a", "b", "c", "d", "e"].map((x) => ev(`evt-${x}`)), sync: { upsert: vi.fn(async () => { throw new CalendarSyncError("server", "x", 503); }) } });
    const r = await t.r.run();
    expect(r).toMatchObject({ status: "aborted", failed: 3 });
    expect(t.sync.upsert).toHaveBeenCalledTimes(3);
  });

  it("인증·권한·한도 오류는 나머지를 두드리지 않고 멈춘다(힌트 로그)", async () => {
    for (const [kind, hint] of [["auth", "서비스 계정 키"], ["forbidden", "일정 변경"], ["rate_limit", "한도"]] as const) {
      const t = setup({ events: [ev("evt-a"), ev("evt-b")], sync: { upsert: vi.fn(async () => { throw new CalendarSyncError(kind, "x"); }) } });
      const r = await t.r.run();
      expect(r.status).toBe("aborted");
      expect(t.sync.upsert).toHaveBeenCalledTimes(1);
      expect(t.warns.join()).toContain(hint);
    }
  });

  it("알 수 없는 오류도 던지지 않는다(내용은 로그에 싣지 않음)", async () => {
    const t = setup({ events: [ev("evt-a")], sync: { upsert: vi.fn(async () => { throw new Error("secret-token-xyz"); }) } });
    const r = await t.r.run();
    expect(r).toMatchObject({ failed: 1, errors: { unknown: 1 } });
    expect(t.warns.join()).not.toContain("secret-token-xyz");
  });

  it("위키 읽기가 실패하면 아무것도 하지 않고 던지지도 않는다", async () => {
    const t = setup({ events: [ev("evt-a")] });
    t.readState.mockRejectedValueOnce(new Error("disk"));
    expect((await t.r.run()).status).toBe("read_failed");
    expect(t.sync.upsert).not.toHaveBeenCalled();
  });

  it("복사 기록 저장이 실패해도 동기화는 계속된다", async () => {
    const t = setup({ events: [ev("evt-a"), ev("evt-b")] });
    t.mem.store.write = async () => { throw new Error("EACCES /secret/path"); };
    const r = await t.r.run();
    expect(r.added).toBe(2);
    expect(t.warns.join()).toContain("저장하지 못했어요");
    expect(t.warns.join()).not.toContain("/secret/path");
  });

  it("복사 기록 파일이 깨졌으면 알리고 새로 시작한다", async () => {
    const t = setup({ events: [ev("evt-a")] });
    t.mem.store.read = async () => ({ broken: true });
    expect((await t.r.run()).added).toBe(1);
    expect(t.warns.join()).toContain("깨져");
  });

  it("위키 events 파일에 읽기 경고가 있으면 삭제하지 않는다", async () => {
    const t = setup({ events: [ev("evt-a")] });
    await t.r.run();
    t.state.events.length = 0;
    t.state.warnings.push("events/2026-11.md: 줄 형식 오류");
    const r = await t.r.run();
    expect(r.removed).toBe(0);
    expect(r.heldRemovals).toBe(1);
    expect(t.sync.remove).not.toHaveBeenCalled();
    t.state.warnings.length = 0;
    expect((await t.r.run()).removed).toBe(1);
  });

  it("삭제 도중 이미 없던(성공 취급) 일정도 기록에서 빠진다", async () => {
    const t = setup({ events: [ev("evt-a")] });
    await t.r.run();
    t.state.events.length = 0;
    await t.r.run();
    expect(t.mem.get()!.entries).toEqual({});
  });

  it("동시에 여러 번 불러도 한 번의 실행으로 합쳐진다(끝난 뒤 한 번 더 확인)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const t = setup({ events: [ev("evt-a")], sync: { upsert: vi.fn(async () => { await gate; }) } });
    const p1 = t.r.run();
    const p2 = t.r.run();
    const p3 = t.r.run();
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    release();
    await p1;
    expect(t.sync.upsert).toHaveBeenCalledTimes(1);
    // 도는 사이 요청이 있었으므로 한 번 더 읽어 확인했다(바뀐 게 없어 쓰기 없음)
    expect(t.readState).toHaveBeenCalledTimes(2);
  });

  it("실행 도중 위키에 새 일정이 생겨도 이어지는 한 바퀴가 따라간다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const t = setup({ events: [ev("evt-a")], sync: { upsert: vi.fn(async () => { if (first) { first = false; await gate; } }) } });
    const p = t.r.run();
    await vi.waitFor(() => expect(t.sync.upsert).toHaveBeenCalledTimes(1));
    t.state.events.push(ev("evt-b"));
    void t.r.run();
    release();
    await p;
    expect(Object.keys(t.mem.get()!.entries).sort()).toEqual(["evt-a", "evt-b"]);
  });

  it("옛 기록(mapping 있음)에서 기록에 없던 사라진 일정도 지운다", async () => {
    const m: CalendarMapping = { ...emptyMapping("x"), entries: {} };
    const t = setup({ events: [], initial: m });
    expect((await t.r.run()).status).toBe("ok");
  });
});
