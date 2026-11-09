import { ConnectStoreError, type ConnectCodeRecord } from "@hsh/core";
import { FsConnectCodeStore } from "@hsh/core/node";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectStatus, issueConnectCode, revokeConnectCode, MAX_STATUS_CODES, type ConnectApiDeps } from "./connect";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "hsh-connect-api-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const deps = (over: Partial<ConnectApiDeps> = {}): ConnectApiDeps => ({ store: new FsConnectCodeStore({ dir }), needsSetup: async () => true, log: () => {}, ...over });
const body = { memberKey: "m1", name: "하늘", role: "child" };

describe("issueConnectCode", () => {
  it("200: 코드와 만료 시각", async () => {
    const r = await issueConnectCode(body, deps());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, code: expect.stringMatching(/^\d{6}$/), expiresAt: expect.any(String) });
  });

  it("모양이 틀리면 422(저장소·세팅 확인을 부르지 않는다)", async () => {
    const needsSetup = vi.fn(async () => true);
    const d = deps({ needsSetup });
    for (const raw of [null, [], {}, { ...body, memberKey: "../x" }, { ...body, memberKey: "" }, { ...body, name: "  " }, { ...body, name: "a".repeat(41) }, { ...body, name: "하\n늘" }, { ...body, role: "admin" }, { ...body, slackId: "U1" }]) {
      expect((await issueConnectCode(raw, d)).status, JSON.stringify(raw)).toBe(422);
    }
    expect(needsSetup).not.toHaveBeenCalled();
  });

  it("세팅이 이미 끝났으면 409, 코드를 만들지 않는다", async () => {
    const issue = vi.fn();
    const r = await issueConnectCode(body, deps({ needsSetup: async () => false, store: { issue, states: vi.fn(), revoke: vi.fn() } }));
    expect(r).toMatchObject({ status: 409, body: { ok: false, code: "already_done" } });
    expect(issue).not.toHaveBeenCalled();
  });

  it("활성 코드가 너무 많으면 429, 그 밖의 오류는 500 일반 문구(내부 메시지는 로그에만)", async () => {
    const many = await issueConnectCode(body, deps({ store: { issue: async () => Promise.reject(new ConnectStoreError("x", "too_many")), states: vi.fn(), revoke: vi.fn() } }));
    expect(many.status).toBe(429);
    const log = vi.fn();
    const r = await issueConnectCode(body, deps({ log, store: { issue: async () => Promise.reject(new Error("EACCES /home/u/.homesweethome")), states: vi.fn(), revoke: vi.fn() } }));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("homesweethome");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
  });

  it("같은 구성원이 다시 받으면 이전 코드는 무효", async () => {
    const d = deps();
    const a = await issueConnectCode(body, d);
    const b = await issueConnectCode(body, d);
    if (!a.body.ok || !b.body.ok) throw new Error("발급 실패");
    const s = await connectStatus({ codes: [a.body.code, b.body.code] }, d);
    expect(s.body).toEqual({ ok: true, states: { [a.body.code]: "expired", [b.body.code]: "pending" } });
  });
});

describe("connectStatus", () => {
  it("코드별 pending·connected·expired, 슬랙 ID는 응답 어디에도 없다", async () => {
    const store = new FsConnectCodeStore({ dir });
    const a = (await store.issue({ memberKey: "m1", name: "하늘", role: "child" })) as ConnectCodeRecord;
    const b = await store.issue({ memberKey: "m2", name: "엄마", role: "guardian" });
    await store.claim(a.code, "U0123ABC");
    const r = await connectStatus({ codes: [a.code, b.code, "000000"] }, deps({ store }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, states: { [a.code]: "connected", [b.code]: "pending", "000000": "expired" } });
    expect(JSON.stringify(r.body)).not.toContain("U0123ABC");
  });

  it("모양이 틀리면 422: 빈 목록·너무 많음·6자리가 아님·여분 필드", async () => {
    const d = deps();
    for (const raw of [null, {}, { codes: [] }, { codes: ["12345"] }, { codes: [123456] }, { codes: ["123456"], extra: 1 }, { codes: Array.from({ length: MAX_STATUS_CODES + 1 }, (_, i) => String(100000 + i)) }]) {
      expect((await connectStatus(raw, d)).status, JSON.stringify(raw)).toBe(422);
    }
  });

  it("세팅이 끝났으면 409, 저장소 오류는 500", async () => {
    expect((await connectStatus({ codes: ["123456"] }, deps({ needsSetup: async () => false }))).status).toBe(409);
    const r = await connectStatus({ codes: ["123456"] }, deps({ store: { issue: vi.fn(), states: async () => Promise.reject(new Error("boom")), revoke: vi.fn() } }));
    expect(r.status).toBe(500);
  });
});

describe("revokeConnectCode", () => {
  it("연결된 코드도 푼다(다른 구성원으로 다시 연결할 수 있게). 없는 코드도 200", async () => {
    const store = new FsConnectCodeStore({ dir });
    const a = await store.issue({ memberKey: "m1", name: "하늘", role: "child" });
    await store.claim(a.code, "U1");
    expect((await revokeConnectCode({ code: a.code }, deps({ store }))).status).toBe(200);
    expect((await store.states([a.code]))[a.code]).toBe("expired");
    const b = await store.issue({ memberKey: "m2", name: "엄마", role: "guardian" });
    expect((await store.claim(b.code, "U1")).ok).toBe(true); // 같은 계정이 이제 다른 구성원에 연결 가능
    expect((await revokeConnectCode({ code: "000000" }, deps({ store }))).status).toBe(200);
  });
  it("모양 422, 세팅이 끝났으면 409(저장소를 부르지 않음), 오류 500", async () => {
    const revoke = vi.fn();
    const d = deps({ store: { issue: vi.fn(), states: vi.fn(), revoke } });
    for (const raw of [null, {}, { code: "12" }, { code: "123456", x: 1 }]) expect((await revokeConnectCode(raw, d)).status).toBe(422);
    expect((await revokeConnectCode({ code: "123456" }, { ...d, needsSetup: async () => false })).status).toBe(409);
    expect(revoke).not.toHaveBeenCalled();
    expect((await revokeConnectCode({ code: "123456" }, { ...d, store: { ...d.store, revoke: async () => Promise.reject(new Error("x")) } })).status).toBe(500);
  });
});
