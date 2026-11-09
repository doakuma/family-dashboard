import { describe, expect, it, vi } from "vitest";
import { guardSetupJson, MAX_CONNECT_BYTES, type GuardDeps } from "./guard";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://x/api/setup/connect", { method: "POST", body, headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(body).length), ...headers } });
const ok: GuardDeps = { isSameOrigin: () => true, readSession: async () => ({ via: "setup" }) };

describe("guardSetupJson (출처 -> 세션 -> 본문)", () => {
  it("통과하면 파싱한 JSON", async () => {
    expect(await guardSetupJson(post('{"a":1}'), ok, MAX_CONNECT_BYTES)).toEqual({ ok: true, value: { a: 1 } });
  });
  it("출처가 다르면 403(세션·본문은 보지 않는다)", async () => {
    const readSession = vi.fn();
    const r = await guardSetupJson(post("{}"), { isSameOrigin: () => false, readSession }, 100);
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(readSession).not.toHaveBeenCalled();
  });
  it("세션이 없거나 via=setup이 아니면 401", async () => {
    for (const s of [undefined, { via: "admin" }, {}]) expect(await guardSetupJson(post("{}"), { ...ok, readSession: async () => s }, 100), JSON.stringify(s)).toMatchObject({ ok: false, status: 401 });
  });
  it("본문: JSON이 아니면 415, 길이 없으면 411, 상한 초과 413, 깨지면 400", async () => {
    expect(await guardSetupJson(post("{}", { "content-type": "text/plain" }), ok, 100)).toMatchObject({ status: 415 });
    expect(await guardSetupJson(post("{}", { "content-length": "" }), ok, 100)).toMatchObject({ status: 411 });
    expect(await guardSetupJson(post(JSON.stringify({ x: "a".repeat(MAX_CONNECT_BYTES) })), ok, MAX_CONNECT_BYTES)).toMatchObject({ status: 413 });
    expect(await guardSetupJson(post("{nope"), ok, 100)).toMatchObject({ status: 400 });
  });
  it("실패 본문에 내부 정보를 싣지 않는다", async () => {
    const r = await guardSetupJson(post("{nope"), ok, 100);
    expect(r.ok === false && Object.keys(r.body).sort()).toEqual(["code", "message", "ok"]);
  });
});
