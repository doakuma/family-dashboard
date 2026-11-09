import { SettingsError, WikiLockError, asFamilyId, ConnectStoreError, type ConnectCodeStore, type Member, type SettingsChange } from "@hsh/core";
import { describe, expect, it, vi } from "vitest";
import { runSettings, type SettingsApiDeps } from "./api";

const FID = asFamilyId("default");
const members: Member[] = [
  { id: "mom", name: "엄마", role: "guardian", color: "coral", slackId: "U0MOM" },
  { id: "haneul", name: "하늘", role: "child", color: "blue" },
  { id: "family", name: "가족", role: "guardian", color: "gray" },
];
const config = { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray", region: "서울특별시 마포구" };

function setup(over: Partial<SettingsApiDeps> = {}) {
  const calls: { change: SettingsChange; author?: string }[] = [];
  const connect = {
    issue: vi.fn(async (i: { memberKey: string; name: string; role: "guardian" | "child"; scope?: string }) => ({ code: "123456", memberKey: i.memberKey, name: i.name, role: i.role, scope: "settings" as const, issuedAt: "2026-11-09T00:00:00Z", expiresAt: "2026-11-09T00:30:00Z" })),
    states: vi.fn(async (codes: readonly string[]) => Object.fromEntries(codes.map((c) => [c, "connected" as const]))),
    claimed: vi.fn(async (c: string) => (c === "123456" ? { slackId: "U0SKY", record: { code: c, memberKey: "haneul", name: "하늘", role: "child" as const, scope: "settings" as const, issuedAt: "", expiresAt: "" } } : undefined)),
    revoke: vi.fn(async () => {}),
  } satisfies Pick<ConnectCodeStore, "issue" | "states" | "claimed" | "revoke">;
  const deps: SettingsApiDeps = {
    repo: {
      applySettings: vi.fn(async (_f, change, opts) => {
        calls.push({ change, author: opts?.author });
        return { version: "abc123", synced: true };
      }),
    },
    read: async () => ({ config, members }),
    connect,
    familyId: FID,
    log: () => {},
    ...over,
  };
  return { deps, calls, connect };
}

describe("runSettings: 변경 -> applySettings", () => {
  it("구성원 추가·색·해제는 해당 SettingsChange로, 작성자는 settings", async () => {
    const { deps, calls } = setup();
    expect((await runSettings({ kind: "member.add", name: "아빠", role: "guardian", color: "teal" }, deps)).status).toBe(200);
    expect((await runSettings({ kind: "member.color", id: "haneul", color: "green" }, deps)).status).toBe(200);
    expect((await runSettings({ kind: "slack.unlink", id: "mom" }, deps)).status).toBe(200);
    expect(calls).toEqual([
      { change: { kind: "member.add", payload: { name: "아빠", role: "guardian", color: "teal" } }, author: "settings" },
      { change: { kind: "member.color", payload: { id: "haneul", color: "green" } }, author: "settings" },
      { change: { kind: "member.slack", payload: { id: "mom", slackId: null } }, author: "settings" },
    ]);
  });
  it("지역은 키만 받아 서버가 지역표에서 코드를 채운다", async () => {
    const { deps, calls } = setup();
    expect((await runSettings({ kind: "region", regionKey: "seoul-gangnam" }, deps)).status).toBe(200);
    expect(calls[0]?.change).toEqual({ kind: "config.region", payload: { region: "서울특별시 강남구", kmaNx: 61, kmaNy: 126, kmaMidLandRegId: "11B00000", kmaMidTaRegId: "11B10101" } });
    const bad = await runSettings({ kind: "region", regionKey: "nowhere" }, deps);
    expect(bad).toMatchObject({ status: 422, body: { ok: false, code: "invalid" } });
    expect(calls).toHaveLength(1);
  });
  it("성공 응답: view는 연결됨 여부만 싣고 슬랙 ID가 어디에도 없다", async () => {
    const { deps } = setup();
    const r = await runSettings({ kind: "member.color", id: "haneul", color: "green" }, deps);
    expect(r.body).toMatchObject({ ok: true, saved: true, synced: true, view: { familyName: "햇살네", region: "서울특별시 마포구" } });
    expect(JSON.stringify(r.body)).not.toContain("U0MOM");
    expect(r.body.ok && r.body.view?.members.find((m) => m.id === "mom")).toEqual({ id: "mom", name: "엄마", role: "guardian", color: "coral", connected: true });
    expect(r.body.ok && r.body.view?.members.some((m) => m.id === "family")).toBe(false);
  });
  it("동기화 실패는 저장 성공 + syncError", async () => {
    const { deps } = setup({ repo: { applySettings: async () => ({ version: "v", synced: false, syncError: "push 거부" }) } });
    expect((await runSettings({ kind: "member.color", id: "haneul", color: "green" }, deps)).body).toMatchObject({ ok: true, synced: false, syncError: "push 거부" });
  });
  it("저장 뒤 다시 읽지 못해도 저장은 성공(view 없음)", async () => {
    const { deps } = setup({ read: async () => { throw new Error("읽기 실패"); } });
    const r = await runSettings({ kind: "member.color", id: "haneul", color: "green" }, deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, saved: true });
    expect(r.body.ok && r.body.view).toBeUndefined();
  });
});

