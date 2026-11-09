import { DEFAULT_FAMILY_ID, SETUP_NOTICE_TTL_MS, type WikiState } from "@hsh/core";
import { FsSetupNoticeStore } from "@hsh/core/node";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { slackWelcomePoster, WELCOME_CLIENT_OPTIONS } from "./slack";
import { WelcomeWorker, type WelcomeWorkerDeps } from "./worker";

let dir: string;
let t: number;
const now = () => t;
const store = () => new FsSetupNoticeStore({ dir, now: () => new Date(t), warn: () => {} });
const state: Pick<WikiState, "config" | "members"> = {
  config: { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray" },
  members: [{ id: "mom", name: "엄마", role: "guardian", color: "coral", slackId: "U111AB" }],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hsh-welcome-"));
  t = Date.parse("2026-11-09T09:00:00Z");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (s = store()) => s.put({ familyId: DEFAULT_FAMILY_ID, completedAt: new Date(t).toISOString(), version: "abc" });

function make(over: Partial<WelcomeWorkerDeps> = {}) {
  const post = vi.fn<WelcomeWorkerDeps["post"]>(async () => {});
  const warn = vi.fn();
  const readState = vi.fn<WelcomeWorkerDeps["readState"]>(async () => state);
  const w = new WelcomeWorker({ store: store(), readState, post, channel: "C123", now, log: () => {}, warn, ...over });
  return { w, post, warn, readState };
}

describe("WelcomeWorker", () => {
  it("알림이 없으면 아무것도 하지 않는다", async () => {
    const { w, post, readState } = make();
    await w.tick();
    expect(post).not.toHaveBeenCalled();
    expect(readState).not.toHaveBeenCalled();
  });

  it("알림이 있으면 #가족 채널에 환영 메시지 하나를 올리고, 다시 확인해도 올리지 않는다", async () => {
    await put();
    const { w, post } = make();
    await w.tick();
    expect(post).toHaveBeenCalledOnce();
    const [channel, text] = post.mock.calls[0]!;
    expect(channel).toBe("C123");
    expect(text).toContain("*햇살네*");
    expect(text).toContain("<@U111AB>");
    await w.tick();
    t += 60_000;
    await w.tick();
    expect(post).toHaveBeenCalledOnce();
    expect(await store().list()).toEqual([]);
  });

  it("봇 둘이 동시에 확인하거나 재시작해도 한 번만 올린다", async () => {
    await put();
    const posts: string[] = [];
    const post = async (_c: string, text: string) => void posts.push(text);
    const a = make({ post }).w;
    const b = make({ post }).w;
    await Promise.all([a.tick(), b.tick(), a.tick()]);
    await make({ post }).w.tick(); // 재시작한 봇
    expect(posts).toHaveLength(1);
  });

  it("채널이 없으면 경고 한 번(반복 없음)만 하고 알림을 남겨 두며, 채널을 설정한 봇이 올린다", async () => {
    await put();
    const { w, post, warn } = make({ channel: undefined });
    await w.tick();
    await w.tick();
    expect(post).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("SLACK_FAMILY_CHANNEL");
    expect(await store().list()).toHaveLength(1);
    const later = make();
    await later.w.tick();
    expect(later.post).toHaveBeenCalledOnce();
  });

  it("게시가 실패하면 간격을 두 배씩 늘려 다시 시도하고, 성공하면 끝난다", async () => {
    await put();
    const post = vi.fn<WelcomeWorkerDeps["post"]>().mockRejectedValueOnce(new Error("rate_limited")).mockRejectedValueOnce(new Error("rate_limited")).mockResolvedValue(undefined);
    const { w, warn } = make({ post, retryBaseMs: 1000, retryMaxMs: 10_000 });
    await w.tick();
    expect(post).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("1번째");
    t += 999;
    await w.tick(); // 아직 기다리는 중
    expect(post).toHaveBeenCalledTimes(1);
    t += 1;
    await w.tick();
    expect(post).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0]).toContain("2초");
    t += 1999;
    await w.tick();
    expect(post).toHaveBeenCalledTimes(2);
    t += 1;
    await w.tick();
    expect(post).toHaveBeenCalledTimes(3);
    expect(await store().list()).toEqual([]);
  });

  it("재시도 간격은 상한을 넘지 않는다", async () => {
    await put();
    const post = vi.fn<WelcomeWorkerDeps["post"]>().mockRejectedValue(new Error("x"));
    const { w, warn } = make({ post, retryBaseMs: 4000, retryMaxMs: 10_000 });
    for (let i = 0; i < 4; i++) {
      await w.tick();
      t += 10_000;
    }
    expect(warn.mock.calls.at(-1)![0]).toContain("10초");
  });

  it("위키를 못 읽어도 실패로 보고 재시도한다(게시하지 않음)", async () => {
    await put();
    const readState = vi.fn<WelcomeWorkerDeps["readState"]>().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValue(state);
    const { w, post } = make({ readState, retryBaseMs: 1000 });
    await w.tick();
    expect(post).not.toHaveBeenCalled();
    t += 1000;
    await w.tick();
    expect(post).toHaveBeenCalledOnce();
  });

  it("가족 설정이 비어 있으면 게시하지 않고 재시도", async () => {
    await put();
    const { w, post, warn } = make({ readState: async () => ({ ...state, config: undefined }) });
    await w.tick();
    expect(post).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("24시간이 지난 알림은 게시하지 않고 지운다(봇이 꺼져 있다 켜진 경우)", async () => {
    await put();
    t += SETUP_NOTICE_TTL_MS;
    const { w, post } = make();
    await w.tick();
    expect(post).not.toHaveBeenCalled();
    expect(await store().list()).toEqual([]);
  });

  it("24시간 안에 켜진 봇은 오래된 알림도 올린다", async () => {
    await put();
    t += SETUP_NOTICE_TTL_MS - 60_000;
    const { w, post } = make();
    await w.tick();
    expect(post).toHaveBeenCalledOnce();
  });

  it("게시는 됐는데 완료 표시를 못 하면 다시 올리지 않고 표시만 다시 시도한다", async () => {
    await put();
    const real = store();
    const complete = vi.fn().mockRejectedValueOnce(new Error("EIO")).mockImplementation((id: string) => real.complete(id));
    const { w, post, warn } = make({ store: { put: (i) => real.put(i), list: () => real.list(), claim: (i) => real.claim(i), release: (i, k) => real.release(i, k), expire: () => real.expire(), complete } });
    await w.tick();
    await w.tick();
    expect(post).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(await real.list()).toEqual([]);
  });

  it("release는 자기 토큰으로만 부른다(게시 실패 뒤)", async () => {
    await put();
    const real = store();
    const release = vi.fn(real.release.bind(real));
    const { w } = make({ post: async () => { throw new Error("x"); }, store: { put: (i) => real.put(i), list: () => real.list(), claim: (i) => real.claim(i), release, complete: (i) => real.complete(i), expire: () => real.expire() } });
    await w.tick();
    expect(release).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{32}$/), 1);
  });

  it("저장소 오류가 나도 tick은 던지지 않는다", async () => {
    const real = store();
    const bad: WelcomeWorkerDeps["store"] = { put: (i) => real.put(i), list: () => real.list(), claim: (i) => real.claim(i), release: (i, k) => real.release(i, k), complete: (i) => real.complete(i), expire: async () => { throw new Error("disk"); } };
    const { w, warn } = make({ store: bad });
    await expect(w.tick()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk"));
    await w.tick();
    await w.tick();
    expect(warn).toHaveBeenCalledOnce(); // 같은 오류가 반복되면 다시 남기지 않는다
  });
});

describe("slackWelcomePoster", () => {
  const installation = (token?: string) => ({ fetchInstallation: async () => ({ bot: token ? { token } : undefined }) as never });
  it("토큰은 InstallationStore에서 받는다(게시 때마다)", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const create = vi.fn(() => ({ chat: { postMessage } }));
    await slackWelcomePoster(installation("xoxb-from-store"), create)("C1", "안녕");
    expect(create).toHaveBeenCalledWith("xoxb-from-store");
    await expect(slackWelcomePoster(installation(undefined), create)("C1", "x")).rejects.toThrow("설치 정보");
  });

  it("클라이언트는 재시도 없이 10초 제한", () => {
    expect(WELCOME_CLIENT_OPTIONS).toEqual({ timeout: 10_000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
  });

  it("chat.postMessage로 채널에 글 하나를 올리고, ok:false나 오류는 실패로 던진다", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    await slackWelcomePoster(installation("t"), () => ({ chat: { postMessage } }))("C123", "안녕");
    expect(postMessage).toHaveBeenCalledWith({ channel: "C123", text: "안녕" });
    await expect(slackWelcomePoster(installation("t"), () => ({ chat: { postMessage: async () => ({ ok: false }) } }))("C1", "x")).rejects.toThrow();
    await expect(slackWelcomePoster(installation("t"), () => ({ chat: { postMessage: async () => { throw new Error("not_in_channel"); } } }))("C1", "x")).rejects.toThrow("not_in_channel");
  });
});
