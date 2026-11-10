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

function setup(o: { events?: Event[]; calendarId?: string | null; fallback?: string; warnings?: string[]; initial?: CalendarMapping; sync?: Partial<CalendarSync> & { checkAccess?: () => Promise<void> }; mentions?: (id: string) => boolean; holdReleaseMs?: number; now?: () => Date } = {}) {
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
    googleId: (_f, id, gen) => `g${id.replace(/\W/g, "")}${gen}`.toLowerCase().replace(/[^a-v0-9]/g, "a").padEnd(5, "0"),
    mentionsEventId: o.mentions,
    holdReleaseMs: o.holdReleaseMs,
    retryDelayMs: 5,
    now: o.now ?? (() => NOW),
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

  it("위키 원문에 일정 id가 아직 남아 있으면(깨진 줄) 그 일정만 삭제하지 않는다", async () => {
    const t = setup({ events: [ev("evt-a"), ev("evt-b")], mentions: (id) => id === "evt-a" });
    await t.r.run();
    t.state.events.length = 0; // 읽기에서 둘 다 빠짐: a는 원문에 남아 있음(깨진 줄), b는 정말 지워짐
    const r = await t.r.run();
    expect(r.removed).toBe(1);
    expect(t.sync.remove).toHaveBeenCalledWith("evt-b");
    expect(t.sync.remove).not.toHaveBeenCalledWith("evt-a");
    expect(Object.keys(t.mem.get()!.entries)).toEqual(["evt-a"]);
    expect(t.warns.join()).toContain("형식이 깨진");
  });

  it("events 읽기 경고(share 관련 등)만으로는 삭제를 막지 않는다", async () => {
    const t = setup({ events: [ev("evt-a")], warnings: ["events/2026-11.md: share 값이 올바르지 않아 없는 것으로 읽었어요"] });
    await t.r.run();
    t.state.events.length = 0;
    expect((await t.r.run()).removed).toBe(1);
  });

  it("대량 삭제는 보류하다가 같은 집합이 15분 이어지면 진행한다", async () => {
    let at = NOW.getTime();
    const events = Array.from({ length: 6 }, (_, i) => ev(`evt-${i}`));
    const t = setup({ events, now: () => new Date(at) });
    await t.r.run();
    t.state.events.length = 0;
    const r1 = await t.r.run();
    expect(r1).toMatchObject({ removed: 0, heldRemovals: 6 });
    at += 14 * 60_000;
    expect((await t.r.run()).removed).toBe(0);
    at += 60_000;
    expect((await t.r.run()).removed).toBe(6);
    expect(t.warns.join()).toContain("사람이 지운 것으로");
  });

  it("보류 중 삭제 집합이 바뀌면 시간을 다시 센다", async () => {
    let at = NOW.getTime();
    const events = Array.from({ length: 8 }, (_, i) => ev(`evt-${i}`));
    const t = setup({ events, now: () => new Date(at) });
    await t.r.run();
    const all = [...t.state.events];
    t.state.events.length = 0;
    await t.r.run();
    at += 14 * 60_000;
    t.state.events.push(all[0]!); // 집합이 달라짐
    await t.r.run();
    at += 14 * 60_000;
    expect((await t.r.run()).removed).toBe(0);
  });

  it("할 일이 있는 바퀴에서만 캘린더 접근을 확인하고, 404(공유 풀림)면 지우지 않고 멈춘다", async () => {
    const checkAccess = vi.fn(async () => {});
    const t = setup({ events: [ev("evt-a")], sync: { checkAccess } });
    await t.r.run();
    expect(checkAccess).toHaveBeenCalledTimes(1);
    await t.r.run(); // 바뀐 것 없음: 구글 호출 없음
    expect(checkAccess).toHaveBeenCalledTimes(1);

    t.state.events.length = 0;
    checkAccess.mockRejectedValueOnce(new CalendarSyncError("forbidden", "캘린더를 찾지 못했어요", 404));
    const r = await t.r.run();
    expect(r.status).toBe("aborted");
    expect(t.sync.remove).not.toHaveBeenCalled();
    expect(Object.keys(t.mem.get()!.entries)).toEqual(["evt-a"]); // 기록 유지: 공유가 돌아오면 지운다
    expect(t.warns.join()).toContain("일정 변경");
    expect((await t.r.run()).removed).toBe(1);
  });

  it("영구 실패(400 등) 건이 앞에 있어도 뒤 일정은 계속 나가고, 다음 바퀴에는 뒤로 밀린다", async () => {
    const bad = vi.fn(async (e: Event) => { if (e.id === "evt-a" || e.id === "evt-b" || e.id === "evt-c") throw new CalendarSyncError("http", "x", 400); });
    const t = setup({ events: ["a", "b", "c", "d", "e"].map((x) => ev(`evt-${x}`)), sync: { upsert: bad } });
    const r = await t.r.run();
    expect(r).toMatchObject({ status: "ok", failed: 3, added: 2 });
    expect(Object.keys(t.mem.get()!.entries).sort()).toEqual(["evt-d", "evt-e"]);
    // 다음 바퀴: 날짜가 더 늦은 새 일정이 실패 건보다 먼저 나간다
    bad.mockClear();
    t.state.events.push(ev("evt-f", { date: "2026-11-30" }));
    await t.r.run();
    expect(bad.mock.calls.map((c) => c[0].id)).toEqual(["evt-f", "evt-a", "evt-b", "evt-c"]);
  });

  it("지운 id를 되살리지 못해 conflict가 나면 세대를 올려 새 id로 만들고 기록한다", async () => {
    let first = true;
    const t = setup({ events: [ev("evt-a")], sync: { upsert: vi.fn(async () => { if (first) { first = false; throw new CalendarSyncError("conflict", "x", 404); } }) } });
    const r = await t.r.run();
    expect(r).toMatchObject({ added: 1, failed: 0 });
    expect(t.sync.upsert).toHaveBeenCalledTimes(2);
    expect(t.mem.get()!.entries["evt-a"]).toMatchObject({ gen: 1, googleId: expect.stringContaining("a1") });
    expect(t.runtime.generations).toEqual({ "evt-a": 1 });
    // 다음 바퀴: 같은 내용이면 호출 없음
    await t.r.run();
    expect(t.sync.upsert).toHaveBeenCalledTimes(2);
  });

  it("세대를 올린 재시도도 실패하면 기록은 그대로(세대 되돌림)", async () => {
    const t = setup({ events: [ev("evt-a")], sync: { upsert: vi.fn(async () => { throw new CalendarSyncError("conflict", "x"); }) } });
    const r = await t.r.run();
    expect(r.failed).toBe(1);
    expect(t.mem.get()).toBeUndefined();
    expect(t.runtime.generations).toEqual({});
  });

  it("config.md를 못 읽었거나 calendarId 값이 깨졌으면 환경 변수 캘린더로 바꿔 올리지 않고 건너뛴다", async () => {
    const t = setup({ events: [ev("evt-a")], fallback: "env@x.com", warnings: ['config.md: calendarId: "a b" 값이 올바르지 않아 없는 것으로 읽었어요'] });
    t.state.config!.calendarId = undefined;
    expect((await t.r.run()).status).toBe("read_failed");
    expect(t.sync.upsert).not.toHaveBeenCalled();
    const u = setup({ events: [ev("evt-a")], fallback: "env@x.com", calendarId: null, warnings: ["config.md: 프론트매터(---)가 없어 config로 읽지 못했어요"] });
    expect((await u.r.run()).status).toBe("read_failed");
    // config.md가 아예 없으면(경고 없음) 환경 변수 값을 쓴다
    const v = setup({ events: [ev("evt-a")], fallback: "env@x.com", calendarId: null });
    expect((await v.r.run()).added).toBe(1);
  });

  it("config의 calendarId도 메일 주소 모양이 아니면 쓰지 않는다", async () => {
    const t = setup({ events: [ev("evt-a")], calendarId: "bad id/../x" });
    expect((await t.r.run()).status).toBe("disabled");
    expect(t.sync.upsert).not.toHaveBeenCalled();
  });

  it("중단된 바퀴 중에 온 요청은 잠시 뒤 한 번 다시 돈다(버려지지 않음)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const t = setup({ events: [ev("evt-a")], sync: { upsert: vi.fn(async () => { n++; if (n === 1) { await gate; throw new CalendarSyncError("rate_limit", "x"); } }) } });
    const p = t.r.run();
    await vi.waitFor(() => expect(n).toBe(1));
    void t.r.run(); // 도는 중 요청
    release();
    expect((await p).status).toBe("aborted");
    await vi.waitFor(() => expect(t.mem.get()?.entries["evt-a"]).toBeDefined());
    t.r.dispose();
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

  it("이미 복사해 둔 기록(같은 캘린더)이 있으면 위키에서 사라진 일정만 지운다", async () => {
    const fp = `h${"calendar:fam@group.calendar.google.com".length}:${"calendar:fam@group.calendar.google.com".slice(-12)}`.slice(0, 16);
    const m: CalendarMapping = { ...emptyMapping(fp), entries: { "evt-old": { googleId: "abcde12345", hash: "x", at: "2026-11-01T00:00:00Z" } } };
    const t = setup({ events: [], initial: m });
    const r = await t.r.run();
    expect(r).toMatchObject({ status: "ok", removed: 1, added: 0 });
    expect(t.sync.remove).toHaveBeenCalledWith("evt-old");
    expect(t.mem.get()!.entries).toEqual({});
  });
});