describe("runSettings: 오류 번역", () => {
  const rejecting = (e: unknown) => setup({ repo: { applySettings: async () => { throw e; } } }).deps;
  it.each([
    ["invalid", 422],
    ["not_found", 422],
    ["conflict", 409],
    ["needs_setup", 409],
    ["read_only", 503],
  ] as const)("SettingsError %s -> %i", async (code, status) => {
    const r = await runSettings({ kind: "member.color", id: "haneul", color: "green" }, rejecting(new SettingsError("안내 문구", code)));
    expect(r).toMatchObject({ status, body: { ok: false, code, message: "안내 문구" } });
  });
  it("다른 곳에서 저장 중(WikiLockError)이면 503 + 다시 하라는 문구", async () => {
    const r = await runSettings({ kind: "member.color", id: "haneul", color: "green" }, rejecting(new WikiLockError()));
    expect(r).toMatchObject({ status: 503, body: { ok: false, code: "busy", message: "다른 곳에서 저장 중이에요. 잠시 뒤 다시 해 주세요" } });
  });
  it("그 밖의 오류는 500 + 일반 문구(내부 메시지를 싣지 않는다)", async () => {
    const r = await runSettings({ kind: "member.color", id: "haneul", color: "green" }, rejecting(new Error("fatal: /home/x/secret")));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });
});

describe("runSettings: 본문 모양", () => {
  it.each([
    [undefined],
    [{}],
    [{ kind: "member.remove", id: "mom" }],
    [{ kind: "member.add", name: "아빠", role: "guardian", color: "teal", slackId: "U1" }],
    [{ kind: "member.color", id: "mom", color: "green", slackId: "U1" }],
    [{ kind: "member.color", id: "../etc", color: "green" }],
    [{ kind: "slack.save", id: "haneul", code: "12", slackId: "U1" }],
    [{ kind: "slack.status", codes: [] }],
    [{ kind: "slack.status", codes: ["123456", "abc"] }],
  ])("%j -> 422 bad_request, 쓰지 않는다", async (raw) => {
    const { deps, calls } = setup();
    expect(await runSettings(raw, deps)).toMatchObject({ status: 422, body: { ok: false, code: "bad_request" } });
    expect(calls).toHaveLength(0);
  });
});

