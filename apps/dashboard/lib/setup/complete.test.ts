import { SetupError, type WikiRepository } from "@hsh/core";
import { describe, expect, it, vi } from "vitest";
import { runSetup } from "./complete";

const repoOf = (fn: WikiRepository["applySetup"]): Pick<WikiRepository, "applySetup"> => ({ applySetup: fn });

describe("runSetup (HTTP 번역)", () => {
  it("성공: 200 + commit/pushed, overwrite는 true일 때만 넘긴다", async () => {
    const fn = vi.fn().mockResolvedValue({ commit: "abc", pushed: false });
    expect(await runSetup({ setup: { a: 1 } }, repoOf(fn))).toEqual({ status: 200, body: { ok: true, commit: "abc", pushed: false } });
    expect(fn).toHaveBeenCalledWith({ a: 1 }, { overwrite: false });
    await runSetup({ setup: {}, overwrite: true }, repoOf(fn));
    expect(fn).toHaveBeenLastCalledWith({}, { overwrite: true });
  });

  it("push 실패 원인을 그대로 전달", async () => {
    const r = await runSetup({ setup: {} }, repoOf(async () => ({ commit: "c", pushed: false, pushError: "rejected" })));
    expect(r.body).toMatchObject({ ok: true, pushed: false, pushError: "rejected" });
  });

  it("본문 모양이 틀리면 400 (repo는 부르지 않는다)", async () => {
    const fn = vi.fn();
    for (const raw of [null, [], "x", {}, { setup: {}, overwrite: "yes" }]) expect((await runSetup(raw, repoOf(fn))).status, JSON.stringify(raw)).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("invalid -> 422 + 필드별 issues, already_done·needs_confirm -> 409, read_only -> 503", async () => {
    const issues = [{ path: "config.familyName", message: "x" }];
    const err = (code: ConstructorParameters<typeof SetupError>[1]) => runSetup({ setup: {} }, repoOf(async () => Promise.reject(new SetupError("m", code, issues))));
    expect(await err("invalid")).toMatchObject({ status: 422, body: { ok: false, code: "invalid", issues } });
    expect(await err("already_done")).toMatchObject({ status: 409, body: { code: "already_done" } });
    expect(await err("needs_confirm")).toMatchObject({ status: 409, body: { code: "needs_confirm" } });
    expect(await err("read_only")).toMatchObject({ status: 503, body: { code: "read_only" } });
    expect((await err("already_done")).body).not.toHaveProperty("issues");
  });

  it("예기치 못한 오류는 500, 내부 메시지는 응답에 싣지 않고 로그에만", async () => {
    const log = vi.fn();
    const r = await runSetup({ setup: {} }, repoOf(async () => Promise.reject(new Error("fatal: /secret/path index.lock"))), log);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("index.lock"));
  });
});
