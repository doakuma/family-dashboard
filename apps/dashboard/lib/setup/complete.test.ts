import { DEFAULT_FAMILY_ID, SetupError, type WikiRepository } from "@hsh/core";
import { describe, expect, it, vi } from "vitest";
import { runSetup } from "./complete";

const repoOf = (fn: WikiRepository["applySetup"]): Pick<WikiRepository, "applySetup"> => ({ applySetup: fn });

const valid = {
  config: { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray" },
  members: [{ id: "mom", name: "엄마", role: "guardian", color: "coral" }],
  anniversaries: [],
};

describe("runSetup (HTTP 번역)", () => {
  it("성공: 200 + synced(version은 응답에 없고 로그로), overwrite는 true일 때만 넘긴다", async () => {
    const fn = vi.fn().mockResolvedValue({ version: "abc", synced: false });
    const info = vi.fn();
    expect(await runSetup({ setup: valid }, repoOf(fn), DEFAULT_FAMILY_ID, undefined, info)).toEqual({ status: 200, body: { ok: true, synced: false } });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("version=abc"));
    expect(fn).toHaveBeenCalledWith(DEFAULT_FAMILY_ID, valid, { overwrite: false });
    await runSetup({ setup: valid, overwrite: true }, repoOf(fn), DEFAULT_FAMILY_ID);
    expect(fn).toHaveBeenLastCalledWith(DEFAULT_FAMILY_ID, valid, { overwrite: true });
  });

  it("동기화 실패 원인을 그대로 전달", async () => {
    const r = await runSetup({ setup: valid }, repoOf(async () => ({ version: "c", synced: false, syncError: "rejected" })), DEFAULT_FAMILY_ID, undefined, () => {});
    expect(r.body).toMatchObject({ ok: true, synced: false, syncError: "rejected" });
  });

  it("본문 모양이 틀리면 400 (repo는 부르지 않는다)", async () => {
    const fn = vi.fn();
    for (const raw of [null, [], "x", {}, { setup: {}, overwrite: "yes" }]) expect((await runSetup(raw, repoOf(fn), DEFAULT_FAMILY_ID)).status, JSON.stringify(raw)).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("스키마를 통과하지 못한 setup은 422 + issues, repo는 부르지 않는다", async () => {
    const fn = vi.fn();
    const r = await runSetup({ setup: { ...valid, members: [] } }, repoOf(fn), DEFAULT_FAMILY_ID);
    expect(r).toMatchObject({ status: 422, body: { ok: false, code: "invalid" } });
    expect(r.body.ok === false && r.body.issues?.length).toBeGreaterThan(0);
    expect((await runSetup({ setup: {} }, repoOf(fn), DEFAULT_FAMILY_ID)).status).toBe(422);
    expect(fn).not.toHaveBeenCalled();
  });

  it("invalid -> 422 + 필드별 issues, already_done·needs_confirm -> 409, read_only -> 503", async () => {
    const issues = [{ path: "config.familyName", message: "x" }];
    const err = (code: ConstructorParameters<typeof SetupError>[1]) => runSetup({ setup: valid }, repoOf(async () => Promise.reject(new SetupError("m", code, issues))), DEFAULT_FAMILY_ID);
    expect(await err("invalid")).toMatchObject({ status: 422, body: { ok: false, code: "invalid", issues } });
    expect(await err("already_done")).toMatchObject({ status: 409, body: { code: "already_done" } });
    expect(await err("needs_confirm")).toMatchObject({ status: 409, body: { code: "needs_confirm" } });
    expect(await err("read_only")).toMatchObject({ status: 503, body: { code: "read_only" } });
    expect((await err("already_done")).body).not.toHaveProperty("issues");
  });

  it("예기치 못한 오류는 500, 내부 메시지는 응답에 싣지 않고 로그에만", async () => {
    const log = vi.fn();
    const r = await runSetup({ setup: valid }, repoOf(async () => Promise.reject(new Error("fatal: /secret/path index.lock"))), DEFAULT_FAMILY_ID, log);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("index.lock"));
  });
});