describe("runSettings: 슬랙 재연결", () => {
  it("코드 받기: 이름·역할은 위키에서 읽고 settings 범위·구성원 id로 발급", async () => {
    const { deps, connect } = setup();
    const r = await runSettings({ kind: "slack.code", id: "haneul" }, deps);
    expect(r).toMatchObject({ status: 200, body: { ok: true, code: "123456", expiresAt: "2026-11-09T00:30:00Z" } });
    expect(connect.issue).toHaveBeenCalledWith({ memberKey: "haneul", name: "하늘", role: "child", scope: "settings" });
  });
  it("없는 구성원·family는 코드를 발급하지 않는다", async () => {
    const { deps, connect } = setup();
    expect(await runSettings({ kind: "slack.code", id: "nobody" }, deps)).toMatchObject({ status: 422, body: { code: "not_found" } });
    expect(await runSettings({ kind: "slack.code", id: "family" }, deps)).toMatchObject({ status: 422 });
    expect(connect.issue).not.toHaveBeenCalled();
  });
  it("코드가 너무 많으면 429", async () => {
    const { deps } = setup();
    deps.connect = { ...deps.connect!, issue: async () => { throw new ConnectStoreError("많아요", "too_many"); } };
    expect((await runSettings({ kind: "slack.code", id: "haneul" }, deps)).status).toBe(429);
  });
  it("상태 조회: 코드별 상태만(슬랙 ID 없음)", async () => {
    const { deps } = setup();
    const r = await runSettings({ kind: "slack.status", codes: ["123456"] }, deps);
    expect(r).toMatchObject({ status: 200, body: { ok: true, states: { "123456": "connected" } } });
    expect(JSON.stringify(r.body)).not.toContain("U0SKY");
  });
  it("저장: 서버가 연결 기록에서 slackId를 꺼내 member.slack으로 반영하고 코드를 지운다", async () => {
    const { deps, calls, connect } = setup();
    const r = await runSettings({ kind: "slack.save", id: "haneul", code: "123456" }, deps);
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ change: { kind: "member.slack", payload: { id: "haneul", slackId: "U0SKY" } }, author: "settings" }]);
    expect(connect.revoke).toHaveBeenCalledWith("123456");
    expect(JSON.stringify(r.body)).not.toContain("U0SKY");
  });
  it("연결 전·다른 구성원의 코드·setup 범위 코드는 409 not_connected, 쓰지 않는다", async () => {
    const { deps, calls, connect } = setup();
    expect(await runSettings({ kind: "slack.save", id: "haneul", code: "999999" }, deps)).toMatchObject({ status: 409, body: { code: "not_connected" } });
    expect(await runSettings({ kind: "slack.save", id: "mom", code: "123456" }, deps)).toMatchObject({ status: 409, body: { code: "not_connected" } });
    connect.claimed.mockResolvedValueOnce({ slackId: "U0X", record: { code: "123456", memberKey: "haneul", name: "하늘", role: "child", scope: "setup" as never, issuedAt: "", expiresAt: "" } });
    expect(await runSettings({ kind: "slack.save", id: "haneul", code: "123456" }, deps)).toMatchObject({ status: 409 });
    expect(calls).toHaveLength(0);
  });
  it("같은 슬랙 계정이 이미 다른 구성원이면 409(위키 검사) 그리고 코드는 남긴다", async () => {
    const { deps, connect } = setup({ repo: { applySettings: async () => { throw new SettingsError("이미 '엄마'에 연결", "conflict"); } } });
    expect(await runSettings({ kind: "slack.save", id: "haneul", code: "123456" }, deps)).toMatchObject({ status: 409, body: { code: "conflict" } });
    expect(connect.revoke).not.toHaveBeenCalled();
  });
  it("상태 폴더 설정이 잘못되면(connect 없음) 코드 관련만 503, 나머지 변경은 된다", async () => {
    const { deps } = setup({ connect: undefined });
    for (const raw of [{ kind: "slack.code", id: "haneul" }, { kind: "slack.status", codes: ["123456"] }, { kind: "slack.save", id: "haneul", code: "123456" }]) expect((await runSettings(raw, deps)).status).toBe(503);
    expect((await runSettings({ kind: "member.color", id: "haneul", color: "green" }, deps)).status).toBe(200);
    expect((await runSettings({ kind: "slack.unlink", id: "mom" }, deps)).status).toBe(200);
  });
});

describe("runSettings + 실제 파일 연결 저장소(봇의 claim 흉내)", () => {
  it("코드 받기 -> 봇 DM claim -> 상태 connected -> 저장(slackId는 서버 안에서만) -> 코드 폐기", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { FsConnectCodeStore } = await import("@hsh/core/node");
    const dir = mkdtempSync(join(tmpdir(), "hsh-settings-api-"));
    try {
      const store = new FsConnectCodeStore({ dir });
      const { deps, calls } = setup({ connect: store });
      const issued = await runSettings({ kind: "slack.code", id: "haneul" }, deps);
      const code = issued.body.ok ? (issued.body.code ?? "") : "";
      expect(code).toMatch(/^\d{6}$/);
      expect((await runSettings({ kind: "slack.status", codes: [code] }, deps)).body).toMatchObject({ states: { [code]: "pending" } });
      expect((await runSettings({ kind: "slack.save", id: "haneul", code }, deps)).status).toBe(409); // 아직 DM 전

      expect(await store.claim(code, "U0SKY")).toMatchObject({ ok: true });
      const st = await runSettings({ kind: "slack.status", codes: [code] }, deps);
      expect(st.body).toMatchObject({ states: { [code]: "connected" } });
      expect(JSON.stringify(st.body)).not.toContain("U0SKY");

      expect((await runSettings({ kind: "slack.save", id: "mom", code }, deps)).status).toBe(409); // 다른 구성원 몫의 코드
      const saved = await runSettings({ kind: "slack.save", id: "haneul", code }, deps);
      expect(saved.status).toBe(200);
      expect(calls).toEqual([{ change: { kind: "member.slack", payload: { id: "haneul", slackId: "U0SKY" } }, author: "settings" }]);
      expect(JSON.stringify(saved.body)).not.toContain("U0SKY");
      expect((await store.states([code]))[code]).toBe("expired"); // 반영 뒤 코드는 쓸 수 없다
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
