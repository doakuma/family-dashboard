import { describe, expect, it, vi } from "vitest";
import { connectErrorMessage, fetchConnectStates, requestConnectCode } from "./connect-client";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("requestConnectCode", () => {
  it("성공하면 코드, 요청에는 memberKey·이름(앞뒤 공백 제거)·역할만 보낸다", async () => {
    const f = reply(200, { ok: true, code: "482913", expiresAt: "2026-11-09T09:30:00Z" });
    expect(await requestConnectCode({ key: "m1", name: " 하늘 ", role: "child" }, f)).toEqual({ ok: true, code: "482913", expiresAt: "2026-11-09T09:30:00Z" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/setup/connect");
    expect(JSON.parse(init.body as string)).toEqual({ memberKey: "m1", name: "하늘", role: "child" });
    expect(init.credentials).toBe("same-origin");
  });
  it("실패는 상태 코드별 문구(서버 문구는 쓰지 않는다)", async () => {
    for (const status of [401, 409, 429, 500]) {
      const r = await requestConnectCode({ key: "m1", name: "a", role: "child" }, reply(status, { ok: false, message: "서버 내부 /secret" }));
      expect(r).toEqual({ ok: false, message: connectErrorMessage(status) });
      expect(JSON.stringify(r)).not.toContain("secret");
    }
  });
  it("모양이 틀린 200·JSON이 아닌 본문·네트워크 오류도 실패로", async () => {
    expect((await requestConnectCode({ key: "m1", name: "a", role: "child" }, reply(200, { ok: true, code: "12" }))).ok).toBe(false);
    expect((await requestConnectCode({ key: "m1", name: "a", role: "child" }, reply(200, "<html>"))).ok).toBe(false);
    const r = await requestConnectCode({ key: "m1", name: "a", role: "child" }, vi.fn().mockRejectedValue(new Error("net")));
    expect(r).toEqual({ ok: false, message: connectErrorMessage(undefined) });
  });
});

describe("fetchConnectStates", () => {
  it("코드별 상태", async () => {
    const f = reply(200, { ok: true, states: { "482913": "connected", "111111": "pending" } });
    expect(await fetchConnectStates(["482913", "111111"], f)).toEqual({ ok: true, states: { "482913": "connected", "111111": "pending" } });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ codes: ["482913", "111111"] });
  });
  it("알 수 없는 상태 값·실패는 ok:false + 상태 코드", async () => {
    expect((await fetchConnectStates(["1"], reply(200, { ok: true, states: { a: "weird" } }))).ok).toBe(false);
    expect(await fetchConnectStates(["1"], reply(401, { ok: false }))).toMatchObject({ ok: false, status: 401 });
    expect(await fetchConnectStates(["1"], vi.fn().mockRejectedValue(new Error("x")))).toMatchObject({ ok: false, status: undefined });
  });
});
