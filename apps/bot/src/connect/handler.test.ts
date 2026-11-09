import { type ClaimResult, type ConnectCodeStore } from "@hsh/core";
import { FsConnectCodeStore } from "@hsh/core/node";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ConversationMessage, ConversationUi, Thread } from "../flow/ui";
import { AttemptLimiter, CONNECT_TEXT, ConnectHandler, LOCK_MS, MAX_FAILURES } from "./handler";

const dm: Thread = { channelId: "D1", isDirect: true };
const channel: Thread = { channelId: "C1", threadId: "1.1", isDirect: false };
const say = (text: string, userId = "U1", thread: Thread = dm): ConversationMessage => ({ text, userId, thread });

function fakeUi() {
  const posted: { thread: Thread; card: Card }[] = [];
  const whispers: { thread: Thread; userId: string; text: string }[] = [];
  const ui: Pick<ConversationUi, "post" | "whisper"> = {
    post: async (thread, card) => {
      posted.push({ thread, card });
      return { channelId: thread.channelId, messageId: "1" };
    },
    whisper: async (thread, userId, text) => void whispers.push({ thread, userId, text }),
  };
  return { ui, posted, whispers, texts: () => posted.map((p) => p.card.text) };
}

function fakeStore(result: ClaimResult = { ok: false, reason: "invalid" }) {
  const claim = vi.fn<ConnectCodeStore["claim"]>(async () => result);
  const revoke = vi.fn<ConnectCodeStore["revoke"]>(async () => {});
  return { store: { claim, revoke }, claim, revoke };
}
const record = { code: "482913", memberKey: "m1", name: "하늘", role: "child" as const, scope: "setup" as const, issuedAt: "", expiresAt: "" };

