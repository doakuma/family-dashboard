import { describe, expect, it, vi } from "vitest";
import { fetchSettingsConnectStates, postSettings } from "./client";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const view = { familyName: "햇살네", members: [], maxMembers: 12 };

describe("postSettings", () => {
  it("본문을 JSON으로 보내고 성공 응답을 읽는다", async () => {
    const f = reply(200, { ok: true, saved: true, synced: true, view });
    const r = await postSettings({ kind: "member.color", id: "haneul", color: "green" }, f);
    expect(r).toMatchObject({ ok: true, body: { saved: true, view: { familyName: "햇살네" } } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/settings");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(init.body))).toEqual({ kind: "member.color", id: "haneul", color: "green" });
  });
  it("409·422는 서버가 쓴 안내 문구와 필드 사유를 그대로", async () => {
    const r = await postSettings({ kind: "member.add", name: "x", role: "child", color: "teal" }, reply(409, { ok: false, code: "conflict", message: "이미 쓰는 id예요", issues: [{ path: "payload.id", message: "중복" }] }));
    expect(r).toEqual({ ok: false, status: 409, code: "conflict", message: "이미 쓰는 id예요", issues: [{ path: "payload.id", message: "중복" }] });
  });
  it("401·403은 서버 문구 대신 우리 문구, 5xx는 일반 문구", async () => {
    const a = await postSettings({ kind: "region", regionKey: "k" }, reply(401, { ok: false, message: "내부 사정" }));
    expect(a).toMatchObject({ ok: false, status: 401 });
    expect(a.ok === false && a.message).toContain("PIN");
    const b = await postSettings({ kind: "region", regionKey: "k" }, reply(500, { ok: false, message: "stack trace /home/x" }));
    expect(b.ok === false && b.message).not.toContain("stack");
  });
  it("503은 서버가 알려 준 설정 안내를 그대로", async () => {
    const r = await postSettings({ kind: "region", regionKey: "k" }, reply(503, { ok: false, code: "read_only", message: "WIKI_REPO_PATH를 확인해 주세요" }));
    expect(r).toMatchObject({ ok: false, status: 503, message: "WIKI_REPO_PATH를 확인해 주세요" });
  });
  it("네트워크 오류·JSON이 아닌 응답·모양이 틀린 성공 응답은 일반 오류", async () => {
    expect(await postSettings({ kind: "region", regionKey: "k" }, vi.fn(async () => { throw new Error("offline"); }))).toMatchObject({ ok: false, message: expect.stringContaining("연결하지 못했어요") });
    expect(await postSettings({ kind: "region", regionKey: "k" }, vi.fn(async () => new Response("<html>", { status: 200 })))).toMatchObject({ ok: false });
    expect(await postSettings({ kind: "region", regionKey: "k" }, reply(200, { ok: true, view: { nope: 1 } }))).toMatchObject({ ok: false });
  });
});

describe("fetchSettingsConnectStates", () => {
  it("상태 맵을 돌려주고, 401은 상태 코드를 담아 실패", async () => {
    expect(await fetchSettingsConnectStates(["123456"], reply(200, { ok: true, states: { "123456": "pending" } }))).toEqual({ ok: true, states: { "123456": "pending" } });
    expect(await fetchSettingsConnectStates(["123456"], reply(401, { ok: false }))).toMatchObject({ ok: false, status: 401 });
  });
});