describe("ConnectHandler (가짜 저장소·가짜 응답)", () => {
  it("연결 글이 아니면 처리하지 않는다(false, 아무것도 부르지 않음)", async () => {
    const { store, claim, revoke } = fakeStore();
    const u = fakeUi();
    const h = new ConnectHandler({ store, ui: u.ui });
    for (const t of ["다음 주 화요일 3시 치과", "연결 12345", "연결", "482913"]) expect(await h.tryHandle(say(t)), t).toBe(false);
    expect(claim).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(u.posted).toEqual([]);
  });

  it("DM 성공: 코드와 보낸 슬랙 ID로 claim, 이름을 알려 준다", async () => {
    const { store, claim } = fakeStore({ ok: true, record });
    const u = fakeUi();
    expect(await new ConnectHandler({ store, ui: u.ui }).tryHandle(say("연결 482913", "U0123ABC"))).toBe(true);
    expect(claim).toHaveBeenCalledWith("482913", "U0123ABC");
    expect(u.texts()).toEqual(["'하늘'(으)로 연결했어요. 세팅을 마치면 이 슬랙 계정으로 쓸 수 있어요."]);
    expect(u.posted[0]?.thread).toEqual(dm);
  });

  it("DM에서 스레드로 말하면 그 스레드에 답한다", async () => {
    const { store } = fakeStore({ ok: true, record });
    const u = fakeUi();
    await new ConnectHandler({ store, ui: u.ui }).tryHandle(say("연결 482913", "U1", { ...dm, threadId: "9.9" }));
    expect(u.posted[0]?.thread.threadId).toBe("9.9");
  });

  it("채널에 올린 코드: 처리(claim)하지 않고 코드를 지우고, 보낸 사람에게만 알린다. 흐름으로 넘기지 않는다(true)", async () => {
    const { store, claim, revoke } = fakeStore({ ok: true, record });
    const u = fakeUi();
    expect(await new ConnectHandler({ store, ui: u.ui }).tryHandle(say("연결 482913 이거 맞아?", "U7", channel))).toBe(true);
    expect(claim).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("482913", { unclaimedOnly: true });
    expect(u.posted).toEqual([]); // 채널에 공개 답글을 달지 않는다
    expect(u.whispers).toEqual([{ thread: channel, userId: "U7", text: CONNECT_TEXT.channel }]);
    expect(CONNECT_TEXT.channel).toContain("코드는 봇 DM으로 보내 주세요");
    expect(CONNECT_TEXT.channel).toContain("새 코드를 받아 주세요");
  });

  it("틀림·만료·이미 사용은 같은 문구, 어떤 이유도 드러내지 않는다", async () => {
    const u = fakeUi();
    const h = new ConnectHandler({ store: fakeStore({ ok: false, reason: "invalid" }).store, ui: u.ui });
    await h.tryHandle(say("연결 000000"));
    expect(u.texts()).toEqual([CONNECT_TEXT.invalid]);
    expect(CONNECT_TEXT.invalid).toMatch(/^코드가 맞지 않거나 시간이 지났어요/);
    expect(CONNECT_TEXT.invalid).not.toMatch(/이미|없는|만료/);
  });

  it("이미 다른 구성원으로 연결된 계정: 거부하고 어느 이름인지 알려 준다(실패 횟수에는 세지 않는다)", async () => {
    const { store } = fakeStore({ ok: false, reason: "slack_taken", name: "엄마" });
    const u = fakeUi();
    const limiter = new AttemptLimiter(() => 0);
    const h = new ConnectHandler({ store, ui: u.ui, limiter });
    for (let i = 0; i < MAX_FAILURES + 2; i++) await h.tryHandle(say("연결 482913"));
    expect(u.texts().every((t) => t === CONNECT_TEXT.slackTaken("엄마"))).toBe(true);
    expect(u.texts()[0]).toContain("'엄마'");
  });

  it("같은 계정이 같은 코드를 또 보내면 이미 연결됐다고 알려 준다", async () => {
    const u = fakeUi();
    await new ConnectHandler({ store: fakeStore({ ok: false, reason: "already_yours", name: "하늘" }).store, ui: u.ui }).tryHandle(say("연결 482913"));
    expect(u.texts()).toEqual([CONNECT_TEXT.alreadyYours("하늘")]);
  });

  it("저장소 오류: 일반 문구로 답하고 로그에는 코드를 남기지 않는다", async () => {
    const log = vi.fn();
    const u = fakeUi();
    const store = { claim: vi.fn().mockRejectedValue(new Error("EACCES")), revoke: vi.fn() };
    expect(await new ConnectHandler({ store, ui: u.ui, log }).tryHandle(say("연결 482913"))).toBe(true);
    expect(u.texts()).toEqual([CONNECT_TEXT.failed]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("482913");
  });

  it("응답 전송까지 실패해도 던지지 않는다", async () => {
    const ui = { post: vi.fn().mockRejectedValue(new Error("slack down")), whisper: vi.fn().mockRejectedValue(new Error("slack down")) };
    const h = new ConnectHandler({ store: fakeStore().store, ui, log: () => {} });
    await expect(h.tryHandle(say("연결 482913"))).resolves.toBe(true);
    await expect(h.tryHandle(say("연결 482913", "U1", channel))).resolves.toBe(true);
  });

  it("사용자별 실패 5회면 15분 잠금: 잠긴 동안은 맞는 코드도 처리하지 않고, 다른 사용자는 영향 없음, 15분 뒤 풀림", async () => {
    let t = 1_000_000;
    const { store, claim } = fakeStore();
    const u = fakeUi();
    const h = new ConnectHandler({ store, ui: u.ui, now: () => t });
    for (let i = 0; i < MAX_FAILURES - 1; i++) await h.tryHandle(say("연결 111111", "U1"));
    expect(u.texts().every((x) => x === CONNECT_TEXT.invalid)).toBe(true);
    await h.tryHandle(say("연결 111111", "U1")); // 5번째 실패 -> 잠금 안내
    expect(u.texts().at(-1)).toBe(CONNECT_TEXT.locked);
    expect(claim).toHaveBeenCalledTimes(MAX_FAILURES);
    claim.mockResolvedValue({ ok: true, record });
    await h.tryHandle(say("연결 482913", "U1"));
    expect(u.texts().at(-1)).toBe(CONNECT_TEXT.locked);
    expect(claim).toHaveBeenCalledTimes(MAX_FAILURES); // 잠긴 동안은 저장소를 부르지 않는다
    await h.tryHandle(say("연결 482913", "U2"));
    expect(u.texts().at(-1)).toContain("연결했어요");
    t += LOCK_MS;
    await h.tryHandle(say("연결 482913", "U1"));
    expect(u.texts().at(-1)).toContain("연결했어요");
  });
});

describe("AttemptLimiter", () => {
  it("성공하면 횟수가 지워지고, 15분이 지나면 오래된 실패는 세지 않는다", () => {
    let t = 0;
    const l = new AttemptLimiter(() => t);
    for (let i = 0; i < 4; i++) l.fail("U1");
    l.succeed("U1");
    for (let i = 0; i < 4; i++) l.fail("U1");
    expect(l.lockedFor("U1")).toBe(0);
    t += LOCK_MS; // 첫 실패 뒤 15분: 새로 센다
    for (let i = 0; i < 4; i++) l.fail("U1");
    expect(l.lockedFor("U1")).toBe(0);
    l.fail("U1");
    expect(l.lockedFor("U1")).toBe(LOCK_MS);
    t += 1000;
    expect(l.lockedFor("U1")).toBe(LOCK_MS - 1000);
  });
});

describe("실제 파일 저장소와 한 바퀴 (임시 폴더)", () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "hsh-bot-connect-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("발급 -> DM -> 연결됨, 같은 DM을 두 번 보내도 한 번만, 채널 코드는 무효", async () => {
    const store = new FsConnectCodeStore({ dir });
    const u = fakeUi();
    const h = new ConnectHandler({ store, ui: u.ui });
    const a = await store.issue({ memberKey: "m1", name: "하늘", role: "child" });
    const b = await store.issue({ memberKey: "m2", name: "엄마", role: "guardian" });
    expect(await h.tryHandle(say(`연결 ${a.code}`, "U1"))).toBe(true);
    expect((await store.claimed(a.code))?.slackId).toBe("U1");
    expect(await h.tryHandle(say(`연결 ${a.code}`, "U2"))).toBe(true);
    expect(u.texts().at(-1)).toBe(CONNECT_TEXT.invalid);
    expect((await store.claimed(a.code))?.slackId).toBe("U1");
    await h.tryHandle(say(`연결 ${b.code}`, "U1")); // 같은 계정이 다른 구성원
    expect(u.texts().at(-1)).toBe(CONNECT_TEXT.slackTaken("하늘"));
    expect(CONNECT_TEXT.slackTaken("하늘")).toContain("코드를 다시 받으면 풀려요");
    await h.tryHandle(say(`연결 ${b.code}`, "U3", channel));
    expect(await store.states([b.code])).toEqual({ [b.code]: "expired" });
    // 이미 연결된 코드를 채널에 올려도 기존 연결은 그대로(연결 전 코드만 무효화한다)
    await h.tryHandle(say(`연결 ${a.code}`, "U3", channel));
    expect((await store.claimed(a.code))?.slackId).toBe("U1");
  });
});
